//! WAMR3D: the JavaScript-facing API of the engine.
//!
//! Every type here is a thin shell over `wamr-math` or `wamr-core`; no computation or
//! state lives on the JavaScript side. Objects, geometries and materials are named by
//! 64-bit generational handles, which JavaScript sees as `BigInt`.

#![forbid(unsafe_code)]

use wamr_core::{
    AttributeAccess, AttributeArray, BufferAttribute, BufferGeometry, CoreEvent, Entity, GeometryHandle, Handle,
    Material, MaterialHandle, Renderable,
};
use wamr_math::{CoordinateSystem, EulerOrder};
use wasm_bindgen::prelude::*;

mod materials;
mod math;
mod picking;
mod renderer;
mod resources;
mod world;

pub use math::*;
pub use picking::RaycastHits;
pub use renderer::Renderer;

pub(crate) fn euler_order(order: &str) -> Result<EulerOrder, JsError> {
    Ok(match order {
        "XYZ" => EulerOrder::XYZ,
        "YXZ" => EulerOrder::YXZ,
        "ZXY" => EulerOrder::ZXY,
        "ZYX" => EulerOrder::ZYX,
        "YZX" => EulerOrder::YZX,
        "XZY" => EulerOrder::XZY,
        other => return Err(JsError::new(&format!("unknown Euler order: {other}"))),
    })
}

pub(crate) fn coordinate_system(webgpu: bool) -> CoordinateSystem {
    if webgpu {
        CoordinateSystem::WebGPU
    } else {
        CoordinateSystem::WebGL
    }
}

/// The crate version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------- Vector3

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Vector3 {
    inner: wamr_math::Vector3,
}

#[wasm_bindgen]
impl Vector3 {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3 { inner: wamr_math::Vector3::new(x, y, z) }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f32 {
        self.inner.x
    }

    #[wasm_bindgen(setter)]
    pub fn set_x(&mut self, x: f32) {
        self.inner.x = x;
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f32 {
        self.inner.y
    }

    #[wasm_bindgen(setter)]
    pub fn set_y(&mut self, y: f32) {
        self.inner.y = y;
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f32 {
        self.inner.z
    }

    #[wasm_bindgen(setter)]
    pub fn set_z(&mut self, z: f32) {
        self.inner.z = z;
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32) {
        self.inner.set(x, y, z);
    }

    pub fn copy(&mut self, v: &Vector3) {
        self.inner = v.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Vector3 {
        *self
    }

    pub fn add(&mut self, v: &Vector3) {
        self.inner.add(&v.inner);
    }

    pub fn sub(&mut self, v: &Vector3) {
        self.inner.sub(&v.inner);
    }

    #[wasm_bindgen(js_name = multiplyScalar)]
    pub fn multiply_scalar(&mut self, scalar: f32) {
        self.inner.multiply_scalar(scalar);
    }

    pub fn dot(&self, v: &Vector3) -> f32 {
        self.inner.dot(&v.inner)
    }

    pub fn cross(&mut self, v: &Vector3) {
        self.inner.cross(&v.inner);
    }

    pub fn length(&self) -> f32 {
        self.inner.length()
    }

    #[wasm_bindgen(js_name = lengthSq)]
    pub fn length_sq(&self) -> f32 {
        self.inner.length_sq()
    }

    pub fn normalize(&mut self) {
        self.inner.normalize();
    }

    #[wasm_bindgen(js_name = distanceTo)]
    pub fn distance_to(&self, v: &Vector3) -> f32 {
        self.inner.distance_to(&v.inner)
    }

    pub fn lerp(&mut self, v: &Vector3, alpha: f32) {
        self.inner.lerp(&v.inner, alpha);
    }

    #[wasm_bindgen(js_name = applyMatrix4)]
    pub fn apply_matrix4(&mut self, m: &Matrix4) {
        self.inner.apply_matrix4(&m.inner);
    }

    #[wasm_bindgen(js_name = applyQuaternion)]
    pub fn apply_quaternion(&mut self, q: &Quaternion) {
        self.inner.apply_quaternion(&q.inner);
    }

    #[wasm_bindgen(js_name = transformDirection)]
    pub fn transform_direction(&mut self, m: &Matrix4) {
        self.inner.transform_direction(&m.inner);
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

// ---------------------------------------------------------------- Quaternion

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Quaternion {
    inner: wamr_math::Quaternion,
}

#[wasm_bindgen]
impl Quaternion {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f32, y: f32, z: f32, w: f32) -> Quaternion {
        Quaternion { inner: wamr_math::Quaternion::new(x, y, z, w) }
    }

    #[wasm_bindgen(getter)]
    pub fn x(&self) -> f32 {
        self.inner.x
    }

    #[wasm_bindgen(getter)]
    pub fn y(&self) -> f32 {
        self.inner.y
    }

    #[wasm_bindgen(getter)]
    pub fn z(&self) -> f32 {
        self.inner.z
    }

    #[wasm_bindgen(getter)]
    pub fn w(&self) -> f32 {
        self.inner.w
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, w: f32) {
        self.inner.set(x, y, z, w);
    }

    pub fn copy(&mut self, q: &Quaternion) {
        self.inner = q.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Quaternion {
        *self
    }

    /// `axis` must be normalized.
    #[wasm_bindgen(js_name = setFromAxisAngle)]
    pub fn set_from_axis_angle(&mut self, axis: &Vector3, angle: f32) {
        self.inner.set_from_axis_angle(&axis.inner, angle);
    }

    /// `order` is one of "XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY".
    #[wasm_bindgen(js_name = setFromEuler)]
    pub fn set_from_euler(&mut self, x: f32, y: f32, z: f32, order: &str) -> Result<(), JsError> {
        self.inner.set_from_euler(&wamr_math::Euler::new(x, y, z, euler_order(order)?));
        Ok(())
    }

    #[wasm_bindgen(js_name = setFromRotationMatrix)]
    pub fn set_from_rotation_matrix(&mut self, m: &Matrix4) {
        self.inner.set_from_rotation_matrix(&m.inner);
    }

    pub fn multiply(&mut self, q: &Quaternion) {
        self.inner.multiply(&q.inner);
    }

    pub fn premultiply(&mut self, q: &Quaternion) {
        self.inner.premultiply(&q.inner);
    }

    pub fn slerp(&mut self, q: &Quaternion, t: f32) {
        self.inner.slerp(&q.inner, t);
    }

    pub fn normalize(&mut self) {
        self.inner.normalize();
    }

    pub fn invert(&mut self) {
        self.inner.invert();
    }

    pub fn dot(&self, q: &Quaternion) -> f32 {
        self.inner.dot(&q.inner)
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

// ---------------------------------------------------------------- Matrix4

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Matrix4 {
    inner: wamr_math::Matrix4,
}

#[wasm_bindgen]
impl Matrix4 {
    /// The identity matrix.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Matrix4 {
        Matrix4::default()
    }

    pub fn identity(&mut self) {
        self.inner.identity();
    }

    pub fn copy(&mut self, m: &Matrix4) {
        self.inner = m.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Matrix4 {
        *self
    }

    /// Sets the 16 elements, column-major.
    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(&mut self, elements: &[f32]) -> Result<(), JsError> {
        if elements.len() < 16 {
            return Err(JsError::new("Matrix4.fromArray needs 16 elements"));
        }
        self.inner.from_array(elements, 0);
        Ok(())
    }

    /// The 16 elements, column-major.
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.elements.to_vec()
    }

    pub fn multiply(&mut self, m: &Matrix4) {
        self.inner.multiply(&m.inner);
    }

    pub fn premultiply(&mut self, m: &Matrix4) {
        self.inner.premultiply(&m.inner);
    }

    #[wasm_bindgen(js_name = multiplyMatrices)]
    pub fn multiply_matrices(&mut self, a: &Matrix4, b: &Matrix4) {
        self.inner.multiply_matrices(&a.inner, &b.inner);
    }

    /// A singular matrix becomes the zero matrix.
    pub fn invert(&mut self) {
        self.inner.invert();
    }

    pub fn transpose(&mut self) {
        self.inner.transpose();
    }

    pub fn determinant(&self) -> f32 {
        self.inner.determinant()
    }

    pub fn compose(&mut self, position: &Vector3, quaternion: &Quaternion, scale: &Vector3) {
        self.inner.compose(&position.inner, &quaternion.inner, &scale.inner);
    }

    /// Returns ten numbers: position xyz, quaternion xyzw, scale xyz.
    pub fn decompose(&self) -> Vec<f32> {
        let (mut p, mut q, mut s) = Default::default();
        self.inner.decompose(&mut p, &mut q, &mut s);
        [&p.to_array()[..], &q.to_array()[..], &s.to_array()[..]].concat()
    }

    #[wasm_bindgen(js_name = makeTranslation)]
    pub fn make_translation(&mut self, x: f32, y: f32, z: f32) {
        self.inner.make_translation(x, y, z);
    }

    #[wasm_bindgen(js_name = makeScale)]
    pub fn make_scale(&mut self, x: f32, y: f32, z: f32) {
        self.inner.make_scale(x, y, z);
    }

    #[wasm_bindgen(js_name = makeRotationX)]
    pub fn make_rotation_x(&mut self, theta: f32) {
        self.inner.make_rotation_x(theta);
    }

    #[wasm_bindgen(js_name = makeRotationY)]
    pub fn make_rotation_y(&mut self, theta: f32) {
        self.inner.make_rotation_y(theta);
    }

    #[wasm_bindgen(js_name = makeRotationZ)]
    pub fn make_rotation_z(&mut self, theta: f32) {
        self.inner.make_rotation_z(theta);
    }

    #[wasm_bindgen(js_name = makeRotationFromQuaternion)]
    pub fn make_rotation_from_quaternion(&mut self, q: &Quaternion) {
        self.inner.make_rotation_from_quaternion(&q.inner);
    }

    /// Sets the rotation part so that -Z points from `eye` to `target`.
    #[wasm_bindgen(js_name = lookAt)]
    pub fn look_at(&mut self, eye: &Vector3, target: &Vector3, up: &Vector3) {
        self.inner.look_at(&eye.inner, &target.inner, &up.inner);
    }

    /// `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = makePerspective)]
    #[allow(clippy::too_many_arguments)]
    pub fn make_perspective(&mut self, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool, reversed_depth: bool) {
        self.inner.make_perspective(left, right, top, bottom, near, far, coordinate_system(webgpu), reversed_depth);
    }

    /// `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = makeOrthographic)]
    #[allow(clippy::too_many_arguments)]
    pub fn make_orthographic(&mut self, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool, reversed_depth: bool) {
        self.inner.make_orthographic(left, right, top, bottom, near, far, coordinate_system(webgpu), reversed_depth);
    }
}

// ---------------------------------------------------------------- Timer

/// Frame timing. Pass every timestamp in milliseconds, for example `performance.now()`.
#[wasm_bindgen]
pub struct Timer {
    inner: wamr_core::Timer,
}

#[wasm_bindgen]
impl Timer {
    #[wasm_bindgen(constructor)]
    pub fn new(now: f64) -> Timer {
        Timer { inner: wamr_core::Timer::new(now) }
    }

    pub fn update(&mut self, timestamp: f64) {
        self.inner.update(timestamp);
    }

    pub fn reset(&mut self, now: f64) {
        self.inner.reset(now);
    }

    /// Seconds between the last two updates.
    #[wasm_bindgen(js_name = getDelta)]
    pub fn get_delta(&self) -> f64 {
        self.inner.get_delta()
    }

    /// Seconds accumulated over all updates.
    #[wasm_bindgen(js_name = getElapsed)]
    pub fn get_elapsed(&self) -> f64 {
        self.inner.get_elapsed()
    }

    #[wasm_bindgen(js_name = setTimescale)]
    pub fn set_timescale(&mut self, timescale: f64) {
        self.inner.set_timescale(timescale);
    }
}

// ---------------------------------------------------------------- World

fn entity(handle: u64) -> Entity {
    Handle::from_bits(handle)
}

fn geometry(handle: u64) -> GeometryHandle {
    Handle::from_bits(handle)
}

fn material(handle: u64) -> MaterialHandle {
    Handle::from_bits(handle)
}

fn dead(what: &str) -> JsError {
    JsError::new(&format!("{what} handle is not alive"))
}

/// Owner of a scene: objects, their transforms and hierarchy, geometries and materials.
#[wasm_bindgen]
#[derive(Default)]
pub struct World {
    inner: wamr_core::World,
    /// Output of `matricesWorldPtr`, kept so that JavaScript can view it without a copy.
    scratch: Vec<f32>,
    /// Output of the single-value `*Ptr` readers (`getWorldPositionPtr` and the others),
    /// at a fixed address inside the module.
    readout: [f32; 4],
}

impl World {
    fn transform_mut(&mut self, object: u64) -> Result<&mut wamr_core::Transform, JsError> {
        self.inner.transform_mut(entity(object)).ok_or_else(|| dead("object"))
    }

    fn transform(&self, object: u64) -> Result<&wamr_core::Transform, JsError> {
        self.inner.transform(entity(object)).ok_or_else(|| dead("object"))
    }

    fn geometry_mut(&mut self, handle: u64) -> Result<&mut BufferGeometry, JsError> {
        self.inner.geometry_mut(geometry(handle)).ok_or_else(|| dead("geometry"))
    }

    fn attribute(&self, handle: u64, name: &str) -> Result<&BufferAttribute, JsError> {
        self.inner
            .geometry(geometry(handle))
            .ok_or_else(|| dead("geometry"))?
            .get_attribute(name)
            .ok_or_else(|| JsError::new(&format!("geometry has no attribute named {name}")))
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::GEOMETRY_STATE_FIELDS;

    #[test]
    fn math_shells_delegate() {
        let mut v = Vector3::new(1.0, 0.0, 0.0);
        let mut q = Quaternion::new(0.0, 0.0, 0.0, 1.0);
        q.set_from_axis_angle(&Vector3::new(0.0, 0.0, 1.0), core::f32::consts::FRAC_PI_2);
        v.apply_quaternion(&q);
        assert!((v.y() - 1.0).abs() < 1e-6);

        let mut m = Matrix4::new();
        m.make_translation(1.0, 2.0, 3.0);
        let mut p = Vector3::new(0.0, 0.0, 0.0);
        p.apply_matrix4(&m);
        assert_eq!(p.to_array(), [1.0, 2.0, 3.0]);
        assert_eq!(m.decompose()[..3], [1.0, 2.0, 3.0]);
    }

    #[test]
    fn world_shell_round_trips_handles() {
        let mut world = World::new();
        let (root, child) = (world.create_object(), world.create_object());
        assert!(world.add(root, child));
        assert_eq!(world.parent(child), Some(root));
        assert_eq!(world.children(root), [child]);
        assert_eq!(world.drain_events(), [0, child, 0, 2, root, child]);
        assert!(world.destroy(child) && !world.is_alive(child));
        assert_eq!(world.object_count(), 1);
    }

    #[test]
    fn geometry_state_describes_each_distinct_geometry_once() {
        let mut world = World::new();
        let (root, camera) = (world.create_object(), world.create_object());
        world.add(root, camera);
        world.set_perspective_camera(camera, 90.0, 1.0, 0.1, 100.0, true);
        let geometry = world.create_box_geometry(1.0, 1.0, 1.0, 1, 1, 1);
        let material = world.create_material("");
        for z in [-5.0, -6.0] {
            let object = world.create_object();
            world.add(root, object);
            world.set_renderable(object, geometry, material);
            assert!(world.set_position(object, 0.0, 0.0, z).is_ok());
        }
        world.update_matrix_world(root, false);

        let mut renderer = Renderer::new();
        assert_eq!(renderer.prepare(&mut world, root, camera).ok(), Some(2));
        assert_eq!(renderer.draw_geometry_slots(), [0, 0]);
        let state = renderer.geometry_state();
        assert_eq!(state.len(), GEOMETRY_STATE_FIELDS);
        assert_eq!(u64::from(state[0]) | u64::from(state[1]) << 32, geometry);
        assert_eq!(state[2], 24);
        // position, normal and uv can be bound; a box has no colours
        assert!(state[4] != 0 && state[6] != 0 && state[8] != 0);
        assert_eq!(state[10], 0);
        assert_eq!(state[GEOMETRY_STATE_FIELDS - 1], 3);

        // colours with alpha are bound with four floats each
        assert!(world.set_attribute(geometry, "color", &vec![1.0; 24 * 4], 4).is_ok());
        assert_eq!(renderer.prepare(&mut world, root, camera).ok(), Some(2));
        let state = renderer.geometry_state();
        assert!(state[10] != 0);
        assert_eq!(state[GEOMETRY_STATE_FIELDS - 1], 4);
    }

    #[test]
    fn timer_shell() {
        let mut t = Timer::new(0.0);
        t.update(500.0);
        assert_eq!((t.get_delta(), t.get_elapsed()), (0.5, 0.5));
    }
}
