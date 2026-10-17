//! WGSL of the mesh pipelines, the shadow passes and the VSM blur.

/// Declarations shared by the mesh and shadow shaders: the frame, object and material
/// blocks, the texture slots and the map helpers.
pub const COMMON: &str = r#"
const RECIPROCAL_PI = 0.31830988618;
const PI = 3.141592653589793;

// maps, in the order of the material's map table
const MAP_COLOR = 0u;
const MAP_NORMAL = 1u;
const MAP_ROUGHNESS = 2u;
const MAP_METALNESS = 3u;
const MAP_EMISSIVE = 4u;
const MAP_ALPHA = 5u;
const MAP_AO = 6u;
const MAP_LIGHT = 7u;
const MAP_BUMP = 8u;
const MAP_DISPLACEMENT = 9u;
const MAP_SPECULAR = 10u;
const MAP_GRADIENT = 11u;
const MAP_CLEARCOAT = 12u;
const MAP_CLEARCOAT_ROUGHNESS = 13u;
const MAP_CLEARCOAT_NORMAL = 14u;
const MAP_SHEEN_COLOR = 15u;
const MAP_SHEEN_ROUGHNESS = 16u;
const MAP_SPECULAR_INTENSITY = 17u;
const MAP_SPECULAR_COLOR = 18u;
const MAP_TRANSMISSION = 19u;
const MAP_THICKNESS = 20u;
const MAP_IRIDESCENCE = 21u;
const MAP_IRIDESCENCE_THICKNESS = 22u;
const MAP_ANISOTROPY = 23u;

struct Light {
    // xyz position, w kind (0 directional, 1 point, 2 spot, 3 rectangular area)
    position: vec4<f32>,
    // xyz direction towards the light (an area light's half width), w cutoff distance
    direction: vec4<f32>,
    // rgb colour times intensity, w decay
    color: vec4<f32>,
    // x cosine of the cone angle, y cosine of the penumbra angle, z index + 1 of the first
    // shadow map (0 none; a point light has six, one per cube face); an area light's half
    // height in x, y and w
    cone: vec4<f32>,
};

struct Shadow {
    // light space to shadow-map coordinates: x, y in 0..1 (y still up), z the depth
    matrix: mat4x4<f32>,
    // bias, normal bias, intensity, filter radius in units of the map width
    params: vec4<f32>,
    // share of the layer the map covers (x, y), layer, filter (0 basic, 1 PCF, 2 VSM)
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
    // w: half the viewport height in logical pixels
    camera_right: vec4<f32>,
    // w is 1 for a perspective camera
    camera_up: vec4<f32>,
    lights: array<Light, 16>,
    shadows: array<Shadow, 16>,
    // the environment stack: 1/width, 1/height, lodMax, height of one map in pixels
    environment: vec4<f32>,
    environment_unused: array<vec4<f32>, 3>,
    // spherical-harmonics coefficients of the light probe
    probe: array<vec4<f32>, 9>,
    // 1/width and 1/height of the viewport (and of the transmission copy), its mip
    // count, the pixel ratio
    transmission: vec4<f32>,
};

struct ObjectUniforms {
    model: mat4x4<f32>,
    normal_0: vec4<f32>,
    normal_1: vec4<f32>,
    normal_2: vec4<f32>,
    // flags (1 vertex colours, 4 receives shadows, 8 sprite, 16 a line drawn as quads),
    // first skin matrix + 1 (0 none), sprite centre
    params: vec4<f32>,
};

struct MaterialUniforms {
    // a is the opacity
    color: vec4<f32>,
    // roughness, metalness, shading (0 diffuse, 1 unlit, 2 standard, 3 phong, 4 normal,
    // 5 toon), flags (2 blended, 16 fixed size, 65536 environment, 131072 clearcoat,
    // 262144 sheen, 524288 transmission, 1048576 iridescence, 2097152 anisotropy, 4194304
    // premultiplied alpha)
    params: vec4<f32>,
    // emissive colour times intensity; w the ambient-occlusion intensity
    emissive: vec4<f32>,
    // phong: specular colour, shininess; standard: dielectric reflectance, intensity
    specular: vec4<f32>,
    // environment intensity, light-map intensity, normal scale
    environment: vec4<f32>,
    // bump scale, displacement scale and bias, alpha test (0 for none)
    surface: vec4<f32>,
    // clearcoat, clearcoat roughness, sheen roughness, ior
    layers: vec4<f32>,
    // sheen colour, index of the environment in the stack
    sheen: vec4<f32>,
    // transmission, thickness, attenuation distance (-1 infinite), dispersion
    transmission: vec4<f32>,
    // attenuation colour, iridescence
    attenuation: vec4<f32>,
    // iridescence ior, thickness range, anisotropy strength
    iridescence: vec4<f32>,
    // anisotropy direction, clearcoat normal scale
    anisotropy: vec4<f32>,
    // sprite rotation, point size, line width
    sprite: vec4<f32>,
    // the environment's rotation, three padded columns
    environment_rotation_0: vec4<f32>,
    environment_rotation_1: vec4<f32>,
    environment_rotation_2: vec4<f32>,
    // per map two vec4: the uv transform's first row and slot + 1, its second row and uv set
    maps: array<vec4<f32>, 48>,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> object: ObjectUniforms;
@group(1) @binding(1) var<uniform> material: MaterialUniforms;
@group(2) @binding(0) var slot_0: texture_2d<f32>;
@group(2) @binding(1) var sampler_0: sampler;
@group(2) @binding(2) var slot_1: texture_2d<f32>;
@group(2) @binding(3) var sampler_1: sampler;
@group(2) @binding(4) var slot_2: texture_2d<f32>;
@group(2) @binding(5) var sampler_2: sampler;
@group(2) @binding(6) var slot_3: texture_2d<f32>;
@group(2) @binding(7) var sampler_3: sampler;
@group(2) @binding(8) var slot_4: texture_2d<f32>;
@group(2) @binding(9) var sampler_4: sampler;
@group(2) @binding(10) var slot_5: texture_2d<f32>;
@group(2) @binding(11) var sampler_5: sampler;
@group(2) @binding(12) var slot_6: texture_2d<f32>;
@group(2) @binding(13) var sampler_6: sampler;
@group(2) @binding(14) var slot_7: texture_2d<f32>;
@group(2) @binding(15) var sampler_7: sampler;
@group(2) @binding(16) var slot_8: texture_2d<f32>;
@group(2) @binding(17) var sampler_8: sampler;
@group(2) @binding(18) var slot_9: texture_2d<f32>;
@group(2) @binding(19) var sampler_9: sampler;
@group(2) @binding(20) var slot_10: texture_2d<f32>;
@group(2) @binding(21) var sampler_10: sampler;
@group(2) @binding(22) var slot_11: texture_2d<f32>;
@group(2) @binding(23) var sampler_11: sampler;

// Texture coordinates of the fragment: both uv sets and their screen-space changes.
struct Coords {
    uv0: vec2<f32>,
    uv1: vec2<f32>,
    d0x: vec2<f32>,
    d0y: vec2<f32>,
    d1x: vec2<f32>,
    d1y: vec2<f32>,
};

// Where a map is read: its transformed coordinates and their changes, and its slot.
struct MapCoords {
    uv: vec2<f32>,
    dx: vec2<f32>,
    dy: vec2<f32>,
    slot: u32,
};

fn map_present(k: u32) -> bool {
    return material.maps[2u * k].w > 0.5;
}

fn map_transform(k: u32, uv: vec2<f32>) -> vec2<f32> {
    let a = material.maps[2u * k];
    let b = material.maps[2u * k + 1u];
    return vec2<f32>(dot(a.xyz, vec3<f32>(uv, 1.0)), dot(b.xyz, vec3<f32>(uv, 1.0)));
}

fn map_coords(k: u32, c: Coords) -> MapCoords {
    let a = material.maps[2u * k];
    let b = material.maps[2u * k + 1u];
    let second = b.w > 0.5;
    let uv = select(c.uv0, c.uv1, second);
    let dx = select(c.d0x, c.d1x, second);
    let dy = select(c.d0y, c.d1y, second);
    var m: MapCoords;
    m.uv = vec2<f32>(dot(a.xyz, vec3<f32>(uv, 1.0)), dot(b.xyz, vec3<f32>(uv, 1.0)));
    m.dx = vec2<f32>(dot(a.xy, dx), dot(b.xy, dx));
    m.dy = vec2<f32>(dot(a.xy, dy), dot(b.xy, dy));
    m.slot = u32(a.w + 0.5) - 1u;
    return m;
}

// Every draw reads the same slot for a map, so the branch is uniform across it.
fn slot_sample(slot: u32, uv: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>) -> vec4<f32> {
    switch slot {
        case 0u: { return textureSampleGrad(slot_0, sampler_0, uv, dx, dy); }
        case 1u: { return textureSampleGrad(slot_1, sampler_1, uv, dx, dy); }
        case 2u: { return textureSampleGrad(slot_2, sampler_2, uv, dx, dy); }
        case 3u: { return textureSampleGrad(slot_3, sampler_3, uv, dx, dy); }
        case 4u: { return textureSampleGrad(slot_4, sampler_4, uv, dx, dy); }
        case 5u: { return textureSampleGrad(slot_5, sampler_5, uv, dx, dy); }
        case 6u: { return textureSampleGrad(slot_6, sampler_6, uv, dx, dy); }
        case 7u: { return textureSampleGrad(slot_7, sampler_7, uv, dx, dy); }
        case 8u: { return textureSampleGrad(slot_8, sampler_8, uv, dx, dy); }
        case 9u: { return textureSampleGrad(slot_9, sampler_9, uv, dx, dy); }
        case 10u: { return textureSampleGrad(slot_10, sampler_10, uv, dx, dy); }
        default: { return textureSampleGrad(slot_11, sampler_11, uv, dx, dy); }
    }
}

fn map_sample(k: u32, c: Coords) -> vec4<f32> {
    let m = map_coords(k, c);
    return slot_sample(m.slot, m.uv, m.dx, m.dy);
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
    // tangent with its handedness in w (0 for none), second uv set, skinning
    @location(9) tangent: vec4<f32>,
    @location(10) uv1: vec2<f32>,
    @location(11) skin_index: vec4<f32>,
    @location(12) skin_weight: vec4<f32>,
};

// Bone matrix `index` of the frame: four texels of a row of 1024.
fn bone_matrix(index: u32) -> mat4x4<f32> {
    let row = index / 256u;
    let column = (index % 256u) * 4u;
    return mat4x4<f32>(
        textureLoad(bone_map, vec2<u32>(column, row), 0),
        textureLoad(bone_map, vec2<u32>(column + 1u, row), 0),
        textureLoad(bone_map, vec2<u32>(column + 2u, row), 0),
        textureLoad(bone_map, vec2<u32>(column + 3u, row), 0)
    );
}

// The weighted sum of the vertex's bone matrices (already in the mesh's bind space).
fn skin_matrix(index: vec4<f32>, weight: vec4<f32>) -> mat4x4<f32> {
    let first = u32(object.params.y + 0.5) - 1u;
    return bone_matrix(first + u32(index.x + 0.5)) * weight.x
        + bone_matrix(first + u32(index.y + 0.5)) * weight.y
        + bone_matrix(first + u32(index.z + 0.5)) * weight.z
        + bone_matrix(first + u32(index.w + 0.5)) * weight.w;
}

// Displaced along the normal by the map's first channel, scaled and biased.
fn displaced(position: vec3<f32>, normal: vec3<f32>, uv0: vec2<f32>, uv1: vec2<f32>) -> vec3<f32> {
    if (!map_present(MAP_DISPLACEMENT)) {
        return position;
    }
    let length_normal = length(normal);
    let direction = select(vec3<f32>(0.0), normal / length_normal, length_normal > 0.0);
    let second = material.maps[2u * MAP_DISPLACEMENT + 1u].w > 0.5;
    let uv = map_transform(MAP_DISPLACEMENT, select(uv0, uv1, second));
    let height = textureSampleLevel(slot_9, sampler_9, uv, 0.0).x;
    return position + direction * (height * material.surface.y + material.surface.z);
}
"#;

/// The mesh pipeline. It outputs linear colour: the target must be an sRGB or float
/// format.
pub const SHADER: &str = r#"
@group(3) @binding(0) var shadow_map: texture_depth_2d_array;
@group(3) @binding(1) var shadow_sampler: sampler_comparison;
@group(3) @binding(2) var environment_map: texture_2d<f32>;
@group(3) @binding(3) var environment_sampler: sampler;
@group(3) @binding(4) var bone_map: texture_2d<f32>;
@group(3) @binding(5) var transmission_map: texture_2d<f32>;
@group(3) @binding(6) var vsm_map: texture_2d_array<f32>;

// The prefiltered maps are written with y inverted, so directions are flipped before
// sampling (three.js PMREMNode). Map `index` of the stack.
fn environment_sample(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
    let rotation = mat3x3<f32>(material.environment_rotation_0.xyz, material.environment_rotation_1.xyz, material.environment_rotation_2.xyz);
    let rotated = rotation * vec3<f32>(direction.x, -direction.y, direction.z);
    let offset = material.sheen.w * frame.environment.w;
    return cube_uv_sample(environment_map, environment_sampler, rotated, roughness, frame.environment.xy, frame.environment.z, offset);
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) world_position: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) color: vec4<f32>,
    @location(4) tint: vec3<f32>,
    @location(5) depth: f32,
    @location(6) uv1: vec2<f32>,
    // world tangent, handedness in w (0 without a tangent attribute)
    @location(7) tangent: vec4<f32>,
};

// Interleaved gradient noise of a pixel position, 0..1.
fn gradient_noise(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

// Fraction of light reaching a point (1 lit). PCF filters like three.js PCFShadowMap:
// five comparisons on a Vogel disk turned by per-pixel noise, each bilinearly filtered.
// Basic makes one comparison at the centre of the nearest texel, as three.js's nearest
// filtered BasicShadowMap. VSM reads the blurred mean and deviation of the depth and
// bounds the lit share with Chebyshev's inequality, as three.js does.
fn shadowed(index: u32, world: vec3<f32>, normal: vec3<f32>, pixel: vec2<f32>) -> f32 {
    let shadow = frame.shadows[index];
    let projected = shadow.matrix * vec4<f32>(world + normal * shadow.params.y, 1.0);
    var coord = projected.xyz / projected.w;
    coord = vec3<f32>(coord.x, 1.0 - coord.y, coord.z + shadow.params.x);
    if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
        return 1.0;
    }
    let layer = i32(shadow.region.z + 0.5);
    if (shadow.region.w > 1.5) {
        let distribution = textureSampleLevel(vsm_map, environment_sampler, coord.xy * shadow.region.xy, layer, 0.0).xy;
        if (coord.z <= distribution.x) {
            return 1.0;
        }
        let variance = max(distribution.y * distribution.y, 0.0000001);
        let d = coord.z - distribution.x;
        let p_max = clamp((variance / (variance + d * d) - 0.3) / 0.65, 0.0, 1.0);
        return mix(1.0, p_max, shadow.params.z);
    }
    if (shadow.region.w < 0.5) {
        let size = vec2<f32>(textureDimensions(shadow_map));
        let texel = (floor(coord.xy * shadow.region.xy * size) + 0.5) / size;
        return mix(1.0, textureSampleCompareLevel(shadow_map, shadow_sampler, texel, layer, coord.z), shadow.params.z);
    }
    let phi = gradient_noise(pixel) * 6.28318530718;
    var sum = 0.0;
    for (var k = 0u; k < 5u; k++) {
        let radius = sqrt((f32(k) + 0.5) / 5.0);
        let theta = f32(k) * 2.399963229728653 + phi;
        let uv = coord.xy + vec2<f32>(cos(theta), sin(theta)) * radius * shadow.params.w;
        sum += textureSampleCompareLevel(shadow_map, shadow_sampler, uv * shadow.region.xy, layer, coord.z);
    }
    return mix(1.0, sum / 5.0, shadow.params.z);
}

// The cube face (+x, -x, +y, -y, +z, -z) a direction from a point light falls on: the
// face of its largest component.
fn cube_face(d: vec3<f32>) -> u32 {
    let a = abs(d);
    if (a.x >= a.y && a.x >= a.z) {
        return select(1u, 0u, d.x > 0.0);
    }
    if (a.y >= a.z) {
        return select(3u, 2u, d.y > 0.0);
    }
    return select(5u, 4u, d.z > 0.0);
}

@vertex
fn vertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let flags = u32(object.params.x);
    output.uv = input.uv;
    output.uv1 = input.uv1;
    var position = input.position;
    var normal = input.normal;
    var tangent = input.tangent.xyz;
    if (object.params.y > 0.5) {
        let skin = skin_matrix(input.skin_index, input.skin_weight);
        position = (skin * vec4<f32>(position, 1.0)).xyz;
        normal = (skin * vec4<f32>(normal, 0.0)).xyz;
        tangent = (skin * vec4<f32>(tangent, 0.0)).xyz;
    }
    position = displaced(position, normal, input.uv, input.uv1);
    let instance = mat4x4<f32>(input.instance_0, input.instance_1, input.instance_2, input.instance_3);
    var world = object.model * (instance * vec4<f32>(position, 1.0));
    if ((flags & 8u) != 0u) {
        // A sprite: the quad's x and y, around its centre, scaled by the world scale and
        // rotated, laid out along the camera's right and up directions.
        let origin = object.model[3].xyz;
        var scale = vec2<f32>(length(object.model[0].xyz), length(object.model[1].xyz));
        if (frame.camera_up.w > 0.5 && (u32(material.params.w) & 16u) != 0u) {
            scale *= dot(origin - frame.camera_position.xyz, frame.camera_forward.xyz);
        }
        let aligned = (input.position.xy - (object.params.zw - 0.5)) * scale;
        let c = cos(material.sprite.x);
        let s = sin(material.sprite.x);
        let rotated = vec2<f32>(c * aligned.x - s * aligned.y, s * aligned.x + c * aligned.y);
        world = vec4<f32>(origin + frame.camera_right.xyz * rotated.x + frame.camera_up.xyz * rotated.y, 1.0);
    }
    output.clip_position = frame.view_projection * world;
    output.world_position = world.xyz;

    // dividing by the squared column lengths keeps normals right under non-uniform instance scale
    let x = input.instance_0.xyz;
    let y = input.instance_1.xyz;
    let z = input.instance_2.xyz;
    let instance_normal = mat3x3<f32>(x, y, z) * (normal / vec3<f32>(dot(x, x), dot(y, y), dot(z, z)));
    output.normal = mat3x3<f32>(object.normal_0.xyz, object.normal_1.xyz, object.normal_2.xyz) * instance_normal;
    let model3 = mat3x3<f32>(object.model[0].xyz, object.model[1].xyz, object.model[2].xyz);
    output.tangent = vec4<f32>(model3 * (mat3x3<f32>(x, y, z) * tangent), input.tangent.w);
    output.color = input.color;
    output.tint = input.instance_color;
    output.depth = dot(world.xyz - frame.camera_position.xyz, frame.camera_forward.xyz);
    return output;
}

struct QuadInput {
    @builtin(vertex_index) corner: u32,
    // per point (or segment): its first and second vertex, and their colours
    @location(0) position: vec3<f32>,
    @location(3) color: vec4<f32>,
    @location(13) position_b: vec3<f32>,
    @location(14) color_b: vec4<f32>,
};

// Points larger than a pixel and lines wider than one, as two triangles per point or
// segment. Point sizes follow three.js's WebGLRenderer: `size` pixels times the pixel
// ratio, with size attenuation scaled by half the viewport height over the distance.
@vertex
fn vertex_quad(input: QuadInput) -> VertexOutput {
    var output: VertexOutput;
    // corners of two triangles: (-1,-1) (1,-1) (1,1) (-1,-1) (1,1) (-1,1)
    let corners = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
    let corner = corners[input.corner % 6u];
    let pixel = frame.transmission.xy * 2.0;
    let pixel_ratio = frame.transmission.w;
    let a = object.model * vec4<f32>(input.position, 1.0);
    let clip_a = frame.view_projection * a;
    var clip = clip_a;
    var world = a;
    var color = input.color;
    let line = (u32(object.params.x) & 16u) != 0u;
    if (line) {
        // a segment from a to b, widened across its screen direction
        let b = object.model * vec4<f32>(input.position_b, 1.0);
        let clip_b = frame.view_projection * b;
        let screen = (clip_b.xy / clip_b.w - clip_a.xy / clip_a.w) / pixel;
        let along = select(vec2<f32>(1.0, 0.0), normalize(screen), length(screen) > 0.0);
        let across = vec2<f32>(-along.y, along.x);
        let at_b = corner.x > 0.0;
        clip = select(clip_a, clip_b, at_b);
        world = select(a, b, at_b);
        color = select(input.color, input.color_b, at_b);
        clip = vec4<f32>(clip.xy + across * corner.y * material.sprite.z * pixel_ratio * 0.5 * pixel * clip.w, clip.zw);
    } else {
        var size = material.sprite.y * pixel_ratio;
        if (frame.camera_up.w > 0.5 && (u32(material.params.w) & 16u) == 0u) {
            let distance = max(dot(a.xyz - frame.camera_position.xyz, frame.camera_forward.xyz), 0.000001);
            // half the viewport height in logical pixels, as three.js's `scale` uniform
            size *= frame.camera_right.w / distance;
        }
        clip = vec4<f32>(clip.xy + corner * size * 0.5 * pixel * clip.w, clip.zw);
    }
    output.clip_position = clip;
    output.world_position = world.xyz;
    // three.js reads a point's map at (x, 1 - y) of the point sprite
    output.uv = corner * vec2<f32>(0.5, -0.5) + 0.5;
    output.uv = vec2<f32>(output.uv.x, 1.0 - output.uv.y);
    output.uv1 = output.uv;
    output.normal = vec3<f32>(0.0, 0.0, 1.0);
    output.tangent = vec4<f32>(0.0);
    output.color = color;
    output.tint = vec3<f32>(1.0);
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

fn finish(color: vec3<f32>, alpha: f32) -> vec4<f32> {
    if ((u32(material.params.w) & 4194304u) != 0u) {
        return vec4<f32>(color * alpha, alpha);
    }
    return vec4<f32>(color, alpha);
}

@fragment
fn fragment(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let geometry_normal = normalize(input.normal);
    let face = select(-1.0, 1.0, front);
    // the clearcoat layer keeps the surface's own normal
    let face_normal = geometry_normal * face;
    var n = face_normal;
    // Screen-space changes for the toon step, the tangent frames and the maps' mip
    // levels. Taken before any branch: derivatives need uniform control flow. The maps are
    // then read with explicit gradients, only when present.
    let n_dx = dpdx(n);
    let n_dy = dpdy(n);
    var c: Coords;
    c.uv0 = input.uv;
    c.uv1 = input.uv1;
    c.d0x = dpdx(input.uv);
    c.d0y = dpdy(input.uv);
    c.d1x = dpdx(input.uv1);
    c.d1y = dpdy(input.uv1);
    let position_dx = dpdx(input.world_position);
    let position_dy = dpdy(input.world_position);
    let object_flags = u32(object.params.x);
    let flags = u32(material.params.w);
    var texel = vec4<f32>(1.0);
    if (map_present(MAP_COLOR)) {
        texel = map_sample(MAP_COLOR, c);
    }
    var base = material.color.rgb * texel.rgb * input.tint;
    var coverage = material.color.a * texel.a;
    if ((object_flags & 1u) != 0u) {
        base *= input.color.rgb;
        coverage *= input.color.a;
    }
    if (map_present(MAP_ALPHA)) {
        // three.js multiplies the opacity by the whole texel and keeps the first
        // component: alpha comes from red (grey maps read the same in every channel)
        coverage *= map_sample(MAP_ALPHA, c).r;
    }
    if (material.surface.w > 0.0 && coverage <= material.surface.w) {
        discard;
    }
    var alpha = select(1.0, coverage, (flags & 2u) != 0u);

    if (map_present(MAP_NORMAL)) {
        let m = map_coords(MAP_NORMAL, c);
        let sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
        let map_normal = vec3<f32>(sampled.xy * material.environment.zw, sampled.z);
        n = normalize(surface_frame(m, n, geometry_normal, input.tangent, position_dx, position_dy, face) * map_normal);
    } else if (map_present(MAP_BUMP)) {
        // A bump map (Mikkelsen's surface gradient, as three.js): the height's change
        // across the pixel tilts the normal. Flipping the screen's y flips both the
        // height's and the position's y change, which cancel.
        let m = map_coords(MAP_BUMP, c);
        let height = slot_sample(m.slot, m.uv, m.dx, m.dy).x;
        let height_dx = slot_sample(m.slot, m.uv + m.dx, m.dx, m.dy).x - height;
        let height_dy = slot_sample(m.slot, m.uv + m.dy, m.dx, m.dy).x - height;
        let slope = vec2<f32>(height_dx, height_dy) * material.surface.x;
        let sigma_x = normalize(position_dx);
        let sigma_y = normalize(position_dy);
        let r1 = cross(sigma_y, n);
        let r2 = cross(n, sigma_x);
        let det = dot(sigma_x, r1) * face;
        let gradient = sign(det) * (slope.x * r1 + slope.y * r2);
        n = normalize(abs(det) * n - gradient);
    }

    // ambient occlusion scales indirect light only
    var occlusion = 1.0;
    if (map_present(MAP_AO)) {
        occlusion = (map_sample(MAP_AO, c).r - 1.0) * material.emissive.w + 1.0;
    }
    // baked irradiance, added to the light arriving from all around
    var baked = vec3<f32>(0.0);
    if (map_present(MAP_LIGHT)) {
        baked = map_sample(MAP_LIGHT, c).rgb * material.environment.y;
    }

    let shading = u32(material.params.z + 0.5);
    if (shading == 1u) {
        // three.js's basic material: the light map's irradiance over pi, else full light
        let indirect = select(vec3<f32>(1.0), baked * RECIPROCAL_PI, map_present(MAP_LIGHT));
        return finish(fogged(base * indirect * occlusion, input.depth), alpha);
    }

    if (shading == 4u) {
        // The view-space normal packed into 0..1, which three.js treats as sRGB. Normal
        // materials have no fog.
        let view_normal = vec3<f32>(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return finish(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    let standard = shading == 2u;
    let phong = shading == 3u;
    let toon = shading == 5u;
    var metalness = material.params.y;
    if (map_present(MAP_METALNESS)) {
        metalness *= map_sample(MAP_METALNESS, c).b;
    }
    var roughness_factor = material.params.x;
    if (map_present(MAP_ROUGHNESS)) {
        roughness_factor *= map_sample(MAP_ROUGHNESS, c).g;
    }
    // Widened where the normal turns fast across the pixel, against specular aliasing:
    // the largest view-space component of the normal's screen-space change.
    let view_dx = abs(vec3<f32>(dot(n_dx, frame.camera_right.xyz), dot(n_dx, frame.camera_up.xyz), dot(n_dx, frame.camera_forward.xyz)));
    let view_dy = abs(vec3<f32>(dot(n_dy, frame.camera_right.xyz), dot(n_dy, frame.camera_up.xyz), dot(n_dy, frame.camera_forward.xyz)));
    let geometry_change = max(view_dx, view_dy);
    let geometry_roughness = max(max(geometry_change.x, geometry_change.y), geometry_change.z);
    let roughness = min(max(roughness_factor, 0.0525) + geometry_roughness, 1.0);
    var emissive = material.emissive.rgb;
    if (map_present(MAP_EMISSIVE)) {
        emissive *= map_sample(MAP_EMISSIVE, c).rgb;
    }
    let v = normalize(frame.camera_position.xyz - input.world_position);
    let n_v = saturate(dot(n, v));
    // standard: the dielectric layer's reflectance head on and at grazing angles, tinted
    // and scaled by the specular layer's maps
    var dielectric_f0 = material.specular.rgb;
    var specular_intensity = material.specular.w;
    if (standard && map_present(MAP_SPECULAR_COLOR)) {
        dielectric_f0 = min(dielectric_f0 * map_sample(MAP_SPECULAR_COLOR, c).rgb, vec3<f32>(1.0));
    }
    if (standard && map_present(MAP_SPECULAR_INTENSITY)) {
        let k = map_sample(MAP_SPECULAR_INTENSITY, c).a;
        dielectric_f0 *= k;
        specular_intensity *= k;
    }
    let f90 = mix(specular_intensity, 1.0, metalness);
    let f0 = mix(dielectric_f0, base, metalness);
    let shininess = max(material.specular.w, 0.0001);
    var specular_strength = 1.0;
    if (map_present(MAP_SPECULAR)) {
        specular_strength = map_sample(MAP_SPECULAR, c).r;
    }

    // clearcoat, with its own maps and normal
    let has_clearcoat = standard && (flags & 131072u) != 0u;
    var clearcoat = material.layers.x;
    var clearcoat_roughness_factor = material.layers.y;
    var clearcoat_normal = face_normal;
    if (has_clearcoat) {
        if (map_present(MAP_CLEARCOAT)) {
            clearcoat *= map_sample(MAP_CLEARCOAT, c).x;
        }
        if (map_present(MAP_CLEARCOAT_ROUGHNESS)) {
            clearcoat_roughness_factor *= map_sample(MAP_CLEARCOAT_ROUGHNESS, c).y;
        }
        if (map_present(MAP_CLEARCOAT_NORMAL)) {
            let m = map_coords(MAP_CLEARCOAT_NORMAL, c);
            let sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
            let coat_normal = vec3<f32>(sampled.xy * material.anisotropy.zw, sampled.z);
            clearcoat_normal = normalize(surface_frame(m, face_normal, geometry_normal, input.tangent, position_dx, position_dy, face) * coat_normal);
        }
    }
    clearcoat = saturate(clearcoat);
    let clearcoat_roughness = min(max(clearcoat_roughness_factor, 0.0525) + geometry_roughness, 1.0);

    // sheen
    let has_sheen = standard && (flags & 262144u) != 0u;
    var sheen_color = material.sheen.rgb;
    // kept away from 0 as three.js's WebGL renderer does: a zero-width lobe is undefined
    var sheen_roughness = clamp(material.layers.z, 0.07, 1.0);
    if (has_sheen) {
        if (map_present(MAP_SHEEN_COLOR)) {
            sheen_color *= map_sample(MAP_SHEEN_COLOR, c).rgb;
        }
        if (map_present(MAP_SHEEN_ROUGHNESS)) {
            sheen_roughness = clamp(sheen_roughness * map_sample(MAP_SHEEN_ROUGHNESS, c).a, 0.07, 1.0);
        }
    }
    let sheen_peak = max(max(sheen_color.r, sheen_color.g), sheen_color.b);
    let sheen_albedo_v = sheen_albedo(n_v, sheen_roughness);

    // a thin film over the surface
    var lobe = plain_lobe();
    var iridescence_f0_dielectric = dielectric_f0;
    var iridescence_f0_metallic = base;
    if (standard && (flags & 1048576u) != 0u) {
        var iridescence = material.attenuation.w;
        if (map_present(MAP_IRIDESCENCE)) {
            iridescence *= map_sample(MAP_IRIDESCENCE, c).r;
        }
        var thickness = material.iridescence.z;
        if (map_present(MAP_IRIDESCENCE_THICKNESS)) {
            thickness = mix(material.iridescence.y, material.iridescence.z, map_sample(MAP_IRIDESCENCE_THICKNESS, c).g);
        }
        iridescence = select(saturate(iridescence), 0.0, thickness == 0.0);
        if (iridescence > 0.0) {
            let dielectric = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, dielectric_f0);
            let metallic = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, base);
            lobe.iridescence = iridescence;
            lobe.iridescence_fresnel = mix(dielectric, metallic, metalness);
            iridescence_f0_dielectric = mix(dielectric_f0, schlick_to_f0(dielectric, 1.0, n_v), iridescence);
            iridescence_f0_metallic = mix(base, schlick_to_f0(metallic, 1.0, n_v), iridescence);
        }
    }

    // a highlight stretched along a tangent direction
    var anisotropy = 0.0;
    if (standard && (flags & 2097152u) != 0u) {
        var direction = material.anisotropy.xy * material.iridescence.w;
        var frame_coords: MapCoords;
        frame_coords.dx = c.d0x;
        frame_coords.dy = c.d0y;
        if (map_present(MAP_ANISOTROPY)) {
            frame_coords = map_coords(MAP_ANISOTROPY, c);
            let polar = slot_sample(frame_coords.slot, frame_coords.uv, frame_coords.dx, frame_coords.dy).rgb;
            let rotation = mat2x2<f32>(direction.x, direction.y, -direction.y, direction.x);
            direction = rotation * normalize(2.0 * polar.rg - vec2<f32>(1.0)) * polar.b;
        } else if (map_present(MAP_NORMAL)) {
            frame_coords = map_coords(MAP_NORMAL, c);
        }
        anisotropy = length(direction);
        direction = select(direction / max(anisotropy, 1e-8), vec2<f32>(1.0, 0.0), anisotropy == 0.0);
        anisotropy = saturate(anisotropy);
        let tbn = surface_frame(frame_coords, n, geometry_normal, input.tangent, position_dx, position_dy, face);
        lobe.anisotropic = true;
        lobe.alpha_t = mix(roughness * roughness, 1.0, anisotropy * anisotropy);
        lobe.t = tbn[0] * direction.x + tbn[1] * direction.y;
        lobe.b = tbn[1] * direction.x - tbn[0] * direction.y;
    }

    let ambient = mix(frame.ground.rgb, frame.sky.rgb, n.y * 0.5 + 0.5) + probe_irradiance(n) + baked;
    var direct = vec3<f32>(0.0);
    var highlight = vec3<f32>(0.0);
    var clearcoat_direct = vec3<f32>(0.0);
    var sheen_direct = vec3<f32>(0.0);
    let count = min(u32(frame.camera_position.w), 16u);
    let coat_lobe = plain_lobe();

    for (var i = 0u; i < count; i++) {
        let light = frame.lights[i];
        if (light.position.w > 2.5) {
            // A rectangular area light (physical materials only, as in three.js): the
            // diffuse part exactly by its form factor, the specular part from its point
            // nearest the reflected view ray, with the lobe widened by the light's size.
            if (!standard) {
                continue;
            }
            let center = light.position.xyz;
            let half_width = light.direction.xyz;
            let half_height = vec3<f32>(light.cone.x, light.cone.y, light.cone.w);
            let corners = array<vec3<f32>, 4>(center + half_width - half_height, center - half_width - half_height, center - half_width + half_height, center + half_width + half_height);
            let form = rect_form_factor(n, v, input.world_position, corners);
            if (form <= 0.0) {
                continue;
            }
            let reflected = reflect(-v, n);
            let point = rect_closest_point(input.world_position, reflected, center, half_width, half_height);
            let to_point = point - input.world_position;
            let distance = max(length(to_point), 1e-4);
            let l = to_point / distance;
            let radius = sqrt(4.0 * length(half_width) * length(half_height) / PI);
            let alpha = saturate(roughness * roughness + radius / (2.0 * distance));
            let v_h = saturate(dot(v, normalize(l + v)));
            direct += light.color.rgb * form * PI * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += light.color.rgb * form * PI * specular(n, l, v, f0, f90, sqrt(alpha), lobe);
            if (has_clearcoat) {
                let coat_alpha = saturate(clearcoat_roughness * clearcoat_roughness + radius / (2.0 * distance));
                clearcoat_direct += light.color.rgb * rect_form_factor(clearcoat_normal, v, input.world_position, corners) * PI * specular(clearcoat_normal, l, v, vec3<f32>(0.04), 1.0, sqrt(coat_alpha), coat_lobe);
            }
            continue;
        }
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
        if (shadow_index > 0u && (object_flags & 4u) != 0u) {
            var layer = shadow_index - 1u;
            if (light.position.w > 0.5 && light.position.w < 1.5) {
                // a point light: the face the normal-biased point falls on
                let biased = input.world_position + geometry_normal * frame.shadows[layer].params.y;
                layer += cube_face(biased - light.position.xyz);
            }
            strength *= shadowed(layer, input.world_position, geometry_normal, input.clip_position.xy);
        }

        let n_l = dot(n, l);
        var irradiance = max(n_l, 0.0) * strength * light.color.rgb;
        if (toon) {
            let coord = n_l * 0.5 + 0.5;
            if (map_present(MAP_GRADIENT)) {
                // the gradient map's red channel along n.l / 2 + 1/2
                let slot = u32(material.maps[2u * MAP_GRADIENT].w + 0.5) - 1u;
                let tone = slot_sample(slot, vec2<f32>(coord, 0.0), vec2<f32>(0.0), vec2<f32>(0.0)).r;
                irradiance = vec3<f32>(tone) * strength * light.color.rgb;
            } else {
                // Two tones without a gradient map, the step smoothed over one pixel: half
                // the screen-space change of n.l / 2 + 1/2, the light direction taken as
                // constant.
                let fw = 0.25 * (abs(dot(n_dx, l)) + abs(dot(n_dy, l)));
                irradiance = mix(vec3<f32>(0.7), vec3<f32>(1.0), smoothstep(0.7 - fw, 0.7 + fw, coord)) * strength * light.color.rgb;
            }
        }
        if (standard) {
            if (has_sheen) {
                // the sheen lobe reflects first; the layers below get what it lets through
                sheen_direct += irradiance * sheen_brdf(n, l, v, sheen_color, sheen_roughness);
                irradiance *= 1.0 - sheen_peak * max(sheen_albedo_v, sheen_albedo(saturate(n_l), sheen_roughness));
            }
            if (has_clearcoat) {
                let coat_irradiance = saturate(dot(clearcoat_normal, l)) * strength * light.color.rgb;
                clearcoat_direct += coat_irradiance * specular(clearcoat_normal, l, v, vec3<f32>(0.04), 1.0, clearcoat_roughness, coat_lobe);
            }
            // what the dielectric interface reflects does not reach the diffuse layer
            let v_h = saturate(dot(v, normalize(l + v)));
            direct += irradiance * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += irradiance * specular(n, l, v, f0, f90, roughness, lobe);
        } else {
            direct += irradiance;
        }
        if (phong) {
            // Blinn-Phong: Schlick fresnel on the specular colour, implicit visibility 1/4,
            // scaled by the specular map
            let h = normalize(l + v);
            let v_h = saturate(dot(v, h));
            let f = fresnel(material.specular.rgb, 1.0, v_h);
            let distribution = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(saturate(dot(n, h)), shininess);
            highlight += irradiance * f * (0.25 * distribution * specular_strength);
        }
    }

    var lit = (direct + ambient * occlusion) * base * RECIPROCAL_PI + highlight;
    if (standard) {
        // As three.js: scattering is worked out for the dielectric layer and for a metal
        // (f0 the base colour) and mixed by metalness. Only the dielectric part takes
        // energy from the diffuse layer, and light from ambient and hemisphere lights is
        // diffuse only; the environment adds radiance and light scattered more than once.
        let fab = dfg(n_v, roughness);
        let dielectric = scattering(iridescence_f0_dielectric, f90, fab);
        let metallic = scattering(iridescence_f0_metallic, f90, fab);
        let single = mix(dielectric[0], metallic[0], metalness);
        let multiple = mix(dielectric[1], metallic[1], metalness);
        let diffuse_color = base * (1.0 - metalness) * (1.0 - (dielectric[0] + dielectric[1]));
        // direct specular, compensated for the energy of multiple bounces
        let compensation = 1.0 + f0 * (1.0 / (fab.x + fab.y) - 1.0);
        let diffuse_layer = base * (1.0 - metalness);
        // the share of indirect light the sheen lets through to the layers below
        let sheen_pass = select(1.0, 1.0 - sheen_peak * sheen_albedo_v, has_sheen);
        var sheen_indirect = ambient * sheen_color * (sheen_albedo_v * RECIPROCAL_PI);
        var clearcoat_indirect = vec3<f32>(0.0);
        var diffuse_total = direct * diffuse_layer * RECIPROCAL_PI + ambient * diffuse_color * RECIPROCAL_PI * occlusion * sheen_pass;
        var specular_total = highlight * compensation;
        if ((flags & 65536u) != 0u && frame.environment.x > 0.0) {
            // radiance along the reflection bent towards the normal by roughness^4 (for an
            // anisotropic lobe, towards a normal bent along it), irradiance (cosine-weighted,
            // divided by pi) along the normal at roughness 1
            let intensity = material.environment.x;
            let r2 = roughness * roughness;
            var bent = n;
            if (lobe.anisotropic) {
                let across = normalize(cross(cross(lobe.b, v), lobe.b));
                let k = 1.0 - anisotropy * (1.0 - roughness);
                bent = normalize(mix(across, n, k * k * k * k));
            }
            let reflected = normalize(mix(reflect(-v, bent), bent, r2 * r2));
            let radiance = environment_sample(reflected, roughness) * intensity;
            let irradiance = environment_sample(n, 1.0) * intensity;
            // occlusion of reflected light, by roughness and view angle
            let specular_occlusion = saturate(occlusion - (1.0 - pow(n_v + occlusion, exp2(-16.0 * roughness - 1.0))));
            specular_total += (radiance * single + multiple * irradiance) * specular_occlusion * sheen_pass;
            diffuse_total += diffuse_color * irradiance * occlusion * sheen_pass;
            sheen_indirect += irradiance * sheen_color * sheen_albedo_v;
            if (has_clearcoat) {
                let c2 = clearcoat_roughness * clearcoat_roughness;
                let coat_reflected = normalize(mix(reflect(-v, clearcoat_normal), clearcoat_normal, c2 * c2));
                let coat_fab = dfg(saturate(dot(clearcoat_normal, v)), clearcoat_roughness);
                clearcoat_indirect = environment_sample(coat_reflected, clearcoat_roughness) * intensity * (0.04 * coat_fab.x + coat_fab.y);
            }
        }
        if ((flags & 524288u) != 0u) {
            // Light through the volume (three.js after glTF-Sample-Viewer): the refracted ray
            // leaves the object `thickness` further on, where the copy of the opaque scene is
            // read, blurred by roughness; Beer's law tints it on the way.
            var transmission = material.transmission.x;
            if (map_present(MAP_TRANSMISSION)) {
                transmission *= map_sample(MAP_TRANSMISSION, c).r;
            }
            var thickness = material.transmission.y;
            if (map_present(MAP_THICKNESS)) {
                thickness *= map_sample(MAP_THICKNESS, c).g;
            }
            let ior = material.layers.w;
            let model_scale = vec3<f32>(length(object.model[0].xyz), length(object.model[1].xyz), length(object.model[2].xyz));
            let half_spread = (ior - 1.0) * 0.025 * material.transmission.w;
            let iors = vec3<f32>(ior - half_spread, ior, ior + half_spread);
            var transmitted = vec3<f32>(0.0);
            var transmittance = vec3<f32>(0.0);
            var transmitted_alpha = 0.0;
            let channels = select(1, 3, material.transmission.w > 0.0);
            for (var k = 0; k < channels; k++) {
                let channel_ior = select(ior, iors[k], channels == 3);
                let ray = normalize(refract(-v, n, 1.0 / channel_ior)) * thickness * model_scale;
                let exit = frame.view_projection * vec4<f32>(input.world_position + ray, 1.0);
                let ndc = exit.xy / exit.w;
                let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
                let lod = min(log2(1.0 / frame.transmission.x) * roughness * clamp(channel_ior * 2.0 - 2.0, 0.0, 1.0), frame.transmission.z - 1.0);
                let refracted_texel = textureSampleLevel(transmission_map, environment_sampler, uv, lod);
                var attenuation = vec3<f32>(1.0);
                if (material.transmission.z > 0.0) {
                    attenuation = exp(log(max(material.attenuation.rgb, vec3<f32>(1e-6))) / material.transmission.z * length(ray));
                }
                let through = diffuse_layer * attenuation;
                if (channels == 3) {
                    transmitted[k] = refracted_texel[k];
                    transmittance[k] = through[k];
                } else {
                    transmitted = refracted_texel.rgb;
                    transmittance = through;
                }
                transmitted_alpha += refracted_texel.a;
            }
            transmitted_alpha /= f32(channels);
            let environment_f = f0 * fab.x + f90 * fab.y;
            let refracted = (1.0 - environment_f) * transmittance * transmitted;
            let factor = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
            diffuse_total = mix(diffuse_total, refracted, transmission);
            alpha *= mix(1.0, 1.0 - (1.0 - transmitted_alpha) * factor, transmission);
        }
        lit = diffuse_total + specular_total;
        if (has_clearcoat) {
            // the coat reflects by its own fresnel and dims everything under it
            let coat_fresnel = schlick(0.04, saturate(dot(clearcoat_normal, v)));
            lit = lit * (1.0 - clearcoat * coat_fresnel) + (clearcoat_direct + clearcoat_indirect * occlusion) * clearcoat;
        }
        if (has_sheen) {
            lit += sheen_direct + sheen_indirect * occlusion;
        }
    }
    lit += emissive;
    return finish(fogged(lit, input.depth), alpha);
}
"#;

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
    output.position = shadow_camera * (object.model * (instance * vec4<f32>(position, 1.0)));
    output.uv = input.uv;
    output.uv1 = input.uv1;
    return output;
}

// Only for casters with an alpha test: the colour map's and alpha map's alpha.
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
