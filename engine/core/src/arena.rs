use core::fmt;
use core::hash::{Hash, Hasher};
use core::marker::PhantomData;

/// A generational reference to a value in an [`Arena`].
///
/// A handle whose slot was freed never resolves again, even after the slot is reused,
/// because reuse bumps the slot's generation. Generations start at 1, so the all-zero
/// bit pattern is never a live handle and can stand for "none" on the JS side.
pub struct Handle<T> {
    index: u32,
    generation: u32,
    // `fn() -> T` keeps the handle `Send + Sync + Copy` whatever `T` is.
    marker: PhantomData<fn() -> T>,
}

impl<T> Handle<T> {
    pub fn index(self) -> u32 {
        self.index
    }

    pub fn generation(self) -> u32 {
        self.generation
    }

    /// Packs the handle into one integer for the Wasm boundary: generation in the high
    /// 32 bits, index in the low 32.
    pub fn to_bits(self) -> u64 {
        (self.generation as u64) << 32 | self.index as u64
    }

    pub fn from_bits(bits: u64) -> Self {
        Self { index: bits as u32, generation: (bits >> 32) as u32, marker: PhantomData }
    }
}

impl<T> Clone for Handle<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Handle<T> {}

impl<T> PartialEq for Handle<T> {
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index && self.generation == other.generation
    }
}

impl<T> Eq for Handle<T> {}

impl<T> Hash for Handle<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.to_bits().hash(state);
    }
}

impl<T> fmt::Debug for Handle<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Handle({}v{})", self.index, self.generation)
    }
}

struct Slot<T> {
    generation: u32,
    value: Option<T>,
}

/// Slot storage addressed by [`Handle`]s. Freed slots are reused, so a loop that
/// creates and destroys values does not grow the arena.
pub struct Arena<T> {
    slots: Vec<Slot<T>>,
    free: Vec<u32>,
    len: usize,
}

impl<T> Default for Arena<T> {
    fn default() -> Self {
        Self { slots: Vec::new(), free: Vec::new(), len: 0 }
    }
}

impl<T> Arena<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, value: T) -> Handle<T> {
        self.len += 1;

        if let Some(index) = self.free.pop() {
            let slot = &mut self.slots[index as usize];
            slot.value = Some(value);
            return Handle { index, generation: slot.generation, marker: PhantomData };
        }

        let index = u32::try_from(self.slots.len()).expect("arena holds more than u32::MAX slots");
        self.slots.push(Slot { generation: 1, value: Some(value) });
        Handle { index, generation: 1, marker: PhantomData }
    }

    pub fn remove(&mut self, handle: Handle<T>) -> Option<T> {
        let slot = self.slots.get_mut(handle.index as usize)?;
        if slot.generation != handle.generation {
            return None;
        }

        let value = slot.value.take()?;
        // A generation that would wrap to an already issued value retires the slot instead.
        if let Some(next) = slot.generation.checked_add(1) {
            slot.generation = next;
            self.free.push(handle.index);
        }
        self.len -= 1;
        Some(value)
    }

    pub fn get(&self, handle: Handle<T>) -> Option<&T> {
        let slot = self.slots.get(handle.index as usize)?;
        if slot.generation == handle.generation {
            slot.value.as_ref()
        } else {
            None
        }
    }

    pub fn get_mut(&mut self, handle: Handle<T>) -> Option<&mut T> {
        let slot = self.slots.get_mut(handle.index as usize)?;
        if slot.generation == handle.generation {
            slot.value.as_mut()
        } else {
            None
        }
    }

    pub fn contains(&self, handle: Handle<T>) -> bool {
        self.get(handle).is_some()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn iter(&self) -> impl Iterator<Item = (Handle<T>, &T)> {
        self.slots.iter().enumerate().filter_map(|(index, slot)| {
            let handle = Handle { index: index as u32, generation: slot.generation, marker: PhantomData };
            slot.value.as_ref().map(|value| (handle, value))
        })
    }

    /// Releases capacity that is no longer needed. Trailing free slots are dropped only
    /// when the arena is empty, because dropping a slot would forget its generation and
    /// let an old handle resolve again.
    pub fn shrink_to_fit(&mut self) {
        if self.len == 0 && self.slots.iter().all(|slot| slot.generation == 1) {
            self.slots.clear();
            self.free.clear();
        }
        self.slots.shrink_to_fit();
        self.free.shrink_to_fit();
    }
}

/// Per-entity component storage: a column indexed by the entity's slot index.
pub(crate) struct Column<T> {
    cells: Vec<Option<T>>,
}

impl<T> Default for Column<T> {
    fn default() -> Self {
        Self { cells: Vec::new() }
    }
}

impl<T> Column<T> {
    pub(crate) fn set(&mut self, index: u32, value: T) -> Option<T> {
        let index = index as usize;
        if index >= self.cells.len() {
            self.cells.resize_with(index + 1, || None);
        }
        self.cells[index].replace(value)
    }

    pub(crate) fn take(&mut self, index: u32) -> Option<T> {
        self.cells.get_mut(index as usize)?.take()
    }

    pub(crate) fn get(&self, index: u32) -> Option<&T> {
        self.cells.get(index as usize)?.as_ref()
    }

    pub(crate) fn get_mut(&mut self, index: u32) -> Option<&mut T> {
        self.cells.get_mut(index as usize)?.as_mut()
    }

    pub(crate) fn shrink_to_fit(&mut self) {
        while matches!(self.cells.last(), Some(None)) {
            self.cells.pop();
        }
        self.cells.shrink_to_fit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_get_remove() {
        let mut arena = Arena::new();
        let a = arena.insert("a");
        let b = arena.insert("b");
        assert_eq!((arena.get(a), arena.get(b)), (Some(&"a"), Some(&"b")));
        assert_eq!(arena.len(), 2);
        assert_eq!(arena.remove(a), Some("a"));
        assert_eq!(arena.remove(a), None);
        assert!(!arena.contains(a) && arena.contains(b));
        assert_eq!(arena.len(), 1);
        assert!(!arena.is_empty());
    }

    #[test]
    fn stale_handle_fails_after_slot_reuse() {
        let mut arena = Arena::new();
        let old = arena.insert(1);
        arena.remove(old);
        let new = arena.insert(2);
        assert_eq!(new.index(), old.index());
        assert_ne!(new.generation(), old.generation());
        assert_eq!(arena.get(old), None);
        assert_eq!(arena.get_mut(old), None);
        assert_eq!(arena.get(new), Some(&2));
    }

    #[test]
    fn get_mut_changes_the_value() {
        let mut arena = Arena::new();
        let h = arena.insert(1);
        *arena.get_mut(h).unwrap() = 5;
        assert_eq!(arena.get(h), Some(&5));
    }

    #[test]
    fn handle_bits_round_trip_and_zero_is_never_live() {
        let mut arena = Arena::new();
        let h = arena.insert(7u8);
        assert_eq!(Handle::<u8>::from_bits(h.to_bits()), h);
        assert_eq!(arena.get(Handle::from_bits(0)), None);
        assert_eq!(format!("{h:?}"), "Handle(0v1)");
    }

    #[test]
    fn iter_visits_live_values_only() {
        let mut arena = Arena::new();
        let a = arena.insert(1);
        let b = arena.insert(2);
        arena.remove(a);
        assert_eq!(arena.iter().collect::<Vec<_>>(), vec![(b, &2)]);
    }

    #[test]
    fn shrink_to_fit_keeps_generations() {
        let mut arena = Arena::new();
        let old = arena.insert(1);
        arena.remove(old);
        arena.shrink_to_fit();
        let new = arena.insert(2);
        assert_eq!(arena.get(old), None);
        assert_eq!(arena.get(new), Some(&2));
    }

    #[test]
    fn column_set_get_take() {
        let mut column = Column::default();
        assert_eq!(column.set(3, "x"), None);
        assert_eq!(column.set(3, "y"), Some("x"));
        assert_eq!(column.get(3), Some(&"y"));
        assert_eq!(column.get(0), None);
        *column.get_mut(3).unwrap() = "z";
        assert_eq!(column.take(3), Some("z"));
        assert_eq!(column.take(3), None);
        column.shrink_to_fit();
        assert_eq!(column.get(3), None);
    }
}
