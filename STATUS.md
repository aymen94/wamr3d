# STATUS.md: WAMR3D

## Release

- Version **`0.9.4`**

## Limitations

- **TSL / node materials** (`src/nodes/`, `src/materials/nodes/`) are not ported (AGENTS.md, risk R1): no node materials and no node-based post-processing.
- **`ShaderMaterial`** draws unlit on WebGPU because GLSL shaders are WebGL-only. On WebGL 2 it supports lights and fog when `lights` and `fog` are enabled, but not shadows or rectangular area lights. A `ShaderPass` with GLSL other than the built-in passes needs WebGL 2.
- `LineMaterial.dashOffset` does not move the dashes.
- `UnrealBloomPass` uses five fixed blur kernels (3, 5, 7, 9, 11); per-level bloom tint colors are not applied.
- Rectangular area-light diffuse evaluation is implemented, while specular and clearcoat highlights are approximated without LTC tables. Skinned meshes are frustum-culled using posed-vertex bounds.
- **WebGL 2:** 1-pixel points, lines and wireframes rasterize slightly differently from WebGPU. Without `EXT_color_buffer_float`, rendering falls back to 8-bit targets, blends in the sRGB canvas, and disables tone mapping, float render targets, environment maps and VSM.
- `wireframeLinewidth` other than 1, `CustomToneMapping`, `DataTexture` formats other than RGBA, and offset, repeat or rotation of background textures warn and have no effect.
- Browser checks have run only in Chromium-based browsers; Firefox and Safari have not been tried.
