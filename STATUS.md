# STATUS.md: WAMR3D

## Release

- Version **`0.9.4`**

## Verification

| Check | Result |
|---|---|
| `cargo test --workspace` | 669 passed; 1 ignored manual benchmark |
| `cargo build --workspace --target wasm32-unknown-unknown` | builds |
| `npm run test:api` (object API against stored three.js values) | 1537 values, largest scaled error 5.7e-6 (tolerance 1e-5) |
| `node parity/bindings/check.mjs` (low-level API against three.js live) | 44,179 values, largest scaled error 6.1e-6 |
| `npm run test:gltf` / `test:loaders` / `test:controls` | 13 / 14 / 9 passed, none failed |
| `tsc -p parity/bindings` (typings) | no errors |
| `node parity/visual/run.mjs` (WebGPU) | 37 of 37 cases pass |
| `node parity/visual/run.mjs --backend=webgl` | 34 of 37 pass; `lines`, `points` and `wireframe` differ by 2.5–4.4% of pixels (WebGL 2 rasterizes 1-pixel primitives differently), as before |
| `examples/webgpu/smoke.mjs`, `examples/browser/smoke.mjs`, `examples/showcase/check.mjs` | all pass, none failed |
| `examples/ports/check.mjs --three` and `--webgl` | all eight ports draw on WAMR3D, on three.js and on WebGL 2 |
| `npm run build --prefix website` | builds (the site's own pages use the published npm package) |

Release 0.9.4 preparation (2026-10-23): `node engine/bindings/build.mjs` completed and generated a 764.6 KiB Wasm module. `npm pack --dry-run` from `dist/wamr3d` reports `wamr3d@0.9.4`, 178 files, and a 592.5 kB package archive. Not published. The website dependency remains on published `wamr3d@^0.9.3`; update it after the 0.9.4 package is published, as described in CONTRIBUTING.md.

`engine/math` did not change, so its `wasm32-wasip1` runs were not repeated (last: 501 / 502 passed, 6 ignored, 2026-10-19).

Re-run on 2026-10-22 after the version change to `0.9.3` (build of `dist/wamr3d`, 738.6 KiB of Wasm): `cargo test --workspace` 668 passed; the `wasm32-unknown-unknown` build; `test:api` 1537 values (5.7e-6); `parity/bindings/check.mjs` 44,179 values (6.1e-6); `test:gltf` / `test:loaders` / `test:controls` 13 / 14 / 9 passed; typings without errors; `npm run build --prefix website`. The browser checks above were not repeated (only the version changed).

## Performance work

Found by profiling (method in [PERFORMANCE.md](PERFORMANCE.md#how-to-measure)), each change measured before and after in the same session. Figures: [PERFORMANCE.md](PERFORMANCE.md#known-costs-and-results).

- **WebGPU fragment cost (the largest problem).** The mesh shader read the split-sum (DFG) table as a 256-entry WGSL `const` array indexed at run time, which the WGSL compiler (Dawn on D3D12) rebuilt in every fragment invocation: a 3840x2160 canvas with a dozen standard-material meshes ran at 30 fps where WebGL 2 ran at 60. The table is now a uniform (`@group(0) @binding(1)`, filled once from `Renderer.dfgTable()`); values and lookups are unchanged. GLSL keeps its `const` array: ANGLE emits it as a `static const`, which D3D places in constant memory.
- **WebGPU memory.** The 4x multisampled canvas-format target is made only when a frame is drawn without tone mapping (tone-mapped frames use the linear target): 127 MiB at 3840x2160.
- **Draw submission, both hosts.** Draws are ordered by depth, so materials alternate from draw to draw; feature keys (strings), program and pipeline lookups are now made once per material and pass instead of once per draw. WebGPU passes dynamic offsets as a reused `Uint32Array`; WebGL 2 no longer re-disables polygon offset and the stencil test for every material, and reads the material view once per draw.
- **Frame preparation (Rust).** Draws sort on packed `u128` keys (category, render order, depth, index) with an unstable sort, which gives the order of the previous stable sort without reading entries; per-geometry attribute lookups are made once for a run of objects sharing a geometry; maps keyed by handles use a multiply-rotate hasher (`wamr_core::IdHashMap`) instead of SipHash.
- **World matrices (Rust).** Camera cells are boxed: the camera column spans every entity up to the last camera, and each world-matrix update looked every object up in it, reading a whole camera-sized cell per object.

### External ideas reviewed (2026-10-23)

Reviewed the three snippets and six techniques in [iniGlowee/threejs-game-optimization](https://github.com/iniGlowee/threejs-game-optimization). These are candidates, not measured WAMR3D results:

- **BVH raycasting and cached candidate sets:** added a cached triangle BVH for mesh geometry with at least 16 triangles. Nodes split on the largest centroid axis; geometry attribute/index versions invalidate the cache, and replacing geometry data clears it. Smaller geometry keeps the linear path. In an optimized Rust test benchmark, 200 rays through a 32,768-triangle grid took 0.163–0.215 ms with a warm BVH versus 230–236 ms for the linear scan (about 1,070–1,450x faster for this sparse-hit workload). Building the BVH plus the first ray took 28–30 ms, so the measured break-even is roughly 25 rays. The CPU model was unavailable in the sandbox. Candidate-set caching remains application-specific because visibility and scene membership are app-specific.
- **Freeze static matrices:** already supported through `matrixAutoUpdate = false`, and the Rust world-matrix update skips clean subtrees. A convenience helper could reduce object-API update work for static loaded scenes, but must exclude animated/skinned content and preserve parent/world-transform semantics. The snippet is a possible reference, not a need to duplicate the existing behavior.
- **KTX2/Basis texture compression:** the loader already supports `KHR_texture_basisu` through `setKTX2Loader`; the repository also supports meshopt compression. The content-hash encode cache is an asset-build workflow idea, not runtime engine work.
- **Pixel-ratio cap:** the renderer exposes `setPixelRatio`; an automatic cap would alter rendering quality and should remain an application quality choice unless a compatible opt-in/default policy is decided.
- **Strip `KHR_materials_specular`:** not safe as a general loader optimization because it changes material appearance. It may be useful as an opt-in asset preprocessing tool for projects that verify the extension is unnecessary.
- **Near-plane dither fade:** an app-specific occlusion effect that avoids transparency sorting, but requires custom shader injection and changes pixels. Not a general renderer optimization to apply automatically.

The BVH is implemented as described above; the other ideas remain review notes, with no performance claim implied.

The BVH implementation was verified with `cargo test --workspace` and `cargo build --workspace --target wasm32-unknown-unknown`; both passed. `cargo fmt --all` could not run because `rustfmt` is not installed for the active toolchain.

Added API: `Renderer.dfgTable()` (low-level, for hosts, like `Renderer.shaderSource()`); `wamr_core::IdHashMap` (Rust).

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported (AGENTS.md, risk R1): no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU, since GLSL cannot run there (three.js's WebGPURenderer does not take GLSL either). On WebGL 2 it receives lights and fog but no shadows (`receiveShadow` is false; no shadow-map chunks). A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes; wide line loops lack their closing segment.
- `UnrealBloomPass` uses kernel sizes 3 to 11 and white tints.
- Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled.
- WebGL 2: 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU; without `EXT_color_buffer_float` it blends in sRGB and skips tone mapping, float targets, environments and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Tested in Chromium-based browsers only; Firefox and Safari have not been tried.
