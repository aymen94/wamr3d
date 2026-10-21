//! Shader sources, environments and the background.

use super::*;

#[wasm_bindgen]
impl Renderer {
    /// WGSL source of the mesh pipeline.
    #[wasm_bindgen(js_name = shaderSource)]
    pub fn shader_source() -> String {
        wamr_renderer::shader_source()
    }

    /// The split-sum table the mesh pipeline reads at group 0, binding 1: 512 floats
    /// (a uniform `array<vec4<f32>, 128>`), the same for every frame.
    #[wasm_bindgen(js_name = dfgTable)]
    pub fn dfg_table() -> Vec<f32> {
        wamr_renderer::dfg_table()
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
}
