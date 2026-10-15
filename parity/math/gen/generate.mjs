// Parity fixture generator for Phase 1 (engine/math).
//
// Imports the real three.js math modules straight from the pinned `three` package's src/math
// (never build/) and writes deterministic JSON fixtures to parity/math/<Type>.json.
// Expected values are always computed by three.js; nothing here is hand-written.
//
// Run from anywhere:  node parity/math/gen/generate.mjs
//
// Fixture format (see parity/math/README.md):
//   { "meta": {...}, "cases": [ { "op": "Vector3.applyMatrix4", "in": [...], "out": [...] }, ... ] }
// "in" and "out" are flat number arrays. Non-finite numbers are the strings
// "Infinity", "-Infinity", "NaN". Float inputs are rounded to f32 (Math.fround) BEFORE
// three.js sees them, so the reference and the f32 engine start from identical inputs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as MU from 'three/src/math/MathUtils.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Vector4 } from 'three/src/math/Vector4.js';
import { Matrix3 } from 'three/src/math/Matrix3.js';
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Euler } from 'three/src/math/Euler.js';
import { Color } from 'three/src/math/Color.js';
import { ColorManagement, SRGBToLinear, LinearToSRGB } from 'three/src/math/ColorManagement.js';
import { Box3 } from 'three/src/math/Box3.js';
import { Sphere } from 'three/src/math/Sphere.js';
import { Plane } from 'three/src/math/Plane.js';
import { Ray } from 'three/src/math/Ray.js';
import { Frustum } from 'three/src/math/Frustum.js';
import { Triangle } from 'three/src/math/Triangle.js';
import { Line3 } from 'three/src/math/Line3.js';
import { Spherical } from 'three/src/math/Spherical.js';
import { Cylindrical } from 'three/src/math/Cylindrical.js';

const OUT_DIR = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const RANDOM_CASES = 8;
const PI = Math.PI;
const f = Math.fround;

// Index encodings shared with engine/math/tests/parity.rs.
const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];
const PROPER_ORDERS = [ 'XYX', 'YZY', 'ZXZ', 'XZX', 'YXY', 'ZYZ' ];
const COLOR_SPACES = [ '', 'srgb', 'srgb-linear' ];
const COORD_SYSTEMS = [ 2000, 2001 ]; // WebGLCoordinateSystem, WebGPUCoordinateSystem
const ARRAY_TYPES = [ Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, Int16Array, Int8Array, Uint8ClampedArray ];

// ---------------------------------------------------------------- seeded RNG

function fnv1a( str ) {

	let h = 0x811c9dc5;
	for ( let i = 0; i < str.length; i ++ ) {

		h ^= str.charCodeAt( i );
		h = Math.imul( h, 0x01000193 );

	}

	return h >>> 0;

}

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

const u = ( r, lo, hi ) => lo + r() * ( hi - lo );
const ri = ( r, lo, hi ) => lo + Math.floor( r() * ( hi - lo + 1 ) );
const nz = ( r, lo, hi ) => ( r() < 0.5 ? - 1 : 1 ) * u( r, lo, hi );
const vecN = ( n, lo, hi ) => ( r ) => Array.from( { length: n }, () => u( r, lo, hi ) );

function unit3( r ) {

	const v = new Vector3( u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ) );
	if ( v.lengthSq() < 1e-4 ) v.set( 1, 0, 0 );
	return v.normalize().toArray();

}

function unitQ( r ) {

	const q = new Quaternion( u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ) );
	if ( q.lengthSq() < 1e-4 ) q.set( 0, 0, 0, 1 );
	return q.normalize().toArray();

}

function trs( r ) {

	const p = new Vector3( u( r, - 3, 3 ), u( r, - 3, 3 ), u( r, - 3, 3 ) );
	const q = new Quaternion().fromArray( unitQ( r ) );
	const s = new Vector3( nz( r, 0.3, 2.5 ), nz( r, 0.3, 2.5 ), nz( r, 0.3, 2.5 ) );
	return new Matrix4().compose( p, q, s ).toArray();

}

// ------------------------------------------------------------- edge samples

const AXES = [ [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ] ];
const RIGHT_ANGLES = [ PI / 2, PI, 3 * PI / 2 ]; // 90, 180, 270 degrees

const axisQuats = [];
for ( const a of AXES ) for ( const ang of RIGHT_ANGLES ) {

	axisQuats.push( new Quaternion().setFromAxisAngle( new Vector3( ...a ), ang ).toArray() );

}

// Euler edge cases: zero, 90/180/270 about each axis, then gimbal lock (+-90 degrees on
// each axis in turn, so every order hits its singular branch) crossed with all six orders,
// plus near-gimbal angles that must stay on the regular branch.
const eulerEdges = [ [ 0, 0, 0, 0 ] ];
{

	let k = 1;
	for ( let axis = 0; axis < 3; axis ++ ) for ( const ang of RIGHT_ANGLES ) {

		const e = [ 0, 0, 0, k ++ % 6 ];
		e[ axis ] = ang;
		eulerEdges.push( e );

	}

	const gimbal = [
		[ 0.3, PI / 2, - 0.7 ], [ 0.3, - PI / 2, 0.4 ],
		[ PI / 2, 0.2, 0.5 ], [ - PI / 2, - 0.6, 0.1 ],
		[ 0.4, 0.6, PI / 2 ], [ - 0.2, 0.9, - PI / 2 ]
	];
	for ( let o = 0; o < 6; o ++ ) for ( const g of gimbal ) eulerEdges.push( [ ...g, o ] );

	const nearGimbal = [ [ 0.3, PI / 2 - 0.001, - 0.7 ], [ PI / 2 - 0.001, 0.2, 0.5 ], [ 0.4, 0.6, - PI / 2 + 0.001 ] ];
	for ( let o = 0; o < 6; o ++ ) eulerEdges.push( [ ...nearGimbal[ o % 3 ], o ] );

}

const eulerOf = ( a ) => new Euler( f( a[ 0 ] ), f( a[ 1 ] ), f( a[ 2 ] ), ORDERS[ a[ 3 ] ] );
const rotationEdges = [ new Matrix4().toArray() ];
for ( const e of eulerEdges.slice( 1 ) ) rotationEdges.push( new Matrix4().makeRotationFromEuler( eulerOf( e ) ).toArray() );

const SINGULAR4 = [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 ];
const m4Edges = [
	new Matrix4().toArray(),
	new Array( 16 ).fill( 0 ),
	SINGULAR4,
	[ 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ], // two identical columns
	new Matrix4().makeTranslation( 1, - 2, 3 ).toArray(),
	new Matrix4().makeScale( 2, 3, 4 ).toArray(),
	new Matrix4().makeScale( - 1, 1, 1 ).toArray(), // mirror, negative determinant
	new Matrix4().makeScale( 1, 0, 1 ).toArray(), // zero scale on one axis
	new Matrix4().makeRotationX( f( PI / 2 ) ).toArray(),
	new Matrix4().makeRotationY( f( PI ) ).toArray(),
	new Matrix4().makeRotationZ( f( 3 * PI / 2 ) ).toArray(),
	new Matrix4().compose( new Vector3( 1, 2, 3 ), new Quaternion().fromArray( axisQuats[ 3 ] ), new Vector3( 2, 0.5, - 1.5 ) ).toArray(),
	new Matrix4().makePerspective( - 0.5, 0.5, 0.5, - 0.5, 0.5, 50 ).toArray()
];

const trsEdges = [ m4Edges[ 0 ], m4Edges[ 4 ], m4Edges[ 5 ], m4Edges[ 6 ], m4Edges[ 8 ], m4Edges[ 9 ], m4Edges[ 10 ], m4Edges[ 11 ] ];

// Projection matrices: perspective and orthographic, both coordinate systems, reversed depth.
const projEdges = [];
for ( const cs of COORD_SYSTEMS ) for ( const reversed of [ false, true ] ) {

	projEdges.push( new Matrix4().makePerspective( - 0.5, 0.5, 0.5, - 0.5, 0.5, 50, cs, reversed ).toArray() );
	projEdges.push( new Matrix4().makeOrthographic( - 2, 2, 1.5, - 1.5, 0.1, 20, cs, reversed ).toArray() );

}

function randomProj( r ) {

	const near = u( r, 0.1, 1 ), far = near + u( r, 5, 50 ), w = u( r, 0.2, 1.5 ), h = u( r, 0.2, 1.5 );
	const cs = COORD_SYSTEMS[ ri( r, 0, 1 ) ];
	return r() < 0.5
		? new Matrix4().makePerspective( - w, w, h, - h, near, far, cs ).toArray()
		: new Matrix4().makeOrthographic( - w * 3, w * 3, h * 3, - h * 3, near, far, cs ).toArray();

}

function frustumOf( projArray, viewArray ) {

	const m = new Matrix4().fromArray( projArray );
	if ( viewArray ) m.multiply( new Matrix4().fromArray( viewArray ).invert() );
	const fr = new Frustum().setFromProjectionMatrix( m );
	return fr.planes.flatMap( ( p ) => [ p.normal.x, p.normal.y, p.normal.z, p.constant ] );

}

const INF = Infinity;
const S3 = 1 / Math.sqrt( 3 );

// kind -> { base, edges, rand, int }.  `base` is the decode/encode layout.
const SAMPLES = {
	s: { base: 's', edges: [ [ 0 ], [ 1 ], [ - 1 ], [ 0.5 ], [ 2 ], [ - 2.5 ], [ 1.5 ], [ 0.25 ] ], rand: ( r ) => [ u( r, - 3, 3 ) ] },
	nzs: { base: 's', edges: [ [ 1 ], [ - 1 ], [ 2 ], [ 0.5 ], [ - 2.5 ] ], rand: ( r ) => [ nz( r, 0.25, 3 ) ] },
	t: { base: 's', edges: [ [ 0 ], [ 1 ], [ 0.5 ], [ 0.25 ], [ 0.75 ] ], rand: ( r ) => [ r() ] },
	ps: { base: 's', edges: [ [ 1 ], [ 0.5 ], [ 2 ], [ 0.001 ], [ 10 ] ], rand: ( r ) => [ u( r, 0.05, 4 ) ] },
	unit: { base: 's', edges: [ [ 0 ], [ 1 ], [ - 1 ], [ 0.5 ], [ - 0.5 ], [ 0.25 ] ], rand: ( r ) => [ u( r, - 1, 1 ) ] },
	ang: { base: 's', edges: [ [ 0 ], [ PI / 2 ], [ PI ], [ 3 * PI / 2 ], [ - PI / 2 ], [ 2 * PI ], [ PI / 4 ], [ - PI ], [ 1e-4 ] ], rand: ( r ) => [ u( r, - 2 * PI, 2 * PI ) ] },
	v2: { base: 'v2', edges: [ [ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ - 1, 0 ], [ 0, - 1 ], [ 1, 1 ], [ - 1.5, 2.5 ], [ 0.5, - 0.5 ], [ 3, - 4 ] ], rand: vecN( 2, - 2, 2 ) },
	nzv2: { base: 'v2', edges: [ [ 1, 1 ], [ - 1, 2 ], [ 0.5, - 4 ] ], rand: ( r ) => [ nz( r, 0.25, 2 ), nz( r, 0.25, 2 ) ] },
	v3: { base: 'v3', edges: [ [ 0, 0, 0 ], [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ], [ - 1, 0, 0 ], [ 0, - 1, 0 ], [ 0, 0, - 1 ], [ 1, 1, 1 ], [ - 1, 2, - 3 ], [ 0.5, - 1.5, 2.5 ] ], rand: vecN( 3, - 2, 2 ) },
	nzv3: { base: 'v3', edges: [ [ 1, 1, 1 ], [ - 1, 2, - 4 ], [ 0.5, 0.25, - 2 ] ], rand: ( r ) => [ nz( r, 0.25, 2 ), nz( r, 0.25, 2 ), nz( r, 0.25, 2 ) ] },
	uv3: { base: 'v3', edges: [ ...AXES, [ - 1, 0, 0 ], [ 0, - 1, 0 ], [ 0, 0, - 1 ], [ S3, S3, S3 ], [ - S3, S3, - S3 ] ], rand: unit3 },
	v4: { base: 'v4', edges: [ [ 0, 0, 0, 0 ], [ 0, 0, 0, 1 ], [ 1, 0, 0, 0 ], [ 0, 1, 0, 0 ], [ 0, 0, 1, 0 ], [ 1, 1, 1, 1 ], [ - 1, 2, - 3, 4 ], [ 0.5, - 0.5, 1.5, - 2.5 ] ], rand: vecN( 4, - 2, 2 ) },
	nzv4: { base: 'v4', edges: [ [ 1, 1, 1, 1 ], [ - 1, 2, - 4, 0.5 ] ], rand: ( r ) => [ nz( r, 0.25, 2 ), nz( r, 0.25, 2 ), nz( r, 0.25, 2 ), nz( r, 0.25, 2 ) ] },
	// quaternions: identity, zero, non-normalized, then unit axis rotations
	q: { base: 'q', edges: [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 0 ], [ 1, 2, 3, 4 ], [ 0, 0, 0, 2 ], [ - 0.5, 0.25, 0.125, - 1 ], ...axisQuats ], rand: ( r ) => ( r() < 0.5 ? unitQ( r ) : vecN( 4, - 2, 2 )( r ) ) },
	uq: { base: 'q', edges: [ [ 0, 0, 0, 1 ], [ 0, 0, 0, - 1 ], ...axisQuats ], rand: unitQ },
	e: { base: 'e', edges: eulerEdges, rand: ( r ) => [ u( r, - PI, PI ), u( r, - PI, PI ), u( r, - PI, PI ), ri( r, 0, 5 ) ] },
	ord: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ 5 ] ], rand: ( r ) => [ ri( r, 0, 5 ) ] },
	pord: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ 5 ] ], rand: ( r ) => [ ri( r, 0, 5 ) ] },
	m3: { base: 'm3', edges: [
		[ 1, 0, 0, 0, 1, 0, 0, 0, 1 ], [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
		[ 1, 2, 3, 2, 4, 6, 7, 8, 9 ], [ 1, 1, 1, 1, 1, 1, 1, 1, 1 ], // singular
		[ 2, 0, 0, 0, 0.5, 0, 0, 0, - 1 ], new Matrix3().makeRotation( f( PI / 2 ) ).toArray(), [ 1, 0, 0, 0, 1, 0, 3, - 2, 1 ]
	], rand: vecN( 9, - 2, 2 ) },
	m4: { base: 'm4', edges: m4Edges, rand: ( r ) => ( r() < 0.5 ? trs( r ) : vecN( 16, - 2, 2 )( r ) ) },
	trs: { base: 'm4', edges: trsEdges, rand: trs },
	rm4: { base: 'm4', edges: rotationEdges, rand: ( r ) => new Matrix4().makeRotationFromQuaternion( new Quaternion().fromArray( unitQ( r ) ) ).toArray() },
	proj: { base: 'm4', edges: projEdges, rand: randomProj },
	cs: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ] ], rand: ( r ) => [ ri( r, 0, 1 ) ] },
	c: { base: 'c', edges: [ [ 0, 0, 0 ], [ 1, 1, 1 ], [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ], [ 0.5, 0.5, 0.5 ], [ 1, 1, 0 ], [ 0.2, 0.4, 0.6 ], [ 0.04045, 0.0031308, 0.5 ], [ 0.7, 0.3, 0.7 ], [ 0.0625, 0.1875, 0.9375 ] ], rand: vecN( 3, 0, 1 ) },
	cspace: { base: 'i', int: true, edges: [ [ 1 ], [ 2 ], [ 0 ] ], rand: ( r ) => [ ri( r, 1, 2 ) ] },
	hex: { base: 'i', int: true, edges: [ [ 0 ], [ 0xffffff ], [ 0xff0000 ], [ 0x00ff00 ], [ 0x0000ff ], [ 0x808080 ], [ 0x123456 ], [ 0xabcdef ] ], rand: ( r ) => [ ri( r, 0, 0xffffff ) ] },
	box: { base: 'box', edges: [ [ - 1, - 1, - 1, 1, 1, 1 ], [ 0, 0, 0, 0, 0, 0 ], [ INF, INF, INF, - INF, - INF, - INF ], [ 0, 0, 0, 1, 2, 3 ], [ - 2, - 0.5, 1, - 1, 0.5, 3 ] ],
		rand: ( r ) => {

			const c = vecN( 3, - 2, 2 )( r ), h = vecN( 3, 0, 1.5 )( r );
			return [ c[ 0 ] - h[ 0 ], c[ 1 ] - h[ 1 ], c[ 2 ] - h[ 2 ], c[ 0 ] + h[ 0 ], c[ 1 ] + h[ 1 ], c[ 2 ] + h[ 2 ] ];

		} },
	sph: { base: 'sph', edges: [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 0 ], [ 0, 0, 0, - 1 ], [ 1, 2, 3, 0.5 ], [ - 1, 0, 0, 2 ] ], rand: ( r ) => [ ...vecN( 3, - 2, 2 )( r ), u( r, 0, 2 ) ] },
	pl: { base: 'pl', edges: [ [ 1, 0, 0, 0 ], [ 0, 1, 0, 0 ], [ 0, 0, 1, 0 ], [ 0, 1, 0, - 1 ], [ 0, 0, - 1, 2 ], [ S3, S3, S3, 0.5 ], [ 0, 2, 0, 4 ] ], rand: ( r ) => [ ...unit3( r ), u( r, - 2, 2 ) ] },
	ray: { base: 'ray', edges: [ [ 0, 0, 0, 0, 0, - 1 ], [ 0, 0, 5, 0, 0, - 1 ], [ 0, 0, 0, 1, 0, 0 ], [ 1, 2, 3, 0, 1, 0 ], [ - 3, 0, 0, 1, 0, 0 ], [ 0, 0, 0, 0, 0, 0 ], [ - 2, - 2, - 2, S3, S3, S3 ], [ 0.25, 0.25, 4, 0, 0, - 1 ] ],
		rand: ( r ) => {

			const o = vecN( 3, - 3, 3 )( r );
			if ( r() < 0.5 ) return [ ...o, ...unit3( r ) ];
			// aim at a point near the origin so intersection tests hit often
			const d = new Vector3( u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ) ).sub( new Vector3( ...o ) ).normalize();
			return [ ...o, d.x, d.y, d.z ];

		} },
	line: { base: 'line', edges: [ [ 0, 0, 0, 1, 0, 0 ], [ 0, 0, 0, 0, 0, 0 ], [ - 1, - 1, - 1, 1, 1, 1 ], [ 1, 2, 3, 1, 2, 3 ], [ 0, - 2, 0, 0, 2, 0 ], [ 0, 1, 0, 2, 1, 0 ] ], rand: vecN( 6, - 2, 2 ) },
	tri: { base: 'tri', edges: [ [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ], [ 0, 0, 0, 1, 1, 1, 2, 2, 2 ], [ 1, 1, 1, 1, 1, 1, 1, 1, 1 ], [ - 1, - 1, 0, 1, - 1, 0, 0, 1, 0 ], [ - 2, 0, - 2, 2, 0, - 2, 0, 0, 2 ] ], rand: vecN( 9, - 2, 2 ) },
	fr: { base: 'fr', edges: [ frustumOf( projEdges[ 0 ] ), frustumOf( projEdges[ 1 ] ), frustumOf( projEdges[ 0 ], m4Edges[ 4 ] ), frustumOf( projEdges[ 0 ], m4Edges[ 8 ] ) ], rand: ( r ) => frustumOf( randomProj( r ), new Matrix4().compose( new Vector3( u( r, - 2, 2 ), u( r, - 2, 2 ), u( r, - 2, 2 ) ), new Quaternion().fromArray( unitQ( r ) ), new Vector3( 1, 1, 1 ) ).toArray() ) },
	sphl: { base: 'sphl', edges: [ [ 1, 0, 0 ], [ 1, PI / 2, 0 ], [ 2, PI / 4, PI / 3 ], [ 0, 0, 0 ], [ 1, PI, 1 ], [ 1, - 0.5, 2 ], [ 1.5, 4, - 1 ] ], rand: ( r ) => [ u( r, 0, 3 ), u( r, 0, PI ), u( r, - PI, PI ) ] },
	cyl: { base: 'cyl', edges: [ [ 1, 0, 0 ], [ 2, PI / 2, 1 ], [ 0, 0, 0 ], [ 1.5, - PI / 3, - 2 ] ], rand: ( r ) => [ u( r, 0, 3 ), u( r, - PI, PI ), u( r, - 2, 2 ) ] },
	b: { base: 'b', int: true, edges: [ [ 0 ], [ 1 ] ], rand: ( r ) => [ ri( r, 0, 1 ) ] },
	i2: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ] ], rand: ( r ) => [ ri( r, 0, 1 ) ] },
	i3: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 2 ] ], rand: ( r ) => [ ri( r, 0, 2 ) ] },
	i4: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 2 ], [ 3 ] ], rand: ( r ) => [ ri( r, 0, 3 ) ] },
	pot: { base: 's', edges: [ 0, 1, 2, 3, 4, 5, 8, 16, 31, 32, 64, 100, 128, 255, 256, 1024, 4096, 0.5, - 2, 536870912 ].map( ( x ) => [ x ] ), rand: ( r ) => [ ri( r, 1, 5000 ) ] },
	ctype: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 2 ], [ 3 ], [ 4 ], [ 5 ], [ 6 ], [ 7 ] ], rand: ( r ) => [ ri( r, 0, 7 ) ] },
	big: { base: 's', edges: [ 0, 1, 127, 255, 32767, 65535, - 128, - 32768, 2147483647, 4294967295 ].map( ( x ) => [ x ] ), rand: ( r ) => [ ri( r, - 70000, 70000 ) ] },
	seed: { base: 'i', int: true, edges: [ [ 0 ], [ 1 ], [ 1234567 ], [ 4294967295 ], [ 2147483648 ] ], rand: ( r ) => [ ri( r, 0, 4294967295 ) ] },
	// variable-length point list, encoded as [count, x0, y0, z0, ...]
	pts: { base: 'pts', edges: [ [ 0 ], [ 1, 1, 2, 3 ], [ 4, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1 ], [ 2, - 1, - 1, - 1, - 1, - 1, - 1 ] ],
		rand: ( r ) => {

			const n = ri( r, 1, 6 );
			return [ n, ...vecN( n * 3, - 2, 2 )( r ) ];

		} }
};

// ----------------------------------------------------- flat <-> three objects

const v3 = ( a, o = 0 ) => new Vector3( a[ o ], a[ o + 1 ], a[ o + 2 ] );
const points = ( a ) => Array.from( { length: a[ 0 ] }, ( _, i ) => v3( a, 1 + i * 3 ) );

const DEC = {
	s: ( a ) => a[ 0 ],
	i: ( a ) => a[ 0 ],
	b: ( a ) => a[ 0 ] === 1,
	v2: ( a ) => new Vector2( a[ 0 ], a[ 1 ] ),
	v3: ( a ) => v3( a ),
	v4: ( a ) => new Vector4( a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ] ),
	q: ( a ) => new Quaternion( a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ] ),
	e: ( a ) => new Euler( a[ 0 ], a[ 1 ], a[ 2 ], ORDERS[ a[ 3 ] ] ),
	m3: ( a ) => new Matrix3().fromArray( a ),
	m4: ( a ) => new Matrix4().fromArray( a ),
	c: ( a ) => new Color().fromArray( a ),
	box: ( a ) => new Box3( v3( a, 0 ), v3( a, 3 ) ),
	sph: ( a ) => new Sphere( v3( a ), a[ 3 ] ),
	pl: ( a ) => new Plane( v3( a ), a[ 3 ] ),
	ray: ( a ) => new Ray( v3( a, 0 ), v3( a, 3 ) ),
	line: ( a ) => new Line3( v3( a, 0 ), v3( a, 3 ) ),
	tri: ( a ) => new Triangle( v3( a, 0 ), v3( a, 3 ), v3( a, 6 ) ),
	fr: ( a ) => new Frustum( ...[ 0, 4, 8, 12, 16, 20 ].map( ( o ) => new Plane( v3( a, o ), a[ o + 3 ] ) ) ),
	sphl: ( a ) => new Spherical( a[ 0 ], a[ 1 ], a[ 2 ] ),
	cyl: ( a ) => new Cylindrical( a[ 0 ], a[ 1 ], a[ 2 ] ),
	pts: ( a ) => points( a )
};

const ENC = {
	s: ( v ) => [ v ],
	i: ( v ) => [ v ],
	b: ( v ) => [ v ? 1 : 0 ],
	v2: ( v ) => [ v.x, v.y ],
	v3: ( v ) => [ v.x, v.y, v.z ],
	v4: ( v ) => [ v.x, v.y, v.z, v.w ],
	q: ( v ) => ( Array.isArray( v ) ? v.slice( 0, 4 ) : [ v.x, v.y, v.z, v.w ] ),
	e: ( v ) => [ v.x, v.y, v.z, ORDERS.indexOf( v.order ) ],
	m3: ( v ) => [ ...v.elements ],
	m4: ( v ) => [ ...v.elements ],
	c: ( v ) => [ v.r, v.g, v.b ],
	hsl: ( v ) => [ v.h, v.s, v.l ],
	box: ( v ) => [ ...v.min.toArray(), ...v.max.toArray() ],
	sph: ( v ) => [ ...v.center.toArray(), v.radius ],
	pl: ( v ) => [ ...v.normal.toArray(), v.constant ],
	ray: ( v ) => [ ...v.origin.toArray(), ...v.direction.toArray() ],
	line: ( v ) => [ ...v.start.toArray(), ...v.end.toArray() ],
	tri: ( v ) => [ ...v.a.toArray(), ...v.b.toArray(), ...v.c.toArray() ],
	fr: ( v ) => v.planes.flatMap( ( p ) => [ ...p.normal.toArray(), p.constant ] ),
	sphl: ( v ) => [ v.radius, v.phi, v.theta ],
	cyl: ( v ) => [ v.radius, v.theta, v.y ]
};

// `ret` is a kind, "opt:<kind>" (null -> [0], value -> [1, ...]), "str", or an array of those.
function encode( ret, value, extra ) {

	if ( Array.isArray( ret ) ) return ret.flatMap( ( k, i ) => encode( k, value[ i ], extra ) );
	if ( ret === 'str' ) {

		extra.os = value;
		return [];

	}

	if ( ret.startsWith( 'opt:' ) ) return value === null ? [ 0 ] : [ 1, ...ENC[ ret.slice( 4 ) ]( value ) ];
	return ENC[ ret ]( value );

}

// --------------------------------------------------------------------- ops

const OPS = [];
const op = ( name, args, ret, fn, opts = {} ) => OPS.push( { name, args, ret, fn, ...opts } );

const V2 = () => new Vector2(), V3 = () => new Vector3(), V4 = () => new Vector4();
const Q = () => new Quaternion(), M3 = () => new Matrix3(), M4 = () => new Matrix4();
const CS = ( i ) => COORD_SYSTEMS[ i ], SP = ( i ) => COLOR_SPACES[ i ];

// MathUtils
op( 'MathUtils.clamp', [ 's', 's', 's' ], 's', ( a, b, c ) => MU.clamp( a, b, c ) );
op( 'MathUtils.euclideanModulo', [ 's', 'nzs' ], 's', ( a, b ) => MU.euclideanModulo( a, b ) );
op( 'MathUtils.mapLinear', [ 's', 's', 'ps', 's', 's' ], 's', ( x, a1, d, b1, b2 ) => MU.mapLinear( x, a1, f( a1 + d ), b1, b2 ) );
op( 'MathUtils.inverseLerp', [ 's', 's', 's' ], 's', ( a, b, c ) => MU.inverseLerp( a, b, c ) );
op( 'MathUtils.lerp', [ 's', 's', 't' ], 's', ( a, b, c ) => MU.lerp( a, b, c ) );
op( 'MathUtils.damp', [ 's', 's', 'ps', 'ps' ], 's', ( a, b, c, d ) => MU.damp( a, b, c, d ) );
op( 'MathUtils.pingpong', [ 's', 'ps' ], 's', ( a, b ) => MU.pingpong( a, b ) );
op( 'MathUtils.smoothstep', [ 's', 's', 's' ], 's', ( a, b, c ) => MU.smoothstep( a, b, c ) );
op( 'MathUtils.smootherstep', [ 's', 's', 's' ], 's', ( a, b, c ) => MU.smootherstep( a, b, c ) );
op( 'MathUtils.seededRandom', [ 'seed' ], [ 's', 's', 's', 's' ], ( s ) => [ MU.seededRandom( s ), MU.seededRandom(), MU.seededRandom(), MU.seededRandom() ] );
op( 'MathUtils.degToRad', [ 'ang' ], 's', ( a ) => MU.degToRad( a ) );
op( 'MathUtils.radToDeg', [ 'ang' ], 's', ( a ) => MU.radToDeg( a ) );
op( 'MathUtils.isPowerOfTwo', [ 'pot' ], 'b', ( a ) => MU.isPowerOfTwo( a ) );
op( 'MathUtils.ceilPowerOfTwo', [ 'pot' ], 's', ( a ) => MU.ceilPowerOfTwo( a ) );
op( 'MathUtils.floorPowerOfTwo', [ 'pot' ], 's', ( a ) => MU.floorPowerOfTwo( a ) );
op( 'MathUtils.setQuaternionFromProperEuler', [ 'ang', 'ang', 'ang', 'pord' ], 'q', ( a, b, c, o ) => {

	const q = Q();
	MU.setQuaternionFromProperEuler( q, a, b, c, PROPER_ORDERS[ o ] );
	return q;

} );
op( 'MathUtils.normalize', [ 'unit', 'ctype' ], 's', ( v, t ) => MU.normalize( v, new ARRAY_TYPES[ t ]( 1 ) ) );
op( 'MathUtils.denormalize', [ 'big', 'ctype' ], 's', ( v, t ) => MU.denormalize( v, new ARRAY_TYPES[ t ]( 1 ) ) );

// Vector2 / Vector3 / Vector4: methods shared by all three sizes
for ( const [ T, k, nzk, ik ] of [ [ 'Vector2', 'v2', 'nzv2', 'i2' ], [ 'Vector3', 'v3', 'nzv3', 'i3' ], [ 'Vector4', 'v4', 'nzv4', 'i4' ] ] ) {

	op( `${T}.setScalar`, [ k, 's' ], k, ( v, s ) => v.setScalar( s ) );
	op( `${T}.setComponent`, [ k, ik, 's' ], k, ( v, i, s ) => v.setComponent( i, s ) );
	op( `${T}.getComponent`, [ k, ik ], 's', ( v, i ) => v.getComponent( i ) );
	op( `${T}.add`, [ k, k ], k, ( v, a ) => v.add( a ) );
	op( `${T}.addScalar`, [ k, 's' ], k, ( v, s ) => v.addScalar( s ) );
	op( `${T}.addVectors`, [ k, k ], k, ( a, b ) => new a.constructor().addVectors( a, b ) );
	op( `${T}.addScaledVector`, [ k, k, 's' ], k, ( v, a, s ) => v.addScaledVector( a, s ) );
	op( `${T}.sub`, [ k, k ], k, ( v, a ) => v.sub( a ) );
	op( `${T}.subScalar`, [ k, 's' ], k, ( v, s ) => v.subScalar( s ) );
	op( `${T}.subVectors`, [ k, k ], k, ( a, b ) => new a.constructor().subVectors( a, b ) );
	op( `${T}.multiply`, [ k, k ], k, ( v, a ) => v.multiply( a ) );
	op( `${T}.multiplyScalar`, [ k, 's' ], k, ( v, s ) => v.multiplyScalar( s ) );
	op( `${T}.divide`, [ k, nzk ], k, ( v, a ) => v.divide( a ) );
	op( `${T}.divideScalar`, [ k, 'nzs' ], k, ( v, s ) => v.divideScalar( s ) );
	op( `${T}.min`, [ k, k ], k, ( v, a ) => v.min( a ) );
	op( `${T}.max`, [ k, k ], k, ( v, a ) => v.max( a ) );
	op( `${T}.clamp`, [ k, k, k ], k, ( v, a, b ) => v.clamp( a, b ) );
	op( `${T}.clampScalar`, [ k, 's', 's' ], k, ( v, a, b ) => v.clampScalar( a, b ) );
	op( `${T}.clampLength`, [ k, 'ps', 'ps' ], k, ( v, a, b ) => v.clampLength( a, b ) );
	op( `${T}.floor`, [ k ], k, ( v ) => v.floor() );
	op( `${T}.ceil`, [ k ], k, ( v ) => v.ceil() );
	op( `${T}.round`, [ k ], k, ( v ) => v.round() );
	op( `${T}.roundToZero`, [ k ], k, ( v ) => v.roundToZero() );
	op( `${T}.negate`, [ k ], k, ( v ) => v.negate() );
	op( `${T}.dot`, [ k, k ], 's', ( v, a ) => v.dot( a ) );
	op( `${T}.lengthSq`, [ k ], 's', ( v ) => v.lengthSq() );
	op( `${T}.length`, [ k ], 's', ( v ) => v.length() );
	op( `${T}.manhattanLength`, [ k ], 's', ( v ) => v.manhattanLength() );
	op( `${T}.normalize`, [ k ], k, ( v ) => v.normalize() );
	op( `${T}.setLength`, [ k, 's' ], k, ( v, s ) => v.setLength( s ) );
	op( `${T}.lerp`, [ k, k, 't' ], k, ( v, a, t ) => v.lerp( a, t ) );
	op( `${T}.lerpVectors`, [ k, k, 't' ], k, ( a, b, t ) => new a.constructor().lerpVectors( a, b, t ) );
	op( `${T}.equals`, [ k, k ], 'b', ( v, a ) => v.equals( a ) );

}

for ( const [ T, k ] of [ [ 'Vector2', 'v2' ], [ 'Vector3', 'v3' ] ] ) {

	op( `${T}.angleTo`, [ k, k ], 's', ( v, a ) => v.angleTo( a ) );
	op( `${T}.distanceTo`, [ k, k ], 's', ( v, a ) => v.distanceTo( a ) );
	op( `${T}.distanceToSquared`, [ k, k ], 's', ( v, a ) => v.distanceToSquared( a ) );
	op( `${T}.manhattanDistanceTo`, [ k, k ], 's', ( v, a ) => v.manhattanDistanceTo( a ) );

}

op( 'Vector2.applyMatrix3', [ 'v2', 'm3' ], 'v2', ( v, m ) => v.applyMatrix3( m ) );
op( 'Vector2.cross', [ 'v2', 'v2' ], 's', ( v, a ) => v.cross( a ) );
op( 'Vector2.angle', [ 'v2' ], 's', ( v ) => v.angle() );
op( 'Vector2.rotateAround', [ 'v2', 'v2', 'ang' ], 'v2', ( v, c, a ) => v.rotateAround( c, a ) );

op( 'Vector3.multiplyVectors', [ 'v3', 'v3' ], 'v3', ( a, b ) => V3().multiplyVectors( a, b ) );
op( 'Vector3.applyEuler', [ 'v3', 'e' ], 'v3', ( v, e ) => v.applyEuler( e ) );
op( 'Vector3.applyAxisAngle', [ 'v3', 'uv3', 'ang' ], 'v3', ( v, a, s ) => v.applyAxisAngle( a, s ) );
op( 'Vector3.applyMatrix3', [ 'v3', 'm3' ], 'v3', ( v, m ) => v.applyMatrix3( m ) );
op( 'Vector3.applyNormalMatrix', [ 'v3', 'm3' ], 'v3', ( v, m ) => v.applyNormalMatrix( m ) );
op( 'Vector3.applyMatrix4', [ 'v3', 'm4' ], 'v3', ( v, m ) => v.applyMatrix4( m ) );
op( 'Vector3.applyMatrix4.trs', [ 'v3', 'trs' ], 'v3', ( v, m ) => v.applyMatrix4( m ) );
op( 'Vector3.applyMatrix4.proj', [ 'v3', 'proj' ], 'v3', ( v, m ) => v.applyMatrix4( m ) );
op( 'Vector3.applyQuaternion', [ 'v3', 'q' ], 'v3', ( v, q ) => v.applyQuaternion( q ) );
op( 'Vector3.transformDirection', [ 'v3', 'm4' ], 'v3', ( v, m ) => v.transformDirection( m ) );
op( 'Vector3.cross', [ 'v3', 'v3' ], 'v3', ( v, a ) => v.cross( a ) );
op( 'Vector3.crossVectors', [ 'v3', 'v3' ], 'v3', ( a, b ) => V3().crossVectors( a, b ) );
op( 'Vector3.projectOnVector', [ 'v3', 'v3' ], 'v3', ( v, a ) => v.projectOnVector( a ) );
op( 'Vector3.projectOnPlane', [ 'v3', 'uv3' ], 'v3', ( v, n ) => v.projectOnPlane( n ) );
op( 'Vector3.reflect', [ 'v3', 'uv3' ], 'v3', ( v, n ) => v.reflect( n ) );
op( 'Vector3.setFromSpherical', [ 'sphl' ], 'v3', ( s ) => V3().setFromSpherical( s ) );
op( 'Vector3.setFromSphericalCoords', [ 'ps', 'ang', 'ang' ], 'v3', ( r, p, t ) => V3().setFromSphericalCoords( r, p, t ) );
op( 'Vector3.setFromCylindrical', [ 'cyl' ], 'v3', ( c ) => V3().setFromCylindrical( c ) );
op( 'Vector3.setFromCylindricalCoords', [ 'ps', 'ang', 's' ], 'v3', ( r, t, y ) => V3().setFromCylindricalCoords( r, t, y ) );
op( 'Vector3.setFromMatrixPosition', [ 'm4' ], 'v3', ( m ) => V3().setFromMatrixPosition( m ) );
op( 'Vector3.setFromMatrixScale', [ 'm4' ], 'v3', ( m ) => V3().setFromMatrixScale( m ) );
op( 'Vector3.setFromMatrixColumn', [ 'm4', 'i4' ], 'v3', ( m, i ) => V3().setFromMatrixColumn( m, i ) );
op( 'Vector3.setFromMatrix3Column', [ 'm3', 'i3' ], 'v3', ( m, i ) => V3().setFromMatrix3Column( m, i ) );
op( 'Vector3.setFromEuler', [ 'e' ], 'v3', ( e ) => V3().setFromEuler( e ) );
op( 'Vector3.setFromColor', [ 'c' ], 'v3', ( c ) => V3().setFromColor( c ) );

op( 'Vector4.applyMatrix4', [ 'v4', 'm4' ], 'v4', ( v, m ) => v.applyMatrix4( m ) );
op( 'Vector4.setAxisAngleFromQuaternion', [ 'uq' ], 'v4', ( q ) => V4().setAxisAngleFromQuaternion( q ) );
op( 'Vector4.setAxisAngleFromRotationMatrix', [ 'rm4' ], 'v4', ( m ) => V4().setAxisAngleFromRotationMatrix( m ) );
op( 'Vector4.setFromMatrixPosition', [ 'm4' ], 'v4', ( m ) => V4().setFromMatrixPosition( m ) );

// Matrix3
op( 'Matrix3.set', [ 'm3' ], 'm3', ( m ) => M3().set( ...m.elements ) ); // row-major arguments
op( 'Matrix3.extractBasis', [ 'm3' ], [ 'v3', 'v3', 'v3' ], ( m ) => {

	const x = V3(), y = V3(), z = V3();
	m.extractBasis( x, y, z );
	return [ x, y, z ];

} );
op( 'Matrix3.setFromMatrix4', [ 'm4' ], 'm3', ( m ) => M3().setFromMatrix4( m ) );
op( 'Matrix3.multiply', [ 'm3', 'm3' ], 'm3', ( a, b ) => a.multiply( b ) );
op( 'Matrix3.premultiply', [ 'm3', 'm3' ], 'm3', ( a, b ) => a.premultiply( b ) );
op( 'Matrix3.multiplyMatrices', [ 'm3', 'm3' ], 'm3', ( a, b ) => M3().multiplyMatrices( a, b ) );
op( 'Matrix3.multiplyScalar', [ 'm3', 's' ], 'm3', ( m, s ) => m.multiplyScalar( s ) );
op( 'Matrix3.determinant', [ 'm3' ], 's', ( m ) => m.determinant() );
op( 'Matrix3.invert', [ 'm3' ], 'm3', ( m ) => m.invert() );
op( 'Matrix3.transpose', [ 'm3' ], 'm3', ( m ) => m.transpose() );
op( 'Matrix3.getNormalMatrix', [ 'm4' ], 'm3', ( m ) => M3().getNormalMatrix( m ) );
op( 'Matrix3.getNormalMatrix.trs', [ 'trs' ], 'm3', ( m ) => M3().getNormalMatrix( m ) );
op( 'Matrix3.transposeIntoArray', [ 'm3' ], 'm3', ( m ) => {

	const r = [];
	m.transposeIntoArray( r );
	return M3().fromArray( r );

} );
op( 'Matrix3.setUvTransform', [ 's', 's', 'nzs', 'nzs', 'ang', 't', 't' ], 'm3', ( tx, ty, sx, sy, r, cx, cy ) => M3().setUvTransform( tx, ty, sx, sy, r, cx, cy ) );
op( 'Matrix3.makeTranslation', [ 's', 's' ], 'm3', ( x, y ) => M3().makeTranslation( x, y ) );
op( 'Matrix3.makeRotation', [ 'ang' ], 'm3', ( a ) => M3().makeRotation( a ) );
op( 'Matrix3.makeScale', [ 's', 's' ], 'm3', ( x, y ) => M3().makeScale( x, y ) );
op( 'Matrix3.equals', [ 'm3', 'm3' ], 'b', ( a, b ) => a.equals( b ) );

// Matrix4
op( 'Matrix4.set', [ 'm4' ], 'm4', ( m ) => M4().set( ...m.elements ) ); // row-major arguments
op( 'Matrix4.copyPosition', [ 'm4', 'm4' ], 'm4', ( a, b ) => a.copyPosition( b ) );
op( 'Matrix4.setFromMatrix3', [ 'm3' ], 'm4', ( m ) => M4().setFromMatrix3( m ) );
op( 'Matrix4.extractBasis', [ 'm4' ], [ 'v3', 'v3', 'v3' ], ( m ) => {

	const x = new Vector3( 9, 9, 9 ), y = new Vector3( 9, 9, 9 ), z = new Vector3( 9, 9, 9 );
	m.extractBasis( x, y, z );
	return [ x, y, z ];

} );
op( 'Matrix4.makeBasis', [ 'v3', 'v3', 'v3' ], 'm4', ( x, y, z ) => M4().makeBasis( x, y, z ) );
op( 'Matrix4.extractRotation', [ 'm4', 'm4' ], 'm4', ( base, m ) => base.extractRotation( m ) );
op( 'Matrix4.makeRotationFromEuler', [ 'e' ], 'm4', ( e ) => M4().makeRotationFromEuler( e ) );
op( 'Matrix4.makeRotationFromQuaternion', [ 'q' ], 'm4', ( q ) => M4().makeRotationFromQuaternion( q ) );
op( 'Matrix4.lookAt', [ 'm4', 'v3', 'v3', 'uv3' ], 'm4', ( m, eye, target, up ) => m.lookAt( eye, target, up ) );
op( 'Matrix4.multiply', [ 'm4', 'm4' ], 'm4', ( a, b ) => a.multiply( b ) );
op( 'Matrix4.premultiply', [ 'm4', 'm4' ], 'm4', ( a, b ) => a.premultiply( b ) );
op( 'Matrix4.multiplyMatrices', [ 'm4', 'm4' ], 'm4', ( a, b ) => M4().multiplyMatrices( a, b ) );
op( 'Matrix4.multiplyMatrices.trs', [ 'trs', 'trs' ], 'm4', ( a, b ) => M4().multiplyMatrices( a, b ) );
op( 'Matrix4.multiplyScalar', [ 'm4', 's' ], 'm4', ( m, s ) => m.multiplyScalar( s ) );
op( 'Matrix4.determinant', [ 'm4' ], 's', ( m ) => m.determinant() );
op( 'Matrix4.determinantAffine', [ 'm4' ], 's', ( m ) => m.determinantAffine() );
op( 'Matrix4.transpose', [ 'm4' ], 'm4', ( m ) => m.transpose() );
op( 'Matrix4.setPosition', [ 'm4', 's', 's', 's' ], 'm4', ( m, x, y, z ) => m.setPosition( x, y, z ) );
op( 'Matrix4.invert', [ 'm4' ], 'm4', ( m ) => m.invert() );
op( 'Matrix4.invert.trs', [ 'trs' ], 'm4', ( m ) => m.invert() );
op( 'Matrix4.invert.proj', [ 'proj' ], 'm4', ( m ) => m.invert() );
op( 'Matrix4.scale', [ 'm4', 'v3' ], 'm4', ( m, v ) => m.scale( v ) );
op( 'Matrix4.getMaxScaleOnAxis', [ 'm4' ], 's', ( m ) => m.getMaxScaleOnAxis() );
op( 'Matrix4.makeTranslation', [ 's', 's', 's' ], 'm4', ( x, y, z ) => M4().makeTranslation( x, y, z ) );
op( 'Matrix4.makeRotationX', [ 'ang' ], 'm4', ( a ) => M4().makeRotationX( a ) );
op( 'Matrix4.makeRotationY', [ 'ang' ], 'm4', ( a ) => M4().makeRotationY( a ) );
op( 'Matrix4.makeRotationZ', [ 'ang' ], 'm4', ( a ) => M4().makeRotationZ( a ) );
op( 'Matrix4.makeRotationAxis', [ 'uv3', 'ang' ], 'm4', ( v, a ) => M4().makeRotationAxis( v, a ) );
op( 'Matrix4.makeScale', [ 's', 's', 's' ], 'm4', ( x, y, z ) => M4().makeScale( x, y, z ) );
op( 'Matrix4.makeShear', [ 's', 's', 's', 's', 's', 's' ], 'm4', ( a, b, c, d, e, g ) => M4().makeShear( a, b, c, d, e, g ) );
op( 'Matrix4.compose', [ 'v3', 'q', 'v3' ], 'm4', ( p, q, s ) => M4().compose( p, q, s ) );
op( 'Matrix4.decompose', [ 'm4' ], [ 'v3', 'q', 'v3' ], ( m ) => {

	const p = new Vector3( 9, 9, 9 ), q = new Quaternion( 9, 9, 9, 9 ), s = new Vector3( 9, 9, 9 );
	m.decompose( p, q, s );
	return [ p, q, s ];

} );
op( 'Matrix4.decompose.trs', [ 'trs' ], [ 'v3', 'q', 'v3' ], ( m ) => {

	const p = V3(), q = Q(), s = V3();
	m.decompose( p, q, s );
	return [ p, q, s ];

} );
// near/far/extents are built from positive offsets so the frustum is never degenerate
op( 'Matrix4.makePerspective', [ 's', 'ps', 's', 'ps', 'ps', 'ps', 'cs', 'b' ], 'm4', ( l, w, b, h, n, d, cs, rev ) => M4().makePerspective( l, f( l + w ), f( b + h ), b, n, f( n + d ), CS( cs ), rev ) );
op( 'Matrix4.makeOrthographic', [ 's', 'ps', 's', 'ps', 'ps', 'ps', 'cs', 'b' ], 'm4', ( l, w, b, h, n, d, cs, rev ) => M4().makeOrthographic( l, f( l + w ), f( b + h ), b, n, f( n + d ), CS( cs ), rev ) );
op( 'Matrix4.equals', [ 'm4', 'm4' ], 'b', ( a, b ) => a.equals( b ) );

// Quaternion
op( 'Quaternion.slerpFlat', [ 'q', 'q', 't' ], 'q', ( a, b, t ) => {

	const dst = [ 0, 0, 0, 0 ];
	Quaternion.slerpFlat( dst, 0, a.toArray(), 0, b.toArray(), 0, t );
	return dst;

} );
op( 'Quaternion.multiplyQuaternionsFlat', [ 'q', 'q' ], 'q', ( a, b ) => Quaternion.multiplyQuaternionsFlat( [ 0, 0, 0, 0 ], 0, a.toArray(), 0, b.toArray(), 0 ) );
op( 'Quaternion.setFromEuler', [ 'e' ], 'q', ( e ) => Q().setFromEuler( e ) );
op( 'Quaternion.setFromAxisAngle', [ 'uv3', 'ang' ], 'q', ( v, a ) => Q().setFromAxisAngle( v, a ) );
op( 'Quaternion.setFromRotationMatrix', [ 'rm4' ], 'q', ( m ) => Q().setFromRotationMatrix( m ) );
op( 'Quaternion.setFromUnitVectors', [ 'uv3', 'uv3' ], 'q', ( a, b ) => Q().setFromUnitVectors( a, b ) );
op( 'Quaternion.setFromUnitVectors.opposite', [ 'uv3' ], 'q', ( a ) => Q().setFromUnitVectors( a, a.clone().negate() ) );
op( 'Quaternion.angleTo', [ 'uq', 'uq' ], 's', ( a, b ) => a.angleTo( b ) );
op( 'Quaternion.rotateTowards', [ 'uq', 'uq', 'ps' ], 'q', ( a, b, s ) => a.rotateTowards( b, s ) );
op( 'Quaternion.invert', [ 'q' ], 'q', ( q ) => q.invert() );
op( 'Quaternion.conjugate', [ 'q' ], 'q', ( q ) => q.conjugate() );
op( 'Quaternion.dot', [ 'q', 'q' ], 's', ( a, b ) => a.dot( b ) );
op( 'Quaternion.lengthSq', [ 'q' ], 's', ( q ) => q.lengthSq() );
op( 'Quaternion.length', [ 'q' ], 's', ( q ) => q.length() );
op( 'Quaternion.normalize', [ 'q' ], 'q', ( q ) => q.normalize() );
op( 'Quaternion.multiply', [ 'q', 'q' ], 'q', ( a, b ) => a.multiply( b ) );
op( 'Quaternion.premultiply', [ 'q', 'q' ], 'q', ( a, b ) => a.premultiply( b ) );
op( 'Quaternion.multiplyQuaternions', [ 'q', 'q' ], 'q', ( a, b ) => Q().multiplyQuaternions( a, b ) );
op( 'Quaternion.slerp', [ 'uq', 'uq', 't' ], 'q', ( a, b, t ) => a.slerp( b, t ) );
op( 'Quaternion.slerp.any', [ 'q', 'q', 't' ], 'q', ( a, b, t ) => a.slerp( b, t ) );
op( 'Quaternion.slerpQuaternions', [ 'uq', 'uq', 't' ], 'q', ( a, b, t ) => Q().slerpQuaternions( a, b, t ) );
op( 'Quaternion.equals', [ 'q', 'q' ], 'b', ( a, b ) => a.equals( b ) );

// Euler
op( 'Euler.setFromRotationMatrix', [ 'rm4', 'ord' ], 'e', ( m, o ) => new Euler().setFromRotationMatrix( m, ORDERS[ o ] ) );
op( 'Euler.setFromQuaternion', [ 'uq', 'ord' ], 'e', ( q, o ) => new Euler().setFromQuaternion( q, ORDERS[ o ] ) );
op( 'Euler.setFromQuaternion.any', [ 'q', 'ord' ], 'e', ( q, o ) => new Euler().setFromQuaternion( q, ORDERS[ o ] ) );
op( 'Euler.setFromVector3', [ 'v3', 'ord' ], 'e', ( v, o ) => new Euler().setFromVector3( v, ORDERS[ o ] ) );
op( 'Euler.reorder', [ 'e', 'ord' ], 'e', ( e, o ) => e.reorder( ORDERS[ o ] ) );
op( 'Euler.equals', [ 'e', 'e' ], 'b', ( a, b ) => a.equals( b ) );

// Color (ColorManagement stays at its defaults: enabled, working space = srgb-linear)
op( 'Color.setScalar', [ 's' ], 'c', ( s ) => new Color().setScalar( s ) );
op( 'Color.setHex', [ 'hex', 'cspace' ], 'c', ( h, cs ) => new Color().setHex( h, SP( cs ) ) );
op( 'Color.setRGB', [ 'c', 'cspace' ], 'c', ( c, cs ) => new Color().setRGB( c.r, c.g, c.b, SP( cs ) ) );
op( 'Color.setHSL', [ 's', 's', 's', 'cspace' ], 'c', ( h, s, l, cs ) => new Color().setHSL( h, s, l, SP( cs ) ) );
op( 'Color.setHSL.unit', [ 't', 't', 't', 'cspace' ], 'c', ( h, s, l, cs ) => new Color().setHSL( h, s, l, SP( cs ) ) );
op( 'Color.copySRGBToLinear', [ 'c' ], 'c', ( c ) => new Color().copySRGBToLinear( c ) );
op( 'Color.copyLinearToSRGB', [ 'c' ], 'c', ( c ) => new Color().copyLinearToSRGB( c ) );
op( 'Color.convertSRGBToLinear', [ 'c' ], 'c', ( c ) => c.convertSRGBToLinear() );
op( 'Color.convertLinearToSRGB', [ 'c' ], 'c', ( c ) => c.convertLinearToSRGB() );
op( 'Color.getHex', [ 'c', 'cspace' ], 'i', ( c, cs ) => c.getHex( SP( cs ) ) );
op( 'Color.getHexString', [ 'c', 'cspace' ], 'str', ( c, cs ) => c.getHexString( SP( cs ) ) );
op( 'Color.getHSL', [ 'c', 'cspace' ], 'hsl', ( c, cs ) => c.getHSL( { h: 0, s: 0, l: 0 }, SP( cs ) ) );
op( 'Color.getRGB', [ 'c', 'cspace' ], 'c', ( c, cs ) => c.getRGB( new Color(), SP( cs ) ) );
op( 'Color.getStyle', [ 'c', 'cspace' ], 'str', ( c, cs ) => c.getStyle( SP( cs ) ) );
op( 'Color.offsetHSL', [ 'c', 'unit', 'unit', 'unit' ], 'c', ( c, h, s, l ) => c.offsetHSL( h, s, l ) );
op( 'Color.add', [ 'c', 'c' ], 'c', ( a, b ) => a.add( b ) );
op( 'Color.addColors', [ 'c', 'c' ], 'c', ( a, b ) => new Color().addColors( a, b ) );
op( 'Color.addScalar', [ 'c', 's' ], 'c', ( a, s ) => a.addScalar( s ) );
op( 'Color.sub', [ 'c', 'c' ], 'c', ( a, b ) => a.sub( b ) );
op( 'Color.multiply', [ 'c', 'c' ], 'c', ( a, b ) => a.multiply( b ) );
op( 'Color.multiplyScalar', [ 'c', 's' ], 'c', ( a, s ) => a.multiplyScalar( s ) );
op( 'Color.lerp', [ 'c', 'c', 't' ], 'c', ( a, b, t ) => a.lerp( b, t ) );
op( 'Color.lerpColors', [ 'c', 'c', 't' ], 'c', ( a, b, t ) => new Color().lerpColors( a, b, t ) );
op( 'Color.lerpHSL', [ 'c', 'c', 't' ], 'c', ( a, b, t ) => a.lerpHSL( b, t ) );
op( 'Color.setFromVector3', [ 'v3' ], 'c', ( v ) => new Color().setFromVector3( v ) );
op( 'Color.applyMatrix3', [ 'c', 'm3' ], 'c', ( c, m ) => c.applyMatrix3( m ) );
op( 'Color.equals', [ 'c', 'c' ], 'b', ( a, b ) => a.equals( b ) );
op( 'Color.setStyle', [ 'cspace' ], 'c', ( cs, str ) => new Color( 0.25, 0.5, 0.75 ).setStyle( str, SP( cs ) ), { strings: [
	'rgb(255,0,0)', 'rgb(0, 128, 255)', 'rgba(10,20,30,0.5)', 'rgb(300,0,0)', 'rgb(100%,50%,0%)', 'rgba(100%, 0%, 25%, 1)', 'rgb(150%,0%,0%)',
	'hsl(120,50%,50%)', 'hsla(240, 100%, 25%, 0.5)', 'hsl(0,0%,100%)', 'hsl(30.5,60.5%,40.25%)', 'hsl(400,50%,50%)',
	'#ff0', '#F80', '#ff0000', '#1a2B3c', '#abcd', '#12', 'red', 'RebeccaPurple', 'cornflowerblue', 'notacolor', '',
	'rgb(1,2)', 'hsl(120,50,50)', 'lab(1,2,3)', 'rgb( 12 , 34 , 56 )', 'rgb(1.5,2,3)'
] } );
op( 'Color.setColorName', [ 'cspace' ], 'c', ( cs, str ) => new Color( 0.25, 0.5, 0.75 ).setColorName( str, SP( cs ) ), { strings: [ 'red', 'Teal', 'ORANGE', 'slategrey', 'whitesmoke', 'nope' ] } );
op( 'Color.NAMES', [], 'i', ( str ) => Color.NAMES[ str ], { strings: Object.keys( Color.NAMES ) } );
op( 'ColorManagement.SRGBToLinear', [ 't' ], 's', ( c ) => SRGBToLinear( c ) );
op( 'ColorManagement.LinearToSRGB', [ 't' ], 's', ( c ) => LinearToSRGB( c ) );
op( 'ColorManagement.convert', [ 'c', 'cspace', 'cspace' ], 'c', ( c, a, b ) => ColorManagement.convert( c, SP( a ), SP( b ) ) );

// Box3
op( 'Box3.setFromArray', [ 'pts' ], 'box', ( p ) => new Box3().setFromArray( p.flatMap( ( v ) => v.toArray() ) ) );
op( 'Box3.setFromPoints', [ 'pts' ], 'box', ( p ) => new Box3().setFromPoints( p ) );
op( 'Box3.setFromCenterAndSize', [ 'v3', 'v3' ], 'box', ( c, s ) => new Box3().setFromCenterAndSize( c, s ) );
op( 'Box3.isEmpty', [ 'box' ], 'b', ( b ) => b.isEmpty() );
op( 'Box3.getCenter', [ 'box' ], 'v3', ( b ) => b.getCenter( V3() ) );
op( 'Box3.getSize', [ 'box' ], 'v3', ( b ) => b.getSize( V3() ) );
op( 'Box3.expandByPoint', [ 'box', 'v3' ], 'box', ( b, p ) => b.expandByPoint( p ) );
op( 'Box3.expandByVector', [ 'box', 'v3' ], 'box', ( b, p ) => b.expandByVector( p ) );
op( 'Box3.expandByScalar', [ 'box', 's' ], 'box', ( b, s ) => b.expandByScalar( s ) );
op( 'Box3.containsPoint', [ 'box', 'v3' ], 'b', ( b, p ) => b.containsPoint( p ) );
op( 'Box3.containsBox', [ 'box', 'box' ], 'b', ( a, b ) => a.containsBox( b ) );
op( 'Box3.getParameter', [ 'box', 'v3' ], 'v3', ( b, p ) => b.getParameter( p, V3() ) );
op( 'Box3.intersectsBox', [ 'box', 'box' ], 'b', ( a, b ) => a.intersectsBox( b ) );
op( 'Box3.intersectsSphere', [ 'box', 'sph' ], 'b', ( a, b ) => a.intersectsSphere( b ) );
op( 'Box3.intersectsPlane', [ 'box', 'pl' ], 'b', ( a, b ) => a.intersectsPlane( b ) );
op( 'Box3.intersectsTriangle', [ 'box', 'tri' ], 'b', ( a, b ) => a.intersectsTriangle( b ) );
op( 'Box3.clampPoint', [ 'box', 'v3' ], 'v3', ( b, p ) => b.clampPoint( p, V3() ) );
op( 'Box3.distanceToPoint', [ 'box', 'v3' ], 's', ( b, p ) => b.distanceToPoint( p ) );
op( 'Box3.getBoundingSphere', [ 'box' ], 'sph', ( b ) => b.getBoundingSphere( new Sphere( new Vector3( 9, 9, 9 ), 9 ) ) );
op( 'Box3.intersect', [ 'box', 'box' ], 'box', ( a, b ) => a.intersect( b ) );
op( 'Box3.union', [ 'box', 'box' ], 'box', ( a, b ) => a.union( b ) );
op( 'Box3.applyMatrix4', [ 'box', 'm4' ], 'box', ( b, m ) => b.applyMatrix4( m ) );
op( 'Box3.applyMatrix4.trs', [ 'box', 'trs' ], 'box', ( b, m ) => b.applyMatrix4( m ) );
op( 'Box3.translate', [ 'box', 'v3' ], 'box', ( b, p ) => b.translate( p ) );
op( 'Box3.equals', [ 'box', 'box' ], 'b', ( a, b ) => a.equals( b ) );

// Sphere
op( 'Sphere.setFromPoints', [ 'pts' ], 'sph', ( p ) => new Sphere().setFromPoints( p ) );
op( 'Sphere.setFromPoints.center', [ 'pts', 'v3' ], 'sph', ( p, c ) => new Sphere().setFromPoints( p, c ) );
op( 'Sphere.isEmpty', [ 'sph' ], 'b', ( s ) => s.isEmpty() );
op( 'Sphere.containsPoint', [ 'sph', 'v3' ], 'b', ( s, p ) => s.containsPoint( p ) );
op( 'Sphere.distanceToPoint', [ 'sph', 'v3' ], 's', ( s, p ) => s.distanceToPoint( p ) );
op( 'Sphere.intersectsSphere', [ 'sph', 'sph' ], 'b', ( a, b ) => a.intersectsSphere( b ) );
op( 'Sphere.intersectsBox', [ 'sph', 'box' ], 'b', ( a, b ) => a.intersectsBox( b ) );
op( 'Sphere.intersectsPlane', [ 'sph', 'pl' ], 'b', ( a, b ) => a.intersectsPlane( b ) );
op( 'Sphere.clampPoint', [ 'sph', 'v3' ], 'v3', ( s, p ) => s.clampPoint( p, V3() ) );
op( 'Sphere.getBoundingBox', [ 'sph' ], 'box', ( s ) => s.getBoundingBox( new Box3() ) );
op( 'Sphere.applyMatrix4', [ 'sph', 'trs' ], 'sph', ( s, m ) => s.applyMatrix4( m ) );
op( 'Sphere.translate', [ 'sph', 'v3' ], 'sph', ( s, p ) => s.translate( p ) );
op( 'Sphere.expandByPoint', [ 'sph', 'v3' ], 'sph', ( s, p ) => s.expandByPoint( p ) );
op( 'Sphere.union', [ 'sph', 'sph' ], 'sph', ( a, b ) => a.union( b ) );
op( 'Sphere.equals', [ 'sph', 'sph' ], 'b', ( a, b ) => a.equals( b ) );

// Plane
op( 'Plane.setComponents', [ 's', 's', 's', 's' ], 'pl', ( x, y, z, w ) => new Plane().setComponents( x, y, z, w ) );
op( 'Plane.setFromNormalAndCoplanarPoint', [ 'uv3', 'v3' ], 'pl', ( n, p ) => new Plane().setFromNormalAndCoplanarPoint( n, p ) );
op( 'Plane.setFromCoplanarPoints', [ 'tri' ], 'pl', ( t ) => new Plane().setFromCoplanarPoints( t.a, t.b, t.c ) );
op( 'Plane.normalize', [ 'pl' ], 'pl', ( p ) => p.normalize() );
op( 'Plane.normalize.any', [ 'nzv3', 's' ], 'pl', ( n, c ) => new Plane( n, c ).normalize() );
op( 'Plane.negate', [ 'pl' ], 'pl', ( p ) => p.negate() );
op( 'Plane.distanceToPoint', [ 'pl', 'v3' ], 's', ( p, v ) => p.distanceToPoint( v ) );
op( 'Plane.distanceToSphere', [ 'pl', 'sph' ], 's', ( p, s ) => p.distanceToSphere( s ) );
op( 'Plane.projectPoint', [ 'pl', 'v3' ], 'v3', ( p, v ) => p.projectPoint( v, V3() ) );
op( 'Plane.intersectLine', [ 'pl', 'line', 'b' ], 'opt:v3', ( p, l, c ) => p.intersectLine( l, V3(), c ) );
op( 'Plane.intersectsLine', [ 'pl', 'line' ], 'b', ( p, l ) => p.intersectsLine( l ) );
op( 'Plane.intersectsBox', [ 'pl', 'box' ], 'b', ( p, b ) => p.intersectsBox( b ) );
op( 'Plane.intersectsSphere', [ 'pl', 'sph' ], 'b', ( p, s ) => p.intersectsSphere( s ) );
op( 'Plane.coplanarPoint', [ 'pl' ], 'v3', ( p ) => p.coplanarPoint( V3() ) );
op( 'Plane.applyMatrix4', [ 'pl', 'trs' ], 'pl', ( p, m ) => p.applyMatrix4( m ) );
op( 'Plane.applyMatrix4.normalMatrix', [ 'pl', 'trs', 'm3' ], 'pl', ( p, m, n ) => p.applyMatrix4( m, n ) );
op( 'Plane.translate', [ 'pl', 'v3' ], 'pl', ( p, v ) => p.translate( v ) );
op( 'Plane.equals', [ 'pl', 'pl' ], 'b', ( a, b ) => a.equals( b ) );

// Ray
op( 'Ray.at', [ 'ray', 's' ], 'v3', ( r, t ) => r.at( t, V3() ) );
op( 'Ray.lookAt', [ 'ray', 'v3' ], 'ray', ( r, v ) => r.lookAt( v ) );
op( 'Ray.recast', [ 'ray', 's' ], 'ray', ( r, t ) => r.recast( t ) );
op( 'Ray.closestPointToPoint', [ 'ray', 'v3' ], 'v3', ( r, p ) => r.closestPointToPoint( p, V3() ) );
op( 'Ray.distanceToPoint', [ 'ray', 'v3' ], 's', ( r, p ) => r.distanceToPoint( p ) );
op( 'Ray.distanceSqToPoint', [ 'ray', 'v3' ], 's', ( r, p ) => r.distanceSqToPoint( p ) );
op( 'Ray.distanceSqToSegment', [ 'ray', 'line' ], [ 's', 'v3', 'v3' ], ( r, l ) => {

	const a = V3(), b = V3();
	const d = r.distanceSqToSegment( l.start, l.end, a, b );
	return [ d, a, b ];

} );
op( 'Ray.intersectSphere', [ 'ray', 'sph' ], 'opt:v3', ( r, s ) => r.intersectSphere( s, V3() ) );
op( 'Ray.intersectsSphere', [ 'ray', 'sph' ], 'b', ( r, s ) => r.intersectsSphere( s ) );
op( 'Ray.distanceToPlane', [ 'ray', 'pl' ], 'opt:s', ( r, p ) => r.distanceToPlane( p ) );
op( 'Ray.intersectPlane', [ 'ray', 'pl' ], 'opt:v3', ( r, p ) => r.intersectPlane( p, V3() ) );
op( 'Ray.intersectsPlane', [ 'ray', 'pl' ], 'b', ( r, p ) => r.intersectsPlane( p ) );
op( 'Ray.intersectBox', [ 'ray', 'box' ], 'opt:v3', ( r, b ) => r.intersectBox( b, V3() ) );
op( 'Ray.intersectsBox', [ 'ray', 'box' ], 'b', ( r, b ) => r.intersectsBox( b ) );
op( 'Ray.intersectTriangle', [ 'ray', 'tri', 'b' ], 'opt:v3', ( r, t, c ) => r.intersectTriangle( t.a, t.b, t.c, c, V3() ) );
op( 'Ray.applyMatrix4', [ 'ray', 'trs' ], 'ray', ( r, m ) => r.applyMatrix4( m ) );
op( 'Ray.equals', [ 'ray', 'ray' ], 'b', ( a, b ) => a.equals( b ) );

// Frustum
op( 'Frustum.setFromProjectionMatrix', [ 'proj', 'cs', 'b' ], 'fr', ( m, cs, rev ) => new Frustum().setFromProjectionMatrix( m, CS( cs ), rev ) );
op( 'Frustum.setFromProjectionMatrix.viewProj', [ 'proj', 'trs', 'cs', 'b' ], 'fr', ( p, v, cs, rev ) => new Frustum().setFromProjectionMatrix( p.multiply( v ), CS( cs ), rev ), { inputMatrix: true } );
op( 'Frustum.intersectsSphere', [ 'fr', 'sph' ], 'b', ( fr, s ) => fr.intersectsSphere( s ) );
op( 'Frustum.intersectsBox', [ 'fr', 'box' ], 'b', ( fr, b ) => fr.intersectsBox( b ) );
op( 'Frustum.containsPoint', [ 'fr', 'v3' ], 'b', ( fr, p ) => fr.containsPoint( p ) );

// Triangle
op( 'Triangle.getNormal.static', [ 'tri' ], 'v3', ( t ) => Triangle.getNormal( t.a, t.b, t.c, V3() ) );
op( 'Triangle.getBarycoord.static', [ 'v3', 'tri' ], 'opt:v3', ( p, t ) => Triangle.getBarycoord( p, t.a, t.b, t.c, V3() ) );
op( 'Triangle.containsPoint.static', [ 'v3', 'tri' ], 'b', ( p, t ) => Triangle.containsPoint( p, t.a, t.b, t.c ) );
op( 'Triangle.getInterpolation.static', [ 'v3', 'tri', 'v3', 'v3', 'v3' ], 'opt:v3', ( p, t, a, b, c ) => Triangle.getInterpolation( p, t.a, t.b, t.c, a, b, c, V3() ) );
op( 'Triangle.getInterpolation.static.v2', [ 'v3', 'tri', 'v2', 'v2', 'v2' ], 'opt:v2', ( p, t, a, b, c ) => Triangle.getInterpolation( p, t.a, t.b, t.c, a, b, c, V2() ) );
op( 'Triangle.getInterpolation.static.v4', [ 'v3', 'tri', 'v4', 'v4', 'v4' ], 'opt:v4', ( p, t, a, b, c ) => Triangle.getInterpolation( p, t.a, t.b, t.c, a, b, c, V4() ) );
op( 'Triangle.isFrontFacing.static', [ 'tri', 'v3' ], 'b', ( t, d ) => Triangle.isFrontFacing( t.a, t.b, t.c, d ) );
op( 'Triangle.setFromPointsAndIndices', [ 'pts', 'i3' ], 'tri', ( p, i ) => new Triangle().setFromPointsAndIndices( p, i % p.length, ( i + 1 ) % p.length, ( i + 2 ) % p.length ), { minPoints: 1 } );
op( 'Triangle.getArea', [ 'tri' ], 's', ( t ) => t.getArea() );
op( 'Triangle.getMidpoint', [ 'tri' ], 'v3', ( t ) => t.getMidpoint( V3() ) );
op( 'Triangle.getNormal', [ 'tri' ], 'v3', ( t ) => t.getNormal( V3() ) );
op( 'Triangle.getPlane', [ 'tri' ], 'pl', ( t ) => t.getPlane( new Plane() ) );
op( 'Triangle.getBarycoord', [ 'tri', 'v3' ], 'opt:v3', ( t, p ) => t.getBarycoord( p, V3() ) );
op( 'Triangle.getInterpolation', [ 'tri', 'v3', 'v3', 'v3', 'v3' ], 'opt:v3', ( t, p, a, b, c ) => t.getInterpolation( p, a, b, c, V3() ) );
op( 'Triangle.containsPoint', [ 'tri', 'v3' ], 'b', ( t, p ) => t.containsPoint( p ) );
op( 'Triangle.containsPoint.inside', [ 'tri', 't', 't' ], 'b', ( t, a, b ) => t.containsPoint( pointInTriangle( t, a, b ) ), { derived: 'pointInTriangle' } );
op( 'Triangle.isFrontFacing', [ 'tri', 'v3' ], 'b', ( t, d ) => t.isFrontFacing( d ) );
op( 'Triangle.intersectsBox', [ 'tri', 'box' ], 'b', ( t, b ) => t.intersectsBox( b ) );
op( 'Triangle.closestPointToPoint', [ 'tri', 'v3' ], 'v3', ( t, p ) => t.closestPointToPoint( p, V3() ) );
op( 'Triangle.equals', [ 'tri', 'tri' ], 'b', ( a, b ) => a.equals( b ) );

// Line3
op( 'Line3.getCenter', [ 'line' ], 'v3', ( l ) => l.getCenter( V3() ) );
op( 'Line3.delta', [ 'line' ], 'v3', ( l ) => l.delta( V3() ) );
op( 'Line3.distanceSq', [ 'line' ], 's', ( l ) => l.distanceSq() );
op( 'Line3.distance', [ 'line' ], 's', ( l ) => l.distance() );
op( 'Line3.at', [ 'line', 's' ], 'v3', ( l, t ) => l.at( t, V3() ) );
op( 'Line3.closestPointToPointParameter', [ 'line', 'v3', 'b' ], 's', ( l, p, c ) => l.closestPointToPointParameter( p, c ) );
op( 'Line3.closestPointToPoint', [ 'line', 'v3', 'b' ], 'v3', ( l, p, c ) => l.closestPointToPoint( p, c, V3() ) );
op( 'Line3.distanceSqToLine3', [ 'line', 'line' ], [ 's', 'v3', 'v3' ], ( a, b ) => {

	const c1 = V3(), c2 = V3();
	const d = a.distanceSqToLine3( b, c1, c2 );
	return [ d, c1, c2 ];

} );
op( 'Line3.applyMatrix4', [ 'line', 'trs' ], 'line', ( l, m ) => l.applyMatrix4( m ) );
op( 'Line3.equals', [ 'line', 'line' ], 'b', ( a, b ) => a.equals( b ) );

// Spherical / Cylindrical
op( 'Spherical.makeSafe', [ 'sphl' ], 'sphl', ( s ) => s.makeSafe() );
op( 'Spherical.setFromVector3', [ 'v3' ], 'sphl', ( v ) => new Spherical().setFromVector3( v ) );
op( 'Spherical.setFromCartesianCoords', [ 's', 's', 's' ], 'sphl', ( x, y, z ) => new Spherical().setFromCartesianCoords( x, y, z ) );
op( 'Cylindrical.setFromVector3', [ 'v3' ], 'cyl', ( v ) => new Cylindrical().setFromVector3( v ) );
op( 'Cylindrical.setFromCartesianCoords', [ 's', 's', 's' ], 'cyl', ( x, y, z ) => new Cylindrical().setFromCartesianCoords( x, y, z ) );

// A point strictly inside triangle t for barycentric weights derived from (a, b).
// Rounded to f32 and recorded in the case as extra inputs, so the engine reads the point itself.
function pointInTriangle( t, a, b ) {

	const u1 = 0.05 + 0.9 * a * ( 1 - b ), v1 = 0.05 + 0.9 * b * 0.5 * ( 1 - a );
	const p = t.a.clone().multiplyScalar( 1 - u1 - v1 ).addScaledVector( t.b, u1 ).addScaledVector( t.c, v1 );
	return new Vector3( f( p.x ), f( p.y ), f( p.z ) );

}

// ----------------------------------------------------------------- generate

function sample( kind, i, j, edgeRounds, rng ) {

	const s = SAMPLES[ kind ];
	if ( ! s ) throw new Error( 'unknown sample kind: ' + kind );
	const flat = i < edgeRounds ? s.edges[ ( i * ( j * 2 + 1 ) + j ) % s.edges.length ] : s.rand( rng );
	return s.int ? flat.slice() : flat.map( f );

}

function runOp( o ) {

	const rng = mulberry32( fnv1a( o.name ) );
	const edgeRounds = o.args.reduce( ( n, k ) => Math.max( n, SAMPLES[ k ].edges.length ), 0 );
	const strings = o.strings || [ undefined ];
	const count = o.strings ? Math.max( strings.length, edgeRounds ) : edgeRounds + RANDOM_CASES;
	const cases = [];

	for ( let i = 0; i < count; i ++ ) {

		let flats = o.args.map( ( k, j ) => sample( k, i, j, edgeRounds, rng ) );
		if ( o.minPoints ) while ( flats[ 0 ][ 0 ] < o.minPoints ) flats = o.args.map( ( k, j ) => sample( k, edgeRounds, j, edgeRounds, rng ) );

		const str = strings[ i % strings.length ];
		const decoded = () => o.args.map( ( k, j ) => DEC[ SAMPLES[ k ].base ]( flats[ j ] ) );
		const c = { op: o.name, in: flats.flat() };
		if ( str !== undefined ) c.s = str;

		if ( o.derived === 'pointInTriangle' ) {

			// replace the two weights with the derived f32 point so the engine needs no helper
			const [ t, a, b ] = decoded();
			const p = pointInTriangle( t, a, b );
			c.in = [ ...flats[ 0 ], p.x, p.y, p.z ];

		}

		if ( o.inputMatrix ) {

			// the op consumes one pre-multiplied f32 matrix: record that instead of its factors
			const [ p, v, cs, rev ] = decoded();
			const m = p.multiply( v ).toArray().map( f );
			c.in = [ ...m, cs, rev ? 1 : 0 ];
			c.out = encode( o.ret, new Frustum().setFromProjectionMatrix( new Matrix4().fromArray( m ), CS( cs ), rev ), c );
			cases.push( c );
			continue;

		}

		const args = decoded();
		if ( str !== undefined ) args.push( str );
		const extra = {};
		c.out = encode( o.ret, o.fn( ...args ), extra );
		if ( extra.os !== undefined ) c.os = extra.os;
		cases.push( c );

	}

	return cases;

}

const num = ( x ) => ( Number.isFinite( x ) ? ( Object.is( x, - 0 ) ? '0' : String( x ) ) : JSON.stringify( String( x ) ) );
const arr = ( a ) => '[' + a.map( num ).join( ',' ) + ']';

function serialize( type, cases ) {

	const meta = {
		type,
		reference: 'three@0.186.1 src/math',
		generator: 'parity/math/gen/generate.mjs',
		inputs: 'float inputs are f32-rounded (Math.fround) before three.js sees them',
		tolerance: '|got - out| <= 1e-6 * max(1, |out|)',
		cases: cases.length
	};
	const lines = cases.map( ( c ) => {

		let s = '{"op":' + JSON.stringify( c.op ) + ',"in":' + arr( c.in );
		if ( c.s !== undefined ) s += ',"s":' + JSON.stringify( c.s );
		s += ',"out":' + arr( c.out );
		if ( c.os !== undefined ) s += ',"os":' + JSON.stringify( c.os );
		return s + '}';

	} );
	return '{"meta":' + JSON.stringify( meta ) + ',\n"cases":[\n' + lines.join( ',\n' ) + '\n]}\n';

}

const byType = new Map();
for ( const o of OPS ) {

	const type = o.name.split( '.' )[ 0 ];
	if ( ! byType.has( type ) ) byType.set( type, [] );
	byType.get( type ).push( ...runOp( o ) );

}

let total = 0;
const opNames = OPS.map( ( o ) => o.name );
for ( const [ type, cases ] of byType ) {

	fs.writeFileSync( path.join( OUT_DIR, type + '.json' ), serialize( type, cases ) );
	console.log( `${type}.json`.padEnd( 24 ) + String( cases.length ).padStart( 6 ) + ' cases' );
	total += cases.length;

}

fs.writeFileSync( path.join( OUT_DIR, 'ops.json' ), JSON.stringify( opNames, null, '\t' ) + '\n' );
console.log( `${opNames.length} ops, ${total} cases -> ${OUT_DIR}` );
