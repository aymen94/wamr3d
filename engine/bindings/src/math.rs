//! JavaScript classes for the math types beyond the three in `values.rs` (including
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

mod vectors;
mod rotations;
mod color;
pub use vectors::*;
pub use rotations::*;
pub use color::*;

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
mod tests;
