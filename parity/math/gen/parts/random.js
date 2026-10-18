// The seeded random inputs.
//
// Part of the math fixture generator; `../generate.mjs` runs it.

import { Vector3 } from 'three/src/math/Vector3.js';
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';

export function fnv1a( str ) {

	let h = 0x811c9dc5;
	for ( let i = 0; i < str.length; i ++ ) {

		h ^= str.charCodeAt( i );
		h = Math.imul( h, 0x01000193 );

	}

	return h >>> 0;

}

export function mulberry32( seed ) {

	let a = seed >>> 0;
	return function () {

		a = ( a + 0x6D2B79F5 ) >>> 0;
		let t = a;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export const u = ( r, lo, hi ) => lo + r() * ( hi - lo );
export const ri = ( r, lo, hi ) => lo + Math.floor( r() * ( hi - lo + 1 ) );
export const nz = ( r, lo, hi ) => ( r() < 0.5 ? - 1 : 1 ) * u( r, lo, hi );
export const vecN = ( n, lo, hi ) => ( r ) => Array.from( { length: n }, () => u( r, lo, hi ) );

export function unit3( r ) {

	const v = new Vector3( u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ) );
	if ( v.lengthSq() < 1e-4 ) v.set( 1, 0, 0 );
	return v.normalize().toArray();

}

export function unitQ( r ) {

	const q = new Quaternion( u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ), u( r, - 1, 1 ) );
	if ( q.lengthSq() < 1e-4 ) q.set( 0, 0, 0, 1 );
	return q.normalize().toArray();

}

export function trs( r ) {

	const p = new Vector3( u( r, - 3, 3 ), u( r, - 3, 3 ), u( r, - 3, 3 ) );
	const q = new Quaternion().fromArray( unitQ( r ) );
	const s = new Vector3( nz( r, 0.3, 2.5 ), nz( r, 0.3, 2.5 ), nz( r, 0.3, 2.5 ) );
	return new Matrix4().compose( p, q, s ).toArray();

}
