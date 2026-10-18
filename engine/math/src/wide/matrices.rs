//! Matrix3 and Matrix4.

use super::*;

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
