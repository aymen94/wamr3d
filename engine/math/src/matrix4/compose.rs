//! Composition, decomposition and projection matrices.

use super::*;

impl Matrix4 {
    pub fn compose(&mut self, position: &Vector3, quaternion: &Quaternion, scale: &Vector3) -> &mut Self {
        self.set_wide(wide::m4_compose(position.wide(), quaternion.wide(), scale.wide()))
    }

    pub fn decompose(&self, position: &mut Vector3, quaternion: &mut Quaternion, scale: &mut Vector3) -> &Self {
        let te = self.wide();

        position.set(self.elements[12], self.elements[13], self.elements[14]);

        let det = wide::m4_determinant_affine(&te);

        if det == 0.0 {
            scale.set(1.0, 1.0, 1.0);
            quaternion.identity();

            return self;
        }

        let mut sx = wide::length([te[0], te[1], te[2]]);
        let sy = wide::length([te[4], te[5], te[6]]);
        let sz = wide::length([te[8], te[9], te[10]]);

        // if determinant is negative, we need to invert one scale
        if det < 0.0 {
            sx = -sx;
        }

        // scale the rotation part
        let mut m1 = te;

        let inv_sx = 1.0 / sx;
        let inv_sy = 1.0 / sy;
        let inv_sz = 1.0 / sz;

        m1[0] *= inv_sx;
        m1[1] *= inv_sx;
        m1[2] *= inv_sx;

        m1[4] *= inv_sy;
        m1[5] *= inv_sy;
        m1[6] *= inv_sy;

        m1[8] *= inv_sz;
        m1[9] *= inv_sz;
        m1[10] *= inv_sz;

        quaternion.set_wide(wide::quat_from_rotation(&m1));
        scale.set_wide([sx, sy, sz]);

        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn make_perspective(
        &mut self,
        left: f32,
        right: f32,
        top: f32,
        bottom: f32,
        near: f32,
        far: f32,
        coordinate_system: CoordinateSystem,
        reversed_depth: bool,
    ) -> &mut Self {
        let (left, right, top, bottom, near, far) =
            (left as f64, right as f64, top as f64, bottom as f64, near as f64, far as f64);

        let x = 2.0 * near / (right - left);
        let y = 2.0 * near / (top - bottom);

        let a = (right + left) / (right - left);
        let b = (top + bottom) / (top - bottom);

        let (c, d);

        if reversed_depth {
            c = near / (far - near);
            d = (far * near) / (far - near);
        } else {
            match coordinate_system {
                CoordinateSystem::WebGL => {
                    c = -(far + near) / (far - near);
                    d = (-2.0 * far * near) / (far - near);
                }
                CoordinateSystem::WebGPU => {
                    c = -far / (far - near);
                    d = (-far * near) / (far - near);
                }
            }
        }

        self.set_wide([
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            a, b, c, -1.0,
            0.0, 0.0, d, 0.0,
        ])
    }

    #[allow(clippy::too_many_arguments)]
    pub fn make_orthographic(
        &mut self,
        left: f32,
        right: f32,
        top: f32,
        bottom: f32,
        near: f32,
        far: f32,
        coordinate_system: CoordinateSystem,
        reversed_depth: bool,
    ) -> &mut Self {
        let (left, right, top, bottom, near, far) =
            (left as f64, right as f64, top as f64, bottom as f64, near as f64, far as f64);

        let x = 2.0 / (right - left);
        let y = 2.0 / (top - bottom);

        let a = -(right + left) / (right - left);
        let b = -(top + bottom) / (top - bottom);

        let (c, d);

        if reversed_depth {
            c = 1.0 / (far - near);
            d = far / (far - near);
        } else {
            match coordinate_system {
                CoordinateSystem::WebGL => {
                    c = -2.0 / (far - near);
                    d = -(far + near) / (far - near);
                }
                CoordinateSystem::WebGPU => {
                    c = -1.0 / (far - near);
                    d = -near / (far - near);
                }
            }
        }

        self.set_wide([
            x, 0.0, 0.0, 0.0,
            0.0, y, 0.0, 0.0,
            0.0, 0.0, c, 0.0,
            a, b, d, 1.0,
        ])
    }
}
