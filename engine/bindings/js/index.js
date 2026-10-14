// WAMR3D entry point.
//
//   import { init, World, Vector3 } from 'wamr3d';
//   await init();
//
// Everything exported here except `init`, `attributeView`, `memory` and the scalar
// helpers is implemented in the WebAssembly module; this file only loads it.

import initWasm, { seededRandom } from './wamr3d_wasm.js';

export * from './wamr3d_wasm.js';

let wasm;

// The scalar helpers run in JavaScript: a call into the module costs more than the
// arithmetic, and doubles give the same results as three.js. These local exports take
// precedence over the module's functions of the same name. `seededRandom` stays in the
// module so that its sequence is shared with the engine.

const DEG2RAD = Math.PI / 180, RAD2DEG = 180 / Math.PI;

export function degToRad( degrees ) {

	return degrees * DEG2RAD;

}

export function radToDeg( radians ) {

	return radians * RAD2DEG;

}

export function clamp( value, min, max ) {

	return Math.max( min, Math.min( max, value ) );

}

export function lerp( x, y, t ) {

	return ( 1 - t ) * x + t * y;

}

export function inverseLerp( x, y, value ) {

	return x !== y ? ( value - x ) / ( y - x ) : 0;

}

export function mapLinear( x, a1, a2, b1, b2 ) {

	return b1 + ( x - a1 ) * ( b2 - b1 ) / ( a2 - a1 );

}

export function damp( x, y, lambda, dt ) {

	return lerp( x, y, 1 - Math.exp( - lambda * dt ) );

}

export function euclideanModulo( n, m ) {

	return ( ( n % m ) + m ) % m;

}

export function pingpong( x, length = 1 ) {

	return length - Math.abs( euclideanModulo( x, length * 2 ) - length );

}

export function smoothstep( x, min, max ) {

	if ( x <= min ) return 0;
	if ( x >= max ) return 1;
	x = ( x - min ) / ( max - min );
	return x * x * ( 3 - 2 * x );

}

export function smootherstep( x, min, max ) {

	if ( x <= min ) return 0;
	if ( x >= max ) return 1;
	x = ( x - min ) / ( max - min );
	return x * x * x * ( x * ( x * 6 - 15 ) + 10 );

}

export function isPowerOfTwo( value ) {

	return value > 0 && Number.isInteger( value ) && 2 ** Math.round( Math.log2( value ) ) === value;

}

export function ceilPowerOfTwo( value ) {

	return Math.pow( 2, Math.ceil( Math.log( value ) / Math.LN2 ) );

}

export function floorPowerOfTwo( value ) {

	return Math.pow( 2, Math.floor( Math.log( value ) / Math.LN2 ) );

}

/** The scalar helpers, also available as individual exports. */
export const MathUtils = Object.freeze( {
	degToRad, radToDeg, clamp, lerp, inverseLerp, mapLinear, damp, pingpong, smoothstep, smootherstep,
	euclideanModulo, isPowerOfTwo, ceilPowerOfTwo, floorPowerOfTwo, seededRandom: ( seed ) => seededRandom( seed )
} );

/**
 * Loads and instantiates the WebAssembly module. Call once, before anything else.
 *
 * With no argument the .wasm file next to this module is used: read from disk under
 * Node.js, fetched in a browser. Pass a URL, Response, ArrayBuffer or
 * WebAssembly.Module to load it from somewhere else.
 */
export async function init( source ) {

	if ( wasm !== undefined ) return;

	if ( source === undefined && typeof process !== 'undefined' && process.versions?.node ) {

		const { readFile } = await import( 'node:fs/promises' );
		source = await readFile( new URL( './wamr3d_wasm_bg.wasm', import.meta.url ) );

	}

	wasm = await initWasm( source === undefined ? undefined : { module_or_path: source } );

}

/** The module's linear memory. */
export function memory() {

	if ( wasm === undefined ) throw new Error( 'WAMR3D: call init() first' );
	return wasm.memory;

}

/**
 * A Float32Array over a geometry attribute's data inside the module's memory: no copy,
 * and writes go straight to the engine. Call world.markAttributeNeedsUpdate() after writing.
 *
 * The view becomes unusable (length 0) whenever the module's memory grows, which any
 * allocation can cause, and stale when the attribute is replaced or its geometry
 * disposed. Create it right before use, or again after other engine calls.
 */
export function attributeView( world, geometry, name ) {

	return new Float32Array( memory().buffer, world.attributePtr( geometry, name ), world.attributeLength( geometry, name ) );

}
