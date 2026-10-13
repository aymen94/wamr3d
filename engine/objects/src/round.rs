//! Shapes built around an axis: cylinder (and cone), circle, ring and torus.

use super::Buffers;
use wamr_core::BufferGeometry;

fn push(out: &mut Vec<f32>, values: &[f64]) {
    out.extend(values.iter().map(|v| *v as f32));
}

fn normalized(v: [f64; 3]) -> [f64; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let divisor = if length == 0.0 || length.is_nan() { 1.0 } else { length };
    v.map(|c| c / divisor)
}

/// A cylinder along the Y axis, centred on the origin. A radius of zero at one end
/// makes a cone. Groups: 0 the side, 1 the top cap, 2 the bottom cap.
///
/// Usual defaults: radii 1, height 1, 32 radial segments, 1 height segment, closed
/// ends, a full turn starting at angle 0.
#[allow(clippy::too_many_arguments)]
pub fn cylinder_geometry(radius_top: f32, radius_bottom: f32, height: f32, radial_segments: u32, height_segments: u32, open_ended: bool, theta_start: f32, theta_length: f32) -> BufferGeometry {
    let (radius_top, radius_bottom, height) = (radius_top as f64, radius_bottom as f64, height as f64);
    let (theta_start, theta_length) = (theta_start as f64, theta_length as f64);
    let half_height = height / 2.0;

    let mut buffers = Buffers::default();
    let mut groups = Vec::new();
    let mut index = 0u32;
    let mut group_start = 0u32;

    // the side
    let slope = (radius_bottom - radius_top) / height;
    let row = radial_segments + 1;

    for y in 0..=height_segments {
        let v = y as f64 / height_segments as f64;
        let radius = v * (radius_bottom - radius_top) + radius_top;

        for x in 0..=radial_segments {
            let u = x as f64 / radial_segments as f64;
            let (sin_theta, cos_theta) = (u * theta_length + theta_start).sin_cos();

            push(&mut buffers.vertices, &[radius * sin_theta, -v * height + half_height, radius * cos_theta]);
            push(&mut buffers.normals, &normalized([sin_theta, slope, cos_theta]));
            push(&mut buffers.uvs, &[u, 1.0 - v]);
            index += 1;
        }
    }

    let mut group_count = 0;
    for x in 0..radial_segments {
        for y in 0..height_segments {
            let a = y * row + x;
            let b = (y + 1) * row + x;
            let c = (y + 1) * row + x + 1;
            let d = y * row + x + 1;

            // a zero radius collapses the end row, so its triangle would be degenerate
            if radius_top > 0.0 || y != 0 {
                buffers.indices.extend([a, b, d]);
                group_count += 3;
            }
            if radius_bottom > 0.0 || y != height_segments - 1 {
                buffers.indices.extend([b, c, d]);
                group_count += 3;
            }
        }
    }
    groups.push((group_start, group_count, 0));
    group_start += group_count;

    let mut cap = |top: bool, buffers: &mut Buffers| {
        let radius = if top { radius_top } else { radius_bottom };
        let sign = if top { 1.0 } else { -1.0 };
        let center_start = index;

        // one centre vertex per segment, so each triangle gets its own
        for _ in 1..=radial_segments {
            push(&mut buffers.vertices, &[0.0, half_height * sign, 0.0]);
            push(&mut buffers.normals, &[0.0, sign, 0.0]);
            push(&mut buffers.uvs, &[0.5, 0.5]);
            index += 1;
        }
        let center_end = index;

        for x in 0..=radial_segments {
            let u = x as f64 / radial_segments as f64;
            let (sin_theta, cos_theta) = (u * theta_length + theta_start).sin_cos();

            push(&mut buffers.vertices, &[radius * sin_theta, half_height * sign, radius * cos_theta]);
            push(&mut buffers.normals, &[0.0, sign, 0.0]);
            push(&mut buffers.uvs, &[cos_theta * 0.5 + 0.5, sin_theta * 0.5 * sign + 0.5]);
            index += 1;
        }

        for x in 0..radial_segments {
            let (c, i) = (center_start + x, center_end + x);
            buffers.indices.extend(if top { [i, i + 1, c] } else { [i + 1, i, c] });
        }
        groups.push((group_start, radial_segments * 3, if top { 1 } else { 2 }));
        group_start += radial_segments * 3;
    };

    if !open_ended {
        if radius_top > 0.0 {
            cap(true, &mut buffers);
        }
        if radius_bottom > 0.0 {
            cap(false, &mut buffers);
        }
    }

    let mut geometry = buffers.into_geometry();
    for (start, count, material_index) in groups {
        geometry.add_group(start, count, material_index);
    }
    geometry
}

/// A cone along the Y axis with its tip at the top.
///
/// Usual defaults: radius 1, height 1, 32 radial segments, 1 height segment, a closed
/// base, a full turn starting at angle 0.
pub fn cone_geometry(radius: f32, height: f32, radial_segments: u32, height_segments: u32, open_ended: bool, theta_start: f32, theta_length: f32) -> BufferGeometry {
    cylinder_geometry(0.0, radius, height, radial_segments, height_segments, open_ended, theta_start, theta_length)
}

/// A disc in the XY plane facing +Z, as a fan around a centre vertex.
///
/// Usual defaults: radius 1, 32 segments, a full turn starting at angle 0. Fewer than
/// three segments are treated as three.
pub fn circle_geometry(radius: f32, segments: u32, theta_start: f32, theta_length: f32) -> BufferGeometry {
    let (radius, theta_start, theta_length) = (radius as f64, theta_start as f64, theta_length as f64);
    let segments = segments.max(3);

    let mut buffers = Buffers::default();
    push(&mut buffers.vertices, &[0.0, 0.0, 0.0]);
    push(&mut buffers.normals, &[0.0, 0.0, 1.0]);
    push(&mut buffers.uvs, &[0.5, 0.5]);

    for s in 0..=segments {
        let segment = theta_start + s as f64 / segments as f64 * theta_length;
        let (x, y) = (radius * segment.cos(), radius * segment.sin());
        push(&mut buffers.vertices, &[x, y, 0.0]);
        push(&mut buffers.normals, &[0.0, 0.0, 1.0]);
        push(&mut buffers.uvs, &[(x / radius + 1.0) / 2.0, (y / radius + 1.0) / 2.0]);
    }

    for i in 1..=segments {
        buffers.indices.extend([i, i + 1, 0]);
    }

    buffers.into_geometry()
}

/// A flat ring in the XY plane facing +Z.
///
/// Usual defaults: inner radius 0.5, outer radius 1, 32 segments around, 1 across, a
/// full turn starting at angle 0. At least 3 segments around and 1 across are used.
pub fn ring_geometry(inner_radius: f32, outer_radius: f32, theta_segments: u32, phi_segments: u32, theta_start: f32, theta_length: f32) -> BufferGeometry {
    let (inner_radius, outer_radius) = (inner_radius as f64, outer_radius as f64);
    let (theta_start, theta_length) = (theta_start as f64, theta_length as f64);
    let (theta_segments, phi_segments) = (theta_segments.max(3), phi_segments.max(1));

    let mut buffers = Buffers::default();
    let mut radius = inner_radius;
    let radius_step = (outer_radius - inner_radius) / phi_segments as f64;

    for _ in 0..=phi_segments {
        for i in 0..=theta_segments {
            let segment = theta_start + i as f64 / theta_segments as f64 * theta_length;
            let (x, y) = (radius * segment.cos(), radius * segment.sin());
            push(&mut buffers.vertices, &[x, y, 0.0]);
            push(&mut buffers.normals, &[0.0, 0.0, 1.0]);
            push(&mut buffers.uvs, &[(x / outer_radius + 1.0) / 2.0, (y / outer_radius + 1.0) / 2.0]);
        }
        // accumulated, not recomputed, so the outer row carries the same rounding
        radius += radius_step;
    }

    for j in 0..phi_segments {
        let level = j * (theta_segments + 1);
        for i in 0..theta_segments {
            let a = i + level;
            let b = a + theta_segments + 1;
            let c = a + theta_segments + 2;
            let d = a + 1;
            buffers.indices.extend([a, b, d, b, c, d]);
        }
    }

    buffers.into_geometry()
}

/// A torus around the Z axis. `radius` is from the centre to the middle of the tube,
/// `tube` the radius of the tube.
///
/// Usual defaults: radius 1, tube 0.4, 12 radial segments, 48 tubular segments, a full
/// arc, and a full turn of the tube starting at angle 0.
pub fn torus_geometry(radius: f32, tube: f32, radial_segments: u32, tubular_segments: u32, arc: f32, theta_start: f32, theta_length: f32) -> BufferGeometry {
    let (radius, tube, arc) = (radius as f64, tube as f64, arc as f64);
    let (theta_start, theta_length) = (theta_start as f64, theta_length as f64);

    let mut buffers = Buffers::default();

    for j in 0..=radial_segments {
        let v = theta_start + j as f64 / radial_segments as f64 * theta_length;

        for i in 0..=tubular_segments {
            let u = i as f64 / tubular_segments as f64 * arc;
            let vertex = [(radius + tube * v.cos()) * u.cos(), (radius + tube * v.cos()) * u.sin(), tube * v.sin()];
            push(&mut buffers.vertices, &vertex);
            push(&mut buffers.normals, &normalized([vertex[0] - radius * u.cos(), vertex[1] - radius * u.sin(), vertex[2]]));
            push(&mut buffers.uvs, &[i as f64 / tubular_segments as f64, j as f64 / radial_segments as f64]);
        }
    }

    let row = tubular_segments + 1;
    for j in 1..=radial_segments {
        for i in 1..=tubular_segments {
            let a = row * j + i - 1;
            let b = row * (j - 1) + i - 1;
            let c = row * (j - 1) + i;
            let d = row * j + i;
            buffers.indices.extend([a, b, d, b, c, d]);
        }
    }

    buffers.into_geometry()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::TAU;
    use wamr_core::AttributeAccess;

    fn counts(g: &BufferGeometry) -> (usize, usize) {
        (g.get_attribute("position").unwrap().count(), g.get_index().unwrap().count())
    }

    #[test]
    fn cylinder_has_a_side_and_two_caps() {
        let g = cylinder_geometry(1.0, 1.0, 2.0, 8, 1, false, 0.0, TAU);
        // side 2 rows of 9; each cap 8 centres + 9 rim vertices
        assert_eq!(counts(&g), (18 + 2 * 17, (16 + 8 + 8) * 3));
        assert_eq!(g.groups.iter().map(|x| (x.start, x.count, x.material_index)).collect::<Vec<_>>(), [(0, 48, 0), (48, 24, 1), (72, 24, 2)]);
        assert_eq!(cylinder_geometry(1.0, 1.0, 2.0, 8, 1, true, 0.0, TAU).groups.len(), 1);
    }

    #[test]
    fn cone_drops_the_tip_cap_and_its_degenerate_triangles() {
        let g = cone_geometry(1.0, 2.0, 8, 1, false, 0.0, TAU);
        assert_eq!(counts(&g), (18 + 17, (8 + 8) * 3));
        assert_eq!(g.groups.iter().map(|x| x.material_index).collect::<Vec<_>>(), [0, 2]);
    }

    #[test]
    fn circle_ring_and_torus_sizes() {
        assert_eq!(counts(&circle_geometry(1.0, 0, 0.0, TAU)), (5, 9));
        assert_eq!(counts(&ring_geometry(0.5, 1.0, 8, 2, 0.0, TAU)), (27, 96));
        let torus = torus_geometry(1.0, 0.4, 6, 12, TAU, 0.0, TAU);
        assert_eq!(counts(&torus), (7 * 13, 6 * 12 * 6));
        // the first vertex is on the outer equator and its normal points outwards
        assert_eq!(torus.get_attribute("position").unwrap().get_vector3(0), wamr_math::Vector3::new(1.4, 0.0, 0.0));
        assert_eq!(torus.get_attribute("normal").unwrap().get_vector3(0), wamr_math::Vector3::new(1.0, 0.0, 0.0));
    }
}
