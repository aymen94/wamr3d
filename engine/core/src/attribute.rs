use crate::arena::Handle;
use crate::constants::{GpuType, Usage};
use wamr_math::math_utils::ComponentType;
use wamr_math::{Matrix3, Matrix4, Vector2, Vector3};

/// The typed storage of an attribute: one contiguous `Vec` per JS typed-array kind, so
/// the data can be exposed to JS as a typed-array view over Wasm memory without copying.
#[derive(Clone, Debug, PartialEq)]
pub enum AttributeArray {
    Float32(Vec<f32>),
    Uint32(Vec<u32>),
    Uint16(Vec<u16>),
    Uint8(Vec<u8>),
    Int32(Vec<i32>),
    Int16(Vec<i16>),
    Int8(Vec<i8>),
    Uint8Clamped(Vec<u8>),
}

/// JS `ToInt32`-style conversion: truncate, then wrap modulo 2^32. Rust's `as` saturates
/// instead, which would store a different value for out-of-range writes (DECISIONS.md D18).
fn wrap_to_i64(value: f64) -> i64 {
    if !value.is_finite() {
        return 0;
    }
    value.trunc().rem_euclid(4294967296.0) as i64
}

/// `Uint8ClampedArray` store: clamp to 0..=255 and round half to even.
fn clamp_to_u8(value: f64) -> u8 {
    if value.is_nan() {
        return 0;
    }
    value.clamp(0.0, 255.0).round_ties_even() as u8
}

impl AttributeArray {
    pub fn len(&self) -> usize {
        match self {
            Self::Float32(a) => a.len(),
            Self::Uint32(a) => a.len(),
            Self::Uint16(a) => a.len(),
            Self::Uint8(a) | Self::Uint8Clamped(a) => a.len(),
            Self::Int32(a) => a.len(),
            Self::Int16(a) => a.len(),
            Self::Int8(a) => a.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn component_type(&self) -> ComponentType {
        match self {
            Self::Float32(_) => ComponentType::Float32,
            Self::Uint32(_) => ComponentType::Uint32,
            Self::Uint16(_) => ComponentType::Uint16,
            Self::Uint8(_) => ComponentType::Uint8,
            Self::Int32(_) => ComponentType::Int32,
            Self::Int16(_) => ComponentType::Int16,
            Self::Int8(_) => ComponentType::Int8,
            Self::Uint8Clamped(_) => ComponentType::Uint8Clamped,
        }
    }

    /// A zero-filled array of the same kind.
    pub fn zeroed_like(&self, len: usize) -> Self {
        match self {
            Self::Float32(_) => Self::Float32(vec![0.0; len]),
            Self::Uint32(_) => Self::Uint32(vec![0; len]),
            Self::Uint16(_) => Self::Uint16(vec![0; len]),
            Self::Uint8(_) => Self::Uint8(vec![0; len]),
            Self::Int32(_) => Self::Int32(vec![0; len]),
            Self::Int16(_) => Self::Int16(vec![0; len]),
            Self::Int8(_) => Self::Int8(vec![0; len]),
            Self::Uint8Clamped(_) => Self::Uint8Clamped(vec![0; len]),
        }
    }

    /// Reads element `i` as a number. Panics if `i` is out of range.
    pub fn get(&self, i: usize) -> f64 {
        match self {
            Self::Float32(a) => a[i] as f64,
            Self::Uint32(a) => a[i] as f64,
            Self::Uint16(a) => a[i] as f64,
            Self::Uint8(a) | Self::Uint8Clamped(a) => a[i] as f64,
            Self::Int32(a) => a[i] as f64,
            Self::Int16(a) => a[i] as f64,
            Self::Int8(a) => a[i] as f64,
        }
    }

    /// Stores a number in element `i` the way a JS typed array would. Panics if `i` is
    /// out of range (a JS typed array ignores such writes).
    pub fn set(&mut self, i: usize, value: f64) {
        match self {
            Self::Float32(a) => a[i] = value as f32,
            Self::Uint32(a) => a[i] = wrap_to_i64(value) as u32,
            Self::Uint16(a) => a[i] = wrap_to_i64(value) as u16,
            Self::Uint8(a) => a[i] = wrap_to_i64(value) as u8,
            Self::Int32(a) => a[i] = wrap_to_i64(value) as i32,
            Self::Int16(a) => a[i] = wrap_to_i64(value) as i16,
            Self::Int8(a) => a[i] = wrap_to_i64(value) as i8,
            Self::Uint8Clamped(a) => a[i] = clamp_to_u8(value),
        }
    }

    fn copy_within_from(&mut self, to: usize, source: &AttributeArray, from: usize, count: usize) {
        for k in 0..count {
            self.set(to + k, source.get(from + k));
        }
    }
}

// The math crate's `normalize` / `denormalize` take and return f32, which cannot hold
// every 32-bit integer. These keep f64 until the value is stored or returned.
fn denormalize(value: f64, ty: ComponentType) -> f64 {
    match ty {
        ComponentType::Float32 => value,
        ComponentType::Uint32 => value / 4294967295.0,
        ComponentType::Uint16 => value / 65535.0,
        ComponentType::Uint8 | ComponentType::Uint8Clamped => value / 255.0,
        ComponentType::Int32 => (value / 2147483647.0).max(-1.0),
        ComponentType::Int16 => (value / 32767.0).max(-1.0),
        ComponentType::Int8 => (value / 127.0).max(-1.0),
    }
}

fn js_round(x: f64) -> f64 {
    let r = x.floor();
    if x - r >= 0.5 {
        r + 1.0
    } else {
        r
    }
}

fn normalize(value: f64, ty: ComponentType) -> f64 {
    match ty {
        ComponentType::Float32 => value,
        ComponentType::Uint32 => js_round(value * 4294967295.0),
        ComponentType::Uint16 => js_round(value * 65535.0),
        ComponentType::Uint8 | ComponentType::Uint8Clamped => js_round(value * 255.0),
        ComponentType::Int32 => js_round(value * 2147483647.0),
        ComponentType::Int16 => js_round(value * 32767.0),
        ComponentType::Int8 => js_round(value * 127.0),
    }
}

/// A sub-range of an attribute's array that changed and must be re-uploaded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UpdateRange {
    pub start: u32,
    pub count: u32,
}

/// Read and write access to per-vertex data. Implemented by [`BufferAttribute`] and by
/// [`InterleavedView`], so the transform helpers exist once.
pub trait AttributeAccess {
    fn item_size(&self) -> usize;
    fn count(&self) -> usize;
    fn get_component(&self, index: usize, component: usize) -> f32;
    fn set_component(&mut self, index: usize, component: usize, value: f32);

    fn get_x(&self, index: usize) -> f32 {
        self.get_component(index, 0)
    }
    fn get_y(&self, index: usize) -> f32 {
        self.get_component(index, 1)
    }
    fn get_z(&self, index: usize) -> f32 {
        self.get_component(index, 2)
    }
    fn get_w(&self, index: usize) -> f32 {
        self.get_component(index, 3)
    }
    fn set_x(&mut self, index: usize, x: f32) {
        self.set_component(index, 0, x);
    }
    fn set_y(&mut self, index: usize, y: f32) {
        self.set_component(index, 1, y);
    }
    fn set_z(&mut self, index: usize, z: f32) {
        self.set_component(index, 2, z);
    }
    fn set_w(&mut self, index: usize, w: f32) {
        self.set_component(index, 3, w);
    }
    fn set_xy(&mut self, index: usize, x: f32, y: f32) {
        self.set_x(index, x);
        self.set_y(index, y);
    }
    fn set_xyz(&mut self, index: usize, x: f32, y: f32, z: f32) {
        self.set_xy(index, x, y);
        self.set_z(index, z);
    }
    fn set_xyzw(&mut self, index: usize, x: f32, y: f32, z: f32, w: f32) {
        self.set_xyz(index, x, y, z);
        self.set_w(index, w);
    }

    fn get_vector2(&self, index: usize) -> Vector2 {
        Vector2::new(self.get_x(index), self.get_y(index))
    }

    fn get_vector3(&self, index: usize) -> Vector3 {
        Vector3::new(self.get_x(index), self.get_y(index), self.get_z(index))
    }

    /// Transforms every item as a 2D or 3D vector, depending on the item size. Other
    /// item sizes are left unchanged.
    fn apply_matrix3(&mut self, m: &Matrix3) {
        if self.item_size() == 2 {
            for i in 0..self.count() {
                let mut v = self.get_vector2(i);
                v.apply_matrix3(m);
                self.set_xy(i, v.x, v.y);
            }
        } else if self.item_size() == 3 {
            for i in 0..self.count() {
                let mut v = self.get_vector3(i);
                v.apply_matrix3(m);
                self.set_xyz(i, v.x, v.y, v.z);
            }
        }
    }

    fn apply_matrix4(&mut self, m: &Matrix4) {
        for i in 0..self.count() {
            let mut v = self.get_vector3(i);
            v.apply_matrix4(m);
            self.set_xyz(i, v.x, v.y, v.z);
        }
    }

    fn apply_normal_matrix(&mut self, m: &Matrix3) {
        for i in 0..self.count() {
            let mut v = self.get_vector3(i);
            v.apply_normal_matrix(m);
            self.set_xyz(i, v.x, v.y, v.z);
        }
    }

    fn transform_direction(&mut self, m: &Matrix4) {
        for i in 0..self.count() {
            let mut v = self.get_vector3(i);
            v.transform_direction(m);
            self.set_xyz(i, v.x, v.y, v.z);
        }
    }
}

/// Per-vertex (or, with `mesh_per_attribute`, per-instance) data of a geometry.
///
/// With `normalized`, integer data stands for the range `[0, 1]` (unsigned) or `[-1, 1]`
/// (signed): getters and setters convert, the stored values stay integers.
#[derive(Clone, Debug, PartialEq)]
pub struct BufferAttribute {
    pub name: String,
    pub array: AttributeArray,
    pub item_size: usize,
    pub normalized: bool,
    pub usage: Usage,
    pub update_ranges: Vec<UpdateRange>,
    pub gpu_type: GpuType,
    /// Bumped by [`BufferAttribute::needs_update`]; the renderer re-uploads when it changes.
    pub version: u32,
    /// `Some(n)` makes this an instanced attribute that advances once every `n` instances.
    pub mesh_per_attribute: Option<u32>,
}

impl BufferAttribute {
    /// Panics if `item_size` is zero.
    pub fn new(array: AttributeArray, item_size: usize, normalized: bool) -> Self {
        assert!(item_size > 0, "BufferAttribute: item_size must be at least 1");
        Self {
            name: String::new(),
            array,
            item_size,
            normalized,
            usage: Usage::default(),
            update_ranges: Vec::new(),
            gpu_type: GpuType::default(),
            version: 0,
            mesh_per_attribute: None,
        }
    }

    /// An instanced attribute. three.js defaults `mesh_per_attribute` to 1.
    pub fn new_instanced(array: AttributeArray, item_size: usize, normalized: bool, mesh_per_attribute: u32) -> Self {
        Self { mesh_per_attribute: Some(mesh_per_attribute), ..Self::new(array, item_size, normalized) }
    }

    pub fn is_instanced(&self) -> bool {
        self.mesh_per_attribute.is_some()
    }

    /// Marks the data as changed so it is uploaded again.
    pub fn needs_update(&mut self) {
        self.version += 1;
    }

    pub fn set_usage(&mut self, value: Usage) -> &mut Self {
        self.usage = value;
        self
    }

    pub fn add_update_range(&mut self, start: u32, count: u32) {
        self.update_ranges.push(UpdateRange { start, count });
    }

    pub fn clear_update_ranges(&mut self) {
        self.update_ranges.clear();
    }

    /// Copies everything except `version` and `update_ranges`, which belong to the
    /// upload state of the destination.
    pub fn copy(&mut self, source: &BufferAttribute) -> &mut Self {
        self.name.clone_from(&source.name);
        self.array.clone_from(&source.array);
        self.item_size = source.item_size;
        self.normalized = source.normalized;
        self.usage = source.usage;
        self.gpu_type = source.gpu_type;
        self.mesh_per_attribute = source.mesh_per_attribute;
        self
    }

    /// Copies item `index2` of `attribute` over item `index1` of this attribute, raw
    /// (no normalization), `self.item_size` components.
    pub fn copy_at(&mut self, index1: usize, attribute: &BufferAttribute, index2: usize) -> &mut Self {
        let count = self.item_size;
        self.array.copy_within_from(index1 * count, &attribute.array, index2 * attribute.item_size, count);
        self
    }

    /// Writes raw values starting at element `offset` (no normalization). Panics if they
    /// do not fit.
    pub fn set(&mut self, values: &[f32], offset: usize) -> &mut Self {
        for (k, value) in values.iter().enumerate() {
            self.array.set(offset + k, *value as f64);
        }
        self
    }

    /// Writes raw values from the start of the array.
    pub fn copy_array(&mut self, values: &[f32]) -> &mut Self {
        self.set(values, 0)
    }
}

impl AttributeAccess for BufferAttribute {
    fn item_size(&self) -> usize {
        self.item_size
    }

    fn count(&self) -> usize {
        self.array.len() / self.item_size
    }

    fn get_component(&self, index: usize, component: usize) -> f32 {
        let value = self.array.get(index * self.item_size + component);
        if self.normalized {
            denormalize(value, self.array.component_type()) as f32
        } else {
            value as f32
        }
    }

    fn set_component(&mut self, index: usize, component: usize, value: f32) {
        let mut value = value as f64;
        if self.normalized {
            value = normalize(value, self.array.component_type());
        }
        self.array.set(index * self.item_size + component, value);
    }

    fn apply_matrix4(&mut self, m: &Matrix4) {
        let stride = self.item_size;
        if let AttributeArray::Float32(values) = &mut self.array {
            for vertex in values.chunks_exact_mut(stride) {
                let mut value = Vector3::new(vertex[0], vertex[1], vertex[2]);
                value.apply_matrix4(m);
                vertex[0] = value.x;
                vertex[1] = value.y;
                vertex[2] = value.z;
            }
        } else {
            for i in 0..self.count() {
                let mut value = self.get_vector3(i);
                value.apply_matrix4(m);
                self.set_xyz(i, value.x, value.y, value.z);
            }
        }
    }

    fn apply_normal_matrix(&mut self, m: &Matrix3) {
        let stride = self.item_size;
        if let AttributeArray::Float32(values) = &mut self.array {
            for vertex in values.chunks_exact_mut(stride) {
                let mut value = Vector3::new(vertex[0], vertex[1], vertex[2]);
                value.apply_normal_matrix(m);
                vertex[0] = value.x;
                vertex[1] = value.y;
                vertex[2] = value.z;
            }
        } else {
            for i in 0..self.count() {
                let mut value = self.get_vector3(i);
                value.apply_normal_matrix(m);
                self.set_xyz(i, value.x, value.y, value.z);
            }
        }
    }

    fn transform_direction(&mut self, m: &Matrix4) {
        let stride = self.item_size;
        if let AttributeArray::Float32(values) = &mut self.array {
            for vertex in values.chunks_exact_mut(stride) {
                let mut value = Vector3::new(vertex[0], vertex[1], vertex[2]);
                value.transform_direction(m);
                vertex[0] = value.x;
                vertex[1] = value.y;
                vertex[2] = value.z;
            }
        } else {
            for i in 0..self.count() {
                let mut value = self.get_vector3(i);
                value.transform_direction(m);
                self.set_xyz(i, value.x, value.y, value.z);
            }
        }
    }
}
mod interleaved;
pub use interleaved::*;

#[cfg(test)]
mod tests;
