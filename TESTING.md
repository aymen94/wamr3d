# Testing

What to run, when, and how to add tests. Tool setup and the server are in [CONFIGURATION.md](CONFIGURATION.md); the last verified results are in [STATUS.md](STATUS.md#verification).

Behavior is checked against three.js, never assumed: expected values come from fixtures generated from the pinned `three/src` and from stored three.js renders (D2, D27 in [CONTRIBUTING.md](CONTRIBUTING.md#fixed-rules)). Fixtures and images are committed, so the checks need no three.js.

## Checks

Commands run from the repository root unless they start with `cd`. "A build" means `node engine/bindings/build.mjs` after the last change; "server" means `node examples/browser/serve.mjs` running on port 8080.

| Command | Checks | Needs |
|---|---|---|
| `cd engine && cargo test --workspace` | unit, parity and allocation tests of all crates (674 on 0.9.5) | Rust |
| `cd engine && cargo build --workspace --target wasm32-unknown-unknown` | the crates build for WebAssembly | `wasm32-unknown-unknown` |
| `cd engine/math && cargo test --target wasm32-wasip1` | the math crate run as WebAssembly, scalar | `wasm32-wasip1` |
| `cd engine/math && RUSTFLAGS="-C target-feature=+simd128" cargo test --target wasm32-wasip1 --features simd` | the same with SIMD (D3) | `wasm32-wasip1` |
| `npm run test:api` (`node parity/bindings/compat-check.mjs`) | the object API against stored three.js values | a build |
| `npm run reference:api` (`node parity/bindings/check.mjs`) | the low-level API against three.js live | a build, `npm install` |
| `npm run test:gltf` | `GLTFLoader` on a generated glTF | a build |
| `npm run test:loaders` | `OBJLoader`, `MTLLoader`, `HDRLoader`/`RGBELoader` on generated files | a build |
| `npm run test:controls` | `TransformControls` through its pointer methods | a build |
| `npm run test:types` (`tsc -p parity/bindings`) | the typings, with an application-style program | a build, TypeScript (`npx -y -p typescript@5 tsc -p parity/bindings` without a global `tsc`) |
| `node parity/visual/run.mjs` | every visual case against stored three.js WebGPU images | a build, server, GPU |
| `node parity/visual/run.mjs --backend=webgl` | the same drawn with WebGL 2 | a build, server |
| `node examples/webgpu/smoke.mjs` | the object-API demo: frames, picking, orbiting | a build, server |
| `node examples/browser/smoke.mjs` | the low-level demo | a build, server |
| `node examples/showcase/check.mjs` (`npm run test:showcase`) | the showcase settings and all engines | a build, server |
| `node examples/ports/check.mjs --three` / `--webgl` | every ported example draws on WAMR3D and three.js / on WebGL 2 | a build, server |
| `npm run build --prefix website` | the site builds | `npm install --prefix website` |

Visual parity options: `--cases=a,b`, `--headed`, `--browser=edge`, `--console` (prints what each page logs; use it when a case renders black or times out). Diffs go to `parity/visual/out/` (gitignored); screenshots saved from WebGL 2 runs are black (the canvas does not keep its drawing buffer), but the comparison reads the pixels itself. Tolerances: `parity/visual/cases.js` (mean difference 1.5 of 255, at most 2% of pixels off by more than 12).

**Known failures:** with `--backend=webgl`, `lines`, `points` and `wireframe` differ by 2.5–4.4% of pixels because WebGL 2 rasterizes 1-pixel primitives differently (36 of 39 pass). Any other failure is a regression.

## What to run for a change

| Changed | Run at least |
|---|---|
| `engine/math` | `cargo test --workspace`, both wasm32 math runs |
| `engine/core`, `engine/objects` | `cargo test --workspace`, wasm32 build, `test:api`, `reference:api` |
| `engine/renderer_webgpu` (frame data, WGSL, GLSL) | `cargo test --workspace`, a build, visual parity on **both** backends, smoke checks |
| `engine/bindings/src` | `cargo test --workspace`, a build, `test:api`, `test:types`, smoke checks |
| `engine/bindings/js/webgpu*`, `webgl*` (hosts) | a build, visual parity on both backends, smoke checks, showcase, ports `--webgl` |
| `engine/bindings/js/compat`, `types/` | a build, `test:api`, `test:types`, `test:gltf`, `test:loaders`, `test:controls`, ports `--three` |
| `engine/bindings/js/addons` | the matching `test:*` check, ports |
| Performance work | the area's checks above, plus before/after measurements ([PERFORMANCE.md](PERFORMANCE.md)) |
| Documentation only | link and command check ([CONTRIBUTING.md](CONTRIBUTING.md#documentation)) |


## Adding tests

- **Rust unit tests** sit next to the code (`#[cfg(test)]` modules, `tests.rs` files such as `engine/renderer_webgpu/src/tests.rs`). Every ported public function has at least one.
- **Parity fixtures** for engine behavior: extend the generator in `parity/<area>/gen/generate.mjs` (it imports `three/src`), run `npm install` and `npm run reference:fixtures`, and replay the new entries in `engine/<crate>/tests/parity.rs`. Never hand-write expected values.
- **Object-API values:** add to the script in `parity/bindings/compat-check.mjs`, then store three.js's values with `node parity/bindings/compat-check.mjs --generate`.
- **Visual cases:** add a case to `parity/visual/cases/*.js` (written once against a library object `L`), then store its reference with `node parity/visual/run.mjs --generate --cases=<name>` (loads the pinned three.js WebGPU build from cdnjs).
- **Typings:** extend `parity/bindings/typecheck.ts` for new public API.

Regenerate references only when a case is added or changed on purpose, never to make a failing check pass, and only with the pinned three.js version.

## Gaps

- No test grows Wasm memory on purpose to check that views are re-taken.
- Browser checks need a GPU and run only in Chromium-based browsers; there is no CI configuration in the repository.
