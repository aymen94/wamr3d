use super::*;
use wamr_core::{BufferAttribute, BufferGeometry, MaterialHandle, Renderable, Shading};
use wamr_math::Vector4;
use wamr_objects::box_geometry;

/// The pipeline-key bits of three.js's default depth function, `LessEqualDepth`.
const LESS_EQUAL: u32 = 3 << DEPTH_FUNC_SHIFT;

/// A camera at the origin looking down -Z, and boxes at the given positions.
fn scene(positions: &[[f32; 3]]) -> (World, Entity, Entity, Vec<Entity>) {
    let mut world = World::new();
    let (root, camera) = (world.create_object(), world.create_object());
    world.add(root, camera);
    world.set_camera(camera, Some(Camera::perspective(90.0, 1.0, 1.0, 100.0)));

    let geometry = world.create_geometry(box_geometry(1.0, 1.0, 1.0, 1, 1, 1));
    let material = world.create_material(Material { color: Color::new(1.0, 0.5, 0.25), shading: Shading::Standard, roughness: 0.5, metalness: 0.25, map: 7, ..Material::default() });
    let boxes = positions
        .iter()
        .map(|p| {
            let e = world.create_object();
            world.add(root, e);
            world.set_renderable(e, Some(Renderable::mesh(geometry, material)));
            world.transform_mut(e).unwrap().position.set(p[0], p[1], p[2]);
            e
        })
        .collect();

    world.update_matrix_world(root, false);
    (world, root, camera, boxes)
}

/// The material block of a frame's draw.
fn block(frame: &Frame, draw: usize) -> &[f32] {
    let start = frame.draws[draw].material as usize * MATERIAL_UNIFORM_FLOATS;
    &frame.material_uniforms[start..start + MATERIAL_UNIFORM_FLOATS]
}

/// The two vec4 of a map in a material block's map table.
fn map_entry(block: &[f32], map: wamr_core::MapSlot) -> &[f32] {
    &block[64 + map as usize * 8..][..8]
}

#[test]
fn culls_outside_the_frustum_and_orders_nearest_first() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -20.0], [0.0, 0.0, -5.0], [0.0, 0.0, 5.0], [300.0, 0.0, -5.0]]);
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();

    assert_eq!(frame.candidates, 4);
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[1], boxes[0]]);
    assert_eq!(frame.draws[0].depth, 5.0);
    assert_eq!(frame.object_uniforms.len(), 2 * OBJECT_UNIFORM_FLOATS);
    assert_eq!(frame.frame_uniforms.len(), FRAME_UNIFORM_FLOATS);
}

#[test]
fn frustum_culled_false_invisible_objects_and_layers_are_respected() {
    let (mut world, root, camera, boxes) = scene(&[[300.0, 0.0, -5.0], [0.0, 0.0, -5.0], [0.0, 0.0, -6.0]]);
    world.visibility_mut(boxes[0]).unwrap().frustum_culled = false;
    world.visibility_mut(boxes[1]).unwrap().visible = false;
    world.visibility_mut(boxes[2]).unwrap().layers.set(4);

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]]);
}

#[test]
fn render_order_comes_before_depth() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -20.0]]);
    world.visibility_mut(boxes[0]).unwrap().render_order = 1.0;
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[1], boxes[0]]);
}

#[test]
fn uniforms_hold_the_matrices_and_colour() {
    let (mut world, root, camera, _) = scene(&[[1.0, 2.0, -5.0]]);
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();

    let o = &frame.object_uniforms;
    assert_eq!(o[12..16], [1.0, 2.0, -5.0, 1.0]);
    assert_eq!((o[16], o[21], o[26]), (1.0, 1.0, 1.0));
    assert_eq!(o[28..32], [0.0, 0.0, 0.5, 0.5], "no flags, no skin, the default sprite centre");
    let m = block(&frame, 0);
    assert_eq!(m[0..4], [1.0, 0.5, 0.25, 1.0]);
    assert_eq!(m[4..8], [0.5, 0.25, 2.0, 0.0]);
    assert_eq!(map_entry(m, wamr_core::MapSlot::Color), [1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0], "identity transform, slot 0, uv set 0");
    assert_eq!((frame.draws[0].start, frame.draws[0].count, frame.draws[0].pipeline, frame.draws[0].instance_count), (0, 36, 0b11000 | LESS_EQUAL, 1));
    assert_eq!(frame.draws[0].textures, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // a standard material: 4% reflectance and full specular intensity
    assert_eq!(m[12..16], [0.04, 0.04, 0.04, 1.0]);
    assert_eq!(frame.material_uniforms.len(), MATERIAL_UNIFORM_FLOATS, "one block for a shared material");

    // The view-projection uses WebGPU depth: the near plane maps to 0, the far plane to 1.
    let view_projection = Matrix4 { elements: frame.frame_uniforms[..16].try_into().unwrap() };
    let depth = |z: f32| {
        let mut p = Vector4::new(0.0, 0.0, z, 1.0);
        p.apply_matrix4(&view_projection);
        p.z / p.w
    };
    assert!(depth(-1.0).abs() < 1e-6 && (depth(-100.0) - 1.0).abs() < 1e-5);
}

#[test]
fn needs_a_camera_and_skips_dead_or_incomplete_geometry() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
    assert!(prepare_frame(&mut world, root, boxes[0], &Lighting::default()).is_none());

    let geometry = world.renderable(boxes[0]).unwrap().geometry;
    world.geometry_mut(geometry).unwrap().set_draw_range(6, 12);
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!((frame.draws[0].start, frame.draws[0].count), (6, 12));
    world.geometry_mut(geometry).unwrap().delete_attribute("position");
    assert!(prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap().draws.is_empty());
    world.dispose_geometry(geometry);
    assert!(prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap().draws.is_empty());
}

#[test]
fn blended_draws_come_last_and_farthest_first() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -20.0], [0.0, 0.0, -10.0], [0.0, 0.0, -8.0]]);
    let glass = world.create_material(Material { transparent: true, opacity: 0.5, depth_write: false, ..Material::default() });
    let geometry = world.renderable(boxes[0]).unwrap().geometry;
    for e in [boxes[0], boxes[1]] {
        world.set_renderable(e, Some(Renderable::mesh(geometry, glass)));
    }

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[3], boxes[2], boxes[1], boxes[0]]);
    assert_eq!(frame.draws[3].pipeline, 0b10100 | 1 << 11 | LESS_EQUAL, "blended with normal blending");
    let m = block(&frame, 3);
    assert_eq!((m[3], m[7]), (0.5, 2.0));
}

#[test]
fn lines_need_no_normals_and_ignore_the_side() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
    let mut segments = BufferGeometry::new();
    segments.set_attribute("position", BufferAttribute::new(AttributeArray::Float32(vec![-1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0]), 3, false));
    segments.set_attribute("color", BufferAttribute::new(AttributeArray::Float32(vec![1.0; 12]), 3, false));
    let geometry = world.create_geometry(segments);
    let material = world.create_material(Material { shading: Shading::Unlit, side: Side::Back, vertex_colors: true, ..Material::default() });
    world.set_renderable(boxes[0], Some(Renderable { primitive: Primitive::LineSegments, ..Renderable::mesh(geometry, material) }));

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!((frame.draws[0].count, frame.draws[0].pipeline), (4, 2 | 0b11000 | 2 << 5 | LESS_EQUAL));
    assert_eq!(frame.object_uniforms[28], 17.0, "vertex colours, a line");
}

#[test]
fn lights_are_packed_after_the_ambient_colours() {
    let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
    let mut lighting = Lighting::default();
    lighting.lights.push(Light { kind: LightKind::Spot, position: Vector3::new(1.0, 2.0, 3.0), direction: Vector3::new(0.0, 2.0, 0.0), intensity: 3.0, distance: 9.0, decay: 1.5, cone_cos: 0.8, penumbra_cos: 0.9, ..Light::default() });
    lighting.lights.extend([Light::default(); MAX_LIGHTS + 2]);

    let f = prepare_frame(&mut world, root, camera, &lighting).unwrap().frame_uniforms;
    assert_eq!(f.len(), FRAME_UNIFORM_FLOATS);
    assert_eq!(f[19], MAX_LIGHTS as f32);
    assert_eq!(f[LIGHTS_OFFSET + 3], 0.0);
    assert_eq!(f[36..40], [0.0, 0.0, -1.0, 1.0]);
    assert_eq!(f[LIGHTS_OFFSET + 16..LIGHTS_OFFSET + 30], [1.0, 2.0, 3.0, 2.0, 0.0, 1.0, 0.0, 9.0, 3.0, 3.0, 3.0, 1.5, 0.8, 0.9]);
}

#[test]
fn a_material_per_group_makes_a_draw_per_group() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
    let red = world.create_material(Material { color: Color::new(1.0, 0.0, 0.0), ..Material::default() });
    let glass = world.create_material(Material { transparent: true, ..Material::default() });
    // a box has six groups of six indices; only groups 0, 1 and 4 get a material
    world.set_materials(boxes[0], vec![red, glass, MaterialHandle::from_bits(u64::MAX), MaterialHandle::from_bits(u64::MAX), red]);
    let geometry = world.renderable(boxes[0]).unwrap().geometry;
    world.geometry_mut(geometry).unwrap().set_draw_range(3, 24);

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| (d.start, d.count, d.pipeline & 4)).collect::<Vec<_>>(), [(3, 3, 0), (24, 3, 0), (6, 6, 4)]);
    assert_eq!(block(&frame, 0)[0..3], [1.0, 0.0, 0.0]);
    assert_eq!(frame.draws[0].material, frame.draws[1].material, "one block per material");
    assert_eq!(frame.candidates, 1);
}

#[test]
fn instanced_objects_are_not_culled_and_carry_their_count() {
    let (mut world, root, camera, boxes) = scene(&[[300.0, 0.0, -5.0], [0.0, 0.0, -5.0]]);
    let mut renderable = *world.renderable(boxes[0]).unwrap();
    renderable.instances = 9;
    renderable.instance_count = 250;
    world.set_renderable(boxes[0], Some(renderable));

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| (d.instances, d.instance_count)).collect::<Vec<_>>(), [(9, 250), (0, 1)]);
}

#[test]
fn fog_is_packed_before_the_lights() {
    let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
    let lighting = Lighting { fog: Fog { kind: FogKind::Linear, color: Color::new(0.5, 0.6, 0.7), near: 2.0, far: 30.0, density: 0.1 }, ..Lighting::default() };
    let f = prepare_frame(&mut world, root, camera, &lighting).unwrap().frame_uniforms;
    assert_eq!(f[28..35], [0.5, 0.6, 0.7, 1.0, 2.0, 30.0, 0.1]);
}

#[test]
fn shadow_casters_are_collected_per_light_and_receivers_flagged() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [0.0, 0.0, -8.0], [400.0, 0.0, -5.0]]);
    for &e in &boxes {
        world.visibility_mut(e).unwrap().cast_shadow = true;
    }
    world.visibility_mut(boxes[1]).unwrap().cast_shadow = false;
    world.visibility_mut(boxes[0]).unwrap().receive_shadow = true;

    let shadow = LightShadow {
        blur_samples: 8,
        projection: ShadowProjection::Orthographic { left: -5.0, right: 5.0, top: 5.0, bottom: -5.0, near: 0.5, far: 500.0 },
        target: Vector3::new(0.0, 0.0, -5.0),
        bias: -0.001,
        normal_bias: 0.0,
        intensity: 1.0,
        radius: 1.0,
        map_width: 1024,
        map_height: 512,
    };
    let sun = Light { direction: Vector3::new(0.0, 10.0, 0.0), shadow: Some(shadow), ..Light::default() };
    let point_shadow = LightShadow { projection: ShadowProjection::Perspective { fov: 90.0, aspect: 1.0, near: 0.5, far: 500.0 }, map_width: 256, map_height: 128, ..shadow };
    let point = Light { kind: LightKind::Point, shadow: Some(point_shadow), ..Light::default() };
    let mut lighting = Lighting { lights: vec![point, sun], shadows: true, ..Lighting::default() };

    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    assert_eq!(frame.shadows.len(), POINT_SHADOW_FACES + 1, "six cube faces for the point light, one map for the sun");
    // the point light at the origin sees the casting box in front of it on its -z face
    assert_eq!(frame.shadows[5].draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]]);
    assert_eq!(frame.shadows[0].draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[2]], "the far box lies on the +x face");
    assert!(frame.shadows[2].draws.is_empty());
    assert_eq!((frame.shadows[0].width, frame.shadows[0].height), (256, 256), "square faces of the map width");
    let pass = &frame.shadows[POINT_SHADOW_FACES];
    assert_eq!(pass.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]], "not casting, or outside the shadow frustum");
    assert_eq!(pass.draws[0].pipeline & 3, Side::Back as u32);
    assert_eq!((frame.shadow_map_width, frame.shadow_map_height), (1024, 512));
    // light 0 (point) starts at layer 0, light 1 uses layer 6
    assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + 14], 1.0);
    assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + LIGHT_FLOATS + 14], 7.0);
    // a point light's filter radius spans half as many texels
    assert_eq!(frame.frame_uniforms[SHADOWS_OFFSET + 19], 0.5 / 256.0);
    let sun_offset = SHADOWS_OFFSET + POINT_SHADOW_FACES * SHADOW_FLOATS;
    assert_eq!(frame.frame_uniforms[sun_offset + 16..sun_offset + 24], [-0.001, 0.0, 1.0, 1.0 / 1024.0, 1.0, 1.0, 6.0, 1.0]);
    // the box at the target projects to the middle of the map
    let m = Matrix4 { elements: frame.frame_uniforms[sun_offset..sun_offset + 16].try_into().unwrap() };
    let mut p = Vector3::new(0.0, 0.0, -5.0);
    p.apply_matrix4(&m);
    // (y is nudged slightly: the light looks straight down, parallel to "up", as in three.js)
    assert!((p.x - 0.5).abs() < 1e-5 && (p.y - 0.5).abs() < 1e-3 && p.z > 0.0 && p.z < 1.0, "{p:?}");
    // receivers are flagged; others not
    let receiver = frame.draws.iter().position(|d| d.object == boxes[0]).unwrap();
    assert_eq!(frame.object_uniforms[receiver * OBJECT_UNIFORM_FLOATS + 28], 4.0);

    lighting.shadow_type = ShadowType::Basic;
    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    assert_eq!(frame.frame_uniforms[sun_offset + 23], 0.0, "basic filtering");

    lighting.shadows = false;
    assert!(prepare_frame(&mut world, root, camera, &lighting).unwrap().shadows.is_empty());
}

#[test]
fn point_shadows_that_do_not_fit_are_skipped() {
    let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
    let shadow = LightShadow {
        blur_samples: 8,
        projection: ShadowProjection::Perspective { fov: 90.0, aspect: 1.0, near: 0.5, far: 500.0 },
        target: Vector3::default(),
        bias: 0.0,
        normal_bias: 0.0,
        intensity: 1.0,
        radius: 1.0,
        map_width: 512,
        map_height: 512,
    };
    let point = Light { kind: LightKind::Point, shadow: Some(shadow), ..Light::default() };
    let spot = Light { kind: LightKind::Spot, shadow: Some(shadow), ..Light::default() };
    // 6 + 6 maps fit in 16, a third point light does not; the spot light still does
    let lighting = Lighting { lights: vec![point, point, point, spot], shadows: true, ..Lighting::default() };
    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    assert_eq!(frame.shadows.len(), 13);
    assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + 2 * LIGHT_FLOATS + 14], 0.0);
    assert_eq!(frame.frame_uniforms[LIGHTS_OFFSET + 3 * LIGHT_FLOATS + 14], 13.0);
}

#[test]
fn maps_wireframe_and_physical_layers_are_packed() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
    let handle = world.renderable(boxes[0]).unwrap().material;
    {
        let m = world.material_mut(handle).unwrap();
        m.maps.light = 11;
        m.maps.bump = 12;
        m.maps.displacement = 13;
        m.light_map_intensity = 0.5;
        m.bump_scale = 2.0;
        m.displacement_scale = 3.0;
        m.displacement_bias = -1.0;
        m.clearcoat = 0.8;
        m.clearcoat_roughness = 0.2;
        m.sheen_color = Color::new(0.5, 0.25, 0.125);
        m.sheen_roughness = 0.6;
        m.ior = 2.0;
        m.specular_intensity = 0.5;
        m.wireframe = true;
    }
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    let draw = frame.draws[0];
    assert_eq!(draw.textures[0..3], [7, 11, 12], "maps take the free slots in map order");
    assert_eq!(draw.textures[DISPLACEMENT_SLOT], 13);
    assert_eq!(draw.pipeline & WIREFRAME_KEY, WIREFRAME_KEY);
    assert_eq!((draw.pipeline >> 5 & 3, draw.pipeline & 3), (2, Side::Double as u32), "a line list, without culling");
    let m = block(&frame, 0);
    assert_eq!(m[24..28], [0.8, 0.2, 0.6, 2.0]);
    assert_eq!(m[28..31], [0.5, 0.25, 0.125]);
    assert_eq!(m[20..23], [2.0, 3.0, -1.0]);
    assert_eq!(m[17], 0.5);
    // ((2 - 1) / (2 + 1))^2 = 1/9, times the specular intensity
    assert!((m[12] - 0.5 / 9.0).abs() < 1e-7 && m[15] == 0.5);
    assert_eq!(m[7] as u32, 131072 | 262144);
    use wamr_core::MapSlot;
    assert_eq!([MapSlot::Light, MapSlot::Bump, MapSlot::Displacement].map(|map| map_entry(m, map)[3]), [2.0, 3.0, DISPLACEMENT_SLOT as f32 + 1.0]);
    assert_eq!(map_entry(m, MapSlot::Normal)[3], 0.0, "no normal map");
}

#[test]
fn points_use_the_point_list_and_sprites_carry_their_settings() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [1.0, 0.0, -6.0]]);
    let geometry = world.renderable(boxes[0]).unwrap().geometry;
    let material = world.create_material(Material { shading: Shading::Unlit, rotation: 0.5, size_attenuation: false, ..Material::default() });
    world.set_renderable(boxes[0], Some(Renderable { primitive: Primitive::Points, ..Renderable::mesh(geometry, material) }));
    world.set_renderable(boxes[1], Some(Renderable { sprite: Some([0.25, 1.0]), ..Renderable::mesh(geometry, material) }));

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    let points = frame.draws.iter().position(|d| d.object == boxes[0]).unwrap();
    let sprite = frame.draws.iter().position(|d| d.object == boxes[1]).unwrap();
    assert_eq!(frame.draws[points].pipeline >> 5 & 3, 3);
    assert_eq!(frame.draws[points].pipeline & 3, 2, "points ignore the side");
    let o = &frame.object_uniforms[sprite * OBJECT_UNIFORM_FLOATS..];
    // a sprite (8) with its centre; its material of fixed size (16) with its rotation
    assert_eq!(o[28..32], [8.0, 0.0, 0.25, 1.0]);
    let m = block(&frame, sprite);
    assert_eq!((m[7], m[48]), (16.0, 0.5));
    // camera right and up, perspective
    let f = &frame.frame_uniforms;
    assert_eq!((f[40..43].to_vec(), f[44..48].to_vec()), (vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0, 1.0]));
}

#[test]
fn the_environment_is_packed_with_three_js_layout_sizes() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0]]);
    let handle = world.renderable(boxes[0]).unwrap().material;
    world.material_mut(handle).unwrap().uses_environment = true;
    world.material_mut(handle).unwrap().env_map_intensity = 0.7;
    // a 1024-wide equirectangular map: cube faces of 256, lodMax 8
    let environment = Environment { texture: 3, source_width: 1024, rotation: Matrix3::default() };
    assert_eq!((environment.lod_max(), environment.layout_size()), (8, (768, 1024)));
    assert_eq!(Environment { source_width: 256, ..environment }.layout_size(), (336, 256));

    let lighting = Lighting { environment: Some(environment), ..Lighting::default() };
    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    assert_eq!(frame.frame_uniforms[ENVIRONMENT_OFFSET..ENVIRONMENT_OFFSET + 3], [1.0 / 768.0, 1.0 / 1024.0, 8.0]);
    let m = block(&frame, 0);
    assert_eq!((m[16], m[31]), (0.7, 0.0), "intensity, first environment of the stack");
    assert_eq!(m[7] as u32 & 65536, 65536, "lit by the environment");
    assert_eq!(frame.environments.first().map(|e| e.texture), Some(3));
    assert!(shader_source().contains("fn cube_uv_sample(") && pmrem_shader_source().contains("fn ggx("));
}

#[test]
fn emissive_specular_line_loops_and_rgba_colours_are_packed() {
    let (mut world, root, camera, boxes) = scene(&[[0.0, 0.0, -5.0], [1.0, 0.0, -6.0]]);
    let geometry = world.renderable(boxes[0]).unwrap().geometry;
    let shiny = world.create_material(Material { shading: Shading::Phong, emissive: Color::new(0.1, 0.2, 0.3), specular: Color::new(0.5, 0.5, 0.5), shininess: 60.0, ..Material::default() });
    world.set_renderable(boxes[0], Some(Renderable::mesh(geometry, shiny)));
    world.set_renderable(boxes[1], Some(Renderable { primitive: Primitive::LineLoop, ..Renderable::mesh(geometry, shiny) }));
    world.geometry_mut(geometry).unwrap().set_attribute("color", BufferAttribute::new(AttributeArray::Float32(vec![1.0; 24 * 4]), 4, false));

    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    let mesh = frame.draws.iter().position(|d| d.object == boxes[0]).unwrap();
    let line = frame.draws.iter().position(|d| d.object == boxes[1]).unwrap();
    let m = block(&frame, mesh);
    assert_eq!(m[6], 3.0);
    assert_eq!(m[8..16], [0.1, 0.2, 0.3, 1.0, 0.5, 0.5, 0.5, 60.0], "emissive and ambient-occlusion intensity, specular and shininess");
    assert_eq!(frame.draws[mesh].pipeline & (LINE_LOOP_KEY | FOUR_COMPONENT_COLOR_KEY), FOUR_COMPONENT_COLOR_KEY);
    // a loop is drawn as a line strip with the loop bit
    assert_eq!(frame.draws[line].pipeline >> 5 & 3, 1);
    assert_eq!(frame.draws[line].pipeline & LINE_LOOP_KEY, LINE_LOOP_KEY);
    assert!(shader_source().contains("struct ObjectUniforms") && OBJECT_BINDING_FLOATS * 4 == 128);
}

#[test]
fn a_texture_background_is_packed_for_its_pass() {
    let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
    assert!(prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap().background_uniforms.is_empty());

    let background = Background { texture: 4, kind: BackgroundKind::Blurred, source_width: 1024, intensity: 0.5, blurriness: 0.25, rotation: Matrix3::default() };
    let lighting = Lighting { background: Some(background), ..Lighting::default() };
    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    let u = &frame.background_uniforms;
    assert_eq!(u.len(), BACKGROUND_UNIFORM_FLOATS);
    assert_eq!(frame.background, Some(background));
    // the camera looks down -Z with +Y up: its rotation is the identity
    assert_eq!(u[16..28], [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
    assert_eq!(u[40..44], [1.0, 0.5, 0.25, 0.0]);
    assert_eq!(u[44..47], [1.0 / 768.0, 1.0 / 1024.0, 8.0]);
    assert!(background_shader_source().contains("fn cube_uv_sample(") && BACKGROUND_SHADER.contains("fn fragment("));
}

#[test]
fn shader_declares_both_entry_points() {
    assert!(SHADER.contains("fn vertex(") && SHADER.contains("fn fragment("));
    let source = shader_source();
    assert!(source.contains(&format!("array<Light, {MAX_LIGHTS}>")) && source.contains(&format!("{MAX_LIGHTS}u)")));
    assert!(source.contains(&format!("array<Shadow, {MAX_SHADOWS}>")) && SHADOW_SHADER.contains("fn vertex("));
    assert!(SHADER.contains("fn vertex_quad(") && VSM_SHADER.contains("fn vertical(") && VSM_SHADER.contains("fn horizontal("));
    assert_eq!(FRAME_UNIFORM_FLOATS * 4 % 16, 0);
}

#[test]
fn tone_mapping_and_exposure_are_packed_for_the_output_pass() {
    let (mut world, root, camera, _) = scene(&[[0.0, 0.0, -5.0]]);
    let lighting = Lighting { tone_mapping: ToneMapping::AcesFilmic, exposure: 1.5, ..Lighting::default() };
    let frame = prepare_frame(&mut world, root, camera, &lighting).unwrap();
    assert_eq!((frame.frame_uniforms[TONE_MAPPING_INDEX], frame.frame_uniforms[TONE_MAPPING_EXPOSURE_INDEX]), (4.0, 1.5));
    assert!(output_shader_source().contains("fn tone_mapped(") && !SHADER.contains("fn tone_mapped("));
    assert_eq!(ToneMapping::from_u8(5), ToneMapping::None);
}

#[test]
fn every_glsl_pass_is_assembled_for_webgl_2() {
    for name in ["mesh.vert", "mesh.frag", "shadow.vert", "shadow.frag", "fullscreen.vert", "background.frag", "output.frag", "pmrem.vert", "pmrem.equirect", "pmrem.ggx", "cube.equirect"] {
        let source = glsl_source(name).unwrap();
        assert!(source.starts_with("#version 300 es
") && source.contains("void main()"), "{name}");
    }
    assert!(glsl_source("mesh.frag").unwrap().contains("vec2 dfg(") && glsl_source("unknown").is_none());
    // the frame block keeps the WGSL layout: same members, same order
    assert!(glsl_source("mesh.vert").unwrap().contains("Light lights[16];
    Shadow shadows[16];"));
}

#[test]
fn mesh_shaders_decide_every_feature_at_run_time_unless_specialised() {
    // The hosts set these by name (FEATURE_NAMES in webgpu/formats.js); a host that sets
    // none draws with all features possible, as before specialisation.
    let wgsl = shader_source();
    let glsl = glsl_source("mesh.frag").unwrap();
    for name in ["MATERIAL_FEATURES", "STATE_FEATURES", "MAP_FEATURES", "LIGHT_FEATURES"] {
        assert!(wgsl.contains(&format!("override {name}: u32 = 0xffffffffu;")), "{name}");
        assert!(glsl.contains(&format!("#ifndef {name}\n#define {name} 0xffffffffu\n#endif")), "{name}");
    }
    assert!(wgsl.contains("override SHADING_MODE: u32 = 0xffffffffu;") && glsl.contains("#ifdef SHADING_MODE"));
    // one mask bit per map
    assert!(wgsl.contains("const MAP_MATCAP = 24u;") && glsl.contains("#define MAP_MATCAP 24\n"));
}

#[test]
fn skinned_meshes_are_culled_where_their_bones_put_them() {
    // two boxes far to the side; the first one's bone holds it in front of the camera
    let (mut world, root, camera, boxes) = scene(&[[300.0, 0.0, -5.0], [300.0, 0.0, -5.0]]);
    for (&mesh, bone_at) in boxes.iter().zip([[0.0, 0.0, -5.0], [600.0, 0.0, -5.0]]) {
        let bone = world.create_object();
        world.add(root, bone);
        world.transform_mut(bone).unwrap().position.set(bone_at[0], bone_at[1], bone_at[2]);
        world.set_skin(mesh, Some(wamr_core::Skin { bones: vec![Some(bone)], bone_inverses: vec![Matrix4::default()], bind_matrix: Matrix4::default(), bind_matrix_inverse: Matrix4::default(), detached: false }));
    }
    world.update_matrix_world(root, false);
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[0]]);
    assert_eq!(frame.skin_matrices.len(), 32, "both skins are posed, the culled one too");
}

#[test]
fn equal_keys_keep_scene_order_and_negative_render_orders_come_first() {
    let (mut world, root, camera, boxes) = scene(&[[1.0, 0.0, -5.0], [-1.0, 0.0, -5.0], [0.0, 1.0, -5.0], [0.0, 0.0, -9.0]]);
    world.visibility_mut(boxes[3]).unwrap().render_order = -2.0;
    let frame = prepare_frame(&mut world, root, camera, &Lighting::default()).unwrap();
    assert_eq!(frame.draws.iter().map(|d| d.object).collect::<Vec<_>>(), [boxes[3], boxes[0], boxes[1], boxes[2]]);
}
