//! Hot kernels with two implementations: the scalar reference and a wasm `simd128` path.
//!
//! `Matrix4::multiply_matrices`, `Vector3::apply_matrix4`, `Vector4::apply_matrix4` and
//! `Vector3::transform_direction` call the functions re-exported at the bottom of this
//! file. The `simd` cargo feature selects [`simd128`] on wasm32; everywhere else, and
//! without the feature, they are the [`scalar`] functions.
//!
//! The simd path promotes to `f64x2` and keeps the scalar operation order, so both paths
//! are bit-identical (DECISIONS.md D3). Both modules stay public so tests can compare them.

#[cfg(all(feature = "simd", target_arch = "wasm32", not(target_feature = "simd128")))]
compile_error!(
    "feature `simd` on wasm32 needs the simd128 target feature: \
     set RUSTFLAGS=\"-C target-feature=+simd128\""
);

pub mod scalar {
    use crate::wide;

    fn widen<const N: usize>(a: &[f32; N]) -> [f64; N] {
        a.map(|x| x as f64)
    }

    pub fn mat4_multiply(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
        wide::m4_multiply(&widen(a), &widen(b)).map(|x| x as f32)
    }

    pub fn vec3_apply_mat4(v: [f32; 3], m: &[f32; 16]) -> [f32; 3] {
        wide::apply_m4(widen(&v), &widen(m)).map(|x| x as f32)
    }

    pub fn vec3_transform_direction(v: [f32; 3], m: &[f32; 16]) -> [f32; 3] {
        wide::transform_direction(widen(&v), &widen(m)).map(|x| x as f32)
    }

    pub fn vec4_apply_mat4(v: [f32; 4], m: &[f32; 16]) -> [f32; 4] {
        let [x, y, z, w] = widen(&v);
        let e = widen(m);
        [
            (e[0] * x + e[4] * y + e[8] * z + e[12] * w) as f32,
            (e[1] * x + e[5] * y + e[9] * z + e[13] * w) as f32,
            (e[2] * x + e[6] * y + e[10] * z + e[14] * w) as f32,
            (e[3] * x + e[7] * y + e[11] * z + e[15] * w) as f32,
        ]
    }
}

#[cfg(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128"))]
pub mod simd128 {
    use crate::wide;
    use core::arch::wasm32::*;

    #[inline]
    fn column(m: &[f32; 16], c: usize) -> (v128, v128) {
        let col = f32x4(m[c * 4], m[c * 4 + 1], m[c * 4 + 2], m[c * 4 + 3]);
        let hi = i32x4_shuffle::<2, 3, 0, 1>(col, col);
        (f64x2_promote_low_f32x4(col), f64x2_promote_low_f32x4(hi))
    }

    #[inline]
    fn columns(m: &[f32; 16]) -> [(v128, v128); 4] {
        [column(m, 0), column(m, 1), column(m, 2), column(m, 3)]
    }

    #[inline]
    fn lanes(v: v128) -> [f64; 2] {
        [f64x2_extract_lane::<0>(v), f64x2_extract_lane::<1>(v)]
    }

    #[inline]
    fn narrow(lo: v128, hi: v128) -> [f32; 4] {
        let v = i32x4_shuffle::<0, 1, 4, 5>(f32x4_demote_f64x2_zero(lo), f32x4_demote_f64x2_zero(hi));
        [
            f32x4_extract_lane::<0>(v),
            f32x4_extract_lane::<1>(v),
            f32x4_extract_lane::<2>(v),
            f32x4_extract_lane::<3>(v),
        ]
    }

    #[inline]
    fn combine(cols: &[(v128, v128); 4], x: f64, y: f64, z: f64, w: f64) -> (v128, v128) {
        let (sx, sy, sz, sw) = (f64x2_splat(x), f64x2_splat(y), f64x2_splat(z), f64x2_splat(w));
        let half = |c0: v128, c1: v128, c2: v128, c3: v128| {
            f64x2_add(
                f64x2_add(f64x2_add(f64x2_mul(c0, sx), f64x2_mul(c1, sy)), f64x2_mul(c2, sz)),
                f64x2_mul(c3, sw),
            )
        };
        (
            half(cols[0].0, cols[1].0, cols[2].0, cols[3].0),
            half(cols[0].1, cols[1].1, cols[2].1, cols[3].1),
        )
    }

    pub fn mat4_multiply(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
        let cols = columns(a);
        let mut te = [0.0; 16];
        for j in 0..4 {
            let (lo, hi) = combine(
                &cols,
                b[j * 4] as f64,
                b[j * 4 + 1] as f64,
                b[j * 4 + 2] as f64,
                b[j * 4 + 3] as f64,
            );
            te[j * 4..j * 4 + 4].copy_from_slice(&narrow(lo, hi));
        }
        te
    }

    #[inline]
    fn combine3(cols: &[(v128, v128); 4], v: [f32; 3]) -> (v128, v128) {
        let (sx, sy, sz) = (
            f64x2_splat(v[0] as f64),
            f64x2_splat(v[1] as f64),
            f64x2_splat(v[2] as f64),
        );
        let half = |c0: v128, c1: v128, c2: v128| {
            f64x2_add(f64x2_add(f64x2_mul(c0, sx), f64x2_mul(c1, sy)), f64x2_mul(c2, sz))
        };
        (
            half(cols[0].0, cols[1].0, cols[2].0),
            half(cols[0].1, cols[1].1, cols[2].1),
        )
    }

    pub fn vec3_apply_mat4(v: [f32; 3], m: &[f32; 16]) -> [f32; 3] {
        let cols = columns(m);
        let (lo, hi) = combine3(&cols, v);
        // the translation column is added last, as in the scalar expression
        let [x, y] = lanes(f64x2_add(lo, cols[3].0));
        let [z, pw] = lanes(f64x2_add(hi, cols[3].1));
        let w = 1.0 / pw;
        [(x * w) as f32, (y * w) as f32, (z * w) as f32]
    }

    pub fn vec3_transform_direction(v: [f32; 3], m: &[f32; 16]) -> [f32; 3] {
        let cols = columns(m);
        let (lo, hi) = combine3(&cols, v);
        let [x, y] = lanes(lo);
        let [z, _] = lanes(hi);
        wide::normalize([x, y, z]).map(|c| c as f32)
    }

    pub fn vec4_apply_mat4(v: [f32; 4], m: &[f32; 16]) -> [f32; 4] {
        let (lo, hi) = combine(&columns(m), v[0] as f64, v[1] as f64, v[2] as f64, v[3] as f64);
        narrow(lo, hi)
    }
}

#[cfg(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128"))]
pub(crate) use simd128::{mat4_multiply, vec3_apply_mat4, vec3_transform_direction, vec4_apply_mat4};

#[cfg(not(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128")))]
pub(crate) use scalar::{mat4_multiply, vec3_apply_mat4, vec3_transform_direction, vec4_apply_mat4};

#[cfg(test)]
mod tests {
    use super::*;

    const TRANSLATE_123: [f32; 16] = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 2.0, 3.0, 1.0,
    ];
    const SCALE_234: [f32; 16] = [
        2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];

    #[test]
    fn scalar_mat4_multiply() {
        let m = scalar::mat4_multiply(&TRANSLATE_123, &SCALE_234);
        assert_eq!(
            m,
            [2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 4.0, 0.0, 1.0, 2.0, 3.0, 1.0]
        );
    }

    #[test]
    fn scalar_vec3_apply_mat4() {
        assert_eq!(scalar::vec3_apply_mat4([1.0, 1.0, 1.0], &TRANSLATE_123), [2.0, 3.0, 4.0]);
    }

    #[test]
    fn scalar_vec3_transform_direction() {
        // translation is ignored and the result is normalized
        assert_eq!(scalar::vec3_transform_direction([0.0, 5.0, 0.0], &TRANSLATE_123), [0.0, 1.0, 0.0]);
    }

    #[test]
    fn scalar_vec4_apply_mat4() {
        assert_eq!(scalar::vec4_apply_mat4([1.0, 1.0, 1.0, 1.0], &TRANSLATE_123), [2.0, 3.0, 4.0, 1.0]);
        assert_eq!(scalar::vec4_apply_mat4([1.0, 1.0, 1.0, 0.0], &TRANSLATE_123), [1.0, 1.0, 1.0, 0.0]);
    }

    #[cfg(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128"))]
    #[test]
    fn simd128_agrees_with_scalar() {
        use crate::math_utils::seeded_random;

        let next = {
            seeded_random(Some(186));
            move |range: f64| ((seeded_random(None) * 2.0 - 1.0) * range) as f32
        };
        let same = |a: &[f32], b: &[f32]| {
            a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()))
        };
        let mut max_diff = 0.0f64;
        let mut track = |a: &[f32], b: &[f32]| {
            for (x, y) in a.iter().zip(b) {
                if x.is_finite() && y.is_finite() {
                    max_diff = max_diff.max((*x as f64 - *y as f64).abs());
                }
            }
        };

        for round in 0..20_000 {
            // mix small, ordinary and large magnitudes
            let range = [1.0, 10.0, 1.0e3, 1.0e-3][round % 4];
            let a: [f32; 16] = core::array::from_fn(|_| next(range));
            let b: [f32; 16] = core::array::from_fn(|_| next(range));
            let v: [f32; 4] = core::array::from_fn(|_| next(range));
            let v3 = [v[0], v[1], v[2]];

            let (s, p) = (scalar::mat4_multiply(&a, &b), simd128::mat4_multiply(&a, &b));
            track(&s, &p);
            assert!(same(&s, &p), "mat4_multiply {round}: {s:?} vs {p:?}");

            let (s, p) = (scalar::vec3_apply_mat4(v3, &a), simd128::vec3_apply_mat4(v3, &a));
            track(&s, &p);
            assert!(same(&s, &p), "vec3_apply_mat4 {round}: {s:?} vs {p:?}");

            let (s, p) = (
                scalar::vec3_transform_direction(v3, &a),
                simd128::vec3_transform_direction(v3, &a),
            );
            track(&s, &p);
            assert!(same(&s, &p), "vec3_transform_direction {round}: {s:?} vs {p:?}");

            let (s, p) = (scalar::vec4_apply_mat4(v, &a), simd128::vec4_apply_mat4(v, &a));
            track(&s, &p);
            assert!(same(&s, &p), "vec4_apply_mat4 {round}: {s:?} vs {p:?}");
        }

        assert!(max_diff <= 1e-6);
        println!("simd128 vs scalar: 20000 rounds x 4 kernels, max |diff| = {max_diff:e}");
    }
}
