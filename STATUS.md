# STATUS.md: WAMR3D

## Release

- Version **`0.9.3`** (not yet published; the website installs `wamr3d@^0.9.2` from npm). 0.9.3: the 2026-10-21 performance work below (WebGPU DFG table as a uniform, lazy multisampled target, per-material draw submission, packed sort keys, `IdHashMap`) and `Renderer.dfgTable()`. 0.9.1: faster per-object transform setters, lazy Euler angles after quaternion writes, single-copy geometry uploads, and object-API `Euler.set` and matrix `copy`. 0.9.2: the `wamr3d/math` entry, JavaScript math values for use next to the low-level API. The npm package (`engine/bindings/js/package.json`) and the Rust bindings crate (`engine/bindings/Cargo.toml`); internal crates stay at `0.1.0`.

## Verification (2026-10-21, on the current tree)

| Check | Result |
|---|---|
| `cargo test --workspace` | 668 passed |
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

`engine/math` did not change, so its `wasm32-wasip1` runs were not repeated (last: 501 / 502 passed, 6 ignored, 2026-10-19).

Re-run on 2026-10-22 after the version change to `0.9.3` (build of `dist/wamr3d`, 738.6 KiB of Wasm): `cargo test --workspace` 668 passed; the `wasm32-unknown-unknown` build; `test:api` 1537 values (5.7e-6); `parity/bindings/check.mjs` 44,179 values (6.1e-6); `test:gltf` / `test:loaders` / `test:controls` 13 / 14 / 9 passed; typings without errors; `npm run build --prefix website`. The browser checks above were not repeated (only the version changed).

## Benchmarks (2026-10-21)

[`bench/results/`](bench/results/), 0.9.3 tree: Node.js suites, showcase at 1280×720 and 3840×2160, 100,000 instanced and the comparison scene at 3840×2160 (i9-10900X, RTX 2070 SUPER, Chrome 156). 1920×1080 and 2560×1440 were not run. Results now live in one fixed folder that each run replaces (`bench/run-browser.ps1` clears it; git history keeps older runs); the dated folders `2026-10-19`, `2026-10-20-mixed` and `2026-10-21` are gone. Headline: 50,000 separate meshes at 3840×2160 on WebGPU, 16.7 fps against 2.1 fps for three.js WebGPU (8.0×); summary table in [BENCHMARKS.md](BENCHMARKS.md#last-run). The website data (`website/src/data/benchmarks.js`) was regenerated from this run; the generator now reads UTF-16 logs, repairs the code-page-437 "·", accepts the `JS math` showcase engines and skips sizes that were not run.

## Performance work (2026-10-21)

Found by profiling (method in [PERFORMANCE.md](PERFORMANCE.md#how-to-measure)), each change measured before and after in the same session. Figures: [PERFORMANCE.md](PERFORMANCE.md#known-costs-and-results).

- **WebGPU fragment cost (the largest problem).** The mesh shader read the split-sum (DFG) table as a 256-entry WGSL `const` array indexed at run time, which the WGSL compiler (Dawn on D3D12) rebuilt in every fragment invocation: a 3840x2160 canvas with a dozen standard-material meshes ran at 30 fps where WebGL 2 ran at 60. The table is now a uniform (`@group(0) @binding(1)`, filled once from `Renderer.dfgTable()`); values and lookups are unchanged. GLSL keeps its `const` array: ANGLE emits it as a `static const`, which D3D places in constant memory.
- **WebGPU memory.** The 4x multisampled canvas-format target is made only when a frame is drawn without tone mapping (tone-mapped frames use the linear target): 127 MiB at 3840x2160.
- **Draw submission, both hosts.** Draws are ordered by depth, so materials alternate from draw to draw; feature keys (strings), program and pipeline lookups are now made once per material and pass instead of once per draw. WebGPU passes dynamic offsets as a reused `Uint32Array`; WebGL 2 no longer re-disables polygon offset and the stencil test for every material, and reads the material view once per draw.
- **Frame preparation (Rust).** Draws sort on packed `u128` keys (category, render order, depth, index) with an unstable sort, which gives the order of the previous stable sort without reading entries; per-geometry attribute lookups are made once for a run of objects sharing a geometry; maps keyed by handles use a multiply-rotate hasher (`wamr_core::IdHashMap`) instead of SipHash.
- **World matrices (Rust).** Camera cells are boxed: the camera column spans every entity up to the last camera, and each world-matrix update looked every object up in it, reading a whole camera-sized cell per object.

Added API: `Renderer.dfgTable()` (low-level, for hosts, like `Renderer.shaderSource()`); `wamr_core::IdHashMap` (Rust).

### Needs decision

- The low-level Wasm math classes (`Vector3`, `Matrix4`… from `wamr3d`) cost 1.5x to 9x three.js's time per operation, because each method is a call into WebAssembly (1.46x to 8.31x in `bench/results/math.txt`). `wamr3d/math` (JavaScript values) is at three.js's speed. Making the `wamr3d` exports JavaScript classes would change the low-level API (`raycast` and `applyMatrix4ToGeometry` take the Wasm classes, and they have `free()`); not done.

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported (AGENTS.md, risk R1): no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU, since GLSL cannot run there (three.js's WebGPURenderer does not take GLSL either). On WebGL 2 it receives lights and fog but no shadows (`receiveShadow` is false; no shadow-map chunks). A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes; wide line loops lack their closing segment.
- `UnrealBloomPass` uses kernel sizes 3 to 11 and white tints.
- Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled.
- WebGL 2: 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU; without `EXT_color_buffer_float` it blends in sRGB and skips tone mapping, float targets, environments and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Tested in Chromium-based browsers only; Firefox and Safari have not been tried.