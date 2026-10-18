use crate::arena::{Arena, Column, Handle};
use crate::attribute::{InterleavedBuffer, InterleavedBufferHandle};
use crate::camera::Camera;
use crate::components::{Hierarchy, Renderable, Skin, Transform, Visibility};
use crate::geometry::{BufferGeometry, GeometryHandle};
use crate::resources::{Material, RenderTarget, RenderTargetHandle};
use wamr_math::{Matrix4, Quaternion, Vector3};

mod graph;
mod skins;
mod placement;
mod stores;

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
/// AGENTS.md section 10 (Section 5 / 5.3) for the ownership and disposal rules.
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
    skins: Column<Skin>,

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
        self.skins.take(entity.index());
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
        if let Some(skin) = self.skins.get(index).cloned() {
            self.skins.set(copy.index(), skin);
        }

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
mod tests;
