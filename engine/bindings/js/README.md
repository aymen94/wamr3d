# WAMR3D

WAMR3D is a Rust and WebAssembly 3D engine with its own WebGPU renderer and WebGL 2 fallback. Its JavaScript compatibility layer follows the three.js API for supported classes, while the low-level API exposes batched scene and resource operations.

The object API keeps vectors, matrices, colours and user-facing transforms in JavaScript, then synchronizes scene changes with WebAssembly in batches. The low-level API uses explicit handles and is best suited to large scenes updated in batches.

## Install

```sh
npm install wamr3d
```

## Quick start

```js
import * as WAMR3D from 'wamr3d/compat';

await WAMR3D.init();

const scene = new WAMR3D.Scene();
const camera = new WAMR3D.PerspectiveCamera( 50, innerWidth / innerHeight, 0.1, 100 );
camera.position.set( 3, 2, 5 );
camera.lookAt( 0, 0, 0 );

const mesh = new WAMR3D.Mesh(
	new WAMR3D.BoxGeometry(),
	new WAMR3D.MeshLambertMaterial( { color: 0x4f8cff } )
);
scene.add( mesh );

const renderer = new WAMR3D.WebGPURenderer( { antialias: true } );
await renderer.init();
renderer.setSize( innerWidth, innerHeight );
document.body.appendChild( renderer.domElement );
renderer.render( scene, camera );
```

`WebGPURenderer` uses WebGPU when available and WAMR3D's WebGL 2 renderer otherwise. Select a backend with `backend: 'webgpu'` or `backend: 'webgl'` when needed.

Shaders are built for the features each material uses, on the first frame that draws it. To build them without blocking the page, `await renderer.compileAsync( scene, camera )` before the first `render`.

## Low-level API

Import from `wamr3d` for the handle-based API. It is designed for batched updates; math values use 32-bit floats and methods mutate in place without chaining. Call `.free()` on owned wrapper objects when finished and dispose geometries and materials explicitly. Typed-array views into Wasm memory must be refreshed after memory growth.

Each call on the low-level math classes crosses into WebAssembly. For per-value math, use `wamr3d/math`: the object API's `Vector2/3/4`, `Quaternion`, `Euler`, `Matrix3/4`, `Box3` and `Sphere` as plain JavaScript values, without the rest of the object API and without `init()`. Write the results into one typed array and send it in one call such as `world.setTransforms`.

## Compatibility and current limits

WAMR3D covers the scene graph, math, built-in objects, materials, loaders, animation, controls, post-processing and rendering features listed in the project README. GLSL `ShaderMaterial` is supported by the WebGL 2 renderer; on WebGPU it draws unlit. TSL is not supported. Other known gaps and backend differences are documented in the status page.

- [Coming from three.js: differences and supported API](https://github.com/aymen94/wamr3d#coming-from-threejs)
- [Current status and known gaps](https://github.com/aymen94/wamr3d/blob/main/STATUS.md)
- [Configuration and development checks](https://github.com/aymen94/wamr3d/blob/main/CONFIGURATION.md)
- [Project website and examples](https://github.com/aymen94/wamr3d)

The project is MIT-licensed. Third-party notices are included in the repository.
