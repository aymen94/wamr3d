//! Geometries, materials, render targets and interleaved buffers, by handle.

use super::*;

impl World {
    // ---- geometries

    pub fn create_geometry(&mut self, geometry: BufferGeometry) -> GeometryHandle {
        self.geometries.insert(geometry)
    }

    pub fn geometry(&self, handle: GeometryHandle) -> Option<&BufferGeometry> {
        self.geometries.get(handle)
    }

    pub fn geometry_mut(&mut self, handle: GeometryHandle) -> Option<&mut BufferGeometry> {
        self.geometries.get_mut(handle)
    }

    /// How many renderables use the geometry.
    pub fn geometry_ref_count(&self, handle: GeometryHandle) -> u32 {
        self.geometries.ref_count(handle)
    }

    /// Frees the geometry. Renderables that used it keep a dead handle.
    pub fn dispose_geometry(&mut self, handle: GeometryHandle) -> bool {
        let disposed = self.geometries.remove(handle).is_some();
        if disposed {
            self.events.push(CoreEvent::GeometryDisposed { geometry: handle });
        }
        disposed
    }

    // ---- materials

    pub fn create_material(&mut self, material: Material) -> MaterialHandle {
        self.materials.insert(material)
    }

    pub fn material(&self, handle: MaterialHandle) -> Option<&Material> {
        self.materials.get(handle)
    }

    pub fn material_mut(&mut self, handle: MaterialHandle) -> Option<&mut Material> {
        self.materials.get_mut(handle)
    }

    /// How many renderables use the material.
    pub fn material_ref_count(&self, handle: MaterialHandle) -> u32 {
        self.materials.ref_count(handle)
    }

    /// Frees the material. Renderables that used it keep a dead handle.
    pub fn dispose_material(&mut self, handle: MaterialHandle) -> bool {
        let disposed = self.materials.remove(handle).is_some();
        if disposed {
            self.events.push(CoreEvent::MaterialDisposed { material: handle });
        }
        disposed
    }

    // ---- render targets

    pub fn create_render_target(&mut self, target: RenderTarget) -> RenderTargetHandle {
        self.render_targets.insert(target)
    }

    pub fn render_target(&self, handle: RenderTargetHandle) -> Option<&RenderTarget> {
        self.render_targets.get(handle)
    }

    pub fn render_target_mut(&mut self, handle: RenderTargetHandle) -> Option<&mut RenderTarget> {
        self.render_targets.get_mut(handle)
    }

    /// Resizes a render target. A change of size queues `RenderTargetDisposed` so the
    /// renderer recreates the GPU resources; the target itself stays alive.
    pub fn set_render_target_size(&mut self, handle: RenderTargetHandle, width: u32, height: u32, depth: u32) {
        if let Some(target) = self.render_targets.get_mut(handle) {
            if target.set_size(width, height, depth) {
                self.events.push(CoreEvent::RenderTargetDisposed { target: handle });
            }
        }
    }

    pub fn dispose_render_target(&mut self, handle: RenderTargetHandle) -> bool {
        let disposed = self.render_targets.remove(handle).is_some();
        if disposed {
            self.events.push(CoreEvent::RenderTargetDisposed { target: handle });
        }
        disposed
    }

    // ---- interleaved buffers

    pub fn create_interleaved_buffer(&mut self, buffer: InterleavedBuffer) -> InterleavedBufferHandle {
        self.interleaved_buffers.insert(buffer)
    }

    pub fn interleaved_buffer(&self, handle: InterleavedBufferHandle) -> Option<&InterleavedBuffer> {
        self.interleaved_buffers.get(handle)
    }

    pub fn interleaved_buffer_mut(&mut self, handle: InterleavedBufferHandle) -> Option<&mut InterleavedBuffer> {
        self.interleaved_buffers.get_mut(handle)
    }

    /// Records one more attribute using the buffer.
    pub fn retain_interleaved_buffer(&mut self, handle: InterleavedBufferHandle) {
        self.interleaved_buffers.retain(handle);
    }

    /// Records one attribute fewer using the buffer.
    pub fn release_interleaved_buffer(&mut self, handle: InterleavedBufferHandle) {
        self.interleaved_buffers.release(handle);
    }

    pub fn interleaved_buffer_ref_count(&self, handle: InterleavedBufferHandle) -> u32 {
        self.interleaved_buffers.ref_count(handle)
    }

    pub fn dispose_interleaved_buffer(&mut self, handle: InterleavedBufferHandle) -> bool {
        let disposed = self.interleaved_buffers.remove(handle).is_some();
        if disposed {
            self.events.push(CoreEvent::InterleavedBufferDisposed { buffer: handle });
        }
        disposed
    }
}
