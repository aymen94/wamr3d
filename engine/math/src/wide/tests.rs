#[test]
fn sin_cos_agrees_with_the_library_functions() {
    let mut worst = 0.0f64;
    let mut x = -40.0f64;
    while x < 40.0 {
        let (s, c) = super::sin_cos(x);
        worst = worst.max((s - x.sin()).abs()).max((c - x.cos()).abs());
        x += 0.000_917;
    }
    for x in [0.0, core::f64::consts::FRAC_PI_4, core::f64::consts::FRAC_PI_2, core::f64::consts::PI, -core::f64::consts::PI, 8191.9, -8191.9, 1e9, 1e300] {
        let (s, c) = super::sin_cos(x);
        worst = worst.max((s - x.sin()).abs()).max((c - x.cos()).abs());
    }
    assert!(worst < 4e-16, "largest difference {worst:e}");
    assert!(super::sin_cos(f64::NAN).0.is_nan() && super::sin_cos(f64::INFINITY).1.is_nan());
    assert_eq!(super::sin_cos(0.0), (0.0, 1.0));
}

use super::*;

#[test]
fn max_and_min_propagate_nan() {
    assert_eq!(max(1.0, 2.0), 2.0);
    assert_eq!(min(1.0, 2.0), 1.0);
    assert!(max(f64::NAN, 2.0).is_nan());
    assert!(min(1.0, f64::NAN).is_nan());
    assert_eq!(max32(-1.0, 3.0), 3.0);
    assert_eq!(min32(-1.0, 3.0), -1.0);
}

#[test]
fn clamp_matches_js() {
    assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
    assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
    assert_eq!(clamp32(0.5, 0.0, 1.0), 0.5);
    // inverted bounds: max( min, min( max, value ) )
    assert_eq!(clamp(0.5, 1.0, 0.0), 1.0);
}

#[test]
fn round_halves_toward_positive_infinity() {
    assert_eq!(round(2.5), 3.0);
    assert_eq!(round(-2.5), -2.0);
    assert_eq!(round(-2.6), -3.0);
    assert_eq!(round(0.49), 0.0);
}

#[test]
fn or_one_treats_zero_and_nan_as_falsy() {
    assert_eq!(or_one(0.0), 1.0);
    assert_eq!(or_one(f64::NAN), 1.0);
    assert_eq!(or_one(2.0), 2.0);
}

#[test]
fn vector_helpers() {
    let (a, b) = ([1.0, 2.0, 3.0], [4.0, 5.0, 6.0]);
    assert_eq!(add(a, b), [5.0, 7.0, 9.0]);
    assert_eq!(sub(b, a), [3.0, 3.0, 3.0]);
    assert_eq!(scale(a, 2.0), [2.0, 4.0, 6.0]);
    assert_eq!(add_scaled(a, b, 2.0), [9.0, 12.0, 15.0]);
    assert_eq!(dot(a, b), 32.0);
    assert_eq!(cross([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), [0.0, 0.0, 1.0]);
    assert_eq!(length_sq(a), 14.0);
    assert_eq!(length([3.0, 4.0, 0.0]), 5.0);
    assert_eq!(normalize([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
    assert_eq!(normalize([0.0, 4.0, 0.0]), [0.0, 1.0, 0.0]);
    assert_eq!(distance_sq(a, b), 27.0);
}
