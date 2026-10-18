use super::*;

fn v(x: f32, y: f32, z: f32) -> Vector3 {
    Vector3::new(x, y, z)
}

fn unit() -> Box3 {
    Box3::new(v(-1.0, -1.0, -1.0), v(1.0, 1.0, 1.0))
}

#[test]
fn default_is_empty() {
    assert!(Box3::default().is_empty());
    assert_eq!(Box3::default().min.x, f32::INFINITY);
}

#[test]
fn set() {
    assert_eq!(*Box3::default().set(&v(-1.0, -1.0, -1.0), &v(1.0, 1.0, 1.0)), unit());
}

#[test]
fn set_from_array() {
    let mut b = Box3::default();
    b.set_from_array(&[1.0, 5.0, -3.0, -2.0, 0.0, 4.0]);
    assert_eq!(b, Box3::new(v(-2.0, 0.0, -3.0), v(1.0, 5.0, 4.0)));
    assert!(b.set_from_array(&[]).is_empty());
}

#[test]
fn set_from_points() {
    let mut b = Box3::default();
    b.set_from_points(&[v(1.0, 5.0, -3.0), v(-2.0, 0.0, 4.0)]);
    assert_eq!(b, Box3::new(v(-2.0, 0.0, -3.0), v(1.0, 5.0, 4.0)));
}

#[test]
fn set_from_center_and_size() {
    let mut b = Box3::default();
    b.set_from_center_and_size(&v(1.0, 2.0, 3.0), &v(2.0, 4.0, 6.0));
    assert_eq!(b, Box3::new(v(0.0, 0.0, 0.0), v(2.0, 4.0, 6.0)));
}

#[test]
fn copy() {
    assert_eq!(*Box3::default().copy(&unit()), unit());
}

#[test]
fn make_empty_and_is_empty() {
    let mut b = unit();
    assert!(!b.is_empty());
    assert!(b.make_empty().is_empty());
    // a single point is not empty
    assert!(!Box3::new(v(1.0, 1.0, 1.0), v(1.0, 1.0, 1.0)).is_empty());
}

#[test]
fn get_center() {
    assert_eq!(Box3::new(v(0.0, 0.0, 0.0), v(2.0, 4.0, 6.0)).get_center(), v(1.0, 2.0, 3.0));
    assert_eq!(Box3::default().get_center(), v(0.0, 0.0, 0.0));
}

#[test]
fn get_size() {
    assert_eq!(Box3::new(v(0.0, 0.0, 0.0), v(2.0, 4.0, 6.0)).get_size(), v(2.0, 4.0, 6.0));
    assert_eq!(Box3::default().get_size(), v(0.0, 0.0, 0.0));
}

#[test]
fn expand_by_point() {
    assert_eq!(*unit().expand_by_point(&v(3.0, 0.0, -2.0)), Box3::new(v(-1.0, -1.0, -2.0), v(3.0, 1.0, 1.0)));
}

#[test]
fn expand_by_vector() {
    assert_eq!(*unit().expand_by_vector(&v(1.0, 2.0, 3.0)), Box3::new(v(-2.0, -3.0, -4.0), v(2.0, 3.0, 4.0)));
}

#[test]
fn expand_by_scalar() {
    assert_eq!(*unit().expand_by_scalar(1.0), Box3::new(v(-2.0, -2.0, -2.0), v(2.0, 2.0, 2.0)));
}

#[test]
fn contains_point() {
    assert!(unit().contains_point(&v(1.0, 0.0, -1.0)));
    assert!(!unit().contains_point(&v(1.5, 0.0, 0.0)));
}

#[test]
fn contains_box() {
    assert!(unit().contains_box(&Box3::new(v(0.0, 0.0, 0.0), v(1.0, 1.0, 1.0))));
    assert!(!unit().contains_box(&Box3::new(v(0.0, 0.0, 0.0), v(2.0, 1.0, 1.0))));
}

#[test]
fn get_parameter() {
    assert_eq!(unit().get_parameter(&v(0.0, 1.0, -1.0)), v(0.5, 1.0, 0.0));
}

#[test]
fn intersects_box() {
    assert!(unit().intersects_box(&Box3::new(v(1.0, 1.0, 1.0), v(2.0, 2.0, 2.0))));
    assert!(!unit().intersects_box(&Box3::new(v(1.5, 1.5, 1.5), v(2.0, 2.0, 2.0))));
}

#[test]
fn intersects_sphere() {
    assert!(unit().intersects_sphere(&Sphere::new(v(2.0, 0.0, 0.0), 1.0)));
    assert!(!unit().intersects_sphere(&Sphere::new(v(2.5, 0.0, 0.0), 1.0)));
}

#[test]
fn intersects_plane() {
    assert!(unit().intersects_plane(&Plane::new(v(0.0, 1.0, 0.0), 0.5)));
    assert!(!unit().intersects_plane(&Plane::new(v(0.0, 1.0, 0.0), 2.0)));
}

#[test]
fn intersects_triangle() {
    let inside = Triangle::new(v(0.0, 0.0, 0.0), v(0.5, 0.0, 0.0), v(0.0, 0.5, 0.0));
    let outside = Triangle::new(v(3.0, 0.0, 0.0), v(4.0, 0.0, 0.0), v(3.0, 1.0, 0.0));
    // large triangle that cuts through the box without a vertex inside
    let through = Triangle::new(v(-5.0, -5.0, 0.0), v(5.0, -5.0, 0.0), v(0.0, 5.0, 0.0));
    assert!(unit().intersects_triangle(&inside));
    assert!(!unit().intersects_triangle(&outside));
    assert!(unit().intersects_triangle(&through));
    assert!(!Box3::default().intersects_triangle(&inside));
}

#[test]
fn clamp_point() {
    assert_eq!(unit().clamp_point(&v(3.0, 0.5, -3.0)), v(1.0, 0.5, -1.0));
}

#[test]
fn distance_to_point() {
    assert_eq!(unit().distance_to_point(&v(4.0, 5.0, 0.0)), 5.0);
    assert_eq!(unit().distance_to_point(&v(0.0, 0.0, 0.0)), 0.0);
}

#[test]
fn get_bounding_sphere() {
    let s = Box3::new(v(0.0, 0.0, 0.0), v(2.0, 0.0, 0.0)).get_bounding_sphere();
    assert_eq!(s, Sphere::new(v(1.0, 0.0, 0.0), 1.0));
    assert!(Box3::default().get_bounding_sphere().is_empty());
}

#[test]
fn intersect() {
    let mut b = unit();
    b.intersect(&Box3::new(v(0.0, 0.0, 0.0), v(2.0, 2.0, 2.0)));
    assert_eq!(b, Box3::new(v(0.0, 0.0, 0.0), v(1.0, 1.0, 1.0)));
    // no overlap: fully empty
    b.intersect(&Box3::new(v(5.0, 5.0, 5.0), v(6.0, 6.0, 6.0)));
    assert_eq!(b, Box3::default());
}

#[test]
fn union() {
    let mut b = unit();
    b.union(&Box3::new(v(0.0, 0.0, 0.0), v(2.0, 3.0, 4.0)));
    assert_eq!(b, Box3::new(v(-1.0, -1.0, -1.0), v(2.0, 3.0, 4.0)));
}

#[test]
fn apply_matrix4() {
    let mut m = Matrix4::default();
    m.make_translation(1.0, 2.0, 3.0);
    assert_eq!(*unit().apply_matrix4(&m), Box3::new(v(0.0, 1.0, 2.0), v(2.0, 3.0, 4.0)));
    // a mirrored box stays well formed
    m.make_scale(-2.0, 1.0, 1.0);
    assert_eq!(*unit().apply_matrix4(&m), Box3::new(v(-2.0, -1.0, -1.0), v(2.0, 1.0, 1.0)));
    assert!(Box3::default().apply_matrix4(&m).is_empty());
}

#[test]
fn translate() {
    assert_eq!(*unit().translate(&v(1.0, 2.0, 3.0)), Box3::new(v(0.0, 1.0, 2.0), v(2.0, 3.0, 4.0)));
}

#[test]
fn equals() {
    assert!(unit().equals(&unit()));
    assert!(!unit().equals(&Box3::default()));
}
