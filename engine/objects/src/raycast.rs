//! Picking: rays against the meshes of a `World`.
//!
//! A mesh is any object with a `Renderable` whose geometry and material are alive.
//! World matrices are read as they are; update them before casting.

use wamr_core::{AttributeAccess, BufferGeometry, Entity, Primitive, Projection, Raycaster, Side, World};
use wamr_math::{Interpolate, Matrix4, Ray, Sphere, Triangle, Vector2, Vector3};

/// The triangle a ray hit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Face {
    pub a: u32,
    pub b: u32,
    pub c: u32,
    /// Face normal in the object's local space.
    pub normal: Vector3,
    pub material_index: u32,
}

/// One hit of a ray on a mesh.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Intersection {
    /// Distance from the ray origin to the hit, in world units.
    pub distance: f32,
    /// The hit point in world space.
    pub point: Vector3,
    pub object: Entity,
    /// For a line: the position (in the index, or in the vertices) where the segment
    /// that was hit starts. `None` for a mesh; the face fields are then meaningful.
    pub line_index: Option<u32>,
    /// Index of the triangle within the geometry.
    pub face_index: u32,
    pub face: Face,
    /// Barycentric coordinates of the hit within the triangle.
    pub barycoord: Vector3,
    /// Interpolated texture coordinate, if the geometry has a `uv` attribute.
    pub uv: Option<Vector2>,
    /// Interpolated vertex normal in local space, flipped to face the ray, if the
    /// geometry has a `normal` attribute.
    pub normal: Option<Vector3>,
    /// For a hit found by [`intersect_instances`]: the instance that was hit.
    pub instance_id: Option<u32>,
}

fn check_triangle(
    object: Entity,
    geometry: &BufferGeometry,
    side: Side,
    raycaster: &Raycaster,
    local_ray: &Ray,
    matrix_world: &Matrix4,
    [a, b, c]: [usize; 3],
) -> Option<Intersection> {
    let position = geometry.get_attribute("position")?;
    let (v_a, v_b, v_c) = (position.get_vector3(a), position.get_vector3(b), position.get_vector3(c));

    let local_point = if side == Side::Back {
        local_ray.intersect_triangle(&v_c, &v_b, &v_a, true)?
    } else {
        local_ray.intersect_triangle(&v_a, &v_b, &v_c, side == Side::Front)?
    };

    let mut point = local_point;
    point.apply_matrix4(matrix_world);

    let distance = raycaster.ray.origin.distance_to(&point);
    if distance < raycaster.near || distance > raycaster.far {
        return None;
    }

    // A degenerate triangle cannot be hit, so the barycentric coordinates exist.
    let barycoord = Triangle::get_barycoord_abc(&local_point, &v_a, &v_b, &v_c).unwrap_or_default();
    let weights = [barycoord.x as f64, barycoord.y as f64, barycoord.z as f64];

    let uv = geometry
        .get_attribute("uv")
        .map(|uv| Vector2::interpolate(&uv.get_vector2(a), &uv.get_vector2(b), &uv.get_vector2(c), weights));

    let normal = geometry.get_attribute("normal").map(|n| {
        let mut normal = Vector3::interpolate(&n.get_vector3(a), &n.get_vector3(b), &n.get_vector3(c), weights);
        if normal.dot(&local_ray.direction) > 0.0 {
            normal.multiply_scalar(-1.0);
        }
        normal
    });

    Some(Intersection {
        distance,
        point,
        object,
        line_index: None,
        face_index: 0,
        face: Face { a: a as u32, b: b as u32, c: c as u32, normal: Triangle::get_normal_abc(&v_a, &v_b, &v_c), material_index: 0 },
        barycoord,
        uv,
        normal,
        instance_id: None,
    })
}

fn raycast_mesh(world: &World, object: Entity, raycaster: &Raycaster, intersects: &mut Vec<Intersection>) {
    let Some(renderable) = world.renderable(object) else {
        return;
    };
    if renderable.sprite.is_some() || renderable.instances != 0 {
        // A sprite faces a camera, and instance matrices are kept by the host: both are
        // picked by the caller (see `intersect_instances`).
        return;
    }
    if renderable.primitive == Primitive::Points {
        raycast_points(world, object, raycaster, intersects);
        return;
    }
    if renderable.primitive != Primitive::Mesh {
        raycast_line(world, object, renderable.primitive, raycaster, intersects);
        return;
    }
    let (Some(geometry), Some(material), Some(transform)) =
        (world.geometry(renderable.geometry), world.material(renderable.material), world.transform(object))
    else {
        return;
    };
    let sphere = local_bounding_sphere(geometry);
    raycast_triangles(object, geometry, material.side, &sphere, &transform.matrix_world, raycaster, intersects);
}

/// The geometry's bounding sphere, measured on a copy when it has none yet.
fn local_bounding_sphere(geometry: &BufferGeometry) -> Sphere {
    match geometry.bounding_sphere {
        Some(sphere) => sphere,
        None => {
            let mut measured = geometry.clone();
            measured.compute_bounding_sphere();
            measured.bounding_sphere.unwrap_or_default()
        }
    }
}

/// The triangles of `geometry`, placed by `matrix_world`; `sphere` is the geometry's
/// bounding sphere in local space.
fn raycast_triangles(
    object: Entity,
    geometry: &BufferGeometry,
    side: Side,
    sphere: &Sphere,
    matrix_world: &Matrix4,
    raycaster: &Raycaster,
    intersects: &mut Vec<Intersection>,
) {
    let matrix_world = *matrix_world;

    // test with bounding sphere in world space
    let mut sphere = *sphere;
    sphere.apply_matrix4(&matrix_world);

    // check distance from ray origin to bounding sphere
    let mut ray = raycaster.ray;
    ray.recast(raycaster.near);

    if !sphere.contains_point(&ray.origin) {
        let Some(hit) = ray.intersect_sphere(&sphere) else {
            return;
        };
        let reach = raycaster.far as f64 - raycaster.near as f64;
        if ray.origin.distance_to_squared(&hit) as f64 > reach * reach {
            return;
        }
    }

    // convert ray to local space of mesh
    let mut inverse = matrix_world;
    inverse.invert();
    let mut local_ray = raycaster.ray;
    local_ray.apply_matrix4(&inverse);

    // test with bounding box in local space
    if let Some(bounding_box) = &geometry.bounding_box {
        if !local_ray.intersects_box(bounding_box) {
            return;
        }
    }

    let range_end = geometry.draw_range.start.saturating_add(geometry.draw_range.count) as usize;
    let start = geometry.draw_range.start as usize;

    let mut test = |i: usize, vertices: [usize; 3]| {
        if let Some(mut hit) = check_triangle(object, geometry, side, raycaster, &local_ray, &matrix_world, vertices) {
            hit.face_index = (i / 3) as u32;
            intersects.push(hit);
        }
    };

    match geometry.get_index() {
        Some(index) => {
            let end = index.count().min(range_end);
            for i in (start..end).step_by(3) {
                if i + 2 < index.count() {
                    test(i, [index.array.get(i) as usize, index.array.get(i + 1) as usize, index.array.get(i + 2) as usize]);
                }
            }
        }
        None => {
            let count = geometry.get_attribute("position").map_or(0, |p| p.count());
            let end = count.min(range_end);
            for i in (start..end).step_by(3) {
                if i + 2 < count {
                    test(i, [i, i + 1, i + 2]);
                }
            }
        }
    }
}

fn raycast_line(world: &World, object: Entity, primitive: Primitive, raycaster: &Raycaster, intersects: &mut Vec<Intersection>) {
    let Some(renderable) = world.renderable(object) else {
        return;
    };
    let (Some(geometry), Some(transform)) = (world.geometry(renderable.geometry), world.transform(object)) else {
        return;
    };
    let Some(position) = geometry.get_attribute("position") else {
        return;
    };
    let matrix_world = transform.matrix_world;
    let threshold = raycaster.params.line_threshold;

    let mut sphere: Sphere = match geometry.bounding_sphere {
        Some(sphere) => sphere,
        None => {
            let mut measured = geometry.clone();
            measured.compute_bounding_sphere();
            measured.bounding_sphere.unwrap_or_default()
        }
    };
    sphere.apply_matrix4(&matrix_world);
    sphere.radius += threshold;
    if !raycaster.ray.intersects_sphere(&sphere) {
        return;
    }

    let mut inverse = matrix_world;
    inverse.invert();
    let mut local_ray = raycaster.ray;
    local_ray.apply_matrix4(&inverse);

    let scale = transform.scale;
    let local_threshold = threshold as f64 / ((scale.x as f64 + scale.y as f64 + scale.z as f64) / 3.0);
    let threshold_sq = local_threshold * local_threshold;

    let index = geometry.get_index();
    let count = index.map_or(position.count(), |index| index.count());
    let start = geometry.draw_range.start as usize;
    let end = count.min(geometry.draw_range.start.saturating_add(geometry.draw_range.count) as usize);
    let vertex = |i: usize| index.map_or(i, |index| index.array.get(i) as usize);

    let mut check = |a: usize, b: usize, line_index: usize| {
        let (a, b) = (position.get_vector3(a), position.get_vector3(b));
        let (mut on_ray, mut on_segment) = (Vector3::default(), Vector3::default());
        let distance_sq = local_ray.distance_sq_to_segment(&a, &b, Some(&mut on_ray), Some(&mut on_segment));
        if distance_sq as f64 > threshold_sq {
            return;
        }
        // back to world space for the distance along the ray
        on_ray.apply_matrix4(&matrix_world);
        let distance = raycaster.ray.origin.distance_to(&on_ray);
        if distance < raycaster.near || distance > raycaster.far {
            return;
        }
        on_segment.apply_matrix4(&matrix_world);
        intersects.push(Intersection {
            distance,
            point: on_segment,
            object,
            line_index: Some(line_index as u32),
            face_index: 0,
            face: Face { a: 0, b: 0, c: 0, normal: Vector3::default(), material_index: 0 },
            barycoord: Vector3::default(),
            uv: None,
            normal: None,
            instance_id: None,
        });
    };

    let step = if primitive == Primitive::LineSegments { 2 } else { 1 };
    let mut i = start;
    while i + 1 < end {
        check(vertex(i), vertex(i + 1), i);
        i += step;
    }
    // the closing segment is tested even for a single vertex, as three.js does
    if primitive == Primitive::LineLoop && end > start {
        check(vertex(end - 1), vertex(start), end - 1);
    }
}

/// Every vertex closer to the ray than `points_threshold` is a hit; `line_index` holds
/// the vertex (through the index, if any).
fn raycast_points(world: &World, object: Entity, raycaster: &Raycaster, intersects: &mut Vec<Intersection>) {
    let Some(renderable) = world.renderable(object) else {
        return;
    };
    let (Some(geometry), Some(transform)) = (world.geometry(renderable.geometry), world.transform(object)) else {
        return;
    };
    let Some(position) = geometry.get_attribute("position") else {
        return;
    };
    let matrix_world = transform.matrix_world;
    let threshold = raycaster.params.points_threshold;

    let mut sphere: Sphere = match geometry.bounding_sphere {
        Some(sphere) => sphere,
        None => {
            let mut measured = geometry.clone();
            measured.compute_bounding_sphere();
            measured.bounding_sphere.unwrap_or_default()
        }
    };
    sphere.apply_matrix4(&matrix_world);
    sphere.radius += threshold;
    if !raycaster.ray.intersects_sphere(&sphere) {
        return;
    }

    let mut inverse = matrix_world;
    inverse.invert();
    let mut local_ray = raycaster.ray;
    local_ray.apply_matrix4(&inverse);

    let scale = transform.scale;
    let local_threshold = threshold as f64 / ((scale.x as f64 + scale.y as f64 + scale.z as f64) / 3.0);
    let threshold_sq = local_threshold * local_threshold;

    let index = geometry.get_index();
    let count = index.map_or(position.count(), |index| index.count());
    let start = (geometry.draw_range.start as usize).min(count);
    let end = count.min(geometry.draw_range.start.saturating_add(geometry.draw_range.count) as usize);

    for i in start..end {
        let vertex = index.map_or(i, |index| index.array.get(i) as usize);
        let point = position.get_vector3(vertex);
        if (local_ray.distance_sq_to_point(&point) as f64) >= threshold_sq {
            continue;
        }
        let mut closest = local_ray.closest_point_to_point(&point);
        closest.apply_matrix4(&matrix_world);
        let distance = raycaster.ray.origin.distance_to(&closest);
        if distance < raycaster.near || distance > raycaster.far {
            continue;
        }
        intersects.push(Intersection {
            distance,
            point: closest,
            object,
            line_index: Some(vertex as u32),
            face_index: 0,
            face: Face { a: 0, b: 0, c: 0, normal: Vector3::default(), material_index: 0 },
            barycoord: Vector3::default(),
            uv: None,
            normal: None,
            instance_id: None,
        });
    }
}

fn collect(world: &World, raycaster: &Raycaster, object: Entity, recursive: bool, intersects: &mut Vec<Intersection>) {
    let mut visit = |e: Entity| {
        if world.visibility(e).is_some_and(|v| v.layers.test(&raycaster.layers)) {
            raycast_mesh(world, e, raycaster, intersects);
        }
    };

    if recursive {
        world.traverse(object, visit);
    } else {
        visit(object);
    }
}

fn sort(intersects: &mut [Intersection]) {
    intersects.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(core::cmp::Ordering::Equal));
}

/// Hits of the ray on `object` and, with `recursive`, on everything below it, nearest
/// first. Objects whose layers do not overlap the raycaster's are skipped, but their
/// descendants are still tested.
pub fn intersect_object(world: &World, raycaster: &Raycaster, object: Entity, recursive: bool) -> Vec<Intersection> {
    let mut intersects = Vec::new();
    collect(world, raycaster, object, recursive, &mut intersects);
    sort(&mut intersects);
    intersects
}

/// Hits of the ray on the instances of the mesh `object`, nearest first. `matrices`
/// holds one column-major matrix (16 floats) per instance, each placing the instance
/// within the object; each hit carries its `instance_id`. The object's layers are not
/// tested, as with [`intersect_object`] on a single object.
pub fn intersect_instances(world: &World, raycaster: &Raycaster, object: Entity, matrices: &[f32]) -> Vec<Intersection> {
    let mut intersects = Vec::new();
    let Some(renderable) = world.renderable(object) else {
        return intersects;
    };
    let (Some(geometry), Some(material), Some(transform)) =
        (world.geometry(renderable.geometry), world.material(renderable.material), world.transform(object))
    else {
        return intersects;
    };
    if renderable.primitive != Primitive::Mesh {
        return intersects;
    }
    let sphere = local_bounding_sphere(geometry);
    let mut instance = Matrix4::default();
    let mut matrix_world = Matrix4::default();
    let mut found = Vec::new();
    for (id, elements) in matrices.chunks_exact(16).enumerate() {
        instance.elements.copy_from_slice(elements);
        matrix_world.multiply_matrices(&transform.matrix_world, &instance);
        raycast_triangles(object, geometry, material.side, &sphere, &matrix_world, raycaster, &mut found);
        intersects.extend(found.drain(..).map(|hit| Intersection { instance_id: Some(id as u32), ..hit }));
    }
    sort(&mut intersects);
    intersects
}

/// Like [`intersect_object`] for several objects, with one combined, sorted result.
pub fn intersect_objects(world: &World, raycaster: &Raycaster, objects: &[Entity], recursive: bool) -> Vec<Intersection> {
    let mut intersects = Vec::new();
    for object in objects {
        collect(world, raycaster, *object, recursive, &mut intersects);
    }
    sort(&mut intersects);
    intersects
}

/// Aims the raycaster from a camera through a point of its view. `coords` are
/// normalized device coordinates: x and y from -1 to 1, y up. Returns false if `camera`
/// is not a camera.
pub fn set_from_camera(raycaster: &mut Raycaster, world: &World, camera: Entity, coords: Vector2) -> bool {
    let (Some(component), Some(transform)) = (world.camera(camera), world.transform(camera)) else {
        return false;
    };
    let matrix_world = transform.matrix_world;
    let unproject = |mut v: Vector3| {
        v.apply_matrix4(&component.projection_matrix_inverse).apply_matrix4(&matrix_world);
        v
    };

    match component.projection {
        Projection::Perspective { .. } => {
            raycaster.ray.origin.set_from_matrix_position(&matrix_world);
            let mut direction = unproject(Vector3::new(coords.x, coords.y, 0.5));
            direction.sub(&raycaster.ray.origin).normalize();
            raycaster.ray.direction = direction;
        }
        Projection::Orthographic { .. } => {
            // the origin lies in the plane of the camera
            raycaster.ray.origin = unproject(Vector3::new(coords.x, coords.y, component.projection_matrix.elements[14]));
            let mut direction = Vector3::new(0.0, 0.0, -1.0);
            direction.transform_direction(&matrix_world);
            raycaster.ray.direction = direction;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{box_geometry, plane_geometry};
    use wamr_core::{Camera, Material, Renderable};

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
}
