//! The scene graph: parents, children, traversal and world matrices.

use super::*;

impl World {
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

    pub(crate) fn traverse_inner(&self, entity: Entity, visible_only: bool, callback: &mut dyn FnMut(Entity)) {
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
    pub(crate) fn update_own_world_matrix(&mut self, entity: Entity, force: bool) -> bool {
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

    pub(crate) fn update_camera_view(&mut self, entity: Entity) {
        if let (Some(camera), Some(t)) = (self.cameras.get_mut(entity.index()), self.transforms.get(entity.index())) {
            camera.update_view(&t.matrix_world);
        }
    }
}
