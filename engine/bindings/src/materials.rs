//! The `World` methods for the newer material settings, skins and morph targets.

use super::*;

fn matrix4(values: &[f32]) -> Result<wamr_math::Matrix4, JsError> {
    let elements: [f32; 16] = values.try_into().map_err(|_| JsError::new("a matrix has 16 numbers"))?;
    Ok(wamr_math::Matrix4 { elements })
}

#[wasm_bindgen]
impl World {
    /// The uv transform and uv set (0 `uv`, 1 `uv1`) of one map of a material, by its
    /// index in the map table: 0 colour, 1 normal, 2 roughness, 3 metalness, 4 emissive, 5
    /// alpha, 6 ambient occlusion, 7 light, 8 bump, 9 displacement, 10 specular, 11
    /// gradient, 12 clearcoat, 13 clearcoat roughness, 14 clearcoat normal, 15 sheen
    /// colour, 16 sheen roughness, 17 specular intensity, 18 specular colour, 19
    /// transmission, 20 thickness, 21 iridescence, 22 iridescence thickness, 23
    /// anisotropy, 24 matcap.
    #[wasm_bindgen(js_name = setMaterialMapUv)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_map_uv(&mut self, handle: u64, map: u32, offset_x: f32, offset_y: f32, repeat_x: f32, repeat_y: f32, rotation: f32, center_x: f32, center_y: f32, channel: u8) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        let uv = material.map_uvs.get_mut(map as usize).ok_or_else(|| JsError::new("map index out of range"))?;
        uv.transform.set_uv_transform(offset_x, offset_y, repeat_x, repeat_y, rotation, center_x, center_y);
        uv.channel = channel.min(1);
        if map == 0 {
            material.map_transform = uv.transform;
        }
        Ok(())
    }

    /// The textures of one or more maps by table index (see `setMaterialMapUv`):
    /// `ids[i]` for map `first + i`, 0 for none. The colour map is map 0.
    #[wasm_bindgen(js_name = setMaterialMapTextures)]
    pub fn set_material_map_textures(&mut self, handle: u64, first: u32, ids: &[u32]) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        for (i, id) in ids.iter().enumerate() {
            match wamr_core::MapSlot::from_index(first as usize + i) {
                Some(wamr_core::MapSlot::Color) => material.map = *id,
                Some(slot) => material.maps.set(slot, *id),
                None => return Err(JsError::new("map index out of range")),
            }
        }
        Ok(())
    }

    /// The light-through and thin-film layers of three.js `MeshPhysicalMaterial`:
    /// `transmission`, `thickness`, linear `attenuationColor`, `attenuationDistance`
    /// (Infinity for none), `dispersion`, `iridescence`, `iridescenceIOR`,
    /// `iridescenceThicknessRange`, `anisotropy`, `anisotropyRotation` and
    /// `clearcoatNormalScale`.
    #[wasm_bindgen(js_name = setMaterialPhysicalExtensions)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_physical_extensions(
        &mut self,
        handle: u64,
        transmission: f32,
        thickness: f32,
        attenuation_r: f32,
        attenuation_g: f32,
        attenuation_b: f32,
        attenuation_distance: f32,
        dispersion: f32,
        iridescence: f32,
        iridescence_ior: f32,
        thickness_min: f32,
        thickness_max: f32,
        anisotropy: f32,
        anisotropy_rotation: f32,
        clearcoat_normal_scale_x: f32,
        clearcoat_normal_scale_y: f32,
    ) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.transmission = transmission;
        material.thickness = thickness;
        material.attenuation_color = wamr_math::Color::new(attenuation_r, attenuation_g, attenuation_b);
        material.attenuation_distance = attenuation_distance;
        material.dispersion = dispersion;
        material.iridescence = iridescence;
        material.iridescence_ior = iridescence_ior;
        material.iridescence_thickness = [thickness_min, thickness_max];
        material.anisotropy = anisotropy;
        material.anisotropy_rotation = anisotropy_rotation;
        material.clearcoat_normal_scale = [clearcoat_normal_scale_x, clearcoat_normal_scale_y];
        Ok(())
    }

    /// three.js `blending` (0 none, 1 normal, 2 additive, 3 subtractive, 4 multiply, 5
    /// custom), `premultipliedAlpha`, and the packed factors and equations of custom
    /// blending (see `Material::custom_blending`).
    #[wasm_bindgen(js_name = setMaterialBlending)]
    pub fn set_material_blending(&mut self, handle: u64, blending: u8, premultiplied_alpha: bool, custom_blending: u32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.blending = blending.min(5);
        material.premultiplied_alpha = premultiplied_alpha;
        material.custom_blending = custom_blending & 0x3f_ffff;
        Ok(())
    }

    /// three.js `flatShading`: each triangle lit with its own face normal.
    #[wasm_bindgen(js_name = setMaterialFlatShading)]
    pub fn set_material_flat_shading(&mut self, handle: u64, flat_shading: bool) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.flat_shading = flat_shading;
        Ok(())
    }

    /// `PointsMaterial.size` and a line material's `linewidth`, in pixels. Above 1 they
    /// are drawn as quads.
    #[wasm_bindgen(js_name = setMaterialSizes)]
    pub fn set_material_sizes(&mut self, handle: u64, point_size: f32, line_width: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.point_size = point_size;
        material.line_width = line_width;
        Ok(())
    }

    /// A standard material's own environment map (three.js `envMap`): the host's texture
    /// id (0 for none, the frame's environment is used), the width of its equirectangular
    /// image, and the inverted rotation of sampling directions (column-major 3x3).
    #[wasm_bindgen(js_name = setMaterialEnvMap)]
    pub fn set_material_env_map(&mut self, handle: u64, texture: u32, width: u32, rotation: &[f32]) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.env_map = texture;
        material.env_map_width = width;
        if rotation.len() == 9 {
            material.env_map_rotation.elements.copy_from_slice(rotation);
        }
        Ok(())
    }

    /// Draws a material with a custom shader (1-6 the renderer's effects, 16 and above a
    /// host's shader materials; 0 the built-in shading) and its 16 settings.
    #[wasm_bindgen(js_name = setMaterialCustom)]
    pub fn set_material_custom(&mut self, handle: u64, custom: u32, params: &[f32]) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.custom = custom;
        material.custom_params = [0.0; 16];
        for (out, value) in material.custom_params.iter_mut().zip(params) {
            *out = *value;
        }
        Ok(())
    }

    /// The fixed-function state and shading switches of a material (see
    /// `wamr_core::RenderState`), as numbers in this order: visible, depth function,
    /// colour write, polygon offset, its factor and units, alpha to coverage, dithering,
    /// alpha hash, fog, object-space normal map, blend colour r, g, b and alpha, stencil
    /// write, function, reference, function mask, write mask, fail, depth fail and pass
    /// operations (three.js constants), clip intersection, clip shadows, allow override,
    /// environment combine (0 multiply, 1 mix, 2 add), reflectivity, refraction ratio,
    /// refraction (1) or reflection, dashed, dash size, gap size, dash scale, depth
    /// packing, line width in world units, shadow side (-1 for none).
    #[wasm_bindgen(js_name = setMaterialRenderState)]
    pub fn set_material_render_state(&mut self, handle: u64, values: &[f32]) -> Result<(), JsError> {
        if values.len() < 37 {
            return Err(JsError::new("setMaterialRenderState takes 37 numbers"));
        }
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        let on = |i: usize| values[i] != 0.0;
        // three.js numbers stencil functions from 512 and operations from 0 (zero), 7680
        // (keep), 7681 (replace), 7682, 7683 (increment, decrement), 34055, 34056 (wrap), 5386 (invert)
        let operation = |value: f32| match value as u32 {
            0 => 0,
            7680 => 1,
            7681 => 2,
            7682 => 3,
            7683 => 4,
            34055 => 5,
            34056 => 6,
            5386 => 7,
            _ => 1,
        };
        let state = &mut material.state;
        state.visible = on(0);
        state.depth_func = (values[1] as u32).min(7) as u8;
        state.color_write = on(2);
        state.polygon_offset = on(3);
        state.polygon_offset_factor = values[4];
        state.polygon_offset_units = values[5];
        state.alpha_to_coverage = on(6);
        state.dithering = on(7);
        state.alpha_hash = on(8);
        state.fog = on(9);
        state.object_space_normal_map = on(10);
        state.blend_color = [values[11], values[12], values[13], values[14]];
        state.stencil = wamr_core::Stencil {
            write: on(15),
            func: (values[16] as u32).saturating_sub(512).min(7) as u8,
            reference: values[17] as u32,
            func_mask: values[18] as u32,
            write_mask: values[19] as u32,
            fail: operation(values[20]),
            z_fail: operation(values[21]),
            z_pass: operation(values[22]),
        };
        state.clip_intersection = on(23);
        state.clip_shadows = on(24);
        state.allow_override = on(25);
        state.env_combine = (values[26] as u32).min(2) as u8;
        state.reflectivity = values[27];
        state.refraction_ratio = values[28];
        state.env_refraction = on(29);
        state.dashed = on(30);
        state.dash_size = values[31];
        state.gap_size = values[32];
        state.dash_scale = values[33];
        state.depth_packing = values[34] as u32;
        state.line_world_units = on(35);
        state.shadow_side = match values[36] as i32 {
            0 => Some(wamr_core::Side::Front),
            1 => Some(wamr_core::Side::Back),
            2 => Some(wamr_core::Side::Double),
            _ => None,
        };
        Ok(())
    }

    /// A material's clipping planes in world space, four numbers each (normal and
    /// constant); at most eight are used.
    #[wasm_bindgen(js_name = setMaterialClipPlanes)]
    pub fn set_material_clip_planes(&mut self, handle: u64, planes: &[f32]) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.clip_planes = planes.chunks_exact(4).take(wamr_core::MAX_CLIP_PLANES).map(|p| [p[0], p[1], p[2], p[3]]).collect();
        Ok(())
    }

    // ---- skins

    /// Makes `object` a skinned mesh (three.js `SkinnedMesh.bind`): the handles of its
    /// bones (0 for a missing bone), their inverse bind matrices (16 numbers each), the
    /// bind matrix and its inverse, and whether the bind mode is detached.
    #[wasm_bindgen(js_name = setSkin)]
    pub fn set_skin(&mut self, object: u64, bones: &[u64], inverses: &[f32], bind_matrix: &[f32], bind_matrix_inverse: &[f32], detached: bool) -> Result<(), JsError> {
        if inverses.len() != bones.len() * 16 {
            return Err(JsError::new("one inverse matrix per bone"));
        }
        let skin = wamr_core::Skin {
            bones: bones.iter().map(|b| (*b != 0).then(|| entity(*b))).collect(),
            bone_inverses: inverses.chunks_exact(16).map(matrix4).collect::<Result<_, _>>()?,
            bind_matrix: matrix4(bind_matrix)?,
            bind_matrix_inverse: matrix4(bind_matrix_inverse)?,
            detached,
        };
        self.inner.set_skin(entity(object), Some(skin));
        Ok(())
    }

    /// Replaces the inverse bind matrices of a skin (three.js `Skeleton.calculateInverses`
    /// or a changed `boneInverses`).
    #[wasm_bindgen(js_name = setSkinInverses)]
    pub fn set_skin_inverses(&mut self, object: u64, inverses: &[f32]) -> Result<(), JsError> {
        let mut skin = self.inner.skin(entity(object)).cloned().ok_or_else(|| JsError::new("object has no skin"))?;
        skin.bone_inverses = inverses.chunks_exact(16).map(matrix4).collect::<Result<_, _>>()?;
        self.inner.set_skin(entity(object), Some(skin));
        Ok(())
    }

    #[wasm_bindgen(js_name = clearSkin)]
    pub fn clear_skin(&mut self, object: u64) {
        self.inner.set_skin(entity(object), None);
    }

    /// The skinning matrices of `object` at the current world matrices, 16 numbers per
    /// bone (each takes a bind-pose vertex to its posed place in the mesh's local space),
    /// as three.js `SkinnedMesh.applyBoneTransform` applies them.
    #[wasm_bindgen(js_name = skinMatrices)]
    pub fn skin_matrices(&self, object: u64) -> Vec<f32> {
        let mut out = Vec::new();
        self.inner.skin_matrices(entity(object), &mut out);
        out
    }

    // ---- morph targets

    /// Writes `base`'s morph targets blended with `influences` into `target` (see
    /// `wamr_core::morph`); `relative` is three.js `morphTargetsRelative`. The targets are
    /// attributes of `base` named `morph.position.<i>`, `morph.normal.<i>` and
    /// `morph.color.<i>`.
    #[wasm_bindgen(js_name = morphGeometry)]
    pub fn morph_geometry(&mut self, base: u64, target: u64, influences: &[f32], relative: bool) -> Result<(), JsError> {
        if base == target {
            return Err(JsError::new("a geometry cannot be morphed into itself"));
        }
        // taken out for the call, so that both geometries are borrowed without a copy
        let mut out = std::mem::take(self.inner.geometry_mut(geometry(target)).ok_or_else(|| dead("geometry"))?);
        let result = match self.inner.geometry(geometry(base)) {
            Some(source) => {
                wamr_core::morph::morph_into(source, &mut out, influences, relative);
                Ok(())
            }
            None => Err(dead("geometry")),
        };
        if let Some(slot) = self.inner.geometry_mut(geometry(target)) {
            *slot = out;
        }
        result
    }
}
