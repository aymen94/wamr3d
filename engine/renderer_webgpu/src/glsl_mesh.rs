//! GLSL ES 3.00 of the mesh pipelines, the shadow passes and the VSM blur, reading the
//! same blocks as the WGSL in `mesh_wgsl.rs` (std140 matches the WGSL layout).

pub const BLOCKS: &str = r#"
struct Light {
    vec4 position;
    vec4 direction;
    vec4 color;
    vec4 cone;
};

struct Shadow {
    mat4 transform;
    vec4 params;
    vec4 region;
};

layout(std140) uniform FrameBlock {
    mat4 view_projection;
    vec4 camera_position;
    vec4 sky;
    vec4 ground;
    vec4 fog_color;
    vec4 fog;
    vec4 camera_forward;
    vec4 camera_right;
    vec4 camera_up;
    Light lights[16];
    Shadow shadows[16];
    vec4 environment;
    vec4 environment_unused[3];
    vec4 probe[9];
    vec4 transmission;
} frame;

layout(std140) uniform ObjectBlock {
    mat4 model;
    vec4 normal_0;
    vec4 normal_1;
    vec4 normal_2;
    vec4 params;
} object;

// See the WGSL `MaterialUniforms`.
layout(std140) uniform MaterialBlock {
    vec4 color;
    vec4 params;
    vec4 emissive;
    vec4 specular;
    vec4 environment;
    vec4 surface;
    vec4 layers;
    vec4 sheen;
    vec4 transmission;
    vec4 attenuation;
    vec4 iridescence;
    vec4 anisotropy;
    vec4 sprite;
    vec4 environment_rotation_0;
    vec4 environment_rotation_1;
    vec4 environment_rotation_2;
    vec4 maps[48];
} material;

#define MAP_COLOR 0
#define MAP_NORMAL 1
#define MAP_ROUGHNESS 2
#define MAP_METALNESS 3
#define MAP_EMISSIVE 4
#define MAP_ALPHA 5
#define MAP_AO 6
#define MAP_LIGHT 7
#define MAP_BUMP 8
#define MAP_DISPLACEMENT 9
#define MAP_SPECULAR 10
#define MAP_GRADIENT 11
#define MAP_CLEARCOAT 12
#define MAP_CLEARCOAT_ROUGHNESS 13
#define MAP_CLEARCOAT_NORMAL 14
#define MAP_SHEEN_COLOR 15
#define MAP_SHEEN_ROUGHNESS 16
#define MAP_SPECULAR_INTENSITY 17
#define MAP_SPECULAR_COLOR 18
#define MAP_TRANSMISSION 19
#define MAP_THICKNESS 20
#define MAP_IRIDESCENCE 21
#define MAP_IRIDESCENCE_THICKNESS 22
#define MAP_ANISOTROPY 23

bool map_present(int k) {
    return material.maps[2 * k].w > 0.5;
}

vec2 map_transform(int k, vec2 uv) {
    vec4 a = material.maps[2 * k];
    vec4 b = material.maps[2 * k + 1];
    return vec2(dot(a.xyz, vec3(uv, 1.0)), dot(b.xyz, vec3(uv, 1.0)));
}
"#;

/// Texture slots and map sampling, for stages that read maps.
pub const MAPS: &str = r#"
uniform sampler2D slot_0;
uniform sampler2D slot_1;
uniform sampler2D slot_2;
uniform sampler2D slot_3;
uniform sampler2D slot_4;
uniform sampler2D slot_5;
uniform sampler2D slot_6;
uniform sampler2D slot_7;
uniform sampler2D slot_8;
uniform sampler2D slot_9;
uniform sampler2D slot_10;
uniform sampler2D slot_11;

struct Coords {
    vec2 uv0;
    vec2 uv1;
    vec2 d0x;
    vec2 d0y;
    vec2 d1x;
    vec2 d1y;
};

struct MapCoords {
    vec2 uv;
    vec2 dx;
    vec2 dy;
    int slot;
};

MapCoords map_coords(int k, Coords c) {
    vec4 a = material.maps[2 * k];
    vec4 b = material.maps[2 * k + 1];
    bool second = b.w > 0.5;
    vec2 uv = second ? c.uv1 : c.uv0;
    vec2 dx = second ? c.d1x : c.d0x;
    vec2 dy = second ? c.d1y : c.d0y;
    MapCoords m;
    m.uv = vec2(dot(a.xyz, vec3(uv, 1.0)), dot(b.xyz, vec3(uv, 1.0)));
    m.dx = vec2(dot(a.xy, dx), dot(b.xy, dx));
    m.dy = vec2(dot(a.xy, dy), dot(b.xy, dy));
    m.slot = int(a.w + 0.5) - 1;
    return m;
}

vec4 slot_sample(int slot, vec2 uv, vec2 dx, vec2 dy) {
    switch (slot) {
        case 0: return textureGrad(slot_0, uv, dx, dy);
        case 1: return textureGrad(slot_1, uv, dx, dy);
        case 2: return textureGrad(slot_2, uv, dx, dy);
        case 3: return textureGrad(slot_3, uv, dx, dy);
        case 4: return textureGrad(slot_4, uv, dx, dy);
        case 5: return textureGrad(slot_5, uv, dx, dy);
        case 6: return textureGrad(slot_6, uv, dx, dy);
        case 7: return textureGrad(slot_7, uv, dx, dy);
        case 8: return textureGrad(slot_8, uv, dx, dy);
        case 9: return textureGrad(slot_9, uv, dx, dy);
        case 10: return textureGrad(slot_10, uv, dx, dy);
        default: return textureGrad(slot_11, uv, dx, dy);
    }
}

vec4 map_sample(int k, Coords c) {
    MapCoords m = map_coords(k, c);
    return slot_sample(m.slot, m.uv, m.dx, m.dy);
}
"#;

/// Skinning and displacement, for the vertex stages of the mesh and shadow passes.
pub const VERTEX_COMMON: &str = r#"
uniform highp sampler2D bone_map;
uniform sampler2D slot_9;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec4 a_instance0;
layout(location = 5) in vec4 a_instance1;
layout(location = 6) in vec4 a_instance2;
layout(location = 7) in vec4 a_instance3;
layout(location = 8) in vec3 a_instance_color;
layout(location = 9) in vec4 a_tangent;
layout(location = 10) in vec2 a_uv1;
layout(location = 11) in vec4 a_skin_index;
layout(location = 12) in vec4 a_skin_weight;

// -1 while drawing into a render target, so that its rows are stored top first, as
// WebGPU stores them and as they are sampled; 1 otherwise.
uniform float flip_y;

mat4 bone_matrix(int index) {
    int row = index / 256;
    int column = (index - row * 256) * 4;
    return mat4(
        texelFetch(bone_map, ivec2(column, row), 0),
        texelFetch(bone_map, ivec2(column + 1, row), 0),
        texelFetch(bone_map, ivec2(column + 2, row), 0),
        texelFetch(bone_map, ivec2(column + 3, row), 0)
    );
}

mat4 skin_matrix() {
    int first = int(object.params.y + 0.5) - 1;
    return bone_matrix(first + int(a_skin_index.x + 0.5)) * a_skin_weight.x
        + bone_matrix(first + int(a_skin_index.y + 0.5)) * a_skin_weight.y
        + bone_matrix(first + int(a_skin_index.z + 0.5)) * a_skin_weight.z
        + bone_matrix(first + int(a_skin_index.w + 0.5)) * a_skin_weight.w;
}

vec3 displaced(vec3 position, vec3 normal) {
    if (!map_present(MAP_DISPLACEMENT)) {
        return position;
    }
    float length_normal = length(normal);
    vec3 direction = length_normal > 0.0 ? normal / length_normal : vec3(0.0);
    bool second = material.maps[2 * MAP_DISPLACEMENT + 1].w > 0.5;
    vec2 uv = map_transform(MAP_DISPLACEMENT, second ? a_uv1 : a_uv);
    float height = textureLod(slot_9, uv, 0.0).x;
    return position + direction * (height * material.surface.y + material.surface.z);
}
"#;

pub const MESH_VERTEX: &str = r#"
out vec3 v_normal;
out vec3 v_world;
out vec2 v_uv;
out vec4 v_color;
out vec3 v_tint;
out float v_depth;
out vec2 v_uv1;
out vec4 v_tangent;

void main() {
    uint flags = uint(object.params.x);
    v_uv = a_uv;
    v_uv1 = a_uv1;
    vec3 position = a_position;
    vec3 normal = a_normal;
    vec3 tangent = a_tangent.xyz;
    if (object.params.y > 0.5) {
        mat4 skin = skin_matrix();
        position = (skin * vec4(position, 1.0)).xyz;
        normal = (skin * vec4(normal, 0.0)).xyz;
        tangent = (skin * vec4(tangent, 0.0)).xyz;
    }
    position = displaced(position, normal);
    mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
    vec4 world = object.model * (instance * vec4(position, 1.0));
    if ((flags & 8u) != 0u) {
        vec3 origin = object.model[3].xyz;
        vec2 scale = vec2(length(object.model[0].xyz), length(object.model[1].xyz));
        if (frame.camera_up.w > 0.5 && (uint(material.params.w) & 16u) != 0u) {
            scale *= dot(origin - frame.camera_position.xyz, frame.camera_forward.xyz);
        }
        vec2 aligned = (a_position.xy - (object.params.zw - 0.5)) * scale;
        float c = cos(material.sprite.x);
        float s = sin(material.sprite.x);
        vec2 rotated = vec2(c * aligned.x - s * aligned.y, s * aligned.x + c * aligned.y);
        world = vec4(origin + frame.camera_right.xyz * rotated.x + frame.camera_up.xyz * rotated.y, 1.0);
    }
    gl_Position = frame.view_projection * world;
    gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
    gl_Position.y *= flip_y;
    gl_PointSize = 1.0;
    v_world = world.xyz;

    vec3 x = a_instance0.xyz;
    vec3 y = a_instance1.xyz;
    vec3 z = a_instance2.xyz;
    vec3 instance_normal = mat3(x, y, z) * (normal / vec3(dot(x, x), dot(y, y), dot(z, z)));
    v_normal = mat3(object.normal_0.xyz, object.normal_1.xyz, object.normal_2.xyz) * instance_normal;
    v_tangent = vec4(mat3(object.model) * (mat3(x, y, z) * tangent), a_tangent.w);
    v_color = a_color;
    v_tint = a_instance_color;
    v_depth = dot(world.xyz - frame.camera_position.xyz, frame.camera_forward.xyz);
}
"#;

/// Points and lines drawn as quads: the vertices are read per point or segment (an
/// attribute divisor of 1), the quad's corner from `gl_VertexID`.
pub const QUAD_VERTEX: &str = r#"
layout(location = 0) in vec3 a_position;
layout(location = 3) in vec4 a_color;
layout(location = 13) in vec3 a_position_b;
layout(location = 14) in vec4 a_color_b;

uniform float flip_y;

out vec3 v_normal;
out vec3 v_world;
out vec2 v_uv;
out vec4 v_color;
out vec3 v_tint;
out float v_depth;
out vec2 v_uv1;
out vec4 v_tangent;

void main() {
    int index = gl_VertexID - (gl_VertexID / 6) * 6;
    vec2 corner = index == 0 || index == 3 ? vec2(-1.0, -1.0) : index == 1 ? vec2(1.0, -1.0) : index == 5 ? vec2(-1.0, 1.0) : vec2(1.0, 1.0);
    vec2 pixel = frame.transmission.xy * 2.0;
    float pixel_ratio = frame.transmission.w;
    vec4 a = object.model * vec4(a_position, 1.0);
    vec4 clip_a = frame.view_projection * a;
    vec4 clip = clip_a;
    vec4 world = a;
    vec4 color = a_color;
    if ((uint(object.params.x) & 16u) != 0u) {
        vec4 b = object.model * vec4(a_position_b, 1.0);
        vec4 clip_b = frame.view_projection * b;
        vec2 screen = (clip_b.xy / clip_b.w - clip_a.xy / clip_a.w) / pixel;
        vec2 along = length(screen) > 0.0 ? normalize(screen) : vec2(1.0, 0.0);
        vec2 across = vec2(-along.y, along.x);
        bool at_b = corner.x > 0.0;
        clip = at_b ? clip_b : clip_a;
        world = at_b ? b : a;
        color = at_b ? a_color_b : a_color;
        clip.xy += across * corner.y * material.sprite.z * pixel_ratio * 0.5 * pixel * clip.w;
    } else {
        float size = material.sprite.y * pixel_ratio;
        if (frame.camera_up.w > 0.5 && (uint(material.params.w) & 16u) == 0u) {
            float distance = max(dot(a.xyz - frame.camera_position.xyz, frame.camera_forward.xyz), 0.000001);
            size *= frame.camera_right.w / distance;
        }
        clip.xy += corner * size * 0.5 * pixel * clip.w;
    }
    gl_Position = clip;
    gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
    gl_Position.y *= flip_y;
    v_world = world.xyz;
    vec2 uv = corner * vec2(0.5, -0.5) + 0.5;
    v_uv = vec2(uv.x, 1.0 - uv.y);
    v_uv1 = v_uv;
    v_normal = vec3(0.0, 0.0, 1.0);
    v_tangent = vec4(0.0);
    v_color = color;
    v_tint = vec3(1.0);
    v_depth = dot(world.xyz - frame.camera_position.xyz, frame.camera_forward.xyz);
}
"#;

pub const MESH_FRAGMENT: &str = r#"
const float RECIPROCAL_PI = 0.31830988618;
const float PI = 3.141592653589793;

uniform sampler2DArrayShadow shadow_map;
uniform sampler2D environment_map;
uniform sampler2D transmission_map;
uniform highp sampler2DArray vsm_map;

in vec3 v_normal;
in vec3 v_world;
in vec2 v_uv;
in vec4 v_color;
in vec3 v_tint;
in float v_depth;
in vec2 v_uv1;
in vec4 v_tangent;

layout(location = 0) out vec4 out_color;

vec3 environment_sample(vec3 direction, float roughness) {
    mat3 rotation = mat3(material.environment_rotation_0.xyz, material.environment_rotation_1.xyz, material.environment_rotation_2.xyz);
    vec3 rotated = rotation * vec3(direction.x, -direction.y, direction.z);
    float offset = material.sheen.w * frame.environment.w;
    return cube_uv_sample(environment_map, rotated, roughness, frame.environment.xy, frame.environment.z, offset);
}

float gradient_noise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

float shadowed(int index, vec3 world, vec3 normal, vec2 pixel) {
    Shadow s = frame.shadows[index];
    vec4 projected = s.transform * vec4(world + normal * s.params.y, 1.0);
    vec3 coord = projected.xyz / projected.w;
    coord.z += s.params.x;
    if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
        return 1.0;
    }
    float layer = floor(s.region.z + 0.5);
    if (s.region.w > 1.5) {
        vec2 distribution = textureLod(vsm_map, vec3(coord.xy * s.region.xy, layer), 0.0).xy;
        if (coord.z <= distribution.x) {
            return 1.0;
        }
        float variance = max(distribution.y * distribution.y, 0.0000001);
        float d = coord.z - distribution.x;
        float p_max = clamp((variance / (variance + d * d) - 0.3) / 0.65, 0.0, 1.0);
        return mix(1.0, p_max, s.params.z);
    }
    if (s.region.w < 0.5) {
        vec2 size = vec2(textureSize(shadow_map, 0).xy);
        vec2 texel = (floor(coord.xy * s.region.xy * size) + 0.5) / size;
        return mix(1.0, texture(shadow_map, vec4(texel, layer, coord.z)), s.params.z);
    }
    float phi = gradient_noise(pixel) * 6.28318530718;
    float sum = 0.0;
    for (int k = 0; k < 5; k++) {
        float radius = sqrt((float(k) + 0.5) / 5.0);
        float theta = float(k) * 2.399963229728653 + phi;
        vec2 uv = coord.xy + vec2(cos(theta), sin(theta)) * radius * s.params.w;
        sum += texture(shadow_map, vec4(uv * s.region.xy, layer, coord.z));
    }
    return mix(1.0, sum / 5.0, s.params.z);
}

int cube_face(vec3 d) {
    vec3 a = abs(d);
    if (a.x >= a.y && a.x >= a.z) {
        return d.x > 0.0 ? 0 : 1;
    }
    if (a.y >= a.z) {
        return d.y > 0.0 ? 2 : 3;
    }
    return d.z > 0.0 ? 4 : 5;
}

vec3 fogged(vec3 color, float depth) {
    float kind = frame.fog_color.w;
    if (kind < 0.5) {
        return color;
    }
    float amount = smoothstep(frame.fog.x, frame.fog.y, depth);
    if (kind > 1.5) {
        amount = 1.0 - exp(-frame.fog.z * frame.fog.z * depth * depth);
    }
    return mix(color, frame.fog_color.rgb, amount);
}

vec3 fresnel(vec3 f0, float f90, float v_h) {
    float weight = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - weight) + vec3(f90 * weight);
}

float schlick(float f0, float v_h) {
    float weight = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - weight) + weight;
}

struct Lobe {
    float iridescence;
    vec3 iridescence_fresnel;
    bool anisotropic;
    float alpha_t;
    vec3 t;
    vec3 b;
};

Lobe plain_lobe() {
    return Lobe(0.0, vec3(0.0), false, 0.0, vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
}

vec3 specular_ggx(vec3 n, vec3 l, vec3 v, vec3 f0, float f90, float roughness, Lobe lobe) {
    float alpha = roughness * roughness;
    float a2 = alpha * alpha;
    vec3 h = normalize(l + v);
    float n_l = clamp(dot(n, l), 0.0, 1.0);
    float n_v = clamp(dot(n, v), 0.0, 1.0);
    float n_h = clamp(dot(n, h), 0.0, 1.0);
    float v_h = clamp(dot(v, h), 0.0, 1.0);
    vec3 f = mix(fresnel(f0, f90, v_h), lobe.iridescence_fresnel, lobe.iridescence);
    if (lobe.anisotropic) {
        float t_l = dot(lobe.t, l);
        float t_v = dot(lobe.t, v);
        float t_h = dot(lobe.t, h);
        float b_l = dot(lobe.b, l);
        float b_v = dot(lobe.b, v);
        float b_h = dot(lobe.b, h);
        float gv = n_l * length(vec3(lobe.alpha_t * t_v, alpha * b_v, n_v));
        float gl = n_v * length(vec3(lobe.alpha_t * t_l, alpha * b_l, n_l));
        float visibility = 0.5 / max(gv + gl, 0.000001);
        float ab = lobe.alpha_t * alpha;
        vec3 w = vec3(alpha * t_h, lobe.alpha_t * b_h, ab * n_h);
        float w2 = ab / dot(w, w);
        return f * (visibility * RECIPROCAL_PI * ab * w2 * w2);
    }
    float gv = n_l * sqrt(a2 + (1.0 - a2) * n_v * n_v);
    float gl = n_v * sqrt(a2 + (1.0 - a2) * n_l * n_l);
    float visibility = 0.5 / max(gv + gl, 0.000001);
    float denominator = n_h * n_h * (a2 - 1.0) + 1.0;
    float distribution = RECIPROCAL_PI * a2 / (denominator * denominator);
    return f * (visibility * distribution);
}

void scattering(vec3 f0, float f90, vec2 fab, out vec3 single, out vec3 multiple) {
    single = f0 * fab.x + vec3(f90 * fab.y);
    float lost = 1.0 - (fab.x + fab.y);
    vec3 average = f0 + (1.0 - f0) * 0.047619;
    multiple = single * average / (1.0 - lost * average) * lost;
}

vec3 sheen_brdf(vec3 n, vec3 l, vec3 v, vec3 color, float roughness) {
    vec3 h = normalize(l + v);
    float n_l = clamp(dot(n, l), 0.0, 1.0);
    float n_v = clamp(dot(n, v), 0.0, 1.0);
    float n_h = clamp(dot(n, h), 0.0, 1.0);
    float inverse_alpha = 1.0 / (roughness * roughness);
    float sin2h = max(1.0 - n_h * n_h, 0.0078125);
    float distribution = (2.0 + inverse_alpha) * pow(sin2h, inverse_alpha * 0.5) * (0.5 * RECIPROCAL_PI);
    float visibility = clamp(1.0 / (4.0 * (n_l + n_v - n_l * n_v)), 0.0, 1.0);
    return color * (distribution * visibility);
}

float sheen_albedo(float cos_theta, float roughness) {
    float r2 = roughness * roughness;
    float r_inverse = 1.0 / (roughness + 0.1);
    float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * r_inverse;
    float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * r_inverse;
    return clamp(exp(a * cos_theta + b), 0.0, 1.0);
}

float falloff(float dist, float cutoff, float decay) {
    float value = 1.0 / max(pow(dist, decay), 0.01);
    if (cutoff > 0.0) {
        float ratio = dist / cutoff;
        float window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
        value *= window * window;
    }
    return value;
}

// GL's y already runs up: no negated derivatives (see the WGSL).
mat3 derivative_frame(vec3 n, vec3 q0, vec3 q1, vec2 st0, vec2 st1, float face) {
    vec3 q1perp = cross(q1, n);
    vec3 q0perp = cross(n, q0);
    vec3 t = q1perp * st0.x + q0perp * st1.x;
    vec3 b = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(t, t), dot(b, b));
    float scale = (det == 0.0 ? 0.0 : inversesqrt(det)) * face;
    return mat3(t * scale, b * scale, n);
}

mat3 surface_frame(MapCoords m, vec3 n, vec3 geometry_normal, vec3 position_dx, vec3 position_dy, float face) {
    if (abs(v_tangent.w) > 0.5) {
        vec3 t = normalize(v_tangent.xyz);
        vec3 b = normalize(cross(geometry_normal, t) * v_tangent.w);
        return mat3(t * face, b * face, n);
    }
    return derivative_frame(n, position_dx, position_dy, m.dx, m.dy, face);
}

vec3 iridescence_sensitivity(float opd, vec3 shift) {
    float phase = 2.0 * PI * opd * 1.0e-9;
    vec3 val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
    vec3 pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
    vec3 spread = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
    vec3 xyz = val * sqrt(2.0 * PI * spread) * cos(pos * phase + shift) * exp(-phase * phase * spread);
    xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
    xyz /= 1.0685e-7;
    mat3 xyz_to_rec709 = mat3(vec3(3.2404542, -0.9692660, 0.0556434), vec3(-1.5371385, 1.8760108, -0.2040259), vec3(-0.4985314, 0.0415560, 1.0572252));
    return xyz_to_rec709 * xyz;
}

vec3 iridescence_fresnel(float outside_ior, float eta2, float cos_theta1, float thickness, vec3 base_f0) {
    float ior = mix(outside_ior, eta2, smoothstep(0.0, 0.03, thickness));
    float sin2 = (outside_ior / ior) * (outside_ior / ior) * (1.0 - cos_theta1 * cos_theta1);
    float cos2_sq = 1.0 - sin2;
    if (cos2_sq < 0.0) {
        return vec3(1.0);
    }
    float cos_theta2 = sqrt(cos2_sq);
    float r0 = ((ior - outside_ior) / (ior + outside_ior)) * ((ior - outside_ior) / (ior + outside_ior));
    float r12 = schlick(r0, cos_theta1);
    float t121 = 1.0 - r12;
    float phi12 = ior < outside_ior ? PI : 0.0;
    float phi21 = PI - phi12;
    vec3 sqrt_f0 = sqrt(clamp(base_f0, 0.0, 0.9999));
    vec3 base_ior = (1.0 + sqrt_f0) / (1.0 - sqrt_f0);
    vec3 r1 = ((base_ior - ior) / (base_ior + ior)) * ((base_ior - ior) / (base_ior + ior));
    vec3 r23 = fresnel(r1, 1.0, cos_theta2);
    vec3 phi23 = vec3(base_ior.x < ior ? PI : 0.0, base_ior.y < ior ? PI : 0.0, base_ior.z < ior ? PI : 0.0);
    float opd = 2.0 * ior * thickness * cos_theta2;
    vec3 phi = vec3(phi21) + phi23;
    vec3 r123 = clamp(r12 * r23, 1e-5, 0.9999);
    vec3 sqrt_r123 = sqrt(r123);
    vec3 rs = t121 * t121 * r23 / (1.0 - r123);
    vec3 result = r12 + rs;
    vec3 cm = rs - t121;
    for (int m = 1; m <= 2; m++) {
        cm *= sqrt_r123;
        result += cm * 2.0 * iridescence_sensitivity(float(m) * opd, float(m) * phi);
    }
    return max(result, vec3(0.0));
}

vec3 schlick_to_f0(vec3 f, float f90, float v_h) {
    float x = clamp(1.0 - v_h, 0.0, 1.0);
    float x2 = x * x;
    float x5 = clamp(x * x2 * x2, 0.0, 0.9999);
    return (f - vec3(f90) * x5) / (1.0 - x5);
}

vec3 probe_irradiance(vec3 n) {
    vec3 result = frame.probe[0].rgb * 0.886227;
    result += frame.probe[1].rgb * 2.0 * 0.511664 * n.y;
    result += frame.probe[2].rgb * 2.0 * 0.511664 * n.z;
    result += frame.probe[3].rgb * 2.0 * 0.511664 * n.x;
    result += frame.probe[4].rgb * 2.0 * 0.429043 * n.x * n.y;
    result += frame.probe[5].rgb * 2.0 * 0.429043 * n.y * n.z;
    result += frame.probe[6].rgb * (0.743125 * n.z * n.z - 0.247708);
    result += frame.probe[7].rgb * 2.0 * 0.429043 * n.x * n.z;
    result += frame.probe[8].rgb * 0.429043 * (n.x * n.x - n.y * n.y);
    return result;
}

vec3 edge_form_factor(vec3 v1, vec3 v2) {
    float x = dot(v1, v2);
    float y = abs(x);
    float a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
    float b = 3.4175940 + (4.1616724 + y) * y;
    float v = a / b;
    float theta_sintheta = x > 0.0 ? v : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - v;
    return cross(v1, v2) * theta_sintheta;
}

float rect_form_factor(vec3 n, vec3 v, vec3 p, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
    vec3 light_normal = cross(c1 - c0, c3 - c0);
    if (dot(light_normal, p - c0) < 0.0) {
        return 0.0;
    }
    vec3 t1 = v - n * dot(v, n);
    if (dot(t1, t1) < 1e-8) {
        t1 = cross(n, abs(n.x) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
    }
    t1 = normalize(t1);
    vec3 t2 = -cross(n, t1);
    mat3 basis = transpose(mat3(t1, t2, n));
    vec3 d0 = normalize(basis * (c0 - p));
    vec3 d1 = normalize(basis * (c1 - p));
    vec3 d2 = normalize(basis * (c2 - p));
    vec3 d3 = normalize(basis * (c3 - p));
    vec3 f = edge_form_factor(d0, d1) + edge_form_factor(d1, d2) + edge_form_factor(d2, d3) + edge_form_factor(d3, d0);
    float l = length(f);
    return max((l * l + f.z) / (l + 1.0), 0.0);
}

vec3 rect_closest_point(vec3 p, vec3 r, vec3 center, vec3 half_width, vec3 half_height) {
    vec3 normal = normalize(cross(half_width, half_height));
    float denominator = dot(r, normal);
    vec3 hit = center;
    if (abs(denominator) > 1e-6) {
        hit = p + r * max(dot(center - p, normal) / denominator, 0.0);
    }
    vec3 offset = hit - center;
    float u = clamp(dot(offset, half_width) / max(dot(half_width, half_width), 1e-8), -1.0, 1.0);
    float w = clamp(dot(offset, half_height) / max(dot(half_height, half_height), 1e-8), -1.0, 1.0);
    return center + half_width * u + half_height * w;
}

vec4 finish(vec3 color, float alpha) {
    if ((uint(material.params.w) & 4194304u) != 0u) {
        return vec4(color * alpha, alpha);
    }
    return vec4(color, alpha);
}

vec4 shade() {
    vec3 geometry_normal = normalize(v_normal);
    float face = gl_FrontFacing ? 1.0 : -1.0;
    vec3 face_normal = geometry_normal * face;
    vec3 n = face_normal;
    vec3 n_dx = dFdx(n);
    vec3 n_dy = dFdy(n);
    Coords c = Coords(v_uv, v_uv1, dFdx(v_uv), dFdy(v_uv), dFdx(v_uv1), dFdy(v_uv1));
    vec3 position_dx = dFdx(v_world);
    vec3 position_dy = dFdy(v_world);
    uint object_flags = uint(object.params.x);
    uint flags = uint(material.params.w);
    vec4 texel = map_present(MAP_COLOR) ? map_sample(MAP_COLOR, c) : vec4(1.0);
    vec3 base = material.color.rgb * texel.rgb * v_tint;
    float coverage = material.color.a * texel.a;
    if ((object_flags & 1u) != 0u) {
        base *= v_color.rgb;
        coverage *= v_color.a;
    }
    if (map_present(MAP_ALPHA)) {
        coverage *= map_sample(MAP_ALPHA, c).r;
    }
    if (material.surface.w > 0.0 && coverage <= material.surface.w) {
        discard;
    }
    float alpha = (flags & 2u) != 0u ? coverage : 1.0;

    if (map_present(MAP_NORMAL)) {
        MapCoords m = map_coords(MAP_NORMAL, c);
        vec3 sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
        vec3 map_normal = vec3(sampled.xy * material.environment.zw, sampled.z);
        n = normalize(surface_frame(m, n, geometry_normal, position_dx, position_dy, face) * map_normal);
    } else if (map_present(MAP_BUMP)) {
        MapCoords m = map_coords(MAP_BUMP, c);
        float height = slot_sample(m.slot, m.uv, m.dx, m.dy).x;
        float height_dx = slot_sample(m.slot, m.uv + m.dx, m.dx, m.dy).x - height;
        float height_dy = slot_sample(m.slot, m.uv + m.dy, m.dx, m.dy).x - height;
        vec2 slope = vec2(height_dx, height_dy) * material.surface.x;
        vec3 sigma_x = normalize(position_dx);
        vec3 sigma_y = normalize(position_dy);
        vec3 r1 = cross(sigma_y, n);
        vec3 r2 = cross(n, sigma_x);
        float det = dot(sigma_x, r1) * face;
        vec3 gradient = sign(det) * (slope.x * r1 + slope.y * r2);
        n = normalize(abs(det) * n - gradient);
    }

    float occlusion = 1.0;
    if (map_present(MAP_AO)) {
        occlusion = (map_sample(MAP_AO, c).r - 1.0) * material.emissive.w + 1.0;
    }
    vec3 baked = vec3(0.0);
    if (map_present(MAP_LIGHT)) {
        baked = map_sample(MAP_LIGHT, c).rgb * material.environment.y;
    }

    uint shading = uint(material.params.z + 0.5);
    if (shading == 1u) {
        vec3 indirect = map_present(MAP_LIGHT) ? baked * RECIPROCAL_PI : vec3(1.0);
        return finish(fogged(base * indirect * occlusion, v_depth), alpha);
    }
    if (shading == 4u) {
        vec3 view_normal = vec3(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return finish(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    bool standard = shading == 2u;
    bool phong = shading == 3u;
    bool toon = shading == 5u;
    float metalness = material.params.y;
    if (map_present(MAP_METALNESS)) {
        metalness *= map_sample(MAP_METALNESS, c).b;
    }
    float roughness_factor = material.params.x;
    if (map_present(MAP_ROUGHNESS)) {
        roughness_factor *= map_sample(MAP_ROUGHNESS, c).g;
    }
    vec3 view_dx = abs(vec3(dot(n_dx, frame.camera_right.xyz), dot(n_dx, frame.camera_up.xyz), dot(n_dx, frame.camera_forward.xyz)));
    vec3 view_dy = abs(vec3(dot(n_dy, frame.camera_right.xyz), dot(n_dy, frame.camera_up.xyz), dot(n_dy, frame.camera_forward.xyz)));
    vec3 geometry_change = max(view_dx, view_dy);
    float geometry_roughness = max(max(geometry_change.x, geometry_change.y), geometry_change.z);
    float roughness = min(max(roughness_factor, 0.0525) + geometry_roughness, 1.0);
    vec3 emissive = material.emissive.rgb;
    if (map_present(MAP_EMISSIVE)) {
        emissive *= map_sample(MAP_EMISSIVE, c).rgb;
    }
    vec3 v = normalize(frame.camera_position.xyz - v_world);
    float n_v = clamp(dot(n, v), 0.0, 1.0);
    vec3 dielectric_f0 = material.specular.rgb;
    float specular_intensity = material.specular.w;
    if (standard && map_present(MAP_SPECULAR_COLOR)) {
        dielectric_f0 = min(dielectric_f0 * map_sample(MAP_SPECULAR_COLOR, c).rgb, vec3(1.0));
    }
    if (standard && map_present(MAP_SPECULAR_INTENSITY)) {
        float k = map_sample(MAP_SPECULAR_INTENSITY, c).a;
        dielectric_f0 *= k;
        specular_intensity *= k;
    }
    float f90 = mix(specular_intensity, 1.0, metalness);
    vec3 f0 = mix(dielectric_f0, base, metalness);
    float shininess = max(material.specular.w, 0.0001);
    float specular_strength = 1.0;
    if (map_present(MAP_SPECULAR)) {
        specular_strength = map_sample(MAP_SPECULAR, c).r;
    }

    bool has_clearcoat = standard && (flags & 131072u) != 0u;
    float clearcoat = material.layers.x;
    float clearcoat_roughness_factor = material.layers.y;
    vec3 clearcoat_normal = face_normal;
    if (has_clearcoat) {
        if (map_present(MAP_CLEARCOAT)) {
            clearcoat *= map_sample(MAP_CLEARCOAT, c).x;
        }
        if (map_present(MAP_CLEARCOAT_ROUGHNESS)) {
            clearcoat_roughness_factor *= map_sample(MAP_CLEARCOAT_ROUGHNESS, c).y;
        }
        if (map_present(MAP_CLEARCOAT_NORMAL)) {
            MapCoords m = map_coords(MAP_CLEARCOAT_NORMAL, c);
            vec3 sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
            vec3 coat_normal = vec3(sampled.xy * material.anisotropy.zw, sampled.z);
            clearcoat_normal = normalize(surface_frame(m, face_normal, geometry_normal, position_dx, position_dy, face) * coat_normal);
        }
    }
    clearcoat = clamp(clearcoat, 0.0, 1.0);
    float clearcoat_roughness = min(max(clearcoat_roughness_factor, 0.0525) + geometry_roughness, 1.0);

    bool has_sheen = standard && (flags & 262144u) != 0u;
    vec3 sheen_color = material.sheen.rgb;
    float sheen_roughness = clamp(material.layers.z, 0.07, 1.0);
    if (has_sheen) {
        if (map_present(MAP_SHEEN_COLOR)) {
            sheen_color *= map_sample(MAP_SHEEN_COLOR, c).rgb;
        }
        if (map_present(MAP_SHEEN_ROUGHNESS)) {
            sheen_roughness = clamp(sheen_roughness * map_sample(MAP_SHEEN_ROUGHNESS, c).a, 0.07, 1.0);
        }
    }
    float sheen_peak = max(max(sheen_color.r, sheen_color.g), sheen_color.b);
    float sheen_albedo_v = sheen_albedo(n_v, sheen_roughness);

    Lobe lobe = plain_lobe();
    vec3 iridescence_f0_dielectric = dielectric_f0;
    vec3 iridescence_f0_metallic = base;
    if (standard && (flags & 1048576u) != 0u) {
        float iridescence = material.attenuation.w;
        if (map_present(MAP_IRIDESCENCE)) {
            iridescence *= map_sample(MAP_IRIDESCENCE, c).r;
        }
        float thickness = material.iridescence.z;
        if (map_present(MAP_IRIDESCENCE_THICKNESS)) {
            thickness = mix(material.iridescence.y, material.iridescence.z, map_sample(MAP_IRIDESCENCE_THICKNESS, c).g);
        }
        iridescence = thickness == 0.0 ? 0.0 : clamp(iridescence, 0.0, 1.0);
        if (iridescence > 0.0) {
            vec3 dielectric = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, dielectric_f0);
            vec3 metallic = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, base);
            lobe.iridescence = iridescence;
            lobe.iridescence_fresnel = mix(dielectric, metallic, metalness);
            iridescence_f0_dielectric = mix(dielectric_f0, schlick_to_f0(dielectric, 1.0, n_v), iridescence);
            iridescence_f0_metallic = mix(base, schlick_to_f0(metallic, 1.0, n_v), iridescence);
        }
    }

    float anisotropy = 0.0;
    if (standard && (flags & 2097152u) != 0u) {
        vec2 direction = material.anisotropy.xy * material.iridescence.w;
        MapCoords frame_coords = MapCoords(v_uv, c.d0x, c.d0y, 0);
        if (map_present(MAP_ANISOTROPY)) {
            frame_coords = map_coords(MAP_ANISOTROPY, c);
            vec3 polar = slot_sample(frame_coords.slot, frame_coords.uv, frame_coords.dx, frame_coords.dy).rgb;
            mat2 rotation = mat2(direction.x, direction.y, -direction.y, direction.x);
            direction = rotation * normalize(2.0 * polar.rg - vec2(1.0)) * polar.b;
        } else if (map_present(MAP_NORMAL)) {
            frame_coords = map_coords(MAP_NORMAL, c);
        }
        anisotropy = length(direction);
        direction = anisotropy == 0.0 ? vec2(1.0, 0.0) : direction / anisotropy;
        anisotropy = clamp(anisotropy, 0.0, 1.0);
        mat3 tbn = surface_frame(frame_coords, n, geometry_normal, position_dx, position_dy, face);
        lobe.anisotropic = true;
        lobe.alpha_t = mix(roughness * roughness, 1.0, anisotropy * anisotropy);
        lobe.t = tbn[0] * direction.x + tbn[1] * direction.y;
        lobe.b = tbn[1] * direction.x - tbn[0] * direction.y;
    }

    vec3 ambient = mix(frame.ground.rgb, frame.sky.rgb, n.y * 0.5 + 0.5) + probe_irradiance(n) + baked;
    vec3 direct = vec3(0.0);
    vec3 highlight = vec3(0.0);
    vec3 clearcoat_direct = vec3(0.0);
    vec3 sheen_direct = vec3(0.0);
    int count = min(int(frame.camera_position.w), 16);
    Lobe coat_lobe = plain_lobe();

    for (int i = 0; i < 16; i++) {
        if (i >= count) {
            break;
        }
        Light light = frame.lights[i];
        if (light.position.w > 2.5) {
            if (!standard) {
                continue;
            }
            vec3 center = light.position.xyz;
            vec3 half_width = light.direction.xyz;
            vec3 half_height = vec3(light.cone.x, light.cone.y, light.cone.w);
            vec3 c0 = center + half_width - half_height;
            vec3 c1 = center - half_width - half_height;
            vec3 c2 = center - half_width + half_height;
            vec3 c3 = center + half_width + half_height;
            float form = rect_form_factor(n, v, v_world, c0, c1, c2, c3);
            if (form <= 0.0) {
                continue;
            }
            vec3 point = rect_closest_point(v_world, reflect(-v, n), center, half_width, half_height);
            vec3 to_point = point - v_world;
            float distance = max(length(to_point), 1e-4);
            vec3 l = to_point / distance;
            float radius = sqrt(4.0 * length(half_width) * length(half_height) / PI);
            float area_alpha = clamp(roughness * roughness + radius / (2.0 * distance), 0.0, 1.0);
            float v_h = clamp(dot(v, normalize(l + v)), 0.0, 1.0);
            direct += light.color.rgb * form * PI * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += light.color.rgb * form * PI * specular_ggx(n, l, v, f0, f90, sqrt(area_alpha), lobe);
            if (has_clearcoat) {
                float coat_alpha = clamp(clearcoat_roughness * clearcoat_roughness + radius / (2.0 * distance), 0.0, 1.0);
                clearcoat_direct += light.color.rgb * rect_form_factor(clearcoat_normal, v, v_world, c0, c1, c2, c3) * PI * specular_ggx(clearcoat_normal, l, v, vec3(0.04), 1.0, sqrt(coat_alpha), coat_lobe);
            }
            continue;
        }
        vec3 l = light.direction.xyz;
        float strength = 1.0;
        if (light.position.w > 0.5) {
            vec3 to_light = light.position.xyz - v_world;
            float dist = length(to_light);
            l = to_light / max(dist, 0.000001);
            strength = falloff(dist, light.direction.w, light.color.w);
            if (light.position.w > 1.5) {
                strength *= smoothstep(light.cone.x, light.cone.y, dot(l, light.direction.xyz));
            }
        }
        int shadow_index = int(light.cone.z + 0.5);
        if (shadow_index > 0 && (object_flags & 4u) != 0u) {
            int layer = shadow_index - 1;
            if (light.position.w > 0.5 && light.position.w < 1.5) {
                vec3 biased = v_world + geometry_normal * frame.shadows[layer].params.y;
                layer += cube_face(biased - light.position.xyz);
            }
            strength *= shadowed(layer, v_world, geometry_normal, gl_FragCoord.xy);
        }

        float n_l = dot(n, l);
        vec3 irradiance = max(n_l, 0.0) * strength * light.color.rgb;
        if (toon) {
            float coord = n_l * 0.5 + 0.5;
            if (map_present(MAP_GRADIENT)) {
                int slot = int(material.maps[2 * MAP_GRADIENT].w + 0.5) - 1;
                float tone = slot_sample(slot, vec2(coord, 0.0), vec2(0.0), vec2(0.0)).r;
                irradiance = vec3(tone) * strength * light.color.rgb;
            } else {
                float fw = 0.25 * (abs(dot(n_dx, l)) + abs(dot(n_dy, l)));
                irradiance = mix(vec3(0.7), vec3(1.0), smoothstep(0.7 - fw, 0.7 + fw, coord)) * strength * light.color.rgb;
            }
        }
        if (standard) {
            if (has_sheen) {
                sheen_direct += irradiance * sheen_brdf(n, l, v, sheen_color, sheen_roughness);
                irradiance *= 1.0 - sheen_peak * max(sheen_albedo_v, sheen_albedo(clamp(n_l, 0.0, 1.0), sheen_roughness));
            }
            if (has_clearcoat) {
                vec3 coat_irradiance = clamp(dot(clearcoat_normal, l), 0.0, 1.0) * strength * light.color.rgb;
                clearcoat_direct += coat_irradiance * specular_ggx(clearcoat_normal, l, v, vec3(0.04), 1.0, clearcoat_roughness, coat_lobe);
            }
            float v_h = clamp(dot(v, normalize(l + v)), 0.0, 1.0);
            direct += irradiance * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += irradiance * specular_ggx(n, l, v, f0, f90, roughness, lobe);
        } else {
            direct += irradiance;
        }
        if (phong) {
            vec3 h = normalize(l + v);
            float v_h = clamp(dot(v, h), 0.0, 1.0);
            vec3 f = fresnel(material.specular.rgb, 1.0, v_h);
            float distribution = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(clamp(dot(n, h), 0.0, 1.0), shininess);
            highlight += irradiance * f * (0.25 * distribution * specular_strength);
        }
    }

    vec3 lit = (direct + ambient * occlusion) * base * RECIPROCAL_PI + highlight;
    if (standard) {
        vec2 fab = dfg(n_v, roughness);
        vec3 dielectric_single;
        vec3 dielectric_multiple;
        vec3 metallic_single;
        vec3 metallic_multiple;
        scattering(iridescence_f0_dielectric, f90, fab, dielectric_single, dielectric_multiple);
        scattering(iridescence_f0_metallic, f90, fab, metallic_single, metallic_multiple);
        vec3 single = mix(dielectric_single, metallic_single, metalness);
        vec3 multiple = mix(dielectric_multiple, metallic_multiple, metalness);
        vec3 diffuse_color = base * (1.0 - metalness) * (1.0 - (dielectric_single + dielectric_multiple));
        vec3 compensation = 1.0 + f0 * (1.0 / (fab.x + fab.y) - 1.0);
        vec3 diffuse_layer = base * (1.0 - metalness);
        float sheen_pass = has_sheen ? 1.0 - sheen_peak * sheen_albedo_v : 1.0;
        vec3 sheen_indirect = ambient * sheen_color * (sheen_albedo_v * RECIPROCAL_PI);
        vec3 clearcoat_indirect = vec3(0.0);
        vec3 diffuse_total = direct * diffuse_layer * RECIPROCAL_PI + ambient * diffuse_color * RECIPROCAL_PI * occlusion * sheen_pass;
        vec3 specular_total = highlight * compensation;
        if ((flags & 65536u) != 0u && frame.environment.x > 0.0) {
            float intensity = material.environment.x;
            float r2 = roughness * roughness;
            vec3 bent = n;
            if (lobe.anisotropic) {
                vec3 across = normalize(cross(cross(lobe.b, v), lobe.b));
                float k = 1.0 - anisotropy * (1.0 - roughness);
                bent = normalize(mix(across, n, k * k * k * k));
            }
            vec3 reflected = normalize(mix(reflect(-v, bent), bent, r2 * r2));
            vec3 radiance = environment_sample(reflected, roughness) * intensity;
            vec3 env_irradiance = environment_sample(n, 1.0) * intensity;
            float specular_occlusion = clamp(occlusion - (1.0 - pow(n_v + occlusion, exp2(-16.0 * roughness - 1.0))), 0.0, 1.0);
            specular_total += (radiance * single + multiple * env_irradiance) * specular_occlusion * sheen_pass;
            diffuse_total += diffuse_color * env_irradiance * occlusion * sheen_pass;
            sheen_indirect += env_irradiance * sheen_color * sheen_albedo_v;
            if (has_clearcoat) {
                float c2 = clearcoat_roughness * clearcoat_roughness;
                vec3 coat_reflected = normalize(mix(reflect(-v, clearcoat_normal), clearcoat_normal, c2 * c2));
                vec2 coat_fab = dfg(clamp(dot(clearcoat_normal, v), 0.0, 1.0), clearcoat_roughness);
                clearcoat_indirect = environment_sample(coat_reflected, clearcoat_roughness) * intensity * (0.04 * coat_fab.x + coat_fab.y);
            }
        }
        if ((flags & 524288u) != 0u) {
            float transmission = material.transmission.x;
            if (map_present(MAP_TRANSMISSION)) {
                transmission *= map_sample(MAP_TRANSMISSION, c).r;
            }
            float thickness = material.transmission.y;
            if (map_present(MAP_THICKNESS)) {
                thickness *= map_sample(MAP_THICKNESS, c).g;
            }
            float ior = material.layers.w;
            vec3 model_scale = vec3(length(object.model[0].xyz), length(object.model[1].xyz), length(object.model[2].xyz));
            float half_spread = (ior - 1.0) * 0.025 * material.transmission.w;
            vec3 iors = vec3(ior - half_spread, ior, ior + half_spread);
            vec3 transmitted = vec3(0.0);
            vec3 transmittance = vec3(0.0);
            float transmitted_alpha = 0.0;
            int channels = material.transmission.w > 0.0 ? 3 : 1;
            for (int k = 0; k < 3; k++) {
                if (k >= channels) {
                    break;
                }
                float channel_ior = channels == 3 ? iors[k] : ior;
                vec3 ray = normalize(refract(-v, n, 1.0 / channel_ior)) * thickness * model_scale;
                vec4 exit = frame.view_projection * vec4(v_world + ray, 1.0);
                vec2 ndc = exit.xy / exit.w;
                vec2 uv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
                float lod = min(log2(1.0 / frame.transmission.x) * roughness * clamp(channel_ior * 2.0 - 2.0, 0.0, 1.0), frame.transmission.z - 1.0);
                vec4 sampled = textureLod(transmission_map, uv, lod);
                vec3 attenuation = vec3(1.0);
                if (material.transmission.z > 0.0) {
                    attenuation = exp(log(max(material.attenuation.rgb, vec3(1e-6))) / material.transmission.z * length(ray));
                }
                vec3 through = diffuse_layer * attenuation;
                if (channels == 3) {
                    transmitted[k] = sampled[k];
                    transmittance[k] = through[k];
                } else {
                    transmitted = sampled.rgb;
                    transmittance = through;
                }
                transmitted_alpha += sampled.a;
            }
            transmitted_alpha /= float(channels);
            vec3 environment_f = f0 * fab.x + f90 * fab.y;
            vec3 refracted = (1.0 - environment_f) * transmittance * transmitted;
            float factor = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
            diffuse_total = mix(diffuse_total, refracted, transmission);
            alpha *= mix(1.0, 1.0 - (1.0 - transmitted_alpha) * factor, transmission);
        }
        lit = diffuse_total + specular_total;
        if (has_clearcoat) {
            float coat_fresnel = schlick(0.04, clamp(dot(clearcoat_normal, v), 0.0, 1.0));
            lit = lit * (1.0 - clearcoat * coat_fresnel) + (clearcoat_direct + clearcoat_indirect * occlusion) * clearcoat;
        }
        if (has_sheen) {
            lit += sheen_direct + sheen_indirect * occlusion;
        }
    }
    lit += emissive;
    return finish(fogged(lit, v_depth), alpha);
}

void main() {
    out_color = shade();
#ifdef OUTPUT_SRGB
    out_color.rgb = linear_to_srgb(out_color.rgb);
#endif
}
"#;

pub const SHADOW_VERTEX: &str = r#"
uniform mat4 shadow_view_projection;

out vec2 v_uv;
out vec2 v_uv1;

void main() {
    vec3 position = a_position;
    vec3 normal = a_normal;
    if (object.params.y > 0.5) {
        mat4 skin = skin_matrix();
        position = (skin * vec4(position, 1.0)).xyz;
        normal = (skin * vec4(normal, 0.0)).xyz;
    }
    position = displaced(position, normal);
    mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
    gl_Position = shadow_view_projection * (object.model * (instance * vec4(position, 1.0)));
    gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
    v_uv = a_uv;
    v_uv1 = a_uv1;
}
"#;

/// The shadow fragment stage: nothing to write, an alpha test with `ALPHA_TEST` defined.
pub const SHADOW_FRAGMENT: &str = r#"
in vec2 v_uv;
in vec2 v_uv1;

void main() {
#ifdef ALPHA_TEST
    Coords c = Coords(v_uv, v_uv1, dFdx(v_uv), dFdy(v_uv), dFdx(v_uv1), dFdy(v_uv1));
    float coverage = material.color.a;
    if (map_present(MAP_COLOR)) {
        coverage *= map_sample(MAP_COLOR, c).a;
    }
    if (map_present(MAP_ALPHA)) {
        coverage *= map_sample(MAP_ALPHA, c).r;
    }
    if (coverage <= material.surface.w) {
        discard;
    }
#endif
}
"#;

/// The VSM blur passes (see `VSM_SHADER`): `vsm.vertical` reads a layer of the depth
/// array, `vsm.horizontal` the moments it wrote.
pub const VSM_FRAGMENT: &str = r#"
// radius in texels, taps, layer, 0
uniform vec4 settings;
uniform highp sampler2DArray depth_layers;
uniform highp sampler2D moments;

layout(location = 0) out vec4 out_color;

float tap(float i, float samples) {
    return samples <= 1.0 ? 0.0 : -1.0 + i * 2.0 / (samples - 1.0);
}

void main() {
    float samples = max(settings.y, 1.0);
    float mean = 0.0;
    float squared = 0.0;
    for (int k = 0; k < 64; k++) {
        float i = float(k);
        if (i >= samples) {
            break;
        }
#ifdef VERTICAL
        ivec3 size = textureSize(depth_layers, 0);
        ivec2 at = clamp(ivec2(gl_FragCoord.xy + vec2(0.0, tap(i, samples) * settings.x)), ivec2(0), size.xy - 1);
        float d = texelFetch(depth_layers, ivec3(at, int(settings.z + 0.5)), 0).r;
        mean += d;
        squared += d * d;
#else
        ivec2 size = textureSize(moments, 0);
        ivec2 at = clamp(ivec2(gl_FragCoord.xy + vec2(tap(i, samples) * settings.x, 0.0)), ivec2(0), size - 1);
        vec2 m = texelFetch(moments, at, 0).xy;
        mean += m.x;
        squared += m.y * m.y + m.x * m.x;
#endif
    }
    mean /= samples;
    squared /= samples;
    out_color = vec4(mean, sqrt(max(0.0, squared - mean * mean)), 0.0, 1.0);
}
"#;
