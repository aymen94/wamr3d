use crate::matrix4::Matrix4;
use crate::quaternion::Quaternion;
use crate::vector3::Vector3;
use crate::wide;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum EulerOrder {
    #[default]
    XYZ = 0,
    YXZ = 1,
    ZXY = 2,
    ZYX = 3,
    YZX = 4,
    XZY = 5,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Euler {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub order: EulerOrder,
}

impl Euler {
    pub const DEFAULT_ORDER: EulerOrder = EulerOrder::XYZ;

    pub const fn new(x: f32, y: f32, z: f32, order: EulerOrder) -> Self {
        Self { x, y, z, order }
    }

    fn set_wide(&mut self, a: wide::W3, order: EulerOrder) -> &mut Self {
        self.x = a[0] as f32;
        self.y = a[1] as f32;
        self.z = a[2] as f32;
        self.order = order;
        self
    }

    pub fn set(&mut self, x: f32, y: f32, z: f32, order: EulerOrder) -> &mut Self {
        *self = Self::new(x, y, z, order);
        self
    }

    pub fn copy(&mut self, euler: &Euler) -> &mut Self {
        *self = *euler;
        self
    }

    pub fn set_from_rotation_matrix(&mut self, m: &Matrix4, order: EulerOrder) -> &mut Self {
        self.set_wide(wide::euler_from_rotation(&m.wide(), order), order)
    }

    pub fn set_from_quaternion(&mut self, q: &Quaternion, order: EulerOrder) -> &mut Self {
        let matrix = wide::m4_rotation_from_quaternion(q.wide());
        self.set_wide(wide::euler_from_rotation(&matrix, order), order)
    }

    pub fn set_from_vector3(&mut self, v: &Vector3, order: EulerOrder) -> &mut Self {
        self.set(v.x, v.y, v.z, order)
    }

    pub fn reorder(&mut self, new_order: EulerOrder) -> &mut Self {
        let q = wide::quat_from_euler(self.x as f64, self.y as f64, self.z as f64, self.order);
        let matrix = wide::m4_rotation_from_quaternion(q);
        self.set_wide(wide::euler_from_rotation(&matrix, new_order), new_order)
    }

    pub fn equals(&self, euler: &Euler) -> bool {
        euler.x == self.x && euler.y == self.y && euler.z == self.z && euler.order == self.order
    }

    pub fn from_array(&mut self, array: &[f32; 3]) -> &mut Self {
        self.x = array[0];
        self.y = array[1];
        self.z = array[2];
        self
    }

    pub fn to_array(&self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close_slice;
    use core::f32::consts::FRAC_PI_2;

    const ORDERS: [EulerOrder; 6] =
        [EulerOrder::XYZ, EulerOrder::YXZ, EulerOrder::ZXY, EulerOrder::ZYX, EulerOrder::YZX, EulerOrder::XZY];

    #[test]
    fn default_order_is_xyz() {
        assert_eq!(Euler::DEFAULT_ORDER, EulerOrder::XYZ);
        assert_eq!(EulerOrder::default(), EulerOrder::XYZ);
        assert_eq!(Euler::default(), Euler::new(0.0, 0.0, 0.0, EulerOrder::XYZ));
    }

    #[test]
    fn layout_is_three_f32_then_order() {
        assert_eq!(core::mem::size_of::<Euler>(), 16);
        assert_eq!(core::mem::size_of::<EulerOrder>(), 1);
    }

    #[test]
    fn set() {
        assert_eq!(*Euler::default().set(1.0, 2.0, 3.0, EulerOrder::ZYX), Euler::new(1.0, 2.0, 3.0, EulerOrder::ZYX));
    }

    #[test]
    fn copy() {
        let e = Euler::new(1.0, 2.0, 3.0, EulerOrder::YZX);
        assert_eq!(*Euler::default().copy(&e), e);
    }

    #[test]
    fn set_from_rotation_matrix_round_trips_every_order() {
        for order in ORDERS {
            let e = Euler::new(0.3, -0.5, 0.7, order);
            let mut m = Matrix4::default();
            m.make_rotation_from_euler(&e);
            let mut back = Euler::default();
            back.set_from_rotation_matrix(&m, order);
            assert_close_slice(&back.to_array(), &e.to_array());
            assert_eq!(back.order, order);
        }
    }

    #[test]
    fn set_from_rotation_matrix_gimbal_lock() {
        // XYZ with y = 90 degrees: z is forced to 0 and x absorbs the rest
        let mut m = Matrix4::default();
        m.make_rotation_from_euler(&Euler::new(0.25, FRAC_PI_2, 0.0, EulerOrder::XYZ));
        let mut e = Euler::default();
        e.set_from_rotation_matrix(&m, EulerOrder::XYZ);
        assert_close_slice(&e.to_array(), &[0.25, FRAC_PI_2, 0.0]);
    }

    #[test]
    fn set_from_quaternion() {
        for order in ORDERS {
            let e = Euler::new(-0.4, 0.2, 0.9, order);
            let mut q = Quaternion::default();
            q.set_from_euler(&e);
            let mut back = Euler::default();
            back.set_from_quaternion(&q, order);
            assert_close_slice(&back.to_array(), &e.to_array());
        }
    }

    #[test]
    fn set_from_vector3() {
        let mut e = Euler::default();
        e.set_from_vector3(&Vector3::new(1.0, 2.0, 3.0), EulerOrder::XZY);
        assert_eq!(e, Euler::new(1.0, 2.0, 3.0, EulerOrder::XZY));
    }

    #[test]
    fn reorder_keeps_the_rotation() {
        let e = Euler::new(0.3, -0.5, 0.7, EulerOrder::XYZ);
        let mut r = e;
        r.reorder(EulerOrder::ZYX);
        assert_eq!(r.order, EulerOrder::ZYX);
        let (mut a, mut b) = (Matrix4::default(), Matrix4::default());
        a.make_rotation_from_euler(&e);
        b.make_rotation_from_euler(&r);
        assert_close_slice(&a.elements, &b.elements);
    }

    #[test]
    fn equals() {
        let e = Euler::new(1.0, 2.0, 3.0, EulerOrder::XYZ);
        assert!(e.equals(&e));
        assert!(!e.equals(&Euler::new(1.0, 2.0, 3.0, EulerOrder::YXZ)));
    }

    #[test]
    fn from_array_and_to_array() {
        let mut e = Euler::new(0.0, 0.0, 0.0, EulerOrder::YZX);
        e.from_array(&[1.0, 2.0, 3.0]);
        assert_eq!(e.to_array(), [1.0, 2.0, 3.0]);
        assert_eq!(e.order, EulerOrder::YZX);
    }
}
