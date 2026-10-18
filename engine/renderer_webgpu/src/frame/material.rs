//! Material blocks: texture slots, flags and the packed uniforms, and the frame's environments.

use super::*;

/// Reflectance of the dielectric layer head on, as three.js's physical material derives
/// it: `((ior - 1) / (ior + 1))^2` tinted by the specular colour, at most 1, scaled by the
/// specular intensity. The defaults give 0.04.
fn dielectric_f0(material: &Material) -> [f32; 3] {
    let ior = material.ior as f64;
    let f0 = ((ior - 1.0) / (ior + 1.0)).powi(2);
    let c = material.specular_color;
    let k = material.specular_intensity as f64;
    [c.r, c.g, c.b].map(|channel| ((f0 * channel as f64).min(1.0) * k) as f32)
}

/// The texture of each of a draw's slots, and per map (in [`MapSlot`] order) its slot
/// plus one (0 for none). Maps are given the first free slot in map order, and maps
/// reading the same texture share one, so that packed textures (occlusion, roughness and
/// metalness in one image, as glTF stores them) take a single slot. The displacement map
/// takes [`DISPLACEMENT_SLOT`]; maps beyond the free slots are left out.
pub fn material_slots(material: &Material) -> ([u32; TEXTURE_SLOTS], [u8; MAP_COUNT]) {
    let ids = material.maps.ids(material.map);
    let mut textures = [0u32; TEXTURE_SLOTS];
    let mut slots = [0u8; MAP_COUNT];
    let displacement = MapSlot::Displacement as usize;
    if ids[displacement] != 0 {
        textures[DISPLACEMENT_SLOT] = ids[displacement];
        slots[displacement] = DISPLACEMENT_SLOT as u8 + 1;
    }
    for (map, &id) in ids.iter().enumerate() {
        if id == 0 || map == displacement {
            continue;
        }
        let shared = textures.iter().enumerate().position(|(slot, &t)| t == id && slot != DISPLACEMENT_SLOT);
        let slot = shared.or_else(|| textures.iter().enumerate().position(|(slot, &t)| t == 0 && slot != DISPLACEMENT_SLOT));
        if let Some(slot) = slot {
            textures[slot] = id;
            slots[map] = slot as u8 + 1;
        }
    }
    (textures, slots)
}

/// Material flag bits (the w of the material's second vector): 2 blended, 16 points or
/// sprites of fixed size, 32 flat shading, 65536 lit by an environment, 131072 clearcoat, 262144 sheen,
/// 524288 transmission, 1048576 iridescence, 2097152 anisotropy, 4194304 premultiplied
/// alpha, 8388608 a material of lines or points drawn as quads with a colour map.
pub fn material_flags(material: &Material, lit_by_environment: bool) -> u32 {
    let bit = |on: bool, value: u32| if on { value } else { 0 };
    let standard = material.shading == wamr_core::Shading::Standard;
    let sheen = material.sheen_color;
    bit(material.transparent, 2)
        | bit(!material.size_attenuation, 16)
        | bit(material.flat_shading, 32)
        | bit(standard && lit_by_environment, 65536)
        | bit(standard && material.clearcoat > 0.0, 131072)
        | bit(standard && sheen.r.max(sheen.g).max(sheen.b) > 0.0, 262144)
        | bit(standard && material.transmission > 0.0, 524288)
        | bit(standard && material.iridescence > 0.0, 1048576)
        | bit(standard && material.anisotropy != 0.0, 2097152)
        | bit(material.premultiplied_alpha, 4194304)
}

/// Packs one material's block, [`MATERIAL_UNIFORM_FLOATS`] floats as vec4s:
///
/// 0. colour and opacity
/// 1. roughness, metalness, shading model, flags ([`material_flags`])
/// 2. emissive colour (times intensity) and ambient-occlusion intensity
/// 3. Blinn-Phong's specular colour and shininess, or standard shading's dielectric
///    reflectance and specular intensity
/// 4. environment intensity, light-map intensity, normal scale
/// 5. bump scale, displacement scale and bias, alpha test
/// 6. clearcoat, clearcoat roughness, sheen roughness, ior
/// 7. sheen colour, index of the material's environment in the frame's stack
/// 8. transmission, thickness, attenuation distance (-1 for infinite), dispersion
/// 9. attenuation colour, iridescence
/// 10. iridescence ior, thickness range, anisotropy strength
/// 11. anisotropy direction (cos, sin), clearcoat normal scale
/// 12. sprite rotation, point size, line width, custom blending (see
///     [`Material::custom_blending`])
/// 13-15. the environment's rotation, three padded columns
/// 16-65. per map in [`MapSlot`] order, two vec4: the first two rows of its uv
///     transform with its slot plus one, then with its uv set in the w of the second.
/// 66. blend colour and alpha (read by the hosts)
/// 67. depth function, colour write, polygon offset factor and units (hosts)
/// 68. stencil: packed write flag, function and operations ([`stencil_bits`]), reference,
///     function mask, write mask (hosts)
/// 69. flags of [`state_flags`], clipping plane count, environment combine, reflectivity
/// 70. dash size, gap size, dash scale, refraction ratio
/// 71. depth packing, line width in world units (1) or pixels (0)
/// 72-79. the clipping planes, normal and constant
pub fn pack_material(material: &Material, slots: &[u8; MAP_COUNT], environment: Option<(u32, Matrix3)>, environment_intensity: f32, out: &mut Vec<f32>) {
    let start = out.len();
    let standard = material.shading == wamr_core::Shading::Standard;
    push_color(out, &material.color, 1.0, material.opacity);
    let flags = material_flags(material, environment.is_some());
    out.extend([material.roughness, material.metalness, f32::from(material.shading as u8), flags as f32]);
    push_color(out, &material.emissive, 1.0, material.ao_map_intensity);
    if standard {
        out.extend(dielectric_f0(material));
        out.push(material.specular_intensity);
    } else {
        push_color(out, &material.specular, 1.0, material.shininess);
    }
    let [scale_x, scale_y] = material.normal_scale;
    out.extend([environment_intensity, material.light_map_intensity, scale_x, scale_y]);
    out.extend([material.bump_scale, material.displacement_scale, material.displacement_bias, material.alpha_test]);
    out.extend([material.clearcoat, material.clearcoat_roughness, material.sheen_roughness, material.ior]);
    let index = environment.map_or(0.0, |(index, _)| index as f32);
    push_color(out, &material.sheen_color, 1.0, index);
    let attenuation = if material.attenuation_distance.is_finite() { material.attenuation_distance } else { -1.0 };
    out.extend([material.transmission, material.thickness, attenuation, material.dispersion]);
    push_color(out, &material.attenuation_color, 1.0, material.iridescence);
    let [thin, thick] = material.iridescence_thickness;
    out.extend([material.iridescence_ior, thin, thick, material.anisotropy]);
    let angle = material.anisotropy_rotation as f64;
    let [cc_x, cc_y] = material.clearcoat_normal_scale;
    out.extend([angle.cos() as f32, angle.sin() as f32, cc_x, cc_y]);
    if material.custom != 0 {
        // a custom shader's settings take the place of the sprite and environment rotation
        out.extend(material.custom_params);
    } else {
        out.extend([material.rotation, material.point_size, material.line_width, material.custom_blending as f32]);
        push_matrix3(out, &environment.map_or_else(Matrix3::default, |(_, rotation)| rotation));
    }
    for (map, uv) in material.map_uvs.iter().enumerate() {
        let e = uv.transform.elements;
        out.extend([e[0], e[3], e[6], f32::from(slots[map])]);
        out.extend([e[1], e[4], e[7], f32::from(uv.channel)]);
    }
    let state = &material.state;
    out.extend(state.blend_color);
    let (factor, units) = if state.polygon_offset { (state.polygon_offset_factor, state.polygon_offset_units) } else { (0.0, 0.0) };
    out.extend([f32::from(state.depth_func), f32::from(u8::from(state.color_write)), factor, units]);
    let stencil = state.stencil;
    out.extend([stencil_bits(&stencil) as f32, stencil.reference as f32, stencil.func_mask as f32, stencil.write_mask as f32]);
    let planes = &material.clip_planes[..material.clip_planes.len().min(wamr_core::MAX_CLIP_PLANES)];
    let combined = !standard && environment.is_some();
    out.extend([state_flags(material, combined) as f32, planes.len() as f32, f32::from(state.env_combine), state.reflectivity]);
    out.extend([state.dash_size, state.gap_size, state.dash_scale, state.refraction_ratio]);
    out.extend([state.depth_packing as f32, f32::from(u8::from(state.line_world_units)), 0.0, 0.0]);
    for plane in planes {
        out.extend(plane);
    }
    out.resize(start + MATERIAL_UNIFORM_FLOATS, 0.0);
}

/// The stencil settings in 13 bits: write (1), function (3 bits from bit 1) and the fail,
/// depth-fail and pass operations (3 bits each from bits 4, 7 and 10).
pub fn stencil_bits(stencil: &wamr_core::Stencil) -> u32 {
    u32::from(stencil.write) | u32::from(stencil.func & 7) << 1 | u32::from(stencil.fail & 7) << 4 | u32::from(stencil.z_fail & 7) << 7 | u32::from(stencil.z_pass & 7) << 10
}

/// The material's second flag word (vector 69's x): 1 no fog, 2 dithering, 4 alpha hash,
/// 8 an object-space normal map, 16 clip intersection, 32 an environment combined with a
/// basic, Lambert or Phong surface (`combined`), 64 refracted rather than reflected, 128
/// dashed lines, 256 clipping planes that also clip shadows.
pub fn state_flags(material: &Material, combined: bool) -> u32 {
    let state = &material.state;
    let bit = |on: bool, value: u32| if on { value } else { 0 };
    bit(!state.fog, 1)
        | bit(state.dithering, 2)
        | bit(state.alpha_hash, 4)
        | bit(state.object_space_normal_map, 8)
        | bit(state.clip_intersection, 16)
        | bit(combined, 32)
        | bit(combined && state.env_refraction, 64)
        | bit(state.dashed, 128)
        | bit(state.clip_shadows && !material.clip_planes.is_empty(), 256)
}

/// The object flags of a draw: 1 vertex colours, 4 receives shadows, 8 sprite, 16 a
/// line (read only when it is drawn as quads).
pub fn object_flags(vertex_colors: bool, receive_shadow: bool, sprite: bool, line: bool) -> u32 {
    u32::from(vertex_colors) | u32::from(receive_shadow) << 2 | u32::from(sprite) << 3 | u32::from(line) << 4
}

/// The frame's materials, each packed once.
pub(super) struct Materials {
    index: HashMap<MaterialHandle, (u32, [u32; TEXTURE_SLOTS])>,
    last: Option<(MaterialHandle, u32, [u32; TEXTURE_SLOTS])>,
}

impl Materials {
    pub(super) fn new() -> Self {
        Self { index: HashMap::new(), last: None }
    }

    pub(super) fn get(&mut self, world: &World, handle: MaterialHandle, environments: &mut Environments, out: &mut Vec<f32>) -> (u32, [u32; TEXTURE_SLOTS]) {
        if let Some((h, index, textures)) = self.last {
            if h == handle {
                return (index, textures);
            }
        }
        let value = *self.index.entry(handle).or_insert_with(|| {
            let index = (out.len() / MATERIAL_UNIFORM_FLOATS) as u32;
            let Some(material) = world.material(handle) else {
                out.resize(out.len() + MATERIAL_UNIFORM_FLOATS, 0.0);
                return (index, [0; TEXTURE_SLOTS]);
            };
            let (textures, slots) = material_slots(material);
            let environment = environments.for_material(material);
            pack_material(material, &slots, environment, material.env_map_intensity, out);
            (index, textures)
        });
        self.last = Some((handle, value.0, value.1));
        value
    }
}

/// The environments sampled by the frame: the scene's first, then the materials' own.
pub(super) struct Environments {
    pub(super) list: Vec<Environment>,
    pub(super) scene: Option<Environment>,
}

impl Environments {
    pub(super) fn for_material(&mut self, material: &Material) -> Option<(u32, Matrix3)> {
        if !material.uses_environment {
            return None;
        }
        // basic, Lambert and Phong materials reflect only an `envMap` of their own
        if material.shading != wamr_core::Shading::Standard && (material.env_map == 0 || !matches!(material.shading, wamr_core::Shading::Unlit | wamr_core::Shading::Lambert | wamr_core::Shading::Phong)) {
            return None;
        }
        let wanted = if material.env_map != 0 {
            Environment { texture: material.env_map, source_width: material.env_map_width, rotation: material.env_map_rotation }
        } else {
            self.scene?
        };
        // the same texture with another rotation is the same prefiltered map
        let index = match self.list.iter().position(|e| e.texture == wanted.texture) {
            Some(index) => index,
            None if self.list.len() < MAX_ENVIRONMENTS => {
                self.list.push(wanted);
                self.list.len() - 1
            }
            None => return None,
        };
        Some((index as u32, wanted.rotation))
    }

    /// The `lodMax` all maps are prefiltered at: the largest of them, lowered until the
    /// stack fits in a texture 8192 texels high.
    pub(super) fn lod_max(&self) -> u32 {
        let mut lod = self.list.iter().map(Environment::lod_max).max().unwrap_or(0).max(4);
        while lod > 4 && self.list.len() as u32 * (4 << lod) > 8192 {
            lod -= 1;
        }
        lod
    }
}
