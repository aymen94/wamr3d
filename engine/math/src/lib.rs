//! `wamr-math`: the three.js math primitives, ported to Rust (WAMR3D Phase 1).
//!
//! Semantics follow three.js: right-handed, +Y up, column-major
//! matrices, `XYZ` default Euler order. Values are stored as contiguous `f32`; every
//! function computes in `f64` and rounds once on store (AGENTS.md D1).
//!
//! Method names are the three.js names in `snake_case`. Mutating methods return
//! `&mut Self` so calls chain as they do in JavaScript; `target` out-parameters are
//! return values (AGENTS.md D4).

#![forbid(unsafe_code)]

#[macro_use]
mod vector_common;
mod color_names;
mod wide;

pub mod box3;
pub mod color;
pub mod color_management;
pub mod cylindrical;
pub mod euler;
pub mod frustum;
#[doc(hidden)]
pub mod kernels;
pub mod line3;
pub mod math_utils;
pub mod matrix3;
pub mod matrix4;
pub mod plane;
pub mod quaternion;
pub mod ray;
pub mod sphere;
pub mod spherical;
pub mod triangle;
pub mod vector2;
pub mod vector3;
pub mod vector4;

pub use box3::Box3;
pub use color::{Color, Hsl};
pub use color_management::ColorSpace;
pub use cylindrical::Cylindrical;
pub use euler::{Euler, EulerOrder};
pub use frustum::Frustum;
pub use line3::Line3;
pub use math_utils::{ComponentType, ProperEulerOrder};
pub use matrix3::Matrix3;
pub use matrix4::Matrix4;
pub use plane::Plane;
pub use quaternion::Quaternion;
pub use ray::Ray;
pub use sphere::Sphere;
pub use spherical::Spherical;
pub use triangle::{Interpolate, Triangle};
pub use vector2::Vector2;
pub use vector3::Vector3;
pub use vector4::Vector4;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CoordinateSystem {
    WebGL = 2000,
    WebGPU = 2001,
}

#[cfg(test)]
pub(crate) mod test_util {
    const EPS: f32 = 1e-6;

    #[track_caller]
    pub(crate) fn assert_close(got: f32, expected: f32) {
        assert!(
            (got - expected).abs() <= EPS * expected.abs().max(1.0),
            "got {got}, expected {expected}"
        );
    }

    #[track_caller]
    pub(crate) fn assert_close_slice(got: &[f32], expected: &[f32]) {
        assert_eq!(got.len(), expected.len(), "length mismatch");
        for (i, (g, e)) in got.iter().zip(expected).enumerate() {
            assert!(
                (g - e).abs() <= EPS * e.abs().max(1.0),
                "index {i}: got {g}, expected {e}\n got: {got:?}\n expected: {expected:?}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_system_values_match_three_js_constants() {
        assert_eq!(CoordinateSystem::WebGL as u32, 2000);
        assert_eq!(CoordinateSystem::WebGPU as u32, 2001);
    }

    #[test]
    fn layouts_are_contiguous_f32() {
        use core::mem::{align_of, size_of};

        assert_eq!(size_of::<Vector2>(), 8);
        assert_eq!(size_of::<Vector3>(), 12);
        assert_eq!(size_of::<Vector4>(), 16);
        assert_eq!(size_of::<Quaternion>(), 16);
        assert_eq!(size_of::<Matrix3>(), 36);
        assert_eq!(size_of::<Matrix4>(), 64);
        assert_eq!(size_of::<Color>(), 12);
        assert_eq!(size_of::<Box3>(), 24);
        assert_eq!(size_of::<Sphere>(), 16);
        assert_eq!(size_of::<Plane>(), 16);
        assert_eq!(size_of::<Ray>(), 24);
        assert_eq!(size_of::<Line3>(), 24);
        assert_eq!(size_of::<Triangle>(), 36);
        assert_eq!(size_of::<Frustum>(), 96);
        assert_eq!(size_of::<Spherical>(), 12);
        assert_eq!(size_of::<Cylindrical>(), 12);
        assert_eq!(align_of::<Matrix4>(), 4);
    }
}
