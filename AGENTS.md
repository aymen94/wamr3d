# AGENTS.md: WAMR3D

**Mission:** Port the core of Three.js (r186) to a native engine in **Rust** or **C++**, built to **WebAssembly**, rendering through **WebGPU**. The public API should feel familiar to Three.js users. The internals are typed, explicitly managed, and designed for Wasm.

---

## 0. Folder Layout

```
WAMRNative/
├── node_modules/three/     # REFERENCE, optional, not in the repository: `npm install` fetches the
│   └── src/                # pinned three@0.186.1. Read-only. `src/` is the only part read for porting
├── engine/                 # OUR code (Rust crate, or C++ with CMake)
│   ├── math/               # Phase 1
│   ├── core/               # Phase 2
│   ├── objects/            # Phase 3  (cameras + objects + geometries)
│   ├── renderer_webgpu/    # Phase 4
│   └── bindings/           # Phase 5  (wasm-bindgen or embind)
├── parity/                 # expected outputs generated FROM the reference `src/`, committed
├── DECISIONS.md            # architecture choices, deviations, pinned commit
├── STATUS.md               # per-phase progress, open questions, handoff notes
└── AGENTS.md               # this file
```

Renaming any of our folders is a decision, so record it in `DECISIONS.md`.

---

## 1. Repository Import Rules (critical)

1. **The reference is three.js r186, exactly `three@0.186.1`.** It is not kept in the repository. `npm install` at the root puts it in `node_modules/three/`; below, `three/src/` means `node_modules/three/src/`. **Read only `three/src/`.** Never feed the AI `build/three.js` or `build/three.module.js`. They are compiled output and lack the structure we need.
   - Nothing in `engine/`, `dist/wamr3d/` or the primary examples may import three.js, from `node_modules` or from a CDN. The engine builds and its tests run without the reference: parity tests read committed fixtures.
   - The comparison pages load the pinned r186 builds from a CDN (`examples/three-reference.js`); that is the only place a URL to three.js belongs.
2. **Ignore everything else in the reference tree.** Do not read, summarize, or port from:
   - `build/`, `docs/`, `editor/`, `examples/`, `test/`, `devtools/`, `manual/`, `tsl/`, `utils/`, `files/`, `.github/`
   - Asset folders anywhere (`models/`, `textures/`, `fonts/`, `sounds/`, `luts/`, `ies/`, `screenshots/`, and so on)
3. **Stay inside your phase's source folders** (listed in section 4). If you need something outside them, stop and log it in `STATUS.md` under "Needs decision" rather than importing it.
4. **Out of scope for v1, do not port:**
   - `src/renderers/webgl/`, `src/renderers/webgl-fallback/`, `src/renderers/webxr/`
   - `src/nodes/` and `src/materials/nodes/` (the TSL node system; see section 6, risk R1)
   - `src/loaders/`, `src/audio/`, `src/animation/`, `src/extras/`, `src/helpers/` (except `GridHelper.js` and `AxesHelper.js`, which may be ported), `src/textures/`, `src/lights/webgpu/`
   - `src/renderers/shaders/ShaderLib/` and `ShaderChunk/` (GLSL for WebGL; reference only, see section 6)

   These are candidates for later phases. Add them to `STATUS.md` when we get there.
5. **Verify file names first.** The first thing each agent does is `ls` its source folder and write the actual file list into `STATUS.md`. File names below come from upstream structure and must be checked against r186.

---

## 2. Ground Rules (every agent)

1. **Port behavior, not syntax.** Match Three.js semantics first: defaults, method meaning, edge cases. Optimize only after parity passes.
2. **Comment only what the code cannot say.** No comments that cite or point to the original source file or function. Comment non-obvious behavior, invariants, ownership or safety constraints, and subtle numerical decisions. Do not restate the code.
3. **Do not invent API.** If Three.js does not define it, do not add it silently. Log it in `STATUS.md`.
4. **Do not edit other phases' code** except to fix a compile error. Log any such edit in `STATUS.md`.
5. **Think about the Wasm boundary from the start.** Data that will cross to JS must be contiguous and typed (`f32`, `u32`), with no hidden pointers.
6. **Keep attribution.** Three.js is MIT-licensed. Preserve applicable license notices and attribution for derived code. Never remove a legally required notice.
7. **Done means done.** A task is complete when the code compiles (native and `wasm32`), the relevant tests pass, `DECISIONS.md` has entries for any deviations, and `STATUS.md` is updated. "It compiles" is not done.

---

## 3. Early Decisions (before Phase 1 code)

Record each in `DECISIONS.md`. Do not start coding until these are filled in.

| Decision | Recommendation | Why |
|---|---|---|
| Language | Rust | `wasm-bindgen` and `wgpu` are mature; memory safety helps the leak goal |
| Three.js version | `r186`, pinned | Matches the folder we have |
| Matrix layout | Column-major `[f32; 16]` | Same as `Matrix4.elements`, so buffers match |
| Handedness | Right-handed, +Y up, camera looks down −Z | Three.js default |
| Euler default order | `XYZ` | Three.js default |
| Core model (Phase 2) | ECS with generational handles (section 4.2) | Avoids reference cycles and Wasm leaks |
| Parity generator | Node script that imports `three/src` (the pinned npm package) directly | Ground truth without using `build/` |

---

## 4. Phases

Phases run in order. A phase starts only when the previous phase's exit criteria pass.

### Phase 1: Agent 2, The Mathematician

**Source (`three/src/math/`):**
`Vector2`, `Vector3`, `Vector4`, `Matrix3`, `Matrix4`, `Quaternion`, `Euler`, `Color`, `Box3`, `Sphere`, `Ray`, `Plane`, `Frustum`, `Triangle`, `Line3`, `Spherical`, `Cylindrical`, `MathUtils`

Skip `math/interpolants/` in v1.

**Responsibilities:**
- Port the types above with Three.js semantics.
- Store everything as contiguous `f32`. `Matrix4` is `[f32; 16]`, column-major.
- Implement `Matrix4` multiply and vector transforms with a scalar path first. Add `simd128` (Rust `std::arch::wasm32`, or C++ `-msimd128` intrinsics) behind a feature flag once scalar parity passes. Keep the scalar path as the reference.
- Implement `Euler` ↔ `Quaternion` ↔ `Matrix4` conversions exactly as Three.js does, including the `XYZ` default.

**Exit criteria:**
- Parity within `1e-6` against fixtures in `parity/math/` for every ported type.
- Scalar and SIMD paths agree within `1e-6`.

### Phase 2: Agent 1, The Cartographer

**Source (`three/src/core/`):**
`Object3D`, `BufferGeometry`, `BufferAttribute`, `InterleavedBuffer`, `InterleavedBufferAttribute`, `InstancedBufferAttribute`, `InstancedBufferGeometry`, `EventDispatcher`, `Layers`, `Uniform`, `Raycaster`, `Clock`, `Timer`, `RenderTarget`

Confirm this list with `ls`. Drop anything that doesn't exist in r186.

**Responsibilities:**
- Analyze the class hierarchy in `src/core/` and write it into `DECISIONS.md` before writing code.
- Build the native model described in section 4.2.
- Define ownership and disposal for geometries, materials, and render targets.
- Replace string-keyed callbacks in `EventDispatcher` with a typed event enum.

**Exit criteria:**
- Create and destroy 10,000 objects in a loop. Memory returns to baseline (checked with a counting allocator).
- `DECISIONS.md` contains the class-to-component map and the ownership rules.

#### 4.2 Proposed core design (Rust)

Three.js builds the scene from `Object3D` subclasses with parent and child references. In Rust, parent/child cycles of `Rc<RefCell<…>>` leak memory and are slow. Use an ECS with generational handles instead:

```
Entity   = u32 index + u32 generation   (passed to JS as a single u64 or two u32s)
Transform   { position: Vec3, quaternion: Quat, scale: Vec3,
              matrix: Mat4, world: Mat4, dirty: DirtyFlags }
Hierarchy   { parent: Option<Entity>, children: SmallVec<Entity> }
Visibility  { visible: bool, layers: u32 }
Renderable  { geometry: GeometryHandle, material: MaterialHandle }
Name        { name: String }
```

- **Storage:** one `Arena<T>` per component type (slotmap-style). Handles are generational, so a stale handle fails safely instead of reading freed memory.
- **Geometry and material stores:** arenas with explicit `dispose()`. Reference counts are kept only where Three.js shares a resource across objects.
- **Events:** each `World` holds a `Vec<CoreEvent>` queue. The frame loop drains it. Replace `EventDispatcher` callbacks with this queue, plus optional subscriber closures for JS.
- **Attributes:** `BufferAttribute` owns a `Vec<f32>` (or `u32`) inside the world's linear memory. Expose it to JS as a typed-array view (section 4.5).

#### C++ alternative

If the team chooses C++: keep an inheritance hierarchy that mirrors `Object3D`. Use `std::unique_ptr` for owned children and raw non-owning parent pointers. Use handle-based ID tables for geometries and materials, not `shared_ptr` graphs. Document the ownership rules in `DECISIONS.md`.

### Phase 3: Agent 4, The Scenegrapher

**Source:**
- `three/src/cameras/`: `Camera`, `PerspectiveCamera`, `OrthographicCamera`, `ArrayCamera` (later)
- `three/src/objects/`: `Mesh`, `Points`, `Line`, `LineSegments`, `Group`, `Sprite`, `LOD`, `InstancedMesh`. `SkinnedMesh` and `Bone` are later.
- `three/src/geometries/`: start with `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`. Other primitives are later.

**Responsibilities:**
- Parent/child management with the same semantics as `Object3D.add`, `remove`, and `attach`.
- World matrix computation with `matrixAutoUpdate` and `matrixWorldNeedsUpdate`. Only dirty subtrees recompute.
- Projection matrices with Three.js conventions (section 5).

**Exit criteria:**
- World matrices for a 1,000-node hierarchy match parity fixtures.
- Changing one node recomputes only its subtree (verified by a counter in tests).

### Phase 4: Agent 3, The Renderer (WebGPU)

**Source:**
- `three/src/renderers/webgpu/`: the backend, device, and pipeline code. Read the subfolders `descriptors/` and `utils/` first. `nodes/` is the node-system integration (see R1).
- `three/src/renderers/common/`: shared backend logic (render lists, bindings, pipelines). This is needed, since the WebGPU path depends on it.
- `three/src/lights/` (non-webgpu files only): light data layout.

**Ignore:** `src/renderers/webgl/`, `src/renderers/webgl-fallback/`, `src/renderers/webxr/`.

**Responsibilities:**
- Split the renderer as recorded in `DECISIONS.md` D32: Rust/Wasm prepares each frame (culling, ordering, pipeline state, uniform data, WGSL source) and a thin JavaScript host issues the WebGPU calls (devices, pipelines, bind groups, command encoders). `wgpu` is not used on the web; a native backend may consume the same frame format later.
- Cache pipelines keyed on material and vertex-layout state. Do not rebuild them every frame.
- Write WGSL for `MeshBasicMaterial` first, then `MeshStandardMaterial`. Do not try to port GLSL from `ShaderLib`. See section 6.
- Upload vertex and index buffers only when their data changes.

**Exit criteria:**
- A cube, a lit sphere, and a textured plane render in headless Chromium with WebGPU enabled. Each matches a Three.js reference screenshot within an agreed pixel tolerance (stored in `parity/visual/`).

### Phase 5: Agent 5, The Diplomat

**Responsibilities:**
- Bindings with `wasm-bindgen` (Rust) or Emscripten/embind (C++).
- A JS/TS API that mirrors the Three.js surface for the classes ported so far. Ship `.d.ts` typings.
- Typed-array views over Wasm linear memory for geometry buffers, with no copying. Document that a view is invalid after Wasm memory grows, and provide `refreshViews()`.
- Canvas entry point and a `requestAnimationFrame` loop.

**Exit criteria:**
- A minimal Three.js example (scene, camera, mesh, `renderer.render`) runs with only the import path changed.
- Static geometry handoff shows no per-frame copy in a benchmark.

---

## 5. Coordinate and Depth Conventions

These are the most likely porting bugs. Each one needs a test.

- **Handedness:** right-handed, +Y up, camera looks down −Z.
- **Clip-space depth:** Three.js projection matrices produce depth in `[-1, 1]` (GL style). WebGPU uses `[0, 1]`. Apply the correction the same way Three.js's WebGPU path does. Test: a point on the near plane maps to NDC depth `0`.
- **Y axis:** check the NDC-to-framebuffer Y direction against a single-triangle test before building on it.
- **Winding:** Three.js front faces are counter-clockwise by default. Set the pipeline's front face explicitly.

---

## 6. Known Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | r186's WebGPU backend is built on the TSL node system (`src/nodes/`, `src/materials/nodes/`). Porting it wholesale would mean porting most of the renderer. | v1 does not port `src/nodes/`. Materials are written as hand-written WGSL that follows the behavior of the node versions. Log every material's behavior source in `DECISIONS.md`. Confirm this in r186 before Phase 4. |
| R2 | `ShaderLib` and `ShaderChunk` are GLSL for WebGL. They cannot be reused as WGSL. | Use them to understand intent (lighting math, UV transforms). Write WGSL from scratch. |
| R3 | Depth range and Y conventions differ between GL and WebGPU. | Section 5 tests, required before Phase 4 exit. |
| R4 | Wasm memory growth invalidates typed-array views. | `refreshViews()` in Phase 5. Tests that grow memory on purpose. |
| R5 | Parity fixtures drift if the reference changes. | Pinned to `three@0.186.1` in `package.json` (exact version) and in the CDN URLs. Never regenerate fixtures from a different version without updating `DECISIONS.md`. |

---

## 7. Testing and Parity

- **Language:** the goal is a working Three.js replacement. Keep scene computation and core logic in Rust/Wasm where it provides value, and do not cross the Wasm boundary for every property update; the JavaScript layer may hold code that is simpler or faster there (`DECISIONS.md` section 6).
- **Visual reference:** the Three.js r186 WebGPU renderer (`DECISIONS.md` D27).
- **Parity fixtures:** Generated by a Node script that imports the real `three/src` modules and writes JSON or binary to `parity/`. Fixtures and reference images are committed, so running the tests needs no three.js; only regenerating them does (`npm run reference:fixtures`, `node parity/visual/run.mjs --generate`). Never hand-write expected values from memory.
- **Unit tests:** Every ported public function has at least one test, placed next to the code.
- **Visual tests:** Headless Chromium with WebGPU, compared against Three.js renders. Diffs go to `parity/visual/out/` (gitignored).
- **CI:** On every change to `engine/math/`, `engine/core/`, or `engine/bindings/`, run native tests, the `wasm32` build, and the parity check.

---

## 8. Handoff Protocol

When you finish or stop:
1. Update `STATUS.md` with: phase, files touched, tests run and results, open questions, assumptions about other phases.
2. Leave the tree compiling. If you can't, say so at the top of `STATUS.md`.
3. If you hit a decision that isn't yours (for example, pulling in a file from section 1.4), write it under "Needs decision" and stop that item.

---

## 9. Do Not

- Edit anything inside `node_modules/three/`, or copy the reference into the repository.
- Import three.js from `engine/`, the package in `dist/wamr3d/`, or a primary example.
- Port from `build/`, `examples/`, `docs/`, `editor/`, `test/`, or asset folders.
- Port `src/renderers/webgl/`.
- Change the matrix layout, depth convention, Euler order, or Three.js version without updating `DECISIONS.md` and regenerating all parity fixtures.
- Add `unsafe` (Rust) or raw owning pointers (C++) without a `// SAFETY:` or ownership comment that states the invariant.
