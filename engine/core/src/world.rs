use crate::arena::{Arena, Column, Handle};
use crate::attribute::{InterleavedBuffer, InterleavedBufferHandle};
use crate::camera::Camera;
use crate::components::{Hierarchy, Renderable, Transform, Visibility};
use crate::geometry::{BufferGeometry, GeometryHandle};
use crate::resources::{Material, RenderTarget, RenderTargetHandle};
use wamr_math::{Matrix4, Quaternion, Vector3};

/// Marker type for entity handles; entities carry no data of their own.
#[derive(Debug)]
pub struct EntityTag;

/// An object in the scene. Plays the role of an `Object3D` reference.
pub type Entity = Handle<EntityTag>;

pub type MaterialHandle = Handle<Material>;

/// Something that happened in a [`World`], in the order it happened. Read with
/// [`World::drain_events`], normally once per frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoreEvent {
    /// `entity` was given a parent.
    Added { entity: Entity },
    /// `entity` was detached from its parent.
    Removed { entity: Entity },
    ChildAdded { parent: Entity, child: Entity },
    ChildRemoved { parent: Entity, child: Entity },
    /// The entity was destroyed, or its GPU resources were asked to be released.
    ObjectDisposed { entity: Entity },
    GeometryDisposed { geometry: GeometryHandle },
    MaterialDisposed { material: MaterialHandle },
    /// The target was disposed, or resized and still alive. Either way its GPU
    /// resources are stale.
    RenderTargetDisposed { target: RenderTargetHandle },
    InterleavedBufferDisposed { buffer: InterleavedBufferHandle },
}

/// An arena whose values are shared by handle, with a count of who shares them. The
/// count is informational: nothing is freed until `remove` is called.
struct Shared<T> {
    arena: Arena<(T, u32)>,
}

impl<T> Default for Shared<T> {
    fn default() -> Self {
        Self { arena: Arena::default() }
    }
}

impl<T> Shared<T> {
    // `Handle<(T, u32)>` and `Handle<T>` address the same slot; only the tag differs.
    fn inner(handle: Handle<T>) -> Handle<(T, u32)> {
        Handle::from_bits(handle.to_bits())
    }

    fn insert(&mut self, value: T) -> Handle<T> {
        Handle::from_bits(self.arena.insert((value, 0)).to_bits())
    }

    fn remove(&mut self, handle: Handle<T>) -> Option<T> {
        self.arena.remove(Self::inner(handle)).map(|(value, _)| value)
    }

    fn get(&self, handle: Handle<T>) -> Option<&T> {
        self.arena.get(Self::inner(handle)).map(|(value, _)| value)
    }

    fn get_mut(&mut self, handle: Handle<T>) -> Option<&mut T> {
        self.arena.get_mut(Self::inner(handle)).map(|(value, _)| value)
    }

    fn ref_count(&self, handle: Handle<T>) -> u32 {
        self.arena.get(Self::inner(handle)).map_or(0, |(_, count)| *count)
    }

    fn retain(&mut self, handle: Handle<T>) {
        if let Some((_, count)) = self.arena.get_mut(Self::inner(handle)) {
            *count += 1;
        }
    }

    fn release(&mut self, handle: Handle<T>) {
        if let Some((_, count)) = self.arena.get_mut(Self::inner(handle)) {
            *count = count.saturating_sub(1);
        }
    }
}

/// Owner of a scene: its objects, their components, and the geometries, materials,
/// render targets and interleaved buffers they use.
///
/// Everything is addressed by handle. Dropping the world frees all of it. See
/// DECISIONS.md section 5.3 for the ownership and disposal rules.
#[derive(Default)]
pub struct World {
    entities: Arena<EntityTag>,
    transforms: Column<Transform>,
    hierarchies: Column<Hierarchy>,
    visibilities: Column<Visibility>,
    names: Column<String>,
    renderables: Column<Renderable>,
    cameras: Column<Camera>,
    material_lists: Column<Vec<MaterialHandle>>,

    geometries: Shared<BufferGeometry>,
    materials: Shared<Material>,
    render_targets: Arena<RenderTarget>,
    interleaved_buffers: Shared<InterleavedBuffer>,

    events: Vec<CoreEvent>,
}

impl World {
    pub fn new() -> Self {
        Self::default()
    }

    // ---- objects

    /// Creates an object with default transform, no parent, visible on layer 0.
    pub fn create_object(&mut self) -> Entity {
        let entity = self.entities.insert(EntityTag);
        self.transforms.set(entity.index(), Transform::default());
        self.hierarchies.set(entity.index(), Hierarchy::default());
        self.visibilities.set(entity.index(), Visibility::default());
        entity
    }

    pub fn is_alive(&self, entity: Entity) -> bool {
        self.entities.contains(entity)
    }

    pub fn object_count(&self) -> usize {
        self.entities.len()
    }

    /// Destroys one object. It is detached from its parent, and its children stay
    /// alive as roots. Geometries and materials it used are not disposed. Returns false
    /// if the entity was not alive.
    pub fn destroy(&mut self, entity: Entity) -> bool {
        if !self.is_alive(entity) {
            return false;
        }

        self.remove_from_parent(entity);
        self.clear(entity);
        self.set_renderable(entity, None);

        self.transforms.take(entity.index());
        self.hierarchies.take(entity.index());
        self.visibilities.take(entity.index());
        self.names.take(entity.index());
        self.cameras.take(entity.index());
        self.material_lists.take(entity.index());
        self.entities.remove(entity);

        self.events.push(CoreEvent::ObjectDisposed { entity });
        true
    }

    /// Destroys an object and everything below it, children first.
    pub fn destroy_recursive(&mut self, entity: Entity) -> bool {
        if !self.is_alive(entity) {
            return false;
        }

        let mut subtree = Vec::new();
        self.traverse(entity, |e| subtree.push(e));
        for e in subtree.into_iter().rev() {
            self.destroy(e);
        }
        true
    }

    /// Creates a copy of an object: transform, flags, name, camera and what it draws
    /// (the copy shares the geometry and material). With `recursive` the whole subtree
    /// is copied too. The copy has no parent.
    pub fn clone_object(&mut self, source: Entity, recursive: bool) -> Option<Entity> {
        if !self.is_alive(source) {
            return None;
        }

        let copy = self.create_object();
        let index = source.index();

        if let Some(t) = self.transforms.get(index).cloned() {
            self.transforms.set(copy.index(), t);
        }
        if let Some(v) = self.visibilities.get(index).copied() {
            self.visibilities.set(copy.index(), v);
        }
        if let Some(name) = self.names.get(index).cloned() {
            self.names.set(copy.index(), name);
        }
        if let Some(camera) = self.cameras.get(index).copied() {
            self.cameras.set(copy.index(), camera);
        }
        let renderable = self.renderables.get(index).copied();
        self.set_renderable(copy, renderable);

        if recursive {
            for child in self.children(source).to_vec() {
                if let Some(child_copy) = self.clone_object(child, true) {
                    self.add(copy, child_copy);
                }
            }
        }

        Some(copy)
    }

    /// Asks for the object's GPU resources to be released, without destroying it.
    pub fn dispose_object(&mut self, entity: Entity) {
        if self.is_alive(entity) {
            self.events.push(CoreEvent::ObjectDisposed { entity });
        }
    }

    pub fn transform(&self, entity: Entity) -> Option<&Transform> {
        self.is_alive(entity).then(|| self.transforms.get(entity.index())).flatten()
    }

    pub fn transform_mut(&mut self, entity: Entity) -> Option<&mut Transform> {
        self.is_alive(entity).then(|| self.transforms.get_mut(entity.index())).flatten()
    }

    pub fn hierarchy(&self, entity: Entity) -> Option<&Hierarchy> {
        self.is_alive(entity).then(|| self.hierarchies.get(entity.index())).flatten()
    }

    pub fn visibility(&self, entity: Entity) -> Option<&Visibility> {
        self.is_alive(entity).then(|| self.visibilities.get(entity.index())).flatten()
    }

    pub fn visibility_mut(&mut self, entity: Entity) -> Option<&mut Visibility> {
        self.is_alive(entity).then(|| self.visibilities.get_mut(entity.index())).flatten()
    }

    /// The object's name; empty if it has none or is not alive.
    pub fn name(&self, entity: Entity) -> &str {
        if !self.is_alive(entity) {
            return "";
        }
        self.names.get(entity.index()).map_or("", String::as_str)
    }

    pub fn set_name(&mut self, entity: Entity, name: &str) {
        if !self.is_alive(entity) {
            return;
        }
        if name.is_empty() {
            self.names.take(entity.index());
        } else {
            self.names.set(entity.index(), name.to_string());
        }
    }

    pub fn renderable(&self, entity: Entity) -> Option<&Renderable> {
        self.is_alive(entity).then(|| self.renderables.get(entity.index())).flatten()
    }

    /// Sets or clears what the object draws, and keeps the reference counts of the
    /// geometry and material in step.
    pub fn set_renderable(&mut self, entity: Entity, renderable: Option<Renderable>) {
        if !self.is_alive(entity) {
            return;
        }

        if let Some(new) = &renderable {
            self.geometries.retain(new.geometry);
            self.materials.retain(new.material);
        }

        let old = match renderable {
            Some(new) => self.renderables.set(entity.index(), new),
            None => self.renderables.take(entity.index()),
        };

        if let Some(old) = old {
            self.geometries.release(old.geometry);
            self.materials.release(old.material);
        }
    }

    /// The materials of an object drawn with one material per geometry group, indexed
    /// by the group's material index. Empty for the usual single material.
    pub fn materials(&self, entity: Entity) -> &[MaterialHandle] {
        if !self.is_alive(entity) {
            return &[];
        }
        self.material_lists.get(entity.index()).map_or(&[], Vec::as_slice)
    }

    /// Sets the per-group materials; an empty list goes back to the single material of
    /// the renderable. The list does not count as references to the materials.
    pub fn set_materials(&mut self, entity: Entity, materials: Vec<MaterialHandle>) {
        if !self.is_alive(entity) {
            return;
        }
        if materials.is_empty() {
            self.material_lists.take(entity.index());
        } else {
            self.material_lists.set(entity.index(), materials);
        }
    }

    // ---- scene graph

    pub fn parent(&self, entity: Entity) -> Option<Entity> {
        self.hierarchy(entity)?.parent
    }

    pub fn children(&self, entity: Entity) -> &[Entity] {
        self.hierarchy(entity).map_or(&[], |h| h.children.as_slice())
    }

    /// Makes `child` a child of `parent`, detaching it from any previous parent first.
    /// Returns false, changing nothing, if either is not alive or they are the same
    /// object.
    ///
    /// Like three.js, this does not check for cycles: adding an ancestor as a child
    /// creates one, and traversals of it never end.
    pub fn add(&mut self, parent: Entity, child: Entity) -> bool {
        if parent == child || !self.is_alive(parent) || !self.is_alive(child) {
            return false;
        }

        self.remove_from_parent(child);

        if let Some(h) = self.hierarchies.get_mut(child.index()) {
            h.parent = Some(parent);
        }
        if let Some(h) = self.hierarchies.get_mut(parent.index()) {
            h.children.push(child);
        }

        self.events.push(CoreEvent::Added { entity: child });
        self.events.push(CoreEvent::ChildAdded { parent, child });
        true
    }

    /// Detaches `child` from `parent`. Returns false if it was not a child of `parent`.
    pub fn remove(&mut self, parent: Entity, child: Entity) -> bool {
        if !self.is_alive(parent) {
            return false;
        }

        let Some(siblings) = self.hierarchies.get_mut(parent.index()).map(|h| &mut h.children) else {
            return false;
        };
        let Some(position) = siblings.iter().position(|c| *c == child) else {
            return false;
        };
        siblings.remove(position);

        if let Some(h) = self.hierarchies.get_mut(child.index()) {
            h.parent = None;
        }

        self.events.push(CoreEvent::Removed { entity: child });
        self.events.push(CoreEvent::ChildRemoved { parent, child });
        true
    }

    pub fn remove_from_parent(&mut self, entity: Entity) {
        if let Some(parent) = self.parent(entity) {
            self.remove(parent, entity);
        }
    }

    /// Detaches every child of `entity`, in order.
    pub fn clear(&mut self, entity: Entity) {
        for child in self.children(entity).to_vec() {
            self.remove(entity, child);
        }
    }

    /// Calls `callback` for `entity` and every descendant, parents before children.
    pub fn traverse(&self, entity: Entity, mut callback: impl FnMut(Entity)) {
        self.traverse_inner(entity, false, &mut callback);
    }

    /// Like [`World::traverse`], but skips invisible objects and everything below them.
    pub fn traverse_visible(&self, entity: Entity, mut callback: impl FnMut(Entity)) {
        self.traverse_inner(entity, true, &mut callback);
    }

    fn traverse_inner(&self, entity: Entity, visible_only: bool, callback: &mut dyn FnMut(Entity)) {
        // An explicit stack: scene graphs can be deeper than the Wasm call stack allows.
        let mut stack = vec![entity];

        while let Some(e) = stack.pop() {
            if !self.is_alive(e) {
                continue;
            }
            if visible_only && !self.visibility(e).is_some_and(|v| v.visible) {
                continue;
            }

            callback(e);
            stack.extend(self.children(e).iter().rev());
        }
    }

    /// Calls `callback` for the parent, the grandparent, and so on up to the root.
    pub fn traverse_ancestors(&self, entity: Entity, mut callback: impl FnMut(Entity)) {
        let mut current = self.parent(entity);
        while let Some(e) = current {
            callback(e);
            current = self.parent(e);
        }
    }

    /// The first object named `name` in the subtree at `root`, searching depth first.
    pub fn get_object_by_name(&self, root: Entity, name: &str) -> Option<Entity> {
        let mut found = None;
        self.traverse(root, |e| {
            if found.is_none() && self.name(e) == name {
                found = Some(e);
            }
        });
        found
    }

    // ---- world matrices

    /// Updates one object's world matrix from its parent's. Returns the `force` flag
    /// its children must be updated with.
    fn update_own_world_matrix(&mut self, entity: Entity, force: bool) -> bool {
        let parent_world = self
            .parent(entity)
            .and_then(|p| self.transforms.get(p.index()))
            .map(|t| t.matrix_world);
        let Some(t) = self.transforms.get_mut(entity.index()) else {
            return force;
        };

        if t.matrix_auto_update {
            t.update_matrix();
        }

        if !(t.matrix_world_needs_update || force) {
            return false;
        }

        if t.matrix_world_auto_update {
            match parent_world {
                None => t.matrix_world = t.matrix,
                Some(parent_world) => {
                    let local = t.matrix;
                    t.matrix_world.multiply_matrices(&parent_world, &local);
                }
            }
        }

        t.matrix_world_needs_update = false;
        true
    }

    /// Updates the world matrices of `entity` and everything below it. A subtree is
    /// recomputed only where a local matrix changed, or everywhere with `force`.
    pub fn update_matrix_world(&mut self, entity: Entity, force: bool) {
        let mut stack = vec![(entity, force)];

        while let Some((e, force)) = stack.pop() {
            if !self.is_alive(e) {
                continue;
            }
            let force = self.update_own_world_matrix(e, force);
            self.update_camera_view(e);
            if let Some(h) = self.hierarchies.get(e.index()) {
                stack.extend(h.children.iter().rev().map(|c| (*c, force)));
            }
        }
    }

    /// Updates the world matrix of `entity`, optionally bringing its ancestors up to
    /// date first and its descendants afterwards.
    pub fn update_world_matrix(&mut self, entity: Entity, update_parents: bool, update_children: bool) {
        if !self.is_alive(entity) {
            return;
        }

        if update_parents {
            let mut ancestors = Vec::new();
            self.traverse_ancestors(entity, |e| ancestors.push(e));
            for ancestor in ancestors.into_iter().rev() {
                self.update_own_world_matrix(ancestor, false);
                self.update_camera_view(ancestor);
            }
        }

        let force = self.update_own_world_matrix(entity, false);
        self.update_camera_view(entity);

        if update_children {
            for child in self.children(entity).to_vec() {
                self.update_matrix_world(child, force);
            }
        }
    }

    fn update_camera_view(&mut self, entity: Entity) {
        if let (Some(camera), Some(t)) = (self.cameras.get_mut(entity.index()), self.transforms.get(entity.index())) {
            camera.update_view(&t.matrix_world);
        }
    }

    // ---- cameras

    pub fn camera(&self, entity: Entity) -> Option<&Camera> {
        self.is_alive(entity).then(|| self.cameras.get(entity.index())).flatten()
    }

    pub fn camera_mut(&mut self, entity: Entity) -> Option<&mut Camera> {
        self.is_alive(entity).then(|| self.cameras.get_mut(entity.index())).flatten()
    }

    /// Makes the object a camera, or an ordinary object again with `None`.
    pub fn set_camera(&mut self, entity: Entity, camera: Option<Camera>) {
        if !self.is_alive(entity) {
            return;
        }
        match camera {
            Some(camera) => drop(self.cameras.set(entity.index(), camera)),
            None => drop(self.cameras.take(entity.index())),
        }
    }

    // ---- world-space queries and placement

    fn world_matrix(&mut self, entity: Entity) -> Option<Matrix4> {
        self.update_world_matrix(entity, true, false);
        self.transform(entity).map(|t| t.matrix_world)
    }

    /// Converts a point from the local space of the object to world space.
    pub fn local_to_world(&mut self, entity: Entity, vector: &Vector3) -> Option<Vector3> {
        let world = self.world_matrix(entity)?;
        let mut v = *vector;
        v.apply_matrix4(&world);
        Some(v)
    }

    /// Converts a point from world space to the local space of the object.
    pub fn world_to_local(&mut self, entity: Entity, vector: &Vector3) -> Option<Vector3> {
        let mut inverse = self.world_matrix(entity)?;
        inverse.invert();
        let mut v = *vector;
        v.apply_matrix4(&inverse);
        Some(v)
    }

    pub fn get_world_position(&mut self, entity: Entity) -> Option<Vector3> {
        let world = self.world_matrix(entity)?;
        let mut v = Vector3::default();
        v.set_from_matrix_position(&world);
        Some(v)
    }

    fn decompose_world(&mut self, entity: Entity) -> Option<(Vector3, Quaternion, Vector3)> {
        let world = self.world_matrix(entity)?;
        let (mut p, mut q, mut s) = (Vector3::default(), Quaternion::default(), Vector3::default());
        world.decompose(&mut p, &mut q, &mut s);
        Some((p, q, s))
    }

    pub fn get_world_quaternion(&mut self, entity: Entity) -> Option<Quaternion> {
        self.decompose_world(entity).map(|(_, q, _)| q)
    }

    pub fn get_world_scale(&mut self, entity: Entity) -> Option<Vector3> {
        self.decompose_world(entity).map(|(_, _, s)| s)
    }

    /// The direction of the positive z-axis of the object in world space. For a camera,
    /// which looks down its negative z-axis, the viewing direction.
    pub fn get_world_direction(&mut self, entity: Entity) -> Option<Vector3> {
        let e = self.world_matrix(entity)?.elements;
        let mut direction = Vector3::new(e[8], e[9], e[10]);
        direction.normalize();
        if self.cameras.get(entity.index()).is_some() {
            direction.negate();
        }
        Some(direction)
    }

    /// Rotates the object so its positive z-axis (for a camera, its viewing direction)
    /// points at a position in world space. Does not support objects whose parents are
    /// scaled non-uniformly.
    pub fn look_at(&mut self, entity: Entity, x: f32, y: f32, z: f32) {
        let Some(world) = self.world_matrix(entity) else {
            return;
        };
        let target = Vector3::new(x, y, z);
        let mut position = Vector3::default();
        position.set_from_matrix_position(&world);

        let is_camera = self.cameras.get(entity.index()).is_some();
        let parent_world = self.parent(entity).and_then(|p| self.transform(p)).map(|t| t.matrix_world);
        let Some(t) = self.transforms.get_mut(entity.index()) else {
            return;
        };

        let mut m1 = Matrix4::default();
        if is_camera {
            m1.look_at(&position, &target, &t.up);
        } else {
            m1.look_at(&target, &position, &t.up);
        }

        let mut quaternion = Quaternion::default();
        quaternion.set_from_rotation_matrix(&m1);

        if let Some(parent_world) = parent_world {
            m1.extract_rotation(&parent_world);
            let mut q1 = Quaternion::default();
            q1.set_from_rotation_matrix(&m1);
            quaternion.premultiply(q1.invert());
        }

        t.set_quaternion(quaternion);
    }

    /// Makes `object` a child of `parent` while keeping its world transform. Does not
    /// support scene graphs with non-uniformly scaled nodes. Returns false, changing
    /// nothing, if either is not alive or they are the same object.
    pub fn attach(&mut self, parent: Entity, object: Entity) -> bool {
        if parent == object || !self.is_alive(parent) || !self.is_alive(object) {
            return false;
        }

        let Some(mut m1) = self.world_matrix(parent) else {
            return false;
        };
        m1.invert();

        if let Some(old_parent) = self.parent(object) {
            if let Some(old_world) = self.world_matrix(old_parent) {
                m1.multiply(&old_world);
            }
        }

        if let Some(t) = self.transforms.get_mut(object.index()) {
            t.apply_matrix4(&m1);
        }

        self.remove_from_parent(object);

        if let Some(h) = self.hierarchies.get_mut(object.index()) {
            h.parent = Some(parent);
        }
        if let Some(h) = self.hierarchies.get_mut(parent.index()) {
            h.children.push(object);
        }

        self.update_world_matrix(object, false, true);

        self.events.push(CoreEvent::Added { entity: object });
        self.events.push(CoreEvent::ChildAdded { parent, child: object });
        true
    }

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

    // ---- events and memory

    /// The events queued since the last drain, oldest first.
    pub fn events(&self) -> &[CoreEvent] {
        &self.events
    }

    /// Takes the queued events, leaving the queue empty.
    pub fn drain_events(&mut self) -> Vec<CoreEvent> {
        core::mem::take(&mut self.events)
    }

    /// Returns unused capacity to the allocator. Slots that were ever freed are kept,
    /// because they remember the generation that makes old handles fail.
    pub fn shrink_to_fit(&mut self) {
        self.entities.shrink_to_fit();
        self.transforms.shrink_to_fit();
        self.hierarchies.shrink_to_fit();
        self.visibilities.shrink_to_fit();
        self.names.shrink_to_fit();
        self.renderables.shrink_to_fit();
        self.cameras.shrink_to_fit();
        self.geometries.arena.shrink_to_fit();
        self.materials.arena.shrink_to_fit();
        self.render_targets.shrink_to_fit();
        self.interleaved_buffers.arena.shrink_to_fit();
        self.events.shrink_to_fit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attribute::AttributeArray;

    fn family(world: &mut World) -> (Entity, Entity, Entity, Entity) {
        let (root, a, b, a1) = (world.create_object(), world.create_object(), world.create_object(), world.create_object());
        world.add(root, a);
        world.add(root, b);
        world.add(a, a1);
        world.drain_events();
        (root, a, b, a1)
    }

    #[test]
    fn create_object_has_default_components() {
        let mut world = World::new();
        let e = world.create_object();
        assert!(world.is_alive(e));
        assert_eq!(world.object_count(), 1);
        assert_eq!(world.transform(e), Some(&Transform::default()));
        assert_eq!(world.visibility(e), Some(&Visibility::default()));
        assert_eq!(world.hierarchy(e), Some(&Hierarchy::default()));
        assert_eq!(world.name(e), "");
        assert!(world.renderable(e).is_none() && world.events().is_empty());
    }

    #[test]
    fn component_mutation() {
        let mut world = World::new();
        let e = world.create_object();
        world.transform_mut(e).unwrap().position.set(1.0, 2.0, 3.0);
        world.visibility_mut(e).unwrap().visible = false;
        world.set_name(e, "hero");
        assert_eq!(world.transform(e).unwrap().position.x, 1.0);
        assert!(!world.visibility(e).unwrap().visible);
        assert_eq!(world.name(e), "hero");
        world.set_name(e, "");
        assert_eq!(world.name(e), "");
    }

    #[test]
    fn add_links_both_sides_and_queues_events_in_order() {
        let mut world = World::new();
        let (parent, child) = (world.create_object(), world.create_object());
        assert!(world.add(parent, child));
        assert_eq!(world.parent(child), Some(parent));
        assert_eq!(world.children(parent), [child]);
        assert_eq!(
            world.drain_events(),
            [CoreEvent::Added { entity: child }, CoreEvent::ChildAdded { parent, child }]
        );
        assert!(world.events().is_empty());
    }

    #[test]
    fn add_rejects_self_and_dead_entities() {
        let mut world = World::new();
        let (a, b) = (world.create_object(), world.create_object());
        world.destroy(b);
        world.drain_events();
        assert!(!world.add(a, a));
        assert!(!world.add(a, b));
        assert!(!world.add(b, a));
        assert!(world.events().is_empty());
    }

    #[test]
    fn add_reparents() {
        let mut world = World::new();
        let (root, a, b, _) = family(&mut world);
        world.add(a, b);
        assert_eq!(world.children(root), [a]);
        assert_eq!(world.parent(b), Some(a));
        assert_eq!(
            world.drain_events(),
            [
                CoreEvent::Removed { entity: b },
                CoreEvent::ChildRemoved { parent: root, child: b },
                CoreEvent::Added { entity: b },
                CoreEvent::ChildAdded { parent: a, child: b },
            ]
        );
    }

    #[test]
    fn remove_and_remove_from_parent() {
        let mut world = World::new();
        let (root, a, b, _) = family(&mut world);
        assert!(world.remove(root, a));
        assert!(!world.remove(root, a));
        assert_eq!((world.parent(a), world.children(root)), (None, [b].as_slice()));
        world.remove_from_parent(b);
        assert!(world.children(root).is_empty());
        assert_eq!(world.drain_events().len(), 4);
    }

    #[test]
    fn clear_detaches_children_in_order() {
        let mut world = World::new();
        let (root, a, b, a1) = family(&mut world);
        world.clear(root);
        assert!(world.children(root).is_empty());
        assert_eq!(world.parent(a1), Some(a));
        let events = world.drain_events();
        assert_eq!(events[0], CoreEvent::Removed { entity: a });
        assert_eq!(events[3], CoreEvent::ChildRemoved { parent: root, child: b });
    }

    #[test]
    fn traversals() {
        let mut world = World::new();
        let (root, a, b, a1) = family(&mut world);

        let mut order = Vec::new();
        world.traverse(root, |e| order.push(e));
        assert_eq!(order, [root, a, a1, b]);

        world.visibility_mut(a).unwrap().visible = false;
        let mut visible = Vec::new();
        world.traverse_visible(root, |e| visible.push(e));
        assert_eq!(visible, [root, b]);

        let mut ancestors = Vec::new();
        world.traverse_ancestors(a1, |e| ancestors.push(e));
        assert_eq!(ancestors, [a, root]);
    }

    #[test]
    fn get_object_by_name() {
        let mut world = World::new();
        let (root, _, b, a1) = family(&mut world);
        world.set_name(a1, "wheel");
        world.set_name(b, "wheel");
        assert_eq!(world.get_object_by_name(root, "wheel"), Some(a1));
        assert_eq!(world.get_object_by_name(b, "wheel"), Some(b));
        assert_eq!(world.get_object_by_name(root, "missing"), None);
    }

    #[test]
    fn destroy_detaches_and_orphans_children() {
        let mut world = World::new();
        let (root, a, _, a1) = family(&mut world);
        assert!(world.destroy(a));
        assert!(!world.destroy(a));
        assert!(!world.is_alive(a) && world.is_alive(a1));
        assert_eq!(world.parent(a1), None);
        assert_eq!(world.children(root).len(), 1);
        assert!(world.transform(a).is_none() && world.hierarchy(a).is_none());
        assert_eq!(world.drain_events().last(), Some(&CoreEvent::ObjectDisposed { entity: a }));
    }

    #[test]
    fn a_reused_slot_does_not_inherit_components() {
        let mut world = World::new();
        let old = world.create_object();
        world.set_name(old, "old");
        world.transform_mut(old).unwrap().position.x = 5.0;
        world.destroy(old);
        let new = world.create_object();
        assert_eq!(new.index(), old.index());
        assert_eq!((world.name(new), world.name(old)), ("", ""));
        assert_eq!(world.transform(new).unwrap().position.x, 0.0);
        assert!(world.transform(old).is_none());
        world.set_name(old, "ghost");
        assert_eq!(world.name(new), "");
    }

    #[test]
    fn destroy_recursive() {
        let mut world = World::new();
        let (root, a, b, a1) = family(&mut world);
        assert!(world.destroy_recursive(a));
        assert!(!world.is_alive(a) && !world.is_alive(a1) && world.is_alive(b));
        assert_eq!(world.children(root), [b]);
        assert_eq!(world.object_count(), 2);
    }

    #[test]
    fn dispose_object_only_queues_an_event() {
        let mut world = World::new();
        let e = world.create_object();
        world.dispose_object(e);
        assert!(world.is_alive(e));
        assert_eq!(world.drain_events(), [CoreEvent::ObjectDisposed { entity: e }]);
    }

    #[test]
    fn update_matrix_world_composes_down_the_tree() {
        let mut world = World::new();
        let (root, a, _, a1) = family(&mut world);
        world.transform_mut(root).unwrap().position.set(1.0, 0.0, 0.0);
        world.transform_mut(a).unwrap().position.set(0.0, 2.0, 0.0);
        world.transform_mut(a1).unwrap().position.set(0.0, 0.0, 3.0);
        world.update_matrix_world(root, false);
        assert_eq!(world.transform(a1).unwrap().matrix_world.elements[12..15], [1.0, 2.0, 3.0]);
        assert!(!world.transform(a1).unwrap().matrix_world_needs_update);
    }

    #[test]
    fn update_matrix_world_skips_clean_subtrees_unless_forced() {
        let mut world = World::new();
        let (root, a, b, _) = family(&mut world);
        world.update_matrix_world(root, false);

        // with auto update off nothing marks the subtree dirty, so a stale value survives
        for e in [root, a, b] {
            world.transform_mut(e).unwrap().matrix_auto_update = false;
        }
        world.transform_mut(a).unwrap().matrix_world.elements[12] = 99.0;
        world.update_matrix_world(root, false);
        assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 99.0);
        world.update_matrix_world(root, true);
        assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 0.0);
    }

    #[test]
    fn update_world_matrix_can_update_parents_and_children() {
        let mut world = World::new();
        let (root, a, _, a1) = family(&mut world);
        world.transform_mut(root).unwrap().position.set(5.0, 0.0, 0.0);

        world.update_world_matrix(a, false, false);
        assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 0.0);

        world.update_world_matrix(a, true, true);
        assert_eq!(world.transform(a).unwrap().matrix_world.elements[12], 5.0);
        assert_eq!(world.transform(a1).unwrap().matrix_world.elements[12], 5.0);
    }

    #[test]
    fn cameras_get_a_view_matrix_from_world_updates() {
        let mut world = World::new();
        let (rig, eye) = (world.create_object(), world.create_object());
        world.add(rig, eye);
        world.set_camera(eye, Some(Camera::perspective(50.0, 1.0, 0.1, 100.0)));
        world.transform_mut(rig).unwrap().position.set(0.0, 0.0, 10.0);
        world.update_matrix_world(rig, false);
        assert_eq!(world.camera(eye).unwrap().matrix_world_inverse.elements[14], -10.0);
        world.camera_mut(eye).unwrap().reversed_depth = true;
        world.set_camera(eye, None);
        assert!(world.camera(eye).is_none());
    }

    #[test]
    fn world_space_queries() {
        let mut world = World::new();
        let (root, a, _, _) = family(&mut world);
        world.transform_mut(root).unwrap().position.set(1.0, 2.0, 3.0);
        world.transform_mut(root).unwrap().scale.set(2.0, 2.0, 2.0);
        world.transform_mut(a).unwrap().position.set(1.0, 0.0, 0.0);

        assert_eq!(world.get_world_position(a), Some(Vector3::new(3.0, 2.0, 3.0)));
        assert_eq!(world.get_world_scale(a), Some(Vector3::new(2.0, 2.0, 2.0)));
        assert_eq!(world.get_world_quaternion(a), Some(Quaternion::default()));
        assert_eq!(world.get_world_direction(a), Some(Vector3::new(0.0, 0.0, 1.0)));
        assert_eq!(world.local_to_world(a, &Vector3::new(0.0, 1.0, 0.0)), Some(Vector3::new(3.0, 4.0, 3.0)));
        assert_eq!(world.world_to_local(a, &Vector3::new(3.0, 4.0, 3.0)), Some(Vector3::new(0.0, 1.0, 0.0)));
    }

    #[test]
    fn look_at_points_objects_forward_and_cameras_backward() {
        let mut world = World::new();
        let (object, camera) = (world.create_object(), world.create_object());
        world.set_camera(camera, Some(Camera::perspective(50.0, 1.0, 0.1, 100.0)));

        world.look_at(object, 5.0, 0.0, 0.0);
        world.look_at(camera, 5.0, 0.0, 0.0);
        let towards = |world: &mut World, e| {
            let d = world.get_world_direction(e).unwrap();
            (d.x - 1.0).abs() < 1e-6 && d.y.abs() < 1e-6 && d.z.abs() < 1e-6
        };
        assert!(towards(&mut world, object) && towards(&mut world, camera));
    }

    #[test]
    fn attach_keeps_the_world_transform() {
        let mut world = World::new();
        let (root, a, b, _) = family(&mut world);
        world.transform_mut(a).unwrap().position.set(0.0, 5.0, 0.0);
        world.transform_mut(b).unwrap().position.set(2.0, 0.0, 0.0);
        world.update_matrix_world(root, false);
        world.drain_events();

        assert!(world.attach(a, b));
        assert_eq!(world.parent(b), Some(a));
        assert_eq!(world.get_world_position(b), Some(Vector3::new(2.0, 0.0, 0.0)));
        assert_eq!(world.transform(b).unwrap().position, Vector3::new(2.0, -5.0, 0.0));
        assert_eq!(world.drain_events().last(), Some(&CoreEvent::ChildAdded { parent: a, child: b }));
        assert!(!world.attach(a, a));
    }

    #[test]
    fn clone_object_copies_the_subtree_and_shares_resources() {
        let mut world = World::new();
        let (root, a, _, a1) = family(&mut world);
        let geometry = world.create_geometry(BufferGeometry::new());
        let material = world.create_material(Material::default());
        world.set_renderable(a1, Some(Renderable::mesh(geometry, material)));
        world.set_name(a, "arm");
        world.transform_mut(a).unwrap().position.set(1.0, 2.0, 3.0);
        world.set_camera(a, Some(Camera::perspective(50.0, 1.0, 0.1, 10.0)));

        let copy = world.clone_object(root, true).unwrap();
        assert_ne!(copy, root);
        assert_eq!(world.parent(copy), None);
        assert_eq!(world.children(copy).len(), 2);
        let a_copy = world.children(copy)[0];
        assert_eq!(world.name(a_copy), "arm");
        assert_eq!(world.transform(a_copy).unwrap().position, Vector3::new(1.0, 2.0, 3.0));
        assert!(world.camera(a_copy).is_some());
        assert_eq!(world.renderable(world.children(a_copy)[0]), world.renderable(a1));
        assert_eq!(world.geometry_ref_count(geometry), 2);

        let shallow = world.clone_object(root, false).unwrap();
        assert!(world.children(shallow).is_empty());
        world.destroy(a);
        assert!(world.clone_object(a, true).is_none());
    }

    #[test]
    fn renderables_count_references() {
        let mut world = World::new();
        let geometry = world.create_geometry(BufferGeometry::new());
        let material = world.create_material(Material { name: "red".into(), ..Material::default() });
        let (a, b) = (world.create_object(), world.create_object());
        let renderable = Renderable::mesh(geometry, material);

        world.set_renderable(a, Some(renderable));
        world.set_renderable(b, Some(renderable));
        assert_eq!(world.renderable(a), Some(&renderable));
        assert_eq!((world.geometry_ref_count(geometry), world.material_ref_count(material)), (2, 2));

        // replacing with the same resources must not drop the count to zero in between
        world.set_renderable(a, Some(renderable));
        assert_eq!(world.geometry_ref_count(geometry), 2);

        world.set_renderable(a, None);
        world.destroy(b);
        assert_eq!((world.geometry_ref_count(geometry), world.material_ref_count(material)), (0, 0));
        // unreferenced resources stay alive until disposed
        assert!(world.geometry(geometry).is_some() && world.material(material).is_some());
    }

    #[test]
    fn dispose_geometry_and_material_free_and_notify() {
        let mut world = World::new();
        let geometry = world.create_geometry(BufferGeometry::new());
        let material = world.create_material(Material::default());
        let e = world.create_object();
        world.set_renderable(e, Some(Renderable::mesh(geometry, material)));

        world.geometry_mut(geometry).unwrap().name = "box".into();
        world.material_mut(material).unwrap().name = "red".into();
        assert_eq!(world.geometry(geometry).unwrap().name, "box");

        assert!(world.dispose_geometry(geometry));
        assert!(!world.dispose_geometry(geometry));
        assert!(world.dispose_material(material));
        assert!(world.geometry(geometry).is_none() && world.material(material).is_none());
        assert_eq!(world.geometry_ref_count(geometry), 0);
        // the renderable keeps its now dead handles
        assert_eq!(world.renderable(e).unwrap().geometry, geometry);
        assert_eq!(
            world.drain_events(),
            [CoreEvent::GeometryDisposed { geometry }, CoreEvent::MaterialDisposed { material }]
        );
    }

    #[test]
    fn render_targets() {
        let mut world = World::new();
        let target = world.create_render_target(RenderTarget::new(4, 4));
        world.render_target_mut(target).unwrap().samples = 4;
        assert_eq!(world.render_target(target).unwrap().samples, 4);

        world.set_render_target_size(target, 4, 4, 1);
        assert!(world.events().is_empty());
        world.set_render_target_size(target, 8, 8, 1);
        assert_eq!(world.drain_events(), [CoreEvent::RenderTargetDisposed { target }]);
        assert_eq!(world.render_target(target).unwrap().width, 8);

        assert!(world.dispose_render_target(target));
        assert!(world.render_target(target).is_none() && !world.dispose_render_target(target));
    }

    #[test]
    fn interleaved_buffers() {
        let mut world = World::new();
        let buffer = world.create_interleaved_buffer(InterleavedBuffer::new(AttributeArray::Float32(vec![0.0; 10]), 5));
        world.retain_interleaved_buffer(buffer);
        world.retain_interleaved_buffer(buffer);
        world.release_interleaved_buffer(buffer);
        assert_eq!(world.interleaved_buffer_ref_count(buffer), 1);
        world.interleaved_buffer_mut(buffer).unwrap().needs_update();
        assert_eq!(world.interleaved_buffer(buffer).unwrap().version, 1);
        assert!(world.dispose_interleaved_buffer(buffer));
        assert_eq!(world.drain_events(), [CoreEvent::InterleavedBufferDisposed { buffer }]);
        assert!(world.interleaved_buffer(buffer).is_none());
    }

    #[test]
    fn shrink_to_fit_keeps_live_data() {
        let mut world = World::new();
        let keep = world.create_object();
        let extra: Vec<_> = (0..100).map(|_| world.create_object()).collect();
        for e in extra {
            world.destroy(e);
        }
        world.drain_events();
        world.shrink_to_fit();
        assert!(world.is_alive(keep));
        assert_eq!(world.object_count(), 1);
    }
}
