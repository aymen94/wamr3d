# STATUS.md: WAMR3D

## Release

- Version **`0.9.5`** (2026-11-11)

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported: no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU because GLSL shaders are WebGL-only. On WebGL 2 it supports lights and fog when `lights` and `fog` are enabled, but not shadows or rectangular area lights. A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes.
- `GLTFLoader` plugins registered with `register()` get the parser and their `beforeRoot` and `afterRoot` hooks; the other hooks of three.js's plugin interface (`loadMesh`, `loadMaterial`, `extendMaterialParams`, `getMaterialType` and the rest) are not called.
- `UnrealBloomPass` uses five fixed blur kernels (3, 5, 7, 9, 11); per-level bloom tint colors are not applied.
- Rectangular area-light diffuse evaluation is implemented, while specular and clearcoat highlights are approximated without LTC tables. Skinned meshes are frustum-culled using posed-vertex bounds.
- **WebGL 2:** 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU. Without `EXT_color_buffer_float`, rendering falls back to 8-bit targets, blends in the sRGB canvas (so partly covered pixels of a transparent canvas are not premultiplied in sRGB as three.js does), and disables tone mapping, float render targets, environment maps and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Frame preparation writes draws in sorted order: about 3.4 ms of 17 ms for 39,000 draws natively. Reading blocks through an index instead would break the consecutive blocks that instanced batching needs.
- `renderer.info.render.calls` counts objects drawn, as three.js does, not the fewer instanced draws the hosts issue.
- Browser checks have run only in Chromium-based browsers; Firefox and Safari have not been tried.
- **WebGPU:** a pooled geometry whose index changes is placed in its pool again, which writes all its attributes again (2,000 geometries whose index changes every frame: 12.1 ms a frame instead of 3.2 ms, Apple M4). The WebGL 2 host uploads only the index.

## Verification

2026-11-22, WebGL 2 geometry pools (Apple M4, macOS, Chrome for Testing via Playwright, ANGLE on Metal): visual parity 37 of 40 on WebGPU and 36 of 40 on WebGL 2; `fog`, `lines` and `wireframe` (and `points` on WebGL 2) fail on this machine with the same figures on the previous `main` build, so they are differences of the macOS drivers. Both smoke checks, the showcase check, the ported examples on WebGL 2 and `test:api` pass. Pooled geometries (meshes, points, lines, wireframe, a shader material with its own attribute, instances, shadows) give the same pixels as before pools through attribute, index, size and dispose changes, pool growth, and reordered, shortened, removed and restored indices. Pools no geometry is in are freed on both backends (WebGPU buffers 15.4 MB → 4.4 MB once a scene of 2,000 geometries is emptied); in builds with small pools for the test, geometries a full pool refused join it once space is freed, and pools grow up to their limit; the same pixels throughout.

2026-11-16, after the transparent canvas and `compileAsync` passes (i9-10900X, RTX 2070 SUPER, Chrome, Windows): `cargo test --workspace` (679 passed), visual parity 40 of 40 on WebGPU and 37 of 40 on WebGL 2 (the known differences), `test:api`, `test:gltf`, `test:types` and both smoke checks.

2026-11-11, on the 0.9.5 tree (i9-10900X, RTX 2070 SUPER, Chrome 157, Windows): `cargo test --workspace` (674 passed) and the `wasm32` build; visual parity 39 of 39 on WebGPU and 36 of 39 on WebGL 2 (the known `lines`, `points` and `wireframe` differences); `test:api`, `reference:api`, `test:types`, `test:gltf`, `test:loaders`, `test:controls`; both smoke checks, the showcase check and the ported examples on both backends; the WebGL 2 path without uniform-buffer ranges, forced.

## Needs decision

Nothing open.
