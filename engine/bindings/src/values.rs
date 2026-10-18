//! Vector3, Quaternion, Matrix4 and Timer: the value types the scene API takes and returns. The rest of their methods are in `math`.

use super::*;

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Vector3 {
    pub(crate) inner: wamr_math::Vector3,
}

#[wasm_bindgen]
impl Vector3 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3 { inner: wamr_math::Vector3::new(x, y, z) }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f32 {
        self.inner.x
    }

    #[wasm_bindgen(setter)]
    pub fn set_x(&mut self, x: f32) {
        self.inner.x = x;
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f32 {
        self.inner.y
    }

    #[wasm_bindgen(setter)]
    pub fn set_y(&mut self, y: f32) {
        self.inner.y = y;
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f32 {
        self.inner.z
    }

    #[wasm_bindgen(setter)]
    pub fn set_z(&mut self, z: f32) {
        self.inner.z = z;
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32) {
        self.inner.set(x, y, z);
    }

    pub fn copy(&mut self, v: &Vector3) {
        self.inner = v.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Vector3 {
        *self
    }

    pub fn add(&mut self, v: &Vector3) {
        self.inner.add(&v.inner);
    }

    pub fn sub(&mut self, v: &Vector3) {
        self.inner.sub(&v.inner);
    }

    #[wasm_bindgen(js_name = multiplyScalar)]
    pub fn multiply_scalar(&mut self, scalar: f32) {
        self.inner.multiply_scalar(scalar);
    }

    pub fn dot(&self, v: &Vector3) -> f32 {
        self.inner.dot(&v.inner)
    }

    pub fn cross(&mut self, v: &Vector3) {
        self.inner.cross(&v.inner);
    }

    pub fn length(&self) -> f32 {
        self.inner.length()
    }

    #[wasm_bindgen(js_name = lengthSq)]
    pub fn length_sq(&self) -> f32 {
        self.inner.length_sq()
    }

    pub fn normalize(&mut self) {
        self.inner.normalize();
    }

    #[wasm_bindgen(js_name = distanceTo)]
    pub fn distance_to(&self, v: &Vector3) -> f32 {
        self.inner.distance_to(&v.inner)
    }

    pub fn lerp(&mut self, v: &Vector3, alpha: f32) {
        self.inner.lerp(&v.inner, alpha);
    }

    #[wasm_bindgen(js_name = applyMatrix4)]
    pub fn apply_matrix4(&mut self, m: &Matrix4) {
        self.inner.apply_matrix4(&m.inner);
    }

    #[wasm_bindgen(js_name = applyQuaternion)]
    pub fn apply_quaternion(&mut self, q: &Quaternion) {
        self.inner.apply_quaternion(&q.inner);
    }

    #[wasm_bindgen(js_name = transformDirection)]
    pub fn transform_direction(&mut self, m: &Matrix4) {
        self.inner.transform_direction(&m.inner);
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

// ---------------------------------------------------------------- Quaternion

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Quaternion {
    pub(crate) inner: wamr_math::Quaternion,
}

#[wasm_bindgen]
impl Quaternion {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32, w: f32) -> Quaternion {
        Quaternion { inner: wamr_math::Quaternion::new(x, y, z, w) }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f32 {
        self.inner.x
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f32 {
        self.inner.y
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f32 {
        self.inner.z
    }

    #[wasm_bindgen(getter)]
    pub fn w(&self) -> f32 {
        self.inner.w
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, w: f32) {
        self.inner.set(x, y, z, w);
    }

    pub fn copy(&mut self, q: &Quaternion) {
        self.inner = q.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Quaternion {
        *self
    }

    /// `axis` must be normalized.
    #[wasm_bindgen(js_name = setFromAxisAngle)]
    pub fn set_from_axis_angle(&mut self, axis: &Vector3, angle: f32) {
        self.inner.set_from_axis_angle(&axis.inner, angle);
    }

    /// `order` is one of "XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY".
    #[wasm_bindgen(js_name = setFromEuler)]
    pub fn set_from_euler(&mut self, x: f32, y: f32, z: f32, order: &str) -> Result<(), JsError> {
        self.inner.set_from_euler(&wamr_math::Euler::new(x, y, z, euler_order(order)?));
        Ok(())
    }

    #[wasm_bindgen(js_name = setFromRotationMatrix)]
    pub fn set_from_rotation_matrix(&mut self, m: &Matrix4) {
        self.inner.set_from_rotation_matrix(&m.inner);
    }

    pub fn multiply(&mut self, q: &Quaternion) {
        self.inner.multiply(&q.inner);
    }

    pub fn premultiply(&mut self, q: &Quaternion) {
        self.inner.premultiply(&q.inner);
    }

    pub fn slerp(&mut self, q: &Quaternion, t: f32) {
        self.inner.slerp(&q.inner, t);
    }

    pub fn normalize(&mut self) {
        self.inner.normalize();
    }

    pub fn invert(&mut self) {
        self.inner.invert();
    }

    pub fn dot(&self, q: &Quaternion) -> f32 {
        self.inner.dot(&q.inner)
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

// ---------------------------------------------------------------- Matrix4

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Matrix4 {
    pub(crate) inner: wamr_math::Matrix4,
}

#[wasm_bindgen]
impl Matrix4 {
    /// The identity matrix.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Matrix4 {
        Matrix4::default()
    }

    pub fn identity(&mut self) {
        self.inner.identity();
    }

    pub fn copy(&mut self, m: &Matrix4) {
        self.inner = m.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Matrix4 {
        *self
    }

    /// Sets the 16 elements, column-major.
    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(&mut self, elements: &[f32]) -> Result<(), JsError> {
        if elements.len() < 16 {
            return Err(JsError::new("Matrix4.fromArray needs 16 elements"));
        }
        self.inner.from_array(elements, 0);
        Ok(())
    }

    /// The 16 elements, column-major.
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.elements.to_vec()
    }

    pub fn multiply(&mut self, m: &Matrix4) {
        self.inner.multiply(&m.inner);
    }

    pub fn premultiply(&mut self, m: &Matrix4) {
        self.inner.premultiply(&m.inner);
    }

    #[wasm_bindgen(js_name = multiplyMatrices)]
    pub fn multiply_matrices(&mut self, a: &Matrix4, b: &Matrix4) {
        self.inner.multiply_matrices(&a.inner, &b.inner);
    }

    /// A singular matrix becomes the zero matrix.
    pub fn invert(&mut self) {
        self.inner.invert();
    }

    pub fn transpose(&mut self) {
        self.inner.transpose();
    }

    pub fn determinant(&self) -> f32 {
        self.inner.determinant()
    }

    pub fn compose(&mut self, position: &Vector3, quaternion: &Quaternion, scale: &Vector3) {
        self.inner.compose(&position.inner, &quaternion.inner, &scale.inner);
    }

    /// Returns ten numbers: position xyz, quaternion xyzw, scale xyz.
    pub fn decompose(&self) -> Vec<f32> {
        let (mut p, mut q, mut s) = Default::default();
        self.inner.decompose(&mut p, &mut q, &mut s);
        [&p.to_array()[..], &q.to_array()[..], &s.to_array()[..]].concat()
    }

    #[wasm_bindgen(js_name = makeTranslation)]
    pub fn make_translation(&mut self, x: f32, y: f32, z: f32) {
        self.inner.make_translation(x, y, z);
    }

    #[wasm_bindgen(js_name = makeScale)]
    pub fn make_scale(&mut self, x: f32, y: f32, z: f32) {
        self.inner.make_scale(x, y, z);
    }

    #[wasm_bindgen(js_name = makeRotationX)]
    pub fn make_rotation_x(&mut self, theta: f32) {
        self.inner.make_rotation_x(theta);
    }

    #[wasm_bindgen(js_name = makeRotationY)]
    pub fn make_rotation_y(&mut self, theta: f32) {
        self.inner.make_rotation_y(theta);
    }

    #[wasm_bindgen(js_name = makeRotationZ)]
    pub fn make_rotation_z(&mut self, theta: f32) {
        self.inner.make_rotation_z(theta);
    }

    #[wasm_bindgen(js_name = makeRotationFromQuaternion)]
    pub fn make_rotation_from_quaternion(&mut self, q: &Quaternion) {
        self.inner.make_rotation_from_quaternion(&q.inner);
    }

    /// Sets the rotation part so that -Z points from `eye` to `target`.
    #[wasm_bindgen(js_name = lookAt)]
    pub fn look_at(&mut self, eye: &Vector3, target: &Vector3, up: &Vector3) {
        self.inner.look_at(&eye.inner, &target.inner, &up.inner);
    }

    /// `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = makePerspective)]
    #[allow(clippy::too_many_arguments)]
    pub fn make_perspective(&mut self, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool, reversed_depth: bool) {
        self.inner.make_perspective(left, right, top, bottom, near, far, coordinate_system(webgpu), reversed_depth);
    }

    /// `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = makeOrthographic)]
    #[allow(clippy::too_many_arguments)]
    pub fn make_orthographic(&mut self, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool, reversed_depth: bool) {
        self.inner.make_orthographic(left, right, top, bottom, near, far, coordinate_system(webgpu), reversed_depth);
    }
}

// ---------------------------------------------------------------- Timer

/// Frame timing. Pass every timestamp in milliseconds, for example `performance.now()`.
#[wasm_bindgen]
pub struct Timer {
    pub(crate) inner: wamr_core::Timer,
}

#[wasm_bindgen]
impl Timer {
    #[wasm_bindgen(constructor)]
    pub fn new(now: f64) -> Timer {
        Timer { inner: wamr_core::Timer::new(now) }
    }

    pub fn update(&mut self, timestamp: f64) {
        self.inner.update(timestamp);
    }

    pub fn reset(&mut self, now: f64) {
        self.inner.reset(now);
    }

    /// Seconds between the last two updates.
    #[wasm_bindgen(js_name = getDelta)]
    pub fn get_delta(&self) -> f64 {
        self.inner.get_delta()
    }

    /// Seconds accumulated over all updates.
    #[wasm_bindgen(js_name = getElapsed)]
    pub fn get_elapsed(&self) -> f64 {
        self.inner.get_elapsed()
    }

    #[wasm_bindgen(js_name = setTimescale)]
    pub fn set_timescale(&mut self, timescale: f64) {
        self.inner.set_timescale(timescale);
    }
}
