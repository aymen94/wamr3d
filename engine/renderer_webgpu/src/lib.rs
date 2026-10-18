//! `wamr-renderer`: turns a `World` into what a WebGPU or WebGL 2 backend draws.
//!
//! This crate decides *what* is drawn and with *which data*: it culls against the
//! camera frustum, orders the draws, chooses each draw's pipeline state, packs the
//! uniform buffers and owns the shader source. Issuing the GPU calls is left to a small
//! host layer, because WebGPU is a browser API (AGENTS.md D32).
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
mod lighting;
mod mesh_wgsl;
mod shaders;
#[cfg(test)]
mod tests;

pub use frame::{material_flags, material_slots, object_flags, pack_material, prepare_frame};
pub use effects::*;
pub use glsl::glsl_source;
pub use lighting::*;
pub use shaders::*;

/// Floats per object in [`Frame::object_uniforms`]. 64 floats are 256 bytes, the
/// uniform-buffer offset alignment every WebGPU implementation accepts.
pub const OBJECT_UNIFORM_FLOATS: usize = 64;

/// Floats of [`OBJECT_UNIFORM_FLOATS`] the shader reads.
pub const OBJECT_BINDING_FLOATS: usize = 32;

/// Floats per material in [`Frame::material_uniforms`] (2 KiB, a multiple of the
/// offset alignment).
pub const MATERIAL_UNIFORM_FLOATS: usize = 512;

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
pub const FRAME_UNIFORM_FLOATS: usize = CLIP_OFFSET + 4 + wamr_core::MAX_CLIP_PLANES * 4;

const CLIP_OFFSET: usize = TRANSMISSION_OFFSET + 4;

const ENVIRONMENT_OFFSET: usize = SHADOWS_OFFSET + MAX_SHADOWS * SHADOW_FLOATS;
const PROBE_OFFSET: usize = ENVIRONMENT_OFFSET + 16;
const TRANSMISSION_OFFSET: usize = PROBE_OFFSET + 36;

const LIGHTS_OFFSET: usize = 48;
const SHADOWS_OFFSET: usize = LIGHTS_OFFSET + MAX_LIGHTS * LIGHT_FLOATS;

/// Matrices per row of the bone texture: 1024 texels of four floats, four per matrix.
pub const BONE_TEXTURE_MATRICES_PER_ROW: usize = 256;

/// Pipeline state of a draw, packed into [`Draw::pipeline`]: bits 0-1 the side (0
/// front, 1 back, 2 both), bit 2 blending, bit 3 depth write, bit 4 depth test,
/// bits 5-6 the topology (0 triangles, 1 line strip, 2 line list, 3 point list), bit 7
/// [`LINE_LOOP_KEY`], bit 8 [`FOUR_COMPONENT_COLOR_KEY`], bit 9 [`WIREFRAME_KEY`], bit 10
/// [`AUX_KEY`], bits 11-13 the blending mode (three.js `blending`: 1 normal, 2 additive,
/// 3 subtractive, 4 multiply, 5 custom with the factors in the material block), bit 14
/// [`PREMULTIPLIED_KEY`], bit 15 [`QUAD_KEY`], bit 24 [`ALPHA_TO_COVERAGE_KEY`], bits
/// 25-27 the depth function (three.js `depthFunc`), bit 28 [`COLOR_WRITE_OFF_KEY`]. Bits
/// 20-23 are left to the hosts. Draws with equal values share a pipeline; polygon offset,
/// stencil and custom blending are read by the hosts from the material block.
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
        | if primitive == Primitive::LineLoop { LINE_LOOP_KEY } else { 0 }
        | if wireframe { WIREFRAME_KEY } else { 0 }
        | if blended { (u32::from(material.blending.min(5)) & 7) << 11 } else { 0 }
        | if material.premultiplied_alpha { PREMULTIPLIED_KEY } else { 0 }
        | if quads { QUAD_KEY } else { 0 }
        | if material.state.alpha_to_coverage { ALPHA_TO_COVERAGE_KEY } else { 0 }
        | (u32::from(material.state.depth_func.min(7))) << DEPTH_FUNC_SHIFT
        | if material.state.color_write { 0 } else { COLOR_WRITE_OFF_KEY }
}

/// Set in [`Draw::pipeline`] for three.js `alphaToCoverage`: multisampled targets turn
/// the fragment's alpha into coverage.
pub const ALPHA_TO_COVERAGE_KEY: u32 = 1 << 24;

/// Shift of the depth function in [`Draw::pipeline`] (three bits).
pub const DEPTH_FUNC_SHIFT: u32 = 25;

/// Set in [`Draw::pipeline`] when the material does not write colour (three.js `colorWrite`).
pub const COLOR_WRITE_OFF_KEY: u32 = 1 << 28;

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

/// Set in [`Draw::pipeline`] when the geometry has any of [`AUX_ATTRIBUTES`]. The host
/// then binds them interleaved in one vertex buffer (tangent 4 floats, uv1 2, skin
/// indices 4, skin weights 4, line distance 1: 60 bytes per vertex); otherwise a zero
/// stride buffer of zeros.
pub const AUX_KEY: u32 = 1 << 10;

/// The vertex inputs beyond position, normal, uv and colour, in their order in the
/// interleaved buffer of [`AUX_KEY`].
pub const AUX_ATTRIBUTES: [&str; 5] = ["tangent", "uv1", "skinIndex", "skinWeight", "lineDistance"];

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
