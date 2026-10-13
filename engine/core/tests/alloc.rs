//! Phase 2 exit criterion: create and destroy 10,000 objects in a loop and check, with a
//! counting allocator, that memory returns to baseline.
//!
//! Two things are measured. Repeating the create/destroy cycle must not grow the live
//! byte count from one cycle to the next (slots and capacity are reused), and dropping
//! the world must return the count to exactly what it was before the world existed.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use wamr_core::*;

thread_local! {
    // Per thread, so allocations made by the test harness on other threads are not counted.
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

struct CountingAllocator;

fn track(delta: isize) {
    // `try_with`: the allocator can run while a thread's locals are being torn down.
    let _ = LIVE_BYTES.try_with(|live| live.set(live.get() + delta));
    if delta > 0 {
        let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
    }
}

// SAFETY: every call is forwarded unchanged to `System`, which upholds the `GlobalAlloc`
// contract; the bookkeeping only touches const-initialized thread-locals and never
// allocates. `realloc` is counted as free-old plus allocate-new, matching what `System`
// reports to the caller.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the caller guarantees `layout` has non-zero size.
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            track(layout.size() as isize);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: the caller guarantees `pointer` came from this allocator with `layout`,
        // and this allocator hands out `System` pointers only.
        unsafe { System.dealloc(pointer, layout) };
        track(-(layout.size() as isize));
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY: same guarantees as `dealloc`, plus a valid non-zero `new_size`.
        let new_pointer = unsafe { System.realloc(pointer, layout, new_size) };
        if !new_pointer.is_null() {
            track(new_size as isize - layout.size() as isize);
        }
        new_pointer
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn live_bytes() -> isize {
    LIVE_BYTES.with(Cell::get)
}

const OBJECTS: usize = 10_000;

/// Builds a 10,000-object binary tree of named, renderable objects, then destroys it.
fn create_and_destroy(world: &mut World, renderable: Renderable) {
    let mut objects: Vec<Entity> = Vec::with_capacity(OBJECTS);

    for i in 0..OBJECTS {
        let object = world.create_object();
        world.set_name(object, &format!("object-{i}"));
        world.set_renderable(object, Some(renderable));
        world.transform_mut(object).unwrap().position.set(i as f32, 0.0, 0.0);
        if i > 0 {
            assert!(world.add(objects[(i - 1) / 2], object));
        }
        objects.push(object);
    }

    assert_eq!(world.object_count(), OBJECTS);
    assert_eq!(world.geometry_ref_count(renderable.geometry), OBJECTS as u32);

    // half through the subtree, the rest one by one, to exercise both paths
    assert!(world.destroy_recursive(objects[1]));
    for object in &objects {
        world.destroy(*object);
    }

    assert_eq!(world.object_count(), 0);
    assert_eq!(world.geometry_ref_count(renderable.geometry), 0);
    assert!(objects.iter().all(|o| !world.is_alive(*o)));
    assert!(!world.drain_events().is_empty());
}

#[test]
fn ten_thousand_objects_return_memory_to_baseline() {
    let baseline = live_bytes();
    // a fixed array: a growing Vec here would itself show up in the measurement
    let mut after_cycle = [0isize; 4];
    let after_shrink;

    {
        let mut world = World::new();

        let mut geometry = BufferGeometry::new();
        geometry.set_from_points(&[wamr_math::Vector3::new(0.0, 0.0, 0.0), wamr_math::Vector3::new(1.0, 2.0, 3.0)]);
        let geometry = world.create_geometry(geometry);
        let material = world.create_material(Material { name: "shared".into(), ..Material::default() });
        let renderable = Renderable::mesh(geometry, material);

        for live in &mut after_cycle {
            create_and_destroy(&mut world, renderable);
            *live = live_bytes();
        }

        assert!(after_cycle[0] > baseline, "the world should be holding its arenas");

        world.shrink_to_fit();
        after_shrink = live_bytes();

        assert!(world.dispose_geometry(renderable.geometry));
        assert!(world.dispose_material(renderable.material));
    }

    let after_drop = live_bytes();
    let allocations = ALLOCATIONS.with(Cell::get);
    println!(
        "alloc: baseline {baseline} B, live after each of 4 cycles {after_cycle:?} B, after shrink_to_fit {after_shrink} B, after drop {after_drop} B, {allocations} allocations"
    );

    // capacity is reused: no growth from the first cycle on
    assert!(after_cycle.windows(2).all(|w| w[0] == w[1]), "live bytes grew between cycles: {after_cycle:?}");
    assert!(after_shrink < after_cycle[0], "shrink_to_fit should release unused capacity");
    assert_eq!(after_drop, baseline, "dropping the world must free everything");
    assert!(allocations > OBJECTS, "the allocator was not exercised");
}
