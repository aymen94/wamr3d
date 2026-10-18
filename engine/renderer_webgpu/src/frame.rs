//! Building a frame: culling, ordering and packing the uniforms of every pass.

use super::*;
use std::collections::HashMap;
use wamr_core::{MapSlot, MaterialHandle, MAP_COUNT};

mod material;
mod shadows;
pub use material::*;
use shadows::shadow_pass;

fn push_color(out: &mut Vec<f32>, color: &Color, scale: f32, w: f32) {
    out.extend([color.r * scale, color.g * scale, color.b * scale, w]);
}

fn push_matrix3(out: &mut Vec<f32>, matrix: &Matrix3) {
    for column in matrix.elements.chunks_exact(3) {
        out.extend([column[0], column[1], column[2], 0.0]);
    }
}

/// View directions and up vectors of a point light's cube faces, in layer order.
const CUBE_FACES: [([f32; 3], [f32; 3]); POINT_SHADOW_FACES] = [
    ([1.0, 0.0, 0.0], [0.0, -1.0, 0.0]),
    ([-1.0, 0.0, 0.0], [0.0, -1.0, 0.0]),
    ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
    ([0.0, -1.0, 0.0], [0.0, 0.0, -1.0]),
    ([0.0, 0.0, 1.0], [0.0, -1.0, 0.0]),
    ([0.0, 0.0, -1.0], [0.0, -1.0, 0.0]),
];

/// A draw before ordering. It keeps the material's handle, not a copy: materials are
/// shared by many draws and hold a name, so copying one per draw cost an allocation.
struct Entry {
    /// 0 opaque, 1 transmissive, 2 blended.
    category: u8,
    render_order: f32,
    vertex_colors: bool,
    receive_shadow: bool,
    sprite: Option<[f32; 2]>,
    line: bool,
    skin: u32,
    draw: Draw,
    matrix_world: Matrix4,
}

/// Skinning matrices of the frame, computed once per skinned object.
struct Skins {
    /// Per object, its first matrix plus one and its number of matrices.
    offsets: HashMap<Entity, (u32, u32)>,
}

impl Skins {
    /// The object's first matrix plus one, 0 without a skin.
    fn offset(&mut self, world: &World, object: Entity, out: &mut Vec<f32>) -> u32 {
        if world.skin(object).is_none() {
            return 0;
        }
        self.offsets
            .entry(object)
            .or_insert_with(|| {
                let first = out.len() / 16;
                world.skin_matrices(object, out);
                (first as u32 + 1, (out.len() / 16 - first) as u32)
            })
            .0
    }

    /// A local-space sphere around every pose the object's skinning matrices give `sphere`.
    /// A skinned vertex is a weighted average of its bone-transformed positions, each
    /// inside one of the transformed spheres, so it lies inside the sphere around them all.
    fn bounds(&self, object: Entity, sphere: &Sphere, matrices: &[f32]) -> Option<Sphere> {
        let &(first, count) = self.offsets.get(&object)?;
        let mut bounds = Sphere::default();
        for i in 0..count as usize {
            let start = (first as usize - 1 + i) * 16;
            let matrix = Matrix4 { elements: matrices.get(start..start + 16)?.try_into().ok()? };
            let mut posed = *sphere;
            posed.apply_matrix4(&matrix);
            bounds.union(&posed);
        }
        (count > 0).then_some(bounds)
    }
}

fn push_object(out: &mut Vec<f32>, matrix_world: &Matrix4, flags: u32, skin: u32, sprite: Option<[f32; 2]>) {
    let start = out.len();
    out.extend(matrix_world.elements);
    let mut normal_matrix = Matrix3::default();
    normal_matrix.get_normal_matrix(matrix_world);
    push_matrix3(out, &normal_matrix);
    let [center_x, center_y] = sprite.unwrap_or([0.5, 0.5]);
    out.extend([flags as f32, skin as f32, center_x, center_y]);
    out.resize(start + OBJECT_UNIFORM_FLOATS, 0.0);
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

    let mut frame = Frame { shadow_type: lighting.shadow_type, ..Frame::default() };
    let mut entries: Vec<Entry> = Vec::new();
    let mut parts: Vec<(MaterialHandle, u32, u32)> = Vec::new();
    let mut materials = Materials::new();
    let mut environments = Environments { list: Vec::new(), scene: lighting.environment };
    let mut skins = Skins { offsets: HashMap::new() };
    let mut casters: Vec<Entity> = Vec::new();

    for &object in &visible {
        let Some(renderable) = world.renderable(object).copied() else {
            continue;
        };
        let (Some(visibility), Some(matrix_world)) =
            (world.visibility(object).copied(), world.transform(object).map(|t| t.matrix_world))
        else {
            continue;
        };
        if visibility.cast_shadow {
            casters.push(object);
        }
        let skinned = world.skin(object).is_some();
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
        let aux_key = if AUX_ATTRIBUTES.iter().any(|name| geometry.has_attribute(name)) { AUX_KEY } else { 0 };
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
        parts.clear();
        if groups.is_empty() {
            if world.material(renderable.material).is_some() {
                parts.push((renderable.material, range_start, range_end));
            }
        } else {
            for group in &groups {
                let handle = world.materials(object).get(group.material_index as usize).copied();
                if let Some(handle) = handle.filter(|h| world.material(*h).is_some()) {
                    parts.push((handle, group.start.max(range_start), group.start.saturating_add(group.count).min(range_end)));
                }
            }
        }
        // the scene's override material, where the object's own allows it
        if let Some(override_material) = lighting.override_material.filter(|h| world.material(*h).is_some()) {
            for part in &mut parts {
                if world.material(part.0).is_some_and(|m| m.state.allow_override) {
                    part.0 = override_material;
                }
            }
        }
        parts.retain(|(handle, start, end)| end > start && world.material(*handle).is_some_and(|m| m.state.visible));
        if parts.is_empty() {
            continue;
        }

        frame.candidates += 1;

        // The host holds the instance transforms, so instanced objects are not culled.
        // Bones move skinned vertices beyond the geometry's bounds: those are culled with
        // a sphere around the posed geometry (three.js skins the vertices on the CPU).
        let instanced = renderable.instances != 0;
        let skin = if renderable.primitive == Primitive::Mesh { skins.offset(world, object, &mut frame.skin_matrices) } else { 0 };
        if skinned {
            match skins.bounds(object, &sphere, &frame.skin_matrices) {
                Some(posed) => sphere = posed,
                None => sphere.radius = f32::INFINITY,
            }
        }
        sphere.apply_matrix4(&matrix_world);
        if visibility.frustum_culled && !instanced && !frustum.intersects_sphere(&sphere) {
            continue;
        }
        if instanced && renderable.instance_count == 0 {
            continue;
        }

        let mut view_position = Vector3::new(matrix_world.elements[12], matrix_world.elements[13], matrix_world.elements[14]);
        view_position.apply_matrix4(&gpu_camera.matrix_world_inverse);

        for &(handle, start, end) in &parts {
            let Some(material) = world.material(handle) else {
                continue;
            };
            let category = if material.is_transmissive() {
                1
            } else if material.transparent {
                2
            } else {
                0
            };
            let key = pipeline_key(material, renderable.primitive) | color_key | aux_key;
            let vertex_colors = material.vertex_colors && has_colors;
            let (material_index, textures) = materials.get(world, handle, &mut environments, &mut frame.material_uniforms);
            let draw = Draw {
                object,
                geometry: renderable.geometry,
                pipeline: key,
                depth: -view_position.z,
                textures,
                start,
                count: end - start,
                instances: renderable.instances,
                instance_count: if instanced { renderable.instance_count } else { 1 },
                material: material_index,
                custom: material.custom,
            };
            let line = matches!(renderable.primitive, Primitive::Line | Primitive::LineSegments | Primitive::LineLoop);
            entries.push(Entry { category, render_order: visibility.render_order, vertex_colors, receive_shadow: visibility.receive_shadow, sprite: renderable.sprite, line, skin, draw, matrix_world });
        }
    }

    // Sorting indices moves 4 bytes per swap instead of a whole entry. A stable sort keeps
    // scene-graph order for equal keys, so frames are deterministic.
    let mut order: Vec<u32> = (0..entries.len() as u32).collect();
    order.sort_by(|&a, &b| {
        let (a, b) = (&entries[a as usize], &entries[b as usize]);
        let by_depth = a.draw.depth.total_cmp(&b.draw.depth);
        let by_depth = if a.category == 2 { by_depth.reverse() } else { by_depth };
        a.category.cmp(&b.category).then(a.render_order.total_cmp(&b.render_order)).then(by_depth)
    });
    frame.opaque_count = entries.iter().filter(|e| e.category == 0).count() as u32;
    frame.transmissive_count = entries.iter().filter(|e| e.category == 1).count() as u32;

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
    // the w of the right vector: half the viewport height in logical pixels, which points
    // with size attenuation are scaled by, as in three.js's WebGLRenderer
    frame.frame_uniforms.extend([right.x, right.y, right.z, lighting.viewport[1] * 0.5 / lighting.viewport[2].max(1e-6), up.x, up.y, up.z, f32::from(u8::from(perspective))]);
    // Shadow maps in light order, each with its light and view-projection: one per
    // directional or spot light, one per cube face of a point light.
    let mut casting: Vec<(usize, LightShadow, Matrix4)> = Vec::new();
    if lighting.shadows {
        for (index, light) in lights.iter().enumerate() {
            let Some(shadow) = light.shadow else {
                continue;
            };
            if light.kind == LightKind::RectArea {
                continue;
            }
            let layers = if light.kind == LightKind::Point { POINT_SHADOW_FACES } else { 1 };
            if casting.len() + layers > MAX_SHADOWS {
                continue;
            }
            if light.kind == LightKind::Point {
                // three.js renders a point light's faces with a 90 degree square camera,
                // into maps of the shadow's map width.
                let (near, far) = match shadow.projection {
                    ShadowProjection::Perspective { near, far, .. } | ShadowProjection::Orthographic { near, far, .. } => (near, far),
                };
                let face = LightShadow { projection: ShadowProjection::Perspective { fov: 90.0, aspect: 1.0, near, far }, map_height: shadow.map_width, ..shadow };
                for (direction, up) in CUBE_FACES {
                    let mut target = light.position;
                    target.add(&Vector3::new(direction[0], direction[1], direction[2]));
                    let up = Vector3::new(up[0], up[1], up[2]);
                    casting.push((index, face, face.view_projection_towards(&light.position, &target, &up)));
                }
                continue;
            }
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

    for (index, light) in lights.iter().enumerate() {
        let layer = casting.iter().position(|(i, ..)| *i == index).map_or(0.0, |layer| layer as f32 + 1.0);
        frame.frame_uniforms.extend([light.position.x, light.position.y, light.position.z, f32::from(light.kind as u8)]);
        if light.kind == LightKind::RectArea {
            let (w, h) = (light.direction, light.half_height);
            frame.frame_uniforms.extend([w.x, w.y, w.z, 0.0]);
            push_color(&mut frame.frame_uniforms, &light.color, light.intensity, 0.0);
            frame.frame_uniforms.extend([h.x, h.y, 0.0, h.z]);
            continue;
        }
        let mut direction = light.direction;
        direction.normalize();
        frame.frame_uniforms.extend([direction.x, direction.y, direction.z, light.distance]);
        push_color(&mut frame.frame_uniforms, &light.color, light.intensity, light.decay);
        frame.frame_uniforms.extend([light.cone_cos, light.penumbra_cos, layer, 0.0]);
    }
    frame.frame_uniforms.resize(SHADOWS_OFFSET, 0.0);

    frame.shadow_map_width = casting.iter().map(|(_, s, _)| s.map_width.max(1)).max().unwrap_or(1);
    frame.shadow_map_height = casting.iter().map(|(_, s, _)| s.map_height.max(1)).max().unwrap_or(1);
    let filter = f32::from(lighting.shadow_type as u8);
    for (layer, (light, shadow, view_projection)) in casting.iter().enumerate() {
        // x, y from -1..1 to 0..1; WebGPU depth is already 0..1.
        let mut to_map = Matrix4::default();
        to_map.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
        let mut matrix = Matrix4::default();
        matrix.multiply_matrices(&to_map, view_projection);
        let (width, height) = (shadow.map_width.max(1), shadow.map_height.max(1));
        frame.frame_uniforms.extend(matrix.elements);
        // three.js offsets a point light's samples on the unit sphere by radius / width,
        // which spans half as many texels of a cube face.
        let radius = if lights[*light].kind == LightKind::Point { shadow.radius * 0.5 } else { shadow.radius };
        frame.frame_uniforms.extend([shadow.bias, shadow.normal_bias, shadow.intensity, radius / width as f32]);
        frame.frame_uniforms.extend([width as f32 / frame.shadow_map_width as f32, height as f32 / frame.shadow_map_height as f32, layer as f32, filter]);
        frame.shadow_blur.push([shadow.radius, shadow.blur_samples.max(1) as f32]);

        let pass = shadow_pass(world, &casters, camera_layers, view_projection, layer as u32, width, height, &mut materials, &mut environments, &mut skins, &mut frame);
        frame.shadows.push(pass);
    }

    // the environments are known once every material of the frame was packed
    frame.frame_uniforms.resize(ENVIRONMENT_OFFSET, 0.0);
    frame.environment_lod_max = environments.lod_max();
    if environments.list.is_empty() {
        frame.frame_uniforms.extend([0.0; 16]);
    } else {
        let (width, height) = layout_size_for_lod(frame.environment_lod_max);
        let total = height * environments.list.len() as u32;
        frame.frame_uniforms.extend([1.0 / width as f32, 1.0 / total as f32, frame.environment_lod_max as f32, height as f32]);
        frame.frame_uniforms.extend([0.0; 12]);
    }
    frame.environments = environments.list;
    for coefficient in &lighting.probe {
        push_color(&mut frame.frame_uniforms, coefficient, 1.0, 0.0);
    }
    let [width, height, pixel_ratio] = lighting.viewport;
    let mips = (width.max(height).max(1.0)).log2().floor() + 1.0;
    frame.frame_uniforms.extend([1.0 / width.max(1.0), 1.0 / height.max(1.0), mips, pixel_ratio]);
    // the global clipping planes, and the camera's near and far for distance materials
    let planes = &lighting.clip_planes[..lighting.clip_planes.len().min(wamr_core::MAX_CLIP_PLANES)];
    let (near, far) = match gpu_camera.projection {
        wamr_core::Projection::Perspective { near, far, .. } | wamr_core::Projection::Orthographic { near, far, .. } => (near, far),
    };
    frame.frame_uniforms.extend([planes.len() as f32, near, far, 0.0]);
    for plane in planes {
        frame.frame_uniforms.extend(plane);
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

    frame.object_uniforms.reserve(order.len() * OBJECT_UNIFORM_FLOATS);
    frame.draws.reserve(order.len());
    for index in order {
        let Entry { draw, matrix_world, vertex_colors, receive_shadow, sprite, line, skin, .. } = entries[index as usize];
        push_object(&mut frame.object_uniforms, &matrix_world, object_flags(vertex_colors, receive_shadow, sprite.is_some(), line), skin, sprite);
        frame.draws.push(draw);
    }

    Some(frame)
}
