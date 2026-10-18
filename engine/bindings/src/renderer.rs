//! The `Renderer` class: prepares frames for the WebGPU host (`webgpu.js`).

use super::*;

mod sources;
mod lighting;

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
/// colour have a buffer each; tangent, second uv set, skinning and line distances are
/// interleaved by the host into one (see `AUX_KEY`).
const VERTEX_ATTRIBUTES: [(&str, usize); 9] = [("position", 3), ("normal", 3), ("uv", 2), ("color", 3), ("tangent", 4), ("uv1", 2), ("skinIndex", 4), ("skinWeight", 4), ("lineDistance", 1)];

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
