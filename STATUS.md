# STATUS.md: WAMR3D

## Release

- Version **`0.9.5`** (2026-11-11)

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported: no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU because GLSL shaders are WebGL-only. On WebGL 2 it supports lights, fog and shadows (three.js's `shadowmap_*` and `shadowmask_pars_fragment` chunks, from the engine's shadow maps) when `lights` and `fog` are enabled, but not rectangular area lights or spot light maps (`SpotLight.map`). Its `directionalShadowMap` and the other shadow "maps" are `vec4` handles, not samplers: code that passes them to `getShadow` and `getPointShadow` works, code that samples them itself does not. A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- **`ShaderMaterial` output colour:** what a shader material writes reaches the canvas as in three.js's WebGLRenderer (unchanged, or encoded by `colorspace_fragment` / `linearToOutputTexel`). With tone mapping on, the output pass tone-maps every pixel, so a shader material without `tonemapping_fragment`, or with `toneMapped` false, is tone-mapped where three.js leaves it, and so is the background colour. Transparent shader materials blend in linear colour, where three.js's WebGLRenderer blends the encoded colours.
- **`ShaderMaterial` light order:** three.js lists a material's lights in scene order; WAMR3D meets the children of an object last first. Lights with shadows come first in both, so shadow i belongs to light i, but `directionalLights[ i ]` may name another light among those without shadows.
- `LineMaterial.dashOffset` does not move the dashes.
- `GLTFLoader` plugins registered with `register()` get the parser and their `beforeRoot` and `afterRoot` hooks; the other hooks of three.js's plugin interface (`loadMesh`, `loadMaterial`, `extendMaterialParams`, `getMaterialType` and the rest) are not called.
- VSM shadow edges are softer than three.js's WebGLRenderer draws them (about 1% of pixels differ by more than 12 of 255, with built-in and shader materials alike); they have not been compared with three.js's WebGPU VSM in a visual case.
- `UnrealBloomPass` uses five fixed blur kernels (3, 5, 7, 9, 11); per-level bloom tint colors are not applied.
- Rectangular area-light diffuse evaluation is implemented, while specular and clearcoat highlights are approximated without LTC tables. Skinned meshes are frustum-culled using posed-vertex bounds.
- **WebGL 2:** 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU. Without `EXT_color_buffer_float`, rendering falls back to 8-bit targets, blends in the sRGB canvas (so partly covered pixels of a transparent canvas are not premultiplied in sRGB as three.js does), and disables tone mapping, float render targets, environment maps and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Frame preparation writes draws in sorted order: about 3.4 ms of 17 ms for 39,000 draws natively. Reading blocks through an index instead would break the consecutive blocks that instanced batching needs.
- `renderer.info.render.calls` counts objects drawn, as three.js does, not the fewer instanced draws the hosts issue.
- Browser checks have run only in Chromium-based browsers; Firefox and Safari have not been tried.

## Verification

2026-11-17, `ShaderMaterial` output colour (same machine): visual parity 43 of 47 with `--backend=webgl` and 44 of 47 on WebGPU, the failures those of unchanged `main`; the two new `shader_output_*` cases pass against three.js WebGLRenderer images and the colour case fails without the decoding (mean difference 16 of 255); with `EXT_color_buffer_float` forced off the shader cases match exactly. `test:api`, `test:types`, `test:gltf`, `test:loaders`, `test:controls`, both smoke checks, the showcase, ports `--three` and `--webgl`.

2026-11-17, `ShaderMaterial` shadows on WebGL 2 (Apple M4, Chromium, macOS; ANGLE on Metal): `test:api` (with `UniformsLib` against three.js), `test:types`, `test:gltf`, `test:loaders`, `test:controls`, both smoke checks, the showcase check, the ported examples with `--three` and `--webgl`; visual parity 41 of 45 with `--backend=webgl` and 42 of 45 on WebGPU. The five new `shader_shadows_*` cases pass against three.js WebGLRenderer images; with the shadow mask or the light order broken on purpose they fail. On this machine `fog`, `lines` and `wireframe` (and `points` on WebGL 2) fail on unchanged `main` too, with the same numbers. The shader cases also pass with uniform-buffer ranges forced off. No Rust changed; `cargo test` was not run.

2026-11-16, after the transparent canvas and `compileAsync` passes (i9-10900X, RTX 2070 SUPER, Chrome, Windows): `cargo test --workspace` (679 passed), visual parity 40 of 40 on WebGPU and 37 of 40 on WebGL 2 (the known differences), `test:api`, `test:gltf`, `test:types` and both smoke checks.

2026-11-11, on the 0.9.5 tree (i9-10900X, RTX 2070 SUPER, Chrome 157, Windows): `cargo test --workspace` (674 passed) and the `wasm32` build; visual parity 39 of 39 on WebGPU and 36 of 39 on WebGL 2 (the known `lines`, `points` and `wireframe` differences); `test:api`, `reference:api`, `test:types`, `test:gltf`, `test:loaders`, `test:controls`; both smoke checks, the showcase check and the ported examples on both backends; the WebGL 2 path without uniform-buffer ranges, forced.

## Needs decision

- **Visual references from three.js's WebGLRenderer (D27).** GLSL shader materials cannot be drawn by three.js's WebGPU renderer, so the `shader_shadows_*` cases store references drawn by the pinned three.js WebGLRenderer and always draw WAMR3D with WebGL 2 (`WEBGL_REFERENCE` in `parity/visual/cases.js`). D27 in AGENTS.md and CONTRIBUTING.md describes this; the maintainer may prefer another way to check these cases.
