// Constants shared by the host's parts.
//
// Part of the WebGL 2 host; `../webgl.js` creates the context and draws the frames.

export const UNUSED_FRAMES = 300;
// Vertex inputs with a buffer each, in location order, with their floats per vertex; the
// colour may have four. Tangent, uv1, skinIndex and skinWeight follow in the geometry
// records and are interleaved into one buffer at locations 9 to 12.
export const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
export const AUX_ATTRIBUTES = 4, AUX_STRIDE = 56;
// What a missing input reads, as the WebGPU host's buffer of zeros gives it.
export const MISSING = [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ] ];
export const VERTEX_COLOR_SLOT = 3, INSTANCE_SLOT = 4, INSTANCE_COLOR_SLOT = 8, AUX_LOCATION = 9, QUAD_B = 13, QUAD_COLOR_B = 14;
export const LOOP_KEY = 1 << 7, RGBA_COLOR_KEY = 1 << 8, WIREFRAME_KEY = 1 << 9, PREMULTIPLIED_KEY = 1 << 14, QUAD_KEY = 1 << 15;
// Texture units: the twelve slots of a draw (the vertex stage reads slot 9), then the
// shadow maps, the environments, the transmission copy, the VSM moments, and the bones.
export const SLOTS = 12, SHADOW_UNIT = 12, ENVIRONMENT_UNIT = 13, TRANSMISSION_UNIT = 14, VSM_UNIT = 15, BONE_UNIT = 16;
export const OBJECT_STRIDE = 256, MATERIAL_STRIDE = 1024, MATERIAL_FLOATS = 256;
// Indices of a wireframe over `count` triangle vertices: two per edge, three edges per triangle.
export const wireframeCount = ( count ) => Math.floor( count / 3 ) * 6;

// A cube face: an image, `{ data, width, height }`, or a DataTexture (as three.js accepts).
export const cubeFace = ( face ) => ( face?.isDataTexture ? face.image : face );
// Whether all six square faces of a cube texture have arrived.
export const cubeReady = ( images ) => Array.isArray( images ) && images.length === 6 && images.map( cubeFace ).every( ( image, i, faces ) => image && ( image.data || image.width > 0 ) && image.width === faces[ 0 ].width );

// The packed custom blending in a material block: the w of its 13th vector.
export const CUSTOM_BLENDING_FLOAT = 51;
