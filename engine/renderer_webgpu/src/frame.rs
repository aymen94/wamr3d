//! Building a frame: culling, ordering and packing the uniforms of every pass.

use super::*;
use std::collections::HashMap;
use wamr_core::{MapSlot, MaterialHandle, MAP_COUNT};

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

/// Reflectance of the dielectric layer head on, as three.js's physical material derives
/// it: `((ior - 1) / (ior + 1))^2` tinted by the specular colour, at most 1, scaled by the
/// specular intensity. The defaults give 0.04.
fn dielectric_f0(material: &Material) -> [f32; 3] {
    let ior = material.ior as f64;
    let f0 = ((ior - 1.0) / (ior + 1.0)).powi(2);
    let c = material.specular_color;
    let k = material.specular_intensity as f64;
    [c.r, c.g, c.b].map(|channel| ((f0 * channel as f64).min(1.0) * k) as f32)
}

/// The texture of each of a draw's slots, and per map (in [`MapSlot`] order) its slot
/// plus one (0 for none). Maps are given the first free slot in map order, and maps
/// reading the same texture share one, so that packed textures (occlusion, roughness and
/// metalness in one image, as glTF stores them) take a single slot. The displacement map
/// takes [`DISPLACEMENT_SLOT`]; maps beyond the free slots are left out.
pub fn material_slots(material: &Material) -> ([u32; TEXTURE_SLOTS], [u8; MAP_COUNT]) {
    let ids = material.maps.ids(material.map);
    let mut textures = [0u32; TEXTURE_SLOTS];
    let mut slots = [0u8; MAP_COUNT];
    let displacement = MapSlot::Displacement as usize;
    if ids[displacement] != 0 {
        textures[DISPLACEMENT_SLOT] = ids[displacement];
        slots[displacement] = DISPLACEMENT_SLOT as u8 + 1;
    }
    for (map, &id) in ids.iter().enumerate() {
        if id == 0 || map == displacement {
            continue;
        }
        let shared = textures.iter().enumerate().position(|(slot, &t)| t == id && slot != DISPLACEMENT_SLOT);
        let slot = shared.or_else(|| textures.iter().enumerate().position(|(slot, &t)| t == 0 && slot != DISPLACEMENT_SLOT));
        if let Some(slot) = slot {
            textures[slot] = id;
            slots[map] = slot as u8 + 1;
        }
    }
    (textures, slots)
}

/// Material flag bits (the w of the material's second vector): 2 blended, 16 points or
/// sprites of fixed size, 65536 lit by an environment, 131072 clearcoat, 262144 sheen,
/// 524288 transmission, 1048576 iridescence, 2097152 anisotropy, 4194304 premultiplied
/// alpha, 8388608 a material of lines or points drawn as quads with a colour map.
pub fn material_flags(material: &Material, lit_by_environment: bool) -> u32 {
    let bit = |on: bool, value: u32| if on { value } else { 0 };
    let standard = material.shading == wamr_core::Shading::Standard;
    let sheen = material.sheen_color;
    bit(material.transparent, 2)
        | bit(!material.size_attenuation, 16)
        | bit(standard && lit_by_environment, 65536)
        | bit(standard && material.clearcoat > 0.0, 131072)
        | bit(standard && sheen.r.max(sheen.g).max(sheen.b) > 0.0, 262144)
        | bit(standard && material.transmission > 0.0, 524288)
        | bit(standard && material.iridescence > 0.0, 1048576)
        | bit(standard && material.anisotropy != 0.0, 2097152)
        | bit(material.premultiplied_alpha, 4194304)
}

/// Packs one material's block, [`MATERIAL_UNIFORM_FLOATS`] floats as vec4s:
///
/// 0. colour and opacity
/// 1. roughness, metalness, shading model, flags ([`material_flags`])
/// 2. emissive colour (times intensity) and ambient-occlusion intensity
/// 3. Blinn-Phong's specular colour and shininess, or standard shading's dielectric
///    reflectance and specular intensity
/// 4. environment intensity, light-map intensity, normal scale
/// 5. bump scale, displacement scale and bias, alpha test
/// 6. clearcoat, clearcoat roughness, sheen roughness, ior
/// 7. sheen colour, index of the material's environment in the frame's stack
/// 8. transmission, thickness, attenuation distance (-1 for infinite), dispersion
/// 9. attenuation colour, iridescence
/// 10. iridescence ior, thickness range, anisotropy strength
/// 11. anisotropy direction (cos, sin), clearcoat normal scale
/// 12. sprite rotation, point size, line width, 0
/// 13-15. the environment's rotation, three padded columns
/// 16-63. per map in [`MapSlot`] order, two vec4: the first two rows of its uv
///     transform with its slot plus one, then with its uv set in the w of the second.
pub fn pack_material(material: &Material, slots: &[u8; MAP_COUNT], environment: Option<(u32, Matrix3)>, environment_intensity: f32, out: &mut Vec<f32>) {
    let start = out.len();
    let standard = material.shading == wamr_core::Shading::Standard;
    push_color(out, &material.color, 1.0, material.opacity);
    let flags = material_flags(material, environment.is_some());
    out.extend([material.roughness, material.metalness, f32::from(material.shading as u8), flags as f32]);
    push_color(out, &material.emissive, 1.0, material.ao_map_intensity);
    if standard {
        out.extend(dielectric_f0(material));
        out.push(material.specular_intensity);
    } else {
        push_color(out, &material.specular, 1.0, material.shininess);
    }
    let [scale_x, scale_y] = material.normal_scale;
    out.extend([environment_intensity, material.light_map_intensity, scale_x, scale_y]);
    out.extend([material.bump_scale, material.displacement_scale, material.displacement_bias, material.alpha_test]);
    out.extend([material.clearcoat, material.clearcoat_roughness, material.sheen_roughness, material.ior]);
    let index = environment.map_or(0.0, |(index, _)| index as f32);
    push_color(out, &material.sheen_color, 1.0, index);
    let attenuation = if material.attenuation_distance.is_finite() { material.attenuation_distance } else { -1.0 };
    out.extend([material.transmission, material.thickness, attenuation, material.dispersion]);
    push_color(out, &material.attenuation_color, 1.0, material.iridescence);
    let [thin, thick] = material.iridescence_thickness;
    out.extend([material.iridescence_ior, thin, thick, material.anisotropy]);
    let angle = material.anisotropy_rotation as f64;
    let [cc_x, cc_y] = material.clearcoat_normal_scale;
    out.extend([angle.cos() as f32, angle.sin() as f32, cc_x, cc_y]);
    if material.custom != 0 {
        // a custom shader's settings take the place of the sprite and environment rotation
        out.extend(material.custom_params);
    } else {
        out.extend([material.rotation, material.point_size, material.line_width, 0.0]);
        push_matrix3(out, &environment.map_or_else(Matrix3::default, |(_, rotation)| rotation));
    }
    for (map, uv) in material.map_uvs.iter().enumerate() {
        let e = uv.transform.elements;
        out.extend([e[0], e[3], e[6], f32::from(slots[map])]);
        out.extend([e[1], e[4], e[7], f32::from(uv.channel)]);
    }
    out.resize(start + MATERIAL_UNIFORM_FLOATS, 0.0);
}

/// The object flags of a draw: 1 vertex colours, 4 receives shadows, 8 sprite, 16 a
/// line drawn as quads.
pub fn object_flags(vertex_colors: bool, receive_shadow: bool, sprite: bool, line: bool) -> u32 {
    u32::from(vertex_colors) | u32::from(receive_shadow) << 2 | u32::from(sprite) << 3 | u32::from(line) << 4
}

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

/// The frame's materials, each packed once.
struct Materials {
    index: HashMap<MaterialHandle, (u32, [u32; TEXTURE_SLOTS])>,
    last: Option<(MaterialHandle, u32, [u32; TEXTURE_SLOTS])>,
}

impl Materials {
    fn new() -> Self {
        Self { index: HashMap::new(), last: None }
    }

    fn get(&mut self, world: &World, handle: MaterialHandle, environments: &mut Environments, out: &mut Vec<f32>) -> (u32, [u32; TEXTURE_SLOTS]) {
        if let Some((h, index, textures)) = self.last {
            if h == handle {
                return (index, textures);
            }
        }
        let value = *self.index.entry(handle).or_insert_with(|| {
            let index = (out.len() / MATERIAL_UNIFORM_FLOATS) as u32;
            let Some(material) = world.material(handle) else {
                out.resize(out.len() + MATERIAL_UNIFORM_FLOATS, 0.0);
                return (index, [0; TEXTURE_SLOTS]);
            };
            let (textures, slots) = material_slots(material);
            let environment = environments.for_material(material);
            pack_material(material, &slots, environment, material.env_map_intensity, out);
            (index, textures)
        });
        self.last = Some((handle, value.0, value.1));
        value
    }
}

/// The environments sampled by the frame: the scene's first, then the materials' own.
struct Environments {
    list: Vec<Environment>,
    scene: Option<Environment>,
}

impl Environments {
    fn for_material(&mut self, material: &Material) -> Option<(u32, Matrix3)> {
        if material.shading != wamr_core::Shading::Standard || !material.uses_environment {
            return None;
        }
        let wanted = if material.env_map != 0 {
            Environment { texture: material.env_map, source_width: material.env_map_width, rotation: material.env_map_rotation }
        } else {
            self.scene?
        };
        // the same texture with another rotation is the same prefiltered map
        let index = match self.list.iter().position(|e| e.texture == wanted.texture) {
            Some(index) => index,
            None if self.list.len() < MAX_ENVIRONMENTS => {
                self.list.push(wanted);
                self.list.len() - 1
            }
            None => return None,
        };
        Some((index as u32, wanted.rotation))
    }

    /// The `lodMax` all maps are prefiltered at: the largest of them, lowered until the
    /// stack fits in a texture 8192 texels high.
    fn lod_max(&self) -> u32 {
        let mut lod = self.list.iter().map(Environment::lod_max).max().unwrap_or(0).max(4);
        while lod > 4 && self.list.len() as u32 * (4 << lod) > 8192 {
            lod -= 1;
        }
        lod
    }
}

/// Skinning matrices of the frame, computed once per skinned object.
struct Skins {
    offsets: HashMap<Entity, u32>,
}

impl Skins {
    /// The object's first matrix plus one, 0 without a skin.
    fn offset(&mut self, world: &World, object: Entity, out: &mut Vec<f32>) -> u32 {
        if world.skin(object).is_none() {
            return 0;
        }
        *self.offsets.entry(object).or_insert_with(|| {
            let first = (out.len() / 16) as u32;
            world.skin_matrices(object, out);
            first + 1
        })
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
        let aux_key = if ["tangent", "uv1", "skinIndex", "skinWeight"].iter().any(|name| geometry.has_attribute(name)) { AUX_KEY } else { 0 };
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
        parts.retain(|(_, start, end)| end > start);
        if parts.is_empty() {
            continue;
        }

        frame.candidates += 1;

        // The host holds the instance transforms, and bones move skinned vertices beyond
        // the geometry's bounds, so neither is culled.
        let instanced = renderable.instances != 0;
        sphere.apply_matrix4(&matrix_world);
        if visibility.frustum_culled && !instanced && !skinned && !frustum.intersects_sphere(&sphere) {
            continue;
        }
        if instanced && renderable.instance_count == 0 {
            continue;
        }

        let mut view_position = Vector3::new(matrix_world.elements[12], matrix_world.elements[13], matrix_world.elements[14]);
        view_position.apply_matrix4(&gpu_camera.matrix_world_inverse);
        let skin = if renderable.primitive == Primitive::Mesh { skins.offset(world, object, &mut frame.skin_matrices) } else { 0 };

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

/// The meshes that cast shadows into one map: visible, `cast_shadow`, on the camera's
/// layers (three.js gives a shadow camera without layers of its own the view camera's),
/// and inside the shadow camera's frustum unless instanced, skinned or not
/// frustum-culled.
#[allow(clippy::too_many_arguments)]
fn shadow_pass(
    world: &mut World,
    objects: &[Entity],
    layers: wamr_core::Layers,
    view_projection: &Matrix4,
    layer: u32,
    width: u32,
    height: u32,
    materials: &mut Materials,
    environments: &mut Environments,
    skins: &mut Skins,
    frame: &mut Frame,
) -> ShadowPass {
    let mut frustum = Frustum::default();
    frustum.set_from_projection_matrix(view_projection, CoordinateSystem::WebGPU, false);
    let mut pass = ShadowPass { layer, width, height, view_projection: view_projection.elements, ..ShadowPass::default() };

    for &object in objects {
        let (Some(renderable), Some(visibility), Some(matrix_world)) =
            (world.renderable(object).copied(), world.visibility(object).copied(), world.transform(object).map(|t| t.matrix_world))
        else {
            continue;
        };
        if renderable.primitive != Primitive::Mesh || renderable.sprite.is_some() || !visibility.layers.test(&layers) {
            continue;
        }
        let Some(side) = world.material(renderable.material).map(|m| m.side) else {
            continue;
        };
        let skinned = world.skin(object).is_some();
        let Some(geometry) = world.geometry_mut(renderable.geometry) else {
            continue;
        };
        let Some(vertices) = geometry.get_attribute("position").map(|a| a.count() as u32) else {
            continue;
        };
        let aux_key = if ["tangent", "uv1", "skinIndex", "skinWeight"].iter().any(|name| geometry.has_attribute(name)) { AUX_KEY } else { 0 };
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
        if visibility.frustum_culled && !instanced && !skinned && !frustum.intersects_sphere(&sphere) {
            continue;
        }
        let side = match side {
            Side::Front => Side::Back,
            Side::Back => Side::Front,
            Side::Double => Side::Double,
        };
        // the material's textures and block go along, for its alpha test and displacement
        let (material_index, textures) = materials.get(world, renderable.material, environments, &mut frame.material_uniforms);
        let shadow_material = Material { side, transparent: false, depth_write: true, depth_test: true, ..Material::default() };
        let skin = skins.offset(world, object, &mut frame.skin_matrices);
        pass.draws.push(Draw {
            object,
            geometry: renderable.geometry,
            pipeline: pipeline_key(&shadow_material, Primitive::Mesh) | aux_key,
            depth: 0.0,
            textures,
            start,
            count: end - start,
            instances: renderable.instances,
            instance_count: if instanced { renderable.instance_count } else { 1 },
            material: material_index,
            custom: 0,
        });
        push_object(&mut pass.object_uniforms, &matrix_world, 0, skin, None);
    }
    pass
}
