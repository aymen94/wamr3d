//! Morph targets, blended on the CPU into a geometry of the object's own.
//!
//! three.js keeps morph targets on the geometry and the weights (`morphTargetInfluences`)
//! on each mesh, so a geometry shared by meshes with different weights cannot be blended
//! in place. A morphed mesh draws a second geometry instead: [`morph_into`] copies the
//! base geometry's other attributes into it and writes the blended positions, normals and
//! colours. Raycasting and bounds then see the blended shape, as in three.js.
//!
//! The targets are attributes of the base geometry named `morph.position.<i>`,
//! `morph.normal.<i>` and `morph.color.<i>`.

use crate::attribute::{AttributeArray, BufferAttribute};
use crate::geometry::BufferGeometry;

const MORPHED: [&str; 3] = ["position", "normal", "color"];

/// Name of morph target `index` of `attribute` ("position", "normal" or "color").
pub fn morph_attribute_name(attribute: &str, index: usize) -> String {
    format!("morph.{attribute}.{index}")
}

/// How many morph targets `geometry` has for `attribute`.
pub fn morph_target_count(geometry: &BufferGeometry, attribute: &str) -> usize {
    (0..).take_while(|i| geometry.has_attribute(&morph_attribute_name(attribute, *i))).count()
}

fn floats(attribute: &BufferAttribute) -> Option<&[f32]> {
    match &attribute.array {
        AttributeArray::Float32(values) => Some(values),
        _ => None,
    }
}

/// Writes `base` blended with `influences` into `target`: every morphed attribute is the
/// base value plus the weighted targets (`relative`, three.js `morphTargetsRelative`) or
/// the base value scaled by one minus the weights' sum plus the weighted targets. Other
/// attributes, the index, groups and draw range are copied when they differ.
pub fn morph_into(base: &BufferGeometry, target: &mut BufferGeometry, influences: &[f32], relative: bool) {
    for (name, attribute) in base.attributes() {
        if name.starts_with("morph.") || MORPHED.contains(&name) {
            continue;
        }
        let stale = target.get_attribute(name).map_or(true, |current| current.version != attribute.version || current.array.len() != attribute.array.len());
        if stale {
            target.set_attribute(name, attribute.clone());
        }
    }
    let names: Vec<String> = target.attributes().map(|(n, _)| n.to_string()).filter(|n| !base.has_attribute(n)).collect();
    for name in names {
        target.delete_attribute(&name);
    }
    if target.get_index().map(|i| i.version) != base.get_index().map(|i| i.version) || target.get_index().map(|i| i.array.len()) != base.get_index().map(|i| i.array.len()) {
        target.set_index(base.get_index().cloned());
    }
    target.groups.clone_from(&base.groups);
    target.draw_range = base.draw_range;

    let sum: f32 = influences.iter().sum();
    let base_weight = if relative { 1.0 } else { 1.0 - sum };

    for name in MORPHED {
        let Some(source) = base.get_attribute(name) else {
            target.delete_attribute(name);
            continue;
        };
        let Some(values) = floats(source) else {
            target.set_attribute(name, source.clone());
            continue;
        };
        let mut out: Vec<f32> = match target.get_attribute_mut(name).map(|a| std::mem::replace(&mut a.array, AttributeArray::Float32(Vec::new()))) {
            Some(AttributeArray::Float32(mut v)) => {
                v.clear();
                v
            }
            _ => Vec::with_capacity(values.len()),
        };
        out.extend(values.iter().map(|v| v * base_weight));

        for (index, weight) in influences.iter().enumerate() {
            if *weight == 0.0 {
                continue;
            }
            let Some(delta) = base.get_attribute(&morph_attribute_name(name, index)).and_then(floats) else {
                continue;
            };
            // a target may have fewer components (a three-component colour target of a
            // four-component colour)
            let (size, delta_size) = (source.item_size, delta.len() / (values.len() / source.item_size.max(1)).max(1));
            if delta_size == size {
                for (o, d) in out.iter_mut().zip(delta) {
                    *o += weight * d;
                }
            } else {
                for (item, chunk) in out.chunks_exact_mut(size).zip(delta.chunks_exact(delta_size.max(1))) {
                    for (o, d) in item.iter_mut().zip(chunk) {
                        *o += weight * d;
                    }
                }
            }
        }

        let version = target.get_attribute(name).map_or(0, |a| a.version.wrapping_add(1));
        let mut attribute = BufferAttribute::new(AttributeArray::Float32(out), source.item_size, source.normalized);
        attribute.version = version;
        target.set_attribute(name, attribute);
    }

    target.bounding_box = None;
    target.bounding_sphere = None;
    target.clear_raycast_cache();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> BufferGeometry {
        let mut g = BufferGeometry::new();
        g.set_attribute("position", BufferAttribute::new(AttributeArray::Float32(vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0]), 3, false));
        g.set_attribute("uv", BufferAttribute::new(AttributeArray::Float32(vec![0.0, 0.0, 1.0, 1.0]), 2, false));
        g.set_attribute(&morph_attribute_name("position", 0), BufferAttribute::new(AttributeArray::Float32(vec![0.0, 2.0, 0.0, 0.0, 2.0, 0.0]), 3, false));
        g
    }

    #[test]
    fn relative_targets_add_their_weighted_offsets() {
        let base = geometry();
        let mut target = BufferGeometry::new();
        morph_into(&base, &mut target, &[0.5], true);
        assert_eq!(floats(target.get_attribute("position").unwrap()).unwrap(), [0.0, 1.0, 0.0, 1.0, 1.0, 0.0]);
        assert!(target.has_attribute("uv") && !target.has_attribute("morph.position.0"));
        assert_eq!(morph_target_count(&base, "position"), 1);
    }

    #[test]
    fn absolute_targets_blend_with_the_base() {
        let base = geometry();
        let mut target = BufferGeometry::new();
        morph_into(&base, &mut target, &[0.5], false);
        assert_eq!(floats(target.get_attribute("position").unwrap()).unwrap(), [0.0, 1.0, 0.0, 0.5, 1.0, 0.0]);
        let before = target.get_attribute("position").unwrap().version;
        morph_into(&base, &mut target, &[1.0], false);
        assert_ne!(target.get_attribute("position").unwrap().version, before);
    }
}
