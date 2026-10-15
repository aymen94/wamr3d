use super::*;
use crate::attribute::AttributeArray;

fn family(world: &mut World) -> (Entity, Entity, Entity, Entity) {
    let (root, a, b, a1) = (world.create_object(), world.create_object(), world.create_object(), world.create_object());
    world.add(root, a);
    world.add(root, b);
    world.add(a, a1);
    world.drain_events();
    (root, a, b, a1)
}

#[test]
fn create_object_has_default_components() {
    let mut world = World::new();
    let e = world.create_object();
    assert!(world.is_alive(e));
    assert_eq!(world.object_count(), 1);
    assert_eq!(world.transform(e), Some(&Transform::default()));
    assert_eq!(world.visibility(e), Some(&Visibility::default()));
    assert_eq!(world.hierarchy(e), Some(&Hierarchy::default()));
    assert_eq!(world.name(e), "");
    assert!(world.renderable(e).is_none() && world.events().is_empty());
}

#[test]
fn component_mutation() {
    let mut world = World::new();
    let e = world.create_object();
    world.transform_mut(e).unwrap().position.set(1.0, 2.0, 3.0);
    world.visibility_mut(e).unwrap().visible = false;
    world.set_name(e, "hero");
    assert_eq!(world.transform(e).unwrap().position.x, 1.0);
    assert!(!world.visibility(e).unwrap().visible);
    assert_eq!(world.name(e), "hero");
    world.set_name(e, "");
    assert_eq!(world.name(e), "");
}

#[test]
fn add_links_both_sides_and_queues_events_in_order() {
    let mut world = World::new();
    let (parent, child) = (world.create_object(), world.create_object());
    assert!(world.add(parent, child));
    assert_eq!(world.parent(child), Some(parent));
    assert_eq!(world.children(parent), [child]);
    assert_eq!(
        world.drain_events(),
        [CoreEvent::Added { entity: child }, CoreEvent::ChildAdded { parent, child }]
    );
    assert!(world.events().is_empty());
}

#[test]
fn add_rejects_self_and_dead_entities() {
    let mut world = World::new();
    let (a, b) = (world.create_object(), world.create_object());
    world.destroy(b);
    world.drain_events();
    assert!(!world.add(a, a));
    assert!(!world.add(a, b));
    assert!(!world.add(b, a));
    assert!(world.events().is_empty());
}

#[test]
fn add_reparents() {
    let mut world = World::new();
    let (root, a, b, _) = family(&mut world);
    world.add(a, b);
    assert_eq!(world.children(root), [a]);
    assert_eq!(world.parent(b), Some(a));
    assert_eq!(
        world.drain_events(),
        [
            CoreEvent::Removed { entity: b },
            CoreEvent::ChildRemoved { parent: root, child: b },
            CoreEvent::Added { entity: b },
            CoreEvent::ChildAdded { parent: a, child: b },
        ]
    );
}

#[test]
fn remove_and_remove_from_parent() {
    let mut world = World::new();
    let (root, a, b, _) = family(&mut world);
    assert!(world.remove(root, a));
    assert!(!world.remove(root, a));
    assert_eq!((world.parent(a), world.children(root)), (None, [b].as_slice()));
    world.remove_from_parent(b);
    assert!(world.children(root).is_empty());
    assert_eq!(world.drain_events().len(), 4);
}

#[test]
fn clear_detaches_children_in_order() {
    let mut world = World::new();
    let (root, a, b, a1) = family(&mut world);
    world.clear(root);
    assert!(world.children(root).is_empty());
    assert_eq!(world.parent(a1), Some(a));
    let events = world.drain_events();
    assert_eq!(events[0], CoreEvent::Removed { entity: a });
    assert_eq!(events[3], CoreEvent::ChildRemoved { parent: root, child: b });
}

#[test]
fn traversals() {
    let mut world = World::new();
    let (root, a, b, a1) = family(&mut world);

    let mut order = Vec::new();
    world.traverse(root, |e| order.push(e));
    assert_eq!(order, [root, a, a1, b]);

    world.visibility_mut(a).unwrap().visible = false;
    let mut visible = Vec::new();
    world.traverse_visible(root, |e| visible.push(e));
    assert_eq!(visible, [root, b]);

    let mut ancestors = Vec::new();
    world.traverse_ancestors(a1, |e| ancestors.push(e));
    assert_eq!(ancestors, [a, root]);
}

#[test]
fn get_object_by_name() {
    let mut world = World::new();
    let (root, _, b, a1) = family(&mut world);
    world.set_name(a1, "wheel");
    world.set_name(b, "wheel");
    assert_eq!(world.get_object_by_name(root, "wheel"), Some(a1));
    assert_eq!(world.get_object_by_name(b, "wheel"), Some(b));
    assert_eq!(world.get_object_by_name(root, "missing"), None);
}

#[test]
fn destroy_detaches_and_orphans_children() {
    let mut world = World::new();
    let (root, a, _, a1) = family(&mut world);
    assert!(world.destroy(a));
    assert!(!world.destroy(a));
    assert!(!world.is_alive(a) && world.is_alive(a1));
    assert_eq!(world.parent(a1), None);
    assert_eq!(world.children(root).len(), 1);
    assert!(world.transform(a).is_none() && world.hierarchy(a).is_none());
    assert_eq!(world.drain_events().last(), Some(&CoreEvent::ObjectDisposed { entity: a }));
}

#[test]
fn a_reused_slot_does_not_inherit_components() {
    let mut world = World::new();
    let old = world.create_object();
    world.set_name(old, "old");
    world.transform_mut(old).unwrap().position.x = 5.0;
    world.destroy(old);
    let new = world.create_object();
    assert_eq!(new.index(), old.index());
    assert_eq!((world.name(new), world.name(old)), ("", ""));
    assert_eq!(world.transform(new).unwrap().position.x, 0.0);
    assert!(world.transform(old).is_none());
    world.set_name(old, "ghost");
    assert_eq!(world.name(new), "");
}

#[test]
fn destroy_recursive() {
    let mut world = World::new();
    let (root, a, b, a1) = family(&mut world);
    assert!(world.destroy_recursive(a));
    assert!(!world.is_alive(a) && !world.is_alive(a1) && world.is_alive(b));
    assert_eq!(world.children(root), [b]);
    assert_eq!(world.object_count(), 2);
}

#[test]
fn dispose_object_only_queues_an_event() {
    let mut world = World::new();
    let e = world.create_object();
    world.dispose_object(e);
    assert!(world.is_alive(e));
    assert_eq!(world.drain_events(), [CoreEvent::ObjectDisposed { entity: e }]);
}

#[test]
fn update_matrix_world_composes_down_the_tree() {
    let mut world = World::new();
    let (root, a, _, a1) = family(&mut world);
    world.transform_mut(root).unwrap().position.set(1.0, 0.0, 0.0);
    world.transform_mut(a).unwrap().position.set(0.0, 2.0, 0.0);
    world.transform_mut(a1).unwrap().position.set(0.0, 0.0, 3.0);
    world.update_matrix_world(root, false);
    assert_eq!(world.transform(a1).unwrap().matrix_world.elements[12..15], [1.0, 2.0, 3.0]);
    assert!(!world.transform(a1).unwrap().matrix_world_needs_update);
}

#[test]
fn update_matrix_world_skips_clean_subtrees_unless_forced() {
    let mut world = World::new();
    let (root, a, b, _) = family(&mut world);
    world.update_matrix_world(root, false);

    // with auto update off nothing marks the subtree dirty, so a stale value survives
    for e in [root, a, b] {
        world.transform_mut(e).unwrap().matrix_auto_update = false;
    }
    world.transform_mut(a).unwrap().matrix_world.elements[12] = 99.0;
    world.update_matrix_world(root, false);
    assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 99.0);
    world.update_matrix_world(root, true);
    assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 0.0);
}

#[test]
fn update_world_matrix_can_update_parents_and_children() {
    let mut world = World::new();
    let (root, a, _, a1) = family(&mut world);
    world.transform_mut(root).unwrap().position.set(5.0, 0.0, 0.0);

    world.update_world_matrix(a, false, false);
    assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 0.0);

    world.update_world_matrix(a, true, true);
    assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 5.0);
    assert_eq!(world.transform(a1).unwrap().matrix_world.elements[12], 5.0);
}

#[test]
fn cameras_get_a_view_matrix_from_world_updates() {
    let mut world = World::new();
    let (rig, eye) = (world.create_object(), world.create_object());
    world.add(rig, eye);
    world.set_camera(eye, Some(Camera::perspective(50.0, 1.0, 0.1, 100.0)));
    world.transform_mut(rig).unwrap().position.set(0.0, 0.0, 10.0);
    world.update_matrix_world(rig, false);
    assert_eq!(world.camera(eye).unwrap().matrix_world_inverse.elements[14], -10.0);
    world.camera_mut(eye).unwrap().reversed_depth = true;
    world.set_camera(eye, None);
    assert!(world.camera(eye).is_none());
}

#[test]
fn world_space_queries() {
    let mut world = World::new();
    let (root, a, _, _) = family(&mut world);
    world.transform_mut(root).unwrap().position.set(1.0, 2.0, 3.0);
    world.transform_mut(root).unwrap().scale.set(2.0, 2.0, 2.0);
    world.transform_mut(a).unwrap().position.set(1.0, 0.0, 0.0);

    assert_eq!(world.get_world_position(a), Some(Vector3::new(3.0, 2.0, 3.0)));
    assert_eq!(world.get_world_scale(a), Some(Vector3::new(2.0, 2.0, 2.0)));
    assert_eq!(world.get_world_quaternion(a), Some(Quaternion::default()));
    assert_eq!(world.get_world_direction(a), Some(Vector3::new(0.0, 0.0, 1.0)));
    assert_eq!(world.local_to_world(a, &Vector3::new(0.0, 1.0, 0.0)), Some(Vector3::new(3.0, 4.0, 3.0)));
    assert_eq!(world.world_to_local(a, &Vector3::new(3.0, 4.0, 3.0)), Some(Vector3::new(0.0, 1.0, 0.0)));
}

#[test]
fn look_at_points_objects_forward_and_cameras_backward() {
    let mut world = World::new();
    let (object, camera) = (world.create_object(), world.create_object());
    world.set_camera(camera, Some(Camera::perspective(50.0, 1.0, 0.1, 100.0)));

    world.look_at(object, 5.0, 0.0, 0.0);
    world.look_at(camera, 5.0, 0.0, 0.0);
    let towards = |world: &mut World, e| {
        let d = world.get_world_direction(e).unwrap();
        (d.x - 1.0).abs() < 1e-6 && d.y.abs() < 1e-6 && d.z.abs() < 1e-6
    };
    assert!(towards(&mut world, object) && towards(&mut world, camera));
}

#[test]
fn attach_keeps_the_world_transform() {
    let mut world = World::new();
    let (root, a, b, _) = family(&mut world);
    world.transform_mut(a).unwrap().position.set(0.0, 5.0, 0.0);
    world.transform_mut(b).unwrap().position.set(2.0, 0.0, 0.0);
    world.update_matrix_world(root, false);
    world.drain_events();

    assert!(world.attach(a, b));
    assert_eq!(world.parent(b), Some(a));
    assert_eq!(world.get_world_position(b), Some(Vector3::new(2.0, 0.0, 0.0)));
    assert_eq!(world.transform(b).unwrap().position, Vector3::new(2.0, -5.0, 0.0));
    assert_eq!(world.drain_events().last(), Some(&CoreEvent::ChildAdded { parent: a, child: b }));
    assert!(!world.attach(a, a));
}

#[test]
fn clone_object_copies_the_subtree_and_shares_resources() {
    let mut world = World::new();
    let (root, a, _, a1) = family(&mut world);
    let geometry = world.create_geometry(BufferGeometry::new());
    let material = world.create_material(Material::default());
    world.set_renderable(a1, Some(Renderable::mesh(geometry, material)));
    world.set_name(a, "arm");
    world.transform_mut(a).unwrap().position.set(1.0, 2.0, 3.0);
    world.set_camera(a, Some(Camera::perspective(50.0, 1.0, 0.1, 10.0)));

    let copy = world.clone_object(root, true).unwrap();
    assert_ne!(copy, root);
    assert_eq!(world.parent(copy), None);
    assert_eq!(world.children(copy).len(), 2);
    let a_copy = world.children(copy)[0];
    assert_eq!(world.name(a_copy), "arm");
    assert_eq!(world.transform(a_copy).unwrap().position, Vector3::new(1.0, 2.0, 3.0));
    assert!(world.camera(a_copy).is_some());
    assert_eq!(world.renderable(world.children(a_copy)[0]), world.renderable(a1));
    assert_eq!(world.geometry_ref_count(geometry), 2);

    let shallow = world.clone_object(root, false).unwrap();
    assert!(world.children(shallow).is_empty());
    world.destroy(a);
    assert!(world.clone_object(a, true).is_none());
}

#[test]
fn renderables_count_references() {
    let mut world = World::new();
    let geometry = world.create_geometry(BufferGeometry::new());
    let material = world.create_material(Material { name: "red".into(), ..Material::default() });
    let (a, b) = (world.create_object(), world.create_object());
    let renderable = Renderable::mesh(geometry, material);

    world.set_renderable(a, Some(renderable));
    world.set_renderable(b, Some(renderable));
    assert_eq!(world.renderable(a), Some(&renderable));
    assert_eq!((world.geometry_ref_count(geometry), world.material_ref_count(material)), (2, 2));

    // replacing with the same resources must not drop the count to zero in between
    world.set_renderable(a, Some(renderable));
    assert_eq!(world.geometry_ref_count(geometry), 2);

    world.set_renderable(a, None);
    world.destroy(b);
    assert_eq!((world.geometry_ref_count(geometry), world.material_ref_count(material)), (0, 0));
    // unreferenced resources stay alive until disposed
    assert!(world.geometry(geometry).is_some() && world.material(material).is_some());
}

#[test]
fn dispose_geometry_and_material_free_and_notify() {
    let mut world = World::new();
    let geometry = world.create_geometry(BufferGeometry::new());
    let material = world.create_material(Material::default());
    let e = world.create_object();
    world.set_renderable(e, Some(Renderable::mesh(geometry, material)));

    world.geometry_mut(geometry).unwrap().name = "box".into();
    world.material_mut(material).unwrap().name = "red".into();
    assert_eq!(world.geometry(geometry).unwrap().name, "box");

    assert!(world.dispose_geometry(geometry));
    assert!(!world.dispose_geometry(geometry));
    assert!(world.dispose_material(material));
    assert!(world.geometry(geometry).is_none() && world.material(material).is_none());
    assert_eq!(world.geometry_ref_count(geometry), 0);
    // the renderable keeps its now dead handles
    assert_eq!(world.renderable(e).unwrap().geometry, geometry);
    assert_eq!(
        world.drain_events(),
        [CoreEvent::GeometryDisposed { geometry }, CoreEvent::MaterialDisposed { material }]
    );
}

#[test]
fn render_targets() {
    let mut world = World::new();
    let target = world.create_render_target(RenderTarget::new(4, 4));
    world.render_target_mut(target).unwrap().samples = 4;
    assert_eq!(world.render_target(target).unwrap().samples, 4);

    world.set_render_target_size(target, 4, 4, 1);
    assert!(world.events().is_empty());
    world.set_render_target_size(target, 8, 8, 1);
    assert_eq!(world.drain_events(), [CoreEvent::RenderTargetDisposed { target }]);
    assert_eq!(world.render_target(target).unwrap().width, 8);

    assert!(world.dispose_render_target(target));
    assert!(world.render_target(target).is_none() && !world.dispose_render_target(target));
}

#[test]
fn interleaved_buffers() {
    let mut world = World::new();
    let buffer = world.create_interleaved_buffer(InterleavedBuffer::new(AttributeArray::Float32(vec![0.0; 10]), 5));
    world.retain_interleaved_buffer(buffer);
    world.retain_interleaved_buffer(buffer);
    world.release_interleaved_buffer(buffer);
    assert_eq!(world.interleaved_buffer_ref_count(buffer), 1);
    world.interleaved_buffer_mut(buffer).unwrap().needs_update();
    assert_eq!(world.interleaved_buffer(buffer).unwrap().version, 1);
    assert!(world.dispose_interleaved_buffer(buffer));
    assert_eq!(world.drain_events(), [CoreEvent::InterleavedBufferDisposed { buffer }]);
    assert!(world.interleaved_buffer(buffer).is_none());
}

#[test]
fn shrink_to_fit_keeps_live_data() {
    let mut world = World::new();
    let keep = world.create_object();
    let extra: Vec<_> = (0..100).map(|_| world.create_object()).collect();
    for e in extra {
        world.destroy(e);
    }
    world.drain_events();
    world.shrink_to_fit();
    assert!(world.is_alive(keep));
    assert_eq!(world.object_count(), 1);
}
