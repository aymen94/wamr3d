//! Building a frame: culling, ordering and packing the uniforms of every pass.

use super::*;

fn push_color(out: &mut Vec<f32>, color: &Color, scale: f32, w: f32) {
    out.extend([color.r * scale, color.g * scale, color.b * scale, w]);
}

fn push_matrix3(out: &mut Vec<f32>, matrix: &Matrix3) {
    for column in matrix.elements.chunks_exact(3) {
        out.extend([column[0], column[1], column[2], 0.0]);
    }
}

struct Entry {
    render_order: f32,
    vertex_colors: bool,
    receive_shadow: bool,
    sprite: Option<[f32; 2]>,
    draw: Draw,
    matrix_world: Matrix4,
    material: Material,
}

/// Builds the frame for `camera` looking at the subtree of `root`.
///
/// World matrices must be up to date. Returns `None` if `camera` is not a camera.
/// Geometries without a bounding sphere get one computed and cached; that is the only
/// change made to the world.
pub fn prepare_frame(world: &mut World, root: Entity, camera: Entity, lighting: &Lighting) -> Option<Frame> {
    // WebGPU clip space has depth 0..1 whatever convention the camera was created with.
    let mut gpu_camera: Camera = *world.camera(camera)?;
    gpu_camera.coordinate_system = CoordinateSystem::WebGPU;
    gpu_camera.update_projection_matrix();

    let camera_world = world.transform(camera)?.matrix_world;
    let camera_layers = world.visibility(camera)?.layers;

    let mut view_projection = Matrix4::default();
    view_projection.multiply_matrices(&gpu_camera.projection_matrix, &gpu_camera.matrix_world_inverse);

    let mut frustum = Frustum::default();
    frustum.set_from_projection_matrix(&view_projection, CoordinateSystem::WebGPU, gpu_camera.reversed_depth);

    let mut visible = Vec::new();
    world.traverse_visible(root, |e| visible.push(e));
    let casters_from = visible.clone();

    let mut frame = Frame::default();
    let mut entries: Vec<Entry> = Vec::new();

    for object in visible {
        let Some(renderable) = world.renderable(object).copied() else {
            continue;
        };
        let (Some(visibility), Some(matrix_world)) =
            (world.visibility(object).copied(), world.transform(object).map(|t| t.matrix_world))
        else {
            continue;
        };
        let Some(geometry) = world.geometry_mut(renderable.geometry) else {
            continue;
        };
        let Some(vertices) = geometry.get_attribute("position").map(|a| a.count() as u32) else {
            continue;
        };
        if !visibility.layers.test(&camera_layers) {
            continue;
        }

        let has_colors = geometry.has_attribute("color");
        let color_key = match geometry.get_attribute("color") {
            Some(color) if color.item_size == 4 && matches!(color.array, AttributeArray::Float32(_)) => FOUR_COMPONENT_COLOR_KEY,
            _ => 0,
        };
        let available = geometry.get_index().map_or(vertices, |index| index.count() as u32);
        let range_start = geometry.draw_range.start.min(available);
        let range_end = geometry.draw_range.start.saturating_add(geometry.draw_range.count).min(available);

        if geometry.bounding_sphere.is_none() {
            geometry.compute_bounding_sphere();
        }
        let mut sphere = geometry.bounding_sphere.unwrap_or_default();
        let groups = if world.materials(object).is_empty() { Vec::new() } else { world.geometry(renderable.geometry).map_or_else(Vec::new, |g| g.groups.clone()) };

        // One part per material: the whole draw range, or one per geometry group when
        // the object has a material for each group.
        let mut parts: Vec<(Material, u32, u32)> = Vec::new();
        if groups.is_empty() {
            if let Some(material) = world.material(renderable.material) {
                parts.push((material.clone(), range_start, range_end));
            }
        } else {
            for group in &groups {
                let handle = world.materials(object).get(group.material_index as usize).copied();
                if let Some(material) = handle.and_then(|h| world.material(h)) {
                    parts.push((material.clone(), group.start.max(range_start), group.start.saturating_add(group.count).min(range_end)));
                }
            }
        }
        parts.retain(|(_, start, end)| end > start);
        if parts.is_empty() {
            continue;
        }

        frame.candidates += 1;

        // The host holds the instance transforms, so instanced objects are not culled.
        let instanced = renderable.instances != 0;
        sphere.apply_matrix4(&matrix_world);
        if visibility.frustum_culled && !instanced && !frustum.intersects_sphere(&sphere) {
            continue;
        }
        if instanced && renderable.instance_count == 0 {
            continue;
        }

        let mut view_position = Vector3::new(matrix_world.elements[12], matrix_world.elements[13], matrix_world.elements[14]);
        view_position.apply_matrix4(&gpu_camera.matrix_world_inverse);

        for (material, start, end) in parts {
            let draw = Draw {
                object,
                geometry: renderable.geometry,
                pipeline: pipeline_key(&material, renderable.primitive) | color_key,
                depth: -view_position.z,
                textures: material_textures(&material),
                start,
                count: end - start,
                instances: renderable.instances,
                instance_count: if instanced { renderable.instance_count } else { 1 },
            };
            let vertex_colors = material.vertex_colors && has_colors;
            entries.push(Entry { render_order: visibility.render_order, vertex_colors, receive_shadow: visibility.receive_shadow, sprite: renderable.sprite, draw, matrix_world, material });
        }
    }

    // A stable sort keeps scene-graph order for equal keys, so frames are deterministic.
    entries.sort_by(|a, b| {
        let by_depth = a.draw.depth.total_cmp(&b.draw.depth);
        let by_depth = if a.material.transparent { by_depth.reverse() } else { by_depth };
        a.material.transparent.cmp(&b.material.transparent).then(a.render_order.total_cmp(&b.render_order)).then(by_depth)
    });

    let lights = &lighting.lights[..lighting.lights.len().min(MAX_LIGHTS)];
    frame.frame_uniforms.extend(view_projection.elements);
    frame.frame_uniforms.extend([camera_world.elements[12], camera_world.elements[13], camera_world.elements[14], lights.len() as f32]);
    push_color(&mut frame.frame_uniforms, &lighting.sky, 1.0, 1.0);
    push_color(&mut frame.frame_uniforms, &lighting.ground, 1.0, 1.0);
    push_color(&mut frame.frame_uniforms, &lighting.fog.color, 1.0, f32::from(lighting.fog.kind as u8));
    frame.frame_uniforms.extend([lighting.fog.near, lighting.fog.far, lighting.fog.density, f32::from(lighting.tone_mapping as u8)]);
    // the camera looks down its own -Z axis
    let mut forward = Vector3::new(-camera_world.elements[8], -camera_world.elements[9], -camera_world.elements[10]);
    forward.normalize();
    frame.frame_uniforms.extend([forward.x, forward.y, forward.z, lighting.exposure]);
    let mut right = Vector3::new(camera_world.elements[0], camera_world.elements[1], camera_world.elements[2]);
    right.normalize();
    let mut up = Vector3::new(camera_world.elements[4], camera_world.elements[5], camera_world.elements[6]);
    up.normalize();
    let perspective = matches!(gpu_camera.projection, wamr_core::Projection::Perspective { .. });
    frame.frame_uniforms.extend([right.x, right.y, right.z, 0.0, up.x, up.y, up.z, f32::from(u8::from(perspective))]);
    // Shadow-casting lights, in light order, each with its layer.
    let mut casting: Vec<(usize, LightShadow, Matrix4)> = Vec::new();
    if lighting.shadows {
        for (index, light) in lights.iter().enumerate() {
            if let (Some(shadow), true) = (light.shadow, light.kind != LightKind::Point && casting.len() < MAX_SHADOWS) {
                // A directional light is given as a direction (position minus target), so
                // its shadow camera stands at target + direction, where three.js puts it.
                let mut eye = light.position;
                if light.kind == LightKind::Directional {
                    eye = shadow.target;
                    eye.add(&light.direction);
                }
                casting.push((index, shadow, shadow.view_projection(&eye)));
            }
        }
    }

    for (index, light) in lights.iter().enumerate() {
        let mut direction = light.direction;
        direction.normalize();
        let layer = casting.iter().position(|(i, ..)| *i == index).map_or(0.0, |layer| layer as f32 + 1.0);
        frame.frame_uniforms.extend([light.position.x, light.position.y, light.position.z, f32::from(light.kind as u8)]);
        frame.frame_uniforms.extend([direction.x, direction.y, direction.z, light.distance]);
        push_color(&mut frame.frame_uniforms, &light.color, light.intensity, light.decay);
        frame.frame_uniforms.extend([light.cone_cos, light.penumbra_cos, layer, 0.0]);
    }
    frame.frame_uniforms.resize(SHADOWS_OFFSET, 0.0);

    frame.shadow_map_width = casting.iter().map(|(_, s, _)| s.map_width.max(1)).max().unwrap_or(1);
    frame.shadow_map_height = casting.iter().map(|(_, s, _)| s.map_height.max(1)).max().unwrap_or(1);
    for (layer, (_, shadow, view_projection)) in casting.iter().enumerate() {
        // x, y from -1..1 to 0..1; WebGPU depth is already 0..1.
        let mut to_map = Matrix4::default();
        to_map.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        let mut matrix = Matrix4::default();
        matrix.multiply_matrices(&to_map, view_projection);
        let (width, height) = (shadow.map_width.max(1), shadow.map_height.max(1));
        frame.frame_uniforms.extend(matrix.elements);
        frame.frame_uniforms.extend([shadow.bias, shadow.normal_bias, shadow.intensity, shadow.radius / width as f32]);
        frame.frame_uniforms.extend([width as f32 / frame.shadow_map_width as f32, height as f32 / frame.shadow_map_height as f32, layer as f32, 0.0]);

        let pass = shadow_pass(world, &casters_from, camera_layers, view_projection, layer as u32, width, height);
        frame.shadows.push(pass);
    }
    frame.frame_uniforms.resize(ENVIRONMENT_OFFSET, 0.0);
    frame.environment = lighting.environment;
    match lighting.environment {
        Some(environment) => {
            let (width, height) = environment.layout_size();
            frame.frame_uniforms.extend([1.0 / width as f32, 1.0 / height as f32, environment.lod_max() as f32, 0.0]);
            push_matrix3(&mut frame.frame_uniforms, &environment.rotation);
        }
        None => {
            frame.frame_uniforms.extend([0.0; 4]);
            push_matrix3(&mut frame.frame_uniforms, &Matrix3::default());
        }
    }
    frame.frame_uniforms.resize(FRAME_UNIFORM_FLOATS, 0.0);

    if let Some(background) = lighting.background {
        let u = &mut frame.background_uniforms;
        u.extend(gpu_camera.projection_matrix_inverse.elements);
        let back = Vector3::new(-forward.x, -forward.y, -forward.z);
        for axis in [right, up, back] {
            u.extend([axis.x, axis.y, axis.z, 0.0]);
        }
        push_matrix3(u, &background.rotation);
        // three.js draws the background on a sphere around the camera; under an
        // orthographic projection its radius is three times the view's half height.
        let radius = if perspective { 0.0 } else { 3.0 / gpu_camera.projection_matrix.elements[5] };
        u.extend([f32::from(background.kind as u8), background.intensity, background.blurriness, radius]);
        let prefiltered = background.prefiltered();
        let (width, height) = prefiltered.layout_size();
        u.extend([1.0 / width as f32, 1.0 / height as f32, prefiltered.lod_max() as f32, 0.0]);
        frame.background = Some(background);
    }

    for Entry { draw, matrix_world, material, vertex_colors, receive_shadow, sprite, .. } in entries {
        let start = frame.object_uniforms.len();
        frame.object_uniforms.extend(matrix_world.elements);

        let mut normal_matrix = Matrix3::default();
        normal_matrix.get_normal_matrix(&matrix_world);
        push_matrix3(&mut frame.object_uniforms, &normal_matrix);

        push_color(&mut frame.object_uniforms, &material.color, 1.0, material.opacity);
        let flags = object_flags(&material, vertex_colors, receive_shadow, sprite.is_some());
        frame.object_uniforms.extend([material.roughness, material.metalness, f32::from(material.shading as u8), flags as f32]);
        push_matrix3(&mut frame.object_uniforms, &material.map_transform);
        let [center_x, center_y] = sprite.unwrap_or([0.5, 0.5]);
        frame.object_uniforms.extend([material.rotation, center_x, center_y, material.alpha_test]);
        let lit_by_environment = material.uses_environment && material.shading == wamr_core::Shading::Standard;
        let [scale_x, scale_y] = material.normal_scale;
        frame.object_uniforms.extend([material.env_map_intensity, f32::from(u8::from(lit_by_environment)), scale_x, scale_y]);
        push_color(&mut frame.object_uniforms, &material.emissive, 1.0, material.ao_map_intensity);
        push_color(&mut frame.object_uniforms, &material.specular, 1.0, material.shininess);
        frame.object_uniforms.resize(start + OBJECT_UNIFORM_FLOATS, 0.0);
        frame.draws.push(draw);
    }

    Some(frame)
}

/// The flags word of an object's uniforms: 1 vertex colours, 2 blended, 4 receives
/// shadows, 8 sprite, 16 a sprite of fixed size (no size attenuation), then one bit per texture map present: 32
/// normal, 64 roughness, 128 metalness, 256 emissive, 512 alpha, 1024 ambient occlusion.
pub fn object_flags(material: &Material, vertex_colors: bool, receive_shadow: bool, sprite: bool) -> u32 {
    let m = material.maps;
    let bit = |on: bool, value: u32| if on { value } else { 0 };
    bit(vertex_colors, 1)
        | bit(material.transparent, 2)
        | bit(receive_shadow, 4)
        | bit(sprite, 8)
        | bit(!material.size_attenuation, 16)
        | bit(m.normal != 0, 32)
        | bit(m.roughness != 0, 64)
        | bit(m.metalness != 0, 128)
        | bit(m.emissive != 0, 256)
        | bit(m.alpha != 0, 512)
        | bit(m.ao != 0, 1024)
}

/// The meshes that cast shadows into one map: visible, `cast_shadow`, on the camera's
/// layers (three.js gives a shadow camera without layers of its own the view camera's),
/// and inside the shadow camera's frustum unless instanced or not frustum-culled.
fn shadow_pass(world: &mut World, objects: &[Entity], layers: wamr_core::Layers, view_projection: &Matrix4, layer: u32, width: u32, height: u32) -> ShadowPass {
    let mut frustum = Frustum::default();
    frustum.set_from_projection_matrix(view_projection, CoordinateSystem::WebGPU, false);
    let mut pass = ShadowPass { layer, width, height, view_projection: view_projection.elements, ..ShadowPass::default() };

    for &object in objects {
        let (Some(renderable), Some(visibility), Some(matrix_world)) =
            (world.renderable(object).copied(), world.visibility(object).copied(), world.transform(object).map(|t| t.matrix_world))
        else {
            continue;
        };
        if !visibility.cast_shadow || renderable.primitive != Primitive::Mesh || renderable.sprite.is_some() || !visibility.layers.test(&layers) {
            continue;
        }
        let Some(material) = world.material(renderable.material).cloned() else {
            continue;
        };
        let Some(geometry) = world.geometry_mut(renderable.geometry) else {
            continue;
        };
        let Some(vertices) = geometry.get_attribute("position").map(|a| a.count() as u32) else {
            continue;
        };
        let available = geometry.get_index().map_or(vertices, |index| index.count() as u32);
        let start = geometry.draw_range.start.min(available);
        let end = geometry.draw_range.start.saturating_add(geometry.draw_range.count).min(available);
        if end <= start {
            continue;
        }
        if geometry.bounding_sphere.is_none() {
            geometry.compute_bounding_sphere();
        }
        let mut sphere: Sphere = geometry.bounding_sphere.unwrap_or_default();
        sphere.apply_matrix4(&matrix_world);
        let instanced = renderable.instances != 0;
        if instanced && renderable.instance_count == 0 {
            continue;
        }
        if visibility.frustum_culled && !instanced && !frustum.intersects_sphere(&sphere) {
            continue;
        }

        let side = match material.side {
            Side::Front => Side::Back,
            Side::Back => Side::Front,
            Side::Double => Side::Double,
        };
        let shadow_material = Material { side, transparent: false, depth_write: true, depth_test: true, ..Material::default() };
        pass.draws.push(Draw {
            object,
            geometry: renderable.geometry,
            pipeline: pipeline_key(&shadow_material, Primitive::Mesh),
            depth: 0.0,
            textures: [0; TEXTURE_SLOTS],
            start,
            count: end - start,
            instances: renderable.instances,
            instance_count: if instanced { renderable.instance_count } else { 1 },
        });
        let offset = pass.object_uniforms.len();
        pass.object_uniforms.extend(matrix_world.elements);
        pass.object_uniforms.resize(offset + OBJECT_UNIFORM_FLOATS, 0.0);
    }
    pass
}
