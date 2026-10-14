export * from './wamr3d_wasm.js';
import type { InitInput, World } from './wamr3d_wasm.js';

/** Loads and instantiates the WebAssembly module. Call once, before anything else. */
export function init( source?: InitInput | Promise<InitInput> ): Promise<void>;

/** The module's linear memory. */
export function memory(): WebAssembly.Memory;

/**
 * A zero-copy Float32Array over a geometry attribute. Unusable after the module's
 * memory grows; create it right before use.
 */
export function attributeView( world: World, geometry: bigint, name: string ): Float32Array;

/** The scalar helpers, also available as individual exports. */
export const MathUtils: Readonly<{
	degToRad( degrees: number ): number;
	radToDeg( radians: number ): number;
	clamp( value: number, min: number, max: number ): number;
	lerp( x: number, y: number, t: number ): number;
	inverseLerp( x: number, y: number, value: number ): number;
	mapLinear( x: number, a1: number, a2: number, b1: number, b2: number ): number;
	damp( x: number, y: number, lambda: number, dt: number ): number;
	pingpong( x: number, length: number ): number;
	smoothstep( x: number, min: number, max: number ): number;
	smootherstep( x: number, min: number, max: number ): number;
	euclideanModulo( n: number, m: number ): number;
	isPowerOfTwo( value: number ): boolean;
	ceilPowerOfTwo( value: number ): number;
	floorPowerOfTwo( value: number ): number;
	seededRandom( seed?: number ): number;
	/** Random integer in [low, high], both included. */
	randInt( low: number, high: number ): number;
	/** Random float in [low, high). */
	randFloat( low: number, high: number ): number;
	/** Random float in (-range / 2, range / 2]. */
	randFloatSpread( range: number ): number;
	/** A version 4 UUID in lower case. */
	generateUUID(): string;
}>;
