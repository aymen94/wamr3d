//! The shadow passes and the VSM blur.

/// Depth-only shader of the shadow passes. Group 0 holds the shadow camera's
/// view-projection, groups 1 and 2 the object, material and textures as in the main pass
/// (for skinning, displacement and alpha tests), group 3 the bones.
pub const SHADOW_SHADER: &str = r#"
@group(3) @binding(0) var bone_map: texture_2d<f32>;
@group(0) @binding(1) var<uniform> shadow_camera: mat4x4<f32>;

struct ShadowOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) uv1: vec2<f32>,
    @location(2) world_position: vec3<f32>,
};

@vertex
fn vertex(input: VertexInput) -> ShadowOutput {
    var position = input.position;
    var normal = input.normal;
    if (object.params.y > 0.5) {
        let skin = skin_matrix(input.skin_index, input.skin_weight);
        position = (skin * vec4<f32>(position, 1.0)).xyz;
        normal = (skin * vec4<f32>(normal, 0.0)).xyz;
    }
    position = displaced(position, normal, input.uv, input.uv1);
    let instance = mat4x4<f32>(input.instance_0, input.instance_1, input.instance_2, input.instance_3);
    var output: ShadowOutput;
    let world = object.model * (instance * vec4<f32>(position, 1.0));
    output.position = shadow_camera * world;
    output.uv = input.uv;
    output.uv1 = input.uv1;
    output.world_position = world.xyz;
    return output;
}

// Only for casters with an alpha test or clipped shadows: the colour map's and alpha
// map's alpha, and the material's clipping planes.
@fragment
fn fragment(input: ShadowOutput) {
    var c: Coords;
    c.uv0 = input.uv;
    c.uv1 = input.uv1;
    c.d0x = dpdx(input.uv);
    c.d0y = dpdy(input.uv);
    c.d1x = dpdx(input.uv1);
    c.d1y = dpdy(input.uv1);
    var coverage = material.color.a;
    if (map_present(MAP_COLOR)) {
        coverage *= map_sample(MAP_COLOR, c).a;
    }
    if (map_present(MAP_ALPHA)) {
        coverage *= map_sample(MAP_ALPHA, c).r;
    }
    if (coverage <= material.surface.w) {
        discard;
    }
    if ((u32(material.extra.x) & 256u) != 0u && clipped_by_material(input.world_position)) {
        discard;
    }
}
"#;

/// The blur of variance shadow maps (three.js `VSMShadowMap`): a vertical pass from a
/// layer of the depth array into a moments texture (mean and deviation of the depth), then
/// a horizontal pass from it into the layer of the VSM array.
pub const VSM_SHADER: &str = r#"
// radius in texels, taps, layer, 0
@group(0) @binding(0) var<uniform> settings: vec4<f32>;
@group(0) @binding(1) var depth: texture_depth_2d_array;
@group(0) @binding(2) var moments: texture_2d<f32>;

struct Output { @builtin(position) position: vec4<f32> };

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Output {
    var output: Output;
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    output.position = vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
    return output;
}

fn tap(i: f32, samples: f32) -> f32 {
    return select(-1.0 + i * 2.0 / (samples - 1.0), 0.0, samples <= 1.0);
}

@fragment
fn vertical(input: Output) -> @location(0) vec4<f32> {
    let samples = max(settings.y, 1.0);
    let size = vec2<i32>(textureDimensions(depth));
    var mean = 0.0;
    var squared = 0.0;
    for (var i = 0.0; i < samples; i += 1.0) {
        let at = vec2<i32>(input.position.xy + vec2<f32>(0.0, tap(i, samples) * settings.x));
        let d = textureLoad(depth, clamp(at, vec2<i32>(0), size - 1), i32(settings.z + 0.5), 0);
        mean += d;
        squared += d * d;
    }
    mean /= samples;
    squared /= samples;
    return vec4<f32>(mean, sqrt(max(0.0, squared - mean * mean)), 0.0, 1.0);
}

@fragment
fn horizontal(input: Output) -> @location(0) vec4<f32> {
    let samples = max(settings.y, 1.0);
    let size = vec2<i32>(textureDimensions(moments));
    var mean = 0.0;
    var squared = 0.0;
    for (var i = 0.0; i < samples; i += 1.0) {
        let at = vec2<i32>(input.position.xy + vec2<f32>(tap(i, samples) * settings.x, 0.0));
        let m = textureLoad(moments, clamp(at, vec2<i32>(0), size - 1), 0).xy;
        mean += m.x;
        squared += m.y * m.y + m.x * m.x;
    }
    mean /= samples;
    squared /= samples;
    return vec4<f32>(mean, sqrt(max(0.0, squared - mean * mean)), 0.0, 1.0);
}
"#;
