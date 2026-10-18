use super::*;
use crate::euler::EulerOrder;
use crate::test_util::{assert_close, assert_close_slice};
use core::f32::consts::{FRAC_PI_2, PI};

const IDENTITY: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

fn counting() -> Matrix4 {
    Matrix4::new(
        1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
    )
}

fn translation(x: f32, y: f32, z: f32) -> Matrix4 {
    let mut m = Matrix4::default();
    m.make_translation(x, y, z);
    m
}

fn scaling(x: f32, y: f32, z: f32) -> Matrix4 {
    let mut m = Matrix4::default();
    m.make_scale(x, y, z);
    m
}

#[test]
fn default_is_identity() {
    assert_eq!(Matrix4::default().elements, IDENTITY);
}

#[test]
fn new_and_set_are_row_major_storage_is_column_major() {
    let m = counting();
    assert_eq!(
        m.elements,
        [1.0, 5.0, 9.0, 13.0, 2.0, 6.0, 10.0, 14.0, 3.0, 7.0, 11.0, 15.0, 4.0, 8.0, 12.0, 16.0]
    );
    let mut n = Matrix4::default();
    n.set(
        1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0,
    );
    assert_eq!(n, m);
}

#[test]
fn widen_and_narrow() {
    let mut n = Matrix4::default();
    n.set_wide(counting().wide());
    assert_eq!(n, counting());
}

#[test]
fn identity() {
    assert_eq!(counting().identity().elements, IDENTITY);
}

#[test]
fn copy() {
    assert_eq!(*Matrix4::default().copy(&counting()), counting());
}

#[test]
fn copy_position() {
    let mut m = Matrix4::default();
    m.copy_position(&translation(1.0, 2.0, 3.0));
    assert_eq!(m, translation(1.0, 2.0, 3.0));
}

#[test]
fn set_from_matrix3() {
    let m3 = Matrix3::new(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0);
    let mut m = counting();
    m.set_from_matrix3(&m3);
    assert_eq!(
        m,
        Matrix4::new(1.0, 2.0, 3.0, 0.0, 4.0, 5.0, 6.0, 0.0, 7.0, 8.0, 9.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    );
}

#[test]
fn extract_basis() {
    let (mut x, mut y, mut z) = (Vector3::default(), Vector3::default(), Vector3::default());
    scaling(2.0, 3.0, 4.0).extract_basis(&mut x, &mut y, &mut z);
    assert_eq!((x, y, z), (Vector3::new(2.0, 0.0, 0.0), Vector3::new(0.0, 3.0, 0.0), Vector3::new(0.0, 0.0, 4.0)));
    // singular: identity basis
    scaling(2.0, 0.0, 4.0).extract_basis(&mut x, &mut y, &mut z);
    assert_eq!((x, y, z), (Vector3::new(1.0, 0.0, 0.0), Vector3::new(0.0, 1.0, 0.0), Vector3::new(0.0, 0.0, 1.0)));
}

#[test]
fn make_basis() {
    let mut m = Matrix4::default();
    m.make_basis(&Vector3::new(1.0, 2.0, 3.0), &Vector3::new(4.0, 5.0, 6.0), &Vector3::new(7.0, 8.0, 9.0));
    assert_eq!(
        m.elements,
        [1.0, 2.0, 3.0, 0.0, 4.0, 5.0, 6.0, 0.0, 7.0, 8.0, 9.0, 0.0, 0.0, 0.0, 0.0, 1.0]
    );
}

#[test]
fn extract_rotation() {
    let mut m = Matrix4::default();
    let mut src = translation(1.0, 2.0, 3.0);
    src.scale(&Vector3::new(2.0, 3.0, 4.0));
    m.extract_rotation(&src);
    assert_eq!(m.elements, IDENTITY);
    // singular source: identity
    let mut n = counting();
    n.extract_rotation(&scaling(0.0, 1.0, 1.0));
    assert_eq!(n.elements, IDENTITY);
}

#[test]
fn make_rotation_from_euler() {
    let mut m = Matrix4::default();
    m.make_rotation_from_euler(&Euler::new(FRAC_PI_2, 0.0, 0.0, EulerOrder::XYZ));
    let mut expected = Matrix4::default();
    expected.make_rotation_x(FRAC_PI_2);
    assert_close_slice(&m.elements, &expected.elements);
}

#[test]
fn make_rotation_from_quaternion() {
    let mut q = Quaternion::default();
    q.set_from_axis_angle(&Vector3::new(0.0, 1.0, 0.0), FRAC_PI_2);
    let mut m = Matrix4::default();
    m.make_rotation_from_quaternion(&q);
    let mut expected = Matrix4::default();
    expected.make_rotation_y(FRAC_PI_2);
    assert_close_slice(&m.elements, &expected.elements);
}

#[test]
fn look_at() {
    // looking down -Z with +Y up is the identity rotation (camera convention)
    let mut m = translation(5.0, 6.0, 7.0);
    m.look_at(&Vector3::new(0.0, 0.0, 0.0), &Vector3::new(0.0, 0.0, -1.0), &Vector3::new(0.0, 1.0, 0.0));
    assert_eq!(m, translation(5.0, 6.0, 7.0));
    // eye == target falls back to z = (0, 0, 1)
    let mut n = Matrix4::default();
    n.look_at(&Vector3::new(1.0, 1.0, 1.0), &Vector3::new(1.0, 1.0, 1.0), &Vector3::new(0.0, 1.0, 0.0));
    assert_eq!(n.elements, IDENTITY);
    // up parallel to the view direction still yields an orthonormal basis
    let mut p = Matrix4::default();
    p.look_at(&Vector3::new(0.0, 1.0, 0.0), &Vector3::default(), &Vector3::new(0.0, 1.0, 0.0));
    assert_close(p.determinant(), 1.0);
}

#[test]
fn multiply() {
    // T * S: scale first, then translate
    let mut m = translation(1.0, 2.0, 3.0);
    m.multiply(&scaling(2.0, 3.0, 4.0));
    assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(3.0, 5.0, 7.0));
}

#[test]
fn premultiply() {
    // S * T: translate first, then scale
    let mut m = translation(1.0, 2.0, 3.0);
    m.premultiply(&scaling(2.0, 3.0, 4.0));
    assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(4.0, 9.0, 16.0));
}

#[test]
fn multiply_matrices() {
    let mut m = Matrix4::default();
    m.multiply_matrices(&counting(), &Matrix4::default());
    assert_eq!(m, counting());
    m.multiply_matrices(&counting(), &counting());
    assert_eq!(
        m,
        Matrix4::new(
            90.0, 100.0, 110.0, 120.0, 202.0, 228.0, 254.0, 280.0, 314.0, 356.0, 398.0, 440.0, 426.0, 484.0,
            542.0, 600.0
        )
    );
}

#[test]
fn multiply_scalar() {
    assert_eq!(scaling(1.0, 2.0, 3.0).multiply_scalar(2.0).elements[..6], [2.0, 0.0, 0.0, 0.0, 0.0, 4.0]);
}

#[test]
fn determinant() {
    assert_eq!(scaling(2.0, 3.0, 4.0).determinant(), 24.0);
    assert_eq!(counting().determinant(), 0.0);
    assert_eq!(Matrix4::default().determinant(), 1.0);
}

#[test]
fn determinant_affine() {
    assert_eq!(scaling(2.0, 3.0, 4.0).determinant_affine(), 24.0);
    assert_eq!(scaling(-1.0, 1.0, 1.0).determinant_affine(), -1.0);
}

#[test]
fn transpose() {
    let mut m = counting();
    m.transpose();
    assert_eq!(
        m.elements,
        [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0]
    );
}

#[test]
fn set_position() {
    assert_eq!(*Matrix4::default().set_position(1.0, 2.0, 3.0), translation(1.0, 2.0, 3.0));
}

#[test]
fn invert() {
    let mut m = translation(1.0, 2.0, 3.0);
    m.multiply(&scaling(2.0, 4.0, 8.0));
    let mut inv = m;
    inv.invert();
    inv.multiply(&m);
    assert_close_slice(&inv.elements, &IDENTITY);
    // singular: zero matrix
    assert_eq!(counting().invert().elements, [0.0; 16]);
}

#[test]
fn scale() {
    let mut m = translation(1.0, 2.0, 3.0);
    m.scale(&Vector3::new(2.0, 3.0, 4.0));
    assert_eq!(*Vector3::new(1.0, 1.0, 1.0).apply_matrix4(&m), Vector3::new(3.0, 5.0, 7.0));
}

#[test]
fn get_max_scale_on_axis() {
    assert_eq!(scaling(2.0, -5.0, 3.0).get_max_scale_on_axis(), 5.0);
}

#[test]
fn make_translation() {
    assert_eq!(translation(1.0, 2.0, 3.0).elements[12..], [1.0, 2.0, 3.0, 1.0]);
}

#[test]
fn make_rotation_x() {
    // right-handed: +Y rotates toward +Z
    let mut m = Matrix4::default();
    m.make_rotation_x(FRAC_PI_2);
    assert_close_slice(&Vector3::new(0.0, 1.0, 0.0).apply_matrix4(&m).to_array(), &[0.0, 0.0, 1.0]);
}

#[test]
fn make_rotation_y() {
    // right-handed: +Z rotates toward +X
    let mut m = Matrix4::default();
    m.make_rotation_y(FRAC_PI_2);
    assert_close_slice(&Vector3::new(0.0, 0.0, 1.0).apply_matrix4(&m).to_array(), &[1.0, 0.0, 0.0]);
}

#[test]
fn make_rotation_z() {
    // right-handed: +X rotates toward +Y
    let mut m = Matrix4::default();
    m.make_rotation_z(FRAC_PI_2);
    assert_close_slice(&Vector3::new(1.0, 0.0, 0.0).apply_matrix4(&m).to_array(), &[0.0, 1.0, 0.0]);
}

#[test]
fn make_rotation_axis() {
    let mut m = Matrix4::default();
    m.make_rotation_axis(&Vector3::new(0.0, 0.0, 1.0), PI);
    let mut expected = Matrix4::default();
    expected.make_rotation_z(PI);
    assert_close_slice(&m.elements, &expected.elements);
}

#[test]
fn make_scale() {
    assert_eq!(
        scaling(2.0, 3.0, 4.0).elements,
        [2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0]
    );
}

#[test]
fn make_shear() {
    let mut m = Matrix4::default();
    m.make_shear(1.0, 2.0, 3.0, 4.0, 5.0, 6.0);
    assert_eq!(
        m,
        Matrix4::new(1.0, 3.0, 5.0, 0.0, 1.0, 1.0, 6.0, 0.0, 2.0, 4.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    );
}

#[test]
fn compose() {
    let mut m = Matrix4::default();
    m.compose(&Vector3::new(1.0, 2.0, 3.0), &Quaternion::default(), &Vector3::new(2.0, 3.0, 4.0));
    let mut expected = translation(1.0, 2.0, 3.0);
    expected.scale(&Vector3::new(2.0, 3.0, 4.0));
    assert_eq!(m, expected);
}

#[test]
fn decompose() {
    let mut q = Quaternion::default();
    q.set_from_axis_angle(&Vector3::new(0.0, 1.0, 0.0), 0.5);
    let mut m = Matrix4::default();
    m.compose(&Vector3::new(1.0, 2.0, 3.0), &q, &Vector3::new(2.0, 3.0, 4.0));

    let (mut p, mut r, mut s) = (Vector3::default(), Quaternion::default(), Vector3::default());
    m.decompose(&mut p, &mut r, &mut s);
    assert_eq!(p, Vector3::new(1.0, 2.0, 3.0));
    assert_close_slice(&r.to_array(), &q.to_array());
    assert_close_slice(&s.to_array(), &[2.0, 3.0, 4.0]);

    // a mirrored matrix reports a negative X scale
    scaling(-2.0, 3.0, 4.0).decompose(&mut p, &mut r, &mut s);
    assert_close_slice(&s.to_array(), &[-2.0, 3.0, 4.0]);

    // singular: unit scale, identity rotation
    scaling(0.0, 3.0, 4.0).decompose(&mut p, &mut r, &mut s);
    assert_eq!(s, Vector3::new(1.0, 1.0, 1.0));
    assert_eq!(r, Quaternion::default());
}

#[test]
fn make_perspective_depth_conventions() {
    let (near, far) = (0.5, 100.0);
    let ndc_z = |cs, reversed, z: f32| {
        let mut m = Matrix4::default();
        m.make_perspective(-1.0, 1.0, 1.0, -1.0, near, far, cs, reversed);
        Vector3::new(0.0, 0.0, z).apply_matrix4(&m).z
    };

    assert_close(ndc_z(CoordinateSystem::WebGL, false, -near), -1.0);
    assert_close(ndc_z(CoordinateSystem::WebGL, false, -far), 1.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, false, -near), 0.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, false, -far), 1.0);
    // reversed depth: near -> 1, far -> 0
    assert_close(ndc_z(CoordinateSystem::WebGPU, true, -near), 1.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, true, -far), 0.0);
}

#[test]
fn make_perspective_keeps_handedness() {
    // the camera looks down -Z: a point in front has positive clip w, +X stays right, +Y stays up
    let mut m = Matrix4::default();
    m.make_perspective(-1.0, 1.0, 1.0, -1.0, 1.0, 10.0, CoordinateSystem::WebGPU, false);
    let mut p = crate::vector4::Vector4::new(1.0, 2.0, -4.0, 1.0);
    p.apply_matrix4(&m);
    assert!(p.w > 0.0 && p.x > 0.0 && p.y > 0.0);
}

#[test]
fn make_orthographic_depth_conventions() {
    let (near, far) = (1.0, 11.0);
    let ndc_z = |cs, reversed, z: f32| {
        let mut m = Matrix4::default();
        m.make_orthographic(-2.0, 2.0, 2.0, -2.0, near, far, cs, reversed);
        Vector3::new(0.0, 0.0, z).apply_matrix4(&m).z
    };

    assert_close(ndc_z(CoordinateSystem::WebGL, false, -near), -1.0);
    assert_close(ndc_z(CoordinateSystem::WebGL, false, -far), 1.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, false, -near), 0.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, false, -far), 1.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, true, -near), 1.0);
    assert_close(ndc_z(CoordinateSystem::WebGPU, true, -far), 0.0);
}

#[test]
fn equals() {
    assert!(counting().equals(&counting()));
    assert!(!counting().equals(&Matrix4::default()));
}

#[test]
fn from_array_and_to_array() {
    let mut data = [0.0; 17];
    data[1..].copy_from_slice(&counting().elements);
    let mut m = Matrix4::default();
    m.from_array(&data, 1);
    assert_eq!(m, counting());
    assert_eq!(m.to_array(), m.elements);
}

#[test]
fn to_array_into() {
    let mut out = [0.0; 17];
    counting().to_array_into(&mut out, 1);
    assert_eq!(out[0], 0.0);
    assert_eq!(out[1..], counting().elements);
}
