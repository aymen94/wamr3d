// Clock, points, sprites and render targets.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { Vector2 } from './vectors.js';
import { ColorSpace } from './shapes.js';
import { Object3D } from './objects.js';
import { BufferGeometry } from './geometry.js';
import { AlphaMap, Material, MaterialParameters, Texture } from './materials.js';

export class Clock {

	constructor( autoStart?: boolean );
	autoStart: boolean;
	elapsedTime: number;
	running: boolean;
	start(): void;
	stop(): void;
	getElapsedTime(): number;
	getDelta(): number;

}

/** Present so that using it fails with a clear error. */
/** One pixel per vertex, as with the three.js WebGPU renderer. */
export class Points<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isPoints: true;
	geometry: G;
	material: M;

}

/** A quad facing the camera, sized by its scale. `Raycaster` needs its `camera` (set by `setFromCamera`) to pick it. */
export class Sprite<M extends Material = SpriteMaterial> extends Object3D {

	constructor( material?: M );
	readonly isSprite: true;
	readonly geometry: BufferGeometry;
	material: M;
	center: Vector2;

}

/** `size` and `sizeAttenuation` are kept but have no effect: points are one pixel. */
export class PointsMaterial extends Material {

	constructor( parameters?: MaterialParameters & { size?: number; sizeAttenuation?: boolean } );
	readonly isPointsMaterial: true;
	size: number;
	sizeAttenuation: boolean;

}

export interface SpriteMaterial extends AlphaMap {}
export class SpriteMaterial extends Material {

	constructor( parameters?: MaterialParameters & { rotation?: number; sizeAttenuation?: boolean } );
	readonly isSpriteMaterial: true;
	rotation: number;
	sizeAttenuation: boolean;

}

export const UnsignedByteType: 1009, FloatType: 1015, HalfFloatType: 1016;

export interface RenderTargetOptions {

	type?: 1009 | 1015 | 1016;
	samples?: number;
	depthBuffer?: boolean;
	generateMipmaps?: boolean;
	minFilter?: number;
	magFilter?: number;
	colorSpace?: ColorSpace;

}

/** Drawn into with `renderer.setRenderTarget( target )`; `texture` can be a material's map. Linear colour, no tone mapping. */
export class RenderTarget {

	constructor( width?: number, height?: number, options?: RenderTargetOptions );
	readonly isRenderTarget: true;
	width: number;
	height: number;
	samples: number;
	readonly texture: Texture;
	setSize( width: number, height: number ): void;
	dispose(): void;

}

export class WebGLRenderTarget extends RenderTarget {}
