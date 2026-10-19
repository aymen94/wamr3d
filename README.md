<p align="center">
  <img src="logo.png" alt="WAMR3D" width="240">
</p>

# WAMR3D

**Unlock your imagination without limits.** WAMR3D is a high-performance 3D engine that runs as native WebAssembly in the browser: a Rust core, its own WebGPU renderer and the three.js API you already know.

**1.7× faster than three.js on a batched 10,000-transform update.** *(1.50 ms vs 2.57 ms in the 2026-10-18 Node.js benchmark.)*

WAMR3D provides a WebAssembly scene graph, transforms, cameras, geometry processing, culling and draw ordering, plus a separate WebGPU renderer. Drive it from JavaScript through classes that follow three.js conventions or through batched calls for large scenes. The object API keeps user-facing transforms in JavaScript and synchronizes them with the engine in batches. Behaviour is checked against three.js value by value and pixel by pixel.

It has no runtime dependencies and draws with its own WebGPU renderer, switching to a native WebGL 2 renderer where WebGPU is missing: meshes (filled or wireframe), skinned meshes and morph targets, lines and points of any width, sprites and instanced meshes; basic, Lambert, Phong, toon, normal, matcap, depth, distance, shadow, dashed-line, standard and physical materials (clearcoat, sheen, specular layer, iridescence, anisotropy, transmission with dispersion) and GLSL shader materials with lights and fog on WebGL 2; three.js's per-material state (depth function, stencil, polygon offset, alpha hash and coverage, dithering, colour write) and clipping planes; 24 kinds of texture map, each with its own uv transform and uv set, and vertex tangents; directional, point, spot and rectangular area lights and light probes; basic, PCF and VSM shadows; image-based lighting from up to eight environments per frame; texture backgrounds; tone mapping; render targets with depth textures; three.js's blending modes; post-processing (bloom, FXAA, output); transparency; and fog. Around it are three.js's curves and shapes, animation system, loaders, audio, helpers, and add-ons for controls (including `TransformControls` and `ArcballControls`), loaders (`GLTFLoader` with Draco, KTX2 and meshopt, FBX, OBJ/MTL, RGBE/HDR, EXR), post-processing and wide lines. This is release `0.9.0`; [Status](#status) lists what it does not cover.

## Why try it

- **Faster batched scene updates.** Setting 10,000 transforms and updating their world matrices in one batched call took 1.50 ms in WAMR3D against 2.57 ms in three.js in the 2026-10-18 Node.js benchmark. Through the object API, setting the rotation and position of 10,000 meshes and updating their world matrices took 2.37 ms against 3.20 ms.
- **Same results as three.js.** Over 7,600 reference cases generated from the three.js source are replayed against the Rust code. Individual operations agree to about one part in a million.
- **Explicit low-level ownership.** The handle-based API stores objects in WebAssembly memory and uses explicit destruction; stale handles cannot refer to a different object. The three.js-style object API keeps transforms in JavaScript and releases engine objects when their JavaScript objects are collected.
- **Zero-copy low-level geometry access.** Read and write geometry attributes through typed-array views straight over engine memory. The compatibility API exposes copies for mutable attribute arrays.
- **Its own WebGPU and WebGL 2 renderers.** In the 2026-10-18 showcase run at 1280×720, WAMR3D drew 10,000 separate animated meshes at 46 fps on WebGPU (13.7 ms CPU draw submission) and 34 fps on its WebGL 2 renderer; three.js ran at 8.5 fps on WebGPU (108.8 ms) and 26 fps on WebGL in the same session. With 100,000 instanced bodies, WAMR3D ran at 14.5 fps with 29.3 ms of CPU scene update, against 11.7 fps and 68.7 ms for three.js WebGPU. Single runs on one machine (i9-10900X, RTX 2070 SUPER, Chrome 155) in [`bench/results/2026-10-18/`](bench/results/2026-10-18/). Every engine, three.js included, ran slower in that session than in the complete 2026-10-16 run at four resolutions ([`bench/results/2026-10-16/`](bench/results/2026-10-16/), measured on the 0.7 tree), so compare engines within one run, not across runs.
- **Small and free.** The SIMD WebAssembly module is about 745 KiB, shaders for both backends included. Nothing to pay, nothing else to install at run time.

What it is not: a complete replacement for three.js. In the object API, vectors, quaternions, matrices, boxes, spheres and colours are plain JavaScript values, as fast as three.js's own; the scene graph, culling and draw preparation run in WebAssembly. The low-level engine classes (`wamr3d`) cross into WebAssembly on every call, so single small calls there are *slower* than plain JavaScript: batch them.

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

- `init()` loads the WebAssembly module: call it once, before creating anything.
- `renderer.init()` must finish before the first `render`; `setAnimationLoop` waits for it. `new THREE.WebGLRenderer()` also works (the same renderer on WebGL 2, starting `init()` itself).
- Each material gets shaders built for the features it uses (its maps, physical layers, environment; the frame's shadowed and area lights), as in three.js. Building them takes the GPU driver time on the first frame that needs them; `await renderer.compileAsync( scene, camera )` builds them beforehand without blocking the page.
- Serve pages over HTTP and let a bundler or an import map resolve the package name.
- Unsupported parameters are stored, have no effect and log one warning, so the first run lists what your scene depends on.

### Differences to know

| In three.js | In WAMR3D |
|---|---|
| Any number of lights | Up to 16 directional, point, spot and rectangular area lights, plus ambient and hemisphere lights and light probes |
| Shadows | Directional, spot and point lights; `BasicShadowMap`, `PCFShadowMap` (`PCFSoftShadowMap` draws as PCF, as in three.js's WebGPURenderer) or `VSMShadowMap`; up to 16 shadow maps per frame, six per point light |
| Environment maps | Equirectangular textures, `CubeTexture` (also HDR) and render-target textures; up to eight distinct environment maps per frame |
| `RectAreaLight` with `RectAreaLightUniformsLib` | Works without the LTC tables; specular light is an approximation |
| `ShaderMaterial` / `RawShaderMaterial` | GLSL draws on WebGL 2 (`backend: 'webgl'`) with `lights` and `fog`, but no shadows; on WebGPU it draws unlit, as three.js's WebGPURenderer does not take GLSL |
| Node materials (TSL) | Not ported; use the built-in materials, or `ShaderMaterial` on WebGL 2 |
| `three/addons/...` | `wamr3d/addons/...`: controls (including `TransformControls` and `ArcballControls`), loaders (`GLTFLoader` with Draco, KTX2 and meshopt, `FBXLoader`, `OBJLoader`, `MTLLoader`, `RGBELoader`, `HDRLoader`, `EXRLoader`), post-processing, shaders and wide lines |
| Clipping planes | `renderer.clippingPlanes` and material `clippingPlanes` (with `localClippingEnabled`): up to eight each |
| `PointsMaterial.size`, `linewidth` | Points and lines above one pixel are drawn as quads (`linewidth` also on `LineBasicMaterial`, which three.js ignores) |
| `object.matrix.elements[ 12 ] = 5` | Takes effect with `matrixAutoUpdate = false`, as in three.js. `matrixWorld` is read from the engine and its elements are overwritten on the next update |
| `attribute.array` is what is drawn | Set `attribute.needsUpdate = true` after changing it; integer data is stored as floats |
| 64-bit numbers | Math values are 64-bit; transforms, geometry and everything drawn are stored by the engine as 32-bit floats (results agree to about `1e-6`) |
| Garbage collection | Also here; `dispose()` frees engine objects at once |

### Choosing the backend

```js
new THREE.WebGPURenderer();                        // 'auto': WebGPU, else WebGL 2
new THREE.WebGPURenderer( { backend: 'webgpu' } ); // WebGPU only; init() rejects without it
new THREE.WebGPURenderer( { backend: 'webgl' } );  // WebGL 2 only (same as forceWebGL: true)
```

`'auto'` tries WebGPU on a GPU, then WebGL 2, then the browser's software WebGPU adapter, and logs which one it fell back to; `renderer.backend.isWebGPUBackend` tells which draws. On WebGL 2 render targets are not multisampled, and tone mapping, float render targets and environment maps need `EXT_color_buffer_float` (available almost everywhere).

### Batching hot loops

When thousands of objects change every frame, the handle-based API does the same work in fewer calls:

```js
const world = THREE.getWorld();
const handles = BigUint64Array.from( meshes, ( m ) => m.handle );
world.setTransforms( handles, transforms ); // 10 floats per object: position xyz, quaternion xyzw, scale xyz
```

Other batched calls: `world.createObjects( count )`, `world.addMany( parents, children )`, `world.matricesWorld( handles )`, and `attributeView( world, geometry, name )` from `wamr3d` for zero-copy geometry (create the view right before use: memory growth invalidates it). Do not mix the two APIs on the same objects.

## See it run

```
node examples/browser/serve.mjs
```

Then open:

| Page | What you get |
|---|---|
| <http://localhost:8080/examples/showcase/> | **The showcase.** Up to 100,000 tumbling bodies in eight belts around a sun, as separate or instanced meshes, with a settings panel, live timings, and the same scene on three.js (WebGPU and WebGL) one click away. "Compare all four renderers" measures them in turn |
| <http://localhost:8080/examples/ports/crossy-road/> | **three.js games and scenes on WAMR3D, import changed**: `crossy-road`, `stack`, `city`, `voxel-world` and `spotlights` under `examples/ports/`. Add `?engine=three` to run the same code on three.js. Each page lists what changed besides the import |
| <http://localhost:8080/examples/webgpu/> | **WAMR3D drawing by itself with WebGPU**: rotating cube, orbiting cubes, a moving point light, a see-through ring, a line grid, click to recolour. No other library on the page. |
| <http://localhost:8080/parity/visual/> | Each visual parity case drawn by WAMR3D next to the stored three.js image, with the pixel difference |
| <http://localhost:8080/examples/webgpu/visual.html> | The demo scene drawn by WAMR3D and by three.js (WebGL) on the same page, with the pixel difference |
| <http://localhost:8080/examples/browser/> | The low-level API demo, drawn by WAMR3D with WebGPU, with a live transform check against three.js. `?renderer=three` draws it with the three.js adapter instead |
| <http://localhost:8080/examples/compare/> | WAMR3D and three.js side by side on the same scene, with timings, an object-count selector and a choice of what to compare. Single engines: `run.html?engine=api` (WAMR3D object API), `native` (WAMR3D batched calls), `three-webgpu`, `three-webgl`, and the adapter pair `wamr3d` and `three`; add `&satellites=10000`. |
| <http://localhost:8080/examples/threejs/> | The same scene built, animated and drawn only by three.js (its WebGPU renderer; `?engine=three-webgl` for WebGL), as the baseline |

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

The site is plain JavaScript styled with Tailwind CSS. Its animated backdrop is drawn by WAMR3D itself (`website/src/scene/hero-scene.js`, with WebGPU or WebGL 2; browsers with neither get a static backdrop, and three.js is never loaded). Benchmark figures in `website/src/data/benchmarks.js` are generated from the raw logs of a run in `bench/results/<date>/` with `node website/scripts/benchmark-data.mjs bench/results/<date>`; the commands and the method are on the benchmarks page. The demos, the parity page and the package are served from the repository root in development and copied into `website/dist` by `website/scripts/prepare-pages.mjs`. The site's own pages use the published npm package (`wamr3d` in `website/package.json`); the copied demos use the local build, so run `node engine/bindings/build.mjs` before building the site.

`wrangler.jsonc` at the root serves `website/dist` as static assets on Cloudflare.

## Build

You need:

- [Node.js](https://nodejs.org). Tested with v24; older versions have not been tried.
- Nothing from npm. `npm install` is optional: it fetches the pinned three.js that a few comparison scripts use (marked below).
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

`0.9.0` follows the three.js API and is verified with the checks and examples in this repository only.

| Area | Unfinished or missing |
|---|---|
| Materials | No node (TSL) materials (out of scope). `ShaderMaterial` draws on WebGL 2 only, with lights and fog but no shadows. |
| Post-processing | The built-in passes draw on both backends; a `ShaderPass` with other GLSL needs WebGL 2. No TSL. |
| Renderer | Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled; `LineMaterial.dashOffset` has no effect. |
| Browsers | Draws with WebGPU, or WebGL 2 where WebGPU is missing ([Choosing the backend](#choosing-the-backend)). Tested in Chromium-based browsers only. |

[STATUS.md](STATUS.md) has the full list of limitations and the results of the last verification; [NPM.md](NPM.md) has the release steps.

## Tests and measurements

```
cd engine
cargo test --workspace                                  # 663 Rust tests: unit, parity, allocation
cargo build --workspace --target wasm32-unknown-unknown
cd ..
node engine/bindings/build.mjs
node parity/bindings/compat-check.mjs                   # the object API against stored three.js values
node parity/bindings/check.mjs                          # the low-level API against three.js live (needs `npm install`)

node parity/visual/run.mjs                              # 37 cases against stored three.js images (server running, needs a GPU; --backend=webgl, --console, --headed, --browser=edge)
tsc -p parity/bindings                                  # the typings, against an application-style program
node examples/ports/check.mjs --three                   # every ported example draws on WAMR3D and on three.js
node examples/webgpu/smoke.mjs                          # the demo page, and its image against three.js WebGL
node examples/showcase/check.mjs                        # the showcase: settings panel and all four engines; --measure prints the comparison
node examples/browser/smoke.mjs                         # the demo in headless Chrome or Edge (server running)
node bench/bench.mjs                                    # micro-benchmarks against three.js under Node.js (needs `npm install`)
node examples/compare/measure.mjs --gpu                 # the scene comparison in a browser (server running)
npm run build --prefix website                          # build the publication site after building the package
```

Tool versions, installation, every command and troubleshooting are in [CONFIGURATION.md](CONFIGURATION.md); releasing the npm package is in [NPM.md](NPM.md).

three.js is the reference and is not part of this repository. Nothing in `engine/`, `dist/` or the primary examples needs it: the parity tests read committed fixtures and reference images. It is only fetched on request: the comparison pages load the pinned r186 builds from a CDN when a three.js engine or the reference check is selected, and `npm install` fetches `three@0.186.1` for the scripts that regenerate fixtures or compare live (`npm run reference:fixtures`, `reference:api`, `reference:bench`). Measured results, with the environment and method, are in [`bench/results/`](bench/results/) and on the website's benchmarks page.

## Repository layout

| Path | Contents |
|---|---|
| `engine/math` | crate `wamr-math`: the math types |
| `engine/core` | crate `wamr-core`: `World`, components, scene graph, cameras, geometry, resource stores |
| `engine/objects` | crate `wamr-objects`: built-in shapes, picking |
| `engine/renderer_webgpu` | crate `wamr-renderer`: culling, draw order, uniform data (`frame.rs`), WGSL (`shaders.rs`, `dfg.rs`) |
| `engine/bindings` | crate `wamr3d`: the JavaScript API, the object API (`js/compat.js` over the modules in `js/compat/`), the WebGPU host (`js/webgpu.js` and `js/webgpu/`), the build script |
| `examples/` | `showcase` (large scene, four engines, live timings), `basic` (Node.js), `webgpu` (object API demo), `browser` (low-level API demo), `threejs` (baseline), `compare` (side by side) |
| `bench/`, `parity/` | benchmark, reference fixtures and end-to-end checks |
| `STATUS.md` | limitations and the last verification |
| `AGENTS.md` | repository rules and the fixed design rules that code comments cite |
| `CONFIGURATION.md`, `NPM.md` | development setup and commands, package releases |

## Contributing

Help is welcome, especially on the renderer (textures, physically based shading, more lights), the object types and the object API. Two rules keep the project honest:

1. **Behaviour is checked, not assumed.** New engine code comes with a parity fixture generated from the three.js source (see `parity/*/gen/`) and a test that replays it.
2. **Speed is measured, not claimed.** If a change is meant to be faster, add or run a benchmark and report the numbers, including the cases where it is slower.

`AGENTS.md` holds the fixed rules (32-bit storage with 64-bit arithmetic, parity tolerance, generational handles, the ownership rules). `STATUS.md` lists what is unfinished.

## License

This project is MIT licensed.
