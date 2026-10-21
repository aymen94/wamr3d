//! Skins and cameras of objects.

use super::*;

impl World {
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
        self.is_alive(entity).then(|| self.cameras.get(entity.index()).map(Box::as_ref)).flatten()
    }

    pub fn camera_mut(&mut self, entity: Entity) -> Option<&mut Camera> {
        self.is_alive(entity).then(|| self.cameras.get_mut(entity.index()).map(Box::as_mut)).flatten()
    }

    /// Makes the object a camera, or an ordinary object again with `None`.
    pub fn set_camera(&mut self, entity: Entity, camera: Option<Camera>) {
        if !self.is_alive(entity) {
            return;
        }
        match camera {
            Some(camera) => drop(self.cameras.set(entity.index(), Box::new(camera))),
            None => drop(self.cameras.take(entity.index())),
        }
    }
}
