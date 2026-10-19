use crate::arena::Handle;
use crate::attribute::{AttributeAccess, AttributeArray, BufferAttribute};
use std::cell::Cell;
use wamr_math::{Box3, Matrix3, Matrix4, Quaternion, Sphere, Vector3};

mod bounds;

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
        self.set_index_from_vec(indices.to_vec())
    }

    /// As `set_index_from_slice`, keeping the vector itself when it needs 32 bits.
    pub fn set_index_from_vec(&mut self, indices: Vec<u32>) -> &mut Self {
        let array = if indices.iter().any(|i| *i >= 65535) {
            AttributeArray::Uint32(indices)
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
mod tests;
