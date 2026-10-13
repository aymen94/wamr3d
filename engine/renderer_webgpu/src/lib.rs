//! `wamr-renderer`: turns a `World` into what a WebGPU backend draws.
//!
//! This crate decides *what* is drawn and with *which data*: it culls against the
//! camera frustum, orders the draws, chooses each draw's pipeline state, packs the
//! uniform buffers and owns the shader source. Issuing the GPU calls is left to a small
//! host layer, because WebGPU is a browser API (DECISIONS.md D24).
//!
//! Scope so far: meshes and lines; unlit, diffuse or roughness/metalness shading; a
//! colour texture with a uv transform; vertex colours; alpha blending; up to
//! [`MAX_LIGHTS`] directional, point and spot lights plus sky/ground ambient.

#![forbid(unsafe_code)]

use wamr_core::{AttributeAccess, Camera, Entity, GeometryHandle, Material, Primitive, Side, World};
use wamr_math::{Color, CoordinateSystem, Frustum, Matrix3, Matrix4, Vector3};

/// Floats per object in [`Frame::object_uniforms`]. 64 floats are 256 bytes, the
/// uniform-buffer offset alignment every WebGPU implementation accepts.
pub const OBJECT_UNIFORM_FLOATS: usize = 64;

/// Floats of [`OBJECT_UNIFORM_FLOATS`] the shader reads.
pub const OBJECT_BINDING_FLOATS: usize = 48;

/// Lights the shader evaluates; further lights are ignored.
pub const MAX_LIGHTS: usize = 8;

const LIGHT_FLOATS: usize = 16;

/// Floats in [`Frame::frame_uniforms`].
pub const FRAME_UNIFORM_FLOATS: usize = LIGHTS_OFFSET + MAX_LIGHTS * LIGHT_FLOATS;

const LIGHTS_OFFSET: usize = 40;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LightKind {
    #[default]
    Directional = 0,
    Point = 1,
    Spot = 2,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Light {
    pub kind: LightKind,
    /// World position. Unused by directional lights.
    pub position: Vector3,
    /// World direction from the lit scene towards the light: for a directional or spot
    /// light, its position minus its target.
    pub direction: Vector3,
    pub color: Color,
    pub intensity: f32,
    /// Distance at which a point or spot light reaches zero; 0 for no cutoff.
    pub distance: f32,
    /// Exponent of the distance falloff; 2 is physically correct.
    pub decay: f32,
    /// Spot only: cosine of the cone's half angle, and of the angle where the
    /// penumbra starts.
    pub cone_cos: f32,
    pub penumbra_cos: f32,
}

impl Default for Light {
    fn default() -> Self {
        Self {
            kind: LightKind::Directional,
            position: Vector3::default(),
            direction: Vector3::new(0.0, 1.0, 0.0),
            color: Color::new(1.0, 1.0, 1.0),
            intensity: 1.0,
            distance: 0.0,
            decay: 2.0,
            cone_cos: 0.5,
            penumbra_cos: 0.5,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FogKind {
    #[default]
    None = 0,
    /// Fades in linearly between `near` and `far`.
    Linear = 1,
    /// Grows with the square of `density` times the distance.
    Exponential = 2,
}

/// Fades colours towards `color` with distance in front of the camera.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Fog {
    pub kind: FogKind,
    pub color: Color,
    pub near: f32,
    pub far: f32,
    pub density: f32,
}

/// The lights of a frame, ambient light arriving from above and from below, and fog.
#[derive(Clone, Debug, PartialEq)]
pub struct Lighting {
    pub lights: Vec<Light>,
    pub sky: Color,
    pub ground: Color,
    pub fog: Fog,
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            lights: vec![Light { direction: Vector3::new(0.4, 0.8, 0.5), intensity: 2.2, ..Light::default() }],
            sky: Color::new(0.52, 0.66, 0.9),
            ground: Color::new(0.03, 0.02, 0.012),
            fog: Fog::default(),
        }
    }
}

/// Pipeline state of a draw, packed into [`Draw::pipeline`]: bits 0-1 the side (0
/// front, 1 back, 2 both), bit 2 alpha blending, bit 3 depth write, bit 4 depth test,
/// bits 5-6 the primitive (0 triangles, 1 line strip, 2 line list). Draws with equal
/// values share a pipeline.
pub fn pipeline_key(material: &Material, primitive: Primitive) -> u32 {
    let side = if primitive == Primitive::Mesh { material.side } else { Side::Double };
    side as u32
        | (material.transparent as u32) << 2
        | (material.depth_write as u32) << 3
        | (material.depth_test as u32) << 4
        | (primitive as u32) << 5
}

/// One draw call.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Draw {
    pub object: Entity,
    pub geometry: GeometryHandle,
    /// See [`pipeline_key`].
    pub pipeline: u32,
    /// Distance of the object's origin in front of the camera, used for ordering.
    pub depth: f32,
    /// Colour texture id of the material; 0 for none.
    pub map: u32,
    /// First index (or vertex, without an index) and how many to draw.
    pub start: u32,
    pub count: u32,
    /// Id of the host's per-instance data and the number of instances; 0 and 1 for an
    /// ordinary draw.
    pub instances: u32,
    pub instance_count: u32,
}

/// Everything the backend needs for one frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Frame {
    /// Draws in the order to issue them: opaque ones by render order then nearest
    /// first, then blended ones by render order then farthest first.
    pub draws: Vec<Draw>,
    /// view-projection (16), camera position with the light count in w (4), sky (4),
    /// ground (4), fog colour with the fog kind in w (4), fog near, far and density (4),
    /// the camera's forward direction (4), then [`MAX_LIGHTS`] lights of 16 floats: position and kind,
    /// direction and cutoff distance, colour times intensity and decay, cone cosines.
    pub frame_uniforms: Vec<f32>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats: model matrix (16), normal matrix as
    /// three padded columns (12), colour and opacity (4), roughness, metalness, shading
    /// model and flags (4), uv transform as three padded columns (12), padding.
    pub object_uniforms: Vec<f32>,
    /// Objects that had something to draw before culling.
    pub candidates: usize,
}

/// The shader shared by every pipeline. It outputs linear colour: the target must be an
/// sRGB format so that the GPU encodes it.
pub const SHADER: &str = r#"
const RECIPROCAL_PI = 0.31830988618;

struct Light {
    // xyz position, w kind (0 directional, 1 point, 2 spot)
    position: vec4<f32>,
    // xyz direction towards the light, w cutoff distance
    direction: vec4<f32>,
    // rgb colour times intensity, w decay
    color: vec4<f32>,
    // x cosine of the cone angle, y cosine of the penumbra angle
    cone: vec4<f32>,
};

struct FrameUniforms {
    view_projection: mat4x4<f32>,
    // w is the number of lights
    camera_position: vec4<f32>,
    sky: vec4<f32>,
    ground: vec4<f32>,
    // w is the kind: 0 none, 1 linear, 2 exponential squared
    fog_color: vec4<f32>,
    // near, far, density
    fog: vec4<f32>,
    camera_forward: vec4<f32>,
    lights: array<Light, 8>,
};

struct ObjectUniforms {
    model: mat4x4<f32>,
    normal_matrix: mat3x3<f32>,
    // a is the opacity
    color: vec4<f32>,
    // roughness, metalness, shading (0 diffuse, 1 unlit, 2 standard), flags (1 vertex colours, 2 blended)
    params: vec4<f32>,
    uv_transform: mat3x3<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(2) @binding(0) var map_texture: texture_2d<f32>;
@group(2) @binding(1) var map_sampler: sampler;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec3<f32>,
    @location(4) tint: vec3<f32>,
    @location(5) depth: f32,
};

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec3<f32>,
    // per instance: the columns of the instance matrix, and a colour
    @location(4) instance_0: vec4<f32>,
    @location(5) instance_1: vec4<f32>,
    @location(6) instance_2: vec4<f32>,
    @location(7) instance_3: vec4<f32>,
    @location(8) instance_color: vec3<f32>,
};

@vertex
fn vertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let instance = mat4x4<f32>(input.instance_0, input.instance_1, input.instance_2, input.instance_3);
    let world = object.model * (instance * vec4<f32>(input.position, 1.0));
    output.clip_position = frame.view_projection * world;
    output.world_position = world.xyz;

    // dividing by the squared column lengths keeps normals right under non-uniform instance scale
    let x = input.instance_0.xyz;
    let y = input.instance_1.xyz;
    let z = input.instance_2.xyz;
    let instance_normal = mat3x3<f32>(x, y, z) * (input.normal / vec3<f32>(dot(x, x), dot(y, y), dot(z, z)));
    output.normal = object.normal_matrix * instance_normal;
    output.uv = (object.uv_transform * vec3<f32>(input.uv, 1.0)).xy;
    output.color = input.color;
    output.tint = input.instance_color;
    output.depth = dot(world.xyz - frame.camera_position.xyz, frame.camera_forward.xyz);
    return output;
}

fn fogged(color: vec3<f32>, depth: f32) -> vec3<f32> {
    let kind = frame.fog_color.w;
    if (kind < 0.5) {
        return color;
    }
    var amount = smoothstep(frame.fog.x, frame.fog.y, depth);
    if (kind > 1.5) {
        amount = 1.0 - exp(-frame.fog.z * frame.fog.z * depth * depth);
    }
    return mix(color, frame.fog_color.rgb, amount);
}

// GGX specular for one light, with f90 = 1.
fn specular(n: vec3<f32>, l: vec3<f32>, v: vec3<f32>, f0: vec3<f32>, roughness: f32) -> vec3<f32> {
    let alpha = roughness * roughness;
    let a2 = alpha * alpha;
    let h = normalize(l + v);
    let n_l = saturate(dot(n, l));
    let n_v = saturate(dot(n, v));
    let n_h = saturate(dot(n, h));
    let v_h = saturate(dot(v, h));

    let fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
    let f = f0 * (1.0 - fresnel) + vec3<f32>(fresnel);
    let gv = n_l * sqrt(a2 + (1.0 - a2) * n_v * n_v);
    let gl = n_v * sqrt(a2 + (1.0 - a2) * n_l * n_l);
    let visibility = 0.5 / max(gv + gl, 0.000001);
    let denominator = n_h * n_h * (a2 - 1.0) + 1.0;
    let distribution = RECIPROCAL_PI * a2 / (denominator * denominator);
    return f * (visibility * distribution);
}

// Approximate split-sum terms of the specular lobe: scale and bias applied to f0.
fn dfg(n_v: f32, roughness: f32) -> vec2<f32> {
    let r = roughness * vec4<f32>(-1.0, -0.0275, -0.572, 0.022) + vec4<f32>(1.0, 0.0425, 1.04, -0.04);
    let a004 = min(r.x * r.x, exp2(-9.28 * n_v)) * r.x + r.y;
    return vec2<f32>(-1.04, 1.04) * a004 + r.zw;
}

// Inverse-power falloff, brought smoothly to zero at the cutoff distance if there is one.
fn falloff(distance: f32, cutoff: f32, decay: f32) -> f32 {
    var value = 1.0 / max(pow(distance, decay), 0.01);
    if (cutoff > 0.0) {
        let ratio = distance / cutoff;
        let window = saturate(1.0 - ratio * ratio * ratio * ratio);
        value *= window * window;
    }
    return value;
}

@fragment
fn fragment(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let texel = textureSample(map_texture, map_sampler, input.uv);
    let flags = u32(object.params.w);
    var base = object.color.rgb * texel.rgb * input.tint;
    if ((flags & 1u) != 0u) {
        base *= input.color;
    }
    var alpha = 1.0;
    if ((flags & 2u) != 0u) {
        alpha = object.color.a * texel.a;
    }

    let shading = object.params.z;
    if (shading > 0.5 && shading < 1.5) {
        return vec4<f32>(fogged(base, input.depth), alpha);
    }

    var n = normalize(input.normal);
    if (!front) {
        n = -n;
    }
    let standard = shading > 1.5;
    let metalness = object.params.y;
    let roughness = max(object.params.x, 0.0525);
    let v = normalize(frame.camera_position.xyz - input.world_position);
    let f0 = mix(vec3<f32>(0.04), base, metalness);

    let ambient = mix(frame.ground.rgb, frame.sky.rgb, n.y * 0.5 + 0.5);
    var direct = vec3<f32>(0.0);
    var highlight = vec3<f32>(0.0);
    let count = min(u32(frame.camera_position.w), 8u);

    for (var i = 0u; i < count; i++) {
        let light = frame.lights[i];
        var l = light.direction.xyz;
        var strength = 1.0;

        if (light.position.w > 0.5) {
            let to_light = light.position.xyz - input.world_position;
            let distance = length(to_light);
            l = to_light / max(distance, 0.000001);
            strength = falloff(distance, light.direction.w, light.color.w);
            if (light.position.w > 1.5) {
                strength *= smoothstep(light.cone.x, light.cone.y, dot(l, light.direction.xyz));
            }
        }

        let irradiance = max(dot(n, l), 0.0) * strength * light.color.rgb;
        direct += irradiance;
        if (standard) {
            highlight += irradiance * specular(n, l, v, f0, roughness);
        }
    }

    var lit = (direct + ambient) * base * RECIPROCAL_PI;
    if (standard) {
        // Ambient light also feeds the specular lobe; what the lobe reflects, including
        // light scattered more than once, is taken from the diffuse term.
        let diffuse_color = base * (1.0 - metalness);
        let fab = dfg(saturate(dot(n, v)), roughness);
        let single = f0 * fab.x + vec3<f32>(fab.y);
        let lost = 1.0 - (fab.x + fab.y);
        let average = f0 + (1.0 - f0) * 0.047619;
        let multiple = single * average / (1.0 - lost * average) * lost;
        let scattered = single + multiple;
        let indirect = diffuse_color * (1.0 - max(max(scattered.r, scattered.g), scattered.b)) + multiple;
        lit = direct * diffuse_color * RECIPROCAL_PI + highlight + ambient * indirect * RECIPROCAL_PI;
    }
    return vec4<f32>(fogged(lit, input.depth), alpha);
}
"#;

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
                pipeline: pipeline_key(&material, renderable.primitive),
                depth: -view_position.z,
                map: material.map,
                start,
                count: end - start,
                instances: renderable.instances,
                instance_count: if instanced { renderable.instance_count } else { 1 },
            };
            let vertex_colors = material.vertex_colors && has_colors;
            entries.push(Entry { render_order: visibility.render_order, vertex_colors, draw, matrix_world, material });
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
    frame.frame_uniforms.extend([lighting.fog.near, lighting.fog.far, lighting.fog.density, 0.0]);
    // the camera looks down its own -Z axis
    let mut forward = Vector3::new(-camera_world.elements[8], -camera_world.elements[9], -camera_world.elements[10]);
    forward.normalize();
    frame.frame_uniforms.extend([forward.x, forward.y, forward.z, 0.0]);
    for light in lights {
        let mut direction = light.direction;
        direction.normalize();
        frame.frame_uniforms.extend([light.position.x, light.position.y, light.position.z, f32::from(light.kind as u8)]);
        frame.frame_uniforms.extend([direction.x, direction.y, direction.z, light.distance]);
        push_color(&mut frame.frame_uniforms, &light.color, light.intensity, light.decay);
        frame.frame_uniforms.extend([light.cone_cos, light.penumbra_cos, 0.0, 0.0]);
    }
    frame.frame_uniforms.resize(FRAME_UNIFORM_FLOATS, 0.0);

    for Entry { draw, matrix_world, material, vertex_colors, .. } in entries {
        let start = frame.object_uniforms.len();
        frame.object_uniforms.extend(matrix_world.elements);

        let mut normal_matrix = Matrix3::default();
        normal_matrix.get_normal_matrix(&matrix_world);
        push_matrix3(&mut frame.object_uniforms, &normal_matrix);

        push_color(&mut frame.object_uniforms, &material.color, 1.0, material.opacity);
        let flags = u8::from(vertex_colors) | u8::from(material.transparent) << 1;
        frame.object_uniforms.extend([material.roughness, material.metalness, f32::from(material.shading as u8), f32::from(flags)]);
        push_matrix3(&mut frame.object_uniforms, &material.map_transform);
        frame.object_uniforms.resize(start + OBJECT_UNIFORM_FLOATS, 0.0);
        frame.draws.push(draw);
    }

    Some(frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wamr_core::{AttributeArray, BufferAttribute, BufferGeometry, MaterialHandle, Renderable, Shading};
    use wamr_math::Vector4;
    use wamr_objects::box_geometry;

    /// A camera at the origin looking down -Z, and boxes at the given positions.
    fn scene(positions: &[[f32; 3]]) -> (World, Entity, Entity, Vec<Entity>) {
        let mut world = World::new();
        let (root, camera) = (world.create_object(), world.create_object());
        world.add(root, camera);
        world.set_camera(camera, Some(Camera::perspective(90.0, 1.0, 1.0, 100.0)));

        let geometry = world.create_geometry(box_geometry(1.0, 1.0, 1.0, 1, 1, 1));
        let material = world.create_material(Material { color: Color::new(1.0, 0.5, 0.25), shading: Shading::Standard, roughness: 0.5, metalness: 0.25, map: 7, ..Material::default() });
        let boxes = positions
            .iter()
            .map(|p| {
                let e = world.create_object();
                world.add(root, e);
                world.set_renderable(e, Some(Renderable::mesh(geometry, material)));
                world.transform_mut(e).unwrap().position.set(p[0], p[1], p[2]);
                e
            })
            .collect();

        world.update_matrix_world(root, false);
        (world, root, camera, boxes)
    }

    #[test]
    fn culls_outside_the_frustum_and_orders_nearest_first() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -20.0], [0.0, 0.0, -5.0], [0.0, 0.0, 5.0], [300.0, 0.0, -5.0]]);
        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();

        assert_eq!(frame.candidates, 4);
        assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[1], boxes[0]]);
        assert_eq!(frame.draws[0].depth, 5.0);
        assert_eq!(frame.object_uniforms.len(), 2 * OBJECT_UNIFORM_FLOATS);
        assert_eq!(frame.frame_uniforms.len(), FRAME_UNIFORM_FLOATS);
    }

    #[test]
    fn frustum_culled_false_invisible_objects_and_layers_are_respected() {
        let (mut world, root, camera, boxes) = scene(&[[300.0, 0.0, -5.0], [0.0, 0.0, -5.0], [0.0, 0.0, -6.0]]);
        world.visibility_mut(boxes[0]).unwrap().frustum_culled = false;
        world.visibility_mut(boxes[1]).unwrap().visible = false;
        world.visibility_mut(boxes[2]).unwrap().layers.set(4);

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]]);
    }

    #[test]
    fn render_order_comes_before_depth() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -20.0]]);
        world.visibility_mut(boxes[0]).unwrap().render_order = 1.0;
        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[1], boxes[0]]);
    }

    #[test]
    fn uniforms_hold_the_matrices_and_colour() {
        let (mut world, root, camera, _) = scene(&[[1.0, 2.0, -5.0]]);
        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();

        let o = &frame.object_uniforms;
        assert_eq!(o[12..16], [1.0, 2.0, -5.0, 1.0]);
        assert_eq!((o[16], o[21], o[26]), (1.0, 1.0, 1.0));
        assert_eq!(o[28..32], [1.0, 0.5, 0.25, 1.0]);
        assert_eq!(o[32..36], [0.5, 0.25, 2.0, 0.0]);
        assert_eq!((o[36], o[41], o[46]), (1.0, 1.0, 1.0));
        assert_eq!((frame.draws[0].start, frame.draws[0].count, frame.draws[0].pipeline, frame.draws[0].instance_count), (0, 36, 0b11000, 1));
        assert_eq!(frame.draws[0].map, 7);

        // The view-projection uses WebGPU depth: the near plane maps to 0, the far plane to 1.
        let view_projection = Matrix4 { elements: frame.frame_uniforms[..16].try_into().unwrap() };
        let depth = |z: f32| {
            let mut p = Vector4::new(0.0, 0.0, z, 1.0);
            p.apply_matrix4(&view_projection);
            p.z / p.w
        };
        assert!(depth(-1.0).abs() < 1e-6 && (depth(-100.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn needs_a_camera_and_skips_dead_or_incomplete_geometry() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
        assert!(prepare_frame(&mut world, root, boxes[0], &Lighting::default()).is_none());

        let geometry = world.renderable(boxes[0]).unwrap().geometry;
        world.geometry_mut(geometry).unwrap().set_draw_range(6, 12);
        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!((frame.draws[0].start, frame.draws[0].count), (6, 12));
        world.geometry_mut(geometry).unwrap().delete_attribute("position");
        assert!(prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap().draws.is_empty());
        world.dispose_geometry(geometry);
        assert!(prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap().draws.is_empty());
    }

    #[test]
    fn blended_draws_come_last_and_farthest_first() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -20.0], [0.0, 0.0, -10.0], [0.0, 0.0, -8.0]]);
        let glass = world.create_material(Material { transparent: true, opacity: 0.5, depth_write: false, ..Material::default() });
        let geometry = world.renderable(boxes[0]).unwrap().geometry;
        for e in [boxes[0], boxes[1]] {
            world.set_renderable(e, Some(Renderable::mesh(geometry, glass)));
        }

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[3], boxes[2], boxes[1], boxes[0]]);
        assert_eq!(frame.draws[3].pipeline, 0b10100);
        assert_eq!(frame.object_uniforms[3 * OBJECT_UNIFORM_FLOATS + 31], 0.5);
        assert_eq!(frame.object_uniforms[3 * OBJECT_UNIFORM_FLOATS + 35], 2.0);
    }

    #[test]
    fn lines_need_no_normals_and_ignore_the_side() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
        let mut segments = BufferGeometry::new();
        segments.set_attribute("position", BufferAttribute::new(AttributeArray::Float32(vec![-1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0]), 3, false));
        segments.set_attribute("color", BufferAttribute::new(AttributeArray::Float32(vec![1.0; 12]), 3, false));
        let geometry = world.create_geometry(segments);
        let material = world.create_material(Material { shading: Shading::Unlit, side: Side::Back, vertex_colors: true, ..Material::default() });
        world.set_renderable(boxes[0], Some(Renderable { primitive: Primitive::LineSegments, ..Renderable::mesh(geometry, material) }));

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!((frame.draws[0].count, frame.draws[0].pipeline), (4, 2 | 0b11000 | 2 << 5));
        assert_eq!(frame.object_uniforms[35], 1.0);
    }

    #[test]
    fn lights_are_packed_after_the_ambient_colours() {
        let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
        let mut lighting = Lighting::default();
        lighting.lights.push(Light { kind: LightKind::Spot, position: Vector3::new(1.0, 2.0, 3.0), direction: Vector3::new(0.0, 2.0, 0.0), intensity: 3.0, distance: 9.0, decay: 1.5, cone_cos: 0.8, penumbra_cos: 0.9, ..Light::default() });
        lighting.lights.extend([Light::default(); 10]);

        let f = prepare_frame(&mut world, root, camera, &lighting).unwrap().frame_uniforms;
        assert_eq!(f.len(), FRAME_UNIFORM_FLOATS);
        assert_eq!(f[19], MAX_LIGHTS as f32);
        assert_eq!(f[LIGHTS_OFFSET + 3], 0.0);
        assert_eq!(f[36..39], [0.0, 0.0, -1.0]);
        assert_eq!(f[56..70], [1.0, 2.0, 3.0, 2.0, 0.0, 1.0, 0.0, 9.0, 3.0, 3.0, 3.0, 1.5, 0.8, 0.9]);
    }

    #[test]
    fn a_material_per_group_makes_a_draw_per_group() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
        let red = world.create_material(Material { color: Color::new(1.0, 0.0, 0.0), ..Material::default() });
        let glass = world.create_material(Material { transparent: true, ..Material::default() });
        // a box has six groups of six indices; only groups 0, 1 and 4 get a material
        world.set_materials(boxes[0], vec![red, glass, MaterialHandle::from_bits(u64::MAX), MaterialHandle::from_bits(u64::MAX), red]);
        let geometry = world.renderable(boxes[0]).unwrap().geometry;
        world.geometry_mut(geometry).unwrap().set_draw_range(3, 24);

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!(frame.draws.iter().map(|d| (d.start, d.count, d.pipeline & 4)).collect::<Vec<_>>(), [(3, 3, 0), (24, 3, 0), (6, 6, 4)]);
        assert_eq!(frame.object_uniforms[28..31], [1.0, 0.0, 0.0]);
        assert_eq!(frame.candidates, 1);
    }

    #[test]
    fn instanced_objects_are_not_culled_and_carry_their_count() {
        let (mut world, root, camera, boxes) = scene(&[[300.0, 0.0, -5.0], [0.0, 0.0, -5.0]]);
        let mut renderable = *world.renderable(boxes[0]).unwrap();
        renderable.instances = 9;
        renderable.instance_count = 250;
        world.set_renderable(boxes[0], Some(renderable));

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        assert_eq!(frame.draws.iter().map(|d| (d.instances, d.instance_count)).collect::<Vec<_>>(), [(9, 250), (0, 1)]);
    }

    #[test]
    fn fog_is_packed_before_the_lights() {
        let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
        let lighting = Lighting { fog: Fog { kind: FogKind::Linear, color: Color::new(0.5, 0.6, 0.7), near: 2.0, far: 30.0, density: 0.1 }, ..Lighting::default() };
        let f = prepare_frame(&mut world, root, camera, &lighting).unwrap().frame_uniforms;
        assert_eq!(f[28..35], [0.5, 0.6, 0.7, 1.0, 2.0, 30.0, 0.1]);
    }

    #[test]
    fn shader_declares_both_entry_points() {
        assert!(SHADER.contains("fn vertex(") && SHADER.contains("fn fragment("));
    }
}
