//! `wamr-core`: the scene model of WAMR3D (Phase 2).
//!
//! A [`World`] owns objects, their components and the resources they use; everything
//! is referred to by generational [`Handle`]s, so there are no reference cycles and a
//! stale handle fails instead of reading freed memory. Behaviour follows three.js;
//! the mapping from its classes is in DECISIONS.md section 5.

#![forbid(unsafe_code)]

pub mod arena;
pub mod attribute;
pub mod camera;
pub mod components;
pub mod constants;
pub mod geometry;
pub mod layers;
pub mod resources;
pub mod world;

pub use arena::{Arena, Handle};
pub use attribute::{
    AttributeAccess, AttributeArray, BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute,
    InterleavedBufferHandle, InterleavedView, UpdateRange,
};
pub use camera::{Camera, Projection, ViewOffset};
pub use components::{Hierarchy, Primitive, Renderable, Transform, Visibility};
pub use constants::{GpuType, Usage};
pub use geometry::{BufferGeometry, DrawRange, GeometryHandle, Group};
pub use layers::Layers;
pub use resources::{Material, Shading, Side, TextureMaps, Raycaster, RaycasterParams, RenderTarget, RenderTargetHandle, Timer, Uniform};
pub use world::{CoreEvent, Entity, MaterialHandle, World};
