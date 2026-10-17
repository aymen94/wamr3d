//! `wamr-renderer`: turns a `World` into what a WebGPU or WebGL 2 backend draws.
//!
//! This crate decides *what* is drawn and with *which data*: it culls against the
//! camera frustum, orders the draws, chooses each draw's pipeline state, packs the
//! uniform buffers and owns the shader source. Issuing the GPU calls is left to a small
//! host layer, because WebGPU is a browser API (DECISIONS.md D32).
//!
//! Scope: meshes (filled or wireframe, skinned), lines, line loops, points and sprites;
//! unlit, diffuse (Lambert), Blinn-Phong, toon, normal or roughness/metalness shading,
//! with three.js's clearcoat, sheen, specular layer, iridescence, anisotropy and
//! transmission (with dispersion and attenuation); up to [`MAX_MAPS_PER_DRAW`] textures
//! per draw shared among 24 kinds of map, each with its own uv transform and uv set;
//! vertex tangents; three- or four-component vertex colours; three.js's blending modes;
//! up to [`MAX_LIGHTS`] directional, point, spot and rectangular area lights plus
//! sky/ground ambient and a spherical-harmonics light probe; fog; tone mapping; shadow
//! maps (basic, PCF or VSM) from directional, spot and point lights, up to
//! [`MAX_SHADOWS`] maps per frame; image-based lighting from up to [`MAX_ENVIRONMENTS`]
//! prefiltered environments per frame; a texture background.

#![forbid(unsafe_code)]

use wamr_core::{AttributeAccess, AttributeArray, Camera, Entity, GeometryHandle, Material, Primitive, Side, World};
use wamr_math::{Color, CoordinateSystem, Frustum, Matrix3, Matrix4, Sphere, Vector3};

mod dfg;
mod effects;
mod frame;
mod glsl;
mod glsl_mesh;
mod mesh_wgsl;
mod shaders;
#[cfg(test)]
mod tests;

pub use frame::{material_flags, material_slots, object_flags, pack_material, prepare_frame};
pub use effects::*;
pub use glsl::glsl_source;
pub use shaders::*;

/// Floats per object in [`Frame::object_uniforms`]. 64 floats are 256 bytes, the
/// uniform-buffer offset alignment every WebGPU implementation accepts.
pub const OBJECT_UNIFORM_FLOATS: usize = 64;

/// Floats of [`OBJECT_UNIFORM_FLOATS`] the shader reads.
pub const OBJECT_BINDING_FLOATS: usize = 32;

/// Floats per material in [`Frame::material_uniforms`] (1 KiB, a multiple of the
/// offset alignment).
pub const MATERIAL_UNIFORM_FLOATS: usize = 256;

/// Lights the shader evaluates; further lights are ignored.
pub const MAX_LIGHTS: usize = 16;

const LIGHT_FLOATS: usize = 16;

/// Shadow maps per frame, each a layer of the shadow texture array. A directional or
/// spot light takes one, a point light six (one per cube face); lights that no longer
/// fit draw without shadows.
pub const MAX_SHADOWS: usize = 16;

/// Layers a point light's shadow takes: its cube faces, in the order +x, -x, +y, -y, +z, -z.
pub const POINT_SHADOW_FACES: usize = 6;

const SHADOW_FLOATS: usize = 24;

/// Prefiltered environments per frame: the scene's and those of materials with an
/// `envMap` of their own. They are stacked in one texture by the host.
pub const MAX_ENVIRONMENTS: usize = 8;

/// Floats in [`Frame::frame_uniforms`].
pub const FRAME_UNIFORM_FLOATS: usize = TRANSMISSION_OFFSET + 4;

const ENVIRONMENT_OFFSET: usize = SHADOWS_OFFSET + MAX_SHADOWS * SHADOW_FLOATS;
const PROBE_OFFSET: usize = ENVIRONMENT_OFFSET + 16;
const TRANSMISSION_OFFSET: usize = PROBE_OFFSET + 36;

const LIGHTS_OFFSET: usize = 48;
const SHADOWS_OFFSET: usize = LIGHTS_OFFSET + MAX_LIGHTS * LIGHT_FLOATS;

/// Matrices per row of the bone texture: 1024 texels of four floats, four per matrix.
pub const BONE_TEXTURE_MATRICES_PER_ROW: usize = 256;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LightKind {
    #[default]
    Directional = 0,
    Point = 1,
    Spot = 2,
    /// A rectangle facing along its local -z, three.js `RectAreaLight`.
    RectArea = 3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Light {
    pub kind: LightKind,
    /// World position (the centre of an area light). Unused by directional lights.
    pub position: Vector3,
    /// World direction from the lit scene towards the light: for a directional or spot
    /// light, its position minus its target. For an area light, half its width as a world
    /// vector.
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
    /// Area lights only: half the height as a world vector.
    pub half_height: Vector3,
    /// Casts shadows when set and the frame has shadows enabled. A point light's shadow
    /// uses a 90 degree perspective projection per cube face; its target is unused.
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
    /// VSM only: taps of the blur (three.js `blurSamples`).
    pub blur_samples: u32,
    pub map_width: u32,
    pub map_height: u32,
}

impl LightShadow {
    /// The shadow camera's view-projection, with WebGPU depth (0 near, 1 far).
    pub fn view_projection(&self, light_position: &Vector3) -> Matrix4 {
        self.view_projection_towards(light_position, &self.target, &Vector3::new(0.0, 1.0, 0.0))
    }

    /// The same for a camera at `eye` looking at `target`, `up` giving the roll.
    pub fn view_projection_towards(&self, eye: &Vector3, target: &Vector3, up: &Vector3) -> Matrix4 {
        let mut camera = match self.projection {
            ShadowProjection::Orthographic { left, right, top, bottom, near, far } => Camera::orthographic(left, right, top, bottom, near, far),
            ShadowProjection::Perspective { fov, aspect, near, far } => Camera::perspective(fov, aspect, near, far),
        };
        camera.coordinate_system = CoordinateSystem::WebGPU;
        camera.update_projection_matrix();

        let mut world = Matrix4::default();
        world.look_at(eye, target, up);
        world.set_position(eye.x, eye.y, eye.z);
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
            half_height: Vector3::default(),
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

/// How shadow maps are filtered. three.js's WebGPU renderer draws `PCFSoftShadowMap` (2)
/// as PCF, and so does this renderer.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ShadowType {
    /// One unfiltered comparison: hard, aliased edges.
    Basic = 0,
    /// Five bilinear comparisons on a noise-rotated disk.
    #[default]
    Pcf = 1,
    /// Variance shadow maps: the depth's mean and mean square, blurred, read with
    /// Chebyshev's bound (three.js `VSMShadowMap`).
    Vsm = 2,
}

impl ShadowType {
    /// From three.js's constants: 0 basic, 3 VSM, anything else PCF.
    pub fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Basic,
            3 => Self::Vsm,
            _ => Self::Pcf,
        }
    }
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

/// `log2` of the cube face size of an environment prefiltered from an image
/// `source_width` wide, three.js's `lodMax`.
pub fn lod_max_for_width(source_width: u32) -> u32 {
    ((source_width / 4).max(1) as f64).log2().floor() as u32
}

/// Width and height of one prefiltered map of `lod_max`.
pub fn layout_size_for_lod(lod_max: u32) -> (u32, u32) {
    let cube = 1u32 << lod_max;
    (3 * cube.max(16 * 7), 4 * cube)
}

impl Environment {
    /// `log2` of the cube face size of the prefiltered map, three.js's `lodMax`.
    pub fn lod_max(&self) -> u32 {
        lod_max_for_width(self.source_width)
    }

    /// Width and height of the prefiltered texture.
    pub fn layout_size(&self) -> (u32, u32) {
        layout_size_for_lod(self.lod_max())
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

/// The lights of a frame, ambient light arriving from above and from below, a light
/// probe, fog, the tone mapping applied to the output, the environment map and the
/// background.
#[derive(Clone, Debug, PartialEq)]
pub struct Lighting {
    pub lights: Vec<Light>,
    pub sky: Color,
    pub ground: Color,
    /// Spherical-harmonics coefficients of the scene's light probes (three.js
    /// `LightProbe.sh`, already times the intensity), summed.
    pub probe: [Color; 9],
    pub fog: Fog,
    pub tone_mapping: ToneMapping,
    pub exposure: f32,
    /// three.js `renderer.shadowMap.enabled`.
    pub shadows: bool,
    /// three.js `renderer.shadowMap.type`.
    pub shadow_type: ShadowType,
    pub environment: Option<Environment>,
    pub background: Option<Background>,
    /// Width and height of the drawing buffer in pixels, and the pixel ratio: points
    /// larger than one pixel and transmission read them.
    pub viewport: [f32; 3],
}

impl Default for Lighting {
    fn default() -> Self {
        Self {
            lights: vec![Light { direction: Vector3::new(0.4, 0.8, 0.5), intensity: 2.2, ..Light::default() }],
            sky: Color::new(0.52, 0.66, 0.9),
            ground: Color::new(0.03, 0.02, 0.012),
            probe: [Color::new(0.0, 0.0, 0.0); 9],
            fog: Fog::default(),
            tone_mapping: ToneMapping::None,
            exposure: 1.0,
            shadows: false,
            shadow_type: ShadowType::Pcf,
            environment: None,
            background: None,
            viewport: [1.0, 1.0, 1.0],
        }
    }
}

/// Pipeline state of a draw, packed into [`Draw::pipeline`]: bits 0-1 the side (0
/// front, 1 back, 2 both), bit 2 blending, bit 3 depth write, bit 4 depth test,
/// bits 5-6 the topology (0 triangles, 1 line strip, 2 line list, 3 point list), bit 7
/// [`LINE_LOOP_KEY`], bit 8 [`FOUR_COMPONENT_COLOR_KEY`], bit 9 [`WIREFRAME_KEY`], bit 10
/// [`AUX_KEY`], bits 11-13 the blending mode (three.js `blending`: 1 normal, 2 additive,
/// 3 subtractive, 4 multiply; custom blending draws as normal), bit 14
/// [`PREMULTIPLIED_KEY`], bit 15 [`QUAD_KEY`]. Draws with equal values share a pipeline.
pub fn pipeline_key(material: &Material, primitive: Primitive) -> u32 {
    let wireframe = primitive == Primitive::Mesh && material.wireframe;
    let side = if primitive == Primitive::Mesh && !wireframe { material.side } else { Side::Double };
    // wide lines and large points are drawn as triangles
    let quads = (primitive == Primitive::Points && material.point_size > 1.0)
        || (matches!(primitive, Primitive::Line | Primitive::LineSegments | Primitive::LineLoop) && material.line_width > 1.0);
    // quads keep the primitive's topology: the host draws them as triangles and reads
    // the vertices per point or segment
    let topology: u32 = match primitive {
        Primitive::Mesh if wireframe => 2,
        Primitive::Mesh => 0,
        Primitive::Line | Primitive::LineLoop => 1,
        Primitive::LineSegments => 2,
        Primitive::Points => 3,
    };
    // as in three.js, blending applies to transparent materials only
    let blended = material.transparent && material.blending != 0;
    side as u32
        | (blended as u32) << 2
        | (material.depth_write as u32) << 3
        | (material.depth_test as u32) << 4
        | topology << 5
        | if primitive == Primitive::LineLoop && !quads { LINE_LOOP_KEY } else { 0 }
        | if wireframe { WIREFRAME_KEY } else { 0 }
        | if blended { (u32::from(material.blending.min(4)) & 7) << 11 } else { 0 }
        | if material.premultiplied_alpha { PREMULTIPLIED_KEY } else { 0 }
        | if quads { QUAD_KEY } else { 0 }
}

/// Textures a draw samples. A material's maps are given slots in the order of
/// [`wamr_core::MapSlot`] (maps reading one texture share a slot); the displacement map
/// always takes [`DISPLACEMENT_SLOT`], the one the vertex stage reads.
pub const TEXTURE_SLOTS: usize = 12;

/// The most textures one draw reads.
pub const MAX_MAPS_PER_DRAW: usize = TEXTURE_SLOTS;

/// Slot of the displacement map, the one texture the vertex stage reads.
pub const DISPLACEMENT_SLOT: usize = 9;

/// Set in [`Draw::pipeline`] for a line loop: a line strip to which the host appends the
/// first vertex again, closing the loop.
pub const LINE_LOOP_KEY: u32 = 1 << 7;

/// Set in [`Draw::pipeline`] when the geometry's `color` attribute has four float
/// components (with alpha); the vertex layout then reads four floats per colour.
pub const FOUR_COMPONENT_COLOR_KEY: u32 = 1 << 8;

/// Set in [`Draw::pipeline`] for a wireframe mesh: a line list over the edges of the
/// triangles in the draw range, whose index the host builds (two indices per edge, three
/// edges per triangle, as three.js builds it).
pub const WIREFRAME_KEY: u32 = 1 << 9;

/// Set in [`Draw::pipeline`] when the geometry has any of `tangent`, `uv1`, `skinIndex`
/// and `skinWeight`. The host then binds them interleaved in one vertex buffer
/// (tangent 4 floats, uv1 2, skin indices 4, skin weights 4: 56 bytes per vertex);
/// otherwise a zero stride buffer of zeros.
pub const AUX_KEY: u32 = 1 << 10;

/// Set in [`Draw::pipeline`] for three.js `premultipliedAlpha`: the colour is multiplied
/// by alpha in the shader and the blend factors take that into account.
pub const PREMULTIPLIED_KEY: u32 = 1 << 14;

/// Set in [`Draw::pipeline`] for points larger than one pixel and lines wider than one:
/// each point (or segment) is drawn as a quad of two triangles, six vertices per
/// primitive, from the geometry's vertices read as instance data.
pub const QUAD_KEY: u32 = 1 << 15;

/// One draw call.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Draw {
    pub object: Entity,
    pub geometry: GeometryHandle,
    /// See [`pipeline_key`].
    pub pipeline: u32,
    /// Distance of the object's origin in front of the camera, used for ordering.
    pub depth: f32,
    /// Texture ids of the draw's slots; 0 for none.
    pub textures: [u32; TEXTURE_SLOTS],
    /// First index (or vertex, without an index) and how many to draw.
    pub start: u32,
    pub count: u32,
    /// Id of the host's per-instance data and the number of instances; 0 and 1 for an
    /// ordinary draw.
    pub instances: u32,
    pub instance_count: u32,
    /// The draw's material block in [`Frame::material_uniforms`].
    pub material: u32,
    /// The material's `custom` shader (0 for the built-in shading).
    pub custom: u32,
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
    /// side of `material.side` (both for double-sided materials). Textures and material
    /// blocks are those of the main pass, for alpha tests and displacement.
    pub draws: Vec<Draw>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats laid out as the main pass's.
    pub object_uniforms: Vec<f32>,
}

/// Everything the backend needs for one frame.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Frame {
    /// Draws in the order to issue them: opaque ones by render order then nearest
    /// first, then transmissive ones likewise, then blended ones by render order then
    /// farthest first.
    pub draws: Vec<Draw>,
    /// How many of the first draws are opaque, and how many transmissive draws follow
    /// them. With transmissive draws the host first draws the background and the opaque
    /// draws into a mipmapped copy that the transmissive ones read.
    pub opaque_count: u32,
    pub transmissive_count: u32,
    /// view-projection (16), camera position with the light count in w (4), sky (4),
    /// ground (4), fog colour with the fog kind in w (4), fog near, far and density and
    /// the tone mapping (4), the camera's forward direction with the exposure in w (4),
    /// the camera's right (4) and up direction, with 1 in w for a perspective camera (4),
    /// then [`MAX_LIGHTS`] lights of 16 floats: position and kind, direction (an area
    /// light's half width) and cutoff distance, colour times intensity and decay, cone
    /// cosines (an area light's half height in x, y, w) with the shadow layer in z; then
    /// [`MAX_SHADOWS`] shadows, the environment stack (1/width, 1/height, `lodMax`, the
    /// height of one map in pixels, then 12 unused), the light probe's nine
    /// coefficients as vec4, and the transmission copy's 1/width, 1/height and mip count.
    pub frame_uniforms: Vec<f32>,
    /// Per draw, [`OBJECT_UNIFORM_FLOATS`] floats: model matrix (16), normal matrix as
    /// three columns (12), then the object flags (1 vertex colours, 4 receives shadows, 8
    /// sprite, 16 a line drawn as quads), the first matrix of its skin in [`Frame::skin_matrices`] plus one (0
    /// without a skin), and a sprite's centre.
    pub object_uniforms: Vec<f32>,
    /// Per distinct material of the frame, [`MATERIAL_UNIFORM_FLOATS`] floats; see
    /// [`frame::pack_material`].
    pub material_uniforms: Vec<f32>,
    /// The skinning matrices of the frame's skinned draws, 16 floats each, for the bone
    /// texture ([`BONE_TEXTURE_MATRICES_PER_ROW`] per row).
    pub skin_matrices: Vec<f32>,
    /// Objects that had something to draw before culling.
    pub candidates: usize,
    /// One pass per shadow map (six for a point light), in the order of their layers.
    pub shadows: Vec<ShadowPass>,
    /// Size of each layer of the shadow texture array: the largest map of the frame.
    pub shadow_map_width: u32,
    pub shadow_map_height: u32,
    /// The shadow filter of the frame; with VSM the host also renders and blurs moments.
    pub shadow_type: ShadowType,
    /// Per shadow pass, its VSM blur radius in texels and taps.
    pub shadow_blur: Vec<[f32; 2]>,
    /// The environments the frame samples, stacked in this order, all prefiltered at
    /// [`Frame::environment_lod_max`].
    pub environments: Vec<Environment>,
    pub environment_lod_max: u32,
    /// The texture background, drawn first; `None` clears to a colour instead.
    pub background: Option<Background>,
    /// [`BACKGROUND_UNIFORM_FLOATS`] floats for the background pass when there is one:
    /// the inverse projection (16), the camera's rotation as three padded columns (12),
    /// the background rotation likewise (12), kind, intensity, blurriness and the radius
    /// of an orthographic camera's background sphere (0 for perspective) (4), then 1/width,
    /// 1/height and `lodMax` of the prefiltered map (4).
    pub background_uniforms: Vec<f32>,
}
