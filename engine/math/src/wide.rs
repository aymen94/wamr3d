//! f64 working-precision helpers.
//!
//! Public types store f32 but every function computes in f64, exactly as the
//! JavaScript source does, and rounds once on store (DECISIONS.md D1). The shared
//! pieces of that arithmetic live here so each formula exists once.

use crate::euler::EulerOrder;

pub(crate) type W3 = [f64; 3];
pub(crate) type W4 = [f64; 4];
pub(crate) type WM3 = [f64; 9];
pub(crate) type WM4 = [f64; 16];

// ---- JS number semantics

pub(crate) fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

pub(crate) fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

pub(crate) fn max32(a: f32, b: f32) -> f32 {
    max(a as f64, b as f64) as f32
}

pub(crate) fn min32(a: f32, b: f32) -> f32 {
    min(a as f64, b as f64) as f32
}

pub(crate) fn clamp(value: f64, lo: f64, hi: f64) -> f64 {
    max(lo, min(hi, value))
}

pub(crate) fn clamp32(value: f32, lo: f32, hi: f32) -> f32 {
    max32(lo, min32(hi, value))
}

pub(crate) fn round(x: f64) -> f64 {
    let r = x.floor();
    if x - r >= 0.5 {
        r + 1.0
    } else {
        r
    }
}

pub(crate) fn or_one(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        1.0
    } else {
        x
    }
}

// ---- Vector3 arithmetic

pub(crate) fn add(a: W3, b: W3) -> W3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub(crate) fn sub(a: W3, b: W3) -> W3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn scale(a: W3, s: f64) -> W3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

pub(crate) fn add_scaled(a: W3, v: W3, s: f64) -> W3 {
    [a[0] + v[0] * s, a[1] + v[1] * s, a[2] + v[2] * s]
}

pub(crate) fn dot(a: W3, b: W3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn cross(a: W3, b: W3) -> W3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(crate) fn length_sq(a: W3) -> f64 {
    dot(a, a)
}

pub(crate) fn length(a: W3) -> f64 {
    length_sq(a).sqrt()
}

// `divideScalar( length || 1 )` multiplies by the reciprocal; it does not divide.
pub(crate) fn normalize(a: W3) -> W3 {
    scale(a, 1.0 / or_one(length(a)))
}

pub(crate) fn distance_sq(a: W3, b: W3) -> f64 {
    let d = sub(a, b);
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

pub(crate) fn apply_m3(v: W3, e: &WM3) -> W3 {
    let [x, y, z] = v;
    [
        e[0] * x + e[3] * y + e[6] * z,
        e[1] * x + e[4] * y + e[7] * z,
        e[2] * x + e[5] * y + e[8] * z,
    ]
}

pub(crate) fn apply_m4(v: W3, e: &WM4) -> W3 {
    let [x, y, z] = v;
    let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    [
        (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
        (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
        (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
    ]
}

pub(crate) fn transform_direction(v: W3, e: &WM4) -> W3 {
    let [x, y, z] = v;
    normalize([
        e[0] * x + e[4] * y + e[8] * z,
        e[1] * x + e[5] * y + e[9] * z,
        e[2] * x + e[6] * y + e[10] * z,
    ])
}

pub(crate) fn apply_quaternion(v: W3, q: W4) -> W3 {
    let [vx, vy, vz] = v;
    let [qx, qy, qz, qw] = q;
    // t = 2 * cross( q.xyz, v );
    let tx = 2.0 * (qy * vz - qz * vy);
    let ty = 2.0 * (qz * vx - qx * vz);
    let tz = 2.0 * (qx * vy - qy * vx);
    // v + q.w * t + cross( q.xyz, t );
    [
        vx + qw * tx + qy * tz - qz * ty,
        vy + qw * ty + qz * tx - qx * tz,
        vz + qw * tz + qx * ty - qy * tx,
    ]
}

mod matrices;
mod rotations;
pub(crate) use matrices::*;
pub(crate) use rotations::*;

#[cfg(test)]
mod tests;
