//! Color.

use super::*;

#[wasm_bindgen]
#[derive(Clone, Copy, Default)]
pub struct Color {
    pub(crate) inner: wamr_math::Color,
}

fields!(Color { r set_r; g set_g; b set_b; });

const SRGB: wamr_math::ColorSpace = wamr_math::ColorSpace::Srgb;
const LINEAR: wamr_math::ColorSpace = wamr_math::ColorSpace::LinearSrgb;

#[wasm_bindgen]
impl Color {
    /// Components in the linear working colour space.
    #[wasm_bindgen(constructor)]
    pub fn new(r: f32, g: f32, b: f32) -> Color {
        Color { inner: wamr_math::Color::new(r, g, b) }
    }

    /// From an sRGB hex value such as `0xff8800`.
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(hex: u32) -> Color {
        Color { inner: wamr_math::Color::from_hex(hex) }
    }

    /// From a CSS colour string: `#f80`, `rgb(255,136,0)`, `hsl(32,100%,50%)` or a name.
    #[wasm_bindgen(js_name = fromStyle)]
    pub fn from_style(style: &str) -> Color {
        Color { inner: wamr_math::Color::from_style(style) }
    }

    pub fn copy(&mut self, source: &Color) {
        self.inner = source.inner;
    }

    #[wasm_bindgen(js_name = clone)]
    pub fn clone_value(&self) -> Color {
        *self
    }

    /// Sets from an sRGB hex value.
    #[wasm_bindgen(js_name = setHex)]
    pub fn set_hex(&mut self, hex: u32) {
        self.inner.set_hex(hex, SRGB);
    }

    /// Sets linear components.
    #[wasm_bindgen(js_name = setRGB)]
    pub fn set_rgb(&mut self, r: f32, g: f32, b: f32) {
        self.inner.set_rgb(r, g, b, LINEAR);
    }

    /// Hue, saturation and lightness, each 0 to 1.
    #[wasm_bindgen(js_name = setHSL)]
    pub fn set_hsl(&mut self, h: f32, s: f32, l: f32) {
        self.inner.set_hsl(h, s, l, LINEAR);
    }

    /// Sets from a CSS colour string. Strings that do not parse leave the colour unchanged.
    #[wasm_bindgen(js_name = setStyle)]
    pub fn set_style(&mut self, style: &str) {
        self.inner.set_style(style, SRGB);
    }

    /// The sRGB hex value.
    #[wasm_bindgen(js_name = getHex)]
    pub fn get_hex(&self) -> u32 {
        self.inner.get_hex(SRGB)
    }

    #[wasm_bindgen(js_name = getHexString)]
    pub fn get_hex_string(&self) -> String {
        self.inner.get_hex_string(SRGB)
    }

    /// A CSS string such as `rgb(255,136,0)`.
    #[wasm_bindgen(js_name = getStyle)]
    pub fn get_style(&self) -> String {
        self.inner.get_style(SRGB)
    }

    /// Hue, saturation, lightness.
    #[wasm_bindgen(js_name = getHSL)]
    pub fn get_hsl(&self) -> Vec<f32> {
        let hsl = self.inner.get_hsl(LINEAR);
        vec![hsl.h, hsl.s, hsl.l]
    }

    #[wasm_bindgen(js_name = lerpColors)]
    pub fn lerp_colors(&mut self, a: &Color, b: &Color, alpha: f32) {
        self.inner.lerp_colors(&a.inner, &b.inner, alpha);
    }

    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Vec<f32> {
        self.inner.to_array().to_vec()
    }
}

mutate!(Color {
    "setScalar" set_scalar(scalar: f32);
    "addScalar" add_scalar(s: f32);
    "multiplyScalar" multiply_scalar(s: f32);
    "offsetHSL" offset_hsl(h: f32, s: f32, l: f32);
    "convertSRGBToLinear" convert_srgb_to_linear();
    "convertLinearToSRGB" convert_linear_to_srgb();
});
mutate_with!(Color {
    "add" add(color: Color);
    "sub" sub(color: Color);
    "multiply" multiply(color: Color);
    "addColors" add_colors(a: Color, b: Color);
    "lerp" lerp(color: Color; alpha: f32);
    "lerpHSL" lerp_hsl(color: Color; alpha: f32);
    "setFromVector3" set_from_vector3(v: Vector3);
    "applyMatrix3" apply_matrix3(m: Matrix3);
});
query!(Color { "equals" equals(c: Color) -> bool; });
