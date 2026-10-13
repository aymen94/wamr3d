use crate::kernels;
use crate::matrix4::Matrix4;
use crate::quaternion::Quaternion;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vector4 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Default for Vector4 {
    fn default() -> Self {
        Self::new(0.0, 0.0, 0.0, 1.0)
    }
}

vector_common!(Vector4, "Vector4", 4, (0, x), (1, y), (2, z), (3, w));

impl Vector4 {
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self { x, y, z, w }
    }

    pub fn width(&self) -> f32 {
        self.z
    }

    pub fn set_width(&mut self, value: f32) {
        self.z = value;
    }

    pub fn height(&self) -> f32 {
        self.w
    }

    pub fn set_height(&mut self, value: f32) {
        self.w = value;
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, w: f32) -> &mut Self {
        self.x = x;
        self.y = y;
        self.z = z;
        self.w = w;
        self
    }

    pub fn set_x(&mut self, x: f32) -> &mut Self {
        self.x = x;
        self
    }

    pub fn set_y(&mut self, y: f32) -> &mut Self {
        self.y = y;
        self
    }

    pub fn set_z(&mut self, z: f32) -> &mut Self {
        self.z = z;
        self
    }

    pub fn set_w(&mut self, w: f32) -> &mut Self {
        self.w = w;
        self
    }

    pub fn copy(&mut self, v: &Vector4) -> &mut Self {
        *self = *v;
        self
    }

    pub fn apply_matrix4(&mut self, m: &Matrix4) -> &mut Self {
        let [x, y, z, w] = kernels::vec4_apply_mat4(self.to_array(), &m.elements);
        self.set(x, y, z, w)
    }

    pub fn set_axis_angle_from_quaternion(&mut self, q: &Quaternion) -> &mut Self {
        let [qx, qy, qz, qw] = q.wide();

        let w = 2.0 * qw.acos();
        let s = (1.0 - qw * qw).sqrt();

        if s < 0.0001 {
            self.set_wide([1.0, 0.0, 0.0, w])
        } else {
            self.set_wide([qx / s, qy / s, qz / s, w])
        }
    }

    pub fn set_axis_angle_from_rotation_matrix(&mut self, m: &Matrix4) -> &mut Self {
        let (x, y, z); // variables for result
        let epsilon = 0.01; // margin to allow for rounding errors
        let epsilon2 = 0.1; // margin to distinguish between 0 and 180 degrees

        let te = m.wide();
        let (m11, m12, m13) = (te[0], te[4], te[8]);
        let (m21, m22, m23) = (te[1], te[5], te[9]);
        let (m31, m32, m33) = (te[2], te[6], te[10]);

        if (m12 - m21).abs() < epsilon && (m13 - m31).abs() < epsilon && (m23 - m32).abs() < epsilon {
            // singularity found
            // first check for identity matrix which must have +1 for all terms
            // in leading diagonal and zero in other terms

            if (m12 + m21).abs() < epsilon2
                && (m13 + m31).abs() < epsilon2
                && (m23 + m32).abs() < epsilon2
                && (m11 + m22 + m33 - 3.0).abs() < epsilon2
            {
                // this singularity is identity matrix so angle = 0

                return self.set(1.0, 0.0, 0.0, 0.0); // zero angle, arbitrary axis
            }

            // otherwise this singularity is angle = 180

            let angle = core::f64::consts::PI;

            let xx = (m11 + 1.0) / 2.0;
            let yy = (m22 + 1.0) / 2.0;
            let zz = (m33 + 1.0) / 2.0;
            let xy = (m12 + m21) / 4.0;
            let xz = (m13 + m31) / 4.0;
            let yz = (m23 + m32) / 4.0;

            if xx > yy && xx > zz {
                // m11 is the largest diagonal term

                if xx < epsilon {
                    x = 0.0;
                    y = 0.707106781;
                    z = 0.707106781;
                } else {
                    x = xx.sqrt();
                    y = xy / x;
                    z = xz / x;
                }
            } else if yy > zz {
                // m22 is the largest diagonal term

                if yy < epsilon {
                    x = 0.707106781;
                    y = 0.0;
                    z = 0.707106781;
                } else {
                    y = yy.sqrt();
                    x = xy / y;
                    z = yz / y;
                }
            } else {
                // m33 is the largest diagonal term so base result on this

                if zz < epsilon {
                    x = 0.707106781;
                    y = 0.707106781;
                    z = 0.0;
                } else {
                    z = zz.sqrt();
                    x = xz / z;
                    y = yz / z;
                }
            }

            return self.set_wide([x, y, z, angle]); // return 180 deg rotation
        }

        // as we have reached here there are no singularities so we can handle normally

        let mut s = ((m32 - m23) * (m32 - m23) + (m13 - m31) * (m13 - m31) + (m21 - m12) * (m21 - m12)).sqrt(); // used to normalize

        if s.abs() < 0.001 {
            s = 1.0;
        }

        // prevent divide by zero, should not happen if matrix is orthogonal and should be
        // caught by singularity test above, but I've left it in just in case

        self.set_wide([
            (m32 - m23) / s,
            (m13 - m31) / s,
            (m21 - m12) / s,
            ((m11 + m22 + m33 - 1.0) / 2.0).acos(),
        ])
    }

    pub fn set_from_matrix_position(&mut self, m: &Matrix4) -> &mut Self {
        let e = &m.elements;
        self.set(e[12], e[13], e[14], e[15])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close_slice;
    use crate::vector3::Vector3;
    use core::f32::consts::{FRAC_PI_2, PI};

    vector_common_tests!(Vector4, 4);

    #[test]
    fn new_and_default() {
        assert_eq!(Vector4::new(1.0, 2.0, 3.0, 4.0), Vector4 { x: 1.0, y: 2.0, z: 3.0, w: 4.0 });
        assert_eq!(Vector4::default(), Vector4::new(0.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn width_and_height() {
        let mut v = Vector4::new(1.0, 2.0, 3.0, 4.0);
        assert_eq!((v.width(), v.height()), (3.0, 4.0));
        v.set_width(30.0);
        v.set_height(40.0);
        assert_eq!(v, Vector4::new(1.0, 2.0, 30.0, 40.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Vector4::default().set(1.0, 2.0, 3.0, 4.0), Vector4::new(1.0, 2.0, 3.0, 4.0));
    }

    #[test]
    fn component_setters() {
        let mut v = Vector4::default();
        v.set_x(1.0).set_y(2.0).set_z(3.0).set_w(4.0);
        assert_eq!(v, Vector4::new(1.0, 2.0, 3.0, 4.0));
    }

    #[test]
    fn copy() {
        let src = Vector4::new(5.0, 6.0, 7.0, 8.0);
        assert_eq!(*Vector4::default().copy(&src), src);
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(1.0, 2.0, 3.0);
        assert_eq!(*Vector4::new(1.0, 1.0, 1.0, 1.0).apply_matrix4(&m), Vector4::new(2.0, 3.0, 4.0, 1.0));
        // w = 0 is a direction: translation does not apply
        assert_eq!(*Vector4::new(1.0, 1.0, 1.0, 0.0).apply_matrix4(&m), Vector4::new(1.0, 1.0, 1.0, 0.0));
    }

    #[test]
    fn set_axis_angle_from_quaternion() {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Vector3::new(0.0, 1.0, 0.0), FRAC_PI_2);
        let mut v = Vector4::default();
        v.set_axis_angle_from_quaternion(&q);
        assert_close_slice(&v.to_array(), &[0.0, 1.0, 0.0, FRAC_PI_2]);
        // identity: zero angle, arbitrary +X axis
        v.set_axis_angle_from_quaternion(&Quaternion::default());
        assert_close_slice(&v.to_array(), &[1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn set_axis_angle_from_rotation_matrix() {
        let mut m = Matrix4::default();
        let mut v = Vector4::default();

        m.make_rotation_z(FRAC_PI_2);
        v.set_axis_angle_from_rotation_matrix(&m);
        assert_close_slice(&v.to_array(), &[0.0, 0.0, 1.0, FRAC_PI_2]);

        // identity singularity
        v.set_axis_angle_from_rotation_matrix(&Matrix4::default());
        assert_close_slice(&v.to_array(), &[1.0, 0.0, 0.0, 0.0]);

        // 180 degree singularity
        m.make_rotation_y(PI);
        v.set_axis_angle_from_rotation_matrix(&m);
        assert_close_slice(&v.to_array(), &[0.0, 1.0, 0.0, PI]);
    }

    #[test]
    fn set_from_matrix_position() {
        let mut m = Matrix4::default();
        m.make_translation(7.0, 8.0, 9.0);
        assert_eq!(*Vector4::default().set_from_matrix_position(&m), Vector4::new(7.0, 8.0, 9.0, 1.0));
    }
}
