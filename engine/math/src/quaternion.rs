use crate::euler::Euler;
use crate::matrix4::Matrix4;
use crate::vector3::Vector3;
use crate::wide::{self, W4};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quaternion {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Default for Quaternion {
    fn default() -> Self {
        Self::new(0.0, 0.0, 0.0, 1.0)
    }
}

impl Quaternion {
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self { x, y, z, w }
    }

    #[inline]
    pub(crate) fn wide(&self) -> W4 {
        [self.x as f64, self.y as f64, self.z as f64, self.w as f64]
    }

    #[inline]
    pub(crate) fn set_wide(&mut self, q: W4) -> &mut Self {
        self.x = q[0] as f32;
        self.y = q[1] as f32;
        self.z = q[2] as f32;
        self.w = q[3] as f32;
        self
    }

    pub fn slerp_flat(
        dst: &mut [f32],
        dst_offset: usize,
        src0: &[f32],
        src_offset0: usize,
        src1: &[f32],
        src_offset1: usize,
        t: f32,
    ) {
        let mut t = t as f64;

        let mut x0 = src0[src_offset0] as f64;
        let mut y0 = src0[src_offset0 + 1] as f64;
        let mut z0 = src0[src_offset0 + 2] as f64;
        let mut w0 = src0[src_offset0 + 3] as f64;

        let mut x1 = src1[src_offset1] as f64;
        let mut y1 = src1[src_offset1 + 1] as f64;
        let mut z1 = src1[src_offset1 + 2] as f64;
        let mut w1 = src1[src_offset1 + 3] as f64;

        if w0 != w1 || x0 != x1 || y0 != y1 || z0 != z1 {
            let mut dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;

            if dot < 0.0 {
                x1 = -x1;
                y1 = -y1;
                z1 = -z1;
                w1 = -w1;

                dot = -dot;
            }

            let mut s = 1.0 - t;

            if dot < 0.9995 {
                // slerp

                let theta = dot.acos();
                let sin = theta.sin();

                s = (s * theta).sin() / sin;
                t = (t * theta).sin() / sin;

                x0 = x0 * s + x1 * t;
                y0 = y0 * s + y1 * t;
                z0 = z0 * s + z1 * t;
                w0 = w0 * s + w1 * t;
            } else {
                // for small angles, lerp then normalize

                x0 = x0 * s + x1 * t;
                y0 = y0 * s + y1 * t;
                z0 = z0 * s + z1 * t;
                w0 = w0 * s + w1 * t;

                let f = 1.0 / (x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0).sqrt();

                x0 *= f;
                y0 *= f;
                z0 *= f;
                w0 *= f;
            }
        }

        dst[dst_offset] = x0 as f32;
        dst[dst_offset + 1] = y0 as f32;
        dst[dst_offset + 2] = z0 as f32;
        dst[dst_offset + 3] = w0 as f32;
    }

    pub fn multiply_quaternions_flat(
        dst: &mut [f32],
        dst_offset: usize,
        src0: &[f32],
        src_offset0: usize,
        src1: &[f32],
        src_offset1: usize,
    ) {
        let a: W4 = core::array::from_fn(|i| src0[src_offset0 + i] as f64);
        let b: W4 = core::array::from_fn(|i| src1[src_offset1 + i] as f64);
        let r = wide::quat_multiply(a, b);

        for i in 0..4 {
            dst[dst_offset + i] = r[i] as f32;
        }
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, w: f32) -> &mut Self {
        self.x = x;
        self.y = y;
        self.z = z;
        self.w = w;
        self
    }

    pub fn copy(&mut self, quaternion: &Quaternion) -> &mut Self {
        *self = *quaternion;
        self
    }

    pub fn set_from_euler(&mut self, euler: &Euler) -> &mut Self {
        self.set_wide(wide::quat_from_euler(euler.x as f64, euler.y as f64, euler.z as f64, euler.order))
    }

    pub fn set_from_axis_angle(&mut self, axis: &Vector3, angle: f32) -> &mut Self {
        self.set_wide(wide::quat_from_axis_angle(axis.wide(), angle as f64))
    }

    pub fn set_from_rotation_matrix(&mut self, m: &Matrix4) -> &mut Self {
        self.set_wide(wide::quat_from_rotation(&m.wide()))
    }

    pub fn set_from_unit_vectors(&mut self, v_from: &Vector3, v_to: &Vector3) -> &mut Self {
        let (from, to) = (v_from.wide(), v_to.wide());
        let mut r = wide::dot(from, to) + 1.0;
        let q;

        if r < 1e-8 {
            // the epsilon value has been discussed in #31286

            // vFrom and vTo point in opposite directions

            r = 0.0;

            if from[0].abs() > from[2].abs() {
                q = [-from[1], from[0], 0.0, r];
            } else {
                q = [0.0, -from[2], from[1], r];
            }
        } else {
            let c = wide::cross(from, to);
            q = [c[0], c[1], c[2], r];
        }

        self.set_wide(wide::quat_normalize(q))
    }

    fn angle_to_wide(&self, q: &Quaternion) -> f64 {
        2.0 * wide::clamp(self.dot_wide(q), -1.0, 1.0).abs().acos()
    }

    pub fn angle_to(&self, q: &Quaternion) -> f32 {
        self.angle_to_wide(q) as f32
    }

    pub fn rotate_towards(&mut self, q: &Quaternion, step: f32) -> &mut Self {
        let angle = self.angle_to_wide(q);

        if angle == 0.0 {
            return self;
        }

        let t = wide::min(1.0, step as f64 / angle);

        self.set_wide(wide::quat_slerp(self.wide(), q.wide(), t))
    }

    pub fn identity(&mut self) -> &mut Self {
        self.set(0.0, 0.0, 0.0, 1.0)
    }

    pub fn invert(&mut self) -> &mut Self {
        self.conjugate()
    }

    pub fn conjugate(&mut self) -> &mut Self {
        self.x *= -1.0;
        self.y *= -1.0;
        self.z *= -1.0;
        self
    }

    #[inline]
    fn dot_wide(&self, v: &Quaternion) -> f64 {
        let (a, b) = (self.wide(), v.wide());
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
    }

    pub fn dot(&self, v: &Quaternion) -> f32 {
        self.dot_wide(v) as f32
    }

    pub fn length_sq(&self) -> f32 {
        self.dot_wide(self) as f32
    }

    pub fn length(&self) -> f32 {
        self.dot_wide(self).sqrt() as f32
    }

    pub fn normalize(&mut self) -> &mut Self {
        self.set_wide(wide::quat_normalize(self.wide()))
    }

    pub fn multiply(&mut self, q: &Quaternion) -> &mut Self {
        self.set_wide(wide::quat_multiply(self.wide(), q.wide()))
    }

    pub fn premultiply(&mut self, q: &Quaternion) -> &mut Self {
        self.set_wide(wide::quat_multiply(q.wide(), self.wide()))
    }

    pub fn multiply_quaternions(&mut self, a: &Quaternion, b: &Quaternion) -> &mut Self {
        self.set_wide(wide::quat_multiply(a.wide(), b.wide()))
    }

    pub fn slerp(&mut self, qb: &Quaternion, t: f32) -> &mut Self {
        self.set_wide(wide::quat_slerp(self.wide(), qb.wide(), t as f64))
    }

    pub fn slerp_quaternions(&mut self, qa: &Quaternion, qb: &Quaternion, t: f32) -> &mut Self {
        self.set_wide(wide::quat_slerp(qa.wide(), qb.wide(), t as f64))
    }

    pub fn equals(&self, quaternion: &Quaternion) -> bool {
        quaternion.x == self.x && quaternion.y == self.y && quaternion.z == self.z && quaternion.w == self.w
    }

    pub fn from_array(&mut self, array: &[f32], offset: usize) -> &mut Self {
        self.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3])
    }

    pub fn to_array(&self) -> [f32; 4] {
        [self.x, self.y, self.z, self.w]
    }

    pub fn to_array_into(&self, array: &mut [f32], offset: usize) {
        array[offset..offset + 4].copy_from_slice(&self.to_array());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::euler::EulerOrder;
    use crate::test_util::{assert_close, assert_close_slice};
    use core::f32::consts::{FRAC_1_SQRT_2, FRAC_PI_2, PI};

    fn about(axis: [f32; 3], angle: f32) -> Quaternion {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Vector3::new(axis[0], axis[1], axis[2]), angle);
        q
    }

    #[test]
    fn new_and_default() {
        assert_eq!(Quaternion::default(), Quaternion::new(0.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn widen_and_narrow() {
        let q = Quaternion::new(1.0, 2.0, 3.0, 4.0);
        let mut r = Quaternion::default();
        r.set_wide(q.wide());
        assert_eq!(r, q);
    }

    #[test]
    fn slerp_flat() {
        let a = Quaternion::default().to_array();
        let b = about([0.0, 0.0, 1.0], FRAC_PI_2).to_array();
        let mut dst = [9.0; 6];
        Quaternion::slerp_flat(&mut dst, 1, &a, 0, &b, 0, 0.5);
        assert_close_slice(&dst[1..5], &about([0.0, 0.0, 1.0], FRAC_PI_2 / 2.0).to_array());
        assert_eq!((dst[0], dst[5]), (9.0, 9.0));
        // identical inputs are copied through
        Quaternion::slerp_flat(&mut dst, 0, &b, 0, &b, 0, 0.3);
        assert_eq!(dst[..4], b);
    }

    #[test]
    fn multiply_quaternions_flat() {
        let a = about([1.0, 0.0, 0.0], 0.4);
        let b = about([0.0, 1.0, 0.0], 0.7);
        let mut dst = [0.0; 4];
        Quaternion::multiply_quaternions_flat(&mut dst, 0, &a.to_array(), 0, &b.to_array(), 0);
        let mut expected = Quaternion::default();
        expected.multiply_quaternions(&a, &b);
        assert_eq!(dst, expected.to_array());
    }

    #[test]
    fn set() {
        assert_eq!(*Quaternion::default().set(1.0, 2.0, 3.0, 4.0), Quaternion::new(1.0, 2.0, 3.0, 4.0));
    }

    #[test]
    fn copy() {
        let q = Quaternion::new(1.0, 2.0, 3.0, 4.0);
        assert_eq!(*Quaternion::default().copy(&q), q);
    }

    #[test]
    fn set_from_euler() {
        let mut q = Quaternion::default();
        q.set_from_euler(&Euler::new(FRAC_PI_2, 0.0, 0.0, EulerOrder::XYZ));
        assert_close_slice(&q.to_array(), &[FRAC_1_SQRT_2, 0.0, 0.0, FRAC_1_SQRT_2]);
        // the order matters once two axes are involved
        let (mut a, mut b) = (Quaternion::default(), Quaternion::default());
        a.set_from_euler(&Euler::new(0.5, 0.6, 0.0, EulerOrder::XYZ));
        b.set_from_euler(&Euler::new(0.5, 0.6, 0.0, EulerOrder::YXZ));
        assert!(a != b);
    }

    #[test]
    fn set_from_axis_angle() {
        assert_close_slice(&about([0.0, 1.0, 0.0], PI).to_array(), &[0.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn set_from_rotation_matrix() {
        // one case per branch: positive trace, then m11, m22, m33 largest
        for (axis, angle) in [([0.0, 0.0, 1.0], 0.5), ([1.0, 0.0, 0.0], PI), ([0.0, 1.0, 0.0], PI), ([0.0, 0.0, 1.0], PI)] {
            let q = about(axis, angle);
            let mut m = Matrix4::default();
            m.make_rotation_from_quaternion(&q);
            let mut r = Quaternion::default();
            r.set_from_rotation_matrix(&m);
            // q and -q are the same rotation
            assert_close(r.dot(&q).abs(), 1.0);
        }
    }

    #[test]
    fn set_from_unit_vectors() {
        let mut q = Quaternion::default();
        q.set_from_unit_vectors(&Vector3::new(1.0, 0.0, 0.0), &Vector3::new(0.0, 1.0, 0.0));
        assert_close_slice(&q.to_array(), &about([0.0, 0.0, 1.0], FRAC_PI_2).to_array());
        // opposite vectors: a 180 degree turn about a perpendicular axis
        q.set_from_unit_vectors(&Vector3::new(1.0, 0.0, 0.0), &Vector3::new(-1.0, 0.0, 0.0));
        assert_close_slice(&q.to_array(), &[0.0, 1.0, 0.0, 0.0]);
        q.set_from_unit_vectors(&Vector3::new(0.0, 0.0, 1.0), &Vector3::new(0.0, 0.0, -1.0));
        assert_close_slice(&q.to_array(), &[0.0, -1.0, 0.0, 0.0]);
    }

    #[test]
    fn angle_to() {
        assert_close(Quaternion::default().angle_to(&about([0.0, 1.0, 0.0], 0.75)), 0.75);
    }

    #[test]
    fn rotate_towards() {
        let target = about([0.0, 1.0, 0.0], 1.0);
        let mut q = Quaternion::default();
        q.rotate_towards(&target, 0.25);
        assert_close(q.angle_to(&Quaternion::default()), 0.25);
        // a step past the target stops at the target
        q.rotate_towards(&target, 10.0);
        assert_close_slice(&q.to_array(), &target.to_array());
        // zero angle: unchanged
        let before = q;
        q.rotate_towards(&before, 1.0);
        assert_eq!(q, before);
    }

    #[test]
    fn identity() {
        assert_eq!(*Quaternion::new(1.0, 2.0, 3.0, 4.0).identity(), Quaternion::default());
    }

    #[test]
    fn invert() {
        assert_eq!(*Quaternion::new(1.0, 2.0, 3.0, 4.0).invert(), Quaternion::new(-1.0, -2.0, -3.0, 4.0));
    }

    #[test]
    fn conjugate() {
        assert_eq!(*Quaternion::new(1.0, 2.0, 3.0, 4.0).conjugate(), Quaternion::new(-1.0, -2.0, -3.0, 4.0));
    }

    #[test]
    fn dot() {
        assert_eq!(Quaternion::new(1.0, 2.0, 3.0, 4.0).dot(&Quaternion::new(5.0, 6.0, 7.0, 8.0)), 70.0);
    }

    #[test]
    fn length_sq() {
        assert_eq!(Quaternion::new(1.0, 2.0, 3.0, 4.0).length_sq(), 30.0);
    }

    #[test]
    fn length() {
        assert_eq!(Quaternion::new(2.0, 2.0, 2.0, 2.0).length(), 4.0);
    }

    #[test]
    fn normalize() {
        assert_eq!(*Quaternion::new(0.0, 0.0, 0.0, 2.0).normalize(), Quaternion::default());
        // zero length becomes identity
        assert_eq!(*Quaternion::new(0.0, 0.0, 0.0, 0.0).normalize(), Quaternion::default());
    }

    #[test]
    fn multiply() {
        // two quarter turns about Z make a half turn
        let mut q = about([0.0, 0.0, 1.0], FRAC_PI_2);
        q.multiply(&about([0.0, 0.0, 1.0], FRAC_PI_2));
        assert_close_slice(&q.to_array(), &[0.0, 0.0, 1.0, 0.0]);
    }

    #[test]
    fn premultiply() {
        let (a, b) = (about([1.0, 0.0, 0.0], 0.4), about([0.0, 1.0, 0.0], 0.7));
        let mut p = a;
        p.premultiply(&b);
        let mut expected = Quaternion::default();
        expected.multiply_quaternions(&b, &a);
        assert_eq!(p, expected);
    }

    #[test]
    fn multiply_quaternions() {
        // i * j = k
        let mut q = Quaternion::default();
        q.multiply_quaternions(&Quaternion::new(1.0, 0.0, 0.0, 0.0), &Quaternion::new(0.0, 1.0, 0.0, 0.0));
        assert_eq!(q, Quaternion::new(0.0, 0.0, 1.0, 0.0));
    }

    #[test]
    fn slerp() {
        let mut q = Quaternion::default();
        q.slerp(&about([0.0, 1.0, 0.0], 1.0), 0.5);
        assert_close_slice(&q.to_array(), &about([0.0, 1.0, 0.0], 0.5).to_array());
        // takes the short way round when the dot product is negative
        let mut n = Quaternion::default();
        let mut far = about([0.0, 1.0, 0.0], 1.0);
        far.set(-far.x, -far.y, -far.z, -far.w);
        n.slerp(&far, 0.5);
        assert_close_slice(&n.to_array(), &about([0.0, 1.0, 0.0], 0.5).to_array());
    }

    #[test]
    fn slerp_quaternions() {
        let mut q = Quaternion::new(9.0, 9.0, 9.0, 9.0);
        q.slerp_quaternions(&Quaternion::default(), &about([1.0, 0.0, 0.0], 1.0), 0.25);
        assert_close_slice(&q.to_array(), &about([1.0, 0.0, 0.0], 0.25).to_array());
    }

    #[test]
    fn equals() {
        let q = Quaternion::new(1.0, 2.0, 3.0, 4.0);
        assert!(q.equals(&q));
        assert!(!q.equals(&Quaternion::default()));
    }

    #[test]
    fn from_array_and_to_array() {
        let mut q = Quaternion::default();
        q.from_array(&[9.0, 1.0, 2.0, 3.0, 4.0], 1);
        assert_eq!(q.to_array(), [1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn to_array_into() {
        let mut out = [0.0; 5];
        Quaternion::new(1.0, 2.0, 3.0, 4.0).to_array_into(&mut out, 1);
        assert_eq!(out, [0.0, 1.0, 2.0, 3.0, 4.0]);
    }
}
