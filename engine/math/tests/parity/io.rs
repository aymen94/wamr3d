//! Reading a fixture's inputs and writing the results to compare.

use super::*;

pub(crate) const ORDERS: [EulerOrder; 6] =
    [EulerOrder::XYZ, EulerOrder::YXZ, EulerOrder::ZXY, EulerOrder::ZYX, EulerOrder::YZX, EulerOrder::XZY];
pub(crate) const PROPER_ORDERS: [ProperEulerOrder; 6] = [
    ProperEulerOrder::XYX,
    ProperEulerOrder::YZY,
    ProperEulerOrder::ZXZ,
    ProperEulerOrder::XZX,
    ProperEulerOrder::YXY,
    ProperEulerOrder::ZYZ,
];
pub(crate) const COLOR_SPACES: [ColorSpace; 3] = [ColorSpace::None, ColorSpace::Srgb, ColorSpace::LinearSrgb];
pub(crate) const COORD_SYSTEMS: [CoordinateSystem; 2] = [CoordinateSystem::WebGL, CoordinateSystem::WebGPU];
pub(crate) const COMPONENT_TYPES: [ComponentType; 8] = [
    ComponentType::Float32,
    ComponentType::Uint32,
    ComponentType::Uint16,
    ComponentType::Uint8,
    ComponentType::Int32,
    ComponentType::Int16,
    ComponentType::Int8,
    ComponentType::Uint8Clamped,
];

pub(crate) struct In<'a> {
    pub(crate) v: &'a [f64],
    pub(crate) i: usize,
    pub(crate) text: &'a str,
}

impl In<'_> {
    pub(crate) fn d(&mut self) -> f64 {
        let x = self.v[self.i];
        self.i += 1;
        x
    }
    pub(crate) fn s(&mut self) -> f32 {
        let x = self.d();
        assert!(x.is_nan() || x as f32 as f64 == x, "float input {x} is not an f32 value");
        x as f32
    }
    pub(crate) fn u(&mut self) -> usize {
        self.d() as usize
    }
    pub(crate) fn b(&mut self) -> bool {
        self.d() == 1.0
    }
    pub(crate) fn v2(&mut self) -> Vector2 {
        Vector2::new(self.s(), self.s())
    }
    pub(crate) fn v3(&mut self) -> Vector3 {
        Vector3::new(self.s(), self.s(), self.s())
    }
    pub(crate) fn v4(&mut self) -> Vector4 {
        Vector4::new(self.s(), self.s(), self.s(), self.s())
    }
    pub(crate) fn q(&mut self) -> Quaternion {
        Quaternion::new(self.s(), self.s(), self.s(), self.s())
    }
    pub(crate) fn ord(&mut self) -> EulerOrder {
        ORDERS[self.u()]
    }
    pub(crate) fn e(&mut self) -> Euler {
        Euler::new(self.s(), self.s(), self.s(), self.ord())
    }
    pub(crate) fn m3(&mut self) -> Matrix3 {
        Matrix3 { elements: core::array::from_fn(|_| self.s()) }
    }
    pub(crate) fn m4(&mut self) -> Matrix4 {
        Matrix4 { elements: core::array::from_fn(|_| self.s()) }
    }
    pub(crate) fn c(&mut self) -> Color {
        Color::new(self.s(), self.s(), self.s())
    }
    pub(crate) fn cspace(&mut self) -> ColorSpace {
        COLOR_SPACES[self.u()]
    }
    pub(crate) fn cs(&mut self) -> CoordinateSystem {
        COORD_SYSTEMS[self.u()]
    }
    pub(crate) fn bx(&mut self) -> Box3 {
        Box3::new(self.v3(), self.v3())
    }
    pub(crate) fn sph(&mut self) -> Sphere {
        Sphere::new(self.v3(), self.s())
    }
    pub(crate) fn pl(&mut self) -> Plane {
        Plane::new(self.v3(), self.s())
    }
    pub(crate) fn ray(&mut self) -> Ray {
        Ray::new(self.v3(), self.v3())
    }
    pub(crate) fn line(&mut self) -> Line3 {
        Line3::new(self.v3(), self.v3())
    }
    pub(crate) fn tri(&mut self) -> Triangle {
        Triangle::new(self.v3(), self.v3(), self.v3())
    }
    pub(crate) fn fr(&mut self) -> Frustum {
        Frustum { planes: core::array::from_fn(|_| self.pl()) }
    }
    pub(crate) fn sphl(&mut self) -> Spherical {
        Spherical::new(self.s(), self.s(), self.s())
    }
    pub(crate) fn cyl(&mut self) -> Cylindrical {
        Cylindrical::new(self.s(), self.s(), self.s())
    }
    pub(crate) fn pts(&mut self) -> Vec<Vector3> {
        let n = self.u();
        (0..n).map(|_| self.v3()).collect()
    }
}

#[derive(Default)]
pub(crate) struct Out {
    pub(crate) v: Vec<f64>,
    pub(crate) text: Option<String>,
}

impl Out {
    pub(crate) fn d(&mut self, x: f64) {
        self.v.push(x);
    }
    pub(crate) fn s(&mut self, x: f32) {
        self.v.push(x as f64);
    }
    pub(crate) fn b(&mut self, x: bool) {
        self.v.push(if x { 1.0 } else { 0.0 });
    }
    pub(crate) fn a(&mut self, x: &[f32]) {
        self.v.extend(x.iter().map(|c| *c as f64));
    }
    pub(crate) fn v2(&mut self, x: &Vector2) {
        self.a(&x.to_array());
    }
    pub(crate) fn v3(&mut self, x: &Vector3) {
        self.a(&x.to_array());
    }
    pub(crate) fn v4(&mut self, x: &Vector4) {
        self.a(&x.to_array());
    }
    pub(crate) fn q(&mut self, x: &Quaternion) {
        self.a(&x.to_array());
    }
    pub(crate) fn e(&mut self, x: &Euler) {
        self.a(&x.to_array());
        self.d(x.order as u8 as f64);
    }
    pub(crate) fn m3(&mut self, x: &Matrix3) {
        self.a(&x.elements);
    }
    pub(crate) fn m4(&mut self, x: &Matrix4) {
        self.a(&x.elements);
    }
    pub(crate) fn c(&mut self, x: &Color) {
        self.a(&x.to_array());
    }
    pub(crate) fn bx(&mut self, x: &Box3) {
        self.v3(&x.min);
        self.v3(&x.max);
    }
    pub(crate) fn sph(&mut self, x: &Sphere) {
        self.v3(&x.center);
        self.s(x.radius);
    }
    pub(crate) fn pl(&mut self, x: &Plane) {
        self.v3(&x.normal);
        self.s(x.constant);
    }
    pub(crate) fn ray(&mut self, x: &Ray) {
        self.v3(&x.origin);
        self.v3(&x.direction);
    }
    pub(crate) fn line(&mut self, x: &Line3) {
        self.v3(&x.start);
        self.v3(&x.end);
    }
    pub(crate) fn tri(&mut self, x: &Triangle) {
        self.v3(&x.a);
        self.v3(&x.b);
        self.v3(&x.c);
    }
    pub(crate) fn fr(&mut self, x: &Frustum) {
        for p in &x.planes {
            self.pl(p);
        }
    }
    pub(crate) fn sphl(&mut self, x: &Spherical) {
        self.a(&[x.radius, x.phi, x.theta]);
    }
    pub(crate) fn cyl(&mut self, x: &Cylindrical) {
        self.a(&[x.radius, x.theta, x.y]);
    }
    pub(crate) fn opt_v3(&mut self, x: Option<Vector3>) {
        match x {
            None => self.d(0.0),
            Some(v) => {
                self.d(1.0);
                self.v3(&v);
            }
        }
    }
}
