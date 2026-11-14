//! Allocations of a repeated frame. Preparing the same scene again must reuse the buffers of
//! the previous frame instead of allocating new ones; counted with a counting allocator.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use wamr_core::{Camera, Entity, Material, Renderable, Shading, World};
use wamr_math::{Color, Vector3};
use wamr_objects::box_geometry;
use wamr_renderer::*;

thread_local! {
    // Per thread, so allocations made by the test harness on other threads are not counted.
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

struct CountingAllocator;

// SAFETY: every call is forwarded unchanged to `System`, which upholds the `GlobalAlloc`
// contract; the bookkeeping only touches a const-initialized thread-local and never
// allocates. A `realloc` counts as one allocation.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
        // SAFETY: the caller guarantees `layout` has non-zero size.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: the caller guarantees `pointer` came from this allocator with `layout`,
        // and this allocator hands out `System` pointers only.
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
        // SAFETY: same guarantees as `dealloc`, plus a valid non-zero `new_size`.
        unsafe { System.realloc(pointer, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

fn allocations() -> usize {
    ALLOCATIONS.with(Cell::get)
}

/// A camera and 1,000 shadow-casting boxes in 8 materials, in front of it.
fn scene() -> (World, Entity, Entity) {
    let mut world = World::new();
    let (root, camera) = (world.create_object(), world.create_object());
    world.add(root, camera);
    world.set_camera(camera, Some(Camera::perspective(60.0, 1.0, 0.1, 500.0)));
    let geometry = world.create_geometry(box_geometry(1.0, 1.0, 1.0, 1, 1, 1));
    let materials: Vec<_> = (0..8).map(|i| world.create_material(Material { color: Color::new(i as f32 / 8.0, 0.5, 0.25), shading: Shading::Standard, ..Material::default() })).collect();
    for i in 0..1000 {
        let object = world.create_object();
        world.add(root, object);
        world.set_renderable(object, Some(Renderable::mesh(geometry, materials[i % 8])));
        world.transform_mut(object).unwrap().position.set((i % 40) as f32 - 20.0, (i / 40) as f32 - 12.0, -40.0 - (i % 7) as f32);
        world.visibility_mut(object).unwrap().cast_shadow = true;
    }
    world.update_matrix_world(root, false);
    (world, root, camera)
}

fn lighting() -> Lighting {
    let shadow = LightShadow {
        blur_samples: 8,
        projection: ShadowProjection::Orthographic { left: -30.0, right: 30.0, top: 30.0, bottom: -30.0, near: 0.5, far: 500.0 },
        target: Vector3::new(0.0, 0.0, -40.0),
        bias: 0.0,
        normal_bias: 0.0,
        intensity: 1.0,
        radius: 1.0,
        map_width: 1024,
        map_height: 1024,
    };
    Lighting { lights: vec![Light { direction: Vector3::new(1.0, 10.0, 2.0), shadow: Some(shadow), ..Light::default() }], shadows: true, ..Lighting::default() }
}

#[test]
fn a_repeated_frame_allocates_nothing() {
    let (mut world, root, camera) = scene();
    let lighting = lighting();
    let (mut frame, mut scratch) = (Frame::default(), FrameScratch::default());
    assert!(prepare_frame_into(&mut world, root, camera, &lighting, &mut frame, &mut scratch));
    assert_eq!(frame.draws.len(), 1000);
    assert!(frame.shadows[0].draws.len() > 900);

    let before = allocations();
    assert!(prepare_frame_into(&mut world, root, camera, &lighting, &mut frame, &mut scratch));
    let made = allocations() - before;
    assert_eq!(frame.draws.len(), 1000);
    println!("allocations in a repeated frame: {made}");
    assert_eq!(made, 0, "a repeated frame allocated {made} times");
}
