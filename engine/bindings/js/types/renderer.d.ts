// WebGPURenderer and WebGLRenderer.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { ColorRepresentation, ToneMapping, init } from './core.js';
import { Vector2 } from './vectors.js';
import { Color, Plane } from './shapes.js';
import { Camera, Object3D, Scene } from './objects.js';
import { RenderTarget } from './rendering.js';

export interface WebGPURendererParameters {

	canvas?: HTMLCanvasElement;
	antialias?: boolean;
	powerPreference?: 'high-performance' | 'low-power';
	/** `'auto'` (default): WebGPU, else WebGL 2, else a software WebGPU adapter. `'webgpu'` or `'webgl'`: only that API. */
	backend?: 'auto' | 'webgpu' | 'webgl';
	/** As in three.js: the same as `backend: 'webgl'`. */
	forceWebGL?: boolean;

}

/** What draws the frames: WebGPU (`'webgpu'`, or `'webgpu-software'` on the browser's software adapter) or WebGL 2. */
export interface RenderBackend {

	readonly name: 'webgpu' | 'webgpu-software' | 'webgl';
	readonly isWebGPUBackend?: true;
	readonly isWebGLBackend?: true;

}

/** Draws a scene with WebGPU, or WebGL 2 where WebGPU is missing. `await renderer.init()` before the first `render`. */
export class WebGPURenderer {

	/** The backend drawing the frames, once `init()` has finished; otherwise null. */
	readonly backend: RenderBackend | null;

	/** Draws into `target` until set back to null (the canvas). */
	setRenderTarget( target: RenderTarget | null ): void;
	getRenderTarget(): RenderTarget | null;

	/** Applied when drawing to the canvas. `CustomToneMapping` is not supported and draws like `NoToneMapping`. */
	toneMapping: ToneMapping;
	toneMappingExposure: number;
	/** World-space planes clipping everything drawn (at most eight). */
	clippingPlanes: Plane[];
	/** Whether materials' own `clippingPlanes` apply. */
	localClippingEnabled: boolean;

	constructor( parameters?: WebGPURendererParameters );
	/** False on `WebGLRenderer`. */
	readonly isWebGPURenderer: boolean;
	domElement: HTMLCanvasElement;
	info: { render: { calls: number; triangles: number }; memory: { geometries: number } };
	init(): Promise<this>;
	getPixelRatio(): number;
	setPixelRatio( value: number ): void;
	setSize( width: number, height: number, updateStyle?: boolean ): void;
	getSize( target: Vector2 ): Vector2;
	setClearColor( color: ColorRepresentation ): void;
	getClearColor( target: Color ): Color;
	render( scene: Scene, camera: Camera ): void;
	renderAsync( scene: Scene, camera: Camera ): Promise<void>;
	/** Builds the shaders that rendering the scene needs without drawing, so that the first `render` does not wait for them. */
	compileAsync( scene: Object3D, camera: Camera, targetScene?: Scene | null ): Promise<void>;
	setAnimationLoop( callback: ( ( time: number ) => void ) | null ): void;
	dispose(): void;

}

/** The same renderer drawing with WebGL 2, for code written for three.js's `WebGLRenderer`; it starts `init()` itself. */
export class WebGLRenderer extends WebGPURenderer {

	readonly isWebGLRenderer: true;

}
