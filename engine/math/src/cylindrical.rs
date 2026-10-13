use crate::vector3::Vector3;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cylindrical {
    pub radius: f32,
    pub theta: f32,
    pub y: f32,
}

impl Default for Cylindrical {
    fn default() -> Self {
        Self::new(1.0, 0.0, 0.0)
    }
}

impl Cylindrical {
    pub const fn new(radius: f32, theta: f32, y: f32) -> Self {
        Self { radius, theta, y }
    }

    pub fn set(&mut self, radius: f32, theta: f32, y: f32) -> &mut Self {
        *self = Self::new(radius, theta, y);
        self
    }

    pub fn copy(&mut self, other: &Cylindrical) -> &mut Self {
        *self = *other;
        self
    }

    pub fn set_from_vector3(&mut self, v: &Vector3) -> &mut Self {
        self.set_from_cartesian_coords(v.x, v.y, v.z)
    }

    pub fn set_from_cartesian_coords(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        let (xw, zw) = (x as f64, z as f64);

        self.radius = (xw * xw + zw * zw).sqrt() as f32;
        self.theta = xw.atan2(zw) as f32;
        self.y = y;

        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close;

    #[test]
    fn new_and_default() {
        assert_eq!(Cylindrical::default(), Cylindrical::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Cylindrical::default().set(2.0, 0.5, 3.0), Cylindrical::new(2.0, 0.5, 3.0));
    }

    #[test]
    fn copy() {
        let c = Cylindrical::new(2.0, 0.5, 3.0);
        assert_eq!(*Cylindrical::default().copy(&c), c);
    }

    #[test]
    fn set_from_vector3() {
        let mut c = Cylindrical::default();
        c.set_from_vector3(&Vector3::new(0.0, 7.0, 2.0));
        assert_eq!(c, Cylindrical::new(2.0, 0.0, 7.0));
    }

    #[test]
    fn set_from_cartesian_coords() {
        let mut c = Cylindrical::default();
        c.set_from_cartesian_coords(3.0, -1.0, 4.0);
        assert_eq!((c.radius, c.y), (5.0, -1.0));
        assert_close(c.theta, (3.0f32).atan2(4.0));
    }
}
