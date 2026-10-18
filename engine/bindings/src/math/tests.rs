use super::*;

#[test]
fn random_helpers_reach_the_math_crate() {
    set_random_seed(0, 9);
    let first = (rand_int(1.0, 6.0), rand_float(0.0, 1.0), rand_float_spread(2.0), generate_uuid());
    set_random_seed(0, 9);
    assert_eq!(first, (rand_int(1.0, 6.0), rand_float(0.0, 1.0), rand_float_spread(2.0), generate_uuid()));
    assert!((1.0..=6.0).contains(&first.0));
}

#[test]
fn line3_triangle_and_coordinate_classes_reach_the_math_crate() {
    let line = Line3::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(2.0, 0.0, 0.0));
    assert_eq!((line.distance(), line.get_center().x()), (2.0, 1.0));
    assert_eq!(line.closest_point_to_point_parameter(&Vector3::new(3.0, 1.0, 0.0), true), 1.0);

    let triangle = Triangle::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(1.0, 0.0, 0.0), &Vector3::new(0.0, 1.0, 0.0));
    assert_eq!((triangle.get_area(), triangle.get_normal().z()), (0.5, 1.0));
    assert!(triangle.contains_point(&Vector3::new(0.25, 0.25, 0.0)));
    let degenerate = Triangle::new(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(1.0, 0.0, 0.0), &Vector3::new(2.0, 0.0, 0.0));
    assert!(degenerate.get_barycoord(&Vector3::new(0.0, 0.0, 0.0)).is_none());

    let mut spherical = Spherical::new(1.0, 0.0, 0.0);
    spherical.set_from_vector3(&Vector3::new(0.0, 2.0, 0.0));
    let mut v = Vector3::new(0.0, 0.0, 0.0);
    v.set_from_spherical(&spherical);
    assert_eq!((spherical.radius(), v.y()), (2.0, 2.0));
    let mut cylindrical = Cylindrical::new(1.0, 0.0, 0.0);
    cylindrical.set_from_cartesian_coords(0.0, 3.0, 4.0);
    assert_eq!((cylindrical.radius(), cylindrical.y()), (4.0, 3.0));
}

#[test]
fn forwarding_macros_reach_the_math_crate() {
    let mut v = Vector2::new(3.0, 4.0);
    assert_eq!(v.length(), 5.0);
    v.normalize();
    v.add_scaled_vector(&Vector2::new(1.0, 0.0), 2.0);
    assert!((v.x() - 2.6).abs() < 1e-6);

    let mut b = Box3::new();
    b.expand_by_point(&Vector3::new(1.0, 2.0, 3.0));
    b.expand_by_point(&Vector3::new(-1.0, 0.0, 0.0));
    assert_eq!(b.get_center().to_array(), [0.0, 1.0, 1.5]);
    assert!(b.intersects_sphere(&Sphere::new(&Vector3::new(2.0, 1.0, 1.0), 1.5)));

    let ray = Ray::new(&Vector3::new(0.0, 0.0, 5.0), &Vector3::new(0.0, 0.0, -1.0));
    let hit = ray.intersect_plane(&Plane::new(&Vector3::new(0.0, 0.0, 1.0), -1.0)).unwrap();
    assert_eq!(hit.to_array(), [0.0, 0.0, 1.0]);

    let c = Color::from_hex(0xff0000);
    assert_eq!((c.get_hex(), c.get_hex_string().as_str()), (0xff0000, "ff0000"));
    assert_eq!(deg_to_rad(180.0), core::f32::consts::PI);
}

#[test]
fn euler_reports_its_order() {
    let mut e = wamr_math::Euler::default();
    e.order = wamr_math::EulerOrder::ZYX;
    assert_eq!(Euler { inner: e }.order(), "ZYX");
}
