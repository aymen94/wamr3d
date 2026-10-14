# DECISIONS.md: WAMR3D

> The reference used to live in a folder of this repository. It was removed on 2026-10-14 (D37). Where older entries name `three/src/...`, read the `src/` folder of the npm package `three@0.186.1`, which is byte-identical to what that folder held.

Architecture choices, deviations from Three.js, and the pinned reference.
Changing anything marked **pinned** requires updating this file and regenerating all parity fixtures (AGENTS.md section 9).

## 1. Early decisions (AGENTS.md section 3)

| Decision | Choice | Status | Reason |
|---|---|---|---|
| Language | **Rust** (edition 2021, stable toolchain) | pinned | `wasm-bindgen` and `wgpu` are mature; ownership and no GC help the "memory returns to baseline" goal of Phase 2. |
| Three.js version | **r186** | pinned: npm `three@0.186.1` (exact version in `package.json`), and the same version in the CDN URLs of `examples/three-reference.js` | The version the port was made from. Its package reports `0.186.1`. |
| Matrix layout | Column-major `[f32; 16]` (`[f32; 9]` for `Matrix3`) | pinned | Identical to `Matrix4.elements`, so buffers can be handed to JS/WebGPU without reordering. |
| Handedness | Right-handed, +Y up, camera looks down −Z | pinned | Three.js default; all ported math assumes it. |
| Euler default order | `XYZ` | pinned | Three.js default (`Euler.DEFAULT_ORDER`). |
| Core model (Phase 2) | ECS with generational handles (AGENTS.md 4.2) | recommended, owned by Phase 2 | Avoids `Rc<RefCell>` parent/child cycles and Wasm leaks. Not decided by Phase 1. |
| Parity generator | Node script that imports `three/src` directly | pinned | Ground truth without touching `build/`. Details in section 2. |

## 2. Parity generator

**Finding: `three/src/math/` imports directly in Node as ES modules, with no build step and no `node_modules`.**

- The `package.json` of `three@0.186.1` has `"type": "module"`, so every `.js` under `src/` is loaded as ESM.
- All imports inside `src/math/` are relative and carry the `.js` extension, so Node's resolver needs no bundler or import map.
- Verified with Node v24.19.0 by importing `Matrix4.js`, `Euler.js`, `Color.js`, `Frustum.js`, `MathUtils.js` by relative path.
- `src/math/` is not self-contained. It imports two files from the parent folder, which Node loads transitively:
  - `../constants.js`: `WebGLCoordinateSystem`, `WebGPUCoordinateSystem` (Matrix4, Frustum, FrustumArray), `SRGBColorSpace`, `LinearSRGBColorSpace`, `NoColorSpace`, `SRGBTransfer`, `LinearTransfer` (Color, ColorManagement).
  - `../utils.js`: `warn`, `warnOnce` (console warnings only).
- `Color.js` depends on `ColorManagement.js`, which is in `src/math/` but not in the Phase 1 list.

**Generator:** `parity/math/gen/generate.mjs`. Run with `node parity/math/gen/generate.mjs`.

- Imports only `three/src/math/*.js`. Reads nothing else from the reference tree and nothing from `build/`.
- Writes `parity/math/<Type>.json` (one file per type) and `parity/math/ops.json` (the list of every op).
- Deterministic: every op uses its own Mulberry32 stream seeded with FNV-1a of the op name. No clock, no `Math.random`. Running twice gives byte-identical files (checked by SHA-256).
- Every expected value is produced by calling three.js. Nothing is hand-written.
- **Float inputs are rounded to f32 (`Math.fround`) before three.js sees them.** The reference and the engine therefore start from bit-identical inputs, and the only difference left is the engine's f32 storage.
- Edge cases included: zero vectors, identity, 90/180/270 degree rotations, gimbal-lock Euler angles for all six orders (plus near-gimbal angles that must stay on the regular branch), non-normalized and zero quaternions, singular and zero matrices, mirrored (negative determinant) matrices, empty boxes and spheres, degenerate triangles and lines, zero-direction rays.

**Fixture format:** `{ "meta": {...}, "cases": [ { "op", "in", "out" }, ... ] }`.
`in` and `out` are flat number arrays. Layouts: vec = components; quaternion = `x,y,z,w`; Euler = `x,y,z,orderIndex` with `XYZ,YXZ,ZXY,ZYX,YZX,XZY` = 0..5; matrices = `elements` (column-major); box = `min,max`; sphere = `center,radius`; plane = `normal,constant`; ray = `origin,direction`; frustum = 6 planes; bool = 0/1; a nullable result = `[0]` or `[1, ...value]`; point list = `[count, ...xyz]`. Non-finite numbers are the strings `"Infinity"`, `"-Infinity"`, `"NaN"`. String arguments and results use `s` and `os`.

## 3. Phase 1 deviations and design choices

Each of these is a difference from the JavaScript source. None changes a numeric result.

### D1. f32 storage, f64 arithmetic inside each function
Three.js stores every component as a JS number (f64) and only narrows to f32 when uploading to the GPU. AGENTS.md requires f32 storage. If the arithmetic were also f32, functions with cancellation (`Matrix4.invert`, `determinant`, ray and triangle tests) would lose more precision than the `1e-6` budget allows, and exact checks such as `det === 0` could take different branches. This is reasoned from f32's 24-bit mantissa; a pure-f32 build was not written or measured.

So every function widens its f32 inputs to f64, runs the same expression three.js runs, and rounds once when storing the result. For a single call on identical inputs the result is the correctly rounded f32 of the Three.js value, and every branch is taken identically. Single IEEE operations (`a + b`, `a * b`) are done directly in f32, because that is bit-identical to widen-compute-round.

Consequence: a chain of calls rounds to f32 at each step, where JS carries f64 between steps. That is the unavoidable cost of f32 storage.

### D2. Parity tolerance
The parity test accepts `|got − expected| <= 1e-6 * max(1, |expected|)`: absolute `1e-6` up to magnitude 1, relative above. A plain absolute `1e-6` cannot be met by any f32 value above 16, where adjacent f32 values are already `1.9e-6` apart. Non-finite values must match exactly (`NaN` matches `NaN`).

### D3. SIMD path uses `f64x2`, not `f32x4`
The `simd` cargo feature (wasm32 with `+simd128`) covers `Matrix4::multiply_matrices`, `Vector3::apply_matrix4`, `Vector4::apply_matrix4` and `Vector3::transform_direction`. It promotes to `f64x2` and keeps the scalar operation order, so it is bit-identical to the scalar reference (D1) rather than merely within `1e-6`. `f32x4` would process four lanes instead of two but would lose D1's precision for exactly the functions the renderer uses most. This is listed as an open decision in STATUS.md.

### D4. Naming and calling conventions
- Methods are the Three.js names in `snake_case` (`applyMatrix4` → `apply_matrix4`). Mutating methods return `&mut Self` so calls chain as in JS.
- `target` out-parameters become return values (`box.getCenter(target)` → `box.get_center() -> Vector3`). Functions that return `null` return `Option`. Where JS zeroes the target before returning `null` (`Triangle.getBarycoord`), the zeroing has no equivalent.
- Optional out-parameters that are not `target` stay as `Option<&mut Vector3>` (`Ray.distanceSqToSegment`, `Line3.distanceSqToLine3`).
- JS default arguments have no Rust equivalent. Every argument is explicit; the doc comment names the JS default.
- Overloads are split: `Matrix4.makeTranslation(x, y, z)` keeps the scalar form (pass `v.x, v.y, v.z` for the `Vector3` form), same for `Matrix4.setPosition` and `Matrix3.makeTranslation`. `new Color(r, g, b)`, `new Color(hex)`, `new Color(style)` become `Color::new`, `Color::from_hex`, `Color::from_style`.
- Static methods that share a name with an instance method take the suffix `_abc`: `Triangle::get_normal_abc(a, b, c)`, `get_barycoord_abc`, `contains_point_abc`, `get_interpolation_abc`, `is_front_facing_abc`.
- `Triangle.getInterpolation` accepts `Vector2`, `Vector3` or `Vector4` in JS by duck typing. In Rust it is generic over the `Interpolate` trait, implemented for those three types.
- String enums become Rust enums: `EulerOrder`, `ProperEulerOrder`, `ColorSpace`, `CoordinateSystem`, `ComponentType` (the typed-array argument of `MathUtils.normalize`/`denormalize`).
- Index arguments out of range panic, where JS throws.

### D5. No change callbacks on `Quaternion` and `Euler`
JS `Quaternion` and `Euler` carry `_onChange` callbacks so `Object3D` can keep `rotation` and `quaternion` in sync. Callbacks stored in a math value would put a hidden pointer in data that crosses the Wasm boundary (ground rule 5). Both types are plain `Copy` structs with public fields. **Phase 2 owns the rotation ↔ quaternion sync.**

### D6. `ColorManagement` is fixed, not global mutable state
JS `ColorManagement` is a mutable singleton (`enabled`, `workingColorSpace`, a registry of spaces). The port fixes it at the Three.js defaults: enabled, working space `srgb-linear`, the two built-in spaces `srgb` and `srgb-linear`. Only the parts `Color` needs are ported (`convert`, `working_to_color_space`, `color_space_to_working`, `srgb_to_linear`, `linear_to_srgb`). Because both built-in spaces share Rec.709 primaries, the XYZ matrix branch of `convert` can never run and is not ported.

### D7. `MathUtils.seededRandom` state is per thread
JS keeps one module-level seed. Rust keeps it in a `thread_local`, which is the same thing on single-threaded Wasm and avoids a data race natively. It returns `f64`: the value has 32 bits of precision, and rounding it to f32 could return exactly `1.0`, which breaks the `[0, 1)` contract.

### D8. Layout
All structs are `#[repr(C)]` with f32 fields only, except `Euler`, which ends with a one-byte `EulerOrder` (12 bytes of f32, then the order, padded to 16). Use `to_array` to get the three angles as contiguous f32.

### D9. Warnings are dropped
`warn` / `warnOnce` from `src/utils.js` have no equivalent. Where JS warns and continues (unknown colour name, invalid hex colour, ignored alpha), the Rust code continues the same way without output.

### D10. JavaScript quirks that are not reproduced
- `Color.setColorName` looks the name up in a plain object, so in JS inherited keys such as `"constructor"` or `"toString"` are "found" and turn the colour black. Rust looks the name up in the 148-entry keyword table only.
- `Box3.setFromArray` on an array whose length is not a multiple of 3 reads `undefined` in JS and poisons the box with NaN. Rust ignores the trailing partial position.
- `Vector3.set(x, y)` (two arguments, keeps `z`) has no equivalent.
- `Color.getStyle` for non-sRGB spaces uses `toFixed(3)`. Rust reproduces its rounding, including exact ties, but not its switch to exponent notation at `1e21`.
- `Euler.toArray` / `fromArray` carry the order string as a fourth array element in JS. In Rust they carry the three angles; the order is the `order` field.

### D11. Measured parity (D2 in numbers)
7,186 cases over 388 ops produce 29,696 compared values. The largest scaled error `|err| / max(1, |expected|)` is `5.96e-8`, which is half an f32 ulp, the best f32 storage can do. 42 values miss a plain absolute `1e-6`; every one of them has `|expected| >= 40.8` (inverses of near-singular matrices, frustum planes of large matrices, `MathUtils.normalize` to 32-bit integers).

### D12. Crate layout and tooling
- `engine/math` is a standalone crate named `wamr-math`. There is no workspace `Cargo.toml` in `engine/` yet; Phase 2 should add one when `engine/core` exists.
- Runtime dependencies: none. Dev dependency: `serde_json` with `float_roundtrip` (the default JSON number parser can be one ulp off, which would corrupt the fixtures).
- `#![forbid(unsafe_code)]`. The wasm simd intrinsics are safe to call because the `simd` feature requires the whole crate to be built with `+simd128`; building the feature without it is a compile error with instructions.
- The simd path only exists on wasm32, so it is tested by running the full test suite on `wasm32-wasip1` under Node's WASI (`engine/math/tools/wasi-runner.mjs`, wired up in `engine/math/.cargo/config.toml`). `wasm32-unknown-unknown` is build-only.
- `kernels` (the scalar and simd128 functions) is public but `#[doc(hidden)]`, so tests can compare the two paths. It is not part of the three.js-shaped API.
- `engine/math/src/color_names.rs` is generated from `Color.NAMES` by `parity/math/gen/gen_color_names.mjs`.

### D13. Values taken from outside `src/math/`
The math sources import from `src/constants.js` and `src/utils.js` (section 2). Phase 1 uses these and nothing else from outside its folder:
- `WebGLCoordinateSystem = 2000`, `WebGPUCoordinateSystem = 2001` → `CoordinateSystem` enum in `engine/math/src/lib.rs`.
- `NoColorSpace = ''`, `SRGBColorSpace = 'srgb'`, `LinearSRGBColorSpace = 'srgb-linear'` → `ColorSpace` enum. `SRGBTransfer` / `LinearTransfer` are implied by the two built-in spaces and have no Rust counterpart.

These values were read with a `grep` of `src/constants.js`, which is outside the Phase 1 source folder (AGENTS.md 1.3). Logged in STATUS.md under "Needs decision".

### D14. Licence notice in derived files
Every file derived from three.js starts with: the source file it derives from, `Copyright © 2010-2026 three.js authors`, and an MIT license notice. The full licence text is maintained centrally rather than repeated in each file.


## 4. Phase 1 approvals (2026-10-13)

The project owner approved the Phase 1 approach. These are now settled:

| # | Decision | Outcome |
|---|---|---|
| A1 | Parity tolerance | `|error| <= 1e-6 * max(1, |expected|)`; non-finite values must match exactly (D2). |
| A2 | Arithmetic | f64 inside functions, one rounding on store to f32 (D1). Do not switch to pure f32 without measurements. |
| A3 | Random helpers | `Math.random`-based helpers stay unported. Revisit in the bindings phase. |
| A4 | SIMD | Keep `f64x2`, bit-identical to scalar (D3). No speed-up may be claimed until benchmarked. |
| A5 | Constants | The limited read of `src/constants.js` is approved. Shared values go in a Rust constants module with their source documented here (D13, D16). |
| A6 | Unlisted math files | Not added to Phase 1. Deferred until a later phase has a concrete need. |
| A7 | Rust API shape | Explicit arguments, return values instead of `target`, and the naming rules of D4 are approved and apply to later phases. The JS-facing API is made familiar in the bindings. |

### D15. Comment and attribution policy (supersedes D14)
Source files carry no comments that cite or point to the three.js file or function they derive from, and no per-file attribution header. Attribution and the full MIT licence text are maintained centrally, along with a list of derived directories. Comments are for non-obvious behaviour, invariants, ownership or safety constraints and subtle numerical decisions. `AGENTS.md` ground rules 2 and 6 were rewritten to match.

Direction: the engine is Rust compiled to WebAssembly. three.js is the behavioural reference only. JavaScript is limited to the host and integration layer; core state and computation live in Rust.

## 5. Phase 2: core model

### 5.1 Class hierarchy in `three/src/core/`

```
EventDispatcher
├── Object3D                      scene-graph node: transform, parent/children, layers, flags
├── BufferAttribute               one typed array + itemSize + normalized + usage + version
│   ├── InstancedBufferAttribute  adds meshPerAttribute
│   └── Int8/Uint8/Uint8Clamped/Int16/Uint16/Int32/Uint32/Float16/Float32BufferAttribute
│                                 constructors that pick the typed array; Float16 also converts half floats
├── BufferGeometry                index + named attributes + groups + bounds + drawRange
│   └── InstancedBufferGeometry   adds instanceCount
├── RenderTarget                  size, viewport, scissor, textures, depth/stencil/resolve flags
│   └── RenderTarget3D
└── UniformsGroup

InterleavedBuffer                 one typed array shared by several attributes, with a stride
└── InstancedInterleavedBuffer    adds meshPerAttribute
InterleavedBufferAttribute        a view (itemSize, offset) into an InterleavedBuffer; not a BufferAttribute subclass
GLBufferAttribute                 wraps a raw WebGL buffer
Layers, Uniform, Raycaster, Clock, Timer    standalone
```

Inheritance is used for three things: events (`EventDispatcher`), small data extensions (`Instanced*`), and constructor convenience (the typed `*BufferAttribute` classes). None of it needs virtual dispatch in Rust.

File list against AGENTS.md: all 14 listed files exist. Also present and not listed: `GLBufferAttribute.js`, `InstancedInterleavedBuffer.js`, `RenderTarget3D.js`, `UniformsGroup.js`.

### 5.2 Class-to-component map

| three.js | Rust (`engine/core`) | Notes |
|---|---|---|
| `Object3D` (identity) | `Entity` = `Handle<EntityTag>` (u32 index + u32 generation) | `Object3D.id` is the handle. `uuid` is not kept (needs `Math.random`, A3). |
| `Object3D.position/rotation/quaternion/scale/up/pivot/matrix/matrixWorld/matrixAutoUpdate/matrixWorldAutoUpdate/matrixWorldNeedsUpdate` | `Transform` component | `rotation` and `quaternion` are private and kept in sync by their setters, which replaces the `_onChange` callbacks (D5). |
| `Object3D.parent/children` | `Hierarchy` component | Handles, not references, so there are no cycles. |
| `Object3D.visible/layers/castShadow/receiveShadow/frustumCulled/renderOrder/static` | `Visibility` component | |
| `Object3D.name` | `Name` component (optional) | Absent means `''`. |
| `mesh.geometry` / `mesh.material` | `Renderable { geometry, material }` component | Optional. Handles into the geometry and material stores. |
| `Object3D.userData/animations/customDepthMaterial/customDistanceMaterial/on*Render/on*Shadow/type/is*` | not ported | JS-side data and renderer hooks; `type` and `is*` flags are replaced by which components exist. |
| `EventDispatcher` | `CoreEvent` enum + `World::events` queue | Section 5.4. |
| `Layers` | `Layers { mask: u32 }` | Full port. |
| `BufferAttribute`, typed subclasses, `InstancedBufferAttribute` | `BufferAttribute` with `AttributeArray` (enum of typed `Vec`s) and `mesh_per_attribute: Option<u32>` | The typed subclasses become `AttributeArray` variants. `Float16BufferAttribute` is not ported (needs `src/extras/DataUtils.js`, out of scope). |
| `InterleavedBuffer`, `InstancedInterleavedBuffer` | `InterleavedBuffer` in `World::interleaved_buffers` | Shared by handle. |
| `InterleavedBufferAttribute` | `InterleavedBufferAttribute { data: Handle, item_size, offset, normalized }` | |
| `BufferGeometry`, `InstancedBufferGeometry` | `BufferGeometry` in `World::geometries`, with `instance_count: Option<u32>` | Morph attributes and `indirect` are not ported yet (animation and indirect draws are out of v1 scope). |
| `RenderTarget` | `RenderTarget` in `World::render_targets` | Size, viewport, scissor and buffer flags. Its textures are not ported: `src/textures/` is out of scope (AGENTS.md 1.4). |
| `Uniform` | `Uniform<T>` | |
| `Timer` | `Timer` | Every timestamp is passed in by the host; Rust has no `performance.now` on wasm. |
| `Clock` | not ported | Deprecated in three.js since r183 in favour of `Timer`. |
| `Raycaster` | `Raycaster { ray, near, far, layers, params }` | `setFromCamera` and `intersectObject(s)` need cameras and per-object `raycast`, which are Phase 3. |
| `GLBufferAttribute`, `RenderTarget3D`, `UniformsGroup` | not ported | WebGL-only, or no v1 consumer yet. |

### 5.3 Ownership and disposal

1. A `World` owns everything: entities, their components, geometries, interleaved buffers, materials and render targets. Dropping the `World` frees all of it.
2. Everything is referred to by generational handles (`Handle<T>`: 32-bit slot index + 32-bit generation, one `u64` across the Wasm boundary). A handle to a freed slot never resolves, even after the slot is reused.
3. **Entities.** `World::destroy(entity)` removes the entity and all its components, detaches it from its parent, and leaves its children alive as roots, which is what dropping a JS parent while still holding its children does. `World::destroy_recursive` also destroys the subtree. Neither touches geometries or materials, exactly as removing a mesh in three.js does not dispose its geometry.
4. **Geometries, materials, render targets, interleaved buffers** are freed only by an explicit `dispose_*` call, as in three.js. Disposal frees the memory immediately and queues a `CoreEvent`. A `Renderable` that still names a disposed resource holds a dead handle; lookups return `None`.
5. **Reference counts** exist where three.js shares a resource: geometries and materials (shared by `Renderable`s) and interleaved buffers (shared by attributes). Attaching increments, detaching or destroying decrements. The count is information for the renderer and the bindings (for example to dispose automatically when a JS wrapper is collected); it never frees anything by itself.
6. A geometry owns its `BufferAttribute`s by value. An attribute that must be shared between geometries has to be an `InterleavedBufferAttribute` over a shared buffer; plain attributes are cloned. This is a deviation: three.js lets two geometries hold the same `BufferAttribute` object.
7. Arena slots are reused. A create/destroy loop does not grow memory after its first pass; the retained capacity is released when the `World` is dropped or `World::shrink_to_fit` is called.

### 5.4 Events

`EventDispatcher` stores callbacks keyed by string. `engine/core` has a typed enum and a queue instead:

```
CoreEvent::Added { entity }                    'added'         on the child
CoreEvent::Removed { entity }                  'removed'       on the child
CoreEvent::ChildAdded { parent, child }        'childadded'    on the parent
CoreEvent::ChildRemoved { parent, child }      'childremoved'  on the parent
CoreEvent::ObjectDisposed { entity }           'dispose'       Object3D
CoreEvent::GeometryDisposed { geometry }       'dispose'       BufferGeometry
CoreEvent::MaterialDisposed { material }       'dispose'       Material
CoreEvent::RenderTargetDisposed { target }     'dispose'       RenderTarget
CoreEvent::InterleavedBufferDisposed { buffer }
```

Events are pushed in the order three.js dispatches them and are read with `World::drain_events`. The difference from JS: listeners run synchronously inside `dispatchEvent`, while the queue is read later (once per frame). Subscriber closures for JS belong to the bindings phase. `BufferAttribute.dispose` has no event because attributes are owned by their geometry.

### D16. Constants used by `engine/core`
`engine/core/src/constants.rs` holds values from `three/src/constants.js` that the core sources import: the buffer usage hints (`StaticDrawUsage = 35044` and the other eight `*Usage` values) and the attribute GPU types (`FloatType = 1015`, `HalfFloatType = 1016`, `UnsignedByteType = 1009`, `ByteType = 1010`, `ShortType = 1011`, `UnsignedShortType = 1012`, `IntType = 1013`, `UnsignedIntType = 1014`). Read under approval A5.

### D17. Phase 2 / Phase 3 split of `Object3D`
`Object3D.js` is in Phase 2's source folder, but AGENTS.md gives parent/child semantics and world matrices to Phase 3. Phase 2 ports what needs only the components: `add`, `remove`, `removeFromParent`, `clear`, the local transform helpers (`applyMatrix4`, `applyQuaternion`, `setRotationFrom*`, `rotateOnAxis`, `rotateOnWorldAxis`, `rotateX/Y/Z`, `translateOnAxis`, `translateX/Y/Z`), `updateMatrix` (with pivot), the traversals and `getObjectByName`. Left for Phase 3: `attach`, `lookAt`, `updateMatrixWorld`, `updateWorldMatrix`, `localToWorld`, `worldToLocal`, `getWorld*`, `raycast`, `clone`/`copy`.

### D18. Typed-array store semantics
Writing a number into a JS integer typed array wraps modulo 2^n (and `Uint8ClampedArray` clamps and rounds half to even), where Rust's `as` saturates. `AttributeArray::set` reproduces the JS behaviour so that out-of-range writes give the same stored value.

### D19. Phase 2 deviations found while implementing
- **`dispose` frees.** In three.js `dispose()` only fires an event: the object stays usable and the renderer drops its GPU copies. In Rust `World::dispose_geometry`, `dispose_material`, `dispose_render_target` and `dispose_interleaved_buffer` free the value; its handle is dead afterwards. The event is still queued so the renderer can drop GPU resources. The one "release GPU resources but keep the object" case that three.js core itself relies on, `RenderTarget.setSize`, is kept: `World::set_render_target_size` queues `RenderTargetDisposed` and the target stays alive. `World::dispose_object` likewise only queues `ObjectDisposed`.
- **Interleaved attributes are not yet accepted by `BufferGeometry`.** `InterleavedBuffer`, `InterleavedBufferAttribute` and the world store for shared buffers are ported, but a geometry's attribute map holds plain `BufferAttribute`s only. Wiring interleaved attributes in changes every geometry method that reads attributes (they would need the buffer store), so it is left as an open decision. Until then rule 6 of section 5.3 reads: attributes are owned by value and cannot be shared between geometries.
- **`BufferGeometry` fields not ported:** `morphAttributes`, `morphTargetsRelative` (animation is out of v1 scope), `indirect` / `indirectOffset`, `userData`, `uuid`, `_transformed` (a renderer cache hint), and `lookAt` (needs `Object3D.lookAt`, Phase 3).
- **`Infinity` counts** (`drawRange.count`, `instanceCount`) are `u32::MAX`.
- **`BufferGeometry.setIndex( array )`** is `set_index_from_slice`; it picks 16 or 32 bits with the rule of `arrayNeedsUint32` in `src/utils.js` (any index >= 65535 needs 32 bits). The rule was confirmed through the parity fixture rather than by reading `utils.js`.
- **`Timer`** takes every timestamp from the caller (`Timer::new(now)`, `update(timestamp)`, `reset(now)`). `connect( document )`, `disconnect` and `dispose` are host concerns: the host calls `reset` when a hidden page becomes visible.
- **`World::add` does not check for cycles**, exactly like `Object3D.add`. Adding an ancestor below its own descendant makes traversals loop forever in both.
- **Traversals are iterative**, not recursive, so a deep scene graph cannot overflow the Wasm call stack. The visiting order is the same as three.js.
- **`Transform::set_rotation_order`** stands for assigning `object.rotation.order`.
- **Chained transform helpers round to f32 at each step** (D1), so `Object3D.transform` parity is at `4.7e-7` rather than the half-ulp of single math calls.

### D20. Workspace
`engine/Cargo.toml` is a Cargo workspace with members `math` and `core`. Build output is `engine/target/`. `engine/math/Cargo.lock` was replaced by `engine/Cargo.lock`. The WASI test runner still belongs to `engine/math` (run its wasm tests from that folder); `engine/core` is built for `wasm32-unknown-unknown` but its tests run natively only, because the allocation test replaces the global allocator and the parity test reads a file.

### D21. Bindings pulled ahead of Phases 3 and 4
AGENTS.md runs the phases in order, with bindings last. The owner asked for an importable WebAssembly module as early as possible, so a first slice of Phase 5 was built on top of Phases 1 and 2. AGENTS.md itself was not changed; Phases 3 and 4 are still to do, and the bindings will grow with them.

- **Crate:** `engine/bindings`, named `wamr3d`, a thin shell over `wamr-math` and `wamr-core` with no state or computation of its own. `#![forbid(unsafe_code)]`.
- **Tooling:** `wasm-bindgen` pinned to `=0.2.129` (the CLI must match), output `--target web`, assembled into `dist/wamr3d` by `engine/bindings/build.mjs`. A hand-written `index.js` adds `init()` (loads the .wasm from disk under Node.js, fetches it in a browser) and `attributeView()`.
- **Handles are `bigint`** (the `u64` of section 5.3). Correct and simple, but the slowest argument type to pass; the benchmark in STATUS.md shows the cost. Batch calls (`createObjects`, `addMany`, `setTransforms`, `matricesWorld`) exist for that reason.
- **JS methods return nothing**, so they do not chain, and JS objects must be `free()`d. A chaining, garbage-collected facade is Phase 5 proper.
- **Zero-copy views** are built in JS from `attributePtr` / `attributeLength` over the module's memory, which keeps `unsafe` out of the Rust side. They die when memory grows.
- **`World::update_matrix_world` and `update_world_matrix` moved into Phase 2** (they were left to Phase 3 in D17): a scene graph without world matrices could not be tried out. Phase 3 still owns the dirty-subtree counter test of its exit criteria, `attach`, `lookAt` and the world-space queries.
- **Release profile** for the workspace: `opt-level = 3`, LTO, one codegen unit.
- **User-facing files** (README, example, bindings, generated package) do not refer to the reference library, except where the README says what the tests and the benchmark compare against.

### D22. Cameras and world-space methods live in `engine/core`; shapes in `engine/objects`
`AGENTS.md` puts cameras, objects and shapes together in `engine/objects`. The camera is a component stored in the `World` and its view matrix is refreshed by the world-matrix update, and `lookAt`, `attach` and the world-space queries are methods of the scene graph, so all of those went into `engine/core`. `engine/objects` (crate `wamr-objects`) holds the built-in shapes and is where mesh, line and point objects will go. This supersedes the Phase 2 / Phase 3 split of D17 for the methods named here.

A camera defaults to the `WebGL` clip-space convention, as in three.js; set `coordinate_system` (or pass `webgpu = true` in the bindings) for depth 0..1.

### D23. Comparison demos draw with one shared renderer
`examples/threejs` and `examples/compare` draw both engines' scenes with the same three.js WebGL renderer, meshes, lights and materials. Until WAMR3D has a renderer this is the only way to make the picture equal on both sides, and it means only the CPU update time compares the engines. The comparison must be redone when the native renderer exists.

### D24. Renderer split: the engine prepares the frame, a JavaScript host issues WebGPU calls
`engine/renderer_webgpu` (crate `wamr-renderer`) owns everything that is a decision: which objects are drawn, in what order, the uniform data, the depth convention and the shader. `engine/bindings/js/webgpu.js` owns the WebGPU objects and replays the frame. This deviates from AGENTS.md section 4, which names `wgpu`. Reasons: WebGPU is a browser API, so `wgpu` on the web forwards every call to the same JavaScript functions; it would add its dependency tree to a 422 KiB module and to a toolchain where `cargo install wasm-bindgen-cli` already failed to compile; and the split keeps the renderer's logic testable natively without a GPU (6 unit tests). The cost is roughly 250 lines of host JavaScript that are not Rust. The frame format (`Frame`: draws, frame uniforms, object uniforms) is the boundary, so a `wgpu` backend can replace the host later without changing the engine side.

Behaviour source for shading (risk R1): diffuse term and light units follow `MeshLambertMaterial` with a directional and a hemisphere light as rendered by three.js r186; the visual check compares against that render. `src/nodes/` was not read.

Clip space: the frame's view-projection is always built with depth 0..1, whatever convention the camera was created with. Front faces are counter-clockwise. Both are covered by tests (near plane maps to depth 0; the image check would fail on a flipped Y or winding).

### D25. Object API as a second entry point, `wamr3d/compat`
The class-based API lives beside the handle-based one instead of replacing it. `wamr3d` stays the low-level, batched API that the measurements favour; `wamr3d/compat` is for code written against three.js-style classes. Design:

- One `World` per page, created by `init()`. Every object is a thin JavaScript wrapper holding a handle.
- `position`, `rotation`, `quaternion`, `scale`, `up` and `layers` are views whose numbers live in the engine: property reads and writes are engine calls. Methods not written out run on a temporary value and are copied back.
- Math classes subclass the generated engine classes. A generic wrapper adds chaining, default arguments, `target` parameters and `null` for misses.
- Engine objects, geometries and materials are released when their wrapper is garbage collected (`FinalizationRegistry`), or at once with `dispose()`. A wrapper stays reachable while its parent's `children` holds it, so nothing in a live scene is released.
- Material colours are sent to the engine when drawing, because they are plain values that code mutates in place.

Known cost: one engine call per property access, so per-object property animation of thousands of objects is slower than the batched calls and slower than three.js (STATUS.md).

### D26. Materials in the engine; textures as ids
`Material` now holds what the renderer needs: `shading` (diffuse, unlit, standard), `roughness`, `metalness` and `map`. `map` is a `u32` id, 0 for none: images are browser objects (`ImageBitmap`, canvas) that cannot live in WebAssembly memory, so the object API keeps the image and its sampling settings and the WebGPU host resolves the id when drawing. `src/textures/` is out of scope in AGENTS.md section 1.4 and was not read; the texture classes in the object API follow the public behaviour only (defaults for `flipY`, filters, wrapping and colour space), checked by the image comparison.

Behaviour source for the standard material (risk R1): direct lighting as rendered by three.js r186 `MeshStandardMaterial` without an environment map, matched against that render. Not implemented from it: multiple scattering compensation, geometric roughness from normal derivatives, environment lighting.

### D27. Visual parity: stored three.js WebGPU references, agreed tolerance
`parity/visual/` holds the Phase 4 exit check. `cases.js` describes each scene once against a library object; `run.mjs --generate` draws it with three.js r186 and its **WebGPU** renderer and stores `reference/<case>.png`; `run.mjs` draws it with WAMR3D and compares in the page. Differences go to `parity/visual/out/` (ignored by git).

- **Tolerance:** mean absolute difference per channel at most `1.5` of 255, and at most `2%` of pixels with a channel off by more than `12`. Cases with probes must also hit them (the triangle case pins the Y direction, the X direction and the winding).
- **Why the WebGPU renderer is the reference, not the WebGL one:** it blends and resolves multisampling in linear light, which is what WAMR3D does after D28. Against WebGL references every antialiased edge and every blended pixel differs slightly, and one-pixel lines differ visibly.
- The references are images from one machine (RTX 2070 Super, Chrome 155). Regenerate them only from `three@0.186.1`.
- `examples/webgpu/visual.html` still compares the demo scene with the three.js WebGL renderer, as a second opinion with the same limits.

### D28. Linear output into an sRGB canvas view
The shader writes linear colour and the canvas is drawn through an `-srgb` view of its format, so the GPU encodes on write and both alpha blending and the multisample resolve happen in linear light. Before, the shader encoded to sRGB itself, which matched the three.js WebGL renderer but not its WebGPU renderer. Clear colours passed to the host are linear.

### D29. Renderer state added for lights, blending and lines
- `Renderable` gained `primitive` (`Mesh`, `Line`, `LineSegments`); `Renderable::mesh(geometry, material)` builds the usual case. This touched Phase 2 and Phase 3 code (constructor call sites only). Lines are skipped by picking.
- `Material` gained `opacity`, `transparent`, `depth_test`, `depth_write`, `vertex_colors` and `map_transform`.
- Each draw carries a pipeline state number (side, blending, depth write, depth test, primitive). The host creates a pipeline the first time a state is drawn and keeps it, so pipelines are cached on material and vertex-layout state as AGENTS.md asks; the vertex layout is the same for every pipeline (missing attributes are bound to a zero buffer).
- Draw order: opaque draws by render order then nearest first; blended draws after them, by render order then farthest first. Depth is the origin of the object in view space, as in three.js. three.js also groups opaque draws by material; that is not done.
- Lights are passed per frame by the caller (the object API collects them from the scene): up to 8 directional, point and spot lights, plus sky and ground ambient colours. There is no light component in the `World` yet. The hemisphere light is assumed to point up.
- Behaviour sources (risk R1): point and spot falloff and the spot cone follow three.js r186 as rendered; the falloff formula was taken from the intent of the GLSL lighting chunk. The ambient term of the standard material uses the split-sum approximation and takes multiply-scattered light from the diffuse term, which halved the difference to the reference. A matching term for direct lights was tried and made no measurable difference, so it is not in. `src/nodes/` was not read.
- Textures: mipmaps are generated on the GPU when the texture asks for them; `offset`, `repeat`, `rotation` and `center` go through `map_transform`.
- The depth comparison is less-or-equal, as in three.js.

### D30. Shapes added out of the "later" list
`CylinderGeometry`, `ConeGeometry`, `CircleGeometry`, `RingGeometry` and `TorusGeometry` were ported from `three/src/geometries/` (AGENTS.md lists them as later) because ordinary scenes need them. Their fixtures are appended to `parity/objects/objects.json`; the earlier cases are unchanged.

### D31. three.js baseline for the comparison
`examples/compare/engine-three-scene.js` runs three.js r186 on its own: the scene comes from the same scene code as the WAMR3D object API (`examples/webgpu/scene.js`) and is drawn by the three.js WebGPU or WebGL renderer. `engine=three-webgpu` against `engine=api` is the like-for-like comparison (same scene code, same graphics API, each engine with its own renderer). The older `three` and `wamr3d` engines, which share one three.js WebGL renderer through the adapter, are kept as the transform-only baseline. The three.js builds in `three@0.186.1 build/` are loaded by these pages as a library; nothing is ported from them.

## 6. Owner decisions of 2026-10-13 (second round)

The project owner settled the open questions of D24, D27 and STATUS.md:

| # | Decision |
|---|---|
| B1 | The goal is a working three.js replacement. The implementation language follows from that: Rust is not required where JavaScript is simpler or faster. |
| B2 | The three.js **WebGPU** renderer is the primary visual reference. WebGL comparisons stay where useful (`examples/webgpu/visual.html`). |
| B3 | The native renderer is the default demo path. The three.js adapter stays as an optional reference (`examples/browser/?renderer=three`). |
| B4 | `GridHelper` and `AxesHelper` may be ported; AGENTS.md section 1.4 now names them as the exception to the `src/helpers/` exclusion. |
| B5 | Toolchain: latest stable Rust in the environment. Verified `rustc 1.99.0 (2026-09-28)`, `stable-x86_64-pc-windows-gnu`, reported up to date by `rustup check`. No toolchain file is pinned; the crates stay on edition 2021 (they build cleanly and nothing needs a newer edition). |

### D32. Renderer architecture: Rust prepares the frame, JavaScript issues the WebGPU calls (final for v1)
This replaces the `wgpu` line of AGENTS.md Phase 4, which was edited to match.

- **Rust/WebAssembly (`wamr-renderer`):** everything that scales with scene size and is pure computation: world matrices, frustum culling, layers, draw ordering, splitting objects into per-material parts, pipeline state per draw, and packing the uniform data for all draws into one buffer. It also owns the WGSL source.
- **JavaScript (`webgpu.js`, about 450 lines):** the WebGPU objects: device, pipelines (created per state and cached), buffers, textures and mipmaps, the render pass. It reads the frame from WebAssembly memory without copying the uniform data twice.

Why not `wgpu` compiled to WebAssembly:

1. On the web every `wgpu` call is forwarded to the same JavaScript WebGPU functions through generated bindings, so it adds a layer without removing the JavaScript calls. Draw submission is already the fastest measured part (STATUS.md).
2. It would add `wgpu` and its dependency tree to a 450 KiB module, and to a toolchain on which even `wasm-bindgen-cli` does not compile from source (GNU target).
3. Images, canvases and instance arrays are JavaScript objects. With the host in JavaScript they are handed to the GPU directly; with `wgpu` they would first have to cross into WebAssembly.
4. The frame format (draw list plus two uniform blocks) is the boundary. A native `wgpu` backend for non-browser targets can consume the same frames later without touching the engine side.

Cost: the host is not checked by the Rust compiler; it is covered by the visual parity cases instead.

### D33. The object API keeps transforms in JavaScript and sends them in batches
`object.position`, `rotation`, `quaternion`, `scale` and `up` used to call into WebAssembly on every read and write. They now read and write numbers stored next to the JavaScript object. Each object tracks which parts were written; the next engine access of any kind sends all pending writes in one call (`World.applyTransforms`). Parts the engine changes itself (`lookAt`, `rotateOnAxis`, `attach`, and the rotation that follows a quaternion write or the other way round) are marked out of date and read back with one call only when they are next read.

- Same observable behaviour as before for code that only uses the object API; the round trips are in `parity/bindings/compat-check.mjs`.
- A number read back is now the number written (a 64-bit float), as in three.js, where it used to be rounded to 32 bits.
- **Caveat:** transforms changed through the low-level `World` (for example `getWorld().setRotations(...)`) are not seen by the object's `position`/`rotation` getters until the engine changes that object through the object API. Mixing the two APIs on the same objects is no longer needed for speed and should be avoided.

### D34. `matrixAutoUpdate = false`
The engine already had the flag. In the object API, `object.matrix` is one persistent `Matrix4` per object. With automatic updates it is refreshed from the engine on each access (so it is still a copy). With `matrixAutoUpdate = false` it is the source of truth: the object API notes that it was handed out and writes it to the engine before the next engine access. `matrix.elements` is still a copy, so change the matrix through its methods. Setting the matrix marks the world matrix as out of date, so `matrixWorldNeedsUpdate = true` is accepted but not required.

### D35. Instancing, material arrays, fog, line picking
- **`InstancedMesh`:** instance matrices and colours stay in JavaScript typed arrays (`instanceMatrix.array`, `instanceColor.array`) and are uploaded by the host when their version changes; the engine only carries an id and a count on the `Renderable`. Per-instance culling and picking are not done: an instanced mesh is never frustum-culled, and the raycaster sees it as one mesh at its own transform. Every pipeline takes the instance inputs; ordinary draws bind one identity matrix.
- **Material arrays:** `World::set_materials` holds a material per geometry group; the frame gets one draw per group, clipped to the draw range, as in three.js. An array assigned to `mesh.material` is read when assigned; later edits of the array are not seen. A hit on such a mesh reports `materialIndex` 0.
- **Fog:** `Fog` and `FogExp2`, applied in the shader from the distance in front of the camera. All materials are fogged; `material.fog = false` is not honoured.
- **Line picking:** `Line` and `LineSegments` follow three.js (`Raycaster.params.Line.threshold`). `LineLoop` does not exist.

### D36. Showcase support: SIMD by default, paired sine and cosine, world-matrix view
- **The package is built with WebAssembly SIMD** (`+simd128`, feature `wamr-math/simd`) unless `build.mjs --no-simd` is given. Every browser that has WebGPU has SIMD, and the SIMD kernels are bit-identical to the scalar ones (D3). Measured on the showcase update: world-matrix update 78 to 62 ns per node.
- **`wide::sin_cos`** replaces separate `sin` and `cos` calls in the Euler-to-quaternion conversion, the hot spot of setting many rotations (WebAssembly has no native trigonometry). It reduces the angle once and evaluates both minimax polynomials; it agrees with the library functions to `4e-16` (unit test) and all parity fixtures still pass. This weakens D1 slightly for that one conversion: the result is no longer guaranteed to be the correctly rounded f32 of the three.js value, only within the parity tolerance. Angles of magnitude 8192 or more, and non-finite ones, use the library functions.
- **`World.matricesWorldPtr`** writes world matrices of a list of objects into a buffer owned by the module and returns its address, so instance matrices can go from the engine to the GPU without passing through a JavaScript copy. The view dies at the next call or when memory grows; the showcase recreates it at upload time.
- **The showcase compares four engines on one scene description.** The batched WAMR3D engine is written against the low-level API; the other three run one shared file written against a three.js-style library object. Timings are CPU-side only and are labelled so.

### D37. The three.js reference is no longer in the repository
The project owner is removing the local copy of three.js r186. WAMR3D was made independent of it:

- **Engine, package, object API, primary examples:** never imported three.js; unchanged. `examples/browser` used to load three.js for its transform check on every visit; the check is now off by default and loads three.js only when switched on (`?compare=1` or the checkbox).
- **Comparison pages** (three.js engines of the showcase and of `examples/compare`, `examples/threejs`, the reference adapter, `examples/webgpu/visual.html`, generating visual references): load `three.module.js` or `three.webgpu.js` of r186 from cdnjs, through one file, `examples/three-reference.js` (`parity/visual/cases.js` holds the URL for reference generation). Both builds import `./three.core.js` beside them, so they work from the CDN as they are. `three.tsl.js` is not a standalone entry point (it imports `three/webgpu` by name) and is not used.
- **Tests read committed data:** Rust parity fixtures (`parity/math`, `parity/core`, `parity/objects`), visual reference images (`parity/visual/reference`), and now the object API values (`parity/bindings/compat-expected.json`, 1,312 values recorded from three.js with `compat-check.mjs --generate`).
- **Scripts that genuinely need three.js** import the npm package, pinned exactly in the root `package.json` (`"three": "0.186.1"`): the three fixture generators, `compat-check.mjs --generate`, `parity/bindings/check.mjs` (live comparison of the low-level API), `bench/bench.mjs`. `npm install` fetches it into `node_modules/` (ignored by git). The package's `src/` was compared with the removed folder (`diff -r`: no difference), and regenerating every fixture from it changed no value.
- No CDN or npm dependency was added to WAMR3D itself.

### D38. Shadows, tone mapping, points, sprites, render targets, environment (2026-10-14)

Each follows the behaviour of the three.js r186 WebGPU renderer, read from its source and checked with visual cases (STATUS.md, milestone "renderer features"):

- **Tone mapping in an output pass.** r186 draws the frame into a half-float target and tone-maps it in a full-screen pass, so blending happens first, the background is tone-mapped and `material.toneMapped` has no effect on screen output. WAMR3D does the same (`rgba16float`, `OUTPUT_SHADER`) only when tone mapping is on; without it the scene is still drawn straight into the sRGB canvas, which matched before. Render targets are never tone-mapped.
- **Shadows.** One `depth32float` texture array, one layer per shadow-casting light (at most 4), sized to the largest map; each map fills the top-left of its layer. PCF exactly as r186 `PCFShadowFilter` (5 Vogel-disk taps rotated by interleaved gradient noise, bilinear comparison). The shadow camera is built in Rust; a directional light's camera stands at target + direction because the renderer receives directional lights as directions. Point-light (cube) shadows are not done.
- **Points are one pixel.** r186's WebGPU renderer draws `Points` with the point-list topology and ignores `size`; WAMR3D matches rather than inventing sized points.
- **Sprites** are a flag on the renderable (`Renderable.sprite`, the centre) and two material settings; the vertex shader lays the quad along the camera's right and up vectors, which the frame now carries (frame header grew by 8 floats; lights start at float 48).
- **Render targets** are drawn without flipping, as r186 WebGPU does; pipelines are keyed by target format and sample count.
- **Environment (incomplete).** The PMREM port keeps three.js's cube-UV layout, level sizes and passes so that results can be compared texel for texel; the sampling direction is y-flipped as r186 `PMREMNode` does. The object API is not wired yet.
