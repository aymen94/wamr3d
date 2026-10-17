//! Polyhedra (tetrahedron, octahedron, icosahedron, dodecahedron and any other given as
//! vertices and faces), the torus knot, lathe and capsule shapes.

use super::Buffers;
use wamr_core::{AttributeArray, BufferAttribute, BufferGeometry};

type V3 = [f64; 3];

fn lerp(a: V3, b: V3, t: f64) -> V3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn normalized(v: V3) -> V3 {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let divisor = if length == 0.0 || length.is_nan() { 1.0 } else { length };
    v.map(|c| c / divisor)
}

fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn azimuth(v: V3) -> f64 {
    v[2].atan2(-v[0])
}

fn inclination(v: V3) -> f64 {
    (-v[1]).atan2((v[0] * v[0] + v[2] * v[2]).sqrt())
}

/// A polyhedron from `vertices` (xyz triples) and triangular faces `indices`, each face
/// split into `detail + 1` rows of triangles, every vertex pushed out to `radius`. The
/// result is not indexed: every triangle has its own vertices. Normals are flat for
/// detail 0 and point away from the centre otherwise; uvs are spherical.
pub fn polyhedron_geometry(vertices: &[f32], indices: &[u32], radius: f32, detail: u32) -> BufferGeometry {
    let corner = |i: u32| -> V3 {
        let s = i as usize * 3;
        [vertices[s] as f64, vertices[s + 1] as f64, vertices[s + 2] as f64]
    };
    let mut points: Vec<V3> = Vec::new();

    for face in indices.chunks_exact(3) {
        if face.iter().any(|&i| (i as usize + 1) * 3 > vertices.len()) {
            continue;
        }
        let (a, b, c) = (corner(face[0]), corner(face[1]), corner(face[2]));
        let cols = detail as usize + 1;
        // v[i][j]: row i from the a-b edge towards c, column j across the row
        let mut v: Vec<Vec<V3>> = Vec::with_capacity(cols + 1);
        for i in 0..=cols {
            let aj = lerp(a, c, i as f64 / cols as f64);
            let bj = lerp(b, c, i as f64 / cols as f64);
            let rows = cols - i;
            v.push((0..=rows).map(|j| if j == 0 && i == cols { aj } else { lerp(aj, bj, j as f64 / rows as f64) }).collect());
        }
        for i in 0..cols {
            for j in 0..2 * (cols - i) - 1 {
                let k = j / 2;
                if j % 2 == 0 {
                    points.extend([v[i][k + 1], v[i + 1][k], v[i][k]]);
                } else {
                    points.extend([v[i][k + 1], v[i + 1][k + 1], v[i + 1][k]]);
                }
            }
        }
    }

    let radius = radius as f64;
    for p in &mut points {
        *p = normalized(*p).map(|c| c * radius);
    }

    let mut uvs: Vec<[f64; 2]> = points.iter().map(|&p| [azimuth(p) / 2.0 / core::f64::consts::PI + 0.5, 1.0 - (inclination(p) / core::f64::consts::PI + 0.5)]).collect();

    // a vertex at the seam takes the side of its face; a pole takes its face's azimuth
    for (triangle, uv) in points.chunks_exact(3).zip(uvs.chunks_exact_mut(3)) {
        let centroid = [(triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3.0, (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3.0, (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3.0];
        let azi = azimuth(centroid);
        for (p, uv) in triangle.iter().zip(uv.iter_mut()) {
            if azi < 0.0 && uv[0] == 1.0 {
                uv[0] -= 1.0;
            }
            if p[0] == 0.0 && p[2] == 0.0 {
                uv[0] = azi / 2.0 / core::f64::consts::PI + 0.5;
            }
        }
    }
    for uv in uvs.chunks_exact_mut(3) {
        let (x0, x1, x2) = (uv[0][0], uv[1][0], uv[2][0]);
        let (max, min) = (x0.max(x1).max(x2), x0.min(x1).min(x2));
        if max > 0.9 && min < 0.1 {
            for value in uv.iter_mut() {
                if value[0] < 0.2 {
                    value[0] += 1.0;
                }
            }
        }
    }

    let positions: Vec<f32> = points.iter().flat_map(|p| p.map(|c| c as f32)).collect();
    let mut geometry = BufferGeometry::new();
    geometry.set_attribute("position", BufferAttribute::new(AttributeArray::Float32(positions.clone()), 3, false));
    geometry.set_attribute("normal", BufferAttribute::new(AttributeArray::Float32(positions), 3, false));
    geometry.set_attribute("uv", BufferAttribute::new(AttributeArray::Float32(uvs.iter().flat_map(|uv| uv.map(|c| c as f32)).collect()), 2, false));
    if detail == 0 {
        geometry.compute_vertex_normals();
    } else {
        geometry.normalize_normals();
    }
    geometry
}

/// Usual defaults for every platonic solid: radius 1, detail 0.
pub fn tetrahedron_geometry(radius: f32, detail: u32) -> BufferGeometry {
    let vertices = [1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0];
    let indices = [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1];
    polyhedron_geometry(&vertices, &indices, radius, detail)
}

pub fn octahedron_geometry(radius: f32, detail: u32) -> BufferGeometry {
    let vertices = [1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0];
    let indices = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2];
    polyhedron_geometry(&vertices, &indices, radius, detail)
}

pub fn icosahedron_geometry(radius: f32, detail: u32) -> BufferGeometry {
    let t = ((1.0 + 5f64.sqrt()) / 2.0) as f32;
    #[rustfmt::skip]
    let vertices = [
        -1.0, t, 0.0, 1.0, t, 0.0, -1.0, -t, 0.0, 1.0, -t, 0.0,
        0.0, -1.0, t, 0.0, 1.0, t, 0.0, -1.0, -t, 0.0, 1.0, -t,
        t, 0.0, -1.0, t, 0.0, 1.0, -t, 0.0, -1.0, -t, 0.0, 1.0,
    ];
    #[rustfmt::skip]
    let indices = [
        0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
        1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
        3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
        4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
    ];
    polyhedron_geometry(&vertices, &indices, radius, detail)
}

pub fn dodecahedron_geometry(radius: f32, detail: u32) -> BufferGeometry {
    let t = (1.0 + 5f64.sqrt()) / 2.0;
    let (t, r) = (t as f32, (1.0 / t) as f32);
    #[rustfmt::skip]
    let vertices = [
        -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0,
        1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0,
        0.0, -r, -t, 0.0, -r, t, 0.0, r, -t, 0.0, r, t,
        -r, -t, 0.0, -r, t, 0.0, r, -t, 0.0, r, t, 0.0,
        -t, 0.0, -r, t, 0.0, -r, -t, 0.0, r, t, 0.0, r,
    ];
    #[rustfmt::skip]
    let indices = [
        3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15,
        17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10,
        0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15,
        2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3,
        4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7,
        19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
    ];
    polyhedron_geometry(&vertices, &indices, radius, detail)
}

/// A tube of radius `tube` wound `p` times around the axis and `q` times through the
/// hole of a torus of radius `radius`.
///
/// Usual defaults: radius 1, tube 0.4, 64 tubular and 8 radial segments, p 2, q 3.
pub fn torus_knot_geometry(radius: f32, tube: f32, tubular_segments: u32, radial_segments: u32, p: f32, q: f32) -> BufferGeometry {
    let (radius, tube, p, q) = (radius as f64, tube as f64, p as f64, q as f64);
    let curve = |u: f64| -> V3 {
        let q_over_p = q / p * u;
        let cs = q_over_p.cos();
        [radius * (2.0 + cs) * 0.5 * u.cos(), radius * (2.0 + cs) * u.sin() * 0.5, radius * q_over_p.sin() * 0.5]
    };

    let mut buffers = Buffers::default();
    for i in 0..=tubular_segments {
        let u = i as f64 / tubular_segments as f64 * p * core::f64::consts::PI * 2.0;
        let p1 = curve(u);
        let p2 = curve(u + 0.01);
        // a frame along the curve: tangent, then binormal and normal from it
        let t = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
        let n = [p2[0] + p1[0], p2[1] + p1[1], p2[2] + p1[2]];
        let b = cross(t, n);
        let n = normalized(cross(b, t));
        let b = normalized(b);

        for j in 0..=radial_segments {
            let v = j as f64 / radial_segments as f64 * core::f64::consts::PI * 2.0;
            let (cx, cy) = (-tube * v.cos(), tube * v.sin());
            let vertex = [p1[0] + (cx * n[0] + cy * b[0]), p1[1] + (cx * n[1] + cy * b[1]), p1[2] + (cx * n[2] + cy * b[2])];
            buffers.vertices.extend(vertex.map(|c| c as f32));
            buffers.normals.extend(normalized([vertex[0] - p1[0], vertex[1] - p1[1], vertex[2] - p1[2]]).map(|c| c as f32));
            buffers.uvs.extend([(i as f64 / tubular_segments as f64) as f32, (j as f64 / radial_segments as f64) as f32]);
        }
    }

    let row = radial_segments + 1;
    for j in 1..=tubular_segments {
        for i in 1..=radial_segments {
            let a = row * (j - 1) + (i - 1);
            let b = row * j + (i - 1);
            let c = row * j + i;
            let d = row * (j - 1) + i;
            buffers.indices.extend([a, b, d, b, c, d]);
        }
    }
    buffers.into_geometry()
}

/// The surface swept by turning the profile `points` (x, y pairs; x is the distance
/// from the y-axis) around the y-axis.
///
/// Usual defaults: 12 segments, a full turn from angle 0.
pub fn lathe_geometry(points: &[f32], segments: u32, phi_start: f32, phi_length: f32) -> BufferGeometry {
    let points: Vec<[f64; 2]> = points.chunks_exact(2).map(|p| [p[0] as f64, p[1] as f64]).collect();
    let count = points.len();
    let mut buffers = Buffers::default();
    if count < 2 {
        return buffers.into_geometry();
    }
    let segments = segments.max(1);
    let phi_start = phi_start as f64;
    let phi_length = (phi_length as f64).clamp(0.0, core::f64::consts::PI * 2.0);

    // profile normals: perpendicular to each edge, averaged with the previous edge's
    let mut profile_normals: Vec<[f64; 2]> = Vec::with_capacity(count);
    let mut previous = [0.0, 0.0];
    for j in 0..count {
        if j == count - 1 {
            profile_normals.push(previous);
            continue;
        }
        let (dx, dy) = (points[j + 1][0] - points[j][0], points[j + 1][1] - points[j][1]);
        let current = [dy, -dx];
        let sum = if j == 0 { current } else { [current[0] + previous[0], current[1] + previous[1]] };
        let n = normalized([sum[0], sum[1], 0.0]);
        profile_normals.push([n[0], n[1]]);
        previous = current;
    }

    for i in 0..=segments {
        let phi = phi_start + i as f64 * (1.0 / segments as f64) * phi_length;
        let (sin, cos) = phi.sin_cos();
        for (j, point) in points.iter().enumerate() {
            buffers.vertices.extend([(point[0] * sin) as f32, point[1] as f32, (point[0] * cos) as f32]);
            buffers.uvs.extend([(i as f64 / segments as f64) as f32, (j as f64 / (count - 1) as f64) as f32]);
            let n = profile_normals[j];
            buffers.normals.extend([(n[0] * sin) as f32, n[1] as f32, (n[0] * cos) as f32]);
        }
    }

    let count = count as u32;
    for i in 0..segments {
        for j in 0..count - 1 {
            let base = j + i * count;
            let (a, b, c, d) = (base, base + count, base + count + 1, base + 1);
            buffers.indices.extend([a, b, d, c, d, b]);
        }
    }
    buffers.into_geometry()
}

/// A cylinder of `height` along the y-axis capped by two half spheres of `radius`.
///
/// Usual defaults: radius 1, height 1, 4 cap segments, 8 radial segments, 1 height
/// segment. At least 1 cap, 3 radial and 1 height segment are used.
pub fn capsule_geometry(radius: f32, height: f32, cap_segments: u32, radial_segments: u32, height_segments: u32) -> BufferGeometry {
    let (radius, height) = (radius as f64, (height as f64).max(0.0));
    let (cap_segments, radial_segments, height_segments) = (cap_segments.max(1), radial_segments.max(3), height_segments.max(1));
    let half_height = height / 2.0;
    let cap_arc_length = core::f64::consts::FRAC_PI_2 * radius;
    let total_arc_length = 2.0 * cap_arc_length + height;
    let vertical_segments = cap_segments * 2 + height_segments;
    let row = radial_segments + 1;

    let mut buffers = Buffers::default();
    for iy in 0..=vertical_segments {
        let (profile_y, profile_radius, normal_y, arc_length);
        if iy <= cap_segments {
            let progress = iy as f64 / cap_segments as f64;
            let angle = progress * core::f64::consts::FRAC_PI_2;
            profile_y = -half_height - radius * angle.cos();
            profile_radius = radius * angle.sin();
            normal_y = -radius * angle.cos();
            arc_length = progress * cap_arc_length;
        } else if iy <= cap_segments + height_segments {
            let progress = (iy - cap_segments) as f64 / height_segments as f64;
            profile_y = -half_height + progress * height;
            profile_radius = radius;
            normal_y = 0.0;
            arc_length = cap_arc_length + progress * height;
        } else {
            let progress = (iy - cap_segments - height_segments) as f64 / cap_segments as f64;
            let angle = progress * core::f64::consts::FRAC_PI_2;
            profile_y = half_height + radius * angle.sin();
            profile_radius = radius * angle.cos();
            normal_y = radius * angle.sin();
            arc_length = cap_arc_length + height + progress * cap_arc_length;
        }
        let v = (arc_length / total_arc_length).clamp(0.0, 1.0);
        // the poles get a half-segment shift so their triangles are not skewed
        let u_offset = if iy == 0 {
            0.5 / radial_segments as f64
        } else if iy == vertical_segments {
            -0.5 / radial_segments as f64
        } else {
            0.0
        };

        for ix in 0..=radial_segments {
            let u = ix as f64 / radial_segments as f64;
            let (sin_theta, cos_theta) = (u * core::f64::consts::PI * 2.0).sin_cos();
            buffers.vertices.extend([(-profile_radius * cos_theta) as f32, profile_y as f32, (profile_radius * sin_theta) as f32]);
            buffers.normals.extend(normalized([-profile_radius * cos_theta, normal_y, profile_radius * sin_theta]).map(|c| c as f32));
            buffers.uvs.extend([(u + u_offset) as f32, v as f32]);
        }

        if iy > 0 {
            let previous = (iy - 1) * row;
            for ix in 0..radial_segments {
                let (i1, i2, i3, i4) = (previous + ix, previous + ix + 1, iy * row + ix, iy * row + ix + 1);
                buffers.indices.extend([i1, i2, i3, i2, i4, i3]);
            }
        }
    }
    buffers.into_geometry()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;
    use wamr_core::AttributeAccess;

    fn vertices(g: &BufferGeometry) -> usize {
        g.get_attribute("position").unwrap().count()
    }

    #[test]
    fn platonic_solids_are_unindexed_triangles_on_the_sphere() {
        assert_eq!(vertices(&tetrahedron_geometry(1.0, 0)), 4 * 3);
        assert_eq!(vertices(&octahedron_geometry(1.0, 0)), 8 * 3);
        assert_eq!(vertices(&icosahedron_geometry(1.0, 0)), 20 * 3);
        assert_eq!(vertices(&dodecahedron_geometry(1.0, 0)), 36 * 3);
        // each subdivision level splits a face into (detail + 1)^2 triangles
        let g = icosahedron_geometry(2.0, 2);
        assert!(g.get_index().is_none());
        assert_eq!(vertices(&g), 20 * 9 * 3);
        let p = g.get_attribute("position").unwrap().get_vector3(5);
        assert!((p.length() - 2.0).abs() < 1e-5);
    }

    #[test]
    fn torus_knot_lathe_and_capsule_sizes() {
        let knot = torus_knot_geometry(1.0, 0.4, 64, 8, 2.0, 3.0);
        assert_eq!((vertices(&knot), knot.get_index().unwrap().count()), (65 * 9, 64 * 8 * 6));
        let lathe = lathe_geometry(&[0.0, -0.5, 0.5, 0.0, 0.0, 0.5], 12, 0.0, TAU);
        assert_eq!((vertices(&lathe), lathe.get_index().unwrap().count()), (13 * 3, 12 * 2 * 6));
        let capsule = capsule_geometry(1.0, 1.0, 4, 8, 1);
        assert_eq!((vertices(&capsule), capsule.get_index().unwrap().count()), (10 * 9, 9 * 8 * 6));
        // the bottom pole sits half the height plus the radius below the centre
        assert_eq!(capsule.get_attribute("position").unwrap().get_vector3(0).y, -1.5);
    }
}
