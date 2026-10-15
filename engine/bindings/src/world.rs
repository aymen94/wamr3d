//! The `World` methods for objects, the scene graph, transforms, cameras and events.

use super::*;

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new() -> World {
        World::default()
    }

    // ---- objects

    #[wasm_bindgen(js_name = createObject)]
    pub fn create_object(&mut self) -> u64 {
        self.inner.create_object().to_bits()
    }

    /// Creates `count` objects at once and returns their handles.
    #[wasm_bindgen(js_name = createObjects)]
    pub fn create_objects(&mut self, count: u32) -> Vec<u64> {
        (0..count).map(|_| self.inner.create_object().to_bits()).collect()
    }

    /// Destroys one object; its children stay alive as roots.
    pub fn destroy(&mut self, object: u64) -> bool {
        self.inner.destroy(entity(object))
    }

    #[wasm_bindgen(js_name = destroyRecursive)]
    pub fn destroy_recursive(&mut self, object: u64) -> bool {
        self.inner.destroy_recursive(entity(object))
    }

    #[wasm_bindgen(js_name = isAlive)]
    pub fn is_alive(&self, object: u64) -> bool {
        self.inner.is_alive(entity(object))
    }

    #[wasm_bindgen(js_name = objectCount)]
    pub fn object_count(&self) -> u32 {
        self.inner.object_count() as u32
    }

    pub fn name(&self, object: u64) -> String {
        self.inner.name(entity(object)).to_string()
    }

    #[wasm_bindgen(js_name = setName)]
    pub fn set_name(&mut self, object: u64, name: &str) {
        self.inner.set_name(entity(object), name);
    }

    #[wasm_bindgen(js_name = isVisible)]
    pub fn is_visible(&self, object: u64) -> bool {
        self.inner.visibility(entity(object)).is_some_and(|v| v.visible)
    }

    #[wasm_bindgen(js_name = setVisible)]
    pub fn set_visible(&mut self, object: u64, visible: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.visible = visible;
        }
    }

    // ---- scene graph

    /// Makes `child` a child of `parent`. Returns false if either is dead or they are
    /// the same object.
    pub fn add(&mut self, parent: u64, child: u64) -> bool {
        self.inner.add(entity(parent), entity(child))
    }

    /// Parents `children[i]` to `parents[i]` for every index.
    #[wasm_bindgen(js_name = addMany)]
    pub fn add_many(&mut self, parents: &[u64], children: &[u64]) {
        for (parent, child) in parents.iter().zip(children) {
            self.inner.add(entity(*parent), entity(*child));
        }
    }

    pub fn remove(&mut self, parent: u64, child: u64) -> bool {
        self.inner.remove(entity(parent), entity(child))
    }

    #[wasm_bindgen(js_name = removeFromParent)]
    pub fn remove_from_parent(&mut self, object: u64) {
        self.inner.remove_from_parent(entity(object));
    }

    pub fn clear(&mut self, object: u64) {
        self.inner.clear(entity(object));
    }

    /// The parent's handle, or `undefined` for a root.
    pub fn parent(&self, object: u64) -> Option<u64> {
        self.inner.parent(entity(object)).map(Handle::to_bits)
    }

    pub fn children(&self, object: u64) -> Vec<u64> {
        self.inner.children(entity(object)).iter().map(|c| c.to_bits()).collect()
    }

    #[wasm_bindgen(js_name = getObjectByName)]
    pub fn get_object_by_name(&self, root: u64, name: &str) -> Option<u64> {
        self.inner.get_object_by_name(entity(root), name).map(Handle::to_bits)
    }

    // ---- transforms

    #[wasm_bindgen(js_name = setPosition)]
    pub fn set_position(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.position.set(x, y, z);
        Ok(())
    }

    #[wasm_bindgen(js_name = setScale)]
    pub fn set_scale(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.scale.set(x, y, z);
        Ok(())
    }

    /// Sets the Euler angles; the quaternion follows. `order` as in `Quaternion.setFromEuler`.
    #[wasm_bindgen(js_name = setRotation)]
    pub fn set_rotation(&mut self, object: u64, x: f32, y: f32, z: f32, order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        self.transform_mut(object)?.set_rotation(wamr_math::Euler::new(x, y, z, order));
        Ok(())
    }

    /// Sets the quaternion; the Euler angles follow.
    #[wasm_bindgen(js_name = setQuaternion)]
    pub fn set_quaternion(&mut self, object: u64, x: f32, y: f32, z: f32, w: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.set_quaternion(wamr_math::Quaternion::new(x, y, z, w));
        Ok(())
    }

    /// Sets position (xyz), quaternion (xyzw) and scale (xyz) of many objects from one
    /// array of ten numbers per object.
    #[wasm_bindgen(js_name = setTransforms)]
    pub fn set_transforms(&mut self, objects: &[u64], values: &[f32]) -> Result<(), JsError> {
        if values.len() < objects.len() * 10 {
            return Err(JsError::new("setTransforms needs ten numbers per object"));
        }
        for (object, v) in objects.iter().zip(values.chunks_exact(10)) {
            let t = self.transform_mut(*object)?;
            t.position.set(v[0], v[1], v[2]);
            t.set_quaternion(wamr_math::Quaternion::new(v[3], v[4], v[5], v[6]));
            t.scale.set(v[7], v[8], v[9]);
        }
        Ok(())
    }

/// Sets the Euler angles of many objects from one array of three numbers per object.
    #[wasm_bindgen(js_name = setRotations)]
    pub fn set_rotations(&mut self, objects: &[u64], angles: &[f32], order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        if angles.len() < objects.len() * 3 {
            return Err(JsError::new("setRotations needs three numbers per object"));
        }
        for (object, a) in objects.iter().zip(angles.chunks_exact(3)) {
            self.transform_mut(*object)?.set_rotation(wamr_math::Euler::new(a[0], a[1], a[2], order));
        }
        Ok(())
    }

    pub fn position(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.position.to_array().to_vec())
    }

    pub fn scale(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.scale.to_array().to_vec())
    }

    /// The Euler angles xyz, in the object's rotation order.
    pub fn rotation(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.rotation().to_array().to_vec())
    }

    pub fn quaternion(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.quaternion().to_array().to_vec())
    }

    /// Rotates about an axis in object space. `axis` must be normalized.
    #[wasm_bindgen(js_name = rotateOnAxis)]
    pub fn rotate_on_axis(&mut self, object: u64, axis: &Vector3, angle: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.rotate_on_axis(&axis.inner, angle);
        Ok(())
    }

    /// Moves along an axis in object space. `axis` must be normalized.
    #[wasm_bindgen(js_name = translateOnAxis)]
    pub fn translate_on_axis(&mut self, object: u64, axis: &Vector3, distance: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.translate_on_axis(&axis.inner, distance);
        Ok(())
    }

    /// Recomputes the local matrix of one object from position, rotation and scale.
    #[wasm_bindgen(js_name = updateMatrix)]
    pub fn update_matrix(&mut self, object: u64) -> Result<(), JsError> {
        self.transform_mut(object)?.update_matrix();
        Ok(())
    }

    /// Updates local and world matrices of `root` and everything below it.
    #[wasm_bindgen(js_name = updateMatrixWorld)]
    pub fn update_matrix_world(&mut self, root: u64, force: bool) {
        self.inner.update_matrix_world(entity(root), force);
    }

    /// The local matrix, 16 elements, column-major.
    pub fn matrix(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.matrix.elements.to_vec())
    }

    /// The world matrix, 16 elements, column-major.
    #[wasm_bindgen(js_name = matrixWorld)]
    pub fn matrix_world(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.matrix_world.elements.to_vec())
    }

    /// Writes the world matrices of many objects, 16 numbers each, into a buffer inside
    /// the module and returns its address, for a `Float32Array` view without a copy
    /// (for example as the instance matrices of an instanced mesh). The view is valid
    /// until the next call of this method or until the module's memory grows. Objects
    /// that are not alive get an identity matrix.
    #[wasm_bindgen(js_name = matricesWorldPtr)]
    pub fn matrices_world_ptr(&mut self, objects: &[u64]) -> u32 {
        self.scratch.clear();
        self.scratch.reserve(objects.len() * 16);
        for object in objects {
            let matrix = self.inner.transform(entity(*object)).map_or_else(wamr_math::Matrix4::default, |t| t.matrix_world);
            self.scratch.extend_from_slice(&matrix.elements);
        }
        self.scratch.as_ptr() as usize as u32
    }

    /// The world matrices of many objects, 16 elements each, in one array.
    #[wasm_bindgen(js_name = matricesWorld)]
    pub fn matrices_world(&self, objects: &[u64]) -> Result<Vec<f32>, JsError> {
        let mut out = Vec::with_capacity(objects.len() * 16);
        for object in objects {
            out.extend_from_slice(&self.transform(*object)?.matrix_world.elements);
        }
        Ok(out)
    }

    // ---- cameras

    /// Makes the object a perspective camera. `fov` is the vertical field of view in
    /// degrees; `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = setPerspectiveCamera)]
    pub fn set_perspective_camera(&mut self, object: u64, fov: f32, aspect: f32, near: f32, far: f32, webgpu: bool) {
        let mut camera = wamr_core::Camera::perspective(fov, aspect, near, far);
        camera.coordinate_system = coordinate_system(webgpu);
        camera.update_projection_matrix();
        if let Some(existing) = self.inner.camera(entity(object)) {
            camera.matrix_world_inverse = existing.matrix_world_inverse;
        }
        self.inner.set_camera(entity(object), Some(camera));
    }

    /// Makes the object an orthographic camera.
    #[wasm_bindgen(js_name = setOrthographicCamera)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_orthographic_camera(&mut self, object: u64, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool) {
        let mut camera = wamr_core::Camera::orthographic(left, right, top, bottom, near, far);
        camera.coordinate_system = coordinate_system(webgpu);
        camera.update_projection_matrix();
        if let Some(existing) = self.inner.camera(entity(object)) {
            camera.matrix_world_inverse = existing.matrix_world_inverse;
        }
        self.inner.set_camera(entity(object), Some(camera));
    }

    /// Changes the aspect ratio of a perspective camera and updates its projection.
    #[wasm_bindgen(js_name = setCameraAspect)]
    pub fn set_camera_aspect(&mut self, object: u64, aspect: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        if let wamr_core::Projection::Perspective { aspect: current, .. } = &mut camera.projection {
            *current = aspect;
        }
        camera.update_projection_matrix();
        Ok(())
    }

    #[wasm_bindgen(js_name = projectionMatrix)]
    pub fn projection_matrix(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.projection_matrix.elements.to_vec())
    }

    #[wasm_bindgen(js_name = projectionMatrixInverse)]
    pub fn projection_matrix_inverse(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.projection_matrix_inverse.elements.to_vec())
    }

    /// The view matrix of a camera, as of the last world-matrix update.
    #[wasm_bindgen(js_name = matrixWorldInverse)]
    pub fn matrix_world_inverse(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.matrix_world_inverse.elements.to_vec())
    }

    // ---- world-space placement and queries

    /// Rotates the object to face a point in world space (a camera looks at it).
    #[wasm_bindgen(js_name = lookAt)]
    pub fn look_at(&mut self, object: u64, x: f32, y: f32, z: f32) {
        self.inner.look_at(entity(object), x, y, z);
    }

    /// Reparents `object` under `parent` while keeping its world transform.
    pub fn attach(&mut self, parent: u64, object: u64) -> bool {
        self.inner.attach(entity(parent), entity(object))
    }

    #[wasm_bindgen(js_name = getWorldPosition)]
    pub fn get_world_position(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_position(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldQuaternion)]
    pub fn get_world_quaternion(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_quaternion(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldScale)]
    pub fn get_world_scale(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_scale(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldDirection)]
    pub fn get_world_direction(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_direction(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = localToWorld)]
    pub fn local_to_world(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<Vec<f32>, JsError> {
        let v = self.inner.local_to_world(entity(object), &wamr_math::Vector3::new(x, y, z)).ok_or_else(|| dead("object"))?;
        Ok(v.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = worldToLocal)]
    pub fn world_to_local(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<Vec<f32>, JsError> {
        let v = self.inner.world_to_local(entity(object), &wamr_math::Vector3::new(x, y, z)).ok_or_else(|| dead("object"))?;
        Ok(v.to_array().to_vec())
    }

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
    /// `roughness` and `metalness`), 3 Blinn-Phong, 4 normal, 5 toon.
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
            _ => return Err(JsError::new("shading must be 0 (diffuse), 1 (unlit), 2 (standard), 3 (phong), 4 (normal) or 5 (toon)")),
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

    /// Offset, repeat, rotation and rotation centre applied to texture coordinates.
    #[wasm_bindgen(js_name = setMaterialMapTransform)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_map_transform(&mut self, handle: u64, offset_x: f32, offset_y: f32, repeat_x: f32, repeat_y: f32, rotation: f32, center_x: f32, center_y: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.map_transform.set_uv_transform(offset_x, offset_y, repeat_x, repeat_y, rotation, center_x, center_y);
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
        material.maps = wamr_core::TextureMaps { normal, roughness, metalness, emissive, alpha, ao };
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

    /// Upload counter of an attribute; it changes whenever the data should be re-uploaded.
    #[wasm_bindgen(js_name = attributeVersion)]
    pub fn attribute_version(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        Ok(self.attribute(handle, name)?.version)
    }

    // ---- more object, camera and geometry controls

    /// Copies an object (and with `recursive` its subtree). The copy has no parent and
    /// shares geometries and materials with the original.
    #[wasm_bindgen(js_name = cloneObject)]
    pub fn clone_object(&mut self, object: u64, recursive: bool) -> Option<u64> {
        self.inner.clone_object(entity(object), recursive).map(Handle::to_bits)
    }

    /// The layer bit mask of the object.
    pub fn layers(&self, object: u64) -> u32 {
        self.inner.visibility(entity(object)).map_or(0, |v| v.layers.mask)
    }

    #[wasm_bindgen(js_name = setLayers)]
    pub fn set_layers(&mut self, object: u64, mask: u32) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.layers.mask = mask;
        }
    }

    /// Zoom factor of a camera; updates its projection.
    #[wasm_bindgen(js_name = setCameraZoom)]
    pub fn set_camera_zoom(&mut self, object: u64, zoom: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        match &mut camera.projection {
            wamr_core::Projection::Perspective { zoom: current, .. } | wamr_core::Projection::Orthographic { zoom: current, .. } => *current = zoom,
        }
        camera.update_projection_matrix();
        Ok(())
    }

    /// Restricts a camera to a sub-rectangle of a larger virtual viewport.
    #[wasm_bindgen(js_name = setCameraViewOffset)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_camera_view_offset(&mut self, object: u64, full_width: f32, full_height: f32, x: f32, y: f32, width: f32, height: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        camera.set_view_offset(full_width, full_height, x, y, width, height);
        Ok(())
    }

    #[wasm_bindgen(js_name = clearCameraViewOffset)]
    pub fn clear_camera_view_offset(&mut self, object: u64) -> Result<(), JsError> {
        self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?.clear_view_offset();
        Ok(())
    }

    /// Which faces of the material count for picking: 0 front, 1 back, 2 both.
    #[wasm_bindgen(js_name = setMaterialSide)]
    pub fn set_material_side(&mut self, handle: u64, side: u8) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.side = match side {
            0 => wamr_core::Side::Front,
            1 => wamr_core::Side::Back,
            2 => wamr_core::Side::Double,
            _ => return Err(JsError::new("side must be 0 (front), 1 (back) or 2 (both)")),
        };
        Ok(())
    }

    /// The geometry's groups as three numbers each: start, count, material index.
    #[wasm_bindgen(js_name = getGroups)]
    pub fn get_groups(&self, handle: u64) -> Result<Vec<u32>, JsError> {
        let geometry = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?;
        Ok(geometry.groups.iter().flat_map(|g| [g.start, g.count, g.material_index]).collect())
    }

    #[wasm_bindgen(js_name = addGroup)]
    pub fn add_group(&mut self, handle: u64, start: u32, count: u32, material_index: u32) -> Result<(), JsError> {
        self.geometry_mut(handle)?.add_group(start, count, material_index);
        Ok(())
    }

    #[wasm_bindgen(js_name = clearGroups)]
    pub fn clear_groups(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.clear_groups();
        Ok(())
    }

    /// Removes an attribute; removing one the geometry does not have does nothing.
    #[wasm_bindgen(js_name = deleteAttribute)]
    pub fn delete_attribute(&mut self, handle: u64, name: &str) -> Result<(), JsError> {
        self.geometry_mut(handle)?.delete_attribute(name);
        Ok(())
    }

    #[wasm_bindgen(js_name = setDrawRange)]
    pub fn set_draw_range(&mut self, handle: u64, start: u32, count: u32) -> Result<(), JsError> {
        self.geometry_mut(handle)?.set_draw_range(start, count);
        Ok(())
    }

    /// Moves the geometry so that its bounding box is centred on the origin.
    #[wasm_bindgen(js_name = centerGeometry)]
    pub fn center_geometry(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.center();
        Ok(())
    }

    /// A new geometry with the index expanded away.
    #[wasm_bindgen(js_name = toNonIndexed)]
    pub fn to_non_indexed(&mut self, handle: u64) -> Result<u64, JsError> {
        let flat = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?.to_non_indexed();
        Ok(self.inner.create_geometry(flat).to_bits())
    }

    // ---- events

    /// Takes the queued events as triples `[kind, a, b]`. Kinds: 0 added (a = object),
    /// 1 removed (a = object), 2 childAdded (a = parent, b = child), 3 childRemoved
    /// (a = parent, b = child), 4 objectDisposed, 5 geometryDisposed, 6 materialDisposed,
    /// 7 renderTargetDisposed, 8 interleavedBufferDisposed (a = the handle).
    #[wasm_bindgen(js_name = drainEvents)]
    pub fn drain_events(&mut self) -> Vec<u64> {
        let mut out = Vec::new();
        for event in self.inner.drain_events() {
            let triple = match event {
                CoreEvent::Added { entity } => [0, entity.to_bits(), 0],
                CoreEvent::Removed { entity } => [1, entity.to_bits(), 0],
                CoreEvent::ChildAdded { parent, child } => [2, parent.to_bits(), child.to_bits()],
                CoreEvent::ChildRemoved { parent, child } => [3, parent.to_bits(), child.to_bits()],
                CoreEvent::ObjectDisposed { entity } => [4, entity.to_bits(), 0],
                CoreEvent::GeometryDisposed { geometry } => [5, geometry.to_bits(), 0],
                CoreEvent::MaterialDisposed { material } => [6, material.to_bits(), 0],
                CoreEvent::RenderTargetDisposed { target } => [7, target.to_bits(), 0],
                CoreEvent::InterleavedBufferDisposed { buffer } => [8, buffer.to_bits(), 0],
            };
            out.extend(triple);
        }
        out
    }
}
