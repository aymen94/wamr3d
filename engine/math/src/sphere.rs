use crate::box3::Box3;
use crate::matrix4::Matrix4;
use crate::plane::Plane;
use crate::vector3::Vector3;
use crate::wide::{self, W3};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sphere {
    pub center: Vector3,
    pub radius: f32,
}

impl Default for Sphere {
    fn default() -> Self {
        Self { center: Vector3::new(0.0, 0.0, 0.0), radius: -1.0 }
    }
}

fn expand_by_point_wide(center: &mut W3, radius: &mut f64, point: W3) {
    if *radius < 0.0 {
        *center = point;
        *radius = 0.0;
        return;
    }

    let v1 = wide::sub(point, *center);
    let length_sq = wide::length_sq(v1);

    if length_sq > *radius * *radius {
        // calculate the minimal sphere

        let length = length_sq.sqrt();
        let delta = (length - *radius) * 0.5;

        *center = wide::add_scaled(*center, v1, delta / length);
        *radius += delta;
    }
}

impl Sphere {
    pub const fn new(center: Vector3, radius: f32) -> Self {
        Self { center, radius }
    }

    pub fn set(&mut self, center: &Vector3, radius: f32) -> &mut Self {
        self.center = *center;
        self.radius = radius;
        self
    }

    pub fn set_from_points(&mut self, points: &[Vector3], optional_center: Option<&Vector3>) -> &mut Self {
        let center = match optional_center {
            Some(c) => c.wide(),
            None => {
                let mut b = Box3::default();
                b.set_from_points(points);
                if b.is_empty() {
                    [0.0; 3]
                } else {
                    wide::scale(wide::add(b.min.wide(), b.max.wide()), 0.5)
                }
            }
        };

        let mut max_radius_sq = 0.0;

        for p in points {
            max_radius_sq = wide::max(max_radius_sq, wide::distance_sq(center, p.wide()));
        }

        self.center.set_wide(center);
        self.radius = max_radius_sq.sqrt() as f32;

        self
    }

    pub fn copy(&mut self, sphere: &Sphere) -> &mut Self {
        *self = *sphere;
        self
    }

    pub fn is_empty(&self) -> bool {
        self.radius < 0.0
    }

    pub fn make_empty(&mut self) -> &mut Self {
        *self = Self::default();
        self
    }

    pub fn contains_point(&self, point: &Vector3) -> bool {
        let radius = self.radius as f64;
        wide::distance_sq(point.wide(), self.center.wide()) <= radius * radius
    }

    pub fn distance_to_point(&self, point: &Vector3) -> f32 {
        (wide::distance_sq(point.wide(), self.center.wide()).sqrt() - self.radius as f64) as f32
    }

    pub fn intersects_sphere(&self, sphere: &Sphere) -> bool {
        let radius_sum = self.radius as f64 + sphere.radius as f64;

        wide::distance_sq(sphere.center.wide(), self.center.wide()) <= radius_sum * radius_sum
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        b.intersects_sphere(self)
    }

    pub fn intersects_plane(&self, plane: &Plane) -> bool {
        plane.distance_to_point_wide(self.center.wide()).abs() <= self.radius as f64
    }

    pub fn clamp_point(&self, point: &Vector3) -> Vector3 {
        let (center, p, radius) = (self.center.wide(), point.wide(), self.radius as f64);
        let delta_length_sq = wide::distance_sq(center, p);

        if delta_length_sq > radius * radius {
            let direction = wide::normalize(wide::sub(p, center));
            Vector3::from_wide(wide::add(wide::scale(direction, radius), center))
        } else {
            *point
        }
    }

    pub fn get_bounding_box(&self) -> Box3 {
        let mut target = Box3::default();

        if self.is_empty() {
            // Empty sphere produces empty bounding box
            return target;
        }

        target.set(&self.center, &self.center);
        target.expand_by_scalar(self.radius);

        target
    }

    pub fn apply_matrix4(&mut self, matrix: &Matrix4) -> &mut Self {
        self.center.apply_matrix4(matrix);
        self.radius = (self.radius as f64 * wide::m4_max_scale_on_axis(&matrix.wide())) as f32;
        self
    }

    pub fn translate(&mut self, offset: &Vector3) -> &mut Self {
        self.center.add(offset);
        self
    }

    pub fn expand_by_point(&mut self, point: &Vector3) -> &mut Self {
        let (mut center, mut radius) = (self.center.wide(), self.radius as f64);
        expand_by_point_wide(&mut center, &mut radius, point.wide());

        self.center.set_wide(center);
        self.radius = radius as f32;
        self
    }

    pub fn union(&mut self, sphere: &Sphere) -> &mut Self {
        if sphere.is_empty() {
            return self;
        }

        if self.is_empty() {
            return self.copy(sphere);
        }

        if self.center.equals(&sphere.center) {
            self.radius = wide::max32(self.radius, sphere.radius);
        } else {
            let (mut center, mut radius) = (self.center.wide(), self.radius as f64);
            let other = sphere.center.wide();

            // _v2.subVectors( sphere.center, this.center ).setLength( sphere.radius )
            let offset = wide::sub(other, center);
            let v2 = wide::scale(wide::scale(offset, 1.0 / wide::or_one(wide::length(offset))), sphere.radius as f64);

            expand_by_point_wide(&mut center, &mut radius, wide::add(other, v2));
            expand_by_point_wide(&mut center, &mut radius, wide::sub(other, v2));

            self.center.set_wide(center);
            self.radius = radius as f32;
        }

        self
    }

    pub fn equals(&self, sphere: &Sphere) -> bool {
        sphere.center.equals(&self.center) && sphere.radius == self.radius
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn unit() -> Sphere {
        Sphere::new(v(0.0, 0.0, 0.0), 1.0)
    }

    #[test]
    fn default_is_empty() {
        assert_eq!(Sphere::default(), Sphere::new(v(0.0, 0.0, 0.0), -1.0));
        assert!(Sphere::default().is_empty());
    }

    #[test]
    fn set() {
        assert_eq!(*Sphere::default().set(&v(1.0, 2.0, 3.0), 4.0), Sphere::new(v(1.0, 2.0, 3.0), 4.0));
    }

    #[test]
    fn set_from_points() {
        let pts = [v(-1.0, 0.0, 0.0), v(3.0, 0.0, 0.0)];
        let mut s = Sphere::default();
        s.set_from_points(&pts, None);
        assert_eq!(s, Sphere::new(v(1.0, 0.0, 0.0), 2.0));
        s.set_from_points(&pts, Some(&v(-1.0, 0.0, 0.0)));
        assert_eq!(s, Sphere::new(v(-1.0, 0.0, 0.0), 4.0));
        s.set_from_points(&[], None);
        assert_eq!(s, Sphere::new(v(0.0, 0.0, 0.0), 0.0));
    }

    #[test]
    fn copy() {
        assert_eq!(*Sphere::default().copy(&unit()), unit());
    }

    #[test]
    fn is_empty_and_make_empty() {
        let mut s = Sphere::new(v(1.0, 1.0, 1.0), 0.0);
        assert!(!s.is_empty());
        assert_eq!(*s.make_empty(), Sphere::default());
    }

    #[test]
    fn contains_point() {
        assert!(unit().contains_point(&v(1.0, 0.0, 0.0)));
        assert!(!unit().contains_point(&v(1.0, 0.5, 0.0)));
    }

    #[test]
    fn distance_to_point() {
        assert_eq!(unit().distance_to_point(&v(3.0, 0.0, 0.0)), 2.0);
        assert_eq!(unit().distance_to_point(&v(0.0, 0.0, 0.0)), -1.0);
    }

    #[test]
    fn intersects_sphere() {
        assert!(unit().intersects_sphere(&Sphere::new(v(2.0, 0.0, 0.0), 1.0)));
        assert!(!unit().intersects_sphere(&Sphere::new(v(2.5, 0.0, 0.0), 1.0)));
    }

    #[test]
    fn intersects_box() {
        assert!(unit().intersects_box(&Box3::new(v(1.0, -1.0, -1.0), v(2.0, 1.0, 1.0))));
        assert!(!unit().intersects_box(&Box3::new(v(1.5, -1.0, -1.0), v(2.0, 1.0, 1.0))));
    }

    #[test]
    fn intersects_plane() {
        assert!(unit().intersects_plane(&Plane::new(v(0.0, 1.0, 0.0), 1.0)));
        assert!(!unit().intersects_plane(&Plane::new(v(0.0, 1.0, 0.0), 1.5)));
    }

    #[test]
    fn clamp_point() {
        assert_eq!(unit().clamp_point(&v(0.0, 5.0, 0.0)), v(0.0, 1.0, 0.0));
        assert_eq!(unit().clamp_point(&v(0.0, 0.5, 0.0)), v(0.0, 0.5, 0.0));
    }

    #[test]
    fn get_bounding_box() {
        let b = Sphere::new(v(1.0, 2.0, 3.0), 1.0).get_bounding_box();
        assert_eq!(b, Box3::new(v(0.0, 1.0, 2.0), v(2.0, 3.0, 4.0)));
        assert!(Sphere::default().get_bounding_box().is_empty());
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_scale(2.0, 3.0, 1.0);
        m.set_position(1.0, 0.0, 0.0);
        let mut s = Sphere::new(v(1.0, 1.0, 1.0), 2.0);
        s.apply_matrix4(&m);
        // the radius grows by the largest axis scale
        assert_eq!(s, Sphere::new(v(3.0, 3.0, 1.0), 6.0));
    }

    #[test]
    fn translate() {
        assert_eq!(*unit().translate(&v(1.0, 2.0, 3.0)), Sphere::new(v(1.0, 2.0, 3.0), 1.0));
    }

    #[test]
    fn expand_by_point() {
        let mut s = unit();
        s.expand_by_point(&v(3.0, 0.0, 0.0));
        assert_eq!(s, Sphere::new(v(1.0, 0.0, 0.0), 2.0));
        // a point already inside changes nothing
        s.expand_by_point(&v(1.0, 1.0, 0.0));
        assert_eq!(s, Sphere::new(v(1.0, 0.0, 0.0), 2.0));
        // an empty sphere becomes the point
        let mut e = Sphere::default();
        e.expand_by_point(&v(1.0, 2.0, 3.0));
        assert_eq!(e, Sphere::new(v(1.0, 2.0, 3.0), 0.0));
    }

    #[test]
    fn union() {
        let mut s = unit();
        s.union(&Sphere::new(v(4.0, 0.0, 0.0), 1.0));
        assert_eq!(s, Sphere::new(v(2.0, 0.0, 0.0), 3.0));
        // same centre: the larger radius wins
        let mut c = unit();
        c.union(&Sphere::new(v(0.0, 0.0, 0.0), 2.5));
        assert_eq!(c.radius, 2.5);
        // empty operands
        let mut e = Sphere::default();
        e.union(&unit());
        assert_eq!(e, unit());
        e.union(&Sphere::default());
        assert_eq!(e, unit());
    }

    #[test]
    fn equals() {
        assert!(unit().equals(&unit()));
        assert!(!unit().equals(&Sphere::default()));
    }
}
