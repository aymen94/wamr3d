use super::*;
use crate::test_util::{assert_close, assert_close_slice};

const SRGB: ColorSpace = ColorSpace::Srgb;
const LINEAR: ColorSpace = ColorSpace::LinearSrgb;

#[test]
fn default_is_white() {
    assert_eq!(Color::default(), Color::new(1.0, 1.0, 1.0));
}

#[test]
fn names_table_is_sorted_and_complete() {
    assert_eq!(Color::NAMES.len(), 148);
    assert!(Color::NAMES.windows(2).all(|w| w[0].0 < w[1].0));
}

#[test]
fn from_hex() {
    assert_eq!(Color::from_hex(0xff0000), Color::new(1.0, 0.0, 0.0));
    assert_eq!(Color::from_hex(0x808080).get_hex(SRGB), 0x808080);
}

#[test]
fn from_style() {
    assert_eq!(Color::from_style("blue"), Color::new(0.0, 0.0, 1.0));
}

#[test]
fn widen_and_narrow() {
    let c = Color::new(0.1, 0.2, 0.3);
    let mut d = Color::default();
    d.set_wide(c.wide());
    assert_eq!(d, c);
}

#[test]
fn set_scalar() {
    assert_eq!(*Color::default().set_scalar(0.5), Color::new(0.5, 0.5, 0.5));
}

#[test]
fn set_hex() {
    // sRGB input is converted to the linear working space
    let mut c = Color::default();
    c.set_hex(0x800000, SRGB);
    assert_close(c.r, crate::color_management::srgb_to_linear(128.0 / 255.0));
    // linear input is stored as is
    c.set_hex(0x00ff80, LINEAR);
    assert_close_slice(&c.to_array(), &[0.0, 1.0, 128.0 / 255.0]);
}

#[test]
fn set_rgb() {
    let mut c = Color::default();
    c.set_rgb(0.1, 0.2, 0.3, LINEAR);
    assert_eq!(c, Color::new(0.1, 0.2, 0.3));
    c.set_rgb(1.0, 0.0, 0.5, SRGB);
    assert_close(c.b, crate::color_management::srgb_to_linear(0.5));
}

#[test]
fn set_hsl() {
    let mut c = Color::default();
    c.set_hsl(0.0, 1.0, 0.5, LINEAR);
    assert_close_slice(&c.to_array(), &[1.0, 0.0, 0.0]);
    c.set_hsl(1.0 / 3.0, 1.0, 0.5, LINEAR);
    assert_close_slice(&c.to_array(), &[0.0, 1.0, 0.0]);
    // zero saturation is grey; hue wraps
    c.set_hsl(7.25, 0.0, 0.25, LINEAR);
    assert_eq!(c, Color::new(0.25, 0.25, 0.25));
}

#[test]
fn set_style_rgb_forms() {
    let style = |s: &str| *Color::new(0.25, 0.5, 0.75).set_style(s, LINEAR);
    assert_eq!(style("rgb(255,0,0)"), Color::new(1.0, 0.0, 0.0));
    assert_eq!(style("rgba( 0 , 255 , 0 , 0.5 )"), Color::new(0.0, 1.0, 0.0));
    assert_eq!(style("rgb(300,0,0)"), Color::new(1.0, 0.0, 0.0));
    assert_eq!(style("rgb(100%,0%,50%)"), Color::new(1.0, 0.0, 0.5));
}

#[test]
fn set_style_hsl_and_hex_forms() {
    let style = |s: &str| *Color::new(0.25, 0.5, 0.75).set_style(s, LINEAR);
    assert_close_slice(&style("hsl(120,100%,50%)").to_array(), &[0.0, 1.0, 0.0]);
    assert_eq!(style("#f00"), Color::new(1.0, 0.0, 0.0));
    assert_eq!(style("#00FF00"), Color::new(0.0, 1.0, 0.0));
    assert_eq!(style("Blue"), Color::new(0.0, 0.0, 1.0));
}

#[test]
fn set_style_rejects_malformed_input_unchanged() {
    let untouched = Color::new(0.25, 0.5, 0.75);
    for s in ["", "rgb(1,2)", "rgb(1.5,2,3)", "hsl(120,50,50)", "lab(1,2,3)", "#abcd", "#12", "notacolor", "rgb(1,2,3,x)"] {
        assert_eq!(*Color::new(0.25, 0.5, 0.75).set_style(s, LINEAR), untouched, "{s}");
    }
}

#[test]
fn set_color_name() {
    let mut c = Color::default();
    c.set_color_name("RED", SRGB);
    assert_eq!(c, Color::new(1.0, 0.0, 0.0));
    c.set_color_name("nope", SRGB);
    assert_eq!(c, Color::new(1.0, 0.0, 0.0));
}

#[test]
fn copy() {
    assert_eq!(*Color::default().copy(&Color::new(0.1, 0.2, 0.3)), Color::new(0.1, 0.2, 0.3));
}

#[test]
fn copy_srgb_to_linear_and_back() {
    let src = Color::new(0.2, 0.5, 0.8);
    let mut lin = Color::default();
    lin.copy_srgb_to_linear(&src);
    assert!(lin.g < src.g);
    let mut back = Color::default();
    back.copy_linear_to_srgb(&lin);
    // three.js uses a truncated exponent, so the round trip is close, not exact
    assert!((back.g - src.g).abs() < 1e-4);
}

#[test]
fn convert_srgb_to_linear() {
    let mut c = Color::new(0.5, 0.5, 0.5);
    c.convert_srgb_to_linear();
    assert_close(c.r, crate::color_management::srgb_to_linear(0.5));
}

#[test]
fn convert_linear_to_srgb() {
    let mut c = Color::new(0.5, 0.5, 0.5);
    c.convert_linear_to_srgb();
    assert_close(c.r, crate::color_management::linear_to_srgb(0.5));
}

#[test]
fn get_hex() {
    assert_eq!(Color::new(1.0, 0.0, 0.0).get_hex(SRGB), 0xff0000);
    assert_eq!(Color::new(0.0, 0.5, 1.0).get_hex(LINEAR), 0x0080ff);
    // out-of-range components clamp
    assert_eq!(Color::new(2.0, -1.0, 0.0).get_hex(LINEAR), 0xff0000);
}

#[test]
fn get_hex_string() {
    assert_eq!(Color::new(0.0, 0.0, 1.0).get_hex_string(SRGB), "0000ff");
}

#[test]
fn get_hsl() {
    let hsl = Color::new(0.0, 0.0, 1.0).get_hsl(LINEAR);
    assert_close_slice(&[hsl.h, hsl.s, hsl.l], &[2.0 / 3.0, 1.0, 0.5]);
    assert_eq!(Color::new(0.5, 0.5, 0.5).get_hsl(LINEAR), Hsl { h: 0.0, s: 0.0, l: 0.5 });
}

#[test]
fn get_rgb() {
    let c = Color::new(0.5, 0.25, 1.0);
    assert_eq!(c.get_rgb(LINEAR), c);
    assert_close(c.get_rgb(SRGB).r, crate::color_management::linear_to_srgb(0.5));
}

#[test]
fn get_style() {
    assert_eq!(Color::new(1.0, 0.0, 0.0).get_style(SRGB), "rgb(255,0,0)");
    assert_eq!(Color::new(0.2, 0.4, 0.6).get_style(LINEAR), "color(srgb-linear 0.200 0.400 0.600)");
    // exact ties round away from zero, like toFixed
    assert_eq!(Color::new(0.0625, 0.1875, 0.9375).get_style(LINEAR), "color(srgb-linear 0.063 0.188 0.938)");
}

#[test]
fn offset_hsl() {
    // red shifted a third of the way round the hue circle is green
    let mut c = Color::new(1.0, 0.0, 0.0);
    c.offset_hsl(1.0 / 3.0, 0.0, 0.0);
    assert_close_slice(&c.to_array(), &[0.0, 1.0, 0.0]);
}

#[test]
fn add() {
    assert_eq!(*Color::new(0.25, 0.5, 0.0).add(&Color::new(0.25, 0.25, 1.0)), Color::new(0.5, 0.75, 1.0));
}

#[test]
fn add_colors() {
    let mut c = Color::default();
    c.add_colors(&Color::new(0.25, 0.5, 0.0), &Color::new(0.25, 0.25, 1.0));
    assert_eq!(c, Color::new(0.5, 0.75, 1.0));
}

#[test]
fn add_scalar() {
    assert_eq!(*Color::new(0.25, 0.5, 0.0).add_scalar(0.25), Color::new(0.5, 0.75, 0.25));
}

#[test]
fn sub_clamps_at_zero() {
    assert_eq!(*Color::new(0.5, 0.25, 1.0).sub(&Color::new(0.25, 0.5, 0.5)), Color::new(0.25, 0.0, 0.5));
}

#[test]
fn multiply() {
    assert_eq!(*Color::new(0.5, 0.25, 1.0).multiply(&Color::new(0.5, 2.0, 0.0)), Color::new(0.25, 0.5, 0.0));
}

#[test]
fn multiply_scalar() {
    assert_eq!(*Color::new(0.5, 0.25, 1.0).multiply_scalar(2.0), Color::new(1.0, 0.5, 2.0));
}

#[test]
fn lerp() {
    assert_eq!(*Color::new(0.0, 0.5, 1.0).lerp(&Color::new(1.0, 0.5, 0.0), 0.25), Color::new(0.25, 0.5, 0.75));
}

#[test]
fn lerp_colors() {
    let mut c = Color::default();
    c.lerp_colors(&Color::new(0.0, 0.5, 1.0), &Color::new(1.0, 0.5, 0.0), 0.25);
    assert_eq!(c, Color::new(0.25, 0.5, 0.75));
}

#[test]
fn lerp_hsl() {
    // halfway from red (h = 0) to green (h = 1/3) in HSL is yellow (h = 1/6)
    let mut c = Color::new(1.0, 0.0, 0.0);
    c.lerp_hsl(&Color::new(0.0, 1.0, 0.0), 0.5);
    assert_close_slice(&c.to_array(), &[1.0, 1.0, 0.0]);
}

#[test]
fn set_from_vector3() {
    assert_eq!(*Color::default().set_from_vector3(&Vector3::new(0.1, 0.2, 0.3)), Color::new(0.1, 0.2, 0.3));
}

#[test]
fn apply_matrix3() {
    // swap red and green
    let m = Matrix3::new(0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
    assert_eq!(*Color::new(0.1, 0.2, 0.3).apply_matrix3(&m), Color::new(0.2, 0.1, 0.3));
}

#[test]
fn equals() {
    assert!(Color::new(0.1, 0.2, 0.3).equals(&Color::new(0.1, 0.2, 0.3)));
    assert!(!Color::new(0.1, 0.2, 0.3).equals(&Color::default()));
}

#[test]
fn from_array_and_to_array() {
    let mut c = Color::default();
    c.from_array(&[9.0, 0.1, 0.2, 0.3], 1);
    assert_eq!(c.to_array(), [0.1, 0.2, 0.3]);
}

#[test]
fn to_array_into() {
    let mut out = [0.0; 4];
    Color::new(0.1, 0.2, 0.3).to_array_into(&mut out, 1);
    assert_eq!(out, [0.0, 0.1, 0.2, 0.3]);
}

#[test]
fn to_fixed3_matches_js() {
    assert_eq!(to_fixed3(0.5), "0.500");
    assert_eq!(to_fixed3(0.0625), "0.063");
    assert_eq!(to_fixed3(-0.0625), "-0.063");
    assert_eq!(to_fixed3(-0.0), "0.000");
    assert_eq!(to_fixed3(1.23456), "1.235");
    assert_eq!(to_fixed3(f64::NAN), "NaN");
}
