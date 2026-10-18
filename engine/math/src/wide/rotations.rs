//! Quaternion and Euler.

use super::*;

/// Sine and cosine of one angle together, sharing the argument reduction. This is the
/// hot spot of setting many rotations: the library routines reduce the argument once
/// per call, and WebAssembly has no native trigonometry.
///
/// The angle is reduced to `r` in [-pi/4, pi/4] with pi/2 split into a part whose
/// multiples are exact and a remainder, then both functions come from the usual minimax
/// polynomials on that interval. Results are within about one unit in the last place of
/// the f64 value, far below what survives rounding to f32. Angles too large for the
/// split to stay exact, and non-finite ones, take the library path.
#[inline]
pub(crate) fn sin_cos(x: f64) -> (f64, f64) {
    if !(x.abs() < 8192.0) {
        return (x.sin(), x.cos());
    }

    // the first 33 bits of pi/2, so that k * PIO2_HIGH is exact for the k that occur
    const PIO2_HIGH: f64 = 1.570_796_326_734_125_614_17;
    const PIO2_LOW: f64 = 6.077_100_506_506_192_249_32e-11;

    let k = (x * core::f64::consts::FRAC_2_PI + 0.5).floor();
    let r = (x - k * PIO2_HIGH) - k * PIO2_LOW;
    let r2 = r * r;

    let sin = r + r * r2
        * (-1.666_666_666_666_663_243_48e-1
            + r2 * (8.333_333_333_322_489_461_24e-3
                + r2 * (-1.984_126_982_985_794_931_34e-4
                    + r2 * (2.755_731_370_707_006_767_89e-6 + r2 * (-2.505_076_025_340_686_341_95e-8 + r2 * 1.589_690_995_211_550_102_21e-10)))));
    let cos = 1.0 - 0.5 * r2
        + r2 * r2
            * (4.166_666_666_666_660_190_37e-2
                + r2 * (-1.388_888_888_887_410_957_49e-3
                    + r2 * (2.480_158_728_947_672_941_78e-5
                        + r2 * (-2.755_731_435_139_066_330_35e-7 + r2 * (2.087_572_321_298_174_827_90e-9 + r2 * -1.135_964_755_778_819_482_65e-11)))));

    match (k as i64) & 3 {
        0 => (sin, cos),
        1 => (cos, -sin),
        2 => (-sin, -cos),
        _ => (-cos, sin),
    }
}

pub(crate) fn quat_from_euler(x: f64, y: f64, z: f64, order: EulerOrder) -> W4 {
    let (s1, c1) = sin_cos(x / 2.0);
    let (s2, c2) = sin_cos(y / 2.0);
    let (s3, c3) = sin_cos(z / 2.0);

    match order {
        EulerOrder::XYZ => [
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        ],
        EulerOrder::YXZ => [
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        ],
        EulerOrder::ZXY => [
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        ],
        EulerOrder::ZYX => [
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        ],
        EulerOrder::YZX => [
            s1 * c2 * c3 + c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 - s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3,
        ],
        EulerOrder::XZY => [
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 - s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 + s1 * s2 * s3,
        ],
    }
}

pub(crate) fn quat_from_axis_angle(axis: W3, angle: f64) -> W4 {
    let half_angle = angle / 2.0;
    let s = half_angle.sin();
    [axis[0] * s, axis[1] * s, axis[2] * s, half_angle.cos()]
}

// assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)
pub(crate) fn quat_from_rotation(te: &WM4) -> W4 {
    let (m11, m12, m13) = (te[0], te[4], te[8]);
    let (m21, m22, m23) = (te[1], te[5], te[9]);
    let (m31, m32, m33) = (te[2], te[6], te[10]);
    let trace = m11 + m22 + m33;

    if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]
    } else if m11 > m22 && m11 > m33 {
        let s = 2.0 * (1.0 + m11 - m22 - m33).sqrt();
        [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]
    } else if m22 > m33 {
        let s = 2.0 * (1.0 + m22 - m11 - m33).sqrt();
        [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]
    } else {
        let s = 2.0 * (1.0 + m33 - m11 - m22).sqrt();
        [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]
    }
}

pub(crate) fn quat_normalize(q: W4) -> W4 {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l == 0.0 {
        [0.0, 0.0, 0.0, 1.0]
    } else {
        let l = 1.0 / l;
        [q[0] * l, q[1] * l, q[2] * l, q[3] * l]
    }
}

pub(crate) fn quat_multiply(a: W4, b: W4) -> W4 {
    let [qax, qay, qaz, qaw] = a;
    let [qbx, qby, qbz, qbw] = b;
    [
        qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
        qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
        qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
        qaw * qbw - qax * qbx - qay * qby - qaz * qbz,
    ]
}

pub(crate) fn quat_slerp(qa: W4, qb: W4, t: f64) -> W4 {
    let [mut x, mut y, mut z, mut w] = qb;
    let mut dot = qa[0] * x + qa[1] * y + qa[2] * z + qa[3] * w;

    if dot < 0.0 {
        x = -x;
        y = -y;
        z = -z;
        w = -w;
        dot = -dot;
    }

    let mut s = 1.0 - t;
    let mut t = t;

    if dot < 0.9995 {
        // slerp
        let theta = dot.acos();
        let sin = theta.sin();

        s = (s * theta).sin() / sin;
        t = (t * theta).sin() / sin;

        [
            qa[0] * s + x * t,
            qa[1] * s + y * t,
            qa[2] * s + z * t,
            qa[3] * s + w * t,
        ]
    } else {
        // for small angles, lerp then normalize
        quat_normalize([
            qa[0] * s + x * t,
            qa[1] * s + y * t,
            qa[2] * s + z * t,
            qa[3] * s + w * t,
        ])
    }
}

// ---- Euler

// assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)
pub(crate) fn euler_from_rotation(te: &WM4, order: EulerOrder) -> W3 {
    let (m11, m12, m13) = (te[0], te[4], te[8]);
    let (m21, m22, m23) = (te[1], te[5], te[9]);
    let (m31, m32, m33) = (te[2], te[6], te[10]);
    let (x, y, z);

    match order {
        EulerOrder::XYZ => {
            y = clamp(m13, -1.0, 1.0).asin();

            if m13.abs() < 0.9999999 {
                x = (-m23).atan2(m33);
                z = (-m12).atan2(m11);
            } else {
                x = m32.atan2(m22);
                z = 0.0;
            }
        }
        EulerOrder::YXZ => {
            x = (-clamp(m23, -1.0, 1.0)).asin();

            if m23.abs() < 0.9999999 {
                y = m13.atan2(m33);
                z = m21.atan2(m22);
            } else {
                y = (-m31).atan2(m11);
                z = 0.0;
            }
        }
        EulerOrder::ZXY => {
            x = clamp(m32, -1.0, 1.0).asin();

            if m32.abs() < 0.9999999 {
                y = (-m31).atan2(m33);
                z = (-m12).atan2(m22);
            } else {
                y = 0.0;
                z = m21.atan2(m11);
            }
        }
        EulerOrder::ZYX => {
            y = (-clamp(m31, -1.0, 1.0)).asin();

            if m31.abs() < 0.9999999 {
                x = m32.atan2(m33);
                z = m21.atan2(m11);
            } else {
                x = 0.0;
                z = (-m12).atan2(m22);
            }
        }
        EulerOrder::YZX => {
            z = clamp(m21, -1.0, 1.0).asin();

            if m21.abs() < 0.9999999 {
                x = (-m23).atan2(m22);
                y = (-m31).atan2(m11);
            } else {
                x = 0.0;
                y = m13.atan2(m33);
            }
        }
        EulerOrder::XZY => {
            z = (-clamp(m12, -1.0, 1.0)).asin();

            if m12.abs() < 0.9999999 {
                x = m32.atan2(m22);
                y = m13.atan2(m11);
            } else {
                x = (-m23).atan2(m33);
                y = 0.0;
            }
        }
    }

    [x, y, z]
}
