//! Cameras, world-space placement and queries.

use super::*;

#[wasm_bindgen]
impl World {
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

    /// three.js `focus`, `filmGauge` and `filmOffset` of a perspective camera; updates its
    /// projection.
    #[wasm_bindgen(js_name = setCameraFilm)]
    pub fn set_camera_film(&mut self, object: u64, focus: f32, film_gauge: f32, film_offset: f32) {
        if let Some(camera) = self.inner.camera_mut(entity(object)) {
            if let wamr_core::Projection::Perspective { focus: f, film_gauge: g, film_offset: o, .. } = &mut camera.projection {
                *f = focus;
                *g = film_gauge;
                *o = film_offset;
            }
            camera.update_projection_matrix();
        }
    }

    /// The point rotation and scale turn about, in local space (three.js `pivot`);
    /// `enabled` false for the origin.
    #[wasm_bindgen(js_name = setPivot)]
    pub fn set_pivot(&mut self, object: u64, enabled: bool, x: f32, y: f32, z: f32) {
        if let Some(transform) = self.inner.transform_mut(entity(object)) {
            transform.pivot = enabled.then(|| wamr_math::Vector3::new(x, y, z));
            transform.matrix_world_needs_update = true;
        }
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

    /// Like `getWorldPosition`, `getWorldQuaternion`, `getWorldScale` and
    /// `getWorldDirection` (`what` 0 to 3), written to a fixed buffer inside the module
    /// whose address is returned (3 floats, 4 for the quaternion), so that nothing is
    /// allocated per call. 0 for an object that is not alive. Read it at once: the next
    /// call overwrites it.
    #[wasm_bindgen(js_name = worldValuePtr)]
    pub fn world_value_ptr(&mut self, object: u64, what: u8) -> u32 {
        let object = entity(object);
        let value = match what {
            0 => self.inner.get_world_position(object).map(|v| [v.x, v.y, v.z, 0.0]),
            1 => self.inner.get_world_quaternion(object).map(|q| q.to_array()),
            2 => self.inner.get_world_scale(object).map(|v| [v.x, v.y, v.z, 0.0]),
            _ => self.inner.get_world_direction(object).map(|v| [v.x, v.y, v.z, 0.0]),
        };
        let Some(value) = value else {
            return 0;
        };
        self.readout = value;
        self.readout.as_ptr() as usize as u32
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
}
