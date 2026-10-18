//! Materials: their settings, texture maps and uv transforms, shading and sides.

use super::*;

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
    /// subtractive, 4 multiply, 5 custom (with `custom_blending`).
    pub blending: u8,
    /// The factors and equations of custom blending, 22 bits: source factor, destination
    /// factor (4 bits each, three.js's factor constant minus 200), equation (3 bits, its
    /// constant minus 100), then the same three for alpha. The default is three.js's
    /// (source alpha, one minus source alpha, add, for colour and alpha).
    pub custom_blending: u32,
    /// three.js `premultipliedAlpha`: the colour is multiplied by alpha before blending.
    pub premultiplied_alpha: bool,
    /// three.js `flatShading`: each triangle lit with its own face normal.
    pub flat_shading: bool,
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
    /// Fixed-function state and the smaller shading switches; see [`RenderState`].
    pub state: RenderState,
    /// three.js `clippingPlanes` of the material, in world space (normal xyz, constant w):
    /// fragments on the negative side of any (or of all with `state.clip_intersection`)
    /// are discarded. At most [`MAX_CLIP_PLANES`] are used.
    pub clip_planes: Vec<[f32; 4]>,
}

/// Clipping planes per material, and per frame for the renderer's global planes.
pub const MAX_CLIP_PLANES: usize = 8;

/// three.js `Material` settings that the renderer's hosts apply as pipeline or draw
/// state, and the shading switches that do not change the shading model.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RenderState {
    /// false: objects with this material are not drawn.
    pub visible: bool,
    /// three.js `depthFunc`: 0 never, 1 always, 2 less, 3 less or equal, 4 equal, 5
    /// greater or equal, 6 greater, 7 not equal.
    pub depth_func: u8,
    pub color_write: bool,
    /// three.js `polygonOffset`, `polygonOffsetFactor` and `polygonOffsetUnits`.
    pub polygon_offset: bool,
    pub polygon_offset_factor: f32,
    pub polygon_offset_units: f32,
    pub alpha_to_coverage: bool,
    /// Adds noise below one 8-bit step to the colour, against banding.
    pub dithering: bool,
    /// Discards fragments whose alpha is below a hash of their position.
    pub alpha_hash: bool,
    /// Whether the scene's fog applies (three.js `fog`).
    pub fog: bool,
    /// `normalMapType` ObjectSpaceNormalMap: the normal map holds object-space normals.
    pub object_space_normal_map: bool,
    /// The constant colour and alpha of custom blending (three.js `blendColor`, `blendAlpha`).
    pub blend_color: [f32; 4],
    pub stencil: Stencil,
    pub clip_intersection: bool,
    pub clip_shadows: bool,
    /// Whether `Scene.overrideMaterial` replaces this material.
    pub allow_override: bool,
    /// How an `envMap` of a basic, Lambert or Phong material combines with the surface
    /// (three.js `combine`: 0 multiply, 1 mix, 2 add), by `reflectivity`; refracted with
    /// `refraction_ratio` instead of reflected when `env_refraction`.
    pub env_combine: u8,
    pub reflectivity: f32,
    pub refraction_ratio: f32,
    pub env_refraction: bool,
    /// `LineDashedMaterial` (and `LineMaterial` with `dashed`): dash and gap lengths along
    /// the `lineDistance` attribute, scaled by `dash_scale`.
    pub dashed: bool,
    pub dash_size: f32,
    pub gap_size: f32,
    pub dash_scale: f32,
    /// `MeshDepthMaterial.depthPacking`: 3200 basic (grey), 3201 RGBA, 3202 RGB, 3203 RG.
    pub depth_packing: u32,
    /// Line width in world units instead of pixels (`LineMaterial.worldUnits`).
    pub line_world_units: bool,
    /// three.js `shadowSide`: the side drawn into shadow maps, or the opposite of `side`.
    pub shadow_side: Option<Side>,
}

/// three.js stencil settings: functions and operations as three.js numbers them less
/// their base (functions from 512, operations: 0 zero, 1 keep, 2 replace, 3 increment, 4
/// decrement, 5 increment wrap, 6 decrement wrap, 7 invert).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stencil {
    pub write: bool,
    pub func: u8,
    pub reference: u32,
    pub func_mask: u32,
    pub write_mask: u32,
    pub fail: u8,
    pub z_fail: u8,
    pub z_pass: u8,
}

impl Default for Stencil {
    fn default() -> Self {
        Self { write: false, func: 7, reference: 0, func_mask: 0xff, write_mask: 0xff, fail: 1, z_fail: 1, z_pass: 1 }
    }
}

impl Default for RenderState {
    fn default() -> Self {
        Self {
            visible: true,
            depth_func: 3,
            color_write: true,
            polygon_offset: false,
            polygon_offset_factor: 0.0,
            polygon_offset_units: 0.0,
            alpha_to_coverage: false,
            dithering: false,
            alpha_hash: false,
            fog: true,
            object_space_normal_map: false,
            blend_color: [0.0; 4],
            stencil: Stencil::default(),
            clip_intersection: false,
            clip_shadows: false,
            allow_override: true,
            env_combine: 0,
            reflectivity: 1.0,
            refraction_ratio: 0.98,
            env_refraction: false,
            dashed: false,
            dash_size: 3.0,
            gap_size: 1.0,
            dash_scale: 1.0,
            depth_packing: 3200,
            line_world_units: false,
            shadow_side: None,
        }
    }
}

/// Number of texture maps a material can have, the colour map included.
pub const MAP_COUNT: usize = 25;

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
    Matcap,
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
/// and its thickness in g, the anisotropy direction in rg with strength in b, and the
/// matcap's colour in rgb.
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
    pub matcap: u32,
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
            self.matcap,
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
            MapSlot::Matcap => &mut self.matcap,
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
        MapSlot::Matcap,
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
            custom_blending: 4 | 5 << 4 | 4 << 11 | 5 << 15,
            premultiplied_alpha: false,
            flat_shading: false,
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
            state: RenderState::default(),
            clip_planes: Vec::new(),
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
    /// The colour of a matcap texture looked up by the view-space normal (three.js
    /// `MeshMatcapMaterial`).
    Matcap = 6,
    /// The fragment's depth (three.js `MeshDepthMaterial`), packed by `depth_packing`.
    Depth = 7,
    /// The distance to the camera between its near and far planes, packed into RGBA
    /// (three.js `MeshDistanceMaterial`).
    Distance = 8,
    /// Black where shadows fall, transparent elsewhere (three.js `ShadowMaterial`).
    Shadow = 9,
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
