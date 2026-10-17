//! Full-screen effects for post-processing, drawn as materials of a quad: a material
//! with `custom` 1 to 6 is drawn with the effect's shader instead of the mesh shader. The
//! quad's positions are clip coordinates (a 2 x 2 plane); the effect reads its inputs from
//! the draw's texture slots in map order and its settings from `params`, the 16 floats the
//! material block keeps for custom materials (see `pack_material`).

/// Effect ids, the `custom` of a material.
pub const EFFECT_COPY: u32 = 1;
pub const EFFECT_HIGH_PASS: u32 = 2;
pub const EFFECT_BLUR: u32 = 3;
pub const EFFECT_BLOOM: u32 = 4;
pub const EFFECT_FXAA: u32 = 5;
pub const EFFECT_OUTPUT: u32 = 6;

/// Ids from this one on are a host's own shader materials (three.js `ShaderMaterial`).
pub const FIRST_SHADER_MATERIAL: u32 = 16;

/// Entry points of the effects, by id: the WGSL `fragment` functions and GLSL names.
pub const EFFECT_ENTRY_POINTS: [&str; 6] = ["copy", "high_pass", "blur", "bloom", "fxaa", "output"];

const WGSL: &str = r#"
// the 16 floats of a custom material
fn params(i: u32) -> vec4<f32> {
    switch i {
        case 0u: { return material.sprite; }
        case 1u: { return material.environment_rotation_0; }
        case 2u: { return material.environment_rotation_1; }
        default: { return material.environment_rotation_2; }
    }
}

struct EffectOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vertex_effect(@location(0) position: vec3<f32>, @location(2) uv: vec2<f32>) -> EffectOutput {
    var output: EffectOutput;
    output.position = vec4<f32>(position.xy, 0.0, 1.0);
    // render-target rows are stored top first
    output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return output;
}

fn effect_sample(slot: u32, uv: vec2<f32>) -> vec4<f32> {
    return slot_sample(slot, uv, vec2<f32>(0.0), vec2<f32>(0.0));
}

// the input times params[0].x (three.js CopyShader's opacity)
@fragment
fn copy(input: EffectOutput) -> @location(0) vec4<f32> {
    return effect_sample(0u, input.uv) * params(0u).x;
}

// three.js LuminosityHighPassShader: threshold, smooth width; params[1] the default
// colour and opacity
@fragment
fn high_pass(input: EffectOutput) -> @location(0) vec4<f32> {
    let texel = effect_sample(0u, input.uv);
    let luminance = dot(texel.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let p = params(0u);
    let alpha = smoothstep(p.x, p.x + p.y, luminance);
    return mix(params(1u), texel, alpha);
}

// A separable Gaussian blur: direction (x, y), kernel radius, sigma.
@fragment
fn blur(input: EffectOutput) -> @location(0) vec4<f32> {
    let p = params(0u);
    let texel = 1.0 / vec2<f32>(textureDimensions(slot_0));
    let sigma = max(p.w, 0.0001);
    let pdf = 0.39894 / sigma;
    var weight_sum = pdf;
    var sum = effect_sample(0u, input.uv).rgb * weight_sum;
    for (var i = 1; i < i32(p.z); i++) {
        let x = f32(i);
        let w = pdf * exp(-0.5 * x * x / (sigma * sigma));
        let offset = p.xy * texel * x;
        sum += (effect_sample(0u, input.uv + offset).rgb + effect_sample(0u, input.uv - offset).rgb) * w;
        weight_sum += 2.0 * w;
    }
    return vec4<f32>(sum / weight_sum, 1.0);
}

// three.js UnrealBloomPass's composite of five blurred levels: strength, radius.
@fragment
fn bloom(input: EffectOutput) -> @location(0) vec4<f32> {
    let p = params(0u);
    let factors = array<f32, 5>(1.0, 0.8, 0.6, 0.4, 0.2);
    var sum = vec4<f32>(0.0);
    for (var i = 0u; i < 5u; i++) {
        let factor = mix(factors[i], 1.2 - factors[i], p.y);
        sum += factor * effect_sample(i, input.uv);
    }
    return p.x * sum;
}

// FXAA after Timothy Lottes: edges found from luma, blurred along their direction.
@fragment
fn fxaa(input: EffectOutput) -> @location(0) vec4<f32> {
    let texel = 1.0 / vec2<f32>(textureDimensions(slot_0));
    let luma = vec3<f32>(0.299, 0.587, 0.114);
    let nw = dot(effect_sample(0u, input.uv + vec2<f32>(-1.0, -1.0) * texel).rgb, luma);
    let ne = dot(effect_sample(0u, input.uv + vec2<f32>(1.0, -1.0) * texel).rgb, luma);
    let sw = dot(effect_sample(0u, input.uv + vec2<f32>(-1.0, 1.0) * texel).rgb, luma);
    let se = dot(effect_sample(0u, input.uv + vec2<f32>(1.0, 1.0) * texel).rgb, luma);
    let center = effect_sample(0u, input.uv);
    let m = dot(center.rgb, luma);
    let low = min(m, min(min(nw, ne), min(sw, se)));
    let high = max(m, max(max(nw, ne), max(sw, se)));
    var direction = vec2<f32>(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    let reduce = max((nw + ne + sw + se) * (0.25 * 0.125), 1.0 / 128.0);
    let scale = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduce);
    direction = clamp(direction * scale, vec2<f32>(-8.0), vec2<f32>(8.0)) * texel;
    let a = 0.5 * (effect_sample(0u, input.uv + direction * (1.0 / 3.0 - 0.5)).rgb + effect_sample(0u, input.uv + direction * (2.0 / 3.0 - 0.5)).rgb);
    let b = a * 0.5 + 0.25 * (effect_sample(0u, input.uv - direction * 0.5).rgb + effect_sample(0u, input.uv + direction * 0.5).rgb);
    let lb = dot(b, luma);
    return vec4<f32>(select(b, a, lb < low || lb > high), center.a);
}

// three.js OutputPass: tone mapping (params[0].x, a three.js constant) and exposure (y);
// the target encodes to sRGB.
@fragment
fn output(input: EffectOutput) -> @location(0) vec4<f32> {
    let color = effect_sample(0u, input.uv);
    return vec4<f32>(tone_mapped(color.rgb, params(0u).x, params(0u).y), color.a);
}
"#;

const GLSL_VERTEX: &str = r#"
layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
uniform float flip_y;
out vec2 v_uv;

void main() {
    gl_Position = vec4(a_position.x, a_position.y * flip_y, 0.0, 1.0);
    // render-target rows are stored top first (see `flip_y`)
    v_uv = vec2(a_uv.x, 1.0 - a_uv.y);
}
"#;

const GLSL_COMMON: &str = r#"
in vec2 v_uv;
layout(location = 0) out vec4 out_color;

vec4 params(int i) {
    return i == 0 ? material.sprite : i == 1 ? material.environment_rotation_0 : i == 2 ? material.environment_rotation_1 : material.environment_rotation_2;
}

vec4 sample_slot(int slot, vec2 uv) {
    return slot_sample(slot, uv, vec2(0.0), vec2(0.0));
}
"#;

const GLSL_COPY: &str = r#"
void main() {
    out_color = sample_slot(0, v_uv) * params(0).x;
}
"#;

const GLSL_HIGH_PASS: &str = r#"
void main() {
    vec4 texel = sample_slot(0, v_uv);
    float luminance = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec4 p = params(0);
    out_color = mix(params(1), texel, smoothstep(p.x, p.x + p.y, luminance));
}
"#;

const GLSL_BLUR: &str = r#"
void main() {
    vec4 p = params(0);
    vec2 texel = 1.0 / vec2(textureSize(slot_0, 0));
    float sigma = max(p.w, 0.0001);
    float pdf = 0.39894 / sigma;
    float weight_sum = pdf;
    vec3 sum = sample_slot(0, v_uv).rgb * weight_sum;
    for (int i = 1; i < 64; i++) {
        if (i >= int(p.z)) {
            break;
        }
        float x = float(i);
        float w = pdf * exp(-0.5 * x * x / (sigma * sigma));
        vec2 offset = p.xy * texel * x;
        sum += (sample_slot(0, v_uv + offset).rgb + sample_slot(0, v_uv - offset).rgb) * w;
        weight_sum += 2.0 * w;
    }
    out_color = vec4(sum / weight_sum, 1.0);
}
"#;

const GLSL_BLOOM: &str = r#"
void main() {
    vec4 p = params(0);
    float factors[5] = float[5](1.0, 0.8, 0.6, 0.4, 0.2);
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 5; i++) {
        sum += mix(factors[i], 1.2 - factors[i], p.y) * sample_slot(i, v_uv);
    }
    out_color = p.x * sum;
}
"#;

const GLSL_FXAA: &str = r#"
void main() {
    vec2 texel = 1.0 / vec2(textureSize(slot_0, 0));
    vec3 luma = vec3(0.299, 0.587, 0.114);
    float nw = dot(sample_slot(0, v_uv + vec2(-1.0, -1.0) * texel).rgb, luma);
    float ne = dot(sample_slot(0, v_uv + vec2(1.0, -1.0) * texel).rgb, luma);
    float sw = dot(sample_slot(0, v_uv + vec2(-1.0, 1.0) * texel).rgb, luma);
    float se = dot(sample_slot(0, v_uv + vec2(1.0, 1.0) * texel).rgb, luma);
    vec4 center = sample_slot(0, v_uv);
    float m = dot(center.rgb, luma);
    float low = min(m, min(min(nw, ne), min(sw, se)));
    float high = max(m, max(max(nw, ne), max(sw, se)));
    vec2 direction = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
    float reduce = max((nw + ne + sw + se) * (0.25 * 0.125), 1.0 / 128.0);
    float scale = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduce);
    direction = clamp(direction * scale, vec2(-8.0), vec2(8.0)) * texel;
    vec3 a = 0.5 * (sample_slot(0, v_uv + direction * (1.0 / 3.0 - 0.5)).rgb + sample_slot(0, v_uv + direction * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (sample_slot(0, v_uv - direction * 0.5).rgb + sample_slot(0, v_uv + direction * 0.5).rgb);
    float lb = dot(b, luma);
    out_color = vec4(lb < low || lb > high ? a : b, center.a);
}
"#;

const GLSL_OUTPUT: &str = r#"
void main() {
    vec4 color = sample_slot(0, v_uv);
    out_color = vec4(tone_mapped(color.rgb, params(0).x, params(0).y), color.a);
#ifdef OUTPUT_SRGB
    out_color.rgb = linear_to_srgb(out_color.rgb);
#endif
}
"#;

/// The effects' WGSL: entry points `vertex_effect` and those of [`EFFECT_ENTRY_POINTS`],
/// with the mesh shader's bind group layout.
pub fn effect_shader_source() -> String {
    format!("{}{}{WGSL}{}", crate::mesh_wgsl::COMMON, EFFECT_GLOBALS, crate::shaders::TONE_MAPPING_WGSL)
}

// The frame-wide bindings the shared declarations refer to.
const EFFECT_GLOBALS: &str = r#"
@group(3) @binding(4) var bone_map: texture_2d<f32>;
"#;

/// GLSL of an effect: `effect.vert`, or `effect.<name>` for a name of
/// [`EFFECT_ENTRY_POINTS`].
pub fn effect_glsl(name: &str, header: &str, encode: &str) -> Option<String> {
    let body = match name {
        "effect.vert" => return Some(format!("{header}{GLSL_VERTEX}")),
        "effect.copy" => GLSL_COPY,
        "effect.high_pass" => GLSL_HIGH_PASS,
        "effect.blur" => GLSL_BLUR,
        "effect.bloom" => GLSL_BLOOM,
        "effect.fxaa" => GLSL_FXAA,
        "effect.output" => GLSL_OUTPUT,
        _ => return None,
    };
    Some(format!("{header}{}{encode}{}{}{GLSL_COMMON}{body}", crate::glsl_mesh::BLOCKS, crate::glsl::TONE_MAPPING_GLSL, crate::glsl_mesh::MAPS))
}
