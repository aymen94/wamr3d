//! The mesh fragment stage's fog, BRDFs, physical layers, light probes and area lights.

macro_rules! mesh_fragment_lighting {
    () => {
        r#"
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
in float v_line_distance;

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
    // materials with `fog` false keep their colour
    if (kind < 0.5 || (uint(material.extra.x) & 1u) != 0u) {
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

// Hashed alpha testing (Wyman and McGuire, 2017): a threshold from a hash of the
// position, at a scale of about one pixel, stable as the camera moves.
float hash_2d(vec2 v) {
    return fract(1.0e4 * sin(17.0 * v.x + 0.1 * v.y) * (0.1 + abs(sin(13.0 * v.y + v.x))));
}

float hash_3d(vec3 v) {
    return hash_2d(vec2(hash_2d(v.xy), v.z));
}

float alpha_hash_threshold(vec3 position, vec3 position_dx, vec3 position_dy) {
    float max_derivative = max(max(length(position_dx), length(position_dy)), 1e-8);
    float pixel_scale = 1.0 / (0.05 * max_derivative);
    vec2 scales = vec2(exp2(floor(log2(pixel_scale))), exp2(ceil(log2(pixel_scale))));
    vec2 alphas = vec2(hash_3d(floor(scales.x * position)), hash_3d(floor(scales.y * position)));
    float blend = fract(log2(pixel_scale));
    float x = (1.0 - blend) * alphas.x + blend * alphas.y;
    float a = max(min(blend, 1.0 - blend), 1e-6);
    vec3 cases = vec3(x * x / (2.0 * a * (1.0 - a)), (x - 0.5 * a) / (1.0 - a), 1.0 - ((1.0 - x) * (1.0 - x) / (2.0 * a * (1.0 - a))));
    float threshold = x < 1.0 - a ? (x < a ? cases.x : cases.y) : cases.z;
    return clamp(threshold, 1.0e-6, 1.0);
}

// The depth packings of MeshDepthMaterial: 3201 RGBA, 3202 RGB and 3203 RG, eight bits
// per channel; 3200 (basic) is grey, white near.
vec4 pack_depth(float depth, uint packing, float alpha) {
    if (packing == 3200u) {
        return vec4(vec3(1.0 - depth), alpha);
    }
    if (depth <= 0.0) {
        return vec4(0.0);
    }
    if (depth >= 1.0) {
        return vec4(1.0);
    }
    float up = 256.0 / 255.0;
    if (packing == 3203u) {
        return vec4(floor(depth * 256.0) / 255.0, fract(depth * 256.0), 0.0, 1.0);
    }
    if (packing == 3202u) {
        float whole = floor(depth * 65536.0);
        float b = fract(depth * 65536.0);
        float g = fract(whole / 256.0);
        whole = floor(whole / 256.0);
        return vec4(whole / 255.0, g * up, b, 1.0);
    }
    float whole = floor(depth * 16777216.0);
    float a = fract(depth * 16777216.0);
    float b = fract(whole / 256.0);
    whole = floor(whole / 256.0);
    float g = fract(whole / 256.0);
    whole = floor(whole / 256.0);
    return vec4(whole / 255.0, g * up, b * up, a);
}

// The product of the shadow factors of every shadowed light at a point, for
// ShadowMaterial.
float shadow_mask(vec3 world, vec3 normal, vec2 pixel) {
    float mask = 1.0;
    int count = min(int(frame.camera_position.w), 16);
    for (int i = 0; i < 16; i++) {
        if (i >= count) {
            break;
        }
        Light light = frame.lights[i];
        int shadow_index = int(light.cone.z + 0.5);
        if (light.position.w > 2.5 || shadow_index == 0) {
            continue;
        }
        int layer = shadow_index - 1;
        if (light.position.w > 0.5 && light.position.w < 1.5) {
            vec3 biased = world + normal * frame.shadows[layer].params.y;
            layer += cube_face(biased - light.position.xyz);
        }
        mask *= shadowed(layer, world, normal, pixel);
    }
    return mask;
}

vec4 finish(vec3 color_in, float alpha) {
    vec3 color = color_in;
    if ((uint(material.extra.x) & 2u) != 0u) {
        // dithering: noise below one 8-bit step of the encoded colour
        float noise = gradient_noise(gl_FragCoord.xy) - 0.5;
        color = srgb_to_linear(max(linear_to_srgb(max(color, vec3(0.0))) + vec3(noise, -noise, noise) / 255.0, vec3(0.0)));
    }
    if ((uint(material.params.w) & 4194304u) != 0u) {
        return vec4(color * alpha, alpha);
    }
    return vec4(color, alpha);
}

"#
    };
}
