//! WGSL of the mesh pipelines, the shadow passes and the VSM blur.

// The mesh shader is long; its parts are macros so that `SHADER` stays one constant.
#[macro_use]
mod vertex;
#[macro_use]
mod lighting;
#[macro_use]
mod fragment;
mod common;
mod shadow;

pub use common::COMMON;
pub use shadow::{SHADOW_SHADER, VSM_SHADER};

/// The mesh pipeline. It outputs linear colour: the target must be an sRGB or float
/// format.
pub const SHADER: &str = concat!(mesh_vertex!(), mesh_lighting!(), mesh_fragment!());
