# STATUS.md: WAMR3D

## In progress

- **Environment reflections.** Prefiltering (three.js PMREM) and image-based lighting exist in the renderer and work through the low-level API (`setEnvironment`, `setMaterialEnvironment`). Still missing: the object API does not read `scene.environment` or `envMap`, and there is no visual case.
- **No WebGL fallback.** Without WebGPU, `renderer.init()` rejects; three.js r186 switches to WebGL 2 by itself. Until a fallback exists, applications choose the library at start-up (MIGRATION.md, "Browsers without WebGPU").

## Measurements

The latest benchmark run (2026-10-14, four canvas resolutions, one run per configuration on one machine) has its raw logs in `bench/results/2026-10-14/`; the website's figures in `website/src/data/benchmarks.js` are a checked-in projection of those logs. The run predates the shadow, tone mapping, points, sprite and render-target features, so it measures the showcase workloads, not the cost of those effects.

## Undeveloped and incomplete work

### Renderer and materials

- Wire environment settings into the object API: `scene.environment`, `scene.environmentIntensity`, `scene.environmentRotation`, `material.envMap`, `envMapIntensity`, and `envMapRotation`. The low-level environment API exists, but object API support and visual parity coverage are missing.
- Add texture maps beyond the colour `map`, including normal, roughness, metalness, and related maps.
- Implement point-light shadows, area lights, shadow filtering modes other than PCF, and scene background textures.
- Implement post-processing, render-target depth textures, and multiple render-target attachments.
- Add a WebGL fallback. The current renderer requires WebGPU.
- Support lines wider than one pixel. Points currently render at one pixel.
- Improve physically based lighting parity; a strong-light comparison still differs by about 1.8/255.

### Object API and geometry

- Add missing object and material classes, including `LineLoop`, `SkinnedMesh`, `LOD`, `MeshPhongMaterial`, `MeshPhysicalMaterial`, `MeshToonMaterial`, `MeshNormalMaterial`, and `ShaderMaterial`.
- Add picking for sprites and individual instances of `InstancedMesh`.
- Add morph targets, interleaved buffers, and JavaScript bindings for integer vertex attributes.
- Add geometry primitives beyond box, plane, sphere, cylinder, cone, circle, ring, and torus.
- Add JavaScript bindings for `Triangle`, `Line3`, `Spherical`, and `Cylindrical`.

### Supporting systems

- Add loaders beyond `TextureLoader`, including object and buffer geometry loading. glTF support would require an add-on.
- Add animation, audio, controls, and additional helpers.
- Add random helpers and UUID support.

## Constraints

The renderer targets WebGPU. TSL/node-based rendering, WebGL backends, and the listed out-of-scope Three.js systems remain unported. No schedule is assigned to these items.
