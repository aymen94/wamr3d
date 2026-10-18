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

mod css;
use css::*;

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
mod tests;
