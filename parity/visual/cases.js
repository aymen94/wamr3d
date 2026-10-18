// The visual parity cases, written once against a library object `L`. generate mode
// passes three.js with its WebGPU renderer and stores the image; check mode passes
// WAMR3D and compares.

import { BACKGROUND } from './cases/common.js';
import { BASIC } from './cases/basic.js';
import { SCENES } from './cases/scenes.js';
import { MAPS } from './cases/maps.js';

export { WIDTH, HEIGHT } from './cases/common.js';

// Only `run.mjs --generate` loads this: the three.js WebGPU build that draws the
// reference images. Checking against the stored images needs no three.js.
export const REFERENCE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.webgpu.js';

// Agreed tolerance (DECISIONS.md D27): mean absolute difference per channel, of 255,
// and the fraction of pixels with any channel off by more than PIXEL_THRESHOLD.
export const MEAN_LIMIT = 1.5, DIFFERENT_LIMIT = 0.02, PIXEL_THRESHOLD = 12;

// Every case by name, in the order they run.
export const CASES = { ...BASIC, ...SCENES, ...MAPS };

export const BACKGROUND_RGB = [ BACKGROUND >> 16, BACKGROUND >> 8 & 255, BACKGROUND & 255 ];
