//! The mesh fragment stage's `shade()` and `main()`.

macro_rules! mesh_fragment_shading {
    () => {
        r#"vec4 shade() {
    // flat shading: the triangle's normal from the position's screen-space change,
    // turned towards the viewer as three.js's is
    vec3 flat_cross = cross(dFdx(v_world), dFdy(v_world));
    bool flat_shaded = (uint(material.params.w) & 32u) != 0u && dot(flat_cross, flat_cross) > 0.0;
    vec3 flat_normal = normalize(flat_cross) * (dot(flat_cross, frame.camera_position.xyz - v_world) >= 0.0 ? 1.0 : -1.0);
    vec3 geometry_normal = flat_shaded ? flat_normal : normalize(v_normal);
    float face = flat_shaded ? 1.0 : (gl_FrontFacing ? 1.0 : -1.0);
    vec3 face_normal = geometry_normal * face;
    vec3 n = face_normal;
    vec3 n_dx = dFdx(n);
    vec3 n_dy = dFdy(n);
    Coords c = Coords(v_uv, v_uv1, dFdx(v_uv), dFdy(v_uv), dFdx(v_uv1), dFdy(v_uv1));
    vec3 position_dx = dFdx(v_world);
    vec3 position_dy = dFdy(v_world);
    uint object_flags = uint(object.params.x);
    uint flags = uint(material.params.w);
    vec4 texel = map_present(MAP_COLOR) ? map_sample(MAP_COLOR, c) : vec4(1.0);
    vec3 base = material.color.rgb * texel.rgb * v_tint;
    float coverage = material.color.a * texel.a;
    if ((object_flags & 1u) != 0u) {
        base *= v_color.rgb;
        coverage *= v_color.a;
    }
    if (map_present(MAP_ALPHA)) {
        coverage *= map_sample(MAP_ALPHA, c).r;
    }
    if (material.surface.w > 0.0 && coverage <= material.surface.w) {
        discard;
    }
    float alpha = (flags & 2u) != 0u ? coverage : 1.0;

    if (map_present(MAP_NORMAL)) {
        MapCoords m = map_coords(MAP_NORMAL, c);
        vec3 sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
        vec3 map_normal = vec3(sampled.xy * material.environment.zw, sampled.z);
        n = normalize(surface_frame(m, n, geometry_normal, position_dx, position_dy, face) * map_normal);
    } else if (map_present(MAP_BUMP)) {
        MapCoords m = map_coords(MAP_BUMP, c);
        float height = slot_sample(m.slot, m.uv, m.dx, m.dy).x;
        float height_dx = slot_sample(m.slot, m.uv + m.dx, m.dx, m.dy).x - height;
        float height_dy = slot_sample(m.slot, m.uv + m.dy, m.dx, m.dy).x - height;
        vec2 slope = vec2(height_dx, height_dy) * material.surface.x;
        vec3 sigma_x = normalize(position_dx);
        vec3 sigma_y = normalize(position_dy);
        vec3 r1 = cross(sigma_y, n);
        vec3 r2 = cross(n, sigma_x);
        float det = dot(sigma_x, r1) * face;
        vec3 gradient = sign(det) * (slope.x * r1 + slope.y * r2);
        n = normalize(abs(det) * n - gradient);
    }

    float occlusion = 1.0;
    if (map_present(MAP_AO)) {
        occlusion = (map_sample(MAP_AO, c).r - 1.0) * material.emissive.w + 1.0;
    }
    vec3 baked = vec3(0.0);
    if (map_present(MAP_LIGHT)) {
        baked = map_sample(MAP_LIGHT, c).rgb * material.environment.y;
    }

    uint shading = uint(material.params.z + 0.5);
    if (shading == 1u) {
        vec3 indirect = map_present(MAP_LIGHT) ? baked * RECIPROCAL_PI : vec3(1.0);
        return finish(fogged(base * indirect * occlusion, v_depth), alpha);
    }
    if (shading == 4u) {
        vec3 view_normal = vec3(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return finish(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    bool standard = shading == 2u;
    bool phong = shading == 3u;
    bool toon = shading == 5u;
    float metalness = material.params.y;
    if (map_present(MAP_METALNESS)) {
        metalness *= map_sample(MAP_METALNESS, c).b;
    }
    float roughness_factor = material.params.x;
    if (map_present(MAP_ROUGHNESS)) {
        roughness_factor *= map_sample(MAP_ROUGHNESS, c).g;
    }
    vec3 view_dx = abs(vec3(dot(n_dx, frame.camera_right.xyz), dot(n_dx, frame.camera_up.xyz), dot(n_dx, frame.camera_forward.xyz)));
    vec3 view_dy = abs(vec3(dot(n_dy, frame.camera_right.xyz), dot(n_dy, frame.camera_up.xyz), dot(n_dy, frame.camera_forward.xyz)));
    vec3 geometry_change = max(view_dx, view_dy);
    float geometry_roughness = max(max(geometry_change.x, geometry_change.y), geometry_change.z);
    float roughness = min(max(roughness_factor, 0.0525) + geometry_roughness, 1.0);
    vec3 emissive = material.emissive.rgb;
    if (map_present(MAP_EMISSIVE)) {
        emissive *= map_sample(MAP_EMISSIVE, c).rgb;
    }
    vec3 v = normalize(frame.camera_position.xyz - v_world);
    float n_v = clamp(dot(n, v), 0.0, 1.0);
    vec3 dielectric_f0 = material.specular.rgb;
    float specular_intensity = material.specular.w;
    if (standard && map_present(MAP_SPECULAR_COLOR)) {
        dielectric_f0 = min(dielectric_f0 * map_sample(MAP_SPECULAR_COLOR, c).rgb, vec3(1.0));
    }
    if (standard && map_present(MAP_SPECULAR_INTENSITY)) {
        float k = map_sample(MAP_SPECULAR_INTENSITY, c).a;
        dielectric_f0 *= k;
        specular_intensity *= k;
    }
    float f90 = mix(specular_intensity, 1.0, metalness);
    vec3 f0 = mix(dielectric_f0, base, metalness);
    float shininess = max(material.specular.w, 0.0001);
    float specular_strength = 1.0;
    if (map_present(MAP_SPECULAR)) {
        specular_strength = map_sample(MAP_SPECULAR, c).r;
    }

    bool has_clearcoat = standard && (flags & 131072u) != 0u;
    float clearcoat = material.layers.x;
    float clearcoat_roughness_factor = material.layers.y;
    vec3 clearcoat_normal = face_normal;
    if (has_clearcoat) {
        if (map_present(MAP_CLEARCOAT)) {
            clearcoat *= map_sample(MAP_CLEARCOAT, c).x;
        }
        if (map_present(MAP_CLEARCOAT_ROUGHNESS)) {
            clearcoat_roughness_factor *= map_sample(MAP_CLEARCOAT_ROUGHNESS, c).y;
        }
        if (map_present(MAP_CLEARCOAT_NORMAL)) {
            MapCoords m = map_coords(MAP_CLEARCOAT_NORMAL, c);
            vec3 sampled = slot_sample(m.slot, m.uv, m.dx, m.dy).xyz * 2.0 - 1.0;
            vec3 coat_normal = vec3(sampled.xy * material.anisotropy.zw, sampled.z);
            clearcoat_normal = normalize(surface_frame(m, face_normal, geometry_normal, position_dx, position_dy, face) * coat_normal);
        }
    }
    clearcoat = clamp(clearcoat, 0.0, 1.0);
    float clearcoat_roughness = min(max(clearcoat_roughness_factor, 0.0525) + geometry_roughness, 1.0);

    bool has_sheen = standard && (flags & 262144u) != 0u;
    vec3 sheen_color = material.sheen.rgb;
    float sheen_roughness = clamp(material.layers.z, 0.07, 1.0);
    if (has_sheen) {
        if (map_present(MAP_SHEEN_COLOR)) {
            sheen_color *= map_sample(MAP_SHEEN_COLOR, c).rgb;
        }
        if (map_present(MAP_SHEEN_ROUGHNESS)) {
            sheen_roughness = clamp(sheen_roughness * map_sample(MAP_SHEEN_ROUGHNESS, c).a, 0.07, 1.0);
        }
    }
    float sheen_peak = max(max(sheen_color.r, sheen_color.g), sheen_color.b);
    float sheen_albedo_v = sheen_albedo(n_v, sheen_roughness);

    Lobe lobe = plain_lobe();
    vec3 iridescence_f0_dielectric = dielectric_f0;
    vec3 iridescence_f0_metallic = base;
    if (standard && (flags & 1048576u) != 0u) {
        float iridescence = material.attenuation.w;
        if (map_present(MAP_IRIDESCENCE)) {
            iridescence *= map_sample(MAP_IRIDESCENCE, c).r;
        }
        float thickness = material.iridescence.z;
        if (map_present(MAP_IRIDESCENCE_THICKNESS)) {
            thickness = mix(material.iridescence.y, material.iridescence.z, map_sample(MAP_IRIDESCENCE_THICKNESS, c).g);
        }
        iridescence = thickness == 0.0 ? 0.0 : clamp(iridescence, 0.0, 1.0);
        if (iridescence > 0.0) {
            vec3 dielectric = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, dielectric_f0);
            vec3 metallic = iridescence_fresnel(1.0, material.iridescence.x, n_v, thickness, base);
            lobe.iridescence = iridescence;
            lobe.iridescence_fresnel = mix(dielectric, metallic, metalness);
            iridescence_f0_dielectric = mix(dielectric_f0, schlick_to_f0(dielectric, 1.0, n_v), iridescence);
            iridescence_f0_metallic = mix(base, schlick_to_f0(metallic, 1.0, n_v), iridescence);
        }
    }

    float anisotropy = 0.0;
    if (standard && (flags & 2097152u) != 0u) {
        vec2 direction = material.anisotropy.xy * material.iridescence.w;
        MapCoords frame_coords = MapCoords(v_uv, c.d0x, c.d0y, 0);
        if (map_present(MAP_ANISOTROPY)) {
            frame_coords = map_coords(MAP_ANISOTROPY, c);
            vec3 polar = slot_sample(frame_coords.slot, frame_coords.uv, frame_coords.dx, frame_coords.dy).rgb;
            mat2 rotation = mat2(direction.x, direction.y, -direction.y, direction.x);
            direction = rotation * normalize(2.0 * polar.rg - vec2(1.0)) * polar.b;
        } else if (map_present(MAP_NORMAL)) {
            frame_coords = map_coords(MAP_NORMAL, c);
        }
        anisotropy = length(direction);
        direction = anisotropy == 0.0 ? vec2(1.0, 0.0) : direction / anisotropy;
        anisotropy = clamp(anisotropy, 0.0, 1.0);
        mat3 tbn = surface_frame(frame_coords, n, geometry_normal, position_dx, position_dy, face);
        lobe.anisotropic = true;
        lobe.alpha_t = mix(roughness * roughness, 1.0, anisotropy * anisotropy);
        lobe.t = tbn[0] * direction.x + tbn[1] * direction.y;
        lobe.b = tbn[1] * direction.x - tbn[0] * direction.y;
    }

    vec3 ambient = mix(frame.ground.rgb, frame.sky.rgb, n.y * 0.5 + 0.5) + probe_irradiance(n) + baked;
    vec3 direct = vec3(0.0);
    vec3 highlight = vec3(0.0);
    vec3 clearcoat_direct = vec3(0.0);
    vec3 sheen_direct = vec3(0.0);
    int count = min(int(frame.camera_position.w), 16);
    Lobe coat_lobe = plain_lobe();

    for (int i = 0; i < 16; i++) {
        if (i >= count) {
            break;
        }
        Light light = frame.lights[i];
        if (light.position.w > 2.5) {
            if (!standard) {
                continue;
            }
            vec3 center = light.position.xyz;
            vec3 half_width = light.direction.xyz;
            vec3 half_height = vec3(light.cone.x, light.cone.y, light.cone.w);
            vec3 c0 = center + half_width - half_height;
            vec3 c1 = center - half_width - half_height;
            vec3 c2 = center - half_width + half_height;
            vec3 c3 = center + half_width + half_height;
            float form = rect_form_factor(n, v, v_world, c0, c1, c2, c3);
            if (form <= 0.0) {
                continue;
            }
            vec3 point = rect_closest_point(v_world, reflect(-v, n), center, half_width, half_height);
            vec3 to_point = point - v_world;
            float distance = max(length(to_point), 1e-4);
            vec3 l = to_point / distance;
            float radius = sqrt(4.0 * length(half_width) * length(half_height) / PI);
            float area_alpha = clamp(roughness * roughness + radius / (2.0 * distance), 0.0, 1.0);
            float v_h = clamp(dot(v, normalize(l + v)), 0.0, 1.0);
            direct += light.color.rgb * form * PI * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += light.color.rgb * form * PI * specular_ggx(n, l, v, f0, f90, sqrt(area_alpha), lobe);
            if (has_clearcoat) {
                float coat_alpha = clamp(clearcoat_roughness * clearcoat_roughness + radius / (2.0 * distance), 0.0, 1.0);
                clearcoat_direct += light.color.rgb * rect_form_factor(clearcoat_normal, v, v_world, c0, c1, c2, c3) * PI * specular_ggx(clearcoat_normal, l, v, vec3(0.04), 1.0, sqrt(coat_alpha), coat_lobe);
            }
            continue;
        }
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
        if (shadow_index > 0 && (object_flags & 4u) != 0u) {
            int layer = shadow_index - 1;
            if (light.position.w > 0.5 && light.position.w < 1.5) {
                vec3 biased = v_world + geometry_normal * frame.shadows[layer].params.y;
                layer += cube_face(biased - light.position.xyz);
            }
            strength *= shadowed(layer, v_world, geometry_normal, gl_FragCoord.xy);
        }

        float n_l = dot(n, l);
        vec3 irradiance = max(n_l, 0.0) * strength * light.color.rgb;
        if (toon) {
            float coord = n_l * 0.5 + 0.5;
            if (map_present(MAP_GRADIENT)) {
                int slot = int(material.maps[2 * MAP_GRADIENT].w + 0.5) - 1;
                float tone = slot_sample(slot, vec2(coord, 0.0), vec2(0.0), vec2(0.0)).r;
                irradiance = vec3(tone) * strength * light.color.rgb;
            } else {
                float fw = 0.25 * (abs(dot(n_dx, l)) + abs(dot(n_dy, l)));
                irradiance = mix(vec3(0.7), vec3(1.0), smoothstep(0.7 - fw, 0.7 + fw, coord)) * strength * light.color.rgb;
            }
        }
        if (standard) {
            if (has_sheen) {
                sheen_direct += irradiance * sheen_brdf(n, l, v, sheen_color, sheen_roughness);
                irradiance *= 1.0 - sheen_peak * max(sheen_albedo_v, sheen_albedo(clamp(n_l, 0.0, 1.0), sheen_roughness));
            }
            if (has_clearcoat) {
                vec3 coat_irradiance = clamp(dot(clearcoat_normal, l), 0.0, 1.0) * strength * light.color.rgb;
                clearcoat_direct += coat_irradiance * specular_ggx(clearcoat_normal, l, v, vec3(0.04), 1.0, clearcoat_roughness, coat_lobe);
            }
            float v_h = clamp(dot(v, normalize(l + v)), 0.0, 1.0);
            direct += irradiance * (1.0 - fresnel(dielectric_f0, f90, v_h));
            highlight += irradiance * specular_ggx(n, l, v, f0, f90, roughness, lobe);
        } else {
            direct += irradiance;
        }
        if (phong) {
            vec3 h = normalize(l + v);
            float v_h = clamp(dot(v, h), 0.0, 1.0);
            vec3 f = fresnel(material.specular.rgb, 1.0, v_h);
            float distribution = RECIPROCAL_PI * (shininess * 0.5 + 1.0) * pow(clamp(dot(n, h), 0.0, 1.0), shininess);
            highlight += irradiance * f * (0.25 * distribution * specular_strength);
        }
    }

    vec3 lit = (direct + ambient * occlusion) * base * RECIPROCAL_PI + highlight;
    if (standard) {
        vec2 fab = dfg(n_v, roughness);
        vec3 dielectric_single;
        vec3 dielectric_multiple;
        vec3 metallic_single;
        vec3 metallic_multiple;
        scattering(iridescence_f0_dielectric, f90, fab, dielectric_single, dielectric_multiple);
        scattering(iridescence_f0_metallic, f90, fab, metallic_single, metallic_multiple);
        vec3 single = mix(dielectric_single, metallic_single, metalness);
        vec3 multiple = mix(dielectric_multiple, metallic_multiple, metalness);
        vec3 diffuse_color = base * (1.0 - metalness) * (1.0 - (dielectric_single + dielectric_multiple));
        vec3 compensation = 1.0 + f0 * (1.0 / (fab.x + fab.y) - 1.0);
        vec3 diffuse_layer = base * (1.0 - metalness);
        float sheen_pass = has_sheen ? 1.0 - sheen_peak * sheen_albedo_v : 1.0;
        vec3 sheen_indirect = ambient * sheen_color * (sheen_albedo_v * RECIPROCAL_PI);
        vec3 clearcoat_indirect = vec3(0.0);
        vec3 diffuse_total = direct * diffuse_layer * RECIPROCAL_PI + ambient * diffuse_color * RECIPROCAL_PI * occlusion * sheen_pass;
        vec3 specular_total = highlight * compensation;
        if ((flags & 65536u) != 0u && frame.environment.x > 0.0) {
            float intensity = material.environment.x;
            float r2 = roughness * roughness;
            vec3 bent = n;
            if (lobe.anisotropic) {
                vec3 across = normalize(cross(cross(lobe.b, v), lobe.b));
                float k = 1.0 - anisotropy * (1.0 - roughness);
                bent = normalize(mix(across, n, k * k * k * k));
            }
            vec3 reflected = normalize(mix(reflect(-v, bent), bent, r2 * r2));
            vec3 radiance = environment_sample(reflected, roughness) * intensity;
            vec3 env_irradiance = environment_sample(n, 1.0) * intensity;
            float specular_occlusion = clamp(occlusion - (1.0 - pow(n_v + occlusion, exp2(-16.0 * roughness - 1.0))), 0.0, 1.0);
            specular_total += (radiance * single + multiple * env_irradiance) * specular_occlusion * sheen_pass;
            diffuse_total += diffuse_color * env_irradiance * occlusion * sheen_pass;
            sheen_indirect += env_irradiance * sheen_color * sheen_albedo_v;
            if (has_clearcoat) {
                float c2 = clearcoat_roughness * clearcoat_roughness;
                vec3 coat_reflected = normalize(mix(reflect(-v, clearcoat_normal), clearcoat_normal, c2 * c2));
                vec2 coat_fab = dfg(clamp(dot(clearcoat_normal, v), 0.0, 1.0), clearcoat_roughness);
                clearcoat_indirect = environment_sample(coat_reflected, clearcoat_roughness) * intensity * (0.04 * coat_fab.x + coat_fab.y);
            }
        }
        if ((flags & 524288u) != 0u) {
            float transmission = material.transmission.x;
            if (map_present(MAP_TRANSMISSION)) {
                transmission *= map_sample(MAP_TRANSMISSION, c).r;
            }
            float thickness = material.transmission.y;
            if (map_present(MAP_THICKNESS)) {
                thickness *= map_sample(MAP_THICKNESS, c).g;
            }
            float ior = material.layers.w;
            vec3 model_scale = vec3(length(object.model[0].xyz), length(object.model[1].xyz), length(object.model[2].xyz));
            float half_spread = (ior - 1.0) * 0.025 * material.transmission.w;
            vec3 iors = vec3(ior - half_spread, ior, ior + half_spread);
            vec3 transmitted = vec3(0.0);
            vec3 transmittance = vec3(0.0);
            float transmitted_alpha = 0.0;
            int channels = material.transmission.w > 0.0 ? 3 : 1;
            for (int k = 0; k < 3; k++) {
                if (k >= channels) {
                    break;
                }
                float channel_ior = channels == 3 ? iors[k] : ior;
                vec3 ray = normalize(refract(-v, n, 1.0 / channel_ior)) * thickness * model_scale;
                vec4 exit = frame.view_projection * vec4(v_world + ray, 1.0);
                vec2 ndc = exit.xy / exit.w;
                vec2 uv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
                float lod = min(log2(1.0 / frame.transmission.x) * roughness * clamp(channel_ior * 2.0 - 2.0, 0.0, 1.0), frame.transmission.z - 1.0);
                vec4 sampled = textureLod(transmission_map, uv, lod);
                vec3 attenuation = vec3(1.0);
                if (material.transmission.z > 0.0) {
                    attenuation = exp(log(max(material.attenuation.rgb, vec3(1e-6))) / material.transmission.z * length(ray));
                }
                vec3 through = diffuse_layer * attenuation;
                if (channels == 3) {
                    transmitted[k] = sampled[k];
                    transmittance[k] = through[k];
                } else {
                    transmitted = sampled.rgb;
                    transmittance = through;
                }
                transmitted_alpha += sampled.a;
            }
            transmitted_alpha /= float(channels);
            vec3 environment_f = f0 * fab.x + f90 * fab.y;
            vec3 refracted = (1.0 - environment_f) * transmittance * transmitted;
            float factor = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
            diffuse_total = mix(diffuse_total, refracted, transmission);
            alpha *= mix(1.0, 1.0 - (1.0 - transmitted_alpha) * factor, transmission);
        }
        lit = diffuse_total + specular_total;
        if (has_clearcoat) {
            float coat_fresnel = schlick(0.04, clamp(dot(clearcoat_normal, v), 0.0, 1.0));
            lit = lit * (1.0 - clearcoat * coat_fresnel) + (clearcoat_direct + clearcoat_indirect * occlusion) * clearcoat;
        }
        if (has_sheen) {
            lit += sheen_direct + sheen_indirect * occlusion;
        }
    }
    lit += emissive;
    return finish(fogged(lit, v_depth), alpha);
}

void main() {
    out_color = shade();
#ifdef OUTPUT_SRGB
    out_color.rgb = linear_to_srgb(out_color.rgb);
#endif
}
"#
    };
}
