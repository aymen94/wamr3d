//! Parity for cameras, built-in shapes and world-space object methods, replayed from
//! `parity/objects/objects.json` (see `parity/objects/gen/generate.mjs`).
//!
//! Single operations must agree to `1e-6 * max(1, |expected|)`; the world-space
//! methods chain many f32 steps and are held to `1e-5`.

use serde_json::Value;
use std::collections::BTreeMap;
use wamr_core::{AttributeAccess, BufferGeometry, Camera, Entity, Projection, World};
use wamr_math::{CoordinateSystem, Quaternion, Vector3};
use wamr_objects::{box_geometry, circle_geometry, cone_geometry, cylinder_geometry, plane_geometry, ring_geometry, sphere_geometry, torus_geometry};

fn geometry_out(g: &BufferGeometry) -> Vec<f64> {
    let attribute = |name: &str| {
        let a = g.get_attribute(name).unwrap();
        (0..a.array.len()).map(|i| a.array.get(i)).collect::<Vec<f64>>()
    };
    let index = g.get_index().unwrap();

    let mut out = vec![g.get_attribute("position").unwrap().count() as f64];
    out.extend(attribute("position"));
    out.extend(attribute("normal"));
    out.extend(attribute("uv"));
    out.push(index.count() as f64);
    out.extend((0..index.array.len()).map(|i| index.array.get(i)));
    out.push(g.groups.len() as f64);
    out.extend(g.groups.iter().flat_map(|x| [x.start as f64, x.count as f64, x.material_index as f64]));
    out
}

fn widen(values: &[f32]) -> impl Iterator<Item = f64> + '_ {
    values.iter().map(|x| *x as f64)
}

fn configure(camera: &mut Camera, v: &[f32]) {
    // v: coordinate system, reversed depth, view offset flag + six numbers
    camera.coordinate_system = if v[0] == 1.0 { CoordinateSystem::WebGPU } else { CoordinateSystem::WebGL };
    camera.reversed_depth = v[1] == 1.0;
    if v[2] == 1.0 {
        camera.set_view_offset(v[3], v[4], v[5], v[6], v[7], v[8]);
    }
    camera.update_projection_matrix();
}

/// grandparent -> parent -> object, the last one optionally a camera.
fn chain(v: &[f32]) -> (World, [Entity; 3], Vector3, Vector3) {
    let mut world = World::new();
    let entities = [world.create_object(), world.create_object(), world.create_object()];

    for (k, e) in entities.iter().enumerate() {
        let l = &v[1 + k * 8..9 + k * 8];
        let t = world.transform_mut(*e).unwrap();
        t.position.set(l[0], l[1], l[2]);
        t.set_quaternion(Quaternion::new(l[3], l[4], l[5], l[6]));
        t.scale.set(l[7], l[7], l[7]);
        if k > 0 {
            world.add(entities[k - 1], *e);
        }
    }

    if v[0] == 1.0 {
        world.set_camera(entities[2], Some(Camera::perspective(50.0, 1.5, 0.1, 100.0)));
    }

    (world, entities, Vector3::new(v[25], v[26], v[27]), Vector3::new(v[28], v[29], v[30]))
}

fn run(op: &str, v: &[f32]) -> Vec<f64> {
    let mut out = Vec::new();

    match op {
        "box" => out = geometry_out(&box_geometry(v[0], v[1], v[2], v[3] as u32, v[4] as u32, v[5] as u32)),
        "plane" => out = geometry_out(&plane_geometry(v[0], v[1], v[2] as u32, v[3] as u32)),
        "sphere" => out = geometry_out(&sphere_geometry(v[0], v[1] as u32, v[2] as u32, v[3], v[4], v[5], v[6])),
        "cylinder" => out = geometry_out(&cylinder_geometry(v[0], v[1], v[2], v[3] as u32, v[4] as u32, v[5] == 1.0, v[6], v[7])),
        "cone" => out = geometry_out(&cone_geometry(v[0], v[1], v[2] as u32, v[3] as u32, v[4] == 1.0, v[5], v[6])),
        "circle" => out = geometry_out(&circle_geometry(v[0], v[1] as u32, v[2], v[3])),
        "ring" => out = geometry_out(&ring_geometry(v[0], v[1], v[2] as u32, v[3] as u32, v[4], v[5])),
        "torus" => out = geometry_out(&torus_geometry(v[0], v[1], v[2] as u32, v[3] as u32, v[4], v[5], v[6])),
        "perspective" => {
            let mut camera = Camera::perspective(v[0], v[1], v[2], v[3]);
            if let Projection::Perspective { zoom, film_offset, .. } = &mut camera.projection {
                *zoom = v[4];
                *film_offset = v[5];
            }
            configure(&mut camera, &v[6..15]);
            let (min, max) = camera.get_view_bounds(v[15]);
            out.extend(widen(&camera.projection_matrix.elements));
            out.extend(widen(&camera.projection_matrix_inverse.elements));
            out.extend(widen(&[camera.get_effective_fov(), camera.get_film_width(), camera.get_film_height(), camera.get_focal_length()]));
            out.extend(widen(&[min.x, min.y, max.x, max.y]));
        }
        "orthographic" => {
            let mut camera = Camera::orthographic(v[0], v[1], v[2], v[3], v[4], v[5]);
            if let Projection::Orthographic { zoom, .. } = &mut camera.projection {
                *zoom = v[6];
            }
            configure(&mut camera, &v[7..16]);
            out.extend(widen(&camera.projection_matrix.elements));
            out.extend(widen(&camera.projection_matrix_inverse.elements));
        }
        "world" => {
            let (mut world, [root, _, object], _, point) = chain(v);
            out.extend(widen(&world.get_world_position(object).unwrap().to_array()));
            out.extend(widen(&world.get_world_quaternion(object).unwrap().to_array()));
            out.extend(widen(&world.get_world_scale(object).unwrap().to_array()));
            out.extend(widen(&world.get_world_direction(object).unwrap().to_array()));
            out.extend(widen(&world.local_to_world(object, &point).unwrap().to_array()));
            out.extend(widen(&world.world_to_local(object, &point).unwrap().to_array()));
            world.update_matrix_world(root, false);
            out.extend(widen(&world.transform(object).unwrap().matrix_world.elements));
            if let Some(camera) = world.camera(object) {
                out.extend(widen(&camera.matrix_world_inverse.elements));
            }
        }
        "lookAt" => {
            let (mut world, [root, _, object], target, _) = chain(v);
            world.look_at(object, target.x, target.y, target.z);
            world.update_matrix_world(root, false);
            let t = world.transform(object).unwrap();
            out.extend(widen(&t.quaternion().to_array()));
            out.extend(widen(&t.matrix_world.elements));
        }
        "attach" => {
            let (mut world, [root, parent, object], _, _) = chain(v);
            world.update_matrix_world(root, false);
            let before = world.transform(object).unwrap().matrix_world;
            assert!(world.attach(root, object));
            world.update_matrix_world(root, false);
            let t = world.transform(object).unwrap();
            out.extend(widen(&t.position.to_array()));
            out.extend(widen(&t.quaternion().to_array()));
            out.extend(widen(&t.scale.to_array()));
            out.extend(widen(&t.matrix_world.elements));
            out.extend(widen(&before.elements));
            out.push(world.children(parent).len() as f64);
            out.push(world.children(root).len() as f64);
        }
        other => panic!("no Rust replay for op {other}"),
    }

    out
}

#[test]
fn objects_match_the_reference() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../parity/objects/objects.json");
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    let numbers = |v: &Value| -> Vec<f64> { v.as_array().unwrap().iter().map(|x| x.as_f64().expect("finite number")).collect() };

    let mut summary: BTreeMap<String, (usize, usize, f64)> = BTreeMap::new();
    let mut failures = Vec::new();

    for (index, case) in cases.iter().enumerate() {
        let op = case["op"].as_str().unwrap();
        let input: Vec<f32> = numbers(&case["in"]).iter().map(|x| *x as f32).collect();
        let expected = numbers(&case["out"]);
        let got = run(op, &input);
        assert_eq!(got.len(), expected.len(), "case {index} ({op}): output length");

        let tolerance = if matches!(op, "world" | "lookAt" | "attach") { 1e-5 } else { 1e-6 };
        let entry = summary.entry(op.to_string()).or_default();
        entry.0 += 1;
        let mut ok = true;
        for (g, e) in got.iter().zip(&expected) {
            let scaled = (g - e).abs() / e.abs().max(1.0);
            entry.1 += 1;
            entry.2 = entry.2.max(scaled);
            ok &= scaled <= tolerance;
        }
        if !ok && failures.len() < 6 {
            failures.push(format!("case {index} {op}\n    in:       {input:?}\n    expected: {expected:?}\n    got:      {got:?}"));
        }
    }

    for (op, (count, values, worst)) in &summary {
        println!("parity {op:<14} {count:>3} cases {values:>6} values  max |err|/max(1,|exp|) {worst:.3e}");
    }
    assert!(failures.is_empty(), "parity failures (first {}):\n{}", failures.len(), failures.join("\n"));
}
