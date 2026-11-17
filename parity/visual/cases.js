// The visual parity cases, written once against a library object `L`. generate mode
// passes three.js with its WebGPU renderer and stores the image; check mode passes
// WAMR3D and compares. Cases in WEBGL_REFERENCE use GLSL, which three.js draws only with
// its WebGLRenderer: their references come from it, and WAMR3D draws them with WebGL 2.

import { BACKGROUND } from './cases/common.js';
import { BASIC } from './cases/basic.js';
import { SCENES } from './cases/scenes.js';
import { MAPS } from './cases/maps.js';
import { SHADER } from './cases/shader.js';

export { WIDTH, HEIGHT } from './cases/common.js';

// Only `run.mjs --generate` loads this: the three.js WebGPU build that draws the
// reference images. Checking against the stored images needs no three.js.
export const REFERENCE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.webgpu.js';
// The same release with the WebGLRenderer, for the cases in WEBGL_REFERENCE.
export const REFERENCE_WEBGL_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.module.js';

// Agreed tolerance against the stored three.js WebGPU renders: mean absolute difference per channel, of 255,
// and the fraction of pixels with any channel off by more than PIXEL_THRESHOLD.
export const MEAN_LIMIT = 1.5, DIFFERENT_LIMIT = 0.02, PIXEL_THRESHOLD = 12;

// Every case by name, in the order they run.
export const CASES = { ...BASIC, ...SCENES, ...MAPS, ...SHADER };

// The cases checked against three.js's WebGLRenderer, on WAMR3D's WebGL 2 backend.
export const WEBGL_REFERENCE = new Set( Object.keys( SHADER ) );

export const BACKGROUND_RGB = [ BACKGROUND >> 16, BACKGROUND >> 8 & 255, BACKGROUND & 255 ];
