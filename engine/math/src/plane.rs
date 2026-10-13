use crate::box3::Box3;
use crate::line3::Line3;
use crate::matrix3::Matrix3;
use crate::matrix4::Matrix4;
use crate::sphere::Sphere;
use crate::vector3::Vector3;
use crate::wide::{self, W3};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plane {
    pub normal: Vector3,
    pub constant: f32,
}

impl Default for Plane {
    fn default() -> Self {
        Self { normal: Vector3::new(1.0, 0.0, 0.0), constant: 0.0 }
    }
}

impl Plane {
    pub const fn new(normal: Vector3, constant: f32) -> Self {
        Self { normal, constant }
    }

    pub(crate) fn set_wide(&mut self, normal: W3, constant: f64) -> &mut Self {
        self.normal.set_wide(normal);
        self.constant = constant as f32;
        self
    }

    pub fn set(&mut self, normal: &Vector3, constant: f32) -> &mut Self {
        self.normal = *normal;
        self.constant = constant;
        self
    }

    pub fn set_components(&mut self, x: f32, y: f32, z: f32, w: f32) -> &mut Self {
        self.normal.set(x, y, z);
        self.constant = w;
        self
    }

    pub fn set_from_normal_and_coplanar_point(&mut self, normal: &Vector3, point: &Vector3) -> &mut Self {
        self.normal = *normal;
        self.constant = -point.dot_wide(&self.normal) as f32;
        self
    }

    pub fn set_from_coplanar_points(&mut self, a: &Vector3, b: &Vector3, c: &Vector3) -> &mut Self {
        let normal = wide::normalize(wide::cross(wide::sub(c.wide(), b.wide()), wide::sub(a.wide(), b.wide())));

        // Q: should an error be thrown if normal is zero (e.g. degenerate plane)?

        self.set_wide(normal, -wide::dot(a.wide(), normal))
    }

    pub fn copy(&mut self, plane: &Plane) -> &mut Self {
        *self = *plane;
        self
    }

    pub fn normalize(&mut self) -> &mut Self {
        let normal = self.normal.wide();
        let inverse_normal_length = 1.0 / wide::length(normal);

        self.set_wide(wide::scale(normal, inverse_normal_length), self.constant as f64 * inverse_normal_length)
    }

    pub fn negate(&mut self) -> &mut Self {
        self.constant *= -1.0;
        self.normal.negate();
        self
    }

    #[inline]
    pub(crate) fn distance_to_point_wide(&self, point: W3) -> f64 {
        wide::dot(self.normal.wide(), point) + self.constant as f64
    }

    pub fn distance_to_point(&self, point: &Vector3) -> f32 {
        self.distance_to_point_wide(point.wide()) as f32
    }

    pub fn distance_to_sphere(&self, sphere: &Sphere) -> f32 {
        (self.distance_to_point_wide(sphere.center.wide()) - sphere.radius as f64) as f32
    }

    pub fn project_point(&self, point: &Vector3) -> Vector3 {
        let p = point.wide();
        Vector3::from_wide(wide::add_scaled(p, self.normal.wide(), -self.distance_to_point_wide(p)))
    }

    pub fn intersect_line(&self, line: &Line3, clamp_to_line: bool) -> Option<Vector3> {
        let (start, normal) = (line.start.wide(), self.normal.wide());
        let direction = wide::sub(line.end.wide(), start);

        let denominator = wide::dot(normal, direction);

        if denominator == 0.0 {
            // line is coplanar, return origin
            if self.distance_to_point_wide(start) == 0.0 {
                return Some(line.start);
            }

            // Unsure if this is the correct method to handle this case.
            return None;
        }

        let t = -(wide::dot(start, normal) + self.constant as f64) / denominator;

        // written as in three.js so that a NaN `t` is not rejected here
        #[allow(clippy::manual_range_contains)]
        let outside_segment = t < 0.0 || t > 1.0;

        if clamp_to_line && outside_segment {
            return None;
        }

        Some(Vector3::from_wide(wide::add_scaled(start, direction, t)))
    }

    pub fn intersects_line(&self, line: &Line3) -> bool {
        // Note: this tests if a line intersects the plane, not whether it (or its end-points) are coplanar with it.

        let start_sign = self.distance_to_point_wide(line.start.wide());
        let end_sign = self.distance_to_point_wide(line.end.wide());

        (start_sign < 0.0 && end_sign > 0.0) || (end_sign < 0.0 && start_sign > 0.0)
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        b.intersects_plane(self)
    }

    pub fn intersects_sphere(&self, sphere: &Sphere) -> bool {
        sphere.intersects_plane(self)
    }

    pub fn coplanar_point(&self) -> Vector3 {
        let mut target = self.normal;
        target.multiply_scalar(-self.constant);
        target
    }

    pub fn apply_matrix4(&mut self, matrix: &Matrix4, optional_normal_matrix: Option<&Matrix3>) -> &mut Self {
        let m = matrix.wide();
        let normal_matrix = match optional_normal_matrix {
            Some(n) => n.wide(),
            None => wide::m3_normal_matrix(&m),
        };

        let reference_point = wide::apply_m4(wide::scale(self.normal.wide(), -(self.constant as f64)), &m);

        let normal = wide::normalize(wide::apply_m3(self.normal.wide(), &normal_matrix));

        self.set_wide(normal, -wide::dot(reference_point, normal))
    }

    pub fn translate(&mut self, offset: &Vector3) -> &mut Self {
        self.constant = (self.constant as f64 - offset.dot_wide(&self.normal)) as f32;
        self
    }

    pub fn equals(&self, plane: &Plane) -> bool {
        plane.normal.equals(&self.normal) && plane.constant == self.constant
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close_slice;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn y1() -> Plane {
        Plane::new(v(0.0, 1.0, 0.0), -1.0)
    }

    #[test]
    fn default() {
        assert_eq!(Plane::default(), Plane::new(v(1.0, 0.0, 0.0), 0.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Plane::default().set(&v(0.0, 1.0, 0.0), -1.0), y1());
    }

    #[test]
    fn set_components() {
        assert_eq!(*Plane::default().set_components(0.0, 1.0, 0.0, -1.0), y1());
    }

    #[test]
    fn set_from_normal_and_coplanar_point() {
        let mut p = Plane::default();
        p.set_from_normal_and_coplanar_point(&v(0.0, 1.0, 0.0), &v(5.0, 1.0, 7.0));
        assert_eq!(p, y1());
    }

    #[test]
    fn set_from_coplanar_points() {
        // counter-clockwise seen from +Y gives a +Y normal
        let mut p = Plane::default();
        p.set_from_coplanar_points(&v(0.0, 1.0, 0.0), &v(0.0, 1.0, 1.0), &v(1.0, 1.0, 0.0));
        assert_eq!(p, y1());
    }

    #[test]
    fn copy() {
        assert_eq!(*Plane::default().copy(&y1()), y1());
    }

    #[test]
    fn normalize() {
        assert_eq!(*Plane::new(v(0.0, 2.0, 0.0), -2.0).normalize(), y1());
    }

    #[test]
    fn negate() {
        assert_eq!(*y1().negate(), Plane::new(v(0.0, -1.0, 0.0), 1.0));
    }

    #[test]
    fn distance_to_point() {
        assert_eq!(y1().distance_to_point(&v(9.0, 4.0, 9.0)), 3.0);
        assert_eq!(y1().distance_to_point(&v(0.0, -1.0, 0.0)), -2.0);
    }

    #[test]
    fn distance_to_sphere() {
        assert_eq!(y1().distance_to_sphere(&Sphere::new(v(0.0, 4.0, 0.0), 1.0)), 2.0);
    }

    #[test]
    fn project_point() {
        assert_eq!(y1().project_point(&v(2.0, 5.0, 3.0)), v(2.0, 1.0, 3.0));
    }

    #[test]
    fn intersect_line() {
        let line = Line3::new(v(0.0, 0.0, 0.0), v(0.0, 4.0, 0.0));
        assert_eq!(y1().intersect_line(&line, true), Some(v(0.0, 1.0, 0.0)));
        // segment stops short of the plane
        let short = Line3::new(v(0.0, 0.0, 0.0), v(0.0, 0.5, 0.0));
        assert_eq!(y1().intersect_line(&short, true), None);
        assert_eq!(y1().intersect_line(&short, false), Some(v(0.0, 1.0, 0.0)));
        // parallel: none, unless the start lies on the plane
        assert_eq!(y1().intersect_line(&Line3::new(v(0.0, 0.0, 0.0), v(1.0, 0.0, 0.0)), true), None);
        let on = Line3::new(v(3.0, 1.0, 0.0), v(4.0, 1.0, 0.0));
        assert_eq!(y1().intersect_line(&on, true), Some(v(3.0, 1.0, 0.0)));
    }

    #[test]
    fn intersects_line() {
        assert!(y1().intersects_line(&Line3::new(v(0.0, 0.0, 0.0), v(0.0, 4.0, 0.0))));
        assert!(!y1().intersects_line(&Line3::new(v(0.0, 2.0, 0.0), v(0.0, 4.0, 0.0))));
    }

    #[test]
    fn intersects_box() {
        assert!(y1().intersects_box(&Box3::new(v(0.0, 0.0, 0.0), v(2.0, 2.0, 2.0))));
        assert!(!y1().intersects_box(&Box3::new(v(0.0, 2.0, 0.0), v(2.0, 3.0, 2.0))));
    }

    #[test]
    fn intersects_sphere() {
        assert!(y1().intersects_sphere(&Sphere::new(v(0.0, 0.0, 0.0), 1.0)));
        assert!(!y1().intersects_sphere(&Sphere::new(v(0.0, 0.0, 0.0), 0.5)));
    }

    #[test]
    fn coplanar_point() {
        assert_eq!(y1().coplanar_point(), v(0.0, 1.0, 0.0));
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(0.0, 2.0, 0.0);
        assert_eq!(*y1().apply_matrix4(&m, None), Plane::new(v(0.0, 1.0, 0.0), -3.0));

        // rotating y = 1 a quarter turn about Z gives x = -1
        m.make_rotation_z(core::f32::consts::FRAC_PI_2);
        let mut p = y1();
        p.apply_matrix4(&m, None);
        assert_close_slice(&[p.normal.x, p.normal.y, p.normal.z, p.constant], &[-1.0, 0.0, 0.0, -1.0]);

        // an explicit normal matrix is used as given
        let mut n = Matrix3::default();
        n.get_normal_matrix(&m);
        let mut q = y1();
        q.apply_matrix4(&m, Some(&n));
        assert_close_slice(&[q.normal.x, q.normal.y, q.normal.z, q.constant], &[-1.0, 0.0, 0.0, -1.0]);
    }

    #[test]
    fn translate() {
        assert_eq!(*y1().translate(&v(5.0, 2.0, 5.0)), Plane::new(v(0.0, 1.0, 0.0), -3.0));
    }

    #[test]
    fn equals() {
        assert!(y1().equals(&y1()));
        assert!(!y1().equals(&Plane::default()));
    }
}
