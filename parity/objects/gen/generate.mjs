// Parity fixture generator for cameras, built-in shapes and world-space object methods.
// Same conventions as parity/math/gen/generate.mjs. Writes parity/objects/objects.json.
//
//   node parity/objects/gen/generate.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js';
import { OrthographicCamera } from 'three/src/cameras/OrthographicCamera.js';
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js';
import { PlaneGeometry } from 'three/src/geometries/PlaneGeometry.js';
import { SphereGeometry } from 'three/src/geometries/SphereGeometry.js';
import { CylinderGeometry } from 'three/src/geometries/CylinderGeometry.js';
import { ConeGeometry } from 'three/src/geometries/ConeGeometry.js';
import { CircleGeometry } from 'three/src/geometries/CircleGeometry.js';
import { RingGeometry } from 'three/src/geometries/RingGeometry.js';
import { TorusGeometry } from 'three/src/geometries/TorusGeometry.js';
import { Object3D } from 'three/src/core/Object3D.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Quaternion } from 'three/src/math/Quaternion.js';

const OUT = fileURLToPath( new URL( '../objects.json', import.meta.url ) );
const f = Math.fround;

let seed = 186003;
const random = () => {

	seed = ( seed + 0x6D2B79F5 ) >>> 0;
	let t = seed;
	t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
	t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
	return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

};
const u = ( lo, hi ) => f( lo + random() * ( hi - lo ) );
const ri = ( lo, hi ) => lo + Math.floor( random() * ( hi - lo + 1 ) );

const cases = [];
const add = ( op, input, output ) => cases.push( { op, in: input, out: output } );

// ---- shapes: positions, normals, uvs, indices, groups

function geometryOut( g ) {

	return [
		g.getAttribute( 'position' ).count, ...g.getAttribute( 'position' ).array, ...g.getAttribute( 'normal' ).array, ...g.getAttribute( 'uv' ).array,
		g.index.count, ...g.index.array, g.groups.length, ...g.groups.flatMap( ( x ) => [ x.start, x.count, x.materialIndex ] )
	];

}

for ( let i = 0; i < 8; i ++ ) {

	const box = i === 0 ? [ 1, 1, 1, 1, 1, 1 ] : [ u( 0.2, 4 ), u( 0.2, 4 ), u( 0.2, 4 ), ri( 1, 4 ), ri( 1, 4 ), ri( 1, 4 ) ];
	add( 'box', box, geometryOut( new BoxGeometry( ...box ) ) );

	const plane = i === 0 ? [ 1, 1, 1, 1 ] : [ u( 0.2, 4 ), u( 0.2, 4 ), ri( 1, 5 ), ri( 1, 5 ) ];
	add( 'plane', plane, geometryOut( new PlaneGeometry( ...plane ) ) );

	const full = i < 3;
	const sphere = i === 0 ? [ 1, 32, 16, 0, f( Math.PI * 2 ), 0, f( Math.PI ) ]
		: [ u( 0.2, 3 ), ri( 3, 12 ), ri( 2, 8 ), full ? 0 : u( 0, 3 ), full ? f( Math.PI * 2 ) : u( 0.5, 6 ), full ? 0 : u( 0, 1.5 ), full ? f( Math.PI ) : u( 0.5, 3 ) ];
	add( 'sphere', sphere, geometryOut( new SphereGeometry( ...sphere ) ) );

}

// ---- cameras

for ( let i = 0; i < 16; i ++ ) {

	const p = [ u( 20, 100 ), u( 0.5, 2.5 ), u( 0.05, 1 ), u( 50, 2000 ) ];
	const zoom = i % 2 ? u( 0.5, 3 ) : 1, filmOffset = i % 3 === 0 ? u( - 5, 5 ) : 0;
	const coordinateSystem = i % 4 < 2 ? 0 : 1, reversed = i % 8 >= 4 ? 1 : 0;
	const offset = i % 5 === 0 ? [ 1, u( 800, 2000 ), u( 500, 1200 ), u( 0, 400 ), u( 0, 300 ), u( 100, 800 ), u( 100, 500 ) ] : [ 0, 0, 0, 0, 0, 0, 0 ];
	const distance = u( 1, 20 );

	const camera = new PerspectiveCamera( ...p );
	camera.zoom = zoom;
	camera.filmOffset = filmOffset;
	camera.coordinateSystem = 2000 + coordinateSystem;
	camera._reversedDepth = reversed === 1;
	if ( offset[ 0 ] ) camera.setViewOffset( ...offset.slice( 1 ) );
	camera.updateProjectionMatrix();

	const min = new Vector2(), max = new Vector2();
	camera.getViewBounds( distance, min, max );
	add( 'perspective', [ ...p, zoom, filmOffset, coordinateSystem, reversed, ...offset, distance ], [
		...camera.projectionMatrix.elements, ...camera.projectionMatrixInverse.elements,
		camera.getEffectiveFOV(), camera.getFilmWidth(), camera.getFilmHeight(), camera.getFocalLength(), min.x, min.y, max.x, max.y
	] );

	const o = [ u( - 5, - 0.5 ), u( 0.5, 5 ), u( 0.5, 5 ), u( - 5, - 0.5 ), u( 0.05, 1 ), u( 10, 500 ) ];
	const ortho = new OrthographicCamera( ...o );
	ortho.zoom = zoom;
	ortho.coordinateSystem = 2000 + coordinateSystem;
	ortho._reversedDepth = reversed === 1;
	if ( offset[ 0 ] ) ortho.setViewOffset( ...offset.slice( 1 ) );
	ortho.updateProjectionMatrix();
	add( 'orthographic', [ ...o, zoom, coordinateSystem, reversed, ...offset ], [ ...ortho.projectionMatrix.elements, ...ortho.projectionMatrixInverse.elements ] );

}

// ---- world-space methods on a three-level chain: grandparent -> parent -> object (or camera)

function unitQuaternion() {

	return new Quaternion( u( - 1, 1 ), u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize().toArray().map( f );

}

for ( let i = 0; i < 24; i ++ ) {

	const isCamera = i % 2;
	// uniform scales: lookAt and attach do not support non-uniformly scaled parents
	const levels = [ 0, 1, 2 ].map( () => ( { p: [ u( - 3, 3 ), u( - 3, 3 ), u( - 3, 3 ) ], q: unitQuaternion(), s: i % 3 === 0 ? 1 : u( 0.5, 2 ) } ) );
	const target = [ u( - 5, 5 ), u( - 5, 5 ), u( - 5, 5 ) ], point = [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ) ];

	const build = () => {

		const objects = [ new Object3D(), new Object3D(), isCamera ? new PerspectiveCamera( 50, 1.5, 0.1, 100 ) : new Object3D() ];
		objects.forEach( ( object, k ) => {

			object.position.fromArray( levels[ k ].p );
			object.quaternion.fromArray( levels[ k ].q );
			object.scale.setScalar( levels[ k ].s );
			if ( k > 0 ) objects[ k - 1 ].add( object );

		} );
		return objects;

	};

	const input = [ isCamera, ...levels.flatMap( ( l ) => [ ...l.p, ...l.q, l.s ] ), ...target, ...point ];

	let [ root, , object ] = build();
	const out = [];
	out.push( ...object.getWorldPosition( new Vector3() ).toArray(), ...object.getWorldQuaternion( new Quaternion() ).toArray(), ...object.getWorldScale( new Vector3() ).toArray(), ...object.getWorldDirection( new Vector3() ).toArray() );
	out.push( ...object.localToWorld( new Vector3( ...point ) ).toArray(), ...object.worldToLocal( new Vector3( ...point ) ).toArray() );
	root.updateMatrixWorld();
	out.push( ...object.matrixWorld.elements );
	if ( isCamera ) out.push( ...object.matrixWorldInverse.elements );
	add( 'world', input, out );

	[ root, , object ] = build();
	object.lookAt( ...target );
	root.updateMatrixWorld();
	add( 'lookAt', input, [ ...object.quaternion.toArray(), ...object.matrixWorld.elements ] );

	const [ root2, parent2, object2 ] = build();
	root2.updateMatrixWorld();
	const before = object2.matrixWorld.clone();
	root2.attach( object2 );
	root2.updateMatrixWorld();
	add( 'attach', input, [ ...object2.position.toArray(), ...object2.quaternion.toArray(), ...object2.scale.toArray(), ...object2.matrixWorld.elements, ...before.elements, parent2.children.length, root2.children.length ] );

}

// ---- shapes added later; kept last so the cases above keep their random numbers

for ( let i = 0; i < 8; i ++ ) {

	const full = i < 3, turn = f( Math.PI * 2 );
	const start = () => ( full ? 0 : u( 0, 3 ) ), length = () => ( full ? turn : u( 0.5, 6 ) );

	const cylinder = i === 0 ? [ 1, 1, 1, 32, 1, 0, 0, turn ] : [ i === 4 ? 0 : u( 0.2, 2 ), i === 5 ? 0 : u( 0.2, 2 ), u( 0.5, 4 ), ri( 3, 12 ), ri( 1, 4 ), i % 3 === 2 ? 1 : 0, start(), length() ];
	add( 'cylinder', cylinder, geometryOut( new CylinderGeometry( cylinder[ 0 ], cylinder[ 1 ], cylinder[ 2 ], cylinder[ 3 ], cylinder[ 4 ], cylinder[ 5 ] === 1, cylinder[ 6 ], cylinder[ 7 ] ) ) );

	const cone = i === 0 ? [ 1, 1, 32, 1, 0, 0, turn ] : [ u( 0.2, 2 ), u( 0.5, 4 ), ri( 3, 12 ), ri( 1, 4 ), i % 3 === 2 ? 1 : 0, start(), length() ];
	add( 'cone', cone, geometryOut( new ConeGeometry( cone[ 0 ], cone[ 1 ], cone[ 2 ], cone[ 3 ], cone[ 4 ] === 1, cone[ 5 ], cone[ 6 ] ) ) );

	const circle = i === 0 ? [ 1, 32, 0, turn ] : [ u( 0.2, 3 ), ri( 1, 16 ), start(), length() ];
	add( 'circle', circle, geometryOut( new CircleGeometry( ...circle ) ) );

	const inner = u( 0.1, 1 );
	const ring = i === 0 ? [ 0.5, 1, 32, 1, 0, turn ] : [ inner, f( inner + u( 0.2, 2 ) ), ri( 1, 16 ), ri( 1, 4 ), start(), length() ];
	add( 'ring', ring, geometryOut( new RingGeometry( ...ring ) ) );

	const torus = i === 0 ? [ 1, f( 0.4 ), 12, 48, turn, 0, turn ] : [ u( 0.5, 3 ), u( 0.1, 0.5 ), ri( 3, 10 ), ri( 3, 20 ), length(), start(), length() ];
	add( 'torus', torus, geometryOut( new TorusGeometry( ...torus ) ) );

}

const num = ( x ) => ( Number.isFinite( x ) ? ( Object.is( x, - 0 ) ? '0' : String( x ) ) : JSON.stringify( String( x ) ) );
const meta = { reference: 'three@0.186.1 src (cameras, geometries, core/Object3D)', generator: 'parity/objects/gen/generate.mjs', tolerance: '|got - out| <= 1e-6 * max(1, |out|); 1e-5 for chained world-space methods', cases: cases.length };
const lines = cases.map( ( c ) => `{"op":${JSON.stringify( c.op )},"in":[${c.in.map( num ).join( ',' )}],"out":[${c.out.map( num ).join( ',' )}]}` );
fs.writeFileSync( OUT, `{"meta":${JSON.stringify( meta )},\n"cases":[\n${lines.join( ',\n' )}\n]}\n` );
console.log( `${new Set( cases.map( ( c ) => c.op ) ).size} ops, ${cases.length} cases -> ${OUT}` );
