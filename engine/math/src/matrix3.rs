use crate::matrix4::Matrix4;
use crate::vector3::Vector3;
use crate::wide::{self, WM3};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrix3 {
    pub elements: [f32; 9],
}

impl Default for Matrix3 {
    fn default() -> Self {
        Self { elements: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0] }
    }
}

fn multiply_wide(ae: &WM3, be: &WM3) -> WM3 {
    let (a11, a12, a13) = (ae[0], ae[3], ae[6]);
    let (a21, a22, a23) = (ae[1], ae[4], ae[7]);
    let (a31, a32, a33) = (ae[2], ae[5], ae[8]);

    let (b11, b12, b13) = (be[0], be[3], be[6]);
    let (b21, b22, b23) = (be[1], be[4], be[7]);
    let (b31, b32, b33) = (be[2], be[5], be[8]);

    [
        a11 * b11 + a12 * b21 + a13 * b31,
        a21 * b11 + a22 * b21 + a23 * b31,
        a31 * b11 + a32 * b21 + a33 * b31,
        a11 * b12 + a12 * b22 + a13 * b32,
        a21 * b12 + a22 * b22 + a23 * b32,
        a31 * b12 + a32 * b22 + a33 * b32,
        a11 * b13 + a12 * b23 + a13 * b33,
        a21 * b13 + a22 * b23 + a23 * b33,
        a31 * b13 + a32 * b23 + a33 * b33,
    ]
}

#[allow(clippy::too_many_arguments)]
fn row_major(n11: f64, n12: f64, n13: f64, n21: f64, n22: f64, n23: f64, n31: f64, n32: f64, n33: f64) -> WM3 {
    [n11, n21, n31, n12, n22, n32, n13, n23, n33]
}

impl Matrix3 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(n11: f32, n12: f32, n13: f32, n21: f32, n22: f32, n23: f32, n31: f32, n32: f32, n33: f32) -> Self {
        Self { elements: [n11, n21, n31, n12, n22, n32, n13, n23, n33] }
    }

    #[inline]
    pub(crate) fn wide(&self) -> WM3 {
        self.elements.map(|x| x as f64)
    }

    #[inline]
    pub(crate) fn set_wide(&mut self, e: WM3) -> &mut Self {
        self.elements = e.map(|x| x as f32);
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set(&mut self, n11: f32, n12: f32, n13: f32, n21: f32, n22: f32, n23: f32, n31: f32, n32: f32, n33: f32) -> &mut Self {
        self.elements = [n11, n21, n31, n12, n22, n32, n13, n23, n33];
        self
    }

    pub fn identity(&mut self) -> &mut Self {
        *self = Self::default();
        self
    }

    pub fn copy(&mut self, m: &Matrix3) -> &mut Self {
        *self = *m;
        self
    }

    pub fn extract_basis(&self, x_axis: &mut Vector3, y_axis: &mut Vector3, z_axis: &mut Vector3) -> &Self {
        x_axis.set_from_matrix3_column(self, 0);
        y_axis.set_from_matrix3_column(self, 1);
        z_axis.set_from_matrix3_column(self, 2);
        self
    }

    pub fn set_from_matrix4(&mut self, m: &Matrix4) -> &mut Self {
        let me = &m.elements;
        self.elements = [me[0], me[1], me[2], me[4], me[5], me[6], me[8], me[9], me[10]];
        self
    }

    pub fn multiply(&mut self, m: &Matrix3) -> &mut Self {
        self.set_wide(multiply_wide(&self.wide(), &m.wide()))
    }

    pub fn premultiply(&mut self, m: &Matrix3) -> &mut Self {
        self.set_wide(multiply_wide(&m.wide(), &self.wide()))
    }

    pub fn multiply_matrices(&mut self, a: &Matrix3, b: &Matrix3) -> &mut Self {
        self.set_wide(multiply_wide(&a.wide(), &b.wide()))
    }

    pub fn multiply_scalar(&mut self, s: f32) -> &mut Self {
        for e in &mut self.elements {
            *e *= s;
        }
        self
    }

    pub fn determinant(&self) -> f32 {
        let [a, b, c, d, e, f, g, h, i] = self.wide();

        (a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g) as f32
    }

    pub fn invert(&mut self) -> &mut Self {
        self.set_wide(wide::m3_invert(&self.wide()))
    }

    pub fn transpose(&mut self) -> &mut Self {
        let m = &mut self.elements;
        m.swap(1, 3);
        m.swap(2, 6);
        m.swap(5, 7);
        self
    }

    pub fn get_normal_matrix(&mut self, matrix4: &Matrix4) -> &mut Self {
        self.set_wide(wide::m3_normal_matrix(&matrix4.wide()))
    }

    pub fn transpose_into_array(&self, r: &mut [f32; 9]) -> &Self {
        let m = &self.elements;
        *r = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_uv_transform(&mut self, tx: f32, ty: f32, sx: f32, sy: f32, rotation: f32, cx: f32, cy: f32) -> &mut Self {
        let (tx, ty, sx, sy, cx, cy) = (tx as f64, ty as f64, sx as f64, sy as f64, cx as f64, cy as f64);
        let c = (rotation as f64).cos();
        let s = (rotation as f64).sin();

        self.set_wide(row_major(
            sx * c,
            sx * s,
            -sx * (c * cx + s * cy) + cx + tx,
            -sy * s,
            sy * c,
            -sy * (-s * cx + c * cy) + cy + ty,
            0.0,
            0.0,
            1.0,
        ))
    }

    pub fn scale(&mut self, sx: f32, sy: f32) -> &mut Self {
        let m = row_major(sx as f64, 0.0, 0.0, 0.0, sy as f64, 0.0, 0.0, 0.0, 1.0);
        self.set_wide(multiply_wide(&m, &self.wide()))
    }

    pub fn rotate(&mut self, theta: f32) -> &mut Self {
        let theta = -(theta as f64);
        let (c, s) = (theta.cos(), theta.sin());
        let m = row_major(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
        self.set_wide(multiply_wide(&m, &self.wide()))
    }

    pub fn translate(&mut self, tx: f32, ty: f32) -> &mut Self {
        let m = row_major(1.0, 0.0, tx as f64, 0.0, 1.0, ty as f64, 0.0, 0.0, 1.0);
        self.set_wide(multiply_wide(&m, &self.wide()))
    }

    // for 2D Transforms

    pub fn make_translation(&mut self, x: f32, y: f32) -> &mut Self {
        self.set(1.0, 0.0, x, 0.0, 1.0, y, 0.0, 0.0, 1.0)
    }

    pub fn make_rotation(&mut self, theta: f32) -> &mut Self {
        let c = (theta as f64).cos();
        let s = (theta as f64).sin();

        self.set_wide(row_major(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0))
    }

    pub fn make_scale(&mut self, x: f32, y: f32) -> &mut Self {
        self.set(x, 0.0, 0.0, 0.0, y, 0.0, 0.0, 0.0, 1.0)
    }

    pub fn equals(&self, matrix: &Matrix3) -> bool {
        self.elements == matrix.elements
    }

    pub fn from_array(&mut self, array: &[f32], offset: usize) -> &mut Self {
        self.elements.copy_from_slice(&array[offset..offset + 9]);
        self
    }

    pub fn to_array(&self) -> [f32; 9] {
        self.elements
    }

    pub fn to_array_into(&self, array: &mut [f32], offset: usize) {
        array[offset..offset + 9].copy_from_slice(&self.elements);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close_slice;
    use core::f32::consts::FRAC_PI_2;

    fn sample() -> Matrix3 {
        Matrix3::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0)
    }

    #[test]
    fn default_is_identity() {
        assert_eq!(Matrix3::default().elements, [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn new_and_set_are_row_major_storage_is_column_major() {
        let m = sample();
        assert_eq!(m.elements, [1.0, 4.0, 7.0, 2.0, 5.0, 8.0, 3.0, 6.0, 10.0]);
        let mut n = Matrix3::default();
        n.set(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0);
        assert_eq!(n, m);
    }

    #[test]
    fn widen_and_narrow() {
        let m = sample();
        let mut n = Matrix3::default();
        n.set_wide(m.wide());
        assert_eq!(n, m);
    }

    #[test]
    fn identity() {
        assert_eq!(*sample().identity(), Matrix3::default());
    }

    #[test]
    fn copy() {
        assert_eq!(*Matrix3::default().copy(&sample()), sample());
    }

    #[test]
    fn extract_basis() {
        let (mut x, mut y, mut z) = (Vector3::default(), Vector3::default(), Vector3::default());
        sample().extract_basis(&mut x, &mut y, &mut z);
        assert_eq!(x, Vector3::new(1.0, 4.0, 7.0));
        assert_eq!(y, Vector3::new(2.0, 5.0, 8.0));
        assert_eq!(z, Vector3::new(3.0, 6.0, 10.0));
    }

    #[test]
    fn set_from_matrix4() {
        let m4 = Matrix4::new(
            1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
        );
        let mut m = Matrix3::default();
        m.set_from_matrix4(&m4);
        assert_eq!(m, Matrix3::new(1.0, 2.0, 3.0, 5.0, 6.0, 7.0, 9.0, 10.0, 11.0));
    }

    #[test]
    fn multiply() {
        let mut t = Matrix3::default();
        t.make_translation(1.0, 2.0);
        let mut s = Matrix3::default();
        s.make_scale(2.0, 3.0);
        // T * S: scale first, then translate
        t.multiply(&s);
        assert_eq!(t, Matrix3::new(2.0, 0.0, 1.0, 0.0, 3.0, 2.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn premultiply() {
        let mut t = Matrix3::default();
        t.make_translation(1.0, 2.0);
        let mut s = Matrix3::default();
        s.make_scale(2.0, 3.0);
        // S * T: translate first, then scale
        t.premultiply(&s);
        assert_eq!(t, Matrix3::new(2.0, 0.0, 2.0, 0.0, 3.0, 6.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn multiply_matrices() {
        let mut m = Matrix3::default();
        m.multiply_matrices(&sample(), &Matrix3::default());
        assert_eq!(m, sample());
        m.multiply_matrices(&sample(), &sample());
        assert_eq!(m, Matrix3::new(30.0, 36.0, 45.0, 66.0, 81.0, 102.0, 109.0, 134.0, 169.0));
    }

    #[test]
    fn multiply_scalar() {
        assert_eq!(*sample().multiply_scalar(2.0), Matrix3::new(2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 20.0));
    }

    #[test]
    fn determinant() {
        assert_eq!(sample().determinant(), -3.0);
        assert_eq!(Matrix3::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0).determinant(), 0.0);
    }

    #[test]
    fn invert() {
        let mut m = sample();
        m.invert();
        m.multiply(&sample());
        assert_close_slice(&m.elements, &Matrix3::default().elements);
        // singular: zero matrix
        let mut s = Matrix3::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0);
        assert_eq!(s.invert().elements, [0.0; 9]);
    }

    #[test]
    fn transpose() {
        assert_eq!(*sample().transpose(), Matrix3::new(1.0, 4.0, 7.0, 2.0, 5.0, 8.0, 3.0, 6.0, 10.0));
    }

    #[test]
    fn get_normal_matrix() {
        // for a non-uniform scale the normal matrix is the inverse scale
        let mut m4 = Matrix4::default();
        m4.make_scale(2.0, 4.0, 8.0);
        let mut n = Matrix3::default();
        n.get_normal_matrix(&m4);
        assert_eq!(n, Matrix3::new(0.5, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.125));
    }

    #[test]
    fn transpose_into_array() {
        let mut r = [0.0; 9];
        sample().transpose_into_array(&mut r);
        assert_eq!(r, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0]);
    }

    #[test]
    fn set_uv_transform() {
        let mut m = Matrix3::default();
        m.set_uv_transform(0.5, 0.25, 2.0, 3.0, 0.0, 0.0, 0.0);
        assert_eq!(m, Matrix3::new(2.0, 0.0, 0.5, 0.0, 3.0, 0.25, 0.0, 0.0, 1.0));
    }

    #[test]
    fn scale() {
        let mut m = Matrix3::default();
        m.make_translation(1.0, 2.0);
        m.scale(2.0, 3.0);
        assert_eq!(m, Matrix3::new(2.0, 0.0, 2.0, 0.0, 3.0, 6.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn rotate() {
        // rotate( theta ) premultiplies by makeRotation( -theta )
        let mut m = Matrix3::default();
        m.rotate(FRAC_PI_2);
        let mut expected = Matrix3::default();
        expected.make_rotation(-FRAC_PI_2);
        assert_close_slice(&m.elements, &expected.elements);
    }

    #[test]
    fn translate() {
        let mut m = Matrix3::default();
        m.make_scale(2.0, 3.0);
        m.translate(1.0, 2.0);
        assert_eq!(m, Matrix3::new(2.0, 0.0, 1.0, 0.0, 3.0, 2.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn make_translation() {
        assert_eq!(*Matrix3::default().make_translation(3.0, 4.0), Matrix3::new(1.0, 0.0, 3.0, 0.0, 1.0, 4.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn make_rotation() {
        let mut m = Matrix3::default();
        m.make_rotation(FRAC_PI_2);
        assert_close_slice(&m.elements, &Matrix3::new(0.0, -1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0).elements);
    }

    #[test]
    fn make_scale() {
        assert_eq!(*Matrix3::default().make_scale(3.0, 4.0), Matrix3::new(3.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn equals() {
        assert!(sample().equals(&sample()));
        assert!(!sample().equals(&Matrix3::default()));
    }

    #[test]
    fn from_array_and_to_array() {
        let data = [0.0, 1.0, 4.0, 7.0, 2.0, 5.0, 8.0, 3.0, 6.0, 10.0];
        let mut m = Matrix3::default();
        m.from_array(&data, 1);
        assert_eq!(m, sample());
        assert_eq!(m.to_array(), m.elements);
    }

    #[test]
    fn to_array_into() {
        let mut out = [0.0; 10];
        sample().to_array_into(&mut out, 1);
        assert_eq!(out[0], 0.0);
        assert_eq!(out[1..], sample().elements);
    }
}
