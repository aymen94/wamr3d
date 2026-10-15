// The World behind every object, the batching of transform writes, and the registries
// the other modules share. `world` is a live binding: it is set once by `init`.

import * as W from '../index.js';

export let world = null;

/** Loads the WebAssembly module and creates the world. Call once, before anything else. */
export async function init( source ) {

	await W.init( source );
	world ??= new W.World();

}

// Transform writes are kept on the JavaScript side and sent in one call the next time
// the engine is used, so every engine access goes through here.
export function w() {

	if ( world === null ) throw new Error( 'WAMR3D: call init() first' );
	if ( dirty.length !== 0 ) flush();
	if ( touched.length !== 0 ) pushMatrices();
	return world;

}

/** The World behind every object created here, for the batched low-level calls. */
export function getWorld() {

	return w();

}

// ---------------------------------------------------------------- transform properties

// `object.position` and friends. The numbers are kept here, next to the object, so that
// reading and writing them does not call into WebAssembly. Written parts are sent to
// the engine in one batch (see `w()`); parts the engine changed are read back on demand.
//
// Per object: `_t` holds position (0), Euler angles (3), quaternion (6), scale (10),
// up (13) and the Euler order index (16). `_dirty` has a bit per part written here and
// not yet sent; `_stale` a bit per part whose numbers in `_t` are out of date.

export const POSITION = 1, ROTATION = 2, QUATERNION = 4, SCALE = 8, UP = 16, ALL_PARTS = 31;
export const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];
const VALUES = 17;

export const dirty = [], touched = [];
let flushCapacity = 0, flushHandles = null, flushMasks = null, flushValues = null;

export function flush() {

	const count = dirty.length;

	if ( count > flushCapacity ) {

		flushCapacity = Math.max( 64, count * 2 );
		flushHandles = new BigUint64Array( flushCapacity );
		flushMasks = new Uint8Array( flushCapacity );
		flushValues = new Float32Array( flushCapacity * VALUES );

	}

	for ( let i = 0, o = 0; i < count; i ++ ) {

		const object = dirty[ i ], t = object._t, mask = object._dirty;
		flushHandles[ i ] = object.handle;
		flushMasks[ i ] = mask;
		for ( let k = 0; k < VALUES; k ++ ) flushValues[ o ++ ] = t[ k ];

		// the engine derives each of these from the other
		if ( mask & ROTATION ) object._stale |= QUATERNION;
		if ( mask & QUATERNION ) object._stale |= ROTATION;
		object._dirty = 0;

	}

	dirty.length = 0;
	world.applyTransforms( flushHandles.subarray( 0, count ), flushMasks.subarray( 0, count ), flushValues.subarray( 0, count * VALUES ) );

}

// Local matrices of objects with `matrixAutoUpdate = false` that were handed out since
// the last engine access, and so may have been changed.
function pushMatrices() {

	for ( const object of touched ) {

		object._matrixTouched = false;
		if ( ! object._matrixAutoUpdate ) world.setMatrix( object.handle, object._matrix.toArray() );

	}

	touched.length = 0;

}

function refresh( object ) {

	if ( dirty.length !== 0 ) flush();
	const values = world.transformValues( object.handle ), t = object._t;
	for ( let k = 0; k < VALUES; k ++ ) t[ k ] = values[ k ];
	object._stale = 0;

}

// Before reading a part, or writing one number of it: what was written to the part it
// depends on must reach the engine first, and stale numbers must be read back.
export function ready( object, part, other ) {

	if ( ( object._dirty & other ) !== 0 ) flush();
	if ( ( object._stale & part ) !== 0 ) refresh( object );

}

export function mark( object, part ) {

	if ( object._dirty === 0 ) dirty.push( object );
	object._dirty |= part;

}

export const OBJECT = 0, GEOMETRY = 1, MATERIAL = 2;
export const objects = new Map();

// Engine resources are released when the JavaScript object that owns them is collected.
export const finalizer = new FinalizationRegistry( ( { kind, handle, instances } ) => {

	if ( world === null ) return;

	if ( kind === OBJECT ) {

		if ( instances ) instanceSources.delete( instances );
		objects.delete( handle );
		world.destroy( handle );

	} else if ( kind === GEOMETRY ) {

		world.disposeGeometry( handle );

	} else {

		world.disposeMaterial( handle );

	}

} );


// Objects ever made whose picking needs data kept here (instanced meshes, sprites).
export const hosted = { count: 0 };
export const instanceSources = new Map();
export function lazyUUID( Class ) {

	Object.defineProperty( Class.prototype, 'uuid', {
		get() {

			return this._uuid ??= W.MathUtils.generateUUID();

		},
		set( value ) {

			this._uuid = value;

		},
		configurable: true
	} );

}
const warned = new Set();

export function ignored( what ) {

	if ( warned.has( what ) ) return;
	warned.add( what );
	console.warn( `WAMR3D: ${what} is not supported yet and has no effect` );

}
