//! The mesh pipeline's fragment stage.

macro_rules! mesh_fragment {
    () => {
        r#"@fragment
fn fragment(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    // flat shading: the triangle's normal from the position's screen-space change,
    // turned towards the viewer as three.js's is
    let flat_cross = cross(dpdx(input.world_position), dpdy(input.world_position));
    let to_eye = frame.camera_position.xyz - input.world_position;
    let flat_shaded = (u32(material.params.w) & 32u) != 0u && dot(flat_cross, flat_cross) > 0.0;
    let flat_normal = normalize(flat_cross) * select(-1.0, 1.0, dot(flat_cross, to_eye) >= 0.0);
    let geometry_normal = select(normalize(input.normal), flat_normal, flat_shaded);
    let face = select(select(-1.0, 1.0, front), 1.0, flat_shaded);
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
    let state_flags = u32(material.extra.x);
    fragment_pixel = input.clip_position.xy;
    if (clipped(input.world_position)) {
        discard;
    }
    if ((state_flags & 128u) != 0u) {
        // dashes along the line: drawn while the distance is within a dash of its period
        let period = max(material.dash.x + material.dash.y, 1e-6);
        let along = input.line_distance * material.dash.z;
        if (along - floor(along / period) * period > material.dash.x) {
            discard;
        }
    }
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
    if ((state_flags & 4u) != 0u && coverage < alpha_hash_threshold(input.world_position, position_dx, position_dy)) {
        discard;
    }
    var alpha = select(1.0, coverage, (flags & 2u) != 0u);

    let shading = u32(material.params.z + 0.5);
    if (shading == 7u) {
        // depth: the fragment's depth in the target, packed
        return pack_depth(input.clip_position.z, u32(material.depth_params.x + 0.5), coverage);
    }
    if (shading == 8u) {
        // distance from the camera between its near and far planes, packed into RGBA
        let distance = (length(input.world_position - frame.camera_position.xyz) - frame.clip.y) / max(frame.clip.z - frame.clip.y, 1e-6);
        return pack_depth(saturate(distance), 3201u, 1.0);
    }
    if (shading == 9u) {
        // shadow only: the colour where shadows fall, transparent elsewhere
        var mask = 1.0;
        if ((object_flags & 4u) != 0u) {
            mask = shadow_mask(input.world_position, geometry_normal, input.clip_position.xy);
        }
        return finish(fogged(material.color.rgb, input.depth), material.color.a * (1.0 - mask));
    }

    if (map_present(MAP_NORMAL) && (state_flags & 8u) != 0u) {
        // an object-space normal map: the normal as stored, turned with the object
        let sampled = map_sample(MAP_NORMAL, c).xyz * 2.0 - 1.0;
        n = normalize(mat3x3<f32>(object.normal_0.xyz, object.normal_1.xyz, object.normal_2.xyz) * sampled) * face;
    } else if (map_present(MAP_NORMAL)) {
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

    var specular_strength = 1.0;
    if (map_present(MAP_SPECULAR)) {
        specular_strength = map_sample(MAP_SPECULAR, c).r;
    }
    if (shading == 1u) {
        // three.js's basic material: the light map's irradiance over pi, else full light
        let indirect = select(vec3<f32>(1.0), baked * RECIPROCAL_PI, map_present(MAP_LIGHT));
        return finish(fogged(with_environment(base * indirect * occlusion, n, input.world_position, specular_strength), input.depth), alpha);
    }

    if (shading == 4u) {
        // The view-space normal packed into 0..1, which three.js treats as sRGB. Normal
        // materials have no fog.
        let view_normal = vec3<f32>(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz));
        return finish(srgb_to_linear(normalize(view_normal) * 0.5 + 0.5), alpha);
    }

    if (shading == 6u) {
        // a matcap: the colour the view-space normal points at on a lit sphere's image
        let view_normal = normalize(vec3<f32>(dot(n, frame.camera_right.xyz), dot(n, frame.camera_up.xyz), -dot(n, frame.camera_forward.xyz)));
        let to_eye = normalize(frame.camera_position.xyz - input.world_position);
        let view_dir = vec3<f32>(dot(to_eye, frame.camera_right.xyz), dot(to_eye, frame.camera_up.xyz), -dot(to_eye, frame.camera_forward.xyz));
        let x = normalize(vec3<f32>(view_dir.z, 0.0, -view_dir.x));
        let y = cross(view_dir, x);
        let uv = vec2<f32>(dot(x, view_normal), dot(y, view_normal)) * 0.495 + 0.5;
        var matcap = vec3<f32>(mix(0.2, 0.8, uv.y));
        if (map_present(MAP_MATCAP)) {
            let slot = u32(material.maps[2u * MAP_MATCAP].w + 0.5) - 1u;
            matcap = slot_sample(slot, vec2<f32>(uv.x, 1.0 - uv.y), vec2<f32>(0.0), vec2<f32>(0.0)).rgb;
        }
        return finish(fogged(base * matcap, input.depth), alpha);
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
    if (!standard) {
        lit = with_environment(lit, n, input.world_position, specular_strength);
    }
    return finish(fogged(lit, input.depth), alpha);
}

// A basic, Lambert or Phong material's own environment map (three.js `envMap` with
// `combine`, `reflectivity` and `refractionRatio`), sampled sharp along the reflected or
// refracted view ray.
fn with_environment(color: vec3<f32>, n: vec3<f32>, world: vec3<f32>, strength: f32) -> vec3<f32> {
    let state_flags = u32(material.extra.x);
    if ((state_flags & 32u) == 0u || frame.environment.x <= 0.0) {
        return color;
    }
    var incident = normalize(world - frame.camera_position.xyz);
    if (frame.camera_up.w < 0.5) {
        incident = frame.camera_forward.xyz;
    }
    var direction = reflect(incident, n);
    if ((state_flags & 64u) != 0u) {
        direction = refract(incident, n, material.dash.w);
    }
    let environment = environment_sample(direction, 0.0) * material.environment.x;
    let k = strength * material.extra.w;
    let combine = u32(material.extra.z + 0.5);
    if (combine == 1u) {
        return mix(color, environment, k);
    }
    if (combine == 2u) {
        return color + environment * k;
    }
    return mix(color, color * environment, k);
}
"#
    };
}
