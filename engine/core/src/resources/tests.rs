use super::*;

#[test]
fn render_target_defaults() {
    let t = RenderTarget::new(640, 480);
    assert_eq!((t.width, t.height, t.depth, t.texture_count, t.samples), (640, 480, 1, 1, 0));
    assert_eq!(t.viewport, Vector4::new(0.0, 0.0, 640.0, 480.0));
    assert_eq!(t.scissor, t.viewport);
    assert!(t.depth_buffer && !t.stencil_buffer && !t.scissor_test);
    assert_eq!(RenderTarget::default().width, 1);
}

#[test]
fn render_target_set_size() {
    let mut t = RenderTarget::new(4, 4);
    t.viewport.set(1.0, 1.0, 2.0, 2.0);
    assert!(!t.set_size(4, 4, 1));
    assert_eq!(t.viewport, Vector4::new(0.0, 0.0, 4.0, 4.0));
    assert!(t.set_size(8, 2, 1));
    assert_eq!((t.width, t.height), (8, 2));
    assert_eq!(t.scissor, Vector4::new(0.0, 0.0, 8.0, 2.0));
}

#[test]
fn uniform() {
    let u = Uniform::new(Vector3::new(1.0, 2.0, 3.0));
    let mut copy = u.clone();
    assert_eq!(copy, u);
    copy.value.x = 9.0;
    assert_eq!((u.value.x, copy.value.x), (1.0, 9.0));
}

#[test]
fn timer_measures_deltas_from_host_timestamps() {
    let mut t = Timer::new(1000.0);
    assert_eq!((t.get_delta(), t.get_elapsed(), t.get_timescale()), (0.0, 0.0, 1.0));
    t.update(1016.0);
    assert_eq!((t.get_delta(), t.get_elapsed()), (0.016, 0.016));
    t.set_timescale(0.5).update(1116.0);
    assert_eq!(t.get_delta(), 0.05);
    assert!((t.get_elapsed() - 0.066).abs() < 1e-12);
}

#[test]
fn timer_reset_skips_a_pause() {
    let mut t = Timer::new(0.0);
    t.update(16.0);
    t.reset(60_016.0).update(60_032.0);
    assert_eq!(t.get_delta(), 0.016);
}

#[test]
fn raycaster() {
    let mut r = Raycaster::new(Vector3::default(), Vector3::new(0.0, 0.0, -1.0), 0.0, f32::INFINITY);
    assert_eq!((r.near, r.far, r.layers.mask), (0.0, f32::INFINITY, 1));
    assert_eq!(r.params, RaycasterParams { line_threshold: 1.0, points_threshold: 1.0 });
    r.set(&Vector3::new(1.0, 2.0, 3.0), &Vector3::new(1.0, 0.0, 0.0));
    assert_eq!(r.ray.origin, Vector3::new(1.0, 2.0, 3.0));
}
