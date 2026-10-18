//! GLSL ES 3.00 of the mesh pipelines, the shadow passes and the VSM blur, reading the
//! same blocks as the WGSL in `mesh_wgsl.rs` (std140 matches the WGSL layout).

// The fragment stage is long; its parts are macros so that `MESH_FRAGMENT` stays one
// constant.
#[macro_use]
mod lighting;
#[macro_use]
mod shading;
mod common;
mod shadow;
mod vertex;

pub use common::{BLOCKS, MAPS, VERTEX_COMMON};
pub use shadow::{SHADOW_FRAGMENT, SHADOW_VERTEX, VSM_FRAGMENT};
pub use vertex::{MESH_VERTEX, QUAD_VERTEX};

pub const MESH_FRAGMENT: &str = concat!(mesh_fragment_lighting!(), mesh_fragment_shading!());
