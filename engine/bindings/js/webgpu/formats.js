// Formats, filters and pipeline-key bits shared by the WebGPU host's modules.

export const WRAPS = { 1000: 'repeat', 1001: 'clamp-to-edge', 1002: 'mirror-repeat' };
// Texture filter constants: nearest 1003, linear 1006, and their mipmapped variants.
export const LINEAR = new Set( [ 1006, 1007, 1008 ] ), MIPMAPPED = new Set( [ 1004, 1005, 1007, 1008 ] ), MIP_LINEAR = new Set( [ 1005, 1008 ] );
// With tone mapping the scene is drawn into this linear format, then tone-mapped onto the canvas.
export const HDR_FORMAT = 'rgba16float', HDR_KEY = 1 << 20;
// Render targets hold linear colour without encoding (three.js NoColorSpace); RGBA8_KEY
// marks pipelines for such a target, SINGLE_KEY those without multisampling.
export const RGBA8_KEY = 1 << 21, SINGLE_KEY = 1 << 22;

// Blend factors by three.js blending mode (normal, additive, subtractive, multiply,
// custom drawn as normal): colour source and destination, alpha source and destination;
// the first five for straight alpha, the next five for premultiplied alpha. Subtractive
// and multiply need premultiplied alpha in three.js and use those factors either way.
export const BLEND_FACTORS = [
	[ 'src-alpha', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ],
	[ 'src-alpha', 'one', 'one', 'one' ],
	[ 'zero', 'one-minus-src', 'zero', 'one' ],
	[ 'dst', 'one-minus-src-alpha', 'zero', 'one' ],
	[ 'src-alpha', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ],
	[ 'one', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ],
	[ 'one', 'one', 'one', 'one' ],
	[ 'zero', 'one-minus-src', 'zero', 'one' ],
	[ 'dst', 'one-minus-src-alpha', 'zero', 'one' ],
	[ 'one', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ]
];

// The versions of a geometry's extra attributes (records of `Renderer.geometryState`
// from `o`), as a key; empty when it has none.
export function auxRecord( state, o, count ) {

	let key = '';
	for ( let a = 0, p = o; a < count; a ++, p += 2 ) if ( state[ p + 1 ] !== 0 ) key += a + ':' + state[ p ] + ':' + state[ p + 1 ] + ',';
	return key;

}

// First instance and instance count of points or segments drawn as quads, from a draw's
// first vertex and vertex count: a point per vertex, a segment per strip pair, or one per
// two vertices of a list.
export function quadInstances( topology, start, count ) {

	if ( topology === 3 ) return [ start, count ];
	if ( topology === 2 ) return [ start >> 1, count >> 1 ];
	return [ start, Math.max( 0, count - 1 ) ];

}
