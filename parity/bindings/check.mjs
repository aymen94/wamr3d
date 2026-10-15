// End-to-end check of the built WebAssembly package against the reference library:
// the same inputs go through the public JavaScript API of dist/wamr3d and through
// three.js, and the results must agree.
//
// This check needs the reference: `npm install` at the repository root fetches the
// pinned `three` package. parity/bindings/compat-check.mjs covers the object API against
// stored values without it.
//
//   node engine/bindings/build.mjs && node parity/bindings/check.mjs

import * as W from '../../dist/wamr3d/index.js';
import { init, World, Vector3, Quaternion, Matrix4, attributeView } from '../../dist/wamr3d/index.js';
import * as T from 'three/src/Three.Core.js';

await init();

const TOLERANCE = 1e-5; // chained f32 operations; single operations are covered at 1e-6 by the Rust parity tests
let seed = 20261013;
const random = () => {

	seed = ( seed + 0x6D2B79F5 ) >>> 0;
	let t = seed;
	t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
	t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
	return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

};
const u = ( lo, hi ) => Math.fround( lo + random() * ( hi - lo ) );

let checks = 0, worst = 0;
const failures = [];

function compare( label, got, expected ) {

	if ( got.length !== expected.length ) return failures.push( `${label}: length ${got.length} vs ${expected.length}` );
	for ( let i = 0; i < got.length; i ++ ) {

		const error = Math.abs( got[ i ] - expected[ i ] ) / Math.max( 1, Math.abs( expected[ i ] ) );
		checks ++;
		worst = Math.max( worst, error );
		if ( ! ( error <= TOLERANCE ) ) return failures.push( `${label}[${i}]: got ${got[ i ]}, expected ${expected[ i ]}` );

	}

}

function unitQuaternion() {

	return new T.Quaternion( u( - 1, 1 ), u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize().toArray().map( Math.fround );

}

// ---- math

for ( let i = 0; i < 200; i ++ ) {

	const p = [ u( - 3, 3 ), u( - 3, 3 ), u( - 3, 3 ) ], q = unitQuaternion(), s = [ u( 0.5, 2 ), u( 0.5, 2 ), u( 0.5, 2 ) ];
	const q2 = unitQuaternion(), v = [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ) ], t = u( 0, 1 );

	const a3 = new T.Matrix4().compose( new T.Vector3( ...p ), new T.Quaternion( ...q ), new T.Vector3( ...s ) );
	const b3 = new T.Matrix4().makeRotationFromQuaternion( new T.Quaternion( ...q2 ) );
	const product3 = new T.Matrix4().multiplyMatrices( a3, b3 );

	const wp = new Vector3( ...p ), wq = new Quaternion( ...q ), ws = new Vector3( ...s ), wq2 = new Quaternion( ...q2 ), wv = new Vector3( ...v );
	const a = new Matrix4(), b = new Matrix4(), product = new Matrix4();
	a.compose( wp, wq, ws );
	b.makeRotationFromQuaternion( wq2 );
	product.multiplyMatrices( a, b );

	compare( 'compose', a.toArray(), a3.elements );
	compare( 'multiplyMatrices', product.toArray(), product3.elements );
	compare( 'determinant', [ product.determinant() ], [ product3.determinant() ] );

	product.invert();
	compare( 'invert', product.toArray(), product3.clone().invert().elements );

	wv.applyMatrix4( a );
	compare( 'applyMatrix4', wv.toArray(), new T.Vector3( ...v ).applyMatrix4( a3 ).toArray() );

	wq.slerp( wq2, t );
	compare( 'slerp', wq.toArray(), new T.Quaternion( ...q ).slerp( new T.Quaternion( ...q2 ), t ).toArray() );

	const d3 = { p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3() };
	a3.decompose( d3.p, d3.q, d3.s );
	compare( 'decompose', a.decompose(), [ ...d3.p.toArray(), ...d3.q.toArray(), ...d3.s.toArray() ] );

	for ( const value of [ wp, wq, ws, wq2, wv, a, b, product ] ) value.free();

}

// ---- scene graph: 600 objects, random tree, world matrices and event order

{

	const COUNT = 600;
	const world = new World();
	const handles = world.createObjects( COUNT );
	const objects = Array.from( { length: COUNT }, () => new T.Object3D() );
	const events3 = [];

	objects.forEach( ( object, i ) => {

		object.addEventListener( 'added', () => events3.push( 0n, handles[ i ], 0n ) );
		object.addEventListener( 'childadded', ( e ) => events3.push( 2n, handles[ i ], handles[ objects.indexOf( e.child ) ] ) );

	} );

	for ( let i = 1; i < COUNT; i ++ ) {

		const parent = Math.floor( random() * i );
		objects[ parent ].add( objects[ i ] );
		world.add( handles[ parent ], handles[ i ] );

	}

	compare( 'events', Array.from( world.drainEvents(), Number ), events3.map( Number ) );

	for ( let i = 0; i < COUNT; i ++ ) {

		const p = [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ) ], e = [ u( - 3, 3 ), u( - 3, 3 ), u( - 3, 3 ) ], s = [ u( 0.8, 1.25 ), u( 0.8, 1.25 ), u( 0.8, 1.25 ) ];
		objects[ i ].position.set( ...p );
		objects[ i ].rotation.set( ...e, 'YXZ' );
		objects[ i ].scale.set( ...s );
		world.setPosition( handles[ i ], ...p );
		world.setRotation( handles[ i ], ...e, 'YXZ' );
		world.setScale( handles[ i ], ...s );

	}

	objects[ 0 ].updateMatrixWorld();
	world.updateMatrixWorld( handles[ 0 ], false );

	const all = world.matricesWorld( handles );
	for ( let i = 0; i < COUNT; i ++ ) {

		compare( `matrixWorld ${i}`, all.subarray( i * 16, i * 16 + 16 ), objects[ i ].matrixWorld.elements );

	}

	compare( 'quaternion', world.quaternion( handles[ 7 ] ), objects[ 7 ].quaternion.toArray() );
	compare( 'children', Array.from( world.children( handles[ 0 ] ), Number ), objects[ 0 ].children.map( ( c ) => Number( handles[ objects.indexOf( c ) ] ) ) );

	world.destroyRecursive( handles[ 0 ] );
	compare( 'objectCount after destroy', [ world.objectCount() ], [ 0 ] );
	world.free();

}

// ---- geometry: a displaced grid

{

	const N = 24, positions = [], indices = [];
	for ( let y = 0; y <= N; y ++ ) for ( let x = 0; x <= N; x ++ ) positions.push( Math.fround( x / N ), Math.fround( y / N ), u( - 0.2, 0.2 ) );
	for ( let y = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++ ) {

		const i = y * ( N + 1 ) + x;
		indices.push( i, i + 1, i + N + 2, i, i + N + 2, i + N + 1 );

	}

	const geometry3 = new T.BufferGeometry();
	geometry3.setAttribute( 'position', new T.BufferAttribute( new Float32Array( positions ), 3 ) );
	geometry3.setIndex( indices );
	geometry3.computeVertexNormals();
	geometry3.computeBoundingBox();
	geometry3.computeBoundingSphere();

	const world = new World();
	const geometry = world.createGeometry();
	world.setAttribute( geometry, 'position', new Float32Array( positions ), 3 );
	world.setIndex( geometry, new Uint32Array( indices ) );
	world.computeVertexNormals( geometry );

	compare( 'normals', world.getAttribute( geometry, 'normal' ), geometry3.getAttribute( 'normal' ).array );
	compare( 'normals (view)', attributeView( world, geometry, 'normal' ), geometry3.getAttribute( 'normal' ).array );
	compare( 'boundingBox', world.computeBoundingBox( geometry ), [ ...geometry3.boundingBox.min.toArray(), ...geometry3.boundingBox.max.toArray() ] );
	compare( 'boundingSphere', world.computeBoundingSphere( geometry ), [ ...geometry3.boundingSphere.center.toArray(), geometry3.boundingSphere.radius ] );

	const matrix3 = new T.Matrix4().makeRotationX( Math.fround( 0.7 ) ).setPosition( 1, 2, 3 );
	const matrix = new Matrix4();
	matrix.fromArray( new Float32Array( matrix3.elements ) );
	geometry3.applyMatrix4( new T.Matrix4().fromArray( matrix.toArray() ) );
	world.applyMatrix4ToGeometry( geometry, matrix );
	compare( 'applyMatrix4 positions', world.getAttribute( geometry, 'position' ), geometry3.getAttribute( 'position' ).array );
	compare( 'applyMatrix4 normals', world.getAttribute( geometry, 'normal' ), geometry3.getAttribute( 'normal' ).array );

	matrix.free();
	world.free();

}

// ---- built-in shapes, cameras, lookAt and attach

{

	const world = new World();
	const shapes = [
		[ world.createBoxGeometry( 1.5, 2, 0.5, 2, 3, 1 ), new T.BoxGeometry( 1.5, 2, 0.5, 2, 3, 1 ) ],
		[ world.createPlaneGeometry( 3, 2, 4, 2 ), new T.PlaneGeometry( 3, 2, 4, 2 ) ],
		[ world.createSphereGeometry( 1.25, 12, 6, 0, Math.fround( Math.PI * 2 ), 0, Math.fround( Math.PI ) ), new T.SphereGeometry( 1.25, 12, 6, 0, Math.fround( Math.PI * 2 ), 0, Math.fround( Math.PI ) ) ]
	];
	for ( const [ handle, expected ] of shapes ) {

		for ( const name of [ 'position', 'normal', 'uv' ] ) compare( `shape ${name}`, world.getAttribute( handle, name ), expected.getAttribute( name ).array );
		compare( 'shape index', world.getIndex( handle ), expected.index.array );

	}

	const rig3 = new T.Object3D(), camera3 = new T.PerspectiveCamera( 60, 1.6, 0.1, 500 ), box3 = new T.Object3D();
	rig3.position.set( 1, 2, 3 );
	rig3.rotation.set( 0.2, 0.9, - 0.1, 'XYZ' );
	camera3.position.set( 0, 1, 8 );
	box3.position.set( - 4, 0.5, 2 );
	rig3.add( camera3 );
	camera3.lookAt( - 4, 0.5, 2 );
	box3.lookAt( 1, 5, 1 );
	rig3.attach( box3 );
	rig3.updateMatrixWorld();

	const [ rig, camera, box ] = world.createObjects( 3 );
	world.setPosition( rig, 1, 2, 3 );
	world.setRotation( rig, 0.2, 0.9, - 0.1, 'XYZ' );
	world.setPosition( camera, 0, 1, 8 );
	world.setPosition( box, - 4, 0.5, 2 );
	world.add( rig, camera );
	world.setPerspectiveCamera( camera, 60, 1.6, 0.1, 500, false );
	world.lookAt( camera, - 4, 0.5, 2 );
	world.lookAt( box, 1, 5, 1 );
	world.attach( rig, box );
	world.updateMatrixWorld( rig, false );

	compare( 'camera projection', world.projectionMatrix( camera ), camera3.projectionMatrix.elements );
	compare( 'camera view', world.matrixWorldInverse( camera ), camera3.matrixWorldInverse.elements );
	compare( 'camera world', world.matrixWorld( camera ), camera3.matrixWorld.elements );
	compare( 'attached world', world.matrixWorld( box ), box3.matrixWorld.elements );
	compare( 'world direction', world.getWorldDirection( camera ), camera3.getWorldDirection( new T.Vector3() ).toArray() );
	compare( 'world position', world.getWorldPosition( box ), box3.getWorldPosition( new T.Vector3() ).toArray() );
	compare( 'localToWorld', world.localToWorld( box, 1, 2, 3 ), box3.localToWorld( new T.Vector3( 1, 2, 3 ) ).toArray() );
	world.free();

}

// ---- the remaining math classes

for ( let i = 0; i < 60; i ++ ) {

	const a = [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ) ], b = [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ), u( 0.5, 2 ) ];
	const angles = [ u( - 3, 3 ), u( - 1.4, 1.4 ), u( - 3, 3 ) ], order = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ][ i % 6 ], t = u( 0, 1 );
	const m3 = Array.from( { length: 9 }, () => u( - 2, 2 ) );

	const v2 = new W.Vector2( a[ 0 ], a[ 1 ] ), w2 = new W.Vector2( b[ 0 ], b[ 1 ] ), matrix3 = new W.Matrix3();
	matrix3.fromArray( new Float32Array( m3 ) );
	const tv2 = new T.Vector2( a[ 0 ], a[ 1 ] ), tw2 = new T.Vector2( b[ 0 ], b[ 1 ] ), tm3 = new T.Matrix3().fromArray( m3 );
	compare( 'Vector2 scalars', [ v2.dot( w2 ), v2.cross( w2 ), v2.angleTo( w2 ), v2.distanceTo( w2 ), v2.angle() ], [ tv2.dot( tw2 ), tv2.cross( tw2 ), tv2.angleTo( tw2 ), tv2.distanceTo( tw2 ), tv2.angle() ] );
	v2.rotateAround( w2, t );
	v2.applyMatrix3( matrix3 );
	v2.lerp( w2, t );
	compare( 'Vector2 chain', v2.toArray(), tv2.rotateAround( tw2, t ).applyMatrix3( tm3 ).lerp( tw2, t ).toArray() );

	const v4 = new W.Vector4( ...a ), tv4 = new T.Vector4( ...a );
	v4.addScaledVector( new W.Vector4( ...b ), t );
	v4.normalize();
	compare( 'Vector4', v4.toArray(), tv4.addScaledVector( new T.Vector4( ...b ), t ).normalize().toArray() );

	const euler = new W.Euler( ...angles, order ), teuler = new T.Euler( ...angles, order );
	const q = new Quaternion( 0, 0, 0, 1 ), rotation = new Matrix4();
	q.setFromEuler( ...angles, order );
	rotation.makeRotationFromEuler( euler );
	const trotation = new T.Matrix4().makeRotationFromEuler( teuler );
	compare( 'makeRotationFromEuler', rotation.toArray(), trotation.elements );
	euler.reorder( 'ZYX' );
	teuler.reorder( 'ZYX' );
	compare( 'Euler.reorder', euler.toArray(), [ teuler.x, teuler.y, teuler.z ] );
	const back = new W.Euler( 0, 0, 0, 'XYZ' );
	back.setFromRotationMatrix( rotation, order );
	const tback = new T.Euler().setFromRotationMatrix( new T.Matrix4().fromArray( rotation.toArray() ), order );
	compare( 'Euler.setFromRotationMatrix', back.toArray(), [ tback.x, tback.y, tback.z ] );

	const v3 = new Vector3( a[ 0 ], a[ 1 ], a[ 2 ] ), w3 = new Vector3( b[ 0 ], b[ 1 ], b[ 2 ] );
	const tv3 = new T.Vector3( a[ 0 ], a[ 1 ], a[ 2 ] ), tw3 = new T.Vector3( b[ 0 ], b[ 1 ], b[ 2 ] );
	v3.applyEuler( euler );
	v3.projectOnPlane( w3 );
	v3.applyMatrix3( matrix3 );
	compare( 'Vector3 chain', v3.toArray(), tv3.applyEuler( teuler ).projectOnPlane( tw3 ).applyMatrix3( tm3 ).toArray() );

	matrix3.invert();
	compare( 'Matrix3.invert', matrix3.toArray(), tm3.clone().invert().elements );
	const normalMatrix = new W.Matrix3();
	normalMatrix.getNormalMatrix( rotation );
	compare( 'getNormalMatrix', normalMatrix.toArray(), new T.Matrix3().getNormalMatrix( trotation ).elements );

	const color = new W.Color( Math.abs( a[ 0 ] ) / 2, Math.abs( a[ 1 ] ) / 2, Math.abs( a[ 2 ] ) / 2 );
	const tcolor = new T.Color( Math.fround( Math.abs( a[ 0 ] ) / 2 ), Math.fround( Math.abs( a[ 1 ] ) / 2 ), Math.fround( Math.abs( a[ 2 ] ) / 2 ) );
	compare( 'Color.getHex', [ color.getHex() ], [ tcolor.getHex() ] );
	compare( 'Color.getHSL', color.getHSL(), Object.values( tcolor.getHSL( {} ) ) );
	color.offsetHSL( 0.1, - 0.1, 0.05 );
	compare( 'Color.offsetHSL', color.toArray(), tcolor.offsetHSL( 0.1, - 0.1, 0.05 ).toArray() );
	const styled = W.Color.fromStyle( 'hsl(200, 60%, 40%)' );
	compare( 'Color.fromStyle', styled.toArray(), new T.Color( 'hsl(200, 60%, 40%)' ).toArray() );

	const box = new W.Box3(), tbox = new T.Box3();
	const cloud = new Float32Array( Array.from( { length: 18 }, () => u( - 2, 2 ) ) );
	box.setFromArray( cloud );
	tbox.setFromArray( cloud );
	const sphere = box.getBoundingSphere(), tsphere = tbox.getBoundingSphere( new T.Sphere() );
	compare( 'Box3', [ ...box.min.toArray(), ...box.max.toArray(), ...box.getCenter().toArray(), sphere.radius ], [ ...tbox.min.toArray(), ...tbox.max.toArray(), ...tbox.getCenter( new T.Vector3() ).toArray(), tsphere.radius ] );
	box.applyMatrix4( rotation );
	tbox.applyMatrix4( trotation );
	compare( 'Box3.applyMatrix4', [ ...box.min.toArray(), ...box.max.toArray() ], [ ...tbox.min.toArray(), ...tbox.max.toArray() ] );

	const plane = new W.Plane( new Vector3( 0, 1, 0 ), 0 ), tplane = new T.Plane();
	plane.setFromCoplanarPoints( new Vector3( ...cloud.slice( 0, 3 ) ), new Vector3( ...cloud.slice( 3, 6 ) ), new Vector3( ...cloud.slice( 6, 9 ) ) );
	tplane.setFromCoplanarPoints( new T.Vector3( ...cloud.slice( 0, 3 ) ), new T.Vector3( ...cloud.slice( 3, 6 ) ), new T.Vector3( ...cloud.slice( 6, 9 ) ) );
	compare( 'Plane', [ ...plane.normal.toArray(), plane.constant, plane.distanceToPoint( w3 ) ], [ ...tplane.normal.toArray(), tplane.constant, tplane.distanceToPoint( tw3 ) ] );

	const direction = new T.Vector3( b[ 0 ], b[ 1 ], b[ 2 ] ).normalize().toArray().map( Math.fround );
	const ray = new W.Ray( new Vector3( a[ 0 ], a[ 1 ], a[ 2 ] ), new Vector3( ...direction ) );
	const tray = new T.Ray( new T.Vector3( a[ 0 ], a[ 1 ], a[ 2 ] ), new T.Vector3( ...direction ) );
	const hitBox = ray.intersectBox( box ), thitBox = tray.intersectBox( tbox, new T.Vector3() );
	compare( 'Ray.intersectBox', hitBox ? hitBox.toArray() : [], thitBox ? thitBox.toArray() : [] );
	const planeDistance = ray.distanceToPlane( plane ), tplaneDistance = tray.distanceToPlane( tplane );
	compare( 'Ray.distanceToPlane', planeDistance === undefined ? [] : [ planeDistance ], tplaneDistance === null ? [] : [ tplaneDistance ] );
	compare( 'Ray.intersectsSphere', [ ray.intersectsSphere( sphere ) ? 1 : 0 ], [ tray.intersectsSphere( tsphere ) ? 1 : 0 ] );

	const projection = new Matrix4();
	projection.makePerspective( - 1, 1, 1, - 1, 0.5, 50, false, false );
	const frustum = new W.Frustum(), tfrustum = new T.Frustum().setFromProjectionMatrix( new T.Matrix4().fromArray( projection.toArray() ) );
	frustum.setFromProjectionMatrix( projection, false, false );
	compare( 'Frustum', [ frustum.containsPoint( w3 ) ? 1 : 0, frustum.intersectsBox( box ) ? 1 : 0, frustum.intersectsSphere( sphere ) ? 1 : 0 ], [ tfrustum.containsPoint( tw3 ) ? 1 : 0, tfrustum.intersectsBox( tbox ) ? 1 : 0, tfrustum.intersectsSphere( tsphere ) ? 1 : 0 ] );

	compare( 'MathUtils', [ W.MathUtils.degToRad( a[ 0 ] ), W.MathUtils.smoothstep( t, 0, 1 ), W.MathUtils.pingpong( a[ 1 ], 1 ), W.euclideanModulo( a[ 2 ], 1.5 ), W.MathUtils.seededRandom( i ) ],
		[ T.MathUtils.degToRad( a[ 0 ] ), T.MathUtils.smoothstep( t, 0, 1 ), T.MathUtils.pingpong( a[ 1 ], 1 ), T.MathUtils.euclideanModulo( a[ 2 ], 1.5 ), T.MathUtils.seededRandom( i ) ] );

}

// ---- picking and cloning

{

	const world = new World();
	const [ root, boxObject, ballObject, camera ] = world.createObjects( 4 );
	world.add( root, boxObject );
	world.add( boxObject, ballObject );
	world.setPosition( boxObject, 0.4, - 0.2, - 6 );
	world.setRotation( boxObject, 0.5, 0.8, 0.2, 'XYZ' );
	world.setScale( boxObject, 1.5, 1, 2 );
	world.setPosition( ballObject, 0.3, 1.4, 0.2 );
	world.setPosition( camera, 0.5, 1, 4 );
	world.setPerspectiveCamera( camera, 55, 1.4, 0.1, 100, false );
	world.lookAt( camera, 0.4, 0, - 6 );

	const front = world.createMaterial( 'front' ), both = world.createMaterial( 'both' );
	world.setMaterialSide( both, 2 );
	world.setRenderable( boxObject, world.createBoxGeometry( 2, 2, 2, 2, 2, 2 ), front );
	world.setRenderable( ballObject, world.createSphereGeometry( 0.9, 16, 10, 0, Math.fround( Math.PI * 2 ), 0, Math.fround( Math.PI ) ), both );
	world.updateMatrixWorld( root, false );
	world.updateMatrixWorld( camera, false );

	const root3 = new T.Object3D();
	const box3 = new T.Mesh( new T.BoxGeometry( 2, 2, 2, 2, 2, 2 ), new T.MeshBasicMaterial() );
	const ball3 = new T.Mesh( new T.SphereGeometry( 0.9, 16, 10, 0, Math.fround( Math.PI * 2 ), 0, Math.fround( Math.PI ) ), new T.MeshBasicMaterial( { side: T.DoubleSide } ) );
	const camera3 = new T.PerspectiveCamera( 55, 1.4, 0.1, 100 );
	root3.add( box3 );
	box3.add( ball3 );
	box3.position.set( 0.4, - 0.2, - 6 );
	box3.rotation.set( 0.5, 0.8, 0.2, 'XYZ' );
	box3.scale.set( 1.5, 1, 2 );
	ball3.position.set( 0.3, 1.4, 0.2 );
	camera3.position.set( 0.5, 1, 4 );
	camera3.lookAt( 0.4, 0, - 6 );
	root3.updateMatrixWorld();
	camera3.updateMatrixWorld();

	const raycaster = new T.Raycaster();
	const names = new Map( [ [ box3, boxObject ], [ ball3, ballObject ] ] );
	let totalHits = 0;

	for ( let i = 0; i < 80; i ++ ) {

		const x = u( - 0.3, 0.3 ), y = u( - 0.35, 0.35 );
		raycaster.setFromCamera( new T.Vector2( x, y ), camera3 );
		const expected = raycaster.intersectObject( root3, true );
		const hits = world.raycastFromCamera( camera, x, y, root, true );

		compare( `raycast ${i} count`, [ hits.length ], [ expected.length ] );
		if ( hits.length !== expected.length ) continue;
		totalHits += hits.length;

		expected.forEach( ( e, k ) => {

			compare( `raycast ${i} hit ${k}`,
				[ Number( hits.object( k ) ), hits.distance( k ), ...hits.point( k ), hits.faceIndex( k ), ...hits.faceVertices( k ), ...hits.faceNormal( k ), ...hits.uv( k ), ...hits.normal( k ), ...hits.barycoord( k ) ],
				[ Number( names.get( e.object ) ), e.distance, ...e.point.toArray(), e.faceIndex, e.face.a, e.face.b, e.face.c, ...e.face.normal.toArray(), ...e.uv.toArray(), ...e.normal.toArray(), ...e.barycoord.toArray() ] );

		} );

	}

	compare( 'raycast produced hits', [ totalHits > 40 ? 1 : 0 ], [ 1 ] );

	const copy = world.cloneObject( root, true );
	world.updateMatrixWorld( copy, false );
	const copy3 = root3.clone( true );
	copy3.updateMatrixWorld();
	const copiedBall = world.children( world.children( copy )[ 0 ] )[ 0 ];
	compare( 'clone world matrix', world.matrixWorld( copiedBall ), copy3.children[ 0 ].children[ 0 ].matrixWorld.elements );
	compare( 'clone is separate', [ copiedBall === ballObject ? 1 : 0, world.objectCount() ], [ 0, 7 ] );
	world.free();

}

console.log( `${checks} values compared, largest scaled error ${worst.toExponential( 3 )} (tolerance ${TOLERANCE})` );

if ( failures.length > 0 ) {

	console.error( `FAILED: ${failures.length} mismatches\n` + failures.slice( 0, 10 ).join( '\n' ) );
	process.exit( 1 );

}

console.log( 'ok' );
