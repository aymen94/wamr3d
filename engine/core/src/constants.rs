//! Numeric constants shared with three.js. The values match three.js
//! (AGENTS.md D16), so they can cross the binding layer unchanged.

/// How often a buffer's contents are expected to change. A hint for the GPU backend.
#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Usage {
    #[default]
    StaticDraw = 35044,
    DynamicDraw = 35048,
    StreamDraw = 35040,
    StaticRead = 35045,
    DynamicRead = 35049,
    StreamRead = 35041,
    StaticCopy = 35046,
    DynamicCopy = 35050,
    StreamCopy = 35042,
}

/// The data type an attribute has on the GPU.
#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum GpuType {
    UnsignedByte = 1009,
    Byte = 1010,
    Short = 1011,
    UnsignedShort = 1012,
    Int = 1013,
    UnsignedInt = 1014,
    #[default]
    Float = 1015,
    HalfFloat = 1016,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_values() {
        assert_eq!(Usage::default() as u32, 35044);
        assert_eq!(Usage::DynamicDraw as u32, 35048);
        assert_eq!(GpuType::default() as u32, 1015);
        assert_eq!(GpuType::UnsignedByte as u32, 1009);
    }
}
