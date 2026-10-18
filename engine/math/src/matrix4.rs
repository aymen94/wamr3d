use crate::euler::Euler;
use crate::kernels;
use crate::matrix3::Matrix3;
use crate::quaternion::Quaternion;
use crate::vector3::Vector3;
use crate::wide::{self, WM4};
use crate::CoordinateSystem;

mod compose;

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
mod tests;
