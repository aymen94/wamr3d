//! The `World` methods for geometries, built-in shapes, materials and renderables.

use super::*;

#[wasm_bindgen]
impl World {
    // ---- geometries

    #[wasm_bindgen(js_name = createGeometry)]
    pub fn create_geometry(&mut self) -> u64 {
        self.inner.create_geometry(BufferGeometry::new()).to_bits()
    }

    /// Frees the geometry. Its handle is dead afterwards.
    #[wasm_bindgen(js_name = disposeGeometry)]
    pub fn dispose_geometry(&mut self, handle: u64) -> bool {
        self.inner.dispose_geometry(geometry(handle))
    }

    /// Number of objects drawing this geometry.
    #[wasm_bindgen(js_name = geometryRefCount)]
    pub fn geometry_ref_count(&self, handle: u64) -> u32 {
        self.inner.geometry_ref_count(geometry(handle))
    }

    /// Adds or replaces a float attribute, copying `data` into engine memory.
    #[wasm_bindgen(js_name = setAttribute)]
    pub fn set_attribute(&mut self, handle: u64, name: &str, data: &[f32], item_size: u32) -> Result<(), JsError> {
        if item_size == 0 {
            return Err(JsError::new("item size must be at least 1"));
        }
        let mut attribute = BufferAttribute::new(AttributeArray::Float32(data.to_vec()), item_size as usize, false);
        let geometry = self.geometry_mut(handle)?;
        // Replacing an attribute must still look like a change to the renderer.
        if let Some(previous) = geometry.get_attribute(name) {
            attribute.version = previous.version.wrapping_add(1);
        }
        geometry.set_attribute(name, attribute);
        Ok(())
    }

    #[wasm_bindgen(js_name = setIndex)]
    pub fn set_index(&mut self, handle: u64, indices: &[u32]) -> Result<(), JsError> {
        let geometry = self.geometry_mut(handle)?;
        let version = geometry.get_index().map_or(0, |index| index.version);
        geometry.set_index_from_slice(indices);
        if let Some(index) = geometry.get_index_mut() {
            index.version = version.wrapping_add(1);
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = hasAttribute)]
    pub fn has_attribute(&self, handle: u64, name: &str) -> bool {
        self.attribute(handle, name).is_ok()
    }

    /// A copy of the attribute's values.
    #[wasm_bindgen(js_name = getAttribute)]
    pub fn get_attribute(&self, handle: u64, name: &str) -> Result<Vec<f32>, JsError> {
        let attribute = self.attribute(handle, name)?;
        Ok(match &attribute.array {
            AttributeArray::Float32(values) => values.clone(),
            other => (0..other.len()).map(|i| other.get(i) as f32).collect(),
        })
    }

    /// Byte offset of a float attribute's data in the module's memory, for building a
    /// zero-copy view. The offset is invalid once the attribute is replaced or the
    /// geometry disposed, and any view is detached when the memory grows.
    #[wasm_bindgen(js_name = attributePtr)]
    pub fn attribute_ptr(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        match &self.attribute(handle, name)?.array {
            AttributeArray::Float32(values) => Ok(values.as_ptr() as usize as u32),
            _ => Err(JsError::new("only float attributes can be viewed")),
        }
    }

    /// Number of values (not vertices) in the attribute.
    #[wasm_bindgen(js_name = attributeLength)]
    pub fn attribute_length(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        Ok(self.attribute(handle, name)?.array.len() as u32)
    }

    /// Number of vertices in the attribute.
    #[wasm_bindgen(js_name = attributeCount)]
    pub fn attribute_count(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        Ok(self.attribute(handle, name)?.count() as u32)
    }

    /// Tells the renderer the attribute changed, after writing through a view.
    #[wasm_bindgen(js_name = markAttributeNeedsUpdate)]
    pub fn mark_attribute_needs_update(&mut self, handle: u64, name: &str) -> Result<(), JsError> {
        self.geometry_mut(handle)?
            .get_attribute_mut(name)
            .ok_or_else(|| JsError::new(&format!("geometry has no attribute named {name}")))?
            .needs_update();
        Ok(())
    }

    /// Returns min xyz, max xyz.
    #[wasm_bindgen(js_name = computeBoundingBox)]
    pub fn compute_bounding_box(&mut self, handle: u64) -> Result<Vec<f32>, JsError> {
        let geometry = self.geometry_mut(handle)?;
        geometry.compute_bounding_box();
        let b = geometry.bounding_box.unwrap_or_default();
        Ok([b.min.to_array(), b.max.to_array()].concat())
    }

    /// Returns center xyz, radius.
    #[wasm_bindgen(js_name = computeBoundingSphere)]
    pub fn compute_bounding_sphere(&mut self, handle: u64) -> Result<Vec<f32>, JsError> {
        let geometry = self.geometry_mut(handle)?;
        geometry.compute_bounding_sphere();
        let s = geometry.bounding_sphere.unwrap_or_default();
        Ok(vec![s.center.x, s.center.y, s.center.z, s.radius])
    }

    #[wasm_bindgen(js_name = computeVertexNormals)]
    pub fn compute_vertex_normals(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.compute_vertex_normals();
        Ok(())
    }

    #[wasm_bindgen(js_name = computeTangents)]
    pub fn compute_tangents(&mut self, handle: u64) -> Result<(), JsError> {
        self.geometry_mut(handle)?.compute_tangents();
        Ok(())
    }

    /// Transforms the geometry's positions, normals and tangents.
    #[wasm_bindgen(js_name = applyMatrix4ToGeometry)]
    pub fn apply_matrix4_to_geometry(&mut self, handle: u64, matrix: &Matrix4) -> Result<(), JsError> {
        self.geometry_mut(handle)?.apply_matrix4(&matrix.inner);
        Ok(())
    }

    // ---- built-in shapes

    /// A box centred on the origin, with position, normal and uv attributes.
    #[wasm_bindgen(js_name = createBoxGeometry)]
    pub fn create_box_geometry(&mut self, width: f32, height: f32, depth: f32, width_segments: u32, height_segments: u32, depth_segments: u32) -> u64 {
        let geometry = wamr_objects::box_geometry(width, height, depth, width_segments, height_segments, depth_segments);
        self.inner.create_geometry(geometry).to_bits()
    }

    /// A rectangle in the XY plane facing +Z.
    #[wasm_bindgen(js_name = createPlaneGeometry)]
    pub fn create_plane_geometry(&mut self, width: f32, height: f32, width_segments: u32, height_segments: u32) -> u64 {
        self.inner.create_geometry(wamr_objects::plane_geometry(width, height, width_segments, height_segments)).to_bits()
    }

    /// A sphere, or a part of one. A full sphere is `phiStart = 0, phiLength = 2 PI,
    /// thetaStart = 0, thetaLength = PI`.
    #[wasm_bindgen(js_name = createSphereGeometry)]
    #[allow(clippy::too_many_arguments)]
    pub fn create_sphere_geometry(&mut self, radius: f32, width_segments: u32, height_segments: u32, phi_start: f32, phi_length: f32, theta_start: f32, theta_length: f32) -> u64 {
        let geometry = wamr_objects::sphere_geometry(radius, width_segments, height_segments, phi_start, phi_length, theta_start, theta_length);
        self.inner.create_geometry(geometry).to_bits()
    }

    #[wasm_bindgen(js_name = createCylinderGeometry)]
    #[allow(clippy::too_many_arguments)]
    pub fn create_cylinder_geometry(&mut self, radius_top: f32, radius_bottom: f32, height: f32, radial_segments: u32, height_segments: u32, open_ended: bool, theta_start: f32, theta_length: f32) -> u64 {
        let geometry = wamr_objects::cylinder_geometry(radius_top, radius_bottom, height, radial_segments, height_segments, open_ended, theta_start, theta_length);
        self.inner.create_geometry(geometry).to_bits()
    }

    #[wasm_bindgen(js_name = createCircleGeometry)]
    pub fn create_circle_geometry(&mut self, radius: f32, segments: u32, theta_start: f32, theta_length: f32) -> u64 {
        self.inner.create_geometry(wamr_objects::circle_geometry(radius, segments, theta_start, theta_length)).to_bits()
    }

    #[wasm_bindgen(js_name = createRingGeometry)]
    pub fn create_ring_geometry(&mut self, inner_radius: f32, outer_radius: f32, theta_segments: u32, phi_segments: u32, theta_start: f32, theta_length: f32) -> u64 {
        let geometry = wamr_objects::ring_geometry(inner_radius, outer_radius, theta_segments, phi_segments, theta_start, theta_length);
        self.inner.create_geometry(geometry).to_bits()
    }

    #[wasm_bindgen(js_name = createTorusGeometry)]
    #[allow(clippy::too_many_arguments)]
    pub fn create_torus_geometry(&mut self, radius: f32, tube: f32, radial_segments: u32, tubular_segments: u32, arc: f32, theta_start: f32, theta_length: f32) -> u64 {
        let geometry = wamr_objects::torus_geometry(radius, tube, radial_segments, tubular_segments, arc, theta_start, theta_length);
        self.inner.create_geometry(geometry).to_bits()
    }

    /// Upload counter of the index; 0 for a non-indexed geometry.
    #[wasm_bindgen(js_name = indexVersion)]
    pub fn index_version(&self, handle: u64) -> Result<u32, JsError> {
        let geometry = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?;
        Ok(geometry.get_index().map_or(0, |index| index.version))
    }

    /// A copy of the index, or an empty array for a non-indexed geometry.
    #[wasm_bindgen(js_name = getIndex)]
    pub fn get_index(&self, handle: u64) -> Result<Vec<u32>, JsError> {
        let geometry = self.inner.geometry(geometry(handle)).ok_or_else(|| dead("geometry"))?;
        Ok(geometry.get_index().map_or_else(Vec::new, |index| (0..index.array.len()).map(|i| index.array.get(i) as u32).collect()))
    }

    // ---- materials and renderables

    #[wasm_bindgen(js_name = createMaterial)]
    pub fn create_material(&mut self, name: &str) -> u64 {
        self.inner.create_material(Material { name: name.to_string(), ..Material::default() }).to_bits()
    }

    #[wasm_bindgen(js_name = disposeMaterial)]
    pub fn dispose_material(&mut self, handle: u64) -> bool {
        self.inner.dispose_material(material(handle))
    }

    /// Makes the object draw `geometry_handle` with `material_handle`.
    #[wasm_bindgen(js_name = setRenderable)]
    pub fn set_renderable(&mut self, object: u64, geometry_handle: u64, material_handle: u64) {
        let mut renderable = Renderable::mesh(geometry(geometry_handle), material(material_handle));
        if let Some(previous) = self.inner.renderable(entity(object)) {
            renderable.instances = previous.instances;
            renderable.instance_count = previous.instance_count;
        }
        self.inner.set_renderable(entity(object), Some(renderable));
    }

    /// Draws the object `count` times with the per-instance data the renderer's host
    /// keeps under `id`; id 0 goes back to a single draw.
    #[wasm_bindgen(js_name = setInstances)]
    pub fn set_instances(&mut self, object: u64, id: u32, count: u32) {
        if let Some(mut renderable) = self.inner.renderable(entity(object)).copied() {
            renderable.instances = id;
            renderable.instance_count = count;
            self.inner.set_renderable(entity(object), Some(renderable));
        }
    }

    /// One material per geometry group, indexed by the group's material index. An empty
    /// list goes back to the single material of the object.
    #[wasm_bindgen(js_name = setMaterials)]
    pub fn set_materials(&mut self, object: u64, materials: &[u64]) {
        self.inner.set_materials(entity(object), materials.iter().map(|m| material(*m)).collect());
    }

    /// Makes the object draw `geometry_handle` as a line: one connected line through
    /// all vertices, or separate segments per pair of vertices.
    #[wasm_bindgen(js_name = setLine)]
    pub fn set_line(&mut self, object: u64, geometry_handle: u64, material_handle: u64, segments: bool) {
        let primitive = if segments { wamr_core::Primitive::LineSegments } else { wamr_core::Primitive::Line };
        let renderable = Renderable { primitive, ..Renderable::mesh(geometry(geometry_handle), material(material_handle)) };
        self.inner.set_renderable(entity(object), Some(renderable));
    }

    /// Makes the object draw `geometry_handle` as a closed line: through all vertices and
    /// back to the first.
    #[wasm_bindgen(js_name = setLineLoop)]
    pub fn set_line_loop(&mut self, object: u64, geometry_handle: u64, material_handle: u64) {
        let renderable = Renderable { primitive: wamr_core::Primitive::LineLoop, ..Renderable::mesh(geometry(geometry_handle), material(material_handle)) };
        self.inner.set_renderable(entity(object), Some(renderable));
    }

    /// Makes the object draw `geometry_handle` as points, one pixel per vertex.
    #[wasm_bindgen(js_name = setPoints)]
    pub fn set_points(&mut self, object: u64, geometry_handle: u64, material_handle: u64) {
        let renderable = Renderable { primitive: wamr_core::Primitive::Points, ..Renderable::mesh(geometry(geometry_handle), material(material_handle)) };
        self.inner.set_renderable(entity(object), Some(renderable));
    }

    /// Makes the object a sprite: `geometry_handle` (a quad) faces the camera, anchored
    /// at `center_x, center_y` (0.5, 0.5 is the middle) and sized by the world scale.
    #[wasm_bindgen(js_name = setSprite)]
    pub fn set_sprite(&mut self, object: u64, geometry_handle: u64, material_handle: u64, center_x: f32, center_y: f32) {
        let renderable = Renderable { sprite: Some([center_x, center_y]), ..Renderable::mesh(geometry(geometry_handle), material(material_handle)) };
        self.inner.set_renderable(entity(object), Some(renderable));
    }

    /// Whether a standard material is lit by the frame's environment map, and how
    /// strongly (three.js `envMapIntensity` or the scene's `environmentIntensity`).
    #[wasm_bindgen(js_name = setMaterialEnvironment)]
    pub fn set_material_environment(&mut self, handle: u64, uses_environment: bool, intensity: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.uses_environment = uses_environment;
        material.env_map_intensity = intensity;
        Ok(())
    }

    /// Sprite settings of a material: rotation in radians, and whether the sprite gets
    /// smaller with distance.
    #[wasm_bindgen(js_name = setMaterialSprite)]
    pub fn set_material_sprite(&mut self, handle: u64, rotation: f32, size_attenuation: bool) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.rotation = rotation;
        material.size_attenuation = size_attenuation;
        Ok(())
    }

    #[wasm_bindgen(js_name = clearRenderable)]
    pub fn clear_renderable(&mut self, object: u64) {
        self.inner.set_renderable(entity(object), None);
    }
}
