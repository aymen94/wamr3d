use crate::color::Color;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ColorSpace {
    None = 0,
    Srgb = 1,
    LinearSrgb = 2,
}

impl ColorSpace {
    pub const fn as_str(self) -> &'static str {
        match self {
            ColorSpace::None => "",
            ColorSpace::Srgb => "srgb",
            ColorSpace::LinearSrgb => "srgb-linear",
        }
    }
}

pub const WORKING_COLOR_SPACE: ColorSpace = ColorSpace::LinearSrgb;

pub(crate) fn srgb_to_linear_wide(c: f64) -> f64 {
    if c < 0.04045 {
        c * 0.0773993808
    } else {
        (c * 0.9478672986 + 0.0521327014).powf(2.4)
    }
}

pub(crate) fn linear_to_srgb_wide(c: f64) -> f64 {
    if c < 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(0.41666) - 0.055
    }
}

pub fn srgb_to_linear(c: f32) -> f32 {
    srgb_to_linear_wide(c as f64) as f32
}

pub fn linear_to_srgb(c: f32) -> f32 {
    linear_to_srgb_wide(c as f64) as f32
}

pub(crate) fn convert_wide(rgb: [f64; 3], source: ColorSpace, target: ColorSpace) -> [f64; 3] {
    if source == target || source == ColorSpace::None || target == ColorSpace::None {
        return rgb;
    }

    let mut rgb = rgb;

    if source == ColorSpace::Srgb {
        rgb = rgb.map(srgb_to_linear_wide);
    }

    // primaries are identical for both built-in spaces: no matrix step

    if target == ColorSpace::Srgb {
        rgb = rgb.map(linear_to_srgb_wide);
    }

    rgb
}

pub fn convert(color: &mut Color, source_color_space: ColorSpace, target_color_space: ColorSpace) -> &mut Color {
    let rgb = convert_wide(color.wide(), source_color_space, target_color_space);
    color.set_wide(rgb)
}

pub fn working_to_color_space(color: &mut Color, target_color_space: ColorSpace) -> &mut Color {
    convert(color, WORKING_COLOR_SPACE, target_color_space)
}

pub fn color_space_to_working(color: &mut Color, source_color_space: ColorSpace) -> &mut Color {
    convert(color, source_color_space, WORKING_COLOR_SPACE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::assert_close;

    #[test]
    fn color_space_strings() {
        assert_eq!(ColorSpace::None.as_str(), "");
        assert_eq!(ColorSpace::Srgb.as_str(), "srgb");
        assert_eq!(ColorSpace::LinearSrgb.as_str(), "srgb-linear");
        assert_eq!(WORKING_COLOR_SPACE, ColorSpace::LinearSrgb);
    }

    #[test]
    fn srgb_to_linear_() {
        assert_eq!(srgb_to_linear(0.0), 0.0);
        assert_close(srgb_to_linear(1.0), 1.0);
        // linear segment below the 0.04045 knee
        assert_close(srgb_to_linear(0.02), 0.02 * 0.0773993808);
    }

    #[test]
    fn linear_to_srgb_() {
        assert_eq!(linear_to_srgb(0.0), 0.0);
        assert_close(linear_to_srgb(0.002), 0.002 * 12.92);
        // three.js uses the truncated exponent 0.41666, so 1.0 maps to exactly 1.0
        assert_close(linear_to_srgb(1.0), 1.0);
    }

    #[test]
    fn convert_() {
        let mut c = Color::new(0.5, 0.5, 0.5);
        convert(&mut c, ColorSpace::Srgb, ColorSpace::LinearSrgb);
        assert_close(c.r, srgb_to_linear(0.5));
        // same space and NoColorSpace are no-ops
        let mut d = Color::new(0.5, 0.25, 0.125);
        convert(&mut d, ColorSpace::Srgb, ColorSpace::Srgb);
        convert(&mut d, ColorSpace::None, ColorSpace::Srgb);
        convert(&mut d, ColorSpace::Srgb, ColorSpace::None);
        assert_eq!(d, Color::new(0.5, 0.25, 0.125));
    }

    #[test]
    fn working_to_color_space_() {
        let mut c = Color::new(0.5, 0.5, 0.5);
        working_to_color_space(&mut c, ColorSpace::Srgb);
        assert_close(c.g, linear_to_srgb(0.5));
    }

    #[test]
    fn color_space_to_working_() {
        let mut c = Color::new(0.5, 0.5, 0.5);
        color_space_to_working(&mut c, ColorSpace::Srgb);
        assert_close(c.b, srgb_to_linear(0.5));
    }
}
