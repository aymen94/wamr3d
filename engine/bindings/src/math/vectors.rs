//! Vector2, the rest of Vector3, and Vector4.

use super::*;

class!(Vector2, wamr_math::Vector2);
fields!(Vector2 { x set_x; y set_y; });

#[wasm_bindgen]
impl Vector2 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32) -> Vector2 {
        Vector2 { inner: wamr_math::Vector2::new(x, y) }
    }

    #[wasm_bindgen(js_name = lerpVectors)]
    pub fn lerp_vectors(&mut self, a: &Vector2, b: &Vector2, alpha: f32) {
        self.inner.lerp_vectors(&a.inner, &b.inner, alpha);
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

mutate!(Vector2 {
    "set" set(x: f32, y: f32);
    "setScalar" set_scalar(scalar: f32);
    "addScalar" add_scalar(s: f32);
    "subScalar" sub_scalar(s: f32);
    "multiplyScalar" multiply_scalar(scalar: f32);
    "divideScalar" divide_scalar(scalar: f32);
    "clampScalar" clamp_scalar(min: f32, max: f32);
    "clampLength" clamp_length(min: f32, max: f32);
    "floor" floor();
    "ceil" ceil();
    "round" round();
    "roundToZero" round_to_zero();
    "negate" negate();
    "normalize" normalize();
    "setLength" set_length(length: f32);
});
mutate_with!(Vector2 {
    "add" add(v: Vector2);
    "sub" sub(v: Vector2);
    "multiply" multiply(v: Vector2);
    "divide" divide(v: Vector2);
    "min" min(v: Vector2);
    "max" max(v: Vector2);
    "addVectors" add_vectors(a: Vector2, b: Vector2);
    "subVectors" sub_vectors(a: Vector2, b: Vector2);
    "clamp" clamp(min: Vector2, max: Vector2);
    "addScaledVector" add_scaled_vector(v: Vector2; s: f32);
    "lerp" lerp(v: Vector2; alpha: f32);
    "rotateAround" rotate_around(center: Vector2; angle: f32);
    "applyMatrix3" apply_matrix3(m: Matrix3);
});
query!(Vector2 {
    "length" length() -> f32;
    "lengthSq" length_sq() -> f32;
    "manhattanLength" manhattan_length() -> f32;
    "angle" angle() -> f32;
    "dot" dot(v: Vector2) -> f32;
    "cross" cross(v: Vector2) -> f32;
    "distanceTo" distance_to(v: Vector2) -> f32;
    "distanceToSquared" distance_to_squared(v: Vector2) -> f32;
    "manhattanDistanceTo" manhattan_distance_to(v: Vector2) -> f32;
    "angleTo" angle_to(v: Vector2) -> f32;
    "equals" equals(v: Vector2) -> bool;
});

// ---------------------------------------------------------------- Vector3 (rest)

#[wasm_bindgen]
impl Vector3 {
    #[wasm_bindgen(js_name = lerpVectors)]
    pub fn lerp_vectors(&mut self, a: &Vector3, b: &Vector3, alpha: f32) {
        self.inner.lerp_vectors(&a.inner, &b.inner, alpha);
    }

    /// `order` is one of "XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY".
    #[wasm_bindgen(js_name = applyEuler)]
    pub fn apply_euler(&mut self, euler: &Euler) {
        self.inner.apply_euler(&euler.inner);
    }
}

mutate!(Vector3 {
    "setScalar" set_scalar(scalar: f32);
    "addScalar" add_scalar(s: f32);
    "subScalar" sub_scalar(s: f32);
    "divideScalar" divide_scalar(scalar: f32);
    "clampScalar" clamp_scalar(min: f32, max: f32);
    "clampLength" clamp_length(min: f32, max: f32);
    "floor" floor();
    "ceil" ceil();
    "round" round();
    "roundToZero" round_to_zero();
    "negate" negate();
    "setLength" set_length(length: f32);
    "setFromSphericalCoords" set_from_spherical_coords(radius: f32, phi: f32, theta: f32);
    "setFromCylindricalCoords" set_from_cylindrical_coords(radius: f32, theta: f32, y: f32);
});
mutate_with!(Vector3 {
    "multiply" multiply(v: Vector3);
    "divide" divide(v: Vector3);
    "min" min(v: Vector3);
    "max" max(v: Vector3);
    "projectOnVector" project_on_vector(v: Vector3);
    "projectOnPlane" project_on_plane(normal: Vector3);
    "reflect" reflect(normal: Vector3);
    "addVectors" add_vectors(a: Vector3, b: Vector3);
    "subVectors" sub_vectors(a: Vector3, b: Vector3);
    "crossVectors" cross_vectors(a: Vector3, b: Vector3);
    "multiplyVectors" multiply_vectors(a: Vector3, b: Vector3);
    "clamp" clamp(min: Vector3, max: Vector3);
    "addScaledVector" add_scaled_vector(v: Vector3; s: f32);
    "applyAxisAngle" apply_axis_angle(axis: Vector3; angle: f32);
    "applyMatrix3" apply_matrix3(m: Matrix3);
    "applyNormalMatrix" apply_normal_matrix(m: Matrix3);
    "setFromMatrixPosition" set_from_matrix_position(m: Matrix4);
    "setFromMatrixScale" set_from_matrix_scale(m: Matrix4);
    "setFromColor" set_from_color(c: Color);
});
query!(Vector3 {
    "manhattanLength" manhattan_length() -> f32;
    "angleTo" angle_to(v: Vector3) -> f32;
    "distanceToSquared" distance_to_squared(v: Vector3) -> f32;
    "manhattanDistanceTo" manhattan_distance_to(v: Vector3) -> f32;
    "equals" equals(v: Vector3) -> bool;
});

// ---------------------------------------------------------------- Vector4

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Vector4 {
    pub(crate) inner: wamr_math::Vector4,
}

fields!(Vector4 { x set_x; y set_y; z set_z; w set_w; });

#[wasm_bindgen]
impl Vector4 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32, w: f32) -> Vector4 {
        Vector4 { inner: wamr_math::Vector4::new(x, y, z, w) }
    }

    pub fn copy(&mut self, source: &Vector4) {
        self.inner = source.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Vector4 {
        *self
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

mutate!(Vector4 {
    "set" set(x: f32, y: f32, z: f32, w: f32);
    "setScalar" set_scalar(scalar: f32);
    "addScalar" add_scalar(s: f32);
    "subScalar" sub_scalar(s: f32);
    "multiplyScalar" multiply_scalar(scalar: f32);
    "divideScalar" divide_scalar(scalar: f32);
    "clampScalar" clamp_scalar(min: f32, max: f32);
    "floor" floor();
    "ceil" ceil();
    "round" round();
    "roundToZero" round_to_zero();
    "negate" negate();
    "normalize" normalize();
    "setLength" set_length(length: f32);
});
mutate_with!(Vector4 {
    "add" add(v: Vector4);
    "sub" sub(v: Vector4);
    "multiply" multiply(v: Vector4);
    "divide" divide(v: Vector4);
    "min" min(v: Vector4);
    "max" max(v: Vector4);
    "addVectors" add_vectors(a: Vector4, b: Vector4);
    "subVectors" sub_vectors(a: Vector4, b: Vector4);
    "addScaledVector" add_scaled_vector(v: Vector4; s: f32);
    "lerp" lerp(v: Vector4; alpha: f32);
    "applyMatrix4" apply_matrix4(m: Matrix4);
    "setAxisAngleFromQuaternion" set_axis_angle_from_quaternion(q: Quaternion);
    "setAxisAngleFromRotationMatrix" set_axis_angle_from_rotation_matrix(m: Matrix4);
    "setFromMatrixPosition" set_from_matrix_position(m: Matrix4);
});
query!(Vector4 {
    "length" length() -> f32;
    "lengthSq" length_sq() -> f32;
    "manhattanLength" manhattan_length() -> f32;
    "dot" dot(v: Vector4) -> f32;
    "equals" equals(v: Vector4) -> bool;
});
