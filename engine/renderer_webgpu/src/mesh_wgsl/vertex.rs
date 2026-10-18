//! The mesh pipeline's bindings of group 3, shadow lookups and vertex stages.

macro_rules! mesh_vertex {
    () => {
        r#"
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
    @location(8) line_distance: f32,
};

// Whether a world position is clipped away: behind any of the renderer's global planes,
// or by the material's planes.
fn clipped(p: vec3<f32>) -> bool {
    let global = u32(frame.clip.x + 0.5);
    for (var i = 0u; i < global; i++) {
        let plane = frame.clip_planes[i];
        if (dot(plane.xyz, p) + plane.w < 0.0) {
            return true;
        }
    }
    return clipped_by_material(p);
}

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
    output.line_distance = input.line_distance;
    return output;
}

struct QuadInput {
    @builtin(vertex_index) corner: u32,
    // per point (or segment): its first and second vertex, their colours and, for dashed
    // lines, their distances along the line
    @location(0) position: vec3<f32>,
    @location(1) line_distance: f32,
    @location(2) line_distance_b: f32,
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
    var line_distance = 0.0;
    let line = (u32(object.params.x) & 16u) != 0u;
    if (line) {
        // a segment from a to b, widened across its screen direction
        let b = object.model * vec4<f32>(input.position_b, 1.0);
        let clip_b = frame.view_projection * b;
        let at_b = corner.x > 0.0;
        world = select(a, b, at_b);
        color = select(input.color, input.color_b, at_b);
        line_distance = select(input.line_distance, input.line_distance_b, at_b);
        if (material.depth_params.y > 0.5) {
            // width in world units: across the segment and the direction to the camera
            let direction = b.xyz - a.xyz;
            let to_camera = frame.camera_position.xyz - world.xyz;
            var side = cross(direction, to_camera);
            side = select(vec3<f32>(0.0), normalize(side), dot(side, side) > 0.0);
            world = vec4<f32>(world.xyz + side * corner.y * material.sprite.z * 0.5, 1.0);
            clip = frame.view_projection * world;
        } else {
            let screen = (clip_b.xy / clip_b.w - clip_a.xy / clip_a.w) / pixel;
            let along = select(vec2<f32>(1.0, 0.0), normalize(screen), length(screen) > 0.0);
            let across = vec2<f32>(-along.y, along.x);
            clip = select(clip_a, clip_b, at_b);
            clip = vec4<f32>(clip.xy + across * corner.y * material.sprite.z * pixel_ratio * 0.5 * pixel * clip.w, clip.zw);
        }
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
    output.line_distance = line_distance;
    return output;
}

"#
    };
}
