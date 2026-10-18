// Output folder, case counts and the index encodings shared with engine/math/tests/parity.rs.
//
// Part of the math fixture generator; `../generate.mjs` runs it.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT_DIR = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../..' );
export const RANDOM_CASES = 8;
export const PI = Math.PI;
export const f = Math.fround;

// Index encodings shared with engine/math/tests/parity.rs.
export const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];
export const PROPER_ORDERS = [ 'XYX', 'YZY', 'ZXZ', 'XZX', 'YXY', 'ZYZ' ];
export const COLOR_SPACES = [ '', 'srgb', 'srgb-linear' ];
export const COORD_SYSTEMS = [ 2000, 2001 ]; // WebGLCoordinateSystem, WebGPUCoordinateSystem
export const ARRAY_TYPES = [ Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array, Int16Array, Int8Array, Uint8ClampedArray ];
