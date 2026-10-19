# STATUS.md: WAMR3D

## Release

- Version **`0.9.2`** (not yet published; npm has `0.9.0`). 0.9.1: faster per-object transform setters, lazy Euler angles after quaternion writes, single-copy geometry uploads, and object-API `Euler.set` and matrix `copy`. 0.9.2: the `wamr3d/math` entry, JavaScript math values for use next to the low-level API. The npm package (`engine/bindings/js/package.json`) and the Rust bindings crate (`engine/bindings/Cargo.toml`); internal crates stay at `0.1.0`.

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

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported (AGENTS.md, risk R1): no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU, since GLSL cannot run there (three.js's WebGPURenderer does not take GLSL either). On WebGL 2 it receives lights and fog but no shadows (`receiveShadow` is false; no shadow-map chunks). A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes; wide line loops lack their closing segment.
- `UnrealBloomPass` uses kernel sizes 3 to 11 and white tints.
- Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled.
- WebGL 2: 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU; without `EXT_color_buffer_float` it blends in sRGB and skips tone mapping, float targets, environments and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Tested in Chromium-based browsers only; Firefox and Safari have not been tried.