//! World-space queries and placement (`lookAt`, `attach`).

use super::*;

impl World {
    // ---- world-space queries and placement

    pub(crate) fn world_matrix(&mut self, entity: Entity) -> Option<Matrix4> {
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

    pub(crate) fn decompose_world(&mut self, entity: Entity) -> Option<(Vector3, Quaternion, Vector3)> {
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
}
