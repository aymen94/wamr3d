# wamr3d

Unlock your imagination without limits: a high-performance 3D engine that runs as native WebAssembly, with a Rust core, its own WebGPU renderer and the three.js API you already know. The engine provides scene graph, transforms, cameras, geometry processing, culling and draw ordering; drive it from JavaScript through three.js-style classes or batched low-level calls. The object API keeps user-facing transforms in JavaScript and synchronizes them with the engine in batches.

Behaviour is checked against three.js, value by value and pixel by pixel. `scene.environment`, `envMap` and texture backgrounds work with equirectangular textures, and materials take normal, roughness, metalness, emissive, alpha and ambient-occlusion maps. Cube textures, point-light shadows, area lights, post-processing, most loaders, animation, audio and controls are not available; where WebGPU is missing it draws with WebGL 2. See [Not available yet](https://github.com/aymen94/wamr3d/blob/main/MIGRATION.md#4-not-available-yet).

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
| `MeshStandardMaterial` with environment and many maps | `color`, `map`, `roughness`, `metalness`, `emissive`, the normal, roughness, metalness, emissive, alpha and ambient-occlusion maps (one shared uv transform), `alphaTest`, `envMap` (or `scene.environment`, equirectangular, one per frame), `side`, `transparent`, `opacity`, `depthTest`, `depthWrite`, `vertexColors`. Unsupported parameters are stored, have no effect and log one warning |
| `MeshPhysicalMaterial` | Drawn as `MeshStandardMaterial`; clearcoat, sheen, transmission and the other extensions log one warning |
| Any number of lights | Up to 16 directional, point and spot lights combined, plus ambient and hemisphere lights |
| Shadows from any light | Directional and spot lights support PCF shadows, up to 4 shadow-casting lights per frame. Point-light shadows are not available; other shadow-map types draw as PCF |
| `PointsMaterial.size` | Points are one pixel; `size` has no effect, as in three.js's WebGPU renderer |
| Screen tone mapping and `material.toneMapped` | The supported tone-mapping modes apply to the whole screen frame; `material.toneMapped` has no effect on screen output |
| `WebGPURenderer` falls back to WebGL 2 | The same: WebGPU where available, WAMR3D's own WebGL 2 renderer otherwise; `backend: 'webgpu' \| 'webgl'` or `forceWebGL` pins one ([MIGRATION.md](https://github.com/aymen94/wamr3d/blob/main/MIGRATION.md#choosing-the-backend)) |
| A missing class is `undefined` | Unsupported classes (`SkinnedMesh`, `ShaderMaterial`, ...) throw "not available yet" |
| `object.matrix.elements[ 12 ] = 5` | `matrixWorld`, `matrix.elements`, `box.min` and similar are copies. Use `position`, `rotation`, `scale` or the value's methods |
| `attribute.array` is the data | Set `attribute.needsUpdate = true` after changing it, as in three.js |
| Garbage collected | Also here; `dispose()` releases engine objects at once |

The WebGPU renderer supports meshes, lines, line loops, points, sprites and instancing; basic, Lambert, Phong, toon, normal and standard materials with emissive light and three.js's physically based lighting; colour, normal, roughness, metalness, emissive, alpha and ambient-occlusion maps; environment lighting and texture backgrounds; fog; up to 16 directional, point and spot lights; directional and spot PCF shadows; tone mapping; render targets; geometry groups; frustum culling; draw ranges; and 4× MSAA. Points are one pixel, and shadow casters are meshes only. `Raycaster` picks single instances (`instanceId`) and sprites.

Available classes include `Scene`, `Group`, `Object3D`, `Mesh`, `InstancedMesh`, `Line`, `LineSegments`, `LineLoop`, `Points`, `Sprite`, `LOD`, `PointsMaterial`, `SpriteMaterial`, `RenderTarget` (also `WebGLRenderTarget`), `PerspectiveCamera`, `OrthographicCamera`, `BufferGeometry`, typed and interleaved attributes, eight shape geometries, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshToonMaterial`, `MeshNormalMaterial`, `MeshStandardMaterial`, `MeshPhysicalMaterial`, `LineBasicMaterial`, textures, five lights, `Fog`, `FogExp2`, `Raycaster`, `Clock`, `GridHelper`, `AxesHelper` and the math types (`Vector2/3/4`, `Quaternion`, `Euler`, `Matrix3/4`, `Color`, `Box3`, `Sphere`, `Plane`, `Ray`, `Frustum`, `Line3`, `Triangle`, `Spherical`, `Cylindrical`, `MathUtils`).

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
