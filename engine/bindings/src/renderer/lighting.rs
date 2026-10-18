//! Viewport, light probes, lights, shadows, fog and tone mapping.

use super::*;

#[wasm_bindgen]
impl Renderer {
    /// The size of the drawing buffer in pixels and the pixel ratio; points larger than
    /// a pixel, wide lines and transmission read them. Set before `prepare`.
    #[wasm_bindgen(js_name = setViewport)]
    pub fn set_viewport(&mut self, width: f32, height: f32, pixel_ratio: f32) {
        self.lighting.viewport = [width, height, pixel_ratio];
    }

    /// The summed spherical harmonics of the scene's light probes: 27 numbers, nine
    /// linear colours already times the intensity.
    #[wasm_bindgen(js_name = setLightProbe)]
    pub fn set_light_probe(&mut self, coefficients: &[f32]) {
        for (i, c) in coefficients.chunks_exact(3).take(9).enumerate() {
            self.lighting.probe[i] = wamr_math::Color::new(c[0], c[1], c[2]);
        }
    }

    /// Adds a rectangular area light (three.js `RectAreaLight`): its centre, half its
    /// width and half its height as world vectors (it shines along the cross product of
    /// the two), linear colour and intensity.
    #[wasm_bindgen(js_name = addRectAreaLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_rect_area_light(&mut self, x: f32, y: f32, z: f32, wx: f32, wy: f32, wz: f32, hx: f32, hy: f32, hz: f32, r: f32, g: f32, b: f32, intensity: f32) {
        self.lighting.lights.push(wamr_renderer::Light {
            kind: wamr_renderer::LightKind::RectArea,
            position: wamr_math::Vector3::new(x, y, z),
            direction: wamr_math::Vector3::new(wx, wy, wz),
            half_height: wamr_math::Vector3::new(hx, hy, hz),
            color: wamr_math::Color::new(r, g, b),
            intensity,
            ..Default::default()
        });
    }

    /// The VSM blur taps of the last light's shadow (three.js `shadow.blurSamples`).
    #[wasm_bindgen(js_name = setLastLightShadowBlur)]
    pub fn set_last_light_shadow_blur(&mut self, samples: u32) {
        if let Some(shadow) = self.lighting.lights.last_mut().and_then(|l| l.shadow.as_mut()) {
            shadow.blur_samples = samples;
        }
    }

    /// The most shadow maps per frame, layers of the shadow texture array: one per
    /// directional or spot light, six per point light.
    #[wasm_bindgen(js_name = maxShadows)]
    pub fn max_shadows() -> u32 {
        wamr_renderer::MAX_SHADOWS as u32
    }

    /// The renderer's global clipping planes in world space, four numbers each (normal and
    /// constant); at most eight are used.
    #[wasm_bindgen(js_name = setClippingPlanes)]
    pub fn set_clipping_planes(&mut self, planes: &[f32]) {
        self.lighting.clip_planes = planes.chunks_exact(4).take(wamr_core::MAX_CLIP_PLANES).map(|p| [p[0], p[1], p[2], p[3]]).collect();
    }

    /// three.js `Scene.overrideMaterial`: a material handle, or 0 for none.
    #[wasm_bindgen(js_name = setOverrideMaterial)]
    pub fn set_override_material(&mut self, handle: u64) {
        self.lighting.override_material = (handle != 0).then(|| material(handle));
    }

    /// three.js `renderer.shadowMap.enabled`.
    #[wasm_bindgen(js_name = setShadowsEnabled)]
    pub fn set_shadows_enabled(&mut self, enabled: bool) {
        self.lighting.shadows = enabled;
    }

    /// three.js `renderer.shadowMap.type`: 0 `BasicShadowMap`, 3 `VSMShadowMap`; any
    /// other value filters like `PCFShadowMap`.
    #[wasm_bindgen(js_name = setShadowType)]
    pub fn set_shadow_type(&mut self, kind: u8) {
        self.lighting.shadow_type = wamr_renderer::ShadowType::from_u8(kind);
    }

    /// Gives the light added last a shadow. `orthographic` selects the projection:
    /// `a, b, c, d` are left, right, top, bottom for an orthographic camera, or the
    /// field of view in degrees and the aspect for a perspective one. The shadow camera
    /// looks at the target. A point light uses only `near`, `far`, the bias, intensity,
    /// radius and map width: it draws six square 90 degree faces from its position.
    #[wasm_bindgen(js_name = setLastLightShadow)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_last_light_shadow(&mut self, orthographic: bool, a: f32, b: f32, c: f32, d: f32, near: f32, far: f32, target_x: f32, target_y: f32, target_z: f32, bias: f32, normal_bias: f32, intensity: f32, radius: f32, map_width: u32, map_height: u32) {
        let projection = if orthographic {
            wamr_renderer::ShadowProjection::Orthographic { left: a, right: b, top: c, bottom: d, near, far }
        } else {
            wamr_renderer::ShadowProjection::Perspective { fov: a, aspect: b, near, far }
        };
        if let Some(light) = self.lighting.lights.last_mut() {
            light.shadow = Some(wamr_renderer::LightShadow { projection, target: wamr_math::Vector3::new(target_x, target_y, target_z), bias, normal_bias, intensity, radius, blur_samples: 8, map_width, map_height });
        }
    }

    /// Shadow passes of the last prepared frame.
    #[wasm_bindgen(js_name = shadowCount)]
    pub fn shadow_count(&self) -> u32 {
        self.frame.shadows.len() as u32
    }

    /// Width and height of each layer of the shadow texture array.
    #[wasm_bindgen(js_name = shadowMapSize)]
    pub fn shadow_map_size(&self) -> Vec<u32> {
        vec![self.frame.shadow_map_width, self.frame.shadow_map_height]
    }

    /// Layer, width and height of a pass's map, then its view-projection (16 floats).
    #[wasm_bindgen(js_name = shadowPassInfo)]
    pub fn shadow_pass_info(&self, pass: u32) -> Vec<f32> {
        self.frame.shadows.get(pass as usize).map_or_else(Vec::new, |p| {
            let mut out = vec![p.layer as f32, p.width as f32, p.height as f32];
            out.extend(p.view_projection);
            out
        })
    }

    /// Like `drawInfo`, for the casters of a shadow pass. The texture set and material
    /// are indices into the frame's lists (`textureSets`, `materialUniforms`).
    #[wasm_bindgen(js_name = shadowDrawInfo)]
    pub fn shadow_draw_info(&self, pass: u32) -> Vec<u32> {
        let (Some(p), Some(sets)) = (self.frame.shadows.get(pass as usize), self.shadow_texture_sets.get(pass as usize)) else {
            return Vec::new();
        };
        p.draws.iter().zip(sets).flat_map(|(d, set)| [d.pipeline, *set, d.start, d.count, d.instances, d.instance_count, d.material, 0]).collect()
    }

    /// Like `drawGeometrySlots`, for the casters of a shadow pass.
    #[wasm_bindgen(js_name = shadowDrawGeometrySlots)]
    pub fn shadow_draw_geometry_slots(&self, pass: u32) -> Vec<u32> {
        self.shadow_geometry_slots.get(pass as usize).cloned().unwrap_or_default()
    }

    /// Object uniforms of a shadow pass (only the model matrix is read), same stride as
    /// `objectUniforms`.
    #[wasm_bindgen(js_name = shadowObjectUniforms)]
    pub fn shadow_object_uniforms(&self, pass: u32) -> Vec<f32> {
        self.frame.shadows.get(pass as usize).map_or_else(Vec::new, |p| p.object_uniforms.clone())
    }

    /// Index in `frameUniforms` of the tone mapping (a three.js constant, 0 for none);
    /// the exposure follows `TONE_MAPPING_EXPOSURE_INDEX`.
    #[wasm_bindgen(js_name = toneMappingIndex)]
    pub fn tone_mapping_index() -> u32 {
        wamr_renderer::TONE_MAPPING_INDEX as u32
    }

    #[wasm_bindgen(js_name = toneMappingExposureIndex)]
    pub fn tone_mapping_exposure_index() -> u32 {
        wamr_renderer::TONE_MAPPING_EXPOSURE_INDEX as u32
    }

    /// Bytes per object in `objectUniforms`.
    #[wasm_bindgen(js_name = objectUniformSize)]
    pub fn object_uniform_size() -> u32 {
        (wamr_renderer::OBJECT_UNIFORM_FLOATS * 4) as u32
    }

    /// Bytes of each object's uniforms that the shader reads.
    #[wasm_bindgen(js_name = objectBindingSize)]
    pub fn object_binding_size() -> u32 {
        (wamr_renderer::OBJECT_BINDING_FLOATS * 4) as u32
    }

    /// Lights beyond this many are ignored.
    #[wasm_bindgen(js_name = maxLights)]
    pub fn max_lights() -> u32 {
        wamr_renderer::MAX_LIGHTS as u32
    }

    /// Fog: `kind` 0 none, 1 linear between `near` and `far`, 2 exponential squared
    /// with `density`. The colour is linear.
    #[wasm_bindgen(js_name = setFog)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_fog(&mut self, kind: u8, r: f32, g: f32, b: f32, near: f32, far: f32, density: f32) {
        let kind = match kind {
            1 => wamr_renderer::FogKind::Linear,
            2 => wamr_renderer::FogKind::Exponential,
            _ => wamr_renderer::FogKind::None,
        };
        self.lighting.fog = wamr_renderer::Fog { kind, color: wamr_math::Color::new(r, g, b), near, far, density };
    }

    /// Tone mapping of the output, as a three.js constant (0 none, 1 linear, 2 Reinhard,
    /// 3 Cineon, 4 ACES filmic, 6 AgX, 7 neutral), and its exposure.
    #[wasm_bindgen(js_name = setToneMapping)]
    pub fn set_tone_mapping(&mut self, kind: u8, exposure: f32) {
        self.lighting.tone_mapping = wamr_renderer::ToneMapping::from_u8(kind);
        self.lighting.exposure = exposure;
    }

    #[wasm_bindgen(js_name = clearLights)]
    pub fn clear_lights(&mut self) {
        self.lighting.lights.clear();
    }

    /// Adds a directional light: direction towards the light, linear colour, intensity.
    #[wasm_bindgen(js_name = addDirectionalLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_directional_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        let light = wamr_renderer::Light { direction: wamr_math::Vector3::new(x, y, z), color: wamr_math::Color::new(r, g, b), intensity, ..Default::default() };
        self.lighting.lights.push(light);
    }

    /// Adds a point light at a world position. `distance` 0 means no cutoff.
    #[wasm_bindgen(js_name = addPointLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_point_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32, distance: f32, decay: f32) {
        self.lighting.lights.push(wamr_renderer::Light {
            kind: wamr_renderer::LightKind::Point,
            position: wamr_math::Vector3::new(x, y, z),
            color: wamr_math::Color::new(r, g, b),
            intensity,
            distance,
            decay,
            ..Default::default()
        });
    }

    /// Adds a spot light at a world position shining at a world target. `angle` is the
    /// cone's half angle in radians; `penumbra` (0..1) is the soft share of the cone.
    #[wasm_bindgen(js_name = addSpotLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_spot_light(&mut self, x: f32, y: f32, z: f32, target_x: f32, target_y: f32, target_z: f32, r: f32, g: f32, b: f32, intensity: f32, distance: f32, decay: f32, angle: f32, penumbra: f32) {
        self.lighting.lights.push(wamr_renderer::Light {
            kind: wamr_renderer::LightKind::Spot,
            position: wamr_math::Vector3::new(x, y, z),
            direction: wamr_math::Vector3::new(x - target_x, y - target_y, z - target_z),
            color: wamr_math::Color::new(r, g, b),
            intensity,
            distance,
            decay,
            cone_cos: (angle as f64).cos() as f32,
            penumbra_cos: (angle as f64 * (1.0 - penumbra as f64)).cos() as f32,
            ..Default::default()
        });
    }

    /// Replaces all lights with one directional light.
    #[wasm_bindgen(js_name = setDirectionalLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_directional_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        self.lighting.lights.clear();
        self.add_directional_light(x, y, z, r, g, b, intensity);
    }

    /// Ambient light from above (sky) and below (ground), linear colours.
    #[wasm_bindgen(js_name = setAmbientLight)]
    pub fn set_ambient_light(&mut self, sky_r: f32, sky_g: f32, sky_b: f32, ground_r: f32, ground_g: f32, ground_b: f32) {
        self.lighting.sky = wamr_math::Color::new(sky_r, sky_g, sky_b);
        self.lighting.ground = wamr_math::Color::new(ground_r, ground_g, ground_b);
    }
}
