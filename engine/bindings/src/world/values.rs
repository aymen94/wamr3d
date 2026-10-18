//! Single transform values, for property-style access from JavaScript.

use super::*;

#[wasm_bindgen]
impl World {
    // ---- single transform values, for property-style access from JavaScript

    /// One number of an object's transform. Slots: 0-2 position, 3-5 Euler angles,
    /// 6-9 quaternion, 10-12 scale, 13-15 up.
    #[wasm_bindgen(js_name = transformValue)]
    pub fn transform_value(&self, object: u64, slot: u32) -> Result<f32, JsError> {
        let t = self.transform(object)?;
        let (rotation, quaternion) = (t.rotation(), t.quaternion());
        Ok(match slot {
            0..=2 => t.position.get_component(slot as usize),
            3 => rotation.x,
            4 => rotation.y,
            5 => rotation.z,
            6 => quaternion.x,
            7 => quaternion.y,
            8 => quaternion.z,
            9 => quaternion.w,
            10..=12 => t.scale.get_component(slot as usize - 10),
            13..=15 => t.up.get_component(slot as usize - 13),
            _ => return Err(JsError::new("transform slot out of range")),
        })
    }

    /// Position (3), Euler angles (3), quaternion (4), scale (3), up (3) and the index of
    /// the Euler order (XYZ, YXZ, ZXY, ZYX, YZX, XZY) of an object: 17 numbers.
    #[wasm_bindgen(js_name = transformValues)]
    pub fn transform_values(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let t = self.transform(object)?;
        let (r, q) = (t.rotation(), t.quaternion());
        let mut out = Vec::with_capacity(17);
        out.extend(t.position.to_array());
        out.extend([r.x, r.y, r.z, q.x, q.y, q.z, q.w]);
        out.extend(t.scale.to_array());
        out.extend(t.up.to_array());
        out.push(f32::from(r.order as u8));
        Ok(out)
    }

    /// Writes parts of many transforms in one call. `values` holds 17 numbers per
    /// object laid out as in `transformValues`; `masks` says which parts to take:
    /// 1 position, 2 Euler angles and order, 4 quaternion, 8 scale, 16 up. Objects that
    /// are not alive are skipped.
    #[wasm_bindgen(js_name = applyTransforms)]
    pub fn apply_transforms(&mut self, objects: &[u64], masks: &[u8], values: &[f32]) {
        const ORDERS: [EulerOrder; 6] = [EulerOrder::XYZ, EulerOrder::YXZ, EulerOrder::ZXY, EulerOrder::ZYX, EulerOrder::YZX, EulerOrder::XZY];

        for ((object, mask), v) in objects.iter().zip(masks).zip(values.chunks_exact(17)) {
            let Some(t) = self.inner.transform_mut(entity(*object)) else {
                continue;
            };
            if mask & 1 != 0 {
                t.position.set(v[0], v[1], v[2]);
            }
            if mask & 2 != 0 {
                t.set_rotation(wamr_math::Euler::new(v[3], v[4], v[5], ORDERS[(v[16] as usize).min(5)]));
            }
            if mask & 4 != 0 {
                t.set_quaternion(wamr_math::Quaternion::new(v[6], v[7], v[8], v[9]));
            }
            if mask & 8 != 0 {
                t.scale.set(v[10], v[11], v[12]);
            }
            if mask & 16 != 0 {
                t.up.set(v[13], v[14], v[15]);
            }
        }
    }

    /// With `false` the local matrix is no longer rebuilt from position, rotation and
    /// scale; set it with `setMatrix`.
    #[wasm_bindgen(js_name = setMatrixAutoUpdate)]
    pub fn set_matrix_auto_update(&mut self, object: u64, value: bool) -> Result<(), JsError> {
        self.transform_mut(object)?.matrix_auto_update = value;
        Ok(())
    }

    /// Sets the local matrix (16 numbers, column-major) and marks the world matrix as
    /// out of date. It only lasts on objects whose matrix is not updated automatically.
    #[wasm_bindgen(js_name = setMatrix)]
    pub fn set_matrix(&mut self, object: u64, elements: &[f32]) -> Result<(), JsError> {
        let elements: [f32; 16] = elements.try_into().map_err(|_| JsError::new("a matrix has 16 numbers"))?;
        let t = self.transform_mut(object)?;
        t.matrix.elements = elements;
        t.matrix_world_needs_update = true;
        Ok(())
    }

    /// Sets one number of an object's transform; see `transformValue` for the slots.
    /// Changing an Euler angle updates the quaternion and the other way round.
    #[wasm_bindgen(js_name = setTransformValue)]
    pub fn set_transform_value(&mut self, object: u64, slot: u32, value: f32) -> Result<(), JsError> {
        let t = self.transform_mut(object)?;
        match slot {
            0..=2 => drop(t.position.set_component(slot as usize, value)),
            3..=5 => {
                let mut rotation = t.rotation();
                [&mut rotation.x, &mut rotation.y, &mut rotation.z][slot as usize - 3].clone_from(&&value);
                t.set_rotation(rotation);
            }
            6..=9 => {
                let mut q = t.quaternion();
                [&mut q.x, &mut q.y, &mut q.z, &mut q.w][slot as usize - 6].clone_from(&&value);
                t.set_quaternion(q);
            }
            10..=12 => drop(t.scale.set_component(slot as usize - 10, value)),
            13..=15 => drop(t.up.set_component(slot as usize - 13, value)),
            _ => return Err(JsError::new("transform slot out of range")),
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = rotationOrder)]
    pub fn rotation_order(&self, object: u64) -> Result<String, JsError> {
        Ok(["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"][self.transform(object)?.rotation().order as usize].to_string())
    }

    #[wasm_bindgen(js_name = setRotationOrder)]
    pub fn set_rotation_order(&mut self, object: u64, order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        self.transform_mut(object)?.set_rotation_order(order);
        Ok(())
    }

    #[wasm_bindgen(js_name = setRenderOrder)]
    pub fn set_render_order(&mut self, object: u64, order: f32) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.render_order = order;
        }
    }

    #[wasm_bindgen(js_name = setFrustumCulled)]
    pub fn set_frustum_culled(&mut self, object: u64, culled: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.frustum_culled = culled;
        }
    }

    /// three.js `castShadow` and `receiveShadow`.
    #[wasm_bindgen(js_name = setShadowFlags)]
    pub fn set_shadow_flags(&mut self, object: u64, cast: bool, receive: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.cast_shadow = cast;
            v.receive_shadow = receive;
        }
    }

    /// How a material is lit: `shading` 0 diffuse, 1 unlit, 2 standard (which uses
    /// `roughness` and `metalness`), 3 Blinn-Phong, 4 normal, 5 toon, 6 matcap, 7 depth,
    /// 8 distance, 9 shadow only.
    #[wasm_bindgen(js_name = setMaterialShading)]
    pub fn set_material_shading(&mut self, handle: u64, shading: u8, roughness: f32, metalness: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.shading = match shading {
            0 => wamr_core::Shading::Lambert,
            1 => wamr_core::Shading::Unlit,
            2 => wamr_core::Shading::Standard,
            3 => wamr_core::Shading::Phong,
            4 => wamr_core::Shading::Normal,
            5 => wamr_core::Shading::Toon,
            6 => wamr_core::Shading::Matcap,
            7 => wamr_core::Shading::Depth,
            8 => wamr_core::Shading::Distance,
            9 => wamr_core::Shading::Shadow,
            _ => return Err(JsError::new("shading must be 0 (diffuse), 1 (unlit), 2 (standard), 3 (phong), 4 (normal), 5 (toon), 6 (matcap), 7 (depth), 8 (distance) or 9 (shadow)")),
        };
        material.roughness = roughness;
        material.metalness = metalness;
        Ok(())
    }

    /// The colour texture of a material, as an id the WebGPU host resolves; 0 for none.
    #[wasm_bindgen(js_name = setMaterialMap)]
    pub fn set_material_map(&mut self, handle: u64, texture: u32) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.map = texture;
        Ok(())
    }

    /// Blending and depth state. `opacity` only shows when `transparent` is set.
    #[wasm_bindgen(js_name = setMaterialState)]
    pub fn set_material_state(&mut self, handle: u64, transparent: bool, opacity: f32, depth_test: bool, depth_write: bool, vertex_colors: bool) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.transparent = transparent;
        material.opacity = opacity;
        material.depth_test = depth_test;
        material.depth_write = depth_write;
        material.vertex_colors = vertex_colors;
        Ok(())
    }

    /// Offset, repeat, rotation and rotation centre applied to the texture coordinates of
    /// every map (see `setMaterialMapUv` for one map).
    #[wasm_bindgen(js_name = setMaterialMapTransform)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_map_transform(&mut self, handle: u64, offset_x: f32, offset_y: f32, repeat_x: f32, repeat_y: f32, rotation: f32, center_x: f32, center_y: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        let mut transform = wamr_math::Matrix3::default();
        transform.set_uv_transform(offset_x, offset_y, repeat_x, repeat_y, rotation, center_x, center_y);
        material.set_map_transform(transform);
        Ok(())
    }

    /// Base colour of a material, linear components.
    #[wasm_bindgen(js_name = setMaterialColor)]
    pub fn set_material_color(&mut self, handle: u64, r: f32, g: f32, b: f32) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.color = wamr_math::Color::new(r, g, b);
        Ok(())
    }

    /// Emitted light of a material: linear colour already multiplied by the intensity.
    #[wasm_bindgen(js_name = setMaterialEmissive)]
    pub fn set_material_emissive(&mut self, handle: u64, r: f32, g: f32, b: f32) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.emissive = wamr_math::Color::new(r, g, b);
        Ok(())
    }

    /// Highlight of a Blinn-Phong material: linear specular colour and shininess.
    #[wasm_bindgen(js_name = setMaterialSpecular)]
    pub fn set_material_specular(&mut self, handle: u64, r: f32, g: f32, b: f32, shininess: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.specular = wamr_math::Color::new(r, g, b);
        material.shininess = shininess;
        Ok(())
    }

    /// The textures of a material besides `map`, as ids the WebGPU host resolves (0 for
    /// none): normal, roughness, metalness, emissive, alpha and ambient-occlusion maps.
    #[wasm_bindgen(js_name = setMaterialMaps)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_maps(&mut self, handle: u64, normal: u32, roughness: u32, metalness: u32, emissive: u32, alpha: u32, ao: u32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.maps = wamr_core::TextureMaps { normal, roughness, metalness, emissive, alpha, ao, ..material.maps };
        Ok(())
    }

    /// three.js `normalScale`, `aoMapIntensity` and `alphaTest` of a material.
    #[wasm_bindgen(js_name = setMaterialMapSettings)]
    pub fn set_material_map_settings(&mut self, handle: u64, normal_scale_x: f32, normal_scale_y: f32, ao_map_intensity: f32, alpha_test: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.normal_scale = [normal_scale_x, normal_scale_y];
        material.ao_map_intensity = ao_map_intensity;
        material.alpha_test = alpha_test;
        Ok(())
    }

    /// The remaining textures of a material, as ids the host resolves (0 for none): light,
    /// bump, displacement, specular and toon gradient maps.
    #[wasm_bindgen(js_name = setMaterialExtraMaps)]
    pub fn set_material_extra_maps(&mut self, handle: u64, light: u32, bump: u32, displacement: u32, specular: u32, gradient: u32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.maps = wamr_core::TextureMaps { light, bump, displacement, specular, gradient, ..material.maps };
        Ok(())
    }

    /// three.js `lightMapIntensity`, `bumpScale`, `displacementScale` and
    /// `displacementBias` of a material.
    #[wasm_bindgen(js_name = setMaterialMapStrengths)]
    pub fn set_material_map_strengths(&mut self, handle: u64, light_map_intensity: f32, bump_scale: f32, displacement_scale: f32, displacement_bias: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.light_map_intensity = light_map_intensity;
        material.bump_scale = bump_scale;
        material.displacement_scale = displacement_scale;
        material.displacement_bias = displacement_bias;
        Ok(())
    }

    /// three.js `wireframe`: meshes draw their triangles' edges as lines.
    #[wasm_bindgen(js_name = setMaterialWireframe)]
    pub fn set_material_wireframe(&mut self, handle: u64, wireframe: bool) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.wireframe = wireframe;
        Ok(())
    }

    /// The layers of three.js `MeshPhysicalMaterial` that a standard material draws:
    /// clearcoat and its roughness, sheen (linear `sheenColor` already multiplied by
    /// `sheen`) and its roughness, `ior`, `specularIntensity` and linear `specularColor`.
    #[wasm_bindgen(js_name = setMaterialPhysical)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_physical(&mut self, handle: u64, clearcoat: f32, clearcoat_roughness: f32, sheen_r: f32, sheen_g: f32, sheen_b: f32, sheen_roughness: f32, ior: f32, specular_intensity: f32, specular_r: f32, specular_g: f32, specular_b: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.clearcoat = clearcoat;
        material.clearcoat_roughness = clearcoat_roughness;
        material.sheen_color = wamr_math::Color::new(sheen_r, sheen_g, sheen_b);
        material.sheen_roughness = sheen_roughness;
        material.ior = ior;
        material.specular_intensity = specular_intensity;
        material.specular_color = wamr_math::Color::new(specular_r, specular_g, specular_b);
        Ok(())
    }

    /// Upload counter of an attribute; it changes whenever the data should be re-uploaded.
    #[wasm_bindgen(js_name = attributeVersion)]
    pub fn attribute_version(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        Ok(self.attribute(handle, name)?.version)
    }
}
