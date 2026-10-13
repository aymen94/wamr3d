use crate::box3::Box3;
use crate::plane::Plane;
use crate::vector3::Vector3;
use crate::wide::{self, W3};

pub trait Interpolate: Copy + Default {
    #[doc(hidden)]
    fn interpolate(v1: &Self, v2: &Self, v3: &Self, barycoord: [f64; 3]) -> Self;
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Triangle {
    pub a: Vector3,
    pub b: Vector3,
    pub c: Vector3,
}

fn barycoord_wide(point: W3, a: W3, b: W3, c: W3) -> Option<W3> {
    let v0 = wide::sub(c, a);
    let v1 = wide::sub(b, a);
    let v2 = wide::sub(point, a);

    let dot00 = wide::dot(v0, v0);
    let dot01 = wide::dot(v0, v1);
    let dot02 = wide::dot(v0, v2);
    let dot11 = wide::dot(v1, v1);
    let dot12 = wide::dot(v1, v2);

    let denom = dot00 * dot11 - dot01 * dot01;

    // collinear or singular triangle
    if denom == 0.0 {
        return None;
    }

    let inv_denom = 1.0 / denom;
    let u = (dot11 * dot02 - dot01 * dot12) * inv_denom;
    let v = (dot00 * dot12 - dot01 * dot02) * inv_denom;

    // barycentric coordinates must always sum to 1
    Some([1.0 - u - v, v, u])
}

impl Triangle {
    pub const fn new(a: Vector3, b: Vector3, c: Vector3) -> Self {
        Self { a, b, c }
    }

    pub fn get_normal_abc(a: &Vector3, b: &Vector3, c: &Vector3) -> Vector3 {
        let target = wide::cross(wide::sub(c.wide(), b.wide()), wide::sub(a.wide(), b.wide()));

        let target_length_sq = wide::length_sq(target);
        if target_length_sq > 0.0 {
            return Vector3::from_wide(wide::scale(target, 1.0 / target_length_sq.sqrt()));
        }

        Vector3::new(0.0, 0.0, 0.0)
    }

    pub fn get_barycoord_abc(point: &Vector3, a: &Vector3, b: &Vector3, c: &Vector3) -> Option<Vector3> {
        barycoord_wide(point.wide(), a.wide(), b.wide(), c.wide()).map(Vector3::from_wide)
    }

    pub fn contains_point_abc(point: &Vector3, a: &Vector3, b: &Vector3, c: &Vector3) -> bool {
        // if the triangle is degenerate then we can't contain a point
        match barycoord_wide(point.wide(), a.wide(), b.wide(), c.wide()) {
            None => false,
            Some(v3) => v3[0] >= 0.0 && v3[1] >= 0.0 && (v3[0] + v3[1]) <= 1.0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn get_interpolation_abc<T: Interpolate>(
        point: &Vector3,
        p1: &Vector3,
        p2: &Vector3,
        p3: &Vector3,
        v1: &T,
        v2: &T,
        v3: &T,
    ) -> Option<T> {
        let barycoord = barycoord_wide(point.wide(), p1.wide(), p2.wide(), p3.wide())?;

        Some(T::interpolate(v1, v2, v3, barycoord))
    }

    pub fn is_front_facing_abc(a: &Vector3, b: &Vector3, c: &Vector3, direction: &Vector3) -> bool {
        let v0 = wide::sub(c.wide(), b.wide());
        let v1 = wide::sub(a.wide(), b.wide());

        // strictly front facing
        wide::dot(wide::cross(v0, v1), direction.wide()) < 0.0
    }

    pub fn set(&mut self, a: &Vector3, b: &Vector3, c: &Vector3) -> &mut Self {
        self.a = *a;
        self.b = *b;
        self.c = *c;
        self
    }

    pub fn set_from_points_and_indices(&mut self, points: &[Vector3], i0: usize, i1: usize, i2: usize) -> &mut Self {
        self.a = points[i0];
        self.b = points[i1];
        self.c = points[i2];
        self
    }

    pub fn copy(&mut self, triangle: &Triangle) -> &mut Self {
        *self = *triangle;
        self
    }

    pub fn get_area(&self) -> f32 {
        let v0 = wide::sub(self.c.wide(), self.b.wide());
        let v1 = wide::sub(self.a.wide(), self.b.wide());

        (wide::length(wide::cross(v0, v1)) * 0.5) as f32
    }

    pub fn get_midpoint(&self) -> Vector3 {
        let sum = wide::add(wide::add(self.a.wide(), self.b.wide()), self.c.wide());
        Vector3::from_wide(wide::scale(sum, 1.0 / 3.0))
    }

    pub fn get_normal(&self) -> Vector3 {
        Triangle::get_normal_abc(&self.a, &self.b, &self.c)
    }

    pub fn get_plane(&self) -> Plane {
        let mut target = Plane::default();
        target.set_from_coplanar_points(&self.a, &self.b, &self.c);
        target
    }

    pub fn get_barycoord(&self, point: &Vector3) -> Option<Vector3> {
        Triangle::get_barycoord_abc(point, &self.a, &self.b, &self.c)
    }

    pub fn get_interpolation<T: Interpolate>(&self, point: &Vector3, v1: &T, v2: &T, v3: &T) -> Option<T> {
        Triangle::get_interpolation_abc(point, &self.a, &self.b, &self.c, v1, v2, v3)
    }

    pub fn contains_point(&self, point: &Vector3) -> bool {
        Triangle::contains_point_abc(point, &self.a, &self.b, &self.c)
    }

    pub fn is_front_facing(&self, direction: &Vector3) -> bool {
        Triangle::is_front_facing_abc(&self.a, &self.b, &self.c, direction)
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        b.intersects_triangle(self)
    }

    pub fn closest_point_to_point(&self, p: &Vector3) -> Vector3 {
        let (a, b, c, p) = (self.a.wide(), self.b.wide(), self.c.wide(), p.wide());
        let (v, w);

        // algorithm thanks to Real-Time Collision Detection by Christer Ericson,
        // published by Morgan Kaufmann Publishers, (c) 2005 Elsevier Inc.,
        // under the accompanying license; see chapter 5.1.5 for detailed explanation.
        // basically, we're distinguishing which of the voronoi regions of the triangle
        // the point lies in with the minimum amount of redundant computation.

        let vab = wide::sub(b, a);
        let vac = wide::sub(c, a);
        let vap = wide::sub(p, a);
        let d1 = wide::dot(vab, vap);
        let d2 = wide::dot(vac, vap);
        if d1 <= 0.0 && d2 <= 0.0 {
            // vertex region of A; barycentric coords (1, 0, 0)
            return self.a;
        }

        let vbp = wide::sub(p, b);
        let d3 = wide::dot(vab, vbp);
        let d4 = wide::dot(vac, vbp);
        if d3 >= 0.0 && d4 <= d3 {
            // vertex region of B; barycentric coords (0, 1, 0)
            return self.b;
        }

        let vc = d1 * d4 - d3 * d2;
        if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
            v = d1 / (d1 - d3);
            // edge region of AB; barycentric coords (1-v, v, 0)
            return Vector3::from_wide(wide::add_scaled(a, vab, v));
        }

        let vcp = wide::sub(p, c);
        let d5 = wide::dot(vab, vcp);
        let d6 = wide::dot(vac, vcp);
        if d6 >= 0.0 && d5 <= d6 {
            // vertex region of C; barycentric coords (0, 0, 1)
            return self.c;
        }

        let vb = d5 * d2 - d1 * d6;
        if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
            w = d2 / (d2 - d6);
            // edge region of AC; barycentric coords (1-w, 0, w)
            return Vector3::from_wide(wide::add_scaled(a, vac, w));
        }

        let va = d3 * d6 - d5 * d4;
        if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
            let vbc = wide::sub(c, b);
            w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            // edge region of BC; barycentric coords (0, 1-w, w)
            return Vector3::from_wide(wide::add_scaled(b, vbc, w)); // edge region of BC
        }

        // face region
        let denom = 1.0 / (va + vb + vc);
        // u = va * denom
        v = vb * denom;
        w = vc * denom;

        Vector3::from_wide(wide::add_scaled(wide::add_scaled(a, vab, v), vac, w))
    }

    pub fn equals(&self, triangle: &Triangle) -> bool {
        triangle.a.equals(&self.a) && triangle.b.equals(&self.b) && triangle.c.equals(&self.c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector2::Vector2;
    use crate::vector4::Vector4;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn tri() -> Triangle {
        Triangle::new(v(0.0, 0.0, 0.0), v(4.0, 0.0, 0.0), v(0.0, 4.0, 0.0))
    }

    fn degenerate() -> Triangle {
        Triangle::new(v(0.0, 0.0, 0.0), v(1.0, 1.0, 1.0), v(2.0, 2.0, 2.0))
    }

    #[test]
    fn default_and_new() {
        assert_eq!(Triangle::default(), Triangle::new(v(0.0, 0.0, 0.0), v(0.0, 0.0, 0.0), v(0.0, 0.0, 0.0)));
    }

    #[test]
    fn get_normal_abc() {
        let t = tri();
        // counter-clockwise winding gives a normal toward the viewer
        assert_eq!(Triangle::get_normal_abc(&t.a, &t.b, &t.c), v(0.0, 0.0, 1.0));
        assert_eq!(Triangle::get_normal_abc(&t.a, &t.c, &t.b), v(0.0, 0.0, -1.0));
        let d = degenerate();
        assert_eq!(Triangle::get_normal_abc(&d.a, &d.b, &d.c), v(0.0, 0.0, 0.0));
    }

    #[test]
    fn get_barycoord_abc() {
        let t = tri();
        assert_eq!(Triangle::get_barycoord_abc(&t.b, &t.a, &t.b, &t.c), Some(v(0.0, 1.0, 0.0)));
        assert_eq!(Triangle::get_barycoord_abc(&v(1.0, 1.0, 0.0), &t.a, &t.b, &t.c), Some(v(0.5, 0.25, 0.25)));
        let d = degenerate();
        assert_eq!(Triangle::get_barycoord_abc(&v(1.0, 1.0, 0.0), &d.a, &d.b, &d.c), None);
    }

    #[test]
    fn contains_point_abc() {
        let t = tri();
        assert!(Triangle::contains_point_abc(&v(1.0, 1.0, 0.0), &t.a, &t.b, &t.c));
        assert!(!Triangle::contains_point_abc(&v(3.0, 3.0, 0.0), &t.a, &t.b, &t.c));
        let d = degenerate();
        assert!(!Triangle::contains_point_abc(&d.a, &d.a, &d.b, &d.c));
    }

    #[test]
    fn get_interpolation_abc() {
        let t = tri();
        let p = v(1.0, 1.0, 0.0);
        // uv (Vector2), position-like (Vector3) and colour-like (Vector4) targets
        let uv = Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &Vector2::new(0.0, 0.0), &Vector2::new(1.0, 0.0), &Vector2::new(0.0, 1.0));
        assert_eq!(uv, Some(Vector2::new(0.25, 0.25)));
        let pos = Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &t.a, &t.b, &t.c);
        assert_eq!(pos, Some(p));
        let w = Vector4::new(8.0, 0.0, 0.0, 4.0);
        assert_eq!(Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &w, &w, &w), Some(w));
        let d = degenerate();
        assert_eq!(Triangle::get_interpolation_abc(&p, &d.a, &d.b, &d.c, &t.a, &t.b, &t.c), None);
    }

    #[test]
    fn is_front_facing_abc() {
        let t = tri();
        assert!(Triangle::is_front_facing_abc(&t.a, &t.b, &t.c, &v(0.0, 0.0, -1.0)));
        assert!(!Triangle::is_front_facing_abc(&t.a, &t.b, &t.c, &v(0.0, 0.0, 1.0)));
        // edge-on is not strictly front facing
        assert!(!Triangle::is_front_facing_abc(&t.a, &t.b, &t.c, &v(1.0, 0.0, 0.0)));
    }

    #[test]
    fn set() {
        let t = tri();
        assert_eq!(*Triangle::default().set(&t.a, &t.b, &t.c), t);
    }

    #[test]
    fn set_from_points_and_indices() {
        let t = tri();
        let points = [t.c, t.a, t.b];
        assert_eq!(*Triangle::default().set_from_points_and_indices(&points, 1, 2, 0), t);
    }

    #[test]
    fn copy() {
        assert_eq!(*Triangle::default().copy(&tri()), tri());
    }

    #[test]
    fn get_area() {
        assert_eq!(tri().get_area(), 8.0);
        assert_eq!(degenerate().get_area(), 0.0);
    }

    #[test]
    fn get_midpoint() {
        assert_eq!(Triangle::new(v(0.0, 0.0, 0.0), v(3.0, 0.0, 0.0), v(0.0, 6.0, 9.0)).get_midpoint(), v(1.0, 2.0, 3.0));
    }

    #[test]
    fn get_normal() {
        assert_eq!(tri().get_normal(), v(0.0, 0.0, 1.0));
    }

    #[test]
    fn get_plane() {
        let t = Triangle::new(v(0.0, 0.0, 2.0), v(4.0, 0.0, 2.0), v(0.0, 4.0, 2.0));
        assert_eq!(t.get_plane(), Plane::new(v(0.0, 0.0, 1.0), -2.0));
    }

    #[test]
    fn get_barycoord() {
        assert_eq!(tri().get_barycoord(&v(0.0, 4.0, 0.0)), Some(v(0.0, 0.0, 1.0)));
    }

    #[test]
    fn get_interpolation() {
        let t = tri();
        assert_eq!(t.get_interpolation(&v(2.0, 2.0, 0.0), &t.a, &t.b, &t.c), Some(v(2.0, 2.0, 0.0)));
    }

    #[test]
    fn contains_point() {
        assert!(tri().contains_point(&v(1.0, 1.0, 0.0)));
        assert!(!tri().contains_point(&v(-1.0, 1.0, 0.0)));
    }

    #[test]
    fn is_front_facing() {
        assert!(tri().is_front_facing(&v(0.0, 0.0, -1.0)));
    }

    #[test]
    fn intersects_box() {
        assert!(tri().intersects_box(&Box3::new(v(-1.0, -1.0, -1.0), v(1.0, 1.0, 1.0))));
        assert!(!tri().intersects_box(&Box3::new(v(-1.0, -1.0, 1.0), v(1.0, 1.0, 2.0))));
    }

    #[test]
    fn closest_point_to_point_covers_every_region() {
        let t = tri();
        // vertex regions
        assert_eq!(t.closest_point_to_point(&v(-1.0, -1.0, 5.0)), t.a);
        assert_eq!(t.closest_point_to_point(&v(6.0, -1.0, 0.0)), t.b);
        assert_eq!(t.closest_point_to_point(&v(-1.0, 6.0, 0.0)), t.c);
        // edge regions AB, AC, BC
        assert_eq!(t.closest_point_to_point(&v(2.0, -3.0, 1.0)), v(2.0, 0.0, 0.0));
        assert_eq!(t.closest_point_to_point(&v(-3.0, 2.0, 1.0)), v(0.0, 2.0, 0.0));
        assert_eq!(t.closest_point_to_point(&v(4.0, 4.0, 0.0)), v(2.0, 2.0, 0.0));
        // face region: straight down onto the plane
        assert_eq!(t.closest_point_to_point(&v(1.0, 1.0, 7.0)), v(1.0, 1.0, 0.0));
    }

    #[test]
    fn equals() {
        assert!(tri().equals(&tri()));
        assert!(!tri().equals(&degenerate()));
    }
}
