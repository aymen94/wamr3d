//! The rest of Quaternion and Matrix4; Matrix3 and Euler.

use super::*;

#[wasm_bindgen]
impl Quaternion {
    #[wasm_bindgen(setter)]
    pub fn set_x(&mut self, value: f32) {
        self.inner.x = value;
    }

    #[wasm_bindgen(setter)]
    pub fn set_y(&mut self, value: f32) {
        self.inner.y = value;
    }

    #[wasm_bindgen(setter)]
    pub fn set_z(&mut self, value: f32) {
        self.inner.z = value;
    }

    #[wasm_bindgen(setter)]
    pub fn set_w(&mut self, value: f32) {
        self.inner.w = value;
    }

    #[wasm_bindgen(js_name = slerpQuaternions)]
    pub fn slerp_quaternions(&mut self, a: &Quaternion, b: &Quaternion, t: f32) {
        self.inner.slerp_quaternions(&a.inner, &b.inner, t);
    }
}

mutate!(Quaternion {
    "identity" identity();
    "conjugate" conjugate();
});
mutate_with!(Quaternion {
    "multiplyQuaternions" multiply_quaternions(a: Quaternion, b: Quaternion);
    "setFromUnitVectors" set_from_unit_vectors(from: Vector3, to: Vector3);
    "rotateTowards" rotate_towards(q: Quaternion; step: f32);
});
query!(Quaternion {
    "length" length() -> f32;
    "lengthSq" length_sq() -> f32;
    "angleTo" angle_to(q: Quaternion) -> f32;
    "equals" equals(q: Quaternion) -> bool;
});

// ---------------------------------------------------------------- Matrix4 (rest)

#[wasm_bindgen]
impl Matrix4 {
    /// Sets the rotation part from Euler angles. `order` as in `Quaternion.setFromEuler`.
    #[wasm_bindgen(js_name = makeRotationFromEuler)]
    pub fn make_rotation_from_euler(&mut self, euler: &Euler) {
        self.inner.make_rotation_from_euler(&euler.inner);
    }

    #[wasm_bindgen(js_name = makeBasis)]
    pub fn make_basis(&mut self, x_axis: &Vector3, y_axis: &Vector3, z_axis: &Vector3) {
        self.inner.make_basis(&x_axis.inner, &y_axis.inner, &z_axis.inner);
    }
}

mutate!(Matrix4 {
    "multiplyScalar" multiply_scalar(s: f32);
    "setPosition" set_position(x: f32, y: f32, z: f32);
    "makeShear" make_shear(xy: f32, xz: f32, yx: f32, yz: f32, zx: f32, zy: f32);
});
mutate_with!(Matrix4 {
    "scale" scale(v: Vector3);
    "extractRotation" extract_rotation(m: Matrix4);
    "copyPosition" copy_position(m: Matrix4);
    "setFromMatrix3" set_from_matrix3(m: Matrix3);
    "makeRotationAxis" make_rotation_axis(axis: Vector3; angle: f32);
});
query!(Matrix4 {
    "determinantAffine" determinant_affine() -> f32;
    "getMaxScaleOnAxis" get_max_scale_on_axis() -> f32;
    "equals" equals(m: Matrix4) -> bool;
});

// ---------------------------------------------------------------- Matrix3

class!(Matrix3, wamr_math::Matrix3);

#[wasm_bindgen]
impl Matrix3 {
    /// The identity matrix.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Matrix3 {
        Matrix3::default()
    }

    /// Sets the 9 elements, column-major.
    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(&mut self, elements: &[f32]) -> Result<(), JsError> {
        if elements.len() < 9 {
            return Err(JsError::new("Matrix3.fromArray needs 9 elements"));
        }
        self.inner.from_array(elements, 0);
        Ok(())
    }

    /// The 9 elements, column-major.
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.elements.to_vec()
    }
}

mutate!(Matrix3 {
    "identity" identity();
    "invert" invert();
    "transpose" transpose();
    "multiplyScalar" multiply_scalar(s: f32);
    "setUvTransform" set_uv_transform(tx: f32, ty: f32, sx: f32, sy: f32, rotation: f32, cx: f32, cy: f32);
    "makeTranslation" make_translation(x: f32, y: f32);
    "makeRotation" make_rotation(theta: f32);
    "makeScale" make_scale(x: f32, y: f32);
});
mutate_with!(Matrix3 {
    "multiply" multiply(m: Matrix3);
    "premultiply" premultiply(m: Matrix3);
    "multiplyMatrices" multiply_matrices(a: Matrix3, b: Matrix3);
    "setFromMatrix4" set_from_matrix4(m: Matrix4);
    "getNormalMatrix" get_normal_matrix(m: Matrix4);
});
query!(Matrix3 {
    "determinant" determinant() -> f32;
    "equals" equals(m: Matrix3) -> bool;
});

// ---------------------------------------------------------------- Euler

class!(Euler, wamr_math::Euler);
fields!(Euler { x set_x; y set_y; z set_z; });

fn order_name(order: wamr_math::EulerOrder) -> &'static str {
    ["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"][order as usize]
}

#[wasm_bindgen]
impl Euler {
    /// `order` is one of "XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY".
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32, order: &str) -> Result<Euler, JsError> {
        Ok(Euler { inner: wamr_math::Euler::new(x, y, z, euler_order(order)?) })
    }

    #[wasm_bindgen(getter)]
    pub fn order(&self) -> String {
        order_name(self.inner.order).to_string()
    }

    /// Changes the order label only; the angles are kept. Use `reorder` to keep the rotation.
    #[wasm_bindgen(js_name = setOrder)]
    pub fn set_order(&mut self, order: &str) -> Result<(), JsError> {
        self.inner.order = euler_order(order)?;
        Ok(())
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, order: &str) -> Result<(), JsError> {
        self.inner.set(x, y, z, euler_order(order)?);
        Ok(())
    }

    #[wasm_bindgen(js_name = setFromQuaternion)]
    pub fn set_from_quaternion(&mut self, q: &Quaternion, order: &str) -> Result<(), JsError> {
        self.inner.set_from_quaternion(&q.inner, euler_order(order)?);
        Ok(())
    }

    #[wasm_bindgen(js_name = setFromRotationMatrix)]
    pub fn set_from_rotation_matrix(&mut self, m: &Matrix4, order: &str) -> Result<(), JsError> {
        self.inner.set_from_rotation_matrix(&m.inner, euler_order(order)?);
        Ok(())
    }

    /// Re-expresses the same rotation in another order.
    pub fn reorder(&mut self, order: &str) -> Result<(), JsError> {
        self.inner.reorder(euler_order(order)?);
        Ok(())
    }

    /// The three angles.
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

query!(Euler { "equals" equals(e: Euler) -> bool; });
