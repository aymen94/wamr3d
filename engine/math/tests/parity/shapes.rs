//! The fixtures of the bounding volumes, rays, planes and coordinates.

use super::*;

#[rustfmt::skip]
pub(crate) fn run_shapes(op: &str, r: &mut In, o: &mut Out) -> bool {
    match op {
        // ---- Box3
        "Box3.setFromArray" => { let flat: Vec<f32> = r.pts().iter().flat_map(|p| p.to_array()).collect(); o.bx(Box3::default().set_from_array(&flat)) }
        "Box3.setFromPoints" => o.bx(Box3::default().set_from_points(&r.pts())),
        "Box3.setFromCenterAndSize" => { let (c, s) = (r.v3(), r.v3()); o.bx(Box3::default().set_from_center_and_size(&c, &s)) }
        "Box3.isEmpty" => o.b(r.bx().is_empty()),
        "Box3.getCenter" => o.v3(&r.bx().get_center()),
        "Box3.getSize" => o.v3(&r.bx().get_size()),
        "Box3.expandByPoint" => { let mut b = r.bx(); o.bx(b.expand_by_point(&r.v3())) }
        "Box3.expandByVector" => { let mut b = r.bx(); o.bx(b.expand_by_vector(&r.v3())) }
        "Box3.expandByScalar" => { let mut b = r.bx(); o.bx(b.expand_by_scalar(r.s())) }
        "Box3.containsPoint" => { let b = r.bx(); o.b(b.contains_point(&r.v3())) }
        "Box3.containsBox" => { let b = r.bx(); o.b(b.contains_box(&r.bx())) }
        "Box3.getParameter" => { let b = r.bx(); o.v3(&b.get_parameter(&r.v3())) }
        "Box3.intersectsBox" => { let b = r.bx(); o.b(b.intersects_box(&r.bx())) }
        "Box3.intersectsSphere" => { let b = r.bx(); o.b(b.intersects_sphere(&r.sph())) }
        "Box3.intersectsPlane" => { let b = r.bx(); o.b(b.intersects_plane(&r.pl())) }
        "Box3.intersectsTriangle" => { let b = r.bx(); o.b(b.intersects_triangle(&r.tri())) }
        "Box3.clampPoint" => { let b = r.bx(); o.v3(&b.clamp_point(&r.v3())) }
        "Box3.distanceToPoint" => { let b = r.bx(); o.s(b.distance_to_point(&r.v3())) }
        "Box3.getBoundingSphere" => o.sph(&r.bx().get_bounding_sphere()),
        "Box3.intersect" => { let mut b = r.bx(); o.bx(b.intersect(&r.bx())) }
        "Box3.union" => { let mut b = r.bx(); o.bx(b.union(&r.bx())) }
        "Box3.applyMatrix4" | "Box3.applyMatrix4.trs" => { let mut b = r.bx(); o.bx(b.apply_matrix4(&r.m4())) }
        "Box3.translate" => { let mut b = r.bx(); o.bx(b.translate(&r.v3())) }
        "Box3.equals" => { let b = r.bx(); o.b(b.equals(&r.bx())) }

        // ---- Sphere
        "Sphere.setFromPoints" => o.sph(Sphere::default().set_from_points(&r.pts(), None)),
        "Sphere.setFromPoints.center" => { let p = r.pts(); o.sph(Sphere::default().set_from_points(&p, Some(&r.v3()))) }
        "Sphere.isEmpty" => o.b(r.sph().is_empty()),
        "Sphere.containsPoint" => { let s = r.sph(); o.b(s.contains_point(&r.v3())) }
        "Sphere.distanceToPoint" => { let s = r.sph(); o.s(s.distance_to_point(&r.v3())) }
        "Sphere.intersectsSphere" => { let s = r.sph(); o.b(s.intersects_sphere(&r.sph())) }
        "Sphere.intersectsBox" => { let s = r.sph(); o.b(s.intersects_box(&r.bx())) }
        "Sphere.intersectsPlane" => { let s = r.sph(); o.b(s.intersects_plane(&r.pl())) }
        "Sphere.clampPoint" => { let s = r.sph(); o.v3(&s.clamp_point(&r.v3())) }
        "Sphere.getBoundingBox" => o.bx(&r.sph().get_bounding_box()),
        "Sphere.applyMatrix4" => { let mut s = r.sph(); o.sph(s.apply_matrix4(&r.m4())) }
        "Sphere.translate" => { let mut s = r.sph(); o.sph(s.translate(&r.v3())) }
        "Sphere.expandByPoint" => { let mut s = r.sph(); o.sph(s.expand_by_point(&r.v3())) }
        "Sphere.union" => { let mut s = r.sph(); o.sph(s.union(&r.sph())) }
        "Sphere.equals" => { let s = r.sph(); o.b(s.equals(&r.sph())) }

        // ---- Plane
        "Plane.setComponents" => { let (x, y, z, w) = (r.s(), r.s(), r.s(), r.s()); o.pl(Plane::default().set_components(x, y, z, w)) }
        "Plane.setFromNormalAndCoplanarPoint" => { let (n, p) = (r.v3(), r.v3()); o.pl(Plane::default().set_from_normal_and_coplanar_point(&n, &p)) }
        "Plane.setFromCoplanarPoints" => { let t = r.tri(); o.pl(Plane::default().set_from_coplanar_points(&t.a, &t.b, &t.c)) }
        "Plane.normalize" | "Plane.normalize.any" => o.pl(r.pl().normalize()),
        "Plane.negate" => o.pl(r.pl().negate()),
        "Plane.distanceToPoint" => { let p = r.pl(); o.s(p.distance_to_point(&r.v3())) }
        "Plane.distanceToSphere" => { let p = r.pl(); o.s(p.distance_to_sphere(&r.sph())) }
        "Plane.projectPoint" => { let p = r.pl(); o.v3(&p.project_point(&r.v3())) }
        "Plane.intersectLine" => { let p = r.pl(); let l = r.line(); o.opt_v3(p.intersect_line(&l, r.b())) }
        "Plane.intersectsLine" => { let p = r.pl(); o.b(p.intersects_line(&r.line())) }
        "Plane.intersectsBox" => { let p = r.pl(); o.b(p.intersects_box(&r.bx())) }
        "Plane.intersectsSphere" => { let p = r.pl(); o.b(p.intersects_sphere(&r.sph())) }
        "Plane.coplanarPoint" => o.v3(&r.pl().coplanar_point()),
        "Plane.applyMatrix4" => { let mut p = r.pl(); o.pl(p.apply_matrix4(&r.m4(), None)) }
        "Plane.applyMatrix4.normalMatrix" => { let mut p = r.pl(); let m = r.m4(); o.pl(p.apply_matrix4(&m, Some(&r.m3()))) }
        "Plane.translate" => { let mut p = r.pl(); o.pl(p.translate(&r.v3())) }
        "Plane.equals" => { let p = r.pl(); o.b(p.equals(&r.pl())) }

        // ---- Ray
        "Ray.at" => { let ray = r.ray(); o.v3(&ray.at(r.s())) }
        "Ray.lookAt" => { let mut ray = r.ray(); o.ray(ray.look_at(&r.v3())) }
        "Ray.recast" => { let mut ray = r.ray(); o.ray(ray.recast(r.s())) }
        "Ray.closestPointToPoint" => { let ray = r.ray(); o.v3(&ray.closest_point_to_point(&r.v3())) }
        "Ray.distanceToPoint" => { let ray = r.ray(); o.s(ray.distance_to_point(&r.v3())) }
        "Ray.distanceSqToPoint" => { let ray = r.ray(); o.s(ray.distance_sq_to_point(&r.v3())) }
        "Ray.distanceSqToSegment" => {
            let (ray, l) = (r.ray(), r.line());
            let (mut a, mut b) = (Vector3::default(), Vector3::default());
            o.s(ray.distance_sq_to_segment(&l.start, &l.end, Some(&mut a), Some(&mut b)));
            o.v3(&a); o.v3(&b)
        }
        "Ray.intersectSphere" => { let ray = r.ray(); o.opt_v3(ray.intersect_sphere(&r.sph())) }
        "Ray.intersectsSphere" => { let ray = r.ray(); o.b(ray.intersects_sphere(&r.sph())) }
        "Ray.distanceToPlane" => {
            let ray = r.ray();
            match ray.distance_to_plane(&r.pl()) {
                None => o.d(0.0),
                Some(t) => { o.d(1.0); o.s(t) }
            }
        }
        "Ray.intersectPlane" => { let ray = r.ray(); o.opt_v3(ray.intersect_plane(&r.pl())) }
        "Ray.intersectsPlane" => { let ray = r.ray(); o.b(ray.intersects_plane(&r.pl())) }
        "Ray.intersectBox" => { let ray = r.ray(); o.opt_v3(ray.intersect_box(&r.bx())) }
        "Ray.intersectsBox" => { let ray = r.ray(); o.b(ray.intersects_box(&r.bx())) }
        "Ray.intersectTriangle" => { let (ray, t) = (r.ray(), r.tri()); o.opt_v3(ray.intersect_triangle(&t.a, &t.b, &t.c, r.b())) }
        "Ray.applyMatrix4" => { let mut ray = r.ray(); o.ray(ray.apply_matrix4(&r.m4())) }
        "Ray.equals" => { let ray = r.ray(); o.b(ray.equals(&r.ray())) }

        // ---- Frustum
        "Frustum.setFromProjectionMatrix" | "Frustum.setFromProjectionMatrix.viewProj" => {
            let m = r.m4();
            let (cs, rev) = (r.cs(), r.b());
            o.fr(Frustum::default().set_from_projection_matrix(&m, cs, rev))
        }
        "Frustum.intersectsSphere" => { let f = r.fr(); o.b(f.intersects_sphere(&r.sph())) }
        "Frustum.intersectsBox" => { let f = r.fr(); o.b(f.intersects_box(&r.bx())) }
        "Frustum.containsPoint" => { let f = r.fr(); o.b(f.contains_point(&r.v3())) }

        // ---- Triangle
        "Triangle.getNormal.static" => { let t = r.tri(); o.v3(&Triangle::get_normal_abc(&t.a, &t.b, &t.c)) }
        "Triangle.getBarycoord.static" => { let (p, t) = (r.v3(), r.tri()); o.opt_v3(Triangle::get_barycoord_abc(&p, &t.a, &t.b, &t.c)) }
        "Triangle.containsPoint.static" => { let (p, t) = (r.v3(), r.tri()); o.b(Triangle::contains_point_abc(&p, &t.a, &t.b, &t.c)) }
        "Triangle.getInterpolation.static" => {
            let (p, t, a, b, c) = (r.v3(), r.tri(), r.v3(), r.v3(), r.v3());
            o.opt_v3(Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &a, &b, &c))
        }
        "Triangle.getInterpolation.static.v2" => {
            let (p, t, a, b, c) = (r.v3(), r.tri(), r.v2(), r.v2(), r.v2());
            match Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &a, &b, &c) {
                None => o.d(0.0),
                Some(v) => { o.d(1.0); o.v2(&v) }
            }
        }
        "Triangle.getInterpolation.static.v4" => {
            let (p, t, a, b, c) = (r.v3(), r.tri(), r.v4(), r.v4(), r.v4());
            match Triangle::get_interpolation_abc(&p, &t.a, &t.b, &t.c, &a, &b, &c) {
                None => o.d(0.0),
                Some(v) => { o.d(1.0); o.v4(&v) }
            }
        }
        "Triangle.isFrontFacing.static" => { let (t, d) = (r.tri(), r.v3()); o.b(Triangle::is_front_facing_abc(&t.a, &t.b, &t.c, &d)) }
        "Triangle.setFromPointsAndIndices" => {
            let p = r.pts();
            let i = r.u();
            o.tri(Triangle::default().set_from_points_and_indices(&p, i % p.len(), (i + 1) % p.len(), (i + 2) % p.len()))
        }
        "Triangle.getArea" => o.s(r.tri().get_area()),
        "Triangle.getMidpoint" => o.v3(&r.tri().get_midpoint()),
        "Triangle.getNormal" => o.v3(&r.tri().get_normal()),
        "Triangle.getPlane" => o.pl(&r.tri().get_plane()),
        "Triangle.getBarycoord" => { let t = r.tri(); o.opt_v3(t.get_barycoord(&r.v3())) }
        "Triangle.getInterpolation" => {
            let (t, p, a, b, c) = (r.tri(), r.v3(), r.v3(), r.v3(), r.v3());
            o.opt_v3(t.get_interpolation(&p, &a, &b, &c))
        }
        "Triangle.containsPoint" | "Triangle.containsPoint.inside" => { let t = r.tri(); o.b(t.contains_point(&r.v3())) }
        "Triangle.isFrontFacing" => { let t = r.tri(); o.b(t.is_front_facing(&r.v3())) }
        "Triangle.intersectsBox" => { let t = r.tri(); o.b(t.intersects_box(&r.bx())) }
        "Triangle.closestPointToPoint" => { let t = r.tri(); o.v3(&t.closest_point_to_point(&r.v3())) }
        "Triangle.equals" => { let t = r.tri(); o.b(t.equals(&r.tri())) }

        // ---- Line3
        "Line3.getCenter" => o.v3(&r.line().get_center()),
        "Line3.delta" => o.v3(&r.line().delta()),
        "Line3.distanceSq" => o.s(r.line().distance_sq()),
        "Line3.distance" => o.s(r.line().distance()),
        "Line3.at" => { let l = r.line(); o.v3(&l.at(r.s())) }
        "Line3.closestPointToPointParameter" => { let (l, p) = (r.line(), r.v3()); o.s(l.closest_point_to_point_parameter(&p, r.b())) }
        "Line3.closestPointToPoint" => { let (l, p) = (r.line(), r.v3()); o.v3(&l.closest_point_to_point(&p, r.b())) }
        "Line3.distanceSqToLine3" => {
            let (a, b) = (r.line(), r.line());
            let (mut c1, mut c2) = (Vector3::default(), Vector3::default());
            o.s(a.distance_sq_to_line3(&b, Some(&mut c1), Some(&mut c2)));
            o.v3(&c1); o.v3(&c2)
        }
        "Line3.applyMatrix4" => { let mut l = r.line(); o.line(l.apply_matrix4(&r.m4())) }
        "Line3.equals" => { let l = r.line(); o.b(l.equals(&r.line())) }

        // ---- Spherical / Cylindrical
        "Spherical.makeSafe" => o.sphl(r.sphl().make_safe()),
        "Spherical.setFromVector3" => o.sphl(Spherical::default().set_from_vector3(&r.v3())),
        "Spherical.setFromCartesianCoords" => { let (x, y, z) = (r.s(), r.s(), r.s()); o.sphl(Spherical::default().set_from_cartesian_coords(x, y, z)) }
        "Cylindrical.setFromVector3" => o.cyl(Cylindrical::default().set_from_vector3(&r.v3())),
        "Cylindrical.setFromCartesianCoords" => { let (x, y, z) = (r.s(), r.s(), r.s()); o.cyl(Cylindrical::default().set_from_cartesian_coords(x, y, z)) }
        _ => return false,
    }

    true
}
