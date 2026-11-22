// Geometry pools, shared by the WebGPU and WebGL 2 hosts: small geometries without
// tangents, second uvs or skinning share vertex buffers, one pool per set of inputs.

// Vertex inputs with a buffer of their own, in location order: name, floats per vertex
// (the colour may have four). They are the first records of `Renderer.geometryState`;
// each host follows them with its extra attributes.
export const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
export const VERTEX_COLOR_SLOT = 3;

export const POOL_MAX_VERTICES = 65536, POOL_MAX_INDICES = 393216, POOL_MIN_VERTICES = 16384, POOL_MIN_INDICES = 49152;

// The pool key of the geometry record of `Renderer.geometryState` at `o`: a bit per input
// it has (position, normal, uv, colour) and the colour's floats; -1 for a geometry that
// stays on its own.
export function poolSignature( state, o, vertices, colorSize, auxKey ) {

	if ( auxKey !== '' || vertices === 0 || vertices > POOL_MAX_VERTICES ) return - 1;
	let signature = 0;
	for ( let i = 0, p = o + 4; i < ATTRIBUTES.length; i ++, p += 2 ) if ( state[ p ] !== 0 ) signature |= 1 << i;
	return signature & 1 << VERTEX_COLOR_SLOT ? signature | colorSize << 4 : signature;

}

// The capacity a pool of `old` elements of up to `bytes` each grows to for `needed` more,
// at most `maxBytes`; -1 if they do not fit.
export function grownCapacity( old, needed, minimum, bytes, maxBytes ) {

	const capacity = Math.min( Math.max( old * 2, old + needed, minimum ), Math.floor( maxBytes / bytes ) );
	return capacity < old + needed ? - 1 : capacity;

}

// A geometry left out of its pool tries again only when that may change: its inputs,
// index or vertex count changed, or its pool (`pool`, which was full) gave space back
// since. A pool counts that in `freed`.
export function refusal( pool, signature, indexVersion, vertices ) {

	return { pool, freed: pool ? pool.freed : 0, signature, indexVersion, vertices };

}

export function mayJoin( refused, signature, indexVersion, vertices ) {

	return refused === null || refused.signature !== signature || refused.indexVersion !== indexVersion || refused.vertices !== vertices || ( refused.pool !== null && refused.pool.freed !== refused.freed );

}

// First fit in a list of free `start, length` pairs in address order.
export function allocate( free, length ) {

	for ( let i = 0; i < free.length; i += 2 ) {

		if ( free[ i + 1 ] < length ) continue;
		const start = free[ i ];
		if ( free[ i + 1 ] === length ) free.splice( i, 2 );
		else {

			free[ i ] += length;
			free[ i + 1 ] -= length;

		}

		return start;

	}

	return - 1;

}

export function deallocate( free, start, length ) {

	let i = 0;
	while ( i < free.length && free[ i ] < start ) i += 2;
	free.splice( i, 0, start, length );

	if ( i + 2 < free.length && start + length === free[ i + 2 ] ) {

		free[ i + 1 ] += free[ i + 3 ];
		free.splice( i + 2, 2 );

	}

	if ( i > 0 && free[ i - 2 ] + free[ i - 1 ] === start ) {

		free[ i - 1 ] += free[ i + 1 ];
		free.splice( i, 2 );

	}

}
