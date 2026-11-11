# STATUS.md: WAMR3D

## Release

- Version **`0.9.5`** (2026-11-11)

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported: no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU because GLSL shaders are WebGL-only. On WebGL 2 it supports lights and fog when `lights` and `fog` are enabled, but not shadows or rectangular area lights. A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes.
- `UnrealBloomPass` uses five fixed blur kernels (3, 5, 7, 9, 11); per-level bloom tint colors are not applied.
- Rectangular area-light diffuse evaluation is implemented, while specular and clearcoat highlights are approximated without LTC tables. Skinned meshes are frustum-culled using posed-vertex bounds.
- **WebGL 2:** 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU. Without `EXT_color_buffer_float`, rendering falls back to 8-bit targets, blends in the sRGB canvas, and disables tone mapping, float render targets, environment maps and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Frame preparation writes draws in sorted order: about 3.4 ms of 17 ms for 39,000 draws natively. Reading blocks through an index instead would break the consecutive blocks that instanced batching needs.
- `renderer.info.render.calls` counts objects drawn, as three.js does, not the fewer instanced draws the hosts issue.
- Browser checks have run only in Chromium-based browsers; Firefox and Safari have not been tried.

## Verification

2026-11-11, on the 0.9.5 tree (i9-10900X, RTX 2070 SUPER, Chrome 157, Windows): `cargo test --workspace` (674 passed) and the `wasm32` build; visual parity 39 of 39 on WebGPU and 36 of 39 on WebGL 2 (the known `lines`, `points` and `wireframe` differences); `test:api`, `reference:api`, `test:types`, `test:gltf`, `test:loaders`, `test:controls`; both smoke checks, the showcase check and the ported examples on both backends; the WebGL 2 path without uniform-buffer ranges, forced.

## Needs decision

Nothing open.
