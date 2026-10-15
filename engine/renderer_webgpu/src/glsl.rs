//! GLSL ES 3.00 versions of the passes, for hosts that draw with WebGL 2. They read the
//! same frame data as the WGSL in `shaders.rs`: the uniform blocks follow std140, whose
//! layout matches the WGSL structs float for float.
//!
//! Differences that come from WebGL itself: clip-space depth is -1..1, so the vertex
//! stages remap the frame's 0..1 depth; framebuffers and textures run bottom row first,
//! so shadow maps need no y flip and `dFdy` already follows the convention three.js
//! uses; colour written to the canvas is encoded to sRGB in the shader (`OUTPUT_SRGB`),
//! since the default framebuffer is not an sRGB format.

const HEADER: &str = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DArrayShadow;\n";

const FRAME_BLOCK: &str = r#"
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
    Shadow shadows[4];
    vec4 environment;
    mat3 environment_rotation;
} frame;

layout(std140) uniform ObjectBlock {
    mat4 model;
    mat3 normal_matrix;
    vec4 color;
    vec4 params;
    mat3 uv_transform;
    vec4 sprite;
    vec4 environment;
    vec4 emissive;
    vec4 specular;
} object;
"#;

const MESH_VERTEX: &str = r#"
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec4 a_instance0;
layout(location = 5) in vec4 a_instance1;
layout(location = 6) in vec4 a_instance2;
layout(location = 7) in vec4 a_instance3;
layout(location = 8) in vec3 a_instance_color;

// -1 while drawing into a render target, so that its rows are stored top first, as
// WebGPU stores them and as they are sampled; 1 otherwise.
uniform float flip_y;

out vec3 v_normal;
out vec3 v_world;
out vec2 v_uv;
out vec4 v_color;
out vec3 v_tint;
out float v_depth;

void main() {
    mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
    vec4 world = object.model * (instance * vec4(a_position, 1.0));
    uint flags = uint(object.params.w);
    if ((flags & 8u) != 0u) {
        vec3 origin = object.model[3].xyz;
        vec2 scale = vec2(length(object.model[0].xyz), length(object.model[1].xyz));
        if (frame.camera_up.w > 0.5 && (flags & 16u) != 0u) {
            scale *= dot(origin - frame.camera_position.xyz, frame.camera_forward.xyz);
        }
        vec2 aligned = (a_position.xy - (object.sprite.yz - 0.5)) * scale;
        float c = cos(object.sprite.x);
        float s = sin(object.sprite.x);
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
    vec3 instance_normal = mat3(x, y, z) * (a_normal / vec3(dot(x, x), dot(y, y), dot(z, z)));
    v_normal = object.normal_matrix * instance_normal;
    v_uv = (object.uv_transform * vec3(a_uv, 1.0)).xy;
    v_color = a_color;
    v_tint = a_instance_color;
    v_depth = dot(world.xyz - frame.camera_position.xyz, frame.camera_forward.xyz);
}
"#;

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

vec3 cube_uv_bilinear(sampler2D map, vec3 direction, float mip, vec2 texel, float max_mip) {
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
    uv.y += 4.0 * (exp2(max_mip) - face_size);
    return textureLod(map, uv * texel, 0.0).rgb;
}

vec3 cube_uv_sample(sampler2D map, vec3 direction, float roughness, vec2 texel, float max_mip) {
    float mip = clamp(cube_uv_roughness_to_mip(roughness), -2.0, max_mip);
    float mip_fraction = fract(mip);
    float mip_int = floor(mip);
    vec3 color = cube_uv_bilinear(map, direction, mip_int, texel, max_mip);
    if (mip_fraction != 0.0) {
        color = mix(color, cube_uv_bilinear(map, direction, mip_int + 1.0, texel, max_mip), mip_fraction);
    }
    return color;
}
"#;

const MESH_FRAGMENT: &str = r#"
const float RECIPROCAL_PI = 0.31830988618;

uniform sampler2D map_texture;
uniform sampler2D normal_map;
uniform sampler2D roughness_map;
uniform sampler2D metalness_map;
uniform sampler2D emissive_map;
uniform sampler2D alpha_map;
uniform sampler2D ao_map;
uniform sampler2DArrayShadow shadow_map;
uniform sampler2D environment_map;

in vec3 v_normal;
in vec3 v_world;
in vec2 v_uv;
in vec4 v_color;
in vec3 v_tint;
in float v_depth;

layout(location = 0) out vec4 out_color;

// The prefiltered map is written with y inverted, so directions are flipped before sampling.
vec3 environment_sample(vec3 direction, float roughness) {
    vec3 rotated = frame.environment_rotation * vec3(direction.x, -direction.y, direction.z);
    return cube_uv_sample(environment_map, rotated, roughness, frame.environment.xy, frame.environment.z);
}

float gradient_noise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

// Five comparisons on a Vogel disk turned by per-pixel noise, each bilinearly filtered.
float shadowed(int index, vec3 world, vec3 normal, vec2 pixel) {
    Shadow s = frame.shadows[index];
    vec4 projected = s.transform * vec4(world + normal * s.params.y, 1.0);
    vec3 coord = projected.xyz / projected.w;
    coord.z += s.params.x;
    if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
        return 1.0;
    }
    float phi = gradient_noise(pixel) * 6.28318530718;
    float layer = floor(s.region.z + 0.5);
    float sum = 0.0;
    for (int k = 0; k < 5; k++) {
        float radius = sqrt((float(k) + 0.5) / 5.0);
        float theta = float(k) * 2.399963229728653 + phi;
        vec2 uv = coord.xy + vec2(cos(theta), sin(theta)) * radius * s.params.w;
        sum += texture(shadow_map, vec4(uv * s.region.xy, layer, coord.z));
    }
    return mix(1.0, sum / 5.0, s.params.z);
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

vec3 specular_ggx(vec3 n, vec3 l, vec3 v, vec3 f0, float roughness) {
    float alpha = roughness * roughness;
    float a2 = alpha * alpha;
    vec3 h = normalize(l + v);
    float n_l = clamp(dot(n, l), 0.0, 1.0);
    float n_v = clamp(dot(n, v), 0.0, 1.0);
    float n_h = clamp(dot(n, h), 0.0, 1.0);
    float v_h = clamp(dot(v, h), 0.0, 1.0);
    float fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
    vec3 f = f0 * (1.0 - fresnel) + vec3(fresnel);
    float gv = n_l * sqrt(a2 + (1.0 - a2) * n_v * n_v);
    float gl = n_v * sqrt(a2 + (1.0 - a2) * n_l * n_l);
    float visibility = 0.5 / max(gv + gl, 0.000001);
    float denominator = n_h * n_h * (a2 - 1.0) + 1.0;
    float distribution = RECIPROCAL_PI * a2 / (denominator * denominator);
    return f * (visibility * distribution);
}

void scattering(vec3 f0, vec2 fab, out vec3 single, out vec3 multiple) {
    single = f0 * fab.x + vec3(fab.y);
    float lost = 1.0 - (fab.x + fab.y);
    vec3 average = f0 + (1.0 - f0) * 0.047619;
    multiple = single * average / (1.0 - lost * average) * lost;
}

float schlick(float f0, float v_h) {
    float fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - fresnel) + fresnel;
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

vec4 shade() {
    vec4 texel = texture(map_texture, v_uv);
    vec3 geometry_normal = normalize(v_normal);
    vec3 n = gl_FrontFacing ? geometry_normal : -geometry_normal;
    vec3 n_dx = dFdx(n);
    vec3 n_dy = dFdy(n);
    vec2 uv_dx = dFdx(v_uv);
    vec2 uv_dy = dFdy(v_uv);
    vec3 position_dx = dFdx(v_world);
    vec3 position_dy = dFdy(v_world);
    uint flags = uint(object.params.w);
    vec3 base = object.color.rgb * texel.rgb * v_tint;
    float coverage = object.color.a * texel.a;
    if ((flags & 1u) != 0u) {
        base *= v_color.rgb;
        coverage *= v_color.a;
    }
    if ((flags & 512u) != 0u) {
        coverage *= textureGrad(alpha_map, v_uv, uv_dx, uv_dy).r;
    }
    if (object.sprite.w > 0.0 && coverage <= object.sprite.w) {
        discard;
    }
    float alpha = (flags & 2u) != 0u ? coverage : 1.0;

    if ((flags & 32u) != 0u) {
        vec3 sampled = textureGrad(normal_map, v_uv, uv_dx, uv_dy).xyz * 2.0 - 1.0;
        vec3 map_normal = vec3(sampled.xy * object.environment.zw, sampled.z);
        vec3 q1perp = cross(position_dy, n);
        vec3 q0perp = cross(n, position_dx);
        vec3 t = q1perp * uv_dx.x + q0perp * uv_dy.x;
        vec3 b = q1perp * uv_dx.y + q0perp * uv_dy.y;
        float det = max(dot(t, t), dot(b, b));
        float scale = (det == 0.0 ? 0.0 : inversesqrt(det)) * (gl_FrontFacing ? 1.0 : -1.0);
        n = normalize(mat3(t * scale, b * scale, n) * map_normal);
    }

    uint shading = uint(object.params.z + 0.5);
    if (shading == 1u) {
        return vec4(fogged(base, v_depth), alpha);
    }
    if (shading == 4u) {
        vec3 view_normal = vec3(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return vec4(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    bool standard = shading == 2u;
    bool phong = shading == 3u;
    bool toon = shading == 5u;
    float metalness = object.params.y;
    if ((flags & 128u) != 0u) {
        metalness *= textureGrad(metalness_map, v_uv, uv_dx, uv_dy).b;
    }
    float roughness_factor = object.params.x;
    if ((flags & 64u) != 0u) {
        roughness_factor *= textureGrad(roughness_map, v_uv, uv_dx, uv_dy).g;
    }
    vec3 view_dx = abs(vec3(dot(n_dx, frame.camera_right.xyz), dot(n_dx, frame.camera_up.xyz), dot(n_dx, frame.camera_forward.xyz)));
    vec3 view_dy = abs(vec3(dot(n_dy, frame.camera_right.xyz), dot(n_dy, frame.camera_up.xyz), dot(n_dy, frame.camera_forward.xyz)));
    vec3 geometry_change = max(view_dx, view_dy);
    float geometry_roughness = max(max(geometry_change.x, geometry_change.y), geometry_change.z);
    float roughness = min(max(roughness_factor, 0.0525) + geometry_roughness, 1.0);
    vec3 emissive = object.emissive.rgb;
    if ((flags & 256u) != 0u) {
        emissive *= textureGrad(emissive_map, v_uv, uv_dx, uv_dy).rgb;
    }
    float occlusion = 1.0;
    if ((flags & 1024u) != 0u) {
        occlusion = (textureGrad(ao_map, v_uv, uv_dx, uv_dy).r - 1.0) * object.emissive.w + 1.0;
    }
    vec3 v = normalize(frame.camera_position.xyz - v_world);
    vec3 f0 = mix(vec3(0.04), base, metalness);
    float shininess = max(object.specular.w, 0.0001);

    vec3 ambient = mix(frame.ground.rgb, frame.sky.rgb, n.y * 0.5 + 0.5);
    vec3 direct = vec3(0.0);
    vec3 highlight = vec3(0.0);
    int count = min(int(frame.camera_position.w), 16);

    for (int i = 0; i < 16; i++) {
        if (i >= count) {
            break;
        }
        Light light = frame.lights[i];
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
        if (shadow_index > 0 && (flags & 4u) != 0u) {
            strength *= shadowed(shadow_index - 1, v_world, geometry_normal, gl_FragCoord.xy);
        }

        float n_l = dot(n, l);
        vec3 irradiance = max(n_l, 0.0) * strength * light.color.rgb;
        if (toon) {
            float coord = n_l * 0.5 + 0.5;
            float fw = 0.25 * (abs(dot(n_dx, l)) + abs(dot(n_dy, l)));
            irradiance = mix(vec3(0.7), vec3(1.0), smoothstep(0.7 - fw, 0.7 + fw, coord)) * strength * light.color.rgb;
        }
        if (standard) {
            float v_h = clamp(dot(v, normalize(l + v)), 0.0, 1.0);
            direct += irradiance * (1.0 - schlick(0.04, v_h));
            highlight += irradiance * specular_ggx(n, l, v, f0, roughness);
        } else {
            direct += irradiance;
        }
        if (phong) {
            vec3 h = normalize(l + v);
            float v_h = clamp(dot(v, h), 0.0, 1.0);
            float fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
            vec3 f = object.specular.rgb * (1.0 - fresnel) + vec3(fresnel);
            float distribution = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(clamp(dot(n, h), 0.0, 1.0), shininess);
            highlight += irradiance * f * (0.25 * distribution);
        }
    }

    vec3 lit = (direct + ambient * occlusion) * base * RECIPROCAL_PI + highlight;
    if (standard) {
        float n_v = clamp(dot(n, v), 0.0, 1.0);
        vec2 fab = dfg(n_v, roughness);
        vec3 dielectric_single;
        vec3 dielectric_multiple;
        vec3 metallic_single;
        vec3 metallic_multiple;
        scattering(vec3(0.04), fab, dielectric_single, dielectric_multiple);
        scattering(base, fab, metallic_single, metallic_multiple);
        vec3 single = mix(dielectric_single, metallic_single, metalness);
        vec3 multiple = mix(dielectric_multiple, metallic_multiple, metalness);
        vec3 diffuse_color = base * (1.0 - metalness) * (1.0 - (dielectric_single + dielectric_multiple));
        vec3 compensation = 1.0 + f0 * (1.0 / (fab.x + fab.y) - 1.0);
        vec3 diffuse_layer = base * (1.0 - metalness);
        lit = direct * diffuse_layer * RECIPROCAL_PI + highlight * compensation + ambient * diffuse_color * RECIPROCAL_PI * occlusion;
        if (object.environment.y > 0.5 && frame.environment.x > 0.0) {
            float intensity = object.environment.x;
            float r2 = roughness * roughness;
            vec3 reflected = normalize(mix(reflect(-v, n), n, r2 * r2));
            vec3 radiance = environment_sample(reflected, roughness) * intensity;
            vec3 env_irradiance = environment_sample(n, 1.0) * intensity;
            float specular_occlusion = clamp(occlusion - (1.0 - pow(n_v + occlusion, exp2(-16.0 * roughness - 1.0))), 0.0, 1.0);
            lit += (radiance * single + multiple * env_irradiance) * specular_occlusion + diffuse_color * env_irradiance * occlusion;
        }
    }
    lit += emissive;
    return vec4(fogged(lit, v_depth), alpha);
}

void main() {
    out_color = shade();
#ifdef OUTPUT_SRGB
    out_color.rgb = linear_to_srgb(out_color.rgb);
#endif
}
"#;

const SHADOW_VERTEX: &str = r#"
uniform mat4 shadow_view_projection;

layout(std140) uniform ObjectBlock {
    mat4 model;
} object;

layout(location = 0) in vec3 a_position;
layout(location = 4) in vec4 a_instance0;
layout(location = 5) in vec4 a_instance1;
layout(location = 6) in vec4 a_instance2;
layout(location = 7) in vec4 a_instance3;

void main() {
    mat4 instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
    gl_Position = shadow_view_projection * (object.model * (instance * vec4(a_position, 1.0)));
    gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
}
"#;

const SHADOW_FRAGMENT: &str = r#"
void main() {
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
            color = cube_uv_sample(background_map, flipped, background.params.z, background.environment.xy, background.environment.z);
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

const OUTPUT_FRAGMENT: &str = r#"
// x the tone mapping (a three.js constant), y the exposure
uniform vec4 settings;
uniform sampler2D source;

layout(location = 0) out vec4 out_color;

vec3 agx_contrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 tone_mapped(vec3 color_in) {
    uint kind = uint(settings.x + 0.5);
    if (kind == 0u) {
        return color_in;
    }
    vec3 color = color_in * settings.y;
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

void main() {
    vec4 color = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
    out_color = vec4(linear_to_srgb(tone_mapped(color.rgb)), 1.0);
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
        out_color = vec4(cube_uv_bilinear(source, n, mip, texel, max_mip), 1.0);
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
            color += cube_uv_bilinear(source, l, mip, texel, max_mip) * n_l;
            weight += n_l;
        }
    }
    if (weight > 0.0) {
        color /= weight;
    }
    out_color = vec4(color, 1.0);
}
"#;

/// A GLSL shader by name: `mesh.vert`, `mesh.frag`, `shadow.vert`, `shadow.frag`,
/// `fullscreen.vert`, `background.frag`, `output.frag`, `pmrem.vert`, `pmrem.equirect`,
/// `pmrem.ggx`. Hosts add `#define OUTPUT_SRGB` after the first line of `mesh.frag` and
/// `background.frag` when they draw to the canvas. `None` for an unknown name.
pub fn glsl_source(name: &str) -> Option<String> {
    let source = match name {
        "mesh.vert" => format!("{HEADER}{FRAME_BLOCK}{MESH_VERTEX}"),
        "mesh.frag" => format!("{HEADER}{FRAME_BLOCK}{ENCODE}{CUBE_UV}{}{MESH_FRAGMENT}", crate::dfg::dfg_glsl()),
        "shadow.vert" => format!("{HEADER}{SHADOW_VERTEX}"),
        "shadow.frag" => format!("{HEADER}{SHADOW_FRAGMENT}"),
        "fullscreen.vert" => format!("{HEADER}{FULLSCREEN_VERTEX}"),
        "background.frag" => format!("{HEADER}{ENCODE}{CUBE_UV}{BACKGROUND_FRAGMENT}"),
        "output.frag" => format!("{HEADER}{ENCODE}{OUTPUT_FRAGMENT}"),
        "pmrem.vert" => format!("{HEADER}{PMREM_VERTEX}"),
        "pmrem.equirect" => format!("{HEADER}{PMREM_COMMON}{PMREM_EQUIRECT}"),
        "pmrem.ggx" => format!("{HEADER}{CUBE_UV}{PMREM_COMMON}{PMREM_GGX}"),
        _ => return None,
    };
    Some(source)
}
