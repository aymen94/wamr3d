//! `wamr-core`: the scene model of WAMR3D (Phase 2).
//!
//! A [`World`] owns objects, their components and the resources they use; everything
//! is referred to by generational [`Handle`]s, so there are no reference cycles and a
//! stale handle fails instead of reading freed memory. Behaviour follows three.js;
//! the mapping from its classes is in AGENTS.md sections 4.2 and 10.

#![forbid(unsafe_code)]

pub mod arena;
pub mod attribute;
pub mod camera;
pub mod components;
pub mod constants;
pub mod geometry;
pub mod layers;
pub mod morph;
pub mod resources;
pub mod world;

pub use arena::{Arena, Handle};
pub use attribute::{
    AttributeAccess, AttributeArray, BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute,
    InterleavedBufferHandle, InterleavedView, UpdateRange,
};
pub use camera::{Camera, Projection, ViewOffset};
pub use components::{Hierarchy, Primitive, Renderable, Skin, Transform, Visibility};
pub use constants::{GpuType, Usage};
pub use geometry::{BufferGeometry, DrawRange, GeometryHandle, Group};
pub use layers::Layers;
pub use resources::{MapSlot, MapUv, Material, RenderState, Shading, Side, Stencil, TextureMaps, MAP_COUNT, MAX_CLIP_PLANES, Raycaster, RaycasterParams, RenderTarget, RenderTargetHandle, Timer, Uniform};
pub use world::{CoreEvent, Entity, MaterialHandle, World};
