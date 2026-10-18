use super::*;
use wamr_math::Vector2;

fn v(x: f32, y: f32, z: f32) -> Vector3 {
    Vector3::new(x, y, z)
}

fn f32s(values: &[f32], item_size: usize) -> BufferAttribute {
    BufferAttribute::new(AttributeArray::Float32(values.to_vec()), item_size, false)
}

/// Unit quad in the XY plane, two counter-clockwise triangles facing +Z.
fn quad() -> BufferGeometry {
    let mut g = BufferGeometry::new();
    g.set_attribute("position", f32s(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0], 3));
    g.set_attribute("uv", f32s(&[0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0], 2));
    g.set_index_from_slice(&[0, 1, 2, 0, 2, 3]);
    g
}

#[test]
fn new_and_new_instanced() {
    let g = BufferGeometry::new();
    assert!(g.get_index().is_none() && g.bounding_box.is_none() && g.instance_count.is_none());
    assert_eq!(g.draw_range, DrawRange { start: 0, count: u32::MAX });
    assert_eq!(BufferGeometry::new_instanced().instance_count, Some(u32::MAX));
}

#[test]
fn index_accessors() {
    let mut g = quad();
    assert_eq!(g.get_index().unwrap().count(), 6);
    g.get_index_mut().unwrap().needs_update();
    assert_eq!(g.get_index().unwrap().version, 1);
    g.set_index(None);
    assert!(g.get_index().is_none());
}

#[test]
fn set_index_from_slice_picks_the_width() {
    let mut g = BufferGeometry::new();
    g.set_index_from_slice(&[0, 65534]);
    assert!(matches!(g.get_index().unwrap().array, AttributeArray::Uint16(_)));
    g.set_index_from_slice(&[0, 65535]);
    assert!(matches!(g.get_index().unwrap().array, AttributeArray::Uint32(_)));
}

#[test]
fn attribute_map_keeps_insertion_order() {
    let mut g = quad();
    assert!(g.has_attribute("uv") && !g.has_attribute("normal"));
    g.set_attribute("position", f32s(&[9.0, 9.0, 9.0], 3));
    assert_eq!(g.attributes().map(|(n, _)| n).collect::<Vec<_>>(), ["position", "uv"]);
    assert_eq!(g.get_attribute("position").unwrap().count(), 1);
    g.get_attribute_mut("uv").unwrap().needs_update();
    g.delete_attribute("position");
    assert!(g.get_attribute("position").is_none());
}

#[test]
fn groups_and_draw_range() {
    let mut g = quad();
    g.add_group(0, 3, 0);
    g.add_group(3, 3, 1);
    assert_eq!(g.groups[1], Group { start: 3, count: 3, material_index: 1 });
    g.clear_groups();
    assert!(g.groups.is_empty());
    g.set_draw_range(3, 3);
    assert_eq!(g.draw_range, DrawRange { start: 3, count: 3 });
}

#[test]
fn compute_bounding_box() {
    let mut g = quad();
    g.compute_bounding_box();
    assert_eq!(g.bounding_box, Some(Box3::new(v(0.0, 0.0, 0.0), v(1.0, 1.0, 0.0))));
    let mut empty = BufferGeometry::new();
    empty.compute_bounding_box();
    assert!(empty.bounding_box.unwrap().is_empty());
}

#[test]
fn compute_bounding_sphere() {
    let mut g = BufferGeometry::new();
    g.set_attribute("position", f32s(&[-3.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 4.0, 0.0], 3));
    g.compute_bounding_sphere();
    let s = g.bounding_sphere.unwrap();
    assert_eq!(s.center, v(0.0, 2.0, 0.0));
    assert_eq!(s.radius, 13.0f32.sqrt());
    let mut empty = BufferGeometry::new();
    empty.compute_bounding_sphere();
    assert!(empty.bounding_sphere.unwrap().is_empty());
}

#[test]
fn apply_matrix4_updates_attributes_and_existing_bounds() {
    let mut g = quad();
    g.compute_vertex_normals();
    g.compute_bounding_box();
    let version = g.get_attribute("position").unwrap().version;

    let mut m = Matrix4::default();
    m.make_translation(1.0, 2.0, 3.0);
    g.apply_matrix4(&m);

    assert_eq!(g.get_attribute("position").unwrap().get_vector3(0), v(1.0, 2.0, 3.0));
    assert_eq!(g.get_attribute("position").unwrap().version, version + 1);
    assert_eq!(g.get_attribute("normal").unwrap().get_vector3(0), v(0.0, 0.0, 1.0));
    assert_eq!(g.bounding_box, Some(Box3::new(v(1.0, 2.0, 3.0), v(2.0, 3.0, 3.0))));
    assert!(g.bounding_sphere.is_none());
}

#[test]
fn apply_quaternion_and_rotations() {
    let half_turn = core::f32::consts::PI;
    let mut q = Quaternion::default();
    q.set_from_axis_angle(&v(0.0, 0.0, 1.0), half_turn);

    let mut a = quad();
    a.apply_quaternion(&q);
    let mut b = quad();
    b.rotate_z(half_turn);
    let (pa, pb) = (a.get_attribute("position").unwrap().get_vector3(2), b.get_attribute("position").unwrap().get_vector3(2));
    assert!((pa.x + 1.0).abs() < 1e-6 && (pa.y + 1.0).abs() < 1e-6);
    assert!(pa.distance_to(&pb) < 1e-6);

    let mut c = quad();
    c.rotate_x(half_turn).rotate_y(half_turn);
    let pc = c.get_attribute("position").unwrap().get_vector3(2);
    assert!(pc.distance_to(&v(-1.0, -1.0, 0.0)) < 1e-6);
}

#[test]
fn translate_and_scale() {
    let mut g = quad();
    g.scale(2.0, 3.0, 1.0).translate(1.0, 0.0, 0.0);
    assert_eq!(g.get_attribute("position").unwrap().get_vector3(2), v(3.0, 3.0, 0.0));
}

#[test]
fn center() {
    let mut g = quad();
    g.center();
    assert_eq!(g.get_attribute("position").unwrap().get_vector3(0), v(-0.5, -0.5, 0.0));
    assert_eq!(g.bounding_box, Some(Box3::new(v(-0.5, -0.5, 0.0), v(0.5, 0.5, 0.0))));
}

#[test]
fn set_from_points() {
    let mut g = BufferGeometry::new();
    g.set_from_points(&[v(1.0, 2.0, 3.0), v(4.0, 5.0, 6.0)]);
    assert_eq!(g.get_attribute("position").unwrap().count(), 2);
    // an existing attribute keeps its size
    g.set_from_points(&[v(7.0, 8.0, 9.0), v(0.0, 0.0, 0.0), v(1.0, 1.0, 1.0)]);
    let p = g.get_attribute("position").unwrap();
    assert_eq!((p.count(), p.version), (2, 1));
    assert_eq!(p.get_vector3(0), v(7.0, 8.0, 9.0));
}

#[test]
fn compute_vertex_normals_indexed_and_soup() {
    let mut g = quad();
    g.compute_vertex_normals();
    let n = g.get_attribute("normal").unwrap();
    assert_eq!((n.count(), n.version), (4, 1));
    assert!((0..4).all(|i| n.get_vector3(i) == v(0.0, 0.0, 1.0)));

    let mut soup = g.to_non_indexed();
    soup.delete_attribute("normal");
    soup.compute_vertex_normals();
    assert_eq!(soup.get_attribute("normal").unwrap().get_vector3(5), v(0.0, 0.0, 1.0));
}

#[test]
fn normalize_normals() {
    let mut g = BufferGeometry::new();
    g.set_attribute("normal", f32s(&[0.0, 0.0, 5.0], 3));
    g.normalize_normals();
    assert_eq!(g.get_attribute("normal").unwrap().get_vector3(0), v(0.0, 0.0, 1.0));
}

#[test]
fn compute_tangents() {
    let mut g = quad();
    g.compute_tangents();
    assert!(!g.has_attribute("tangent"), "needs normals");

    g.compute_vertex_normals();
    g.compute_tangents();
    let t = g.get_attribute("tangent").unwrap();
    // u runs along +X, and (normal x tangent) matches the +Y direction of v
    assert_eq!((t.count(), t.item_size), (4, 4));
    assert!((0..4).all(|i| t.get_vector3(i) == v(1.0, 0.0, 0.0) && t.get_w(i) == 1.0));
}

#[test]
fn to_non_indexed() {
    let mut g = quad();
    g.add_group(0, 6, 2);
    let soup = g.to_non_indexed();
    assert!(soup.get_index().is_none());
    assert_eq!(soup.get_attribute("position").unwrap().count(), 6);
    assert_eq!(soup.get_attribute("position").unwrap().get_vector3(5), v(0.0, 1.0, 0.0));
    assert_eq!(soup.get_attribute("uv").unwrap().get_vector2(4), Vector2::new(1.0, 1.0));
    assert_eq!(soup.groups, g.groups);
    // already non-indexed: a plain copy
    assert_eq!(soup.to_non_indexed(), soup);
}
