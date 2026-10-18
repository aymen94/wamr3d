use crate::matrix4::Matrix4;
use crate::plane::Plane;
use crate::sphere::Sphere;
use crate::triangle::Triangle;
use crate::vector3::Vector3;
use crate::wide::{self, W3};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Box3 {
    pub min: Vector3,
    pub max: Vector3,
}

impl Default for Box3 {
    fn default() -> Self {
        Self {
            min: Vector3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY),
            max: Vector3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY),
        }
    }
}

fn sat_for_axes(axes: &[f64], v0: W3, v1: W3, v2: W3, extents: W3) -> bool {
    for axis in axes.chunks_exact(3) {
        let test_axis = [axis[0], axis[1], axis[2]];
        // project the aabb onto the separating axis
        let r = extents[0] * test_axis[0].abs() + extents[1] * test_axis[1].abs() + extents[2] * test_axis[2].abs();
        // project all 3 vertices of the triangle onto the separating axis
        let p0 = wide::dot(v0, test_axis);
        let p1 = wide::dot(v1, test_axis);
        let p2 = wide::dot(v2, test_axis);
        // actual test, basically see if either of the most extreme of the triangle points intersects r
        if wide::max(-wide::max(wide::max(p0, p1), p2), wide::min(wide::min(p0, p1), p2)) > r {
            // points of the projected triangle are outside the projected half-length of the aabb
            // the axis is separating and we can exit
            return false;
        }
    }

    true
}

impl Box3 {
    pub const fn new(min: Vector3, max: Vector3) -> Self {
        Self { min, max }
    }

    pub fn set(&mut self, min: &Vector3, max: &Vector3) -> &mut Self {
        self.min = *min;
        self.max = *max;
        self
    }

    pub fn set_from_array(&mut self, array: &[f32]) -> &mut Self {
        self.make_empty();

        for p in array.chunks_exact(3) {
            self.expand_by_point(&Vector3::new(p[0], p[1], p[2]));
        }

        self
    }

    pub fn set_from_points(&mut self, points: &[Vector3]) -> &mut Self {
        self.make_empty();

        for p in points {
            self.expand_by_point(p);
        }

        self
    }

    pub fn set_from_center_and_size(&mut self, center: &Vector3, size: &Vector3) -> &mut Self {
        let half_size = wide::scale(size.wide(), 0.5);

        self.min.set_wide(wide::sub(center.wide(), half_size));
        self.max.set_wide(wide::add(center.wide(), half_size));

        self
    }

    pub fn copy(&mut self, b: &Box3) -> &mut Self {
        *self = *b;
        self
    }

    pub fn make_empty(&mut self) -> &mut Self {
        *self = Self::default();
        self
    }

    pub fn is_empty(&self) -> bool {
        // this is a more robust check for empty than ( volume <= 0 ) because volume can get positive with two negative axes

        self.max.x < self.min.x || self.max.y < self.min.y || self.max.z < self.min.z
    }

    fn center_wide(&self) -> W3 {
        if self.is_empty() {
            [0.0; 3]
        } else {
            wide::scale(wide::add(self.min.wide(), self.max.wide()), 0.5)
        }
    }

    pub fn get_center(&self) -> Vector3 {
        Vector3::from_wide(self.center_wide())
    }

    pub fn get_size(&self) -> Vector3 {
        if self.is_empty() {
            Vector3::default()
        } else {
            let mut target = Vector3::default();
            target.sub_vectors(&self.max, &self.min);
            target
        }
    }

    pub fn expand_by_point(&mut self, point: &Vector3) -> &mut Self {
        self.min.min(point);
        self.max.max(point);
        self
    }

    pub fn expand_by_vector(&mut self, vector: &Vector3) -> &mut Self {
        self.min.sub(vector);
        self.max.add(vector);
        self
    }

    pub fn expand_by_scalar(&mut self, scalar: f32) -> &mut Self {
        self.min.add_scalar(-scalar);
        self.max.add_scalar(scalar);
        self
    }

    pub fn contains_point(&self, point: &Vector3) -> bool {
        point.x >= self.min.x
            && point.x <= self.max.x
            && point.y >= self.min.y
            && point.y <= self.max.y
            && point.z >= self.min.z
            && point.z <= self.max.z
    }

    pub fn contains_box(&self, b: &Box3) -> bool {
        self.min.x <= b.min.x
            && b.max.x <= self.max.x
            && self.min.y <= b.min.y
            && b.max.y <= self.max.y
            && self.min.z <= b.min.z
            && b.max.z <= self.max.z
    }

    pub fn get_parameter(&self, point: &Vector3) -> Vector3 {
        let (p, min, max) = (point.wide(), self.min.wide(), self.max.wide());

        Vector3::from_wide([
            (p[0] - min[0]) / (max[0] - min[0]),
            (p[1] - min[1]) / (max[1] - min[1]),
            (p[2] - min[2]) / (max[2] - min[2]),
        ])
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        // using 6 splitting planes to rule out intersections.
        b.max.x >= self.min.x
            && b.min.x <= self.max.x
            && b.max.y >= self.min.y
            && b.min.y <= self.max.y
            && b.max.z >= self.min.z
            && b.min.z <= self.max.z
    }

    pub fn intersects_sphere(&self, sphere: &Sphere) -> bool {
        // Find the point on the AABB closest to the sphere center.
        let closest = self.clamp_point(&sphere.center);
        let radius = sphere.radius as f64;

        // If that point is inside the sphere, the AABB and sphere intersect.
        wide::distance_sq(closest.wide(), sphere.center.wide()) <= radius * radius
    }

    pub fn intersects_plane(&self, plane: &Plane) -> bool {
        // We compute the minimum and maximum dot product values. If those values
        // are on the same side (back or front) of the plane, then there is no intersection.

        let (n, bmin, bmax) = (plane.normal.wide(), self.min.wide(), self.max.wide());
        let (mut min, mut max);

        if n[0] > 0.0 {
            min = n[0] * bmin[0];
            max = n[0] * bmax[0];
        } else {
            min = n[0] * bmax[0];
            max = n[0] * bmin[0];
        }

        if n[1] > 0.0 {
            min += n[1] * bmin[1];
            max += n[1] * bmax[1];
        } else {
            min += n[1] * bmax[1];
            max += n[1] * bmin[1];
        }

        if n[2] > 0.0 {
            min += n[2] * bmin[2];
            max += n[2] * bmax[2];
        } else {
            min += n[2] * bmax[2];
            max += n[2] * bmin[2];
        }

        let constant = plane.constant as f64;

        min <= -constant && max >= -constant
    }

    pub fn intersects_triangle(&self, triangle: &Triangle) -> bool {
        if self.is_empty() {
            return false;
        }

        // compute box center and extents
        let center = self.center_wide();
        let extents = wide::sub(self.max.wide(), center);

        // translate triangle to aabb origin
        let v0 = wide::sub(triangle.a.wide(), center);
        let v1 = wide::sub(triangle.b.wide(), center);
        let v2 = wide::sub(triangle.c.wide(), center);

        // compute edge vectors for triangle
        let f0 = wide::sub(v1, v0);
        let f1 = wide::sub(v2, v1);
        let f2 = wide::sub(v0, v2);

        // test against axes that are given by cross product combinations of the edges of the triangle and the edges of the aabb
        // make an axis testing of each of the 3 sides of the aabb against each of the 3 sides of the triangle = 9 axis of separation
        // axis_ij = u_i x f_j (u0, u1, u2 = face normals of aabb = x,y,z axes vectors since aabb is axis aligned)
        let axes = [
            0.0, -f0[2], f0[1], 0.0, -f1[2], f1[1], 0.0, -f2[2], f2[1],
            f0[2], 0.0, -f0[0], f1[2], 0.0, -f1[0], f2[2], 0.0, -f2[0],
            -f0[1], f0[0], 0.0, -f1[1], f1[0], 0.0, -f2[1], f2[0], 0.0,
        ];
        if !sat_for_axes(&axes, v0, v1, v2, extents) {
            return false;
        }

        // test 3 face normals from the aabb
        let axes = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        if !sat_for_axes(&axes, v0, v1, v2, extents) {
            return false;
        }

        // finally testing the face normal of the triangle
        // use already existing triangle edge vectors here
        let triangle_normal = wide::cross(f0, f1);

        sat_for_axes(&triangle_normal, v0, v1, v2, extents)
    }

    pub fn clamp_point(&self, point: &Vector3) -> Vector3 {
        let mut target = *point;
        target.clamp(&self.min, &self.max);
        target
    }

    pub fn distance_to_point(&self, point: &Vector3) -> f32 {
        self.clamp_point(point).distance_to(point)
    }

    pub fn get_bounding_sphere(&self) -> Sphere {
        let mut target = Sphere::default();

        if !self.is_empty() {
            target.center = self.get_center();
            target.radius = (wide::length(wide::sub(self.max.wide(), self.min.wide())) * 0.5) as f32;
        }

        target
    }

    pub fn intersect(&mut self, b: &Box3) -> &mut Self {
        self.min.max(&b.min);
        self.max.min(&b.max);

        // ensure that if there is no overlap, the result is fully empty, not slightly empty with non-inf/+inf values that will cause subsequence intersects to erroneously return valid values.
        if self.is_empty() {
            self.make_empty();
        }

        self
    }

    pub fn union(&mut self, b: &Box3) -> &mut Self {
        self.min.min(&b.min);
        self.max.max(&b.max);
        self
    }

    pub fn apply_matrix4(&mut self, matrix: &Matrix4) -> &mut Self {
        // transform of empty box is an empty box.
        if self.is_empty() {
            return self;
        }

        let (min, max) = (self.min, self.max);

        // NOTE: I am using a binary pattern to specify all 2^3 combinations below
        let mut points = [
            Vector3::new(min.x, min.y, min.z), // 000
            Vector3::new(min.x, min.y, max.z), // 001
            Vector3::new(min.x, max.y, min.z), // 010
            Vector3::new(min.x, max.y, max.z), // 011
            Vector3::new(max.x, min.y, min.z), // 100
            Vector3::new(max.x, min.y, max.z), // 101
            Vector3::new(max.x, max.y, min.z), // 110
            Vector3::new(max.x, max.y, max.z), // 111
        ];

        for p in &mut points {
            p.apply_matrix4(matrix);
        }

        self.set_from_points(&points)
    }

    pub fn translate(&mut self, offset: &Vector3) -> &mut Self {
        self.min.add(offset);
        self.max.add(offset);
        self
    }

    pub fn equals(&self, b: &Box3) -> bool {
        b.min.equals(&self.min) && b.max.equals(&self.max)
    }
}

#[cfg(test)]
mod tests;
