//! More object, camera and geometry controls, and events.

use super::*;

#[wasm_bindgen]
impl World {
    // ---- more object, camera and geometry controls

    /// Copies an object (and with `recursive` its subtree). The copy has no parent and
    /// shares geometries and materials with the original.
    #[wasm_bindgen(js_name = cloneObject)]
    pub fn clone_object(&mut self, object: u64, recursive: bool) -> Option<u64> {
        self.inner.clone_object(entity(object), recursive).map(Handle::to_bits)
    }

    /// The layer bit mask of the object.
    pub fn layers(&self, object: u64) -> u32 {
        self.inner.visibility(entity(object)).map_or(0, |v| v.layers.mask)
    }

    #[wasm_bindgen(js_name = setLayers)]
    pub fn set_layers(&mut self, object: u64, mask: u32) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.layers.mask = mask;
        }
    }

    /// Zoom factor of a camera; updates its projection.
    #[wasm_bindgen(js_name = setCameraZoom)]
    pub fn set_camera_zoom(&mut self, object: u64, zoom: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        match &mut camera.projection {
            wamr_core::Projection::Perspective { zoom: current, .. } | wamr_core::Projection::Orthographic { zoom: current, .. } => *current = zoom,
        }
        camera.update_projection_matrix();
        Ok(())
    }

    /// Restricts a camera to a sub-rectangle of a larger virtual viewport.
    #[wasm_bindgen(js_name = setCameraViewOffset)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_camera_view_offset(&mut self, object: u64, full_width: f32, full_height: f32, x: f32, y: f32, width: f32, height: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        camera.set_view_offset(full_width, full_height, x, y, width, height);
        Ok(())
    }

    #[wasm_bindgen(js_name = clearCameraViewOffset)]
    pub fn clear_camera_view_offset(&mut self, object: u64) -> Result<(), JsError> {
        self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?.clear_view_offset();
        Ok(())
    }

    /// Which faces of the material count for picking: 0 front, 1 back, 2 both.
    #[wasm_bindgen(js_name = setMaterialSide)]
    pub fn set_material_side(&mut self, handle: u64, side: u8) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.side = match side {
            0 => wamr_core::Side::Front,
            1 => wamr_core::Side::Back,
            2 => wamr_core::Side::Double,
            _ => return Err(JsError::new("side must be 0 (front), 1 (back) or 2 (both)")),
        };
        Ok(())
    }

    /// The geometry's groups as three numbers each: start, count, material index.
    #[wasm_bindgen(js_name = getGroups)]
    pub fn get_groups(&self, handle: u64) -> Result<Vec<u32>, JsError> {
        let geometry = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?;
        Ok(geometry.groups.iter().flat_map(|g| [g.start, g.count, g.material_index]).collect())
    }

    #[wasm_bindgen(js_name = addGroup)]
    pub fn add_group(&mut self, handle: u64, start: u32, count: u32, material_index: u32) -> Result<(), JsError> {
        self.geometry_mut(handle)?.add_group(start, count, material_index);
        Ok(())
    }

    #[wasm_bindgen(js_name = clearGroups)]
    pub fn clear_groups(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.clear_groups();
        Ok(())
    }

    /// Removes an attribute; removing one the geometry does not have does nothing.
    #[wasm_bindgen(js_name = deleteAttribute)]
    pub fn delete_attribute(&mut self, handle: u64, name: &str) -> Result<(), JsError> {
        self.geometry_mut(handle)?.delete_attribute(name);
        Ok(())
    }

    #[wasm_bindgen(js_name = setDrawRange)]
    pub fn set_draw_range(&mut self, handle: u64, start: u32, count: u32) -> Result<(), JsError> {
        self.geometry_mut(handle)?.set_draw_range(start, count);
        Ok(())
    }

    /// Moves the geometry so that its bounding box is centred on the origin.
    #[wasm_bindgen(js_name = centerGeometry)]
    pub fn center_geometry(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.center();
        Ok(())
    }

    /// A new geometry with the index expanded away.
    #[wasm_bindgen(js_name = toNonIndexed)]
    pub fn to_non_indexed(&mut self, handle: u64) -> Result<u64, JsError> {
        let flat = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?.to_non_indexed();
        Ok(self.inner.create_geometry(flat).to_bits())
    }

    // ---- events

    /// Takes the queued events as triples `[kind, a, b]`. Kinds: 0 added (a = object),
    /// 1 removed (a = object), 2 childAdded (a = parent, b = child), 3 childRemoved
    /// (a = parent, b = child), 4 objectDisposed, 5 geometryDisposed, 6 materialDisposed,
    /// 7 renderTargetDisposed, 8 interleavedBufferDisposed (a = the handle).
    #[wasm_bindgen(js_name = drainEvents)]
    pub fn drain_events(&mut self) -> Vec<u64> {
        let mut out = Vec::new();
        for event in self.inner.drain_events() {
            let triple = match event {
                CoreEvent::Added { entity } => [0, entity.to_bits(), 0],
                CoreEvent::Removed { entity } => [1, entity.to_bits(), 0],
                CoreEvent::ChildAdded { parent, child } => [2, parent.to_bits(), child.to_bits()],
                CoreEvent::ChildRemoved { parent, child } => [3, parent.to_bits(), child.to_bits()],
                CoreEvent::ObjectDisposed { entity } => [4, entity.to_bits(), 0],
                CoreEvent::GeometryDisposed { geometry } => [5, geometry.to_bits(), 0],
                CoreEvent::MaterialDisposed { material } => [6, material.to_bits(), 0],
                CoreEvent::RenderTargetDisposed { target } => [7, target.to_bits(), 0],
                CoreEvent::InterleavedBufferDisposed { buffer } => [8, buffer.to_bits(), 0],
            };
            out.extend(triple);
        }
        out
    }
}
