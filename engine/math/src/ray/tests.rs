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
