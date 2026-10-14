<img src="logo.png" alt="WAMR3D" width="240">

# WAMR3D

**A fast WebAssembly 3D engine for the web: a Rust core, its own WebGPU renderer and an API that reads like three.js.**

WAMR3D provides a WebAssembly scene graph, transforms, cameras, geometry processing, culling and draw ordering, plus a separate WebGPU renderer. Drive it from JavaScript through classes that follow three.js conventions or through batched calls for large scenes. The object API keeps user-facing transforms in JavaScript and synchronizes them with the engine in batches. Behaviour is checked against three.js r186 value by value and pixel by pixel.

It has no runtime dependencies and ships a complete WebGPU render path: meshes, lines, points, sprites and instanced meshes; basic, Lambert and standard materials; colour textures; up to 16 directional, point and spot lights; directional and spot shadows with PCF; tone mapping; render targets; transparency; and fog. Environment reflections (prefiltered, image-based lighting) are available through the low-level API (`setEnvironment`); the object API does not read `scene.environment` or `envMap` yet. Point-light shadows, area lights, post-processing and a WebGL fallback are not part of it yet; see [Status](#status) for the full list.

## Why try it

- **Faster scene updates where it counts.** Updating 10,000 animated objects (rotations, world matrices, camera) took a median 1.6 ms in WAMR3D against 4.5 ms in three.js at 1920×1080, in Chrome on the same machine with the same scene and the same renderer. At 2,000 objects it was 0.4 ms against 0.6 ms.
- **Same results as three.js.** Over 7,600 reference cases generated from the three.js r186 source are replayed against the Rust code. Individual operations agree to about one part in a million.
- **Explicit low-level ownership.** The handle-based API stores objects in WebAssembly memory and uses explicit destruction; stale handles cannot refer to a different object. The three.js-style object API keeps transforms in JavaScript and releases engine objects when their JavaScript objects are collected.
- **Zero-copy low-level geometry access.** Read and write geometry attributes through typed-array views straight over engine memory. The compatibility API exposes copies for mutable attribute arrays.
- **Its own WebGPU renderer.** In the showcase scene with 10,000 separate animated meshes at 1920×1080, WAMR3D held 60 fps (12.2 ms of draw submission per frame); three.js r186 ran at 34 fps with its WebGL renderer (23.7 ms) and 9.5 fps with its WebGPU renderer (100.5 ms). With 50,000 instanced bodies in a four-level scene graph, WAMR3D held 60 fps (12.0 ms of scene update) against 21 to 23 fps for three.js (39 to 40 ms). Measured at 1280×720, 1920×1080, 2560×1440 and 3840×2160 with similar results at each; one run per resolution on one machine. This snapshot predates the latest renderer-feature additions and does not measure their performance. See [`STATUS.md`](STATUS.md) for the full tables and their limits.
- **Small and free.** The current SIMD WebAssembly module is about 488 KiB. Nothing to pay, nothing else to install at run time.

What it is not: a complete replacement for three.js. Calls that do very little work (a single vector operation, one property at a time) are *slower* than plain JavaScript, because crossing into WebAssembly has a fixed cost. WAMR3D wins when you batch. The numbers for both cases are in [`STATUS.md`](STATUS.md).

## Install

```
npm install wamr3d
```

The package is on npm: <https://www.npmjs.com/package/wamr3d>. To build it from source instead, see [Build](#build).

## Quick look

```js
import * as WAMR3D from 'wamr3d/compat';

await WAMR3D.init();

const scene = new WAMR3D.Scene();
const camera = new WAMR3D.PerspectiveCamera( 50, innerWidth / innerHeight, 0.1, 100 );
camera.position.set( 3, 2, 5 );
camera.lookAt( 0, 0, 0 );

const cube = new WAMR3D.Mesh( new WAMR3D.BoxGeometry(), new WAMR3D.MeshLambertMaterial( { color: 0x4f8cff } ) );
scene.add( cube, new WAMR3D.DirectionalLight( 0xffffff, 2 ), new WAMR3D.HemisphereLight( 0xbfd4ff, 0x30281e, 1 ) );

const renderer = new WAMR3D.WebGPURenderer( { antialias: true } );
await renderer.init();
renderer.setSize( innerWidth, innerHeight );
document.body.appendChild( renderer.domElement );

renderer.setAnimationLoop( ( time ) => {

	cube.rotation.y = time / 1000;
	renderer.render( scene, camera );

} );
```

The same engine through the low-level API, without classes:

```js
import { init, World } from 'wamr3d';

await init();

const world = new World();
const scene = world.createObject();
const arm = world.createObject();
const hand = world.createObject();
world.add(scene, arm);
world.add(arm, hand);

world.setPosition(arm, 10, 0, 0);
world.setRotation(arm, 0, 0, Math.PI / 2, 'XYZ');
world.setPosition(hand, 1, 0, 0);

world.updateMatrixWorld(scene, false);
console.log(world.matrixWorld(hand)); // Float32Array(16), column-major
```

## Coming from three.js

For the classes WAMR3D has, change the import, initialize once, and use the WebGPU renderer:

```diff
- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();
```

`scene.add( mesh )`, `mesh.position.set( 1, 2, 3 )`, `mesh.rotation.y += 0.01`, `camera.lookAt( 0, 0, 0 )`, `raycaster.intersectObjects( scene.children )` and chained math keep working as written. A test runs one such script against both libraries and compares every number.

Setting `position`, `rotation` and `scale` does not call into WebAssembly: the object API keeps them in JavaScript and sends every change to the engine in one batch per frame.

**[Read the full migration guide →](MIGRATION.md)** It lists which classes exist, the differences to watch for, the batching patterns, and what is not available yet.

## See it run

```
node examples/browser/serve.mjs
```

Then open:

| Page | What you get |
|---|---|
| <http://localhost:8080/examples/showcase/> | **The showcase.** Up to 100,000 tumbling bodies in eight belts around a sun, as separate or instanced meshes, with a settings panel, live timings, and the same scene on three.js (WebGPU and WebGL) one click away. "Compare all four renderers" measures them in turn |
| <http://localhost:8080/examples/webgpu/> | **WAMR3D drawing by itself with WebGPU**: rotating cube, orbiting cubes, a moving point light, a see-through ring, a line grid, click to recolour. No other library on the page. |
| <http://localhost:8080/parity/visual/> | Each visual parity case drawn by WAMR3D next to the stored three.js image, with the pixel difference |
| <http://localhost:8080/examples/webgpu/visual.html> | The demo scene drawn by WAMR3D and by three.js (WebGL) on the same page, with the pixel difference |
| <http://localhost:8080/examples/browser/> | The low-level API demo, drawn by WAMR3D with WebGPU, with a live transform check against three.js. `?renderer=three` draws it with the three.js adapter instead |
| <http://localhost:8080/examples/compare/> | WAMR3D and three.js side by side on the same scene, with timings, an object-count selector and a choice of what to compare. Single engines: `run.html?engine=api` (WAMR3D object API), `native` (WAMR3D batched calls), `three-webgpu`, `three-webgl`, and the adapter pair `wamr3d` and `three`; add `&satellites=10000`. |
| <http://localhost:8080/examples/threejs/> | The same scene built, animated and drawn only by three.js r186 (its WebGPU renderer; `?engine=three-webgl` for WebGL), as the baseline |

Drag to orbit, wheel to zoom. The command builds the package first if needed, which requires the tools under [Build](#build).

The WebGPU pages need a browser with WebGPU (current Chrome or Edge). Only the `wamr3d` engine of the comparison and `examples/browser/?renderer=three` still draw through the three.js adapter; they are kept as a reference.

## Project website

The static project site lives in `website/`. To develop it locally, first build the Wasm package, then install and start the site:

```
node engine/bindings/build.mjs
npm ci --prefix website
npm run dev --prefix website
```

To build and preview the deployable site, including its standalone WebGPU example:

```
npm run build --prefix website
npm run preview --prefix website
```

The site is plain JavaScript styled with Tailwind CSS. Its animated backdrop is drawn by WAMR3D itself (`website/src/scene/hero-scene.js`, WebGPU only; browsers without WebGPU get a static backdrop, and three.js is never loaded). Benchmark figures in `website/src/data/benchmarks.js` are a checked-in projection of the latest measurements and their raw logs in `bench/results/`; the methodology and full tables are in `STATUS.md`. Update the data and documentation together when new results are measured. The demos, the parity page and the package are served from the repository root in development and copied into `website/dist` by `website/scripts/prepare-pages.mjs`.

The GitHub Actions workflow in `.github/workflows/pages.yml` builds the package and deploys `website/dist` to GitHub Pages. Its benchmark figures are the recorded 2026-10-14 run; that snapshot predates the renderer-feature milestone below, and does not measure the performance of the newly added effects. Set the repository's Pages source to **GitHub Actions**.

## Build

You need:

- [Node.js](https://nodejs.org). Tested with v24; older versions have not been tried.
- Nothing from npm. `npm install` is optional: it fetches the pinned three.js r186 that a few comparison scripts use (marked below).
- Rust (stable) with the WebAssembly target: `rustup target add wasm32-unknown-unknown`
- The `wasm-bindgen` command-line tool, exactly version 0.2.129: `cargo install wasm-bindgen-cli --version 0.2.129 --locked`. If that fails to compile, download the prebuilt binary for your platform from the 0.2.129 release at <https://github.com/wasm-bindgen/wasm-bindgen/releases> and put it in `~/.cargo/bin`.

Then:

```
node engine/bindings/build.mjs
```

This writes the importable package to `dist/wamr3d/`: `index.js`, the generated bindings, TypeScript typings, `wamr3d_wasm_bg.wasm` and a `package.json`. Use a local build from another project with `npm install /path/to/dist/wamr3d` (or install the published package with `npm install wamr3d`) and `import { init, World } from 'wamr3d'` or `import * as WAMR3D from 'wamr3d/compat'`. In a browser the page must be served over HTTP, not opened from `file://`.

## Things to know before you write code

These apply to the low-level `wamr3d` API. The object API in `wamr3d/compat` has defaults and chaining, keeps transforms in JavaScript and synchronizes them with the engine in batches, and releases engine objects when their JavaScript objects are collected. The low-level API uses handles and explicit disposal.

- Right-handed, +Y up, cameras look down −Z, column-major matrices, radians. Same as three.js.
- Objects, geometries and materials are handles (`bigint`). Math values (`Vector3`, `Quaternion`, `Matrix4`), `Timer` and `World` are classes; call `.free()` on them when you are done.
- Methods change the value in place and return nothing, so calls do not chain.
- There are no default arguments. Rotation order, segment counts and the like are always written out.
- Values are stored as 32-bit floats. Keep animated angles wrapped rather than letting them grow for minutes.
- `world.destroy(object)` leaves the children alive as roots; `destroyRecursive` removes the subtree. Geometries and materials are freed only by `disposeGeometry` and `disposeMaterial`.
- A view from `attributeView()` stops working when the module's memory grows. Create it right before use.

The full typed API is in `dist/wamr3d/wamr3d_wasm.d.ts` after a build. A Node.js example is in [`examples/basic/main.mjs`](examples/basic/main.mjs).

## Status

| Area | State |
|---|---|
| Math (vectors, matrices, quaternions, Euler angles, colours, boxes, spheres, planes, rays, frustums) | Done and exposed to JavaScript. `Triangle`, `Line3`, `Spherical` and `Cylindrical` are Rust-only for now. |
| Scene graph (objects, hierarchy, transforms, world matrices, `lookAt`, `attach`, world-space queries, events) | Done and exposed. |
| Cameras (perspective, orthographic, zoom, view offset) | Done and exposed. |
| Picking (rays against meshes, from a camera or free) and object cloning | Done and exposed. |
| Geometry (attributes, index, normals, tangents, bounds, transforms) | Done for float data. |
| Built-in shapes | Box, plane, sphere, cylinder, cone, circle, ring, torus. |
| Lines | `Line` and `LineSegments`, one pixel wide; raycasting uses `Raycaster.params.Line.threshold`. |
| Instancing, material arrays, fog, hand-set matrices | Done. |
| Points, sprites, render targets, tone mapping, shadows (directional and spot) | Done, each compared with three.js r186 images. Points are one pixel, as in three.js r186's WebGPU renderer. |
| Environment reflections | Prefiltering (three.js PMREM) and image-based lighting in the renderer, available through `setEnvironment` / `setMaterialEnvironment` in the low-level API. Not yet read from `scene.environment` or `envMap` by the object API, and not yet in the visual suite. |
| **Renderer** (WebGPU) | Implemented but incomplete: meshes, lines, points, sprites and instanced meshes; basic, Lambert and standard materials; colour maps, fog, up to 16 directional/point/spot lights, PCF shadows for up to four directional/spot lights, tone mapping, render targets, geometry groups, frustum culling, draw ranges and 4× MSAA. All 23 visual cases are compared with stored three.js WebGPU images. See [STATUS](STATUS.md) for limitations. |
| Object API (`wamr3d/compat`: classes, properties, chaining) | Scene, group, mesh, instanced mesh, lines, points, sprites, render targets, grid and axes helpers, cameras, eight shapes, six materials (basic, Lambert, standard, line, points, sprite), textures, five light types, shadows, tone mapping, fog, raycaster, clock, renderer and math. Typings are compiled with TypeScript. Unsupported classes throw a clear "not available yet" error. |
| Not yet available | `scene.environment` and `envMap` in the object API; point-light shadows, area lights, post-processing, scene background textures, non-colour maps, render-target depth textures and multiple attachments, and WebGL fallback are unavailable. Loaders other than `TextureLoader`, animation, audio and controls are not implemented. |

Verified in Node.js v24 and headless Chrome, and bundled with Vite for the project website. Not yet tried in Firefox or Safari.

## Tests and measurements

```
cd engine
cargo test --workspace                                  # 643 Rust tests: unit, parity, allocation
cargo build --workspace --target wasm32-unknown-unknown
cd ..
node engine/bindings/build.mjs
node parity/bindings/compat-check.mjs                   # the object API against stored three.js r186 values
node parity/bindings/check.mjs                          # the low-level API against three.js live (needs `npm install`)

node parity/visual/run.mjs                              # the WebGPU renderer against stored three.js images (server running, needs a GPU; --headed, --browser=edge)
tsc -p parity/bindings                                  # the typings, against an application-style program
node examples/webgpu/smoke.mjs                          # the demo page, and its image against three.js WebGL
node examples/showcase/check.mjs                        # the showcase: settings panel and all four engines; --measure prints the comparison
node examples/browser/smoke.mjs                         # the demo in headless Chrome or Edge (server running)
node bench/bench.mjs                                    # micro-benchmarks against three.js under Node.js (needs `npm install`)
node examples/compare/measure.mjs --gpu                 # the scene comparison in a browser (server running)
npm run build --prefix website                          # build the publication site after building the package
```

three.js r186 is the reference and is not part of this repository. Nothing in `engine/`, `dist/` or the primary examples needs it: the parity tests read committed fixtures and reference images. It is only fetched on request: the comparison pages load the pinned r186 builds from a CDN when a three.js engine or the reference check is selected, and `npm install` fetches `three@0.186.1` for the scripts that regenerate fixtures or compare live (`npm run reference:fixtures`, `reference:api`, `reference:bench`). Measured results, with the environment and method, are in [`STATUS.md`](STATUS.md).

## Repository layout

| Path | Contents |
|---|---|
| `engine/math` | crate `wamr-math`: the math types |
| `engine/core` | crate `wamr-core`: `World`, components, scene graph, cameras, geometry, resource stores |
| `engine/objects` | crate `wamr-objects`: built-in shapes, picking |
| `engine/renderer_webgpu` | crate `wamr-renderer`: culling, draw order, uniform data, shader |
| `engine/bindings` | crate `wamr3d`: the JavaScript API, the object API (`js/compat.js`), the WebGPU host (`js/webgpu.js`), the build script |
| `examples/` | `showcase` (large scene, four engines, live timings), `basic` (Node.js), `webgpu` (object API demo), `browser` (low-level API demo), `threejs` (baseline), `compare` (side by side) |
| `bench/`, `parity/` | benchmark, reference fixtures and end-to-end checks |
| `MIGRATION.md`, `DECISIONS.md`, `STATUS.md` | migration guide, design decisions, progress and results |

## Contributing

Help is welcome, especially on the renderer (textures, physically based shading, more lights), the object types and the object API. Two rules keep the project honest:

1. **Behaviour is checked, not assumed.** New engine code comes with a parity fixture generated from the three.js r186 source (see `parity/*/gen/`) and a test that replays it.
2. **Speed is measured, not claimed.** If a change is meant to be faster, add or run a benchmark and report the numbers, including the cases where it is slower.

`DECISIONS.md` explains why things are the way they are (32-bit storage with 64-bit arithmetic, generational handles, the ownership rules). `STATUS.md` lists what is done and what is next.

## License

Inspired by three.js; see [`THIRD_PARTY.md`](THIRD_PARTY.md).
