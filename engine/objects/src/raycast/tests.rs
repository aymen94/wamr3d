use super::*;
use crate::{box_geometry, plane_geometry};
use wamr_core::{Camera, Material, Renderable};
use std::time::Instant;

fn scene(side: Side) -> (World, Entity, Entity) {
    let mut world = World::new();
    let geometry = world.create_geometry(box_geometry(2.0, 2.0, 2.0, 1, 1, 1));
    let material = world.create_material(Material { side, ..Material::default() });
    let (root, mesh) = (world.create_object(), world.create_object());
    world.add(root, mesh);
    world.set_renderable(mesh, Some(Renderable::mesh(geometry, material)));
    world.transform_mut(mesh).unwrap().position.set(0.0, 0.0, -10.0);
    world.update_matrix_world(root, false);
    (world, root, mesh)
}

fn forward() -> Raycaster {
    Raycaster::new(Vector3::new(0.25, 0.5, 0.0), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY)
}

#[test]
fn front_faces_are_hit_once_and_reported_in_world_space() {
    let (world, root, mesh) = scene(Side::Front);
    let hits = intersect_object(&world, &forward(), root, true);
    assert_eq!(hits.len(), 1);
    let hit = hits[0];
    assert_eq!((hit.object, hit.distance), (mesh, 9.0));
    assert_eq!(hit.point, Vector3::new(0.25, 0.5, -9.0));
    assert_eq!(hit.face.normal, Vector3::new(0.0, 0.0, 1.0));
    assert_eq!(hit.normal, Some(Vector3::new(0.0, 0.0, 1.0)));
    assert!(hit.uv.is_some());
    assert!((hit.barycoord.x + hit.barycoord.y + hit.barycoord.z - 1.0).abs() < 1e-6);
}

#[test]
fn bvh_keeps_triangle_indices_for_sparse_large_geometry() {
    let mut world = World::new();
    let mut geometry = BufferGeometry::new();
    let mut positions = Vec::new();
    for i in 0..64 {
        let x = if i == 37 { 0.0 } else { i as f32 + 4.0 };
        positions.extend_from_slice(&[x - 0.4, -0.4, -10.0, x + 0.4, -0.4, -10.0, x, 0.4, -10.0]);
    }
    geometry.set_attribute("position", wamr_core::BufferAttribute::new(wamr_core::AttributeArray::Float32(positions), 3, false));
    let geometry = world.create_geometry(geometry);
    let material = world.create_material(Material::default());
    let mesh = world.create_object();
    world.set_renderable(mesh, Some(Renderable::mesh(geometry, material)));
    world.update_matrix_world(mesh, false);
    let ray = Raycaster::new(Vector3::default(), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
    let hits = intersect_object(&world, &ray, mesh, false);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].face_index, 37);

    let geometry = world.geometry_mut(geometry).unwrap();
    let position = geometry.get_attribute_mut("position").unwrap();
    for vertex in 0..position.count() {
        position.set_x(vertex, position.get_x(vertex) + 100.0);
    }
    position.needs_update();
    geometry.clear_raycast_cache();
    assert!(intersect_object(&world, &ray, mesh, false).is_empty());
}

#[test]
#[ignore = "manual raycast performance comparison"]
fn benchmark_bvh_against_linear_triangle_scan() {
    let mut world = World::new();
    let mut geometry = BufferGeometry::new();
    let side = 128usize;
    let mut positions = Vec::with_capacity(side * side * 18);
    for y in 0..side {
        for x in 0..side {
            let x0 = x as f32 - side as f32 / 2.0;
            let y0 = y as f32 - side as f32 / 2.0;
            let x1 = x0 + 1.0;
            let y1 = y0 + 1.0;
            positions.extend_from_slice(&[
                x0, y0, -10.0, x1, y0, -10.0, x1, y1, -10.0,
                x0, y0, -10.0, x1, y1, -10.0, x0, y1, -10.0,
            ]);
        }
    }
    geometry.set_attribute("position", wamr_core::BufferAttribute::new(wamr_core::AttributeArray::Float32(positions), 3, false));
    let geometry_handle = world.create_geometry(geometry);
    let material = world.create_material(Material::default());
    let mesh = world.create_object();
    world.set_renderable(mesh, Some(Renderable::mesh(geometry_handle, material)));
    world.update_matrix_world(mesh, false);
    let ray = Raycaster::new(Vector3::new(0.123, 0.234, 0.0), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
    let geometry = world.geometry(geometry_handle).unwrap();
    let sphere = local_bounding_sphere(geometry);
    let matrix = world.transform(mesh).unwrap().matrix_world;
    let mut hits = Vec::new();
    let build_start = Instant::now();
    raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut hits, true);
    let build_and_first = build_start.elapsed();
    let expected = hits.clone();
    let mut accelerated = Vec::new();
    let mut linear = Vec::new();
    raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut linear, false);
    assert_eq!(expected, linear);
    linear.clear();
    for _ in 0..10 {
        raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut accelerated, true);
        raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut linear, false);
        accelerated.clear();
        linear.clear();
    }
    let runs = 200usize;
    let start = Instant::now();
    for _ in 0..runs { raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut accelerated, true); accelerated.clear(); }
    let bvh_time = start.elapsed();
    let start = Instant::now();
    for _ in 0..runs { raycast_triangles(mesh, geometry, Side::Front, &sphere, &matrix, &ray, &mut linear, false); linear.clear(); }
    let linear_time = start.elapsed();
    println!("triangles={} rays={} BVH_build_plus_first={build_and_first:?} BVH_warm={bvh_time:?} linear={linear_time:?}", side * side * 2, runs);
}

#[test]
fn instances_are_hit_one_by_one_and_skipped_by_intersect_object() {
    let (mut world, root, mesh) = scene(Side::Front);
    let mut renderable = *world.renderable(mesh).unwrap();
    renderable.instances = 1;
    renderable.instance_count = 2;
    world.set_renderable(mesh, Some(renderable));
    assert!(intersect_object(&world, &forward(), root, true).is_empty());

    // instance 0 sits 5 units to the side, instance 1 3 units nearer the ray origin
    let mut matrices = [0.0f32; 32];
    for (i, offset) in [(0, [5.0, 0.0, 0.0]), (1, [0.0, 0.0, 3.0])] {
        let m = &mut matrices[i * 16..i * 16 + 16];
        m[0] = 1.0;
        m[5] = 1.0;
        m[10] = 1.0;
        m[15] = 1.0;
        m[12..15].copy_from_slice(&offset);
    }
    let hits = intersect_instances(&world, &forward(), mesh, &matrices);
    assert_eq!(hits.iter().map(|h| (h.instance_id, h.distance, h.object)).collect::<Vec<_>>(), [(Some(1), 6.0, mesh)]);
}

#[test]
fn a_line_loop_is_also_hit_on_its_closing_segment() {
    let mut world = World::new();
    let mut geometry = BufferGeometry::new();
    // an open "U": the closing segment runs along y = 1 from (1, 1) back to (-1, 1)
    let points = vec![-1.0, 1.0, -10.0, -1.0, -1.0, -10.0, 1.0, -1.0, -10.0, 1.0, 1.0, -10.0];
    geometry.set_attribute("position", wamr_core::BufferAttribute::new(wamr_core::AttributeArray::Float32(points), 3, false));
    let geometry = world.create_geometry(geometry);
    let material = world.create_material(Material::default());
    let line = world.create_object();
    world.set_renderable(line, Some(Renderable { primitive: Primitive::Line, ..Renderable::mesh(geometry, material) }));
    world.update_matrix_world(line, false);

    let mut raycaster = Raycaster::new(Vector3::new(0.0, 1.0, 0.0), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
    raycaster.params.line_threshold = 0.1;
    assert!(intersect_object(&world, &raycaster, line, false).is_empty());

    world.set_renderable(line, Some(Renderable { primitive: Primitive::LineLoop, ..Renderable::mesh(geometry, material) }));
    let hits = intersect_object(&world, &raycaster, line, false);
    assert_eq!(hits.iter().map(|h| (h.line_index, h.distance)).collect::<Vec<_>>(), [(Some(3), 10.0)]);
}

#[test]
fn side_selects_which_faces_count() {
    let hits = |side| {
        let (world, root, _) = scene(side);
        intersect_object(&world, &forward(), root, true).iter().map(|h| h.distance).collect::<Vec<_>>()
    };
    assert_eq!(hits(Side::Back), [11.0]);
    assert_eq!(hits(Side::Double), [9.0, 11.0]);
}

#[test]
fn near_far_layers_and_recursion_limit_the_hits() {
    let (mut world, root, mesh) = scene(Side::Double);
    let mut raycaster = forward();

    raycaster.far = 10.0;
    assert_eq!(intersect_object(&world, &raycaster, root, true).len(), 1);
    raycaster.near = 9.5;
    assert!(intersect_object(&world, &raycaster, root, true).is_empty());

    let mut raycaster = forward();
    assert!(intersect_object(&world, &raycaster, root, false).is_empty());
    assert_eq!(intersect_objects(&world, &raycaster, &[root, mesh], false).len(), 2);

    raycaster.layers.set(3);
    assert!(intersect_object(&world, &raycaster, root, true).is_empty());
    world.visibility_mut(mesh).unwrap().layers.enable(3);
    assert_eq!(intersect_object(&world, &raycaster, root, true).len(), 2);
}

#[test]
fn a_miss_and_a_disposed_geometry_give_nothing() {
    let (mut world, root, mesh) = scene(Side::Front);
    let mut raycaster = forward();
    raycaster.set(&Vector3::new(5.0, 0.0, 0.0), &Vector3::new(0.0, 0.0, -1.0));
    assert!(intersect_object(&world, &raycaster, root, true).is_empty());

    let geometry = world.renderable(mesh).unwrap().geometry;
    world.dispose_geometry(geometry);
    assert!(intersect_object(&world, &forward(), root, true).is_empty());
}

#[test]
fn set_from_camera_aims_through_the_view() {
    let mut world = World::new();
    let (camera, floor) = (world.create_object(), world.create_object());
    world.set_camera(camera, Some(Camera::perspective(90.0, 1.0, 0.1, 100.0)));
    world.transform_mut(camera).unwrap().position.set(0.0, 0.0, 5.0);
    let geometry = world.create_geometry(plane_geometry(100.0, 100.0, 1, 1));
    let material = world.create_material(Material::default());
    world.set_renderable(floor, Some(Renderable::mesh(geometry, material)));
    world.update_matrix_world(camera, false);
    world.update_matrix_world(floor, false);

    let mut raycaster = Raycaster::new(Vector3::default(), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
    // the right edge of a 90 degree view is 45 degrees off axis
    assert!(set_from_camera(&mut raycaster, &world, camera, Vector2::new(1.0, 0.0)));
    let hit = intersect_object(&world, &raycaster, floor, false)[0];
    assert!((hit.point.x - 5.0).abs() < 1e-4 && hit.point.y.abs() < 1e-4);

    world.set_camera(camera, Some(Camera::orthographic(-2.0, 2.0, 2.0, -2.0, 0.1, 100.0)));
    world.update_matrix_world(camera, false);
    assert!(set_from_camera(&mut raycaster, &world, camera, Vector2::new(0.5, -0.5)));
    let hit = intersect_object(&world, &raycaster, floor, false)[0];
    assert!((hit.point.x - 1.0).abs() < 1e-5 && (hit.point.y + 1.0).abs() < 1e-5);

    assert!(!set_from_camera(&mut raycaster, &world, floor, Vector2::default()));
}
