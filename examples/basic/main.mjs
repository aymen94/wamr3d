// Minimal WAMR3D example. Build the module first (node engine/bindings/build.mjs), then:
//
//   node examples/basic/main.mjs

import { init, version, World, Vector3, Quaternion, Matrix4, Timer, attributeView } from '../../dist/wamr3d/index.js';

await init();
console.log( `WAMR3D ${version()}` );

// ---- math

const axis = new Vector3( 0, 1, 0 );
const quarterTurn = new Quaternion( 0, 0, 0, 1 );
quarterTurn.setFromAxisAngle( axis, Math.PI / 2 );

const model = new Matrix4();
model.compose( new Vector3( 1, 2, 3 ), quarterTurn, new Vector3( 2, 2, 2 ) );

const point = new Vector3( 1, 0, 0 );
point.applyMatrix4( model );
console.log( 'point (1, 0, 0) through translate * rotate * scale:', Array.from( point.toArray(), ( n ) => + n.toFixed( 4 ) ) );

const inverse = model.clone();
inverse.invert();
point.applyMatrix4( inverse );
console.log( 'and back through the inverse:', Array.from( point.toArray(), ( n ) => + n.toFixed( 4 ) ) );

const projection = new Matrix4();
projection.makePerspective( - 1, 1, 1, - 1, 0.1, 100, true, false );
const onNearPlane = new Vector3( 0, 0, - 0.1 );
onNearPlane.applyMatrix4( projection );
console.log( 'depth of a point on the near plane (0..1 clip space):', + onNearPlane.z.toFixed( 6 ) );

// ---- scene graph

const world = new World();
const root = world.createObject();
const arm = world.createObject();
const hand = world.createObject();
world.setName( root, 'root' );
world.setName( hand, 'hand' );
world.add( root, arm );
world.add( arm, hand );

world.setPosition( root, 10, 0, 0 );
world.setRotation( arm, 0, 0, Math.PI / 2, 'XYZ' );
world.setPosition( hand, 1, 0, 0 );
world.updateMatrixWorld( root, false );

const handWorld = world.matrixWorld( hand );
console.log( 'hand world position:', Array.from( handWorld.slice( 12, 15 ), ( n ) => + n.toFixed( 4 ) ) );
console.log( 'found by name:', world.getObjectByName( root, 'hand' ) === hand );
console.log( 'events queued:', world.drainEvents().length / 3 );

// ---- geometry

const quad = world.createGeometry();
world.setAttribute( quad, 'position', new Float32Array( [ 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 ] ), 3 );
world.setIndex( quad, new Uint32Array( [ 0, 1, 2, 0, 2, 3 ] ) );
world.computeVertexNormals( quad );
console.log( 'first vertex normal:', Array.from( world.getAttribute( quad, 'normal' ).slice( 0, 3 ) ) );
console.log( 'bounding sphere (center xyz, radius):', Array.from( world.computeBoundingSphere( quad ), ( n ) => + n.toFixed( 4 ) ) );

// write vertex data in place through a view over engine memory, without copying
const positions = attributeView( world, quad, 'position' );
positions[ 2 ] = 5;
world.markAttributeNeedsUpdate( quad, 'position' );
console.log( 'bounding box after moving one vertex (min xyz, max xyz):', Array.from( world.computeBoundingBox( quad ) ) );

// ---- ownership

const material = world.createMaterial( 'plain' );
world.setRenderable( hand, quad, material );
console.log( 'objects drawing the quad:', world.geometryRefCount( quad ) );
world.destroyRecursive( root );
console.log( 'objects alive after destroying the tree:', world.objectCount(), '| hand handle alive:', world.isAlive( hand ) );
world.disposeGeometry( quad );
world.disposeMaterial( material );

// ---- timing

const timer = new Timer( 0 );
timer.update( 16 );
timer.update( 33 );
console.log( 'frame delta (s):', timer.getDelta(), '| elapsed (s):', timer.getElapsed() );

// Objects created with `new` live in engine memory; free them when done.
for ( const value of [ axis, quarterTurn, model, point, inverse, projection, onNearPlane, timer, world ] ) value.free();
console.log( 'ok' );
