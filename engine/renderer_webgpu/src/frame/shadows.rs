//! Shadow passes: the casters drawn into each map.

use super::*;

/// The meshes that cast shadows into one map: visible, `cast_shadow`, on the camera's
/// layers (three.js gives a shadow camera without layers of its own the view camera's),
/// and inside the shadow camera's frustum (skinned ones in their pose) unless instanced
/// or not frustum-culled.
#[allow(clippy::too_many_arguments)]
pub(super) fn shadow_pass(
    world: &mut World,
    objects: &[Entity],
    layers: wamr_core::Layers,
    view_projection: &Matrix4,
    layer: u32,
    width: u32,
    height: u32,
    materials: &mut Materials,
    environments: &mut Environments,
    skins: &mut Skins,
    frame: &mut Frame,
) -> ShadowPass {
    let mut frustum = Frustum::default();
    frustum.set_from_projection_matrix(view_projection, CoordinateSystem::WebGPU, false);
    let mut pass = ShadowPass { layer, width, height, view_projection: view_projection.elements, ..ShadowPass::default() };

    for &object in objects {
        let (Some(renderable), Some(visibility), Some(matrix_world)) =
            (world.renderable(object).copied(), world.visibility(object).copied(), world.transform(object).map(|t| t.matrix_world))
        else {
            continue;
        };
        if renderable.primitive != Primitive::Mesh || renderable.sprite.is_some() || !visibility.layers.test(&layers) {
            continue;
        }
        let Some((side, shadow_side)) = world.material(renderable.material).filter(|m| m.state.visible).map(|m| (m.side, m.state.shadow_side)) else {
            continue;
        };
        let skinned = world.skin(object).is_some();
        let Some(geometry) = world.geometry_mut(renderable.geometry) else {
            continue;
        };
        let Some(vertices) = geometry.get_attribute("position").map(|a| a.count() as u32) else {
            continue;
        };
        let aux_key = if ["tangent", "uv1", "skinIndex", "skinWeight"].iter().any(|name| geometry.has_attribute(name)) { AUX_KEY } else { 0 };
        let available = geometry.get_index().map_or(vertices, |index| index.count() as u32);
        let start = geometry.draw_range.start.min(available);
        let end = geometry.draw_range.start.saturating_add(geometry.draw_range.count).min(available);
        if end <= start {
            continue;
        }
        if geometry.bounding_sphere.is_none() {
            geometry.compute_bounding_sphere();
        }
        let mut sphere: Sphere = geometry.bounding_sphere.unwrap_or_default();
        let skin = skins.offset(world, object, &mut frame.skin_matrices);
        if skinned {
            match skins.bounds(object, &sphere, &frame.skin_matrices) {
                Some(posed) => sphere = posed,
                None => sphere.radius = f32::INFINITY,
            }
        }
        sphere.apply_matrix4(&matrix_world);
        let instanced = renderable.instances != 0;
        if instanced && renderable.instance_count == 0 {
            continue;
        }
        if visibility.frustum_culled && !instanced && !frustum.intersects_sphere(&sphere) {
            continue;
        }
        let side = shadow_side.unwrap_or(match side {
            Side::Front => Side::Back,
            Side::Back => Side::Front,
            Side::Double => Side::Double,
        });
        // the material's textures and block go along, for its alpha test and displacement
        let (material_index, textures) = materials.get(world, renderable.material, environments, &mut frame.material_uniforms);
        let shadow_material = Material { side, transparent: false, depth_write: true, depth_test: true, ..Material::default() };
        pass.draws.push(Draw {
            object,
            geometry: renderable.geometry,
            pipeline: pipeline_key(&shadow_material, Primitive::Mesh) | aux_key,
            depth: 0.0,
            textures,
            start,
            count: end - start,
            instances: renderable.instances,
            instance_count: if instanced { renderable.instance_count } else { 1 },
            material: material_index,
            custom: 0,
        });
        push_object(&mut pass.object_uniforms, &matrix_world, 0, skin, None);
    }
    pass
}
