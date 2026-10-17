use crate::arena::{Arena, Column, Handle};
use crate::attribute::{InterleavedBuffer, InterleavedBufferHandle};
use crate::camera::Camera;
use crate::components::{Hierarchy, Renderable, Skin, Transform, Visibility};
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

    // ---- skins

    pub fn skin(&self, entity: Entity) -> Option<&Skin> {
        self.is_alive(entity).then(|| self.skins.get(entity.index())).flatten()
    }

    /// Makes the object a skinned mesh, or an ordinary one again with `None`.
    pub fn set_skin(&mut self, entity: Entity, skin: Option<Skin>) {
        if !self.is_alive(entity) {
            return;
        }
        match skin {
            Some(skin) => drop(self.skins.set(entity.index(), skin)),
            None => drop(self.skins.take(entity.index())),
        }
    }

    /// Appends, per bone of the object's skin, the matrix that takes a vertex from the
    /// mesh's bind pose to its current pose in the mesh's local space: the bind-matrix
    /// inverse times the bone's world matrix times its inverse bind matrix times the bind
    /// matrix. Vertices are skinned by the weighted sum of these, so the shader needs
    /// neither bind matrix. World matrices must be up to date. Returns the bone count
    /// (0 for an object without a skin).
    pub fn skin_matrices(&self, entity: Entity, out: &mut Vec<f32>) -> usize {
        let Some(skin) = self.skin(entity) else {
            return 0;
        };
        let mut bind_inverse = skin.bind_matrix_inverse;
        if !skin.detached {
            if let Some(t) = self.transform(entity) {
                bind_inverse = t.matrix_world;
                bind_inverse.invert();
            }
        }
        for (i, bone) in skin.bones.iter().enumerate() {
            let mut m = bone.and_then(|b| self.transform(b)).map_or_else(Matrix4::default, |t| t.matrix_world);
            if let Some(inverse) = skin.bone_inverses.get(i) {
                m.multiply(inverse);
            }
            m.multiply(&skin.bind_matrix);
            m.premultiply(&bind_inverse);
            out.extend(m.elements);
        }
        skin.bones.len()
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
mod tests;
