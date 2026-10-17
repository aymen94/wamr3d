//! WGSL of the passes besides the mesh and shadow pipelines (`mesh_wgsl.rs`):
//! prefiltering, background, output and the cube-to-panorama conversion.

pub use crate::mesh_wgsl::{COMMON, SHADER, SHADOW_SHADER, VSM_SHADER};

/// The background pass: one triangle covering the frame, drawn first without depth.
/// Directions are those of a sphere around the camera, as three.js draws backgrounds.
pub const BACKGROUND_SHADER: &str = r#"
struct BackgroundUniforms {
    clip_to_view: mat4x4<f32>,
    view_to_world: mat3x3<f32>,
    rotation: mat3x3<f32>,
    // kind (0 equirectangular, 1 prefiltered, 2 screen), intensity, blurriness,
    // orthographic sphere radius (0 for a perspective camera)
    params: vec4<f32>,
    // prefiltered map: 1/width, 1/height, max mip
    environment: vec4<f32>,
};

@group(0) @binding(0) var<uniform> background: BackgroundUniforms;
@group(0) @binding(1) var background_map: texture_2d<f32>;
@group(0) @binding(2) var background_sampler: sampler;

struct Output {
    @builtin(position) position: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Output {
    var output: Output;
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    output.ndc = corner * 2.0 - 1.0;
    output.position = vec4<f32>(output.ndc, 1.0, 1.0);
    return output;
}

@fragment
fn fragment(input: Output) -> @location(0) vec4<f32> {
    let kind = u32(background.params.x + 0.5);
    var color: vec3<f32>;
    if (kind == 2u) {
        // y up, matching textures uploaded bottom row first
        color = textureSampleLevel(background_map, background_sampler, input.ndc * 0.5 + 0.5, 0.0).rgb;
    } else {
        let p = background.clip_to_view * vec4<f32>(input.ndc, 1.0, 1.0);
        var view = p.xyz / p.w;
        let radius = background.params.w;
        if (radius > 0.0) {
            view = vec3<f32>(view.xy, -sqrt(max(radius * radius - dot(view.xy, view.xy), 0.0)));
        }
        let direction = background.rotation * (background.view_to_world * normalize(view));
        if (kind == 1u) {
            // the prefiltered map is stored with y inverted (three.js PMREMNode)
            let flipped = vec3<f32>(direction.x, -direction.y, direction.z);
            color = cube_uv_sample(background_map, background_sampler, flipped, background.params.z, background.environment.xy, background.environment.z, 0.0);
        } else {
            let uv = vec2<f32>(atan2(direction.z, direction.x) * (1.0 / 6.283185307179586) + 0.5, asin(clamp(direction.y, -1.0, 1.0)) * (1.0 / 3.141592653589793) + 0.5);
            color = textureSampleLevel(background_map, background_sampler, uv, 0.0).rgb;
        }
    }
    return vec4<f32>(color * background.params.y, 1.0);
}
"#;

/// Cube-UV sampling of a prefiltered environment (three.js `textureCubeUV`), shared by
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
// offset_y: pixel row where the map starts, for maps stacked in one texture.
fn cube_uv_bilinear(map: texture_2d<f32>, map_sampler: sampler, direction: vec3<f32>, mip: f32, texel: vec2<f32>, max_mip: f32, offset_y: f32) -> vec3<f32> {
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
    uv.y += 4.0 * (exp2(max_mip) - face_size) + offset_y;
    return textureSampleLevel(map, map_sampler, uv * texel, 0.0).rgb;
}

fn cube_uv_sample(map: texture_2d<f32>, map_sampler: sampler, direction: vec3<f32>, roughness: f32, texel: vec2<f32>, max_mip: f32, offset_y: f32) -> vec3<f32> {
    let mip = clamp(cube_uv_roughness_to_mip(roughness), -2.0, max_mip);
    let mip_fraction = fract(mip);
    let mip_int = floor(mip);
    var color = cube_uv_bilinear(map, map_sampler, direction, mip_int, texel, max_mip, offset_y);
    if (mip_fraction != 0.0) {
        color = mix(color, cube_uv_bilinear(map, map_sampler, direction, mip_int + 1.0, texel, max_mip, offset_y), mip_fraction);
    }
    return color;
}
"#;

/// Prefiltering passes of an environment map, after three.js `PMREMGenerator`: the
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
        return vec4<f32>(cube_uv_bilinear(source, source_sampler, n, mip, texel, max_mip, 0.0), 1.0);
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
            color += cube_uv_bilinear(source, source_sampler, l, mip, texel, max_mip, 0.0) * n_l;
            weight += n_l;
        }
    }
    if (weight > 0.0) {
        color /= weight;
    }
    return vec4<f32>(color, 1.0);
}
"#;

/// Turns a cube texture into an equirectangular image, drawn once per upload by the host
/// so that cube maps go through the equirectangular environment and background passes.
/// Rows run as in an uploaded image (the first row is the bottom, v = 0), and the cube is
/// read along (-x, y, z), as three.js reads cube textures.
pub const CUBE_TO_EQUIRECT_SHADER: &str = r#"
@group(0) @binding(0) var faces: texture_cube<f32>;
@group(0) @binding(1) var faces_sampler: sampler;

struct Output {
    @builtin(position) position: vec4<f32>,
    @location(0) ndc: vec2<f32>,
};

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Output {
    var output: Output;
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    output.ndc = corner * 2.0 - 1.0;
    output.position = vec4<f32>(output.ndc, 0.0, 1.0);
    return output;
}

@fragment
fn fragment(input: Output) -> @location(0) vec4<f32> {
    // the target's first row (the top of the render target) is v = 0
    let uv = vec2<f32>(input.ndc.x * 0.5 + 0.5, 0.5 - input.ndc.y * 0.5);
    let phi = (uv.x - 0.5) * 6.283185307179586;
    let latitude = (uv.y - 0.5) * 3.141592653589793;
    let d = vec3<f32>(cos(phi) * cos(latitude), sin(latitude), sin(phi) * cos(latitude));
    return vec4<f32>(textureSampleLevel(faces, faces_sampler, vec3<f32>(-d.x, d.y, d.z), 0.0).rgb, 1.0);
}
"#;

/// The mesh shader with the functions it shares with the prefiltering passes, and the
/// split-sum table. Entry points `vertex`, `vertex_quad` and `fragment`.
pub fn shader_source() -> String {
    format!("{CUBE_UV}{}{COMMON}{SHADER}", crate::dfg::dfg_source())
}

/// The shadow passes' shader: entry points `vertex` and `fragment` (for alpha tests).
pub fn shadow_shader_source() -> String {
    format!("{COMMON}{SHADOW_SHADER}")
}

/// The prefiltering passes' shader with its shared functions.
pub fn pmrem_shader_source() -> String {
    format!("{CUBE_UV}{PMREM_SHADER}")
}

/// The background pass's shader with its shared functions.
pub fn background_shader_source() -> String {
    format!("{CUBE_UV}{BACKGROUND_SHADER}")
}

/// Index in [`Frame::frame_uniforms`] of the tone mapping, as a three.js constant.
pub const TONE_MAPPING_INDEX: usize = 35;
/// Index in [`Frame::frame_uniforms`] of the tone mapping exposure.
pub const TONE_MAPPING_EXPOSURE_INDEX: usize = 39;

/// The output pass used when tone mapping is on. As in three.js, the scene is drawn
/// in linear colour into a half-float target, and this pass tone-maps every pixel,
/// background included, onto the sRGB canvas. Blending therefore happens before tone
/// mapping, and `Material.toneMapped` has no effect on screen output.
pub const OUTPUT_SHADER_MAIN: &str = r#"
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

@fragment
fn fragment(input: Output) -> @location(0) vec4<f32> {
    let color = textureLoad(source, vec2<i32>(input.position.xy), 0);
    return vec4<f32>(tone_mapped(color.rgb, settings.x, settings.y), 1.0);
}
"#;

/// three.js's tone-mapping curves, shared by the output pass and the output effect.
pub const TONE_MAPPING_WGSL: &str = r#"
fn agx_contrast(x: vec3<f32>) -> vec3<f32> {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// Tone mapping as three.js applies it to output written to the canvas.
fn tone_mapped(input: vec3<f32>, mapping: f32, exposure: f32) -> vec3<f32> {
    let kind = u32(mapping + 0.5);
    if (kind == 0u) {
        return input;
    }
    var color = input * exposure;
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

"#;

/// The output pass's WGSL.
pub fn output_shader_source() -> String {
    format!("{OUTPUT_SHADER_MAIN}{TONE_MAPPING_WGSL}")
}
