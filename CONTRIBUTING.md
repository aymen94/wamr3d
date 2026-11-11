# Contributing

Help is welcome, especially on the renderer, the object types and the object API. Contributions come as pull requests: create a branch (on your fork, or here if you have access), and open a pull request against `main`. Merging, versioning, npm releases and the website are done by the maintainer only.

Two rules keep the project honest:

1. **Behavior is checked, not assumed.** New engine behavior comes with a parity fixture generated from the three.js source and a test that replays it ([TESTING.md](TESTING.md)).
2. **Speed is measured, not claimed.** A change meant to be faster comes with before/after numbers, including the cases where it is slower ([PERFORMANCE.md](PERFORMANCE.md)).

Read [Rules](#rules) below before writing code.

## Workflow

1. Set up the tools: [CONFIGURATION.md](CONFIGURATION.md).
2. **Search first.** Find the existing WAMR3D code for the area (`engine/*/src`, `engine/bindings/js/compat/`, `addons/`) and the three.js behavior to match (`node_modules/three/src/` after `npm install`). Extend what exists. three.js is a reference only; nothing shipped may import it.
3. Make the change where it is cheapest to run (Rust for scene and bulk work, JavaScript for small values; see [Fixed rules](#fixed-rules)).
4. Add tests and fixtures ([TESTING.md](TESTING.md#adding-tests)), rebuild with `node engine/bindings/build.mjs`, and run the checks for the area ([TESTING.md](TESTING.md#what-to-run-for-a-change)).
5. Update `STATUS.md` if limitations or open questions change; describe what changed in the pull request, not in the docs.
6. Commit on your branch and open a pull request on <https://github.com/aymen94/wamr3d> that lists the checks you ran and their results. Do not change the version, publish to npm or deploy the website; leave those to the maintainer.

## Rules

### The three.js reference

- The reference is three.js at the exact version pinned in the root `package.json` (`npm install` puts it in `node_modules/three/`). Read only `three/src/`, never the compiled `build/` files, examples, docs, editor or tests.
- Nothing in `engine/`, `dist/wamr3d/`, the primary examples or the website's own pages imports three.js, from `node_modules` or a CDN. The comparison pages load the pinned builds through `examples/three-reference.js`, the only place a three.js URL belongs. Tests read committed fixtures, so they run without it.
- Not ported: `src/renderers/webgl/`, `webgl-fallback/`, `webxr/`, `src/nodes/` and `src/materials/nodes/` (TSL; materials are hand-written WGSL and GLSL that follow the node versions' behavior), and the GLSL of `ShaderLib/` and `ShaderChunk/` (read for intent only).
- Something outside these rules is a decision: raise it in an issue or the pull request, under "Needs decision" in `STATUS.md`.

### Ground rules

1. **Port behavior, not syntax.** Match three.js defaults, method meaning and edge cases first; optimize after parity passes.
2. **Do not invent API.** Anything three.js does not define is raised before it is added.
3. **Think about the Wasm boundary.** Data that crosses to JavaScript is contiguous and typed (`f32`, `u32`); batch calls, never one per property or per vector.
4. **Keep attribution.** Preserve license notices of derived and vendored code (for example `compat/lib/earcut.js`).
5. **Done means done:** native and `wasm32` builds, the checks of the area pass ([TESTING.md](TESTING.md)), and any change to a fixed rule is recorded below.

### Conventions

- Right-handed, +Y up, cameras look down −Z; front faces are counter-clockwise.
- three.js projection matrices give depth in `[-1, 1]`; WebGPU uses `[0, 1]`. The engine applies the WebGPU correction and the WebGL 2 host remaps back in its vertex stages.
- Render targets are stored top row first on both backends (`flip_y` on WebGL 2).
- Typed-array views over Wasm memory detach when it grows, and any call into the module can grow it: take views right before use.
- Parity fixtures come from one exact three.js version; never regenerate them from another without updating that pin, and never regenerate a reference to make a failing check pass.

### Fixed rules

The choices in force, and the IDs that code comments and these documents cite. Change one only together with this list and, where it applies, with regenerated parity fixtures.

Rust core (edition 2021), with JavaScript where it is simpler or faster. Math stores `f32`; matrices are column-major (`Matrix4` 16 values, `Matrix3` 9); Euler order defaults to `XYZ`. Scene entities use generational handles. Every crate is `#![forbid(unsafe_code)]`.

- **D1** Each math function widens `f32` inputs to `f64`, computes as three.js does, and rounds once on store. Chained calls round at each step.
- **D2** Parity tolerance `|got − expected| <= 1e-6 * max(1, |expected|)`; non-finite values match exactly.
- **D3** The SIMD path uses `f64x2` in scalar operation order, so it is bit-identical to scalar.
- **D4** Rust API: three.js names in `snake_case`; `target` out-parameters become return values; `null` becomes `Option`; overloads are split; string enums become Rust enums; out-of-range indices panic.
- **D16** `engine/core/src/constants.rs` holds the buffer usage and attribute type values of three.js.
- **D18** Integer typed-array stores wrap as JavaScript does (`Uint8ClampedArray` clamps and rounds half to even); they do not saturate.
- **D21** `engine/bindings` (package `wamr3d`) is a thin `wasm-bindgen` shell; zero-copy views are built in JavaScript.
- **D27** Visual parity compares against stored three.js WebGPU renders, within the tolerance in `parity/visual/cases.js`.
- **D32** Rust prepares frame data and the WGSL and GLSL sources; the JavaScript hosts (`webgpu.js`, `webgl.js`) own the device, pipelines, buffers, textures and passes. Both hosts read the engine's uniform layout, so a layout change ships with both hosts.
- **D39** Random helpers use a SplitMix64 generator, seeded by `init()` and resettable with `setRandomSeed`; `seededRandom` stays Mulberry32.
- **D40** Mesh shaders are specialised per material: the hosts pass the material's shading mode and features as GLSL `#define`s or WGSL `override`s; a constant only clears a feature the material does not have, so output is unchanged.
- **Ownership:** a `World` owns everything; `destroy` leaves children alive as roots and `destroy_recursive` destroys the subtree; geometries, materials, render targets and interleaved buffers are freed only by `dispose_*`; reference counts are informational; arena slots are reused.
- **Language split:** scene computation and core logic in Rust/Wasm; the object API (`wamr3d/compat`) keeps three.js-style values and transforms in JavaScript and sends changes in batches. Do not mix low-level transform writes with object-API getters on the same objects.

## Style

- Rust: edition 2021, `#![forbid(unsafe_code)]` in every crate, three.js names in `snake_case` (D4). No `rustfmt` configuration is committed; follow the surrounding code.
- JavaScript: ES modules, tabs and spaces inside parentheses as in the existing files (`fn( a, b )`); the website uses its own Vite style.
- Comments say only what the code cannot: invariants, ownership, numerical choices. No comments that cite three.js source files.
- Keep each file's line endings (most are LF; Git may convert on checkout with `core.autocrlf`).
- Do not add dependencies to the engine or the package; the npm package has none at run time.

## Documentation

| File | Holds |
|---|---|
| [README.md](README.md) | what WAMR3D is, install, quick start, migration notes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | structure |
| [PERFORMANCE.md](PERFORMANCE.md), [BENCHMARKS.md](BENCHMARKS.md) | performance rules, measurement procedures, results |
| [TESTING.md](TESTING.md), [CONFIGURATION.md](CONFIGURATION.md) | checks, tools and commands |
| [STATUS.md](STATUS.md) | current limitations and the last verification (history is in git) |
| [SECURITY.md](SECURITY.md) | reporting vulnerabilities |
| `.github/instructions/` | short per-language pointers for editor assistants; this file stays the source of the rules |

Keep each fact in one file and link to it. Numbers in documentation must come from a recorded measurement or check. After editing Markdown, check that relative links and anchors resolve and that commands you mention exist (`package.json` scripts, files under `examples/`, `parity/`, `bench/`).
