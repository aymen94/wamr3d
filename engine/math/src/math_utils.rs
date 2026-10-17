//! `random` stands in for JavaScript's `Math.random`, which three.js reads in
//! `generateUUID`, `randInt`, `randFloat` and `randFloatSpread`. Rust's standard library
//! has no random source, so the crate carries a SplitMix64 generator. It starts from a
//! fixed state; the JavaScript package seeds it from `crypto.getRandomValues` at start-up,
//! and `set_random_seed` restarts it for reproducible runs.

use crate::quaternion::Quaternion;
use crate::wide;
use std::cell::Cell;

pub const DEG2RAD: f32 = (core::f64::consts::PI / 180.0) as f32;

pub const RAD2DEG: f32 = (180.0 / core::f64::consts::PI) as f32;

const DEG2RAD_WIDE: f64 = core::f64::consts::PI / 180.0;
const RAD2DEG_WIDE: f64 = 180.0 / core::f64::consts::PI;

thread_local! {
    static SEED: Cell<u32> = const { Cell::new(1234567) };
    static RANDOM: Cell<u64> = const { Cell::new(0x853C_49E6_748F_EA9B) };
}

const HEX: &[u8; 16] = b"0123456789abcdef";

pub fn clamp(value: f32, min: f32, max: f32) -> f32 {
    wide::clamp32(value, min, max)
}

fn euclidean_modulo_wide(n: f64, m: f64) -> f64 {
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

/// Restarts the sequence behind `random`: the same seed gives the same numbers.
pub fn set_random_seed(seed: u64) {
    RANDOM.with(|state| state.set(seed));
}

/// Uniform in [0, 1) with 53 random bits, the resolution of `Math.random`.
pub fn random() -> f64 {
    RANDOM.with(|state| {
        // SplitMix64
        let mut z = state.get().wrapping_add(0x9E37_79B9_7F4A_7C15);
        state.set(z);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    })
}

/// Random integer in [low, high], both included. In f64 so that any JavaScript safe
/// integer range works, as in three.js.
pub fn rand_int(low: f64, high: f64) -> f64 {
    low + (random() * (high - low + 1.0)).floor()
}

/// Random float in [low, high).
pub fn rand_float(low: f64, high: f64) -> f64 {
    low + random() * (high - low)
}

/// Random float in (-range / 2, range / 2].
pub fn rand_float_spread(range: f64) -> f64 {
    range * (0.5 - random())
}

/// A version 4 UUID in lower case, such as `"3f2c1a7e-9b0d-4e8a-a1c4-5d6e7f809a1b"`.
pub fn generate_uuid() -> String {
    // `Math.random() * 0xffffffff | 0`: truncated; only the low 32 bits are read.
    let mut d = [0u32; 4];
    for word in d.iter_mut() {
        *word = (random() * 4294967295.0) as u32;
    }
    let bytes = [
        d[0] & 0xff, d[0] >> 8 & 0xff, d[0] >> 16 & 0xff, d[0] >> 24 & 0xff,
        d[1] & 0xff, d[1] >> 8 & 0xff, d[1] >> 16 & 0x0f | 0x40, d[1] >> 24 & 0xff,
        d[2] & 0x3f | 0x80, d[2] >> 8 & 0xff, d[2] >> 16 & 0xff, d[2] >> 24 & 0xff,
        d[3] & 0xff, d[3] >> 8 & 0xff, d[3] >> 16 & 0xff, d[3] >> 24 & 0xff,
    ];
    let mut uuid = String::with_capacity(36);
    for (i, byte) in bytes.iter().enumerate() {
        if matches!(i, 4 | 6 | 8 | 10) {
            uuid.push('-');
        }
        uuid.push(HEX[(byte >> 4) as usize] as char);
        uuid.push(HEX[(byte & 0x0f) as usize] as char);
    }
    uuid
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

    let (s2, c2) = (b / 2.0).sin_cos();
    let (s13, c13) = ((a + c) / 2.0).sin_cos();
    let (s1_3, c1_3) = ((a - c) / 2.0).sin_cos();
    let (s3_1, c3_1) = (-s1_3, c1_3);

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
    fn random_is_seedable_and_in_range() {
        set_random_seed(7);
        let a: Vec<f64> = (0..1000).map(|_| random()).collect();
        set_random_seed(7);
        let b: Vec<f64> = (0..1000).map(|_| random()).collect();
        assert_eq!(a, b);
        assert!(a.iter().all(|x| (0.0..1.0).contains(x)));
        let mean = a.iter().sum::<f64>() / a.len() as f64;
        assert!((mean - 0.5).abs() < 0.05, "mean {mean}");
    }

    #[test]
    fn rand_int_covers_both_ends() {
        set_random_seed(11);
        let values: Vec<f64> = (0..2000).map(|_| rand_int(-8.0, 8.0)).collect();
        assert!(values.iter().all(|v| v.fract() == 0.0 && (-8.0..=8.0).contains(v)));
        for expected in -8..=8 {
            assert!(values.contains(&(expected as f64)), "{expected} never drawn");
        }
        assert_eq!(rand_int(3.0, 3.0), 3.0);
    }

    #[test]
    fn rand_float_and_spread_ranges() {
        set_random_seed(3);
        for _ in 0..1000 {
            let f = rand_float(2.0, 5.0);
            assert!((2.0..5.0).contains(&f));
            let s = rand_float_spread(10.0);
            assert!(s > -5.0 && s <= 5.0);
        }
    }

    #[test]
    fn generate_uuid_is_version_4() {
        set_random_seed(5);
        let a = generate_uuid();
        let b = generate_uuid();
        assert_ne!(a, b);
        for uuid in [&a, &b] {
            assert_eq!(uuid.len(), 36);
            let parts: Vec<&str> = uuid.split('-').collect();
            assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
            assert!(uuid.chars().all(|c| c == '-' || c.is_ascii_digit() || ('a'..='f').contains(&c)));
            assert!(parts[2].starts_with('4'));
            assert!(matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'));
        }
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
