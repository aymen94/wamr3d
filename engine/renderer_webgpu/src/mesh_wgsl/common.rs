//! The blocks, texture slots and map helpers shared by the mesh and shadow shaders.

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
const MAP_MATCAP = 24u;

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
    // the number of global clipping planes, the camera's near and far
    clip: vec4<f32>,
    // global clipping planes in world space: normal, constant
    clip_planes: array<vec4<f32>, 8>,
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
    // 5 toon), flags (2 blended, 16 fixed size, 32 flat shading, 65536 environment, 131072 clearcoat,
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
    maps: array<vec4<f32>, 50>,
    // blend colour and alpha, read by the hosts
    blend: vec4<f32>,
    // depth function, colour write, polygon offset factor and units, read by the hosts
    state: vec4<f32>,
    // stencil settings, read by the hosts
    stencil: vec4<f32>,
    // flags (1 no fog, 2 dithering, 4 alpha hash, 8 object-space normal map, 16 clip
    // intersection, 32 environment combined with the surface, 64 refraction, 128 dashed,
    // 256 clipped shadows), clipping plane count, environment combine, reflectivity
    extra: vec4<f32>,
    // dash size, gap size, dash scale, refraction ratio
    dash: vec4<f32>,
    // depth packing, line width in world units (1) or pixels (0)
    depth_params: vec4<f32>,
    // clipping planes in world space: normal, constant
    clip_planes: array<vec4<f32>, 8>,
};

// Whether a world position is behind any of the material's clipping planes (all of
// them with clip intersection).
fn clipped_by_material(p: vec3<f32>) -> bool {
    let local = u32(material.extra.y + 0.5);
    if (local == 0u) {
        return false;
    }
    let intersection = (u32(material.extra.x) & 16u) != 0u;
    var all = true;
    for (var i = 0u; i < local; i++) {
        let plane = material.clip_planes[i];
        let behind = dot(plane.xyz, p) + plane.w < 0.0;
        if (behind && !intersection) {
            return true;
        }
        all = all && behind;
    }
    return intersection && all;
}

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
    // distance along the line (three.js `lineDistance`), for dashes
    @location(15) line_distance: f32,
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
