//! `wamr-objects`: built-in shapes. Each function returns a `BufferGeometry` with
//! `position`, `normal` and `uv` attributes, indexed except for the polyhedra.
//!
//! Coordinates are computed in f64 and rounded once to f32, like the rest of the engine.

#![forbid(unsafe_code)]

pub mod raycast;
mod round;
mod solids;

pub use round::{circle_geometry, cone_geometry, cylinder_geometry, ring_geometry, torus_geometry};
pub use solids::{capsule_geometry, dodecahedron_geometry, icosahedron_geometry, lathe_geometry, octahedron_geometry, polyhedron_geometry, tetrahedron_geometry, torus_knot_geometry};
pub use raycast::{intersect_instances, intersect_object, intersect_objects, set_from_camera, Face, Intersection};

use wamr_core::{AttributeArray, BufferAttribute, BufferGeometry};

#[derive(Default)]
struct Buffers {
    indices: Vec<u32>,
    vertices: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
}

impl Buffers {
    fn into_geometry(self) -> BufferGeometry {
        let mut geometry = BufferGeometry::new();
        geometry.set_index_from_slice(&self.indices);
        for (name, values, item_size) in [("position", self.vertices, 3), ("normal", self.normals, 3), ("uv", self.uvs, 2)] {
            geometry.set_attribute(name, BufferAttribute::new(AttributeArray::Float32(values), item_size, false));
        }
        geometry
    }
}

/// A box centred on the origin. Each side is its own group (material indices 0 to 5:
/// +x, -x, +y, -y, +z, -z), so sides do not share vertices.
///
/// Usual defaults: size 1 and one segment in every direction. Segment counts of zero
/// are treated as one.
pub fn box_geometry(width: f32, height: f32, depth: f32, width_segments: u32, height_segments: u32, depth_segments: u32) -> BufferGeometry {
    let (w, h, d) = (width as f64, height as f64, depth as f64);
    let (ws, hs, ds) = (width_segments.max(1), height_segments.max(1), depth_segments.max(1));

    let mut buffers = Buffers::default();
    let mut groups = Vec::new();
    let mut vertex_count = 0u32;
    let mut group_start = 0u32;

    // (u, v, w) are the axis indices the plane's x, y and depth are written to
    let mut build_plane = |u: usize, v: usize, w_axis: usize, udir: f64, vdir: f64, width: f64, height: f64, depth: f64, grid_x: u32, grid_y: u32, material_index: u32| {
        let segment_width = width / grid_x as f64;
        let segment_height = height / grid_y as f64;
        let (width_half, height_half, depth_half) = (width / 2.0, height / 2.0, depth / 2.0);
        let (grid_x1, grid_y1) = (grid_x + 1, grid_y + 1);

        for iy in 0..grid_y1 {
            let y = iy as f64 * segment_height - height_half;
            for ix in 0..grid_x1 {
                let x = ix as f64 * segment_width - width_half;

                let mut vector = [0.0f64; 3];
                vector[u] = x * udir;
                vector[v] = y * vdir;
                vector[w_axis] = depth_half;
                buffers.vertices.extend(vector.map(|c| c as f32));

                let mut normal = [0.0f32; 3];
                normal[w_axis] = if depth > 0.0 { 1.0 } else { -1.0 };
                buffers.normals.extend(normal);

                buffers.uvs.push((ix as f64 / grid_x as f64) as f32);
                buffers.uvs.push((1.0 - iy as f64 / grid_y as f64) as f32);
            }
        }

        for iy in 0..grid_y {
            for ix in 0..grid_x {
                let a = vertex_count + ix + grid_x1 * iy;
                let b = vertex_count + ix + grid_x1 * (iy + 1);
                let c = vertex_count + (ix + 1) + grid_x1 * (iy + 1);
                let d = vertex_count + (ix + 1) + grid_x1 * iy;
                buffers.indices.extend([a, b, d, b, c, d]);
            }
        }

        let group_count = grid_x * grid_y * 6;
        groups.push((group_start, group_count, material_index));
        group_start += group_count;
        vertex_count += grid_x1 * grid_y1;
    };

    build_plane(2, 1, 0, -1.0, -1.0, d, h, w, ds, hs, 0); // px
    build_plane(2, 1, 0, 1.0, -1.0, d, h, -w, ds, hs, 1); // nx
    build_plane(0, 2, 1, 1.0, 1.0, w, d, h, ws, ds, 2); // py
    build_plane(0, 2, 1, 1.0, -1.0, w, d, -h, ws, ds, 3); // ny
    build_plane(0, 1, 2, 1.0, -1.0, w, h, d, ws, hs, 4); // pz
    build_plane(0, 1, 2, -1.0, -1.0, w, h, -d, ws, hs, 5); // nz

    let mut geometry = buffers.into_geometry();
    for (start, count, material_index) in groups {
        geometry.add_group(start, count, material_index);
    }
    geometry
}

/// A rectangle in the XY plane, centred on the origin and facing +Z.
///
/// Usual defaults: size 1 and one segment in each direction. Segment counts of zero are
/// treated as one.
pub fn plane_geometry(width: f32, height: f32, width_segments: u32, height_segments: u32) -> BufferGeometry {
    let (width, height) = (width as f64, height as f64);
    let (grid_x, grid_y) = (width_segments.max(1), height_segments.max(1));
    let (grid_x1, grid_y1) = (grid_x + 1, grid_y + 1);
    let (segment_width, segment_height) = (width / grid_x as f64, height / grid_y as f64);

    let mut buffers = Buffers::default();

    for iy in 0..grid_y1 {
        let y = iy as f64 * segment_height - height / 2.0;
        for ix in 0..grid_x1 {
            let x = ix as f64 * segment_width - width / 2.0;
            buffers.vertices.extend([x as f32, -y as f32, 0.0]);
            buffers.normals.extend([0.0, 0.0, 1.0]);
            buffers.uvs.push((ix as f64 / grid_x as f64) as f32);
            buffers.uvs.push((1.0 - iy as f64 / grid_y as f64) as f32);
        }
    }

    for iy in 0..grid_y {
        for ix in 0..grid_x {
            let a = ix + grid_x1 * iy;
            let b = ix + grid_x1 * (iy + 1);
            let c = (ix + 1) + grid_x1 * (iy + 1);
            let d = (ix + 1) + grid_x1 * iy;
            buffers.indices.extend([a, b, d, b, c, d]);
        }
    }

    buffers.into_geometry()
}

/// A sphere, or with the start and length angles a part of one. `phi` runs around the
/// y-axis, `theta` from the top pole down.
///
/// Usual defaults: radius 1, 32 x 16 segments, `phi` from 0 for 2 PI, `theta` from 0
/// for PI. At least 3 width and 2 height segments are used.
pub fn sphere_geometry(radius: f32, width_segments: u32, height_segments: u32, phi_start: f32, phi_length: f32, theta_start: f32, theta_length: f32) -> BufferGeometry {
    let radius = radius as f64;
    let (phi_start, phi_length, theta_start, theta_length) = (phi_start as f64, phi_length as f64, theta_start as f64, theta_length as f64);
    let (width_segments, height_segments) = (width_segments.max(3), height_segments.max(2));
    let pi = core::f64::consts::PI;
    let theta_end = (theta_start + theta_length).min(pi);

    let mut buffers = Buffers::default();
    let row = width_segments + 1;

    for iy in 0..=height_segments {
        let v = iy as f64 / height_segments as f64;
        let theta = theta_start + v * theta_length;
        let y = radius * theta.cos();
        let ring_radius = (radius * radius - y * y).sqrt();

        // the poles get a half-segment shift so their triangles are not skewed
        let u_offset = if iy == 0 && theta_start == 0.0 {
            0.5 / width_segments as f64
        } else if iy == height_segments && theta_end == pi {
            -0.5 / width_segments as f64
        } else {
            0.0
        };

        for ix in 0..=width_segments {
            let u = ix as f64 / width_segments as f64;
            let phi = phi_start + u * phi_length;

            let vertex = [-ring_radius * phi.cos(), y, ring_radius * phi.sin()];
            buffers.vertices.extend(vertex.map(|c| c as f32));

            let length = (vertex[0] * vertex[0] + vertex[1] * vertex[1] + vertex[2] * vertex[2]).sqrt();
            let inverse = 1.0 / if length == 0.0 || length.is_nan() { 1.0 } else { length };
            buffers.normals.extend(vertex.map(|c| (c * inverse) as f32));

            buffers.uvs.extend([(u + u_offset) as f32, (1.0 - v) as f32]);
        }
    }

    for iy in 0..height_segments {
        for ix in 0..width_segments {
            let a = iy * row + ix + 1;
            let b = iy * row + ix;
            let c = (iy + 1) * row + ix;
            let d = (iy + 1) * row + ix + 1;

            if iy != 0 || theta_start > 0.0 {
                buffers.indices.extend([a, b, d]);
            }
            if iy != height_segments - 1 || theta_end < pi {
                buffers.indices.extend([b, c, d]);
            }
        }
    }

    buffers.into_geometry()
}

#[cfg(test)]
mod tests {
    use super::*;
    use wamr_core::AttributeAccess;
    use wamr_math::Vector3;

    fn counts(g: &BufferGeometry) -> (usize, usize) {
        (g.get_attribute("position").unwrap().count(), g.get_index().unwrap().count())
    }

    #[test]
    fn box_has_six_separate_sides() {
        let mut g = box_geometry(2.0, 4.0, 6.0, 1, 1, 1);
        assert_eq!(counts(&g), (24, 36));
        assert_eq!(g.groups.len(), 6);
        assert_eq!((g.groups[5].start, g.groups[5].count, g.groups[5].material_index), (30, 6, 5));
        g.compute_bounding_box();
        let b = g.bounding_box.unwrap();
        assert_eq!((b.min, b.max), (Vector3::new(-1.0, -2.0, -3.0), Vector3::new(1.0, 2.0, 3.0)));
        // first side faces +x
        assert_eq!(g.get_attribute("normal").unwrap().get_vector3(0), Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn box_segments_subdivide_each_side() {
        let g = box_geometry(1.0, 1.0, 1.0, 2, 3, 4);
        // vertices: 2 * (4+1)(3+1) + 2 * (2+1)(4+1) + 2 * (2+1)(3+1)
        assert_eq!(counts(&g), (40 + 30 + 24, (2 * 12 + 2 * 8 + 2 * 6) * 6));
    }

    #[test]
    fn box_normals_match_the_winding() {
        let g = box_geometry(1.0, 2.0, 3.0, 1, 2, 1);
        let stored: Vec<Vector3> = (0..counts(&g).0).map(|i| g.get_attribute("normal").unwrap().get_vector3(i)).collect();
        let mut computed = g.clone();
        computed.compute_vertex_normals();
        for (i, n) in stored.iter().enumerate() {
            assert!(computed.get_attribute("normal").unwrap().get_vector3(i).distance_to(n) < 1e-6);
        }
    }

    #[test]
    fn plane_faces_positive_z() {
        let g = plane_geometry(2.0, 4.0, 2, 1);
        assert_eq!(counts(&g), (6, 12));
        let p = g.get_attribute("position").unwrap();
        // first vertex is the top left corner, with uv (0, 1)
        assert_eq!(p.get_vector3(0), Vector3::new(-1.0, 2.0, 0.0));
        assert_eq!(g.get_attribute("uv").unwrap().get_vector2(0), wamr_math::Vector2::new(0.0, 1.0));
        let mut computed = g.clone();
        computed.compute_vertex_normals();
        assert_eq!(computed.get_attribute("normal").unwrap().get_vector3(3), Vector3::new(0.0, 0.0, 1.0));
    }

    #[test]
    fn sphere_vertices_lie_on_the_radius_and_poles_drop_degenerate_triangles() {
        let g = sphere_geometry(2.0, 8, 4, 0.0, core::f32::consts::TAU, 0.0, core::f32::consts::PI);
        // (8+1) * (4+1) vertices; one triangle per segment in the two pole rows, two elsewhere
        assert_eq!(counts(&g), (45, (8 + 8 + 2 * 8 * 2) * 3));
        let (p, n) = (g.get_attribute("position").unwrap(), g.get_attribute("normal").unwrap());
        for i in 0..p.count() {
            assert!((p.get_vector3(i).length() - 2.0).abs() < 1e-6);
            let mut scaled = n.get_vector3(i);
            scaled.multiply_scalar(2.0);
            assert!(scaled.distance_to(&p.get_vector3(i)) < 1e-5);
        }
    }

    #[test]
    fn sphere_clamps_segment_counts() {
        assert_eq!(counts(&sphere_geometry(1.0, 0, 0, 0.0, core::f32::consts::TAU, 0.0, core::f32::consts::PI)).0, 4 * 3);
    }
}
