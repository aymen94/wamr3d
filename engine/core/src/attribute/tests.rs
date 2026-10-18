use super::*;

fn positions() -> BufferAttribute {
    BufferAttribute::new(AttributeArray::Float32(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), 3, false)
}

#[test]
fn array_len_type_and_zeroed_like() {
    let a = AttributeArray::Int16(vec![1, 2, 3]);
    assert_eq!((a.len(), a.is_empty()), (3, false));
    assert_eq!(a.component_type(), ComponentType::Int16);
    assert_eq!(a.zeroed_like(2), AttributeArray::Int16(vec![0, 0]));
}

#[test]
fn array_set_wraps_like_a_js_typed_array() {
    let mut u8s = AttributeArray::Uint8(vec![0; 4]);
    u8s.set(0, 257.0);
    u8s.set(1, -1.0);
    u8s.set(2, 1.9);
    u8s.set(3, f64::NAN);
    assert_eq!(u8s, AttributeArray::Uint8(vec![1, 255, 1, 0]));

    let mut i8s = AttributeArray::Int8(vec![0; 2]);
    i8s.set(0, 128.0);
    i8s.set(1, -129.0);
    assert_eq!(i8s, AttributeArray::Int8(vec![-128, 127]));

    let mut clamped = AttributeArray::Uint8Clamped(vec![0; 4]);
    clamped.set(0, 300.0);
    clamped.set(1, -5.0);
    clamped.set(2, 0.5);
    clamped.set(3, 1.5);
    assert_eq!(clamped, AttributeArray::Uint8Clamped(vec![255, 0, 0, 2]));
    assert_eq!(clamped.get(3), 2.0);
}

#[test]
fn new_and_count() {
    let a = positions();
    assert_eq!((a.count(), a.item_size(), a.version), (2, 3, 0));
    assert_eq!((a.usage, a.gpu_type), (Usage::StaticDraw, GpuType::Float));
    assert!(!a.is_instanced());
}

#[test]
fn new_instanced() {
    let a = BufferAttribute::new_instanced(AttributeArray::Float32(vec![0.0; 16]), 16, false, 1);
    assert_eq!(a.mesh_per_attribute, Some(1));
    assert!(a.is_instanced());
}

#[test]
fn needs_update_bumps_version() {
    let mut a = positions();
    a.needs_update();
    a.needs_update();
    assert_eq!(a.version, 2);
}

#[test]
fn set_usage() {
    assert_eq!(positions().set_usage(Usage::DynamicDraw).usage, Usage::DynamicDraw);
}

#[test]
fn update_ranges() {
    let mut a = positions();
    a.add_update_range(3, 3);
    assert_eq!(a.update_ranges, vec![UpdateRange { start: 3, count: 3 }]);
    a.clear_update_ranges();
    assert!(a.update_ranges.is_empty());
}

#[test]
fn copy_keeps_destination_version() {
    let mut src = positions();
    src.name = "position".into();
    src.needs_update();
    let mut dst = BufferAttribute::new(AttributeArray::Uint8(vec![]), 1, true);
    dst.copy(&src);
    assert_eq!((dst.name.as_str(), dst.item_size, dst.normalized, dst.version), ("position", 3, false, 0));
    assert_eq!(dst.array, src.array);
}

#[test]
fn copy_at() {
    let mut a = positions();
    let b = BufferAttribute::new(AttributeArray::Float32(vec![7.0, 8.0, 9.0]), 3, false);
    a.copy_at(1, &b, 0);
    assert_eq!(a.array, AttributeArray::Float32(vec![1.0, 2.0, 3.0, 7.0, 8.0, 9.0]));
}

#[test]
fn set_and_copy_array() {
    let mut a = positions();
    a.set(&[9.0, 8.0], 4);
    assert_eq!(a.get_vector3(1), Vector3::new(4.0, 9.0, 8.0));
    a.copy_array(&[0.0, 0.0]);
    assert_eq!(a.get_vector3(0), Vector3::new(0.0, 0.0, 3.0));
}

#[test]
fn component_getters_and_setters() {
    let mut a = BufferAttribute::new(AttributeArray::Float32(vec![0.0; 8]), 4, false);
    a.set_xyzw(1, 1.0, 2.0, 3.0, 4.0);
    assert_eq!((a.get_x(1), a.get_y(1), a.get_z(1), a.get_w(1)), (1.0, 2.0, 3.0, 4.0));
    a.set_x(0, 5.0);
    a.set_y(0, 6.0);
    a.set_z(0, 7.0);
    a.set_w(0, 8.0);
    a.set_component(0, 1, 9.0);
    assert_eq!(a.get_component(0, 1), 9.0);
    a.set_xy(0, 1.5, 2.5);
    a.set_xyz(1, 0.0, 0.0, 0.0);
    assert_eq!(a.get_vector2(0), Vector2::new(1.5, 2.5));
    assert_eq!(a.get_vector3(1), Vector3::new(0.0, 0.0, 0.0));
}

#[test]
fn normalized_attributes_convert_on_access() {
    let mut a = BufferAttribute::new(AttributeArray::Uint8(vec![0; 3]), 3, true);
    a.set_xyz(0, 1.0, 0.5, 0.0);
    assert_eq!(a.array, AttributeArray::Uint8(vec![255, 128, 0]));
    assert_eq!(a.get_x(0), 1.0);

    let mut s = BufferAttribute::new(AttributeArray::Int16(vec![0; 2]), 2, true);
    s.set_xy(0, -1.0, 1.0);
    assert_eq!(s.array, AttributeArray::Int16(vec![-32767, 32767]));
    assert_eq!((s.get_x(0), s.get_y(0)), (-1.0, 1.0));
}

#[test]
fn apply_matrix3() {
    let mut m = Matrix3::default();
    m.make_scale(2.0, 3.0);
    let mut uv = BufferAttribute::new(AttributeArray::Float32(vec![1.0, 1.0]), 2, false);
    uv.apply_matrix3(&m);
    assert_eq!(uv.get_vector2(0), Vector2::new(2.0, 3.0));
    let mut p = positions();
    p.apply_matrix3(&m);
    assert_eq!(p.get_vector3(0), Vector3::new(2.0, 6.0, 3.0));
}

#[test]
fn apply_matrix4() {
    let mut m = Matrix4::default();
    m.make_translation(1.0, 1.0, 1.0);
    let mut p = positions();
    p.apply_matrix4(&m);
    assert_eq!(p.get_vector3(1), Vector3::new(5.0, 6.0, 7.0));
}

#[test]
fn apply_normal_matrix_and_transform_direction_normalize() {
    let mut n = BufferAttribute::new(AttributeArray::Float32(vec![0.0, 3.0, 0.0]), 3, false);
    n.apply_normal_matrix(&Matrix3::default());
    assert_eq!(n.get_vector3(0), Vector3::new(0.0, 1.0, 0.0));
    let mut d = BufferAttribute::new(AttributeArray::Float32(vec![0.0, 0.0, -4.0]), 3, false);
    let mut m = Matrix4::default();
    m.make_translation(9.0, 9.0, 9.0);
    d.transform_direction(&m);
    assert_eq!(d.get_vector3(0), Vector3::new(0.0, 0.0, -1.0));
}

fn interleaved() -> InterleavedBuffer {
    // position.xyz, uv.xy per vertex
    InterleavedBuffer::new(AttributeArray::Float32(vec![1.0, 2.0, 3.0, 0.1, 0.2, 4.0, 5.0, 6.0, 0.3, 0.4]), 5)
}

#[test]
fn interleaved_buffer_basics() {
    let mut b = interleaved();
    assert_eq!((b.count(), b.stride, b.version), (2, 5, 0));
    b.needs_update();
    b.set_usage(Usage::DynamicDraw);
    b.add_update_range(0, 5);
    assert_eq!((b.version, b.usage, b.update_ranges.len()), (1, Usage::DynamicDraw, 1));
    b.clear_update_ranges();
    assert!(b.update_ranges.is_empty());
    let instanced = InterleavedBuffer::new_instanced(AttributeArray::Float32(vec![0.0; 4]), 4, 2);
    assert_eq!(instanced.mesh_per_attribute, Some(2));
}

#[test]
fn interleaved_buffer_copy_copy_at_set() {
    let src = interleaved();
    let mut dst = InterleavedBuffer::new(AttributeArray::Float32(vec![]), 1);
    dst.copy(&src);
    assert_eq!((dst.stride, dst.count()), (5, 2));
    dst.copy_at(0, &src, 1);
    dst.set(&[9.0], 9);
    assert_eq!(dst.array, AttributeArray::Float32(vec![4.0, 5.0, 6.0, 0.3, 0.4, 4.0, 5.0, 6.0, 0.3, 9.0]));
}

#[test]
fn interleaved_attribute_view_and_deinterleave() {
    let mut arena = crate::arena::Arena::new();
    let handle = arena.insert(interleaved());
    let uv = InterleavedBufferAttribute::new(handle, 2, 3, false);
    let buffer = arena.get_mut(handle).unwrap();

    let mut view = uv.view(buffer);
    assert_eq!((view.count(), view.item_size()), (2, 2));
    assert_eq!(view.get_vector2(1), Vector2::new(0.3, 0.4));
    view.set_xy(0, 0.5, 0.75);
    assert_eq!(buffer.array.get(3), 0.5);

    let standalone = uv.deinterleave(buffer);
    assert_eq!(standalone.array, AttributeArray::Float32(vec![0.5, 0.75, 0.3, 0.4]));
}
