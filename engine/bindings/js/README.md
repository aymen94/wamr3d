# wamr3d

Unlock your imagination without limits: a high-performance 3D engine that runs as native WebAssembly, with a Rust core, its own WebGPU renderer and the three.js API you already know. The engine provides scene graph, transforms, cameras, geometry processing, culling and draw ordering; drive it from JavaScript through three.js-style classes or batched low-level calls. The object API keeps user-facing transforms in JavaScript and synchronizes them with the engine in batches.

Behaviour is checked against three.js, value by value and pixel by pixel. It covers three.js's core classes: skinned and morphed meshes, every material including physical transmission and iridescence, shader materials (GLSL, on WebGL 2), area lights and light probes, basic, PCF and VSM shadows, several environment maps per frame, post-processing, curves and extruded shapes, the animation system, loaders, audio and helpers, plus add-ons for controls, post-processing and wide lines under `wamr3d/addons/`. GLTFLoader is not available yet; see [STATUS.md](https://github.com/aymen94/wamr3d/blob/main/STATUS.md).

## Install

```
npm install wamr3d
```

Requirements: a browser with WebGPU (current Chrome or Edge) for rendering; Node.js 18 or newer for the math and scene graph without a renderer. In a browser, pages must be served over HTTP, not opened from `file://`. A bundler or an import map is needed to resolve the `wamr3d` package name.

## Quick start (object API)

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

## Low-level API

Handle-based and batched; use it when thousands of objects change every frame.

```js
import { init, World } from 'wamr3d';

await init();

const world = new World();
const scene = world.createObject();
const arm = world.createObject();
const hand = world.createObject();
world.add( scene, arm );
world.add( arm, hand );

world.setPosition( arm, 10, 0, 0 );
world.setRotation( arm, 0, 0, Math.PI / 2, 'XYZ' );
world.setPosition( hand, 1, 0, 0 );

world.updateMatrixWorld( scene, false );
console.log( world.matrixWorld( hand ) ); // Float32Array(16), column-major
```

Things to know:

- Objects, geometries and materials are handles (`bigint`). Math values, `Timer` and `World` are classes; call `.free()` when done.
- Methods change values in place and return nothing, so calls do not chain.
- There are no default arguments: rotation order, segment counts and the like are always written out.
- Values are stored as 32-bit floats; results agree with three.js to about `1e-6`.
- A view from `attributeView()` stops working when the module's memory grows. Create it right before use.

## Migrating from three.js

For the classes WAMR3D has, change the import, initialize once, and use the WebGPU renderer:

```diff
- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();
```

`scene.add( mesh )`, `mesh.position.set( 1, 2, 3 )`, `mesh.rotation.y += 0.01`, `camera.lookAt( 0, 0, 0 )`, `raycaster.intersectObjects( scene.children )` and chained math keep working as written.

Differences to watch for:

| In three.js | In `wamr3d/compat` |
|---|---|
| Works without setup | `await init()` once, and `await renderer.init()` before the first `render` (`setAnimationLoop` waits for you) |
| `WebGLRenderer` | Works: the same renderer drawing with WebGL 2 |
| `MeshStandardMaterial` with environment and many maps | Every map, each with its own uv transform and uv set; vertex tangents; up to 12 distinct textures per material |
| `MeshPhysicalMaterial` | Clearcoat, sheen, the specular layer, iridescence, anisotropy, transmission with thickness, attenuation and dispersion, and the maps of every layer |
| Any number of lights | Up to 16 directional, point, spot and area lights combined, plus ambient, hemisphere lights and light probes |
| Shadows from any light | Directional, spot and point lights; `BasicShadowMap`, `PCFShadowMap` (`PCFSoftShadowMap` draws as PCF) or `VSMShadowMap` |
| `PointsMaterial.size` | Points above one pixel are drawn as squares, sized as three.js's WebGLRenderer sizes them |
| Screen tone mapping and `material.toneMapped` | The supported tone-mapping modes apply to the whole screen frame; `material.toneMapped` has no effect on screen output |
| `WebGPURenderer` falls back to WebGL 2 | The same: WebGPU where available, WAMR3D's own WebGL 2 renderer otherwise; `backend: 'webgpu' \| 'webgl'` or `forceWebGL` pins one ([MIGRATION.md](https://github.com/aymen94/wamr3d/blob/main/MIGRATION.md#choosing-the-backend)) |
| `ShaderMaterial` | GLSL draws on WebGL 2; on WebGPU it draws unlit, as three.js's WebGPURenderer takes no GLSL |
| `object.matrix.elements[ 12 ] = 5` | Takes effect with `matrixAutoUpdate = false`, as in three.js; `matrixWorld` is read from the engine and refreshed by the next update. Vectors, matrices, quaternions, boxes, spheres and colours are plain JavaScript values |
| `attribute.array` is the data | Set `attribute.needsUpdate = true` after changing it, as in three.js |
| Garbage collected | Also here; `dispose()` releases engine objects at once |

The renderer (WebGPU, or WebGL 2) draws meshes (filled or wireframe, skinned, morphed), lines and points of any width, sprites and instancing; every three.js material type with three.js's lighting; 24 kinds of map; environment lighting from equirectangular, cube or render-target textures; area lights and light probes; basic, PCF and VSM shadows; tone mapping; render targets with depth textures; blending modes; and full-screen effects for post-processing.

Available classes include the scene graph, cameras, lights, every geometry (with `ShapeGeometry`, `ExtrudeGeometry`, `TubeGeometry`, `EdgesGeometry`, `WireframeGeometry`), every material (with `ShaderMaterial` and `RawShaderMaterial`), `SkinnedMesh`, `Skeleton`, `Bone`, textures and render targets, curves and shapes, the animation classes, the loaders (`FileLoader`, `ImageLoader`, `TextureLoader`, `ObjectLoader`, ...), the audio classes, the helpers, `Raycaster`, `Controls` and the math classes. Add-ons: `wamr3d/addons/controls/OrbitControls.js` and the other controls, `wamr3d/addons/postprocessing/EffectComposer.js` and its passes, `wamr3d/addons/lines/Line2.js` and its classes.

**Full guide:** [MIGRATION.md](https://github.com/aymen94/wamr3d/blob/main/MIGRATION.md): the complete class list, the low-level API mapping, batching patterns and what is not available yet.

## TypeScript

Typings ship with the package (`index.d.ts`, `compat.d.ts`). Set `"lib": [ "esnext", "dom" ]` in `tsconfig.json`.

## Links

- npm: <https://www.npmjs.com/package/wamr3d>
- Repository and examples: <https://github.com/aymen94/wamr3d>
- Unfinished work and measurements: [STATUS.md](https://github.com/aymen94/wamr3d/blob/main/STATUS.md)
- Design decisions: [DECISIONS.md](https://github.com/aymen94/wamr3d/blob/main/DECISIONS.md)

## License

MIT license; third-party license notices are included with the project documentation.
