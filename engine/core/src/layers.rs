/// A set of up to 32 layers, as a bit mask. An object is drawn by a camera (or hit by a
/// raycaster) only if the two share at least one layer. Layer 0 is enabled by default.
///
/// Layer numbers are taken modulo 32, as JavaScript's `1 << layer` does.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Layers {
    pub mask: u32,
}

impl Default for Layers {
    fn default() -> Self {
        Self { mask: 1 }
    }
}

fn bit(layer: u32) -> u32 {
    1u32.wrapping_shl(layer)
}

impl Layers {
    pub fn new() -> Self {
        Self::default()
    }

    /// Makes `layer` the only enabled layer.
    pub fn set(&mut self, layer: u32) {
        self.mask = bit(layer);
    }

    pub fn enable(&mut self, layer: u32) {
        self.mask |= bit(layer);
    }

    pub fn enable_all(&mut self) {
        self.mask = u32::MAX;
    }

    pub fn toggle(&mut self, layer: u32) {
        self.mask ^= bit(layer);
    }

    pub fn disable(&mut self, layer: u32) {
        self.mask &= !bit(layer);
    }

    pub fn disable_all(&mut self) {
        self.mask = 0;
    }

    pub fn test(&self, layers: &Layers) -> bool {
        self.mask & layers.mask != 0
    }

    pub fn is_enabled(&self, layer: u32) -> bool {
        self.mask & bit(layer) != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_has_layer_zero() {
        assert_eq!(Layers::new().mask, 1);
    }

    #[test]
    fn set() {
        let mut l = Layers::new();
        l.set(3);
        assert_eq!(l.mask, 8);
    }

    #[test]
    fn enable_and_disable() {
        let mut l = Layers::new();
        l.enable(4);
        assert_eq!(l.mask, 0b10001);
        l.disable(0);
        assert_eq!(l.mask, 0b10000);
    }

    #[test]
    fn enable_all_and_disable_all() {
        let mut l = Layers::new();
        l.enable_all();
        assert_eq!(l.mask, u32::MAX);
        l.disable_all();
        assert_eq!(l.mask, 0);
    }

    #[test]
    fn toggle() {
        let mut l = Layers::new();
        l.toggle(0);
        l.toggle(31);
        assert_eq!(l.mask, 1 << 31);
    }

    #[test]
    fn test_and_is_enabled() {
        let mut a = Layers::new();
        let mut b = Layers::new();
        assert!(a.test(&b));
        b.set(5);
        assert!(!a.test(&b));
        a.enable(5);
        assert!(a.test(&b) && a.is_enabled(5) && !a.is_enabled(6));
    }

    #[test]
    fn layer_numbers_wrap_at_32() {
        let mut l = Layers::new();
        l.set(33);
        assert_eq!(l.mask, 2);
    }
}
