use crate::arena::Handle;
use crate::layers::Layers;
use wamr_math::{Color, Matrix3, Ray, Vector3, Vector4};

/// What a mesh is drawn with. The renderer reads it; picking reads `side`.
#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    pub name: String,
    pub side: Side,
    /// Base colour, in the linear working colour space. White by default.
    pub color: Color,
    pub shading: Shading,
    /// Used by `Shading::Standard`: 0 is a mirror, 1 fully diffuse.
    pub roughness: f32,
    /// Used by `Shading::Standard`: 0 for dielectrics, 1 for metals.
    pub metalness: f32,
    /// Colour texture, as an id the renderer's host resolves. 0 means none.
    pub map: u32,
    /// Applied to texture coordinates before sampling `map`.
    pub map_transform: Matrix3,
    /// 1 is solid. Only blended with what is behind when `transparent` is set.
    pub opacity: f32,
    pub transparent: bool,
    pub depth_test: bool,
    pub depth_write: bool,
    /// Multiplies the colour by the geometry's `color` attribute.
    pub vertex_colors: bool,
    /// Sprites only: rotation of the quad on screen, in radians.
    pub rotation: f32,
    /// Sprites only: whether the sprite gets smaller with distance (perspective cameras).
    pub size_attenuation: bool,
    /// `Shading::Standard` only: lit by the frame's environment map, scaled by
    /// `env_map_intensity` (three.js picks `envMapIntensity` or the scene's
    /// `environmentIntensity`; the caller resolves which).
    pub uses_environment: bool,
    pub env_map_intensity: f32,
    /// Light the surface gives off whatever the lighting, in the linear working colour
    /// space, already multiplied by three.js `emissiveIntensity`. Ignored by
    /// `Shading::Unlit` and `Shading::Normal`, as in three.js.
    pub emissive: Color,
    /// `Shading::Phong` only: colour of the highlight (three.js `specular`).
    pub specular: Color,
    /// `Shading::Phong` only: sharpness of the highlight.
    pub shininess: f32,
    /// Further textures, as ids the renderer's host resolves; 0 means none.
    pub maps: TextureMaps,
    /// Scales the x and y of the tangent-space `maps.normal` (three.js `normalScale`).
    pub normal_scale: [f32; 2],
    /// Strength of `maps.ao` (three.js `aoMapIntensity`).
    pub ao_map_intensity: f32,
    /// Fragments whose alpha is below this are discarded; 0 keeps them all.
    pub alpha_test: f32,
}

/// The textures of a material besides the colour map, read as three.js reads them:
/// the normal in rgb, roughness in g, metalness in b, emitted light in rgb, alpha in r and
/// ambient occlusion in r. All use one uv transform.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextureMaps {
    pub normal: u32,
    pub roughness: u32,
    pub metalness: u32,
    pub emissive: u32,
    pub alpha: u32,
    pub ao: u32,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            name: String::new(),
            side: Side::Front,
            color: Color::default(),
            shading: Shading::Lambert,
            roughness: 1.0,
            metalness: 0.0,
            map: 0,
            map_transform: Matrix3::default(),
            opacity: 1.0,
            transparent: false,
            depth_test: true,
            depth_write: true,
            vertex_colors: false,
            rotation: 0.0,
            size_attenuation: true,
            uses_environment: false,
            env_map_intensity: 1.0,
            emissive: Color::new(0.0, 0.0, 0.0),
            specular: Color::new(0.0, 0.0, 0.0),
            shininess: 30.0,
            maps: TextureMaps::default(),
            normal_scale: [1.0, 1.0],
            ao_map_intensity: 1.0,
            alpha_test: 0.0,
        }
    }
}

/// How a material responds to light.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Shading {
    /// Diffuse only.
    #[default]
    Lambert = 0,
    /// The colour as is, ignoring lights.
    Unlit = 1,
    /// Physically based: diffuse plus a roughness/metalness specular term.
    Standard = 2,
    /// Diffuse plus a Blinn-Phong highlight from `specular` and `shininess`.
    Phong = 3,
    /// The view-space normal packed into a colour, ignoring lights and `color`.
    Normal = 4,
    /// Diffuse lighting quantized into two tones.
    Toon = 5,
}

/// Which faces of a triangle count: those wound counter-clockwise towards the viewer
/// (front), the others (back), or both.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Side {
    #[default]
    Front = 0,
    Back = 1,
    Double = 2,
}

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
mod tests {
    use super::*;

    #[test]
    fn render_target_defaults() {
        let t = RenderTarget::new(640, 480);
        assert_eq!((t.width, t.height, t.depth, t.texture_count, t.samples), (640, 480, 1, 1, 0));
        assert_eq!(t.viewport, Vector4::new(0.0, 0.0, 640.0, 480.0));
        assert_eq!(t.scissor, t.viewport);
        assert!(t.depth_buffer && !t.stencil_buffer && !t.scissor_test);
        assert_eq!(RenderTarget::default().width, 1);
    }

    #[test]
    fn render_target_set_size() {
        let mut t = RenderTarget::new(4, 4);
        t.viewport.set(1.0, 1.0, 2.0, 2.0);
        assert!(!t.set_size(4, 4, 1));
        assert_eq!(t.viewport, Vector4::new(0.0, 0.0, 4.0, 4.0));
        assert!(t.set_size(8, 2, 1));
        assert_eq!((t.width, t.height), (8, 2));
        assert_eq!(t.scissor, Vector4::new(0.0, 0.0, 8.0, 2.0));
    }

    #[test]
    fn uniform() {
        let u = Uniform::new(Vector3::new(1.0, 2.0, 3.0));
        let mut copy = u.clone();
        assert_eq!(copy, u);
        copy.value.x = 9.0;
        assert_eq!((u.value.x, copy.value.x), (1.0, 9.0));
    }

    #[test]
    fn timer_measures_deltas_from_host_timestamps() {
        let mut t = Timer::new(1000.0);
        assert_eq!((t.get_delta(), t.get_elapsed(), t.get_timescale()), (0.0, 0.0, 1.0));
        t.update(1016.0);
        assert_eq!((t.get_delta(), t.get_elapsed()), (0.016, 0.016));
        t.set_timescale(0.5).update(1116.0);
        assert_eq!(t.get_delta(), 0.05);
        assert!((t.get_elapsed() - 0.066).abs() < 1e-12);
    }

    #[test]
    fn timer_reset_skips_a_pause() {
        let mut t = Timer::new(0.0);
        t.update(16.0);
        t.reset(60_016.0).update(60_032.0);
        assert_eq!(t.get_delta(), 0.016);
    }

    #[test]
    fn raycaster() {
        let mut r = Raycaster::new(Vector3::default(), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
        assert_eq!((r.near, r.far, r.layers.mask), (0.0, f32::INFINITY, 1));
        assert_eq!(r.params, RaycasterParams { line_threshold: 1.0, points_threshold: 1.0 });
        r.set(&Vector3::new(1.0, 2.0, 3.0), &Vector3::new(1.0, 0.0, 0.0));
        assert_eq!(r.ray.origin, Vector3::new(1.0, 2.0, 3.0));
    }
}
