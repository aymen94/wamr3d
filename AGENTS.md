# AGENTS.md: WAMR3D

Instructions for AI coding agents (and humans) working in this repository. Read this file first, then the document for the area you touch:

| Topic | File |
|---|---|
| How the engine is built: crates, JS layer, frame flow, ownership | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Performance rules, known costs, how to profile | [PERFORMANCE.md](PERFORMANCE.md) |
| Which checks to run, and how to add tests and fixtures | [TESTING.md](TESTING.md) |
| Benchmark procedure and recorded results | [BENCHMARKS.md](BENCHMARKS.md) |
| Tools, build, serving, troubleshooting | [CONFIGURATION.md](CONFIGURATION.md) |
| Workflow, style, releasing to npm | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Limitations and the last verification | [STATUS.md](STATUS.md) |

**Mission:** a native WebAssembly 3D engine whose public API feels like three.js. The core is Rust compiled to Wasm; JavaScript hosts draw through WebGPU or WebGL 2. Internals are typed, explicitly owned and designed for Wasm. The five porting phases of section 4 are complete; work now extends coverage and performance.

---

## 0. Folder Layout

```
WAMRNative/
├── engine/                 # OUR code: Rust workspace (cargo runs from here)
│   ├── math/               # wamr-math: math types (Phase 1)
│   ├── core/               # wamr-core: World, components, scene graph, resources (Phase 2)
│   ├── objects/            # wamr-objects: built-in shapes, picking (Phase 3)
│   ├── renderer_webgpu/    # wamr-renderer: culling, draw order, uniforms, WGSL and GLSL (Phase 4)
│   └── bindings/           # wamr3d: wasm-bindgen API, build.mjs, and js/ (hosts, object API, add-ons) (Phase 5)
├── dist/wamr3d/            # build output = the npm package (gitignored; `node engine/bindings/build.mjs`)
├── parity/                 # fixtures generated FROM the reference `three/src/`, committed; visual cases
├── examples/               # demos, showcase, comparison pages, ported three.js examples
├── bench/                  # Node benchmarks and committed results
├── website/                # project site (Vite); uses the PUBLISHED npm package
└── node_modules/three/     # REFERENCE, optional, not in the repository (`npm install`)
```

Renaming any of our folders is a decision, so record it in section 10.

---

## 1. Reference Import Rules (critical)

1. **The reference is three.js at the exact version pinned in the root `package.json`.** `npm install` puts it in `node_modules/three/`; below, `three/src/` means `node_modules/three/src/`. **Read only `three/src/`**, never `build/three*.js` (compiled output without the structure we need).
   - Nothing in `engine/`, `dist/wamr3d/` or the primary examples may import three.js, from `node_modules` or a CDN. The engine builds and its tests run without the reference: parity tests read committed fixtures.
   - The comparison pages load the pinned builds from a CDN (`examples/three-reference.js`); that is the only place a URL to three.js belongs.
2. **Ignore the rest of the reference tree:** `build/`, `docs/`, `editor/`, `examples/`, `test/`, `devtools/`, `manual/`, `tsl/`, `utils/`, `files/`, `.github/`, and asset folders.
3. **Out of scope, do not port:** `src/renderers/webgl/`, `src/renderers/webgl-fallback/`, `src/renderers/webxr/`, `src/nodes/`, `src/materials/nodes/` (TSL, risk R1), and the GLSL of `src/renderers/shaders/ShaderLib/` and `ShaderChunk/` (read for intent only, R2). Loaders, audio, animation, extras and helpers are now ported in the JavaScript object API and add-ons; extend them there.
4. If you need something outside these rules, stop and log it in `STATUS.md` under "Needs decision" rather than importing it.

---

## 2. Ground Rules (every agent)

1. **Port behavior, not syntax.** Match three.js semantics first: defaults, method meaning, edge cases. Optimize only after parity passes.
2. **Comment only what the code cannot say.** No comments that cite or point to three.js source files or functions. Comment non-obvious behavior, invariants, ownership or safety constraints, and subtle numerical decisions. Do not restate the code.
3. **Do not invent API.** If three.js does not define it, do not add it silently. Log it in `STATUS.md`.
4. **Think about the Wasm boundary from the start.** Data that crosses to JS is contiguous and typed (`f32`, `u32`), with no hidden pointers.
5. **Keep attribution.** three.js is MIT-licensed. Preserve license notices for derived and vendored code (e.g. `compat/lib/earcut.js`).
6. **Done means done:** the code compiles (native and `wasm32`), the relevant checks of [TESTING.md](TESTING.md) pass, section 10 records any deviation from the fixed rules, and `STATUS.md` is updated. "It compiles" is not done.

### 2.1 Native first

1. **Search before writing.** Look for an existing WAMR3D implementation first (`engine/*/src`, `engine/bindings/js/compat/`, `engine/bindings/js/addons/`), then read the three.js reference in `three/src/` for the behavior to match. Reuse and extend; do not add a parallel path.
2. **three.js is a reference, never a dependency.** Production code (`engine/`, `dist/wamr3d/`, the primary examples, the website's own pages) does not load it. Comparison pages and fixture generators are the only consumers.
3. **Put work where it is cheapest** (section 10, Section 6): scene computation and bulk data in Rust/Wasm; small scalar math and per-object property access in JavaScript. Never cross the Wasm boundary per property or per vector.

### 2.2 Performance is a core requirement

Follow [PERFORMANCE.md](PERFORMANCE.md). In short:

1. **Priorities:** startup freezes and long main-thread tasks first, then frame time (CPU submit and GPU), responsiveness, then memory.
2. **Per frame:** no allocations in hot loops (reuse typed arrays and scratch objects), no per-object Wasm calls (batch them), no repeated uploads of unchanged data, no pipeline or program rebuilds (cache by key).
3. **Across the boundary:** pass typed arrays, not objects; re-create views over Wasm memory after anything that can grow it (any call into the module can).
4. **Startup:** keep shader programs and pipelines specialised per material and compile them without blocking (`compileAsync`, parallel compile); do not add work to `init()` that can be lazy.
5. **Measure, never guess.** Profile before and after a performance change; report the numbers with the machine and method, including regressions. Never fabricate or extrapolate results. Do not run long benchmark suites unless the task needs them ([BENCHMARKS.md](BENCHMARKS.md)).

---

## 3. Early Decisions

Language, version pinning, matrix layout, handedness, Euler order, the ECS core model and the parity generator were decided before Phase 1. The choices in force are in section 10.

---

## 4. Phases (complete)

| Phase | Area | Exit criteria | Evidence |
|---|---|---|---|
| 1 Mathematician | `three/src/math/` → `engine/math` | parity within `1e-6` (D2); scalar and SIMD agree | `engine/math/tests/parity.rs`, the wasm32 SIMD run (D3) |
| 2 Cartographer | `three/src/core/` → `engine/core` | 10,000 objects created and destroyed return memory to baseline; ownership recorded | `engine/core/tests/alloc.rs`; section 4.2 and section 10 |
| 3 Scenegrapher | cameras, objects, geometries → `engine/core`, `engine/objects` | hierarchy world matrices match fixtures; only dirty subtrees recompute | `parity/core`, `parity/objects`; `update_matrix_world_skips_clean_subtrees_unless_forced` |
| 4 Renderer | `three/src/renderers/{webgpu,common}/`, lights → `engine/renderer_webgpu`, `js/webgpu.js` | cube, lit sphere, textured plane match three.js renders | `parity/visual/` (37 cases) |
| 5 Diplomat | `engine/bindings` | a three.js example runs with only the import changed; `.d.ts` typings | `examples/ports/`, `parity/bindings/typecheck.ts` |

The WebGL 2 host (`js/webgl.js`, GLSL generated by the engine) was added after Phase 4 as the fallback where WebGPU is missing. Phase 5 asked for a `refreshViews()`; instead, `attributeView()` documents that views are created right before use (README, risk R4).

#### 4.2 Core design (Rust)

three.js builds the scene from `Object3D` subclasses with parent and child references. In Rust, parent/child cycles of `Rc<RefCell<…>>` leak memory and are slow, so the core is an ECS with generational handles:

```
Entity   = u32 index + u32 generation   (passed to JS as a single u64 / BigInt)
Transform   { position, quaternion, scale, matrix, world, dirty flags }
Hierarchy   { parent: Option<Entity>, children }
Visibility  { visible, layers }
Renderable  { geometry: GeometryHandle, material: MaterialHandle }
Name        { name: String }
```

- **Storage:** one `Arena<T>` per component type (slotmap-style). Handles are generational, so a stale handle fails safely instead of reading freed memory.
- **Geometry and material stores:** arenas with explicit `dispose()`. Reference counts are kept only where three.js shares a resource across objects, and are informational.
- **Events:** each `World` holds a `Vec<CoreEvent>` queue that the frame loop drains, replacing `EventDispatcher` callbacks.
- **Attributes:** `BufferAttribute` owns a `Vec<f32>` (or `u32`) in the world's linear memory, exposed to JS as a typed-array view.

---

## 5. Coordinate and Depth Conventions

These are the most likely porting bugs. Each one needs a test.

- **Handedness:** right-handed, +Y up, camera looks down −Z.
- **Clip-space depth:** three.js projection matrices produce depth in `[-1, 1]`; WebGPU uses `[0, 1]`. The engine applies the correction as three.js's WebGPU path does; the WebGL 2 host remaps back in its vertex stages. Test: a point on the near plane maps to NDC depth `0`.
- **Y axis:** render targets are stored top row first on both backends (`flip_y` on WebGL 2).
- **Winding:** front faces are counter-clockwise; set the pipeline's front face explicitly.

---

## 6. Known Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | The reference WebGPU backend is built on TSL (`src/nodes/`). Porting it means porting most of the renderer. | Not ported. Materials are hand-written WGSL and GLSL that follow the node versions' behavior. |
| R2 | `ShaderLib`/`ShaderChunk` are GLSL for three.js's WebGL renderer. | Read for intent only; the engine writes its own WGSL and GLSL. |
| R3 | Depth range and Y conventions differ between GL and WebGPU. | Section 5 tests; visual parity on both backends. |
| R4 | Wasm memory growth invalidates typed-array views. | Views are re-created after calls that may grow memory (`frameData` in `webgl.js`, `attributeView` before use). No test grows memory on purpose yet (STATUS.md). |
| R5 | Parity fixtures drift if the reference changes. | One exact `three` version in `package.json` and the CDN URLs. Never regenerate fixtures from another version without updating section 10. |

---

## 7. Testing and Parity

- Parity fixtures are generated by Node scripts that import the real `three/src` modules (`parity/*/gen/`) and are committed, so tests run without three.js. **Never hand-write expected values.**
- Every ported public function has at least one test, next to the code. Visual cases compare against stored three.js WebGPU renders (D27).
- On every change to `engine/` or `engine/bindings/js/`: native tests, the `wasm32` build, and the parity checks for that area. The matrix of which checks to run is in [TESTING.md](TESTING.md); commands and prerequisites are in [CONFIGURATION.md](CONFIGURATION.md).
- Rebuild `dist/wamr3d` (`node engine/bindings/build.mjs`) before any browser check: pages load the build, not the sources.

---

## 8. Handoff Protocol

When you finish or stop:
1. Update `STATUS.md`: what changed, checks run and their results, open questions.
2. Leave the tree compiling. If you can't, say so at the top of `STATUS.md`.
3. If you hit a decision that isn't yours (a new dependency, a fixed rule, a version or publishing choice), write it under "Needs decision" in `STATUS.md` and stop that item.
4. Do not commit, push or publish unless asked.

---

## 9. Do Not

- Edit anything inside `node_modules/three/`, or copy the reference into the repository.
- Import three.js from `engine/`, the package in `dist/wamr3d/`, or a primary example.
- Port from `build/`, `examples/`, `docs/`, `editor/`, `test/`, or asset folders, or port `src/renderers/webgl/`.
- Change the matrix layout, depth convention, Euler order, or three.js version without updating section 10 and regenerating all parity fixtures.
- Add `unsafe` (all crates `#![forbid(unsafe_code)]`) or raw owning pointers without a `// SAFETY:` comment and a recorded decision.
- Claim a speed-up without a before/after measurement, or regenerate references to make a failing check pass.
- Change the uniform layouts in Rust without the hosts (`webgpu.js`, `webgl.js`, `webgpu/formats.js` read them): they ship together (D32).

---

## 10. Fixed rules

The choices in force, and the IDs that code comments cite. Change one only together with this section and, where it applies, with regenerated parity fixtures.

**Fixed choices.** Rust core (edition 2021), with JavaScript where it is simpler or faster. Compatibility target: three.js pinned to one exact `three` version in `package.json`. Math stores `f32`; matrices are column-major (`Matrix4` 16 values, `Matrix3` 9). Right-handed, +Y up, cameras look down −Z; Euler order defaults to `XYZ`. Scene entities use generational handles. Parity fixtures come from direct imports of `three/src/`, never `build/`. The visual reference is three.js's WebGPU renderer; WebGPU NDC depth is 0..1 and front faces are counter-clockwise.

- **D1** Each math function widens `f32` inputs to `f64`, computes as three.js does, and rounds once on store. Chained calls round at each step.
- **D2** Parity tolerance `|got − expected| <= 1e-6 * max(1, |expected|)`; non-finite values match exactly.
- **D3** The SIMD path uses `f64x2` in scalar operation order, so it is bit-identical to scalar.
- **D4** Rust API: three.js names in `snake_case`; `target` out-parameters become return values; `null` becomes `Option`; overloads are split; string enums become Rust enums; out-of-range indices panic.
- **D16** `engine/core/src/constants.rs` holds the buffer usage and attribute type values from three.js `constants.js`.
- **D18** Integer typed-array stores wrap as JavaScript does (`Uint8ClampedArray` clamps and rounds half to even); they do not saturate.
- **D21** `engine/bindings` (package `wamr3d`) is a thin `wasm-bindgen` shell with no `unsafe`; zero-copy views are built in JavaScript.
- **D27** Visual parity compares against stored three.js WebGPU renders, within the tolerance in `parity/visual/cases.js`.
- **D32** Renderer split: Rust/Wasm prepares frame data and the WGSL and GLSL sources; JavaScript hosts (`webgpu.js`, `webgl.js`) own and issue the device, pipeline, buffer, texture and pass calls. Both hosts read the engine's uniform layout, so the engine and hosts ship together.
- **D39** Random helpers use a SplitMix64 generator, seeded by `init()` and resettable with `setRandomSeed`; `seededRandom` stays Mulberry32.
- **D40** Mesh shaders are specialised per material: the hosts pass the material's shading mode and present features (`SHADING_MODE`, `MATERIAL_FEATURES`, `STATE_FEATURES`, `MAP_FEATURES`, `LIGHT_FEATURES`) as GLSL `#define`s or WGSL `override`s; unset, every feature is decided at run time. A constant only clears a feature the material does not have, so output is unchanged.
- **Section 5 / 5.3** Core model and ownership: a `World` owns everything; `destroy` leaves children alive as roots and `destroy_recursive` destroys the subtree; geometries, materials, render targets and interleaved buffers are freed only by `dispose_*`; reference counts are informational; arena slots are reused.
- **Section 6** Language split: scene computation and core logic in Rust/Wasm; the object API (`wamr3d/compat`) keeps three.js-style values and transforms in JavaScript and sends changes to the engine in batches. Do not mix low-level transform writes with object-API getters on the same objects.
