# STATUS.md: WAMR3D

## Release

- Version **`0.9.0`**: the npm package (`engine/bindings/js/package.json`) and the Rust bindings crate (`engine/bindings/Cargo.toml`); internal crates stay at `0.1.0`.
- The latest version on npm is `0.8.0`, and the website's own pages depend on it until `0.9.0` is published ([NPM.md](NPM.md)).
- Compared with `0.8.0`: mesh shaders are built per material features, WebGL 2 programs are linked in parallel, and `renderer.compileAsync` is new ([Startup](#startup)). Custom hosts of the low-level `Renderer` need no change: the new shader constants default to the previous behaviour.
- Compared with `0.7.5`, the vertex layout (a fifth auxiliary attribute, `lineDistance`, 60-byte stride) and the material block (512 floats) changed. Code that drives the low-level `Renderer` with its own host must follow both.

## Verification (2026-10-19, on the current tree)

| Check | Result |
|---|---|
| `cargo test --workspace` | 663 passed |
| `engine/math` on `wasm32-wasip1`, scalar / SIMD | 501 / 502 passed, 6 ignored |
| `npm run test:api` (object API against stored three.js values) | 1537 values, largest scaled error 5.7e-6 (tolerance 1e-5) |
| `npm run test:gltf` / `test:loaders` / `test:controls` | 13 / 14 / 9 passed, none failed |
| `tsc -p parity/bindings` (typings) | no errors |
| `node parity/visual/run.mjs` (WebGPU) | 37 of 37 cases pass |
| `node parity/visual/run.mjs --backend=webgl` | 34 of 37 pass; `lines`, `points` and `wireframe` differ by 2.5–4.4% of pixels (WebGL 2 rasterizes 1-pixel primitives differently) |
| `examples/webgpu/smoke.mjs`, `examples/browser/smoke.mjs`, `examples/showcase/check.mjs` | all pass |
| `examples/ports/check.mjs --three` and `--webgl` | all eight ports draw on WAMR3D, on three.js and on WebGL 2 |
| `npm run build --prefix website` | builds; the built site starts and draws its hero scene |

Also run: `node parity/bindings/check.mjs` (44,179 values against three.js live, largest scaled error 6.1e-6). `examples/ports/check.mjs` covers all eight ports, `car` and `city` included. The showcase check passes 13 of 13 on three runs after a fix: the WebGPU backend now destroys its device only after the submitted work is done (destroying it earlier could freeze the page during a renderer swap).

## Startup

The site froze for several seconds on load because of how its shaders were built, not because of scene work:

- The mesh shader was one program covering every material feature behind run-time branches. Its fragment stage had about 1,200 lines and 30 map reads, each through a 12-way texture switch. On WebGL 2 (ANGLE on Direct3D 11), linking it held the main thread for 5.6 s on a fast desktop. On WebGPU the three pipelines built from it stalled frames for 2.3 s after the first one.
- Now each material gets programs built for its features. Its shading mode, the maps it has, its physical layers (clearcoat, sheen, iridescence, anisotropy, transmission), its environment and alpha-hash/dash state, and the frame's shadowed and area lights are compile-time constants (`#define` in GLSL, `override` in WGSL), so code for absent features is not compiled. The results are unchanged: a constant is set only where the material's own value is known to be off. With every feature off, the link took 0.77 s instead of 5.6 s.
- WebGL 2 starts every program a frame needs before it queries any, so drivers that compile on worker threads build them in parallel.
- `renderer.compileAsync( scene, camera )` (three.js API) builds the programs or pipelines beforehand. It polls `KHR_parallel_shader_compile` on WebGL 2 and uses `createRenderPipelineAsync` on WebGPU, so the page is not blocked. The website's hero scene calls it when the package provides it.

Measured on the hero scene with a Chrome DevTools Protocol trace of GL/GPU calls, long tasks and frame gaps, on the same desktop. These are single profiling runs, not benchmarks:

| | Before | Specialised | With `compileAsync` |
|---|---|---|---|
| WebGL 2: longest main-thread task | 5.75 s (first frame at about 6 s) | 0.65 s (first frame at 0.47 s) | none over 50 ms |
| WebGPU: frame stall after the first frame | 2.3 s | 0.82 s | none over 50 ms |

A new combination of features builds its program on the first frame that draws it, unless `compileAsync` covered it, as in three.js. Slower GPUs and drivers take longer.

## Benchmarks

- [`bench/results/2026-10-18/`](bench/results/2026-10-18/): the release tree at 1280×720 — Node.js (`bench.txt`, `compat.txt`) and the showcase (`showcase-1280x720.txt`, `showcase100k-1280x720.txt`; its 50,000 instanced rows come from a second run on the same build). The three.js comparison scene (`examples/compare/measure.mjs`) was not run for this release. Every engine ran slower in this session than on 2026-10-16 (three.js at 10,000 objects: 28% fewer frames on WebGPU, 42% on WebGL), so compare engines within a run, not across runs.
- [`bench/results/2026-10-16/`](bench/results/2026-10-16/): the last complete set (four resolutions, showcase and comparison), measured on the 0.7 tree. The website's benchmarks page shows this set.

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported (AGENTS.md, risk R1): no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU, since GLSL cannot run there (three.js's WebGPURenderer does not take GLSL either). On WebGL 2 it receives lights and fog but no shadows (`receiveShadow` is false; no shadow-map chunks). A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes; wide line loops lack their closing segment.
- `UnrealBloomPass` uses kernel sizes 3 to 11 and white tints.
- Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled.
- WebGL 2: 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU; without `EXT_color_buffer_float` it blends in sRGB and skips tone mapping, float targets, environments and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Tested in Chromium-based browsers only; Firefox and Safari have not been tried.

## Ported examples

`examples/ports/` holds three.js games and scenes run on WAMR3D through `wamr3d/compat` with only the import changed: Crossy Road and Stack (Hunor Márton Borbély), City 3D (Victor Vergara), the official examples `webgl_geometry_minecraft` (`voxel-world`) and `webgl_lights_spotlights`, and three pages written for WAMR3D (`fluid-particles`, `water`, `car`). `?engine=three` runs the ported code on three.js.
