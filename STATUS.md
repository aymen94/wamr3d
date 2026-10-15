# STATUS.md: WAMR3D

## Latest changes, not yet validated

- **Rust bindings package version.** `engine/bindings/Cargo.toml` now uses `0.5.0`, matching the JavaScript package version; internal component crates remain at `0.1.0`. Updated `engine/Cargo.lock`. Version metadata change only; no tests run.
- **Performance hot paths.** The compatibility math wrapper avoids a rest-array allocation on each call and uses arity-specific dispatch for common signatures. Raycasting caches a geometry's local sphere on first use instead of cloning and rescanning the geometry for every mesh and ray; the internal cache is excluded from geometry equality. Float32 bounds and geometry transforms iterate backing slices directly, avoiding per-component enum access. `Object3D.matrixWorld` now copies into its reusable Matrix4 in one Wasm call instead of allocating an intermediate array. These changes are not tested or benchmarked yet.
- **WebGL 2 backend and automatic fallback.** `engine/bindings/js/webgl.js` draws the engine's frames with WebGL 2 and the GLSL in `engine/renderer_webgpu/src/glsl.rs` (mesh with all materials, maps, lights, shadows and environment lighting; shadow, background, tone-mapping output and environment-prefiltering passes). `WebGPURenderer` takes `backend: 'auto' | 'webgpu' | 'webgl'` (default `'auto'`: WebGPU, then WebGL 2, then the software WebGPU adapter) and three.js's `forceWebGL`; `renderer.backend` reports which one draws. `WebGLRenderer` is now the same renderer on WebGL 2 instead of a class that throws. Checked on 2026-10-15 (Chrome headless, D3D11): `node parity/visual/run.mjs --backend=webgl` passes 26 of 28 cases against the three.js WebGPU references; `points` (4.4% of pixels off) and `lines` (2.5%) fail because 1-pixel points and lines rasterize slightly differently under WebGL's multisampling. All 12 ported examples run on it (`node examples/ports/check.mjs --webgl`). Two fixes came from those runs: canvas frames now always go through a linear half-float target, so blending is in linear light as on WebGPU (it was sRGB blending, which failed `transparent`, `vertex_alpha` and `fog`), and render targets are drawn with y flipped so their rows match WebGPU's (the `render_target` case was upside down and sampled black). The package's `files` list now includes `compat/`, `webgpu/` and `webgl.js` (the module folders were missing from it). The SIMD module is 566.6 KiB with the GLSL sources.
- Version references to the three.js reference were removed from comments, documentation, the website and scripts. The exact pin stays only where tools need it: `three` in `package.json` and its lockfile, the CDN constants (`examples/three-reference.js`, `REFERENCE_URL` in `parity/visual/cases.js`) and the metadata of generated fixtures. Stored logs in `bench/results/` were left as recorded; `website/scripts/benchmark-data.mjs` now drops any revision from the engine names it reads.
- Engine names shown by the comparison pages and written by future measurements no longer carry a revision (`three.js · WebGPU`).
- Website and README positioning: "Unlock your imagination without limits", a high-performance native WebAssembly engine with familiar three.js APIs. The README's previous speed placeholder is now the measured 1.9× result for one batched 10,000-transform update; the website benchmark page reports the full workload data.
- `MIGRATION.md` is now a short, generic guide (install and import, differences, browsers without WebGPU, batching, what is missing).
- Fresh test and benchmark results are recorded below.

## Verification (2026-10-15)

The full test suite was run on the current tree after the changes below. Every command in README "Tests and measurements" except the benchmarks passed:

- `cargo test --workspace`: 654 Rust tests (unit, parity, allocation); `cargo build --workspace --target wasm32-unknown-unknown`; the math crate on `wasm32-wasip1`, scalar and SIMD.
- `node parity/bindings/compat-check.mjs`: 1,537 values of the object API against stored three.js values (34 groups; 8 groups added this session cover colour spaces, `Triangle`, `Line3`, `Spherical`, `Cylindrical`, `Box3.setFromObject`, geometry copies, normalized and interleaved attributes, the new materials and maps, line loops, `LOD`, per-instance and sprite picking). Largest scaled error 5.7e-6.
- `node parity/bindings/check.mjs`: 44,179 values of the low-level API against three.js live.
- `node parity/visual/run.mjs`: 28 cases against stored three.js WebGPU images, including 5 new ones: `materials` (Phong, toon, normal, emissive, line loop), `vertex_alpha`, `environment`, `background_blurred` and `texture_maps`.
- `tsc -p parity/bindings` (TypeScript 5, through `npx`), with the typecheck program extended to the new API.
- `node examples/ports/check.mjs --three`, `node examples/webgpu/smoke.mjs`, `node examples/showcase/check.mjs`, `node examples/browser/smoke.mjs`.

No benchmark or profiling has been run since these changes; see "Measurements".

## Done in this round

- **Physically based lighting follows three.js.** The standard material now uses three.js's split-sum table (16 × 16, read with bilinear filtering), works out indirect scattering for a dielectric and a metal and mixes them by metalness, keeps diffuse energy conservation on the dielectric path, takes `1 − F` from the direct diffuse term, compensates direct specular for multiple scattering, and widens roughness where the normal turns quickly across a pixel. Light from ambient and hemisphere lights is diffuse only, as in three.js. Mean differences from three.js fell from 1.03 to 0.04 of 255 (`lights`), 1.43 to 0.04 (`lights_many`) and 0.20 to 0.02 (`sphere`); the earlier "strong-light comparison differs by about 1.8/255" is resolved.
- **Texture maps.** `normalMap` and `normalScale` (tangent space, frame from screen-space derivatives), `roughnessMap` (g), `metalnessMap` (b), `emissiveMap` (rgb), `alphaMap` (read from r, as three.js's WebGPU renderer does), `aoMap` (r) and `aoMapIntensity`, and `alphaTest`, on the materials that have them in three.js. Seven texture slots per draw; the engine interns each frame's distinct texture sets so the host makes one bind group per set. All maps share one uv transform.
- **Environment maps and backgrounds in the object API** (added in the previous round, now verified): `scene.environment`, `environmentIntensity`, `environmentRotation`, `envMap`, `envMapIntensity`, `envMapRotation`, and texture backgrounds with `backgroundBlurriness`, `backgroundIntensity` and `backgroundRotation`. Running the new visual cases found and fixed a bug: the prefiltering pass used an automatic pipeline layout that left out a binding, so no environment was ever prefiltered.
- **Previously added, now verified:** `MeshPhongMaterial`, `MeshToonMaterial`, `MeshNormalMaterial`, `MeshPhysicalMaterial` (drawn as standard), `emissive`, `LineLoop`, `LOD`, four-component vertex colours, per-instance and sprite picking, `Box3.setFromObject`, `BufferGeometry.clone`/`copy`/`setFromPoints`, normalized and interleaved attributes, `Triangle`, `Line3`, `Spherical`, `Cylindrical`, colour-space arguments, `uuid`.
- **Typings.** Getters of engine values (`box.min`, `ray.origin`) are typed as the object-API classes they return.
- **Modules.** Source files over about 1,000 lines were split by area without changing public APIs; the generated wasm-bindgen API is identical (checked by diffing `wamr3d_wasm.d.ts`), and `compat.js` exports the same 138 names:
  - `engine/bindings/js/compat.js` (4,769 lines) is now the entry point (109 lines) over `compat/`: `constants`, `engine` (World, batching, registries), `math`, `transform`, `object3d`, `objects`, `cameras`, `lights`, `geometry`, `textures`, `materials`, `picking`, `renderer`.
  - `engine/bindings/js/webgpu.js` (1,125) keeps the host; prefiltering and the background pass moved to `webgpu/environment.js`, shared formats to `webgpu/formats.js`.
  - `engine/bindings/src/lib.rs` (2,105) keeps the math base classes and `World`; `renderer.rs`, `picking.rs`, `world.rs` and `resources.rs` hold the rest. `bindings/src/math.rs` (1,215) moved the shapes to `math/shapes.rs`.
  - `engine/renderer_webgpu/src/lib.rs` (1,755) keeps the types; `shaders.rs`, `frame.rs`, `dfg.rs` and `tests.rs` hold the rest.
  - `engine/core/src/world.rs` (1,232) moved its tests to `world/tests.rs`.
- **Website** builds against the local package (`dist/wamr3d`, linked as `file:../dist/wamr3d`), not the published 0.3.0.

## Measurements

Historical benchmark runs made before the latest renderer and API changes:

- `bench/results/2026-10-15-webgl/`: the current run, which the website (`website/src/data/benchmarks.js`) and the README quote. Six showcase engines including WAMR3D batched and object API on the WebGL 2 renderer, four resolutions; the 3840×2160 comparison scene was skipped for time (`benchmark-data.mjs` lists it as missing). Showcase summed over 28 configurations: WAMR3D batched 1.3× the frame rate of the faster three.js renderer, 2.2× less CPU per frame.
- `bench/results/2026-10-14/`: the earlier complete run, before texture maps, the three.js lighting model and the WebGL 2 backend.
- `bench/results/2026-10-15/`: a later run of the same set; the 3840×2160 scene comparison failed (`compare-3840x2160.txt` holds a `measure.mjs` error), the other files are complete. Superseded by `2026-10-15-webgl`.
- `bench/results/2026-10-15-current/`: fresh Node.js, compatibility, 1280×720 showcase, 100,000-instance showcase and browser comparison results. The higher-resolution logs were copied from the earlier same-day run; the 3840×2160 comparison remains unavailable.

The fresh benchmark run is recorded below. Changes that can affect future runs include seven texture bindings per draw instead of one (bind groups per distinct texture set), the standard material's longer lighting code, and the object API split into modules (bundlers and the browser now load 14 files instead of 1). The SIMD module is 566.9 KiB.

## Fresh verification and benchmarks (2026-10-15)

- `cargo test --workspace`: 655 tests passed; `cargo build --workspace --target wasm32-unknown-unknown`: passed.
- `node engine/bindings/build.mjs`: passed, producing a 566.9 KiB SIMD Wasm module.
- `node parity/bindings/compat-check.mjs`: passed, 1,537 stored-reference values; largest scaled error 5.692e-6.
- `node parity/bindings/check.mjs`: passed, 44,179 live-reference values; largest scaled error 6.147e-6.
- `tsc -p parity/bindings`: passed.
- Browser checks passed: `node examples/ports/check.mjs --three` (eight remaining pages on both engines), `node examples/browser/smoke.mjs`, `node examples/webgpu/smoke.mjs`, `node examples/showcase/check.mjs`, and `node parity/visual/run.mjs` (28 cases).
- Fresh benchmark logs are in `bench/results/2026-10-15-current/`. Node microbenchmarks and the browser showcase/comparison were rerun at 1280×720; the higher resolutions were carried forward from the earlier run on the same date. The comparison scene has no 3840×2160 result. `website/src/data/benchmarks.js` was regenerated from these logs.
- At 1280×720, 10,000 separate meshes ran at 60 fps on WAMR3D WebGPU with 13.2 ms CPU submission, versus 12 fps and 78.9 ms for three.js WebGPU. For 100,000 instanced bodies, WAMR3D ran at 33 fps with 25.6 ms CPU update, versus 10 fps and 80.5 ms for three.js WebGPU. In Node, one batched 10,000-transform update took 1.45 ms versus 2.72 ms for three.js; individual math operations remain slower across the Wasm boundary.
- `npm run build --prefix website`: passed. Vite externalized Node's `fs/promises` import from the local package as expected for browser builds.

## Ported examples

`examples/ports/` holds three.js games and scenes run on WAMR3D through `wamr3d/compat` with the import changed: Crossy Road and Stack (Hunor Márton Borbély), City 3D (Victor Vergara), and the official examples `webgl_geometry_minecraft` and `webgl_lights_spotlights`, plus three pages written for WAMR3D (`fluid-particles`, `water`, `car`). The four BufferGeometry and picking example ports were removed from the site and repository. `?engine=three` runs the remaining ported code on three.js.

The ports still carry workarounds written when features were missing; they can now be removed: Phong and toon stand-ins in `city` and `spotlights`, the hand-built boxes instead of `Box3.setFromObject` in `crossy-road`, and the missing reflections in `water` and `car`.

## Undeveloped and incomplete work

### Renderer and materials

- Cube textures (`CubeTexture`, `CubeTextureLoader`) for environments and backgrounds; render-target textures as environment or background; more than one environment map per frame.
- Per-map uv transforms and second uv sets (`texture.channel`); `lightMap`, `bumpMap`, `displacementMap`, `specularMap`, `gradientMap`; a `tangent` attribute for normal maps; alpha test in shadow maps.
- The physical extensions of `MeshPhysicalMaterial` (clearcoat, sheen, transmission, iridescence).
- Point-light shadows, area lights and shadow filtering modes other than PCF.
- Post-processing, render-target depth textures and multiple render-target attachments.
- On WebGL 2: multisampled render targets; 1-pixel points and lines differ slightly from WebGPU (visual cases `points` and `lines`); without `EXT_color_buffer_float` it falls back to sRGB blending.
- Lines wider than one pixel; points larger than one pixel (as in three.js's WebGPU renderer).

### Object API and geometry

- `SkinnedMesh`, `Bone`, `ShaderMaterial`, wireframes.
- Morph targets; integer vertex attributes reaching the shader as integers (they are converted to floats).
- Geometry primitives beyond box, plane, sphere, cylinder, cone, circle, ring and torus.

### Supporting systems

- Loaders beyond `TextureLoader` (glTF would be an add-on), animation, audio, controls and more helpers.

## Constraints

The renderer targets WebGPU. TSL/node-based rendering, WebGL backends, and the listed out-of-scope Three.js systems remain unported. No schedule is assigned to these items.
