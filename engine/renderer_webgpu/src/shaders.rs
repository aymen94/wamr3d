//! WGSL of the passes: the mesh pipeline, shadows, prefiltering, background and output.

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
    // roughness, metalness, shading (0 diffuse, 1 unlit, 2 standard, 3 phong, 4 normal, 5 toon),
    // flags (1 vertex colours, 2 blended, 4 receives shadows, 8 sprite, 16 sprite of fixed
    // size; maps present: 32 normal, 64 roughness, 128 metalness, 256 emissive, 512 alpha,
    // 1024 ambient occlusion)
    params: vec4<f32>,
    uv_transform: mat3x3<f32>,
    // sprites: rotation, centre x and y; w the alpha test (0 for none)
    sprite: vec4<f32>,
    // environment intensity, 1 when lit by the environment, normal-map scale (zw)
    environment: vec4<f32>,
    // emissive colour times intensity; w the ambient-occlusion intensity
    emissive: vec4<f32>,
    // phong: specular colour, shininess in w
    specular: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(2) @binding(0) var map_texture: texture_2d<f32>;
@group(2) @binding(1) var map_sampler: sampler;
@group(2) @binding(2) var normal_map: texture_2d<f32>;
@group(2) @binding(3) var normal_sampler: sampler;
@group(2) @binding(4) var roughness_map: texture_2d<f32>;
@group(2) @binding(5) var roughness_sampler: sampler;
@group(2) @binding(6) var metalness_map: texture_2d<f32>;
@group(2) @binding(7) var metalness_sampler: sampler;
@group(2) @binding(8) var emissive_map: texture_2d<f32>;
@group(2) @binding(9) var emissive_sampler: sampler;
@group(2) @binding(10) var alpha_map: texture_2d<f32>;
@group(2) @binding(11) var alpha_sampler: sampler;
@group(2) @binding(12) var ao_map: texture_2d<f32>;
@group(2) @binding(13) var ao_sampler: sampler;
@group(3) @binding(0) var shadow_map: texture_depth_2d_array;
@group(3) @binding(1) var shadow_sampler: sampler_comparison;
@group(3) @binding(2) var environment_map: texture_2d<f32>;
@group(3) @binding(3) var environment_sampler: sampler;

// The prefiltered map is written with y inverted, so directions are flipped before
// sampling (three.js PMREMNode).
fn environment_sample(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
    let rotated = frame.environment_rotation * vec3<f32>(direction.x, -direction.y, direction.z);
    return cube_uv_sample(environment_map, environment_sampler, rotated, roughness, frame.environment.xy, frame.environment.z);
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec4<f32>,
    @location(4) tint: vec3<f32>,
    @location(5) depth: f32,
};

// Interleaved gradient noise of a pixel position, 0..1.
fn gradient_noise(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

// Fraction of light reaching a point (1 lit), filtered like three.js PCFShadowMap:
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
    // a three-component colour attribute reads with alpha 1
    @location(3) color: vec4<f32>,
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
        if (frame.camera_up.w > 0.5 && (u32(object.params.w) & 16u) != 0u) {
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

// Light reflected once (x) and more than once (y) by the specular lobe for reflectance
// f0, from the split-sum terms `fab` (Fdez-Aguera's multiple scattering, as three.js).
fn scattering(f0: vec3<f32>, fab: vec2<f32>) -> array<vec3<f32>, 2> {
    let single = f0 * fab.x + vec3<f32>(fab.y);
    let lost = 1.0 - (fab.x + fab.y);
    let average = f0 + (1.0 - f0) * 0.047619;
    return array<vec3<f32>, 2>(single, single * average / (1.0 - lost * average) * lost);
}

fn schlick(f0: f32, v_h: f32) -> f32 {
    let fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
    return f0 * (1.0 - fresnel) + fresnel;
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

@fragment
fn fragment(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let texel = textureSample(map_texture, map_sampler, input.uv);
    let geometry_normal = normalize(input.normal);
    var n = select(-geometry_normal, geometry_normal, front);
    // Screen-space changes for the toon step, the normal map's tangent frame and the
    // other maps' mip levels. Taken before any branch: derivatives need uniform control
    // flow. The maps are then read with explicit gradients, only when present.
    let n_dx = dpdx(n);
    let n_dy = dpdy(n);
    let uv_dx = dpdx(input.uv);
    let uv_dy = dpdy(input.uv);
    let position_dx = dpdx(input.world_position);
    let position_dy = dpdy(input.world_position);
    let flags = u32(object.params.w);
    var base = object.color.rgb * texel.rgb * input.tint;
    var coverage = object.color.a * texel.a;
    if ((flags & 1u) != 0u) {
        base *= input.color.rgb;
        coverage *= input.color.a;
    }
    if ((flags & 512u) != 0u) {
        // three.js multiplies the opacity by the whole texel and keeps the first
        // component: alpha comes from red (grey maps read the same in every channel)
        coverage *= textureSampleGrad(alpha_map, alpha_sampler, input.uv, uv_dx, uv_dy).r;
    }
    if (object.sprite.w > 0.0 && coverage <= object.sprite.w) {
        discard;
    }
    let alpha = select(1.0, coverage, (flags & 2u) != 0u);

    if ((flags & 32u) != 0u) {
        // A tangent-space normal map, with the tangent frame from screen-space derivatives
        // (three.js without a tangent attribute). three.js follows GL, whose y runs
        // up, hence the negated dpdy.
        let sampled = textureSampleGrad(normal_map, normal_sampler, input.uv, uv_dx, uv_dy).xyz * 2.0 - 1.0;
        let map_normal = vec3<f32>(sampled.xy * object.environment.zw, sampled.z);
        let q0 = position_dx;
        let q1 = -position_dy;
        let st0 = uv_dx;
        let st1 = -uv_dy;
        let q1perp = cross(q1, n);
        let q0perp = cross(n, q0);
        let t = q1perp * st0.x + q0perp * st1.x;
        let b = q1perp * st0.y + q0perp * st1.y;
        let det = max(dot(t, t), dot(b, b));
        let scale = select(inverseSqrt(det), 0.0, det == 0.0) * select(-1.0, 1.0, front);
        n = normalize(mat3x3<f32>(t * scale, b * scale, n) * map_normal);
    }

    let shading = u32(object.params.z + 0.5);
    if (shading == 1u) {
        return vec4<f32>(fogged(base, input.depth), alpha);
    }

    if (shading == 4u) {
        // The view-space normal packed into 0..1, which three.js treats as sRGB. Normal
        // materials have no fog.
        let view_normal = vec3<f32>(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return vec4<f32>(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    let standard = shading == 2u;
    let phong = shading == 3u;
    let toon = shading == 5u;
    var metalness = object.params.y;
    if ((flags & 128u) != 0u) {
        metalness *= textureSampleGrad(metalness_map, metalness_sampler, input.uv, uv_dx, uv_dy).b;
    }
    var roughness_factor = object.params.x;
    if ((flags & 64u) != 0u) {
        roughness_factor *= textureSampleGrad(roughness_map, roughness_sampler, input.uv, uv_dx, uv_dy).g;
    }
    // Widened where the normal turns fast across the pixel, against specular aliasing:
    // the largest view-space component of the normal's screen-space change.
    let view_dx = abs(vec3<f32>(dot(n_dx, frame.camera_right.xyz), dot(n_dx, frame.camera_up.xyz), dot(n_dx, frame.camera_forward.xyz)));
    let view_dy = abs(vec3<f32>(dot(n_dy, frame.camera_right.xyz), dot(n_dy, frame.camera_up.xyz), dot(n_dy, frame.camera_forward.xyz)));
    let geometry_change = max(view_dx, view_dy);
    let geometry_roughness = max(max(geometry_change.x, geometry_change.y), geometry_change.z);
    let roughness = min(max(roughness_factor, 0.0525) + geometry_roughness, 1.0);
    var emissive = object.emissive.rgb;
    if ((flags & 256u) != 0u) {
        emissive *= textureSampleGrad(emissive_map, emissive_sampler, input.uv, uv_dx, uv_dy).rgb;
    }
    // ambient occlusion scales indirect light only
    var occlusion = 1.0;
    if ((flags & 1024u) != 0u) {
        occlusion = (textureSampleGrad(ao_map, ao_sampler, input.uv, uv_dx, uv_dy).r - 1.0) * object.emissive.w + 1.0;
    }
    let v = normalize(frame.camera_position.xyz - input.world_position);
    let f0 = mix(vec3<f32>(0.04), base, metalness);
    let shininess = max(object.specular.w, 0.0001);

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

        let n_l = dot(n, l);
        var irradiance = max(n_l, 0.0) * strength * light.color.rgb;
        if (toon) {
            // Two tones without a gradient map, the step smoothed over one pixel: half the
            // screen-space change of n.l / 2 + 1/2, the light direction taken as constant.
            let coord = n_l * 0.5 + 0.5;
            let fw = 0.25 * (abs(dot(n_dx, l)) + abs(dot(n_dy, l)));
            irradiance = mix(vec3<f32>(0.7), vec3<f32>(1.0), smoothstep(0.7 - fw, 0.7 + fw, coord)) * strength * light.color.rgb;
        }
        if (standard) {
            // what the dielectric interface reflects does not reach the diffuse layer
            let v_h = saturate(dot(v, normalize(l + v)));
            direct += irradiance * (1.0 - schlick(0.04, v_h));
            highlight += irradiance * specular(n, l, v, f0, roughness);
        } else {
            direct += irradiance;
        }
        if (phong) {
            // Blinn-Phong: Schlick fresnel on the specular colour, implicit visibility 1/4
            let h = normalize(l + v);
            let v_h = saturate(dot(v, h));
            let fresnel = exp2((-5.55473 * v_h - 6.98316) * v_h);
            let f = object.specular.rgb * (1.0 - fresnel) + vec3<f32>(fresnel);
            let distribution = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(saturate(dot(n, h)), shininess);
            highlight += irradiance * f * (0.25 * distribution);
        }
    }

    var lit = (direct + ambient * occlusion) * base * RECIPROCAL_PI + highlight;
    if (standard) {
        // As three.js: scattering is worked out for a dielectric (f0 0.04) and for a
        // metal (f0 the base colour) and mixed by metalness. Only the dielectric part takes
        // energy from the diffuse layer, and light from ambient and hemisphere lights is
        // diffuse only; the environment adds radiance and light scattered more than once.
        let n_v = saturate(dot(n, v));
        let fab = dfg(n_v, roughness);
        let dielectric = scattering(vec3<f32>(0.04), fab);
        let metallic = scattering(base, fab);
        let single = mix(dielectric[0], metallic[0], metalness);
        let multiple = mix(dielectric[1], metallic[1], metalness);
        let diffuse_color = base * (1.0 - metalness) * (1.0 - (dielectric[0] + dielectric[1]));
        // direct specular, compensated for the energy of multiple bounces
        let compensation = 1.0 + f0 * (1.0 / (fab.x + fab.y) - 1.0);
        let diffuse_layer = base * (1.0 - metalness);
        lit = direct * diffuse_layer * RECIPROCAL_PI + highlight * compensation + ambient * diffuse_color * RECIPROCAL_PI * occlusion;
        if (object.environment.y > 0.5 && frame.environment.x > 0.0) {
            // radiance along the reflection bent towards the normal by roughness^4,
            // irradiance (cosine-weighted, divided by pi) along the normal at roughness 1
            let intensity = object.environment.x;
            let r2 = roughness * roughness;
            let reflected = normalize(mix(reflect(-v, n), n, r2 * r2));
            let radiance = environment_sample(reflected, roughness) * intensity;
            let irradiance = environment_sample(n, 1.0) * intensity;
            // occlusion of reflected light, by roughness and view angle
            let specular_occlusion = saturate(occlusion - (1.0 - pow(n_v + occlusion, exp2(-16.0 * roughness - 1.0))));
            lit += (radiance * single + multiple * irradiance) * specular_occlusion + diffuse_color * irradiance * occlusion;
        }
    }
    lit += emissive;
    return vec4<f32>(fogged(lit, input.depth), alpha);
}
"#;

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
            color = cube_uv_sample(background_map, background_sampler, flipped, background.params.z, background.environment.xy, background.environment.z);
        } else {
            let uv = vec2<f32>(atan2(direction.z, direction.x) * (1.0 / 6.283185307179586) + 0.5, asin(clamp(direction.y, -1.0, 1.0)) * (1.0 / 3.141592653589793) + 0.5);
            color = textureSampleLevel(background_map, background_sampler, uv, 0.0).rgb;
        }
    }
    return vec4<f32>(color * background.params.y, 1.0);
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

/// The mesh shader with the functions it shares with the prefiltering passes, and the
/// split-sum table.
pub fn shader_source() -> String {
    format!("{CUBE_UV}{}{SHADER}", crate::dfg::dfg_source())
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

// Tone mapping as three.js applies it to output written to the canvas.
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
