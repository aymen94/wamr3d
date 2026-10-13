use crate::euler::Euler;
use crate::kernels;
use crate::matrix3::Matrix3;
use crate::quaternion::Quaternion;
use crate::vector3::Vector3;
use crate::wide::{self, WM4};
use crate::CoordinateSystem;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix4 {
    pub elements: [f32; 16],
}

impl Default for Matrix4 {
    fn default() -> Self {
        Self {
            elements: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        }
    }
}

impl Matrix4 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        n11: f32, n12: f32, n13: f32, n14: f32,
        n21: f32, n22: f32, n23: f32, n24: f32,
        n31: f32, n32: f32, n33: f32, n34: f32,
        n41: f32, n42: f32, n43: f32, n44: f32,
    ) -> Self {
        Self {
            elements: [
                n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44,
            ],
        }
    }

    #[inline]
    pub(crate) fn wide(&self) -> WM4 {
        self.elements.map(|x| x as f64)
    }

    #[inline]
    pub(crate) fn set_wide(&mut self, e: WM4) -> &mut Self {
        self.elements = e.map(|x| x as f32);
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set(
        &mut self,
        n11: f32, n12: f32, n13: f32, n14: f32,
        n21: f32, n22: f32, n23: f32, n24: f32,
        n31: f32, n32: f32, n33: f32, n34: f32,
        n41: f32, n42: f32, n43: f32, n44: f32,
    ) -> &mut Self {
        self.elements = [
            n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44,
        ];
        self
    }

    pub fn identity(&mut self) -> &mut Self {
        *self = Self::default();
        self
    }

    pub fn copy(&mut self, m: &Matrix4) -> &mut Self {
        *self = *m;
        self
    }

    pub fn copy_position(&mut self, m: &Matrix4) -> &mut Self {
        self.elements[12] = m.elements[12];
        self.elements[13] = m.elements[13];
        self.elements[14] = m.elements[14];
        self
    }

    pub fn set_from_matrix3(&mut self, m: &Matrix3) -> &mut Self {
        let me = &m.elements;

        self.set(
            me[0], me[3], me[6], 0.0,
            me[1], me[4], me[7], 0.0,
            me[2], me[5], me[8], 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn extract_basis(&self, x_axis: &mut Vector3, y_axis: &mut Vector3, z_axis: &mut Vector3) -> &Self {
        if wide::m4_determinant_affine(&self.wide()) == 0.0 {
            x_axis.set(1.0, 0.0, 0.0);
            y_axis.set(0.0, 1.0, 0.0);
            z_axis.set(0.0, 0.0, 1.0);
            return self;
        }

        x_axis.set_from_matrix_column(self, 0);
        y_axis.set_from_matrix_column(self, 1);
        z_axis.set_from_matrix_column(self, 2);

        self
    }

    pub fn make_basis(&mut self, x_axis: &Vector3, y_axis: &Vector3, z_axis: &Vector3) -> &mut Self {
        self.set(
            x_axis.x, y_axis.x, z_axis.x, 0.0,
            x_axis.y, y_axis.y, z_axis.y, 0.0,
            x_axis.z, y_axis.z, z_axis.z, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn extract_rotation(&mut self, m: &Matrix4) -> &mut Self {
        let me = m.wide();

        if wide::m4_determinant_affine(&me) == 0.0 {
            return self.identity();
        }

        let scale_x = 1.0 / wide::length([me[0], me[1], me[2]]);
        let scale_y = 1.0 / wide::length([me[4], me[5], me[6]]);
        let scale_z = 1.0 / wide::length([me[8], me[9], me[10]]);

        self.set_wide([
            me[0] * scale_x,
            me[1] * scale_x,
            me[2] * scale_x,
            0.0,
            me[4] * scale_y,
            me[5] * scale_y,
            me[6] * scale_y,
            0.0,
            me[8] * scale_z,
            me[9] * scale_z,
            me[10] * scale_z,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ])
    }

    pub fn make_rotation_from_euler(&mut self, euler: &Euler) -> &mut Self {
        self.set_wide(wide::m4_rotation_from_euler(
            euler.x as f64,
            euler.y as f64,
            euler.z as f64,
            euler.order,
        ))
    }

    pub fn make_rotation_from_quaternion(&mut self, q: &Quaternion) -> &mut Self {
        self.set_wide(wide::m4_rotation_from_quaternion(q.wide()))
    }

    pub fn look_at(&mut self, eye: &Vector3, target: &Vector3, up: &Vector3) -> &mut Self {
        let up = up.wide();
        let mut z = wide::sub(eye.wide(), target.wide());

        if wide::length_sq(z) == 0.0 {
            // eye and target are in the same position

            z[2] = 1.0;
        }

        z = wide::normalize(z);
        let mut x = wide::cross(up, z);

        if wide::length_sq(x) == 0.0 {
            // up and z are parallel

            if up[2].abs() == 1.0 {
                z[0] += 0.0001;
            } else {
                z[2] += 0.0001;
            }

            z = wide::normalize(z);
            x = wide::cross(up, z);
        }

        x = wide::normalize(x);
        let y = wide::cross(z, x);

        let te = &mut self.elements;
        te[0] = x[0] as f32; te[4] = y[0] as f32; te[8] = z[0] as f32;
        te[1] = x[1] as f32; te[5] = y[1] as f32; te[9] = z[1] as f32;
        te[2] = x[2] as f32; te[6] = y[2] as f32; te[10] = z[2] as f32;

        self
    }

    pub fn multiply(&mut self, m: &Matrix4) -> &mut Self {
        self.elements = kernels::mat4_multiply(&self.elements, &m.elements);
        self
    }

    pub fn premultiply(&mut self, m: &Matrix4) -> &mut Self {
        self.elements = kernels::mat4_multiply(&m.elements, &self.elements);
        self
    }

    pub fn multiply_matrices(&mut self, a: &Matrix4, b: &Matrix4) -> &mut Self {
        self.elements = kernels::mat4_multiply(&a.elements, &b.elements);
        self
    }

    pub fn multiply_scalar(&mut self, s: f32) -> &mut Self {
        for e in &mut self.elements {
            *e *= s;
        }
        self
    }

    pub fn determinant(&self) -> f32 {
        let te = self.wide();

        let (n11, n12, n13, n14) = (te[0], te[4], te[8], te[12]);
        let (n21, n22, n23, n24) = (te[1], te[5], te[9], te[13]);
        let (n31, n32, n33, n34) = (te[2], te[6], te[10], te[14]);
        let (n41, n42, n43, n44) = (te[3], te[7], te[11], te[15]);

        let t11 = n23 * n34 - n24 * n33;
        let t12 = n22 * n34 - n24 * n32;
        let t13 = n22 * n33 - n23 * n32;

        let t21 = n21 * n34 - n24 * n31;
        let t22 = n21 * n33 - n23 * n31;
        let t23 = n21 * n32 - n22 * n31;

        (n11 * (n42 * t11 - n43 * t12 + n44 * t13)
            - n12 * (n41 * t11 - n43 * t21 + n44 * t22)
            + n13 * (n41 * t12 - n42 * t21 + n44 * t23)
            - n14 * (n41 * t13 - n42 * t22 + n43 * t23)) as f32
    }

    pub fn determinant_affine(&self) -> f32 {
        wide::m4_determinant_affine(&self.wide()) as f32
    }

    pub fn transpose(&mut self) -> &mut Self {
        let te = &mut self.elements;

        te.swap(1, 4);
        te.swap(2, 8);
        te.swap(6, 9);

        te.swap(3, 12);
        te.swap(7, 13);
        te.swap(11, 14);

        self
    }

    pub fn set_position(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        self.elements[12] = x;
        self.elements[13] = y;
        self.elements[14] = z;
        self
    }

    pub fn invert(&mut self) -> &mut Self {
        // based on https://github.com/toji/gl-matrix
        let te = self.wide();
        let (n11, n21, n31, n41) = (te[0], te[1], te[2], te[3]);
        let (n12, n22, n32, n42) = (te[4], te[5], te[6], te[7]);
        let (n13, n23, n33, n43) = (te[8], te[9], te[10], te[11]);
        let (n14, n24, n34, n44) = (te[12], te[13], te[14], te[15]);

        let t1 = n11 * n22 - n21 * n12;
        let t2 = n11 * n32 - n31 * n12;
        let t3 = n11 * n42 - n41 * n12;
        let t4 = n21 * n32 - n31 * n22;
        let t5 = n21 * n42 - n41 * n22;
        let t6 = n31 * n42 - n41 * n32;
        let t7 = n13 * n24 - n23 * n14;
        let t8 = n13 * n34 - n33 * n14;
        let t9 = n13 * n44 - n43 * n14;
        let t10 = n23 * n34 - n33 * n24;
        let t11 = n23 * n44 - n43 * n24;
        let t12 = n33 * n44 - n43 * n34;

        let det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;

        if det == 0.0 {
            self.elements = [0.0; 16];
            return self;
        }

        let det_inv = 1.0 / det;

        self.set_wide([
            (n22 * t12 - n32 * t11 + n42 * t10) * det_inv,
            (n31 * t11 - n21 * t12 - n41 * t10) * det_inv,
            (n24 * t6 - n34 * t5 + n44 * t4) * det_inv,
            (n33 * t5 - n23 * t6 - n43 * t4) * det_inv,
            (n32 * t9 - n12 * t12 - n42 * t8) * det_inv,
            (n11 * t12 - n31 * t9 + n41 * t8) * det_inv,
            (n34 * t3 - n14 * t6 - n44 * t2) * det_inv,
            (n13 * t6 - n33 * t3 + n43 * t2) * det_inv,
            (n12 * t11 - n22 * t9 + n42 * t7) * det_inv,
            (n21 * t9 - n11 * t11 - n41 * t7) * det_inv,
            (n14 * t5 - n24 * t3 + n44 * t1) * det_inv,
            (n23 * t3 - n13 * t5 - n43 * t1) * det_inv,
            (n22 * t8 - n12 * t10 - n32 * t7) * det_inv,
            (n11 * t10 - n21 * t8 + n31 * t7) * det_inv,
            (n24 * t2 - n14 * t4 - n34 * t1) * det_inv,
            (n13 * t4 - n23 * t2 + n33 * t1) * det_inv,
        ])
    }

    pub fn scale(&mut self, v: &Vector3) -> &mut Self {
        let te = &mut self.elements;
        let (x, y, z) = (v.x, v.y, v.z);

        te[0] *= x; te[4] *= y; te[8] *= z;
        te[1] *= x; te[5] *= y; te[9] *= z;
        te[2] *= x; te[6] *= y; te[10] *= z;
        te[3] *= x; te[7] *= y; te[11] *= z;

        self
    }

    pub fn get_max_scale_on_axis(&self) -> f32 {
        wide::m4_max_scale_on_axis(&self.wide()) as f32
    }

    pub fn make_translation(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        self.set(
            1.0, 0.0, 0.0, x,
            0.0, 1.0, 0.0, y,
            0.0, 0.0, 1.0, z,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn make_rotation_x(&mut self, theta: f32) -> &mut Self {
        let (c, s) = ((theta as f64).cos() as f32, (theta as f64).sin() as f32);

        self.set(
            1.0, 0.0, 0.0, 0.0,
            0.0, c, -s, 0.0,
            0.0, s, c, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn make_rotation_y(&mut self, theta: f32) -> &mut Self {
        let (c, s) = ((theta as f64).cos() as f32, (theta as f64).sin() as f32);

        self.set(
            c, 0.0, s, 0.0,
            0.0, 1.0, 0.0, 0.0,
            -s, 0.0, c, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn make_rotation_z(&mut self, theta: f32) -> &mut Self {
        let (c, s) = ((theta as f64).cos() as f32, (theta as f64).sin() as f32);

        self.set(
            c, -s, 0.0, 0.0,
            s, c, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn make_rotation_axis(&mut self, axis: &Vector3, angle: f32) -> &mut Self {
        // Based on http://www.gamedev.net/reference/articles/article1199.asp

        let c = (angle as f64).cos();
        let s = (angle as f64).sin();
        let t = 1.0 - c;
        let [x, y, z] = axis.wide();
        let (tx, ty) = (t * x, t * y);

        self.set_wide([
            tx * x + c,
            tx * y + s * z,
            tx * z - s * y,
            0.0,
            tx * y - s * z,
            ty * y + c,
            ty * z + s * x,
            0.0,
            tx * z + s * y,
            ty * z - s * x,
            t * z * z + c,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
        ])
    }

    pub fn make_scale(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        self.set(
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            0.0, 0.0, z, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn make_shear(&mut self, xy: f32, xz: f32, yx: f32, yz: f32, zx: f32, zy: f32) -> &mut Self {
        self.set(
            1.0, yx, zx, 0.0,
            xy, 1.0, zy, 0.0,
            xz, yz, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        )
    }

    pub fn compose(&mut self, position: &Vector3, quaternion: &Quaternion, scale: &Vector3) -> &mut Self {
        self.set_wide(wide::m4_compose(position.wide(), quaternion.wide(), scale.wide()))
    }

    pub fn decompose(&self, position: &mut Vector3, quaternion: &mut Quaternion, scale: &mut Vector3) -> &Self {
        let te = self.wide();

        position.set(self.elements[12], self.elements[13], self.elements[14]);

        let det = wide::m4_determinant_affine(&te);

        if det == 0.0 {
            scale.set(1.0, 1.0, 1.0);
            quaternion.identity();

            return self;
        }

        let mut sx = wide::length([te[0], te[1], te[2]]);
        let sy = wide::length([te[4], te[5], te[6]]);
        let sz = wide::length([te[8], te[9], te[10]]);

        // if determinant is negative, we need to invert one scale
        if det < 0.0 {
            sx = -sx;
        }

        // scale the rotation part
        let mut m1 = te;

        let inv_sx = 1.0 / sx;
        let inv_sy = 1.0 / sy;
        let inv_sz = 1.0 / sz;

        m1[0] *= inv_sx;
        m1[1] *= inv_sx;
        m1[2] *= inv_sx;

        m1[4] *= inv_sy;
        m1[5] *= inv_sy;
        m1[6] *= inv_sy;

        m1[8] *= inv_sz;
        m1[9] *= inv_sz;
        m1[10] *= inv_sz;

        quaternion.set_wide(wide::quat_from_rotation(&m1));
        scale.set_wide([sx, sy, sz]);

        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn make_perspective(
        &mut self,
        left: f32,
        right: f32,
        top: f32,
        bottom: f32,
        near: f32,
        far: f32,
        coordinate_system: CoordinateSystem,
        reversed_depth: bool,
    ) -> &mut Self {
        let (left, right, top, bottom, near, far) =
            (left as f64, right as f64, top as f64, bottom as f64, near as f64, far as f64);

        let x = 2.0 * near / (right - left);
        let y = 2.0 * near / (top - bottom);

        let a = (right + left) / (right - left);
        let b = (top + bottom) / (top - bottom);

        let (c, d);

        if reversed_depth {
            c = near / (far - near);
            d = (far * near) / (far - near);
        } else {
            match coordinate_system {
                CoordinateSystem::WebGL => {
                    c = -(far + near) / (far - near);
                    d = (-2.0 * far * near) / (far - near);
                }
                CoordinateSystem::WebGPU => {
                    c = -far / (far - near);
                    d = (-far * near) / (far - near);
                }
            }
        }

        self.set_wide([
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            a, b, c, -1.0,
            0.0, 0.0, d, 0.0,
        ])
    }

    #[allow(clippy::too_many_arguments)]
    pub fn make_orthographic(
        &mut self,
        left: f32,
        right: f32,
        top: f32,
        bottom: f32,
        near: f32,
        far: f32,
        coordinate_system: CoordinateSystem,
        reversed_depth: bool,
    ) -> &mut Self {
        let (left, right, top, bottom, near, far) =
            (left as f64, right as f64, top as f64, bottom as f64, near as f64, far as f64);

        let x = 2.0 / (right - left);
        let y = 2.0 / (top - bottom);

        let a = -(right + left) / (right - left);
        let b = -(top + bottom) / (top - bottom);

        let (c, d);

        if reversed_depth {
            c = 1.0 / (far - near);
            d = far / (far - near);
        } else {
            match coordinate_system {
                CoordinateSystem::WebGL => {
                    c = -2.0 / (far - near);
                    d = -(far + near) / (far - near);
                }
                CoordinateSystem::WebGPU => {
                    c = -1.0 / (far - near);
                    d = -near / (far - near);
                }
            }
        }

        self.set_wide([
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            0.0, 0.0, c, 0.0,
            a, b, d, 1.0,
        ])
    }

    pub fn equals(&self, matrix: &Matrix4) -> bool {
        self.elements == matrix.elements
    }

    pub fn from_array(&mut self, array: &[f32], offset: usize) -> &mut Self {
        self.elements.copy_from_slice(&array[offset..offset + 16]);
        self
    }

    pub fn to_array(&self) -> [f32; 16] {
        self.elements
    }

    pub fn to_array_into(&self, array: &mut [f32], offset: usize) {
        array[offset..offset + 16].copy_from_slice(&self.elements);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::euler::EulerOrder;
    use crate::test_util::{assert_close, assert_close_slice};
    use core::f32::consts::{FRAC_PI_2, PI};

    const IDENTITY: [f32; 16] = [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];

    fn counting() -> Matrix4 {
        Matrix4::new(
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        )
    }

    fn translation(x: f32, y: f32, z: f32) -> Matrix4 {
        let mut m = Matrix4::default();
        m.make_translation(x, y, z);
        m
    }

    fn scaling(x: f32, y: f32, z: f32) -> Matrix4 {
        let mut m = Matrix4::default();
        m.make_scale(x, y, z);
        m
    }

    #[test]
    fn default_is_identity() {
        assert_eq!(Matrix4::default().elements, IDENTITY);
    }

    #[test]
    fn new_and_set_are_row_major_storage_is_column_major() {
        let m = counting();
        assert_eq!(
            m.elements,
            [1.0, 5.0, 9.0, 13.0, 2.0, 6.0, 10.0, 14.0, 3.0, 7.0, 11.0, 15.0, 4.0, 8.0, 12.0, 16.0]
        );
        let mut n = Matrix4::default();
        n.set(
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        );
        assert_eq!(n, m);
    }

    #[test]
    fn widen_and_narrow() {
        let mut n = Matrix4::default();
        n.set_wide(counting().wide());
        assert_eq!(n, counting());
    }

    #[test]
    fn identity() {
        assert_eq!(counting().identity().elements, IDENTITY);
    }

    #[test]
    fn copy() {
        assert_eq!(*Matrix4::default().copy(&counting()), counting());
    }

    #[test]
    fn copy_position() {
        let mut m = Matrix4::default();
        m.copy_position(&translation(1.0, 2.0, 3.0));
        assert_eq!(m, translation(1.0, 2.0, 3.0));
    }

    #[test]
    fn set_from_matrix3() {
        let m3 = Matrix3::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0);
        let mut m = counting();
        m.set_from_matrix3(&m3);
        assert_eq!(
            m,
            Matrix4::new(1.0, 2.0, 3.0, 0.0, 4.0, 5.0, 6.0, 0.0, 7.0, 8.0, 9.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        );
    }

    #[test]
    fn extract_basis() {
        let (mut x, mut y, mut z) = (Vector3::default(), Vector3::default(), Vector3::default());
        scaling(2.0, 3.0, 4.0).extract_basis(&mut x, &mut y, &mut z);
        assert_eq!((x, y, z), (Vector3::new(2.0, 0.0, 0.0), Vector3::new(0.0, 3.0, 0.0), Vector3::new(0.0, 0.0, 4.0)));
        // singular: identity basis
        scaling(2.0, 0.0, 4.0).extract_basis(&mut x, &mut y, &mut z);
        assert_eq!((x, y, z), (Vector3::new(1.0, 0.0, 0.0), Vector3::new(0.0, 1.0, 0.0), Vector3::new(0.0, 0.0, 1.0)));
    }

    #[test]
    fn make_basis() {
        let mut m = Matrix4::default();
        m.make_basis(&Vector3::new(1.0, 2.0, 3.0), &Vector3::new(4.0, 5.0, 6.0), &Vector3::new(7.0, 8.0, 9.0));
        assert_eq!(
            m.elements,
            [1.0, 2.0, 3.0, 0.0, 4.0, 5.0, 6.0, 0.0, 7.0, 8.0, 9.0, 0.0, 0.0, 0.0, 0.0, 1.0]
        );
    }

    #[test]
    fn extract_rotation() {
        let mut m = Matrix4::default();
        let mut src = translation(1.0, 2.0, 3.0);
        src.scale(&Vector3::new(2.0, 3.0, 4.0));
        m.extract_rotation(&src);
        assert_eq!(m.elements, IDENTITY);
        // singular source: identity
        let mut n = counting();
        n.extract_rotation(&scaling(0.0, 1.0, 1.0));
        assert_eq!(n.elements, IDENTITY);
    }

    #[test]
    fn make_rotation_from_euler() {
        let mut m = Matrix4::default();
        m.make_rotation_from_euler(&Euler::new(FRAC_PI_2, 0.0, 0.0, EulerOrder::XYZ));
        let mut expected = Matrix4::default();
        expected.make_rotation_x(FRAC_PI_2);
        assert_close_slice(&m.elements, &expected.elements);
    }

    #[test]
    fn make_rotation_from_quaternion() {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Vector3::new(0.0, 1.0, 0.0), FRAC_PI_2);
        let mut m = Matrix4::default();
        m.make_rotation_from_quaternion(&q);
        let mut expected = Matrix4::default();
        expected.make_rotation_y(FRAC_PI_2);
        assert_close_slice(&m.elements, &expected.elements);
    }

    #[test]
    fn look_at() {
        // looking down -Z with +Y up is the identity rotation (camera convention)
        let mut m = translation(5.0, 6.0, 7.0);
        m.look_at(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(0.0, 0.0, -1.0), &Vector3::new(0.0, 1.0, 0.0));
        assert_eq!(m, translation(5.0, 6.0, 7.0));
        // eye == target falls back to z = (0, 0, 1)
        let mut n = Matrix4::default();
        n.look_at(&Vector3::new(1.0, 1.0, 1.0), &Vector3::new(1.0, 1.0, 1.0), &Vector3::new(0.0, 1.0, 0.0));
        assert_eq!(n.elements, IDENTITY);
        // up parallel to the view direction still yields an orthonormal basis
        let mut p = Matrix4::default();
        p.look_at(&Vector3::new(0.0, 1.0, 0.0), &Vector3::default(), &Vector3::new(0.0, 1.0, 0.0));
        assert_close(p.determinant(), 1.0);
    }

    #[test]
    fn multiply() {
        // T * S: scale first, then translate
        let mut m = translation(1.0, 2.0, 3.0);
        m.multiply(&scaling(2.0, 3.0, 4.0));
        assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(3.0, 5.0, 7.0));
    }

    #[test]
    fn premultiply() {
        // S * T: translate first, then scale
        let mut m = translation(1.0, 2.0, 3.0);
        m.premultiply(&scaling(2.0, 3.0, 4.0));
        assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(4.0, 9.0, 16.0));
    }

    #[test]
    fn multiply_matrices() {
        let mut m = Matrix4::default();
        m.multiply_matrices(&counting(), &Matrix4::default());
        assert_eq!(m, counting());
        m.multiply_matrices(&counting(), &counting());
        assert_eq!(
            m,
            Matrix4::new(
                90.0, 100.0, 110.0, 120.0, 202.0, 228.0, 254.0, 280.0, 314.0, 356.0, 398.0, 440.0, 426.0, 484.0,
                542.0, 600.0
            )
        );
    }

    #[test]
    fn multiply_scalar() {
        assert_eq!(scaling(1.0, 2.0, 3.0).multiply_scalar(2.0).elements[..6], [2.0, 0.0, 0.0, 0.0, 0.0, 4.0]);
    }

    #[test]
    fn determinant() {
        assert_eq!(scaling(2.0, 3.0, 4.0).determinant(), 24.0);
        assert_eq!(counting().determinant(), 0.0);
        assert_eq!(Matrix4::default().determinant(), 1.0);
    }

    #[test]
    fn determinant_affine() {
        assert_eq!(scaling(2.0, 3.0, 4.0).determinant_affine(), 24.0);
        assert_eq!(scaling(-1.0, 1.0, 1.0).determinant_affine(), -1.0);
    }

    #[test]
    fn transpose() {
        let mut m = counting();
        m.transpose();
        assert_eq!(
            m.elements,
            [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0]
        );
    }

    #[test]
    fn set_position() {
        assert_eq!(*Matrix4::default().set_position(1.0, 2.0, 3.0), translation(1.0, 2.0, 3.0));
    }

    #[test]
    fn invert() {
        let mut m = translation(1.0, 2.0, 3.0);
        m.multiply(&scaling(2.0, 4.0, 8.0));
        let mut inv = m;
        inv.invert();
        inv.multiply(&m);
        assert_close_slice(&inv.elements, &IDENTITY);
        // singular: zero matrix
        assert_eq!(counting().invert().elements, [0.0; 16]);
    }

    #[test]
    fn scale() {
        let mut m = translation(1.0, 2.0, 3.0);
        m.scale(&Vector3::new(2.0, 3.0, 4.0));
        assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(3.0, 5.0, 7.0));
    }

    #[test]
    fn get_max_scale_on_axis() {
        assert_eq!(scaling(2.0, -5.0, 3.0).get_max_scale_on_axis(), 5.0);
    }

    #[test]
    fn make_translation() {
        assert_eq!(translation(1.0, 2.0, 3.0).elements[12..], [1.0, 2.0, 3.0, 1.0]);
    }

    #[test]
    fn make_rotation_x() {
        // right-handed: +Y rotates toward +Z
        let mut m = Matrix4::default();
        m.make_rotation_x(FRAC_PI_2);
        assert_close_slice(&Vector3::new(0.0, 1.0, 0.0).apply_matrix4(&m).to_array(), &[0.0, 0.0, 1.0]);
    }

    #[test]
    fn make_rotation_y() {
        // right-handed: +Z rotates toward +X
        let mut m = Matrix4::default();
        m.make_rotation_y(FRAC_PI_2);
        assert_close_slice(&Vector3::new(0.0, 0.0, 1.0).apply_matrix4(&m).to_array(), &[1.0, 0.0, 0.0]);
    }

    #[test]
    fn make_rotation_z() {
        // right-handed: +X rotates toward +Y
        let mut m = Matrix4::default();
        m.make_rotation_z(FRAC_PI_2);
        assert_close_slice(&Vector3::new(1.0, 0.0, 0.0).apply_matrix4(&m).to_array(), &[0.0, 1.0, 0.0]);
    }

    #[test]
    fn make_rotation_axis() {
        let mut m = Matrix4::default();
        m.make_rotation_axis(&Vector3::new(0.0, 0.0, 1.0), PI);
        let mut expected = Matrix4::default();
        expected.make_rotation_z(PI);
        assert_close_slice(&m.elements, &expected.elements);
    }

    #[test]
    fn make_scale() {
        assert_eq!(
            scaling(2.0, 3.0, 4.0).elements,
            [2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0]
        );
    }

    #[test]
    fn make_shear() {
        let mut m = Matrix4::default();
        m.make_shear(1.0, 2.0, 3.0, 4.0, 5.0, 6.0);
        assert_eq!(
            m,
            Matrix4::new(1.0, 3.0, 5.0, 0.0, 1.0, 1.0, 6.0, 0.0, 2.0, 4.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        );
    }

    #[test]
    fn compose() {
        let mut m = Matrix4::default();
        m.compose(&Vector3::new(1.0, 2.0, 3.0), &Quaternion::default(), &Vector3::new(2.0, 3.0, 4.0));
        let mut expected = translation(1.0, 2.0, 3.0);
        expected.scale(&Vector3::new(2.0, 3.0, 4.0));
        assert_eq!(m, expected);
    }

    #[test]
    fn decompose() {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Vector3::new(0.0, 1.0, 0.0), 0.5);
        let mut m = Matrix4::default();
        m.compose(&Vector3::new(1.0, 2.0, 3.0), &q, &Vector3::new(2.0, 3.0, 4.0));

        let (mut p, mut r, mut s) = (Vector3::default(), Quaternion::default(), Vector3::default());
        m.decompose(&mut p, &mut r, &mut s);
        assert_eq!(p, Vector3::new(1.0, 2.0, 3.0));
        assert_close_slice(&r.to_array(), &q.to_array());
        assert_close_slice(&s.to_array(), &[2.0, 3.0, 4.0]);

        // a mirrored matrix reports a negative X scale
        scaling(-2.0, 3.0, 4.0).decompose(&mut p, &mut r, &mut s);
        assert_close_slice(&s.to_array(), &[-2.0, 3.0, 4.0]);

        // singular: unit scale, identity rotation
        scaling(0.0, 3.0, 4.0).decompose(&mut p, &mut r, &mut s);
        assert_eq!(s, Vector3::new(1.0, 1.0, 1.0));
        assert_eq!(r, Quaternion::default());
    }

    #[test]
    fn make_perspective_depth_conventions() {
        let (near, far) = (0.5, 100.0);
        let ndc_z = |cs, reversed, z: f32| {
            let mut m = Matrix4::default();
            m.make_perspective(-1.0, 1.0, 1.0, -1.0, near, far, cs, reversed);
            Vector3::new(0.0, 0.0, z).apply_matrix4(&m).z
        };

        assert_close(ndc_z(CoordinateSystem::WebGL, false, -near), -1.0);
        assert_close(ndc_z(CoordinateSystem::WebGL, false, -far), 1.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, false, -near), 0.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, false, -far), 1.0);
        // reversed depth: near -> 1, far -> 0
        assert_close(ndc_z(CoordinateSystem::WebGPU, true, -near), 1.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, true, -far), 0.0);
    }

    #[test]
    fn make_perspective_keeps_handedness() {
        // the camera looks down -Z: a point in front has positive clip w, +X stays right, +Y stays up
        let mut m = Matrix4::default();
        m.make_perspective(-1.0, 1.0, 1.0, -1.0, 1.0, 10.0, CoordinateSystem::WebGPU, false);
        let mut p = crate::vector4::Vector4::new(1.0, 2.0, -4.0, 1.0);
        p.apply_matrix4(&m);
        assert!(p.w > 0.0 && p.x > 0.0 && p.y > 0.0);
    }

    #[test]
    fn make_orthographic_depth_conventions() {
        let (near, far) = (1.0, 11.0);
        let ndc_z = |cs, reversed, z: f32| {
            let mut m = Matrix4::default();
            m.make_orthographic(-2.0, 2.0, 2.0, -2.0, near, far, cs, reversed);
            Vector3::new(0.0, 0.0, z).apply_matrix4(&m).z
        };

        assert_close(ndc_z(CoordinateSystem::WebGL, false, -near), -1.0);
        assert_close(ndc_z(CoordinateSystem::WebGL, false, -far), 1.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, false, -near), 0.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, false, -far), 1.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, true, -near), 1.0);
        assert_close(ndc_z(CoordinateSystem::WebGPU, true, -far), 0.0);
    }

    #[test]
    fn equals() {
        assert!(counting().equals(&counting()));
        assert!(!counting().equals(&Matrix4::default()));
    }

    #[test]
    fn from_array_and_to_array() {
        let mut data = [0.0; 17];
        data[1..].copy_from_slice(&counting().elements);
        let mut m = Matrix4::default();
        m.from_array(&data, 1);
        assert_eq!(m, counting());
        assert_eq!(m.to_array(), m.elements);
    }

    #[test]
    fn to_array_into() {
        let mut out = [0.0; 17];
        counting().to_array_into(&mut out, 1);
        assert_eq!(out[0], 0.0);
        assert_eq!(out[1..], counting().elements);
    }
}
