use crate::geometry::GeometryHandle;
use crate::layers::Layers;
use crate::world::{Entity, MaterialHandle};
use wamr_math::{Euler, EulerOrder, Matrix4, Quaternion, Vector3};

/// Local placement of an object, and its cached local and world matrices.
///
/// `rotation` and `quaternion` describe the same orientation and are kept in step:
/// changing either through its setter recomputes the other, so they are private.
#[derive(Clone, Debug, PartialEq)]
pub struct Transform {
    pub position: Vector3,
    rotation: Euler,
    quaternion: Quaternion,
    pub scale: Vector3,
    /// The direction `look_at` treats as up.
    pub up: Vector3,
    /// Point that rotation and scale pivot about, in local space. `None` is the origin.
    pub pivot: Option<Vector3>,
    pub matrix: Matrix4,
    pub matrix_world: Matrix4,
    /// Recompute `matrix` from position, rotation and scale whenever matrices are updated.
    pub matrix_auto_update: bool,
    pub matrix_world_auto_update: bool,
    pub matrix_world_needs_update: bool,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: Vector3::default(),
            rotation: Euler::default(),
            quaternion: Quaternion::default(),
            scale: Vector3::new(1.0, 1.0, 1.0),
            up: Self::DEFAULT_UP,
            pivot: None,
            matrix: Matrix4::default(),
            matrix_world: Matrix4::default(),
            matrix_auto_update: Self::DEFAULT_MATRIX_AUTO_UPDATE,
            matrix_world_auto_update: Self::DEFAULT_MATRIX_WORLD_AUTO_UPDATE,
            matrix_world_needs_update: false,
        }
    }
}

const X_AXIS: Vector3 = Vector3::new(1.0, 0.0, 0.0);
const Y_AXIS: Vector3 = Vector3::new(0.0, 1.0, 0.0);
const Z_AXIS: Vector3 = Vector3::new(0.0, 0.0, 1.0);

impl Transform {
    pub const DEFAULT_UP: Vector3 = Vector3::new(0.0, 1.0, 0.0);
    pub const DEFAULT_MATRIX_AUTO_UPDATE: bool = true;
    pub const DEFAULT_MATRIX_WORLD_AUTO_UPDATE: bool = true;

    pub fn rotation(&self) -> Euler {
        self.rotation
    }

    pub fn quaternion(&self) -> Quaternion {
        self.quaternion
    }

    /// Sets the Euler angles (and their order) and recomputes the quaternion.
    pub fn set_rotation(&mut self, rotation: Euler) {
        self.rotation = rotation;
        self.quaternion.set_from_euler(&rotation);
    }

    /// Changes the Euler order while keeping the angles, as assigning `rotation.order`
    /// does in three.js. The orientation changes unless at most one angle is non-zero.
    pub fn set_rotation_order(&mut self, order: EulerOrder) {
        let mut rotation = self.rotation;
        rotation.order = order;
        self.set_rotation(rotation);
    }

    /// Sets the quaternion and recomputes the Euler angles in the current order.
    pub fn set_quaternion(&mut self, quaternion: Quaternion) {
        self.quaternion = quaternion;
        self.rotation.set_from_quaternion(&quaternion, self.rotation.order);
    }

    /// Applies `matrix` on top of the local transform and decomposes the result back
    /// into position, rotation and scale.
    pub fn apply_matrix4(&mut self, matrix: &Matrix4) {
        if self.matrix_auto_update {
            self.update_matrix();
        }

        self.matrix.premultiply(matrix);

        let mut quaternion = self.quaternion;
        let matrix = self.matrix;
        matrix.decompose(&mut self.position, &mut quaternion, &mut self.scale);
        self.set_quaternion(quaternion);
    }

    pub fn apply_quaternion(&mut self, q: &Quaternion) -> &mut Self {
        let mut quaternion = self.quaternion;
        quaternion.premultiply(q);
        self.set_quaternion(quaternion);
        self
    }

    /// `axis` is assumed to be normalized.
    pub fn set_rotation_from_axis_angle(&mut self, axis: &Vector3, angle: f32) {
        let mut q = Quaternion::default();
        q.set_from_axis_angle(axis, angle);
        self.set_quaternion(q);
    }

    /// Sets the orientation from `euler`. The stored Euler angles keep their own order.
    pub fn set_rotation_from_euler(&mut self, euler: &Euler) {
        let mut q = Quaternion::default();
        q.set_from_euler(euler);
        self.set_quaternion(q);
    }

    /// Assumes the upper 3x3 of `m` is a pure rotation matrix (unscaled).
    pub fn set_rotation_from_matrix(&mut self, m: &Matrix4) {
        let mut q = Quaternion::default();
        q.set_from_rotation_matrix(m);
        self.set_quaternion(q);
    }

    /// `q` is assumed to be normalized.
    pub fn set_rotation_from_quaternion(&mut self, q: &Quaternion) {
        self.set_quaternion(*q);
    }

    /// Rotates about an axis in object space. `axis` is assumed to be normalized.
    pub fn rotate_on_axis(&mut self, axis: &Vector3, angle: f32) -> &mut Self {
        let mut q1 = Quaternion::default();
        q1.set_from_axis_angle(axis, angle);
        let mut quaternion = self.quaternion;
        quaternion.multiply(&q1);
        self.set_quaternion(quaternion);
        self
    }

    /// Rotates about an axis in world space. `axis` is assumed to be normalized, and
    /// the object to have no rotated parent.
    pub fn rotate_on_world_axis(&mut self, axis: &Vector3, angle: f32) -> &mut Self {
        let mut q1 = Quaternion::default();
        q1.set_from_axis_angle(axis, angle);
        let mut quaternion = self.quaternion;
        quaternion.premultiply(&q1);
        self.set_quaternion(quaternion);
        self
    }

    pub fn rotate_x(&mut self, angle: f32) -> &mut Self {
        self.rotate_on_axis(&X_AXIS, angle)
    }

    pub fn rotate_y(&mut self, angle: f32) -> &mut Self {
        self.rotate_on_axis(&Y_AXIS, angle)
    }

    pub fn rotate_z(&mut self, angle: f32) -> &mut Self {
        self.rotate_on_axis(&Z_AXIS, angle)
    }

    /// Moves along an axis in object space. `axis` is assumed to be normalized.
    pub fn translate_on_axis(&mut self, axis: &Vector3, distance: f32) -> &mut Self {
        let mut v1 = *axis;
        v1.apply_quaternion(&self.quaternion);
        self.position.add(v1.multiply_scalar(distance));
        self
    }

    pub fn translate_x(&mut self, distance: f32) -> &mut Self {
        self.translate_on_axis(&X_AXIS, distance)
    }

    pub fn translate_y(&mut self, distance: f32) -> &mut Self {
        self.translate_on_axis(&Y_AXIS, distance)
    }

    pub fn translate_z(&mut self, distance: f32) -> &mut Self {
        self.translate_on_axis(&Z_AXIS, distance)
    }

    /// Recomputes `matrix` from position, quaternion, scale and pivot, and flags the
    /// world matrix as stale.
    pub fn update_matrix(&mut self) {
        self.matrix.compose(&self.position, &self.quaternion, &self.scale);

        if let Some(pivot) = self.pivot {
            let (px, py, pz) = (pivot.x as f64, pivot.y as f64, pivot.z as f64);
            let te = self.matrix.elements.map(|e| e as f64);

            self.matrix.elements[12] = (te[12] + (px - te[0] * px - te[4] * py - te[8] * pz)) as f32;
            self.matrix.elements[13] = (te[13] + (py - te[1] * px - te[5] * py - te[9] * pz)) as f32;
            self.matrix.elements[14] = (te[14] + (pz - te[2] * px - te[6] * py - te[10] * pz)) as f32;
        }

        self.matrix_world_needs_update = true;
    }
}

/// Position of an object in the scene graph. Changed only through `World::add`,
/// `World::remove` and friends, which keep both sides of each link consistent.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Hierarchy {
    pub(crate) parent: Option<Entity>,
    pub(crate) children: Vec<Entity>,
}

impl Hierarchy {
    pub fn parent(&self) -> Option<Entity> {
        self.parent
    }

    pub fn children(&self) -> &[Entity] {
        &self.children
    }
}

/// Render flags of an object.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Visibility {
    pub visible: bool,
    pub layers: Layers,
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    pub frustum_culled: bool,
    pub render_order: f32,
    /// A hint that the object never moves. `static` in three.js.
    pub is_static: bool,
}

impl Default for Visibility {
    fn default() -> Self {
        Self {
            visible: true,
            layers: Layers::default(),
            cast_shadow: false,
            receive_shadow: false,
            frustum_culled: true,
            render_order: 0.0,
            is_static: false,
        }
    }
}

/// What an object draws. Both handles point into the owning `World`; either may be
/// dead if the resource was disposed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Renderable {
    pub geometry: GeometryHandle,
    pub material: MaterialHandle,
    pub primitive: Primitive,
    /// Id of per-instance data (matrices, colours) kept by the renderer's host; 0 draws
    /// the object once.
    pub instances: u32,
    pub instance_count: u32,
    /// `Some(center)` draws the geometry as a sprite: a quad that faces the camera,
    /// anchored at `center` (0.5, 0.5 is the middle), sized by the world scale.
    pub sprite: Option<[f32; 2]>,
}

impl Renderable {
    pub fn mesh(geometry: GeometryHandle, material: MaterialHandle) -> Self {
        Self { geometry, material, primitive: Primitive::Mesh, instances: 0, instance_count: 0, sprite: None }
    }
}

/// How a renderable's vertices are assembled.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Primitive {
    /// Triangles.
    #[default]
    Mesh = 0,
    /// One connected line through all vertices.
    Line = 1,
    /// Separate segments, one per pair of vertices.
    LineSegments = 2,
    /// One point per vertex, one pixel in size.
    Points = 3,
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::FRAC_PI_2;

    fn close(a: &[f32], b: &[f32]) {
        assert!(a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6), "{a:?} vs {b:?}");
    }

    #[test]
    fn defaults() {
        let t = Transform::default();
        assert_eq!((t.scale, t.up), (Vector3::new(1.0, 1.0, 1.0), Vector3::new(0.0, 1.0, 0.0)));
        assert!(t.matrix_auto_update && t.matrix_world_auto_update && !t.matrix_world_needs_update);
        assert_eq!((t.rotation(), t.quaternion(), t.pivot), (Euler::default(), Quaternion::default(), None));
        let v = Visibility::default();
        assert!(v.visible && v.frustum_culled && !v.cast_shadow && !v.receive_shadow && !v.is_static);
        assert_eq!((v.layers.mask, v.render_order), (1, 0.0));
        let h = Hierarchy::default();
        assert!(h.parent().is_none() && h.children().is_empty());
    }

    #[test]
    fn set_rotation_updates_quaternion() {
        let mut t = Transform::default();
        t.set_rotation(Euler::new(FRAC_PI_2, 0.0, 0.0, EulerOrder::XYZ));
        let mut expected = Quaternion::default();
        expected.set_from_axis_angle(&X_AXIS, FRAC_PI_2);
        close(&t.quaternion().to_array(), &expected.to_array());
    }

    #[test]
    fn set_quaternion_updates_rotation_in_its_order() {
        let mut t = Transform::default();
        t.set_rotation_order(EulerOrder::ZYX);
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Y_AXIS, 0.5);
        t.set_quaternion(q);
        assert_eq!(t.rotation().order, EulerOrder::ZYX);
        close(&t.rotation().to_array(), &[0.0, 0.5, 0.0]);
    }

    #[test]
    fn set_rotation_order_keeps_angles_and_recomputes_quaternion() {
        let mut t = Transform::default();
        t.set_rotation(Euler::new(0.3, 0.4, 0.0, EulerOrder::XYZ));
        let before = t.quaternion();
        t.set_rotation_order(EulerOrder::YXZ);
        assert_eq!(t.rotation(), Euler::new(0.3, 0.4, 0.0, EulerOrder::YXZ));
        assert_ne!(t.quaternion(), before);
    }

    #[test]
    fn set_rotation_from_variants_agree() {
        let euler = Euler::new(0.0, 0.0, 0.7, EulerOrder::XYZ);
        let mut q = Quaternion::default();
        q.set_from_euler(&euler);
        let mut m = Matrix4::default();
        m.make_rotation_from_quaternion(&q);

        let mut a = Transform::default();
        a.set_rotation_from_euler(&euler);
        let mut b = Transform::default();
        b.set_rotation_from_axis_angle(&Z_AXIS, 0.7);
        let mut c = Transform::default();
        c.set_rotation_from_matrix(&m);
        let mut d = Transform::default();
        d.set_rotation_from_quaternion(&q);

        for t in [&a, &b, &c, &d] {
            close(&t.quaternion().to_array(), &q.to_array());
            close(&t.rotation().to_array(), &[0.0, 0.0, 0.7]);
        }
    }

    #[test]
    fn apply_quaternion_premultiplies() {
        let mut t = Transform::default();
        t.rotate_x(0.3);
        let mut q = Quaternion::default();
        q.set_from_axis_angle(&Y_AXIS, 0.4);
        let mut expected = t.quaternion();
        expected.premultiply(&q);
        t.apply_quaternion(&q);
        close(&t.quaternion().to_array(), &expected.to_array());
    }

    #[test]
    fn rotate_on_axis_is_local_and_rotate_on_world_axis_is_global() {
        let mut local = Transform::default();
        local.rotate_x(FRAC_PI_2).rotate_on_axis(&Y_AXIS, FRAC_PI_2);
        let mut world = Transform::default();
        world.rotate_x(FRAC_PI_2).rotate_on_world_axis(&Y_AXIS, FRAC_PI_2);
        assert_ne!(local.quaternion(), world.quaternion());

        let mut forward = Vector3::new(0.0, 0.0, 1.0);
        forward.apply_quaternion(&world.quaternion());
        close(&forward.to_array(), &[0.0, -1.0, 0.0]);
    }

    #[test]
    fn rotate_x_y_z() {
        let mut t = Transform::default();
        t.rotate_z(FRAC_PI_2);
        close(&t.rotation().to_array(), &[0.0, 0.0, FRAC_PI_2]);
        let mut u = Transform::default();
        u.rotate_y(0.25);
        close(&u.rotation().to_array(), &[0.0, 0.25, 0.0]);
    }

    #[test]
    fn translate_follows_the_orientation() {
        let mut t = Transform::default();
        t.rotate_z(FRAC_PI_2).translate_x(2.0);
        close(&t.position.to_array(), &[0.0, 2.0, 0.0]);
        t.translate_y(1.0).translate_z(3.0);
        close(&t.position.to_array(), &[-1.0, 2.0, 3.0]);
        t.translate_on_axis(&Z_AXIS, -3.0);
        close(&t.position.to_array(), &[-1.0, 2.0, 0.0]);
    }

    #[test]
    fn update_matrix_composes_and_flags_world() {
        let mut t = Transform::default();
        t.position.set(1.0, 2.0, 3.0);
        t.scale.set(2.0, 2.0, 2.0);
        t.update_matrix();
        assert_eq!(t.matrix.elements[12..15], [1.0, 2.0, 3.0]);
        assert_eq!(t.matrix.elements[0], 2.0);
        assert!(t.matrix_world_needs_update);
    }

    #[test]
    fn update_matrix_with_pivot_keeps_the_pivot_point_fixed() {
        let mut t = Transform::default();
        t.pivot = Some(Vector3::new(1.0, 0.0, 0.0));
        t.rotate_z(FRAC_PI_2);
        t.scale.set(3.0, 3.0, 3.0);
        t.update_matrix();
        let mut p = Vector3::new(1.0, 0.0, 0.0);
        p.apply_matrix4(&t.matrix);
        close(&p.to_array(), &[1.0, 0.0, 0.0]);
    }

    #[test]
    fn apply_matrix4_bakes_into_position_rotation_scale() {
        let mut t = Transform::default();
        t.position.set(1.0, 0.0, 0.0);
        let mut m = Matrix4::default();
        m.make_scale(2.0, 2.0, 2.0);
        t.apply_matrix4(&m);
        close(&t.position.to_array(), &[2.0, 0.0, 0.0]);
        close(&t.scale.to_array(), &[2.0, 2.0, 2.0]);
        close(&t.quaternion().to_array(), &[0.0, 0.0, 0.0, 1.0]);
    }
}
