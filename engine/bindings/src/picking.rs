//! Raycasting: the `RaycastHits` result class and the `World` methods that cast rays.

use super::*;

// ---------------------------------------------------------------- RaycastHits

/// The result of a raycast: hits sorted nearest first. Index 0 is the closest.
#[wasm_bindgen]
pub struct RaycastHits {
    hits: Vec<wamr_objects::Intersection>,
}

impl RaycastHits {
    fn hit(&self, index: u32) -> Result<&wamr_objects::Intersection, JsError> {
        self.hits.get(index as usize).ok_or_else(|| JsError::new("hit index out of range"))
    }
}

#[wasm_bindgen]
impl RaycastHits {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> u32 {
        self.hits.len() as u32
    }

    /// The object that was hit.
    pub fn object(&self, index: u32) -> Result<u64, JsError> {
        Ok(self.hit(index)?.object.to_bits())
    }

    /// Distance from the ray origin, in world units.
    pub fn distance(&self, index: u32) -> Result<f32, JsError> {
        Ok(self.hit(index)?.distance)
    }

    /// The hit point in world space.
    pub fn point(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.point.to_array().to_vec())
    }

    /// For a hit on a line, where the segment starts; `undefined` for a mesh.
    #[wasm_bindgen(js_name = lineIndex)]
    pub fn line_index(&self, index: u32) -> Result<Option<u32>, JsError> {
        Ok(self.hit(index)?.line_index)
    }

    /// Index of the triangle within the geometry.
    #[wasm_bindgen(js_name = faceIndex)]
    pub fn face_index(&self, index: u32) -> Result<u32, JsError> {
        Ok(self.hit(index)?.face_index)
    }

    /// The three vertex indices of the triangle.
    #[wasm_bindgen(js_name = faceVertices)]
    pub fn face_vertices(&self, index: u32) -> Result<Vec<u32>, JsError> {
        let face = self.hit(index)?.face;
        Ok(vec![face.a, face.b, face.c])
    }

    /// The triangle normal in the local space of the object.
    #[wasm_bindgen(js_name = faceNormal)]
    pub fn face_normal(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.face.normal.to_array().to_vec())
    }

    pub fn barycoord(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.barycoord.to_array().to_vec())
    }

    /// Interpolated texture coordinate, or `undefined` if the geometry has none.
    pub fn uv(&self, index: u32) -> Result<Option<Vec<f32>>, JsError> {
        Ok(self.hit(index)?.uv.map(|uv| uv.to_array().to_vec()))
    }

    /// Interpolated vertex normal facing the ray, or `undefined` if the geometry has none.
    pub fn normal(&self, index: u32) -> Result<Option<Vec<f32>>, JsError> {
        Ok(self.hit(index)?.normal.map(|n| n.to_array().to_vec()))
    }

    /// The instance hit, for results of `raycastInstances`; otherwise `undefined`.
    #[wasm_bindgen(js_name = instanceId)]
    pub fn instance_id(&self, index: u32) -> Result<Option<u32>, JsError> {
        Ok(self.hit(index)?.instance_id)
    }
}

#[wasm_bindgen]
impl World {
    // ---- picking

    /// Casts a ray against the meshes at and (with `recursive`) below `root`. World
    /// matrices must be up to date. `direction` must be normalized; pass `Infinity` as
    /// `far` for no limit. Sprites and objects with instances are skipped (see
    /// `raycastInstances`).
    /// `line_threshold` and `points_threshold` are how close, in world units, the ray must pass to a line or a point to
    /// hit it; anything that is not a number means 1. Objects whose layers do not share a
    /// bit with `layers` are skipped (three.js `raycaster.layers`).
    #[allow(clippy::too_many_arguments)]
    pub fn raycast(&self, root: u64, recursive: bool, origin: &Vector3, direction: &Vector3, near: f32, far: f32, line_threshold: f32, points_threshold: f32, layers: u32) -> RaycastHits {
        let mut raycaster = wamr_core::Raycaster::new(origin.inner, direction.inner, near, far);
        raycaster.layers.mask = layers;
        raycaster.params.line_threshold = if line_threshold.is_finite() { line_threshold } else { 1.0 };
        raycaster.params.points_threshold = if points_threshold.is_finite() { points_threshold } else { 1.0 };
        RaycastHits { hits: wamr_objects::intersect_object(&self.inner, &raycaster, entity(root), recursive) }
    }

    /// Casts a ray against each instance of the mesh `object`: `matrices` holds 16 floats
    /// (column-major) per instance, placing it within the object. `raycast` skips objects
    /// with instances, whose matrices the engine does not hold.
    #[wasm_bindgen(js_name = raycastInstances)]
    pub fn raycast_instances(&self, object: u64, matrices: &[f32], origin: &Vector3, direction: &Vector3, near: f32, far: f32) -> RaycastHits {
        let raycaster = wamr_core::Raycaster::new(origin.inner, direction.inner, near, far);
        RaycastHits { hits: wamr_objects::intersect_instances(&self.inner, &raycaster, entity(object), matrices) }
    }

    /// Casts a ray from a camera through a point of its view, given in normalized device
    /// coordinates (x and y from -1 to 1, y up).
    #[wasm_bindgen(js_name = raycastFromCamera)]
    pub fn raycast_from_camera(&self, camera: u64, x: f32, y: f32, root: u64, recursive: bool) -> Result<RaycastHits, JsError> {
        let mut raycaster = wamr_core::Raycaster::new(Default::default(), wamr_math::Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
        if !wamr_objects::set_from_camera(&mut raycaster, &self.inner, entity(camera), wamr_math::Vector2::new(x, y)) {
            return Err(JsError::new("object is not a camera"));
        }
        Ok(RaycastHits { hits: wamr_objects::intersect_object(&self.inner, &raycaster, entity(root), recursive) })
    }
}
