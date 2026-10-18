//! The vertex stages of meshes, and of points and lines drawn as quads.

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
