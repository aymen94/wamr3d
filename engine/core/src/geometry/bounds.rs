//! Bounds, raycast caches, tangents and normals.

use super::*;

impl BufferGeometry {
    pub(crate) fn position_box(&self) -> Box3 {
        let mut b = Box3::default();
        if let Some(position) = self.get_attribute("position") {
            if let AttributeArray::Float32(values) = &position.array {
                let stride = position.item_size;
                for vertex in values.chunks_exact(stride) {
                    let (x, y, z) = (vertex[0], vertex[1], vertex[2]);
                    b.min.x = min_number(b.min.x, x);
                    b.min.y = min_number(b.min.y, y);
                    b.min.z = min_number(b.min.z, z);
                    b.max.x = max_number(b.max.x, x);
                    b.max.y = max_number(b.max.y, y);
                    b.max.z = max_number(b.max.z, z);
                }
            } else {
                for i in 0..position.count() {
                    b.expand_by_point(&position.get_vector3(i));
                }
            }
        }
        b
    }

    pub(crate) fn measure_bounding_sphere(&self) -> Sphere {
        let mut sphere = Sphere::default();
        if let Some(position) = self.get_attribute("position") {
            let center = self.position_box().get_center();
            let mut max_radius_sq = 0.0f32;
            if let AttributeArray::Float32(values) = &position.array {
                let stride = position.item_size;
                for vertex in values.chunks_exact(stride) {
                    let dx = center.x as f64 - vertex[0] as f64;
                    let dy = center.y as f64 - vertex[1] as f64;
                    let dz = center.z as f64 - vertex[2] as f64;
                    let d = (dx * dx + dy * dy + dz * dz) as f32;
                    max_radius_sq = if d.is_nan() || d > max_radius_sq { d } else { max_radius_sq };
                }
            } else {
                for i in 0..position.count() {
                    let d = center.distance_to_squared(&position.get_vector3(i));
                    max_radius_sq = if d.is_nan() || d > max_radius_sq { d } else { max_radius_sq };
                }
            }
            sphere.center = center;
            sphere.radius = (max_radius_sq as f64).sqrt() as f32;
        }
        sphere
    }

    /// Forgets the cached raycasting bound, after positions were changed in place.
    pub fn clear_raycast_cache(&mut self) {
        self.raycast_sphere.set(None);
        self.raycast_bvh.get_mut().take();
    }

    /// A cached local bound for raycasting when the public bounding sphere is unset.
    pub fn raycast_sphere(&self) -> Option<Sphere> {
        if let Some(sphere) = self.raycast_sphere.get() {
            return Some(sphere);
        }
        if self.bounding_sphere.is_some() {
            return None;
        }
        let sphere = self.measure_bounding_sphere();
        self.raycast_sphere.set(Some(sphere));
        Some(sphere)
    }

    /// Sets `bounding_box` from the positions. Without positions the box is empty.
    pub fn compute_bounding_box(&mut self) {
        self.bounding_box = Some(self.position_box());
    }

    /// Sets `bounding_sphere`: centred on the bounding box centre, just large enough
    /// for every position. Without positions an existing sphere is kept, and a missing
    /// one becomes the empty sphere.
    pub fn compute_bounding_sphere(&mut self) {
        let mut sphere = self.bounding_sphere.unwrap_or_default();
        if self.has_attribute("position") {
            sphere = self.measure_bounding_sphere();
        }

        self.bounding_sphere = Some(sphere);
        self.raycast_sphere.set(Some(sphere));
    }

    /// Computes per-vertex tangents (xyz, and handedness in w) from an indexed geometry
    /// with position, normal and uv. Does nothing if any of those is missing.
    pub fn compute_tangents(&mut self) {
        // based on http://www.terathon.com/code/tangent.html (per vertex tangents)

        let (Some(index), Some(positions), Some(normals), Some(uvs)) =
            (&self.index, self.get_attribute("position"), self.get_attribute("normal"), self.get_attribute("uv"))
        else {
            return;
        };

        let vertex_count = positions.count();
        let mut tan1 = vec![Vector3::default(); vertex_count];
        let mut tan2 = vec![Vector3::default(); vertex_count];

        let whole = [Group { start: 0, count: index.count() as u32, material_index: 0 }];
        let groups: &[Group] = if self.groups.is_empty() { &whole } else { &self.groups };
        let vertex = |j: u32| index.get_x(j as usize) as usize;

        for group in groups {
            for j in (group.start..group.start + group.count).step_by(3) {
                let (a, b, c) = (vertex(j), vertex(j + 1), vertex(j + 2));

                let v_a = positions.get_vector3(a);
                let mut v_b = positions.get_vector3(b);
                let mut v_c = positions.get_vector3(c);
                let uv_a = uvs.get_vector2(a);
                let mut uv_b = uvs.get_vector2(b);
                let mut uv_c = uvs.get_vector2(c);

                v_b.sub(&v_a);
                v_c.sub(&v_a);
                uv_b.sub(&uv_a);
                uv_c.sub(&uv_a);

                let r = 1.0 / (uv_b.x as f64 * uv_c.y as f64 - uv_c.x as f64 * uv_b.y as f64);

                // silently ignore degenerate uv triangles having coincident or colinear vertices
                if !r.is_finite() {
                    continue;
                }
                let r = r as f32;

                let mut sdir = v_b;
                sdir.multiply_scalar(uv_c.y).add_scaled_vector(&v_c, -uv_b.y).multiply_scalar(r);
                let mut tdir = v_c;
                tdir.multiply_scalar(uv_b.x).add_scaled_vector(&v_b, -uv_c.x).multiply_scalar(r);

                for v in [a, b, c] {
                    tan1[v].add(&sdir);
                    tan2[v].add(&tdir);
                }
            }
        }

        // only vertices referenced by the index get a tangent; the rest keep their value
        let mut tangents: Vec<(usize, [f32; 4])> = Vec::new();

        for group in groups {
            for j in group.start..group.start + group.count {
                let v = vertex(j);
                let n = normals.get_vector3(v);
                let t = tan1[v];

                // Gram-Schmidt orthogonalize
                let mut projected = n;
                projected.multiply_scalar(n.dot(&t));
                let mut tangent = t;
                tangent.sub(&projected).normalize();

                // Calculate handedness
                let mut bitangent = Vector3::default();
                bitangent.cross_vectors(&n, &t);
                let w = if bitangent.dot(&tan2[v]) < 0.0 { -1.0 } else { 1.0 };

                tangents.push((v, [tangent.x, tangent.y, tangent.z, w]));
            }
        }

        let reuse = self.get_attribute("tangent").is_some_and(|t| t.count() == vertex_count);
        if !reuse {
            let array = AttributeArray::Float32(vec![0.0; vertex_count * 4]);
            self.set_attribute("tangent", BufferAttribute::new(array, 4, false));
        }

        if let Some(attribute) = self.get_attribute_mut("tangent") {
            for (v, [x, y, z, w]) in tangents {
                attribute.set_xyzw(v, x, y, z, w);
            }
        }
    }

    /// Computes smooth vertex normals by summing the face normals around each vertex
    /// (area weighted), or flat normals for a non-indexed triangle soup.
    pub fn compute_vertex_normals(&mut self) {
        let Some(positions) = self.get_attribute("position") else {
            return;
        };

        let count = positions.count();
        let mut normals = vec![Vector3::default(); count];

        let face_normal = |a: usize, b: usize, c: usize| {
            let (p_a, p_b, p_c) = (positions.get_vector3(a), positions.get_vector3(b), positions.get_vector3(c));
            let (mut cb, mut ab) = (Vector3::default(), Vector3::default());
            cb.sub_vectors(&p_c, &p_b);
            ab.sub_vectors(&p_a, &p_b);
            cb.cross(&ab);
            cb
        };

        match &self.index {
            Some(index) => {
                let vertex = |i: usize| index.get_x(i) as usize;
                for i in (0..index.count()).step_by(3) {
                    let (a, b, c) = (vertex(i), vertex(i + 1), vertex(i + 2));
                    let cb = face_normal(a, b, c);
                    normals[a].add(&cb);
                    normals[b].add(&cb);
                    normals[c].add(&cb);
                }
            }
            None => {
                // non-indexed elements (unconnected triangle soup)
                for i in (0..count).step_by(3) {
                    let cb = face_normal(i, i + 1, i + 2);
                    normals[i] = cb;
                    normals[i + 1] = cb;
                    normals[i + 2] = cb;
                }
            }
        }

        let reuse = self.get_attribute("normal").is_some_and(|n| n.count() == count);
        if !reuse {
            let array = AttributeArray::Float32(vec![0.0; count * 3]);
            self.set_attribute("normal", BufferAttribute::new(array, 3, false));
        }

        if let Some(attribute) = self.get_attribute_mut("normal") {
            for (i, n) in normals.iter().enumerate() {
                let mut n = *n;
                n.normalize();
                attribute.set_xyz(i, n.x, n.y, n.z);
            }
        }

        if let Some(attribute) = self.get_attribute_mut("normal") {
            attribute.needs_update();
        }
    }

    /// Makes every normal unit length. Does nothing without a normal attribute.
    pub fn normalize_normals(&mut self) {
        if let Some(normals) = self.get_attribute_mut("normal") {
            for i in 0..normals.count() {
                let mut v = normals.get_vector3(i);
                v.normalize();
                normals.set_xyz(i, v.x, v.y, v.z);
            }
        }
    }
}
