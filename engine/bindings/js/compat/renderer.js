// The WebGPU renderer of the object API.

import * as W from '../index.js';
import { createBackend } from '../webgpu.js';
import { createWebGLBackend } from '../webgl.js';
import { CustomToneMapping, EquirectangularReflectionMapping, EquirectangularRefractionMapping, NoToneMapping, PCFShadowMap, UnsignedByteType } from './constants.js';
import { ignored, instanceSources, w } from './engine.js';
import { FrameEnvironment, environmentReady } from './materials.js';
import { Color, Matrix4 } from './math.js';
import { backends, textureSources } from './textures.js';

// ---------------------------------------------------------------- renderer

let frameStamp = 0;
const IDENTITY3 = new Float32Array( [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] );
const linear = ( { r, g, b } ) => ( { r, g, b, a: 1 } );
const BACKENDS = [ 'auto', 'webgpu', 'webgl' ];

/**
 * The drawing backend for a canvas. `'webgpu'` and `'webgl'` use that API or fail;
 * `'auto'` tries WebGPU on a GPU, then WebGL 2, then the browser's software WebGPU
 * adapter, and reports a fallback once on the console.
 */
async function createRenderBackend( canvas, { backend, antialias, powerPreference } ) {

	if ( backend === 'webgpu' ) return createBackend( canvas, { antialias, powerPreference } );
	if ( backend === 'webgl' ) return createWebGLBackend( canvas, { antialias, powerPreference } );
	const failures = [];

	for ( const attempt of [
		() => createBackend( canvas, { antialias, powerPreference } ),
		() => createWebGLBackend( canvas, { antialias, powerPreference } ),
		() => createBackend( canvas, { antialias, fallbackAdapter: true } )
	] ) {

		try {

			const created = await attempt();
			if ( failures.length > 0 ) console.info( `${failures.join( '; ' )}: drawing with ${created.name === 'webgl' ? 'WebGL 2' : 'software WebGPU'}` );
			return created;

		} catch ( error ) {

			failures.push( error.message );

		}

	}

	throw new Error( `WAMR3D: no way to draw in this browser (${failures.join( '; ' )})` );

}

/**
 * Draws a scene with WebGPU, or with WebGL 2 where WebGPU is missing. `await
 * renderer.init()` before the first `render`.
 *
 * `backend`: `'auto'` (the default) picks WebGPU and falls back to WebGL 2; `'webgpu'` or
 * `'webgl'` use only that API. `forceWebGL: true`, as in three.js, is `backend: 'webgl'`.
 * After `init()`, `renderer.backend.isWebGPUBackend` or `isWebGLBackend` says which runs.
 */
export class WebGPURenderer {

	constructor( { canvas, antialias = false, powerPreference, backend = 'auto', forceWebGL = false } = {} ) {

		if ( ! BACKENDS.includes( backend ) ) throw new Error( `WAMR3D: unknown backend "${backend}" (use ${BACKENDS.join( ', ' )})` );
		this.domElement = canvas ?? document.createElement( 'canvas' );
		this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0 } };
		this._options = { antialias, powerPreference, backend: forceWebGL ? 'webgl' : backend };
		/** The backend drawing the frames once `init()` has finished, otherwise null. */
		this.backend = null;
		this._pixelRatio = 1;
		this._width = this.domElement.width;
		this._height = this.domElement.height;
		this._clearColor = new Color( 0x000000 );
		this.toneMapping = NoToneMapping;
		this.toneMappingExposure = 1;
		this.shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false, type: PCFShadowMap };
		this._backend = null;
		this._frame = null;
		this._renderTarget = null;
		this._initializing = null;
		this._loop = null;
		this._environment = new FrameEnvironment();
		// inverse rotations of the environment and of the background, kept while unchanged
		this._rotations = [ { key: [ NaN, NaN, NaN, '' ], matrix: new Float32Array( 9 ) }, { key: [ NaN, NaN, NaN, '' ], matrix: new Float32Array( 9 ) } ];
		this._rotationMatrix = null;

	}

	init() {

		return this._initializing ??= createRenderBackend( this.domElement, this._options ).then( ( backend ) => {

			this._backend = this.backend = backend;
			backends.add( backend );
			this._frame = new W.Renderer();
			return this;

		} );

	}

	getPixelRatio() {

		return this._pixelRatio;

	}

	setPixelRatio( value ) {

		this._pixelRatio = value;
		this.setSize( this._width, this._height, false );

	}

	setSize( width, height, updateStyle = true ) {

		this._width = width;
		this._height = height;
		this.domElement.width = Math.floor( width * this._pixelRatio );
		this.domElement.height = Math.floor( height * this._pixelRatio );

		if ( updateStyle ) {

			this.domElement.style.width = width + 'px';
			this.domElement.style.height = height + 'px';

		}

	}

	getSize( target ) {

		return target.set( this._width, this._height );

	}

	/** Draws into `target` until set back to null (the canvas). */
	setRenderTarget( target ) {

		this._renderTarget = target ?? null;

	}

	getRenderTarget() {

		return this._renderTarget;

	}

	setClearColor( color ) {

		this._clearColor.set( color );

	}

	getClearColor( target ) {

		return target.copy( this._clearColor );

	}

	render( scene, camera ) {

		if ( this._backend === null ) return;

		if ( scene.matrixWorldAutoUpdate ) scene.updateMatrixWorld();
		if ( camera.parent === null && camera.matrixWorldAutoUpdate ) camera.updateMatrixWorld();

		const sky = [ 0, 0, 0 ], ground = [ 0, 0, 0 ], frame = this._frame, MAX_LIGHTS = W.Renderer.maxLights();
		let lights = 0;
		if ( this.toneMapping === CustomToneMapping ) ignored( 'CustomToneMapping' );
		frame.setToneMapping( this.toneMapping, this.toneMappingExposure );
		const shadows = this.shadowMap.enabled === true;
		frame.setShadowsEnabled( shadows );
		if ( shadows && this.shadowMap.type !== PCFShadowMap ) ignored( 'shadowMap.type other than PCFShadowMap (drawn as PCFShadowMap)' );
		const stamp = ++ frameStamp;
		frame.clearLights();
		const environment = this._environment;
		environment.begin( scene );
		const stack = [ scene ];

		while ( stack.length > 0 ) {

			const object = stack.pop();
			if ( ! object._visible ) continue;
			if ( object.isLOD && object.autoUpdate ) object.update( camera );

			if ( object._material !== undefined ) {

				// Materials are shared by many objects; each is sent once per frame.
				const material = object._material;

				if ( Array.isArray( material ) ) {

					for ( const each of material ) if ( each._frame !== stamp ) {

						each._frame = stamp;
						each._sync( environment );

					}

				} else if ( material._frame !== stamp ) {

					material._frame = stamp;
					material._sync( environment );

				}

				if ( object.isSprite ) object._syncCenter();

			} else if ( object.isLight ) {

				const { r, g, b } = object.color, k = object.intensity;

				if ( object.isDirectionalLight || object.isPointLight || object.isSpotLight ) {

					if ( ++ lights > MAX_LIGHTS ) {

						ignored( `more than ${MAX_LIGHTS} directional, point and spot lights` );

					} else {

						const from = w().matrixWorld( object.handle ), to = object.target ? w().matrixWorld( object.target.handle ) : null;
						if ( object.isDirectionalLight ) frame.addDirectionalLight( from[ 12 ] - to[ 12 ], from[ 13 ] - to[ 13 ], from[ 14 ] - to[ 14 ], r, g, b, k );
						else if ( object.isPointLight ) frame.addPointLight( from[ 12 ], from[ 13 ], from[ 14 ], r, g, b, k, object.distance, object.decay );
						else frame.addSpotLight( from[ 12 ], from[ 13 ], from[ 14 ], to[ 12 ], to[ 13 ], to[ 14 ], r, g, b, k, object.distance, object.decay, object.angle, object.penumbra );

						if ( shadows && object.castShadow ) {

							const shadow = object.shadow, c = shadow.camera, size = shadow.mapSize;
							if ( object.isPointLight ) ignored( 'shadows of point lights' );
							else if ( object.isDirectionalLight ) frame.setLastLightShadow( true, c.left, c.right, c.top, c.bottom, c.near, c.far, to[ 12 ], to[ 13 ], to[ 14 ], shadow.bias, shadow.normalBias, shadow.intensity, shadow.radius, size.width, size.height );
							else frame.setLastLightShadow( false, 2 * object.angle * shadow.focus * 180 / Math.PI, size.width / size.height * shadow.aspect, 0, 0, c.near, object.distance || c.far, to[ 12 ], to[ 13 ], to[ 14 ], shadow.bias, shadow.normalBias, shadow.intensity, shadow.radius, size.width, size.height );

						}

					}

				} else if ( object.isHemisphereLight ) {

					const c = object.groundColor;
					sky[ 0 ] += r * k; sky[ 1 ] += g * k; sky[ 2 ] += b * k;
					ground[ 0 ] += c.r * k; ground[ 1 ] += c.g * k; ground[ 2 ] += c.b * k;

				} else if ( object.isAmbientLight ) {

					sky[ 0 ] += r * k; sky[ 1 ] += g * k; sky[ 2 ] += b * k;
					ground[ 0 ] += r * k; ground[ 1 ] += g * k; ground[ 2 ] += b * k;

				}

			}

			const children = object.children;
			for ( let i = 0; i < children.length; i ++ ) stack.push( children[ i ] );

		}

		this._frame.setAmbientLight( ...sky, ...ground );

		const map = environment.texture;
		if ( map !== null ) frame.setEnvironment( map.id, map.image.width, this._inverseRotation( environment.rotation, 0 ) );
		else frame.clearEnvironment();
		this._syncBackground( scene );

		const fog = scene.fog;
		if ( fog ) frame.setFog( fog.isFogExp2 ? 2 : 1, fog.color.r, fog.color.g, fog.color.b, fog.near ?? 0, fog.far ?? 0, fog.density ?? 0 );
		else frame.setFog( 0, 0, 0, 0, 0, 0, 0 );

		const backend = this._backend;
		const rt = this._renderTarget, texture = rt?.texture;
		const target = rt ? { id: texture.id, width: Math.max( 1, rt.width | 0 ), height: Math.max( 1, rt.height | 0 ), samples: rt.samples, type: texture.type === UnsignedByteType ? 'byte' : 'float', texture } : null;
		backend.render( w(), this._frame, scene.handle, camera.handle, linear( scene.background && scene.background.isColor ? scene.background : this._clearColor ), textureSources, instanceSources, target );
		this.info.render.calls = backend.info.calls;
		this.info.render.triangles = backend.info.triangles;
		this.info.memory.geometries = backend.info.geometries;

	}

	// The inverse of an Euler rotation as a column-major 3x3 matrix, kept in `slot` while
	// the angles stay the same.
	_inverseRotation( euler, slot ) {

		const { key, matrix } = this._rotations[ slot ], x = euler.x, y = euler.y, z = euler.z, order = euler.order;
		if ( x === key[ 0 ] && y === key[ 1 ] && z === key[ 2 ] && order === key[ 3 ] ) return matrix;
		key[ 0 ] = x;
		key[ 1 ] = y;
		key[ 2 ] = z;
		key[ 3 ] = order;
		const e = ( this._rotationMatrix ??= new Matrix4() ).makeRotationFromEuler( euler ).elements;
		// a rotation's inverse is its transpose
		matrix.set( [ e[ 0 ], e[ 4 ], e[ 8 ], e[ 1 ], e[ 5 ], e[ 9 ], e[ 2 ], e[ 6 ], e[ 10 ] ] );
		return matrix;

	}

	// A texture background as three.js draws it: equirectangular textures around the
	// camera (blurred from the prefiltered map when `backgroundBlurriness` is above 0),
	// other textures stretched over the frame. Colours are the clear colour instead.
	_syncBackground( scene ) {

		const frame = this._frame, background = scene.background;

		if ( ! background || background.isColor ) {

			frame.clearBackground();
			return;

		}

		if ( ! background.isTexture ) {

			ignored( 'a scene background that is not a Color or a Texture' );
			frame.clearBackground();
			return;

		}

		if ( ! environmentReady( background ) ) {

			frame.clearBackground();
			return;

		}

		const panorama = background.mapping === EquirectangularReflectionMapping || background.mapping === EquirectangularRefractionMapping;
		const blurriness = scene.backgroundBlurriness ?? 0, kind = panorama ? ( blurriness > 0 ? 1 : 0 ) : 2;
		if ( ! panorama && ( background.offset.x !== 0 || background.offset.y !== 0 || background.repeat.x !== 1 || background.repeat.y !== 1 || background.rotation !== 0 ) ) ignored( 'offset, repeat and rotation of a background texture' );
		const rotation = panorama ? this._inverseRotation( scene.backgroundRotation, 1 ) : IDENTITY3;
		frame.setBackground( background.id, kind, background.image.width, scene.backgroundIntensity ?? 1, blurriness, rotation );

	}

	async renderAsync( scene, camera ) {

		await this.init();
		this.render( scene, camera );

	}

	/** Calls `callback( time )` every animation frame; pass null to stop. */
	setAnimationLoop( callback ) {

		this._loop = callback;
		if ( callback === null ) return;
		this.init();

		const tick = ( time ) => {

			if ( this._loop !== callback ) return;
			requestAnimationFrame( tick );
			if ( this._backend !== null ) callback( time );

		};

		requestAnimationFrame( tick );

	}

	dispose() {

		this._loop = null;
		backends.delete( this._backend );
		this._backend?.dispose();
		this._frame?.free();
		this._backend = this._frame = this.backend = null;

	}

}

WebGPURenderer.prototype.isWebGPURenderer = true;

/**
 * The same renderer drawing with WebGL 2 (`backend: 'webgl'`), for code written for
 * three.js's `WebGLRenderer`. It starts `init()` itself; frames rendered before it has
 * finished are skipped, and `setAnimationLoop` waits for it.
 */
export class WebGLRenderer extends WebGPURenderer {

	constructor( parameters = {} ) {

		super( { ...parameters, backend: 'webgl' } );
		this.init().catch( ( error ) => console.error( error ) );

	}

}

WebGLRenderer.prototype.isWebGPURenderer = false;
WebGLRenderer.prototype.isWebGLRenderer = true;
