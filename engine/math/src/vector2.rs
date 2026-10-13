use crate::matrix3::Matrix3;
use crate::wide;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vector2 {
    pub x: f32,
    pub y: f32,
}

vector_common!(Vector2, "Vector2", 2, (0, x), (1, y));

impl Vector2 {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn width(&self) -> f32 {
        self.x
    }

    pub fn set_width(&mut self, value: f32) {
        self.x = value;
    }

    pub fn height(&self) -> f32 {
        self.y
    }

    pub fn set_height(&mut self, value: f32) {
        self.y = value;
    }

    pub fn set(&mut self, x: f32, y: f32) -> &mut Self {
        self.x = x;
        self.y = y;
        self
    }

    pub fn set_x(&mut self, x: f32) -> &mut Self {
        self.x = x;
        self
    }

    pub fn set_y(&mut self, y: f32) -> &mut Self {
        self.y = y;
        self
    }

    pub fn copy(&mut self, v: &Vector2) -> &mut Self {
        *self = *v;
        self
    }

    pub fn apply_matrix3(&mut self, m: &Matrix3) -> &mut Self {
        let [x, y] = self.wide();
        let e = m.wide();

        self.set_wide([e[0] * x + e[3] * y + e[6], e[1] * x + e[4] * y + e[7]])
    }

    pub fn cross(&self, v: &Vector2) -> f32 {
        let ([x, y], [vx, vy]) = (self.wide(), v.wide());
        (x * vy - y * vx) as f32
    }

    pub fn angle(&self) -> f32 {
        let [x, y] = self.wide();
        ((-y).atan2(-x) + core::f64::consts::PI) as f32
    }

    pub fn angle_to(&self, v: &Vector2) -> f32 {
        let denominator = (self.length_sq_wide() * v.length_sq_wide()).sqrt();

        if denominator == 0.0 {
            return core::f32::consts::FRAC_PI_2;
        }

        let theta = self.dot_wide(v) / denominator;

        // clamp, to handle numerical problems
        wide::clamp(theta, -1.0, 1.0).acos() as f32
    }

    #[inline]
    fn distance_to_squared_w(&self, v: &Vector2) -> f64 {
        let ([x, y], [vx, vy]) = (self.wide(), v.wide());
        let (dx, dy) = (x - vx, y - vy);
        dx * dx + dy * dy
    }

    pub fn distance_to(&self, v: &Vector2) -> f32 {
        self.distance_to_squared_w(v).sqrt() as f32
    }

    pub fn distance_to_squared(&self, v: &Vector2) -> f32 {
        self.distance_to_squared_w(v) as f32
    }

    pub fn manhattan_distance_to(&self, v: &Vector2) -> f32 {
        let ([x, y], [vx, vy]) = (self.wide(), v.wide());
        ((x - vx).abs() + (y - vy).abs()) as f32
    }

    pub fn rotate_around(&mut self, center: &Vector2, angle: f32) -> &mut Self {
        let (c, s) = ((angle as f64).cos(), (angle as f64).sin());
        let [cx, cy] = center.wide();

        let x = self.x as f64 - cx;
        let y = self.y as f64 - cy;

        self.set_wide([x * c - y * s + cx, x * s + y * c + cy])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close;

    vector_common_tests!(Vector2, 2);

    #[test]
    fn new_and_default() {
        assert_eq!(Vector2::new(1.0, 2.0), Vector2 { x: 1.0, y: 2.0 });
        assert_eq!(Vector2::default(), Vector2::new(0.0, 0.0));
    }

    #[test]
    fn width_and_height() {
        let mut v = Vector2::new(1.0, 2.0);
        assert_eq!((v.width(), v.height()), (1.0, 2.0));
        v.set_width(3.0);
        v.set_height(4.0);
        assert_eq!(v, Vector2::new(3.0, 4.0));
    }

    #[test]
    fn set() {
        assert_eq!(*Vector2::default().set(1.0, 2.0), Vector2::new(1.0, 2.0));
    }

    #[test]
    fn set_x_and_set_y() {
        assert_eq!(*Vector2::default().set_x(1.0).set_y(2.0), Vector2::new(1.0, 2.0));
    }

    #[test]
    fn copy() {
        assert_eq!(*Vector2::default().copy(&Vector2::new(5.0, 6.0)), Vector2::new(5.0, 6.0));
    }

    #[test]
    fn apply_matrix3() {
        let mut m = Matrix3::default();
        m.make_translation(10.0, 20.0);
        assert_eq!(*Vector2::new(1.0, 2.0).apply_matrix3(&m), Vector2::new(11.0, 22.0));
    }

    #[test]
    fn cross() {
        assert_eq!(Vector2::new(1.0, 0.0).cross(&Vector2::new(0.0, 1.0)), 1.0);
        assert_eq!(Vector2::new(2.0, 3.0).cross(&Vector2::new(4.0, 6.0)), 0.0);
    }

    #[test]
    fn angle() {
        assert_close(Vector2::new(1.0, 0.0).angle(), 0.0);
        assert_close(Vector2::new(0.0, 1.0).angle(), core::f32::consts::FRAC_PI_2);
        assert_close(Vector2::new(-1.0, 0.0).angle(), core::f32::consts::PI);
    }

    #[test]
    fn angle_to() {
        assert_close(Vector2::new(1.0, 0.0).angle_to(&Vector2::new(0.0, 2.0)), core::f32::consts::FRAC_PI_2);
        // a zero vector gives PI / 2
        assert_close(Vector2::new(1.0, 0.0).angle_to(&Vector2::default()), core::f32::consts::FRAC_PI_2);
    }

    #[test]
    fn distance_to() {
        assert_eq!(Vector2::new(1.0, 1.0).distance_to(&Vector2::new(4.0, 5.0)), 5.0);
    }

    #[test]
    fn distance_to_squared() {
        assert_eq!(Vector2::new(1.0, 1.0).distance_to_squared(&Vector2::new(4.0, 5.0)), 25.0);
    }

    #[test]
    fn manhattan_distance_to() {
        assert_eq!(Vector2::new(1.0, 1.0).manhattan_distance_to(&Vector2::new(4.0, -5.0)), 9.0);
    }

    #[test]
    fn rotate_around() {
        let mut v = Vector2::new(2.0, 1.0);
        v.rotate_around(&Vector2::new(1.0, 1.0), core::f32::consts::FRAC_PI_2);
        assert_close(v.x, 1.0);
        assert_close(v.y, 2.0);
    }
}
