# Architecture

How WAMR3D is put together. The rules that constrain it are in [CONTRIBUTING.md](CONTRIBUTING.md#rules).

## Layers

```
application code
 ├─ wamr3d/compat  (three.js-style classes, JS)      ─┐
 ├─ wamr3d/addons/* (controls, loaders, post-processing, lines)
 └─ wamr3d         (low-level handle API, JS loader)  │ batched calls, typed arrays
                                                      ▼
 WebAssembly module (Rust, engine/bindings → wasm-bindgen)
   wamr3d ── wamr-renderer ── wamr-objects ── wamr-core ── wamr-math
                                                      │ frame data: typed views over Wasm memory
                                                      ▼
 JavaScript hosts: webgpu.js (WGSL) or webgl.js (GLSL ES 3.00)  →  GPU
```

| Crate (`engine/`) | Package name | Contents |
|---|---|---|
| `math` | `wamr-math` | `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Color`, `Box3`, `Sphere`, `Ray`, `Plane`, `Frustum`, `Triangle`, `Line3`, `Spherical`, `Cylindrical`, `MathUtils`; scalar kernels and the `f64x2` SIMD kernels (D1, D3) |
| `core` | `wamr-core` | `World`: generational arenas of components (transform, hierarchy, visibility, renderable, skin, morph), the scene graph, cameras, buffer attributes and geometries, resource stores, the event queue ([Memory and ownership](#memory-and-ownership)) |
| `objects` | `wamr-objects` | built-in geometries (box, sphere, torus knot, lathe, capsule, polyhedra…), raycasting |
| `renderer_webgpu` | `wamr-renderer` | frame preparation: frustum culling, draw ordering, pipeline keys, uniform packing (`frame.rs`, `frame/`), lighting and shadows, and the shader sources: WGSL (`shaders.rs`, `mesh_wgsl/`), GLSL (`glsl.rs`, `glsl_mesh/`), post-processing (`effects.rs`) |
| `bindings` | `wamr3d` (npm and crate) | the `wasm-bindgen` API (`World`, `Renderer`, math classes, picking), `build.mjs`, and `js/`: the JavaScript package |

All crates are `#![forbid(unsafe_code)]`. Internal crates stay at version `0.1.0`; only `wamr3d` carries the release version.

## The JavaScript package (`engine/bindings/js/` → `dist/wamr3d/`)

| File or folder | Role |
|---|---|
| `index.js` | loads the Wasm module (`init()`), re-exports the generated bindings, adds `attributeView` (zero-copy) and scalar helpers that are cheaper in JS than a Wasm call |
| `math.js` (`wamr3d/math`) | the object API's math values (`compat/values.js`) on their own, for per-value math next to the low-level API; loads no Wasm |
| `compat.js`, `compat/` | the object API: three.js classes over one shared `World`. Math values are plain JavaScript (`compat/values.js`, `compat/math.js`); `compat/engine.js` queues transform changes and sends them in one `world.applyTransforms` call (`flush`) |
| `compat/renderer.js` | `WebGPURenderer` / `WebGLRenderer`: picks a backend (`'auto'`: WebGPU, then WebGL 2, then software WebGPU), syncs materials, lights, environment and fog into the engine's `Renderer`, then asks the host to draw (`render`) or only to build shaders (`compileAsync`) |
| `webgpu.js`, `webgpu/` | WebGPU host: device, pipelines (`pipelines.js`), buffers (small geometries share pooled buffers, drawn through `baseVertex`), textures, shadows, environment prefiltering |
| `webgl.js`, `webgl/` | WebGL 2 host: the same frames with GLSL; programs (`programs.js`), buffers, textures, shadows, environment |
| `webgpu/formats.js` | helpers shared by both hosts, including `meshFeatures` and `lightFeatures` (shader specialisation keys, D40) |
| `addons/` | `wamr3d/addons/*`: controls, loaders (glTF with Draco/KTX2/meshopt, FBX, OBJ/MTL, HDR/RGBE, EXR), post-processing, wide lines, shaders |
| `types/`, `*.d.ts` | hand-written typings for the object API; `wamr3d_wasm.d.ts` is generated |

## One frame

1. **Application** sets properties (`mesh.position.x = 1`). The object API stores them in JavaScript and marks the object dirty; nothing crosses into Wasm yet.
2. **`renderer.render(scene, camera)`** flushes dirty transforms in one batched call, updates world matrices in Wasm (only dirty subtrees), walks the scene once to sync materials (once per material per frame), lights, environment, background and fog into the engine's `Renderer`.
3. **`Renderer.prepare(world, root, camera)`** (Rust) culls against the frustum, orders draws (opaque, transmissive, blended; order-free opaque draws grouped by pipeline, material and geometry), assigns texture slots, and packs the frame block, one 32-float object block per draw and one 512-float block per distinct material.
4. **The host** reads that data through typed views over Wasm memory (no copy), uploads it, binds cached pipelines or programs keyed on draw state and material features, and issues the draws: shadow passes, the optional transmission copy, the main pass, then the output pass (tone mapping and sRGB) on canvas frames. Shaders read object blocks by index (a storage buffer and `firstInstance` on WebGPU, 128-block uniform ranges and `object_range` + `gl_InstanceID` on WebGL 2), so consecutive draws of one geometry, material and key go out as one instanced draw.

Shader source is generated by Rust and fetched by the hosts once (`Renderer.shaderSource()`, `Renderer.glslSource(name)`); the hosts specialise it per material (D40). Both shader languages read the same std140-compatible uniform layout, so the same buffers serve both backends (D32). The WGSL mesh shader also reads the split-sum (DFG) table from a uniform at group 0, binding 1, which the WebGPU host fills once from `Renderer.dfgTable()`; the GLSL keeps it as a `const` array (a run-time indexed WGSL `const` array is rebuilt in every invocation, see [PERFORMANCE.md](PERFORMANCE.md#shaders-and-startup)).

## Where work runs

A call into WebAssembly costs more than a few float operations (a `v.x` getter on a Wasm class is 1.6x three.js's time, `Vector3.applyQuaternion` 4.0x), while work over many objects in one call is several times faster in Rust ([`bench.txt`](bench/results/bench.txt)). Hence:

| Work | Runs in | Why |
|---|---|---|
| Per-value math (`Vector3`, `Matrix4`, `Quaternion`… of the object API and `wamr3d/math`), scalar helpers | JavaScript | one operation is cheaper than the call; at three.js's speed |
| Object properties (`position`, `rotation`, `visible`…) | JavaScript, sent in batches | read and written often; `flush` sends every change in one `applyTransforms` call |
| World matrices, culling, draw ordering, uniform packing, geometry processing (normals, bounds, transforms), raycasting | Rust/Wasm | loops over thousands of objects or vertices with the data already in Wasm memory |
| Shader source | Rust, generated once | both languages from one description (D32, D40) |
| GPU calls, caches of pipelines, programs, buffers and textures | JavaScript hosts | the browser APIs are JavaScript; frame data is read through views over Wasm memory, not copied |

The low-level Wasm math classes of `wamr3d` exist for the low-level API, which takes them as arguments; for per-value math next to it, use `wamr3d/math`.

## Memory and ownership

The core is an ECS with generational handles rather than parent and child references: cycles of `Rc<RefCell<…>>` would leak and be slow.

```
Entity      = u32 index + u32 generation   (one u64 / BigInt in JavaScript)
Transform   { position, quaternion, scale, matrix, world, dirty flags }
Hierarchy   { parent: Option<Entity>, children }
Visibility  { visible, layers }
Renderable  { geometry: GeometryHandle, material: MaterialHandle }
Name        { name: String }
```

Each component type lives in its own arena; geometry and material stores are arenas with explicit disposal; each `World` holds an event queue the frame loop drains instead of `EventDispatcher` callbacks; buffer attributes own their `Vec<f32>` (or `u32`) in Wasm memory, exposed to JavaScript as typed-array views.

- A `World` owns every object, geometry, material, render target and interleaved buffer. Handles are 64-bit (`BigInt` in JS) and generational: a stale handle fails instead of reading freed memory.
- Low-level API: `destroy` / `destroyRecursive` for objects; `disposeGeometry` / `disposeMaterial` free resources explicitly.
- Object API: engine objects are released when their JavaScript objects are collected, or immediately by `dispose()`.
- Typed-array views over Wasm memory become detached when the memory grows. Any call into the module can grow it (including fetching shader source), so views are taken right before use and re-taken after such calls.

## Shaders and startup

Mesh shaders cover every material, but each program or pipeline is built for its material's features only: shading mode, maps, physical layers, environment, and the frame's shadowed and area lights (D40). WebGL 2 starts all programs a frame needs before querying any. `renderer.compileAsync(scene, camera)` builds them without blocking: it polls `KHR_parallel_shader_compile` on WebGL 2 and uses `createRenderPipelineAsync` on WebGPU. Measured effect: [PERFORMANCE.md](PERFORMANCE.md).

## Around the engine

| Folder | Role |
|---|---|
| `parity/` | fixtures generated from `three/src` (`math`, `core`, `objects`, `bindings`) and the visual cases with stored three.js images (`visual/`) |
| `examples/` | object-API demo (`webgpu`), low-level demo (`browser`), Node example (`basic`), the showcase, side-by-side comparison, three.js baseline, and ported three.js games and scenes (`ports/`) |
| `bench/` | Node benchmarks (`bench.mjs`, `compat.mjs`) and committed results (`results/`, the last run) |
| `website/` | the project site (Vite, Tailwind). Its own pages use the **published** npm package; `scripts/prepare-pages.mjs` copies the local build for the examples it links |
