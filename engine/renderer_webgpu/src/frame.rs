//! Building a frame: culling, ordering and packing the uniforms of every pass.

use super::*;
use wamr_core::IdHashMap;
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
#[derive(Default)]
struct Skins {
    /// Per object, its first matrix plus one and its number of matrices.
    offsets: IdHashMap<Entity, (u32, u32)>,
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

/// What a frame reads of a geometry, the same for every object that draws it.
#[derive(Clone, Copy)]
struct GeometryInfo {
    has_colors: bool,
    color_key: u32,
    aux_key: u32,
    range_start: u32,
    range_end: u32,
    /// In the geometry's space.
    sphere: Sphere,
    /// The geometry's place among the frame's geometries, for [`group_order_free_runs`].
    slot: u32,
}

impl GeometryInfo {
    /// `None` without positions. Computes and caches the bounding sphere if missing.
    fn of(geometry: &mut wamr_core::BufferGeometry) -> Option<Self> {
        let vertices = geometry.get_attribute("position")?.count() as u32;
        let color = geometry.get_attribute("color");
        let color_key = match color {
            Some(color) if color.item_size == 4 && matches!(color.array, AttributeArray::Float32(_)) => FOUR_COMPONENT_COLOR_KEY,
            _ => 0,
        };
        let has_colors = color.is_some();
        let aux_key = if AUX_ATTRIBUTES.iter().any(|name| geometry.has_attribute(name)) { AUX_KEY } else { 0 };
        let available = geometry.get_index().map_or(vertices, |index| index.count() as u32);
        let range_start = geometry.draw_range.start.min(available);
        let range_end = geometry.draw_range.start.saturating_add(geometry.draw_range.count).min(available);
        if geometry.bounding_sphere.is_none() {
            geometry.compute_bounding_sphere();
        }
        Some(Self { has_colors, color_key, aux_key, range_start, range_end, sphere: geometry.bounding_sphere.unwrap_or_default(), slot: 0 })
    }
}

/// The group key of a draw whose order matters; see [`group_order_free_runs`].
const NOT_ORDER_FREE: u64 = u64::MAX;

/// Within each run of opaque draws of one render order, when every draw of the run is
/// order-free, puts draws with the same group key (pipeline key, material, geometry) next
/// to each other, so that the hosts can issue them together, and groups of the same
/// pipeline key and material next to each other, so that the hosts bind each material
/// once rather than for every draw when each object has a geometry of its own. Pipeline
/// and material pairs follow the depth order of their nearest draw, groups within a pair
/// likewise, and each group stays nearest first (a stable counting sort of the
/// depth-sorted run).
///
/// An order-free draw tests and writes depth with `Less` or `LessEqual` and writes colour
/// without blending or stencil, so of two such draws covering a pixel the nearer one is
/// kept whichever comes first; only exactly equal depths can resolve differently. A run
/// holding any other draw (depth writes off, other depth functions, stencil) keeps its
/// order, since those draws depend on what was drawn before them.
fn group_order_free_runs(keys: &mut [u128], group_keys: &[u64], grouping: &mut Grouping) {
    let Grouping { ranks, pair_ranks, counts, pairs, pair_starts, ranked, scratch } = grouping;
    let mut start = 0;
    while start < keys.len() {
        let run_key = keys[start] >> 64;
        let mut end = start + 1;
        while end < keys.len() && keys[end] >> 64 == run_key {
            end += 1;
        }
        let run = &mut keys[start..end];
        start = end;
        if run.len() < 3 || run.iter().any(|&key| group_keys[key as u32 as usize] == NOT_ORDER_FREE) {
            continue;
        }
        ranks.clear();
        pair_ranks.clear();
        counts.clear();
        pairs.clear();
        pair_starts.clear();
        ranked.clear();
        for &key in run.iter() {
            let group_key = group_keys[key as u32 as usize];
            let next = counts.len() as u32;
            let rank = *ranks.entry(group_key).or_insert(next);
            if rank == next {
                counts.push(0u32);
                // the pipeline key and material: the group key without its geometry
                let next_pair = pair_starts.len() as u32;
                let pair = *pair_ranks.entry(group_key >> 16).or_insert(next_pair);
                if pair == next_pair {
                    pair_starts.push(0u32);
                }
                pairs.push(pair);
            }
            counts[rank as usize] += 1;
            ranked.push(rank);
        }
        if counts.len() < 2 {
            continue;
        }
        // first position of each pair, then of each group (groups in rank order, so a
        // pair's groups keep the order of their nearest draws), then each draw in run order
        for (&count, &pair) in counts.iter().zip(pairs.iter()) {
            pair_starts[pair as usize] += count;
        }
        let mut at = 0;
        for start in pair_starts.iter_mut() {
            let n = *start;
            *start = at;
            at += n;
        }
        for (count, &pair) in counts.iter_mut().zip(pairs.iter()) {
            let n = *count;
            *count = pair_starts[pair as usize];
            pair_starts[pair as usize] += n;
        }
        scratch.clear();
        scratch.resize(run.len(), 0u128);
        for (&key, &rank) in run.iter().zip(ranked.iter()) {
            scratch[counts[rank as usize] as usize] = key;
            counts[rank as usize] += 1;
        }
        run.copy_from_slice(scratch);
    }
}

/// The working buffers of [`group_order_free_runs`].
#[derive(Default)]
struct Grouping {
    ranks: IdHashMap<u64, u32>,
    pair_ranks: IdHashMap<u64, u32>,
    counts: Vec<u32>,
    /// Per group, the rank of its pipeline key and material.
    pairs: Vec<u32>,
    pair_starts: Vec<u32>,
    ranked: Vec<u32>,
    scratch: Vec<u128>,
}

/// The working buffers of [`prepare_frame_into`], kept between frames so that preparing a
/// frame again reuses their capacity instead of allocating.
#[derive(Default)]
pub struct FrameScratch {
    stack: Vec<Entity>,
    visible: Vec<Entity>,
    entries: Vec<Entry>,
    parts: Vec<(MaterialHandle, u32, u32)>,
    groups: Vec<wamr_core::Group>,
    group_keys: Vec<u64>,
    keys: Vec<u128>,
    grouping: Grouping,
    materials: Materials,
    skins: Skins,
    casters: Vec<Entity>,
    geometry_infos: IdHashMap<GeometryHandle, GeometryInfo>,
    casting: Vec<(usize, LightShadow, Matrix4)>,
}

/// Empties `frame` for a new frame, keeping the capacity of its buffers. Shadow passes
/// stay, to be refilled in place by the shadow loop. Lists every field, so a new one
/// cannot be left out.
fn reset_frame(frame: &mut Frame, shadow_type: ShadowType) {
    let Frame {
        draws,
        opaque_count,
        transmissive_count,
        frame_uniforms,
        object_uniforms,
        material_uniforms,
        skin_matrices,
        candidates,
        shadows: _,
        shadow_map_width,
        shadow_map_height,
        shadow_type: frame_shadow_type,
        shadow_blur,
        environments,
        environment_lod_max,
        background,
        background_uniforms,
    } = frame;
    draws.clear();
    *opaque_count = 0;
    *transmissive_count = 0;
    frame_uniforms.clear();
    object_uniforms.clear();
    material_uniforms.clear();
    skin_matrices.clear();
    *candidates = 0;
    *shadow_map_width = 0;
    *shadow_map_height = 0;
    *frame_shadow_type = shadow_type;
    shadow_blur.clear();
    environments.clear();
    *environment_lod_max = 0;
    *background = None;
    background_uniforms.clear();
}

/// `value`'s bits as an unsigned integer that orders as `f32::total_cmp` orders floats.
fn total_order_bits(value: f32) -> u32 {
    let bits = value.to_bits();
    if bits & 0x8000_0000 != 0 {
        !bits
    } else {
        bits | 0x8000_0000
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
/// change made to the world. To build frame after frame without allocating, keep a
/// [`Frame`] and a [`FrameScratch`] and use [`prepare_frame_into`].
pub fn prepare_frame(world: &mut World, root: Entity, camera: Entity, lighting: &Lighting) -> Option<Frame> {
    let mut frame = Frame::default();
    prepare_frame_into(world, root, camera, lighting, &mut frame, &mut FrameScratch::default()).then_some(frame)
}

/// [`prepare_frame`] into `frame`, which is overwritten, reusing the buffers of `frame` and
/// `scratch` from earlier frames. Returns false, leaving `frame` unchanged, if `camera` is
/// not a camera.
pub fn prepare_frame_into(world: &mut World, root: Entity, camera: Entity, lighting: &Lighting, frame: &mut Frame, scratch: &mut FrameScratch) -> bool {
    prepare_with(world, root, camera, lighting, frame, scratch).is_some()
}

// `None` only if `camera` is not a camera, before `frame` is touched.
fn prepare_with(world: &mut World, root: Entity, camera: Entity, lighting: &Lighting, frame: &mut Frame, scratch: &mut FrameScratch) -> Option<()> {
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

    let FrameScratch { stack, visible, entries, parts, groups, group_keys, keys, grouping, materials, skins, casters, geometry_infos, casting } = scratch;
    visible.clear();
    world.traverse_visible_with(root, stack, |e| visible.push(e));

    reset_frame(frame, lighting.shadow_type);
    entries.clear();
    // per entry, its group key for `group_order_free_runs`
    group_keys.clear();
    materials.clear();
    let mut environments = Environments { list: std::mem::take(&mut frame.environments), scene: lighting.environment };
    skins.offsets.clear();
    casters.clear();
    let mut last_geometry: Option<(GeometryHandle, GeometryInfo)> = None;
    geometry_infos.clear();

    for &object in visible.iter() {
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
        if !visibility.layers.test(&camera_layers) {
            continue;
        }

        // The attribute lookups by name are made once per geometry and frame; objects that
        // share a geometry are often neighbours in the scene graph, which skips the map.
        let geometry_info = match last_geometry {
            Some((handle, info)) if handle == renderable.geometry => info,
            _ => {
                let info = match geometry_infos.get(&renderable.geometry) {
                    Some(info) => *info,
                    None => {
                        let Some(geometry) = world.geometry_mut(renderable.geometry) else {
                            continue;
                        };
                        let Some(mut info) = GeometryInfo::of(geometry) else {
                            continue;
                        };
                        info.slot = geometry_infos.len() as u32;
                        geometry_infos.insert(renderable.geometry, info);
                        info
                    }
                };
                last_geometry = Some((renderable.geometry, info));
                info
            }
        };
        let GeometryInfo { has_colors, color_key, aux_key, range_start, range_end, sphere, slot: geometry_slot } = geometry_info;
        let mut sphere = sphere;
        groups.clear();
        if !world.materials(object).is_empty() {
            if let Some(geometry) = world.geometry(renderable.geometry) {
                groups.extend_from_slice(&geometry.groups);
            }
        }

        // One part per material: the whole draw range, or one per geometry group when
        // the object has a material for each group.
        parts.clear();
        if groups.is_empty() {
            if world.material(renderable.material).is_some() {
                parts.push((renderable.material, range_start, range_end));
            }
        } else {
            for group in groups.iter() {
                let handle = world.materials(object).get(group.material_index as usize).copied();
                if let Some(handle) = handle.filter(|h| world.material(*h).is_some()) {
                    parts.push((handle, group.start.max(range_start), group.start.saturating_add(group.count).min(range_end)));
                }
            }
        }
        // the scene's override material, where the object's own allows it
        if let Some(override_material) = lighting.override_material.filter(|h| world.material(*h).is_some()) {
            for part in parts.iter_mut() {
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

        for &(handle, start, end) in parts.iter() {
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
            let state = &material.state;
            let order_free = category == 0
                && material.custom == 0
                && material.depth_test
                && material.depth_write
                && matches!(state.depth_func, 2 | 3)
                && state.color_write
                && !state.stencil.write
                && !state.alpha_to_coverage;
            // what draws issued together share; equal keys of different draws only affect
            // how well they group, the hosts compare the draws themselves
            group_keys.push(if order_free { u64::from(draw.pipeline) << 32 | u64::from(draw.material & 0xffff) << 16 | u64::from(geometry_slot & 0xffff) } else { NOT_ORDER_FREE });
            entries.push(Entry { category, render_order: visibility.render_order, vertex_colors, receive_shadow: visibility.receive_shadow, sprite: renderable.sprite, line, skin, draw, matrix_world });
        }
    }

    // Draws sort by category, render order, then depth (front to back, back to front for
    // blended draws), and scene-graph order for equal keys, so frames are deterministic.
    // The keys are packed into one integer per draw that ends with the entry's index:
    // sorting them reads no entries and gives the order a stable sort by the same keys
    // would.
    keys.clear();
    keys.extend(entries.iter().enumerate().map(|(index, e)| {
        let depth = total_order_bits(e.draw.depth);
        let depth = if e.category == 2 { !depth } else { depth };
        u128::from(e.category) << 96 | u128::from(total_order_bits(e.render_order)) << 64 | u128::from(depth) << 32 | index as u128
    }));
    keys.sort_unstable();
    group_order_free_runs(keys, group_keys, grouping);
    let order = keys.iter().map(|&key| key as u32);
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
    casting.clear();
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
    // the passes of the previous frame are refilled, so their buffers keep their capacity
    let mut passes = std::mem::take(&mut frame.shadows);
    passes.truncate(casting.len());
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

        if layer == passes.len() {
            passes.push(ShadowPass::default());
        }
        shadow_pass(world, casters, camera_layers, view_projection, layer as u32, width, height, materials, &mut environments, skins, frame, &mut passes[layer]);
    }
    frame.shadows = passes;

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

    frame.object_uniforms.reserve(keys.len() * OBJECT_UNIFORM_FLOATS);
    frame.draws.reserve(keys.len());
    for index in order {
        let Entry { draw, matrix_world, vertex_colors, receive_shadow, sprite, line, skin, .. } = entries[index as usize];
        push_object(&mut frame.object_uniforms, &matrix_world, object_flags(vertex_colors, receive_shadow, sprite.is_some(), line), skin, sprite);
        frame.draws.push(draw);
    }

    Some(())
}

#[cfg(test)]
mod order_tests {
    use super::total_order_bits;

    #[test]
    fn packed_keys_order_as_total_cmp() {
        let values = [f32::NEG_INFINITY, -1e30, -2.5, -1.0, -f32::MIN_POSITIVE, -0.0, 0.0, f32::MIN_POSITIVE, 1.0, 2.5, 1e30, f32::INFINITY, f32::NAN, -f32::NAN];
        for a in values {
            for b in values {
                assert_eq!(total_order_bits(a).cmp(&total_order_bits(b)), a.total_cmp(&b), "{a} vs {b}");
            }
        }
    }
}
