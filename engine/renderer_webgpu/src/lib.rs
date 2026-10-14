//! `wamr-renderer`: turns a `World` into what a WebGPU backend draws.
//!
//! This crate decides *what* is drawn and with *which data*: it culls against the
//! camera frustum, orders the draws, chooses each draw's pipeline state, packs the
//! uniform buffers and owns the shader source. Issuing the GPU calls is left to a small
//! host layer, because WebGPU is a browser API (DECISIONS.md D24).
//!
//! Scope so far: meshes, lines, points and sprites; unlit, diffuse or roughness/metalness shading; a
//! colour texture with a uv transform; vertex colours; alpha blending; up to
//! [`MAX_LIGHTS`] directional, point and spot lights plus sky/ground ambient; fog; tone
//! mapping; shadow maps for up to [`MAX_SHADOWS`] directional and spot lights; image-based
//! lighting from an equirectangular environment, prefiltered like three.js's PMREM.

#![forbid(unsafe_code)]

use wamr_core::{AttributeAccess, Camera, Entity, GeometryHandle, Material, Primitive, Side, World};
use wamr_math::{Color, CoordinateSystem, Frustum, Matrix3, Matrix4, Sphere, Vector3};

/// Floats per object in [`Frame::object_uniforms`]. 64 floats are 256 bytes, the
/// uniform-buffer offset alignment every WebGPU implementation accepts.
pub const OBJECT_UNIFORM_FLOATS: usize = 64;

/// Floats of [`OBJECT_UNIFORM_FLOATS`] the shader reads.
pub const OBJECT_BINDING_FLOATS: usize = 56;

/// Lights the shader evaluates; further lights are ignored.
pub const MAX_LIGHTS: usize = 16;

const LIGHT_FLOATS: usize = 16;

/// Shadow-casting lights per frame; further ones draw without shadows.
pub const MAX_SHADOWS: usize = 4;

const SHADOW_FLOATS: usize = 24;

/// Floats in [`Frame::frame_uniforms`].
pub const FRAME_UNIFORM_FLOATS: usize = ENVIRONMENT_OFFSET + 16;

const ENVIRONMENT_OFFSET: usize = SHADOWS_OFFSET + MAX_SHADOWS * SHADOW_FLOATS;

const LIGHTS_OFFSET: usize = 48;
const SHADOWS_OFFSET: usize = LIGHTS_OFFSET + MAX_LIGHTS * LIGHT_FLOATS;

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
    /// Casts shadows when set and the frame has shadows enabled. Point lights do not
    /// cast shadows yet.
    pub shadow: Option<LightShadow>,
}

/// The projection of a light's shadow camera, with three.js's parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ShadowProjection {
    /// Directional lights: three.js defaults are -5, 5, 5, -5, 0.5, 500.
    Orthographic { left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32 },
    /// Spot lights: `fov` in degrees (three.js derives it from the cone angle).
    Perspective { fov: f32, aspect: f32, near: f32, far: f32 },
}

/// A light's shadow settings (three.js `LightShadow`). The shadow camera sits at the
/// light and looks at `target`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LightShadow {
    pub projection: ShadowProjection,
    pub target: Vector3,
    /// Added to the depth of the shaded point before the comparison.
    pub bias: f32,
    /// Moves the shaded point along its normal before projecting it, in world units.
    pub normal_bias: f32,
    /// 1 is a full shadow, 0 none.
    pub intensity: f32,
    /// Filter radius in texels.
    pub radius: f32,
    pub map_width: u32,
    pub map_height: u32,
}

impl LightShadow {
    /// The shadow camera's view-projection, with WebGPU depth (0 near, 1 far).
    pub fn view_projection(&self, light_position: &Vector3) -> Matrix4 {
        let mut camera = match self.projection {
            ShadowProjection::Orthographic { left, right, top, bottom, near, far } => Camera::orthographic(left, right, top, bottom, near, far),
            ShadowProjection::Perspective { fov, aspect, near, far } => Camera::perspective(fov, aspect, near, far),
        };
        camera.coordinate_system = CoordinateSystem::WebGPU;
        camera.update_projection_matrix();

        let mut world = Matrix4::default();
        world.look_at(light_position, &self.target, &Vector3::new(0.0, 1.0, 0.0));
        world.set_position(light_position.x, light_position.y, light_position.z);
        world.invert();

        let mut view_projection = Matrix4::default();
        view_projection.multiply_matrices(&camera.projection_matrix, &world);
        view_projection
    }
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
            shadow: None,
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

/// Maps linear scene colours to the displayable range. Values are three.js's constants;
/// 5 (custom) is not supported and draws like `None`.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToneMapping {
    #[default]
    None = 0,
    Linear = 1,
    Reinhard = 2,
    Cineon = 3,
    AcesFilmic = 4,
    AgX = 6,
    Neutral = 7,
}

impl ToneMapping {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Linear,
            2 => Self::Reinhard,
            3 => Self::Cineon,
            4 => Self::AcesFilmic,
            6 => Self::AgX,
            7 => Self::Neutral,
            _ => Self::None,
        }
    }
}

/// An equirectangular environment map, prefiltered by the host into three.js's cube-UV
/// layout (PMREM). The layout's size follows from the source width as in three.js.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Environment {
    /// The host's id of the source texture.
    pub texture: u32,
    /// Width of the source image in pixels.
    pub source_width: u32,
    /// Rotation applied to sampling directions (three.js `environmentRotation` or
    /// `envMapRotation`, already inverted).
    pub rotation: Matrix3,
}

impl Environment {
    /// `log2` of the cube face size of the prefiltered map, three.js's `lodMax`.
    pub fn lod_max(&self) -> u32 {
        ((self.source_width / 4).max(1) as f64).log2().floor() as u32
    }

    /// Width and height of the prefiltered texture.
    pub fn layout_size(&self) -> (u32, u32) {
        let cube = 1u32 << self.lod_max();
        (3 * cube.max(16 * 7), 4 * cube)
    }
}

/// The lights of a frame, ambient light arriving from above and from below, fog, the
/// tone mapping applied to the output and the environment map.
#[derive(Clone, Debug, PartialEq)]
pub struct Lighting {
    pub lights: Vec<Light>,
    pub sky: Color,
    pub ground: Color,
    pub fog: Fog,
    pub tone_mapping: ToneMapping,
    pub exposure: f32,
    /// three.js `renderer.shadowMap.enabled`.
    pub shadows: bool,
    pub environment: Option<Environment>,
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            lights: vec![Light { direction: Vector3::new(0.4, 0.8, 0.5), intensity: 2.2, ..Light::default() }],
            sky: Color::new(0.52, 0.66, 0.9),
            ground: Color::new(0.03, 0.02, 0.012),
            fog: Fog::default(),
            tone_mapping: ToneMapping::None,
            exposure: 1.0,
            shadows: false,
            environment: None,
        }
    }
}

/// Pipeline state of a draw, packed into [`Draw::pipeline`]: bits 0-1 the side (0
/// front, 1 back, 2 both), bit 2 alpha blending, bit 3 depth write, bit 4 depth test,
/// bits 5-6 the primitive (0 triangles, 1 line strip, 2 line list, 3 point list). Draws
/// with equal values share a pipeline.
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

/// The casters of one shadow map, drawn into layer `layer` of the shadow texture array
/// with depth only.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShadowPass {
    pub layer: u32,
    /// Size of this light's map; it fills the top-left of the layer.
    pub width: u32,
    pub height: u32,
    /// The shadow camera's view-projection (WebGPU depth).
    pub view_projection: [f32; 16],
    /// Pipeline keys use the side the shadow is drawn from: three.js draws the opposite
    /// side of `material.side` (both for double-sided materials).
    pub draws: Vec<Draw>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats starting with the model matrix.
    pub object_uniforms: Vec<f32>,
}

/// Everything the backend needs for one frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Frame {
    /// Draws in the order to issue them: opaque ones by render order then nearest
    /// first, then blended ones by render order then farthest first.
    pub draws: Vec<Draw>,
    /// view-projection (16), camera position with the light count in w (4), sky (4),
    /// ground (4), fog colour with the fog kind in w (4), fog near, far and density and
    /// the tone mapping (4), the camera's forward direction with the exposure in w (4),
    /// the camera's right (4) and up direction, with 1 in w for a perspective camera (4),
    /// then [`MAX_LIGHTS`] lights of 16 floats: position and kind,
    /// direction and cutoff distance, colour times intensity and decay, cone cosines.
    pub frame_uniforms: Vec<f32>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats: model matrix (16), normal matrix as
    /// three padded columns (12), colour and opacity (4), roughness, metalness, shading
    /// model and flags (4), uv transform as three padded columns (12), sprite rotation,
    /// centre and size attenuation (4), environment intensity and use (4), padding.
    pub object_uniforms: Vec<f32>,
    /// Objects that had something to draw before culling.
    pub candidates: usize,
    /// One pass per shadow-casting light, in the order of their layers.
    pub shadows: Vec<ShadowPass>,
    /// Size of each layer of the shadow texture array: the largest map of the frame.
    pub shadow_map_width: u32,
    pub shadow_map_height: u32,
    /// The environment map the frame samples, if any material uses one.
    pub environment: Option<Environment>,
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
    // x cosine of the cone angle, y cosine of the penumbra angle, z shadow index + 1 (0 none)
    cone: vec4<f32>,
};

struct Shadow {
    // light space to shadow-map coordinates: x, y in 0..1 (y still up), z the depth
    matrix: mat4x4<f32>,
    // bias, normal bias, intensity, filter radius in units of the map width
    params: vec4<f32>,
    // share of the layer the map covers (x, y), layer
    region: vec4<f32>,
};

struct FrameUniforms {
    view_projection: mat4x4<f32>,
    // w is the number of lights
    camera_position: vec4<f32>,
    sky: vec4<f32>,
    ground: vec4<f32>,
    // w is the kind: 0 none, 1 linear, 2 exponential squared
    fog_color: vec4<f32>,
    // near, far, density; w is read by the output pass
    fog: vec4<f32>,
    // w is read by the output pass
    camera_forward: vec4<f32>,
    camera_right: vec4<f32>,
    // w is 1 for a perspective camera
    camera_up: vec4<f32>,
    lights: array<Light, 16>,
    shadows: array<Shadow, 4>,
    // 1/width and 1/height of the prefiltered map (0 without one), its max mip
    environment: vec4<f32>,
    // rotation applied to sampling directions, three padded columns
    environment_rotation: mat3x3<f32>,
};

struct ObjectUniforms {
    model: mat4x4<f32>,
    normal_matrix: mat3x3<f32>,
    // a is the opacity
    color: vec4<f32>,
    // roughness, metalness, shading (0 diffuse, 1 unlit, 2 standard), flags (1 vertex colours, 2 blended, 4 receives shadows, 8 sprite)
    params: vec4<f32>,
    uv_transform: mat3x3<f32>,
    // sprites: rotation, centre x and y, size attenuation (1 or 0)
    sprite: vec4<f32>,
    // environment intensity, 1 when lit by the environment
    environment: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(2) @binding(0) var map_texture: texture_2d<f32>;
@group(2) @binding(1) var map_sampler: sampler;
@group(3) @binding(0) var shadow_map: texture_depth_2d_array;
@group(3) @binding(1) var shadow_sampler: sampler_comparison;
@group(3) @binding(2) var environment_map: texture_2d<f32>;
@group(3) @binding(3) var environment_sampler: sampler;

// The prefiltered map is written with y inverted, so directions are flipped before
// sampling (three.js r186 PMREMNode).
fn environment_sample(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
    let rotated = frame.environment_rotation * vec3<f32>(direction.x, -direction.y, direction.z);
    return cube_uv_sample(environment_map, environment_sampler, rotated, roughness, frame.environment.xy, frame.environment.z);
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec3<f32>,
    @location(4) tint: vec3<f32>,
    @location(5) depth: f32,
};

// Interleaved gradient noise of a pixel position, 0..1.
fn gradient_noise(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

// Fraction of light reaching a point (1 lit), filtered like three.js r186 PCFShadowMap:
// five comparisons on a Vogel disk turned by per-pixel noise, each bilinearly filtered.
fn shadowed(index: u32, world: vec3<f32>, normal: vec3<f32>, pixel: vec2<f32>) -> f32 {
    let shadow = frame.shadows[index];
    let projected = shadow.matrix * vec4<f32>(world + normal * shadow.params.y, 1.0);
    var coord = projected.xyz / projected.w;
    coord = vec3<f32>(coord.x, 1.0 - coord.y, coord.z + shadow.params.x);
    if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
        return 1.0;
    }
    let phi = gradient_noise(pixel) * 6.28318530718;
    let layer = i32(shadow.region.z + 0.5);
    var sum = 0.0;
    for (var k = 0u; k < 5u; k++) {
        let radius = sqrt((f32(k) + 0.5) / 5.0);
        let theta = f32(k) * 2.399963229728653 + phi;
        let uv = coord.xy + vec2<f32>(cos(theta), sin(theta)) * radius * shadow.params.w;
        sum += textureSampleCompareLevel(shadow_map, shadow_sampler, uv * shadow.region.xy, layer, coord.z);
    }
    return mix(1.0, sum / 5.0, shadow.params.z);
}

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
    var world = object.model * (instance * vec4<f32>(input.position, 1.0));
    if ((u32(object.params.w) & 8u) != 0u) {
        // A sprite: the quad's x and y, around its centre, scaled by the world scale and
        // rotated, laid out along the camera's right and up directions.
        let origin = object.model[3].xyz;
        var scale = vec2<f32>(length(object.model[0].xyz), length(object.model[1].xyz));
        if (frame.camera_up.w > 0.5 && object.sprite.w < 0.5) {
            scale *= dot(origin - frame.camera_position.xyz, frame.camera_forward.xyz);
        }
        let aligned = (input.position.xy - (object.sprite.yz - 0.5)) * scale;
        let c = cos(object.sprite.x);
        let s = sin(object.sprite.x);
        let rotated = vec2<f32>(c * aligned.x - s * aligned.y, s * aligned.x + c * aligned.y);
        world = vec4<f32>(origin + frame.camera_right.xyz * rotated.x + frame.camera_up.xyz * rotated.y, 1.0);
    }
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

    let geometry_normal = normalize(input.normal);
    var n = geometry_normal;
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
    let count = min(u32(frame.camera_position.w), 16u);

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
        let shadow_index = u32(light.cone.z + 0.5);
        if (shadow_index > 0u && (flags & 4u) != 0u) {
            strength *= shadowed(shadow_index - 1u, input.world_position, geometry_normal, input.clip_position.xy);
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
        // Image-based light: radiance along the reflection bent towards the normal by
        // roughness^4, irradiance along the normal at roughness 1 (three.js r186).
        var irradiance = ambient;
        var radiance = vec3<f32>(0.0);
        if (object.environment.y > 0.5 && frame.environment.x > 0.0) {
            let intensity = object.environment.x;
            let r2 = roughness * roughness;
            let reflected = normalize(mix(reflect(-v, n), n, r2 * r2));
            radiance = environment_sample(reflected, roughness) * intensity;
            irradiance += environment_sample(n, 1.0) * 3.141592653589793 * intensity;
        }
        lit = direct * diffuse_color * RECIPROCAL_PI + highlight + irradiance * indirect * RECIPROCAL_PI + radiance * single;
    }
    return vec4<f32>(fogged(lit, input.depth), alpha);
}
"#;

/// Depth-only shader of the shadow passes. Group 0 holds the shadow camera's
/// view-projection, group 1 the object's uniforms (only the model matrix is read).
pub const SHADOW_SHADER: &str = r#"
@group(0) @binding(0) var<uniform> view_projection: mat4x4<f32>;
@group(1) @binding(0) var<uniform> model: mat4x4<f32>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(4) instance_0: vec4<f32>,
    @location(5) instance_1: vec4<f32>,
    @location(6) instance_2: vec4<f32>,
    @location(7) instance_3: vec4<f32>,
};

@vertex
fn vertex(input: VertexInput) -> @builtin(position) vec4<f32> {
    let instance = mat4x4<f32>(input.instance_0, input.instance_1, input.instance_2, input.instance_3);
    return view_projection * (model * (instance * vec4<f32>(input.position, 1.0)));
}
"#;


/// Cube-UV sampling of a prefiltered environment (three.js r186 `textureCubeUV`), shared by
/// the mesh shader and the prefiltering passes.
pub const CUBE_UV: &str = r#"
fn cube_uv_face(direction: vec3<f32>) -> f32 {
    let a = abs(direction);
    if (a.x > a.z) {
        if (a.x > a.y) {
            return select(3.0, 0.0, direction.x > 0.0);
        }
        return select(4.0, 1.0, direction.y > 0.0);
    }
    if (a.z > a.y) {
        return select(5.0, 2.0, direction.z > 0.0);
    }
    return select(4.0, 1.0, direction.y > 0.0);
}

fn cube_uv_coordinates(direction: vec3<f32>, face: f32) -> vec2<f32> {
    var uv: vec2<f32>;
    if (face == 0.0) {
        uv = vec2<f32>(direction.z, direction.y) / abs(direction.x);
    } else if (face == 1.0) {
        uv = vec2<f32>(-direction.x, -direction.z) / abs(direction.y);
    } else if (face == 2.0) {
        uv = vec2<f32>(-direction.x, direction.y) / abs(direction.z);
    } else if (face == 3.0) {
        uv = vec2<f32>(-direction.z, direction.y) / abs(direction.x);
    } else if (face == 4.0) {
        uv = vec2<f32>(-direction.x, direction.z) / abs(direction.y);
    } else {
        uv = vec2<f32>(direction.x, direction.y) / abs(direction.z);
    }
    return 0.5 * (uv + 1.0);
}

fn cube_uv_roughness_to_mip(roughness: f32) -> f32 {
    if (roughness >= 0.8) {
        return (1.0 - roughness) * (-1.0 - -2.0) / (1.0 - 0.8) + -2.0;
    }
    if (roughness >= 0.4) {
        return (0.8 - roughness) * (2.0 - -1.0) / (0.8 - 0.4) + -1.0;
    }
    if (roughness >= 0.305) {
        return (0.4 - roughness) * (3.0 - 2.0) / (0.4 - 0.305) + 2.0;
    }
    if (roughness >= 0.21) {
        return (0.305 - roughness) * (4.0 - 3.0) / (0.305 - 0.21) + 3.0;
    }
    return -2.0 * log2(1.16 * roughness);
}

// texel: 1 / texture size; max_mip: three.js CUBEUV_MAX_MIP (lodMax).
fn cube_uv_bilinear(map: texture_2d<f32>, map_sampler: sampler, direction: vec3<f32>, mip: f32, texel: vec2<f32>, max_mip: f32) -> vec3<f32> {
    var face = cube_uv_face(direction);
    let filter_int = max(4.0 - mip, 0.0);
    let mip_int = max(mip, 4.0);
    let face_size = exp2(mip_int);
    var uv = cube_uv_coordinates(direction, face) * (face_size - 2.0) + 1.0;
    if (face > 2.0) {
        uv.y += face_size;
        face -= 3.0;
    }
    uv.x += face * face_size;
    uv.x += filter_int * 3.0 * 16.0;
    uv.y += 4.0 * (exp2(max_mip) - face_size);
    return textureSampleLevel(map, map_sampler, uv * texel, 0.0).rgb;
}

fn cube_uv_sample(map: texture_2d<f32>, map_sampler: sampler, direction: vec3<f32>, roughness: f32, texel: vec2<f32>, max_mip: f32) -> vec3<f32> {
    let mip = clamp(cube_uv_roughness_to_mip(roughness), -2.0, max_mip);
    let mip_fraction = fract(mip);
    let mip_int = floor(mip);
    var color = cube_uv_bilinear(map, map_sampler, direction, mip_int, texel, max_mip);
    if (mip_fraction != 0.0) {
        color = mix(color, cube_uv_bilinear(map, map_sampler, direction, mip_int + 1.0, texel, max_mip), mip_fraction);
    }
    return color;
}
"#;

/// Prefiltering passes of an environment map, after three.js r186 `PMREMGenerator`: the
/// vertex stage places one level's six faces (positions are clip coordinates), the
/// fragment stages either read the equirectangular source or convolve a level with GGX.
pub const PMREM_SHADER: &str = r#"
struct Settings {
    // roughness of the convolution, source level (three.js mipInt), 1/width, 1/height
    params: vec4<f32>,
    // x: three.js CUBEUV_MAX_MIP
    extra: vec4<f32>,
};

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) direction: vec3<f32>,
};

@vertex
fn vertex(@location(0) position: vec3<f32>, @location(1) direction: vec3<f32>) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(position.xy, 0.0, 1.0);
    output.direction = direction;
    return output;
}

@fragment
fn equirect(input: VertexOutput) -> @location(0) vec4<f32> {
    let d = normalize(input.direction);
    let uv = vec2<f32>(atan2(d.z, d.x) * (1.0 / 6.283185307179586) + 0.5, asin(clamp(d.y, -1.0, 1.0)) * (1.0 / 3.141592653589793) + 0.5);
    return vec4<f32>(textureSampleLevel(source, source_sampler, uv, 0.0).rgb, 1.0);
}

fn radical_inverse(input: u32) -> f32 {
    var bits = (input << 16u) | (input >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

// GGX visible-normal sampling with the view along +Z (Heitz 2018), as three.js does.
fn sample_ggx(xi: vec2<f32>, roughness: f32) -> vec3<f32> {
    let alpha = roughness * roughness;
    let v = vec3<f32>(0.0, 0.0, 1.0);
    let t1_axis = vec3<f32>(1.0, 0.0, 0.0);
    let t2_axis = cross(v, t1_axis);
    let r = sqrt(xi.x);
    let phi = 2.0 * 3.14159265359 * xi.y;
    let t1 = r * cos(phi);
    var t2 = r * sin(phi);
    let s = 0.5 * (v.z + 1.0);
    t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;
    let nh = t1_axis * t1 + t2_axis * t2 + v * sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2));
    return normalize(vec3<f32>(alpha * nh.x, alpha * nh.y, max(0.0, nh.z)));
}

@fragment
fn ggx(input: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(input.direction);
    let roughness = settings.params.x;
    let mip = settings.params.y;
    let texel = settings.params.zw;
    let max_mip = settings.extra.x;
    if (roughness < 0.001) {
        return vec4<f32>(cube_uv_bilinear(source, source_sampler, n, mip, texel, max_mip), 1.0);
    }
    let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(n.z) < 0.999);
    let tangent = normalize(cross(up, n));
    let bitangent = cross(n, tangent);
    var color = vec3<f32>(0.0);
    var weight = 0.0;
    for (var i = 0u; i < 256u; i++) {
        let xi = vec2<f32>(f32(i) / 256.0, radical_inverse(i));
        let h_tangent = sample_ggx(xi, roughness);
        let h = normalize(tangent * h_tangent.x + bitangent * h_tangent.y + n * h_tangent.z);
        let l = normalize(h * (dot(n, h) * 2.0) - n);
        let n_l = max(dot(n, l), 0.0);
        if (n_l > 0.0) {
            color += cube_uv_bilinear(source, source_sampler, l, mip, texel, max_mip) * n_l;
            weight += n_l;
        }
    }
    if (weight > 0.0) {
        color /= weight;
    }
    return vec4<f32>(color, 1.0);
}
"#;

/// The mesh shader with the functions it shares with the prefiltering passes.
pub fn shader_source() -> String {
    format!("{CUBE_UV}{SHADER}")
}

/// The prefiltering passes' shader with its shared functions.
pub fn pmrem_shader_source() -> String {
    format!("{CUBE_UV}{PMREM_SHADER}")
}

/// Index in [`Frame::frame_uniforms`] of the tone mapping, as a three.js constant.
pub const TONE_MAPPING_INDEX: usize = 35;
/// Index in [`Frame::frame_uniforms`] of the tone mapping exposure.
pub const TONE_MAPPING_EXPOSURE_INDEX: usize = 39;

/// The output pass used when tone mapping is on. As in three.js r186, the scene is drawn
/// in linear colour into a half-float target, and this pass tone-maps every pixel,
/// background included, onto the sRGB canvas. Blending therefore happens before tone
/// mapping, and `Material.toneMapped` has no effect on screen output.
pub const OUTPUT_SHADER: &str = r#"
// x the tone mapping (three.js constant), y the exposure
@group(0) @binding(0) var<uniform> settings: vec4<f32>;
@group(0) @binding(1) var source: texture_2d<f32>;

struct Output { @builtin(position) position: vec4<f32> };

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Output {
    var output: Output;
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    output.position = vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
    return output;
}

fn agx_contrast(x: vec3<f32>) -> vec3<f32> {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// Tone mapping as three.js r186 applies it to output written to the canvas.
fn tone_mapped(input: vec3<f32>) -> vec3<f32> {
    let kind = u32(settings.x + 0.5);
    if (kind == 0u) {
        return input;
    }
    var color = input * settings.y;
    if (kind == 1u) {
        return saturate(color);
    }
    if (kind == 2u) {
        return saturate(color / (color + 1.0));
    }
    if (kind == 3u) {
        color = max(color - 0.004, vec3<f32>(0.0));
        return pow(color * (6.2 * color + 0.5) / (color * (6.2 * color + 1.7) + 0.06), vec3<f32>(2.2));
    }
    if (kind == 4u) {
        let aces_in = mat3x3<f32>(vec3<f32>(0.59719, 0.07600, 0.02840), vec3<f32>(0.35458, 0.90834, 0.13383), vec3<f32>(0.04823, 0.01566, 0.83777));
        let aces_out = mat3x3<f32>(vec3<f32>(1.60475, -0.10208, -0.00327), vec3<f32>(-0.53108, 1.10813, -0.07276), vec3<f32>(-0.07367, -0.00605, 1.07602));
        color = aces_in * (color / 0.6);
        color = (color * (color + 0.0245786) - 0.000090537) / (color * (0.983729 * color + 0.4329510) + 0.238081);
        return saturate(aces_out * color);
    }
    if (kind == 6u) {
        let to_rec2020 = mat3x3<f32>(vec3<f32>(0.6274, 0.0691, 0.0164), vec3<f32>(0.3293, 0.9195, 0.0880), vec3<f32>(0.0433, 0.0113, 0.8956));
        let to_srgb = mat3x3<f32>(vec3<f32>(1.6605, -0.1246, -0.0182), vec3<f32>(-0.5876, 1.1329, -0.1006), vec3<f32>(-0.0728, -0.0083, 1.1187));
        let inset = mat3x3<f32>(vec3<f32>(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3<f32>(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3<f32>(0.0482516061458583, 0.101439036467562, 0.811302368396859));
        let outset = mat3x3<f32>(vec3<f32>(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3<f32>(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3<f32>(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
        let min_ev = -12.47393;
        let max_ev = 4.026069;
        color = inset * (to_rec2020 * color);
        color = (log2(max(color, vec3<f32>(1e-10))) - min_ev) / (max_ev - min_ev);
        color = agx_contrast(saturate(color));
        color = pow(max(vec3<f32>(0.0), outset * color), vec3<f32>(2.2));
        return saturate(to_srgb * color);
    }
    if (kind == 7u) {
        let start = 0.8 - 0.04;
        let desaturation = 0.15;
        let x = min(color.r, min(color.g, color.b));
        let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
        color -= offset;
        let peak = max(color.r, max(color.g, color.b));
        if (peak < start) {
            return color;
        }
        let d = 1.0 - start;
        let new_peak = 1.0 - d * d / (peak + d - start);
        color *= new_peak / peak;
        let g = 1.0 - 1.0 / (desaturation * (peak - new_peak) + 1.0);
        return mix(color, vec3<f32>(new_peak), g);
    }
    return input;
}

@fragment
fn fragment(input: Output) -> @location(0) vec4<f32> {
    let color = textureLoad(source, vec2<i32>(input.position.xy), 0);
    return vec4<f32>(tone_mapped(color.rgb), 1.0);
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

    for Entry { draw, matrix_world, material, vertex_colors, receive_shadow, sprite, .. } in entries {
        let start = frame.object_uniforms.len();
        frame.object_uniforms.extend(matrix_world.elements);

        let mut normal_matrix = Matrix3::default();
        normal_matrix.get_normal_matrix(&matrix_world);
        push_matrix3(&mut frame.object_uniforms, &normal_matrix);

        push_color(&mut frame.object_uniforms, &material.color, 1.0, material.opacity);
        let flags = u8::from(vertex_colors) | u8::from(material.transparent) << 1 | u8::from(receive_shadow) << 2 | u8::from(sprite.is_some()) << 3;
        frame.object_uniforms.extend([material.roughness, material.metalness, f32::from(material.shading as u8), f32::from(flags)]);
        push_matrix3(&mut frame.object_uniforms, &material.map_transform);
        let [center_x, center_y] = sprite.unwrap_or([0.5, 0.5]);
        frame.object_uniforms.extend([material.rotation, center_x, center_y, f32::from(u8::from(material.size_attenuation))]);
        let lit_by_environment = material.uses_environment && material.shading == wamr_core::Shading::Standard;
        frame.object_uniforms.extend([material.env_map_intensity, f32::from(u8::from(lit_by_environment)), 0.0, 0.0]);
        frame.object_uniforms.resize(start + OBJECT_UNIFORM_FLOATS, 0.0);
        frame.draws.push(draw);
    }

    Some(frame)
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
            map: 0,
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
        lighting.lights.extend([Light::default(); MAX_LIGHTS + 2]);

        let f = prepare_frame(&mut world, root, camera, &lighting).unwrap().frame_uniforms;
        assert_eq!(f.len(), FRAME_UNIFORM_FLOATS);
        assert_eq!(f[19], MAX_LIGHTS as f32);
        assert_eq!(f[LIGHTS_OFFSET + 3], 0.0);
        assert_eq!(f[36..40], [0.0, 0.0, -1.0, 1.0]);
        assert_eq!(f[LIGHTS_OFFSET + 16..LIGHTS_OFFSET + 30], [1.0, 2.0, 3.0, 2.0, 0.0, 1.0, 0.0, 9.0, 3.0, 3.0, 3.0, 1.5, 0.8, 0.9]);
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
    fn shadow_casters_are_collected_per_light_and_receivers_flagged() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -8.0], [400.0, 0.0, -5.0]]);
        for &e in &boxes {
            world.visibility_mut(e).unwrap().cast_shadow = true;
        }
        world.visibility_mut(boxes[1]).unwrap().cast_shadow = false;
        world.visibility_mut(boxes[0]).unwrap().receive_shadow = true;

        let shadow = LightShadow {
            projection: ShadowProjection::Orthographic { left: -5.0, right: 5.0, top: 5.0, bottom: -5.0, near: 0.5, far: 500.0 },
            target: Vector3::new(0.0, 0.0, -5.0),
            bias: -0.001,
            normal_bias: 0.0,
            intensity: 1.0,
            radius: 1.0,
            map_width: 1024,
            map_height: 512,
        };
        let sun = Light { direction: Vector3::new(0.0, 10.0, 0.0), shadow: Some(shadow), ..Light::default() };
        let point = Light { kind: LightKind::Point, shadow: Some(shadow), ..Light::default() };
        let mut lighting = Lighting { lights: vec![point, sun], shadows: true, ..Lighting::default() };

        let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
        assert_eq!(frame.shadows.len(), 1, "point lights cast no shadows yet");
        let pass = &frame.shadows[0];
        assert_eq!(pass.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]], "not casting, or outside the shadow frustum");
        assert_eq!(pass.draws[0].pipeline & 3, Side::Back as u32);
        assert_eq!((frame.shadow_map_width, frame.shadow_map_height), (1024, 512));
        // light 0 (point) has no shadow; light 1 uses layer 0
        assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + 14], 0.0);
        assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + LIGHT_FLOATS + 14], 1.0);
        assert_eq!(frame.frame_uniforms[SHADOWS_OFFSET + 16..SHADOWS_OFFSET + 23], [-0.001, 0.0, 1.0, 1.0 / 1024.0, 1.0, 1.0, 0.0]);
        // the box at the target projects to the middle of the map
        let m = Matrix4 { elements: frame.frame_uniforms[SHADOWS_OFFSET..SHADOWS_OFFSET + 16].try_into().unwrap() };
        let mut p = Vector3::new(0.0, 0.0, -5.0);
        p.apply_matrix4(&m);
        // (y is nudged slightly: the light looks straight down, parallel to "up", as in three.js)
        assert!((p.x - 0.5).abs() < 1e-5 && (p.y - 0.5).abs() < 1e-3 && p.z > 0.0 && p.z < 1.0, "{p:?}");
        // receivers are flagged; others not
        let receiver = frame.draws.iter().position(|d| d.object == boxes[0]).unwrap();
        assert_eq!(frame.object_uniforms[receiver * OBJECT_UNIFORM_FLOATS + 35], 4.0);

        lighting.shadows = false;
        assert!(prepare_frame(&mut world, root, camera, &lighting).unwrap().shadows.is_empty());
    }

    #[test]
    fn points_use_the_point_list_and_sprites_carry_their_settings() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [1.0, 0.0, -6.0]]);
        let geometry = world.renderable(boxes[0]).unwrap().geometry;
        let material = world.create_material(Material { shading: Shading::Unlit, rotation: 0.5, size_attenuation: false, ..Material::default() });
        world.set_renderable(boxes[0], Some(Renderable { primitive: Primitive::Points, ..Renderable::mesh(geometry, material) }));
        world.set_renderable(boxes[1], Some(Renderable { sprite: Some([0.25, 1.0]), ..Renderable::mesh(geometry, material) }));

        let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
        let points = frame.draws.iter().position(|d| d.object == boxes[0]).unwrap();
        let sprite = frame.draws.iter().position(|d| d.object == boxes[1]).unwrap();
        assert_eq!(frame.draws[points].pipeline >> 5 & 3, 3);
        assert_eq!(frame.draws[points].pipeline & 3, 2, "points ignore the side");
        let o = &frame.object_uniforms[sprite * OBJECT_UNIFORM_FLOATS..];
        assert_eq!(o[35], 8.0);
        assert_eq!(o[48..52], [0.5, 0.25, 1.0, 0.0]);
        // camera right and up, perspective
        assert_eq!(frame.frame_uniforms[40..48], [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0]);
    }

    #[test]
    fn the_environment_is_packed_with_three_js_layout_sizes() {
        let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
        let handle = world.renderable(boxes[0]).unwrap().material;
        world.material_mut(handle).unwrap().uses_environment = true;
        world.material_mut(handle).unwrap().env_map_intensity = 0.7;
        // a 1024-wide equirectangular map: cube faces of 256, lodMax 8
        let environment = Environment { texture: 3, source_width: 1024, rotation: Matrix3::default() };
        assert_eq!((environment.lod_max(), environment.layout_size()), (8, (768, 1024)));
        assert_eq!(Environment { source_width: 256, ..environment }.layout_size(), (336, 256));

        let lighting = Lighting { environment: Some(environment), ..Lighting::default() };
        let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
        assert_eq!(frame.frame_uniforms[ENVIRONMENT_OFFSET..ENVIRONMENT_OFFSET + 3], [1.0 / 768.0, 1.0 / 1024.0, 8.0]);
        assert_eq!(frame.object_uniforms[52..54], [0.7, 1.0]);
        assert_eq!(frame.environment.map(|e| e.texture), Some(3));
        assert!(shader_source().contains("fn cube_uv_sample(") && pmrem_shader_source().contains("fn ggx("));
    }

    #[test]
    fn shader_declares_both_entry_points() {
        assert!(SHADER.contains("fn vertex(") && SHADER.contains("fn fragment("));
        assert!(SHADER.contains(&format!("array<Light, {MAX_LIGHTS}>")) && SHADER.contains(&format!("{MAX_LIGHTS}u)")));
        assert!(SHADER.contains(&format!("array<Shadow, {MAX_SHADOWS}>")) && SHADOW_SHADER.contains("fn vertex("));
        assert_eq!(FRAME_UNIFORM_FLOATS * 4 % 16, 0);
    }

    #[test]
    fn tone_mapping_and_exposure_are_packed_for_the_output_pass() {
        let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
        let lighting = Lighting { tone_mapping: ToneMapping::AcesFilmic, exposure: 1.5, ..Lighting::default() };
        let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
        assert_eq!((frame.frame_uniforms[TONE_MAPPING_INDEX], frame.frame_uniforms[TONE_MAPPING_EXPOSURE_INDEX]), (4.0, 1.5));
        assert!(OUTPUT_SHADER.contains("fn tone_mapped(") && !SHADER.contains("fn tone_mapped("));
        assert_eq!(ToneMapping::from_u8(5), ToneMapping::None);
    }
}
