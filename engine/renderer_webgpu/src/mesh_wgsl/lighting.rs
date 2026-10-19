//! The mesh pipeline's fog, BRDFs, physical layers, light probes and area lights.

macro_rules! mesh_lighting {
    () => {
        r#"// The fragment's pixel, for dithering.
var<private> fragment_pixel: vec2<f32>;

fn fogged(color: vec3<f32>, depth: f32) -> vec3<f32> {
    let kind = frame.fog_color.w;
    // materials with `fog` false keep their colour
    if (kind < 0.5 || (u32(material.extra.x) & 1u) != 0u) {
        return color;
    }
    var amount = smoothstep(frame.fog.x, frame.fog.y, depth);
    if (kind > 1.5) {
        amount = 1.0 - exp(-frame.fog.z * frame.fog.z * depth * depth);
    }
    return mix(color, frame.fog_color.rgb, amount);
}

// Schlick's fresnel between f0 head on and f90 at grazing angles.
fn fresnel(f0: vec3<f32>, f90: f32, v_h: f32) -> vec3<f32> {
    let weight = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - weight) + vec3<f32>(f90 * weight);
}

fn schlick(f0: f32, v_h: f32) -> f32 {
    let weight = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - weight) + weight;
}

// The parts of the specular lobe beyond plain GGX: a thin film's fresnel mixed in by
// `iridescence`, and anisotropic roughness (`alpha_t` along `t`, the base roughness
// along `b`) when `anisotropic`.
struct Lobe {
    iridescence: f32,
    iridescence_fresnel: vec3<f32>,
    anisotropic: bool,
    alpha_t: f32,
    t: vec3<f32>,
    b: vec3<f32>,
};

// GGX specular for one light.
fn specular(n: vec3<f32>, l: vec3<f32>, v: vec3<f32>, f0: vec3<f32>, f90: f32, roughness: f32, lobe: Lobe) -> vec3<f32> {
    let alpha = roughness * roughness;
    let a2 = alpha * alpha;
    let h = normalize(l + v);
    let n_l = saturate(dot(n, l));
    let n_v = saturate(dot(n, v));
    let n_h = saturate(dot(n, h));
    let v_h = saturate(dot(v, h));

    let f = mix(fresnel(f0, f90, v_h), lobe.iridescence_fresnel, lobe.iridescence);
    if (lobe.anisotropic) {
        let t_l = dot(lobe.t, l);
        let t_v = dot(lobe.t, v);
        let t_h = dot(lobe.t, h);
        let b_l = dot(lobe.b, l);
        let b_v = dot(lobe.b, v);
        let b_h = dot(lobe.b, h);
        let gv = n_l * length(vec3<f32>(lobe.alpha_t * t_v, alpha * b_v, n_v));
        let gl = n_v * length(vec3<f32>(lobe.alpha_t * t_l, alpha * b_l, n_l));
        let visibility = 0.5 / max(gv + gl, 0.000001);
        let ab = lobe.alpha_t * alpha;
        let w = vec3<f32>(alpha * t_h, lobe.alpha_t * b_h, ab * n_h);
        let w2 = ab / dot(w, w);
        return f * (visibility * RECIPROCAL_PI * ab * w2 * w2);
    }
    let gv = n_l * sqrt(a2 + (1.0 - a2) * n_v * n_v);
    let gl = n_v * sqrt(a2 + (1.0 - a2) * n_l * n_l);
    let visibility = 0.5 / max(gv + gl, 0.000001);
    let denominator = n_h * n_h * (a2 - 1.0) + 1.0;
    let distribution = RECIPROCAL_PI * a2 / (denominator * denominator);
    return f * (visibility * distribution);
}

fn plain_lobe() -> Lobe {
    var lobe: Lobe;
    lobe.iridescence = 0.0;
    lobe.iridescence_fresnel = vec3<f32>(0.0);
    lobe.anisotropic = false;
    lobe.alpha_t = 0.0;
    lobe.t = vec3<f32>(1.0, 0.0, 0.0);
    lobe.b = vec3<f32>(0.0, 1.0, 0.0);
    return lobe;
}

// Light reflected once (x) and more than once (y) by the specular lobe for reflectance
// f0 and f90, from the split-sum terms `fab` (Fdez-Aguera's multiple scattering, as three.js).
fn scattering(f0: vec3<f32>, f90: f32, fab: vec2<f32>) -> array<vec3<f32>, 2> {
    let single = f0 * fab.x + vec3<f32>(f90 * fab.y);
    let lost = 1.0 - (fab.x + fab.y);
    let average = f0 + (1.0 - f0) * 0.047619;
    return array<vec3<f32>, 2>(single, single * average / (1.0 - lost * average) * lost);
}

// The sheen lobe for one light: Charlie distribution, Neubelt visibility.
fn sheen_brdf(n: vec3<f32>, l: vec3<f32>, v: vec3<f32>, color: vec3<f32>, roughness: f32) -> vec3<f32> {
    let h = normalize(l + v);
    let n_l = saturate(dot(n, l));
    let n_v = saturate(dot(n, v));
    let n_h = saturate(dot(n, h));
    let inverse_alpha = 1.0 / (roughness * roughness);
    let sin2h = max(1.0 - n_h * n_h, 0.0078125);
    let distribution = (2.0 + inverse_alpha) * pow(sin2h, inverse_alpha * 0.5) * (0.5 * RECIPROCAL_PI);
    let visibility = saturate(1.0 / (4.0 * (n_l + n_v - n_l * n_v)));
    return color * (distribution * visibility);
}

// Directional albedo of the sheen lobe (three.js IBLSheenBRDF).
fn sheen_albedo(cos_theta: f32, roughness: f32) -> f32 {
    let r2 = roughness * roughness;
    let r_inverse = 1.0 / (roughness + 0.1);
    let a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * r_inverse;
    let b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * r_inverse;
    return saturate(exp(a * cos_theta + b));
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

// three.js `SRGBColorSpace` to the linear working colour space.
fn srgb_to_linear(color: vec3<f32>) -> vec3<f32> {
    return select(pow(color * 0.9478672986 + 0.0521327014, vec3<f32>(2.4)), color * 0.0773993808, color <= vec3<f32>(0.04045));
}

fn linear_to_srgb(color: vec3<f32>) -> vec3<f32> {
    return select(pow(color, vec3<f32>(0.41666)) * 1.055 - 0.055, color * 12.92, color <= vec3<f32>(0.0031308));
}

// Hashed alpha testing (Wyman and McGuire, 2017): a threshold from a hash of the
// position, at a scale of about one pixel, stable as the camera moves.
fn hash_2d(v: vec2<f32>) -> f32 {
    return fract(1.0e4 * sin(17.0 * v.x + 0.1 * v.y) * (0.1 + abs(sin(13.0 * v.y + v.x))));
}

fn hash_3d(v: vec3<f32>) -> f32 {
    return hash_2d(vec2<f32>(hash_2d(v.xy), v.z));
}

fn alpha_hash_threshold(position: vec3<f32>, position_dx: vec3<f32>, position_dy: vec3<f32>) -> f32 {
    let max_derivative = max(max(length(position_dx), length(position_dy)), 1e-8);
    let pixel_scale = 1.0 / (0.05 * max_derivative);
    let scales = vec2<f32>(exp2(floor(log2(pixel_scale))), exp2(ceil(log2(pixel_scale))));
    let alphas = vec2<f32>(hash_3d(floor(scales.x * position)), hash_3d(floor(scales.y * position)));
    let blend = fract(log2(pixel_scale));
    let x = (1.0 - blend) * alphas.x + blend * alphas.y;
    let a = max(min(blend, 1.0 - blend), 1e-6);
    let cases = vec3<f32>(x * x / (2.0 * a * (1.0 - a)), (x - 0.5 * a) / (1.0 - a), 1.0 - ((1.0 - x) * (1.0 - x) / (2.0 * a * (1.0 - a))));
    let threshold = select(cases.z, select(cases.y, cases.x, x < a), x < 1.0 - a);
    return clamp(threshold, 1.0e-6, 1.0);
}

// three.js's depth packings: 3201 RGBA, 3202 RGB and 3203 RG, eight bits per channel;
// 3200 (basic) is grey, white near.
fn pack_depth(depth: f32, packing: u32, alpha: f32) -> vec4<f32> {
    if (packing == 3200u) {
        return vec4<f32>(vec3<f32>(1.0 - depth), alpha);
    }
    if (depth <= 0.0) {
        return vec4<f32>(0.0);
    }
    if (depth >= 1.0) {
        return vec4<f32>(1.0);
    }
    let up = 256.0 / 255.0;
    if (packing == 3203u) {
        let g = fract(depth * 256.0);
        return vec4<f32>(floor(depth * 256.0) / 255.0, g, 0.0, 1.0);
    }
    if (packing == 3202u) {
        var whole = floor(depth * 65536.0);
        let b = fract(depth * 65536.0);
        let g = fract(whole / 256.0);
        whole = floor(whole / 256.0);
        return vec4<f32>(whole / 255.0, g * up, b, 1.0);
    }
    var whole = floor(depth * 16777216.0);
    let a = fract(depth * 16777216.0);
    let b = fract(whole / 256.0);
    whole = floor(whole / 256.0);
    let g = fract(whole / 256.0);
    whole = floor(whole / 256.0);
    return vec4<f32>(whole / 255.0, g * up, b * up, a);
}

// A tangent frame from screen-space derivatives (three.js without a tangent attribute):
// q0, q1 the position's changes and st0, st1 the map's along x and y, both with y up.
fn derivative_frame(n: vec3<f32>, q0: vec3<f32>, q1: vec3<f32>, st0: vec2<f32>, st1: vec2<f32>, face: f32) -> mat3x3<f32> {
    let q1perp = cross(q1, n);
    let q0perp = cross(n, q0);
    let t = q1perp * st0.x + q0perp * st1.x;
    let b = q1perp * st0.y + q0perp * st1.y;
    let det = max(dot(t, t), dot(b, b));
    let scale = select(inverseSqrt(det), 0.0, det == 0.0) * face;
    return mat3x3<f32>(t * scale, b * scale, n);
}

// The frame a map's tangent-space normals are read in: the vertex tangent's when the
// geometry has one, else the map's screen-space derivatives. three.js follows GL, whose
// y runs up, hence the negated dpdy.
fn surface_frame(m: MapCoords, n: vec3<f32>, geometry_normal: vec3<f32>, tangent: vec4<f32>, position_dx: vec3<f32>, position_dy: vec3<f32>, face: f32) -> mat3x3<f32> {
    if (abs(tangent.w) > 0.5) {
        let t = normalize(tangent.xyz);
        let b = normalize(cross(geometry_normal, t) * tangent.w);
        return mat3x3<f32>(t * face, b * face, n);
    }
    return derivative_frame(n, position_dx, -position_dy, m.dx, -m.dy, face);
}

fn iridescence_sensitivity(opd: f32, shift: vec3<f32>) -> vec3<f32> {
    let phase = 2.0 * PI * opd * 1.0e-9;
    let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
    let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
    let spread = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
    var xyz = val * sqrt(2.0 * PI * spread) * cos(pos * phase + shift) * exp(-phase * phase * spread);
    xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
    xyz /= 1.0685e-7;
    let xyz_to_rec709 = mat3x3<f32>(vec3<f32>(3.2404542, -0.9692660, 0.0556434), vec3<f32>(-1.5371385, 1.8760108, -0.2040259), vec3<f32>(-0.4985314, 0.0415560, 1.0572252));
    return xyz_to_rec709 * xyz;
}

// Reflectance of a thin film over a base of reflectance `base_f0` (Belcour and Barla's
// airy summation, as three.js evaluates it).
fn iridescence_fresnel(outside_ior: f32, eta2: f32, cos_theta1: f32, thickness: f32, base_f0: vec3<f32>) -> vec3<f32> {
    let ior = mix(outside_ior, eta2, smoothstep(0.0, 0.03, thickness));
    let sin2 = (outside_ior / ior) * (outside_ior / ior) * (1.0 - cos_theta1 * cos_theta1);
    let cos2_sq = 1.0 - sin2;
    if (cos2_sq < 0.0) {
        return vec3<f32>(1.0);
    }
    let cos_theta2 = sqrt(cos2_sq);
    let r0 = ((ior - outside_ior) / (ior + outside_ior)) * ((ior - outside_ior) / (ior + outside_ior));
    let r12 = schlick(r0, cos_theta1);
    let t121 = 1.0 - r12;
    let phi12 = select(0.0, PI, ior < outside_ior);
    let phi21 = PI - phi12;
    let sqrt_f0 = sqrt(clamp(base_f0, vec3<f32>(0.0), vec3<f32>(0.9999)));
    let base_ior = (1.0 + sqrt_f0) / (1.0 - sqrt_f0);
    let r1 = ((base_ior - ior) / (base_ior + ior)) * ((base_ior - ior) / (base_ior + ior));
    let r23 = fresnel(r1, 1.0, cos_theta2);
    let phi23 = select(vec3<f32>(0.0), vec3<f32>(PI), base_ior < vec3<f32>(ior));
    let opd = 2.0 * ior * thickness * cos_theta2;
    let phi = vec3<f32>(phi21) + phi23;
    let r123 = clamp(r12 * r23, vec3<f32>(1e-5), vec3<f32>(0.9999));
    let sqrt_r123 = sqrt(r123);
    let rs = t121 * t121 * r23 / (1.0 - r123);
    var result = r12 + rs;
    var cm = rs - t121;
    for (var m = 1; m <= 2; m++) {
        cm *= sqrt_r123;
        result += cm * 2.0 * iridescence_sensitivity(f32(m) * opd, f32(m) * phi);
    }
    return max(result, vec3<f32>(0.0));
}

fn schlick_to_f0(f: vec3<f32>, f90: f32, v_h: f32) -> vec3<f32> {
    let x = saturate(1.0 - v_h);
    let x2 = x * x;
    let x5 = clamp(x * x2 * x2, 0.0, 0.9999);
    return (f - vec3<f32>(f90) * x5) / (1.0 - x5);
}

// Irradiance from the light probe's spherical harmonics (three.js shGetIrradianceAt).
fn probe_irradiance(n: vec3<f32>) -> vec3<f32> {
    let p = frame.probe;
    var result = p[0].rgb * 0.886227;
    result += p[1].rgb * 2.0 * 0.511664 * n.y;
    result += p[2].rgb * 2.0 * 0.511664 * n.z;
    result += p[3].rgb * 2.0 * 0.511664 * n.x;
    result += p[4].rgb * 2.0 * 0.429043 * n.x * n.y;
    result += p[5].rgb * 2.0 * 0.429043 * n.y * n.z;
    result += p[6].rgb * (0.743125 * n.z * n.z - 0.247708);
    result += p[7].rgb * 2.0 * 0.429043 * n.x * n.z;
    result += p[8].rgb * 0.429043 * (n.x * n.x - n.y * n.y);
    return result;
}

fn edge_form_factor(v1: vec3<f32>, v2: vec3<f32>) -> vec3<f32> {
    let x = dot(v1, v2);
    let y = abs(x);
    let a = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
    let b = 3.4175940 + (4.1616724 + y) * y;
    let v = a / b;
    let theta_sintheta = select(0.5 * inverseSqrt(max(1.0 - x * x, 1e-7)) - v, v, x > 0.0);
    return cross(v1, v2) * theta_sintheta;
}

// The cosine-weighted share of the hemisphere above `p` (normal `n`) that a rectangle
// covers, over pi: three.js's LTC evaluation with the identity transform, which is exact
// for diffuse light. 0 behind the light.
fn rect_form_factor(n: vec3<f32>, v: vec3<f32>, p: vec3<f32>, corners: array<vec3<f32>, 4>) -> f32 {
    let light_normal = cross(corners[1] - corners[0], corners[3] - corners[0]);
    if (dot(light_normal, p - corners[0]) < 0.0) {
        return 0.0;
    }
    var t1 = v - n * dot(v, n);
    if (dot(t1, t1) < 1e-8) {
        // looking straight down the normal: any direction across it will do
        t1 = cross(n, select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9));
    }
    t1 = normalize(t1);
    let t2 = -cross(n, t1);
    let basis = transpose(mat3x3<f32>(t1, t2, n));
    let c0 = normalize(basis * (corners[0] - p));
    let c1 = normalize(basis * (corners[1] - p));
    let c2 = normalize(basis * (corners[2] - p));
    let c3 = normalize(basis * (corners[3] - p));
    let f = edge_form_factor(c0, c1) + edge_form_factor(c1, c2) + edge_form_factor(c2, c3) + edge_form_factor(c3, c0);
    let l = length(f);
    return max((l * l + f.z) / (l + 1.0), 0.0);
}

// The point of a rectangle (centre, half axes) closest to the ray from `p` along `r`:
// the representative point that stands in for the whole light in the specular lobe.
fn rect_closest_point(p: vec3<f32>, r: vec3<f32>, center: vec3<f32>, half_width: vec3<f32>, half_height: vec3<f32>) -> vec3<f32> {
    let normal = normalize(cross(half_width, half_height));
    let denominator = dot(r, normal);
    var hit = center;
    if (abs(denominator) > 1e-6) {
        let t = dot(center - p, normal) / denominator;
        hit = p + r * max(t, 0.0);
    }
    let offset = hit - center;
    let w2 = max(dot(half_width, half_width), 1e-8);
    let h2 = max(dot(half_height, half_height), 1e-8);
    let u = clamp(dot(offset, half_width) / w2, -1.0, 1.0);
    let w = clamp(dot(offset, half_height) / h2, -1.0, 1.0);
    return center + half_width * u + half_height * w;
}

fn finish(color_in: vec3<f32>, alpha: f32) -> vec4<f32> {
    var color = color_in;
    if ((u32(material.extra.x) & 2u) != 0u) {
        // dithering: noise below one 8-bit step of the encoded colour, as three.js adds
        let noise = gradient_noise(fragment_pixel) - 0.5;
        color = srgb_to_linear(max(linear_to_srgb(max(color, vec3<f32>(0.0))) + vec3<f32>(noise, -noise, noise) / 255.0, vec3<f32>(0.0)));
    }
    if ((u32(material.params.w) & 4194304u) != 0u) {
        return vec4<f32>(color * alpha, alpha);
    }
    return vec4<f32>(color, alpha);
}

// The product of the shadow factors of every shadowed light at a point (three.js
// `getShadowMask`), for ShadowMaterial.
fn shadow_mask(world: vec3<f32>, normal: vec3<f32>, pixel: vec2<f32>) -> f32 {
    var mask = 1.0;
    if ((LIGHT_FEATURES & 1u) == 0u) {
        return mask;
    }
    let count = min(u32(frame.camera_position.w), 16u);
    for (var i = 0u; i < count; i++) {
        let light = frame.lights[i];
        let shadow_index = u32(light.cone.z + 0.5);
        if (light.position.w > 2.5 || shadow_index == 0u) {
            continue;
        }
        var layer = shadow_index - 1u;
        if (light.position.w > 0.5 && light.position.w < 1.5) {
            let biased = world + normal * frame.shadows[layer].params.y;
            layer += cube_face(biased - light.position.xyz);
        }
        mask *= shadowed(layer, world, normal, pixel);
    }
    return mask;
}

"#
    };
}
