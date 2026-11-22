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
