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
    /// three.js `blending` of a transparent material: 0 none, 1 normal, 2 additive, 3
    /// subtractive, 4 multiply, 5 custom (drawn as normal).
    pub blending: u8,
    /// three.js `premultipliedAlpha`: the colour is multiplied by alpha before blending.
    pub premultiplied_alpha: bool,
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
    /// Strength of `maps.light`, baked light added to the indirect diffuse light (three.js
    /// `lightMapIntensity`).
    pub light_map_intensity: f32,
    /// Height scale of `maps.bump` (three.js `bumpScale`).
    pub bump_scale: f32,
    /// Vertices move along their normal by `maps.displacement` times the scale plus the
    /// bias (three.js `displacementScale`, `displacementBias`).
    pub displacement_scale: f32,
    pub displacement_bias: f32,
    /// Meshes only: draws each triangle's edges as lines instead of the triangle.
    pub wireframe: bool,
    /// `Shading::Standard` only, three.js `MeshPhysicalMaterial`: strength and roughness of
    /// a clear layer over the surface.
    pub clearcoat: f32,
    pub clearcoat_roughness: f32,
    /// Velvet-like reflection at grazing angles: `sheenColor` times `sheen`, in the linear
    /// working colour space, and its roughness.
    pub sheen_color: Color,
    pub sheen_roughness: f32,
    /// Index of refraction of the dielectric layer; 1.5 reflects 4% head on.
    pub ior: f32,
    /// Scale and tint of the dielectric reflection (three.js `specularIntensity` and
    /// `specularColor`).
    pub specular_intensity: f32,
    pub specular_color: Color,
    /// Per map (in [`MapSlot`] order), the uv transform and uv set it is read with.
    /// `set_map_transform` gives every map the same one, as three.js materials do when
    /// all textures share their settings.
    pub map_uvs: [MapUv; MAP_COUNT],
    /// three.js `MeshPhysicalMaterial` light passing through the surface: strength, the
    /// volume's thickness in local units, the distance at which light keeps
    /// `attenuation_color` (infinite for none), and the spread of the refraction index
    /// over wavelengths.
    pub transmission: f32,
    pub thickness: f32,
    pub attenuation_color: Color,
    pub attenuation_distance: f32,
    pub dispersion: f32,
    /// A thin film on the surface: strength, its refraction index and thickness range in
    /// nanometres (the thickness map picks within it, else the maximum is used).
    pub iridescence: f32,
    pub iridescence_ior: f32,
    pub iridescence_thickness: [f32; 2],
    /// Stretches the highlight along a direction in tangent space: strength and the
    /// direction's angle from the tangent.
    pub anisotropy: f32,
    pub anisotropy_rotation: f32,
    /// Scales x and y of `maps.clearcoat_normal`.
    pub clearcoat_normal_scale: [f32; 2],
    /// `PointsMaterial.size` in pixels (world units scaled by the view with
    /// `size_attenuation`), and `LineBasicMaterial.linewidth` in pixels. Points and lines
    /// above 1 are drawn as quads.
    pub point_size: f32,
    pub line_width: f32,
    /// An environment map of the material's own (three.js `envMap`): the host's texture
    /// id and source width, and the inverted rotation of sampling directions. With 0 the
    /// frame's environment is used.
    pub env_map: u32,
    pub env_map_width: u32,
    pub env_map_rotation: Matrix3,
    /// Drawn by a shader of the host instead of the built-in shading: 1 to 15 are the
    /// renderer's full-screen effects, from 16 on a host's own shader materials.
    pub custom: u32,
    /// Settings of a custom material's shader.
    pub custom_params: [f32; 16],
}

/// Number of texture maps a material can have, the colour map included.
pub const MAP_COUNT: usize = 24;

/// The texture maps of a material, in the order of [`Material::map_uvs`] and of
/// [`TextureMaps::ids`].
#[repr(usize)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapSlot {
    Color = 0,
    Normal,
    Roughness,
    Metalness,
    Emissive,
    Alpha,
    Ao,
    Light,
    Bump,
    Displacement,
    Specular,
    Gradient,
    Clearcoat,
    ClearcoatRoughness,
    ClearcoatNormal,
    SheenColor,
    SheenRoughness,
    SpecularIntensity,
    SpecularColor,
    Transmission,
    Thickness,
    Iridescence,
    IridescenceThickness,
    Anisotropy,
}

/// How a map's texture coordinates are made: `transform` applied to uv set `channel`
/// (0 `uv`, 1 `uv1`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MapUv {
    pub transform: Matrix3,
    pub channel: u8,
}

/// The textures of a material besides the colour map, read as three.js reads them:
/// the normal in rgb, roughness in g, metalness in b, emitted light in rgb, alpha in r,
/// ambient occlusion in r, baked light in rgb, height in r (bump and displacement),
/// specular strength in r, the toon gradient in r; clearcoat strength in r, its
/// roughness in g and normal in rgb, sheen colour in rgb and roughness in a, specular
/// intensity in a and colour in rgb, transmission in r, thickness in g, iridescence in r
/// and its thickness in g, and the anisotropy direction in rg with strength in b.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextureMaps {
    pub normal: u32,
    pub roughness: u32,
    pub metalness: u32,
    pub emissive: u32,
    pub alpha: u32,
    pub ao: u32,
    pub light: u32,
    pub bump: u32,
    pub displacement: u32,
    pub specular: u32,
    pub gradient: u32,
    pub clearcoat: u32,
    pub clearcoat_roughness: u32,
    pub clearcoat_normal: u32,
    pub sheen_color: u32,
    pub sheen_roughness: u32,
    pub specular_intensity: u32,
    pub specular_color: u32,
    pub transmission: u32,
    pub thickness: u32,
    pub iridescence: u32,
    pub iridescence_thickness: u32,
    pub anisotropy: u32,
}

impl TextureMaps {
    /// The texture ids in [`MapSlot`] order after the colour map `map`.
    pub fn ids(&self, map: u32) -> [u32; MAP_COUNT] {
        [
            map,
            self.normal,
            self.roughness,
            self.metalness,
            self.emissive,
            self.alpha,
            self.ao,
            self.light,
            self.bump,
            self.displacement,
            self.specular,
            self.gradient,
            self.clearcoat,
            self.clearcoat_roughness,
            self.clearcoat_normal,
            self.sheen_color,
            self.sheen_roughness,
            self.specular_intensity,
            self.specular_color,
            self.transmission,
            self.thickness,
            self.iridescence,
            self.iridescence_thickness,
            self.anisotropy,
        ]
    }

    /// Sets the texture of one map other than the colour map.
    pub fn set(&mut self, slot: MapSlot, id: u32) {
        let field = match slot {
            MapSlot::Color => return,
            MapSlot::Normal => &mut self.normal,
            MapSlot::Roughness => &mut self.roughness,
            MapSlot::Metalness => &mut self.metalness,
            MapSlot::Emissive => &mut self.emissive,
            MapSlot::Alpha => &mut self.alpha,
            MapSlot::Ao => &mut self.ao,
            MapSlot::Light => &mut self.light,
            MapSlot::Bump => &mut self.bump,
            MapSlot::Displacement => &mut self.displacement,
            MapSlot::Specular => &mut self.specular,
            MapSlot::Gradient => &mut self.gradient,
            MapSlot::Clearcoat => &mut self.clearcoat,
            MapSlot::ClearcoatRoughness => &mut self.clearcoat_roughness,
            MapSlot::ClearcoatNormal => &mut self.clearcoat_normal,
            MapSlot::SheenColor => &mut self.sheen_color,
            MapSlot::SheenRoughness => &mut self.sheen_roughness,
            MapSlot::SpecularIntensity => &mut self.specular_intensity,
            MapSlot::SpecularColor => &mut self.specular_color,
            MapSlot::Transmission => &mut self.transmission,
            MapSlot::Thickness => &mut self.thickness,
            MapSlot::Iridescence => &mut self.iridescence,
            MapSlot::IridescenceThickness => &mut self.iridescence_thickness,
            MapSlot::Anisotropy => &mut self.anisotropy,
        };
        *field = id;
    }
}

impl MapSlot {
    pub const ALL: [MapSlot; MAP_COUNT] = [
        MapSlot::Color,
        MapSlot::Normal,
        MapSlot::Roughness,
        MapSlot::Metalness,
        MapSlot::Emissive,
        MapSlot::Alpha,
        MapSlot::Ao,
        MapSlot::Light,
        MapSlot::Bump,
        MapSlot::Displacement,
        MapSlot::Specular,
        MapSlot::Gradient,
        MapSlot::Clearcoat,
        MapSlot::ClearcoatRoughness,
        MapSlot::ClearcoatNormal,
        MapSlot::SheenColor,
        MapSlot::SheenRoughness,
        MapSlot::SpecularIntensity,
        MapSlot::SpecularColor,
        MapSlot::Transmission,
        MapSlot::Thickness,
        MapSlot::Iridescence,
        MapSlot::IridescenceThickness,
        MapSlot::Anisotropy,
    ];

    pub fn from_index(index: usize) -> Option<MapSlot> {
        Self::ALL.get(index).copied()
    }
}

impl Material {
    /// Gives every map the uv transform `transform` (and keeps `map_transform` in step).
    pub fn set_map_transform(&mut self, transform: Matrix3) {
        self.map_transform = transform;
        for uv in &mut self.map_uvs {
            uv.transform = transform;
        }
    }

    /// Whether the material lets light through, which three.js draws after the opaque
    /// objects, over a copy of what they drew.
    pub fn is_transmissive(&self) -> bool {
        self.shading == Shading::Standard && self.transmission > 0.0
    }
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
            blending: 1,
            premultiplied_alpha: false,
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
            light_map_intensity: 1.0,
            bump_scale: 1.0,
            displacement_scale: 1.0,
            displacement_bias: 0.0,
            wireframe: false,
            clearcoat: 0.0,
            clearcoat_roughness: 0.0,
            sheen_color: Color::new(0.0, 0.0, 0.0),
            sheen_roughness: 1.0,
            ior: 1.5,
            specular_intensity: 1.0,
            specular_color: Color::new(1.0, 1.0, 1.0),
            map_uvs: [MapUv::default(); MAP_COUNT],
            transmission: 0.0,
            thickness: 0.0,
            attenuation_color: Color::new(1.0, 1.0, 1.0),
            attenuation_distance: f32::INFINITY,
            dispersion: 0.0,
            iridescence: 0.0,
            iridescence_ior: 1.3,
            iridescence_thickness: [100.0, 400.0],
            anisotropy: 0.0,
            anisotropy_rotation: 0.0,
            clearcoat_normal_scale: [1.0, 1.0],
            point_size: 1.0,
            line_width: 1.0,
            env_map: 0,
            env_map_width: 0,
            env_map_rotation: Matrix3::default(),
            custom: 0,
            custom_params: [0.0; 16],
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
