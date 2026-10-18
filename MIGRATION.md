# Migrating from three.js to WAMR3D

WAMR3D follows the three.js API: most applications move over by changing the import, initialising the module once and awaiting the renderer.

## 1. Install and change the import

```
npm install wamr3d
```

```diff
- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();
```

- `init()` loads the WebAssembly module: call it once, before creating anything.
- `renderer.init()` must finish before the first `render`; `setAnimationLoop` waits for it. Keeping `new THREE.WebGLRenderer()` also works (the same renderer on WebGL 2, starting `init()` itself).
- Serve pages over HTTP and let a bundler or an import map resolve the package name.

Scene code keeps its three.js form: `scene.add( mesh )`, `mesh.position.set( 1, 2, 3 )`, `camera.lookAt( 0, 0, 0 )`, materials and their parameters, `raycaster.intersectObjects( scene.children )`, chained math.

## 2. Differences to know

| In three.js | In WAMR3D |
|---|---|
| Any number of lights | Up to 16 directional, point, spot and rectangular area lights, plus ambient, hemisphere lights and light probes |
| Shadows | Directional, spot and point lights; `BasicShadowMap`, `PCFShadowMap` (`PCFSoftShadowMap` draws as PCF, as in three.js's WebGPURenderer) or `VSMShadowMap`; up to 16 shadow maps per frame, six per point light |
| Environment maps | Equirectangular textures, `CubeTexture` (also HDR) and render-target textures; up to eight distinct environment maps per frame |
| `RectAreaLight` with `RectAreaLightUniformsLib` | Works without the LTC tables (no `init()` needed); specular light is an approximation |
| `ShaderMaterial` / `RawShaderMaterial` | GLSL draws on WebGL 2 (`backend: 'webgl'`); on WebGPU it draws unlit, as three.js's WebGPURenderer does not take GLSL |
| `three/addons/...` | `wamr3d/addons/...` for the controls, post-processing, shaders and wide lines listed in the README; no GLTFLoader yet |
| `PointsMaterial.size`, `linewidth` | Points and lines above one pixel are drawn as quads (`linewidth` also on `LineBasicMaterial`, which three.js ignores) |
| `object.matrix.elements[ 12 ] = 5` | Takes effect with `matrixAutoUpdate = false`, as in three.js. `matrixWorld` is read from the engine and its elements are overwritten on the next update |
| `attribute.array` is what is drawn | Set `attribute.needsUpdate = true` after changing it; integer data is stored as floats |
| 64-bit numbers | Math values are 64-bit; transforms, geometry and everything drawn are stored by the engine as 32-bit floats (results agree to about `1e-6`) |
| Garbage collection | Also here; `dispose()` frees engine objects at once |

Unsupported parameters are stored, have no effect and log one warning, so the first run lists what your scene depends on.

## 3. Choose the backend (optional)

```js
new THREE.WebGPURenderer();                        // 'auto': WebGPU, else WebGL 2
new THREE.WebGPURenderer( { backend: 'webgpu' } ); // WebGPU only; init() rejects without it
new THREE.WebGPURenderer( { backend: 'webgl' } );  // WebGL 2 only (same as forceWebGL: true)
```

`'auto'` tries WebGPU on a GPU, then WebGL 2, then the browser's software WebGPU adapter, and logs which one it fell back to; `renderer.backend.isWebGPUBackend` tells which draws. On WebGL 2 render targets are not multisampled, and tone mapping, float render targets and environment maps need `EXT_color_buffer_float` (available almost everywhere).

## 4. Batch hot loops (optional)

The object API already sends transforms to the engine in one batch per frame. When thousands of objects change every frame, the handle-based API does the same work in fewer calls:

```js
const world = THREE.getWorld();
const handles = BigUint64Array.from( meshes, ( m ) => m.handle );
world.setTransforms( handles, transforms ); // 10 floats per object: position xyz, quaternion xyzw, scale xyz
```

Other batched calls: `world.createObjects( count )`, `world.addMany( parents, children )`, `world.matricesWorld( handles )`, and `attributeView( world, geometry, name )` from `wamr3d` for zero-copy geometry (create the view right before use: memory growth invalidates it). Do not mix the two APIs on the same objects. The low-level API is typed in `wamr3d_wasm.d.ts`.

## 5. Not available yet

GLTFLoader and other format loaders (FBX, OBJ, RGBE, EXR, KTX2, Draco), `TransformControls`, node-based (TSL) materials and post-processing, and lights, fog and shadows inside `ShaderMaterial`. [STATUS.md](STATUS.md) has the full list.

## Checklist

1. `npm install wamr3d`, import `wamr3d/compat`, `await init()`.
2. Create a `WebGPURenderer` (or keep `WebGLRenderer`) and `await renderer.init()`.
3. Run the page: unsupported parameters warn once.
4. Compare a few frames with the three.js version.
5. Move per-frame loops over thousands of objects to batched calls, and measure.
