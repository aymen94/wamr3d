# Migrating from three.js to WAMR3D

WAMR3D follows the three.js API, so most applications move over by changing the import, initializing the WebAssembly module once and using the WebGPU renderer. This guide covers those steps, the differences to watch for, and what is not available yet.

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

`init()` loads the WebAssembly module; call it once, before creating anything. `renderer.init()` must finish before the first `render` (`setAnimationLoop` waits for it). The renderer draws with WebGPU where the browser has it and switches to WebGL 2 by itself otherwise (see [Choosing the backend](#choosing-the-backend)). Code that keeps `new THREE.WebGLRenderer()` also works: it is the same renderer, drawing with WebGL 2, and it starts `init()` itself. Pages must be served over HTTP, and a bundler or an import map resolves the package name. To try the repository's own build, run `node engine/bindings/build.mjs` and install `dist/wamr3d`.

Everything else keeps its three.js form: `scene.add( mesh )`, `mesh.position.set( 1, 2, 3 )`, `mesh.rotation.y += 0.01`, `camera.lookAt( 0, 0, 0 )`, materials with their parameters, `raycaster.intersectObjects( scene.children )` and chained math.

## 2. Check the differences

| In three.js | In WAMR3D |
|---|---|
| `WebGLRenderer` and `WebGPURenderer` | Both exist; `WebGPURenderer` picks WebGPU or WebGL 2, `WebGLRenderer` always uses WebGL 2 (see below) |
| Any number of lights | Up to 16 directional, point and spot lights, plus ambient and hemisphere lights |
| Shadows from any light | Directional and spot lights, PCF filtering, up to 4 shadow-casting lights per frame |
| Environment maps of any kind | Equirectangular textures (`mapping = EquirectangularReflectionMapping`) for `scene.environment`, `envMap` and `scene.background`; one environment map per frame |
| Every texture has its own uv transform | A material's maps share one uv transform (the colour map's, else the first map's) |
| `MeshPhysicalMaterial` | Drawn as `MeshStandardMaterial`; clearcoat, sheen, transmission and the other extensions log a warning |
| Lines and points of any size | One pixel wide, as in three.js's WebGPU renderer |
| `object.matrix.elements[ 12 ] = 5` | `matrix.elements`, `matrixWorld`, `box.min` and similar are copies: change values through `position`, `rotation`, `scale` or the value's methods |
| `attribute.array` is what is drawn | Set `attribute.needsUpdate = true` after changing it, as three.js asks; integer data is stored as floats |
| Numbers are 64-bit | Stored as 32-bit floats; results agree to about `1e-6` |
| A missing class is `undefined` | Classes that do not exist yet throw "not available yet" when constructed |
| Garbage collected | Also here; `dispose()` releases engine objects at once |

Unsupported material parameters are stored, have no effect and log one warning, so a first run shows what your scene depends on.

### Choosing the backend

The examples offer the same choice: `examples/ports/<name>/?backend=webgl`, the showcase's engine menu (WebGPU and WebGL 2 rows for both WAMR3D APIs) and the WebGL 2 pairs on the comparison page.

```js
new THREE.WebGPURenderer();                       // 'auto': WebGPU, else WebGL 2
new THREE.WebGPURenderer( { backend: 'webgpu' } ); // WebGPU only; init() rejects without it
new THREE.WebGPURenderer( { backend: 'webgl' } );  // WebGL 2 only (same as forceWebGL: true)
new THREE.WebGLRenderer();                        // WebGL 2, for code written for three.js's WebGLRenderer

await renderer.init();
console.log( renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2' );
```

In `'auto'` mode the renderer tries WebGPU on a GPU, then WebGL 2, then the browser's software WebGPU adapter (slow, but it draws on machines without a usable graphics driver), and logs once which one it fell back to. Everything above the renderer, the scene graph, culling and draw preparation in WebAssembly, is the same on every backend. On WebGL 2, colour is blended in sRGB rather than linear space (as with three.js's WebGL renderer), render targets are not multisampled, and tone mapping, float render targets and environment maps need the `EXT_color_buffer_float` extension (available almost everywhere); without it they are skipped with a warning.

## 3. Move hot loops to the batched API (optional)

The object API keeps transforms in JavaScript and sends them to the engine in one batch per frame, so ordinary code needs no changes. When thousands of objects change every frame, the handle-based API in `wamr3d` does the same work in fewer calls:

```js
import * as THREE from 'wamr3d/compat';

const world = THREE.getWorld();                     // the engine behind the object API
const handles = BigUint64Array.from( meshes, ( m ) => m.handle );
// 10 numbers per object: position xyz, quaternion xyzw, scale xyz
world.setTransforms( handles, transforms );
```

| Instead of, per object | Use, once |
|---|---|
| `new Object3D()` | `world.createObjects( count )` |
| `parent.add( child )` | `world.addMany( parents, children )` |
| `position.set`, `quaternion.set`, `scale.set` | `world.setTransforms( handles, values )` |
| `object.matrixWorld` | `world.matricesWorld( handles )` |
| `attribute.array` (a copy) | `attributeView( world, geometry, name )` from `wamr3d`, a view over engine memory; create it right before use, as memory growth invalidates it |

Do not mix the two APIs on the same objects: the object API does not see transforms written behind its back. The full low-level API is typed in `wamr3d_wasm.d.ts` in the package.

## 4. Not available yet

Keep three.js for these, or keep that part of the application outside WAMR3D:

- **Rendering:** cube textures; light, bump, displacement, specular and gradient maps; per-map uv transforms; more than one environment map per frame; area lights; point-light shadows; shadow types other than PCF; post-processing; depth textures and multiple render-target attachments; wireframes.
- **Objects and materials:** `SkinnedMesh`, `ShaderMaterial`, morph targets, geometry shapes other than box, plane, sphere, cylinder, cone, circle, ring and torus.
- **Everything else:** loaders other than `TextureLoader`, the animation system, audio, controls, and helpers other than `GridHelper` and `AxesHelper`.

[STATUS.md](STATUS.md) lists the current state in detail.

## Checklist

1. Install `wamr3d`, import `wamr3d/compat` instead of `three`, and `await init()` once.
2. Use `WebGPURenderer` (or keep `WebGLRenderer`) and `await renderer.init()`; pick a `backend` if the default WebGPU-then-WebGL 2 choice does not suit you.
3. Run the application: missing classes throw, unsupported parameters warn once.
4. Compare a few frames with the three.js version of your page.
5. If thousands of objects change every frame, move that loop to the batched calls and measure.
