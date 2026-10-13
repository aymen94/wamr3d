<img src="logo.png" alt="WAMR3D" width="240">

# WAMR3D

**A 3D engine in Rust and WebAssembly that draws with WebGPU, for people who want their animation loop to run native-speed math.**

WAMR3D keeps your scene graph, transforms, cameras, geometry processing, culling and draw ordering inside a WebAssembly module. You drive it from JavaScript, either through classes that follow three.js conventions or through batched calls for large scenes. It is checked against three.js r186 value by value and pixel by pixel.

It is an enthusiast project, MIT licensed, with no runtime dependencies. It is also unfinished: **the renderer is young** (meshes, lines and instanced meshes, diffuse or physically based materials, colour textures, directional, point and spot lights, transparency, fog; no shadows, environment reflections, points or render targets yet). Read [Status](#status) before you plan around it.

## Why try it

- **Faster scene updates where it counts.** Updating 10,000 animated objects (rotations, world matrices, camera) took a median 2.2 ms in WAMR3D against 4.2 ms in three.js, in Chrome on the same machine with the same scene. At 2,000 objects it was 0.5 ms against 0.8 ms.
- **Same results as three.js.** Over 7,600 reference cases generated from the three.js r186 source are replayed against the Rust code. Individual operations agree to about one part in a million.
- **No garbage-collector pauses from the engine.** Objects live in WebAssembly memory and are created and destroyed explicitly. A handle to a destroyed object can never reach a different one.
- **Zero-copy vertex data.** Read and write geometry attributes through typed-array views straight over engine memory.
- **Its own WebGPU renderer.** In the showcase scene with 10,000 separate animated meshes, WAMR3D held 60 fps (12 ms of draw submission per frame); three.js r186 ran at 34 fps with its WebGL renderer (23 ms) and 9 fps with its WebGPU renderer (100 ms). With 50,000 instanced bodies in a four-level scene graph, WAMR3D held 60 fps (12 ms of scene update) against about 20 fps for three.js (39 to 46 ms). One run on one machine; see [`STATUS.md`](STATUS.md) for the full table and its limits.
- **Small and free.** The module is about 450 KiB of WebAssembly. MIT licensed. Nothing to pay, nothing else to install at run time.

What it is not: a complete replacement for three.js. Calls that do very little work (a single vector operation, one property at a time) are *slower* than plain JavaScript, because crossing into WebAssembly has a fixed cost. WAMR3D wins when you batch. The numbers for both cases are in [`STATUS.md`](STATUS.md).

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

The GitHub Actions workflow in `.github/workflows/pages.yml` builds the package and deploys `website/dist` to GitHub Pages. Set the repository's Pages source to **GitHub Actions**.

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

This writes the importable package to `dist/wamr3d/`: `index.js`, the generated bindings, TypeScript typings, `wamr3d_wasm_bg.wasm` and a `package.json`. Use it from another project with `npm install /path/to/dist/wamr3d` and `import { init, World } from 'wamr3d'` or `import * as WAMR3D from 'wamr3d/compat'`. In a browser the page must be served over HTTP, not opened from `file://`.

## Things to know before you write code

These apply to the low-level `wamr3d` API. The object API in `wamr3d/compat` has defaults and chaining and releases engine objects when they are garbage collected.

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
| Lines | `Line` and `LineSegments`, one pixel wide, not picked by the raycaster. |
| Instancing, material arrays, fog, hand-set matrices | Done. |
| Points, sprites, shadows, environment reflections, render targets | Not started. |
| **Renderer** (WebGPU) | **In progress.** Meshes and lines; unlit, diffuse and physically based (roughness/metalness) materials; colour textures with mipmaps and uv transforms; vertex colours; alpha blending; up to 8 directional, point and spot lights plus ambient/hemisphere light; fog; instanced meshes; a material per geometry group; frustum culling; draw ranges; 4x MSAA. Eleven cases are compared with stored three.js WebGPU images. No environment reflections, other maps, shadows, points, sprites, render targets or tone mapping yet. |
| Object API (`wamr3d/compat`: classes, properties, chaining) | Scene, group, mesh, instanced mesh, lines, grid and axes helpers, cameras, eight shapes, four materials, textures, five lights, fog, raycaster, clock, renderer, math. Typings are compiled with TypeScript. Classes that are missing throw a clear "not available yet" error. |
| Loaders, animation system, audio, controls, helpers | Not planned for the first version. |

Verified so far in Node.js v24 and headless Chrome. Not yet tried in Firefox, Safari or with a bundler.

## Tests and measurements

```
cd engine
cargo test --workspace                                  # 638 Rust tests: unit, parity, allocation
cargo build --workspace --target wasm32-unknown-unknown
cd ..
node engine/bindings/build.mjs
node parity/bindings/compat-check.mjs                   # the object API against stored three.js r186 values
node parity/bindings/check.mjs                          # the low-level API against three.js live (needs `npm install`)
node parity/bindings/compat-check.mjs                   # one script run against three.js and the object API
node parity/visual/run.mjs                              # the WebGPU renderer against stored three.js images (server running, needs a GPU; --headed, --browser=edge)
tsc -p parity/bindings                                  # the typings, against an application-style program
node examples/webgpu/smoke.mjs                          # the demo page, and its image against three.js WebGL
node examples/showcase/check.mjs                        # the showcase: settings panel and all four engines; --measure prints the comparison
node examples/browser/smoke.mjs                         # the demo in headless Chrome or Edge (server running)
node bench/bench.mjs                                    # micro-benchmarks against three.js under Node.js (needs `npm install`)
node examples/compare/measure.mjs --gpu                 # the scene comparison in a browser (server running)
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

MIT. WAMR3D's behaviour is derived from three.js, which is also MIT licensed; see [`THIRD_PARTY.md`](THIRD_PARTY.md).
