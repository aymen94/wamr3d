use crate::box3::Box3;
use crate::matrix4::Matrix4;
use crate::plane::Plane;
use crate::sphere::Sphere;
use crate::vector3::Vector3;
use crate::wide;
use crate::CoordinateSystem;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Frustum {
    pub planes: [Plane; 6],
}

impl Frustum {
    pub const fn new(p0: Plane, p1: Plane, p2: Plane, p3: Plane, p4: Plane, p5: Plane) -> Self {
        Self { planes: [p0, p1, p2, p3, p4, p5] }
    }

    pub fn set(&mut self, p0: &Plane, p1: &Plane, p2: &Plane, p3: &Plane, p4: &Plane, p5: &Plane) -> &mut Self {
        self.planes = [*p0, *p1, *p2, *p3, *p4, *p5];
        self
    }

    pub fn copy(&mut self, frustum: &Frustum) -> &mut Self {
        *self = *frustum;
        self
    }

    pub fn set_from_projection_matrix(
        &mut self,
        m: &Matrix4,
        coordinate_system: CoordinateSystem,
        reversed_depth: bool,
    ) -> &mut Self {
        let me = m.wide();
        let (me0, me1, me2, me3) = (me[0], me[1], me[2], me[3]);
        let (me4, me5, me6, me7) = (me[4], me[5], me[6], me[7]);
        let (me8, me9, me10, me11) = (me[8], me[9], me[10], me[11]);
        let (me12, me13, me14, me15) = (me[12], me[13], me[14], me[15]);

        // planes[ i ].setComponents( x, y, z, w ).normalize()
        let mut set = |i: usize, x: f64, y: f64, z: f64, w: f64| {
            let inverse_normal_length = 1.0 / wide::length([x, y, z]);
            self.planes[i].set_wide(wide::scale([x, y, z], inverse_normal_length), w * inverse_normal_length);
        };

        set(0, me3 - me0, me7 - me4, me11 - me8, me15 - me12);
        set(1, me3 + me0, me7 + me4, me11 + me8, me15 + me12);
        set(2, me3 + me1, me7 + me5, me11 + me9, me15 + me13);
        set(3, me3 - me1, me7 - me5, me11 - me9, me15 - me13);

        if reversed_depth {
            set(4, me2, me6, me10, me14); // far
            set(5, me3 - me2, me7 - me6, me11 - me10, me15 - me14); // near
        } else {
            set(4, me3 - me2, me7 - me6, me11 - me10, me15 - me14); // far

            match coordinate_system {
                CoordinateSystem::WebGL => set(5, me3 + me2, me7 + me6, me11 + me10, me15 + me14), // near
                CoordinateSystem::WebGPU => set(5, me2, me6, me10, me14),                          // near
            }
        }

        self
    }

    pub fn intersects_sphere(&self, sphere: &Sphere) -> bool {
        let center = sphere.center.wide();
        let neg_radius = -(sphere.radius as f64);

        for plane in &self.planes {
            let distance = plane.distance_to_point_wide(center);

            if distance < neg_radius {
                return false;
            }
        }

        true
    }

    pub fn intersects_box(&self, b: &Box3) -> bool {
        for plane in &self.planes {
            // corner at max distance

            let corner = Vector3::new(
                if plane.normal.x > 0.0 { b.max.x } else { b.min.x },
                if plane.normal.y > 0.0 { b.max.y } else { b.min.y },
                if plane.normal.z > 0.0 { b.max.z } else { b.min.z },
            );

            if plane.distance_to_point_wide(corner.wide()) < 0.0 {
                return false;
            }
        }

        true
    }

    pub fn contains_point(&self, point: &Vector3) -> bool {
        let point = point.wide();

        for plane in &self.planes {
            if plane.distance_to_point_wide(point) < 0.0 {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn frustum(cs: CoordinateSystem, reversed: bool) -> Frustum {
        let mut m = Matrix4::default();
        m.make_perspective(-1.0, 1.0, 1.0, -1.0, 1.0, 10.0, cs, reversed);
        let mut f = Frustum::default();
        f.set_from_projection_matrix(&m, cs, reversed);
        f
    }

    #[test]
    fn default_and_new() {
        let p = Plane::default();
        assert_eq!(Frustum::default(), Frustum::new(p, p, p, p, p, p));
    }

    #[test]
    fn set() {
        let p = Plane::new(v(0.0, 1.0, 0.0), 2.0);
        let mut f = Frustum::default();
        f.set(&p, &p, &p, &p, &p, &p);
        assert_eq!(f.planes, [p; 6]);
    }

    #[test]
    fn copy() {
        let src = frustum(CoordinateSystem::WebGL, false);
        assert_eq!(*Frustum::default().copy(&src), src);
    }

    #[test]
    fn set_from_projection_matrix_near_and_far_planes() {
        // every convention must describe the same volume: near plane z = -1, far plane z = -10
        for (cs, reversed) in [
            (CoordinateSystem::WebGL, false),
            (CoordinateSystem::WebGPU, false),
            (CoordinateSystem::WebGPU, true),
        ] {
            let f = frustum(cs, reversed);
            let (far, near) = (f.planes[4], f.planes[5]);
            assert_close(near.normal.z, -1.0);
            assert_close(near.constant, -1.0);
            assert_close(far.normal.z, 1.0);
            assert_close(far.constant, 10.0);
        }
    }

    #[test]
    fn contains_point() {
        for cs in [CoordinateSystem::WebGL, CoordinateSystem::WebGPU] {
            let f = frustum(cs, false);
            assert!(f.contains_point(&v(0.0, 0.0, -5.0)));
            assert!(!f.contains_point(&v(0.0, 0.0, -0.5))); // in front of near
            assert!(!f.contains_point(&v(0.0, 0.0, -11.0))); // beyond far
            assert!(!f.contains_point(&v(0.0, 0.0, 5.0))); // behind the camera
            assert!(!f.contains_point(&v(6.0, 0.0, -5.0))); // outside the right plane
        }
    }

    #[test]
    fn intersects_sphere() {
        let f = frustum(CoordinateSystem::WebGPU, false);
        assert!(f.intersects_sphere(&Sphere::new(v(0.0, 0.0, -5.0), 1.0)));
        assert!(f.intersects_sphere(&Sphere::new(v(0.0, 0.0, 0.0), 1.5))); // straddles near
        assert!(!f.intersects_sphere(&Sphere::new(v(0.0, 0.0, 5.0), 1.0)));
    }

    #[test]
    fn intersects_box() {
        let f = frustum(CoordinateSystem::WebGPU, false);
        assert!(f.intersects_box(&Box3::new(v(-1.0, -1.0, -6.0), v(1.0, 1.0, -4.0))));
        assert!(f.intersects_box(&Box3::new(v(-1.0, -1.0, -2.0), v(1.0, 1.0, 2.0)))); // straddles near
        assert!(!f.intersects_box(&Box3::new(v(-1.0, -1.0, 2.0), v(1.0, 1.0, 4.0))));
    }
}
