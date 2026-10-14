# WAMR3D decisions

Short current reference for contributors and AI tools. `AGENTS.md` defines repository rules; `STATUS.md` lists current gaps. Detailed historical rationale has been removed.

## Fixed choices

- Rust core (edition 2021); JavaScript is used where it is simpler or faster.
- Compatibility target: three.js r186, pinned to `three@0.186.1`.
- Math uses `f32`; matrices are column-major (`Matrix4` = 16 values, `Matrix3` = 9).
- Coordinates are right-handed, +Y up, camera looks down −Z; Euler defaults to `XYZ`.
- Scene entities use generational handles. A `World` owns its entities and resources.
- Parity fixtures come from direct imports of `three/src/`, never compiled `build/` files.
- Visual reference is three.js r186 WebGPU. WebGPU NDC depth is 0..1; front faces are counter-clockwise.

## Engine and API

- Math stores `f32` and computes with `f64` where needed for parity. Target parity tolerance is `1e-6 * max(1, |expected|)`; non-finite values must match.
- SIMD is enabled for supported Wasm builds and must agree with scalar results.
- Scene graph, transforms, cameras and picking live in `engine/core`; built-in geometry and object types live in `engine/objects`.
- Generational handles cross the Wasm boundary as `bigint`. Low-level APIs are batched; `wamr3d/compat` provides three.js-style classes and chaining.
- The compatibility API stores transforms in JavaScript and synchronizes changes in batches. Do not mix low-level transform writes with compatibility getters on the same objects.
- Explicit low-level disposal frees resources. Destroying an entity does not dispose its geometry or material.
- Renderer split: Rust/Wasm prepares frame data and WGSL; JavaScript owns and issues WebGPU device, pipeline, buffer, texture and render-pass calls.
- Engine code does not import three.js. CDN reference builds are limited to comparison/reference pages; committed fixtures let regular parity checks run without three.js installed.

## Compatibility limits

- This is an evolving three.js-style engine, not a complete three.js replacement. Check `STATUS.md` and `MIGRATION.md` for current missing features.
- WebGPU is required; no WebGL fallback. TSL/node rendering and WebGL shader sources are not ported.
- Environment reflections are low-level only until object API wiring and visual parity coverage are complete.
- Rust math structs avoid hidden pointers and unsafe code. Typed-array views into Wasm memory become invalid after memory growth; refresh them before reuse.
- Known behavioral deviations and unsupported properties are documented in `MIGRATION.md` and `STATUS.md`.

## Cited decision IDs

Code comments and `AGENTS.md` cite these IDs; keep them stable.

- **D1** Each function widens `f32` inputs to `f64`, computes as three.js does, and rounds once on store. Chained calls round at each step.
- **D2** Parity tolerance `|got − expected| <= 1e-6 * max(1, |expected|)`; non-finite values match exactly.
- **D3** The SIMD path uses `f64x2` in scalar operation order, so it is bit-identical to scalar.
- **D4** Rust API: three.js names in `snake_case`; `target` out-parameters become return values; `null` becomes `Option`; overloads are split; string enums become Rust enums; out-of-range indices panic.
- **D16** `engine/core/src/constants.rs` holds the buffer usage and attribute type values from three.js `constants.js`.
- **D18** Integer typed-array stores wrap as JavaScript does (`Uint8ClampedArray` clamps and rounds half to even); they do not saturate.
- **D21** `engine/bindings` (package `wamr3d`) is a thin `wasm-bindgen` shell with no `unsafe`; zero-copy views are built in JavaScript.
- **D27** Visual parity compares against stored three.js r186 WebGPU renders, within the tolerance in `parity/visual/cases.js`.
- **D32** Renderer split; see "Engine and API".
- **D39** Random helpers use a SplitMix64 generator, seeded by `init()` and resettable with `setRandomSeed`; `seededRandom` stays Mulberry32.
- **Section 5 / 5.3** Core model and ownership: a `World` owns everything; `destroy` leaves children alive as roots and `destroy_recursive` destroys the subtree; geometries, materials, render targets and interleaved buffers are freed only by `dispose_*`; reference counts are informational; arena slots are reused.
- **Section 6** Language split; see "Fixed choices" and "Engine and API".

## Fixture and attribution rules

- Never hand-write expected parity values. Generate them from the pinned three.js source and update fixtures only when the reference version is intentionally changed.
- Preserve three.js MIT attribution in `THIRD_PARTY.md`.
- When changing a fixed choice, update this file and regenerate affected parity fixtures.
