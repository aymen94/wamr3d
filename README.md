<p align="center">
  <img src="logo.png" alt="WAMR3D" width="240">
</p>

# WAMR3D

**Unlock your imagination without limits.** WAMR3D is a high-performance 3D engine that runs as native WebAssembly in the browser: a Rust core, its own WebGPU renderer and the three.js API you already know.

**Renders up to 8× faster than three.js.** *(50,000 separate animated meshes at 3840×2160 on WebGPU: 16.7 fps against 2.1 fps for three.js's WebGPU renderer, in the 2026-10-21 showcase run; draw submission up to 14.5× faster. [Benchmarks](BENCHMARKS.md).)*

WAMR3D provides a WebAssembly scene graph, transforms, cameras, geometry processing, culling and draw ordering, plus a separate WebGPU renderer. Drive it from JavaScript through classes that follow three.js conventions or through batched calls for large scenes. The object API keeps user-facing transforms in JavaScript and synchronizes them with the engine in batches. Behaviour is checked against three.js value by value and pixel by pixel.

It has no runtime dependencies and draws with its own WebGPU renderer, switching to a native WebGL 2 renderer where WebGPU is missing: meshes (filled or wireframe), skinned meshes and morph targets, lines and points of any width, sprites and instanced meshes; basic, Lambert, Phong, toon, normal, matcap, depth, distance, shadow, dashed-line, standard and physical materials (clearcoat, sheen, specular layer, iridescence, anisotropy, transmission with dispersion) and GLSL shader materials with lights and fog on WebGL 2; three.js's per-material state (depth function, stencil, polygon offset, alpha hash and coverage, dithering, colour write) and clipping planes; 24 kinds of texture map, each with its own uv transform and uv set, and vertex tangents; directional, point, spot and rectangular area lights and light probes; basic, PCF and VSM shadows; image-based lighting from up to eight environments per frame; texture backgrounds; tone mapping; render targets with depth textures; three.js's blending modes; post-processing (bloom, FXAA, output); transparency; and fog. Around it are three.js's curves and shapes, animation system, loaders, audio, helpers, and add-ons for controls (including `TransformControls` and `ArcballControls`), loaders (`GLTFLoader` with Draco, KTX2 and meshopt, FBX, OBJ/MTL, RGBE/HDR, EXR), post-processing and wide lines. This is release `0.9.3`; [Status](#status) lists what it does not cover.

## Why try it

- **Faster batched scene updates.** Setting 10,000 transforms and updating their world matrices in one batched call took 0.69 ms in WAMR3D against 2.71 ms in three.js in the 2026-10-21 Node.js benchmark (3.9× faster); one call per object and property took 0.98 ms. Creating, parenting and destroying 10,000 objects took 1.6 ms against 36.7 ms. Through the object API, setting the rotation and position of 10,000 meshes and updating their world matrices took 2.49 ms against 3.50 ms.
- **Same results as three.js.** Over 7,600 reference cases generated from the three.js source are replayed against the Rust code. Individual operations agree to about one part in a million.
- **Explicit low-level ownership.** The handle-based API stores objects in WebAssembly memory and uses explicit destruction; stale handles cannot refer to a different object. The three.js-style object API keeps transforms in JavaScript and releases engine objects when their JavaScript objects are collected.
- **Zero-copy low-level geometry access.** Read and write geometry attributes through typed-array views straight over engine memory. The compatibility API exposes copies for mutable attribute arrays.
- **Its own WebGPU and WebGL 2 renderers.** In the 2026-10-21 showcase run, WAMR3D drew 10,000 separate animated meshes at 60 fps on WebGPU at both 1280×720 and 3840×2160 (8.7 ms CPU draw submission) and at 45 fps on its WebGL 2 renderer; three.js ran at 12 fps on WebGPU (76 to 78 ms) and 42 to 43 fps on WebGL. With 50,000 separate meshes at 3840×2160, WAMR3D WebGPU ran at 16.7 fps against 2.1 fps (three.js WebGPU) and 6.8 fps (three.js WebGL). With 100,000 instanced bodies at 3840×2160, WAMR3D ran at 39.5 fps on WebGPU and 39.1 fps on WebGL 2 with 20.8 ms of CPU scene update, against 9.2 fps (88.0 ms) for three.js WebGPU and 12.0 fps (71.4 ms) for three.js WebGL. In the comparison scene at 3840×2160, the first frame of 10,000 objects took 140 ms against 643 ms for three.js WebGPU. Where WAMR3D is not faster: at 2,000 bodies every engine reaches the 60 fps display limit, and with 50,000 instanced bodies the object API ran at 20 to 21 fps, like three.js. Single runs of 0.9.3 on one machine (i9-10900X, RTX 2070 SUPER, Chrome 156) in [`bench/results/`](bench/results/).
- **Small and free.** The SIMD WebAssembly module is about 739 KiB, shaders for both backends included. Nothing to pay, nothing else to install at run time.

What it is not: a complete replacement for three.js. In the object API, vectors, quaternions, matrices, boxes, spheres and colours are plain JavaScript values, as in three.js, and take about the same time (0.88× to 1.09× of three.js's in the math workloads of `bench/compat.mjs` on 2026-10-21); the scene graph, culling and draw preparation run in WebAssembly. The low-level engine classes (`wamr3d`) cross into WebAssembly on every call, so single small calls there are *slower* than plain JavaScript: batch them, and do per-value math with the JavaScript values of `wamr3d/math` (see [Mixing JavaScript and WebAssembly](#mixing-javascript-and-webassembly)).

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

### Mixing JavaScript and WebAssembly

Use each side for what it does fastest: small math in JavaScript, scene work in WebAssembly. A call on the low-level math classes (`Vector3`, `Matrix4` from `wamr3d`) crosses into WebAssembly, which costs more than the arithmetic of one vector. `wamr3d/math` has the same values as plain JavaScript (`Vector2/3/4`, `Quaternion`, `Euler`, `Matrix3/4`, `Box3`, `Sphere`; they chain and need no `init()`). Compute with them, write the results into one typed array, and send it in one call:

```js
import { init, World } from 'wamr3d';
import { Vector3, Quaternion } from 'wamr3d/math';

await init();
const world = new World();
const handles = world.createObjects( 10000 );
const transforms = new Float32Array( handles.length * 10 );
const p = new Vector3(), q = new Quaternion(), up = new Vector3( 0, 1, 0 );

for ( let i = 0, o = 0; i < handles.length; i ++, o += 10 ) {
	p.set( i * 0.01, 0, 0 );
	q.setFromAxisAngle( up, i * 1e-4 );
	transforms[ o ] = p.x; transforms[ o + 1 ] = p.y; transforms[ o + 2 ] = p.z;
	transforms[ o + 3 ] = q.x; transforms[ o + 4 ] = q.y; transforms[ o + 5 ] = q.z; transforms[ o + 6 ] = q.w;
	transforms[ o + 7 ] = transforms[ o + 8 ] = transforms[ o + 9 ] = 1;
}
world.setTransforms( handles, transforms );
```

In `bench/math.mjs` (2026-10-21, Node.js), this pattern updated 10,000 objects (per-object math, transforms, world matrices) in 0.91 ms, against 2.25 ms for three.js and 1.97 ms with every vector in the low-level Wasm classes. Single operations on `wamr3d/math` values took 0.80× to 1.09× of three.js's time, against 1.46× to 8.31× on the Wasm classes ([`math.txt`](bench/results/math.txt)).

## See it run

```
node examples/browser/serve.mjs
```

Then open:

| Page | What you get |
|---|---|
| <http://localhost:8080/examples/showcase/> | **The showcase.** Up to 100,000 tumbling bodies in eight belts around a sun, as separate or instanced meshes, with a settings panel, live timings, and eight paths including JS math + Wasm rendering. Compare and measure them in turn |
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

The site is plain JavaScript styled with Tailwind CSS. Its animated backdrop is drawn by WAMR3D itself (`website/src/scene/hero-scene.js`, with WebGPU or WebGL 2; browsers with neither get a static backdrop, and three.js is never loaded). Benchmark figures in `website/src/data/benchmarks.js` are generated from the raw logs of the last run in `bench/results/` with `node website/scripts/benchmark-data.mjs`; the commands and the method are on the benchmarks page. The demos, the parity page and the package are served from the repository root in development and copied into `website/dist` by `website/scripts/prepare-pages.mjs`. The site's own pages use the published npm package (`wamr3d` in `website/package.json`); the copied demos use the local build, so run `node engine/bindings/build.mjs` before building the site.

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

`0.9.3` follows the three.js API and is verified with the checks and examples in this repository only.

| Area | Unfinished or missing |
|---|---|
| Materials | No node (TSL) materials (out of scope). `ShaderMaterial` draws on WebGL 2 only, with lights and fog but no shadows. |
| Post-processing | The built-in passes draw on both backends; a `ShaderPass` with other GLSL needs WebGL 2. No TSL. |
| Renderer | Area-light highlights are approximated (no LTC tables); skinned meshes are not frustum-culled; `LineMaterial.dashOffset` has no effect. |
| Browsers | Draws with WebGPU, or WebGL 2 where WebGPU is missing ([Choosing the backend](#choosing-the-backend)). Tested in Chromium-based browsers only. |

[STATUS.md](STATUS.md) has the full list of limitations and the results of the last verification;

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

Tool versions, installation and troubleshooting are in [CONFIGURATION.md](CONFIGURATION.md); which checks to run and how to add tests in [TESTING.md](TESTING.md); benchmark procedures and recorded runs in [BENCHMARKS.md](BENCHMARKS.md); releasing the npm package in [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

three.js is the reference and is not part of this repository. Nothing in `engine/`, `dist/` or the primary examples needs it: the parity tests read committed fixtures and reference images. It is only fetched on request: the comparison pages load the pinned r186 builds from a CDN when a three.js engine or the reference check is selected, and `npm install` fetches `three@0.186.1` for the scripts that regenerate fixtures or compare live (`npm run reference:fixtures`, `reference:api`, `reference:bench`). Measured results, with the environment and method, are in [`bench/results/`](bench/results/) and on the website's benchmarks page.

## Contributing

Help is welcome, especially on the renderer, the object types and the object API. Behaviour is checked against three.js, not assumed, and speed is measured, not claimed: see [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [AGENTS.md](AGENTS.md) for the rules (they also guide AI coding agents; GitHub Copilot reads them through `.github/copilot-instructions.md`).

## License

This project is MIT licensed.
