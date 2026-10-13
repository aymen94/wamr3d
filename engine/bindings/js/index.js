// WAMR3D entry point.
//
//   import { init, World, Vector3 } from 'wamr3d';
//   await init();
//
// Everything exported here except `init`, `attributeView` and `memory` is implemented in
// the WebAssembly module; this file only loads it.

import initWasm, * as bindings from './wamr3d_wasm.js';

export * from './wamr3d_wasm.js';

let wasm;

/** The scalar helpers, also available as individual exports. */
export const MathUtils = Object.freeze( Object.fromEntries( [
	'degToRad', 'radToDeg', 'clamp', 'lerp', 'inverseLerp', 'mapLinear', 'damp', 'pingpong', 'smoothstep', 'smootherstep',
	'euclideanModulo', 'isPowerOfTwo', 'ceilPowerOfTwo', 'floorPowerOfTwo', 'seededRandom'
].map( ( name ) => [ name, ( ...args ) => bindings[ name ]( ...args ) ] ) ) );

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
