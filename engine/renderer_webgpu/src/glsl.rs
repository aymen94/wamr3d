//! GLSL ES 3.00 versions of the passes, for hosts that draw with WebGL 2. They read the
//! same frame data as the WGSL in `shaders.rs`: the uniform blocks follow std140, whose
//! layout matches the WGSL structs float for float.
//!
//! Differences that come from WebGL itself: clip-space depth is -1..1, so the vertex
//! stages remap the frame's 0..1 depth; framebuffers and textures run bottom row first,
//! so shadow maps need no y flip and `dFdy` already follows the convention three.js
//! uses; colour written to the canvas is encoded to sRGB in the shader (`OUTPUT_SRGB`),
//! since the default framebuffer is not an sRGB format.

use crate::glsl_mesh::{BLOCKS, MAPS, MESH_FRAGMENT, MESH_VERTEX, QUAD_VERTEX, SHADOW_FRAGMENT, SHADOW_VERTEX, VERTEX_COMMON, VSM_FRAGMENT};

const HEADER: &str = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DArrayShadow;\n";

const ENCODE: &str = r#"
vec3 srgb_to_linear(vec3 color) {
    return mix(pow(color * 0.9478672986 + 0.0521327014, vec3(2.4)), color * 0.0773993808, vec3(lessThanEqual(color, vec3(0.04045))));
}

vec3 linear_to_srgb(vec3 color) {
    return mix(pow(max(color, vec3(0.0)), vec3(0.41666)) * 1.055 - 0.055, color * 12.92, vec3(lessThanEqual(color, vec3(0.0031308))));
}
"#;

const CUBE_UV: &str = r#"
float cube_uv_face(vec3 direction) {
    vec3 a = abs(direction);
    if (a.x > a.z) {
        if (a.x > a.y) {
            return direction.x > 0.0 ? 0.0 : 3.0;
        }
        return direction.y > 0.0 ? 1.0 : 4.0;
    }
    if (a.z > a.y) {
        return direction.z > 0.0 ? 2.0 : 5.0;
    }
    return direction.y > 0.0 ? 1.0 : 4.0;
}

vec2 cube_uv_coordinates(vec3 direction, float face) {
    vec2 uv;
    if (face == 0.0) {
        uv = vec2(direction.z, direction.y) / abs(direction.x);
    } else if (face == 1.0) {
        uv = vec2(-direction.x, -direction.z) / abs(direction.y);
    } else if (face == 2.0) {
        uv = vec2(-direction.x, direction.y) / abs(direction.z);
    } else if (face == 3.0) {
        uv = vec2(-direction.z, direction.y) / abs(direction.x);
    } else if (face == 4.0) {
        uv = vec2(-direction.x, direction.z) / abs(direction.y);
    } else {
        uv = vec2(direction.x, direction.y) / abs(direction.z);
    }
    return 0.5 * (uv + 1.0);
}

float cube_uv_roughness_to_mip(float roughness) {
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

vec3 cube_uv_bilinear(sampler2D map, vec3 direction, float mip, vec2 texel, float max_mip, float offset_y) {
    float face = cube_uv_face(direction);
    float filter_int = max(4.0 - mip, 0.0);
    float mip_int = max(mip, 4.0);
    float face_size = exp2(mip_int);
    vec2 uv = cube_uv_coordinates(direction, face) * (face_size - 2.0) + 1.0;
    if (face > 2.0) {
        uv.y += face_size;
        face -= 3.0;
    }
    uv.x += face * face_size;
    uv.x += filter_int * 3.0 * 16.0;
    uv.y += 4.0 * (exp2(max_mip) - face_size) + offset_y;
    return textureLod(map, uv * texel, 0.0).rgb;
}

vec3 cube_uv_sample(sampler2D map, vec3 direction, float roughness, vec2 texel, float max_mip, float offset_y) {
    float mip = clamp(cube_uv_roughness_to_mip(roughness), -2.0, max_mip);
    float mip_fraction = fract(mip);
    float mip_int = floor(mip);
    vec3 color = cube_uv_bilinear(map, direction, mip_int, texel, max_mip, offset_y);
    if (mip_fraction != 0.0) {
        color = mix(color, cube_uv_bilinear(map, direction, mip_int + 1.0, texel, max_mip, offset_y), mip_fraction);
    }
    return color;
}
"#;

/// A triangle that covers the frame; `v_ndc` runs -1..1 across it.
const FULLSCREEN_VERTEX: &str = r#"
// see mesh.vert
uniform float flip_y;

out vec2 v_ndc;

void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    v_ndc = corner * 2.0 - 1.0;
    gl_Position = vec4(v_ndc.x, v_ndc.y * flip_y, 1.0, 1.0);
}
"#;

const BACKGROUND_FRAGMENT: &str = r#"
layout(std140) uniform BackgroundBlock {
    mat4 clip_to_view;
    mat3 view_to_world;
    mat3 rotation;
    vec4 params;
    vec4 environment;
} background;

uniform sampler2D background_map;

in vec2 v_ndc;
layout(location = 0) out vec4 out_color;

void main() {
    uint kind = uint(background.params.x + 0.5);
    vec3 color;
    if (kind == 2u) {
        color = textureLod(background_map, v_ndc * 0.5 + 0.5, 0.0).rgb;
    } else {
        vec4 p = background.clip_to_view * vec4(v_ndc, 1.0, 1.0);
        vec3 view = p.xyz / p.w;
        float radius = background.params.w;
        if (radius > 0.0) {
            view = vec3(view.xy, -sqrt(max(radius * radius - dot(view.xy, view.xy), 0.0)));
        }
        vec3 direction = background.rotation * (background.view_to_world * normalize(view));
        if (kind == 1u) {
            vec3 flipped = vec3(direction.x, -direction.y, direction.z);
            color = cube_uv_sample(background_map, flipped, background.params.z, background.environment.xy, background.environment.z, 0.0);
        } else {
            vec2 uv = vec2(atan(direction.z, direction.x) * (1.0 / 6.283185307179586) + 0.5, asin(clamp(direction.y, -1.0, 1.0)) * (1.0 / 3.141592653589793) + 0.5);
            color = textureLod(background_map, uv, 0.0).rgb;
        }
    }
    out_color = vec4(color * background.params.y, 1.0);
#ifdef OUTPUT_SRGB
    out_color.rgb = linear_to_srgb(out_color.rgb);
#endif
}
"#;

pub const TONE_MAPPING_GLSL: &str = r#"
vec3 agx_contrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 tone_mapped(vec3 color_in, float mapping, float exposure) {
    uint kind = uint(mapping + 0.5);
    if (kind == 0u) {
        return color_in;
    }
    vec3 color = color_in * exposure;
    if (kind == 1u) {
        return clamp(color, 0.0, 1.0);
    }
    if (kind == 2u) {
        return clamp(color / (color + 1.0), 0.0, 1.0);
    }
    if (kind == 3u) {
        color = max(color - 0.004, vec3(0.0));
        return pow(color * (6.2 * color + 0.5) / (color * (6.2 * color + 1.7) + 0.06), vec3(2.2));
    }
    if (kind == 4u) {
        mat3 aces_in = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        mat3 aces_out = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        color = aces_in * (color / 0.6);
        color = (color * (color + 0.0245786) - 0.000090537) / (color * (0.983729 * color + 0.4329510) + 0.238081);
        return clamp(aces_out * color, 0.0, 1.0);
    }
    if (kind == 6u) {
        mat3 to_rec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
        mat3 to_srgb = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
        mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
        mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
        float min_ev = -12.47393;
        float max_ev = 4.026069;
        color = inset * (to_rec2020 * color);
        color = (log2(max(color, vec3(1e-10))) - min_ev) / (max_ev - min_ev);
        color = agx_contrast(clamp(color, 0.0, 1.0));
        color = pow(max(vec3(0.0), outset * color), vec3(2.2));
        return clamp(to_srgb * color, 0.0, 1.0);
    }
    if (kind == 7u) {
        float start = 0.8 - 0.04;
        float desaturation = 0.15;
        float x = min(color.r, min(color.g, color.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        color -= offset;
        float peak = max(color.r, max(color.g, color.b));
        if (peak < start) {
            return color;
        }
        float d = 1.0 - start;
        float new_peak = 1.0 - d * d / (peak + d - start);
        color *= new_peak / peak;
        float g = 1.0 - 1.0 / (desaturation * (peak - new_peak) + 1.0);
        return mix(color, vec3(new_peak), g);
    }
    return color_in;
}

"#;

const OUTPUT_FRAGMENT: &str = r#"
// x the tone mapping (a three.js constant), y the exposure
uniform vec4 settings;
uniform sampler2D source;

layout(location = 0) out vec4 out_color;

void main() {
    vec4 color = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
    out_color = vec4(linear_to_srgb(tone_mapped(color.rgb, settings.x, settings.y)), 1.0);
}
"#;

// See `CUBE_TO_EQUIRECT_SHADER`. Framebuffer rows already run bottom first.
const CUBE_EQUIRECT_FRAGMENT: &str = r#"
precision highp samplerCube;
uniform samplerCube faces;

in vec2 v_ndc;
layout(location = 0) out vec4 out_color;

void main() {
    vec2 uv = v_ndc * 0.5 + 0.5;
    float phi = (uv.x - 0.5) * 6.283185307179586;
    float latitude = (uv.y - 0.5) * 3.141592653589793;
    vec3 d = vec3(cos(phi) * cos(latitude), sin(latitude), sin(phi) * cos(latitude));
    out_color = vec4(textureLod(faces, vec3(-d.x, d.y, d.z), 0.0).rgb, 1.0);
}
"#;

const PMREM_VERTEX: &str = r#"
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_direction;

out vec3 v_direction;

// The levels are laid out as the WebGPU passes lay them out in memory: WebGL's viewport
// runs bottom up, so y is mirrored within each face.
void main() {
    gl_Position = vec4(a_position.x, -a_position.y, 0.0, 1.0);
    v_direction = a_direction;
}
"#;

const PMREM_COMMON: &str = r#"
// roughness of the convolution, source level, 1/width, 1/height
uniform vec4 params;
// x: the largest mip
uniform vec4 extra;
uniform sampler2D source;

in vec3 v_direction;
layout(location = 0) out vec4 out_color;
"#;

const PMREM_EQUIRECT: &str = r#"
void main() {
    vec3 d = normalize(v_direction);
    vec2 uv = vec2(atan(d.z, d.x) * (1.0 / 6.283185307179586) + 0.5, asin(clamp(d.y, -1.0, 1.0)) * (1.0 / 3.141592653589793) + 0.5);
    out_color = vec4(textureLod(source, uv, 0.0).rgb, 1.0);
}
"#;

const PMREM_GGX: &str = r#"
float radical_inverse(uint bits_in) {
    uint bits = (bits_in << 16u) | (bits_in >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return float(bits) * 2.3283064365386963e-10;
}

vec3 sample_ggx(vec2 xi, float roughness) {
    float alpha = roughness * roughness;
    vec3 v = vec3(0.0, 0.0, 1.0);
    vec3 t1_axis = vec3(1.0, 0.0, 0.0);
    vec3 t2_axis = cross(v, t1_axis);
    float r = sqrt(xi.x);
    float phi = 2.0 * 3.14159265359 * xi.y;
    float t1 = r * cos(phi);
    float t2 = r * sin(phi);
    float s = 0.5 * (v.z + 1.0);
    t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;
    vec3 nh = t1_axis * t1 + t2_axis * t2 + v * sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2));
    return normalize(vec3(alpha * nh.x, alpha * nh.y, max(0.0, nh.z)));
}

void main() {
    vec3 n = normalize(v_direction);
    float roughness = params.x;
    float mip = params.y;
    vec2 texel = params.zw;
    float max_mip = extra.x;
    if (roughness < 0.001) {
        out_color = vec4(cube_uv_bilinear(source, n, mip, texel, max_mip, 0.0), 1.0);
        return;
    }
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(up, n));
    vec3 bitangent = cross(n, tangent);
    vec3 color = vec3(0.0);
    float weight = 0.0;
    for (uint i = 0u; i < 256u; i++) {
        vec2 xi = vec2(float(i) / 256.0, radical_inverse(i));
        vec3 h_tangent = sample_ggx(xi, roughness);
        vec3 h = normalize(tangent * h_tangent.x + bitangent * h_tangent.y + n * h_tangent.z);
        vec3 l = normalize(h * (dot(n, h) * 2.0) - n);
        float n_l = max(dot(n, l), 0.0);
        if (n_l > 0.0) {
            color += cube_uv_bilinear(source, l, mip, texel, max_mip, 0.0) * n_l;
            weight += n_l;
        }
    }
    if (weight > 0.0) {
        color /= weight;
    }
    out_color = vec4(color, 1.0);
}
"#;

/// A GLSL shader by name: `mesh.vert`, `mesh_quad.vert` (points and lines drawn as
/// quads), `mesh.frag`, `shadow.vert`, `shadow.frag` (`#define ALPHA_TEST` for casters
/// with an alpha test), `vsm.frag` (`#define VERTICAL` for the first blur pass),
/// `fullscreen.vert`, `background.frag`, `output.frag`, `pmrem.vert`, `pmrem.equirect`,
/// `pmrem.ggx`, `cube.equirect` (a cube texture to an equirectangular image, with
/// `fullscreen.vert`). Hosts add `#define OUTPUT_SRGB` after the first line of `mesh.frag` and
/// `background.frag` when they draw to the canvas. `None` for an unknown name.
pub fn glsl_source(name: &str) -> Option<String> {
    let source = match name {
        "mesh.vert" => format!("{HEADER}{BLOCKS}{VERTEX_COMMON}{MESH_VERTEX}"),
        "mesh_quad.vert" => format!("{HEADER}{BLOCKS}{QUAD_VERTEX}"),
        "mesh.frag" => format!("{HEADER}{BLOCKS}{ENCODE}{CUBE_UV}{}{MAPS}{MESH_FRAGMENT}", crate::dfg::dfg_glsl()),
        "shadow.vert" => format!("{HEADER}{BLOCKS}{VERTEX_COMMON}{SHADOW_VERTEX}"),
        "shadow.frag" => format!("{HEADER}{BLOCKS}{MAPS}{SHADOW_FRAGMENT}"),
        "vsm.frag" => format!("{HEADER}{VSM_FRAGMENT}"),
        "fullscreen.vert" => format!("{HEADER}{FULLSCREEN_VERTEX}"),
        "background.frag" => format!("{HEADER}{ENCODE}{CUBE_UV}{BACKGROUND_FRAGMENT}"),
        "output.frag" => format!("{HEADER}{ENCODE}{TONE_MAPPING_GLSL}{OUTPUT_FRAGMENT}"),
        "pmrem.vert" => format!("{HEADER}{PMREM_VERTEX}"),
        "pmrem.equirect" => format!("{HEADER}{PMREM_COMMON}{PMREM_EQUIRECT}"),
        "pmrem.ggx" => format!("{HEADER}{CUBE_UV}{PMREM_COMMON}{PMREM_GGX}"),
        "cube.equirect" => format!("{HEADER}{CUBE_EQUIRECT_FRAGMENT}"),
        _ if name.starts_with("effect.") => return crate::effects::effect_glsl(name, HEADER, ENCODE),
        _ => return None,
    };
    Some(source)
}
