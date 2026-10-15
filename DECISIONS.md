# WAMR3D decisions

Short current reference for contributors and AI tools. `AGENTS.md` defines repository rules; `STATUS.md` lists current gaps. Detailed historical rationale has been removed.

## Fixed choices

- Rust core (edition 2021); JavaScript is used where it is simpler or faster.
- Compatibility target: three.js, pinned to one exact `three` version in `package.json`.
- Math uses `f32`; matrices are column-major (`Matrix4` = 16 values, `Matrix3` = 9).
- Coordinates are right-handed, +Y up, camera looks down −Z; Euler defaults to `XYZ`.
- Scene entities use generational handles. A `World` owns its entities and resources.
- Parity fixtures come from direct imports of `three/src/`, never compiled `build/` files.
- Visual reference is three.js WebGPU. WebGPU NDC depth is 0..1; front faces are counter-clockwise.

## Engine and API

- Math stores `f32` and computes with `f64` where needed for parity. Target parity tolerance is `1e-6 * max(1, |expected|)`; non-finite values must match.
- SIMD is enabled for supported Wasm builds and must agree with scalar results.
- Scene graph, transforms, cameras and picking live in `engine/core`; built-in geometry and object types live in `engine/objects`.
- Generational handles cross the Wasm boundary as `bigint`. Low-level APIs are batched; `wamr3d/compat` provides three.js-style classes and chaining.
- The compatibility API stores transforms in JavaScript and synchronizes changes in batches. Do not mix low-level transform writes with compatibility getters on the same objects.
- Explicit low-level disposal frees resources. Destroying an entity does not dispose its geometry or material.
- Renderer split: Rust/Wasm prepares frame data and WGSL; JavaScript owns and issues WebGPU device, pipeline, buffer, texture and render-pass calls.
- Data the engine does not hold is handled where it lives: instance matrices are passed to `World.raycastInstances` in one call (the low-level `raycast` skips instanced objects and sprites); sprites are picked in JavaScript against the quad facing `raycaster.camera`; a line loop's closing index is built by the host and kept per geometry until its index changes.
- Textures per draw: seven slots (colour, normal, roughness, metalness, emissive, alpha, ambient occlusion) in one bind group. The engine interns each frame's distinct texture sets (`Renderer.textureSets`), so the host makes and caches one bind group per set, not per draw. Maps other than the colour map are sampled only when present, with explicit gradients taken once at the top of the fragment shader.
- Per-object uniforms stay at 64 floats (256-byte stride): map presence and fixed-size sprites are bits of the flags word, and `alphaTest`, `normalScale` and `aoMapIntensity` use components that were free or used only by sprites.
- Source layout: files over about 1,000 lines are split by area. `compat.js` re-exports the object API from `compat/` (live bindings share the one `World`); the WebGPU host's prefiltering and background pass are in `webgpu/environment.js`; the wasm bindings split `World` across several `impl` blocks, which wasm-bindgen merges into one class.
- Attributes reach the engine as floats: `normalized` integer arrays are converted to 0..1 or -1..1 on upload, interleaved attributes are copied out one by one. The pipeline key carries the colour width (bit 8, three or four floats) and the line-loop flag (bit 7).
- Engine code does not import three.js. CDN reference builds are limited to comparison/reference pages; committed fixtures let regular parity checks run without three.js installed.

## Compatibility limits

- This is an evolving three.js-style engine, not a complete three.js replacement. Check `STATUS.md` and `MIGRATION.md` for current missing features.
- Two backends draw the same frames: WebGPU (`webgpu.js`, WGSL) and WebGL 2 (`webgl.js`, GLSL ES 3.00). The engine prepares frames independently of the API; both shader sets live in `engine/renderer_webgpu` (`shaders.rs`, `glsl.rs`), and the std140 uniform blocks keep the WGSL layout, so the same buffers upload to both. The object API's renderer picks with `backend: 'auto'` (WebGPU, then WebGL 2, then the browser's software WebGPU adapter), `'webgpu'` or `'webgl'`; `forceWebGL` and `WebGLRenderer` mean `'webgl'`. TSL/node rendering and three.js's own WebGL shader sources are not ported.
- WebGL 2 specifics: canvas frames are drawn into a linear `RGBA16F` target and encoded to sRGB by the output pass, so blending happens in linear light as on WebGPU (without `EXT_color_buffer_float` the shader encodes directly and blends in sRGB space, and tone mapping, float render targets and environment prefiltering are skipped with a warning); render targets are single-sampled and drawn with y flipped (`flip_y`, front face turned to clockwise) so their rows are stored top first as on WebGPU; clip depth is remapped from the engine's 0..1 to -1..1 in the vertex stages.
- One environment map per frame: three.js lets each material pick its own `envMap`; WAMR3D draws the scene's `environment`, else the first material's map with that material's rotation, and warns once about any other. Only equirectangular textures; no cube textures.
- Background textures follow three.js: equirectangular ones around the camera (from the prefiltered map when blurred, on a sphere of radius 3 × the view's half height for orthographic cameras), others stretched over the frame without their uv transform.
- The standard material follows three.js's lighting model, including its 16 × 16 split-sum table (read with the same bilinear filtering in WGSL) and its geometry roughness. Ambient and hemisphere light is diffuse only, so metals without an environment map are dark, as in three.js.
- Texture maps share one uv transform (the colour map's, else the first map's); three.js gives each texture its own. The normal map's tangent frame always comes from screen-space derivatives (three.js uses a `tangent` attribute when the geometry has one). `alphaMap` is read from the red channel: three.js's WebGPU path multiplies the opacity by the whole texel and keeps the first component, although its documentation says green; grey maps read the same.
- `MeshPhysicalMaterial` is drawn as `MeshStandardMaterial`; its extensions are stored and warn once. `MeshToonMaterial` without `gradientMap` smooths its step from screen-space derivatives of the normal taken before any branch (WGSL needs uniform control flow), treating the light direction as constant across a pixel; three.js differentiates n·l directly.
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
- **D27** Visual parity compares against stored three.js WebGPU renders, within the tolerance in `parity/visual/cases.js`.
- **D32** Renderer split; see "Engine and API".
- **D39** Random helpers use a SplitMix64 generator, seeded by `init()` and resettable with `setRandomSeed`; `seededRandom` stays Mulberry32.
- **Section 5 / 5.3** Core model and ownership: a `World` owns everything; `destroy` leaves children alive as roots and `destroy_recursive` destroys the subtree; geometries, materials, render targets and interleaved buffers are freed only by `dispose_*`; reference counts are informational; arena slots are reused.
- **Section 6** Language split; see "Fixed choices" and "Engine and API".

## Fixture and attribution rules

- When changing a fixed choice, update this file and regenerate affected parity fixtures.
