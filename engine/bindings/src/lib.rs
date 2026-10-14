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

mod math;

pub use math::*;

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

// ---------------------------------------------------------------- Renderer

/// Prepares frames for the WebGPU host: culling, draw order, uniform data and shader.
/// The host (`webgpu.js` in the package) issues the GPU calls.
#[wasm_bindgen]
#[derive(Default)]
pub struct Renderer {
    lighting: wamr_renderer::Lighting,
    frame: wamr_renderer::Frame,
    /// Per draw, the record in `geometry_state` that describes its geometry.
    geometry_slots: Vec<u32>,
    /// The same for the draws of each shadow pass.
    shadow_geometry_slots: Vec<Vec<u32>>,
    /// [`GEOMETRY_STATE_FIELDS`] numbers per distinct geometry of the frame.
    geometry_state: Vec<u32>,
}

/// Vertex inputs of the shader in location order, with their floats per vertex. The
/// host binds its vertex buffers in the same order.
const VERTEX_ATTRIBUTES: [(&str, usize); 4] = [("position", 3), ("normal", 3), ("uv", 2), ("color", 3)];

/// Slot index, generation, vertex count, a (version, address) pair per vertex input,
/// index version.
const GEOMETRY_STATE_FIELDS: usize = 3 + VERTEX_ATTRIBUTES.len() * 2 + 1;

/// Appends what the host needs to keep the GPU copy of `handle` current. An input that
/// is missing, not float, or of the wrong length gets address 0, and the host binds
/// zeros in its place. An address is valid until the attribute is replaced or the
/// geometry disposed; a view over it must be created after the last allocation, since
/// memory growth detaches earlier views.
fn push_geometry_state(out: &mut Vec<u32>, world: &wamr_core::World, handle: GeometryHandle) {
    let start = out.len();
    out.extend([handle.index(), handle.generation()]);
    if let Some(geometry) = world.geometry(handle) {
        let vertices = geometry.get_attribute("position").map_or(0, |a| a.count());
        out.push(vertices as u32);
        for (name, size) in VERTEX_ATTRIBUTES {
            let state = geometry.get_attribute(name).and_then(|a| match &a.array {
                AttributeArray::Float32(values) if values.len() == vertices * size => Some([a.version, values.as_ptr() as usize as u32]),
                _ => None,
            });
            out.extend(state.unwrap_or([0, 0]));
        }
        out.push(geometry.get_index().map_or(0, |index| index.version));
    }
    out.resize(start + GEOMETRY_STATE_FIELDS, 0);
}

#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Renderer {
        Renderer::default()
    }

    /// WGSL source of the mesh pipeline.
    #[wasm_bindgen(js_name = shaderSource)]
    pub fn shader_source() -> String {
        wamr_renderer::shader_source()
    }

    /// WGSL source of the passes that prefilter an environment map (three.js PMREM).
    #[wasm_bindgen(js_name = pmremShaderSource)]
    pub fn pmrem_shader_source() -> String {
        wamr_renderer::pmrem_shader_source()
    }

    /// Lights standard materials that use it with an equirectangular environment map:
    /// the host's texture id, the source image width, and the rotation of sampling
    /// directions as a 3x3 matrix (column-major, already inverted).
    #[wasm_bindgen(js_name = setEnvironment)]
    pub fn set_environment(&mut self, texture: u32, source_width: u32, rotation: &[f32]) {
        let mut matrix = wamr_math::Matrix3::default();
        if rotation.len() == 9 {
            matrix.elements.copy_from_slice(rotation);
        }
        self.lighting.environment = Some(wamr_renderer::Environment { texture, source_width, rotation: matrix });
    }

    #[wasm_bindgen(js_name = clearEnvironment)]
    pub fn clear_environment(&mut self) {
        self.lighting.environment = None;
    }

    /// The environment of the last prepared frame: texture id, `lodMax`, width and height
    /// of the prefiltered map; empty without one.
    #[wasm_bindgen(js_name = environmentInfo)]
    pub fn environment_info(&self) -> Vec<u32> {
        self.frame.environment.map_or_else(Vec::new, |e| {
            let (width, height) = e.layout_size();
            vec![e.texture, e.lod_max(), width, height]
        })
    }

    /// WGSL source of the output pass that tone-maps a linear frame onto the canvas.
    #[wasm_bindgen(js_name = outputShaderSource)]
    pub fn output_shader_source() -> String {
        wamr_renderer::OUTPUT_SHADER.to_string()
    }

    /// WGSL source of the depth-only shadow pipeline.
    #[wasm_bindgen(js_name = shadowShaderSource)]
    pub fn shadow_shader_source() -> String {
        wamr_renderer::SHADOW_SHADER.to_string()
    }

    /// Layers of the shadow texture array, the most shadow-casting lights per frame.
    #[wasm_bindgen(js_name = maxShadows)]
    pub fn max_shadows() -> u32 {
        wamr_renderer::MAX_SHADOWS as u32
    }

    /// three.js `renderer.shadowMap.enabled`.
    #[wasm_bindgen(js_name = setShadowsEnabled)]
    pub fn set_shadows_enabled(&mut self, enabled: bool) {
        self.lighting.shadows = enabled;
    }

    /// Gives the light added last a shadow. `orthographic` selects the projection:
    /// `a, b, c, d` are left, right, top, bottom for an orthographic camera, or the
    /// field of view in degrees and the aspect for a perspective one. The shadow camera
    /// looks at the target. Ignored for point lights.
    #[wasm_bindgen(js_name = setLastLightShadow)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_last_light_shadow(&mut self, orthographic: bool, a: f32, b: f32, c: f32, d: f32, near: f32, far: f32, target_x: f32, target_y: f32, target_z: f32, bias: f32, normal_bias: f32, intensity: f32, radius: f32, map_width: u32, map_height: u32) {
        let projection = if orthographic {
            wamr_renderer::ShadowProjection::Orthographic { left: a, right: b, top: c, bottom: d, near, far }
        } else {
            wamr_renderer::ShadowProjection::Perspective { fov: a, aspect: b, near, far }
        };
        if let Some(light) = self.lighting.lights.last_mut() {
            light.shadow = Some(wamr_renderer::LightShadow { projection, target: wamr_math::Vector3::new(target_x, target_y, target_z), bias, normal_bias, intensity, radius, map_width, map_height });
        }
    }

    /// Shadow passes of the last prepared frame.
    #[wasm_bindgen(js_name = shadowCount)]
    pub fn shadow_count(&self) -> u32 {
        self.frame.shadows.len() as u32
    }

    /// Width and height of each layer of the shadow texture array.
    #[wasm_bindgen(js_name = shadowMapSize)]
    pub fn shadow_map_size(&self) -> Vec<u32> {
        vec![self.frame.shadow_map_width, self.frame.shadow_map_height]
    }

    /// Layer, width and height of a pass's map, then its view-projection (16 floats).
    #[wasm_bindgen(js_name = shadowPassInfo)]
    pub fn shadow_pass_info(&self, pass: u32) -> Vec<f32> {
        self.frame.shadows.get(pass as usize).map_or_else(Vec::new, |p| {
            let mut out = vec![p.layer as f32, p.width as f32, p.height as f32];
            out.extend(p.view_projection);
            out
        })
    }

    /// Like `drawInfo`, for the casters of a shadow pass.
    #[wasm_bindgen(js_name = shadowDrawInfo)]
    pub fn shadow_draw_info(&self, pass: u32) -> Vec<u32> {
        self.frame.shadows.get(pass as usize).map_or_else(Vec::new, |p| p.draws.iter().flat_map(|d| [d.pipeline, d.map, d.start, d.count, d.instances, d.instance_count]).collect())
    }

    /// Like `drawGeometrySlots`, for the casters of a shadow pass.
    #[wasm_bindgen(js_name = shadowDrawGeometrySlots)]
    pub fn shadow_draw_geometry_slots(&self, pass: u32) -> Vec<u32> {
        self.shadow_geometry_slots.get(pass as usize).cloned().unwrap_or_default()
    }

    /// Object uniforms of a shadow pass (only the model matrix is read), same stride as
    /// `objectUniforms`.
    #[wasm_bindgen(js_name = shadowObjectUniforms)]
    pub fn shadow_object_uniforms(&self, pass: u32) -> Vec<f32> {
        self.frame.shadows.get(pass as usize).map_or_else(Vec::new, |p| p.object_uniforms.clone())
    }

    /// Index in `frameUniforms` of the tone mapping (a three.js constant, 0 for none);
    /// the exposure follows `TONE_MAPPING_EXPOSURE_INDEX`.
    #[wasm_bindgen(js_name = toneMappingIndex)]
    pub fn tone_mapping_index() -> u32 {
        wamr_renderer::TONE_MAPPING_INDEX as u32
    }

    #[wasm_bindgen(js_name = toneMappingExposureIndex)]
    pub fn tone_mapping_exposure_index() -> u32 {
        wamr_renderer::TONE_MAPPING_EXPOSURE_INDEX as u32
    }

    /// Bytes per object in `objectUniforms`.
    #[wasm_bindgen(js_name = objectUniformSize)]
    pub fn object_uniform_size() -> u32 {
        (wamr_renderer::OBJECT_UNIFORM_FLOATS * 4) as u32
    }

    /// Bytes of each object's uniforms that the shader reads.
    #[wasm_bindgen(js_name = objectBindingSize)]
    pub fn object_binding_size() -> u32 {
        (wamr_renderer::OBJECT_BINDING_FLOATS * 4) as u32
    }

    /// Lights beyond this many are ignored.
    #[wasm_bindgen(js_name = maxLights)]
    pub fn max_lights() -> u32 {
        wamr_renderer::MAX_LIGHTS as u32
    }

    /// Fog: `kind` 0 none, 1 linear between `near` and `far`, 2 exponential squared
    /// with `density`. The colour is linear.
    #[wasm_bindgen(js_name = setFog)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_fog(&mut self, kind: u8, r: f32, g: f32, b: f32, near: f32, far: f32, density: f32) {
        let kind = match kind {
            1 => wamr_renderer::FogKind::Linear,
            2 => wamr_renderer::FogKind::Exponential,
            _ => wamr_renderer::FogKind::None,
        };
        self.lighting.fog = wamr_renderer::Fog { kind, color: wamr_math::Color::new(r, g, b), near, far, density };
    }

    /// Tone mapping of the output, as a three.js constant (0 none, 1 linear, 2 Reinhard,
    /// 3 Cineon, 4 ACES filmic, 6 AgX, 7 neutral), and its exposure.
    #[wasm_bindgen(js_name = setToneMapping)]
    pub fn set_tone_mapping(&mut self, kind: u8, exposure: f32) {
        self.lighting.tone_mapping = wamr_renderer::ToneMapping::from_u8(kind);
        self.lighting.exposure = exposure;
    }

    #[wasm_bindgen(js_name = clearLights)]
    pub fn clear_lights(&mut self) {
        self.lighting.lights.clear();
    }

    /// Adds a directional light: direction towards the light, linear colour, intensity.
    #[wasm_bindgen(js_name = addDirectionalLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_directional_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        let light = wamr_renderer::Light { direction: wamr_math::Vector3::new(x, y, z), color: wamr_math::Color::new(r, g, b), intensity, ..Default::default() };
        self.lighting.lights.push(light);
    }

    /// Adds a point light at a world position. `distance` 0 means no cutoff.
    #[wasm_bindgen(js_name = addPointLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_point_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32, distance: f32, decay: f32) {
        self.lighting.lights.push(wamr_renderer::Light {
            kind: wamr_renderer::LightKind::Point,
            position: wamr_math::Vector3::new(x, y, z),
            color: wamr_math::Color::new(r, g, b),
            intensity,
            distance,
            decay,
            ..Default::default()
        });
    }

    /// Adds a spot light at a world position shining at a world target. `angle` is the
    /// cone's half angle in radians; `penumbra` (0..1) is the soft share of the cone.
    #[wasm_bindgen(js_name = addSpotLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn add_spot_light(&mut self, x: f32, y: f32, z: f32, target_x: f32, target_y: f32, target_z: f32, r: f32, g: f32, b: f32, intensity: f32, distance: f32, decay: f32, angle: f32, penumbra: f32) {
        self.lighting.lights.push(wamr_renderer::Light {
            kind: wamr_renderer::LightKind::Spot,
            position: wamr_math::Vector3::new(x, y, z),
            direction: wamr_math::Vector3::new(x - target_x, y - target_y, z - target_z),
            color: wamr_math::Color::new(r, g, b),
            intensity,
            distance,
            decay,
            cone_cos: (angle as f64).cos() as f32,
            penumbra_cos: (angle as f64 * (1.0 - penumbra as f64)).cos() as f32,
            shadow: None,
        });
    }

    /// Replaces all lights with one directional light.
    #[wasm_bindgen(js_name = setDirectionalLight)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_directional_light(&mut self, x: f32, y: f32, z: f32, r: f32, g: f32, b: f32, intensity: f32) {
        self.lighting.lights.clear();
        self.add_directional_light(x, y, z, r, g, b, intensity);
    }

    /// Ambient light from above (sky) and below (ground), linear colours.
    #[wasm_bindgen(js_name = setAmbientLight)]
    pub fn set_ambient_light(&mut self, sky_r: f32, sky_g: f32, sky_b: f32, ground_r: f32, ground_g: f32, ground_b: f32) {
        self.lighting.sky = wamr_math::Color::new(sky_r, sky_g, sky_b);
        self.lighting.ground = wamr_math::Color::new(ground_r, ground_g, ground_b);
    }

    /// Builds the frame for `camera` looking at the subtree of `root` and returns the
    /// number of draws. World matrices must be up to date.
    pub fn prepare(&mut self, world: &mut World, root: u64, camera: u64) -> Result<u32, JsError> {
        self.frame = wamr_renderer::prepare_frame(&mut world.inner, entity(root), entity(camera), &self.lighting)
            .ok_or_else(|| JsError::new("object is not a camera"))?;

        self.geometry_slots.clear();
        self.geometry_state.clear();
        self.shadow_geometry_slots.clear();
        let mut records: std::collections::HashMap<GeometryHandle, u32> = std::collections::HashMap::new();
        let state = &mut self.geometry_state;
        let mut slot_of = |geometry: GeometryHandle| -> u32 {
            *records.entry(geometry).or_insert_with(|| {
                let slot = (state.len() / GEOMETRY_STATE_FIELDS) as u32;
                push_geometry_state(state, &world.inner, geometry);
                slot
            })
        };
        for draw in &self.frame.draws {
            self.geometry_slots.push(slot_of(draw.geometry));
        }
        for pass in &self.frame.shadows {
            self.shadow_geometry_slots.push(pass.draws.iter().map(|d| slot_of(d.geometry)).collect());
        }

        Ok(self.frame.draws.len() as u32)
    }

    /// Numbers per record of `geometryState`.
    #[wasm_bindgen(js_name = geometryStateSize)]
    pub fn geometry_state_size() -> u32 {
        GEOMETRY_STATE_FIELDS as u32
    }

    /// One record per distinct geometry of the last prepared frame: slot index and
    /// generation of the handle, vertex count, then for position, normal, uv and colour
    /// the attribute's version and the address of its floats (0 when the shader input
    /// cannot use it), then the index version. Everything the host needs to decide what
    /// to upload, in one call.
    #[wasm_bindgen(js_name = geometryState)]
    pub fn geometry_state(&self) -> Vec<u32> {
        self.geometry_state.clone()
    }

    /// Per draw, which record of `geometryState` describes its geometry.
    #[wasm_bindgen(js_name = drawGeometrySlots)]
    pub fn draw_geometry_slots(&self) -> Vec<u32> {
        self.geometry_slots.clone()
    }

    /// Objects that had something to draw before culling, in the last prepared frame.
    #[wasm_bindgen(js_name = candidateCount)]
    pub fn candidate_count(&self) -> u32 {
        self.frame.candidates as u32
    }

    #[wasm_bindgen(js_name = frameUniforms)]
    pub fn frame_uniforms(&self) -> Vec<f32> {
        self.frame.frame_uniforms.clone()
    }

    /// Address of the object uniform data inside the module's memory, for a view
    /// without a copy. Valid until the next `prepare` or memory growth.
    #[wasm_bindgen(js_name = objectUniformsPtr)]
    pub fn object_uniforms_ptr(&self) -> u32 {
        self.frame.object_uniforms.as_ptr() as u32
    }

    /// Number of floats at `objectUniformsPtr`.
    #[wasm_bindgen(js_name = objectUniformsLength)]
    pub fn object_uniforms_length(&self) -> u32 {
        self.frame.object_uniforms.len() as u32
    }

    #[wasm_bindgen(js_name = objectUniforms)]
    pub fn object_uniforms(&self) -> Vec<f32> {
        self.frame.object_uniforms.clone()
    }

    /// The geometry handle of each draw, in draw order.
    #[wasm_bindgen(js_name = drawGeometries)]
    pub fn draw_geometries(&self) -> Vec<u64> {
        self.frame.draws.iter().map(|d| d.geometry.to_bits()).collect()
    }

    /// Six numbers per draw, in draw order: pipeline state, colour texture id (0 for
    /// none), first index or vertex, count, instance data id (0 for none) and number of
    /// instances. Pipeline state bits: 0-1 side (0 front,
    /// 1 back, 2 both), 2 alpha blending, 3 depth write, 4 depth test, 5-6 primitive
    /// (0 triangles, 1 line strip, 2 line list).
    #[wasm_bindgen(js_name = drawInfo)]
    pub fn draw_info(&self) -> Vec<u32> {
        self.frame.draws.iter().flat_map(|d| [d.pipeline, d.map, d.start, d.count, d.instances, d.instance_count]).collect()
    }
}

// ---------------------------------------------------------------- RaycastHits

/// The result of a raycast: hits sorted nearest first. Index 0 is the closest.
#[wasm_bindgen]
pub struct RaycastHits {
    hits: Vec<wamr_objects::Intersection>,
}

impl RaycastHits {
    fn hit(&self, index: u32) -> Result<&wamr_objects::Intersection, JsError> {
        self.hits.get(index as usize).ok_or_else(|| JsError::new("hit index out of range"))
    }
}

#[wasm_bindgen]
impl RaycastHits {
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> u32 {
        self.hits.len() as u32
    }

    /// The object that was hit.
    pub fn object(&self, index: u32) -> Result<u64, JsError> {
        Ok(self.hit(index)?.object.to_bits())
    }

    /// Distance from the ray origin, in world units.
    pub fn distance(&self, index: u32) -> Result<f32, JsError> {
        Ok(self.hit(index)?.distance)
    }

    /// The hit point in world space.
    pub fn point(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.point.to_array().to_vec())
    }

    /// For a hit on a line, where the segment starts; `undefined` for a mesh.
    #[wasm_bindgen(js_name = lineIndex)]
    pub fn line_index(&self, index: u32) -> Result<Option<u32>, JsError> {
        Ok(self.hit(index)?.line_index)
    }

    /// Index of the triangle within the geometry.
    #[wasm_bindgen(js_name = faceIndex)]
    pub fn face_index(&self, index: u32) -> Result<u32, JsError> {
        Ok(self.hit(index)?.face_index)
    }

    /// The three vertex indices of the triangle.
    #[wasm_bindgen(js_name = faceVertices)]
    pub fn face_vertices(&self, index: u32) -> Result<Vec<u32>, JsError> {
        let face = self.hit(index)?.face;
        Ok(vec![face.a, face.b, face.c])
    }

    /// The triangle normal in the local space of the object.
    #[wasm_bindgen(js_name = faceNormal)]
    pub fn face_normal(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.face.normal.to_array().to_vec())
    }

    pub fn barycoord(&self, index: u32) -> Result<Vec<f32>, JsError> {
        Ok(self.hit(index)?.barycoord.to_array().to_vec())
    }

    /// Interpolated texture coordinate, or `undefined` if the geometry has none.
    pub fn uv(&self, index: u32) -> Result<Option<Vec<f32>>, JsError> {
        Ok(self.hit(index)?.uv.map(|uv| uv.to_array().to_vec()))
    }

    /// Interpolated vertex normal facing the ray, or `undefined` if the geometry has none.
    pub fn normal(&self, index: u32) -> Result<Option<Vec<f32>>, JsError> {
        Ok(self.hit(index)?.normal.map(|n| n.to_array().to_vec()))
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

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new() -> World {
        World::default()
    }

    // ---- objects

    #[wasm_bindgen(js_name = createObject)]
    pub fn create_object(&mut self) -> u64 {
        self.inner.create_object().to_bits()
    }

    /// Creates `count` objects at once and returns their handles.
    #[wasm_bindgen(js_name = createObjects)]
    pub fn create_objects(&mut self, count: u32) -> Vec<u64> {
        (0..count).map(|_| self.inner.create_object().to_bits()).collect()
    }

    /// Destroys one object; its children stay alive as roots.
    pub fn destroy(&mut self, object: u64) -> bool {
        self.inner.destroy(entity(object))
    }

    #[wasm_bindgen(js_name = destroyRecursive)]
    pub fn destroy_recursive(&mut self, object: u64) -> bool {
        self.inner.destroy_recursive(entity(object))
    }

    #[wasm_bindgen(js_name = isAlive)]
    pub fn is_alive(&self, object: u64) -> bool {
        self.inner.is_alive(entity(object))
    }

    #[wasm_bindgen(js_name = objectCount)]
    pub fn object_count(&self) -> u32 {
        self.inner.object_count() as u32
    }

    pub fn name(&self, object: u64) -> String {
        self.inner.name(entity(object)).to_string()
    }

    #[wasm_bindgen(js_name = setName)]
    pub fn set_name(&mut self, object: u64, name: &str) {
        self.inner.set_name(entity(object), name);
    }

    #[wasm_bindgen(js_name = isVisible)]
    pub fn is_visible(&self, object: u64) -> bool {
        self.inner.visibility(entity(object)).is_some_and(|v| v.visible)
    }

    #[wasm_bindgen(js_name = setVisible)]
    pub fn set_visible(&mut self, object: u64, visible: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.visible = visible;
        }
    }

    // ---- scene graph

    /// Makes `child` a child of `parent`. Returns false if either is dead or they are
    /// the same object.
    pub fn add(&mut self, parent: u64, child: u64) -> bool {
        self.inner.add(entity(parent), entity(child))
    }

    /// Parents `children[i]` to `parents[i]` for every index.
    #[wasm_bindgen(js_name = addMany)]
    pub fn add_many(&mut self, parents: &[u64], children: &[u64]) {
        for (parent, child) in parents.iter().zip(children) {
            self.inner.add(entity(*parent), entity(*child));
        }
    }

    pub fn remove(&mut self, parent: u64, child: u64) -> bool {
        self.inner.remove(entity(parent), entity(child))
    }

    #[wasm_bindgen(js_name = removeFromParent)]
    pub fn remove_from_parent(&mut self, object: u64) {
        self.inner.remove_from_parent(entity(object));
    }

    pub fn clear(&mut self, object: u64) {
        self.inner.clear(entity(object));
    }

    /// The parent's handle, or `undefined` for a root.
    pub fn parent(&self, object: u64) -> Option<u64> {
        self.inner.parent(entity(object)).map(Handle::to_bits)
    }

    pub fn children(&self, object: u64) -> Vec<u64> {
        self.inner.children(entity(object)).iter().map(|c| c.to_bits()).collect()
    }

    #[wasm_bindgen(js_name = getObjectByName)]
    pub fn get_object_by_name(&self, root: u64, name: &str) -> Option<u64> {
        self.inner.get_object_by_name(entity(root), name).map(Handle::to_bits)
    }

    // ---- transforms

    #[wasm_bindgen(js_name = setPosition)]
    pub fn set_position(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.position.set(x, y, z);
        Ok(())
    }

    #[wasm_bindgen(js_name = setScale)]
    pub fn set_scale(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.scale.set(x, y, z);
        Ok(())
    }

    /// Sets the Euler angles; the quaternion follows. `order` as in `Quaternion.setFromEuler`.
    #[wasm_bindgen(js_name = setRotation)]
    pub fn set_rotation(&mut self, object: u64, x: f32, y: f32, z: f32, order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        self.transform_mut(object)?.set_rotation(wamr_math::Euler::new(x, y, z, order));
        Ok(())
    }

    /// Sets the quaternion; the Euler angles follow.
    #[wasm_bindgen(js_name = setQuaternion)]
    pub fn set_quaternion(&mut self, object: u64, x: f32, y: f32, z: f32, w: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.set_quaternion(wamr_math::Quaternion::new(x, y, z, w));
        Ok(())
    }

    /// Sets position (xyz), quaternion (xyzw) and scale (xyz) of many objects from one
    /// array of ten numbers per object.
    #[wasm_bindgen(js_name = setTransforms)]
    pub fn set_transforms(&mut self, objects: &[u64], values: &[f32]) -> Result<(), JsError> {
        if values.len() < objects.len() * 10 {
            return Err(JsError::new("setTransforms needs ten numbers per object"));
        }
        for (object, v) in objects.iter().zip(values.chunks_exact(10)) {
            let t = self.transform_mut(*object)?;
            t.position.set(v[0], v[1], v[2]);
            t.set_quaternion(wamr_math::Quaternion::new(v[3], v[4], v[5], v[6]));
            t.scale.set(v[7], v[8], v[9]);
        }
        Ok(())
    }

/// Sets the Euler angles of many objects from one array of three numbers per object.
    #[wasm_bindgen(js_name = setRotations)]
    pub fn set_rotations(&mut self, objects: &[u64], angles: &[f32], order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        if angles.len() < objects.len() * 3 {
            return Err(JsError::new("setRotations needs three numbers per object"));
        }
        for (object, a) in objects.iter().zip(angles.chunks_exact(3)) {
            self.transform_mut(*object)?.set_rotation(wamr_math::Euler::new(a[0], a[1], a[2], order));
        }
        Ok(())
    }

    pub fn position(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.position.to_array().to_vec())
    }

    pub fn scale(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.scale.to_array().to_vec())
    }

    /// The Euler angles xyz, in the object's rotation order.
    pub fn rotation(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.rotation().to_array().to_vec())
    }

    pub fn quaternion(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.quaternion().to_array().to_vec())
    }

    /// Rotates about an axis in object space. `axis` must be normalized.
    #[wasm_bindgen(js_name = rotateOnAxis)]
    pub fn rotate_on_axis(&mut self, object: u64, axis: &Vector3, angle: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.rotate_on_axis(&axis.inner, angle);
        Ok(())
    }

    /// Moves along an axis in object space. `axis` must be normalized.
    #[wasm_bindgen(js_name = translateOnAxis)]
    pub fn translate_on_axis(&mut self, object: u64, axis: &Vector3, distance: f32) -> Result<(), JsError> {
        self.transform_mut(object)?.translate_on_axis(&axis.inner, distance);
        Ok(())
    }

    /// Recomputes the local matrix of one object from position, rotation and scale.
    #[wasm_bindgen(js_name = updateMatrix)]
    pub fn update_matrix(&mut self, object: u64) -> Result<(), JsError> {
        self.transform_mut(object)?.update_matrix();
        Ok(())
    }

    /// Updates local and world matrices of `root` and everything below it.
    #[wasm_bindgen(js_name = updateMatrixWorld)]
    pub fn update_matrix_world(&mut self, root: u64, force: bool) {
        self.inner.update_matrix_world(entity(root), force);
    }

    /// The local matrix, 16 elements, column-major.
    pub fn matrix(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.matrix.elements.to_vec())
    }

    /// The world matrix, 16 elements, column-major.
    #[wasm_bindgen(js_name = matrixWorld)]
    pub fn matrix_world(&self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.transform(object)?.matrix_world.elements.to_vec())
    }

    /// Writes the world matrices of many objects, 16 numbers each, into a buffer inside
    /// the module and returns its address, for a `Float32Array` view without a copy
    /// (for example as the instance matrices of an instanced mesh). The view is valid
    /// until the next call of this method or until the module's memory grows. Objects
    /// that are not alive get an identity matrix.
    #[wasm_bindgen(js_name = matricesWorldPtr)]
    pub fn matrices_world_ptr(&mut self, objects: &[u64]) -> u32 {
        self.scratch.clear();
        self.scratch.reserve(objects.len() * 16);
        for object in objects {
            let matrix = self.inner.transform(entity(*object)).map_or_else(wamr_math::Matrix4::default, |t| t.matrix_world);
            self.scratch.extend_from_slice(&matrix.elements);
        }
        self.scratch.as_ptr() as usize as u32
    }

    /// The world matrices of many objects, 16 elements each, in one array.
    #[wasm_bindgen(js_name = matricesWorld)]
    pub fn matrices_world(&self, objects: &[u64]) -> Result<Vec<f32>, JsError> {
        let mut out = Vec::with_capacity(objects.len() * 16);
        for object in objects {
            out.extend_from_slice(&self.transform(*object)?.matrix_world.elements);
        }
        Ok(out)
    }

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

    // ---- cameras

    /// Makes the object a perspective camera. `fov` is the vertical field of view in
    /// degrees; `webgpu` selects clip-space depth 0..1 instead of -1..1.
    #[wasm_bindgen(js_name = setPerspectiveCamera)]
    pub fn set_perspective_camera(&mut self, object: u64, fov: f32, aspect: f32, near: f32, far: f32, webgpu: bool) {
        let mut camera = wamr_core::Camera::perspective(fov, aspect, near, far);
        camera.coordinate_system = coordinate_system(webgpu);
        camera.update_projection_matrix();
        if let Some(existing) = self.inner.camera(entity(object)) {
            camera.matrix_world_inverse = existing.matrix_world_inverse;
        }
        self.inner.set_camera(entity(object), Some(camera));
    }

    /// Makes the object an orthographic camera.
    #[wasm_bindgen(js_name = setOrthographicCamera)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_orthographic_camera(&mut self, object: u64, left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32, webgpu: bool) {
        let mut camera = wamr_core::Camera::orthographic(left, right, top, bottom, near, far);
        camera.coordinate_system = coordinate_system(webgpu);
        camera.update_projection_matrix();
        if let Some(existing) = self.inner.camera(entity(object)) {
            camera.matrix_world_inverse = existing.matrix_world_inverse;
        }
        self.inner.set_camera(entity(object), Some(camera));
    }

    /// Changes the aspect ratio of a perspective camera and updates its projection.
    #[wasm_bindgen(js_name = setCameraAspect)]
    pub fn set_camera_aspect(&mut self, object: u64, aspect: f32) -> Result<(), JsError> {
        let camera = self.inner.camera_mut(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        if let wamr_core::Projection::Perspective { aspect: current, .. } = &mut camera.projection {
            *current = aspect;
        }
        camera.update_projection_matrix();
        Ok(())
    }

    #[wasm_bindgen(js_name = projectionMatrix)]
    pub fn projection_matrix(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.projection_matrix.elements.to_vec())
    }

    #[wasm_bindgen(js_name = projectionMatrixInverse)]
    pub fn projection_matrix_inverse(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.projection_matrix_inverse.elements.to_vec())
    }

    /// The view matrix of a camera, as of the last world-matrix update.
    #[wasm_bindgen(js_name = matrixWorldInverse)]
    pub fn matrix_world_inverse(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let camera = self.inner.camera(entity(object)).ok_or_else(|| JsError::new("object is not a camera"))?;
        Ok(camera.matrix_world_inverse.elements.to_vec())
    }

    // ---- world-space placement and queries

    /// Rotates the object to face a point in world space (a camera looks at it).
    #[wasm_bindgen(js_name = lookAt)]
    pub fn look_at(&mut self, object: u64, x: f32, y: f32, z: f32) {
        self.inner.look_at(entity(object), x, y, z);
    }

    /// Reparents `object` under `parent` while keeping its world transform.
    pub fn attach(&mut self, parent: u64, object: u64) -> bool {
        self.inner.attach(entity(parent), entity(object))
    }

    #[wasm_bindgen(js_name = getWorldPosition)]
    pub fn get_world_position(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_position(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldQuaternion)]
    pub fn get_world_quaternion(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_quaternion(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldScale)]
    pub fn get_world_scale(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_scale(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = getWorldDirection)]
    pub fn get_world_direction(&mut self, object: u64) -> Result<Vec<f32>, JsError> {
        Ok(self.inner.get_world_direction(entity(object)).ok_or_else(|| dead("object"))?.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = localToWorld)]
    pub fn local_to_world(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<Vec<f32>, JsError> {
        let v = self.inner.local_to_world(entity(object), &wamr_math::Vector3::new(x, y, z)).ok_or_else(|| dead("object"))?;
        Ok(v.to_array().to_vec())
    }

    #[wasm_bindgen(js_name = worldToLocal)]
    pub fn world_to_local(&mut self, object: u64, x: f32, y: f32, z: f32) -> Result<Vec<f32>, JsError> {
        let v = self.inner.world_to_local(entity(object), &wamr_math::Vector3::new(x, y, z)).ok_or_else(|| dead("object"))?;
        Ok(v.to_array().to_vec())
    }

    // ---- single transform values, for property-style access from JavaScript

    /// One number of an object's transform. Slots: 0-2 position, 3-5 Euler angles,
    /// 6-9 quaternion, 10-12 scale, 13-15 up.
    #[wasm_bindgen(js_name = transformValue)]
    pub fn transform_value(&self, object: u64, slot: u32) -> Result<f32, JsError> {
        let t = self.transform(object)?;
        let (rotation, quaternion) = (t.rotation(), t.quaternion());
        Ok(match slot {
            0..=2 => t.position.get_component(slot as usize),
            3 => rotation.x,
            4 => rotation.y,
            5 => rotation.z,
            6 => quaternion.x,
            7 => quaternion.y,
            8 => quaternion.z,
            9 => quaternion.w,
            10..=12 => t.scale.get_component(slot as usize - 10),
            13..=15 => t.up.get_component(slot as usize - 13),
            _ => return Err(JsError::new("transform slot out of range")),
        })
    }

    /// Position (3), Euler angles (3), quaternion (4), scale (3), up (3) and the index of
    /// the Euler order (XYZ, YXZ, ZXY, ZYX, YZX, XZY) of an object: 17 numbers.
    #[wasm_bindgen(js_name = transformValues)]
    pub fn transform_values(&self, object: u64) -> Result<Vec<f32>, JsError> {
        let t = self.transform(object)?;
        let (r, q) = (t.rotation(), t.quaternion());
        let mut out = Vec::with_capacity(17);
        out.extend(t.position.to_array());
        out.extend([r.x, r.y, r.z, q.x, q.y, q.z, q.w]);
        out.extend(t.scale.to_array());
        out.extend(t.up.to_array());
        out.push(f32::from(r.order as u8));
        Ok(out)
    }

    /// Writes parts of many transforms in one call. `values` holds 17 numbers per
    /// object laid out as in `transformValues`; `masks` says which parts to take:
    /// 1 position, 2 Euler angles and order, 4 quaternion, 8 scale, 16 up. Objects that
    /// are not alive are skipped.
    #[wasm_bindgen(js_name = applyTransforms)]
    pub fn apply_transforms(&mut self, objects: &[u64], masks: &[u8], values: &[f32]) {
        const ORDERS: [EulerOrder; 6] = [EulerOrder::XYZ, EulerOrder::YXZ, EulerOrder::ZXY, EulerOrder::ZYX, EulerOrder::YZX, EulerOrder::XZY];

        for ((object, mask), v) in objects.iter().zip(masks).zip(values.chunks_exact(17)) {
            let Some(t) = self.inner.transform_mut(entity(*object)) else {
                continue;
            };
            if mask & 1 != 0 {
                t.position.set(v[0], v[1], v[2]);
            }
            if mask & 2 != 0 {
                t.set_rotation(wamr_math::Euler::new(v[3], v[4], v[5], ORDERS[(v[16] as usize).min(5)]));
            }
            if mask & 4 != 0 {
                t.set_quaternion(wamr_math::Quaternion::new(v[6], v[7], v[8], v[9]));
            }
            if mask & 8 != 0 {
                t.scale.set(v[10], v[11], v[12]);
            }
            if mask & 16 != 0 {
                t.up.set(v[13], v[14], v[15]);
            }
        }
    }

    /// With `false` the local matrix is no longer rebuilt from position, rotation and
    /// scale; set it with `setMatrix`.
    #[wasm_bindgen(js_name = setMatrixAutoUpdate)]
    pub fn set_matrix_auto_update(&mut self, object: u64, value: bool) -> Result<(), JsError> {
        self.transform_mut(object)?.matrix_auto_update = value;
        Ok(())
    }

    /// Sets the local matrix (16 numbers, column-major) and marks the world matrix as
    /// out of date. It only lasts on objects whose matrix is not updated automatically.
    #[wasm_bindgen(js_name = setMatrix)]
    pub fn set_matrix(&mut self, object: u64, elements: &[f32]) -> Result<(), JsError> {
        let elements: [f32; 16] = elements.try_into().map_err(|_| JsError::new("a matrix has 16 numbers"))?;
        let t = self.transform_mut(object)?;
        t.matrix.elements = elements;
        t.matrix_world_needs_update = true;
        Ok(())
    }

    /// Sets one number of an object's transform; see `transformValue` for the slots.
    /// Changing an Euler angle updates the quaternion and the other way round.
    #[wasm_bindgen(js_name = setTransformValue)]
    pub fn set_transform_value(&mut self, object: u64, slot: u32, value: f32) -> Result<(), JsError> {
        let t = self.transform_mut(object)?;
        match slot {
            0..=2 => drop(t.position.set_component(slot as usize, value)),
            3..=5 => {
                let mut rotation = t.rotation();
                [&mut rotation.x, &mut rotation.y, &mut rotation.z][slot as usize - 3].clone_from(&&value);
                t.set_rotation(rotation);
            }
            6..=9 => {
                let mut q = t.quaternion();
                [&mut q.x, &mut q.y, &mut q.z, &mut q.w][slot as usize - 6].clone_from(&&value);
                t.set_quaternion(q);
            }
            10..=12 => drop(t.scale.set_component(slot as usize - 10, value)),
            13..=15 => drop(t.up.set_component(slot as usize - 13, value)),
            _ => return Err(JsError::new("transform slot out of range")),
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = rotationOrder)]
    pub fn rotation_order(&self, object: u64) -> Result<String, JsError> {
        Ok(["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"][self.transform(object)?.rotation().order as usize].to_string())
    }

    #[wasm_bindgen(js_name = setRotationOrder)]
    pub fn set_rotation_order(&mut self, object: u64, order: &str) -> Result<(), JsError> {
        let order = euler_order(order)?;
        self.transform_mut(object)?.set_rotation_order(order);
        Ok(())
    }

    #[wasm_bindgen(js_name = setRenderOrder)]
    pub fn set_render_order(&mut self, object: u64, order: f32) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.render_order = order;
        }
    }

    #[wasm_bindgen(js_name = setFrustumCulled)]
    pub fn set_frustum_culled(&mut self, object: u64, culled: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.frustum_culled = culled;
        }
    }

    /// three.js `castShadow` and `receiveShadow`.
    #[wasm_bindgen(js_name = setShadowFlags)]
    pub fn set_shadow_flags(&mut self, object: u64, cast: bool, receive: bool) {
        if let Some(v) = self.inner.visibility_mut(entity(object)) {
            v.cast_shadow = cast;
            v.receive_shadow = receive;
        }
    }

    /// How a material is lit: `shading` 0 diffuse, 1 unlit, 2 standard (which uses
    /// `roughness` and `metalness`).
    #[wasm_bindgen(js_name = setMaterialShading)]
    pub fn set_material_shading(&mut self, handle: u64, shading: u8, roughness: f32, metalness: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.shading = match shading {
            0 => wamr_core::Shading::Lambert,
            1 => wamr_core::Shading::Unlit,
            2 => wamr_core::Shading::Standard,
            _ => return Err(JsError::new("shading must be 0 (diffuse), 1 (unlit) or 2 (standard)")),
        };
        material.roughness = roughness;
        material.metalness = metalness;
        Ok(())
    }

    /// The colour texture of a material, as an id the WebGPU host resolves; 0 for none.
    #[wasm_bindgen(js_name = setMaterialMap)]
    pub fn set_material_map(&mut self, handle: u64, texture: u32) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.map = texture;
        Ok(())
    }

    /// Blending and depth state. `opacity` only shows when `transparent` is set.
    #[wasm_bindgen(js_name = setMaterialState)]
    pub fn set_material_state(&mut self, handle: u64, transparent: bool, opacity: f32, depth_test: bool, depth_write: bool, vertex_colors: bool) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.transparent = transparent;
        material.opacity = opacity;
        material.depth_test = depth_test;
        material.depth_write = depth_write;
        material.vertex_colors = vertex_colors;
        Ok(())
    }

    /// Offset, repeat, rotation and rotation centre applied to texture coordinates.
    #[wasm_bindgen(js_name = setMaterialMapTransform)]
    #[allow(clippy::too_many_arguments)]
    pub fn set_material_map_transform(&mut self, handle: u64, offset_x: f32, offset_y: f32, repeat_x: f32, repeat_y: f32, rotation: f32, center_x: f32, center_y: f32) -> Result<(), JsError> {
        let material = self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?;
        material.map_transform.set_uv_transform(offset_x, offset_y, repeat_x, repeat_y, rotation, center_x, center_y);
        Ok(())
    }

    /// Base colour of a material, linear components.
    #[wasm_bindgen(js_name = setMaterialColor)]
    pub fn set_material_color(&mut self, handle: u64, r: f32, g: f32, b: f32) -> Result<(), JsError> {
        self.inner.material_mut(material(handle)).ok_or_else(|| dead("material"))?.color = wamr_math::Color::new(r, g, b);
        Ok(())
    }

    /// Upload counter of an attribute; it changes whenever the data should be re-uploaded.
    #[wasm_bindgen(js_name = attributeVersion)]
    pub fn attribute_version(&self, handle: u64, name: &str) -> Result<u32, JsError> {
        Ok(self.attribute(handle, name)?.version)
    }

    // ---- picking

    /// Casts a ray against the meshes at and (with `recursive`) below `root`. World
    /// matrices must be up to date. `direction` must be normalized; pass `Infinity` as
    /// `far` for no limit.
    /// `line_threshold` and `points_threshold` are how close, in world units, the ray must pass to a line or a point to
    /// hit it; anything that is not a number means 1.
    pub fn raycast(&self, root: u64, recursive: bool, origin: &Vector3, direction: &Vector3, near: f32, far: f32, line_threshold: f32, points_threshold: f32) -> RaycastHits {
        let mut raycaster = wamr_core::Raycaster::new(origin.inner, direction.inner, near, far);
        raycaster.params.line_threshold = if line_threshold.is_finite() { line_threshold } else { 1.0 };
        raycaster.params.points_threshold = if points_threshold.is_finite() { points_threshold } else { 1.0 };
        RaycastHits { hits: wamr_objects::intersect_object(&self.inner, &raycaster, entity(root), recursive) }
    }

    /// Casts a ray from a camera through a point of its view, given in normalized device
    /// coordinates (x and y from -1 to 1, y up).
    #[wasm_bindgen(js_name = raycastFromCamera)]
    pub fn raycast_from_camera(&self, camera: u64, x: f32, y: f32, root: u64, recursive: bool) -> Result<RaycastHits, JsError> {
        let mut raycaster = wamr_core::Raycaster::new(Default::default(), wamr_math::Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
        if !wamr_objects::set_from_camera(&mut raycaster, &self.inner, entity(camera), wamr_math::Vector2::new(x, y)) {
            return Err(JsError::new("object is not a camera"));
        }
        Ok(RaycastHits { hits: wamr_objects::intersect_object(&self.inner, &raycaster, entity(root), recursive) })
    }

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

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn timer_shell() {
        let mut t = Timer::new(0.0);
        t.update(500.0);
        assert_eq!((t.get_delta(), t.get_elapsed()), (0.5, 0.5));
    }
}
