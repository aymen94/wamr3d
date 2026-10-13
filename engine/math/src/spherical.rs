use crate::vector3::Vector3;
use crate::wide;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spherical {
    pub radius: f32,
    pub phi: f32,
    pub theta: f32,
}

impl Default for Spherical {
    fn default() -> Self {
        Self::new(1.0, 0.0, 0.0)
    }
}

impl Spherical {
    pub const fn new(radius: f32, phi: f32, theta: f32) -> Self {
        Self { radius, phi, theta }
    }

    pub fn set(&mut self, radius: f32, phi: f32, theta: f32) -> &mut Self {
        *self = Self::new(radius, phi, theta);
        self
    }

    pub fn copy(&mut self, other: &Spherical) -> &mut Self {
        *self = *other;
        self
    }

    pub fn make_safe(&mut self) -> &mut Self {
        const EPS: f64 = 0.000001;
        self.phi = wide::clamp(self.phi as f64, EPS, core::f64::consts::PI - EPS) as f32;
        self
    }

    pub fn set_from_vector3(&mut self, v: &Vector3) -> &mut Self {
        self.set_from_cartesian_coords(v.x, v.y, v.z)
    }

    pub fn set_from_cartesian_coords(&mut self, x: f32, y: f32, z: f32) -> &mut Self {
        let (x, y, z) = (x as f64, y as f64, z as f64);
        let radius = (x * x + y * y + z * z).sqrt();

        self.radius = radius as f32;

        if radius == 0.0 {
            self.theta = 0.0;
            self.phi = 0.0;
        } else {
            self.theta = x.atan2(z) as f32;
            self.phi = wide::clamp(y / radius, -1.0, 1.0).acos() as f32;
        }

        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close;
    use core::f32::consts::{FRAC_PI_2, PI};

    #[test]
    fn new_and_default() {
        assert_eq!(Spherical::default(), Spherical::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Spherical::default().set(2.0, 0.5, 0.25), Spherical::new(2.0, 0.5, 0.25));
    }

    #[test]
    fn copy() {
        let s = Spherical::new(2.0, 0.5, 0.25);
        assert_eq!(*Spherical::default().copy(&s), s);
    }

    #[test]
    fn make_safe() {
        assert_close(Spherical::new(1.0, -1.0, 0.0).make_safe().phi, 0.000001);
        assert_close(Spherical::new(1.0, 4.0, 0.0).make_safe().phi, PI - 0.000001);
        assert_eq!(Spherical::new(1.0, 1.0, 0.0).make_safe().phi, 1.0);
    }

    #[test]
    fn set_from_vector3() {
        let mut s = Spherical::default();
        s.set_from_vector3(&Vector3::new(0.0, 2.0, 0.0));
        assert_eq!(s, Spherical::new(2.0, 0.0, 0.0));
    }

    #[test]
    fn set_from_cartesian_coords() {
        let mut s = Spherical::default();
        s.set_from_cartesian_coords(3.0, 0.0, 0.0);
        assert_eq!(s.radius, 3.0);
        assert_close(s.phi, FRAC_PI_2);
        assert_close(s.theta, FRAC_PI_2);
        // the origin has no direction
        s.set_from_cartesian_coords(0.0, 0.0, 0.0);
        assert_eq!(s, Spherical::new(0.0, 0.0, 0.0));
    }
}
