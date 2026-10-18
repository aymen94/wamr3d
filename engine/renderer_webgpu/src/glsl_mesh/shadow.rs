//! The shadow passes and the VSM blur.

pub const SHADOW_VERTEX: &str = r#"
uniform mat4 shadow_view_projection;

out vec2 v_uv;
out vec2 v_uv1;
out vec3 v_world;

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
    vec4 world = object.model * (instance * vec4(position, 1.0));
    gl_Position = shadow_view_projection * world;
    gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
    v_world = world.xyz;
    v_uv = a_uv;
    v_uv1 = a_uv1;
}
"#;

/// The shadow fragment stage: nothing to write; with `ALPHA_TEST` defined, the alpha test
/// and the material's clipping planes when they clip shadows.
pub const SHADOW_FRAGMENT: &str = r#"
in vec2 v_uv;
in vec2 v_uv1;
in vec3 v_world;

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
    if ((uint(material.extra.x) & 256u) != 0u && clipped_by_material(v_world)) {
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
