//! A hasher for maps keyed by engine handles and ids, which frame preparation looks up
//! once per draw. The standard library's SipHash resists keys chosen by an attacker,
//! which handles are not, and costs several times more per lookup.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// Multiply-rotate hashing of the integers written to it (the FxHash scheme).
#[derive(Default, Clone, Copy)]
pub struct IdHasher {
    hash: u64,
}

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

impl IdHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        self.hash = (self.hash.rotate_left(5) ^ word).wrapping_mul(SEED);
    }
}

impl Hasher for IdHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        let mut chunks = bytes.chunks_exact(8);
        for chunk in &mut chunks {
            self.add(u64::from_le_bytes(chunk.try_into().unwrap_or_default()));
        }
        for &byte in chunks.remainder() {
            self.add(u64::from(byte));
        }
    }

    #[inline]
    fn write_u8(&mut self, n: u8) {
        self.add(u64::from(n));
    }

    #[inline]
    fn write_u32(&mut self, n: u32) {
        self.add(u64::from(n));
    }

    #[inline]
    fn write_u64(&mut self, n: u64) {
        self.add(n);
    }

    #[inline]
    fn write_usize(&mut self, n: usize) {
        self.add(n as u64);
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.hash
    }
}

/// A `HashMap` hashed with [`IdHasher`].
pub type IdHashMap<K, V> = HashMap<K, V, BuildHasherDefault<IdHasher>>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::World;

    #[test]
    fn maps_handles_and_arrays() {
        let mut world = World::new();
        let objects: Vec<_> = (0..1000).map(|_| world.create_object()).collect();
        let mut map: IdHashMap<_, usize> = IdHashMap::default();
        for (i, &e) in objects.iter().enumerate() {
            map.insert(e, i);
        }
        assert_eq!(map.len(), 1000);
        assert!(objects.iter().enumerate().all(|(i, e)| map[e] == i));

        let mut sets: IdHashMap<[u32; 12], u32> = IdHashMap::default();
        for i in 0..100u32 {
            sets.insert([i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, i * 7], i);
        }
        assert!((0..100u32).all(|i| sets[&[i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, i * 7]] == i));
    }

    #[test]
    fn different_words_hash_differently() {
        let hash = |words: &[u32]| {
            let mut h = IdHasher::default();
            words.iter().for_each(|&w| h.write_u32(w));
            h.finish()
        };
        assert_ne!(hash(&[1, 2]), hash(&[2, 1]));
        assert_ne!(hash(&[0, 1]), hash(&[1, 0]));
    }
}
