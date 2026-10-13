//! Not ported: `generateUUID`, `randInt`, `randFloat`, `randFloatSpread`. They need a
//! `Math.random` source, which Rust's standard library does not have (STATUS.md, "Needs
//! decision").

use crate::quaternion::Quaternion;
use crate::wide;
use std::cell::Cell;

pub const DEG2RAD: f32 = (core::f64::consts::PI / 180.0) as f32;

pub const RAD2DEG: f32 = (180.0 / core::f64::consts::PI) as f32;

const DEG2RAD_WIDE: f64 = core::f64::consts::PI / 180.0;
const RAD2DEG_WIDE: f64 = 180.0 / core::f64::consts::PI;

thread_local! {
    static SEED: Cell<u32> = const { Cell::new(1234567) };
}

pub fn clamp(value: f32, min: f32, max: f32) -> f32 {
    wide::clamp32(value, min, max)
}

fn euclidean_modulo_wide(n: f64, m: f64) -> f64 {
    // https://en.wikipedia.org/wiki/Modulo_operation
    ((n % m) + m) % m
}

pub fn euclidean_modulo(n: f32, m: f32) -> f32 {
    euclidean_modulo_wide(n as f64, m as f64) as f32
}

pub fn map_linear(x: f32, a1: f32, a2: f32, b1: f32, b2: f32) -> f32 {
    let (x, a1, a2, b1, b2) = (x as f64, a1 as f64, a2 as f64, b1 as f64, b2 as f64);
    (b1 + (x - a1) * (b2 - b1) / (a2 - a1)) as f32
}

pub fn inverse_lerp(x: f32, y: f32, value: f32) -> f32 {
    // https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/inverse-lerp-a-super-useful-yet-often-overlooked-function-r5230/
    if x != y {
        ((value as f64 - x as f64) / (y as f64 - x as f64)) as f32
    } else {
        0.0
    }
}

pub(crate) fn lerp_wide(x: f64, y: f64, t: f64) -> f64 {
    (1.0 - t) * x + t * y
}

pub fn lerp(x: f32, y: f32, t: f32) -> f32 {
    lerp_wide(x as f64, y as f64, t as f64) as f32
}

pub fn damp(x: f32, y: f32, lambda: f32, dt: f32) -> f32 {
    lerp_wide(x as f64, y as f64, 1.0 - (-(lambda as f64) * dt as f64).exp()) as f32
}

pub fn pingpong(x: f32, length: f32) -> f32 {
    // https://www.desmos.com/calculator/vcsjnyz7x4
    let length = length as f64;
    (length - (euclidean_modulo_wide(x as f64, length * 2.0) - length).abs()) as f32
}

pub fn smoothstep(x: f32, min: f32, max: f32) -> f32 {
    if x <= min {
        return 0.0;
    }
    if x >= max {
        return 1.0;
    }

    let x = (x as f64 - min as f64) / (max as f64 - min as f64);

    (x * x * (3.0 - 2.0 * x)) as f32
}

pub fn smootherstep(x: f32, min: f32, max: f32) -> f32 {
    if x <= min {
        return 0.0;
    }
    if x >= max {
        return 1.0;
    }

    let x = (x as f64 - min as f64) / (max as f64 - min as f64);

    (x * x * x * (x * (x * 6.0 - 15.0) + 10.0)) as f32
}

pub fn seeded_random(s: Option<u32>) -> f64 {
    SEED.with(|seed| {
        if let Some(s) = s {
            seed.set(s);
        }

        // Mulberry32 generator

        seed.set(seed.get().wrapping_add(0x6D2B79F5));
        let mut t = seed.get();

        t = (t ^ (t >> 15)).wrapping_mul(t | 1);

        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));

        (t ^ (t >> 14)) as f64 / 4294967296.0
    })
}

pub fn deg_to_rad(degrees: f32) -> f32 {
    (degrees as f64 * DEG2RAD_WIDE) as f32
}

pub fn rad_to_deg(radians: f32) -> f32 {
    (radians as f64 * RAD2DEG_WIDE) as f32
}

pub fn is_power_of_two(value: f32) -> bool {
    let value = value as f64;
    value > 0.0 && value.fract() == 0.0 && 2f64.powf(wide::round(value.log2())) == value
}

pub fn ceil_power_of_two(value: f32) -> f32 {
    2f64.powf(((value as f64).ln() / core::f64::consts::LN_2).ceil()) as f32
}

pub fn floor_power_of_two(value: f32) -> f32 {
    2f64.powf(((value as f64).ln() / core::f64::consts::LN_2).floor()) as f32
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ProperEulerOrder {
    XYX = 0,
    YZY = 1,
    ZXZ = 2,
    XZX = 3,
    YXY = 4,
    ZYZ = 5,
}

pub fn set_quaternion_from_proper_euler(q: &mut Quaternion, a: f32, b: f32, c: f32, order: ProperEulerOrder) {
    let (a, b, c) = (a as f64, b as f64, c as f64);

    let c2 = (b / 2.0).cos();
    let s2 = (b / 2.0).sin();

    let c13 = ((a + c) / 2.0).cos();
    let s13 = ((a + c) / 2.0).sin();

    let c1_3 = ((a - c) / 2.0).cos();
    let s1_3 = ((a - c) / 2.0).sin();

    let c3_1 = ((c - a) / 2.0).cos();
    let s3_1 = ((c - a) / 2.0).sin();

    q.set_wide(match order {
        ProperEulerOrder::XYX => [c2 * s13, s2 * c1_3, s2 * s1_3, c2 * c13],
        ProperEulerOrder::YZY => [s2 * s1_3, c2 * s13, s2 * c1_3, c2 * c13],
        ProperEulerOrder::ZXZ => [s2 * c1_3, s2 * s1_3, c2 * s13, c2 * c13],
        ProperEulerOrder::XZX => [c2 * s13, s2 * s3_1, s2 * c3_1, c2 * c13],
        ProperEulerOrder::YXY => [s2 * c3_1, c2 * s13, s2 * s3_1, c2 * c13],
        ProperEulerOrder::ZYZ => [s2 * s3_1, s2 * c3_1, c2 * s13, c2 * c13],
    });
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ComponentType {
    Float32 = 0,
    Uint32 = 1,
    Uint16 = 2,
    Uint8 = 3,
    Int32 = 4,
    Int16 = 5,
    Int8 = 6,
    Uint8Clamped = 7,
}

pub fn denormalize(value: f32, array: ComponentType) -> f32 {
    let value = value as f64;
    (match array {
        ComponentType::Float32 => value,
        ComponentType::Uint32 => value / 4294967295.0,
        ComponentType::Uint16 => value / 65535.0,
        ComponentType::Uint8 | ComponentType::Uint8Clamped => value / 255.0,
        ComponentType::Int32 => wide::max(value / 2147483647.0, -1.0),
        ComponentType::Int16 => wide::max(value / 32767.0, -1.0),
        ComponentType::Int8 => wide::max(value / 127.0, -1.0),
    }) as f32
}

pub fn normalize(value: f32, array: ComponentType) -> f32 {
    let value = value as f64;
    (match array {
        ComponentType::Float32 => value,
        ComponentType::Uint32 => wide::round(value * 4294967295.0),
        ComponentType::Uint16 => wide::round(value * 65535.0),
        ComponentType::Uint8 | ComponentType::Uint8Clamped => wide::round(value * 255.0),
        ComponentType::Int32 => wide::round(value * 2147483647.0),
        ComponentType::Int16 => wide::round(value * 32767.0),
        ComponentType::Int8 => wide::round(value * 127.0),
    }) as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{assert_close, assert_close_slice};
    use core::f32::consts::PI;

    #[test]
    fn constants() {
        assert_close(DEG2RAD * 180.0, PI);
        assert_close(RAD2DEG * PI, 180.0);
    }

    #[test]
    fn clamp_() {
        assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
        assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
        assert_eq!(clamp(0.5, 0.0, 1.0), 0.5);
    }

    #[test]
    fn euclidean_modulo_() {
        assert_eq!(euclidean_modulo(-1.0, 3.0), 2.0);
        assert_eq!(euclidean_modulo(4.0, 3.0), 1.0);
        assert!(euclidean_modulo(1.0, 0.0).is_nan());
    }

    #[test]
    fn map_linear_() {
        assert_eq!(map_linear(0.5, 0.0, 1.0, 10.0, 20.0), 15.0);
    }

    #[test]
    fn inverse_lerp_() {
        assert_eq!(inverse_lerp(10.0, 20.0, 15.0), 0.5);
        assert_eq!(inverse_lerp(10.0, 10.0, 15.0), 0.0);
    }

    #[test]
    fn lerp_() {
        assert_eq!(lerp(10.0, 20.0, 0.25), 12.5);
    }

    #[test]
    fn damp_() {
        assert_eq!(damp(1.0, 5.0, 2.0, 0.0), 1.0);
        assert_close(damp(0.0, 1.0, 1.0, 1.0), 1.0 - (-1.0f32).exp());
    }

    #[test]
    fn pingpong_() {
        assert_eq!(pingpong(0.5, 1.0), 0.5);
        assert_eq!(pingpong(1.5, 1.0), 0.5);
        assert_eq!(pingpong(2.0, 1.0), 0.0);
    }

    #[test]
    fn smoothstep_() {
        assert_eq!(smoothstep(-1.0, 0.0, 1.0), 0.0);
        assert_eq!(smoothstep(2.0, 0.0, 1.0), 1.0);
        assert_eq!(smoothstep(0.5, 0.0, 1.0), 0.5);
    }

    #[test]
    fn smootherstep_() {
        assert_eq!(smootherstep(-1.0, 0.0, 1.0), 0.0);
        assert_eq!(smootherstep(2.0, 0.0, 1.0), 1.0);
        assert_eq!(smootherstep(0.5, 0.0, 1.0), 0.5);
    }

    #[test]
    fn seeded_random_is_deterministic_and_in_range() {
        let a = [seeded_random(Some(42)), seeded_random(None), seeded_random(None)];
        let b = [seeded_random(Some(42)), seeded_random(None), seeded_random(None)];
        assert_eq!(a, b);
        assert!(a[0] != a[1] && a[1] != a[2]);
        assert!(a.iter().all(|x| (0.0..1.0).contains(x)));
    }

    #[test]
    fn deg_to_rad_() {
        assert_close(deg_to_rad(180.0), PI);
    }

    #[test]
    fn rad_to_deg_() {
        assert_close(rad_to_deg(PI), 180.0);
    }

    #[test]
    fn is_power_of_two_() {
        assert!(is_power_of_two(1.0) && is_power_of_two(64.0) && is_power_of_two(4096.0));
        assert!(!is_power_of_two(0.0) && !is_power_of_two(3.0) && !is_power_of_two(-2.0) && !is_power_of_two(0.5));
    }

    #[test]
    fn ceil_power_of_two_() {
        assert_eq!(ceil_power_of_two(5.0), 8.0);
        assert_eq!(ceil_power_of_two(100.0), 128.0);
    }

    #[test]
    fn floor_power_of_two_() {
        assert_eq!(floor_power_of_two(5.0), 4.0);
        assert_eq!(floor_power_of_two(100.0), 64.0);
    }

    #[test]
    fn set_quaternion_from_proper_euler_() {
        // XYX with b = 0 is a rotation of a + c about X
        let mut q = Quaternion::default();
        set_quaternion_from_proper_euler(&mut q, 0.25, 0.0, 0.5, ProperEulerOrder::XYX);
        let mut expected = Quaternion::default();
        expected.set_from_axis_angle(&crate::Vector3::new(1.0, 0.0, 0.0), 0.75);
        assert_close_slice(&q.to_array(), &expected.to_array());
    }

    #[test]
    fn denormalize_() {
        assert_eq!(denormalize(255.0, ComponentType::Uint8), 1.0);
        assert_eq!(denormalize(65535.0, ComponentType::Uint16), 1.0);
        assert_eq!(denormalize(-128.0, ComponentType::Int8), -1.0);
        assert_eq!(denormalize(0.25, ComponentType::Float32), 0.25);
    }

    #[test]
    fn normalize_() {
        assert_eq!(normalize(1.0, ComponentType::Uint8), 255.0);
        assert_eq!(normalize(0.5, ComponentType::Uint8Clamped), 128.0);
        assert_eq!(normalize(-1.0, ComponentType::Int16), -32767.0);
        assert_eq!(normalize(0.25, ComponentType::Float32), 0.25);
    }
}
