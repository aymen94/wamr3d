use crate::arena::Handle;
use crate::layers::Layers;
use wamr_math::{Color, Matrix3, Ray, Vector3, Vector4};

mod material;
pub use material::*;

/// An off-screen buffer to render into. Describes the buffer; the textures behind it
/// belong to the renderer.
#[derive(Clone, Debug, PartialEq)]
pub struct RenderTarget {
    pub width: u32,
    pub height: u32,
    pub depth: u32,
    pub scissor: Vector4,
    pub scissor_test: bool,
    pub viewport: Vector4,
    /// Number of colour attachments.
    pub texture_count: u32,
    pub depth_buffer: bool,
    pub stencil_buffer: bool,
    pub resolve_color_buffer: bool,
    pub resolve_depth_buffer: bool,
    pub resolve_stencil_buffer: bool,
    pub store_multisampled_color_buffer: bool,
    pub store_multisampled_depth_buffer: bool,
    pub store_multisampled_stencil_buffer: bool,
    /// MSAA sample count; 0 disables multisampling.
    pub samples: u32,
    pub multiview: bool,
    pub use_array_depth_texture: bool,
}

pub type RenderTargetHandle = Handle<RenderTarget>;

impl Default for RenderTarget {
    fn default() -> Self {
        Self::new(1, 1)
    }
}

impl RenderTarget {
    /// A target with the three.js default options: one colour attachment, a depth
    /// buffer, no stencil, no multisampling.
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            depth: 1,
            scissor: Vector4::new(0.0, 0.0, width as f32, height as f32),
            scissor_test: false,
            viewport: Vector4::new(0.0, 0.0, width as f32, height as f32),
            texture_count: 1,
            depth_buffer: true,
            stencil_buffer: false,
            resolve_color_buffer: true,
            resolve_depth_buffer: true,
            resolve_stencil_buffer: true,
            store_multisampled_color_buffer: true,
            store_multisampled_depth_buffer: true,
            store_multisampled_stencil_buffer: true,
            samples: 0,
            multiview: false,
            use_array_depth_texture: false,
        }
    }

    /// Resizes the target and resets viewport and scissor to cover it. Returns true if
    /// the size changed, in which case the GPU resources must be recreated;
    /// `World::set_render_target_size` queues the event for that.
    pub fn set_size(&mut self, width: u32, height: u32, depth: u32) -> bool {
        let changed = self.width != width || self.height != height || self.depth != depth;

        self.width = width;
        self.height = height;
        self.depth = depth;

        self.viewport.set(0.0, 0.0, width as f32, height as f32);
        self.scissor.set(0.0, 0.0, width as f32, height as f32);

        changed
    }
}

/// A shader uniform value.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Uniform<T> {
    pub value: T,
}

impl<T> Uniform<T> {
    pub fn new(value: T) -> Self {
        Self { value }
    }
}

/// Frame timing. The host supplies every timestamp in milliseconds (in a browser, the
/// `requestAnimationFrame` argument or `performance.now()`); the timer never reads a clock.
///
/// three.js's `connect( document )` resets the timer when a hidden page becomes visible
/// again. Here the host does that by calling [`Timer::reset`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timer {
    previous_time: f64,
    current_time: f64,
    start_time: f64,
    delta: f64,
    elapsed: f64,
    timescale: f64,
}

impl Timer {
    pub fn new(now: f64) -> Self {
        Self { previous_time: 0.0, current_time: 0.0, start_time: now, delta: 0.0, elapsed: 0.0, timescale: 1.0 }
    }

    /// Seconds between the last two updates, scaled by the timescale.
    pub fn get_delta(&self) -> f64 {
        self.delta / 1000.0
    }

    /// Seconds accumulated over all updates, scaled by the timescale in effect at each.
    pub fn get_elapsed(&self) -> f64 {
        self.elapsed / 1000.0
    }

    pub fn get_timescale(&self) -> f64 {
        self.timescale
    }

    pub fn set_timescale(&mut self, timescale: f64) -> &mut Self {
        self.timescale = timescale;
        self
    }

    /// Makes the next update measure from `now`, so a pause does not produce one huge delta.
    pub fn reset(&mut self, now: f64) -> &mut Self {
        self.current_time = now - self.start_time;
        self
    }

    pub fn update(&mut self, timestamp: f64) -> &mut Self {
        self.previous_time = self.current_time;
        self.current_time = timestamp - self.start_time;

        self.delta = (self.current_time - self.previous_time) * self.timescale;
        self.elapsed += self.delta;

        self
    }
}

/// Distance thresholds used when raycasting thin primitives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaycasterParams {
    pub line_threshold: f32,
    pub points_threshold: f32,
}

impl Default for RaycasterParams {
    fn default() -> Self {
        Self { line_threshold: 1.0, points_threshold: 1.0 }
    }
}

/// A ray with a distance range and a layer mask, for picking. Setting it up from a
/// camera and intersecting objects arrive with cameras and meshes in Phase 3.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Raycaster {
    pub ray: Ray,
    pub near: f32,
    pub far: f32,
    pub layers: Layers,
    pub params: RaycasterParams,
}

impl Raycaster {
    /// three.js defaults: `near = 0`, `far = f32::INFINITY`. `direction` is assumed to
    /// be normalized.
    pub fn new(origin: Vector3, direction: Vector3, near: f32, far: f32) -> Self {
        Self { ray: Ray::new(origin, direction), near, far, layers: Layers::default(), params: RaycasterParams::default() }
    }

    /// `direction` is assumed to be normalized (for accurate distance calculations).
    pub fn set(&mut self, origin: &Vector3, direction: &Vector3) {
        self.ray.set(origin, direction);
    }
}

#[cfg(test)]
mod tests;
