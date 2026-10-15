//! JavaScript classes for the math types beyond the three in `lib.rs` (including
//! `Line3`, `Triangle`, `Spherical` and `Cylindrical`), the remaining methods of those
//! three, and the scalar helpers.
//!
//! Every method forwards to `wamr-math`. The macros below only remove the repetition of
//! writing those one-line forwards by hand.

use crate::{coordinate_system, euler_order, Matrix4, Quaternion, Vector3};
use wamr_math::math_utils;
use wasm_bindgen::prelude::*;

/// `name(&mut self, scalars...)`
macro_rules! mutate {
    ($T:ident { $($js:tt $name:ident($($a:ident: $t:tt),*);)+ }) => {
        #[wasm_bindgen]
        impl $T {
            $(#[wasm_bindgen(js_name = $js)]
            pub fn $name(&mut self $(, $a: $t)*) {
                self.inner.$name($($a),*);
            })+
        }
    };
}

/// `name(&mut self, &Other..., scalars...)`
macro_rules! mutate_with {
    ($T:ident { $($js:tt $name:ident($($v:ident: $O:ident),+ $(; $a:ident: $t:tt)*);)+ }) => {
        #[wasm_bindgen]
        impl $T {
            $(#[wasm_bindgen(js_name = $js)]
            pub fn $name(&mut self $(, $v: &$O)+ $(, $a: $t)*) {
                self.inner.$name($(&$v.inner),+ $(, $a)*);
            })+
        }
    };
}

/// `name(&self, &Other...) -> scalar`
macro_rules! query {
    ($T:ident { $($js:tt $name:ident($($v:ident: $O:ident),*) -> $r:tt;)+ }) => {
        #[wasm_bindgen]
        impl $T {
            $(#[wasm_bindgen(js_name = $js)]
            pub fn $name(&self $(, $v: &$O)*) -> $r {
                self.inner.$name($(&$v.inner),*)
            })+
        }
    };
}

/// A class holding one math value, with `copy` and `clone`.
macro_rules! class {
    ($T:ident, $Inner:ty) => {
        #[wasm_bindgen]
        #[derive(Clone, Copy, Default)]
        pub struct $T {
            pub(crate) inner: $Inner,
        }

        #[wasm_bindgen]
        impl $T {
            pub fn copy(&mut self, source: &$T) {
                self.inner = source.inner;
            }

            #[wasm_bindgen(js_name = clone)]
            pub fn clone_value(&self) -> $T {
                *self
            }
        }
    };
}

/// Getter and setter pairs for public f32 fields.
macro_rules! fields {
    ($T:ident { $($get:ident $set:ident;)+ }) => {
        #[wasm_bindgen]
        impl $T {
            $(#[wasm_bindgen(getter)]
            pub fn $get(&self) -> f32 {
                self.inner.$get
            }

            #[wasm_bindgen(setter)]
            pub fn $set(&mut self, value: f32) {
                self.inner.$get = value;
            })+
        }
    };
}

fn wrap(inner: wamr_math::Vector3) -> Vector3 {
    Vector3 { inner }
}

// ---------------------------------------------------------------- Vector2

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

// ---------------------------------------------------------------- Quaternion (rest)

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

// ---------------------------------------------------------------- Color

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Color {
    pub(crate) inner: wamr_math::Color,
}

fields!(Color { r set_r; g set_g; b set_b; });

const SRGB: wamr_math::ColorSpace = wamr_math::ColorSpace::Srgb;
const LINEAR: wamr_math::ColorSpace = wamr_math::ColorSpace::LinearSrgb;

#[wasm_bindgen]
impl Color {
    /// Components in the linear working colour space.
    #[wasm_bindgen(constructor)]
    pub fn new(r: f32, g: f32, b: f32) -> Color {
        Color { inner: wamr_math::Color::new(r, g, b) }
    }

    /// From an sRGB hex value such as `0xff8800`.
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(hex: u32) -> Color {
        Color { inner: wamr_math::Color::from_hex(hex) }
    }

    /// From a CSS colour string: `#f80`, `rgb(255,136,0)`, `hsl(32,100%,50%)` or a name.
    #[wasm_bindgen(js_name = fromStyle)]
    pub fn from_style(style: &str) -> Color {
        Color { inner: wamr_math::Color::from_style(style) }
    }

    pub fn copy(&mut self, source: &Color) {
        self.inner = source.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Color {
        *self
    }

    /// Sets from an sRGB hex value.
    #[wasm_bindgen(js_name = setHex)]
    pub fn set_hex(&mut self, hex: u32) {
        self.inner.set_hex(hex, SRGB);
    }

    /// Sets linear components.
    #[wasm_bindgen(js_name = setRGB)]
    pub fn set_rgb(&mut self, r: f32, g: f32, b: f32) {
        self.inner.set_rgb(r, g, b, LINEAR);
    }

    /// Hue, saturation and lightness, each 0 to 1.
    #[wasm_bindgen(js_name = setHSL)]
    pub fn set_hsl(&mut self, h: f32, s: f32, l: f32) {
        self.inner.set_hsl(h, s, l, LINEAR);
    }

    /// Sets from a CSS colour string. Strings that do not parse leave the colour unchanged.
    #[wasm_bindgen(js_name = setStyle)]
    pub fn set_style(&mut self, style: &str) {
        self.inner.set_style(style, SRGB);
    }

    /// The sRGB hex value.
    #[wasm_bindgen(js_name = getHex)]
    pub fn get_hex(&self) -> u32 {
        self.inner.get_hex(SRGB)
    }

    #[wasm_bindgen(js_name = getHexString)]
    pub fn get_hex_string(&self) -> String {
        self.inner.get_hex_string(SRGB)
    }

    /// A CSS string such as `rgb(255,136,0)`.
    #[wasm_bindgen(js_name = getStyle)]
    pub fn get_style(&self) -> String {
        self.inner.get_style(SRGB)
    }

    /// Hue, saturation, lightness.
    #[wasm_bindgen(js_name = getHSL)]
    pub fn get_hsl(&self) -> Vec<f32> {
        let hsl = self.inner.get_hsl(LINEAR);
        vec![hsl.h, hsl.s, hsl.l]
    }

    #[wasm_bindgen(js_name = lerpColors)]
    pub fn lerp_colors(&mut self, a: &Color, b: &Color, alpha: f32) {
        self.inner.lerp_colors(&a.inner, &b.inner, alpha);
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

mutate!(Color {
    "setScalar" set_scalar(scalar: f32);
    "addScalar" add_scalar(s: f32);
    "multiplyScalar" multiply_scalar(s: f32);
    "offsetHSL" offset_hsl(h: f32, s: f32, l: f32);
    "convertSRGBToLinear" convert_srgb_to_linear();
    "convertLinearToSRGB" convert_linear_to_srgb();
});
mutate_with!(Color {
    "add" add(color: Color);
    "sub" sub(color: Color);
    "multiply" multiply(color: Color);
    "addColors" add_colors(a: Color, b: Color);
    "lerp" lerp(color: Color; alpha: f32);
    "lerpHSL" lerp_hsl(color: Color; alpha: f32);
    "setFromVector3" set_from_vector3(v: Vector3);
    "applyMatrix3" apply_matrix3(m: Matrix3);
});
query!(Color { "equals" equals(c: Color) -> bool; });

mod shapes;
pub use shapes::*;

// ---------------------------------------------------------------- scalar helpers

macro_rules! helpers {
    ($($js:tt $name:ident($($a:ident),*) -> $r:tt;)+) => {
        $(#[wasm_bindgen(js_name = $js)]
        pub fn $name($($a: f32),*) -> $r {
            math_utils::$name($($a),*)
        })+
    };
}

helpers! {
    "degToRad" deg_to_rad(degrees) -> f32;
    "radToDeg" rad_to_deg(radians) -> f32;
    "clamp" clamp(value, min, max) -> f32;
    "lerp" lerp(x, y, t) -> f32;
    "inverseLerp" inverse_lerp(x, y, value) -> f32;
    "mapLinear" map_linear(x, a1, a2, b1, b2) -> f32;
    "damp" damp(x, y, lambda, dt) -> f32;
    "pingpong" pingpong(x, length) -> f32;
    "smoothstep" smoothstep(x, min, max) -> f32;
    "smootherstep" smootherstep(x, min, max) -> f32;
    "euclideanModulo" euclidean_modulo(n, m) -> f32;
    "isPowerOfTwo" is_power_of_two(value) -> bool;
    "ceilPowerOfTwo" ceil_power_of_two(value) -> f32;
    "floorPowerOfTwo" floor_power_of_two(value) -> f32;
}

/// Deterministic pseudo-random number in [0, 1). Pass a seed to restart the sequence.
#[wasm_bindgen(js_name = seededRandom)]
pub fn seeded_random(seed: Option<u32>) -> f64 {
    math_utils::seeded_random(seed)
}

/// Random integer in [low, high], both included.
#[wasm_bindgen(js_name = randInt)]
pub fn rand_int(low: f64, high: f64) -> f64 {
    math_utils::rand_int(low, high)
}

/// Random float in [low, high).
#[wasm_bindgen(js_name = randFloat)]
pub fn rand_float(low: f64, high: f64) -> f64 {
    math_utils::rand_float(low, high)
}

/// Random float in (-range / 2, range / 2].
#[wasm_bindgen(js_name = randFloatSpread)]
pub fn rand_float_spread(range: f64) -> f64 {
    math_utils::rand_float_spread(range)
}

/// A version 4 UUID in lower case.
#[wasm_bindgen(js_name = generateUUID)]
pub fn generate_uuid() -> String {
    math_utils::generate_uuid()
}

/// Restarts the sequence behind `randInt`, `randFloat`, `randFloatSpread` and
/// `generateUUID` from a 64-bit seed given as two halves. `init()` seeds it from
/// `crypto.getRandomValues`; call this for a reproducible sequence.
#[wasm_bindgen(js_name = setRandomSeed)]
pub fn set_random_seed(high: u32, low: u32) {
    math_utils::set_random_seed((high as u64) << 32 | low as u64);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_helpers_reach_the_math_crate() {
        set_random_seed(0, 9);
        let first = (rand_int(1.0, 6.0), rand_float(0.0, 1.0), rand_float_spread(2.0), generate_uuid());
        set_random_seed(0, 9);
        assert_eq!(first, (rand_int(1.0, 6.0), rand_float(0.0, 1.0), rand_float_spread(2.0), generate_uuid()));
        assert!((1.0..=6.0).contains(&first.0));
    }

    #[test]
    fn line3_triangle_and_coordinate_classes_reach_the_math_crate() {
        let line = Line3::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(2.0, 0.0, 0.0));
        assert_eq!((line.distance(), line.get_center().x()), (2.0, 1.0));
        assert_eq!(line.closest_point_to_point_parameter(&Vector3::new(3.0, 1.0, 0.0), true), 1.0);

        let triangle = Triangle::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(1.0, 0.0, 0.0), &Vector3::new(0.0, 1.0, 0.0));
        assert_eq!((triangle.get_area(), triangle.get_normal().z()), (0.5, 1.0));
        assert!(triangle.contains_point(&Vector3::new(0.25, 0.25, 0.0)));
        let degenerate = Triangle::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(1.0, 0.0, 0.0), &Vector3::new(2.0, 0.0, 0.0));
        assert!(degenerate.get_barycoord(&Vector3::new(0.0, 0.0, 0.0)).is_none());

        let mut spherical = Spherical::new(1.0, 0.0, 0.0);
        spherical.set_from_vector3(&Vector3::new(0.0, 2.0, 0.0));
        let mut v = Vector3::new(0.0, 0.0, 0.0);
        v.set_from_spherical(&spherical);
        assert_eq!((spherical.radius(), v.y()), (2.0, 2.0));
        let mut cylindrical = Cylindrical::new(1.0, 0.0, 0.0);
        cylindrical.set_from_cartesian_coords(0.0, 3.0, 4.0);
        assert_eq!((cylindrical.radius(), cylindrical.y()), (4.0, 3.0));
    }

    #[test]
    fn forwarding_macros_reach_the_math_crate() {
        let mut v = Vector2::new(3.0, 4.0);
        assert_eq!(v.length(), 5.0);
        v.normalize();
        v.add_scaled_vector(&Vector2::new(1.0, 0.0), 2.0);
        assert!((v.x() - 2.6).abs() < 1e-6);

        let mut b = Box3::new();
        b.expand_by_point(&Vector3::new(1.0, 2.0, 3.0));
        b.expand_by_point(&Vector3::new(-1.0, 0.0, 0.0));
        assert_eq!(b.get_center().to_array(), [0.0, 1.0, 1.5]);
        assert!(b.intersects_sphere(&Sphere::new(&Vector3::new(2.0, 1.0, 1.0), 1.5)));

        let ray = Ray::new(&Vector3::new(0.0, 0.0, 5.0), &Vector3::new(0.0, 0.0, -1.0));
        let hit = ray.intersect_plane(&Plane::new(&Vector3::new(0.0, 0.0, 1.0), -1.0)).unwrap();
        assert_eq!(hit.to_array(), [0.0, 0.0, 1.0]);

        let c = Color::from_hex(0xff0000);
        assert_eq!((c.get_hex(), c.get_hex_string().as_str()), (0xff0000, "ff0000"));
        assert_eq!(deg_to_rad(180.0), core::f32::consts::PI);
    }

    #[test]
    fn euler_reports_its_order() {
        let mut e = wamr_math::Euler::default();
        e.order = wamr_math::EulerOrder::ZYX;
        assert_eq!(Euler { inner: e }.order(), "ZYX");
    }
}
