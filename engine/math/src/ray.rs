use crate::box3::Box3;
use crate::matrix4::Matrix4;
use crate::plane::Plane;
use crate::sphere::Sphere;
use crate::vector3::Vector3;
use crate::wide::{self, W3};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    pub origin: Vector3,
    pub direction: Vector3,
}

impl Default for Ray {
    fn default() -> Self {
        Self { origin: Vector3::new(0.0, 0.0, 0.0), direction: Vector3::new(0.0, 0.0, -1.0) }
    }
}

impl Ray {
    pub const fn new(origin: Vector3, direction: Vector3) -> Self {
        Self { origin, direction }
    }

    pub fn set(&mut self, origin: &Vector3, direction: &Vector3) -> &mut Self {
        self.origin = *origin;
        self.direction = *direction;
        self
    }

    pub fn copy(&mut self, ray: &Ray) -> &mut Self {
        *self = *ray;
        self
    }

    #[inline]
    fn at_wide(&self, t: f64) -> W3 {
        wide::add_scaled(self.origin.wide(), self.direction.wide(), t)
    }

    pub fn at(&self, t: f32) -> Vector3 {
        Vector3::from_wide(self.at_wide(t as f64))
    }

    pub fn look_at(&mut self, v: &Vector3) -> &mut Self {
        self.direction.set_wide(wide::normalize(wide::sub(v.wide(), self.origin.wide())));
        self
    }

    pub fn recast(&mut self, t: f32) -> &mut Self {
        self.origin = self.at(t);
        self
    }

    pub fn closest_point_to_point(&self, point: &Vector3) -> Vector3 {
        let direction_distance = wide::dot(wide::sub(point.wide(), self.origin.wide()), self.direction.wide());

        if direction_distance < 0.0 {
            return self.origin;
        }

        Vector3::from_wide(self.at_wide(direction_distance))
    }

    pub fn distance_to_point(&self, point: &Vector3) -> f32 {
        self.distance_sq_to_point_wide(point.wide()).sqrt() as f32
    }

    fn distance_sq_to_point_wide(&self, point: W3) -> f64 {
        let origin = self.origin.wide();
        let direction_distance = wide::dot(wide::sub(point, origin), self.direction.wide());

        // point behind the ray

        if direction_distance < 0.0 {
            return wide::distance_sq(origin, point);
        }

        wide::distance_sq(self.at_wide(direction_distance), point)
    }

    pub fn distance_sq_to_point(&self, point: &Vector3) -> f32 {
        self.distance_sq_to_point_wide(point.wide()) as f32
    }

    pub fn distance_sq_to_segment(
        &self,
        v0: &Vector3,
        v1: &Vector3,
        optional_point_on_ray: Option<&mut Vector3>,
        optional_point_on_segment: Option<&mut Vector3>,
    ) -> f32 {
        // from https://github.com/pmjoniak/GeometricTools/blob/master/GTEngine/Include/Mathematics/GteDistRaySegment.h
        // It returns the min distance between the ray and the segment
        // defined by v0 and v1
        // It can also set two optional targets :
        // - The closest point on the ray
        // - The closest point on the segment

        let (v0, v1) = (v0.wide(), v1.wide());
        let (origin, direction) = (self.origin.wide(), self.direction.wide());

        let seg_center = wide::scale(wide::add(v0, v1), 0.5);
        let seg_dir = wide::normalize(wide::sub(v1, v0));
        let diff = wide::sub(origin, seg_center);

        let seg_extent = wide::distance_sq(v0, v1).sqrt() * 0.5;
        let a01 = -wide::dot(direction, seg_dir);
        let b0 = wide::dot(diff, direction);
        let b1 = -wide::dot(diff, seg_dir);
        let c = wide::length_sq(diff);
        let det = (1.0 - a01 * a01).abs();
        let (mut s0, mut s1, sqr_dist, ext_det);

        if det > 0.0 {
            // The ray and segment are not parallel.

            s0 = a01 * b1 - b0;
            s1 = a01 * b0 - b1;
            ext_det = seg_extent * det;

            if s0 >= 0.0 {
                if s1 >= -ext_det {
                    if s1 <= ext_det {
                        // region 0
                        // Minimum at interior points of ray and segment.

                        let inv_det = 1.0 / det;
                        s0 *= inv_det;
                        s1 *= inv_det;
                        sqr_dist = s0 * (s0 + a01 * s1 + 2.0 * b0) + s1 * (a01 * s0 + s1 + 2.0 * b1) + c;
                    } else {
                        // region 1

                        s1 = seg_extent;
                        s0 = wide::max(0.0, -(a01 * s1 + b0));
                        sqr_dist = -s0 * s0 + s1 * (s1 + 2.0 * b1) + c;
                    }
                } else {
                    // region 5

                    s1 = -seg_extent;
                    s0 = wide::max(0.0, -(a01 * s1 + b0));
                    sqr_dist = -s0 * s0 + s1 * (s1 + 2.0 * b1) + c;
                }
            } else if s1 <= -ext_det {
                // region 4

                s0 = wide::max(0.0, -(-a01 * seg_extent + b0));
                s1 = if s0 > 0.0 { -seg_extent } else { wide::min(wide::max(-seg_extent, -b1), seg_extent) };
                sqr_dist = -s0 * s0 + s1 * (s1 + 2.0 * b1) + c;
            } else if s1 <= ext_det {
                // region 3

                s0 = 0.0;
                s1 = wide::min(wide::max(-seg_extent, -b1), seg_extent);
                sqr_dist = s1 * (s1 + 2.0 * b1) + c;
            } else {
                // region 2

                s0 = wide::max(0.0, -(a01 * seg_extent + b0));
                s1 = if s0 > 0.0 { seg_extent } else { wide::min(wide::max(-seg_extent, -b1), seg_extent) };
                sqr_dist = -s0 * s0 + s1 * (s1 + 2.0 * b1) + c;
            }
        } else {
            // Ray and segment are parallel.

            s1 = if a01 > 0.0 { -seg_extent } else { seg_extent };
            s0 = wide::max(0.0, -(a01 * s1 + b0));
            sqr_dist = -s0 * s0 + s1 * (s1 + 2.0 * b1) + c;
        }

        if let Some(p) = optional_point_on_ray {
            p.set_wide(wide::add_scaled(origin, direction, s0));
        }

        if let Some(p) = optional_point_on_segment {
            p.set_wide(wide::add_scaled(seg_center, seg_dir, s1));
        }

        sqr_dist as f32
    }

    pub fn intersect_sphere(&self, sphere: &Sphere) -> Option<Vector3> {
        let sphere_radius = sphere.radius as f64;

        if sphere_radius < 0.0 {
            return None; // handle empty spheres, see #31187
        }

        let v = wide::sub(sphere.center.wide(), self.origin.wide());
        let tca = wide::dot(v, self.direction.wide());
        let d2 = wide::dot(v, v) - tca * tca;
        let radius2 = sphere_radius * sphere_radius;

        if d2 > radius2 {
            return None;
        }

        let thc = (radius2 - d2).sqrt();

        // t0 = first intersect point - entrance on front of sphere
        let t0 = tca - thc;

        // t1 = second intersect point - exit point on back of sphere
        let t1 = tca + thc;

        // test to see if t1 is behind the ray - if so, return null
        if t1 < 0.0 {
            return None;
        }

        // test to see if t0 is behind the ray:
        // if it is, the ray is inside the sphere, so return the second exit point scaled by t1,
        // in order to always return an intersect point that is in front of the ray.
        if t0 < 0.0 {
            return Some(Vector3::from_wide(self.at_wide(t1)));
        }

        // else t0 is in front of the ray, so return the first collision point scaled by t0
        Some(Vector3::from_wide(self.at_wide(t0)))
    }

    pub fn intersects_sphere(&self, sphere: &Sphere) -> bool {
        let radius = sphere.radius as f64;

        if radius < 0.0 {
            return false; // handle empty spheres, see #31187
        }

        self.distance_sq_to_point_wide(sphere.center.wide()) <= radius * radius
    }

    fn distance_to_plane_wide(&self, plane: &Plane) -> Option<f64> {
        let normal = plane.normal.wide();
        let denominator = wide::dot(normal, self.direction.wide());

        if denominator == 0.0 {
            // line is coplanar, return origin
            if plane.distance_to_point_wide(self.origin.wide()) == 0.0 {
                return Some(0.0);
            }

            // Null is preferable to undefined since undefined means.... it is undefined

            return None;
        }

        let t = -(wide::dot(self.origin.wide(), normal) + plane.constant as f64) / denominator;

        // Return if the ray never intersects the plane

        if t >= 0.0 {
            Some(t)
        } else {
            None
        }
    }

    pub fn distance_to_plane(&self, plane: &Plane) -> Option<f32> {
        self.distance_to_plane_wide(plane).map(|t| t as f32)
    }

    pub fn intersect_plane(&self, plane: &Plane) -> Option<Vector3> {
        let t = self.distance_to_plane_wide(plane)?;

        Some(Vector3::from_wide(self.at_wide(t)))
    }

    pub fn intersects_plane(&self, plane: &Plane) -> bool {
        // check if the ray lies on the plane first

        let dist_to_point = plane.distance_to_point_wide(self.origin.wide());

        if dist_to_point == 0.0 {
            return true;
        }

        let denominator = wide::dot(plane.normal.wide(), self.direction.wide());

        if denominator * dist_to_point < 0.0 {
            return true;
        }

        // ray origin is behind the plane (and is pointing behind it)

        false
    }

    fn intersect_box_wide(&self, b: &Box3) -> Option<W3> {
        let (mut tmin, mut tmax, tymin, tymax, tzmin, tzmax);

        let direction = self.direction.wide();
        let invdirx = 1.0 / direction[0];
        let invdiry = 1.0 / direction[1];
        let invdirz = 1.0 / direction[2];

        let origin = self.origin.wide();
        let (bmin, bmax) = (b.min.wide(), b.max.wide());

        if invdirx >= 0.0 {
            tmin = (bmin[0] - origin[0]) * invdirx;
            tmax = (bmax[0] - origin[0]) * invdirx;
        } else {
            tmin = (bmax[0] - origin[0]) * invdirx;
            tmax = (bmin[0] - origin[0]) * invdirx;
        }

        if invdiry >= 0.0 {
            tymin = (bmin[1] - origin[1]) * invdiry;
            tymax = (bmax[1] - origin[1]) * invdiry;
        } else {
            tymin = (bmax[1] - origin[1]) * invdiry;
            tymax = (bmin[1] - origin[1]) * invdiry;
        }

        if tmin > tymax || tymin > tmax {
            return None;
        }

        if tymin > tmin || tmin.is_nan() {
            tmin = tymin;
        }

        if tymax < tmax || tmax.is_nan() {
            tmax = tymax;
        }

        if invdirz >= 0.0 {
            tzmin = (bmin[2] - origin[2]) * invdirz;
            tzmax = (bmax[2] - origin[2]) * invdirz;
        } else {
            tzmin = (bmax[2] - origin[2]) * invdirz;
            tzmax = (bmin[2] - origin[2]) * invdirz;
        }

        if tmin > tzmax || tzmin > tmax {
            return None;
        }

        if tzmin > tmin || tmin.is_nan() {
            tmin = tzmin;
        }

        if tzmax < tmax || tmax.is_nan() {
            tmax = tzmax;
        }

        //return point closest to the ray (positive side)

        if tmax < 0.0 {
            return None;
        }

        Some(self.at_wide(if tmin >= 0.0 { tmin } else { tmax }))
    }

    pub fn intersect_box(&self, b: &Box3) -> Option<Vector3> {
        self.intersect_box_wide(b).map(Vector3::from_wide)
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        self.intersect_box_wide(b).is_some()
    }

    pub fn intersect_triangle(&self, a: &Vector3, b: &Vector3, c: &Vector3, backface_culling: bool) -> Option<Vector3> {
        // Watertight ray/triangle intersection. Reference: Woop, Benthin, Wald,
        // "Watertight Ray/Triangle Intersection", JCGT vol. 2 no. 1 (2013), Appendix A.
        // https://jcgt.org/published/0002/01/05/

        let origin = self.origin.wide();
        let [dx, dy, dz] = self.direction.wide();

        // triangle vertices relative to the ray origin
        let [aox, aoy, aoz] = wide::sub(a.wide(), origin);
        let [box_, boy, boz] = wide::sub(b.wide(), origin);
        let [cox, coy, coz] = wide::sub(c.wide(), origin);

        // Use the dimension where the ray direction is maximal as the projection
        // axis (kz) and read every component already permuted into (kx, ky, kz).
        // kx and ky are swapped when the direction's kz component is negative, to
        // preserve the winding order of triangles.
        let (adx, ady, adz) = (dx.abs(), dy.abs(), dz.abs());

        let (dkx, dky, dkz);
        let (akx, aky, akz, bkx, bky, bkz, ckx, cky, ckz);

        if adx >= ady && adx >= adz {
            dkz = dx; akz = aox; bkz = box_; ckz = cox;

            if dx >= 0.0 {
                dkx = dy; dky = dz;
                akx = aoy; aky = aoz; bkx = boy; bky = boz; ckx = coy; cky = coz;
            } else {
                dkx = dz; dky = dy;
                akx = aoz; aky = aoy; bkx = boz; bky = boy; ckx = coz; cky = coy;
            }
        } else if ady >= adz {
            dkz = dy; akz = aoy; bkz = boy; ckz = coy;

            if dy >= 0.0 {
                dkx = dz; dky = dx;
                akx = aoz; aky = aox; bkx = boz; bky = box_; ckx = coz; cky = cox;
            } else {
                dkx = dx; dky = dz;
                akx = aox; aky = aoz; bkx = box_; bky = boz; ckx = cox; cky = coz;
            }
        } else {
            dkz = dz; akz = aoz; bkz = boz; ckz = coz;

            if dz >= 0.0 {
                dkx = dx; dky = dy;
                akx = aox; aky = aoy; bkx = box_; bky = boy; ckx = cox; cky = coy;
            } else {
                dkx = dy; dky = dx;
                akx = aoy; aky = aox; bkx = boy; bky = box_; ckx = coy; cky = cox;
            }
        }

        // a zero direction has no maximal axis and cannot intersect
        if dkz == 0.0 {
            return None;
        }

        // shear constants that align the ray with the +kz axis
        let (sx, sy, sz) = (dkx / dkz, dky / dkz, 1.0 / dkz);

        // sheared and scaled vertices
        let (ax, ay) = (akx - sx * akz, aky - sy * akz);
        let (bx, by) = (bkx - sx * bkz, bky - sy * bkz);
        let (cx, cy) = (ckx - sx * ckz, cky - sy * ckz);

        // scaled barycentric coordinates (signed edge functions); the shear makes a
        // shared edge evaluate identically for both adjacent triangles, so the ray
        // can never fall between them
        let u = cx * by - cy * bx;
        let v = ax * cy - ay * cx;
        let w = bx * ay - by * ax;

        if backface_culling {
            if u < 0.0 || v < 0.0 || w < 0.0 {
                return None;
            }
        } else if (u < 0.0 || v < 0.0 || w < 0.0) && (u > 0.0 || v > 0.0 || w > 0.0) {
            return None;
        }

        let det = u + v + w;

        // ray is co-planar with the triangle
        if det == 0.0 {
            return None;
        }

        // scaled hit distance; t = tScaled / det must lie in front of the origin
        let t_scaled = sz * (u * akz + v * bkz + w * ckz);

        if if det > 0.0 { t_scaled < 0.0 } else { t_scaled > 0.0 } {
            return None;
        }

        Some(Vector3::from_wide(self.at_wide(t_scaled / det)))
    }

    pub fn apply_matrix4(&mut self, matrix4: &Matrix4) -> &mut Self {
        self.origin.apply_matrix4(matrix4);
        self.direction.transform_direction(matrix4);
        self
    }

    pub fn equals(&self, ray: &Ray) -> bool {
        ray.origin.equals(&self.origin) && ray.direction.equals(&self.direction)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn ray() -> Ray {
        Ray::new(v(0.0, 0.0, 5.0), v(0.0, 0.0, -1.0))
    }

    #[test]
    fn default_looks_down_negative_z() {
        assert_eq!(Ray::default(), Ray::new(v(0.0, 0.0, 0.0), v(0.0, 0.0, -1.0)));
    }

    #[test]
    fn set() {
        assert_eq!(*Ray::default().set(&v(0.0, 0.0, 5.0), &v(0.0, 0.0, -1.0)), ray());
    }

    #[test]
    fn copy() {
        assert_eq!(*Ray::default().copy(&ray()), ray());
    }

    #[test]
    fn at() {
        assert_eq!(ray().at(2.0), v(0.0, 0.0, 3.0));
    }

    #[test]
    fn look_at() {
        assert_eq!(ray().look_at(&v(3.0, 0.0, 5.0)).direction, v(1.0, 0.0, 0.0));
    }

    #[test]
    fn recast() {
        assert_eq!(*ray().recast(2.0), Ray::new(v(0.0, 0.0, 3.0), v(0.0, 0.0, -1.0)));
    }

    #[test]
    fn closest_point_to_point() {
        assert_eq!(ray().closest_point_to_point(&v(1.0, 1.0, 2.0)), v(0.0, 0.0, 2.0));
        // behind the origin: the origin
        assert_eq!(ray().closest_point_to_point(&v(1.0, 1.0, 9.0)), v(0.0, 0.0, 5.0));
    }

    #[test]
    fn distance_to_point() {
        assert_eq!(ray().distance_to_point(&v(3.0, 4.0, 0.0)), 5.0);
    }

    #[test]
    fn distance_sq_to_point() {
        assert_eq!(ray().distance_sq_to_point(&v(3.0, 4.0, 0.0)), 25.0);
        assert_eq!(ray().distance_sq_to_point(&v(0.0, 0.0, 7.0)), 4.0);
    }

    #[test]
    fn distance_sq_to_segment() {
        let (mut on_ray, mut on_segment) = (Vector3::default(), Vector3::default());
        let d = ray().distance_sq_to_segment(&v(2.0, -1.0, 0.0), &v(2.0, 1.0, 0.0), Some(&mut on_ray), Some(&mut on_segment));
        assert_eq!(d, 4.0);
        assert_eq!(on_ray, v(0.0, 0.0, 0.0));
        assert_eq!(on_segment, v(2.0, 0.0, 0.0));
        // parallel segment, no targets
        assert_eq!(ray().distance_sq_to_segment(&v(3.0, 0.0, 1.0), &v(3.0, 0.0, 2.0), None, None), 9.0);
    }

    #[test]
    fn intersect_sphere() {
        let s = Sphere::new(v(0.0, 0.0, 0.0), 1.0);
        assert_eq!(ray().intersect_sphere(&s), Some(v(0.0, 0.0, 1.0)));
        // from inside: the exit point
        assert_eq!(Ray::default().intersect_sphere(&s), Some(v(0.0, 0.0, -1.0)));
        // behind, missing, and empty spheres
        assert_eq!(ray().intersect_sphere(&Sphere::new(v(0.0, 0.0, 9.0), 1.0)), None);
        assert_eq!(ray().intersect_sphere(&Sphere::new(v(5.0, 0.0, 0.0), 1.0)), None);
        assert_eq!(ray().intersect_sphere(&Sphere::default()), None);
    }

    #[test]
    fn intersects_sphere() {
        assert!(ray().intersects_sphere(&Sphere::new(v(1.0, 0.0, 0.0), 1.0)));
        assert!(!ray().intersects_sphere(&Sphere::new(v(2.0, 0.0, 0.0), 1.0)));
        assert!(!ray().intersects_sphere(&Sphere::default()));
    }

    #[test]
    fn distance_to_plane() {
        let z1 = Plane::new(v(0.0, 0.0, 1.0), -1.0);
        assert_eq!(ray().distance_to_plane(&z1), Some(4.0));
        // plane behind the ray
        assert_eq!(ray().distance_to_plane(&Plane::new(v(0.0, 0.0, 1.0), -9.0)), None);
        // parallel: none, unless the origin lies on the plane
        assert_eq!(ray().distance_to_plane(&Plane::new(v(0.0, 1.0, 0.0), -1.0)), None);
        assert_eq!(ray().distance_to_plane(&Plane::new(v(0.0, 1.0, 0.0), 0.0)), Some(0.0));
    }

    #[test]
    fn intersect_plane() {
        assert_eq!(ray().intersect_plane(&Plane::new(v(0.0, 0.0, 1.0), -1.0)), Some(v(0.0, 0.0, 1.0)));
        assert_eq!(ray().intersect_plane(&Plane::new(v(0.0, 0.0, 1.0), -9.0)), None);
    }

    #[test]
    fn intersects_plane() {
        assert!(ray().intersects_plane(&Plane::new(v(0.0, 0.0, 1.0), -1.0)));
        assert!(!ray().intersects_plane(&Plane::new(v(0.0, 0.0, 1.0), -9.0)));
        assert!(ray().intersects_plane(&Plane::new(v(0.0, 1.0, 0.0), 0.0)));
    }

    #[test]
    fn intersect_box() {
        let b = Box3::new(v(-1.0, -1.0, -1.0), v(1.0, 1.0, 1.0));
        assert_eq!(ray().intersect_box(&b), Some(v(0.0, 0.0, 1.0)));
        // from inside: the exit point
        assert_eq!(Ray::default().intersect_box(&b), Some(v(0.0, 0.0, -1.0)));
        // box behind the ray, and a miss
        assert_eq!(Ray::new(v(0.0, 0.0, -5.0), v(0.0, 0.0, -1.0)).intersect_box(&b), None);
        assert_eq!(Ray::new(v(5.0, 0.0, 5.0), v(0.0, 0.0, -1.0)).intersect_box(&b), None);
    }

    #[test]
    fn intersects_box() {
        let b = Box3::new(v(-1.0, -1.0, -1.0), v(1.0, 1.0, 1.0));
        assert!(ray().intersects_box(&b));
        assert!(!Ray::new(v(5.0, 0.0, 5.0), v(0.0, 0.0, -1.0)).intersects_box(&b));
    }

    #[test]
    fn intersect_triangle() {
        // counter-clockwise seen from +Z: front face toward the ray
        let (a, b, c) = (v(-1.0, -1.0, 0.0), v(1.0, -1.0, 0.0), v(0.0, 1.0, 0.0));
        assert_eq!(ray().intersect_triangle(&a, &b, &c, true), Some(v(0.0, 0.0, 0.0)));
        // reversed winding is a back face: culled only when asked
        assert_eq!(ray().intersect_triangle(&a, &c, &b, true), None);
        assert_eq!(ray().intersect_triangle(&a, &c, &b, false), Some(v(0.0, 0.0, 0.0)));
        // miss, triangle behind the ray, zero direction
        assert_eq!(Ray::new(v(5.0, 0.0, 5.0), v(0.0, 0.0, -1.0)).intersect_triangle(&a, &b, &c, false), None);
        assert_eq!(Ray::new(v(0.0, 0.0, -5.0), v(0.0, 0.0, -1.0)).intersect_triangle(&a, &b, &c, false), None);
        assert_eq!(Ray::new(v(0.0, 0.0, 5.0), v(0.0, 0.0, 0.0)).intersect_triangle(&a, &b, &c, false), None);
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(1.0, 2.0, 3.0);
        assert_eq!(*ray().apply_matrix4(&m), Ray::new(v(1.0, 2.0, 8.0), v(0.0, 0.0, -1.0)));
    }

    #[test]
    fn equals() {
        assert!(ray().equals(&ray()));
        assert!(!ray().equals(&Ray::default()));
    }
}
