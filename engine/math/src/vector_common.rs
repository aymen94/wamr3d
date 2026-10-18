//! Each method cites its source as `<Type>.js:<method>`, where `<Type>` is the type the
//! macro is invoked for.

macro_rules! vector_common {
    ($T:ident, $js:literal, $n:literal, $(($i:literal, $f:ident)),+) => {
        impl $T {
            #[doc = concat!("Widened components (AGENTS.md D1).")]
            #[inline]
            #[allow(dead_code)]
            pub(crate) fn wide(&self) -> [f64; $n] {
                [$(self.$f as f64),+]
            }

            #[inline]
            pub(crate) fn set_wide(&mut self, a: [f64; $n]) -> &mut Self {
                $(self.$f = a[$i] as f32;)+
                self
            }

            #[inline]
            #[allow(dead_code)]
            pub(crate) fn from_wide(a: [f64; $n]) -> Self {
                Self { $($f: a[$i] as f32),+ }
            }

            pub fn set_scalar(&mut self, scalar: f32) -> &mut Self {
                $(self.$f = scalar;)+
                self
            }

            pub fn set_component(&mut self, index: usize, value: f32) -> &mut Self {
                match index {
                    $($i => self.$f = value,)+
                    _ => panic!(concat!("THREE.", $js, ": index is out of range: {}"), index),
                }
                self
            }

            pub fn get_component(&self, index: usize) -> f32 {
                match index {
                    $($i => self.$f,)+
                    _ => panic!(concat!("THREE.", $js, ": index is out of range: {}"), index),
                }
            }

            pub fn add(&mut self, v: &Self) -> &mut Self {
                $(self.$f += v.$f;)+
                self
            }

            pub fn add_scalar(&mut self, s: f32) -> &mut Self {
                $(self.$f += s;)+
                self
            }

            pub fn add_vectors(&mut self, a: &Self, b: &Self) -> &mut Self {
                $(self.$f = a.$f + b.$f;)+
                self
            }

            pub fn add_scaled_vector(&mut self, v: &Self, s: f32) -> &mut Self {
                $(self.$f = (self.$f as f64 + v.$f as f64 * s as f64) as f32;)+
                self
            }

            pub fn sub(&mut self, v: &Self) -> &mut Self {
                $(self.$f -= v.$f;)+
                self
            }

            pub fn sub_scalar(&mut self, s: f32) -> &mut Self {
                $(self.$f -= s;)+
                self
            }

            pub fn sub_vectors(&mut self, a: &Self, b: &Self) -> &mut Self {
                $(self.$f = a.$f - b.$f;)+
                self
            }

            pub fn multiply(&mut self, v: &Self) -> &mut Self {
                $(self.$f *= v.$f;)+
                self
            }

            pub fn multiply_scalar(&mut self, scalar: f32) -> &mut Self {
                $(self.$f *= scalar;)+
                self
            }

            pub fn divide(&mut self, v: &Self) -> &mut Self {
                $(self.$f /= v.$f;)+
                self
            }

            pub fn divide_scalar(&mut self, scalar: f32) -> &mut Self {
                let inv = 1.0 / scalar as f64;
                $(self.$f = (self.$f as f64 * inv) as f32;)+
                self
            }

            pub fn min(&mut self, v: &Self) -> &mut Self {
                $(self.$f = crate::wide::min32(self.$f, v.$f);)+
                self
            }

            pub fn max(&mut self, v: &Self) -> &mut Self {
                $(self.$f = crate::wide::max32(self.$f, v.$f);)+
                self
            }

            pub fn clamp(&mut self, min: &Self, max: &Self) -> &mut Self {
                $(self.$f = crate::wide::clamp32(self.$f, min.$f, max.$f);)+
                self
            }

            pub fn clamp_scalar(&mut self, min_val: f32, max_val: f32) -> &mut Self {
                $(self.$f = crate::wide::clamp32(self.$f, min_val, max_val);)+
                self
            }

            pub fn clamp_length(&mut self, min: f32, max: f32) -> &mut Self {
                let length = self.length_wide();
                let inv = 1.0 / crate::wide::or_one(length);
                let scalar = crate::wide::clamp(length, min as f64, max as f64);
                $(self.$f = (self.$f as f64 * inv * scalar) as f32;)+
                self
            }

            pub fn floor(&mut self) -> &mut Self {
                $(self.$f = self.$f.floor();)+
                self
            }

            pub fn ceil(&mut self) -> &mut Self {
                $(self.$f = self.$f.ceil();)+
                self
            }

            pub fn round(&mut self) -> &mut Self {
                $(self.$f = crate::wide::round(self.$f as f64) as f32;)+
                self
            }

            pub fn round_to_zero(&mut self) -> &mut Self {
                $(self.$f = self.$f.trunc();)+
                self
            }

            pub fn negate(&mut self) -> &mut Self {
                $(self.$f = -self.$f;)+
                self
            }

            #[inline]
            pub(crate) fn dot_wide(&self, v: &Self) -> f64 {
                0.0 $(+ self.$f as f64 * v.$f as f64)+
            }

            #[inline]
            pub(crate) fn length_sq_wide(&self) -> f64 {
                self.dot_wide(self)
            }

            #[inline]
            pub(crate) fn length_wide(&self) -> f64 {
                self.length_sq_wide().sqrt()
            }

            pub fn dot(&self, v: &Self) -> f32 {
                self.dot_wide(v) as f32
            }

            pub fn length_sq(&self) -> f32 {
                self.length_sq_wide() as f32
            }

            pub fn length(&self) -> f32 {
                self.length_wide() as f32
            }

            pub fn manhattan_length(&self) -> f32 {
                (0.0 $(+ (self.$f as f64).abs())+) as f32
            }

            pub fn normalize(&mut self) -> &mut Self {
                let inv = 1.0 / crate::wide::or_one(self.length_wide());
                $(self.$f = (self.$f as f64 * inv) as f32;)+
                self
            }

            pub fn set_length(&mut self, length: f32) -> &mut Self {
                let inv = 1.0 / crate::wide::or_one(self.length_wide());
                $(self.$f = (self.$f as f64 * inv * length as f64) as f32;)+
                self
            }

            pub fn lerp(&mut self, v: &Self, alpha: f32) -> &mut Self {
                $(self.$f = (self.$f as f64 + (v.$f as f64 - self.$f as f64) * alpha as f64) as f32;)+
                self
            }

            pub fn lerp_vectors(&mut self, v1: &Self, v2: &Self, alpha: f32) -> &mut Self {
                $(self.$f = (v1.$f as f64 + (v2.$f as f64 - v1.$f as f64) * alpha as f64) as f32;)+
                self
            }

            pub fn equals(&self, v: &Self) -> bool {
                true $(&& v.$f == self.$f)+
            }

            pub fn from_array(&mut self, array: &[f32], offset: usize) -> &mut Self {
                $(self.$f = array[offset + $i];)+
                self
            }

            pub fn to_array(&self) -> [f32; $n] {
                [$(self.$f),+]
            }

            pub fn to_array_into(&self, array: &mut [f32], offset: usize) {
                $(array[offset + $i] = self.$f;)+
            }
        }

        impl crate::triangle::Interpolate for $T {
            fn interpolate(v1: &Self, v2: &Self, v3: &Self, barycoord: [f64; 3]) -> Self {
                Self {
                    $($f: (0.0
                        + v1.$f as f64 * barycoord[0]
                        + v2.$f as f64 * barycoord[1]
                        + v3.$f as f64 * barycoord[2]) as f32),+
                }
            }
        }
    };
}

#[cfg(test)]
macro_rules! vector_common_tests {
    ($T:ident, $n:literal) => {
        mod common {
            use super::super::$T;

            fn v(a: [f32; 4]) -> $T {
                let mut t = $T::default();
                t.from_array(&a, 0);
                t
            }

            fn eq(t: &$T, a: [f32; 4]) {
                assert_eq!(t.to_array()[..], a[..$n]);
            }

            const A: [f32; 4] = [1.0, -2.0, 3.0, -4.0];
            const B: [f32; 4] = [0.5, 4.0, -1.5, 2.0];

            #[test]
            fn widen_and_narrow() {
                let a = v(A);
                assert_eq!($T::from_wide(a.wide()), a);
                let mut b = $T::default();
                b.set_wide(a.wide());
                assert_eq!(b, a);
            }

            #[test]
            fn set_scalar() {
                eq(v(A).set_scalar(7.0), [7.0; 4]);
            }

            #[test]
            fn set_component_and_get_component() {
                let mut a = v(A);
                a.set_component($n - 1, 9.0);
                assert_eq!(a.get_component($n - 1), 9.0);
                assert_eq!(a.get_component(0), 1.0);
            }

            #[test]
            #[should_panic(expected = "index is out of range")]
            fn set_component_out_of_range() {
                v(A).set_component($n, 0.0);
            }

            #[test]
            #[should_panic(expected = "index is out of range")]
            fn get_component_out_of_range() {
                v(A).get_component($n);
            }

            #[test]
            fn add() {
                eq(v(A).add(&v(B)), [1.5, 2.0, 1.5, -2.0]);
            }

            #[test]
            fn add_scalar() {
                eq(v(A).add_scalar(1.0), [2.0, -1.0, 4.0, -3.0]);
            }

            #[test]
            fn add_vectors() {
                eq($T::default().add_vectors(&v(A), &v(B)), [1.5, 2.0, 1.5, -2.0]);
            }

            #[test]
            fn add_scaled_vector() {
                eq(v(A).add_scaled_vector(&v(B), 2.0), [2.0, 6.0, 0.0, 0.0]);
            }

            #[test]
            fn sub() {
                eq(v(A).sub(&v(B)), [0.5, -6.0, 4.5, -6.0]);
            }

            #[test]
            fn sub_scalar() {
                eq(v(A).sub_scalar(1.0), [0.0, -3.0, 2.0, -5.0]);
            }

            #[test]
            fn sub_vectors() {
                eq($T::default().sub_vectors(&v(A), &v(B)), [0.5, -6.0, 4.5, -6.0]);
            }

            #[test]
            fn multiply() {
                eq(v(A).multiply(&v(B)), [0.5, -8.0, -4.5, -8.0]);
            }

            #[test]
            fn multiply_scalar() {
                eq(v(A).multiply_scalar(-2.0), [-2.0, 4.0, -6.0, 8.0]);
            }

            #[test]
            fn divide() {
                eq(v(A).divide(&v(B)), [2.0, -0.5, -2.0, -2.0]);
            }

            #[test]
            fn divide_scalar() {
                eq(v(A).divide_scalar(2.0), [0.5, -1.0, 1.5, -2.0]);
            }

            #[test]
            fn min() {
                eq(v(A).min(&v(B)), [0.5, -2.0, -1.5, -4.0]);
            }

            #[test]
            fn max() {
                eq(v(A).max(&v(B)), [1.0, 4.0, 3.0, 2.0]);
            }

            #[test]
            fn clamp() {
                eq(v(A).clamp(&v([-1.0; 4]), &v([2.0; 4])), [1.0, -1.0, 2.0, -1.0]);
            }

            #[test]
            fn clamp_scalar() {
                eq(v(A).clamp_scalar(-1.0, 2.0), [1.0, -1.0, 2.0, -1.0]);
            }

            #[test]
            fn clamp_length() {
                let mut a = v([3.0, 0.0, 0.0, 0.0]);
                eq(a.clamp_length(1.0, 2.0), [2.0, 0.0, 0.0, 0.0]);
                eq(a.clamp_length(4.0, 8.0), [4.0, 0.0, 0.0, 0.0]);
                // the zero vector has no direction and stays zero
                eq(v([0.0; 4]).clamp_length(1.0, 2.0), [0.0; 4]);
            }

            #[test]
            fn floor() {
                eq(v([1.5, -1.5, 2.0, -0.25]).floor(), [1.0, -2.0, 2.0, -1.0]);
            }

            #[test]
            fn ceil() {
                eq(v([1.5, -1.5, 2.0, -0.25]).ceil(), [2.0, -1.0, 2.0, 0.0]);
            }

            #[test]
            fn round() {
                // Math.round: halves go toward +Infinity
                eq(v([1.5, -1.5, 2.4, -2.5]).round(), [2.0, -1.0, 2.0, -2.0]);
            }

            #[test]
            fn round_to_zero() {
                eq(v([1.5, -1.5, 2.9, -2.9]).round_to_zero(), [1.0, -1.0, 2.0, -2.0]);
            }

            #[test]
            fn negate() {
                eq(v(A).negate(), [-1.0, 2.0, -3.0, 4.0]);
            }

            #[test]
            fn dot() {
                let expected: f32 = (0..$n).map(|i| A[i] * B[i]).sum();
                assert_eq!(v(A).dot(&v(B)), expected);
            }

            #[test]
            fn length_sq() {
                let expected: f32 = (0..$n).map(|i| A[i] * A[i]).sum();
                assert_eq!(v(A).length_sq(), expected);
            }

            #[test]
            fn length() {
                assert_eq!(v([3.0, 4.0, 0.0, 0.0]).length(), 5.0);
            }

            #[test]
            fn manhattan_length() {
                let expected: f32 = (0..$n).map(|i| A[i].abs()).sum();
                assert_eq!(v(A).manhattan_length(), expected);
            }

            #[test]
            fn normalize() {
                eq(v([3.0, 4.0, 0.0, 0.0]).normalize(), [0.6, 0.8, 0.0, 0.0]);
                eq(v([0.0; 4]).normalize(), [0.0; 4]);
            }

            #[test]
            fn set_length() {
                eq(v([3.0, 4.0, 0.0, 0.0]).set_length(10.0), [6.0, 8.0, 0.0, 0.0]);
            }

            #[test]
            fn lerp() {
                eq(v(A).lerp(&v(B), 0.5), [0.75, 1.0, 0.75, -1.0]);
                eq(v(A).lerp(&v(B), 0.0), A);
            }

            #[test]
            fn lerp_vectors() {
                eq($T::default().lerp_vectors(&v(A), &v(B), 0.5), [0.75, 1.0, 0.75, -1.0]);
                eq($T::default().lerp_vectors(&v(A), &v(B), 1.0), B);
            }

            #[test]
            fn equals() {
                assert!(v(A).equals(&v(A)));
                assert!(!v(A).equals(&v(B)));
                assert!(!v([f32::NAN; 4]).equals(&v([f32::NAN; 4])));
            }

            #[test]
            fn from_array_with_offset() {
                let data = [9.0, 1.0, -2.0, 3.0, -4.0];
                let mut a = $T::default();
                a.from_array(&data, 1);
                eq(&a, A);
            }

            #[test]
            fn to_array() {
                assert_eq!(v(A).to_array()[..], A[..$n]);
            }

            #[test]
            fn to_array_into() {
                let mut out = [0.0; 6];
                v(A).to_array_into(&mut out, 2);
                assert_eq!(out[..2], [0.0, 0.0]);
                assert_eq!(out[2..2 + $n], A[..$n]);
            }

            #[test]
            fn interpolate() {
                use crate::triangle::Interpolate;
                let r = $T::interpolate(&v(A), &v(B), &v([0.0; 4]), [0.5, 0.5, 0.0]);
                eq(&r, [0.75, 1.0, 0.75, -1.0]);
            }
        }
    };
}
