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

// ---- Matrix3

pub(crate) fn m3_from_m4(me: &WM4) -> WM3 {
    [
        me[0], me[1], me[2], me[4], me[5], me[6], me[8], me[9], me[10],
    ]
}

pub(crate) fn m3_invert(te: &WM3) -> WM3 {
    let (n11, n21, n31) = (te[0], te[1], te[2]);
    let (n12, n22, n32) = (te[3], te[4], te[5]);
    let (n13, n23, n33) = (te[6], te[7], te[8]);
    let t11 = n33 * n22 - n32 * n23;
    let t12 = n32 * n13 - n33 * n12;
    let t13 = n23 * n12 - n22 * n13;
    let det = n11 * t11 + n21 * t12 + n31 * t13;

    if det == 0.0 {
        return [0.0; 9];
    }

    let det_inv = 1.0 / det;
    [
        t11 * det_inv,
        (n31 * n23 - n33 * n21) * det_inv,
        (n32 * n21 - n31 * n22) * det_inv,
        t12 * det_inv,
        (n33 * n11 - n31 * n13) * det_inv,
        (n31 * n12 - n32 * n11) * det_inv,
        t13 * det_inv,
        (n21 * n13 - n23 * n11) * det_inv,
        (n22 * n11 - n21 * n12) * det_inv,
    ]
}

pub(crate) fn m3_transpose(m: &WM3) -> WM3 {
    [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

pub(crate) fn m3_normal_matrix(m4: &WM4) -> WM3 {
    m3_transpose(&m3_invert(&m3_from_m4(m4)))
}

// ---- Matrix4

// Each element is the left-to-right sum a_i1*b_1j + a_i2*b_2j + a_i3*b_3j + a_i4*b_4j.
pub(crate) fn m4_multiply(a: &WM4, b: &WM4) -> WM4 {
    let mut te = [0.0; 16];
    for j in 0..4 {
        for i in 0..4 {
            te[j * 4 + i] = a[i] * b[j * 4]
                + a[4 + i] * b[j * 4 + 1]
                + a[8 + i] * b[j * 4 + 2]
                + a[12 + i] * b[j * 4 + 3];
        }
    }
    te
}

pub(crate) fn m4_determinant_affine(te: &WM4) -> f64 {
    let (n11, n12, n13) = (te[0], te[4], te[8]);
    let (n21, n22, n23) = (te[1], te[5], te[9]);
    let (n31, n32, n33) = (te[2], te[6], te[10]);

    n11 * (n22 * n33 - n23 * n32) - n12 * (n21 * n33 - n23 * n31) + n13 * (n21 * n32 - n22 * n31)
}

pub(crate) fn m4_max_scale_on_axis(te: &WM4) -> f64 {
    let scale_x_sq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    let scale_y_sq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    let scale_z_sq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];

    max(max(scale_x_sq, scale_y_sq), scale_z_sq).sqrt()
}

pub(crate) fn m4_compose(position: W3, quaternion: W4, scale: W3) -> WM4 {
    let [x, y, z, w] = quaternion;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let [sx, sy, sz] = scale;

    [
        (1.0 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0.0,
        (xy - wz) * sy,
        (1.0 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0.0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1.0 - (xx + yy)) * sz,
        0.0,
        position[0],
        position[1],
        position[2],
        1.0,
    ]
}

pub(crate) fn m4_rotation_from_quaternion(q: W4) -> WM4 {
    m4_compose([0.0; 3], q, [1.0; 3])
}

pub(crate) fn m4_rotation_from_euler(x: f64, y: f64, z: f64, order: EulerOrder) -> WM4 {
    let mut te = [0.0; 16];
    let (a, b) = (x.cos(), x.sin());
    let (c, d) = (y.cos(), y.sin());
    let (e, f) = (z.cos(), z.sin());

    match order {
        EulerOrder::XYZ => {
            let (ae, af, be, bf) = (a * e, a * f, b * e, b * f);

            te[0] = c * e;
            te[4] = -c * f;
            te[8] = d;

            te[1] = af + be * d;
            te[5] = ae - bf * d;
            te[9] = -b * c;

            te[2] = bf - ae * d;
            te[6] = be + af * d;
            te[10] = a * c;
        }
        EulerOrder::YXZ => {
            let (ce, cf, de, df) = (c * e, c * f, d * e, d * f);

            te[0] = ce + df * b;
            te[4] = de * b - cf;
            te[8] = a * d;

            te[1] = a * f;
            te[5] = a * e;
            te[9] = -b;

            te[2] = cf * b - de;
            te[6] = df + ce * b;
            te[10] = a * c;
        }
        EulerOrder::ZXY => {
            let (ce, cf, de, df) = (c * e, c * f, d * e, d * f);

            te[0] = ce - df * b;
            te[4] = -a * f;
            te[8] = de + cf * b;

            te[1] = cf + de * b;
            te[5] = a * e;
            te[9] = df - ce * b;

            te[2] = -a * d;
            te[6] = b;
            te[10] = a * c;
        }
        EulerOrder::ZYX => {
            let (ae, af, be, bf) = (a * e, a * f, b * e, b * f);

            te[0] = c * e;
            te[4] = be * d - af;
            te[8] = ae * d + bf;

            te[1] = c * f;
            te[5] = bf * d + ae;
            te[9] = af * d - be;

            te[2] = -d;
            te[6] = b * c;
            te[10] = a * c;
        }
        EulerOrder::YZX => {
            let (ac, ad, bc, bd) = (a * c, a * d, b * c, b * d);

            te[0] = c * e;
            te[4] = bd - ac * f;
            te[8] = bc * f + ad;

            te[1] = f;
            te[5] = a * e;
            te[9] = -b * e;

            te[2] = -d * e;
            te[6] = ad * f + bc;
            te[10] = ac - bd * f;
        }
        EulerOrder::XZY => {
            let (ac, ad, bc, bd) = (a * c, a * d, b * c, b * d);

            te[0] = c * e;
            te[4] = -f;
            te[8] = d * e;

            te[1] = ac * f + bd;
            te[5] = a * e;
            te[9] = ad * f - bc;

            te[2] = bc * f - ad;
            te[6] = b * e;
            te[10] = bd * f + ac;
        }
    }

    // bottom row and last column are already zero
    te[15] = 1.0;
    te
}

// ---- Quaternion

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

#[cfg(test)]
mod tests {
    #[test]
    fn sin_cos_agrees_with_the_library_functions() {
        let mut worst = 0.0f64;
        let mut x = -40.0f64;
        while x < 40.0 {
            let (s, c) = super::sin_cos(x);
            worst = worst.max((s - x.sin()).abs()).max((c - x.cos()).abs());
            x += 0.000_917;
        }
        for x in [0.0, core::f64::consts::FRAC_PI_4, core::f64::consts::FRAC_PI_2, core::f64::consts::PI, -core::f64::consts::PI, 8191.9, -8191.9, 1e9, 1e300] {
            let (s, c) = super::sin_cos(x);
            worst = worst.max((s - x.sin()).abs()).max((c - x.cos()).abs());
        }
        assert!(worst < 4e-16, "largest difference {worst:e}");
        assert!(super::sin_cos(f64::NAN).0.is_nan() && super::sin_cos(f64::INFINITY).1.is_nan());
        assert_eq!(super::sin_cos(0.0), (0.0, 1.0));
    }

    use super::*;

    #[test]
    fn max_and_min_propagate_nan() {
        assert_eq!(max(1.0, 2.0), 2.0);
        assert_eq!(min(1.0, 2.0), 1.0);
        assert!(max(f64::NAN, 2.0).is_nan());
        assert!(min(1.0, f64::NAN).is_nan());
        assert_eq!(max32(-1.0, 3.0), 3.0);
        assert_eq!(min32(-1.0, 3.0), -1.0);
    }

    #[test]
    fn clamp_matches_js() {
        assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
        assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
        assert_eq!(clamp32(0.5, 0.0, 1.0), 0.5);
        // inverted bounds: max( min, min( max, value ) )
        assert_eq!(clamp(0.5, 1.0, 0.0), 1.0);
    }

    #[test]
    fn round_halves_toward_positive_infinity() {
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(-2.6), -3.0);
        assert_eq!(round(0.49), 0.0);
    }

    #[test]
    fn or_one_treats_zero_and_nan_as_falsy() {
        assert_eq!(or_one(0.0), 1.0);
        assert_eq!(or_one(f64::NAN), 1.0);
        assert_eq!(or_one(2.0), 2.0);
    }

    #[test]
    fn vector_helpers() {
        let (a, b) = ([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]);
        assert_eq!(add(a, b), [5.0, 7.0, 9.0]);
        assert_eq!(sub(b, a), [3.0, 3.0, 3.0]);
        assert_eq!(scale(a, 2.0), [2.0, 4.0, 6.0]);
        assert_eq!(add_scaled(a, b, 2.0), [9.0, 12.0, 15.0]);
        assert_eq!(dot(a, b), 32.0);
        assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
        assert_eq!(length_sq(a), 14.0);
        assert_eq!(length([3.0, 4.0, 0.0]), 5.0);
        assert_eq!(normalize([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(normalize([0.0, 4.0, 0.0]), [0.0, 1.0, 0.0]);
        assert_eq!(distance_sq(a, b), 27.0);
    }
}
