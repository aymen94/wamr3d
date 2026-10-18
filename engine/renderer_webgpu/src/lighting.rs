//! What a frame is lit by: lights and their shadows, fog, tone mapping, environments and the background.

use super::*;

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
    /// The renderer's global clipping planes in world space (normal xyz, constant w);
    /// fragments behind any of them are discarded.
    pub clip_planes: Vec<[f32; 4]>,
    /// three.js `Scene.overrideMaterial`: drawn in place of every material that allows it.
    pub override_material: Option<wamr_core::MaterialHandle>,
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
            clip_planes: Vec::new(),
            override_material: None,
        }
    }
}
