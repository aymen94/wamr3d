use wamr_math::{CoordinateSystem, Matrix4, Quaternion, Vector2, Vector3};

/// How a camera maps view space to clip space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Projection {
    Perspective {
        /// Vertical field of view in degrees.
        fov: f32,
        zoom: f32,
        near: f32,
        far: f32,
        /// Object distance for stereoscopy and depth-of-field effects.
        focus: f32,
        aspect: f32,
        /// Film size in millimetres along the larger axis.
        film_gauge: f32,
        /// Horizontal off-centre offset, in the same unit as `film_gauge`.
        film_offset: f32,
    },
    Orthographic {
        left: f32,
        right: f32,
        top: f32,
        bottom: f32,
        near: f32,
        far: f32,
        zoom: f32,
    },
}

/// A sub-rectangle of a larger virtual viewport, for tiled or multi-monitor rendering.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewOffset {
    pub enabled: bool,
    pub full_width: f32,
    pub full_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub width: f32,
    pub height: f32,
}

/// Camera component. The object's `Transform` places the camera; this holds the
/// projection and the matrices derived from both.
///
/// Changing `projection`, `view`, `coordinate_system` or `reversed_depth` does not
/// take effect until [`Camera::update_projection_matrix`] is called.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub projection: Projection,
    pub view: Option<ViewOffset>,
    /// The view matrix. Kept up to date by the world-matrix updates of `World`.
    pub matrix_world_inverse: Matrix4,
    pub projection_matrix: Matrix4,
    pub projection_matrix_inverse: Matrix4,
    pub coordinate_system: CoordinateSystem,
    pub reversed_depth: bool,
}

const DEG2RAD: f64 = core::f64::consts::PI / 180.0;
const RAD2DEG: f64 = 180.0 / core::f64::consts::PI;

impl Camera {
    fn new(projection: Projection) -> Self {
        let mut camera = Self {
            projection,
            view: None,
            matrix_world_inverse: Matrix4::default(),
            projection_matrix: Matrix4::default(),
            projection_matrix_inverse: Matrix4::default(),
            coordinate_system: CoordinateSystem::WebGL,
            reversed_depth: false,
        };
        camera.update_projection_matrix();
        camera
    }

    /// Usual defaults: `fov = 50`, `aspect = 1`, `near = 0.1`, `far = 2000`.
    pub fn perspective(fov: f32, aspect: f32, near: f32, far: f32) -> Self {
        Self::new(Projection::Perspective { fov, zoom: 1.0, near, far, focus: 10.0, aspect, film_gauge: 35.0, film_offset: 0.0 })
    }

    /// Usual defaults: `-1, 1, 1, -1`, `near = 0.1`, `far = 2000`.
    pub fn orthographic(left: f32, right: f32, top: f32, bottom: f32, near: f32, far: f32) -> Self {
        Self::new(Projection::Orthographic { left, right, top, bottom, near, far, zoom: 1.0 })
    }

    /// Film width in millimetres. In portrait format the film is not completely covered.
    /// Zero for an orthographic camera.
    pub fn get_film_width(&self) -> f32 {
        match self.projection {
            Projection::Perspective { film_gauge, aspect, .. } => film_gauge * aspect.min(1.0),
            Projection::Orthographic { .. } => 0.0,
        }
    }

    /// Film height in millimetres. In landscape format the film is not completely
    /// covered. Zero for an orthographic camera.
    pub fn get_film_height(&self) -> f32 {
        match self.projection {
            Projection::Perspective { film_gauge, aspect, .. } => film_gauge / aspect.max(1.0),
            Projection::Orthographic { .. } => 0.0,
        }
    }

    /// Sets the field of view from a focal length in millimetres. No effect on an
    /// orthographic camera.
    pub fn set_focal_length(&mut self, focal_length: f32) {
        let film_height = self.get_film_height() as f64;
        if let Projection::Perspective { fov, .. } = &mut self.projection {
            let v_extent_slope = 0.5 * film_height / focal_length as f64;
            *fov = (RAD2DEG * 2.0 * v_extent_slope.atan()) as f32;
            self.update_projection_matrix();
        }
    }

    /// The focal length in millimetres for the current field of view. Zero for an
    /// orthographic camera.
    pub fn get_focal_length(&self) -> f32 {
        match self.projection {
            Projection::Perspective { fov, .. } => {
                let v_extent_slope = (DEG2RAD * 0.5 * fov as f64).tan();
                (0.5 * self.get_film_height() as f64 / v_extent_slope) as f32
            }
            Projection::Orthographic { .. } => 0.0,
        }
    }

    /// The vertical field of view in degrees after zoom. Zero for an orthographic camera.
    pub fn get_effective_fov(&self) -> f32 {
        match self.projection {
            Projection::Perspective { fov, zoom, .. } => {
                (RAD2DEG * 2.0 * ((DEG2RAD * 0.5 * fov as f64).tan() / zoom as f64).atan()) as f32
            }
            Projection::Orthographic { .. } => 0.0,
        }
    }

    /// The corners (min, max) of the visible rectangle at `distance` in front of the
    /// camera, in view space. Uses the current projection matrix.
    pub fn get_view_bounds(&self, distance: f32) -> (Vector2, Vector2) {
        let corner = |x: f32, y: f32| {
            let mut v = Vector3::new(x, y, 0.5);
            v.apply_matrix4(&self.projection_matrix_inverse);
            let scale = -(distance as f64) / v.z as f64;
            Vector2::new((v.x as f64 * scale) as f32, (v.y as f64 * scale) as f32)
        };
        (corner(-1.0, -1.0), corner(1.0, 1.0))
    }

    /// Width and height of the visible rectangle at `distance` in front of the camera.
    pub fn get_view_size(&self, distance: f32) -> Vector2 {
        let (min, max) = self.get_view_bounds(distance);
        let mut size = Vector2::default();
        size.sub_vectors(&max, &min);
        size
    }

    /// Restricts the camera to a sub-rectangle of a `full_width` x `full_height`
    /// viewport. For a perspective camera this also sets the aspect ratio to that of
    /// the full viewport.
    pub fn set_view_offset(&mut self, full_width: f32, full_height: f32, x: f32, y: f32, width: f32, height: f32) {
        if let Projection::Perspective { aspect, .. } = &mut self.projection {
            *aspect = (full_width as f64 / full_height as f64) as f32;
        }
        self.view = Some(ViewOffset { enabled: true, full_width, full_height, offset_x: x, offset_y: y, width, height });
        self.update_projection_matrix();
    }

    pub fn clear_view_offset(&mut self) {
        if let Some(view) = &mut self.view {
            view.enabled = false;
        }
        self.update_projection_matrix();
    }

    /// Recomputes the projection matrix and its inverse from the projection settings.
    pub fn update_projection_matrix(&mut self) {
        let view = self.view.filter(|v| v.enabled);

        match self.projection {
            Projection::Perspective { fov, zoom, near, far, aspect, film_offset, .. } => {
                let near_w = near as f64;
                let mut top = near_w * (DEG2RAD * 0.5 * fov as f64).tan() / zoom as f64;
                let mut height = 2.0 * top;
                let mut width = aspect as f64 * height;
                let mut left = -0.5 * width;

                if let Some(v) = view {
                    left += v.offset_x as f64 * width / v.full_width as f64;
                    top -= v.offset_y as f64 * height / v.full_height as f64;
                    width *= v.width as f64 / v.full_width as f64;
                    height *= v.height as f64 / v.full_height as f64;
                }

                if film_offset != 0.0 {
                    left += near_w * film_offset as f64 / self.get_film_width() as f64;
                }

                self.projection_matrix.make_perspective(
                    left as f32,
                    (left + width) as f32,
                    top as f32,
                    (top - height) as f32,
                    near,
                    far,
                    self.coordinate_system,
                    self.reversed_depth,
                );
            }
            Projection::Orthographic { left, right, top, bottom, near, far, zoom } => {
                let (l, r, t, b, zoom) = (left as f64, right as f64, top as f64, bottom as f64, zoom as f64);
                let dx = (r - l) / (2.0 * zoom);
                let dy = (t - b) / (2.0 * zoom);
                let cx = (r + l) / 2.0;
                let cy = (t + b) / 2.0;

                let (mut left, mut right, mut top, mut bottom) = (cx - dx, cx + dx, cy + dy, cy - dy);

                if let Some(v) = view {
                    let scale_w = (r - l) / v.full_width as f64 / zoom;
                    let scale_h = (t - b) / v.full_height as f64 / zoom;

                    left += scale_w * v.offset_x as f64;
                    right = left + scale_w * v.width as f64;
                    top -= scale_h * v.offset_y as f64;
                    bottom = top - scale_h * v.height as f64;
                }

                self.projection_matrix.make_orthographic(
                    left as f32,
                    right as f32,
                    top as f32,
                    bottom as f32,
                    near,
                    far,
                    self.coordinate_system,
                    self.reversed_depth,
                );
            }
        }

        self.projection_matrix_inverse = self.projection_matrix;
        self.projection_matrix_inverse.invert();
    }

    /// Recomputes the view matrix from the camera's world matrix. Scale is left out of
    /// the view matrix, so a scaled camera (or parent) does not scale the picture.
    pub fn update_view(&mut self, matrix_world: &Matrix4) {
        let (mut position, mut quaternion, mut scale) = (Vector3::default(), Quaternion::default(), Vector3::default());
        matrix_world.decompose(&mut position, &mut quaternion, &mut scale);

        if scale.x == 1.0 && scale.y == 1.0 && scale.z == 1.0 {
            self.matrix_world_inverse = *matrix_world;
        } else {
            self.matrix_world_inverse.compose(&position, &quaternion, &Vector3::new(1.0, 1.0, 1.0));
        }
        self.matrix_world_inverse.invert();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) {
        assert!((a - b).abs() <= 1e-5 * b.abs().max(1.0), "{a} vs {b}");
    }

    #[test]
    fn perspective_projects_the_frustum_to_the_clip_cube() {
        let camera = Camera::perspective(90.0, 2.0, 1.0, 100.0);
        // top right corner of the near plane: x = aspect * tan(45 deg), y = tan(45 deg)
        let mut corner = Vector3::new(2.0, 1.0, -1.0);
        corner.apply_matrix4(&camera.projection_matrix);
        close(corner.x, 1.0);
        close(corner.y, 1.0);
        close(corner.z, -1.0);
        let mut back = corner;
        back.apply_matrix4(&camera.projection_matrix_inverse);
        close(back.x, 2.0);
    }

    #[test]
    fn coordinate_system_changes_the_depth_range_after_an_update() {
        let mut camera = Camera::perspective(50.0, 1.0, 0.5, 10.0);
        camera.coordinate_system = CoordinateSystem::WebGPU;
        camera.update_projection_matrix();
        let mut near = Vector3::new(0.0, 0.0, -0.5);
        near.apply_matrix4(&camera.projection_matrix);
        close(near.z, 0.0);
    }

    #[test]
    fn orthographic_maps_its_box_and_zoom_narrows_it() {
        let mut camera = Camera::orthographic(-4.0, 4.0, 2.0, -2.0, 1.0, 11.0);
        let mut p = Vector3::new(4.0, 2.0, -1.0);
        p.apply_matrix4(&camera.projection_matrix);
        close(p.x, 1.0);
        close(p.y, 1.0);

        if let Projection::Orthographic { zoom, .. } = &mut camera.projection {
            *zoom = 2.0;
        }
        camera.update_projection_matrix();
        let mut q = Vector3::new(2.0, 1.0, -1.0);
        q.apply_matrix4(&camera.projection_matrix);
        close(q.x, 1.0);
        close(q.y, 1.0);
    }

    #[test]
    fn film_and_focal_length() {
        let mut camera = Camera::perspective(50.0, 2.0, 0.1, 100.0);
        close(camera.get_film_width(), 35.0);
        close(camera.get_film_height(), 17.5);
        camera.set_focal_length(35.0);
        close(camera.get_focal_length(), 35.0);
        assert_eq!(Camera::orthographic(-1.0, 1.0, 1.0, -1.0, 0.1, 10.0).get_film_width(), 0.0);
    }

    #[test]
    fn effective_fov_follows_zoom() {
        let mut camera = Camera::perspective(90.0, 1.0, 0.1, 100.0);
        close(camera.get_effective_fov(), 90.0);
        if let Projection::Perspective { zoom, .. } = &mut camera.projection {
            *zoom = 2.0;
        }
        close(camera.get_effective_fov(), 2.0 * 0.5f32.atan().to_degrees());
    }

    #[test]
    fn view_bounds_and_size() {
        let camera = Camera::perspective(90.0, 2.0, 0.1, 100.0);
        let (min, max) = camera.get_view_bounds(5.0);
        close(min.x, -10.0);
        close(max.y, 5.0);
        let size = camera.get_view_size(5.0);
        close(size.x, 20.0);
        close(size.y, 10.0);
    }

    #[test]
    fn view_offset_selects_a_tile_and_can_be_cleared() {
        let mut camera = Camera::perspective(90.0, 1.0, 1.0, 100.0);
        let full = camera.projection_matrix;
        // left half of a 200 x 100 viewport
        camera.set_view_offset(200.0, 100.0, 0.0, 0.0, 100.0, 100.0);
        let mut left_edge = Vector3::new(-2.0, 0.0, -1.0);
        left_edge.apply_matrix4(&camera.projection_matrix);
        close(left_edge.x, -1.0);
        let mut centre = Vector3::new(0.0, 0.0, -1.0);
        centre.apply_matrix4(&camera.projection_matrix);
        close(centre.x, 1.0);

        camera.clear_view_offset();
        assert!(!camera.view.unwrap().enabled);
        // the aspect ratio set by the offset stays
        assert_ne!(camera.projection_matrix, full);
    }

    #[test]
    fn update_view_ignores_scale() {
        let mut camera = Camera::perspective(50.0, 1.0, 0.1, 100.0);
        let mut world = Matrix4::default();
        world.compose(&Vector3::new(0.0, 0.0, 5.0), &Quaternion::default(), &Vector3::new(3.0, 3.0, 3.0));
        camera.update_view(&world);
        let mut p = Vector3::new(1.0, 0.0, 0.0);
        p.apply_matrix4(&camera.matrix_world_inverse);
        close(p.x, 1.0);
        close(p.z, -5.0);
    }
}
