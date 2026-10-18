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

mod values;
pub use values::*;

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
mod tests;
