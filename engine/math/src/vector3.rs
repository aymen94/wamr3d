use crate::color::Color;
use crate::cylindrical::Cylindrical;
use crate::euler::Euler;
use crate::kernels;
use crate::matrix3::Matrix3;
use crate::matrix4::Matrix4;
use crate::quaternion::Quaternion;
use crate::spherical::Spherical;
use crate::wide;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

vector_common!(Vector3, "Vector3", 3, (0, x), (1, y), (2, z));

impl Vector3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        self.x = x;
        self.y = y;
        self.z = z;
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

    pub fn copy(&mut self, v: &Vector3) -> &mut Self {
        *self = *v;
        self
    }

    pub fn multiply_vectors(&mut self, a: &Vector3, b: &Vector3) -> &mut Self {
        self.x = a.x * b.x;
        self.y = a.y * b.y;
        self.z = a.z * b.z;
        self
    }

    pub fn apply_euler(&mut self, euler: &Euler) -> &mut Self {
        let q = wide::quat_from_euler(euler.x as f64, euler.y as f64, euler.z as f64, euler.order);
        self.set_wide(wide::apply_quaternion(self.wide(), q))
    }

    pub fn apply_axis_angle(&mut self, axis: &Vector3, angle: f32) -> &mut Self {
        let q = wide::quat_from_axis_angle(axis.wide(), angle as f64);
        self.set_wide(wide::apply_quaternion(self.wide(), q))
    }

    pub fn apply_matrix3(&mut self, m: &Matrix3) -> &mut Self {
        self.set_wide(wide::apply_m3(self.wide(), &m.wide()))
    }

    pub fn apply_normal_matrix(&mut self, m: &Matrix3) -> &mut Self {
        self.set_wide(wide::normalize(wide::apply_m3(self.wide(), &m.wide())))
    }

    pub fn apply_matrix4(&mut self, m: &Matrix4) -> &mut Self {
        let [x, y, z] = kernels::vec3_apply_mat4(self.to_array(), &m.elements);
        self.set(x, y, z)
    }

    pub fn apply_quaternion(&mut self, q: &Quaternion) -> &mut Self {
        self.set_wide(wide::apply_quaternion(self.wide(), q.wide()))
    }

    pub fn transform_direction(&mut self, m: &Matrix4) -> &mut Self {
        let [x, y, z] = kernels::vec3_transform_direction(self.to_array(), &m.elements);
        self.set(x, y, z)
    }

    pub fn cross(&mut self, v: &Vector3) -> &mut Self {
        self.set_wide(wide::cross(self.wide(), v.wide()))
    }

    pub fn cross_vectors(&mut self, a: &Vector3, b: &Vector3) -> &mut Self {
        self.set_wide(wide::cross(a.wide(), b.wide()))
    }

    fn project_on_vector_w(this: wide::W3, v: wide::W3) -> wide::W3 {
        let denominator = wide::length_sq(v);

        if denominator == 0.0 {
            return [0.0; 3];
        }

        let scalar = wide::dot(v, this) / denominator;

        wide::scale(v, scalar)
    }

    pub fn project_on_vector(&mut self, v: &Vector3) -> &mut Self {
        self.set_wide(Self::project_on_vector_w(self.wide(), v.wide()))
    }

    pub fn project_on_plane(&mut self, plane_normal: &Vector3) -> &mut Self {
        let this = self.wide();
        self.set_wide(wide::sub(this, Self::project_on_vector_w(this, plane_normal.wide())))
    }

    pub fn reflect(&mut self, normal: &Vector3) -> &mut Self {
        let (this, n) = (self.wide(), normal.wide());
        self.set_wide(wide::sub(this, wide::scale(n, 2.0 * wide::dot(this, n))))
    }

    pub fn angle_to(&self, v: &Vector3) -> f32 {
        let denominator = (self.length_sq_wide() * v.length_sq_wide()).sqrt();

        if denominator == 0.0 {
            return core::f32::consts::FRAC_PI_2;
        }

        let theta = self.dot_wide(v) / denominator;

        // clamp, to handle numerical problems
        wide::clamp(theta, -1.0, 1.0).acos() as f32
    }

    pub fn distance_to(&self, v: &Vector3) -> f32 {
        wide::distance_sq(self.wide(), v.wide()).sqrt() as f32
    }

    pub fn distance_to_squared(&self, v: &Vector3) -> f32 {
        wide::distance_sq(self.wide(), v.wide()) as f32
    }

    pub fn manhattan_distance_to(&self, v: &Vector3) -> f32 {
        let d = wide::sub(self.wide(), v.wide());
        (d[0].abs() + d[1].abs() + d[2].abs()) as f32
    }

    pub fn set_from_spherical(&mut self, s: &Spherical) -> &mut Self {
        self.set_from_spherical_coords(s.radius, s.phi, s.theta)
    }

    pub fn set_from_spherical_coords(&mut self, radius: f32, phi: f32, theta: f32) -> &mut Self {
        let (radius, phi, theta) = (radius as f64, phi as f64, theta as f64);
        let sin_phi_radius = phi.sin() * radius;

        self.set_wide([
            sin_phi_radius * theta.sin(),
            phi.cos() * radius,
            sin_phi_radius * theta.cos(),
        ])
    }

    pub fn set_from_cylindrical(&mut self, c: &Cylindrical) -> &mut Self {
        self.set_from_cylindrical_coords(c.radius, c.theta, c.y)
    }

    pub fn set_from_cylindrical_coords(&mut self, radius: f32, theta: f32, y: f32) -> &mut Self {
        let (radius, theta) = (radius as f64, theta as f64);

        self.x = (radius * theta.sin()) as f32;
        self.y = y;
        self.z = (radius * theta.cos()) as f32;
        self
    }

    pub fn set_from_matrix_position(&mut self, m: &Matrix4) -> &mut Self {
        let e = &m.elements;
        self.set(e[12], e[13], e[14])
    }

    pub fn set_from_matrix_scale(&mut self, m: &Matrix4) -> &mut Self {
        let e = m.wide();
        self.set_wide([
            wide::length([e[0], e[1], e[2]]),
            wide::length([e[4], e[5], e[6]]),
            wide::length([e[8], e[9], e[10]]),
        ])
    }

    pub fn set_from_matrix_column(&mut self, m: &Matrix4, index: usize) -> &mut Self {
        self.from_array(&m.elements, index * 4)
    }

    pub fn set_from_matrix3_column(&mut self, m: &Matrix3, index: usize) -> &mut Self {
        self.from_array(&m.elements, index * 3)
    }

    pub fn set_from_euler(&mut self, e: &Euler) -> &mut Self {
        self.set(e.x, e.y, e.z)
    }

    pub fn set_from_color(&mut self, c: &Color) -> &mut Self {
        self.set(c.r, c.g, c.b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::euler::EulerOrder;
    use crate::test_util::{assert_close, assert_close_slice};
    use core::f32::consts::{FRAC_PI_2, PI};

    vector_common_tests!(Vector3, 3);

    fn close(v: &Vector3, expected: [f32; 3]) {
        assert_close_slice(&v.to_array(), &expected);
    }

    #[test]
    fn new_and_default() {
        assert_eq!(Vector3::new(1.0, 2.0, 3.0), Vector3 { x: 1.0, y: 2.0, z: 3.0 });
        assert_eq!(Vector3::default(), Vector3::new(0.0, 0.0, 0.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Vector3::default().set(1.0, 2.0, 3.0), Vector3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn set_x_set_y_set_z() {
        assert_eq!(*Vector3::default().set_x(1.0).set_y(2.0).set_z(3.0), Vector3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn copy() {
        assert_eq!(*Vector3::default().copy(&Vector3::new(4.0, 5.0, 6.0)), Vector3::new(4.0, 5.0, 6.0));
    }

    #[test]
    fn multiply_vectors() {
        let mut v = Vector3::default();
        v.multiply_vectors(&Vector3::new(1.0, 2.0, 3.0), &Vector3::new(4.0, 5.0, 6.0));
        assert_eq!(v, Vector3::new(4.0, 10.0, 18.0));
    }

    #[test]
    fn apply_euler() {
        // 90 degrees about Z takes +X to +Y
        let mut v = Vector3::new(1.0, 0.0, 0.0);
        v.apply_euler(&Euler::new(0.0, 0.0, FRAC_PI_2, EulerOrder::XYZ));
        close(&v, [0.0, 1.0, 0.0]);
    }

    #[test]
    fn apply_axis_angle() {
        // 90 degrees about Y takes +Z to +X (right-handed)
        let mut v = Vector3::new(0.0, 0.0, 1.0);
        v.apply_axis_angle(&Vector3::new(0.0, 1.0, 0.0), FRAC_PI_2);
        close(&v, [1.0, 0.0, 0.0]);
    }

    #[test]
    fn apply_matrix3() {
        let mut m = Matrix3::default();
        m.set(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0);
        let mut v = Vector3::new(1.0, 0.0, -1.0);
        v.apply_matrix3(&m);
        assert_eq!(v, Vector3::new(-2.0, -2.0, -2.0));
    }

    #[test]
    fn apply_normal_matrix() {
        let mut m = Matrix3::default();
        m.make_scale(2.0, 2.0);
        let mut v = Vector3::new(3.0, 0.0, 0.0);
        v.apply_normal_matrix(&m);
        assert_eq!(v, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(1.0, 2.0, 3.0);
        assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(2.0, 3.0, 4.0));
    }

    #[test]
    fn apply_matrix4_divides_by_w() {
        let mut m = Matrix4::default();
        m.elements[15] = 2.0;
        assert_eq!(*Vector3::new(2.0, 4.0, 6.0).apply_matrix4(&m), Vector3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn apply_quaternion() {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Vector3::new(0.0, 0.0, 1.0), PI);
        let mut v = Vector3::new(1.0, 2.0, 3.0);
        v.apply_quaternion(&q);
        close(&v, [-1.0, -2.0, 3.0]);
    }

    #[test]
    fn transform_direction() {
        let mut m = Matrix4::default();
        m.make_translation(5.0, 5.0, 5.0);
        assert_eq!(*Vector3::new(0.0, 0.0, -3.0).transform_direction(&m), Vector3::new(0.0, 0.0, -1.0));
    }

    #[test]
    fn cross() {
        // right-handed: X cross Y = Z
        assert_eq!(*Vector3::new(1.0, 0.0, 0.0).cross(&Vector3::new(0.0, 1.0, 0.0)), Vector3::new(0.0, 0.0, 1.0));
    }

    #[test]
    fn cross_vectors() {
        let mut v = Vector3::default();
        v.cross_vectors(&Vector3::new(0.0, 1.0, 0.0), &Vector3::new(0.0, 0.0, 1.0));
        assert_eq!(v, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn project_on_vector() {
        assert_eq!(*Vector3::new(2.0, 3.0, 4.0).project_on_vector(&Vector3::new(2.0, 0.0, 0.0)), Vector3::new(2.0, 0.0, 0.0));
        // projecting on the zero vector gives zero
        assert_eq!(*Vector3::new(2.0, 3.0, 4.0).project_on_vector(&Vector3::default()), Vector3::default());
    }

    #[test]
    fn project_on_plane() {
        assert_eq!(*Vector3::new(2.0, 3.0, 4.0).project_on_plane(&Vector3::new(0.0, 1.0, 0.0)), Vector3::new(2.0, 0.0, 4.0));
    }

    #[test]
    fn reflect() {
        assert_eq!(*Vector3::new(1.0, -1.0, 0.0).reflect(&Vector3::new(0.0, 1.0, 0.0)), Vector3::new(1.0, 1.0, 0.0));
    }

    #[test]
    fn angle_to() {
        assert_close(Vector3::new(1.0, 0.0, 0.0).angle_to(&Vector3::new(0.0, 3.0, 0.0)), FRAC_PI_2);
        assert_close(Vector3::new(1.0, 0.0, 0.0).angle_to(&Vector3::new(-2.0, 0.0, 0.0)), PI);
        assert_close(Vector3::new(1.0, 0.0, 0.0).angle_to(&Vector3::default()), FRAC_PI_2);
    }

    #[test]
    fn distance_to() {
        assert_eq!(Vector3::new(1.0, 1.0, 1.0).distance_to(&Vector3::new(3.0, 4.0, 7.0)), 7.0);
    }

    #[test]
    fn distance_to_squared() {
        assert_eq!(Vector3::new(1.0, 1.0, 1.0).distance_to_squared(&Vector3::new(3.0, 4.0, 7.0)), 49.0);
    }

    #[test]
    fn manhattan_distance_to() {
        assert_eq!(Vector3::new(1.0, 1.0, 1.0).manhattan_distance_to(&Vector3::new(3.0, -4.0, 7.0)), 13.0);
    }

    #[test]
    fn set_from_spherical() {
        // phi = 0 points along +Y
        let mut v = Vector3::default();
        v.set_from_spherical(&Spherical::new(2.0, 0.0, 0.0));
        close(&v, [0.0, 2.0, 0.0]);
    }

    #[test]
    fn set_from_spherical_coords() {
        // phi = 90 degrees, theta = 0 points along +Z
        let mut v = Vector3::default();
        v.set_from_spherical_coords(3.0, FRAC_PI_2, 0.0);
        close(&v, [0.0, 0.0, 3.0]);
    }

    #[test]
    fn set_from_cylindrical() {
        let mut v = Vector3::default();
        v.set_from_cylindrical(&Cylindrical::new(2.0, 0.0, 5.0));
        close(&v, [0.0, 5.0, 2.0]);
    }

    #[test]
    fn set_from_cylindrical_coords() {
        let mut v = Vector3::default();
        v.set_from_cylindrical_coords(2.0, FRAC_PI_2, -1.0);
        close(&v, [2.0, -1.0, 0.0]);
    }

    #[test]
    fn set_from_matrix_position() {
        let mut m = Matrix4::default();
        m.make_translation(7.0, 8.0, 9.0);
        assert_eq!(*Vector3::default().set_from_matrix_position(&m), Vector3::new(7.0, 8.0, 9.0));
    }

    #[test]
    fn set_from_matrix_scale() {
        let mut m = Matrix4::default();
        m.make_scale(2.0, 3.0, 4.0);
        assert_eq!(*Vector3::default().set_from_matrix_scale(&m), Vector3::new(2.0, 3.0, 4.0));
    }

    #[test]
    fn set_from_matrix_column() {
        let mut m = Matrix4::default();
        m.make_translation(7.0, 8.0, 9.0);
        assert_eq!(*Vector3::default().set_from_matrix_column(&m, 3), Vector3::new(7.0, 8.0, 9.0));
        assert_eq!(*Vector3::default().set_from_matrix_column(&m, 1), Vector3::new(0.0, 1.0, 0.0));
    }

    #[test]
    fn set_from_matrix3_column() {
        let mut m = Matrix3::default();
        m.set(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0);
        assert_eq!(*Vector3::default().set_from_matrix3_column(&m, 2), Vector3::new(3.0, 6.0, 9.0));
    }

    #[test]
    fn set_from_euler() {
        let e = Euler::new(0.1, 0.2, 0.3, EulerOrder::ZYX);
        assert_eq!(*Vector3::default().set_from_euler(&e), Vector3::new(0.1, 0.2, 0.3));
    }

    #[test]
    fn set_from_color() {
        assert_eq!(*Vector3::default().set_from_color(&Color::new(0.1, 0.2, 0.3)), Vector3::new(0.1, 0.2, 0.3));
    }
}
