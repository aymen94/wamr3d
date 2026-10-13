# Migrating from three.js to WAMR3D

This guide shows how three.js code maps onto WAMR3D today, what does not map yet, and how to move a project over one piece at a time.

**Read this first.** There are two ways in. The **object API** (`wamr3d/compat`) has classes, properties and chaining like three.js and draws with WAMR3D's own WebGPU renderer; start there. The **low-level API** (`wamr3d`) is handle-based and batched; the rest of this guide from "What changes in your code" onwards describes it, and you reach for it when thousands of objects change every frame. Both are incomplete: check [Not available yet](#not-available-yet) first. Behaviour matches three.js r186, checked by parity tests.

## Contents

- [The object API](#the-object-api)
- [What changes in your code](#what-changes-in-your-code)
- [Step 1: load the module](#step-1-load-the-module)
- [Step 2: move the scene graph](#step-2-move-the-scene-graph)
- [Step 3: keep three.js drawing through an adapter](#step-3-keep-threejs-drawing-through-an-adapter)
- [Step 4: make the frame loop fast](#step-4-make-the-frame-loop-fast)
- [API mapping](#api-mapping)
- [Not available yet](#not-available-yet)
- [Checklist](#checklist)

## The object API

```diff
- import * as THREE from 'three';
+ import * as THREE from 'wamr3d/compat';
+ await THREE.init();

- const renderer = new THREE.WebGLRenderer( { antialias: true } );
+ const renderer = new THREE.WebGPURenderer( { antialias: true } );
+ await renderer.init();
```

Available: `Scene`, `Group`, `Object3D`, `Mesh`, `PerspectiveCamera`, `OrthographicCamera`, `BufferGeometry`, `BufferAttribute` (and the `Float32`, `Uint16`, `Uint32` variants), `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `CircleGeometry`, `RingGeometry`, `TorusGeometry`, `Line`, `LineSegments`, `LineBasicMaterial`, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshStandardMaterial`, `Texture`, `DataTexture`, `CanvasTexture`, `TextureLoader`, `Clock`, `InstancedMesh`, `GridHelper`, `AxesHelper`, `Fog`, `FogExp2`, `AmbientLight`, `HemisphereLight`, `DirectionalLight`, `PointLight`, `SpotLight`, `Raycaster`, `WebGPURenderer`, `Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Euler`, `Matrix3`, `Matrix4`, `Color`, `Box3`, `Sphere`, `Plane`, `Ray`, `Frustum`, `MathUtils`, and the constants `FrontSide`, `BackSide`, `DoubleSide`.

Differences to watch for:

| In three.js | In `wamr3d/compat` |
|---|---|
| Works without setup | `await init()` once before creating anything, and `await renderer.init()` before the first `render` (`setAnimationLoop` waits for you) |
| `WebGLRenderer` | `WebGPURenderer` only; the browser must support WebGPU |
| `MeshStandardMaterial` with environment and many maps | `color`, `map`, `roughness`, `metalness`, `side`, `transparent`, `opacity`, `depthTest`, `depthWrite` and `vertexColors` work. There are no environment reflections, so metals look dark away from the highlight. Any other parameter is stored, has no effect, and logs one warning |
| Textures | Mipmaps, the six filters, the three wrapping modes, `repeat`, `offset`, `rotation` and `center` work. No anisotropy, and only colour maps |
| A missing class is `undefined` | Common classes that do not exist yet (`Points`, `Sprite`, `SkinnedMesh`, `MeshPhongMaterial`, `WebGLRenderer`, ...) throw "not available yet" when constructed |
| Any number of lights | Up to 8 `DirectionalLight`, `PointLight` and `SpotLight` together, plus all `AmbientLight` and `HemisphereLight`. No shadows. A `HemisphereLight` is treated as pointing up |
| `Line`, `LineSegments` | Drawn one pixel wide. `Raycaster` hits them as in three.js (`params.Line.threshold`, 1 world unit by default) |
| `InstancedMesh` | Works, drawn in one call. Instances are not culled or picked one by one |
| `scene.fog` | `Fog` and `FogExp2` work; `material.fog = false` is ignored |
| `object.matrix.elements[ 12 ] = 5` changes the object | `object.matrixWorld`, `matrix.elements`, `box.min`, `box.max`, `sphere.center`, `plane.normal`, `ray.origin` and `ray.direction` are copies. Change the object through `position`, `rotation`, `quaternion`, `scale`, or the value through its methods |
| `mesh.matrixAutoUpdate = false` and writing matrices yourself | Works through the matrix's methods: `mesh.matrix.copy( m )`, `.compose( ... )`, `.makeRotationY( a ).setPosition( x, y, z )`. Writing into `matrix.elements` has no effect |
| `mesh.material = [ a, b ]` | Works with geometry groups. Assign a new array to change it; editing the array in place is not seen |
| `attribute.array` is the data | `attribute.array` is your copy; set `attribute.needsUpdate = true` after changing it, as in three.js. Zero-copy access is `attributeView()` in the low-level API |
| Numbers are 64-bit | Stored as 32-bit floats; results agree to about `1e-6` |
| Everything is garbage collected | Also here: engine objects are released when their JavaScript object is collected. `geometry.dispose()`, `material.dispose()` and `object.dispose()` release them at once |

Speed: `position`, `rotation`, `quaternion`, `scale` and `up` are kept in JavaScript and sent to the engine in one batch, so setting them is as cheap as in three.js. In the measured scene, updating 10,000 objects one property at a time took 4.7 ms against 3.6 ms for three.js, and drawing them was about twice as fast as three.js WebGL (see `STATUS.md`). For very large scenes the batched low-level calls are faster still (2.8 ms), but do not mix them with the object API on the same objects: the object API does not see transforms written behind its back.

TypeScript: the typings are in `wamr3d/compat` (`compat.d.ts`). They need `"lib": [ "esnext", "dom" ]` in `tsconfig.json`.

A complete page is [`examples/webgpu/main.js`](examples/webgpu/main.js), and [`parity/bindings/compat-check.mjs`](parity/bindings/compat-check.mjs) is a script that runs unchanged on both libraries.

## What changes in your code

This and the following sections describe the low-level `wamr3d` API.

| three.js | WAMR3D | Why |
|---|---|---|
| `new THREE.Object3D()` returns an object | `world.createObject()` returns a handle (`bigint`) | The engine owns every object in WebAssembly memory. A handle to a destroyed object is dead and can never reach another object. |
| `object.position.set(x, y, z)` | `world.setPosition(object, x, y, z)` | State lives in the engine, so you call the `World` with the handle. |
| `a.add(b).multiplyScalar(2)` | `a.add(b); a.multiplyScalar(2);` | Methods mutate in place and return nothing, so they do not chain. |
| `new THREE.Euler(x, y, z)` defaults to `'XYZ'` | `world.setRotation(object, x, y, z, 'XYZ')` | There are no default arguments: the order is always written out. |
| Garbage collected | `value.free()`, `world.destroy(object)`, `world.disposeGeometry(g)` | Nothing in the engine is freed by the JavaScript garbage collector. |
| `dispose()` releases GPU copies, object stays usable | `disposeGeometry` / `disposeMaterial` free the resource; its handle is dead afterwards | |
| Numbers are 64-bit | Values are stored as 32-bit floats | Results agree with three.js to about `1e-6` per operation. Keep animated angles small (wrap them) rather than letting them grow for minutes. |
| Synchronous event listeners | `world.drainEvents()` once per frame | Events are queued in order and read when you choose. |

Conventions are the same as three.js: right-handed, +Y up, cameras look down −Z, column-major matrices, radians.

## Step 1: load the module

```js
// before
import * as THREE from 'three';

// after
import { init, World, Vector3, Quaternion, Matrix4, Timer } from 'wamr3d';
await init(); // once, before anything else
```

`init()` fetches the `.wasm` file that sits next to the module (or reads it from disk under Node.js). Pass a URL, `Response`, `ArrayBuffer` or `WebAssembly.Module` to load it from somewhere else. In a browser the page must be served over HTTP.

## Step 2: move the scene graph

```js
// three.js
const scene = new THREE.Scene();
const arm = new THREE.Object3D();
const hand = new THREE.Object3D();
arm.name = 'arm';
scene.add(arm);
arm.add(hand);

arm.position.set(10, 0, 0);
arm.rotation.set(0, 0, Math.PI / 2);
hand.position.set(1, 0, 0);
hand.lookAt(0, 5, 0);

scene.updateMatrixWorld();
const world = hand.matrixWorld.elements;
```

```js
// WAMR3D
const world = new World();
const scene = world.createObject();
const arm = world.createObject();
const hand = world.createObject();
world.setName(arm, 'arm');
world.add(scene, arm);
world.add(arm, hand);

world.setPosition(arm, 10, 0, 0);
world.setRotation(arm, 0, 0, Math.PI / 2, 'XYZ');
world.setPosition(hand, 1, 0, 0);
world.lookAt(hand, 0, 5, 0);

world.updateMatrixWorld(scene, false);
const matrix = world.matrixWorld(hand); // Float32Array(16)
```

A camera is an object with a camera attached:

```js
// three.js
const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
camera.position.set(0, 2, 8);
camera.lookAt(0, 0, 0);
```

```js
// WAMR3D
const camera = world.createObject();
world.setPerspectiveCamera(camera, 50, width / height, 0.1, 2000, false);
world.setPosition(camera, 0, 2, 8);
world.lookAt(camera, 0, 0, 0);
world.updateMatrixWorld(camera, false);

world.projectionMatrix(camera);    // Float32Array(16)
world.matrixWorldInverse(camera);  // the view matrix
```

The last argument of `setPerspectiveCamera` picks the clip-space depth range: `false` for −1..1 (what the three.js WebGL renderer expects), `true` for 0..1 (WebGPU).

Geometry:

```js
// three.js
const geometry = new THREE.BoxGeometry(1, 1, 1);
const custom = new THREE.BufferGeometry();
custom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
custom.setIndex(indices);
custom.computeVertexNormals();
custom.computeBoundingSphere();
```

```js
// WAMR3D
const geometry = world.createBoxGeometry(1, 1, 1, 1, 1, 1);
const custom = world.createGeometry();
world.setAttribute(custom, 'position', positions, 3);   // Float32Array
world.setIndex(custom, indices);                        // Uint32Array
world.computeVertexNormals(custom);
const sphere = world.computeBoundingSphere(custom);     // [cx, cy, cz, radius]
const normals = world.getAttribute(custom, 'normal');   // a copy
```

## Step 3: keep three.js drawing through an adapter

If you need something the WAMR3D renderer does not draw yet (textures, physically based materials, lines), let three.js draw what WAMR3D computed. Turn off three.js's own matrix updates and write the engine's matrices into the meshes.

```js
// one-time setup
threeScene.matrixWorldAutoUpdate = false;
mesh.matrixAutoUpdate = false;
mesh.matrixWorldAutoUpdate = false;
threeCamera.matrixAutoUpdate = false;
threeCamera.matrixWorldAutoUpdate = false;

// every frame
world.updateMatrixWorld(scene, false);
const matrices = world.matricesWorld(handles); // 16 numbers per object, one call

meshes.forEach((mesh, i) => mesh.matrixWorld.fromArray(matrices, i * 16));
threeCamera.matrixWorld.fromArray(world.matrixWorld(camera));
threeCamera.matrixWorldInverse.fromArray(world.matrixWorldInverse(camera));
threeCamera.projectionMatrix.fromArray(world.projectionMatrix(camera));
threeCamera.projectionMatrixInverse.fromArray(world.projectionMatrixInverse(camera));

renderer.render(threeScene, threeCamera);
```

Lights and helpers that never move need one `updateMatrixWorld(true)` after you place them, because automatic updates are off. A complete working version is in [`examples/browser/render-adapter.js`](examples/browser/render-adapter.js).

## Step 4: make the frame loop fast

Every call from JavaScript into WebAssembly has a fixed cost, and a `bigint` handle argument adds to it. A call that does little work is slower than the same line in three.js. A call that does a lot of work is faster. So batch.

```js
// slow: three calls per object per frame
for (let i = 0; i < count; i++) {
  world.setPosition(handles[i], x[i], y[i], z[i]);
  world.setQuaternion(handles[i], qx[i], qy[i], qz[i], qw[i]);
  world.setScale(handles[i], s[i], s[i], s[i]);
}

// fast: one call for all objects
// transforms: Float32Array, 10 numbers per object (position xyz, quaternion xyzw, scale xyz)
world.setTransforms(handles, transforms);
```

| Instead of, per object | Use, once |
|---|---|
| `createObject()` | `createObjects(count)` → `BigUint64Array` |
| `add(parent, child)` | `addMany(parents, children)` |
| `setPosition` + `setQuaternion` + `setScale` | `setTransforms(handles, values)` |
| `setRotation` | `setRotations(handles, angles, order)` |
| `matrixWorld(object)` | `matricesWorld(handles)` |

To write vertex data without copying, use a view over engine memory:

```js
import { attributeView } from 'wamr3d';

const positions = attributeView(world, geometry, 'position'); // Float32Array, no copy
positions[1] += 0.5;
world.markAttributeNeedsUpdate(geometry, 'position');
```

A view stops working when the module's memory grows, which any engine call that allocates can cause. Create it right before you use it; do not keep it across frames.

Measured results for these patterns are in [`STATUS.md`](STATUS.md).

## API mapping

### Math

`Vector2`, `Vector3`, `Vector4`, `Quaternion`, `Euler`, `Matrix3`, `Matrix4`, `Color`, `Box3`, `Sphere`, `Plane`, `Ray` and `Frustum` are classes, created with `new` and released with `.free()`. Method names match three.js; the differences are the ones in the table below plus:

- Methods that take a `target` in three.js return a new value instead (`box.getCenter()`, `ray.at(t)`), and methods that can fail return `undefined` (`ray.intersectBox(box)`).
- `new Euler(x, y, z, order)` always takes the order. `new Color(r, g, b)` takes linear components; use `Color.fromHex(0xff8800)` or `Color.fromStyle('orange')` for sRGB input.
- `MathUtils.degToRad` and the other scalar helpers are available on `MathUtils` and as plain exports.

| three.js | WAMR3D |
|---|---|
| `new Vector3(x, y, z)` | `new Vector3(x, y, z)` (all three arguments required) |
| `v.x`, `v.set`, `v.copy`, `v.clone` | same |
| `v.add`, `v.sub`, `v.multiplyScalar`, `v.dot`, `v.cross`, `v.length`, `v.lengthSq`, `v.normalize`, `v.distanceTo`, `v.lerp` | same, no chaining |
| `v.applyMatrix4`, `v.applyQuaternion`, `v.transformDirection` | same |
| `v.toArray()` | `v.toArray()` → `Float32Array` |
| `new Quaternion()` | `new Quaternion(0, 0, 0, 1)` |
| `q.setFromAxisAngle`, `q.setFromRotationMatrix`, `q.multiply`, `q.premultiply`, `q.slerp`, `q.normalize`, `q.invert`, `q.dot` | same |
| `q.setFromEuler(euler)` | `q.setFromEuler(x, y, z, 'XYZ')` |
| `new Matrix4()` | same (identity) |
| `m.identity`, `m.copy`, `m.clone`, `m.multiply`, `m.premultiply`, `m.multiplyMatrices`, `m.invert`, `m.transpose`, `m.determinant`, `m.compose`, `m.lookAt` | same |
| `m.makeTranslation`, `m.makeScale`, `m.makeRotationX/Y/Z`, `m.makeRotationFromQuaternion` | same |
| `m.elements` | `m.toArray()` / `m.fromArray(array)` |
| `m.decompose(p, q, s)` | `m.decompose()` → 10 numbers: position, quaternion, scale |
| `m.makePerspective(l, r, t, b, n, f, coordinateSystem, reversedDepth)` | `m.makePerspective(l, r, t, b, n, f, webgpu, reversedDepth)` with booleans |
| `new Timer()`, `timer.update(t)`, `getDelta`, `getElapsed`, `setTimescale` | `new Timer(performance.now())`, then the same; pass every timestamp yourself |

### Scene graph (`World`)

| three.js | WAMR3D |
|---|---|
| `new Object3D()`, `new Scene()`, `new Group()` | `world.createObject()` |
| `parent.add(child)`, `parent.remove(child)`, `child.removeFromParent()`, `parent.clear()` | `world.add(parent, child)`, `world.remove(parent, child)`, `world.removeFromParent(child)`, `world.clear(parent)` |
| `parent.attach(child)` | `world.attach(parent, child)` |
| `object.parent`, `object.children` | `world.parent(object)`, `world.children(object)` |
| `object.name`, `scene.getObjectByName(n)` | `world.name(object)` / `world.setName(object, n)`, `world.getObjectByName(root, n)` |
| `object.visible` | `world.isVisible(object)` / `world.setVisible(object, bool)` |
| `object.position.set`, `object.scale.set` | `world.setPosition`, `world.setScale` |
| `object.rotation.set(x, y, z, order)` | `world.setRotation(object, x, y, z, order)` |
| `object.quaternion.set(x, y, z, w)` | `world.setQuaternion(object, x, y, z, w)` |
| read `object.position` / `rotation` / `quaternion` / `scale` | `world.position(object)` etc. → `Float32Array` |
| `object.rotateOnAxis`, `object.translateOnAxis` | `world.rotateOnAxis(object, axis, angle)`, `world.translateOnAxis(object, axis, distance)` |
| `object.lookAt(x, y, z)` | `world.lookAt(object, x, y, z)` |
| `object.updateMatrix()`, `object.updateMatrixWorld(force)` | `world.updateMatrix(object)`, `world.updateMatrixWorld(object, force)` |
| `object.matrix.elements`, `object.matrixWorld.elements` | `world.matrix(object)`, `world.matrixWorld(object)` |
| `object.getWorldPosition(target)` and the other `getWorld*` | `world.getWorldPosition(object)` etc. → `Float32Array` |
| `object.localToWorld(v)`, `object.worldToLocal(v)` | `world.localToWorld(object, x, y, z)`, `world.worldToLocal(object, x, y, z)` |
| drop the last reference | `world.destroy(object)` (children survive as roots) or `world.destroyRecursive(object)` |
| `addEventListener('added' / 'removed' / 'childadded' / 'childremoved' / 'dispose')` | `world.drainEvents()` → triples `[kind, a, b]` |

### Cameras

| three.js | WAMR3D |
|---|---|
| `new PerspectiveCamera(fov, aspect, near, far)` | `world.setPerspectiveCamera(object, fov, aspect, near, far, webgpu)` |
| `new OrthographicCamera(l, r, t, b, near, far)` | `world.setOrthographicCamera(object, l, r, t, b, near, far, webgpu)` |
| `camera.aspect = a; camera.updateProjectionMatrix()` | `world.setCameraAspect(object, a)` |
| `camera.projectionMatrix`, `projectionMatrixInverse`, `matrixWorldInverse` | `world.projectionMatrix(object)`, `world.projectionMatrixInverse(object)`, `world.matrixWorldInverse(object)` |

`world.setCameraZoom`, `world.setCameraViewOffset` and `world.clearCameraViewOffset` cover zoom and view offsets. Film offset and focal length are implemented in the engine but not yet exposed to JavaScript.

### Geometry

| three.js | WAMR3D |
|---|---|
| `new BufferGeometry()` | `world.createGeometry()` |
| `new BoxGeometry(w, h, d, ws, hs, ds)` | `world.createBoxGeometry(w, h, d, ws, hs, ds)` |
| `new PlaneGeometry(w, h, ws, hs)` | `world.createPlaneGeometry(w, h, ws, hs)` |
| `new SphereGeometry(r, ws, hs, phiStart, phiLength, thetaStart, thetaLength)` | `world.createSphereGeometry(...)`, all seven arguments |
| `geometry.setAttribute(name, new BufferAttribute(array, size))` | `world.setAttribute(geometry, name, array, size)` |
| `geometry.setIndex(indices)` | `world.setIndex(geometry, indices)` |
| `geometry.getAttribute(name).array`, `geometry.index.array` | `world.getAttribute(geometry, name)`, `world.getIndex(geometry)` (copies), or `attributeView(...)` (no copy) |
| `attribute.needsUpdate = true` | `world.markAttributeNeedsUpdate(geometry, name)` |
| `geometry.computeVertexNormals()`, `computeTangents()` | `world.computeVertexNormals(geometry)`, `world.computeTangents(geometry)` |
| `geometry.computeBoundingBox()`, `computeBoundingSphere()` | same names on `world`; they return the result |
| `geometry.applyMatrix4(m)` | `world.applyMatrix4ToGeometry(geometry, m)` |
| `geometry.dispose()` | `world.disposeGeometry(geometry)` |
| `new Mesh(geometry, material)` | `world.setRenderable(object, geometry, world.createMaterial(name))`; this records the link, nothing is drawn yet |
| `material.side = DoubleSide` | `world.setMaterialSide(material, 2)` (0 front, 1 back, 2 both) |
| `object.clone(recursive)` | `world.cloneObject(object, recursive)` |
| `object.layers.mask` | `world.layers(object)` / `world.setLayers(object, mask)` |

### Picking

| three.js | WAMR3D |
|---|---|
| `raycaster.setFromCamera(ndc, camera); raycaster.intersectObject(root, true)` | `world.raycastFromCamera(camera, ndc.x, ndc.y, root, true)` |
| `new Raycaster(origin, direction, near, far).intersectObject(root, true)` | `world.raycast(root, true, origin, direction, near, far)` |
| `hits[i].distance`, `.point`, `.object`, `.faceIndex`, `.uv`, `.normal` | `hits.distance(i)`, `hits.point(i)`, `hits.object(i)`, `hits.faceIndex(i)`, `hits.uv(i)`, `hits.normal(i)`; `hits.length` is the count |

Update world matrices before casting. Only meshes are picked; free the result with `hits.free()`.

## Not available yet

Keep using three.js for these:

- **Rendering:** environment maps and every map other than `map`, more than 8 lights, area lights, shadows, tone mapping, render targets, post-processing, lines wider than one pixel, a WebGL fallback.
- **Object API:** every class not listed under [The object API](#the-object-api), including controls and every helper other than `GridHelper` and `AxesHelper`.
- **Objects:** `LineLoop`, `Points`, `Sprite`, `SkinnedMesh`, `LOD`; picking single instances of an `InstancedMesh`.
- **Math from JavaScript:** `Triangle`, `Line3`, `Spherical`, `Cylindrical`. They exist in the Rust crates but have no JavaScript binding.
- **Geometry:** shapes other than box, plane, sphere, cylinder, cone, circle, ring and torus; integer attributes from JavaScript; morph targets; interleaved buffers.
- **Everything else:** loaders, the animation system (`AnimationMixer`, clips, tracks), audio, controls, helpers, random helpers and UUIDs.

## Checklist

1. Build the package and confirm `await init()` works in your app.
2. Create a `World` and mirror your scene graph into it. Keep a table from handle to three.js mesh.
3. Switch off three.js matrix updates for mirrored objects and write WAMR3D's matrices into them each frame.
4. Move per-frame transform code to the batched calls.
5. Compare against your old code path for a few frames, as [`examples/browser/reference-check.js`](examples/browser/reference-check.js) does, before deleting it.
6. Free what you create: `.free()` on math values, `destroy` on objects, `dispose*` on geometries and materials.
