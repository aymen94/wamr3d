// WebGL 2 host for the WAMR3D renderer.
//
// The same frames as the WebGPU host (`webgpu.js`): the engine decides what is drawn and
// prepares every uniform; this file turns that into WebGL 2 calls with the engine's GLSL
// (`Renderer.glslSource`). It is used when WebGPU is missing or when asked for. The
// uniform blocks are uploaded as the engine packs them: their std140 layout matches.

import { Renderer, memory } from './index.js';
import { MIPMAPPED } from './webgpu/formats.js';
import { EXTRA_LODS, LOD_MIN, cubeUVLevel } from './webgpu/environment.js';

const UNUSED_FRAMES = 300;
// Vertex inputs in location order, with their floats per vertex; the colour may have four.
const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
// What a missing input reads, as the WebGPU host's buffer of zeros gives it.
const MISSING = [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ] ];
const VERTEX_COLOR_SLOT = 3, INSTANCE_SLOT = 4, INSTANCE_COLOR_SLOT = 8, DRAW_FIELDS = 6;
const LOOP_KEY = 1 << 7;
// Texture units: the seven material maps, then the shadow maps and the environment.
const SHADOW_UNIT = 7, ENVIRONMENT_UNIT = 8;
const MAP_SAMPLERS = [ 'map_texture', 'normal_map', 'roughness_map', 'metalness_map', 'emissive_map', 'alpha_map', 'ao_map' ];
const OBJECT_STRIDE = 256;

export async function createWebGLBackend( canvas, { antialias = true, powerPreference = 'high-performance' } = {} ) {

	const gl = canvas.getContext( 'webgl2', { antialias, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, powerPreference } );
	if ( ! gl ) throw new Error( 'WAMR3D: WebGL 2 is not available in this browser' );

	// Half-float targets carry tone mapping, render targets of float type and the
	// prefiltered environments; without them those fall back as `warn` reports.
	const floatTargets = gl.getExtension( 'EXT_color_buffer_float' ) !== null;
	const samples = antialias ? Math.min( 4, gl.getParameter( gl.MAX_SAMPLES ) ) : 0;
	const MAX_SHADOWS = Renderer.maxShadows(), TEXTURE_SLOTS = Renderer.textureSlots();
	const GEOMETRY_FIELDS = Renderer.geometryStateSize();
	const TONE_MAPPING = Renderer.toneMappingIndex(), EXPOSURE = Renderer.toneMappingExposureIndex();
	// Object uniforms are bound as ranges of one buffer when the device allows 256-byte offsets.
	const ranges = OBJECT_STRIDE % gl.getParameter( gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT ) === 0;
	const warned = new Set();
	const warn = ( what ) => {

		if ( warned.has( what ) ) return;
		warned.add( what );
		console.warn( `WAMR3D (WebGL 2): ${what}` );

	};

	const WRAP = { 1000: gl.REPEAT, 1001: gl.CLAMP_TO_EDGE, 1002: gl.MIRRORED_REPEAT };
	const MIN_FILTER = { 1003: gl.NEAREST, 1004: gl.NEAREST_MIPMAP_NEAREST, 1005: gl.NEAREST_MIPMAP_LINEAR, 1006: gl.LINEAR, 1007: gl.LINEAR_MIPMAP_NEAREST, 1008: gl.LINEAR_MIPMAP_LINEAR };

	// ---------------------------------------------------------------- programs

	const programs = new Map();

	function compile( type, source, label ) {

		const shader = gl.createShader( type );
		gl.shaderSource( shader, source );
		gl.compileShader( shader );
		if ( ! gl.getShaderParameter( shader, gl.COMPILE_STATUS ) ) throw new Error( `WAMR3D: GLSL ${label}: ${gl.getShaderInfoLog( shader )}` );
		return shader;

	}

	// `defines` go after the `#version` line.
	function program( key, vertex, fragment, defines = '' ) {

		let value = programs.get( key );
		if ( value ) return value;
		const source = ( name ) => {

			const text = Renderer.glslSource( name );
			return defines ? text.replace( '\n', '\n' + defines + '\n' ) : text;

		};

		const id = gl.createProgram();
		gl.attachShader( id, compile( gl.VERTEX_SHADER, source( vertex ), vertex ) );
		gl.attachShader( id, compile( gl.FRAGMENT_SHADER, source( fragment ), fragment ) );
		gl.linkProgram( id );
		if ( ! gl.getProgramParameter( id, gl.LINK_STATUS ) ) throw new Error( `WAMR3D: GLSL ${key}: ${gl.getProgramInfoLog( id )}` );
		gl.useProgram( id );

		const block = ( name, binding ) => {

			const index = gl.getUniformBlockIndex( id, name );
			if ( index !== gl.INVALID_INDEX ) gl.uniformBlockBinding( id, index, binding );

		};

		block( 'FrameBlock', 0 );
		block( 'ObjectBlock', 1 );
		block( 'BackgroundBlock', 2 );
		const unit = ( name, value_ ) => {

			const location = gl.getUniformLocation( id, name );
			if ( location !== null ) gl.uniform1i( location, value_ );

		};

		MAP_SAMPLERS.forEach( ( name, i ) => unit( name, i ) );
		unit( 'shadow_map', SHADOW_UNIT );
		unit( 'environment_map', ENVIRONMENT_UNIT );
		unit( 'background_map', 0 );
		unit( 'source', 0 );
		const flip = gl.getUniformLocation( id, 'flip_y' );
		if ( flip !== null ) gl.uniform1f( flip, 1 );
		value = { id, uniform: ( name ) => gl.getUniformLocation( id, name ) };
		programs.set( key, value );
		return value;

	}

	const meshProgram = ( srgb ) => program( srgb ? 'mesh:srgb' : 'mesh', 'mesh.vert', 'mesh.frag', srgb ? '#define OUTPUT_SRGB 1' : '' );
	const backgroundProgram = ( srgb ) => program( srgb ? 'background:srgb' : 'background', 'fullscreen.vert', 'background.frag', srgb ? '#define OUTPUT_SRGB 1' : '' );

	// ---------------------------------------------------------------- textures

	function newTexture() {

		const id = gl.createTexture();
		gl.bindTexture( gl.TEXTURE_2D, id );
		return id;

	}

	function parameters( source, levels ) {

		const min = source?.minFilter ?? 1006, mag = source?.magFilter ?? 1006;
		let minFilter = MIN_FILTER[ min ] ?? gl.LINEAR;
		if ( levels === 1 ) minFilter = MIPMAPPED.has( min ) ? ( min === 1004 || min === 1005 ? gl.NEAREST : gl.LINEAR ) : minFilter;
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag === 1003 ? gl.NEAREST : gl.LINEAR );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, WRAP[ source?.wrapS ] ?? gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, WRAP[ source?.wrapT ] ?? gl.CLAMP_TO_EDGE );

	}

	const white = newTexture();
	gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array( [ 255, 255, 255, 255 ] ) );
	parameters( null, 1 );

	// WebGL ignores UNPACK_FLIP_Y for ImageBitmap, so a bitmap is turned over on a canvas.
	function upright( bitmap ) {

		const flipped = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas( bitmap.width, bitmap.height ) : Object.assign( document.createElement( 'canvas' ), { width: bitmap.width, height: bitmap.height } );
		const context = flipped.getContext( '2d' );
		context.translate( 0, bitmap.height );
		context.scale( 1, - 1 );
		context.drawImage( bitmap, 0, 0 );
		return flipped;

	}

	const textures = new Map();
	let frameNumber = 0, drawingInto = 0;

	// A material's texture, uploaded when the source's version changes; white while an
	// image is still loading.
	function texture( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );

		if ( source?.isRenderTargetTexture ) {

			if ( id === drawingInto ) return white;
			return renderTargets.get( id )?.color ?? white;

		}

		const image = source?.image;
		if ( ! image || ! ( image.data || image.width > 0 ) ) return white;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.texture;

		const { width, height } = image, srgb = source.colorSpace === 'srgb';
		const levels = source.generateMipmaps !== false && MIPMAPPED.has( source.minFilter ) ? 2 : 1;
		if ( entry.texture ) gl.deleteTexture( entry.texture );
		entry.texture = newTexture();
		const format = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;

		if ( image.data ) {

			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
			gl.texImage2D( gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data );

		} else {

			let pixels = image, flip = source.flipY !== false;

			if ( flip && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ) {

				pixels = upright( image );
				flip = false;

			}

			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, flip );
			gl.texImage2D( gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );

		}

		if ( levels > 1 ) gl.generateMipmap( gl.TEXTURE_2D );
		parameters( source, levels );
		entry.version = source.version;
		return entry.texture;

	}

	// ---------------------------------------------------------------- render targets

	const renderTargets = new Map();

	function renderTarget( target ) {

		let entry = renderTargets.get( target.id );
		const float = target.type !== 'byte' && floatTargets;
		if ( target.type !== 'byte' && ! floatTargets ) warn( 'float render targets need EXT_color_buffer_float; drawn with 8 bits per channel' );
		if ( target.samples > 1 ) warn( 'multisampled render targets are drawn without multisampling' );
		if ( entry && entry.width === target.width && entry.height === target.height && entry.float === float ) return entry;
		if ( entry ) entry.release();

		const color = newTexture();
		gl.texImage2D( gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, target.width, target.height, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null );
		parameters( target.texture, 1 );
		const depth = gl.createRenderbuffer();
		gl.bindRenderbuffer( gl.RENDERBUFFER, depth );
		gl.renderbufferStorage( gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, target.width, target.height );
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER, framebuffer );
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0 );
		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		entry = {
			width: target.width, height: target.height, float, color, framebuffer, release() {

				gl.deleteTexture( color );
				gl.deleteRenderbuffer( depth );
				gl.deleteFramebuffer( framebuffer );

			}
		};
		renderTargets.set( target.id, entry );
		return entry;

	}

	// The linear target of a tone-mapped frame (multisampled when antialiased, then
	// resolved), and the output pass that tone-maps it onto the canvas.
	let hdr = null;

	function hdrTarget( width, height ) {

		if ( hdr && hdr.width === width && hdr.height === height ) return hdr;
		hdr?.release();
		const color = newTexture();
		gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null );
		parameters( null, 1 );
		const resolve = gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER, resolve );
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0 );
		const buffers = [];
		const storage = ( format, count ) => {

			const buffer = gl.createRenderbuffer();
			gl.bindRenderbuffer( gl.RENDERBUFFER, buffer );
			if ( count > 0 ) gl.renderbufferStorageMultisample( gl.RENDERBUFFER, count, format, width, height );
			else gl.renderbufferStorage( gl.RENDERBUFFER, format, width, height );
			buffers.push( buffer );
			return buffer;

		};

		let draw = resolve;

		if ( samples > 0 ) {

			draw = gl.createFramebuffer();
			gl.bindFramebuffer( gl.FRAMEBUFFER, draw );
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, storage( gl.RGBA16F, samples ) );

		}

		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, storage( gl.DEPTH_COMPONENT24, samples ) );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		hdr = {
			width, height, color, draw, resolve, release() {

				gl.deleteTexture( color );
				for ( const buffer of buffers ) gl.deleteRenderbuffer( buffer );
				gl.deleteFramebuffer( resolve );
				if ( draw !== resolve ) gl.deleteFramebuffer( draw );

			}
		};
		return hdr;

	}

	// ---------------------------------------------------------------- buffers

	const info = { calls: 0, shadowCalls: 0, triangles: 0, candidates: 0, geometries: 0, textures: 0, pipelines: 0, uploads: 0 };

	function upload( target, data, existing ) {

		const buffer = existing ?? gl.createBuffer();
		gl.bindBuffer( target, buffer );
		gl.bufferData( target, data, gl.DYNAMIC_DRAW );
		info.uploads ++;
		return buffer;

	}

	const geometries = new Map(), instanced = new Map();
	const entries = [], perInstance = [], distinct = [], setTextures = [];

	// GPU buffers follow the engine's data, re-uploaded when an attribute's version changes
	// (see `Renderer.geometryState`).
	function geometry( world, state, o ) {

		const slot = state[ o ], generation = state[ o + 1 ], vertices = state[ o + 2 ];
		let entry = geometries.get( slot );

		if ( entry && entry.generation !== generation ) {

			release( entry );
			entry = undefined;

		}

		if ( ! entry ) geometries.set( slot, entry = { generation, handle: BigInt( generation ) << 32n | BigInt( slot ), buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], sizes: [ 0, 0, 0, 0 ], index: null, indexVersion: - 1, checked: 0 } );
		entry.checked = frameNumber;
		const colorSize = state[ o + 4 + ATTRIBUTES.length * 2 ];

		for ( let i = 0, p = o + 3; i < ATTRIBUTES.length; i ++, p += 2 ) {

			const version = state[ p ], address = state[ p + 1 ], size = i === VERTEX_COLOR_SLOT ? colorSize : ATTRIBUTES[ i ][ 1 ];

			if ( address === 0 ) {

				if ( entry.buffers[ i ] ) gl.deleteBuffer( entry.buffers[ i ] );
				entry.buffers[ i ] = null;
				entry.versions[ i ] = - 1;
				continue;

			}

			if ( version === entry.versions[ i ] && size === entry.sizes[ i ] ) continue;
			entry.buffers[ i ] = upload( gl.ARRAY_BUFFER, new Float32Array( memory().buffer, address, vertices * size ), entry.buffers[ i ] );
			entry.versions[ i ] = version;
			entry.sizes[ i ] = size;

		}

		const indexVersion = state[ o + 3 + ATTRIBUTES.length * 2 ];

		if ( indexVersion !== entry.indexVersion ) {

			const index = world.getIndex( entry.handle );

			if ( index.length === 0 ) {

				if ( entry.index ) gl.deleteBuffer( entry.index );
				entry.index = null;

			} else {

				entry.index = upload( gl.ELEMENT_ARRAY_BUFFER, index, entry.index );

			}

			entry.indexVersion = indexVersion;

		}

		return entry;

	}

	function instances( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );
		if ( ! source ) return null;
		let entry = instanced.get( id );
		if ( ! entry ) instanced.set( id, entry = { matrix: null, color: null, matrixVersion: - 1, colorVersion: - 1, checked: 0 } );
		entry.checked = frameNumber;

		if ( entry.matrixVersion !== source.matrixVersion ) {

			entry.matrix = upload( gl.ARRAY_BUFFER, source.matrix, entry.matrix );
			entry.matrixVersion = source.matrixVersion;

		}

		if ( source.color === null ) {

			if ( entry.color ) gl.deleteBuffer( entry.color );
			entry.color = null;
			entry.colorVersion = - 1;

		} else if ( entry.colorVersion !== source.colorVersion ) {

			entry.color = upload( gl.ARRAY_BUFFER, source.color, entry.color );
			entry.colorVersion = source.colorVersion;

		}

		return entry;

	}

	function release( entry ) {

		for ( const buffer of entry.buffers ) if ( buffer ) gl.deleteBuffer( buffer );
		if ( entry.index ) gl.deleteBuffer( entry.index );

	}

	// Instance inputs advance per instance; without instances they hold an identity matrix.
	for ( let location = INSTANCE_SLOT; location <= INSTANCE_COLOR_SLOT; location ++ ) gl.vertexAttribDivisor( location, 1 );

	function bindGeometry( entry, positionOnly = false ) {

		for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) {

			const buffer = positionOnly && slot > 0 ? null : entry.buffers[ slot ];

			if ( buffer ) {

				gl.enableVertexAttribArray( slot );
				gl.bindBuffer( gl.ARRAY_BUFFER, buffer );
				gl.vertexAttribPointer( slot, entry.sizes[ slot ], gl.FLOAT, false, 0, 0 );

			} else {

				gl.disableVertexAttribArray( slot );
				gl.vertexAttrib4f( slot, ...MISSING[ slot ] );

			}

		}

		gl.bindBuffer( gl.ELEMENT_ARRAY_BUFFER, entry.index );

	}

	function bindInstances( instance ) {

		for ( let column = 0; column < 4; column ++ ) {

			const location = INSTANCE_SLOT + column;

			if ( instance ) {

				gl.enableVertexAttribArray( location );
				gl.bindBuffer( gl.ARRAY_BUFFER, instance.matrix );
				gl.vertexAttribPointer( location, 4, gl.FLOAT, false, 64, column * 16 );

			} else {

				gl.disableVertexAttribArray( location );
				gl.vertexAttrib4f( location, column === 0 ? 1 : 0, column === 1 ? 1 : 0, column === 2 ? 1 : 0, column === 3 ? 1 : 0 );

			}

		}

		if ( instance?.color ) {

			gl.enableVertexAttribArray( INSTANCE_COLOR_SLOT );
			gl.bindBuffer( gl.ARRAY_BUFFER, instance.color );
			gl.vertexAttribPointer( INSTANCE_COLOR_SLOT, 3, gl.FLOAT, false, 0, 0 );

		} else {

			gl.disableVertexAttribArray( INSTANCE_COLOR_SLOT );
			gl.vertexAttrib4f( INSTANCE_COLOR_SLOT, 1, 1, 1, 1 );

		}

	}

	// Passes that draw a full-screen triangle read no vertex arrays.
	function unbindArrays() {

		for ( let location = 0; location <= INSTANCE_COLOR_SLOT; location ++ ) gl.disableVertexAttribArray( location );

	}

	// ---------------------------------------------------------------- state

	function applyState( key ) {

		const side = key & 3;

		if ( side === 2 ) gl.disable( gl.CULL_FACE );
		else {

			gl.enable( gl.CULL_FACE );
			gl.cullFace( side === 0 ? gl.BACK : gl.FRONT );

		}

		if ( key & 4 ) {

			gl.enable( gl.BLEND );
			gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA );

		} else gl.disable( gl.BLEND );

		gl.depthMask( ( key & 8 ) !== 0 );
		gl.depthFunc( key & 16 ? gl.LEQUAL : gl.ALWAYS );

	}

	function mode( key ) {

		const topology = key >> 5 & 3;
		if ( topology === 0 ) return gl.TRIANGLES;
		if ( topology === 1 ) return key & LOOP_KEY ? gl.LINE_LOOP : gl.LINE_STRIP;
		return topology === 2 ? gl.LINES : gl.POINTS;

	}

	function draw( key, entry, start, vertices, copies ) {

		if ( entry.index ) gl.drawElementsInstanced( mode( key ), vertices, gl.UNSIGNED_INT, start * 4, copies );
		else gl.drawArraysInstanced( mode( key ), start, vertices, copies );

	}

	const frameBuffer = gl.createBuffer(), objectBuffer = gl.createBuffer(), shadowObjectBuffer = gl.createBuffer(), backgroundBuffer = gl.createBuffer();
	let objectCapacity = 0;

	// The object uniforms of draw `i` of `buffer`, uploaded from `data` when ranges are not
	// supported.
	function bindObject( buffer, i, data ) {

		if ( ranges ) gl.bindBufferRange( gl.UNIFORM_BUFFER, 1, buffer, i * OBJECT_STRIDE, OBJECT_STRIDE );
		else {

			gl.bindBuffer( gl.UNIFORM_BUFFER, buffer );
			gl.bufferData( gl.UNIFORM_BUFFER, data.subarray( i * OBJECT_STRIDE / 4, ( i + 1 ) * OBJECT_STRIDE / 4 ), gl.DYNAMIC_DRAW );
			gl.bindBufferBase( gl.UNIFORM_BUFFER, 1, buffer );

		}

	}

	// ---------------------------------------------------------------- shadows

	let shadowTexture = null, shadowWidth = 0, shadowHeight = 0;
	const shadowFramebuffer = gl.createFramebuffer();

	function ensureShadowTexture( width, height ) {

		if ( shadowTexture && shadowWidth === width && shadowHeight === height ) return;
		if ( shadowTexture ) gl.deleteTexture( shadowTexture );
		shadowTexture = gl.createTexture();
		gl.bindTexture( gl.TEXTURE_2D_ARRAY, shadowTexture );
		gl.texImage3D( gl.TEXTURE_2D_ARRAY, 0, gl.DEPTH_COMPONENT24, width, height, MAX_SHADOWS, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE );
		gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL );
		shadowWidth = width;
		shadowHeight = height;

	}

	// Depth only, one layer per shadow-casting light, casters with the main pass's buffers.
	function drawShadows( renderer, instanceSources ) {

		const passes = renderer.shadowCount();
		if ( passes === 0 ) return 0;
		const [ width, height ] = renderer.shadowMapSize();
		ensureShadowTexture( width, height );
		const shadow = program( 'shadow', 'shadow.vert', 'shadow.frag' );
		const camera = shadow.uniform( 'shadow_view_projection' );
		gl.useProgram( shadow.id );
		gl.bindFramebuffer( gl.FRAMEBUFFER, shadowFramebuffer );
		gl.drawBuffers( [ gl.NONE ] );
		gl.disable( gl.BLEND );
		gl.depthMask( true );
		gl.depthFunc( gl.LEQUAL );
		let calls = 0;

		for ( let p = 0; p < passes; p ++ ) {

			const passInfo = renderer.shadowPassInfo( p ), draws = renderer.shadowDrawInfo( p ), slots = renderer.shadowDrawGeometrySlots( p );
			const data = renderer.shadowObjectUniforms( p );
			gl.framebufferTextureLayer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, shadowTexture, 0, passInfo[ 0 ] );
			gl.viewport( 0, 0, passInfo[ 1 ], passInfo[ 2 ] );
			gl.clear( gl.DEPTH_BUFFER_BIT );
			gl.uniformMatrix4fv( camera, false, passInfo.subarray( 3, 19 ) );
			if ( ranges ) upload( gl.UNIFORM_BUFFER, data, shadowObjectBuffer );
			let bound = null, boundInstances;

			for ( let i = 0, o = 0; i < slots.length; i ++, o += DRAW_FIELDS ) {

				const entry = distinct[ slots[ i ] ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				const instance = instances( draws[ o + 4 ], instanceSources ), copies = instance ? draws[ o + 5 ] : 1;
				const side = key & 3;
				if ( side === 2 ) gl.disable( gl.CULL_FACE );
				else {

					gl.enable( gl.CULL_FACE );
					gl.cullFace( side === 0 ? gl.BACK : gl.FRONT );

				}

				if ( instance !== boundInstances ) {

					bindInstances( instance );
					boundInstances = instance;

				}

				if ( entry !== bound ) {

					bindGeometry( entry, true );
					bound = entry;

				}

				bindObject( shadowObjectBuffer, i, data );
				draw( 0, entry, start, vertices, copies );
				calls ++;

			}

		}

		gl.framebufferTextureLayer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, null, 0, 0 );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		return calls;

	}

	// ---------------------------------------------------------------- environment

	// Prefiltered environments in three.js's cube-UV layout, by source texture id. They
	// need half-float targets.
	const environments = new Map(), levelBuffers = new Map();
	const environmentFramebuffer = gl.createFramebuffer();

	function floatTexture( width, height ) {

		const id = newTexture();
		gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null );
		parameters( null, 1 );
		return id;

	}

	function prefilter( gpuSource, lodMax ) {

		const cubeSize = 2 ** lodMax, width = 3 * Math.max( cubeSize, 16 * 7 ), height = 4 * cubeSize;
		const total = lodMax - LOD_MIN + 1 + EXTRA_LODS, sizes = [];
		for ( let i = 0, lod = lodMax; i < total; i ++ ) {

			sizes.push( 2 ** lod );
			if ( lod > LOD_MIN ) lod --;

		}

		const cubeUV = floatTexture( width, height ), pingPong = floatTexture( width, height );
		const equirect = program( 'pmrem:equirect', 'pmrem.vert', 'pmrem.equirect' ), ggx = program( 'pmrem:ggx', 'pmrem.vert', 'pmrem.ggx' );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.BLEND );
		gl.disable( gl.CULL_FACE );
		gl.enable( gl.SCISSOR_TEST );
		gl.bindFramebuffer( gl.FRAMEBUFFER, environmentFramebuffer );
		gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
		unbindArrays();

		const level = ( size ) => {

			let buffer = levelBuffers.get( size );
			if ( ! buffer ) levelBuffers.set( size, buffer = upload( gl.ARRAY_BUFFER, cubeUVLevel( size ) ) );
			gl.bindBuffer( gl.ARRAY_BUFFER, buffer );
			gl.enableVertexAttribArray( 0 );
			gl.vertexAttribPointer( 0, 3, gl.FLOAT, false, 24, 0 );
			gl.enableVertexAttribArray( 1 );
			gl.vertexAttribPointer( 1, 3, gl.FLOAT, false, 24, 12 );

		};

		const pass = ( shader, source, target, size, clear, x, y, w, h, roughness, mip ) => {

			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0 );

			if ( clear ) {

				gl.disable( gl.SCISSOR_TEST );
				gl.clearColor( 0, 0, 0, 1 );
				gl.clear( gl.COLOR_BUFFER_BIT );
				gl.enable( gl.SCISSOR_TEST );

			}

			gl.viewport( x, y, w, h );
			gl.scissor( x, y, w, h );
			gl.useProgram( shader.id );
			gl.uniform4f( shader.uniform( 'params' ), roughness, mip, 1 / width, 1 / height );
			gl.uniform4f( shader.uniform( 'extra' ), lodMax, 0, 0, 0 );
			gl.activeTexture( gl.TEXTURE0 );
			gl.bindTexture( gl.TEXTURE_2D, source );
			level( size );
			gl.drawArrays( gl.TRIANGLES, 0, 36 );

		};

		pass( equirect, gpuSource, cubeUV, sizes[ 0 ], true, 0, 0, 3 * cubeSize, 2 * cubeSize, 0, 0 );

		// Each level is convolved from the one before into the ping-pong target, then
		// copied back (roughness 0 reads one texel).
		for ( let out = 1; out < total; out ++ ) {

			const target = out / ( total - 1 ), previous = ( out - 1 ) / ( total - 1 );
			const roughness = Math.sqrt( target * target - previous * previous ) * target * 1.25;
			const size = sizes[ out ];
			const x = 3 * size * ( out > lodMax - LOD_MIN ? out - lodMax + LOD_MIN : 0 ), y = 4 * ( cubeSize - size );
			pass( ggx, cubeUV, pingPong, size, out === 1, x, y, 3 * size, 2 * size, roughness, lodMax - ( out - 1 ) );
			pass( ggx, pingPong, cubeUV, size, false, x, y, 3 * size, 2 * size, 0, lodMax - out );

		}

		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0 );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		gl.disable( gl.SCISSOR_TEST );
		gl.enable( gl.DEPTH_TEST );
		unbindArrays();
		gl.deleteTexture( pingPong );
		return cubeUV;

	}

	function environment( id, lodMax, sources ) {

		if ( ! floatTargets ) {

			warn( 'environment maps need EXT_color_buffer_float; drawn without them' );
			return null;

		}

		const source = sources?.get( id ), gpuSource = texture( id, sources );
		if ( ! source || gpuSource === white ) return null;
		let entry = environments.get( id );

		if ( entry && entry.version === source.version && entry.lodMax === lodMax ) {

			entry.checked = frameNumber;
			return entry.texture;

		}

		if ( entry ) gl.deleteTexture( entry.texture );
		entry = { version: source.version, lodMax, texture: prefilter( gpuSource, lodMax ), checked: frameNumber };
		environments.set( id, entry );
		return entry.texture;

	}

	// Background: one sampler per kind, overriding the texture's own settings.
	const panoramaSampler = gl.createSampler(), screenSampler = gl.createSampler();

	for ( const [ sampler, wrapS ] of [ [ panoramaSampler, gl.REPEAT ], [ screenSampler, gl.CLAMP_TO_EDGE ] ] ) {

		gl.samplerParameteri( sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
		gl.samplerParameteri( sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
		gl.samplerParameteri( sampler, gl.TEXTURE_WRAP_S, wrapS );
		gl.samplerParameteri( sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );

	}

	// The texture and sampler of the prepared frame's background, or null to keep the clear colour.
	function background( renderer, sources ) {

		const backgroundInfo = renderer.backgroundInfo();
		if ( backgroundInfo.length === 0 ) return null;
		const [ id, kind, lodMax ] = backgroundInfo;
		const source = kind === 1 ? environment( id, lodMax, sources ) : texture( id, sources );
		if ( ! source || source === white ) return null;
		upload( gl.UNIFORM_BUFFER, renderer.backgroundUniforms(), backgroundBuffer );
		return { texture: source, sampler: kind === 0 ? panoramaSampler : screenSampler };

	}

	// ---------------------------------------------------------------- frame

	gl.enable( gl.DEPTH_TEST );
	gl.frontFace( gl.CCW );
	const linearToSRGB = ( c ) => ( c <= 0.0031308 ? c * 12.92 : 1.055 * c ** ( 1 / 2.4 ) - 0.055 );

	return {

		name: 'webgl', isWebGLBackend: true, gl, info,

		/** Same arguments as the WebGPU host's `render`. */
		render( world, renderer, root, camera, clear, sources, instanceSources, target = null ) {

			frameNumber ++;
			const offscreen = target ? renderTarget( target ) : null;
			drawingInto = target ? target.id : 0;
			const count = renderer.prepare( world, root, camera );
			info.candidates = renderer.candidateCount();
			const frameUniforms = renderer.frameUniforms();
			upload( gl.UNIFORM_BUFFER, frameUniforms, frameBuffer );

			const geometryState = renderer.geometryState(), slots = renderer.drawGeometrySlots(), draws = renderer.drawInfo();
			const records = geometryState.length / GEOMETRY_FIELDS;
			entries.length = perInstance.length = count;
			distinct.length = records;
			for ( let r = 0; r < records; r ++ ) distinct[ r ] = geometry( world, geometryState, r * GEOMETRY_FIELDS );

			const sets = renderer.textureSets();
			setTextures.length = sets.length / TEXTURE_SLOTS;
			for ( let set = 0; set < setTextures.length; set ++ ) setTextures[ set ] = Array.from( sets.subarray( set * TEXTURE_SLOTS, ( set + 1 ) * TEXTURE_SLOTS ), ( id ) => texture( id, sources ) );

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				entries[ i ] = distinct[ slots[ i ] ];
				perInstance[ i ] = instances( draws[ o + 4 ], instanceSources );

			}

			// Taken after the uploads above, which may have grown the module's memory.
			const objectData = count > 0 ? new Float32Array( memory().buffer, renderer.objectUniformsPtr(), renderer.objectUniformsLength() ) : new Float32Array( 0 );

			if ( count > 0 && ranges ) {

				if ( count > objectCapacity ) objectCapacity = Math.max( 64, Math.ceil( count * 1.5 ) );
				gl.bindBuffer( gl.UNIFORM_BUFFER, objectBuffer );
				gl.bufferData( gl.UNIFORM_BUFFER, objectCapacity * OBJECT_STRIDE, gl.DYNAMIC_DRAW );
				gl.bufferSubData( gl.UNIFORM_BUFFER, 0, objectData );

			}

			const environmentInfo = renderer.environmentInfo();
			const environmentTexture = environmentInfo.length > 0 ? environment( environmentInfo[ 0 ], environmentInfo[ 1 ], sources ) : null;
			const backdrop = background( renderer, sources );
			const shadowCalls = drawShadows( renderer, instanceSources );

			// Tone mapping applies only to what is drawn to the canvas, through a linear target.
			let toneMapping = offscreen ? 0 : frameUniforms[ TONE_MAPPING ];

			if ( toneMapping !== 0 && ! floatTargets ) {

				warn( 'tone mapping needs EXT_color_buffer_float; drawn without it' );
				toneMapping = 0;

			}

			const width = offscreen ? offscreen.width : Math.max( 1, canvas.width ), height = offscreen ? offscreen.height : Math.max( 1, canvas.height );
			// Canvas frames go through a linear half-float target when possible, so that
			// blending happens in linear light as on WebGPU; the output pass then tone-maps
			// (if asked) and encodes to sRGB.
			const linearTarget = ! offscreen && floatTargets ? hdrTarget( width, height ) : null;
			const srgb = ! offscreen && ! linearTarget;
			gl.bindFramebuffer( gl.FRAMEBUFFER, offscreen ? offscreen.framebuffer : linearTarget ? linearTarget.draw : null );
			if ( offscreen || linearTarget ) gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
			gl.viewport( 0, 0, width, height );
			gl.depthMask( true );
			// the clear colour is linear; the canvas holds sRGB
			const encode = srgb ? linearToSRGB : ( c ) => c;
			gl.clearColor( encode( clear.r ), encode( clear.g ), encode( clear.b ), clear.a );
			gl.clearDepth( 1 );
			gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

			// Render targets are drawn upside down (see `flip_y` in the GLSL), which also
			// turns the winding of front faces.
			const flipY = offscreen ? - 1 : 1;
			gl.frontFace( offscreen ? gl.CW : gl.CCW );

			if ( backdrop ) {

				const shader = backgroundProgram( srgb );
				gl.useProgram( shader.id );
				gl.uniform1f( shader.uniform( 'flip_y' ), flipY );
				gl.bindBufferBase( gl.UNIFORM_BUFFER, 2, backgroundBuffer );
				gl.activeTexture( gl.TEXTURE0 );
				gl.bindTexture( gl.TEXTURE_2D, backdrop.texture );
				gl.bindSampler( 0, backdrop.sampler );
				gl.disable( gl.BLEND );
				gl.disable( gl.CULL_FACE );
				gl.depthMask( false );
				gl.depthFunc( gl.ALWAYS );
				unbindArrays();
				gl.drawArrays( gl.TRIANGLES, 0, 3 );
				gl.bindSampler( 0, null );

			}

			const shader = meshProgram( srgb );
			gl.useProgram( shader.id );
			gl.uniform1f( shader.uniform( 'flip_y' ), flipY );
			gl.bindBufferBase( gl.UNIFORM_BUFFER, 0, frameBuffer );
			gl.activeTexture( gl.TEXTURE0 + SHADOW_UNIT );
			gl.bindTexture( gl.TEXTURE_2D_ARRAY, shadowTexture ?? ( ensureShadowTexture( 1, 1 ), shadowTexture ) );
			gl.activeTexture( gl.TEXTURE0 + ENVIRONMENT_UNIT );
			gl.bindTexture( gl.TEXTURE_2D, environmentTexture ?? white );
			let state = - 1, bound = null, set = null, triangles = 0, boundInstances;

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				const entry = entries[ i ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				const instance = perInstance[ i ], copies = instance ? draws[ o + 5 ] : 1;
				if ( key !== state ) applyState( state = key );

				if ( instance !== boundInstances ) {

					bindInstances( instance );
					boundInstances = instance;

				}

				if ( entry !== bound ) {

					bindGeometry( entry );
					bound = entry;

				}

				const maps = setTextures[ draws[ o + 1 ] ];

				if ( maps !== set ) {

					for ( let slot = 0; slot < TEXTURE_SLOTS; slot ++ ) {

						gl.activeTexture( gl.TEXTURE0 + slot );
						gl.bindTexture( gl.TEXTURE_2D, maps[ slot ] );

					}

					set = maps;

				}

				bindObject( objectBuffer, i, objectData );
				draw( key, entry, start, vertices, copies );
				if ( ( key >> 5 & 3 ) === 0 ) triangles += vertices / 3 * copies;

			}

			if ( linearTarget ) {

				if ( linearTarget.draw !== linearTarget.resolve ) {

					gl.bindFramebuffer( gl.READ_FRAMEBUFFER, linearTarget.draw );
					gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, linearTarget.resolve );
					gl.blitFramebuffer( 0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST );

				}

				const output = program( 'output', 'fullscreen.vert', 'output.frag' );
				gl.bindFramebuffer( gl.FRAMEBUFFER, null );
				gl.viewport( 0, 0, width, height );
				gl.useProgram( output.id );
				gl.uniform4f( output.uniform( 'settings' ), toneMapping, frameUniforms[ EXPOSURE ], 0, 0 );
				gl.activeTexture( gl.TEXTURE0 );
				gl.bindTexture( gl.TEXTURE_2D, linearTarget.color );
				set = null;
				gl.disable( gl.BLEND );
				gl.disable( gl.CULL_FACE );
				gl.depthFunc( gl.ALWAYS );
				unbindArrays();
				gl.drawArrays( gl.TRIANGLES, 0, 3 );

			}

			gl.bindFramebuffer( gl.FRAMEBUFFER, null );
			gl.frontFace( gl.CCW );
			drawingInto = 0;
			info.calls = count;
			info.shadowCalls = shadowCalls;
			info.triangles = triangles;
			info.geometries = geometries.size;
			info.textures = textures.size;
			info.pipelines = programs.size;

			if ( frameNumber % UNUSED_FRAMES === 0 ) {

				const stale = ( entry ) => frameNumber - entry.checked >= UNUSED_FRAMES;
				for ( const [ slot, entry ] of geometries ) if ( stale( entry ) ) {

					release( entry );
					geometries.delete( slot );

				}

				for ( const [ id, entry ] of textures ) if ( stale( entry ) ) {

					gl.deleteTexture( entry.texture );
					textures.delete( id );

				}

				for ( const [ id, entry ] of instanced ) if ( stale( entry ) ) {

					if ( entry.matrix ) gl.deleteBuffer( entry.matrix );
					if ( entry.color ) gl.deleteBuffer( entry.color );
					instanced.delete( id );

				}

			}

		},

		/** Frees the GPU side of a render target (by its texture id). */
		disposeRenderTarget( id ) {

			renderTargets.get( id )?.release();
			renderTargets.delete( id );

		},

		dispose() {

			for ( const entry of renderTargets.values() ) entry.release();
			renderTargets.clear();
			for ( const entry of geometries.values() ) release( entry );
			geometries.clear();
			for ( const entry of textures.values() ) gl.deleteTexture( entry.texture );
			textures.clear();
			for ( const entry of instanced.values() ) {

				if ( entry.matrix ) gl.deleteBuffer( entry.matrix );
				if ( entry.color ) gl.deleteBuffer( entry.color );

			}

			instanced.clear();
			for ( const entry of environments.values() ) gl.deleteTexture( entry.texture );
			environments.clear();
			for ( const buffer of levelBuffers.values() ) gl.deleteBuffer( buffer );
			hdr?.release();
			if ( shadowTexture ) gl.deleteTexture( shadowTexture );
			for ( const buffer of [ frameBuffer, objectBuffer, shadowObjectBuffer, backgroundBuffer ] ) gl.deleteBuffer( buffer );
			for ( const framebuffer of [ shadowFramebuffer, environmentFramebuffer ] ) gl.deleteFramebuffer( framebuffer );
			gl.deleteSampler( panoramaSampler );
			gl.deleteSampler( screenSampler );
			gl.deleteTexture( white );
			for ( const { id } of programs.values() ) gl.deleteProgram( id );
			programs.clear();

		}

	};

}
