use crate::color_management::{convert_wide, linear_to_srgb_wide, srgb_to_linear_wide, ColorSpace, WORKING_COLOR_SPACE};
use crate::color_names::NAMES;
use crate::math_utils::lerp_wide;
use crate::matrix3::Matrix3;
use crate::vector3::Vector3;
use crate::wide;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Hsl {
    pub h: f32,
    pub s: f32,
    pub l: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl Default for Color {
    fn default() -> Self {
        Self { r: 1.0, g: 1.0, b: 1.0 }
    }
}

fn hue2rgb(p: f64, q: f64, t: f64) -> f64 {
    let mut t = t;
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        return p + (q - p) * 6.0 * t;
    }
    if t < 1.0 / 2.0 {
        return q;
    }
    if t < 2.0 / 3.0 {
        return p + (q - p) * 6.0 * (2.0 / 3.0 - t);
    }
    p
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> [f64; 3] {
    // h,s,l ranges are in 0.0 - 1.0
    let h = ((h % 1.0) + 1.0) % 1.0; // euclideanModulo( h, 1 )
    let s = wide::clamp(s, 0.0, 1.0);
    let l = wide::clamp(l, 0.0, 1.0);

    if s == 0.0 {
        [l, l, l]
    } else {
        let p = if l <= 0.5 { l * (1.0 + s) } else { l + s - (l * s) };
        let q = (2.0 * l) - p;

        [hue2rgb(q, p, h + 1.0 / 3.0), hue2rgb(q, p, h), hue2rgb(q, p, h - 1.0 / 3.0)]
    }
}

fn rgb_to_hsl([r, g, b]: [f64; 3]) -> [f64; 3] {
    // h,s,l ranges are in 0.0 - 1.0
    let max = wide::max(wide::max(r, g), b);
    let min = wide::min(wide::min(r, g), b);

    let (hue, saturation);
    let lightness = (min + max) / 2.0;

    if min == max {
        hue = 0.0;
        saturation = 0.0;
    } else {
        let delta = max - min;

        saturation = if lightness <= 0.5 { delta / (max + min) } else { delta / (2.0 - max - min) };

        let h = if max == r {
            (g - b) / delta + (if g < b { 6.0 } else { 0.0 })
        } else if max == g {
            (b - r) / delta + 2.0
        } else {
            (r - g) / delta + 4.0
        };

        hue = h / 6.0;
    }

    [hue, saturation, lightness]
}

fn to_fixed3(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0.000".into();
    }

    let sixteenths = x.abs() * 16.0;
    if sixteenths.fract() == 0.0 && sixteenths % 2.0 == 1.0 {
        let n = (x.abs() * 1000.0 + 0.5).floor() as u64;
        return format!("{}{}.{:03}", if x < 0.0 { "-" } else { "" }, n / 1000, n % 1000);
    }

    format!("{x:.3}")
}

// ---- CSS style parsing (three.js uses regular expressions; this is the same grammar)

fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

struct Cursor<'a> {
    s: &'a [char],
    i: usize,
}

impl Cursor<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && is_js_space(self.s[self.i]) {
            self.i += 1;
        }
    }

    fn eat(&mut self, c: char) -> bool {
        if self.s.get(self.i) == Some(&c) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn digit_run(&mut self) -> usize {
        let start = self.i;
        while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
            self.i += 1;
        }
        self.i - start
    }

    fn digits(&mut self) -> Option<f64> {
        let start = self.i;
        if self.digit_run() == 0 {
            return None;
        }
        self.s[start..self.i].iter().collect::<String>().parse().ok()
    }

    fn number(&mut self) -> Option<f64> {
        let start = self.i;
        let int_digits = self.digit_run();

        if self.s.get(self.i) == Some(&'.') && self.s.get(self.i + 1).is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
            self.digit_run();
        } else if int_digits == 0 {
            return None;
        }

        self.s[start..self.i].iter().collect::<String>().parse().ok()
    }

    fn at_end(&self) -> bool {
        self.i == self.s.len()
    }
}

fn parse_triplet(components: &[char], integers: bool, percent: [bool; 3]) -> Option<[f64; 3]> {
    let mut c = Cursor { s: components, i: 0 };
    let mut out = [0.0; 3];

    for i in 0..3 {
        c.ws();
        out[i] = if integers { c.digits()? } else { c.number()? };
        if percent[i] && !c.eat('%') {
            return None;
        }
        c.ws();
        if i < 2 && !c.eat(',') {
            return None;
        }
    }

    if c.eat(',') {
        c.ws();
        c.number()?;
        c.ws();
    }

    c.at_end().then_some(out)
}

fn match_function(style: &[char]) -> Option<(String, &[char])> {
    let name_len = style.iter().take_while(|c| c.is_ascii_alphanumeric() || **c == '_').count();
    if name_len == 0 || style.get(name_len) != Some(&'(') {
        return None;
    }
    let rest = &style[name_len + 1..];
    let close = rest.iter().position(|c| *c == ')')?;
    Some((style[..name_len].iter().collect(), &rest[..close]))
}

impl Color {
    pub const NAMES: &'static [(&'static str, u32)] = &NAMES;

    pub const fn new(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b }
    }

    pub fn from_hex(hex: u32) -> Self {
        let mut c = Self::default();
        c.set_hex(hex, ColorSpace::Srgb);
        c
    }

    pub fn from_style(style: &str) -> Self {
        let mut c = Self::default();
        c.set_style(style, ColorSpace::Srgb);
        c
    }

    #[inline]
    pub(crate) fn wide(&self) -> [f64; 3] {
        [self.r as f64, self.g as f64, self.b as f64]
    }

    #[inline]
    pub(crate) fn set_wide(&mut self, rgb: [f64; 3]) -> &mut Self {
        self.r = rgb[0] as f32;
        self.g = rgb[1] as f32;
        self.b = rgb[2] as f32;
        self
    }

    fn in_color_space(&self, color_space: ColorSpace) -> [f64; 3] {
        convert_wide(self.wide(), WORKING_COLOR_SPACE, color_space)
    }

    fn set_rgb_wide(&mut self, rgb: [f64; 3], color_space: ColorSpace) -> &mut Self {
        self.set_wide(convert_wide(rgb, color_space, WORKING_COLOR_SPACE))
    }

    fn set_hsl_wide(&mut self, h: f64, s: f64, l: f64, color_space: ColorSpace) -> &mut Self {
        self.set_rgb_wide(hsl_to_rgb(h, s, l), color_space)
    }

    pub fn set_scalar(&mut self, scalar: f32) -> &mut Self {
        self.r = scalar;
        self.g = scalar;
        self.b = scalar;
        self
    }

    pub fn set_hex(&mut self, hex: u32, color_space: ColorSpace) -> &mut Self {
        self.set_rgb_wide(
            [
                (hex >> 16 & 255) as f64 / 255.0,
                (hex >> 8 & 255) as f64 / 255.0,
                (hex & 255) as f64 / 255.0,
            ],
            color_space,
        )
    }

    pub fn set_rgb(&mut self, r: f32, g: f32, b: f32, color_space: ColorSpace) -> &mut Self {
        self.set_rgb_wide([r as f64, g as f64, b as f64], color_space)
    }

    pub fn set_hsl(&mut self, h: f32, s: f32, l: f32, color_space: ColorSpace) -> &mut Self {
        self.set_hsl_wide(h as f64, s as f64, l as f64, color_space)
    }

    pub fn set_style(&mut self, style: &str, color_space: ColorSpace) -> &mut Self {
        let chars: Vec<char> = style.chars().collect();

        if let Some((name, components)) = match_function(&chars) {
            // rgb / hsl

            match name.as_str() {
                "rgb" | "rgba" => {
                    if let Some(c) = parse_triplet(components, true, [false; 3]) {
                        // rgb(255,0,0) rgba(255,0,0,0.5)
                        return self.set_rgb_wide(c.map(|v| wide::min(255.0, v) / 255.0), color_space);
                    }

                    if let Some(c) = parse_triplet(components, true, [true; 3]) {
                        // rgb(100%,0%,0%) rgba(100%,0%,0%,0.5)
                        return self.set_rgb_wide(c.map(|v| wide::min(100.0, v) / 100.0), color_space);
                    }
                }
                "hsl" | "hsla" => {
                    if let Some(c) = parse_triplet(components, false, [false, true, true]) {
                        // hsl(120,50%,50%) hsla(120,50%,50%,0.5)
                        return self.set_hsl_wide(c[0] / 360.0, c[1] / 100.0, c[2] / 100.0, color_space);
                    }
                }
                _ => {} // unknown color model
            }
        } else if chars.first() == Some(&'#') && chars.len() > 1 && chars[1..].iter().all(char::is_ascii_hexdigit) {
            // hex color

            let hex = &chars[1..];
            let digit = |c: char| c.to_digit(16).unwrap_or(0);

            if hex.len() == 3 {
                // #ff0
                return self.set_rgb_wide(
                    [digit(hex[0]) as f64 / 15.0, digit(hex[1]) as f64 / 15.0, digit(hex[2]) as f64 / 15.0],
                    color_space,
                );
            } else if hex.len() == 6 {
                // #ff0000
                return self.set_hex(hex.iter().fold(0, |acc, c| acc * 16 + digit(*c)), color_space);
            }
            // other lengths: invalid hex color
        } else if !style.is_empty() {
            return self.set_color_name(style, color_space);
        }

        self
    }

    pub fn set_color_name(&mut self, style: &str, color_space: ColorSpace) -> &mut Self {
        // color keywords
        let name = style.to_lowercase();

        if let Ok(i) = NAMES.binary_search_by(|(k, _)| (*k).cmp(name.as_str())) {
            // red
            self.set_hex(NAMES[i].1, color_space);
        }
        // else: unknown color

        self
    }

    pub fn copy(&mut self, color: &Color) -> &mut Self {
        *self = *color;
        self
    }

    pub fn copy_srgb_to_linear(&mut self, color: &Color) -> &mut Self {
        self.set_wide(color.wide().map(srgb_to_linear_wide))
    }

    pub fn copy_linear_to_srgb(&mut self, color: &Color) -> &mut Self {
        self.set_wide(color.wide().map(linear_to_srgb_wide))
    }

    pub fn convert_srgb_to_linear(&mut self) -> &mut Self {
        let c = *self;
        self.copy_srgb_to_linear(&c)
    }

    pub fn convert_linear_to_srgb(&mut self) -> &mut Self {
        let c = *self;
        self.copy_linear_to_srgb(&c)
    }

    pub fn get_hex(&self, color_space: ColorSpace) -> u32 {
        let [r, g, b] = self.in_color_space(color_space).map(|c| wide::round(wide::clamp(c * 255.0, 0.0, 255.0)));

        (r * 65536.0 + g * 256.0 + b) as u32
    }

    pub fn get_hex_string(&self, color_space: ColorSpace) -> String {
        format!("{:06x}", self.get_hex(color_space))
    }

    pub fn get_hsl(&self, color_space: ColorSpace) -> Hsl {
        let [h, s, l] = rgb_to_hsl(self.in_color_space(color_space));
        Hsl { h: h as f32, s: s as f32, l: l as f32 }
    }

    pub fn get_rgb(&self, color_space: ColorSpace) -> Color {
        let mut target = Color::default();
        target.set_wide(self.in_color_space(color_space));
        target
    }

    pub fn get_style(&self, color_space: ColorSpace) -> String {
        let [r, g, b] = self.in_color_space(color_space);

        if color_space != ColorSpace::Srgb {
            // Requires CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/).
            return format!("color({} {} {} {})", color_space.as_str(), to_fixed3(r), to_fixed3(g), to_fixed3(b));
        }

        let channel = |c: f64| wide::round(c * 255.0) as i64;
        format!("rgb({},{},{})", channel(r), channel(g), channel(b))
    }

    pub fn offset_hsl(&mut self, h: f32, s: f32, l: f32) -> &mut Self {
        let hsl = rgb_to_hsl(self.wide());

        self.set_hsl_wide(hsl[0] + h as f64, hsl[1] + s as f64, hsl[2] + l as f64, WORKING_COLOR_SPACE)
    }

    pub fn add(&mut self, color: &Color) -> &mut Self {
        self.r += color.r;
        self.g += color.g;
        self.b += color.b;
        self
    }

    pub fn add_colors(&mut self, color1: &Color, color2: &Color) -> &mut Self {
        self.r = color1.r + color2.r;
        self.g = color1.g + color2.g;
        self.b = color1.b + color2.b;
        self
    }

    pub fn add_scalar(&mut self, s: f32) -> &mut Self {
        self.r += s;
        self.g += s;
        self.b += s;
        self
    }

    pub fn sub(&mut self, color: &Color) -> &mut Self {
        self.r = wide::max32(0.0, self.r - color.r);
        self.g = wide::max32(0.0, self.g - color.g);
        self.b = wide::max32(0.0, self.b - color.b);
        self
    }

    pub fn multiply(&mut self, color: &Color) -> &mut Self {
        self.r *= color.r;
        self.g *= color.g;
        self.b *= color.b;
        self
    }

    pub fn multiply_scalar(&mut self, s: f32) -> &mut Self {
        self.r *= s;
        self.g *= s;
        self.b *= s;
        self
    }

    pub fn lerp(&mut self, color: &Color, alpha: f32) -> &mut Self {
        let (a, b, alpha) = (self.wide(), color.wide(), alpha as f64);
        self.set_wide([a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha])
    }

    pub fn lerp_colors(&mut self, color1: &Color, color2: &Color, alpha: f32) -> &mut Self {
        let (a, b, alpha) = (color1.wide(), color2.wide(), alpha as f64);
        self.set_wide([a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha])
    }

    pub fn lerp_hsl(&mut self, color: &Color, alpha: f32) -> &mut Self {
        let hsl_a = rgb_to_hsl(self.wide());
        let hsl_b = rgb_to_hsl(color.wide());
        let alpha = alpha as f64;

        let h = lerp_wide(hsl_a[0], hsl_b[0], alpha);
        let s = lerp_wide(hsl_a[1], hsl_b[1], alpha);
        let l = lerp_wide(hsl_a[2], hsl_b[2], alpha);

        self.set_hsl_wide(h, s, l, WORKING_COLOR_SPACE)
    }

    pub fn set_from_vector3(&mut self, v: &Vector3) -> &mut Self {
        self.r = v.x;
        self.g = v.y;
        self.b = v.z;
        self
    }

    pub fn apply_matrix3(&mut self, m: &Matrix3) -> &mut Self {
        self.set_wide(wide::apply_m3(self.wide(), &m.wide()))
    }

    pub fn equals(&self, c: &Color) -> bool {
        c.r == self.r && c.g == self.g && c.b == self.b
    }

    pub fn from_array(&mut self, array: &[f32], offset: usize) -> &mut Self {
        self.r = array[offset];
        self.g = array[offset + 1];
        self.b = array[offset + 2];
        self
    }

    pub fn to_array(&self) -> [f32; 3] {
        [self.r, self.g, self.b]
    }

    pub fn to_array_into(&self, array: &mut [f32], offset: usize) {
        array[offset..offset + 3].copy_from_slice(&self.to_array());
    }
}

#[cfg(test)]
mod tests {
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
}
