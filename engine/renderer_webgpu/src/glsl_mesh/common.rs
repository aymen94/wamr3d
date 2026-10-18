//! The blocks, texture slots and map sampling, skinning and displacement shared by the stages.

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
    vec4 clip;
    vec4 clip_planes[8];
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
    vec4 maps[50];
    vec4 blend;
    vec4 state;
    vec4 stencil;
    vec4 extra;
    vec4 dash;
    vec4 depth_params;
    vec4 clip_planes[8];
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
#define MAP_MATCAP 24

// Whether a world position is behind any of the material's clipping planes (all of
// them with clip intersection).
bool clipped_by_material(vec3 p) {
    int local = int(material.extra.y + 0.5);
    if (local == 0) {
        return false;
    }
    bool intersection = (uint(material.extra.x) & 16u) != 0u;
    bool all_behind = true;
    for (int i = 0; i < 8; i++) {
        if (i >= local) {
            break;
        }
        vec4 plane = material.clip_planes[i];
        bool behind = dot(plane.xyz, p) + plane.w < 0.0;
        if (behind && !intersection) {
            return true;
        }
        all_behind = all_behind && behind;
    }
    return intersection && all_behind;
}

// Behind any of the renderer's global planes, or clipped by the material's.
bool clipped(vec3 p) {
    int global_count = int(frame.clip.x + 0.5);
    for (int i = 0; i < 8; i++) {
        if (i >= global_count) {
            break;
        }
        vec4 plane = frame.clip_planes[i];
        if (dot(plane.xyz, p) + plane.w < 0.0) {
            return true;
        }
    }
    return clipped_by_material(p);
}

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
layout(location = 15) in float a_line_distance;

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
