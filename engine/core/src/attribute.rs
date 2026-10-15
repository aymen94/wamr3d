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

/// One array shared by several attributes, `stride` elements per vertex. Lives in
/// `World::interleaved_buffers` and is referred to by handle.
#[derive(Clone, Debug, PartialEq)]
pub struct InterleavedBuffer {
    pub array: AttributeArray,
    pub stride: usize,
    pub usage: Usage,
    pub update_ranges: Vec<UpdateRange>,
    pub version: u32,
    /// `Some(n)` makes this an instanced buffer that advances once every `n` instances.
    pub mesh_per_attribute: Option<u32>,
}

pub type InterleavedBufferHandle = Handle<InterleavedBuffer>;

impl InterleavedBuffer {
    /// Panics if `stride` is zero.
    pub fn new(array: AttributeArray, stride: usize) -> Self {
        assert!(stride > 0, "InterleavedBuffer: stride must be at least 1");
        Self { array, stride, usage: Usage::default(), update_ranges: Vec::new(), version: 0, mesh_per_attribute: None }
    }

    /// An instanced interleaved buffer. three.js defaults `mesh_per_attribute` to 1.
    pub fn new_instanced(array: AttributeArray, stride: usize, mesh_per_attribute: u32) -> Self {
        Self { mesh_per_attribute: Some(mesh_per_attribute), ..Self::new(array, stride) }
    }

    pub fn count(&self) -> usize {
        self.array.len() / self.stride
    }

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

    pub fn copy(&mut self, source: &InterleavedBuffer) -> &mut Self {
        self.array.clone_from(&source.array);
        self.stride = source.stride;
        self.usage = source.usage;
        self.mesh_per_attribute = source.mesh_per_attribute;
        self
    }

    /// Copies vertex `index2` of `buffer` over vertex `index1` of this buffer.
    pub fn copy_at(&mut self, index1: usize, buffer: &InterleavedBuffer, index2: usize) -> &mut Self {
        let count = self.stride;
        self.array.copy_within_from(index1 * count, &buffer.array, index2 * buffer.stride, count);
        self
    }

    pub fn set(&mut self, values: &[f32], offset: usize) -> &mut Self {
        for (k, value) in values.iter().enumerate() {
            self.array.set(offset + k, *value as f64);
        }
        self
    }
}

/// Describes one attribute inside an [`InterleavedBuffer`]: `item_size` components
/// starting `offset` elements into each vertex. It holds a handle, not the data; pair it
/// with the buffer through [`InterleavedBufferAttribute::view`] to read or write.
#[derive(Clone, Debug, PartialEq)]
pub struct InterleavedBufferAttribute {
    pub name: String,
    pub data: InterleavedBufferHandle,
    pub item_size: usize,
    pub offset: usize,
    pub normalized: bool,
}

impl InterleavedBufferAttribute {
    pub fn new(data: InterleavedBufferHandle, item_size: usize, offset: usize, normalized: bool) -> Self {
        Self { name: String::new(), data, item_size, offset, normalized }
    }

    /// Accessors over `buffer`, which must be the buffer `self.data` refers to.
    pub fn view<'a>(&'a self, buffer: &'a mut InterleavedBuffer) -> InterleavedView<'a> {
        InterleavedView { attribute: self, buffer }
    }

    /// Copies this attribute's components out into a standalone attribute.
    pub fn deinterleave(&self, buffer: &InterleavedBuffer) -> BufferAttribute {
        let count = buffer.count();
        let mut array = buffer.array.zeroed_like(count * self.item_size);
        for i in 0..count {
            array.copy_within_from(i * self.item_size, &buffer.array, i * buffer.stride + self.offset, self.item_size);
        }
        BufferAttribute::new(array, self.item_size, self.normalized)
    }
}

/// An [`InterleavedBufferAttribute`] together with its buffer.
pub struct InterleavedView<'a> {
    attribute: &'a InterleavedBufferAttribute,
    buffer: &'a mut InterleavedBuffer,
}

impl AttributeAccess for InterleavedView<'_> {
    fn item_size(&self) -> usize {
        self.attribute.item_size
    }

    fn count(&self) -> usize {
        self.buffer.count()
    }

    fn get_component(&self, index: usize, component: usize) -> f32 {
        let value = self.buffer.array.get(index * self.buffer.stride + self.attribute.offset + component);
        if self.attribute.normalized {
            denormalize(value, self.buffer.array.component_type()) as f32
        } else {
            value as f32
        }
    }

    fn set_component(&mut self, index: usize, component: usize, value: f32) {
        let mut value = value as f64;
        if self.attribute.normalized {
            value = normalize(value, self.buffer.array.component_type());
        }
        self.buffer.array.set(index * self.buffer.stride + self.attribute.offset + component, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn positions() -> BufferAttribute {
        BufferAttribute::new(AttributeArray::Float32(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), 3, false)
    }

    #[test]
    fn array_len_type_and_zeroed_like() {
        let a = AttributeArray::Int16(vec![1, 2, 3]);
        assert_eq!((a.len(), a.is_empty()), (3, false));
        assert_eq!(a.component_type(), ComponentType::Int16);
        assert_eq!(a.zeroed_like(2), AttributeArray::Int16(vec![0, 0]));
    }

    #[test]
    fn array_set_wraps_like_a_js_typed_array() {
        let mut u8s = AttributeArray::Uint8(vec![0; 4]);
        u8s.set(0, 257.0);
        u8s.set(1, -1.0);
        u8s.set(2, 1.9);
        u8s.set(3, f64::NAN);
        assert_eq!(u8s, AttributeArray::Uint8(vec![1, 255, 1, 0]));

        let mut i8s = AttributeArray::Int8(vec![0; 2]);
        i8s.set(0, 128.0);
        i8s.set(1, -129.0);
        assert_eq!(i8s, AttributeArray::Int8(vec![-128, 127]));

        let mut clamped = AttributeArray::Uint8Clamped(vec![0; 4]);
        clamped.set(0, 300.0);
        clamped.set(1, -5.0);
        clamped.set(2, 0.5);
        clamped.set(3, 1.5);
        assert_eq!(clamped, AttributeArray::Uint8Clamped(vec![255, 0, 0, 2]));
        assert_eq!(clamped.get(3), 2.0);
    }

    #[test]
    fn new_and_count() {
        let a = positions();
        assert_eq!((a.count(), a.item_size(), a.version), (2, 3, 0));
        assert_eq!((a.usage, a.gpu_type), (Usage::StaticDraw, GpuType::Float));
        assert!(!a.is_instanced());
    }

    #[test]
    fn new_instanced() {
        let a = BufferAttribute::new_instanced(AttributeArray::Float32(vec![0.0; 16]), 16, false, 1);
        assert_eq!(a.mesh_per_attribute, Some(1));
        assert!(a.is_instanced());
    }

    #[test]
    fn needs_update_bumps_version() {
        let mut a = positions();
        a.needs_update();
        a.needs_update();
        assert_eq!(a.version, 2);
    }

    #[test]
    fn set_usage() {
        assert_eq!(positions().set_usage(Usage::DynamicDraw).usage, Usage::DynamicDraw);
    }

    #[test]
    fn update_ranges() {
        let mut a = positions();
        a.add_update_range(3, 3);
        assert_eq!(a.update_ranges, vec![UpdateRange { start: 3, count: 3 }]);
        a.clear_update_ranges();
        assert!(a.update_ranges.is_empty());
    }

    #[test]
    fn copy_keeps_destination_version() {
        let mut src = positions();
        src.name = "position".into();
        src.needs_update();
        let mut dst = BufferAttribute::new(AttributeArray::Uint8(vec![]), 1, true);
        dst.copy(&src);
        assert_eq!((dst.name.as_str(), dst.item_size, dst.normalized, dst.version), ("position", 3, false, 0));
        assert_eq!(dst.array, src.array);
    }

    #[test]
    fn copy_at() {
        let mut a = positions();
        let b = BufferAttribute::new(AttributeArray::Float32(vec![7.0, 8.0, 9.0]), 3, false);
        a.copy_at(1, &b, 0);
        assert_eq!(a.array, AttributeArray::Float32(vec![1.0, 2.0, 3.0, 7.0, 8.0, 9.0]));
    }

    #[test]
    fn set_and_copy_array() {
        let mut a = positions();
        a.set(&[9.0, 8.0], 4);
        assert_eq!(a.get_vector3(1), Vector3::new(4.0, 9.0, 8.0));
        a.copy_array(&[0.0, 0.0]);
        assert_eq!(a.get_vector3(0), Vector3::new(0.0, 0.0, 3.0));
    }

    #[test]
    fn component_getters_and_setters() {
        let mut a = BufferAttribute::new(AttributeArray::Float32(vec![0.0; 8]), 4, false);
        a.set_xyzw(1, 1.0, 2.0, 3.0, 4.0);
        assert_eq!((a.get_x(1), a.get_y(1), a.get_z(1), a.get_w(1)), (1.0, 2.0, 3.0, 4.0));
        a.set_x(0, 5.0);
        a.set_y(0, 6.0);
        a.set_z(0, 7.0);
        a.set_w(0, 8.0);
        a.set_component(0, 1, 9.0);
        assert_eq!(a.get_component(0, 1), 9.0);
        a.set_xy(0, 1.5, 2.5);
        a.set_xyz(1, 0.0, 0.0, 0.0);
        assert_eq!(a.get_vector2(0), Vector2::new(1.5, 2.5));
        assert_eq!(a.get_vector3(1), Vector3::new(0.0, 0.0, 0.0));
    }

    #[test]
    fn normalized_attributes_convert_on_access() {
        let mut a = BufferAttribute::new(AttributeArray::Uint8(vec![0; 3]), 3, true);
        a.set_xyz(0, 1.0, 0.5, 0.0);
        assert_eq!(a.array, AttributeArray::Uint8(vec![255, 128, 0]));
        assert_eq!(a.get_x(0), 1.0);

        let mut s = BufferAttribute::new(AttributeArray::Int16(vec![0; 2]), 2, true);
        s.set_xy(0, -1.0, 1.0);
        assert_eq!(s.array, AttributeArray::Int16(vec![-32767, 32767]));
        assert_eq!((s.get_x(0), s.get_y(0)), (-1.0, 1.0));
    }

    #[test]
    fn apply_matrix3() {
        let mut m = Matrix3::default();
        m.make_scale(2.0, 3.0);
        let mut uv = BufferAttribute::new(AttributeArray::Float32(vec![1.0, 1.0]), 2, false);
        uv.apply_matrix3(&m);
        assert_eq!(uv.get_vector2(0), Vector2::new(2.0, 3.0));
        let mut p = positions();
        p.apply_matrix3(&m);
        assert_eq!(p.get_vector3(0), Vector3::new(2.0, 6.0, 3.0));
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(1.0, 1.0, 1.0);
        let mut p = positions();
        p.apply_matrix4(&m);
        assert_eq!(p.get_vector3(1), Vector3::new(5.0, 6.0, 7.0));
    }

    #[test]
    fn apply_normal_matrix_and_transform_direction_normalize() {
        let mut n = BufferAttribute::new(AttributeArray::Float32(vec![0.0, 3.0, 0.0]), 3, false);
        n.apply_normal_matrix(&Matrix3::default());
        assert_eq!(n.get_vector3(0), Vector3::new(0.0, 1.0, 0.0));
        let mut d = BufferAttribute::new(AttributeArray::Float32(vec![0.0, 0.0, -4.0]), 3, false);
        let mut m = Matrix4::default();
        m.make_translation(9.0, 9.0, 9.0);
        d.transform_direction(&m);
        assert_eq!(d.get_vector3(0), Vector3::new(0.0, 0.0, -1.0));
    }

    fn interleaved() -> InterleavedBuffer {
        // position.xyz, uv.xy per vertex
        InterleavedBuffer::new(AttributeArray::Float32(vec![1.0, 2.0, 3.0, 0.1, 0.2, 4.0, 5.0, 6.0, 0.3, 0.4]), 5)
    }

    #[test]
    fn interleaved_buffer_basics() {
        let mut b = interleaved();
        assert_eq!((b.count(), b.stride, b.version), (2, 5, 0));
        b.needs_update();
        b.set_usage(Usage::DynamicDraw);
        b.add_update_range(0, 5);
        assert_eq!((b.version, b.usage, b.update_ranges.len()), (1, Usage::DynamicDraw, 1));
        b.clear_update_ranges();
        assert!(b.update_ranges.is_empty());
        let instanced = InterleavedBuffer::new_instanced(AttributeArray::Float32(vec![0.0; 4]), 4, 2);
        assert_eq!(instanced.mesh_per_attribute, Some(2));
    }

    #[test]
    fn interleaved_buffer_copy_copy_at_set() {
        let src = interleaved();
        let mut dst = InterleavedBuffer::new(AttributeArray::Float32(vec![]), 1);
        dst.copy(&src);
        assert_eq!((dst.stride, dst.count()), (5, 2));
        dst.copy_at(0, &src, 1);
        dst.set(&[9.0], 9);
        assert_eq!(dst.array, AttributeArray::Float32(vec![4.0, 5.0, 6.0, 0.3, 0.4, 4.0, 5.0, 6.0, 0.3, 9.0]));
    }

    #[test]
    fn interleaved_attribute_view_and_deinterleave() {
        let mut arena = crate::arena::Arena::new();
        let handle = arena.insert(interleaved());
        let uv = InterleavedBufferAttribute::new(handle, 2, 3, false);
        let buffer = arena.get_mut(handle).unwrap();

        let mut view = uv.view(buffer);
        assert_eq!((view.count(), view.item_size()), (2, 2));
        assert_eq!(view.get_vector2(1), Vector2::new(0.3, 0.4));
        view.set_xy(0, 0.5, 0.75);
        assert_eq!(buffer.array.get(3), 0.5);

        let standalone = uv.deinterleave(buffer);
        assert_eq!(standalone.array, AttributeArray::Float32(vec![0.5, 0.75, 0.3, 0.4]));
    }
}
