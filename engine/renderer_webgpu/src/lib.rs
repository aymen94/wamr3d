//! `wamr-renderer`: turns a `World` into what a WebGPU backend draws.
//!
//! This crate decides *what* is drawn and with *which data*: it culls against the
//! camera frustum, orders the draws, chooses each draw's pipeline state, packs the
//! uniform buffers and owns the shader source. Issuing the GPU calls is left to a small
//! host layer, because WebGPU is a browser API (DECISIONS.md D32).
//!
//! Scope so far: meshes, lines, line loops, points and sprites; unlit, diffuse (Lambert),
//! Blinn-Phong, toon, normal or roughness/metalness shading; emissive colour; a colour
//! texture with a uv transform; three- or four-component vertex colours; alpha blending; up to
//! [`MAX_LIGHTS`] directional, point and spot lights plus sky/ground ambient; fog; tone
//! mapping; shadow maps for up to [`MAX_SHADOWS`] directional and spot lights; image-based
//! lighting from an equirectangular environment, prefiltered like three.js's PMREM; a
//! texture background (equirectangular, blurred, or a screen-filling image).

#![forbid(unsafe_code)]

use wamr_core::{AttributeAccess, AttributeArray, Camera, Entity, GeometryHandle, Material, Primitive, Side, World};
use wamr_math::{Color, CoordinateSystem, Frustum, Matrix3, Matrix4, Sphere, Vector3};

mod dfg;
mod frame;
mod glsl;
mod shaders;
#[cfg(test)]
mod tests;

pub use frame::prepare_frame;
pub use glsl::glsl_source;
pub use shaders::*;

/// Floats per object in [`Frame::object_uniforms`]. 64 floats are 256 bytes, the
/// uniform-buffer offset alignment every WebGPU implementation accepts.
pub const OBJECT_UNIFORM_FLOATS: usize = 64;

/// Floats of [`OBJECT_UNIFORM_FLOATS`] the shader reads.
pub const OBJECT_BINDING_FLOATS: usize = 64;

/// Lights the shader evaluates; further lights are ignored.
pub const MAX_LIGHTS: usize = 16;

const LIGHT_FLOATS: usize = 16;

/// Shadow-casting lights per frame; further ones draw without shadows.
pub const MAX_SHADOWS: usize = 4;

const SHADOW_FLOATS: usize = 24;

/// Floats in [`Frame::frame_uniforms`].
pub const FRAME_UNIFORM_FLOATS: usize = ENVIRONMENT_OFFSET + 16;

const ENVIRONMENT_OFFSET: usize = SHADOWS_OFFSET + MAX_SHADOWS * SHADOW_FLOATS;

const LIGHTS_OFFSET: usize = 48;
const SHADOWS_OFFSET: usize = LIGHTS_OFFSET + MAX_LIGHTS * LIGHT_FLOATS;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LightKind {
    #[default]
    Directional = 0,
    Point = 1,
    Spot = 2,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Light {
    pub kind: LightKind,
    /// World position. Unused by directional lights.
    pub position: Vector3,
    /// World direction from the lit scene towards the light: for a directional or spot
    /// light, its position minus its target.
    pub direction: Vector3,
    pub color: Color,
    pub intensity: f32,
    /// Distance at which a point or spot light reaches zero; 0 for no cutoff.
    pub distance: f32,
    /// Exponent of the distance falloff; 2 is physically correct.
    pub decay: f32,
    /// Spot only: cosine of the cone's half angle, and of the angle where the
    /// penumbra starts.
    pub cone_cos: f32,
    pub penumbra_cos: f32,
    /// Casts shadows when set and the frame has shadows enabled. Point lights do not
    /// cast shadows yet.
    pub shadow: Option<LightShadow>,
}

/// The projection of a light's shadow camera, with three.js's parameters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ShadowProjection {
    /// Directional lights: three.js defaults are -5, 5, 5, -5, 0.5, 500.
    Orthographic { left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32 },
    /// Spot lights: `fov` in degrees (three.js derives it from the cone angle).
    Perspective { fov: f32, aspect: f32, near: f32, far: f32 },
}

/// A light's shadow settings (three.js `LightShadow`). The shadow camera sits at the
/// light and looks at `target`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LightShadow {
    pub projection: ShadowProjection,
    pub target: Vector3,
    /// Added to the depth of the shaded point before the comparison.
    pub bias: f32,
    /// Moves the shaded point along its normal before projecting it, in world units.
    pub normal_bias: f32,
    /// 1 is a full shadow, 0 none.
    pub intensity: f32,
    /// Filter radius in texels.
    pub radius: f32,
    pub map_width: u32,
    pub map_height: u32,
}

impl LightShadow {
    /// The shadow camera's view-projection, with WebGPU depth (0 near, 1 far).
    pub fn view_projection(&self, light_position: &Vector3) -> Matrix4 {
        let mut camera = match self.projection {
            ShadowProjection::Orthographic { left, right, top, bottom, near, far } => Camera::orthographic(left, right, top, bottom, near, far),
            ShadowProjection::Perspective { fov, aspect, near, far } => Camera::perspective(fov, aspect, near, far),
        };
        camera.coordinate_system = CoordinateSystem::WebGPU;
        camera.update_projection_matrix();

        let mut world = Matrix4::default();
        world.look_at(light_position, &self.target, &Vector3::new(0.0, 1.0, 0.0));
        world.set_position(light_position.x, light_position.y, light_position.z);
        world.invert();

        let mut view_projection = Matrix4::default();
        view_projection.multiply_matrices(&camera.projection_matrix, &world);
        view_projection
    }
}

impl Default for Light {
    fn default() -> Self {
        Self {
            kind: LightKind::Directional,
            position: Vector3::default(),
            direction: Vector3::new(0.0, 1.0, 0.0),
            color: Color::new(1.0, 1.0, 1.0),
            intensity: 1.0,
            distance: 0.0,
            decay: 2.0,
            cone_cos: 0.5,
            penumbra_cos: 0.5,
            shadow: None,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FogKind {
    #[default]
    None = 0,
    /// Fades in linearly between `near` and `far`.
    Linear = 1,
    /// Grows with the square of `density` times the distance.
    Exponential = 2,
}

/// Fades colours towards `color` with distance in front of the camera.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Fog {
    pub kind: FogKind,
    pub color: Color,
    pub near: f32,
    pub far: f32,
    pub density: f32,
}

/// Maps linear scene colours to the displayable range. Values are three.js's constants;
/// 5 (custom) is not supported and draws like `None`.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToneMapping {
    #[default]
    None = 0,
    Linear = 1,
    Reinhard = 2,
    Cineon = 3,
    AcesFilmic = 4,
    AgX = 6,
    Neutral = 7,
}

impl ToneMapping {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Linear,
            2 => Self::Reinhard,
            3 => Self::Cineon,
            4 => Self::AcesFilmic,
            6 => Self::AgX,
            7 => Self::Neutral,
            _ => Self::None,
        }
    }
}

/// An equirectangular environment map, prefiltered by the host into three.js's cube-UV
/// layout (PMREM). The layout's size follows from the source width as in three.js.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Environment {
    /// The host's id of the source texture.
    pub texture: u32,
    /// Width of the source image in pixels.
    pub source_width: u32,
    /// Rotation applied to sampling directions (three.js `environmentRotation` or
    /// `envMapRotation`, already inverted).
    pub rotation: Matrix3,
}

impl Environment {
    /// `log2` of the cube face size of the prefiltered map, three.js's `lodMax`.
    pub fn lod_max(&self) -> u32 {
        ((self.source_width / 4).max(1) as f64).log2().floor() as u32
    }

    /// Width and height of the prefiltered texture.
    pub fn layout_size(&self) -> (u32, u32) {
        let cube = 1u32 << self.lod_max();
        (3 * cube.max(16 * 7), 4 * cube)
    }
}

/// How a texture background is drawn (three.js `scene.background`).
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BackgroundKind {
    /// An equirectangular image around the camera, sampled directly.
    #[default]
    Equirectangular = 0,
    /// The same, read from its prefiltered map at `blurriness` (three.js
    /// `backgroundBlurriness` above 0).
    Blurred = 1,
    /// A plain image stretched over the whole frame.
    Screen = 2,
}

/// A texture drawn behind everything else, before the scene's draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Background {
    /// The host's id of the texture.
    pub texture: u32,
    pub kind: BackgroundKind,
    /// Width of the source image in pixels; sizes the prefiltered map of `Blurred`.
    pub source_width: u32,
    /// three.js `backgroundIntensity`.
    pub intensity: f32,
    /// three.js `backgroundBlurriness`, the roughness the prefiltered map is read at.
    pub blurriness: f32,
    /// Rotation applied to view directions (three.js `backgroundRotation`, already
    /// inverted). Unused by `Screen`.
    pub rotation: Matrix3,
}

impl Background {
    /// The prefiltered map a `Blurred` background reads.
    pub fn prefiltered(&self) -> Environment {
        Environment { texture: self.texture, source_width: self.source_width, rotation: self.rotation }
    }
}

/// Floats in [`Frame::background_uniforms`].
pub const BACKGROUND_UNIFORM_FLOATS: usize = 48;

/// The lights of a frame, ambient light arriving from above and from below, fog, the
/// tone mapping applied to the output, the environment map and the background.
#[derive(Clone, Debug, PartialEq)]
pub struct Lighting {
    pub lights: Vec<Light>,
    pub sky: Color,
    pub ground: Color,
    pub fog: Fog,
    pub tone_mapping: ToneMapping,
    pub exposure: f32,
    /// three.js `renderer.shadowMap.enabled`.
    pub shadows: bool,
    pub environment: Option<Environment>,
    pub background: Option<Background>,
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            lights: vec![Light { direction: Vector3::new(0.4, 0.8, 0.5), intensity: 2.2, ..Light::default() }],
            sky: Color::new(0.52, 0.66, 0.9),
            ground: Color::new(0.03, 0.02, 0.012),
            fog: Fog::default(),
            tone_mapping: ToneMapping::None,
            exposure: 1.0,
            shadows: false,
            environment: None,
            background: None,
        }
    }
}

/// Pipeline state of a draw, packed into [`Draw::pipeline`]: bits 0-1 the side (0
/// front, 1 back, 2 both), bit 2 alpha blending, bit 3 depth write, bit 4 depth test,
/// bits 5-6 the topology (0 triangles, 1 line strip, 2 line list, 3 point list), bit 7
/// [`LINE_LOOP_KEY`], bit 8 [`FOUR_COMPONENT_COLOR_KEY`]. Draws with equal values share a
/// pipeline.
pub fn pipeline_key(material: &Material, primitive: Primitive) -> u32 {
    let side = if primitive == Primitive::Mesh { material.side } else { Side::Double };
    let topology: u32 = match primitive {
        Primitive::Mesh => 0,
        Primitive::Line | Primitive::LineLoop => 1,
        Primitive::LineSegments => 2,
        Primitive::Points => 3,
    };
    side as u32
        | (material.transparent as u32) << 2
        | (material.depth_write as u32) << 3
        | (material.depth_test as u32) << 4
        | topology << 5
        | if primitive == Primitive::LineLoop { LINE_LOOP_KEY } else { 0 }
}

/// Textures a draw samples, in binding order: colour, normal, roughness, metalness,
/// emissive, alpha and ambient-occlusion maps.
pub const TEXTURE_SLOTS: usize = 7;

/// The texture ids of a material, in [`TEXTURE_SLOTS`] order.
pub fn material_textures(material: &Material) -> [u32; TEXTURE_SLOTS] {
    let m = material.maps;
    [material.map, m.normal, m.roughness, m.metalness, m.emissive, m.alpha, m.ao]
}

/// Set in [`Draw::pipeline`] for a line loop: a line strip to which the host appends the
/// first vertex again, closing the loop.
pub const LINE_LOOP_KEY: u32 = 1 << 7;

/// Set in [`Draw::pipeline`] when the geometry's `color` attribute has four float
/// components (with alpha); the vertex layout then reads four floats per colour.
pub const FOUR_COMPONENT_COLOR_KEY: u32 = 1 << 8;

/// One draw call.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Draw {
    pub object: Entity,
    pub geometry: GeometryHandle,
    /// See [`pipeline_key`].
    pub pipeline: u32,
    /// Distance of the object's origin in front of the camera, used for ordering.
    pub depth: f32,
    /// Texture ids of the material in [`TEXTURE_SLOTS`] order; 0 for none.
    pub textures: [u32; TEXTURE_SLOTS],
    /// First index (or vertex, without an index) and how many to draw.
    pub start: u32,
    pub count: u32,
    /// Id of the host's per-instance data and the number of instances; 0 and 1 for an
    /// ordinary draw.
    pub instances: u32,
    pub instance_count: u32,
}

/// The casters of one shadow map, drawn into layer `layer` of the shadow texture array
/// with depth only.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShadowPass {
    pub layer: u32,
    /// Size of this light's map; it fills the top-left of the layer.
    pub width: u32,
    pub height: u32,
    /// The shadow camera's view-projection (WebGPU depth).
    pub view_projection: [f32; 16],
    /// Pipeline keys use the side the shadow is drawn from: three.js draws the opposite
    /// side of `material.side` (both for double-sided materials).
    pub draws: Vec<Draw>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats starting with the model matrix.
    pub object_uniforms: Vec<f32>,
}

/// Everything the backend needs for one frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Frame {
    /// Draws in the order to issue them: opaque ones by render order then nearest
    /// first, then blended ones by render order then farthest first.
    pub draws: Vec<Draw>,
    /// view-projection (16), camera position with the light count in w (4), sky (4),
    /// ground (4), fog colour with the fog kind in w (4), fog near, far and density and
    /// the tone mapping (4), the camera's forward direction with the exposure in w (4),
    /// the camera's right (4) and up direction, with 1 in w for a perspective camera (4),
    /// then [`MAX_LIGHTS`] lights of 16 floats: position and kind,
    /// direction and cutoff distance, colour times intensity and decay, cone cosines.
    pub frame_uniforms: Vec<f32>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats: model matrix (16), normal matrix as
    /// three padded columns (12), colour and opacity (4), roughness, metalness, shading
    /// model and flags (4, see [`object_flags`]), uv transform as three padded columns
    /// (12), sprite rotation and centre, alpha test (4), environment intensity and use,
    /// normal scale (4), emissive colour and ambient-occlusion intensity (4), specular
    /// colour and shininess (4).
    pub object_uniforms: Vec<f32>,
    /// Objects that had something to draw before culling.
    pub candidates: usize,
    /// One pass per shadow-casting light, in the order of their layers.
    pub shadows: Vec<ShadowPass>,
    /// Size of each layer of the shadow texture array: the largest map of the frame.
    pub shadow_map_width: u32,
    pub shadow_map_height: u32,
    /// The environment map the frame samples, if any material uses one.
    pub environment: Option<Environment>,
    /// The texture background, drawn first; `None` clears to a colour instead.
    pub background: Option<Background>,
    /// [`BACKGROUND_UNIFORM_FLOATS`] floats for the background pass when there is one:
    /// the inverse projection (16), the camera's rotation as three padded columns (12),
    /// the background rotation likewise (12), kind, intensity, blurriness and the radius
    /// of an orthographic camera's background sphere (0 for perspective) (4), then 1/width,
    /// 1/height and `lodMax` of the prefiltered map (4).
    pub background_uniforms: Vec<f32>,
}
