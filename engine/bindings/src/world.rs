//! The `World` methods for objects, the scene graph, transforms, cameras and events.

use super::*;

mod placement;
mod values;
mod controls;

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

    /// Copies an object's world matrix into an existing matrix without allocating an
    /// intermediate JavaScript typed array.
    #[wasm_bindgen(js_name = copyMatrixWorld)]
    pub fn copy_matrix_world(&self, object: u64, target: &mut Matrix4) -> Result<(), JsError> {
        target.inner = self.transform(object)?.matrix_world;
        Ok(())
    }

    /// Address of an object's world matrix (16 floats, column-major) inside the module,
    /// for reading without a copy; 0 for an object that is not alive. Read it at once: it
    /// moves when objects are created and is detached when the memory grows.
    #[wasm_bindgen(js_name = matrixWorldPtr)]
    pub fn matrix_world_ptr(&self, object: u64) -> u32 {
        self.inner.transform(entity(object)).map_or(0, |t| t.matrix_world.elements.as_ptr() as usize as u32)
    }

    /// The same for the local matrix.
    #[wasm_bindgen(js_name = matrixPtr)]
    pub fn matrix_ptr(&self, object: u64) -> u32 {
        self.inner.transform(entity(object)).map_or(0, |t| t.matrix.elements.as_ptr() as usize as u32)
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
}
