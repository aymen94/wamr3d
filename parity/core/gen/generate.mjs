// Parity fixture generator for Phase 2 (engine/core).
//
// Imports the real three.js modules from the pinned `three` package's src (never build/) and
// writes parity/core/core.json. Same conventions as parity/math/gen/generate.mjs:
// seeded, deterministic, float inputs rounded to f32 before three.js sees them, and
// every expected value produced by three.js.
//
// Run from anywhere:  node parity/core/gen/generate.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Layers } from 'three/src/core/Layers.js';
import { BufferAttribute } from 'three/src/core/BufferAttribute.js';
import { BufferGeometry } from 'three/src/core/BufferGeometry.js';
import { Object3D } from 'three/src/core/Object3D.js';
import { Timer } from 'three/src/core/Timer.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Matrix3 } from 'three/src/math/Matrix3.js';
import { Matrix4 } from 'three/src/math/Matrix4.js';

const OUT = fileURLToPath( new URL( '../core.json', import.meta.url ) );
const f = Math.fround;
const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];
const ARRAY_TYPES = [ Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, Int16Array, Int8Array, Uint8ClampedArray ];

// three.js reports rejected calls (add an object to itself) through console.error
console.error = () => {};

function mulberry32( seed ) {

	let a = seed >>> 0;
	return function () {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

const rng = mulberry32( 186002 );
const u = ( lo, hi ) => f( lo + rng() * ( hi - lo ) );
const ri = ( lo, hi ) => lo + Math.floor( rng() * ( hi - lo + 1 ) );
const floats = ( n, lo, hi ) => Array.from( { length: n }, () => u( lo, hi ) );

function unitVector() {

	return new Vector3( u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize().toArray().map( f );

}

function unitQuaternion() {

	return new Quaternion( u( - 1, 1 ), u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize().toArray().map( f );

}

function trs() {

	return new Matrix4().compose(
		new Vector3( u( - 3, 3 ), u( - 3, 3 ), u( - 3, 3 ) ),
		new Quaternion().fromArray( unitQuaternion() ),
		new Vector3( u( 0.3, 2.5 ), - u( 0.3, 2.5 ), u( 0.3, 2.5 ) )
	).toArray().map( f );

}

const cases = [];
const add = ( op, input, output ) => cases.push( { op, in: input, out: output } );

// ---- Layers: a script of [opcode, layer]; the mask after every step, then two queries

for ( let i = 0; i < 24; i ++ ) {

	const layers = new Layers();
	const script = [], out = [];
	for ( let k = 0; k < 8; k ++ ) {

		const code = ri( 0, 5 ), layer = ri( 0, 40 );
		script.push( code, layer );
		[ () => layers.set( layer ), () => layers.enable( layer ), () => layers.toggle( layer ), () => layers.disable( layer ), () => layers.enableAll(), () => layers.disableAll() ][ code ]();
		out.push( layers.mask >>> 0 );

	}

	const probe = ri( 0, 40 ), other = new Layers();
	other.set( probe );
	out.push( layers.isEnabled( probe ) ? 1 : 0, layers.test( other ) ? 1 : 0 );
	add( 'Layers.script', [ ...script, probe ], out );

}

// ---- BufferAttribute: every typed array kind, raw and normalized, in and out of range

for ( let type = 0; type < ARRAY_TYPES.length; type ++ ) for ( const normalized of [ 0, 1 ] ) for ( let i = 0; i < 6; i ++ ) {

	const range = normalized ? 1.25 : [ 1, 200, 70000, 3e9 ][ i % 4 ];
	const v = [ ...floats( 4, - range, range ), u( - range, range ) ];
	if ( i === 5 ) v[ 0 ] = f( 0.5 ), v[ 1 ] = f( - 0.5 ), v[ 2 ] = f( 1.5 ), v[ 3 ] = f( 2.5 );

	const attribute = new BufferAttribute( new ARRAY_TYPES[ type ]( 8 ), 4, normalized === 1 );
	attribute.setXYZW( 1, v[ 0 ], v[ 1 ], v[ 2 ], v[ 3 ] );
	attribute.setComponent( 0, 2, v[ 4 ] );
	attribute.setX( 0, v[ 0 ] );
	add( 'BufferAttribute.access', [ type, normalized, ...v ], [
		...attribute.array,
		attribute.getX( 1 ), attribute.getY( 1 ), attribute.getZ( 1 ), attribute.getW( 1 ),
		attribute.getComponent( 0, 2 ), attribute.getX( 0 )
	] );

}

for ( let i = 0; i < 10; i ++ ) {

	const n = ri( 1, 5 ), positions = floats( n * 3, - 2, 2 ), m4 = i % 2 ? trs() : floats( 16, - 2, 2 ), m3 = floats( 9, - 2, 2 );
	const attr = () => new BufferAttribute( new Float32Array( positions ), 3 );
	add( 'BufferAttribute.applyMatrix4', [ n, ...positions, ...m4 ], [ ...attr().applyMatrix4( new Matrix4().fromArray( m4 ) ).array ] );
	add( 'BufferAttribute.transformDirection', [ n, ...positions, ...m4 ], [ ...attr().transformDirection( new Matrix4().fromArray( m4 ) ).array ] );
	add( 'BufferAttribute.applyNormalMatrix', [ n, ...positions, ...m3 ], [ ...attr().applyNormalMatrix( new Matrix3().fromArray( m3 ) ).array ] );
	add( 'BufferAttribute.applyMatrix3', [ n, ...positions, ...m3 ], [ ...attr().applyMatrix3( new Matrix3().fromArray( m3 ) ).array ] );

	const uvs = floats( n * 2, - 2, 2 );
	add( 'BufferAttribute.applyMatrix3.uv', [ n, ...uvs, ...m3 ], [ ...new BufferAttribute( new Float32Array( uvs ), 2 ).applyMatrix3( new Matrix3().fromArray( m3 ) ).array ] );

}

// ---- BufferGeometry: [vertexCount, positions, uvs, indexCount, indices]

function randomMesh( indexed ) {

	const triangles = ri( 1, 4 );
	const n = indexed ? ri( 3, 7 ) : triangles * 3;
	const positions = floats( n * 3, - 2, 2 ), uvs = floats( n * 2, 0, 1 );
	const indices = indexed ? Array.from( { length: triangles * 3 }, () => ri( 0, n - 1 ) ) : [];
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( positions ), 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( uvs ), 2 ) );
	if ( indexed ) geometry.setIndex( indices );
	return { input: [ n, ...positions, ...uvs, indices.length, ...indices ], geometry };

}

const box = ( b ) => [ ...b.min.toArray(), ...b.max.toArray() ];
const sphere = ( s ) => [ ...s.center.toArray(), s.radius ];
const array = ( geometry, name ) => [ ...geometry.getAttribute( name ).array ];

for ( let i = 0; i < 16; i ++ ) {

	const indexed = i % 2 === 0;

	let m = randomMesh( indexed );
	m.geometry.computeBoundingBox();
	m.geometry.computeBoundingSphere();
	add( 'BufferGeometry.bounds', m.input, [ ...box( m.geometry.boundingBox ), ...sphere( m.geometry.boundingSphere ) ] );

	m = randomMesh( indexed );
	m.geometry.computeVertexNormals();
	add( 'BufferGeometry.computeVertexNormals', m.input, array( m.geometry, 'normal' ) );

	m = randomMesh( indexed );
	m.geometry.center();
	add( 'BufferGeometry.center', m.input, [ ...array( m.geometry, 'position' ), ...box( m.geometry.boundingBox ) ] );

	m = randomMesh( indexed );
	const matrix = trs();
	m.geometry.computeVertexNormals();
	m.geometry.computeBoundingBox();
	m.geometry.computeBoundingSphere();
	m.geometry.applyMatrix4( new Matrix4().fromArray( matrix ) );
	add( 'BufferGeometry.applyMatrix4', [ ...m.input, ...matrix ], [ ...array( m.geometry, 'position' ), ...array( m.geometry, 'normal' ), ...box( m.geometry.boundingBox ), ...sphere( m.geometry.boundingSphere ) ] );

	if ( indexed ) {

		m = randomMesh( true );
		m.geometry.computeVertexNormals();
		m.geometry.computeTangents();
		add( 'BufferGeometry.computeTangents', m.input, array( m.geometry, 'tangent' ) );

		m = randomMesh( true );
		const flat = m.geometry.toNonIndexed();
		add( 'BufferGeometry.toNonIndexed', m.input, [ ...array( flat, 'position' ), ...array( flat, 'uv' ) ] );

	}

}

for ( const max of [ 0, 255, 65534, 65535, 65536, 100000 ] ) {

	const geometry = new BufferGeometry().setIndex( [ 0, max, 1 ] );
	add( 'BufferGeometry.setIndex', [ max ], [ geometry.index.array instanceof Uint32Array ? 1 : 0, ...geometry.index.array ] );

}

// ---- Object3D local transform: fixed program over random parameters

for ( let i = 0; i < 24; i ++ ) {

	const position = floats( 3, - 3, 3 ), euler = floats( 3, - 3, 3 ), order = ri( 0, 5 ), scale = floats( 3, 0.3, 2.5 );
	const hasPivot = i % 3 === 0 ? 1 : 0, pivot = floats( 3, - 2, 2 );
	const axis1 = unitVector(), angle1 = u( - 3, 3 ), axis2 = unitVector(), distance = u( - 3, 3 );
	const axis3 = unitVector(), angle3 = u( - 3, 3 ), q = unitQuaternion(), matrix = trs();

	const object = new Object3D();
	object.position.fromArray( position );
	object.rotation.set( euler[ 0 ], euler[ 1 ], euler[ 2 ], ORDERS[ order ] );
	object.scale.fromArray( scale );
	if ( hasPivot ) object.pivot = new Vector3().fromArray( pivot );

	const state = () => [ ...object.position.toArray(), ...object.quaternion.toArray(), object.rotation.x, object.rotation.y, object.rotation.z, ...object.scale.toArray() ];
	const out = [ ...state() ];

	object.rotateOnAxis( new Vector3().fromArray( axis1 ), angle1 );
	object.translateOnAxis( new Vector3().fromArray( axis2 ), distance );
	object.rotateOnWorldAxis( new Vector3().fromArray( axis3 ), angle3 );
	object.applyQuaternion( new Quaternion().fromArray( q ) );
	object.updateMatrix();
	out.push( ...state(), ...object.matrix.elements );

	object.applyMatrix4( new Matrix4().fromArray( matrix ) );
	out.push( ...state() );

	add( 'Object3D.transform', [ ...position, ...euler, order, ...scale, hasPivot, ...pivot, ...axis1, angle1, ...axis2, distance, ...axis3, angle3, ...q, ...matrix ], out );

}

// ---- Object3D hierarchy: a script of [opcode, a, b]; the event stream and final parents
// events: [0, object] added, [1, object] removed, [2, parent, child] childadded, [3, parent, child] childremoved

for ( let i = 0; i < 24; i ++ ) {

	const count = ri( 2, 6 );
	const objects = Array.from( { length: count }, () => new Object3D() );
	const events = [];

	objects.forEach( ( object, id ) => {

		object.addEventListener( 'added', () => events.push( 0, id ) );
		object.addEventListener( 'removed', () => events.push( 1, id ) );
		object.addEventListener( 'childadded', ( e ) => events.push( 2, id, objects.indexOf( e.child ) ) );
		object.addEventListener( 'childremoved', ( e ) => events.push( 3, id, objects.indexOf( e.child ) ) );

	} );

	const isAncestor = ( a, b ) => {

		for ( let p = b; p !== null; p = p.parent ) if ( p === a ) return true;
		return false;

	};

	const script = [];
	for ( let k = 0; k < 12; k ++ ) {

		let code = ri( 0, 9 ) < 6 ? 0 : ri( 1, 3 );
		const a = ri( 0, count - 1 ), b = ri( 0, count - 1 );
		// adding an ancestor below its own descendant would create a cycle; three.js allows it,
		// but the fixture stays on well-formed trees (adding an object to itself is kept)
		if ( code === 0 && a !== b && isAncestor( objects[ b ], objects[ a ] ) ) code = 2;
		script.push( code, a, b );
		[ () => objects[ a ].add( objects[ b ] ), () => objects[ a ].remove( objects[ b ] ), () => objects[ a ].removeFromParent(), () => objects[ a ].clear() ][ code ]();

	}

	const parents = objects.map( ( o ) => ( o.parent === null ? - 1 : objects.indexOf( o.parent ) ) );
	const children = objects.flatMap( ( o ) => [ o.children.length, ...o.children.map( ( c ) => objects.indexOf( c ) ) ] );
	add( 'Object3D.hierarchy', [ count, ...script ], [ events.length, ...events, ...parents, ...children ] );

}

// ---- Timer: the start time is injected, since three.js reads performance.now() there

for ( let i = 0; i < 8; i ++ ) {

	const start = ri( 0, 5000 ) + rng(), steps = [], out = [];
	const timer = new Timer();
	timer._startTime = start;
	let now = start;

	for ( let k = 0; k < 6; k ++ ) {

		const timescale = k === 3 ? [ 0.5, 2, 0 ][ i % 3 ] : - 1;
		if ( timescale >= 0 ) timer.setTimescale( timescale );
		now += 4 + rng() * 30;
		steps.push( timescale, now );
		timer.update( now );
		out.push( timer.getDelta(), timer.getElapsed() );

	}

	add( 'Timer.updates', [ start, ...steps ], out );

}

const num = ( x ) => ( Number.isFinite( x ) ? ( Object.is( x, - 0 ) ? '0' : String( x ) ) : JSON.stringify( String( x ) ) );
const meta = { reference: 'three@0.186.1 src/core', generator: 'parity/core/gen/generate.mjs', tolerance: '|got - out| <= 1e-6 * max(1, |out|)', cases: cases.length };
const lines = cases.map( ( c ) => `{"op":${JSON.stringify( c.op )},"in":[${c.in.map( num ).join( ',' )}],"out":[${c.out.map( num ).join( ',' )}]}` );
fs.writeFileSync( OUT, `{"meta":${JSON.stringify( meta )},\n"cases":[\n${lines.join( ',\n' )}\n]}\n` );

const ops = [ ...new Set( cases.map( ( c ) => c.op ) ) ];
console.log( `${ops.length} ops, ${cases.length} cases -> ${OUT}` );
