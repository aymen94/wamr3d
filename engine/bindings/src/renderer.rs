//! The `Renderer` class: prepares frames for the WebGPU host (`webgpu.js`).

use super::*;

// ---------------------------------------------------------------- Renderer

/// Prepares frames for the WebGPU host: culling, draw order, uniform data and shader.
/// The host (`webgpu.js` in the package) issues the GPU calls.
#[wasm_bindgen]
#[derive(Default)]
pub struct Renderer {
    lighting: wamr_renderer::Lighting,
    frame: wamr_renderer::Frame,
    /// Per draw, the record in `geometry_state` that describes its geometry.
    geometry_slots: Vec<u32>,
    /// The same for the draws of each shadow pass.
    shadow_geometry_slots: Vec<Vec<u32>>,
    /// [`GEOMETRY_STATE_FIELDS`] numbers per distinct geometry of the frame.
    geometry_state: Vec<u32>,
    /// The distinct texture sets of the frame, `TEXTURE_SLOTS` ids each, so that the host
    /// makes one bind group per set rather than per draw.
    texture_sets: Vec<u32>,
    /// Per draw, its set in `texture_sets`.
    draw_texture_sets: Vec<u32>,
    /// The same for the draws of each shadow pass.
    shadow_texture_sets: Vec<Vec<u32>>,
}

/// Vertex inputs of the shader with their floats per vertex: position, normal, uv and
/// colour have a buffer each; tangent, second uv set and skinning are interleaved by the
/// host into one (see `AUX_KEY`).
const VERTEX_ATTRIBUTES: [(&str, usize); 8] = [("position", 3), ("normal", 3), ("uv", 2), ("color", 3), ("tangent", 4), ("uv1", 2), ("skinIndex", 4), ("skinWeight", 4)];

/// Slot index, generation, vertex count, a (version, address) pair per vertex input,
/// index version, floats per colour (3 or 4).
pub(crate) const GEOMETRY_STATE_FIELDS: usize = 3 + VERTEX_ATTRIBUTES.len() * 2 + 2;

/// Appends what the host needs to keep the GPU copy of `handle` current. An input that
/// is missing, not float, or of the wrong length gets address 0, and the host binds
/// zeros in its place. An address is valid until the attribute is replaced or the
/// geometry disposed; a view over it must be created after the last allocation, since
/// memory growth detaches earlier views.
fn push_geometry_state(out: &mut Vec<u32>, world: &wamr_core::World, handle: GeometryHandle) {
    let start = out.len();
    out.extend([handle.index(), handle.generation()]);
    if let Some(geometry) = world.geometry(handle) {
        let vertices = geometry.get_attribute("position").map_or(0, |a| a.count());
        out.push(vertices as u32);
        // colours may carry alpha; the renderer then marks the draw's pipeline
        let color_size = geometry.get_attribute("color").map_or(3, |a| if a.item_size == 4 { 4 } else { 3 });
        for (name, size) in VERTEX_ATTRIBUTES {
            let size = if name == "color" { color_size } else { size };
            let state = geometry.get_attribute(name).and_then(|a| match &a.array {
                AttributeArray::Float32(values) if a.item_size == size && values.len() == vertices * size => Some([a.version, values.as_ptr() as usize as u32]),
                _ => None,
            });
            out.extend(state.unwrap_or([0, 0]));
        }
        out.push(geometry.get_index().map_or(0, |index| index.version));
        out.push(color_size as u32);
    }
    out.resize(start + GEOMETRY_STATE_FIELDS, 0);
}

#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Renderer {
        Renderer::default()
    }

    /// WGSL source of the mesh pipeline.
    #[wasm_bindgen(js_name = shaderSource)]
    pub fn shader_source() -> String {
        wamr_renderer::shader_source()
    }

    /// WGSL source of the passes that prefilter an environment map (three.js PMREM).
    #[wasm_bindgen(js_name = pmremShaderSource)]
    pub fn pmrem_shader_source() -> String {
        wamr_renderer::pmrem_shader_source()
    }

    /// Lights standard materials that use it with an equirectangular environment map:
    /// the host's texture id, the source image width, and the rotation of sampling
    /// directions as a 3x3 matrix (column-major, already inverted).
    #[wasm_bindgen(js_name = setEnvironment)]
    pub fn set_environment(&mut self, texture: u32, source_width: u32, rotation: &[f32]) {
        let mut matrix = wamr_math::Matrix3::default();
        if rotation.len() == 9 {
            matrix.elements.copy_from_slice(rotation);
        }
        self.lighting.environment = Some(wamr_renderer::Environment { texture, source_width, rotation: matrix });
    }

    #[wasm_bindgen(js_name = clearEnvironment)]
    pub fn clear_environment(&mut self) {
        self.lighting.environment = None;
    }

    /// The environments of the last prepared frame, stacked in one texture: the `lodMax`
    /// they are all prefiltered at, the width and height of one prefiltered map, then the
    /// texture id of each in stacking order; empty without any.
    #[wasm_bindgen(js_name = environmentInfo)]
    pub fn environment_info(&self) -> Vec<u32> {
        if self.frame.environments.is_empty() {
            return Vec::new();
        }
        let lod = self.frame.environment_lod_max;
        let (width, height) = wamr_renderer::layout_size_for_lod(lod);
        let mut out = vec![lod, width, height];
        out.extend(self.frame.environments.iter().map(|e| e.texture));
        out
    }

    /// Draws a texture behind the scene (three.js `scene.background`): `kind` 0 for an
    /// equirectangular image, 1 for the same blurred by `blurriness` (from its
    /// prefiltered map), 2 for an image filling the frame. `source_width` is the image
    /// width in pixels; `rotation` turns view directions (column-major 3x3, already
    /// inverted).
    #[wasm_bindgen(js_name = setBackground)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_background(&mut self, texture: u32, kind: u8, source_width: u32, intensity: f32, blurriness: f32, rotation: &[f32]) {
        let mut matrix = wamr_math::Matrix3::default();
        if rotation.len() == 9 {
            matrix.elements.copy_from_slice(rotation);
        }
        let kind = match kind {
            1 => wamr_renderer::BackgroundKind::Blurred,
            2 => wamr_renderer::BackgroundKind::Screen,
            _ => wamr_renderer::BackgroundKind::Equirectangular,
        };
        self.lighting.background = Some(wamr_renderer::Background { texture, kind, source_width, intensity, blurriness, rotation: matrix });
    }

    #[wasm_bindgen(js_name = clearBackground)]
    pub fn clear_background(&mut self) {
        self.lighting.background = None;
    }

    /// The background of the last prepared frame: texture id, kind, and `lodMax` of the
    /// prefiltered map; empty without one.
    #[wasm_bindgen(js_name = backgroundInfo)]
    pub fn background_info(&self) -> Vec<u32> {
        self.frame.background.map_or_else(Vec::new, |b| vec![b.texture, b.kind as u32, b.prefiltered().lod_max()])
    }

    /// Uniforms of the background pass of the last prepared frame (see
    /// `backgroundShaderSource`); empty without a background.
    #[wasm_bindgen(js_name = backgroundUniforms)]
    pub fn background_uniforms(&self) -> Vec<f32> {
        self.frame.background_uniforms.clone()
    }

    /// GLSL ES 3.00 source of a pass, for the WebGL 2 host (`webgl.js`): `mesh.vert`,
    /// `mesh.frag`, `shadow.vert`, `shadow.frag`, `fullscreen.vert`, `background.frag`,
    /// `output.frag`, `pmrem.vert`, `pmrem.equirect`, `pmrem.ggx` or `cube.equirect`; empty
    /// for others.
    #[wasm_bindgen(js_name = glslSource)]
    pub fn glsl_source(name: &str) -> String {
        wamr_renderer::glsl_source(name).unwrap_or_default()
    }

    /// WGSL source of the background pass.
    #[wasm_bindgen(js_name = backgroundShaderSource)]
    pub fn background_shader_source() -> String {
        wamr_renderer::background_shader_source()
    }

    /// WGSL source of the output pass that tone-maps a linear frame onto the canvas.
    #[wasm_bindgen(js_name = outputShaderSource)]
    pub fn output_shader_source() -> String {
        wamr_renderer::output_shader_source()
    }

    /// WGSL source of the pass that turns a cube texture into an equirectangular image.
    #[wasm_bindgen(js_name = cubeToEquirectShaderSource)]
    pub fn cube_to_equirect_shader_source() -> String {
        wamr_renderer::CUBE_TO_EQUIRECT_SHADER.to_string()
    }

    /// WGSL source of the shadow pipelines: entry points `vertex` and `fragment` (only
    /// for casters with an alpha test).
    #[wasm_bindgen(js_name = shadowShaderSource)]
    pub fn shadow_shader_source() -> String {
        wamr_renderer::shadow_shader_source()
    }

    /// WGSL source of the VSM blur: entry points `vertex`, `vertical` and `horizontal`.
    #[wasm_bindgen(js_name = vsmShaderSource)]
    pub fn vsm_shader_source() -> String {
        wamr_renderer::VSM_SHADER.to_string()
    }

    /// Bytes per material in `materialUniforms`.
    #[wasm_bindgen(js_name = materialUniformSize)]
    pub fn material_uniform_size() -> u32 {
        (wamr_renderer::MATERIAL_UNIFORM_FLOATS * 4) as u32
    }

    /// Address of the material blocks of the last prepared frame inside the module's
    /// memory; valid until the next `prepare` or memory growth.
    #[wasm_bindgen(js_name = materialUniformsPtr)]
    pub fn material_uniforms_ptr(&self) -> u32 {
        self.frame.material_uniforms.as_ptr() as u32
    }

    /// Number of floats at `materialUniformsPtr`.
    #[wasm_bindgen(js_name = materialUniformsLength)]
    pub fn material_uniforms_length(&self) -> u32 {
        self.frame.material_uniforms.len() as u32
    }

    /// Address of the frame's skinning matrices (16 floats each, 256 per row of the bone
    /// texture); valid until the next `prepare` or memory growth.
    #[wasm_bindgen(js_name = skinMatricesPtr)]
    pub fn skin_matrices_ptr(&self) -> u32 {
        self.frame.skin_matrices.as_ptr() as u32
    }

    /// Number of floats at `skinMatricesPtr`.
    #[wasm_bindgen(js_name = skinMatricesLength)]
    pub fn skin_matrices_length(&self) -> u32 {
        self.frame.skin_matrices.len() as u32
    }

    /// How many of the first draws are opaque.
    #[wasm_bindgen(js_name = opaqueCount)]
    pub fn opaque_count(&self) -> u32 {
        self.frame.opaque_count
    }

    /// How many transmissive draws follow the opaque ones.
    #[wasm_bindgen(js_name = transmissiveCount)]
    pub fn transmissive_count(&self) -> u32 {
        self.frame.transmissive_count
    }

    /// The shadow filter of the last prepared frame: 0 basic, 1 PCF, 2 VSM.
    #[wasm_bindgen(js_name = shadowFilter)]
    pub fn shadow_filter(&self) -> u8 {
        self.frame.shadow_type as u8
    }

    /// For a shadow pass, its VSM blur radius in texels and taps.
    #[wasm_bindgen(js_name = shadowBlur)]
    pub fn shadow_blur(&self, pass: u32) -> Vec<f32> {
        self.frame.shadow_blur.get(pass as usize).map_or_else(Vec::new, |b| b.to_vec())
    }

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

    /// Builds the frame for `camera` looking at the subtree of `root` and returns the
    /// number of draws. World matrices must be up to date.
    pub fn prepare(&mut self, world: &mut World, root: u64, camera: u64) -> Result<u32, JsError> {
        self.frame = wamr_renderer::prepare_frame(&mut world.inner, entity(root), entity(camera), &self.lighting)
            .ok_or_else(|| JsError::new("object is not a camera"))?;

        self.geometry_slots.clear();
        self.geometry_state.clear();
        self.shadow_geometry_slots.clear();
        let mut records: std::collections::HashMap<GeometryHandle, u32> = std::collections::HashMap::new();
        let state = &mut self.geometry_state;
        let mut slot_of = |geometry: GeometryHandle| -> u32 {
            *records.entry(geometry).or_insert_with(|| {
                let slot = (state.len() / GEOMETRY_STATE_FIELDS) as u32;
                push_geometry_state(state, &world.inner, geometry);
                slot
            })
        };
        for draw in &self.frame.draws {
            self.geometry_slots.push(slot_of(draw.geometry));
        }
        for pass in &self.frame.shadows {
            self.shadow_geometry_slots.push(pass.draws.iter().map(|d| slot_of(d.geometry)).collect());
        }

        self.texture_sets.clear();
        self.draw_texture_sets.clear();
        self.shadow_texture_sets.clear();
        let mut sets: std::collections::HashMap<[u32; wamr_renderer::TEXTURE_SLOTS], u32> = std::collections::HashMap::new();
        // Draws are ordered by state, so neighbours usually share a set: comparing with the
        // previous draw skips hashing the twelve ids for most of them.
        let texture_sets = &mut self.texture_sets;
        let mut intern = |draws: &[wamr_renderer::Draw], out: &mut Vec<u32>| {
            let mut previous: Option<([u32; wamr_renderer::TEXTURE_SLOTS], u32)> = None;
            for draw in draws {
                let set = match previous {
                    Some((textures, set)) if textures == draw.textures => set,
                    _ => {
                        let next = sets.len() as u32;
                        let set = *sets.entry(draw.textures).or_insert_with(|| {
                            texture_sets.extend(draw.textures);
                            next
                        });
                        previous = Some((draw.textures, set));
                        set
                    }
                };
                out.push(set);
            }
        };
        intern(&self.frame.draws, &mut self.draw_texture_sets);
        for pass in &self.frame.shadows {
            let mut out = Vec::with_capacity(pass.draws.len());
            intern(&pass.draws, &mut out);
            self.shadow_texture_sets.push(out);
        }

        Ok(self.frame.draws.len() as u32)
    }

    /// Numbers per record of `geometryState`.
    #[wasm_bindgen(js_name = geometryStateSize)]
    pub fn geometry_state_size() -> u32 {
        GEOMETRY_STATE_FIELDS as u32
    }

    /// One record per distinct geometry of the last prepared frame: slot index and
    /// generation of the handle, vertex count, then for position, normal, uv and colour
    /// the attribute's version and the address of its floats (0 when the shader input
    /// cannot use it), then the index version and the floats per colour (3 or 4).
    /// Everything the host needs to decide what to upload, in one call.
    #[wasm_bindgen(js_name = geometryState)]
    pub fn geometry_state(&self) -> Vec<u32> {
        self.geometry_state.clone()
    }

    /// Per draw, which record of `geometryState` describes its geometry.
    #[wasm_bindgen(js_name = drawGeometrySlots)]
    pub fn draw_geometry_slots(&self) -> Vec<u32> {
        self.geometry_slots.clone()
    }

    /// Objects that had something to draw before culling, in the last prepared frame.
    #[wasm_bindgen(js_name = candidateCount)]
    pub fn candidate_count(&self) -> u32 {
        self.frame.candidates as u32
    }

    #[wasm_bindgen(js_name = frameUniforms)]
    pub fn frame_uniforms(&self) -> Vec<f32> {
        self.frame.frame_uniforms.clone()
    }

    /// Address of the object uniform data inside the module's memory, for a view
    /// without a copy. Valid until the next `prepare` or memory growth.
    #[wasm_bindgen(js_name = objectUniformsPtr)]
    pub fn object_uniforms_ptr(&self) -> u32 {
        self.frame.object_uniforms.as_ptr() as u32
    }

    /// Number of floats at `objectUniformsPtr`.
    #[wasm_bindgen(js_name = objectUniformsLength)]
    pub fn object_uniforms_length(&self) -> u32 {
        self.frame.object_uniforms.len() as u32
    }

    #[wasm_bindgen(js_name = objectUniforms)]
    pub fn object_uniforms(&self) -> Vec<f32> {
        self.frame.object_uniforms.clone()
    }

    /// The geometry handle of each draw, in draw order.
    #[wasm_bindgen(js_name = drawGeometries)]
    pub fn draw_geometries(&self) -> Vec<u64> {
        self.frame.draws.iter().map(|d| d.geometry.to_bits()).collect()
    }

    /// Eight numbers per draw, in draw order: pipeline state, texture set (see
    /// `textureSets`), first index or vertex, count, instance data id (0 for none),
    /// number of instances, material block (see `materialUniforms`) and the material's
    /// custom shader (0 none, 1-6 an effect, 16 and above a host shader material). Pipeline state
    /// bits: 0-1 side (0 front, 1 back, 2 both), 2 blending, 3 depth write, 4 depth test,
    /// 5-6 primitive (0 triangles, 1 line strip, 2 line list, 3 points), 7 line loop, 8
    /// colours of four floats, 9 wireframe (a line list over the edges of the triangles
    /// from first to first + count), 10 tangent, second uv set or skinning present, 11-13
    /// blending mode, 14 premultiplied alpha, 15 points or lines drawn as quads.
    #[wasm_bindgen(js_name = drawInfo)]
    pub fn draw_info(&self) -> Vec<u32> {
        self.frame.draws.iter().zip(&self.draw_texture_sets).flat_map(|(d, set)| [d.pipeline, *set, d.start, d.count, d.instances, d.instance_count, d.material, d.custom]).collect()
    }

    /// WGSL of the full-screen effects (see `Renderer.effectEntryPoint`).
    #[wasm_bindgen(js_name = effectShaderSource)]
    pub fn effect_shader_source() -> String {
        wamr_renderer::effect_shader_source()
    }

    /// The entry point (WGSL) or name after `effect.` (GLSL) of an effect id, empty for
    /// other ids.
    #[wasm_bindgen(js_name = effectEntryPoint)]
    pub fn effect_entry_point(id: u32) -> String {
        (1..=6).contains(&id).then(|| wamr_renderer::EFFECT_ENTRY_POINTS[id as usize - 1].to_string()).unwrap_or_default()
    }

    /// Numbers per draw in `drawInfo` and `shadowDrawInfo`.
    #[wasm_bindgen(js_name = drawInfoSize)]
    pub fn draw_info_size() -> u32 {
        8
    }

    /// Bit of the pipeline state set for points and lines drawn as quads.
    #[wasm_bindgen(js_name = quadKey)]
    pub fn quad_key() -> u32 {
        wamr_renderer::QUAD_KEY
    }

    /// Bit of the pipeline state set when the geometry has tangents, a second uv set or
    /// skinning attributes.
    #[wasm_bindgen(js_name = auxKey)]
    pub fn aux_key() -> u32 {
        wamr_renderer::AUX_KEY
    }

    /// Matrices per row of the bone texture.
    #[wasm_bindgen(js_name = boneTextureMatricesPerRow)]
    pub fn bone_texture_matrices_per_row() -> u32 {
        wamr_renderer::BONE_TEXTURE_MATRICES_PER_ROW as u32
    }

    /// The texture sets of the last prepared frame, `textureSlots()` ids each (colour,
    /// normal, roughness, metalness, emissive, alpha, ambient-occlusion, light, bump,
    /// displacement, specular and gradient maps; 0 for none). `drawInfo` gives each
    /// draw's set.
    #[wasm_bindgen(js_name = textureSets)]
    pub fn texture_sets(&self) -> Vec<u32> {
        self.texture_sets.clone()
    }

    /// Texture ids per set in `textureSets`.
    #[wasm_bindgen(js_name = textureSlots)]
    pub fn texture_slots() -> u32 {
        wamr_renderer::TEXTURE_SLOTS as u32
    }

    /// Slot of the displacement map in a texture set: the one texture the vertex stage
    /// samples.
    #[wasm_bindgen(js_name = displacementSlot)]
    pub fn displacement_slot() -> u32 {
        wamr_renderer::DISPLACEMENT_SLOT as u32
    }
}
