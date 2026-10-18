//! Interleaved buffers and the attributes that read them.

use super::*;

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
