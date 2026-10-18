// Edge-case inputs per argument kind, and the samplers of random ones.
//
// Part of the math fixture generator; `../generate.mjs` runs it.

import { Vector3 } from 'three/src/math/Vector3.js';
import { Matrix3 } from 'three/src/math/Matrix3.js';
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Euler } from 'three/src/math/Euler.js';
import { Frustum } from 'three/src/math/Frustum.js';
import { COORD_SYSTEMS, ORDERS, PI, f } from './common.js';
import { nz, ri, trs, u, unit3, unitQ, vecN } from './random.js';


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
export const SAMPLES = {
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
