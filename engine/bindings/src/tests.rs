use super::*;
use crate::renderer::GEOMETRY_STATE_FIELDS;

#[test]
fn math_shells_delegate() {
    let mut v = Vector3::new(1.0, 0.0, 0.0);
    let mut q = Quaternion::new(0.0, 0.0, 0.0, 1.0);
    q.set_from_axis_angle(&Vector3::new(0.0, 0.0, 1.0), core::f32::consts::FRAC_PI_2);
    v.apply_quaternion(&q);
    assert!((v.y() - 1.0).abs() < 1e-6);

    let mut m = Matrix4::new();
    m.make_translation(1.0, 2.0, 3.0);
    let mut p = Vector3::new(0.0, 0.0, 0.0);
    p.apply_matrix4(&m);
    assert_eq!(p.to_array(), [1.0, 2.0, 3.0]);
    assert_eq!(m.decompose()[..3], [1.0, 2.0, 3.0]);
}

#[test]
fn world_shell_round_trips_handles() {
    let mut world = World::new();
    let (root, child) = (world.create_object(), world.create_object());
    assert!(world.add(root, child));
    assert_eq!(world.parent(child), Some(root));
    assert_eq!(world.children(root), [child]);
    assert_eq!(world.drain_events(), [0, child, 0, 2, root, child]);
    assert!(world.destroy(child) && !world.is_alive(child));
    assert_eq!(world.object_count(), 1);
}

#[test]
fn geometry_state_describes_each_distinct_geometry_once() {
    let mut world = World::new();
    let (root, camera) = (world.create_object(), world.create_object());
    world.add(root, camera);
    world.set_perspective_camera(camera, 90.0, 1.0, 0.1, 100.0, true);
    let geometry = world.create_box_geometry(1.0, 1.0, 1.0, 1, 1, 1);
    let material = world.create_material("");
    for z in [-5.0, -6.0] {
        let object = world.create_object();
        world.add(root, object);
        world.set_renderable(object, geometry, material);
        assert!(world.set_position(object, 0.0, 0.0, z).is_ok());
    }
    world.update_matrix_world(root, false);

    let mut renderer = Renderer::new();
    assert_eq!(renderer.prepare(&mut world, root, camera).ok(), Some(2));
    assert_eq!(renderer.draw_geometry_slots(), [0, 0]);
    let state = renderer.geometry_state();
    assert_eq!(state.len(), GEOMETRY_STATE_FIELDS);
    assert_eq!(u64::from(state[0]) | u64::from(state[1]) << 32, geometry);
    assert_eq!(state[2], 24);
    // position, normal and uv can be bound; a box has no colours
    assert!(state[4] != 0 && state[6] != 0 && state[8] != 0);
    assert_eq!(state[10], 0);
    assert_eq!(state[GEOMETRY_STATE_FIELDS - 1], 3);

    // colours with alpha are bound with four floats each
    assert!(world.set_attribute(geometry, "color", &vec![1.0; 24 * 4], 4).is_ok());
    assert_eq!(renderer.prepare(&mut world, root, camera).ok(), Some(2));
    let state = renderer.geometry_state();
    assert!(state[10] != 0);
    assert_eq!(state[GEOMETRY_STATE_FIELDS - 1], 4);
}

#[test]
fn timer_shell() {
    let mut t = Timer::new(0.0);
    t.update(500.0);
    assert_eq!((t.get_delta(), t.get_elapsed()), (0.5, 0.5));
}
