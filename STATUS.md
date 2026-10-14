# STATUS.md: WAMR3D

> three.js r186 is no longer kept in this repository (2026-10-14, DECISIONS.md D37). Older entries below that name `three/src/...` or builds of three.js refer to the pinned `three@0.186.1`.

**Current state: the native WebGPU renderer is the default everywhere, an application written against the supported three.js classes runs with the import changed, and `examples/showcase/` shows the same large animated scene on WAMR3D and on three.js with live timings. Since the milestone below it also has shadows (directional and spot), tone mapping, up to 16 lights, points, sprites and render targets, each checked against three.js r186 images. It is not a full three.js replacement: environment reflections are only partly built and not usable, and point-light shadows, area lights, post-processing, loaders, animation, audio, controls and a WebGL fallback do not exist.**
three.js is used only as a reference: the comparison engines of the showcase and of `examples/compare`, the optional adapter (`examples/browser/?renderer=three`), and the stored images.

## Publication readiness (2026-10-14)

The project has one maintained progress/handoff file (`STATUS.md`); there are no separate agent status files or tracked task lists to reconcile. The website, root README, npm package README, and migration page now describe the current renderer surface consistently. The parity page links all 23 stored visual cases, and the Pages build now includes the root favicon required by the copied demo pages.

The unused `website/examples/` mirror was removed (33 duplicate files); `examples/` is the source served in development and copied into the publication output. No other files were removed because their publication or reproducibility purpose was confirmed.

| Check | Result |
|---|---|
| `npm run build --prefix website` | pass; Vite bundle and Pages assets prepared |
| Built-site links and production preview | 66 local HTML references resolve; all 12 checked site, example, parity, favicon, docs, JS and Wasm URLs return HTTP 200 |
| `node parity/visual/run.mjs` | 23/23 pass, including shadows, points, sprites, tone mapping and render targets |
| `node examples/showcase/check.mjs` | 11/11 pass |
| `node examples/browser/smoke.mjs` | 9/9 pass |
| `node examples/webgpu/smoke.mjs` | 8/8 pass |
| Benchmark data | unchanged; website data is from the latest recorded four-resolution run and raw logs under `bench/results/2026-10-14/`. That run predates the renderer-feature milestone above; no benchmark experiment was repeated. |

The remaining engine gaps below are documented capability limits, not website-build blockers. GitHub Pages deployment and repository-level Pages settings have not been verified from this local checkout.

## Milestone: renderer features (2026-10-14)

Feature implementation stopped at this milestone; the website and browser smoke checks from the publication pass are recorded above. The tree builds (`node engine/bindings/build.mjs`, 488.3 KiB of wasm). Nothing in this section has been benchmarked: the benchmark results further down were measured before these changes.

### Implemented and verified

"Verified" means a case in `parity/visual/cases.js` whose reference image was drawn by three.js r186 (WebGPU renderer, from the CDN) and which WAMR3D matches within the agreed tolerance (mean difference 1.5 of 255, at most 2% of pixels off by more than 12).

| Feature | API | Visual cases (mean difference of 255) | Notes |
|---|---|---|---|
| More lights | up to 16 directional, point and spot lights (was 8) | `lights_many`, 12 point lights (1.434) | `Renderer.maxLights()` is 16; further lights are ignored with a warning |
| Tone mapping | `renderer.toneMapping`, `toneMappingExposure`; `NoToneMapping`, `LinearToneMapping`, `ReinhardToneMapping`, `CineonToneMapping`, `ACESFilmicToneMapping`, `AgXToneMapping`, `NeutralToneMapping` | `tonemapping_aces` (0.506), `_agx` (0.692), `_neutral` (0.429), `_linear` (0.405), `_reinhard` (0.405), `_cineon` (0.417) | As in three.js r186's WebGPU renderer, the frame is drawn into an `rgba16float` target and a full-screen output pass tone-maps every pixel, background included. So blending happens before tone mapping and `material.toneMapped` has no effect on screen output (it is accepted). `CustomToneMapping` draws like `NoToneMapping` with a warning |
| Shadows | `renderer.shadowMap.enabled`, `light.castShadow`, `object.castShadow`, `object.receiveShadow`; `light.shadow` with `mapSize`, `bias`, `normalBias`, `radius`, `intensity`, `camera` (orthographic for directional, perspective from the cone for spot), `focus` | `shadows_directional` (0.293), `shadows_spot` (0.031) | PCF filtering like three.js r186 `PCFShadowMap`: five comparisons on a Vogel disk turned by interleaved gradient noise, bilinear comparison sampling. Casters draw the opposite side of `material.side`. Up to 4 shadow-casting lights per frame (`Renderer.maxShadows()`), in one `depth32float` texture array sized to the largest map |
| Points | `Points`, `PointsMaterial` (`color`, `vertexColors`, `opacity`, `transparent`) | `points`, 12,000 vertex-coloured points (0.032) | One pixel per point, as with three.js r186's WebGPU renderer: `size` and `sizeAttenuation` are accepted and have no effect there either. `Raycaster` picks points with `params.Points.threshold` (ported `Points.raycast`) |
| Sprites | `Sprite`, `SpriteMaterial` (`color`, `map`, `rotation`, `sizeAttenuation`, `opacity`; transparent by default), `sprite.center` | `sprites` (0.003) | Camera-facing quad sized by the world scale, as three.js `SpriteNodeMaterial` |
| Render targets | `RenderTarget`, `WebGLRenderTarget` (same class), `renderer.setRenderTarget`, `getRenderTarget`, `target.texture` as a material map, `setSize`, `dispose` | `render_target` (0.002) | Linear colour without tone mapping, like three.js. `type`: `UnsignedByteType` (8-bit) or `HalfFloatType`/`FloatType` (16-bit float). `samples > 1` gives 4x MSAA when the renderer is antialiased. Drawn as three.js r186 WebGPU draws it: the texture appears upside down on a plane, and the reference image does the same |
| Smaller additions | `Vector2.width` and `.height` (aliases of `x`, `y`); constants `BasicShadowMap`, `PCFShadowMap`, `PCFSoftShadowMap`, `VSMShadowMap`, `UnsignedByteType`, `HalfFloatType`, `FloatType` | | |

Rust tests cover the frame layout of each feature (new tests in `engine/renderer_webgpu`: tone mapping packing, shadow casters and receivers, points and sprites, environment packing). The visual suite runner gained `--cases=a,b` and cases may return `setup( renderer )`.

### Partially implemented, not usable yet

- **Environment reflections (image-based lighting).** Built: the cube-UV sampling of three.js r186 `textureCubeUV` (`CUBE_UV` in `engine/renderer_webgpu`), the prefiltering passes of `PMREMGenerator` (equirectangular to cube-UV, then GGX convolution per level through a ping-pong target; `PMREM_SHADER` and `prefilter()` in `engine/bindings/js/webgpu.js`), the material terms (radiance along the reflection bent by roughness⁴, irradiance along the normal times π) in the mesh shader, and the bindings `setEnvironment`, `clearEnvironment`, `environmentInfo`, `setMaterialEnvironment`. **Missing:** the object API never calls them: `scene.environment`, `scene.environmentIntensity`, `scene.environmentRotation`, `material.envMap`, `envMapIntensity`, `envMapRotation` and the texture `mapping` constants are not wired in `engine/bindings/js/compat.js`, so the feature cannot be used yet and has no visual case. Next steps: wire those properties (the precedence rules are in three.js `MaterialProperties.js`: `material.envMap` wins over `scene.environment`, the rotation is inverted, intensity is `envMapIntensity` or `environmentIntensity`), add a visual case with an equirectangular `DataTexture`, and compare. Only `MeshStandardMaterial` is planned to use it; one environment per frame.
- **Shadow types.** Only PCF filtering exists; `BasicShadowMap`, `PCFSoftShadowMap` and `VSMShadowMap` draw as PCF with a warning.

### Not implemented

| Feature | State | Fallback |
|---|---|---|
| Point-light shadows | `castShadow` on a `PointLight` warns and draws without a shadow (three.js uses cube shadow maps) | three.js |
| Area lights (`RectAreaLight`) | throws "not available yet"; needs the LTC lookup tables | three.js |
| Post-processing | none; three.js r186's WebGPU post-processing is node-based (TSL), which v1 does not port (AGENTS.md R1). A render target plus a textured quad covers simple cases | three.js |
| Scene background textures, `backgroundBlurriness` | `scene.background` must be a `Color`; a texture is ignored with a warning | three.js |
| Loaders | only `TextureLoader`; no `ObjectLoader`, `BufferGeometryLoader`, `FileLoader`, `LoadingManager`; glTF is a three.js add-on, not core | three.js |
| Animation system | `AnimationMixer` and clips throw "not available yet" | three.js |
| Audio | none | three.js or Web Audio |
| Controls | none in the package; three.js controls are add-ons, not core. `examples/webgpu` has its own orbit code | three.js add-ons (untested against WAMR3D objects) |
| WebGL fallback | none: `WebGLRenderer` throws; the renderer needs WebGPU | the three.js adapter, `examples/browser/?renderer=three` |
| Others still missing | `LineLoop`, `SkinnedMesh`, `LOD`, `MeshPhongMaterial`, `MeshPhysicalMaterial`, `MeshToonMaterial`, `MeshNormalMaterial`, `ShaderMaterial`, maps other than `map`, render-target depth textures and multiple attachments, picking sprites | three.js |

### Known limitations of what was added

- Sprites are not picked by `Raycaster` (three.js needs the camera for that); they return no hits.
- Shadow casters are meshes only: lines, points and sprites never cast shadows. Each shadow map fills the top-left of its layer; samples at a map's edge can read the cleared area of a larger layer (lit).
- A material sampling the render target it is being drawn into gets white instead (WebGPU forbids the feedback).
- A physically based surface lit by a strong light still differs from three.js by about 1.8 of 255 (found while building `shadows_directional`: the same scene without shadows measures 1.79). It comes from the existing shading approximation, not from shadows; the shadow case uses a Lambert floor so that it tests shadows alone. Likely cause, not investigated: three.js adds a geometry-dependent roughness term WAMR3D does not have.
- `Material` gained `rotation`, `size_attenuation`, `uses_environment` and `env_map_intensity`; `Renderable` gained `sprite` and lost `Eq` (it now holds floats); `Primitive` gained `Points`. `World.raycast` takes a trailing `pointsThreshold` (missing means 1).
- The showcase and standalone WebGPU demo remain focused on their existing workloads rather than these added renderer features; the parity page exposes all feature-specific visual cases.

### Checks run at the end of this milestone

| Check | Result |
|---|---|
| `cargo test --workspace` | 643 pass |
| `node engine/bindings/build.mjs` | ok, 488.3 KiB |
| `node parity/visual/run.mjs` | 23 of 23 (11 earlier cases unchanged, 12 new) |
| `node parity/bindings/compat-check.mjs` | 1,312 values, largest scaled error 5.4e-6, ok |
| `tsc -p parity/bindings` (TypeScript 7.0.2) | no errors |

## Benchmarks at four resolutions (2026-10-14, second run)

Every browser benchmark was run at 1280×720, 1920×1080, 2560×1440 and 3840×2160, and the Node.js benchmarks once, on the current working tree (same engine build as the first run today). The raw logs are in `bench/results/2026-10-14/`; the website's data (`website/src/data/benchmarks.js`) is generated from them, not typed. These numbers replace the first run below, which is kept as history.

| | |
|---|---|
| Hardware | Intel Core i9-10900X @ 3.70 GHz; NVIDIA GeForce RTX 2070 Super |
| OS | Windows x64 |
| Browser | Chrome 155.0.8059.80 (it updated itself from .40 since the first run), **headless** (`--headless=new`) with the GPU enabled: `--enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist --enable-unsafe-webgpu` |
| Backends | WAMR3D and three.js WebGPURenderer: WebGPU (Direct3D 11 adapter). three.js WebGLRenderer: WebGL 2 through ANGLE on Direct3D 11 |
| Resolution | page viewport set exactly with `Emulation.setDeviceMetricsOverride` (new `--size=WxH` option of both scripts); canvas sizes read back from the page: 1280×720, 1920×1080, 2560×1440, 3840×2160; device pixel ratio 1 |
| Node.js | v24.19.0 |
| Failures | none; every configuration produced results. No headless browser was left running before or after any stage |

**Correction to earlier runs.** Before this run the scripts set `--window-size=1280,720` and called that the resolution. In headless Chrome the page gets less than the window: a 3840×2160 window gave a 3824×2009 canvas, so the earlier "1280×720" results were drawn on a smaller canvas than stated.

What is timed: CPU time in JavaScript with a 0.1 ms resolution. GPU time is not measured; it shows only in the frame rate, which the display loop caps at 60. All values are medians of one run per configuration.

### Showcase: `node examples/showcase/check.mjs --measure --size=WxH` (plus `--counts=100000 --modes=instanced`)

Medians over 4 s after a 1.5 s warm-up, one engine at a time.

Separate meshes (one draw call per body). Each cell: fps / update ms / submit ms (draw calls).

| bodies | engine | 1280×720 | 1920×1080 | 2560×1440 | 3840×2160 |
|---|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60.0 / 0.5 / 2.3 (1,926) | 60.0 / 0.5 / 2.2 (1,926) | 59.9 / 0.5 / 2.3 (1,926) | 60.0 / 0.6 / 2.3 (1,926) |
| 2,000 | WAMR3D object API | 60.0 / 0.7 / 2.4 (1,932) | 60.0 / 0.8 / 2.3 (1,932) | 60.0 / 0.6 / 2.4 (1,932) | 60.0 / 0.7 / 2.4 (1,932) |
| 2,000 | three.js WebGPU | 58.8 / 1.1 / 15.4 (1,943) | 52.5 / 1.2 / 17.1 (1,943) | 60.0 / 0.9 / 13.6 (1,943) | 56.4 / 1.1 / 16.1 (1,943) |
| 2,000 | three.js WebGL | 60.0 / 1.2 / 4.3 (1,958) | 60.0 / 1.5 / 4.3 (1,958) | 60.0 / 1.1 / 3.2 (1,958) | 60.0 / 1.6 / 4.5 (1,958) |
| 10,000 | WAMR3D batched | 60.0 / 2.3 / 11.6 (9,819) | 60.0 / 2.5 / 12.2 (9,820) | 60.0 / 2.2 / 11.1 (9,818) | 60.0 / 2.4 / 11.5 (9,820) |
| 10,000 | WAMR3D object API | 59.1 / 3.7 / 12.3 (9,849) | 60.0 / 4.0 / 12.3 (9,850) | 59.8 / 3.8 / 12.1 (9,852) | 58.8 / 3.9 / 12.3 (9,849) |
| 10,000 | three.js WebGPU | 9.2 / 9.5 / 100.1 (9,854) | 9.5 / 6.9 / 100.5 (9,850) | 11.7 / 5.5 / 79.6 (9,848) | 9.4 / 6.3 / 99.7 (9,852) |
| 10,000 | three.js WebGL | 36.5 / 5.2 / 21.8 (9,861) | 33.7 / 5.5 / 23.7 (9,858) | 41.9 / 4.7 / 18.6 (9,858) | 35.0 / 5.4 / 22.6 (9,861) |
| 50,000 | WAMR3D batched | 12.3 / 16.1 / 63.7 (49,307) | 12.6 / 15.5 / 63.2 (49,309) | 15.1 / 10.9 / 54.9 (49,318) | 12.4 / 16.3 / 63.2 (49,306) |
| 50,000 | WAMR3D object API | 11.8 / 21.8 / 61.4 (49,374) | 11.7 / 23.2 / 62.2 (49,370) | 12.7 / 18.2 / 60.1 (49,375) | 11.3 / 23.8 / 64.0 (49,377) |
| 50,000 | three.js WebGPU | 2.0 / 25.8 / 457.2 (49,372) | 1.6 / 45.2 / 561.8 (49,374) | 2.2 / 25.2 / 429.1 (49,383) | 1.8 / 47.3 / 515.3 (49,374) |
| 50,000 | three.js WebGL | 6.3 / 25.3 / 131.9 (49,241) | 6.3 / 26.5 / 131.8 (49,241) | 6.6 / 24.6 / 130.6 (49,237) | 6.0 / 30.3 / 133.7 (49,246) |

Instanced meshes. Each cell: fps / update ms / submit ms (draw calls).

| bodies | engine | 1280×720 | 1920×1080 | 2560×1440 | 3840×2160 |
|---|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60.0 / 0.5 / 0.2 (5) | 60.0 / 0.5 / 0.2 (5) | 60.0 / 0.5 / 0.3 (5) | 60.0 / 0.6 / 0.2 (5) |
| 2,000 | WAMR3D object API | 60.0 / 0.8 / 0.3 (5) | 58.5 / 0.9 / 0.3 (5) | 58.2 / 1.1 / 0.4 (5) | 59.9 / 0.9 / 0.3 (5) |
| 2,000 | three.js WebGPU | 60.0 / 1.3 / 0.5 (6) | 60.2 / 1.3 / 0.6 (6) | 60.0 / 1.7 / 0.7 (6) | 60.2 / 1.3 / 0.6 (6) |
| 2,000 | three.js WebGL | 59.7 / 1.5 / 0.2 (5) | 60.0 / 1.4 / 0.2 (5) | 60.0 / 1.7 / 0.3 (5) | 60.0 / 1.3 / 0.2 (5) |
| 10,000 | WAMR3D batched | 59.9 / 2.5 / 0.5 (5) | 60.0 / 2.4 / 0.5 (5) | 59.7 / 2.7 / 0.6 (5) | 59.9 / 2.5 / 0.5 (5) |
| 10,000 | WAMR3D object API | 60.0 / 4.1 / 1.0 (5) | 60.0 / 4.0 / 1.0 (5) | 60.0 / 4.4 / 1.2 (5) | 60.0 / 4.0 / 1.1 (5) |
| 10,000 | three.js WebGPU | 60.0 / 6.6 / 1.5 (6) | 60.0 / 6.2 / 1.5 (6) | 60.0 / 7.0 / 1.5 (6) | 59.9 / 6.3 / 1.5 (6) |
| 10,000 | three.js WebGL | 60.0 / 6.5 / 0.6 (5) | 60.0 / 6.3 / 0.6 (5) | 59.5 / 7.1 / 0.7 (5) | 60.0 / 6.3 / 0.6 (5) |
| 50,000 | WAMR3D batched | 60.0 / 12.4 / 1.9 (5) | 60.0 / 12.0 / 1.9 (5) | 60.0 / 12.4 / 2.4 (5) | 60.0 / 12.7 / 1.9 (5) |
| 50,000 | WAMR3D object API | 35.3 / 21.1 / 6.4 (5) | 33.2 / 22.6 / 6.8 (5) | 34.7 / 21.8 / 6.1 (5) | 32.6 / 22.8 / 6.8 (5) |
| 50,000 | three.js WebGPU | 21.5 / 38.3 / 7.2 (6) | 21.4 / 39.1 / 7.2 (6) | 19.4 / 42.4 / 8.5 (6) | 19.5 / 42.4 / 7.9 (6) |
| 50,000 | three.js WebGL | 23.4 / 37.8 / 4.2 (5) | 22.7 / 39.7 / 3.6 (5) | 23.3 / 38.4 / 3.9 (5) | 21.0 / 42.0 / 4.7 (5) |
| 100,000 | WAMR3D batched | 29.2 / 29.5 / 3.8 (5) | 29.4 / 28.7 / 3.7 (5) | 32.0 / 25.9 / 3.7 (5) | 26.9 / 31.4 / 3.9 (5) |
| 100,000 | WAMR3D object API | 16.8 / 47.0 / 11.0 (5) | 17.2 / 46.0 / 10.6 (5) | 16.0 / 47.5 / 12.4 (5) | 15.7 / 49.9 / 12.0 (5) |
| 100,000 | three.js WebGPU | 10.4 / 75.3 / 18.1 (6) | 11.5 / 70.9 / 15.9 (6) | 11.0 / 72.4 / 17.1 (6) | 9.4 / 83.6 / 20.2 (6) |
| 100,000 | three.js WebGL | 11.1 / 80.5 / 8.6 (5) | 12.7 / 68.2 / 9.8 (5) | 12.1 / 71.4 / 10.4 (5) | 11.0 / 75.9 / 11.3 (5) |

### Comparison scene: `node examples/compare/measure.mjs --gpu --size=WxH`

3 s warm-up, 8 s sample, medians, one engine per page load. Each cell: fps / CPU update ms / draw submit ms. The first three rows of each group run the same scene code; the last two draw with the three.js WebGL renderer, so only the transforms differ.

| objects | engine | 1280×720 | 1920×1080 | 2560×1440 | 3840×2160 |
|---|---|---|---|---|---|
| 19 | three.js r186 (WebGL) | 60 / 0.0 / 0.1 | 60 / 0.0 / 0.1 | 60 / 0.0 / 0.2 | 60 / 0.0 / 0.2 |
| 19 | three.js r186 (WebGPU) | 60 / 0.0 / 0.4 | 57 / 0.0 / 0.4 | 60 / 0.0 / 0.4 | 60 / 0.0 / 0.4 |
| 19 | WAMR3D object API (WebGPU) | 60 / 0.0 / 0.2 | 57 / 0.0 / 0.2 | 60 / 0.1 / 0.2 | 60 / 0.1 / 0.2 |
| 16 | WAMR3D (WebGPU) | 60 / 0.0 / 0.2 | 57 / 0.0 / 0.2 | 60 / 0.0 / 0.2 | 60 / 0.0 / 0.2 |
| 16 | three.js r186 | 60 / 0.0 / 0.1 | 60 / 0.0 / 0.1 | 60 / 0.0 / 0.1 | 60 / 0.0 / 0.1 |
| 16 | WAMR3D | 60 / 0.1 / 0.1 | 60 / 0.0 / 0.1 | 60 / 0.1 / 0.2 | 60 / 0.1 / 0.1 |
| 2,007 | three.js r186 (WebGL) | 60 / 0.8 / 3.8 | 60 / 0.6 / 3.3 | 60 / 0.9 / 4.1 | 60 / 0.9 / 3.9 |
| 2,007 | three.js r186 (WebGPU) | 60 / 0.9 / 14.8 | 60 / 0.7 / 12.3 | 60 / 0.8 / 14.0 | 60 / 0.8 / 13.9 |
| 2,007 | WAMR3D object API (WebGPU) | 60 / 0.6 / 2.1 | 60 / 0.5 / 1.9 | 60 / 0.7 / 2.0 | 60 / 0.6 / 2.0 |
| 2,004 | WAMR3D (WebGPU) | 60 / 0.4 / 1.9 | 60 / 0.3 / 1.8 | 60 / 0.4 / 1.9 | 60 / 0.4 / 2.1 |
| 2,004 | three.js r186 | 60 / 1.6 / 4.2 | 60 / 0.6 / 3.2 | 60 / 1.0 / 4.6 | 60 / 1.0 / 4.3 |
| 2,004 | WAMR3D | 60 / 0.4 / 4.3 | 60 / 0.4 / 3.4 | 60 / 0.4 / 4.0 | 60 / 0.5 / 4.8 |
| 10,007 | three.js r186 (WebGL) | 30 / 3.8 / 20.8 | 60 / 3.6 / 18.8 | 30 / 4.7 / 20.6 | 30 / 4.2 / 20.4 |
| 10,007 | three.js r186 (WebGPU) | 9 / 8.7 / 104.2 | 10 / 4.3 / 95.4 | 9 / 7.4 / 104.8 | 9 / 6.7 / 107.6 |
| 10,007 | WAMR3D object API (WebGPU) | 60 / 3.7 / 10.0 | 60 / 3.1 / 9.2 | 60 / 4.0 / 9.7 | 60 / 3.5 / 9.4 |
| 10,004 | WAMR3D (WebGPU) | 60 / 2.2 / 8.6 | 60 / 2.2 / 8.1 | 60 / 2.3 / 8.1 | 60 / 2.0 / 8.4 |
| 10,004 | three.js r186 | 60 / 3.8 / 19.5 | 60 / 4.5 / 18.5 | 60 / 3.8 / 19.6 | 60 / 3.2 / 15.7 |
| 10,004 | WAMR3D | 30 / 1.8 / 22.9 | 60 / 1.6 / 17.5 | 30 / 1.9 / 23.6 | 60 / 1.8 / 20.8 |

### Reading it

- **Resolution changed little.** From 1280×720 to 3840×2160 the frame rates and CPU times move by about as much as they vary between neighbouring configurations, with no consistent trend. These scenes are limited by CPU work (scene update and draw submission); the RTX 2070 Super is not the bottleneck at any of the four sizes. A heavier fragment workload than these scenes would be needed to show a resolution effect.
- **Separate meshes, 10,000 bodies:** WAMR3D batched held 60 fps at every resolution; three.js ran at 33.7 to 41.9 fps (WebGL) and 9.2 to 11.7 fps (WebGPU). three.js needed 1.7 to 2.0 times (WebGL) and 7.2 to 8.7 times (WebGPU) the CPU time of WAMR3D to submit draws.
- **Instanced, 50,000 bodies:** WAMR3D batched held 60 fps with 12.0 to 12.7 ms of update; three.js ran at 19.4 to 23.4 fps with 37.8 to 42.4 ms. At 100,000: 26.9 to 32.0 fps against 9.4 to 12.7.
- **Same renderer, only transforms differ (comparison scene, 10,004 objects):** 1.6 to 1.9 ms for WAMR3D against 3.2 to 4.5 ms for three.js.
- **Frame rates at a 16.7 ms boundary:** three.js WebGL at 10,007 objects (30, 60, 30, 30) and WAMR3D transforms drawn by three.js WebGL at 10,004 (30, 60, 30, 60) switch between 30 and 60 fps from one resolution to the next with no trend; their frame time sits at the edge of one display interval.
- **Not ahead:** at 2,000 instanced bodies every engine is at 58 to 60 fps and three.js WebGL submits as fast (0.2 to 0.3 ms). At 50,000 separate meshes nobody is smooth: WAMR3D is at 12 to 15 fps, limited by its own draw submission (55 to 64 ms).
- **Variance:** one run per configuration. Neighbouring configurations differ by up to about 20% in places (for example WAMR3D batched at 50,000 separate meshes: 15.1 fps at 2560×1440, 12.3 to 12.6 elsewhere).

### Low-level API: `node bench/bench.mjs`

Node.js, no GPU. 5 warm-up runs, 25 samples per workload. Start-up: WAMR3D import 3.9 ms, init (compile and instantiate 458 KiB of wasm) 23.3 ms; three.js import 187.7 ms (unbundled source modules).

| workload | three.js ms | WAMR3D ms | WAMR3D/three |
|---|---|---|---|
| Matrix4.multiplyMatrices | 6.227 | 7.885 | 1.27x |
| Matrix4.invert (copy + invert) | 6.694 | 9.853 | 1.47x |
| Vector3.applyMatrix4 | 1.995 | 6.579 | 3.30x |
| Vector3.applyQuaternion | 1.686 | 6.385 | 3.79x |
| boundary: getter (v.x) | 1.484 | 2.384 | 1.61x |
| boundary: call with a handle (isAlive / .visible) | 1.479 | 3.365 | 2.27x |
| scene: update 10,000 world matrices (transforms unchanged, forced) | 1.971 | 0.595 | 0.30x |
| scene: set 10,000 transforms + update, one call per property | 3.686 | 2.900 | 0.79x |
| scene: set 10,000 transforms + update, one batched call | 2.694 | 1.437 | 0.53x |
| scene: read back 10,000 world matrices into one Float32Array | 0.803 | 0.256 | 0.32x |
| scene: create + parent + destroy 10,000 objects | 38.265 | 1.810 | 0.05x |
| geometry: computeVertexNormals | 10.895 | 9.187 | 0.84x |
| geometry: computeBoundingSphere | 1.191 | 2.445 | 2.05x |
| geometry: applyMatrix4 (positions + normals) | 2.855 | 7.041 | 2.47x |
| geometry: upload positions + index (copy into the engine) | 0.503 | 0.537 | 1.07x |

Same picture as the first run: single small calls are 1.3x to 3.8x slower than three.js, batched scene work takes 0.30x to 0.53x of its time. Two rows moved between runs on the three.js side alone (update 10,000 world matrices: 1.244 to 1.971 ms; one call per property: 2.739 to 3.686 ms), so their ratios changed (0.48x to 0.30x, 1.06x to 0.79x) without any engine change; treat those two as noisy. The create/destroy row is still not an equal comparison.

### Object API: `node bench/compat.mjs`

Node.js, median of 21.

| workload | three.js ms | WAMR3D ms | WAMR3D/three |
|---|---|---|---|
| math: vector chain (set, applyQuaternion, add, normalize, dot) | 2.414 | 25.054 | 10.38x |
| math: new Vector3 per operation (allocation churn) | 0.855 | 54.089 | 63.27x |
| math: Matrix4 compose, multiply, invert | 3.431 | 13.565 | 3.95x |
| math: Quaternion.setFromEuler + slerp | 11.336 | 80.490 | 7.10x |
| math: Box3.expandByPoint + Sphere.containsPoint | 0.821 | 14.754 | 17.97x |
| math: Color.setHSL + lerp | 4.348 | 13.224 | 3.04x |
| scene: 10,000 meshes, set rotation + position.y, updateMatrixWorld | 5.315 | 2.511 | 0.47x |
| scene: 10,000 meshes, rotation.y += and position.x read | 4.860 | 2.145 | 0.44x |
| scene: read matrixWorld.elements of 10,000 meshes | 0.378 | 3.983 | 10.53x |
| scene: getWorldPosition of 10,000 meshes | 2.345 | 3.947 | 1.68x |
| scene: object.lookAt on 10,000 meshes | 5.651 | 4.109 | 0.73x |
| scene: create + add + remove 10,000 meshes | 33.940 | 26.692 | 0.79x |
| picking: 100 rays against 1,000 boxes | 6.182 | 142.289 | 23.02x |

### Scene-graph profile: `node examples/showcase/profile.mjs`

110,009 nodes: animate 2.43 ms, `setRotations` 6.24 ms, `updateMatrixWorld` 6.52 ms, `matricesWorldPtr` 1.96 ms, total 17.15 ms.

## Benchmarks rerun (2026-10-14)

> Superseded by [Benchmarks at four resolutions](#benchmarks-at-four-resolutions-2026-10-14-second-run); kept as the record of the first run. Its "1280x720" was the window size; the canvas was smaller.


Every existing benchmark was run again on the current working tree (package rebuilt with `node engine/bindings/build.mjs`, SIMD build, `wamr3d_wasm_bg.wasm` 457.8 KiB; `cargo test --workspace --release`: 639 pass). Same scripts, settings and machine as before: Windows x64, i9-10900X, RTX 2070 Super, Node.js v24.19.0, Chrome 155.0.8059.40 headless, no leftover headless browser before or after the browser runs. These numbers replaced the measurements in the milestone sections below, which are kept as history.

Everything in this section was measured in this run, except the ratios marked *derived*, which are computed from the medians shown. Nothing is estimated. Browser times are timed in JavaScript with a 0.1 ms resolution; GPU time is not measured and only shows in the frame rate (display limit 60).

### Showcase: `node examples/showcase/check.mjs --measure` (plus `--counts=100000 --modes=instanced`)

1280x720, medians over 4 s after a 1.5 s warm-up, one engine at a time, one run. *update* = animation, transforms and world matrices on the CPU; *submit* = the renderer on the CPU.

Separate meshes (one draw call per body):

| bodies | engine | fps | update ms | submit ms |
|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60.0 | 0.5 | 2.2 |
| 2,000 | WAMR3D object API | 60.0 | 0.6 | 2.3 |
| 2,000 | three.js WebGPU | 60.0 | 0.9 | 13.8 |
| 2,000 | three.js WebGL | 60.0 | 1.1 | 3.3 |
| 10,000 | WAMR3D batched | 60.0 | 2.1 | 10.5 |
| 10,000 | WAMR3D object API | 60.0 | 3.7 | 11.1 |
| 10,000 | three.js WebGPU | 10.7 | 5.3 | 77.0 |
| 10,000 | three.js WebGL | 33.7 | 5.4 | 23.9 |
| 50,000 | WAMR3D batched | 14.6 | 11.1 | 56.7 |
| 50,000 | WAMR3D object API | 12.6 | 19.1 | 59.7 |
| 50,000 | three.js WebGPU | 2.2 | 25.3 | 428.4 |
| 50,000 | three.js WebGL | 7.1 | 24.4 | 115.0 |

Instanced meshes (5 draw calls; 6 for three.js WebGPU):

| bodies | engine | fps | update ms | submit ms |
|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60.0 | 0.6 | 0.2 |
| 2,000 | WAMR3D object API | 58.7 | 1.1 | 0.4 |
| 2,000 | three.js WebGPU / WebGL | 60.0 / 60.0 | 1.7 / 1.4 | 0.6 / 0.2 |
| 10,000 | WAMR3D batched | 60.0 | 2.6 | 0.5 |
| 10,000 | WAMR3D object API | 60.0 | 4.5 | 1.0 |
| 10,000 | three.js WebGPU / WebGL | 60.0 / 60.0 | 6.2 / 6.4 | 1.4 / 0.6 |
| 50,000 | WAMR3D batched | 59.2 | 13.0 | 2.0 |
| 50,000 | WAMR3D object API | 30.5 | 24.5 | 6.6 |
| 50,000 | three.js WebGPU / WebGL | 21.7 / 23.6 | 38.6 / 37.7 | 6.8 / 4.0 |
| 100,000 | WAMR3D batched | 33.2 | 24.6 | 3.7 |
| 100,000 | WAMR3D object API | 18.2 | 42.8 | 11.1 |
| 100,000 | three.js WebGPU / WebGL | 12.0 / 10.3 | 67.4 / 81.1 | 15.5 / 11.4 |

First build of the batched engine in a page: 301 ms (341 ms for the 100,000-body scene, measured in a separate page); later builds 43 to 77 ms.

Reading it (ratios *derived*):

- **Separate meshes:** at 10,000 bodies WAMR3D holds 60 fps; three.js runs at 34 (WebGL) and 11 (WebGPU). WAMR3D submits draws 1.5 to 2.3 times as fast as three.js WebGL and 6.3 to 7.6 times as fast as three.js WebGPU. At 50,000 nobody is smooth; WAMR3D is at 15 fps, limited by its own draw submission (57 ms).
- **Instanced:** the scene-graph update decides. At 50,000 bodies the batched API updates in 13.0 ms and runs at 59 fps; three.js needs 38 ms and runs at 22 to 24 fps. At 100,000: 33 fps against 10 to 12.
- **Where WAMR3D is not ahead:** at 2,000 instanced bodies three.js WebGL submits as fast (0.2 ms both); the object API dropped slightly below 60 fps there (58.7) in this run. The object API updates 1.2 to 1.9 times more slowly than the batched API.

### Comparison scene: `node examples/compare/measure.mjs --gpu`

1280x720, pixel ratio 1, 3 s warm-up, 8 s sample per run, medians, one engine per page load, one run. The first three rows of each group run the same scene code; `three` and `wamr3d` are three.js and WAMR3D transforms, both drawn by the three.js WebGL renderer.

| objects | engine | fps | frames | CPU update ms | draw submit ms | first frame ms |
|---|---|---|---|---|---|---|
| 19 / 16 | all six | 60 | 479 to 481 | 0.0 | 0.1 to 0.3 | 68 to 335 |
| 2,007 | three.js r186, WebGL | 60 | 481 | 0.7 | 3.2 | 74 |
| 2,007 | three.js r186, WebGPU | 60 | 462 | 0.8 | 13.6 | 293 |
| 2,007 | WAMR3D object API | 60 | 481 | 0.6 | 1.9 | 191 |
| 2,004 | WAMR3D batched calls | 60 | 480 | 0.4 | 1.8 | 123 |
| 2,004 | three.js transforms + WebGL | 60 | 480 | 0.9 | 3.9 | 86 |
| 2,004 | WAMR3D transforms + three.js WebGL | 60 | 480 | 0.5 | 4.1 | 107 |
| 10,007 | three.js r186, WebGL | 30 | 294 | 5.1 | 21.7 | 138 |
| 10,007 | three.js r186, WebGPU | 12 | 89 | 7.1 | 82.3 | 853 |
| 10,007 | WAMR3D object API | 60 | 481 | 3.3 | 9.4 | 404 |
| 10,004 | WAMR3D batched calls | 60 | 480 | 2.2 | 8.2 | 174 |
| 10,004 | three.js transforms + WebGL | 30 | 304 | 4.7 | 20.9 | 150 |
| 10,004 | WAMR3D transforms + three.js WebGL | 30 | 317 | 1.8 | 23.0 | 178 |

WebAssembly initialisation in the page: 4.0 to 5.3 ms.

- Same renderer (three.js WebGL), only the transforms differ: WAMR3D 1.8 ms against 4.7 ms at 10,004 objects, 0.5 against 0.9 ms at 2,004.
- Same scene code at 10,007 objects: the object API updates in 3.3 ms against 5.1 ms for three.js WebGL and keeps 60 fps where three.js runs at 30 (WebGL) and 12 (WebGPU). Draw submission is about 2.3 times as fast as three.js WebGL and 8.8 times as fast as three.js WebGPU (*derived*).

### Low-level API: `node bench/bench.mjs`

Node.js, release build, 5 warm-up runs and 25 samples per workload. It was run twice. The first run came right after the build and was disturbed by a cold start (importing three.js took 3,036 ms instead of 179 ms, and three.js `computeVertexNormals` took 22.3 ms instead of 11.2 ms); every other ratio of the two runs agreed within 0.3x. The second run is shown.

```
start-up (one time, not included below)
  wamr3d: import 3.9 ms, init (compile + instantiate 458 KiB of wasm) 24.4 ms
  three:  import 179.1 ms (unbundled source modules)

workload                                                              three ms  wamr3d ms  wamr3d/three
Matrix4.multiplyMatrices                                                 6.307      7.918    1.26x
Matrix4.invert (copy + invert)                                           6.801      9.843    1.45x
Vector3.applyMatrix4                                                     1.952      7.276    3.73x
Vector3.applyQuaternion                                                  1.689      6.931    4.10x
boundary: getter (v.x)                                                   1.427      2.310    1.62x
boundary: call with a handle (isAlive / .visible)                        1.443      3.288    2.28x
scene: update 10,000 world matrices (transforms unchanged, forced)       1.244      0.592    0.48x
scene: set 10,000 transforms + update, one call per property             2.739      2.906    1.06x
scene: set 10,000 transforms + update, one batched call                  2.767      1.456    0.53x
scene: read back 10,000 world matrices into one Float32Array             0.881      0.258    0.29x
scene: create + parent + destroy 10,000 objects                         38.300      1.686    0.04x
geometry: computeVertexNormals                                          11.198      9.492    0.85x
geometry: computeBoundingSphere                                          1.186      2.499    2.11x
geometry: applyMatrix4 (positions + normals)                             3.089      7.040    2.28x
geometry: upload positions + index (copy into the engine)                0.502      0.538    1.07x
```

Medians; below 1 means WAMR3D was faster. Same picture as before: single small calls are 1.3x to 4.1x slower than three.js, batched scene work is 0.29x to 0.53x of its time. The create/destroy row is still not an equal comparison (three.js leaves freeing to the garbage collector, outside the timed region).

### Object API: `node bench/compat.mjs`

Node.js, the same three.js-style code run against `wamr3d/compat` and three.js r186, 5 warm-up runs, median of 21, one run. No GPU. Not reported before.

| workload | three.js ms | WAMR3D ms | WAMR3D/three |
|---|---|---|---|
| math: vector chain (set, applyQuaternion, add, normalize, dot) | 2.275 | 23.673 | 10.40x |
| math: new Vector3 per operation (allocation churn) | 0.801 | 54.277 | 67.78x |
| math: Matrix4 compose, multiply, invert | 3.179 | 13.270 | 4.17x |
| math: Quaternion.setFromEuler + slerp | 11.254 | 80.413 | 7.15x |
| math: Box3.expandByPoint + Sphere.containsPoint | 0.826 | 14.612 | 17.70x |
| math: Color.setHSL + lerp | 4.325 | 13.120 | 3.03x |
| scene: 10,000 meshes, set rotation + position.y, updateMatrixWorld | 5.070 | 2.570 | 0.51x |
| scene: 10,000 meshes, rotation.y += and position.x read | 5.031 | 2.432 | 0.48x |
| scene: read matrixWorld.elements of 10,000 meshes | 0.430 | 3.972 | 9.23x |
| scene: getWorldPosition of 10,000 meshes | 2.580 | 4.006 | 1.55x |
| scene: object.lookAt on 10,000 meshes | 4.826 | 4.130 | 0.86x |
| scene: create + add + remove 10,000 meshes | 33.930 | 26.988 | 0.80x |
| picking: 100 rays against 1,000 boxes | 7.322 | 148.969 | 20.34x |

The object API is about twice as fast as three.js for animating and updating a scene of 10,000 meshes, and much slower for math done in JavaScript one value at a time (3x to 68x), for reading world matrices object by object (9.2x) and for picking (20x). Use the math classes of `wamr3d/compat` for convenience, not for speed.

### Scene-graph profile: `node examples/showcase/profile.mjs`

Node.js, no GPU, 110,009 nodes (the 100,000-body scene), one run: animate (JavaScript) 2.42 ms, `setRotations` 6.23 ms, `updateMatrixWorld` 6.54 ms, `matricesWorldPtr` 1.99 ms, total 17.18 ms (the previous milestone measured 18.2 ms).

## Milestone: independent of the local three.js folder (2026-10-14)

`three.js-r186/` can be deleted. Nothing in the repository reads it any more (DECISIONS.md D37).

| What | Before | Now |
|---|---|---|
| Engine, package, object API, `examples/webgpu`, `examples/showcase` on a WAMR3D engine | no three.js | unchanged |
| `examples/browser` | loaded three.js on every visit for its transform check | loads none; the check is behind the checkbox or `?compare=1` |
| three.js engines of the showcase and `examples/compare`, `examples/threejs`, reference adapter, `examples/webgpu/visual.html`, visual reference generation | local `build/` files | r186 from cdnjs, through `examples/three-reference.js` |
| Object API parity (`compat-check.mjs`) | ran three.js from the folder | compares with `parity/bindings/compat-expected.json`; `--generate` rewrites it from three.js |
| Fixture generators, `parity/bindings/check.mjs`, `bench/bench.mjs` | imported the folder's `src/` | import the npm package `three@0.186.1`, pinned exactly in the root `package.json` (`npm install`) |

Checked before switching: the npm package's `src/` is identical to the folder's (`diff -r`), regenerating every JSON fixture from it changed no value, and regenerating the eleven visual reference images from the CDN build produced byte-identical files.

**Run with the folder moved out of the project** (it was moved back afterwards for the owner to delete):

| Needs no three.js | Result |
|---|---|
| `cargo test --workspace` | 638 pass |
| `node engine/bindings/build.mjs`, `node examples/basic/main.mjs` | ok |
| `node parity/bindings/compat-check.mjs` | 1,312 values, ok |
| `tsc -p parity/bindings` | no errors |
| `node parity/visual/run.mjs` | 11 of 11 |
| `node examples/browser/smoke.mjs` | 9 of 9, including "three.js was not loaded" |
| `node examples/showcase/check.mjs` | 11 of 11, including "three.js is not loaded while WAMR3D draws" (its three.js engine steps use the CDN) |

| Still needs an external three.js r186 | Source | Result |
|---|---|---|
| `examples/browser/smoke.mjs` with `?compare=1` and with `?renderer=three&compare=1` | CDN | pass |
| `examples/webgpu/smoke.mjs` (three image comparisons with three.js WebGL) | CDN | 8 of 8 |
| three.js engines of `examples/showcase` and `examples/compare`, `examples/threejs` | CDN | run |
| `node parity/visual/run.mjs --generate` | CDN | images identical to the stored ones |
| `node parity/bindings/check.mjs` | npm | 44,179 values, ok |
| `node bench/bench.mjs`, the three fixture generators, `compat-check.mjs --generate` | npm | run |

Not done: `website/dist/` is build output and still holds old copies of the documents and of `parity/visual/index.html` that name the folder; rebuilding the website replaces them (its build script needed no change). The comparison pages do not work offline.

## Milestone: showcase (2026-10-14)

### Where and how

```
node examples/browser/serve.mjs
```

then open <http://localhost:8080/examples/showcase/>. Files: `examples/showcase/` (`index.html`, `main.js`, `scene.js`, `engine-wamr3d.js`, `engine-library.js`, `check.mjs`, `profile.mjs`).

### What it is

A sun with eight tilted belts turning around it; each belt is made of spinning clusters, each cluster carries ten tumbling bodies. It is a scene graph four levels deep in which only rotations change per frame, so where each body ends up is the product of its three ancestors: the workload of a real application with many moving parts, not a flat list of independent objects. 2,000 to 100,000 bodies, as separate meshes or as instanced meshes, physically based or diffuse, lit by a point light at the sun, a directional light and sky light, in fog.

The idea came from `three@0.186.1 examples/webgl_instancing_dynamic.html`, `webgl_instancing_performance.html` and `webgpu_instance_mesh.html` (dynamic instance matrices rebuilt every frame); nothing was copied from them.

Four engines draw the same scene description (`scene.js`), chosen in the panel without reloading:

| Engine | What runs |
|---|---|
| WAMR3D · batched API | scene graph in WebAssembly; one `setRotations` call per frame; instance matrices are a view of the engine's world matrices, uploaded to the GPU without a copy in JavaScript; WAMR3D WebGPU renderer |
| WAMR3D · object API | the three.js-style classes of `wamr3d/compat`; WAMR3D WebGPU renderer |
| three.js r186 · WebGPU | three.js alone |
| three.js r186 · WebGL | three.js alone |

The last three run one and the same file (`engine-library.js`); only the import and the renderer differ. three.js never draws a WAMR3D scene.

Panel: engine, number of bodies, separate or instanced, shape, speed, camera orbit, shading model, roughness, metalness, sun, sky light, fog and its density. Changes that alter what the scene is made of rebuild it in place; the others apply to the running scene. The header shows the active engine and configuration, frame rate, frame time, CPU update time, draw submission time, scene-graph size, draw calls and triangles. "Compare all four renderers" measures each engine in turn with the current settings and shows a table. The panel lists what the scene does not use: shadows, points, sprites, tone mapping and render targets (implemented in WAMR3D) and environment reflections and post-processing passes (not usable yet).

### Measured

> Superseded by [Benchmarks rerun (2026-10-14)](#benchmarks-rerun-2026-10-14); kept as the record of this milestone.

`node examples/showcase/check.mjs --measure` (plus `--counts=100000 --modes=instanced`): Chrome 155 headless, i9-10900X, RTX 2070 Super, 1280x720, medians over 4 s after a 1.5 s warm-up, one engine at a time, one run.

**What the columns are.** *update* is animation, transforms and world matrices, on the CPU. *submit* is the renderer's work on the CPU. Both are timed in JavaScript. Time spent by the GPU itself is not measured and only shows in the frame rate, which the display caps at 60. These numbers say nothing about GPU speed.

Separate meshes (one draw call per body):

| bodies | engine | fps | update ms | submit ms |
|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60 | 0.5 | 2.5 |
| 2,000 | WAMR3D object API | 60 | 0.8 | 2.7 |
| 2,000 | three.js WebGPU | 51 | 1.2 | 17.8 |
| 2,000 | three.js WebGL | 60 | 1.5 | 4.6 |
| 10,000 | WAMR3D batched | 60 | 2.4 | 12.0 |
| 10,000 | WAMR3D object API | 58 | 3.7 | 13.0 |
| 10,000 | three.js WebGPU | 9 | 9.0 | 100.0 |
| 10,000 | three.js WebGL | 34 | 5.6 | 23.3 |
| 50,000 | WAMR3D batched | 13 | 14.4 | 62.4 |
| 50,000 | WAMR3D object API | 11 | 24.2 | 64.0 |
| 50,000 | three.js WebGPU | 2 | 27.9 | 420.5 |
| 50,000 | three.js WebGL | 7 | 28.0 | 119.5 |

Instanced meshes (three shapes, 5 draw calls):

| bodies | engine | fps | update ms | submit ms |
|---|---|---|---|---|
| 2,000 | WAMR3D batched | 60 | 0.5 | 0.3 |
| 2,000 | three.js WebGPU / WebGL | 60 / 60 | 1.3 / 1.1 | 0.5 / 0.2 |
| 10,000 | WAMR3D batched | 60 | 2.6 | 0.6 |
| 10,000 | WAMR3D object API | 60 | 4.3 | 1.1 |
| 10,000 | three.js WebGPU / WebGL | 60 / 60 | 6.9 / 7.2 | 1.7 / 0.7 |
| 50,000 | WAMR3D batched | 60 | 12.4 | 2.1 |
| 50,000 | WAMR3D object API | 33 | 22.9 | 6.4 |
| 50,000 | three.js WebGPU / WebGL | 21 / 19 | 39.2 / 45.6 | 6.8 / 4.9 |
| 100,000 | WAMR3D batched | 33 | 25.5 | 4.0 |
| 100,000 | WAMR3D object API | 18 | 43.6 | 11.4 |
| 100,000 | three.js WebGPU / WebGL | 12 / 12 | 69.4 / 73.7 | 15.9 / 10.5 |

Reading it:

- **Many separate objects:** WAMR3D submits draws about twice as fast as three.js WebGL and seven to eight times as fast as three.js WebGPU. At 10,000 bodies it holds 60 fps where three.js reaches 34 (WebGL) and 9 (WebGPU). At 50,000 nobody is smooth: WAMR3D is at 13 fps, limited by its own draw submission (62 ms).
- **Instanced:** drawing is cheap for everyone, so the scene-graph update decides. WAMR3D batched updates 50,000 bodies (55,009 nodes) in 12.4 ms and holds 60 fps; three.js needs 39 to 46 ms and runs at about 20 fps. At 100,000 it is 33 fps against 12.
- **Where WAMR3D is not ahead:** at 2,000 instanced bodies everything is at the display limit and submission differs by tenths of a millisecond (three.js WebGL 0.2 ms, WAMR3D 0.3 ms). The object API updates more slowly than the batched API (about 1.5 to 1.9 times) though still faster than three.js here.
- The first build of the batched engine in a page took 330 ms (module compile and first pipeline); later builds 42 to 76 ms.

### What changed in the engine for it

- `World.matricesWorldPtr( handles )`: world matrices of many objects written to a buffer in the module, for a `Float32Array` view without a copy.
- The package is now built with WebAssembly SIMD by default (`node engine/bindings/build.mjs --no-simd` for the scalar build). The SIMD kernels are bit-identical to the scalar ones (D3).
- Euler angles to quaternion uses one routine that returns sine and cosine together (DECISIONS.md D36).
- `node examples/showcase/profile.mjs` (Node.js, no GPU), 110,009 nodes, before and after the two changes above: `setRotations` 10.2 to 6.6 ms, `updateMatrixWorld` 8.6 to 6.8 ms, whole update 24.2 to 18.2 ms.
- The WebGPU host destroys its device on `dispose()`, so switching engines in one page does not accumulate devices.

### Verified

| Check | Result |
|---|---|
| `node examples/showcase/check.mjs` | 10 of 10: starts on WAMR3D; light, fog, material and speed changed while running; switch to instanced (5 draw calls); 10,000 bodies of one shape (3 draw calls, 2.56 million triangles); each of the four engines selected in turn and drawing; back to separate meshes with diffuse shading; no errors or exceptions in the browser console |
| Screenshots of WAMR3D and three.js WebGPU at 2,000 bodies | compared by eye: same picture |
| `cargo test --workspace` | 638 pass (one new test for the sine/cosine routine: within `4e-16` of the library functions) |
| `node parity/visual/run.mjs` | 11 of 11 with the SIMD build |
| `node parity/bindings/compat-check.mjs`, `check.mjs` | 1,312 and 44,179 values, ok |
| `examples/browser` and `examples/webgpu` smoke tests, `tsc -p parity/bindings` | pass |

Not verified: the showcase in a visible window or in Edge (the other pages were, last milestone); touch input; window resize while running; a pixel comparison of the showcase between engines (the same renderer features are compared pixel by pixel in `parity/visual`).

### Limitations of the showcase

- Instanced bodies are not culled or picked one by one (D35).
- 50,000 or more separate meshes are below 15 fps in every engine.
- Switching to an engine and back creates a new canvas each time; three.js objects of the previous engine are left to the garbage collector.
- The frame rate in the header is the median of the last frames, so it lags a second behind a change.

## Milestone: native renderer by default, batched transforms, instancing, fog, material arrays, manual matrices (2026-10-13)

### 1. Native renderer is the default

- `examples/browser/` draws with the WAMR3D WebGPU renderer (`native-renderer.js`), including the grid. `?renderer=three` selects the three.js adapter, which is also the fallback when the browser has no WebGPU. The transform parity check against three.js still runs on the page in both modes.
- `node examples/browser/smoke.mjs`: 8 of 8 in native mode (15 draw calls, parity difference `3.8e-7`), 8 of 8 with `?renderer=three`.

### 2. Renderer architecture (decided, DECISIONS.md D32)

Rust/WebAssembly prepares each frame (world matrices, culling, ordering, per-material parts, pipeline state, uniform data, shader source); a JavaScript host of about 450 lines issues the WebGPU calls. `wgpu` is not used on the web. AGENTS.md Phase 4 was edited to say so, and section 1.4 now allows `GridHelper` and `AxesHelper`.

Toolchain verified: `rustc 1.99.0 (2026-09-28)`, stable, reported up to date by `rustup check`. Nothing pinned or changed.

### 3. Object API

- **Transforms no longer cross into WebAssembly per property.** `position`, `rotation`, `quaternion`, `scale` and `up` are kept in JavaScript and sent in one call at the next engine access (D33).
- **`matrixAutoUpdate = false`** works: `object.matrix` is then the matrix the object uses (D34).
- **Material arrays** with geometry groups, **`InstancedMesh`** (`setMatrixAt`, `setColorAt`, `count`, `instanceMatrix`, `instanceColor`), **`Fog`** and **`FogExp2`**, **`GridHelper`**, **`AxesHelper`**, **line picking** (`Raycaster.params.Line.threshold`), `geometry.groups` on the built-in shapes.
- **Typings are now compiled.** `tsc -p parity/bindings` (TypeScript 7.0.2, strict, library checks on) compiles an application-style program against `compat.d.ts` with no errors. Doing this found and fixed three real faults in the typings: every math method was typed as returning `this` (including `length()` and `clone()`), `mesh.position` and `mesh.quaternion` were not accepted as arguments of math methods, and `Raycaster.params` was missing.

`node parity/bindings/compat-check.mjs`: the same script on three.js r186 and on `wamr3d/compat`, 1,312 values (was 902), worst scaled error `5.4e-6`. New groups: transform writes and reads in mixed order, hand-set matrices and cloning them, fog, helpers, instances, material arrays, line picking.

### 4. Renderer

Added: instanced draws, one draw per material group, linear and squared-exponential fog. `node parity/visual/run.mjs`, WAMR3D against stored three.js r186 WebGPU images (limits: mean 1.5 of 255, 2% of pixels off by more than 12):

| case | mean difference of 255 | pixels off |
|---|---|---|
| cube | 0.000 | 0.00% |
| sphere | 0.200 | 0.00% |
| plane | 0.001 | 0.00% |
| triangle (Y direction, X direction, winding probes) | 0.001 | 0.00% |
| lights | 1.028 | 0.02% |
| transparent | 0.034 | 0.05% |
| lines | 0.009 | 0.00% |
| shapes | 0.114 | 0.02% |
| fog (linear fog, `GridHelper`, three material kinds) | 0.075 | 0.00% |
| instances (90 instances with scale, rotation, colour; `count` 80; `FogExp2`) | 0.287 | 0.02% |
| matrices (material array on a box, two hand-set matrices, child of one, `AxesHelper`) | 0.007 | 0.00% |

11 of 11 pass in headless Chrome 155, in a visible Chrome window (`--headed`) and in headless Edge (`--browser=edge`), all on the same machine and GPU.

### 5. Performance

> Superseded by [Benchmarks rerun (2026-10-14)](#benchmarks-rerun-2026-10-14); kept as the record of this milestone.

`node examples/compare/measure.mjs --gpu`, Chrome 155 headless, i9-10900X, RTX 2070 Super, 1280x720, medians, one run. The first three rows of each group run the same scene code.

| objects | engine | fps | frames of 480 | CPU update ms | draw submit ms |
|---|---|---|---|---|---|
| 2,007 | three.js r186, WebGL | 60 | 481 | 0.9 | 4.0 |
| 2,007 | three.js r186, WebGPU | 60 | 460 | 1.1 | 15.6 |
| 2,007 | WAMR3D object API | 60 | 481 | 0.8 | 2.2 |
| 2,004 | WAMR3D batched calls | 60 | 480 | 0.5 | 1.9 |
| 10,007 | three.js r186, WebGL | 60 | 330 | 3.6 | 19.9 |
| 10,007 | three.js r186, WebGPU | 9 | 74 | 8.8 | 99.9 |
| 10,007 | WAMR3D object API | 60 | 478 | 4.7 | 10.6 |
| 10,004 | WAMR3D batched calls | 60 | 480 | 2.8 | 8.7 |

- Object API update time fell from 7.9 to 4.7 ms at 10,007 objects and from 1.7 to 0.8 ms at 2,007 (previous milestone to this one). It is level with three.js at 2,007 and still about 30% slower at 10,007; it now keeps 60 fps there, which three.js does not with either renderer.
- Draw submission: about 7 to 9 times faster than three.js WebGPU and about 1.8 times faster than three.js WebGL.
- `node bench/bench.mjs` (low-level API, Node.js): unchanged in character. Single math calls 1.5x to 3.8x slower than three.js; batched scene updates 0.62x to 0.68x of its time; reading 10,000 world matrices 0.27x. A call with a handle measured 2.3x of a three.js property read, where the first benchmark run had 5.3x; nothing was changed to cause that and it was not investigated.

### Tests run for this milestone

| Check | Result |
|---|---|
| `cargo test --workspace` | 637 pass |
| `cargo build --workspace --target wasm32-unknown-unknown` | ok; package 451.5 KiB of WebAssembly |
| math suite on `wasm32-wasip1` with simd128 | 497 pass, 6 skipped |
| `node parity/visual/run.mjs` (also `--headed`, `--browser=edge`) | 11 of 11, three times |
| `node examples/webgpu/smoke.mjs` | 8 of 8 |
| `node examples/browser/smoke.mjs`, native and `?renderer=three` | 8 of 8, twice |
| `node parity/bindings/compat-check.mjs` | 1,312 values, ok |
| `node parity/bindings/check.mjs` | 44,179 values, ok |
| `tsc -p parity/bindings` | no errors |
| `node examples/basic/main.mjs`, `node bench/bench.mjs` | ok |

Test scripts no longer leave browsers behind: after these runs no test browser process was left (the previous cleanup with `taskkill /T` had still left two per run, because Chrome relaunches itself on Windows).

Not run: Firefox and Safari (the scripts drive Chrome and Edge only), a phone or an integrated GPU, a bundler. No automated test for `TextureLoader`, `CanvasTexture`, texture `rotation`, `InstancedMesh` with a changed `instanceMatrix` after the first frame, or resizing.

### Limitations of what was added

- `InstancedMesh` is never frustum-culled and is picked as one mesh at its own transform.
- `mesh.material = [ ... ]` is read when assigned; editing the array in place afterwards is not seen. A hit on such a mesh reports `materialIndex` 0.
- `material.fog = false` is accepted and ignored: everything is fogged when the scene has fog.
- `matrix.elements` is a copy, also with `matrixAutoUpdate = false`: change the matrix through its methods (`copy`, `compose`, `makeRotationY`, `setPosition`, `fromArray`, ...).
- Transforms written through the low-level `World` are not seen by the `position`/`rotation` getters of the object API (D33).
- The `lights` case is still the weakest image (1 to 3 levels of 255 on standard-material surfaces under point and spot lights; cause not found).

### Remaining for a full replacement

Not started, in rough order of how often applications need them:

1. **Shadows** (`castShadow`, `receiveShadow`, light shadow cameras).
2. **Environment reflections** and scene backgrounds from textures; normal, roughness, metalness, emissive, ambient-occlusion and alpha maps; `emissive`; `MeshPhongMaterial`, `MeshPhysicalMaterial`.
3. **`Points`** and **`Sprite`** with their materials; `LineLoop`; lines wider than one pixel.
4. **Render targets** and anything built on them (post-processing, picking by colour); tone mapping; `renderer.setViewport` and `setScissor`.
5. Per-instance culling and picking; `SkinnedMesh`, `LOD`; the animation system; loaders; controls (`OrbitControls` lives in `examples/`, outside the reference source).
6. Events on objects, `toJSON`, `uuid`; `box.min`, `ray.origin` and similar still return copies.
7. More shapes (polyhedra, capsule, lathe, tube, extrude); bindings for `Triangle`, `Line3`, `Spherical`, `Cylindrical`; integer attributes; `refreshViews()`.

### Needs decision

None blocking. Two notes:

1. Per-object update through the object API is still about 30% slower than three.js at 10,000 objects. Most of what is left is copying 17 numbers per changed object into the batch; sending only the changed parts is the next step if this matters.
2. Loaders and controls are what most real applications need next after shadows; both are outside the v1 source list of AGENTS.md (`src/loaders/`, and `examples/` for controls). Say if they should be brought in.

## Milestone: three.js baseline, Phase 4 exit check, lights, blending, lines, shapes (2026-10-13)

### 1. three.js r186 baseline demo

- `examples/threejs/` now builds, animates and draws the scene with three.js alone, using the same scene code as the WAMR3D object API (`examples/webgpu/scene.js`) and the three.js WebGPU renderer (`?engine=three-webgl` for WebGL).
- `examples/compare/`: engines `three-webgpu`, `three-webgl`, `api`, `native`, `three`, `wamr3d`; the side-by-side page has a selector for what to compare. `measure.mjs` takes `--engines=` and `--counts=`.

`node examples/compare/measure.mjs --gpu`, Chrome 155 headless, i9-10900X, RTX 2070 Super, 1280x720, 3 s warm-up, 8 s sample, medians, one run:

| objects | engine | fps | CPU update ms | draw submit ms | first frame ms |
|---|---|---|---|---|---|
| 2,007 | three.js r186, WebGL | 60 | 0.8 | 3.9 | 133 |
| 2,007 | three.js r186, WebGPU | 60 | 0.9 | 15.4 | 422 |
| 2,007 | WAMR3D object API, WebGPU | 60 | 1.7 | 2.0 | 173 |
| 2,004 | WAMR3D batched calls, WebGPU | 60 | 0.5 | 1.7 | 150 |
| 10,007 | three.js r186, WebGL | 60 | 3.3 | 16.2 | 137 |
| 10,007 | three.js r186, WebGPU | 9 | 7.9 | 99.8 | 687 |
| 10,007 | WAMR3D object API, WebGPU | 60 | 7.9 | 9.4 | 489 |
| 10,004 | WAMR3D batched calls, WebGPU | 60 | 2.6 | 7.7 | 174 |

How to read it:

- The first three rows of each group run the same scene code, so they are the like-for-like comparison. Against three.js with the same graphics API (WebGPU), WAMR3D submits draws about 8 to 11 times faster. Against three.js WebGL it is about 1.7 to 2 times faster.
- The object API spends more time updating than three.js (7.9 ms against 3.3 ms at 10,007 objects) because every property write crosses into WebAssembly. The batched calls (2.6 ms) are the fast path.
- At 10,007 objects three.js WebGL and the WAMR3D object API both exceed the 16.7 ms frame budget on some frames (402 and 427 frames of a possible 480 in the sample); the batched row does not.
- At 19 objects all engines are at 60 fps with updates at the timer resolution (0.1 ms).
- The adapter pair (`three`, `wamr3d`: both drawn by the three.js WebGL renderer, with a grid) measured 4.9 against 2.2 ms update and 23.1 against 22.4 ms draw at 10,004 objects, both at 30 fps.
- One run, headless, one machine. An earlier run of this session gave numbers 20 to 50% worse for every engine because 68 headless browsers left over from previous test runs were still alive; they were stopped and the scripts now stop the whole browser process tree.

### 2. Native renderer (Phase 4)

Exit criteria: **pass**. `node parity/visual/run.mjs` draws each case with WAMR3D and compares it with a stored three.js r186 WebGPU image (`parity/visual/reference/`, tolerance in DECISIONS.md D27: mean at most 1.5 of 255, at most 2% of pixels off by more than 12):

| case | what it covers | mean difference of 255 | pixels off |
|---|---|---|---|
| cube | unlit boxes, transforms, depth test | 0.000 | 0.00% |
| sphere | physically based material, directional + hemisphere light | 0.200 | 0.00% |
| plane | textured plane, uv orientation, colour space | 0.001 | 0.00% |
| triangle | one triangle; probes pin Y direction, X direction, winding | 0.001 | 0.00% |
| lights | point, spot and two directional lights, ambient | 1.028 | 0.02% |
| transparent | three blended panes over an opaque box, sorted | 0.034 | 0.05% |
| lines | vertex-coloured segment grid and a line strip | 0.009 | 0.00% |
| shapes | cylinder, cone, torus, ring, circle; repeated mipmapped texture | 0.114 | 0.02% |

AGENTS.md section 5: near plane to depth 0 (Rust unit test), Y direction and winding (triangle case), front face set explicitly (`ccw`), covered.

Added to the renderer: up to 8 directional, point and spot lights; alpha blending with back-to-front ordering; `depthTest`, `depthWrite`; `Line` and `LineSegments`; vertex colours; texture mipmaps, all six filters, `offset`/`repeat`/`rotation`/`center`; draw ranges; pipelines created per state and cached; linear output with blending and antialiasing in linear light (D28); index buffers re-uploaded when the index changes.

Known differences from three.js:

- The `lights` case is the weakest (mean 1.03): surfaces with the standard material are 1 to 3 levels of 255 off under point and spot lights. Cause not found; a multiple-scattering term for direct light was tried and did not change it.
- Opaque draws are ordered nearest first, not grouped by material.
- A `HemisphereLight` is treated as pointing up whatever its position.

### 3. Object API (Phase 5)

New in `wamr3d/compat`: `PointLight`, `SpotLight`, `Line`, `LineSegments`, `LineBasicMaterial`, `CylinderGeometry`, `ConeGeometry`, `CircleGeometry`, `RingGeometry`, `TorusGeometry`; material `transparent`, `opacity`, `depthTest`, `depthWrite`, `vertexColors`; texture `offset`, `repeat`, `center`, `rotation`, `generateMipmaps` and the mipmap filter constants. Typings updated (`compat.d.ts`, not compiled with TypeScript). Materials are now sent to the engine once per frame instead of once per mesh.

`node parity/bindings/compat-check.mjs`: the same script on three.js and on `wamr3d/compat`, 902 values (was 434), worst scaled error `5.4e-6`.

### 4. Port

`engine/objects/src/round.rs`: cylinder, cone, circle, ring, torus, with 40 new parity cases generated from `three/src/geometries` (168 cases in `parity/objects/objects.json`, earlier ones unchanged).

### Tests run for this milestone

| Check | Result |
|---|---|
| `cargo test --workspace` | 634 pass |
| `cargo build --workspace --target wasm32-unknown-unknown` | ok; package 438.7 KiB of WebAssembly |
| `node parity/visual/run.mjs` | 8 of 8 |
| `node examples/webgpu/smoke.mjs` (demo page; image against three.js WebGL) | 8 of 8; mean difference 0.193 / 0.823 / 0.379 |
| `node parity/bindings/compat-check.mjs` | 902 values, ok |
| `node parity/bindings/check.mjs` | 44,179 values, ok |
| `node examples/browser/smoke.mjs` (adapter demo, unchanged) | 7 of 7 |
| `node examples/basic/main.mjs` | ok |

Not run: the math suite on wasm32 with simd, `bench/bench.mjs`, TypeScript on the typings, any browser other than headless Chrome, a visible window. No automated test for `TextureLoader`, `CanvasTexture`, `SpotLight.penumbra` at values other than 0.4, or texture `rotation`.

### Remaining

- **Renderer:** environment reflections; normal, roughness and other maps; shadows; fog; instancing; points and sprites; wide lines and `LineLoop`; render targets; tone mapping; material arrays and geometry groups; a light component in the engine (lights are collected in JavaScript each frame).
- **Object API:** `matrixAutoUpdate = false`; `object.matrix`, `box.min` and similar still return copies; events on objects; `toJSON`; picking of lines; every class still listed as "not available yet".
- **Bindings:** `Triangle`, `Line3`, `Spherical`, `Cylindrical`, interleaved buffers, integer attributes, `refreshViews()`.
- **Shapes:** icosahedron and the other polyhedra, capsule, lathe, tube, extrude.

### Needs decision

1. **`examples/browser` still draws through the three.js adapter.** The native renderer can now draw everything that page shows, including the grid. Say if it should switch, or stay as the baseline.
2. **`GridHelper` and `AxesHelper`** live in `src/helpers/`, which AGENTS.md section 1.4 excludes. The demos build their grid from `LineSegments`. Allow porting those two?
3. **`wgpu`** (unchanged from the last milestone): AGENTS.md names it; the renderer still issues WebGPU calls from a JavaScript host (D24).
4. **Reference renderer for images** is now the three.js WebGPU renderer (D27, D28). Colours of blended and antialiased pixels therefore differ slightly from three.js WebGL output. Say if WebGL should be the target instead.

## Milestone: physically based materials, textures, explicit gaps (2026-10-13)

- Renderer: `MeshStandardMaterial` is now physically based for direct light (GGX specular from `roughness` and `metalness`, plus diffuse and hemisphere ambient). Colour textures (`map`) with uv, sRGB or linear, nearest or linear filtering, clamp/repeat/mirror wrapping. Materials carry `shading`, `roughness`, `metalness` and a texture id in the engine (D26).
- Object API: `Texture`, `DataTexture`, `CanvasTexture`, `TextureLoader`, `Clock`. Unsupported material parameters log one warning each. `matrixAutoUpdate = false` throws. 33 classes that do not exist yet (`WebGLRenderer`, `PointLight`, `Line`, `Points`, `InstancedMesh`, `CylinderGeometry`, `MeshPhongMaterial`, ...) are exported as names that throw "not available yet" when constructed.
- `examples/webgpu/` now uses physically based materials and a checker texture; `engine=native` and `engine=api` in the comparison use the same material settings as the three.js baseline.

Results:

- `cargo test --workspace`: 628 pass. Package 425 KiB. `check.mjs` and `compat-check.mjs` unchanged and passing. `examples/browser/smoke.mjs` 7 of 7.
- `node examples/webgpu/smoke.mjs`: 8 of 8. WebGPU image against the three.js WebGL image of the same scene code, mean difference of 255 per channel / pixels off by more than 12: diffuse 0.135 / 0.59%, physically based 0.855 / 0.57%, physically based with textures 0.402 / 0.69%. Limits are 1.5 and 2%. The physically based case differs most; the cause was not investigated.
- Not run: the simd math suite, `bench/bench.mjs`, TypeScript on `compat.d.ts`. `TextureLoader` and `CanvasTexture` have no automated test; only `DataTexture` is exercised.

`node examples/compare/measure.mjs --gpu` (same machine and method as below; all four now use roughness 0.55, metalness 0.05), medians:

| objects | engine | fps | CPU update ms | draw submit ms | first frame ms |
|---|---|---|---|---|---|
| 2,004 | three.js r186 (WebGL) | 60 | 1.7 | 3.7 | 150 |
| 2,004 | WAMR3D transforms + three.js WebGL adapter | 60 | 0.8 | 4.5 | 131 |
| 2,004 | WAMR3D native, batched calls (WebGPU) | 60 | 0.8 | 2.0 | 225 |
| 2,007 | WAMR3D native, object API (WebGPU) | 60 | 2.6 | 1.9 | 179 |
| 10,004 | three.js r186 (WebGL) | 30 | 4.5 | 24.4 | 202 |
| 10,004 | WAMR3D transforms + three.js WebGL adapter | 30 | 2.3 | 26.7 | 242 |
| 10,004 | WAMR3D native, batched calls (WebGPU) | 60 | 3.1 | 7.1 | 259 |
| 10,007 | WAMR3D native, object API (WebGPU) | 60 | 8.6 | 10.9 | 227 |

How to read it. "CPU update" is the engine and the JavaScript/WebAssembly boundary: rows 1 and 2 differ only there, and so do rows 3 and 4 (batched calls against one call per property). "Draw submit" is renderer work on the CPU: rows 2 and 3 share the same engine update path and differ in renderer, but also in graphics API (WebGL against WebGPU) and the three.js rows draw a grid, so that gap is not a like-for-like renderer comparison. WebAssembly start-up is 4 to 8 ms; first frame is slower for the WebGPU rows (device and pipeline creation). Frame rate is capped at 60 by the display.

Remaining gaps, unchanged apart from the above: no environment reflections, mipmaps, texture transforms, normal/roughness/other maps, transparency, shadows, point or spot lights, more than one directional light, instancing, lines, points, sprites, render targets; only box, plane and sphere shapes; no bindings for `Triangle`, `Line3`, `Spherical`, `Cylindrical`, interleaved buffers. `examples/browser` still draws through the three.js adapter (it shows a grid, which needs lines).

## Milestone: object API and first WebGPU renderer (2026-10-13)

**Renderer** (`engine/renderer_webgpu`, crate `wamr-renderer`, new; DECISIONS.md D24). In Rust: frustum culling, layers, visibility, draw order (render order, then nearest first), uniform packing with WebGPU depth 0..1, and the WGSL shader. `engine/bindings/js/webgpu.js` issues the WebGPU calls: three pipelines (front, back, both sides), 4x MSAA, vertex and index buffers uploaded only when the engine's attribute version changes, one uniform buffer for all objects read straight from engine memory. Draws opaque meshes with one colour, unlit or diffuse-lit by one directional light plus sky/ground ambient.

**Object API** (`engine/bindings/js/compat.js`, imported as `wamr3d/compat`; D25). `Scene`, `Group`, `Object3D`, `Mesh`, `PerspectiveCamera`, `OrthographicCamera`, `BufferGeometry`, `BufferAttribute`, `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshStandardMaterial`, `AmbientLight`, `HemisphereLight`, `DirectionalLight`, `Raycaster`, `WebGPURenderer`, and the math classes with default arguments, chaining and `target` parameters. `object.position.x = 1` and the like write straight into the engine.

Results, all run on 2026-10-13:

- `cargo test --workspace`: 628 pass. Every crate builds for `wasm32-unknown-unknown`. Package: 422 KiB of WebAssembly.
- `node parity/bindings/compat-check.mjs` (new): one application-style script (math chains, scene graph, property access, cameras, geometry, picking, cloning) run unchanged against three.js r186 and against `wamr3d/compat`: 434 values, worst scaled error `5.4e-6`. One case was changed while writing it: projecting a point and unprojecting the result differed by `1.6e-5` in depth (32-bit storage on an ill-conditioned round trip), so the script unprojects a fixed point instead.
- `node parity/bindings/check.mjs`: 44,179 values, worst `6.1e-6`.
- `node examples/webgpu/smoke.mjs` (new, headless Chrome, RTX 2070 Super): 9 of 9. The WebGPU image of a 40-object scene against the three.js WebGL render of the same scene code: mean difference 0.135 of 255 per channel, 0.59% of pixels differ by more than 12 (edges). Demo animates, orbits and picks.
- `node examples/browser/smoke.mjs`: 7 of 7.
- Not re-run: the math suite on wasm32 with simd, `bench/bench.mjs`. The typings in `compat.d.ts` have not been compiled with TypeScript.

`node examples/compare/measure.mjs --gpu`, Chrome 155 headless, i9-10900X, RTX 2070 Super, 1280x720, 3 s warm-up, 8 s sample, medians:

| objects | engine | fps | CPU update ms | draw submit ms |
|---|---|---|---|---|
| 2,004 | three.js r186 (WebGL) | 60 | 1.6 | 3.5 |
| 2,004 | WAMR3D transforms + three.js WebGL adapter | 60 | 0.9 | 4.1 |
| 2,004 | WAMR3D native, batched calls (WebGPU) | 60 | 0.9 | 1.5 |
| 2,007 | WAMR3D native, object API (WebGPU) | 60 | 2.5 | 1.7 |
| 10,004 | three.js r186 (WebGL) | 30 | 4.3 | 24.1 |
| 10,004 | WAMR3D transforms + three.js WebGL adapter | 30 | 2.2 | 23.7 |
| 10,004 | WAMR3D native, batched calls (WebGPU) | 60 | 2.9 | 6.2 |
| 10,007 | WAMR3D native, object API (WebGPU) | 60 | 8.3 | 9.2 |

At 16 objects all four are at 60 fps with 0.1 ms updates. Read the native rows with care: they use a different graphics API (WebGPU against WebGL), a simpler material (diffuse only against `MeshStandardMaterial`) and draw no grid, so the draw-submit gap is not purely an engine difference. The object API is slower than three.js at updating many objects one property at a time (8.3 ms against 4.3 ms at 10,000); the batched calls are the fast path.

Not done:

- Renderer: textures, physically based shading, more than one directional light, point and spot lights, shadows, transparency and blending, draw ranges and groups, instancing, lines, points, sprites, render targets, tone mapping, a WebGL fallback.
- Object API: `matrixAutoUpdate = false` with hand-written matrices, material arrays, `Clock`, events on objects, `toJSON`, and every class not listed above. `object.matrix`, `box.min`, `ray.origin` and similar return copies, so writing into them has no effect.
- Bindings: `Triangle`, `Line3`, `Spherical`, `Cylindrical`, interleaved buffers, render targets, integer attributes.
- AGENTS.md Phase 4 exit criteria ask for a textured plane and `MeshStandardMaterial`; neither exists yet.

Needs decision: AGENTS.md names `wgpu` for the renderer; D24 explains why this increment calls WebGPU from a JavaScript host instead. Say if you want `wgpu`.

## Milestone: picking, cloning, and the full math API in JavaScript (2026-10-13)

Native (Rust):

- `engine/objects/src/raycast.rs` (new): rays against the meshes of a world. `intersect_object`, `intersect_objects`, `set_from_camera` (perspective and orthographic), with bounding-sphere and bounding-box rejection, near/far, layers, material side, and per-hit distance, world point, face, barycentric coordinates, interpolated uv and normal.
- `engine/core`: `World::clone_object` (optionally recursive; shares geometry and material and keeps reference counts right); `Material` gained `side` (`Side::Front` / `Back` / `Double`).

Bindings (`engine/bindings`):

- New classes: `Vector2`, `Vector4`, `Matrix3`, `Euler`, `Color`, `Box3`, `Sphere`, `Plane`, `Ray`, `Frustum`, `RaycastHits`. The remaining methods of `Vector3`, `Quaternion` and `Matrix4`. The scalar helpers as functions and as a `MathUtils` object.
- `World`: `raycast`, `raycastFromCamera`, `cloneObject`, `layers` / `setLayers`, `setCameraZoom`, `setCameraViewOffset`, `clearCameraViewOffset`, `setMaterialSide`, `addGroup`, `setDrawRange`, `centerGeometry`, `toNonIndexed`.

Results: 622 native Rust tests pass; every crate builds for `wasm32-unknown-unknown`; `parity/bindings/check.mjs` compares 44,179 values through the built package with three.js r186 (worst scaled error `6.1e-6`, tolerance `1e-5`), including 80 camera rays against a transformed box and a child sphere, matched hit for hit; the browser smoke test passes 7 of 7. The package grew from 157 KiB to 394 KiB of WebAssembly with the added classes. The math suite on wasm32 with simd and both benchmarks were not re-run.

Rust types still without a JavaScript binding: `Triangle`, `Line3`, `Spherical`, `Cylindrical`, `Layers` (as a class), `InterleavedBuffer`, `RenderTarget`, `Uniform`, integer vertex attributes, and `Color` with an explicit colour-space argument. Still not implemented natively: the renderer; line, point, sprite and instanced objects and their picking; multi-material meshes; the other built-in shapes.


## Milestone: baseline demo, comparison, and port continued (2026-10-13)

### Comparison demo

Added `examples/threejs/` (the scene driven only by three.js r186) and `examples/compare/` (shared scene description, shared drawing code, one runner per engine, a side-by-side page, `measure.mjs`). The existing `examples/browser/` demo is unchanged. Pages and commands are in `README.md`.

Measured with `node examples/compare/measure.mjs --gpu`, one run:

```
Chrome/155.0.8059.40, win32 x64, Intel(R) Core(TM) i9-10900X CPU @ 3.70GHz
WebGL renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER (0x00001E84) Direct3D11 vs_5_0 ps_5_0, D3D11)
canvas 1280x720, pixel ratio 1, warm-up 3 s, sample 8 s per run, one engine per page load

objects  engine    frames   frame ms (median / p95)   fps   CPU update ms (median / p95)   draw submit ms (median)   first frame ms   wasm init ms
     16 three       480         16.70 / 16.90       60           0.000 / 0.100                 0.200                319             -
     16 wamr3d      481         16.70 / 16.90       60           0.100 / 0.200                 0.200                 80           3.9
   2004 three       480         16.70 / 16.90       60           0.800 / 1.200                 3.200                 96             -
   2004 wamr3d      480         16.70 / 16.90       60           0.500 / 0.800                 3.800                 94           3.2
  10004 three       341         16.80 / 33.40       60           4.200 / 5.000                18.700                140             -
  10004 wamr3d      346         16.80 / 33.40       60           2.200 / 2.600                20.400                191           3.3
```

How to read it:

- **Frame rate does not separate the engines.** Both hit the 60 Hz display cap up to 2,004 objects, and at 10,004 both drop frames equally because drawing 10,000 separate meshes costs about 19 ms either way. Both sides use the same three.js renderer.
- **CPU update is the engine comparison.** WAMR3D took 0.5 ms against 0.8 ms at 2,004 objects and 2.2 ms against 4.2 ms at 10,004. That is with one batched call for the rotations and one for reading the matrices back. At 16 objects both are at the timer's resolution.
- **Draw submission is slightly higher on the WAMR3D side** (20.4 against 18.7 ms at 10,004) because the adapter copies every world matrix into a renderer object before drawing. A native renderer would not need that copy.
- **Timer resolution is 0.1 ms** (the browser coarsens `performance.now()`), so the small numbers are rough.
- **Time to first frame is not comparable between rows:** the first page load of the run (319 ms) paid for a cold cache.
- One run, headless Chrome, one machine. No visible-window, Firefox or Safari measurement.

### Port: what was added

| Area | Added | Tests |
|---|---|---|
| `engine/core` | `Camera` component (perspective and orthographic projection, zoom, view offset, film offset, focal length, view bounds, view matrix without scale); `World::set_camera`, `look_at`, `attach`, `get_world_position/quaternion/scale/direction`, `local_to_world`, `world_to_local`; camera view matrices follow world-matrix updates | 12 new unit tests (100 in the crate) |
| `engine/objects` (new crate `wamr-objects`) | `box_geometry`, `plane_geometry`, `sphere_geometry` | 6 unit tests; parity: 128 cases in `parity/objects/objects.json` (shapes exact; cameras and world-space methods within `6.8e-7`) |
| `engine/bindings` | `createBoxGeometry`, `createPlaneGeometry`, `createSphereGeometry`, `getIndex`, `setPerspectiveCamera`, `setOrthographicCamera`, `setCameraAspect`, `projectionMatrix`, `projectionMatrixInverse`, `matrixWorldInverse`, `lookAt`, `attach`, `getWorld*`, `localToWorld`, `worldToLocal`, `setRotations` | `parity/bindings/check.mjs`: 35,792 values through the built package, worst scaled error `2.2e-6` |

Totals now: 614 native Rust tests pass; every crate builds for `wasm32-unknown-unknown`; the package is 157 KiB. The math suite on wasm32 with simd and the benchmark in `bench/` were not re-run in this milestone.

Project name is WAMR3D in the documents and crate descriptions; the repository folder is still called `WAMRNative`.

### Found while testing

- **Large angles lose precision at the API boundary.** A demo page left running for about 16 minutes showed a transform difference of `1.3e-4`, above its `1e-5` tolerance. By then the animation angles were over 1,000 radians: the engine receives them as 32-bit floats, while the comparison side keeps 64-bit doubles. A freshly loaded page is at `3e-7`. `examples/browser` was left unchanged as instructed; the fix belongs either in that demo's check (round the inputs for both sides) or in the animation (wrap angles), and is noted here for a decision.
- **Stale headless browsers.** The test scripts started Chrome but did not always stop its helper processes, and a later run attached to an old page. The scripts now use a random debugging port per run. Some headless Chrome processes from earlier runs may still be running on this machine; they were left alone and can be closed from Task Manager.

### Still missing for a three.js replacement

Roughly in the order `AGENTS.md` gives:

1. **Objects (Phase 3):** `Mesh`, `Points`, `Line`, `LineSegments`, `Group`, `Sprite`, `LOD`, `InstancedMesh` as components with their own raycasting; `Raycaster.setFromCamera` and `intersectObject(s)`; `clone`/`copy`; the remaining shapes; the 1,000-node world-matrix fixture and the dirty-subtree counter test that Phase 3's exit criteria ask for.
2. **Renderer (Phase 4):** nothing exists. WebGPU device, pipelines and their cache, buffer upload, WGSL for basic and standard materials, lights, textures, render targets with textures. This is the largest remaining piece and what replaces the temporary adapter.
3. **Bindings (Phase 5):** a JavaScript facade with the familiar constructors, properties, defaults and chaining; the other math types; `refreshViews()`; a canvas entry point and frame loop.
4. Out of v1 scope per `AGENTS.md` and untouched: loaders, animation, audio, the node material system, WebGL and WebXR renderers.

## Milestone: browser demo (2026-10-13)

`node examples/browser/serve.mjs`, then open `http://localhost:8080/examples/browser/`.

Files added: `examples/browser/index.html`, `main.js` (scene, camera and frame loop on WAMR3D), `render-adapter.js` (temporary three.js r186 WebGL adapter, draw only), `reference-check.js` (comparison mode), `serve.mjs` (static server, builds the package if missing), `smoke.mjs` (headless browser test). `README.md` has a "Browser demo" section. No engine code changed.

Verified with `node examples/browser/smoke.mjs` in headless Chrome (software WebGL):

```
PASS  WebAssembly initialized
PASS  no page error
PASS  frames are being rendered
PASS  frame rate is shown
PASS  objects in world
PASS  transform parity passes
PASS  dragging orbits the camera
frames 162 -> 235, 60 fps (software rendering), largest difference 3.35e-7, yaw 0.700 -> -0.500
```

A screenshot was also inspected: cube, twelve orbiting cubes, floor and grid render lit and correctly placed. Not verified: a visible (non-headless) browser window, GPU-accelerated WebGL, wheel zoom, touch input, Firefox and Safari.

The picture is drawn by the three.js WebGL renderer through the adapter. That is a stand-in for the missing WAMR3D renderer, not a replacement for it.

## Milestone: WebAssembly module (2026-10-13)

### Definition of done

| # | Item | Result |
|---|---|---|
| 1 | Native workspace builds | Pass: `cargo test --workspace` builds and runs all three crates |
| 2 | WebAssembly target builds | Pass: `cargo build --workspace --target wasm32-unknown-unknown`, and the release build in `build.mjs` |
| 3 | Generated JavaScript module imports into a normal JavaScript application | Pass under Node.js v24: `import { init, World, ... } from 'dist/wamr3d/index.js'`. Not run in a browser. |
| 4 | Example initializes the module and runs math and core operations | Pass: `node examples/basic/main.mjs` prints its results and `ok` |
| 5 | Native and WASM tests | Pass: 595 native tests; math suite on `wasm32-wasip1` with simd (497 run, 6 skipped); end-to-end check of the built package (33,915 values). Not run: `wamr-core` and `wamr3d` Rust tests on wasm, `clippy`, `rustfmt`. |
| 6 | Benchmark against three.js r186 | Done: `node bench/bench.mjs`, results below |
| 7 | Build, usage, test and benchmark instructions | `README.md` |
| 8 | Unsupported functionality identified | `README.md` "Not included yet", and "Limitations" below |

### Commands

```
node engine/bindings/build.mjs            # build dist/wamr3d (release wasm + ES module)
node examples/basic/main.mjs              # example
node parity/bindings/check.mjs            # end-to-end check of the built package
node bench/bench.mjs                      # benchmark
cd engine && cargo test --workspace       # Rust tests (native)
cd engine && cargo build --workspace --target wasm32-unknown-unknown
cd engine/math && RUSTFLAGS="-C target-feature=+simd128" cargo test --target wasm32-wasip1 --features simd
```

Rust is not on PATH on this machine; `build.mjs` finds `cargo` and `wasm-bindgen` in `%USERPROFILE%\.cargo\bin`. For the `cargo` lines above, add that folder to PATH first.

### Artifacts

`dist/wamr3d/` (not checked in; listed in `.gitignore`): `index.js`, `index.d.ts`, `wamr3d_wasm.js`, `wamr3d_wasm.d.ts`, `wamr3d_wasm_bg.wasm` (132.1 KiB), `wamr3d_wasm_bg.wasm.d.ts`, `package.json`.

### Files added or changed in this milestone

Added:
- `engine/bindings/Cargo.toml`, `src/lib.rs` (crate `wamr3d`: `Vector3`, `Quaternion`, `Matrix4`, `Timer`, `World`), `build.mjs`, `js/index.js`, `js/index.d.ts`, `js/package.json`
- `examples/basic/main.mjs`
- `parity/bindings/check.mjs`
- `bench/bench.mjs`
- `README.md`, `.gitignore`, `engine/.gitignore`

Changed:
- `engine/Cargo.toml`: `bindings` member, release profile (`opt-level = 3`, `lto`, one codegen unit)
- `engine/core/src/world.rs`: `World::update_matrix_world` and `World::update_world_matrix` added, with three unit tests (this was listed as Phase 3 work in D17; it moved because the scene graph is not usable without it)
- `engine/core/src/constants.rs`, `engine/core/src/lib.rs`, `engine/math/src/lib.rs`: module docs no longer name source paths
- `DECISIONS.md` (D21), this file

Installed outside the repository: `wasm-bindgen.exe` 0.2.129 in `%USERPROFILE%\.cargo\bin` (prebuilt release binary; `cargo install wasm-bindgen-cli` fails to compile on this GNU toolchain).

### Verification output

Raw output, run from the repository root (Git Bash), colour codes removed.

```
$ cargo test -q --workspace --manifest-path engine/Cargo.toml

running 88 tests
....................................................................................... 87/88
.
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s


running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s


running 482 tests
....................................................................................... 87/482
....................................................................................... 174/482
....................................................................................... 261/482
....................................................................................... 348/482
....................................................................................... 435/482
...............................................
test result: ok. 482 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s


running 20 tests
....................
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s


running 3 tests
...
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

[exit 0]

$ cargo build -q --workspace --target wasm32-unknown-unknown --manifest-path engine/Cargo.toml
[exit 0]

$ (cd engine/math && RUSTFLAGS="-C target-feature=+simd128" cargo test -q --target wasm32-wasip1 --features simd)

running 483 tests
....................................................................................... 87/483
....................................................................................... 174/483
....................................................................................... 261/483
...............................................................i...............i....... 348/483
.................................i...............i..................................... 435/483
..........i...............i.....................
test result: ok. 477 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out; finished in 0.23s


running 20 tests
....................
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s

[exit 0]

$ node engine/bindings/build.mjs
> cargo.exe build --release --target wasm32-unknown-unknown -p wamr3d
> wasm-bindgen.exe --target web --out-dir C:\Users\Ay\Documents\projects\WAMR3D\dist\wamr3d --out-name wamr3d_wasm C:\Users\Ay\Documents\projects\WAMR3D\engine\target\wasm32-unknown-unknown\release\wamr3d.wasm
built C:\Users\Ay\Documents\projects\WAMR3D\dist\wamr3d (wamr3d_wasm_bg.wasm: 132.1 KiB)
[exit 0]

$ node examples/basic/main.mjs
WAMR3D 0.1.0
point (1, 0, 0) through translate * rotate * scale: [ 1, 2, 1 ]
and back through the inverse: [ 1, 0, 0 ]
depth of a point on the near plane (0..1 clip space): 0
hand world position: [ 10, 1, 0 ]
found by name: true
events queued: 4
first vertex normal: [ 0, 0, 1 ]
bounding sphere (center xyz, radius): [ 0.5, 0.5, 0, 0.7071 ]
bounding box after moving one vertex (min xyz, max xyz): [ 0, 0, 0, 1, 1, 5 ]
objects drawing the quad: 1
objects alive after destroying the tree: 0 | hand handle alive: false
frame delta (s): 0.017 | elapsed (s): 0.033
ok
[exit 0]

$ node parity/bindings/check.mjs
33915 values compared, largest scaled error 2.182e-6 (tolerance 0.00001)
ok
[exit 0]
```

### Benchmark results

> Superseded by [Benchmarks rerun (2026-10-14)](#benchmarks-rerun-2026-10-14); kept as the record of this milestone.

`node bench/bench.mjs` on this machine (Node v24.19.0, Windows x64), release build, 5 warm-up runs and 25 samples per workload. One run; expect a few percent of variation between runs.

```
node v24.19.0, win32 x64; 5 warm-up runs, 25 samples per workload

start-up (one time, not included below)
  wamr3d: import 2.0 ms, init (compile + instantiate 132 KiB of wasm) 24.1 ms
  three:  import 168.0 ms (unbundled source modules)

workload                                                              side      median ms    min ms    max ms   ns/op   wamr3d/three
Matrix4.multiplyMatrices                                              three       6.221      5.705     6.439     31.1   
                                                                      wamr3d     11.125     10.930    11.424     55.6   1.79x
Matrix4.invert (copy + invert)                                        three       6.907      6.746     7.067     34.5   
                                                                      wamr3d     10.005      9.881    10.258     50.0   1.45x
Vector3.applyMatrix4                                                  three       1.896      1.873     1.980      9.5   
                                                                      wamr3d      6.825      6.719     7.090     34.1   3.60x
Vector3.applyQuaternion                                               three       1.658      1.609     1.719      8.3   
                                                                      wamr3d      6.356      6.241     6.558     31.8   3.83x
boundary: getter (v.x)                                                three       1.401      1.310     1.496      7.0   
                                                                      wamr3d      2.375      2.302     2.512     11.9   1.69x
boundary: call with a handle (isAlive / .visible)                     three       1.377      1.319     1.481      6.9   
                                                                      wamr3d      7.301      7.104     7.585     36.5   5.30x
scene: update 10,000 world matrices (transforms unchanged, forced)    three       1.146      1.083     1.282    114.6   
                                                                      wamr3d      0.723      0.715     0.797     72.3   0.63x
scene: set 10,000 transforms + update, one call per property          three       2.628      2.494     2.827    262.8   
                                                                      wamr3d      2.972      2.833     4.021    297.2   1.13x
scene: set 10,000 transforms + update, one batched call               three       2.555      2.469     2.729    255.5   
                                                                      wamr3d      1.577      1.557     1.646    157.7   0.62x
scene: read back 10,000 world matrices into one Float32Array          three       0.849      0.819     0.919     84.9   
                                                                      wamr3d      0.259      0.245     0.285     25.9   0.31x
scene: create + parent + destroy 10,000 objects                       three      36.449     26.386    67.746   3644.9   
                                                                      wamr3d      1.582      1.551     1.893    158.2   0.04x
geometry: computeVertexNormals                                        three      10.610     10.410    10.927    160.6   
                                                                      wamr3d      9.085      8.890     9.330    137.5   0.86x
geometry: computeBoundingSphere                                       three       1.089      1.079     1.194     16.5   
                                                                      wamr3d      1.976      1.950     2.069     29.9   1.81x
geometry: applyMatrix4 (positions + normals)                          three       2.838      2.718     5.525     43.0   
                                                                      wamr3d      6.667      6.442     7.324    100.9   2.35x
geometry: upload positions + index (copy into the engine)             three       0.472      0.439     0.907      7.2   
                                                                      wamr3d      0.525      0.521     0.588      8.0   1.11x

wamr3d/three is the ratio of median times: below 1 means WAMR3D was faster, above 1 slower.
```

What the numbers say:

- **WAMR3D is slower wherever JavaScript calls it once per small operation.** Single math calls are 1.5x to 3.8x slower than three.js, and a call that passes a handle costs about 37 ns against 7 ns for a property read. The work itself is tiny, so the JS/Wasm boundary (and the `BigInt` handle conversion) dominates.
- **WAMR3D is faster when one call does a lot of work.** Updating 10,000 world matrices takes 0.63x the time; setting 10,000 transforms through one batched call and updating takes 0.62x; reading 10,000 world matrices back takes 0.31x.
- **Per-property setters cancel the gain:** setting the same 10,000 transforms with three calls per object comes out at 1.13x, slightly slower than three.js.
- **Geometry is mixed.** `computeVertexNormals` is a little faster (0.86x). `computeBoundingSphere` (1.81x) and `applyMatrix4` (2.35x) are slower even though each is a single call. That is not boundary cost. Likely causes, not yet measured: the f64 arithmetic with f32 rounding on every store (DECISIONS.md D1), and per-component accessor dispatch on the attribute array.
- **The create/destroy row is not an equal comparison.** three.js allocates 10,000 full objects (vectors, matrices, a UUID each) and leaves freeing to the garbage collector, outside the timed region; WAMR3D creates and destroys them explicitly inside it. Read it as "object churn is cheap here", not as a 25x speed-up.
- **Start-up:** `init()` took 24 ms to compile and instantiate the 132 KiB module. The 168 ms three.js figure is for importing unbundled source files and says nothing about a bundled build.

No general speed-up is claimed. The practical conclusion for the API is that batch calls and typed-array views are the fast path, and chatty per-object calls are not.

### Limitations

- No renderer, cameras, lights, textures or real materials.
- The JavaScript API covers `Vector3`, `Quaternion`, `Matrix4`, `Timer` and `World`. The remaining math types and several core features exist in Rust only (list in `README.md`).
- JavaScript methods do not chain and objects created with `new` must be `free()`d.
- Handles are `bigint`, which is the slowest argument type to pass (see the benchmark). A cheaper encoding is possible if per-object calls must be fast.
- Zero-copy attribute views are invalidated when Wasm memory grows; there is no `refreshViews()` helper yet, the documented rule is "create the view right before use".
- Only float attributes can be created from JavaScript.
- Verified under Node.js only. No browser run, no bundler test.
- `attach`, `lookAt`, world-space queries, raycasting against objects: not implemented.

---

# Earlier phases

## Phase 2 exit criteria

| Criterion (AGENTS.md 4, Phase 2) | Result | Evidence |
|---|---|---|
| Create and destroy 10,000 objects in a loop; memory returns to baseline (counting allocator) | **Pass** | `engine/core/tests/alloc.rs`: 4 cycles of 10,000 named, parented, renderable objects. Live bytes are identical after every cycle (5,375,774 B of retained capacity, no growth), and equal to the 24 B baseline once the `World` is dropped. `World::shrink_to_fit` on the empty world brings it to 120,910 B. |
| `DECISIONS.md` contains the class-to-component map and the ownership rules | **Pass** | `DECISIONS.md` sections 5.1 (class hierarchy), 5.2 (class-to-component map), 5.3 (ownership and disposal), 5.4 (events), written before the code. |

Read the first row carefully: memory returns to baseline when the world is dropped. While the world is alive, a create/destroy loop does not grow memory, but the arenas keep their capacity (and, after `shrink_to_fit`, about 12 bytes per slot that was ever used, which is what makes stale handles fail).

## Phase 2 — verified source files

`ls three/src/core/` on 2026-10-13:

```
BufferAttribute.js  BufferGeometry.js  Clock.js  EventDispatcher.js  GLBufferAttribute.js
InstancedBufferAttribute.js  InstancedBufferGeometry.js  InstancedInterleavedBuffer.js
InterleavedBuffer.js  InterleavedBufferAttribute.js  Layers.js  Object3D.js  Raycaster.js
RenderTarget.js  RenderTarget3D.js  Timer.js  Uniform.js  UniformsGroup.js
```

- All 14 files listed in AGENTS.md exist.
- In r186 but not listed: `GLBufferAttribute.js`, `InstancedInterleavedBuffer.js`, `RenderTarget3D.js`, `UniformsGroup.js`. Only `InstancedInterleavedBuffer` is covered (as a field on `InterleavedBuffer`).

## What Phase 2 delivered

`engine/core`, crate `wamr-core`, depending only on `wamr-math`:

| File | Contents |
|---|---|
| `arena.rs` | `Handle<T>` (u32 index + u32 generation, `to_bits`/`from_bits` as one `u64`), `Arena<T>`, per-entity component columns |
| `world.rs` | `World`, `Entity`, `CoreEvent` and the event queue, scene-graph links (`add`, `remove`, `remove_from_parent`, `clear`), traversals, `destroy` / `destroy_recursive`, stores and reference counts for geometries, materials, render targets and interleaved buffers |
| `components.rs` | `Transform` (with the local transform helpers and `update_matrix`), `Hierarchy`, `Visibility`, `Renderable` |
| `attribute.rs` | `AttributeArray`, `BufferAttribute` (plain and instanced), `InterleavedBuffer`, `InterleavedBufferAttribute`, the `AttributeAccess` trait |
| `geometry.rs` | `BufferGeometry` (plain and instanced): attributes, index, groups, draw range, bounds, transforms, vertex normals, tangents, `to_non_indexed` |
| `layers.rs` | `Layers` |
| `resources.rs` | `RenderTarget`, `Uniform<T>`, `Timer`, `Raycaster`, and a placeholder `Material` |
| `constants.rs` | `Usage`, `GpuType` |

The crate is `#![forbid(unsafe_code)]`. The only `unsafe` in the repository is the counting allocator in `engine/core/tests/alloc.rs`, with `SAFETY` comments.

## Files added, modified, removed

Added:
- `engine/Cargo.toml` (workspace), `engine/Cargo.lock`
- `engine/core/Cargo.toml`, `engine/core/src/*.rs` (9 files, table above), `engine/core/tests/parity.rs`, `engine/core/tests/alloc.rs`
- `parity/core/gen/generate.mjs`, `parity/core/core.json` (generated)

Modified:
- `AGENTS.md`: ground rule 2 is now the comment policy, rule 6 points attribution at `THIRD_PARTY.md` (DECISIONS.md D15). Rule 2 had already been removed from the file when I edited it.
- `engine/math/src/*.rs`, `engine/math/tests/parity.rs`: source citations and per-file attribution headers removed. No code changed; all 502 math tests still pass. This is an edit to another phase's code, made on the owner's instruction.
- `parity/math/gen/gen_color_names.mjs` and the generated `engine/math/src/color_names.rs`: header without the citation.
- `DECISIONS.md`: section 4 (Phase 1 approvals, D15), section 5 (Phase 2 analysis, D16 to D20).
- `THIRD_PARTY.md`: table of derived directories.
- `STATUS.md`: this file.

Removed:
- `engine/math/Cargo.lock` (replaced by the workspace lock file). Build output moved from `engine/math/target/` to `engine/target/`; the old folder can be deleted.

Note on `engine/math` doc comments: when I started the cleanup, every `///` doc comment in `engine/math/src` was already gone, including the ones that were not citations (panics, JS default values, "not ported" lists). I did not restore them. Say so if you want the non-citation ones back.

## Tests

| Suite | Count | Result |
|---|---|---|
| `wamr-core` unit tests | 85 | pass |
| `wamr-core` parity (`tests/parity.rs`): 312 cases, 17 ops, generated from three.js `src/core` | 1 | pass, largest scaled error `4.7e-7` |
| `wamr-core` allocation (`tests/alloc.rs`) | 1 | pass |
| `wamr-math` unit tests | 482 | pass |
| `wamr-math` parity: 7,186 cases, 388 ops | 20 | pass |
| `wamr-math` on `wasm32-wasip1` with simd128 | 477 + 20 (6 `should_panic` skipped) | pass |
| `cargo build --workspace --target wasm32-unknown-unknown`, with and without `wamr-math/simd` | | pass |

Not run: `clippy`, `rustfmt` (not installed). `wamr-core` tests were not run on wasm (DECISIONS.md D20).

Core parity covers: `Layers`; `BufferAttribute` get/set for all eight typed-array kinds, raw and normalized, including out-of-range writes; the attribute transform helpers; `BufferGeometry` bounds, vertex normals, tangents, `center`, `applyMatrix4`, `toNonIndexed`, index width; `Object3D` local transforms including pivot and rotation/quaternion sync; `Object3D` `add`/`remove`/`removeFromParent`/`clear` with the exact event order; `Timer`.

Not covered by parity, unit tests only: `InterleavedBuffer` and `InterleavedBufferAttribute`, `RenderTarget`, `Raycaster`, `Uniform`, and everything that has no three.js counterpart (arena, handles, stores, reference counts, `destroy`).

How to run:

```
node parity/core/gen/generate.mjs
cd engine
cargo test --workspace
cargo test -p wamr-core --test parity -- --nocapture
cargo test -p wamr-core --test alloc -- --nocapture
cargo build --workspace --target wasm32-unknown-unknown
```

## Verification output

Raw output, run from `engine/` on 2026-10-13 (Git Bash). Only terminal colour codes were removed.

```
$ cargo test -q --workspace

running 85 tests
.....................................................................................
test result: ok. 85 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s


running 1 test
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s


running 482 tests
....................................................................................... 87/482
....................................................................................... 174/482
....................................................................................... 261/482
....................................................................................... 348/482
....................................................................................... 435/482
...............................................
test result: ok. 482 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s


running 20 tests
....................
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s

[exit 0]

$ cargo test -q -p wamr-core --test parity -- --nocapture

running 1 test
parity BufferAttribute.access                  96 cases  1344 values  max |err|/max(1,|exp|) 2.969e-8
parity BufferAttribute.applyMatrix3            10 cases    87 values  max |err|/max(1,|exp|) 0.000e0
parity BufferAttribute.applyMatrix3.uv         10 cases    58 values  max |err|/max(1,|exp|) 0.000e0
parity BufferAttribute.applyMatrix4            10 cases    87 values  max |err|/max(1,|exp|) 0.000e0
parity BufferAttribute.applyNormalMatrix       10 cases    87 values  max |err|/max(1,|exp|) 0.000e0
parity BufferAttribute.transformDirection      10 cases    87 values  max |err|/max(1,|exp|) 0.000e0
parity BufferGeometry.applyMatrix4             16 cases   742 values  max |err|/max(1,|exp|) 6.667e-8
parity BufferGeometry.bounds                   16 cases   160 values  max |err|/max(1,|exp|) 6.002e-8
parity BufferGeometry.center                   16 cases   411 values  max |err|/max(1,|exp|) 1.189e-7
parity BufferGeometry.computeTangents           8 cases   132 values  max |err|/max(1,|exp|) 1.192e-7
parity BufferGeometry.computeVertexNormals     16 cases   258 values  max |err|/max(1,|exp|) 5.960e-8
parity BufferGeometry.setIndex                  6 cases    24 values  max |err|/max(1,|exp|) 0.000e0
parity BufferGeometry.toNonIndexed              8 cases   315 values  max |err|/max(1,|exp|) 0.000e0
parity Layers.script                           24 cases   240 values  max |err|/max(1,|exp|) 0.000e0
parity Object3D.hierarchy                      24 cases  1160 values  max |err|/max(1,|exp|) 0.000e0
parity Object3D.transform                      24 cases  1320 values  max |err|/max(1,|exp|) 4.745e-7
parity Timer.updates                            8 cases    96 values  max |err|/max(1,|exp|) 0.000e0
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

[exit 0]

$ cargo test -q -p wamr-core --test alloc -- --nocapture

running 1 test
alloc: baseline 24 B, live after each of 4 cycles [5375774, 5375774, 5375774, 5375774] B, after shrink_to_fit 120910 B, after drop 24 B, 108422 allocations
.
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s

[exit 0]

$ cargo build --workspace --target wasm32-unknown-unknown
   Compiling wamr-math v0.1.0 (C:\Users\Ay\Documents\projects\WAMR3D\engine\math)
   Compiling wamr-core v0.1.0 (C:\Users\Ay\Documents\projects\WAMR3D\engine\core)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.00s
[exit 0]

$ RUSTFLAGS="-C target-feature=+simd128" cargo build --workspace --target wasm32-unknown-unknown --features wamr-math/simd
   Compiling wamr-math v0.1.0 (C:\Users\Ay\Documents\projects\WAMR3D\engine\math)
   Compiling wamr-core v0.1.0 (C:\Users\Ay\Documents\projects\WAMR3D\engine\core)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.02s
[exit 0]

$ (cd math && RUSTFLAGS="-C target-feature=+simd128" cargo test -q --target wasm32-wasip1 --features simd)

running 483 tests
....................................................................................... 87/483
....................................................................................... 174/483
....................................................................................... 261/483
...............................................................i...............i....... 348/483
.................................i...............i..................................... 435/483
..........i...............i.....................
test result: ok. 477 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out; finished in 0.23s


running 20 tests
....................
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.26s

[exit 0]

$ node ../parity/core/gen/generate.mjs && sha256sum ../parity/core/core.json
17 ops, 312 cases -> C:\Users\Ay\Documents\projects\WAMR3D\parity\core\core.json
ddfa4fedb6fb0824c0ea2f4c613e7fcafc50efa04ce2fd7d82c4de1c4b8f440b *../parity/core/core.json
[exit 0]

$ node ../parity/math/gen/generate.mjs 2>/dev/null | tail -1 && sha256sum ../parity/math/*.json | sha256sum
388 ops, 7186 cases -> C:\Users\Ay\Documents\projects\WAMR3D\parity\math
8614a1b5f58ba9d115370c588083d622e7c41c50c633f5b15bbe183b31144992 *-
[exit 0]
```

## Open questions and unresolved decisions (Phase 2)

1. **Interleaved attributes in geometries.** The types and the shared store exist, but `BufferGeometry` only holds plain attributes (D19). Wire them in now, or wait until a loader or the renderer needs them?
2. **`dispose` frees the value (D19).** three.js keeps a disposed object usable. Is "dispose = destroy" acceptable for the JS-facing API, or should the bindings offer a separate "release GPU resources" call for geometries and materials, as already exists for render targets and objects?
3. **Retained capacity.** An emptied world keeps its arenas' capacity until `shrink_to_fit` or drop. Is that the intended reading of "memory returns to baseline"?
4. **`Material` is a placeholder** (`{ name }`). Phase 4 must define the real type; the store, handle and reference counting are ready for it.
5. **`RenderTarget` has no textures.** `src/textures/` is out of v1 scope, so only the descriptor is ported (`texture_count`, flags, size). Phase 4 needs to decide where render-target textures live.
6. **`Float16BufferAttribute`** needs `toHalfFloat` / `fromHalfFloat` from `src/extras/DataUtils.js`, which is out of scope. Port those two functions when half-float attributes are needed?
7. **Not ported from `src/core`:** `Clock` (deprecated upstream), `GLBufferAttribute` (WebGL), `RenderTarget3D`, `UniformsGroup`, `Object3D.uuid`/`userData`/`animations`/render hooks, morph attributes. Confirm, or name the ones wanted.
8. **Event subscribers.** Events are a queue drained once per frame. three.js calls listeners synchronously. Subscriber closures for JS are left to Phase 5; say if synchronous delivery is required earlier.

Still open from Phase 1: the random helpers (deferred to the bindings phase, A3) and the unlisted math files (deferred, A6).

## Blockers

None.

## Handoff notes for Phase 3

- **Scope left for you** (DECISIONS.md D17): `attach`, `lookAt`, `updateMatrixWorld`, `updateWorldMatrix` with dirty-subtree tracking, `localToWorld`, `worldToLocal`, `getWorld*`, `raycast`, `clone`/`copy`, `Raycaster.setFromCamera` and `intersectObject(s)`. `Transform` already has `matrix_world`, `matrix_world_auto_update` and `matrix_world_needs_update`; `Transform::update_matrix` sets the flag exactly as three.js does.
- Cameras and meshes are new components next to `Transform`/`Visibility`/`Renderable`. `World`'s component columns are private; add a column per new component in `engine/core/src/world.rs` and log the edit, or propose a generic component API first.
- `World::add`/`remove` already queue `Added`, `Removed`, `ChildAdded`, `ChildRemoved` in three.js order (checked by parity).
- Pass `CoordinateSystem::WebGPU` when building projection matrices (see the Phase 1 notes in DECISIONS.md).
- Chains of f32 operations drift slightly from JS at each step. Generate the 1,000-node world-matrix fixtures with `Math.fround` after each step, or use a tolerance that grows with depth.
- Rust is not on PATH: use `%USERPROFILE%\.cargo\bin\cargo.exe`.
