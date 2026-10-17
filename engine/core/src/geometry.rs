use crate::arena::Handle;
use crate::attribute::{AttributeAccess, AttributeArray, BufferAttribute};
use std::cell::Cell;
use wamr_math::{Box3, Matrix3, Matrix4, Quaternion, Sphere, Vector3};

pub type GeometryHandle = Handle<BufferGeometry>;

/// A range of the index (or vertex) buffer drawn with one material of a multi-material mesh.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Group {
    pub start: u32,
    pub count: u32,
    pub material_index: u32,
}

/// The part of the geometry to draw. `count == u32::MAX` means "to the end", which
/// three.js writes as `Infinity`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DrawRange {
    pub start: u32,
    pub count: u32,
}

impl Default for DrawRange {
    fn default() -> Self {
        Self { start: 0, count: u32::MAX }
    }
}

/// Mesh, line or point data: named vertex attributes and an optional index.
///
/// The geometry owns its attributes. Bounds are `None` until computed, and stale after
/// the positions change unless a method here changed them.
#[derive(Clone, Debug, Default)]
pub struct BufferGeometry {
    pub name: String,
    index: Option<BufferAttribute>,
    // Kept in insertion order, like the keys of the three.js `attributes` object.
    attributes: Vec<(String, BufferAttribute)>,
    pub groups: Vec<Group>,
    pub bounding_box: Option<Box3>,
    pub bounding_sphere: Option<Sphere>,
    // Raycasting needs a bound even when callers have not requested the public one.
    raycast_sphere: Cell<Option<Sphere>>,
    pub draw_range: DrawRange,
    /// `Some(n)` makes this an instanced geometry drawn `n` times; `Some(u32::MAX)`
    /// means "as many as the instanced attributes allow" (`Infinity` in three.js).
    pub instance_count: Option<u32>,
}

impl PartialEq for BufferGeometry {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.index == other.index
            && self.attributes == other.attributes
            && self.groups == other.groups
            && self.bounding_box == other.bounding_box
            && self.bounding_sphere == other.bounding_sphere
            && self.draw_range == other.draw_range
            && self.instance_count == other.instance_count
    }
}

impl BufferGeometry {
    pub fn new() -> Self {
        Self::default()
    }

    /// An instanced geometry with no instance limit.
    pub fn new_instanced() -> Self {
        Self { instance_count: Some(u32::MAX), ..Self::default() }
    }

    pub fn get_index(&self) -> Option<&BufferAttribute> {
        self.index.as_ref()
    }

    pub fn get_index_mut(&mut self) -> Option<&mut BufferAttribute> {
        self.index.as_mut()
    }

    pub fn set_index(&mut self, index: Option<BufferAttribute>) -> &mut Self {
        self.index = index;
        self
    }

    /// Sets the index from a list, stored as 16-bit unless a value needs 32 bits.
    /// 65535 already selects 32 bits: it is the primitive-restart index of 16-bit buffers.
    pub fn set_index_from_slice(&mut self, indices: &[u32]) -> &mut Self {
        let array = if indices.iter().any(|i| *i >= 65535) {
            AttributeArray::Uint32(indices.to_vec())
        } else {
            AttributeArray::Uint16(indices.iter().map(|i| *i as u16).collect())
        };
        self.set_index(Some(BufferAttribute::new(array, 1, false)))
    }

    pub fn get_attribute(&self, name: &str) -> Option<&BufferAttribute> {
        self.attributes.iter().find(|(n, _)| n == name).map(|(_, a)| a)
    }

    pub fn get_attribute_mut(&mut self, name: &str) -> Option<&mut BufferAttribute> {
        self.attributes.iter_mut().find(|(n, _)| n == name).map(|(_, a)| a)
    }

    /// Adds or replaces an attribute. A replaced attribute keeps its position in the order.
    pub fn set_attribute(&mut self, name: &str, attribute: BufferAttribute) -> &mut Self {
        match self.attributes.iter_mut().find(|(n, _)| n == name) {
            Some(slot) => slot.1 = attribute,
            None => self.attributes.push((name.to_string(), attribute)),
        }
        self
    }

    pub fn delete_attribute(&mut self, name: &str) -> &mut Self {
        self.attributes.retain(|(n, _)| n != name);
        self
    }

    pub fn has_attribute(&self, name: &str) -> bool {
        self.get_attribute(name).is_some()
    }

    /// The attributes in insertion order.
    pub fn attributes(&self) -> impl Iterator<Item = (&str, &BufferAttribute)> {
        self.attributes.iter().map(|(n, a)| (n.as_str(), a))
    }

    /// three.js defaults `material_index` to 0.
    pub fn add_group(&mut self, start: u32, count: u32, material_index: u32) {
        self.groups.push(Group { start, count, material_index });
    }

    pub fn clear_groups(&mut self) {
        self.groups.clear();
    }

    pub fn set_draw_range(&mut self, start: u32, count: u32) {
        self.draw_range = DrawRange { start, count };
    }

    /// Transforms positions, normals and tangents, and recomputes bounds that exist.
    pub fn apply_matrix4(&mut self, matrix: &Matrix4) -> &mut Self {
        if let Some(position) = self.get_attribute_mut("position") {
            position.apply_matrix4(matrix);
            position.needs_update();
        }

        if let Some(normal) = self.get_attribute_mut("normal") {
            let mut normal_matrix = Matrix3::default();
            normal_matrix.get_normal_matrix(matrix);
            normal.apply_normal_matrix(&normal_matrix);
            normal.needs_update();
        }

        if let Some(tangent) = self.get_attribute_mut("tangent") {
            tangent.transform_direction(matrix);
            tangent.needs_update();
        }

        if self.bounding_sphere.is_none() {
            if let Some(mut sphere) = self.raycast_sphere.get() {
                sphere.apply_matrix4(matrix);
                self.raycast_sphere.set(Some(sphere));
            }
        }

        if self.bounding_box.is_some() {
            self.compute_bounding_box();
        }

        if self.bounding_sphere.is_some() {
            self.compute_bounding_sphere();
        }

        self
    }

    pub fn apply_quaternion(&mut self, q: &Quaternion) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_rotation_from_quaternion(q);
        self.apply_matrix4(&m)
    }

    pub fn rotate_x(&mut self, angle: f32) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_rotation_x(angle);
        self.apply_matrix4(&m)
    }

    pub fn rotate_y(&mut self, angle: f32) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_rotation_y(angle);
        self.apply_matrix4(&m)
    }

    pub fn rotate_z(&mut self, angle: f32) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_rotation_z(angle);
        self.apply_matrix4(&m)
    }

    pub fn translate(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_translation(x, y, z);
        self.apply_matrix4(&m)
    }

    pub fn scale(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        let mut m = Matrix4::default();
        m.make_scale(x, y, z);
        self.apply_matrix4(&m)
    }

    /// Moves the geometry so its bounding box is centred on the origin.
    pub fn center(&mut self) -> &mut Self {
        self.compute_bounding_box();
        let mut offset = self.bounding_box.map(|b| b.get_center()).unwrap_or_default();
        offset.negate();
        self.translate(offset.x, offset.y, offset.z)
    }

    /// Writes `points` into the position attribute, creating it if needed. An existing
    /// attribute is not resized: points beyond its capacity are dropped.
    pub fn set_from_points(&mut self, points: &[Vector3]) -> &mut Self {
        match self.get_attribute_mut("position") {
            None => {
                let position = points.iter().flat_map(|p| p.to_array()).collect();
                self.set_attribute("position", BufferAttribute::new(AttributeArray::Float32(position), 3, false));
            }
            Some(position) => {
                let count = points.len().min(position.count());
                for (i, p) in points.iter().take(count).enumerate() {
                    position.set_xyz(i, p.x, p.y, p.z);
                }
                position.needs_update();
            }
        }
        self
    }

    fn position_box(&self) -> Box3 {
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

    fn measure_bounding_sphere(&self) -> Sphere {
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

    /// A copy with the index expanded away, so every triangle has its own vertices.
    /// A geometry that is already non-indexed is returned as a plain copy.
    pub fn to_non_indexed(&self) -> BufferGeometry {
        let Some(index) = &self.index else {
            return self.clone();
        };

        let mut geometry = BufferGeometry::new();

        for (name, attribute) in &self.attributes {
            let item_size = attribute.item_size;
            let mut array = attribute.array.zeroed_like(index.count() * item_size);

            for i in 0..index.count() {
                let source = index.array.get(i) as usize * item_size;
                for k in 0..item_size {
                    array.set(i * item_size + k, attribute.array.get(source + k));
                }
            }

            geometry.set_attribute(name, BufferAttribute::new(array, item_size, attribute.normalized));
        }

        geometry.groups.clone_from(&self.groups);
        geometry
    }
}

fn min_number(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() { f32::NAN } else if a < b { a } else { b }
}

fn max_number(a: f32, b: f32) -> f32 {
    if a.is_nan() || b.is_nan() { f32::NAN } else if a > b { a } else { b }
}

#[cfg(test)]
mod tests {
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
}
