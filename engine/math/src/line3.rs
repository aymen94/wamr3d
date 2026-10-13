use crate::matrix4::Matrix4;
use crate::vector3::Vector3;
use crate::wide;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Line3 {
    pub start: Vector3,
    pub end: Vector3,
}

impl Line3 {
    pub const fn new(start: Vector3, end: Vector3) -> Self {
        Self { start, end }
    }

    pub fn set(&mut self, start: &Vector3, end: &Vector3) -> &mut Self {
        self.start = *start;
        self.end = *end;
        self
    }

    pub fn copy(&mut self, line: &Line3) -> &mut Self {
        *self = *line;
        self
    }

    pub fn get_center(&self) -> Vector3 {
        Vector3::from_wide(wide::scale(wide::add(self.start.wide(), self.end.wide()), 0.5))
    }

    pub fn delta(&self) -> Vector3 {
        let mut target = Vector3::default();
        target.sub_vectors(&self.end, &self.start);
        target
    }

    pub fn distance_sq(&self) -> f32 {
        self.start.distance_to_squared(&self.end)
    }

    pub fn distance(&self) -> f32 {
        self.start.distance_to(&self.end)
    }

    fn at_wide(&self, t: f64) -> wide::W3 {
        let start = self.start.wide();
        wide::add(wide::scale(wide::sub(self.end.wide(), start), t), start)
    }

    pub fn at(&self, t: f32) -> Vector3 {
        Vector3::from_wide(self.at_wide(t as f64))
    }

    fn closest_point_to_point_parameter_wide(&self, point: &Vector3, clamp_to_line: bool) -> f64 {
        let start = self.start.wide();
        let start_p = wide::sub(point.wide(), start);
        let start_end = wide::sub(self.end.wide(), start);

        let start_end2 = wide::dot(start_end, start_end);

        if start_end2 == 0.0 {
            return 0.0;
        }

        let start_end_start_p = wide::dot(start_end, start_p);

        let mut t = start_end_start_p / start_end2;

        if clamp_to_line {
            t = wide::clamp(t, 0.0, 1.0);
        }

        t
    }

    pub fn closest_point_to_point_parameter(&self, point: &Vector3, clamp_to_line: bool) -> f32 {
        self.closest_point_to_point_parameter_wide(point, clamp_to_line) as f32
    }

    pub fn closest_point_to_point(&self, point: &Vector3, clamp_to_line: bool) -> Vector3 {
        let t = self.closest_point_to_point_parameter_wide(point, clamp_to_line);

        Vector3::from_wide(self.at_wide(t))
    }

    pub fn distance_sq_to_line3(&self, line: &Line3, c1: Option<&mut Vector3>, c2: Option<&mut Vector3>) -> f32 {
        // from Real-Time Collision Detection by Christer Ericson, chapter 5.1.9

        // Computes closest points C1 and C2 of S1(s)=P1+s*(Q1-P1) and
        // S2(t)=P2+t*(Q2-P2), returning s and t. Function result is squared
        // distance between between S1(s) and S2(t)

        const EPSILON: f64 = 1e-8 * 1e-8; // must be squared since we compare squared length
        let (s, mut t);

        let p1 = self.start.wide();
        let p2 = line.start.wide();
        let q1 = self.end.wide();
        let q2 = line.end.wide();

        let d1 = wide::sub(q1, p1); // Direction vector of segment S1
        let d2 = wide::sub(q2, p2); // Direction vector of segment S2
        let r = wide::sub(p1, p2);

        let a = wide::dot(d1, d1); // Squared length of segment S1, always nonnegative
        let e = wide::dot(d2, d2); // Squared length of segment S2, always nonnegative
        let f = wide::dot(d2, r);

        // Check if either or both segments degenerate into points

        if a <= EPSILON && e <= EPSILON {
            // Both segments degenerate into points

            let difference = wide::sub(p1, p2);

            if let Some(c1) = c1 {
                c1.set_wide(difference);
            }
            if let Some(c2) = c2 {
                c2.set_wide(p2);
            }

            return wide::dot(difference, difference) as f32;
        }

        if a <= EPSILON {
            // First segment degenerates into a point

            s = 0.0;
            t = f / e; // s = 0 => t = (b*s + f) / e = f / e
            t = wide::clamp(t, 0.0, 1.0);
        } else {
            let c = wide::dot(d1, r);

            if e <= EPSILON {
                // Second segment degenerates into a point

                t = 0.0;
                s = wide::clamp(-c / a, 0.0, 1.0); // t = 0 => s = (b*t - c) / a = -c / a
            } else {
                // The general nondegenerate case starts here

                let b = wide::dot(d1, d2);
                let denom = a * e - b * b; // Always nonnegative

                // If segments not parallel, compute closest point on L1 to L2 and
                // clamp to segment S1. Else pick arbitrary s (here 0)

                let mut s_general = if denom != 0.0 { wide::clamp((b * f - c * e) / denom, 0.0, 1.0) } else { 0.0 };

                // Compute point on L2 closest to S1(s) using
                // t = Dot((P1 + D1*s) - P2,D2) / Dot(D2,D2) = (b*s + f) / e

                t = (b * s_general + f) / e;

                // If t in [0,1] done. Else clamp t, recompute s for the new value
                // of t using s = Dot((P2 + D2*t) - P1,D1) / Dot(D1,D1)= (t*b - c) / a
                // and clamp s to [0, 1]

                if t < 0.0 {
                    t = 0.0;
                    s_general = wide::clamp(-c / a, 0.0, 1.0);
                } else if t > 1.0 {
                    t = 1.0;
                    s_general = wide::clamp((b - c) / a, 0.0, 1.0);
                }

                s = s_general;
            }
        }

        let closest1 = wide::add_scaled(p1, d1, s);
        let closest2 = wide::add_scaled(p2, d2, t);

        if let Some(c1) = c1 {
            c1.set_wide(closest1);
        }
        if let Some(c2) = c2 {
            c2.set_wide(closest2);
        }

        wide::distance_sq(closest1, closest2) as f32
    }

    pub fn apply_matrix4(&mut self, matrix: &Matrix4) -> &mut Self {
        self.start.apply_matrix4(matrix);
        self.end.apply_matrix4(matrix);
        self
    }

    pub fn equals(&self, line: &Line3) -> bool {
        line.start.equals(&self.start) && line.end.equals(&self.end)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: f32, y: f32, z: f32) -> Vector3 {
        Vector3::new(x, y, z)
    }

    fn line() -> Line3 {
        Line3::new(v(0.0, 0.0, 0.0), v(4.0, 0.0, 0.0))
    }

    #[test]
    fn default_and_new() {
        assert_eq!(Line3::default(), Line3::new(v(0.0, 0.0, 0.0), v(0.0, 0.0, 0.0)));
    }

    #[test]
    fn set() {
        assert_eq!(*Line3::default().set(&v(0.0, 0.0, 0.0), &v(4.0, 0.0, 0.0)), line());
    }

    #[test]
    fn copy() {
        assert_eq!(*Line3::default().copy(&line()), line());
    }

    #[test]
    fn get_center() {
        assert_eq!(line().get_center(), v(2.0, 0.0, 0.0));
    }

    #[test]
    fn delta() {
        assert_eq!(line().delta(), v(4.0, 0.0, 0.0));
    }

    #[test]
    fn distance_sq() {
        assert_eq!(line().distance_sq(), 16.0);
    }

    #[test]
    fn distance() {
        assert_eq!(line().distance(), 4.0);
    }

    #[test]
    fn at() {
        assert_eq!(line().at(0.25), v(1.0, 0.0, 0.0));
        assert_eq!(line().at(2.0), v(8.0, 0.0, 0.0));
    }

    #[test]
    fn closest_point_to_point_parameter() {
        assert_eq!(line().closest_point_to_point_parameter(&v(1.0, 5.0, 0.0), true), 0.25);
        assert_eq!(line().closest_point_to_point_parameter(&v(8.0, 5.0, 0.0), true), 1.0);
        assert_eq!(line().closest_point_to_point_parameter(&v(8.0, 5.0, 0.0), false), 2.0);
        // a degenerate line always answers 0
        assert_eq!(Line3::default().closest_point_to_point_parameter(&v(1.0, 1.0, 1.0), false), 0.0);
    }

    #[test]
    fn closest_point_to_point() {
        assert_eq!(line().closest_point_to_point(&v(1.0, 5.0, 0.0), true), v(1.0, 0.0, 0.0));
        assert_eq!(line().closest_point_to_point(&v(-3.0, 5.0, 0.0), true), v(0.0, 0.0, 0.0));
        assert_eq!(line().closest_point_to_point(&v(-3.0, 5.0, 0.0), false), v(-3.0, 0.0, 0.0));
    }

    #[test]
    fn distance_sq_to_line3() {
        let (mut c1, mut c2) = (Vector3::default(), Vector3::default());

        // crossing segments, 3 apart in Z
        let other = Line3::new(v(2.0, -1.0, 3.0), v(2.0, 1.0, 3.0));
        assert_eq!(line().distance_sq_to_line3(&other, Some(&mut c1), Some(&mut c2)), 9.0);
        assert_eq!((c1, c2), (v(2.0, 0.0, 0.0), v(2.0, 0.0, 3.0)));

        // parallel segments
        let parallel = Line3::new(v(0.0, 2.0, 0.0), v(4.0, 2.0, 0.0));
        assert_eq!(line().distance_sq_to_line3(&parallel, None, None), 4.0);

        // end to end, beyond both parameter ranges
        let beyond = Line3::new(v(6.0, 0.0, 0.0), v(9.0, 0.0, 0.0));
        assert_eq!(line().distance_sq_to_line3(&beyond, None, None), 4.0);

        // point against segment, and point against point
        let point = Line3::new(v(1.0, 2.0, 0.0), v(1.0, 2.0, 0.0));
        assert_eq!(point.distance_sq_to_line3(&line(), None, None), 4.0);
        assert_eq!(line().distance_sq_to_line3(&point, None, None), 4.0);
        let origin = Line3::default();
        assert_eq!(point.distance_sq_to_line3(&origin, Some(&mut c1), Some(&mut c2)), 5.0);
        assert_eq!((c1, c2), (v(1.0, 2.0, 0.0), v(0.0, 0.0, 0.0)));
    }

    #[test]
    fn apply_matrix4() {
        let mut m = Matrix4::default();
        m.make_translation(1.0, 2.0, 3.0);
        assert_eq!(*line().apply_matrix4(&m), Line3::new(v(1.0, 2.0, 3.0), v(5.0, 2.0, 3.0)));
    }

    #[test]
    fn equals() {
        assert!(line().equals(&line()));
        assert!(!line().equals(&Line3::default()));
    }
}
