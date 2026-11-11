# Performance

Performance is a core requirement of WAMR3D, on lower-powered laptops as much as on fast desktops. This file is the working guide: priorities, rules per language, the costs already known, and how to measure. Benchmark procedures are in [BENCHMARKS.md](BENCHMARKS.md).

## Priorities

1. **Startup and freezes.** No long main-thread task while a page loads or a scene first draws. Shader and pipeline building is the known large cost.
2. **Frame time.** CPU time to update and submit a frame, then GPU time.
3. **Responsiveness.** Input and scrolling stay smooth; heavy work is batched or moved off the main thread.
4. **Memory.** No per-frame garbage; resources freed when disposed.

Correctness comes first: an optimization must keep the parity checks passing ([TESTING.md](TESTING.md)) and must not change three.js-compatible behavior or public APIs.

## Rules

### Across the Wasm boundary

- Batch. One call with typed arrays beats many small calls: `world.applyTransforms`, `world.setTransforms`, `world.matricesWorld`, `raycastInstances`. A Wasm call costs more than the scalar arithmetic it would do; keep small math in JavaScript (`index.js` scalar helpers, object-API values, `wamr3d/math` next to the low-level API) and send the results in one typed-array call.
- Read engine data through typed views over `memory().buffer`, not copies (`attributeView`, `frameData` in `webgl.js`, the `*Ptr` accessors).
- Any call into the module can grow its memory and detach existing views, including fetching shader source. Take views right before use; re-take them after such calls.
- Return `Vec<f32>`/`Vec<u32>` from Rust only for data JavaScript keeps; for per-frame data, expose a pointer and length instead.
- A `Result` return makes the generated glue allocate an array on every call. For exports called once per object (the transform setters), return a flag from an unchecked export (`skip_typescript`) and throw in `index.js`, keeping the public signature and error.
- Take bulk input as `Vec<f32>`/`Vec<u32>` when Rust keeps it: the glue has already copied it into Wasm memory, and a `&[f32]` followed by `to_vec()` copies it twice.

### Rust (`engine/`)

- No allocation per draw or per object in frame preparation: reuse `Vec`s across frames, sort indices rather than structs, store handles rather than clones.
- Recompute only what changed: dirty transforms (only dirty subtrees), materials packed once per frame, morph blending only when weights change.
- Keep the scalar path as the reference; SIMD must stay bit-identical (D3).

### JavaScript hosts and object API (`engine/bindings/js/`)

- Per frame: no closures, arrays or objects allocated in draw loops; reuse scratch typed arrays (`flush` grows its buffers geometrically).
- Cache GPU objects by key: pipelines (`webgpu/pipelines.js`), programs (`webgl/programs.js`), bind groups, texture sets. Never rebuild them per frame.
- Upload only changed data: geometry by version, instance matrices by version, uniforms in one write per buffer.
- Set GPU state only when it changes (the draw loops track the current pipeline, program, material and buffers).
- Draws are ordered by depth, so neighbouring draws rarely share a material. Work that depends only on the material (feature keys, program and pipeline lookups) is cached per material for the pass, not compared with the previous draw.
- WebGL 2: plain draws bind a vertex array per geometry (`bindGeometryArrays`). Code that changes vertex inputs goes through the `buffers.js` helpers (or calls `defaultArrays()` first), so a geometry's array is never modified after it is built. On ANGLE each per-draw uniform state change (a range bind or a `uniform*` call) costs about 0.7 µs; avoid adding one.
- WebGPU: small geometries live in shared pools and draw through `baseVertex`/`firstIndex`; `bindGeometry` sets only bindings that changed in the pass. Code that binds vertex slots 0–3, the aux slot or an index buffer itself calls `forgetBindings()` afterwards, and draws of a geometry add its `baseVertex` (and `firstIndex` for its own index).
- Object blocks are read by index on both hosts: never bind per draw. A draw that reads its block through `firstInstance` (WebGPU, `DIRECT_KEY`) or `object_range` with step 1 (WebGL 2) can share an instanced draw with the following ones only when geometry range, key, material and textures are equal; the hosts check that, the order only makes it likely. In GLSL, index `vec4` arrays in blocks, not arrays of structs (a struct copy stalled ANGLE's D3D compiler), and keep the fragment stage off the block array (flat varyings).
- Pass WebGPU dynamic offsets (now only the material block's) as a reused `Uint32Array` (`setBindGroup( i, group, offsets, 0, n )`), not an array literal.

### Shaders and startup

- Programs and pipelines are specialised per material features (D40); a new combination costs one compile on its first draw. Keep new shader features behind a feature bit so materials without them do not pay for them.
- No WGSL `const` array indexed at run time: the compiler may rebuild it in every invocation (the DFG table cost half the frame rate at 4K). Put tables in a uniform buffer or a texture. GLSL `const` arrays are fine on ANGLE/D3D11 (they become `static const`).
- Start every program a frame needs before waiting on any; never query a link or compile status right after starting it unless the result is needed now.
- Applications (and the website) call `await renderer.compileAsync(scene, camera)` before the first frame to build shaders without blocking.
- Keep `init()` small: the module is about 777 KiB with SIMD; anything not needed for the first frame should be lazy.

## Known costs and results

The results behind the rules above, each with its date, machine and method; the figures of the last full benchmark run are in [BENCHMARKS.md](BENCHMARKS.md#last-run). Machine for all rows: i9-10900X, RTX 2070 SUPER, Windows, Chrome (ANGLE on Direct3D 11, Dawn on Direct3D 12), Node.js 24.20.

| Area | Result | Method |
|---|---|---|
| Start-up, hero scene | Longest main-thread task on WebGL 2: 5.75 s with one shader for every material, 0.65 s specialised per material (D40), none over 50 ms with `compileAsync`. WebGPU frame stall after the first frame: 2.3 s, 0.82 s, none over 50 ms. Linking the GLSL mesh program takes 5.6 s with every feature enabled and 0.77 s with none | CDP trace, 2026-10-19 |
| WGSL `const` table indexed at run time (comparison scene, 3840×2160) | 29.9 fps with the DFG table as a `const` array, 59.9 fps (display limit) as a uniform; submit-to-done latency 230 → 3.7 ms. MSAA, canvas format and stencil changed nothing | `queue.onSubmittedWorkDone` and rAF timing, 2026-10-21 |
| Per-draw state on ANGLE (WebGL 2) | About 0.7 µs per uniform state change (a range bind or a `uniform*` call); a vertex array per geometry replaced a `bindBuffer` + `vertexAttribPointer` per input (34% of CPU samples) | CDP sampling profiler, 2026-11-11 |
| Object blocks read by index, order-free grouping and instanced batches (showcase, separate meshes, CPU submit, against the 0.9.4 build in the same session) | 1280×720, 10,000 meshes: WebGPU 14.0–15.7 → 4.1–4.4 ms, WebGL 2 24.6–25.3 → 4.0 ms (three.js WebGL 24.5–25.0 ms, WebGPU 107–110 ms). 50,000: WebGPU 70–72 → 23–24 ms (11 → 29–31 fps), WebGL 2 127 → 24–26 ms (7.2 → 28–29 fps; three.js WebGL 136–138 ms). 3840×2160, 50,000: WebGPU 9.9 → 30.0 fps, WebGL 2 6.9 → 29.0 fps; instanced rows unchanged. The 0.9.4 figures also lack the geometry pools and vertex arrays | `examples/showcase/check.mjs --measure --modes=objects`, two runs each, 0.9.4 built in a separate worktree, 2026-11-11 |
| WebGPU geometry pools | Before them, `setVertexBuffer`, `setIndexBuffer` and `bindGeometry` took 25% of CPU samples at 50,000 meshes; after, none shows | CDP sampling profiler, 2026-11-11 |
| `prepare_frame` natively, 39,551 draws in 3 geometries and 6 materials | 16.8–17.2 ms without grouping, 18.2–18.3 ms with it (run-to-run noise ±0.5 ms); writing draws in sorted order costs about 3.4 ms of it | temporary `#[ignore]` test, `cargo test --release`, 2026-11-11 |
| Picking, 100 rays against 1,000 boxes (object API) | 7.34 → 5.5 ms per run with the bounding-sphere pre-test (three.js 6.2–6.8 ms); natively 4.41 → 3.33 ms. The rest is reading each object's world matrix (a cache miss per object) | `bench/compat.mjs --only=picking`, Node `--cpu-prof`, 2026-11-11 |
| Skeletal animation, object API (two blended clips, world matrices, `Skeleton.update`) | 16 characters of 24 bones: 0.319 → 0.272 ms (three.js 0.266 ms); 200 characters: 4.52 → 3.77 ms (three.js 4.81–4.96 ms). The rest is clip evaluation, the same JavaScript as three.js's | `bench/compat.mjs --only=animation`, 2026-11-11 |
| `wamr3d/math` `Matrix4.multiplyMatrices` (1.08×–1.5× of three.js in `bench/math.mjs`) | Not a library cost: the code matches three.js's, and timed alone in its own process each takes 2.80–2.90 ms per 100,000. The gap comes from how V8 optimises the surrounding workloads in the benchmark process | single-workload script per library, 2026-11-11 |
| Two libraries benchmarked in one process | The second ran 1.01× to 3.68× slower on V8 inline caches trained by the first; hence each library runs in its own process | `bench/compat.mjs`, 2026-10-19 |

Results across sessions are not comparable; compare builds within one session ([BENCHMARKS.md](BENCHMARKS.md#reading-results)).

## How to measure

Profile before changing code, and again after; report both, with the machine, browser and method, including cases that got slower.

- **Frame time and throughput:** the showcase shows live CPU update and submit times; `node examples/showcase/check.mjs --measure` records them ([BENCHMARKS.md](BENCHMARKS.md)). `renderer.info.render.calls` and `.triangles` give the draw counts.
- **Start-up and freezes:** use the browser's Performance panel (long tasks, `linkProgram`/`getProgramParameter`, `createRenderPipeline`), or a scripted trace: a page that wraps `WebGL2RenderingContext`/`GPUDevice`/`GPUQueue` methods with timers and records `PerformanceObserver` long tasks and `requestAnimationFrame` gaps, driven by headless Chrome over the DevTools protocol (the method behind the start-up figures above). Keep such pages in the gitignored `parity/visual/out/`.
- **Node micro-benchmarks:** `node bench/bench.mjs` and `node bench/compat.mjs` for engine and object-API operations against three.js. When the same code runs against two libraries, run each in its own process: in one process the second library runs on V8 inline caches trained by the first and looks slower than it is.
- **Memory:** `engine/core/tests/alloc.rs` counts allocations for create/destroy loops; in the browser, the Memory panel and `performance.memory` where available.
- Close other GPU work and leftover headless browsers first; they skew results by 20–50% ([CONFIGURATION.md](CONFIGURATION.md#7-troubleshooting)).

## Checklist for a performance change

- [ ] Bottleneck identified by a profile or benchmark, not by inspection alone.
- [ ] Before and after numbers from the same session, machine and method.
- [ ] Parity checks for the area pass (visual parity on both backends for renderer or host changes).
- [ ] No public API or three.js-visible behavior change, or it is recorded in `STATUS.md`.
- [ ] Numbers recorded where they belong ([BENCHMARKS.md](BENCHMARKS.md), `STATUS.md`); none invented or extrapolated.
