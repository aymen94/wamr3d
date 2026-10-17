// WebGL 2 host for the WAMR3D renderer.
//
// The same frames as the WebGPU host (`webgpu.js`): the engine decides what is drawn and
// prepares every uniform; this file turns that into WebGL 2 calls with the engine's GLSL
// (`Renderer.glslSource`). It is used when WebGPU is missing or when asked for. The
// uniform blocks are uploaded as the engine packs them: their std140 layout matches.

import { Renderer, memory } from './index.js';
import { MIPMAPPED, auxRecord, quadInstances } from './webgpu/formats.js';
import { EXTRA_LODS, LOD_MIN, cubeUVLevel } from './webgpu/environment.js';

const UNUSED_FRAMES = 300;
// Vertex inputs with a buffer each, in location order, with their floats per vertex; the
// colour may have four. Tangent, uv1, skinIndex and skinWeight follow in the geometry
// records and are interleaved into one buffer at locations 9 to 12.
const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
const AUX_ATTRIBUTES = 4, AUX_STRIDE = 56;
// What a missing input reads, as the WebGPU host's buffer of zeros gives it.
const MISSING = [ [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ] ];
const VERTEX_COLOR_SLOT = 3, INSTANCE_SLOT = 4, INSTANCE_COLOR_SLOT = 8, AUX_LOCATION = 9, QUAD_B = 13, QUAD_COLOR_B = 14;
const LOOP_KEY = 1 << 7, RGBA_COLOR_KEY = 1 << 8, WIREFRAME_KEY = 1 << 9, PREMULTIPLIED_KEY = 1 << 14, QUAD_KEY = 1 << 15;
// Texture units: the twelve slots of a draw (the vertex stage reads slot 9), then the
// shadow maps, the environments, the transmission copy, the VSM moments, and the bones.
const SLOTS = 12, SHADOW_UNIT = 12, ENVIRONMENT_UNIT = 13, TRANSMISSION_UNIT = 14, VSM_UNIT = 15, BONE_UNIT = 16;
const OBJECT_STRIDE = 256, MATERIAL_STRIDE = 1024, MATERIAL_FLOATS = 256;
// Indices of a wireframe over `count` triangle vertices: two per edge, three edges per triangle.
const wireframeCount = ( count ) => Math.floor( count / 3 ) * 6;

// A cube face: an image, `{ data, width, height }`, or a DataTexture (as three.js accepts).
const cubeFace = ( face ) => ( face?.isDataTexture ? face.image : face );
// Whether all six square faces of a cube texture have arrived.
const cubeReady = ( images ) => Array.isArray( images ) && images.length === 6 && images.map( cubeFace ).every( ( image, i, faces ) => image && ( image.data || image.width > 0 ) && image.width === faces[ 0 ].width );

export async function createWebGLBackend( canvas, { antialias = true, powerPreference = 'high-performance' } = {} ) {

	const gl = canvas.getContext( 'webgl2', { antialias, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, powerPreference } );
	if ( ! gl ) throw new Error( 'WAMR3D: WebGL 2 is not available in this browser' );

	// Half-float targets carry tone mapping, render targets of float type and the
	// prefiltered environments; without them those fall back as `warn` reports.
	const floatTargets = gl.getExtension( 'EXT_color_buffer_float' ) !== null;
	const floatLinear = gl.getExtension( 'OES_texture_float_linear' ) !== null;
	const anisotropic = gl.getExtension( 'EXT_texture_filter_anisotropic' );
	const samples = antialias ? Math.min( 4, gl.getParameter( gl.MAX_SAMPLES ) ) : 0;
	const MAX_SHADOWS = Renderer.maxShadows(), TEXTURE_SLOTS = Renderer.textureSlots();
	const GEOMETRY_FIELDS = Renderer.geometryStateSize(), DRAW_FIELDS = Renderer.drawInfoSize(), BONES_PER_ROW = Renderer.boneTextureMatricesPerRow();
	const TONE_MAPPING = Renderer.toneMappingIndex(), EXPOSURE = Renderer.toneMappingExposureIndex();
	// Object and material uniforms are bound as ranges of one buffer when the device allows 256-byte offsets.
	const ranges = OBJECT_STRIDE % gl.getParameter( gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT ) === 0;
	const warned = new Set();
	const warn = ( what ) => {

		if ( warned.has( what ) ) return;
		warned.add( what );
		console.warn( `WAMR3D (WebGL 2): ${what}` );

	};

	const WRAP = { 1000: gl.REPEAT, 1001: gl.CLAMP_TO_EDGE, 1002: gl.MIRRORED_REPEAT };
	const MIN_FILTER = { 1003: gl.NEAREST, 1004: gl.NEAREST_MIPMAP_NEAREST, 1005: gl.NEAREST_MIPMAP_LINEAR, 1006: gl.LINEAR, 1007: gl.LINEAR_MIPMAP_NEAREST, 1008: gl.LINEAR_MIPMAP_LINEAR };
	const FACTORS = { 'zero': gl.ZERO, 'one': gl.ONE, 'src-alpha': gl.SRC_ALPHA, 'one-minus-src-alpha': gl.ONE_MINUS_SRC_ALPHA, 'one-minus-src': gl.ONE_MINUS_SRC_COLOR, 'dst': gl.DST_COLOR };

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
		block( 'MaterialBlock', 3 );
		const unit = ( name, value_ ) => {

			const location = gl.getUniformLocation( id, name );
			if ( location !== null ) gl.uniform1i( location, value_ );

		};

		for ( let i = 0; i < SLOTS; i ++ ) unit( 'slot_' + i, i );
		unit( 'shadow_map', SHADOW_UNIT );
		unit( 'environment_map', ENVIRONMENT_UNIT );
		unit( 'transmission_map', TRANSMISSION_UNIT );
		unit( 'vsm_map', VSM_UNIT );
		unit( 'bone_map', BONE_UNIT );
		unit( 'background_map', 0 );
		unit( 'source', 0 );
		unit( 'depth_layers', 0 );
		unit( 'moments', 1 );
		const flip = gl.getUniformLocation( id, 'flip_y' );
		if ( flip !== null ) gl.uniform1f( flip, 1 );
		value = { id, uniform: ( name ) => gl.getUniformLocation( id, name ) };
		programs.set( key, value );
		return value;

	}

	const define = ( srgb ) => ( srgb ? '#define OUTPUT_SRGB 1' : '' );
	const effectProgram = ( custom, srgb ) => {

		const name = Renderer.effectEntryPoint( custom );
		return program( 'effect:' + name + ( srgb ? ':srgb' : '' ), 'effect.vert', 'effect.' + name, define( srgb ) );

	};

	// ---------------------------------------------------------------- shader materials

	// three.js's prefixes of `ShaderMaterial` code: GLSL 1 style source compiled as GLSL ES
	// 3.00, the built-in uniforms and attributes, and the common `#include`s. The user's
	// `main` is renamed so that the vertex stage can flip render targets as the engine does.
	const GLSL1_VERTEX = '#define attribute in\n#define varying out\n#define texture2D texture\n';
	const GLSL1_FRAGMENT = '#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define gl_FragDepthEXT gl_FragDepth\n#define texture2D texture\n#define textureCube texture\n#define texture2DProj textureProj\n#define texture2DLodEXT textureLod\n#define texture2DProjLodEXT textureProjLod\n#define textureCubeLodEXT textureLod\n#define texture2DGradEXT textureGrad\n#define texture2DProjGradEXT textureProjGrad\n#define textureCubeGradEXT textureGrad\n';
	const INCLUDES = {
		common: '#define PI 3.141592653589793\n#define PI2 6.283185307179586\n#define HALF_PI 1.5707963267948966\n#define RECIPROCAL_PI 0.3183098861837907\n#define EPSILON 1e-6\n#define saturate( a ) clamp( a, 0.0, 1.0 )\nfloat pow2( const in float x ) { return x * x; }\nvec3 pow2( const in vec3 x ) { return x * x; }\nfloat luminance( const in vec3 rgb ) { return dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) ); }\n',
		colorspace_fragment: '',
		tonemapping_fragment: '',
		fog_pars_vertex: '', fog_vertex: '', fog_pars_fragment: '', fog_fragment: '',
		logdepthbuf_pars_vertex: '', logdepthbuf_vertex: '', logdepthbuf_pars_fragment: '', logdepthbuf_fragment: '',
		premultiplied_alpha_fragment: '#ifdef PREMULTIPLIED_ALPHA\ngl_FragColor.rgb *= gl_FragColor.a;\n#endif\n'
	};
	const resolveIncludes = ( source ) => source.replace( /^[ \t]*#include +<([\w\d./]+)>/gm, ( _, name ) => {

		if ( INCLUDES[ name ] === undefined ) warn( `#include <${name}> is not available in shader materials` );
		return INCLUDES[ name ] ?? '';

	} );
	const STANDARD_ATTRIBUTES = [ [ 'position', 0 ], [ 'normal', 1 ], [ 'uv', 2 ], [ 'color', 3 ], [ 'instanceMatrix', 4 ], [ 'instanceColor', 8 ], [ 'tangent', 9 ], [ 'uv1', 10 ], [ 'skinIndex', 11 ], [ 'skinWeight', 12 ] ];

	function shaderProgram( material, instanced, srgb ) {

		const key = 'shader:' + material.id + ':' + material.version + ':' + instanced + ':' + srgb;
		let value = programs.get( key );
		if ( value ) return value;
		const defines = Object.entries( material.defines ?? {} ).map( ( [ name, v ] ) => ( v === false ? '' : `#define ${name} ${v === true ? '' : v}` ) ).join( '\n' ) + '\n';
		const flags = ( instanced ? '#define USE_INSTANCING\n' : '' ) + ( material.vertexColors ? '#define USE_COLOR\n' : '' ) + ( material.premultipliedAlpha ? '#define PREMULTIPLIED_ALPHA\n' : '' );
		const raw = material.isRawShaderMaterial === true, glsl3 = material.glslVersion === '300 es';
		const strip = ( source ) => source.replace( /^\s*#version[^\n]*\n/, '' );
		let vertex, fragment;

		if ( raw ) {

			vertex = material.vertexShader;
			fragment = material.fragmentShader;

		} else {

			const header = '#version 300 es\nprecision highp float;\nprecision highp int;\n' + defines + flags;
			const uniforms = 'uniform mat4 modelMatrix;\nuniform mat4 modelViewMatrix;\nuniform mat4 projectionMatrix;\nuniform mat4 viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n';
			const attributes = ( glsl3 ? '' : GLSL1_VERTEX ) + 'in vec3 position;\nin vec3 normal;\nin vec2 uv;\n#ifdef USE_INSTANCING\nin mat4 instanceMatrix;\n#endif\n#ifdef USE_COLOR\nin vec3 color;\n#endif\n';
			// the user's main, then the engine's flip of render targets
			vertex = header + uniforms + attributes + 'uniform float wamr_flip_y;\n#define main wamr_user_main\n' + resolveIncludes( strip( material.vertexShader ) ) + '\n#undef main\nvoid main() {\n\twamr_user_main();\n\tgl_Position.y *= wamr_flip_y;\n}\n';
			fragment = header + 'uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n' + ( glsl3 ? '' : GLSL1_FRAGMENT ) + resolveIncludes( strip( material.fragmentShader ) );

		}

		const id = gl.createProgram();
		gl.attachShader( id, compile( gl.VERTEX_SHADER, vertex, 'ShaderMaterial vertex' ) );
		gl.attachShader( id, compile( gl.FRAGMENT_SHADER, fragment, 'ShaderMaterial fragment' ) );
		for ( const [ name, location ] of STANDARD_ATTRIBUTES ) gl.bindAttribLocation( id, location, name );
		gl.linkProgram( id );
		// other attributes take free locations from 13 on, and the program is linked again
		const custom = [];

		for ( let i = 0, n = gl.getProgramParameter( id, gl.ACTIVE_ATTRIBUTES ); i < n; i ++ ) {

			const attribute = gl.getActiveAttrib( id, i );
			if ( ! STANDARD_ATTRIBUTES.some( ( [ name ] ) => name === attribute.name ) && ! attribute.name.startsWith( 'gl_' ) ) custom.push( attribute );

		}

		if ( custom.length > 0 ) {

			let location = 13;
			for ( const attribute of custom ) {

				attribute.location = location;
				gl.bindAttribLocation( id, location, attribute.name );
				location += attribute.type === gl.FLOAT_MAT4 ? 4 : attribute.type === gl.FLOAT_MAT3 ? 3 : 1;

			}

			gl.linkProgram( id );

		}

		if ( ! gl.getProgramParameter( id, gl.LINK_STATUS ) ) throw new Error( `WAMR3D: ShaderMaterial: ${gl.getProgramInfoLog( id )}` );
		const uniforms = [];

		for ( let i = 0, n = gl.getProgramParameter( id, gl.ACTIVE_UNIFORMS ); i < n; i ++ ) {

			const uniform = gl.getActiveUniform( id, i ), name = uniform.name.replace( /\[0\]$/, '' );
			uniforms.push( { name, type: uniform.type, size: uniform.size, location: gl.getUniformLocation( id, uniform.name ) } );

		}

		const INTEGER = new Map( [ [ gl.INT, 1 ], [ gl.INT_VEC2, 2 ], [ gl.INT_VEC3, 3 ], [ gl.INT_VEC4, 4 ], [ gl.UNSIGNED_INT, 1 ], [ gl.UNSIGNED_INT_VEC2, 2 ], [ gl.UNSIGNED_INT_VEC3, 3 ], [ gl.UNSIGNED_INT_VEC4, 4 ] ] );
		for ( const attribute of custom ) attribute.integer = INTEGER.get( attribute.type ) ?? 0;
		value = { id, uniforms, custom, flip: gl.getUniformLocation( id, 'wamr_flip_y' ) };
		programs.set( key, value );
		return value;

	}

	const SAMPLERS = new Set( [ gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_3D, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.SAMPLER_2D_SHADOW ] );
	const scratch = new Float32Array( 16 );

	// Flattens a uniform value into floats: numbers, vectors, colours, matrices, arrays of them.
	function flatten( value, out = [] ) {

		if ( typeof value === 'number' || typeof value === 'boolean' ) out.push( + value );
		else if ( value.isColor ) out.push( value.r, value.g, value.b );
		else if ( value.isMatrix3 || value.isMatrix4 ) out.push( ...value.elements );
		else if ( value.isVector2 ) out.push( value.x, value.y );
		else if ( value.isVector3 ) out.push( value.x, value.y, value.z );
		else if ( value.isVector4 || value.isQuaternion ) out.push( value.x, value.y, value.z, value.w );
		else if ( ArrayBuffer.isView( value ) || Array.isArray( value ) ) for ( const each of value ) flatten( each, out );
		return out;

	}

	// The material's uniforms by name; textures go to units from 0 on.
	function setUniforms( shader, material, builtins, sources ) {

		let unit = 0;

		for ( const uniform of shader.uniforms ) {

			const own = material.uniforms?.[ uniform.name ];
			const value = builtins[ uniform.name ] ?? own?.value;
			if ( value === undefined || value === null ) continue;
			const location = uniform.location;

			if ( SAMPLERS.has( uniform.type ) ) {

				gl.activeTexture( gl.TEXTURE0 + unit );
				gl.bindTexture( gl.TEXTURE_2D, value.isTexture ? texture( value.id, sources ) : white );
				gl.uniform1i( location, unit ++ );
				continue;

			}

			const data = value.length === 16 && ! Array.isArray( value ) && value instanceof Float32Array ? value : flatten( value );

			switch ( uniform.type ) {

				case gl.FLOAT: gl.uniform1fv( location, data ); break;
				case gl.FLOAT_VEC2: gl.uniform2fv( location, data ); break;
				case gl.FLOAT_VEC3: gl.uniform3fv( location, data ); break;
				case gl.FLOAT_VEC4: gl.uniform4fv( location, data ); break;
				case gl.FLOAT_MAT3: gl.uniformMatrix3fv( location, false, data ); break;
				case gl.FLOAT_MAT4: gl.uniformMatrix4fv( location, false, data ); break;
				case gl.INT: case gl.BOOL: gl.uniform1iv( location, data.map( Math.round ) ); break;
				case gl.INT_VEC2: case gl.BOOL_VEC2: gl.uniform2iv( location, data.map( Math.round ) ); break;
				case gl.INT_VEC3: case gl.BOOL_VEC3: gl.uniform3iv( location, data.map( Math.round ) ); break;
				case gl.INT_VEC4: case gl.BOOL_VEC4: gl.uniform4iv( location, data.map( Math.round ) ); break;
				case gl.UNSIGNED_INT: gl.uniform1uiv( location, data.map( Math.round ) ); break;
				default: break;

			}

		}

	}

	// Uploads a shader material's own attributes (those that are not built-in vertex
	// inputs) when their version changes; integer inputs get integer data.
	function bindCustomAttributes( world, entry, shader ) {

		entry.custom ??= new Map();

		for ( const attribute of shader.custom ) {

			if ( ! world.hasAttribute( entry.handle, attribute.name ) ) {

				gl.disableVertexAttribArray( attribute.location );
				continue;

			}

			const version = world.attributeVersion( entry.handle, attribute.name );
			let cached = entry.custom.get( attribute.name );

			if ( ! cached || cached.version !== version || cached.integer !== attribute.integer ) {

				const floats = world.getAttribute( entry.handle, attribute.name ), size = floats.length / Math.max( 1, world.attributeCount( entry.handle, attribute.name ) );
				const data = attribute.integer ? Int32Array.from( floats, Math.round ) : floats;
				cached = { buffer: upload( gl.ARRAY_BUFFER, data, cached?.buffer ), version, size, integer: attribute.integer };
				entry.custom.set( attribute.name, cached );

			}

			gl.enableVertexAttribArray( attribute.location );
			gl.bindBuffer( gl.ARRAY_BUFFER, cached.buffer );
			gl.vertexAttribDivisor( attribute.location, 0 );
			if ( attribute.integer ) gl.vertexAttribIPointer( attribute.location, cached.size, gl.INT, 0, 0 );
			else gl.vertexAttribPointer( attribute.location, cached.size, gl.FLOAT, false, 0, 0 );

		}

	}

	// 4x4 products for the built-in uniforms, column-major.
	function multiply( a, b, out ) {

		for ( let c = 0; c < 4; c ++ ) for ( let r = 0; r < 4; r ++ ) out[ c * 4 + r ] = a[ r ] * b[ c * 4 ] + a[ 4 + r ] * b[ c * 4 + 1 ] + a[ 8 + r ] * b[ c * 4 + 2 ] + a[ 12 + r ] * b[ c * 4 + 3 ];
		return out;

	}

	function normalMatrix( m, out ) {

		const a = m[ 0 ], b = m[ 1 ], c = m[ 2 ], d = m[ 4 ], e = m[ 5 ], f = m[ 6 ], g = m[ 8 ], h = m[ 9 ], i = m[ 10 ];
		const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C, k = det === 0 ? 0 : 1 / det;
		// the inverse transpose of the upper 3x3
		out[ 0 ] = A * k; out[ 1 ] = B * k; out[ 2 ] = C * k;
		out[ 3 ] = ( c * h - b * i ) * k; out[ 4 ] = ( a * i - c * g ) * k; out[ 5 ] = ( b * g - a * h ) * k;
		out[ 6 ] = ( b * f - c * e ) * k; out[ 7 ] = ( c * d - a * f ) * k; out[ 8 ] = ( a * e - b * d ) * k;
		return out;

	}
	const meshProgram = ( srgb, quad ) => program( ( quad ? 'quad' : 'mesh' ) + ( srgb ? ':srgb' : '' ), quad ? 'mesh_quad.vert' : 'mesh.vert', 'mesh.frag', define( srgb ) );
	const backgroundProgram = ( srgb ) => program( srgb ? 'background:srgb' : 'background', 'fullscreen.vert', 'background.frag', define( srgb ) );

	// ---------------------------------------------------------------- textures

	function newTexture() {

		const id = gl.createTexture();
		gl.bindTexture( gl.TEXTURE_2D, id );
		return id;

	}

	function parameters( source, levels, float = false ) {

		const min = source?.minFilter ?? 1006, mag = source?.magFilter ?? 1006;
		let minFilter = MIN_FILTER[ min ] ?? gl.LINEAR;
		if ( levels === 1 ) minFilter = MIPMAPPED.has( min ) ? ( min === 1004 || min === 1005 ? gl.NEAREST : gl.LINEAR ) : minFilter;
		// 32-bit float textures filter only with OES_texture_float_linear
		const nearest = float && ! floatLinear;
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : minFilter );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest || mag === 1003 ? gl.NEAREST : gl.LINEAR );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, WRAP[ source?.wrapS ] ?? gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, WRAP[ source?.wrapT ] ?? gl.CLAMP_TO_EDGE );
		if ( anisotropic && ( source?.anisotropy ?? 1 ) > 1 && levels > 1 ) gl.texParameterf( gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min( source.anisotropy, gl.getParameter( anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT ) ) );

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

	// The internal format, format and type of a data texture's pixels (RGBA).
	function dataFormat( source, srgb ) {

		if ( source?.type === 1015 ) return [ gl.RGBA32F, gl.FLOAT, true ];
		if ( source?.type === 1016 ) return [ gl.RGBA16F, gl.HALF_FLOAT, false ];
		return [ srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.UNSIGNED_BYTE, false ];

	}

	// A material's texture, uploaded when the source's version changes; white while an
	// image is still loading.
	function texture( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );

		if ( source?.isRenderTargetTexture || source?.isDepthTexture ) {

			if ( id === drawingInto ) return white;
			return renderTargetTextures.get( id ) ?? white;

		}

		if ( source?.isCubeTexture ) return cubeTexture( id, source );
		const image = source?.image;
		if ( ! image || ! ( image.data || image.width > 0 ) ) return white;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.texture;

		const { width, height } = image, srgb = source.colorSpace === 'srgb';
		const [ internal, type, float32 ] = image.data ? dataFormat( source, srgb ) : [ srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.UNSIGNED_BYTE, false ];
		const levels = type === gl.UNSIGNED_BYTE && source.generateMipmaps !== false && MIPMAPPED.has( source.minFilter ) ? 2 : 1;
		if ( entry.texture ) gl.deleteTexture( entry.texture );
		entry.texture = newTexture();

		if ( image.data ) {

			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
			gl.texImage2D( gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, image.data );

		} else {

			let pixels = image, flip = source.flipY !== false;

			if ( flip && typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ) {

				pixels = upright( image );
				flip = false;

			}

			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, flip );
			gl.texImage2D( gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
			gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );

		}

		if ( levels > 1 ) gl.generateMipmap( gl.TEXTURE_2D );
		parameters( source, levels, float32 );
		entry.version = source.version;
		return entry.texture;

	}

	// A cube texture becomes an equirectangular image (four faces wide, two high) on each
	// upload, so environments and backgrounds take it like any panorama. Float faces keep
	// a half-float image. White until its six images have arrived.
	function cubeTexture( id, source ) {

		if ( ! cubeReady( source.image ) ) return white;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.texture;

		const images = source.image.map( cubeFace ), size = images[ 0 ].width, srgb = source.colorSpace === 'srgb';
		const faceSource = source.image[ 0 ]?.isDataTexture ? source.image[ 0 ] : source;
		const [ internal, type ] = images[ 0 ].data ? dataFormat( faceSource, srgb ) : [ srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.UNSIGNED_BYTE ];
		const float = type !== gl.UNSIGNED_BYTE;
		if ( float && ! floatTargets ) warn( 'float cube textures need EXT_color_buffer_float; drawn with 8 bits per channel' );
		const faces = gl.createTexture();
		gl.bindTexture( gl.TEXTURE_CUBE_MAP, faces );
		gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );

		images.forEach( ( image, face ) => {

			const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + face;
			if ( image.data ) gl.texImage2D( target, 0, internal, size, size, 0, gl.RGBA, type, image.data );
			else gl.texImage2D( target, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, image );

		} );

		const filter = type === gl.FLOAT && ! floatLinear ? gl.NEAREST : gl.LINEAR;
		gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, filter );
		gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, filter );
		gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );

		const width = Math.min( 4 * size, gl.getParameter( gl.MAX_TEXTURE_SIZE ) ), height = width / 2;
		if ( entry.texture ) gl.deleteTexture( entry.texture );
		entry.texture = newTexture();
		const hdr = float && floatTargets;
		gl.texImage2D( gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, width, height, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null );
		parameters( null, 1 );

		const shader = program( 'cube:equirect', 'fullscreen.vert', 'cube.equirect' );
		gl.bindFramebuffer( gl.FRAMEBUFFER, environmentFramebuffer );
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.texture, 0 );
		gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
		gl.viewport( 0, 0, width, height );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.BLEND );
		gl.disable( gl.CULL_FACE );
		gl.useProgram( shader.id );
		gl.uniform1i( shader.uniform( 'faces' ), 0 );
		gl.activeTexture( gl.TEXTURE0 );
		gl.bindTexture( gl.TEXTURE_CUBE_MAP, faces );
		unbindArrays();
		gl.drawArrays( gl.TRIANGLES, 0, 3 );
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0 );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		gl.bindTexture( gl.TEXTURE_CUBE_MAP, null );
		gl.deleteTexture( faces );
		gl.enable( gl.DEPTH_TEST );

		entry.version = source.version;
		return entry.texture;

	}

	// ---------------------------------------------------------------- render targets

	// GL side of render targets by their texture id; `renderTargetTextures` gives the
	// textures (colour attachments and the depth texture) materials can read.
	const renderTargets = new Map(), renderTargetTextures = new Map();

	function renderTarget( target ) {

		let entry = renderTargets.get( target.id );
		const float = target.type !== 'byte' && floatTargets;
		if ( target.type !== 'byte' && ! floatTargets ) warn( 'float render targets need EXT_color_buffer_float; drawn with 8 bits per channel' );
		const count = target.textures?.length ?? 1, depthTexture = target.depthTexture ?? null;
		const multisampled = target.samples > 1 && samples > 0 && ! depthTexture;
		if ( entry && entry.width === target.width && entry.height === target.height && entry.float === float && entry.count === count && entry.multisampled === multisampled && entry.depthId === ( depthTexture?.id ?? 0 ) ) return entry;
		if ( entry ) entry.release();

		const { width, height } = target, colors = [], buffers = [];
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER, framebuffer );

		( target.textures ?? [ target.texture ] ).forEach( ( texture_, i ) => {

			const color = newTexture();
			gl.texImage2D( gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null );
			parameters( texture_, 1 );
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, color, 0 );
			colors.push( color );
			renderTargetTextures.set( texture_.id, color );

		} );

		let depth = null;

		if ( depthTexture ) {

			depth = newTexture();
			gl.texImage2D( gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0 );
			renderTargetTextures.set( depthTexture.id, depth );

		} else {

			const buffer = gl.createRenderbuffer();
			gl.bindRenderbuffer( gl.RENDERBUFFER, buffer );
			gl.renderbufferStorage( gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height );
			gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, buffer );
			buffers.push( buffer );

		}

		// Multisampled targets draw into renderbuffers and are resolved into the textures.
		let draw = framebuffer;

		if ( multisampled ) {

			draw = gl.createFramebuffer();
			gl.bindFramebuffer( gl.FRAMEBUFFER, draw );
			const storage = ( format, attachment ) => {

				const buffer = gl.createRenderbuffer();
				gl.bindRenderbuffer( gl.RENDERBUFFER, buffer );
				gl.renderbufferStorageMultisample( gl.RENDERBUFFER, samples, format, width, height );
				gl.framebufferRenderbuffer( gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer );
				buffers.push( buffer );

			};

			storage( float ? gl.RGBA16F : gl.RGBA8, gl.COLOR_ATTACHMENT0 );
			storage( gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT );

		}

		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		entry = {
			width, height, float, count, multisampled, depthId: depthTexture?.id ?? 0, colors, framebuffer, draw, release() {

				for ( const color of colors ) gl.deleteTexture( color );
				if ( depth ) gl.deleteTexture( depth );
				for ( const buffer of buffers ) gl.deleteRenderbuffer( buffer );
				gl.deleteFramebuffer( framebuffer );
				if ( draw !== framebuffer ) gl.deleteFramebuffer( draw );
				for ( const texture_ of target.textures ?? [ target.texture ] ) renderTargetTextures.delete( texture_.id );
				if ( depthTexture ) renderTargetTextures.delete( depthTexture.id );

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

	// The mipmapped copy of the opaque scene that transmissive materials read, drawn like a
	// render target (rows top first).
	let transmission = null;

	function transmissionTarget( width, height ) {

		if ( transmission && transmission.width === width && transmission.height === height ) return transmission;
		transmission?.release();
		const color = newTexture();
		const levels = Math.floor( Math.log2( Math.max( width, height ) ) ) + 1;
		gl.texStorage2D( gl.TEXTURE_2D, levels, floatTargets ? gl.RGBA16F : gl.RGBA8, width, height );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
		gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
		const depth = gl.createRenderbuffer();
		gl.bindRenderbuffer( gl.RENDERBUFFER, depth );
		gl.renderbufferStorage( gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height );
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer( gl.FRAMEBUFFER, framebuffer );
		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0 );
		gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		transmission = { width, height, color, framebuffer, release() {

			gl.deleteTexture( color );
			gl.deleteRenderbuffer( depth );
			gl.deleteFramebuffer( framebuffer );

		} };
		return transmission;

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

		if ( ! entry ) geometries.set( slot, entry = { generation, handle: BigInt( generation ) << 32n | BigInt( slot ), buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], sizes: [ 0, 0, 0, 0 ], aux: null, auxVersions: '', index: null, indexVersion: - 1, quads: null, checked: 0 } );
		entry.checked = frameNumber;
		const records = ATTRIBUTES.length + AUX_ATTRIBUTES;
		const colorSize = state[ o + 4 + records * 2 ];

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

		const auxKey = auxRecord( state, o + 3 + ATTRIBUTES.length * 2, AUX_ATTRIBUTES );

		if ( auxKey !== entry.auxVersions ) {

			entry.auxVersions = auxKey;

			if ( auxKey === '' ) {

				if ( entry.aux ) gl.deleteBuffer( entry.aux );
				entry.aux = null;

			} else {

				const data = new Float32Array( vertices * 14 ), view = new Float32Array( memory().buffer );
				const offsets = [ 0, 4, 6, 10 ], sizes = [ 4, 2, 4, 4 ];

				for ( let a = 0, p = o + 3 + ATTRIBUTES.length * 2; a < AUX_ATTRIBUTES; a ++, p += 2 ) {

					const address = state[ p + 1 ];
					if ( address === 0 ) continue;
					const base = address >>> 2, size = sizes[ a ], offset = offsets[ a ];
					for ( let v = 0; v < vertices; v ++ ) for ( let k = 0; k < size; k ++ ) data[ v * 14 + offset + k ] = view[ base + v * size + k ];

				}

				entry.aux = upload( gl.ARRAY_BUFFER, data, entry.aux );

			}

		}

		const indexVersion = state[ o + 3 + records * 2 ];

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
		if ( entry.aux ) gl.deleteBuffer( entry.aux );
		if ( entry.index ) gl.deleteBuffer( entry.index );
		if ( entry.edges ) for ( const edges of entry.edges.values() ) gl.deleteBuffer( edges );
		if ( entry.quads ) for ( const buffer of [ entry.quads.position, entry.quads.color ] ) if ( buffer ) gl.deleteBuffer( buffer );
		if ( entry.custom ) for ( const cached of entry.custom.values() ) gl.deleteBuffer( cached.buffer );

	}

	// The index of a wireframe over the `count` vertices from `start` (through the
	// geometry's index, if any): the three edges of each triangle, as three.js builds
	// them. Kept per geometry until its index changes.
	function wireframeIndex( world, entry, start, count ) {

		if ( ! entry.edges || entry.edgesVersion !== entry.indexVersion ) {

			if ( entry.edges ) for ( const edges of entry.edges.values() ) gl.deleteBuffer( edges );
			entry.edges = new Map();
			entry.edgesVersion = entry.indexVersion;

		}

		const key = start + ':' + count;
		let buffer = entry.edges.get( key );
		if ( buffer ) return buffer;

		const index = entry.index ? world.getIndex( entry.handle ) : null;
		const data = new Uint32Array( wireframeCount( count ) );

		for ( let i = start, o = 0; o < data.length; i += 3, o += 6 ) {

			const a = index ? index[ i ] : i, b = index ? index[ i + 1 ] : i + 1, c = index ? index[ i + 2 ] : i + 2;
			data[ o ] = a; data[ o + 1 ] = b; data[ o + 2 ] = b; data[ o + 3 ] = c; data[ o + 4 ] = c; data[ o + 5 ] = a;

		}

		buffer = upload( gl.ELEMENT_ARRAY_BUFFER, data );
		entry.edges.set( key, buffer );
		return buffer;

	}

	// Instance inputs advance per instance; without instances they hold an identity matrix.
	for ( let location = INSTANCE_SLOT; location <= INSTANCE_COLOR_SLOT; location ++ ) gl.vertexAttribDivisor( location, 1 );

	function bindGeometry( entry ) {

		for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) {

			const buffer = entry.buffers[ slot ];
			gl.vertexAttribDivisor( slot, 0 );

			if ( buffer ) {

				gl.enableVertexAttribArray( slot );
				gl.bindBuffer( gl.ARRAY_BUFFER, buffer );
				gl.vertexAttribPointer( slot, entry.sizes[ slot ], gl.FLOAT, false, 0, 0 );

			} else {

				gl.disableVertexAttribArray( slot );
				gl.vertexAttrib4f( slot, ...MISSING[ slot ] );

			}

		}

		const sizes = [ 4, 2, 4, 4 ], offsets = [ 0, 16, 24, 40 ];

		for ( let a = 0; a < AUX_ATTRIBUTES; a ++ ) {

			const location = AUX_LOCATION + a;

			if ( entry.aux ) {

				gl.enableVertexAttribArray( location );
				gl.bindBuffer( gl.ARRAY_BUFFER, entry.aux );
				gl.vertexAttribPointer( location, sizes[ a ], gl.FLOAT, false, AUX_STRIDE, offsets[ a ] );

			} else {

				gl.disableVertexAttribArray( location );
				gl.vertexAttrib4f( location, 0, 0, 0, 0 );

			}

		}

		gl.bindBuffer( gl.ELEMENT_ARRAY_BUFFER, entry.index );

	}

	// The vertices of an indexed geometry in index order, for quads (see the WebGPU host).
	function quadSource( world, entry ) {

		if ( ! entry.index ) return { position: entry.buffers[ 0 ], color: entry.buffers[ VERTEX_COLOR_SLOT ], colorSize: entry.sizes[ VERTEX_COLOR_SLOT ] };
		const key = entry.indexVersion + ':' + entry.versions[ 0 ] + ':' + entry.versions[ VERTEX_COLOR_SLOT ];
		if ( entry.quads && entry.quads.key === key ) return entry.quads;
		if ( entry.quads ) for ( const buffer of [ entry.quads.position, entry.quads.color ] ) if ( buffer ) gl.deleteBuffer( buffer );
		const index = world.getIndex( entry.handle );
		const unrolled = ( data, size ) => {

			const out = new Float32Array( index.length * size );
			for ( let i = 0; i < index.length; i ++ ) for ( let k = 0; k < size; k ++ ) out[ i * size + k ] = data[ index[ i ] * size + k ];
			return out;

		};

		const colorSize = entry.sizes[ VERTEX_COLOR_SLOT ];
		entry.quads = {
			key, colorSize,
			position: upload( gl.ARRAY_BUFFER, unrolled( world.getAttribute( entry.handle, 'position' ), 3 ) ),
			color: entry.buffers[ VERTEX_COLOR_SLOT ] ? upload( gl.ARRAY_BUFFER, unrolled( world.getAttribute( entry.handle, 'color' ), colorSize ) ) : null
		};
		return entry.quads;

	}

	// Points or segments read per instance, from the first instance on.
	function bindQuads( source, topology, first ) {

		const pairs = topology === 2, step = pairs ? 2 : 1;
		const pointer = ( location, size, stride, offset ) => {

			gl.enableVertexAttribArray( location );
			gl.vertexAttribPointer( location, size, gl.FLOAT, false, stride, offset );
			gl.vertexAttribDivisor( location, 1 );

		};

		gl.bindBuffer( gl.ARRAY_BUFFER, source.position );
		pointer( 0, 3, step * 12, first * step * 12 );
		pointer( QUAD_B, 3, step * 12, first * step * 12 + ( topology === 3 ? 0 : 12 ) );

		if ( source.color ) {

			const c = source.colorSize;
			gl.bindBuffer( gl.ARRAY_BUFFER, source.color );
			pointer( VERTEX_COLOR_SLOT, c, step * c * 4, first * step * c * 4 );
			pointer( QUAD_COLOR_B, c, step * c * 4, first * step * c * 4 + ( topology === 3 ? 0 : c * 4 ) );

		} else {

			for ( const location of [ VERTEX_COLOR_SLOT, QUAD_COLOR_B ] ) {

				gl.disableVertexAttribArray( location );
				gl.vertexAttrib4f( location, ...MISSING[ VERTEX_COLOR_SLOT ] );

			}

		}

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

		for ( let location = 0; location <= QUAD_COLOR_B; location ++ ) gl.disableVertexAttribArray( location );

	}

	// ---------------------------------------------------------------- state

	// Blend factors by three.js blending mode (see `BLEND_FACTORS`).
	const BLENDS = [
		[ 'src-alpha', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ], [ 'src-alpha', 'one', 'one', 'one' ], [ 'zero', 'one-minus-src', 'zero', 'one' ], [ 'dst', 'one-minus-src-alpha', 'zero', 'one' ],
		[ 'one', 'one-minus-src-alpha', 'one', 'one-minus-src-alpha' ], [ 'one', 'one', 'one', 'one' ], [ 'zero', 'one-minus-src', 'zero', 'one' ], [ 'dst', 'one-minus-src-alpha', 'zero', 'one' ]
	].map( ( factors ) => factors.map( ( name ) => FACTORS[ name ] ) );

	function applyState( key ) {

		const side = key & 3;

		if ( side === 2 || key & QUAD_KEY ) gl.disable( gl.CULL_FACE );
		else {

			gl.enable( gl.CULL_FACE );
			gl.cullFace( side === 0 ? gl.BACK : gl.FRONT );

		}

		if ( key & 4 ) {

			const mode = Math.min( 4, Math.max( 1, key >> 11 & 7 ) ) - 1, factors = BLENDS[ ( key & PREMULTIPLIED_KEY ? 4 : 0 ) + mode ];
			gl.enable( gl.BLEND );
			gl.blendFuncSeparate( factors[ 0 ], factors[ 1 ], factors[ 2 ], factors[ 3 ] );

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

	// Binds the wireframe index in place of the geometry's and draws it; the caller binds
	// the geometry again before its next draw.
	function drawWireframe( world, entry, start, vertices, copies ) {

		const indices = wireframeCount( vertices );
		if ( indices === 0 ) return;
		gl.bindBuffer( gl.ELEMENT_ARRAY_BUFFER, wireframeIndex( world, entry, start, vertices ) );
		gl.drawElementsInstanced( gl.LINES, indices, gl.UNSIGNED_INT, 0, copies );

	}

	const frameBuffer = gl.createBuffer(), objectBuffer = gl.createBuffer(), materialBuffer = gl.createBuffer(), shadowObjectBuffer = gl.createBuffer(), backgroundBuffer = gl.createBuffer(), scratchBuffer = gl.createBuffer();
	let objectCapacity = 0, materialCapacity = 0;

	// Binds block `binding` to element `i` (of `size` bytes) of `buffer`, or uploads it from
	// `data` into a scratch buffer when ranges are not supported.
	function bindRange( binding, buffer, i, size, data ) {

		if ( ranges ) gl.bindBufferRange( gl.UNIFORM_BUFFER, binding, buffer, i * size, size );
		else {

			const target = binding === 3 ? scratchBuffer : buffer;
			gl.bindBuffer( gl.UNIFORM_BUFFER, target );
			gl.bufferData( gl.UNIFORM_BUFFER, data.subarray( i * size / 4, ( i + 1 ) * size / 4 ), gl.DYNAMIC_DRAW );
			gl.bindBufferBase( gl.UNIFORM_BUFFER, binding, target );

		}

	}

	function bindMaps( maps ) {

		for ( let slot = 0; slot < TEXTURE_SLOTS; slot ++ ) {

			gl.activeTexture( gl.TEXTURE0 + slot );
			gl.bindTexture( gl.TEXTURE_2D, maps[ slot ] );

		}

	}

	// ---------------------------------------------------------------- bones

	let boneTexture = null, boneRows = 0;

	// The frame's skinning matrices in a float texture 1024 texels wide.
	function uploadBones( renderer ) {

		const length = renderer.skinMatricesLength(), width = BONES_PER_ROW * 4;
		const matrices = length / 16, rows = Math.max( 1, Math.ceil( matrices / BONES_PER_ROW ) );

		if ( ! boneTexture || boneRows < rows ) {

			if ( boneTexture ) gl.deleteTexture( boneTexture );
			boneTexture = newTexture();
			boneRows = Math.max( rows, boneRows * 2 );
			gl.texStorage2D( gl.TEXTURE_2D, 1, gl.RGBA32F, width, boneRows );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );

		}

		if ( length === 0 ) return;
		const data = new Float32Array( memory().buffer, renderer.skinMatricesPtr(), length );
		gl.bindTexture( gl.TEXTURE_2D, boneTexture );
		gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
		const full = Math.floor( matrices / BONES_PER_ROW ), rest = matrices - full * BONES_PER_ROW;
		if ( full > 0 ) gl.texSubImage2D( gl.TEXTURE_2D, 0, 0, 0, width, full, gl.RGBA, gl.FLOAT, data, 0 );
		if ( rest > 0 ) gl.texSubImage2D( gl.TEXTURE_2D, 0, 0, full, rest * 4, 1, gl.RGBA, gl.FLOAT, data, full * BONES_PER_ROW * 16 );

	}

	// ---------------------------------------------------------------- shadows

	let shadowTexture = null, shadowWidth = 0, shadowHeight = 0, shadowLayers = 0, vsmTexture = null, vsmScratch = null;
	const shadowFramebuffer = gl.createFramebuffer(), vsmFramebuffer = gl.createFramebuffer();
	// Reads depth as numbers (the shadow texture compares by itself).
	const depthSampler = gl.createSampler();
	gl.samplerParameteri( depthSampler, gl.TEXTURE_COMPARE_MODE, gl.NONE );
	gl.samplerParameteri( depthSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
	gl.samplerParameteri( depthSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST );

	// One layer per shadow map (a point light has six), as many as frames have needed so far.
	function ensureShadowTexture( width, height, layers, vsm ) {

		const sameSize = shadowTexture && shadowWidth === width && shadowHeight === height;

		if ( ! sameSize || shadowLayers < layers ) {

			if ( shadowTexture ) gl.deleteTexture( shadowTexture );
			shadowLayers = Math.min( MAX_SHADOWS, sameSize ? Math.max( layers, shadowLayers ) : layers );
			shadowTexture = gl.createTexture();
			gl.bindTexture( gl.TEXTURE_2D_ARRAY, shadowTexture );
			gl.texImage3D( gl.TEXTURE_2D_ARRAY, 0, gl.DEPTH_COMPONENT24, width, height, shadowLayers, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL );
			shadowWidth = width;
			shadowHeight = height;
			if ( vsmTexture ) gl.deleteTexture( vsmTexture );
			vsmTexture = null;

		}

		if ( vsm && ! vsmTexture ) {

			if ( ! floatTargets ) warn( 'VSM shadows need EXT_color_buffer_float' );
			vsmTexture = gl.createTexture();
			gl.bindTexture( gl.TEXTURE_2D_ARRAY, vsmTexture );
			gl.texStorage3D( gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, width, height, shadowLayers );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE );
			gl.texParameteri( gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE );
			if ( vsmScratch ) gl.deleteTexture( vsmScratch );
			vsmScratch = newTexture();
			gl.texStorage2D( gl.TEXTURE_2D, 1, gl.RGBA16F, width, height );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST );
			gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST );

		}

	}

	// The VSM blur of every pass: vertical from the depth layer into the scratch moments,
	// horizontal from them into the layer of the moments array.
	function blurShadows( renderer, passes ) {

		const vertical = program( 'vsm:vertical', 'fullscreen.vert', 'vsm.frag', '#define VERTICAL 1' ), horizontal = program( 'vsm:horizontal', 'fullscreen.vert', 'vsm.frag' );
		gl.bindFramebuffer( gl.FRAMEBUFFER, vsmFramebuffer );
		gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
		gl.disable( gl.DEPTH_TEST );
		gl.disable( gl.CULL_FACE );
		unbindArrays();

		for ( let p = 0; p < passes; p ++ ) {

			const passInfo = renderer.shadowPassInfo( p ), blur = renderer.shadowBlur( p ), layer = passInfo[ 0 ];
			gl.viewport( 0, 0, passInfo[ 1 ], passInfo[ 2 ] );
			gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vsmScratch, 0 );
			gl.useProgram( vertical.id );
			gl.uniform4f( vertical.uniform( 'settings' ), blur[ 0 ], blur[ 1 ], layer, 0 );
			gl.activeTexture( gl.TEXTURE0 );
			gl.bindTexture( gl.TEXTURE_2D_ARRAY, shadowTexture );
			gl.bindSampler( 0, depthSampler );
			gl.drawArrays( gl.TRIANGLES, 0, 3 );
			gl.bindSampler( 0, null );
			gl.framebufferTextureLayer( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, vsmTexture, 0, layer );
			gl.useProgram( horizontal.id );
			gl.uniform4f( horizontal.uniform( 'settings' ), blur[ 0 ], blur[ 1 ], layer, 0 );
			gl.activeTexture( gl.TEXTURE1 );
			gl.bindTexture( gl.TEXTURE_2D, vsmScratch );
			gl.drawArrays( gl.TRIANGLES, 0, 3 );

		}

		gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0 );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		gl.enable( gl.DEPTH_TEST );

	}

	// Depth only, one layer per shadow map, casters with the main pass's buffers, materials and textures.
	function drawShadows( renderer, instanceSources, materialData ) {

		const passes = renderer.shadowCount();
		if ( passes === 0 ) return 0;
		const [ width, height ] = renderer.shadowMapSize();
		const variance = renderer.shadowFilter() === 2 && floatTargets;
		ensureShadowTexture( width, height, passes, variance );
		gl.bindFramebuffer( gl.FRAMEBUFFER, shadowFramebuffer );
		gl.drawBuffers( [ gl.NONE ] );
		gl.disable( gl.BLEND );
		gl.depthMask( true );
		gl.depthFunc( gl.LEQUAL );
		gl.activeTexture( gl.TEXTURE0 + BONE_UNIT );
		gl.bindTexture( gl.TEXTURE_2D, boneTexture );
		let calls = 0, current = null;

		for ( let p = 0; p < passes; p ++ ) {

			const passInfo = renderer.shadowPassInfo( p ), draws = renderer.shadowDrawInfo( p ), slots = renderer.shadowDrawGeometrySlots( p );
			const data = renderer.shadowObjectUniforms( p );
			gl.framebufferTextureLayer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, shadowTexture, 0, passInfo[ 0 ] );
			gl.viewport( 0, 0, passInfo[ 1 ], passInfo[ 2 ] );
			gl.clear( gl.DEPTH_BUFFER_BIT );
			if ( ranges ) upload( gl.UNIFORM_BUFFER, data, shadowObjectBuffer );
			let bound = null, boundInstances, set = null;

			for ( let i = 0, o = 0; i < slots.length; i ++, o += DRAW_FIELDS ) {

				const entry = distinct[ slots[ i ] ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ], material = draws[ o + 6 ];
				const alphaTest = materialData[ material * MATERIAL_FLOATS + 23 ] > 0;
				const shader = alphaTest ? program( 'shadow:alpha', 'shadow.vert', 'shadow.frag', '#define ALPHA_TEST 1' ) : program( 'shadow', 'shadow.vert', 'shadow.frag' );

				if ( shader !== current ) {

					gl.useProgram( shader.id );
					current = shader;

				}

				gl.uniformMatrix4fv( shader.uniform( 'shadow_view_projection' ), false, passInfo.subarray( 3, 19 ) );
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

					bindGeometry( entry );
					bound = entry;

				}

				const maps = setTextures[ draws[ o + 1 ] ];

				if ( maps !== set ) {

					bindMaps( maps );
					set = maps;

				}

				bindRange( 1, shadowObjectBuffer, i, OBJECT_STRIDE, data );
				bindRange( 3, materialBuffer, material, MATERIAL_STRIDE, materialData );
				draw( 0, entry, start, vertices, copies );
				calls ++;

			}

		}

		gl.framebufferTextureLayer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, null, 0, 0 );
		gl.bindFramebuffer( gl.FRAMEBUFFER, null );
		if ( variance ) blurShadows( renderer, passes );
		return calls;

	}

	// ---------------------------------------------------------------- environment

	// Prefiltered environments in three.js's cube-UV layout, by source texture id and
	// lodMax, and the frame's stack of them. They need half-float targets.
	const environments = new Map(), levelBuffers = new Map();
	const environmentFramebuffer = gl.createFramebuffer(), stackFramebuffer = gl.createFramebuffer();
	let stack = null;

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
			gl.vertexAttribDivisor( 0, 0 );
			gl.vertexAttribPointer( 0, 3, gl.FLOAT, false, 24, 0 );
			gl.enableVertexAttribArray( 1 );
			gl.vertexAttribDivisor( 1, 0 );
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

	let stamps = 0;

	function prefiltered( id, lodMax, sources ) {

		if ( ! floatTargets ) {

			warn( 'environment maps need EXT_color_buffer_float; drawn without them' );
			return null;

		}

		const source = sources?.get( id ), gpuSource = texture( id, sources );
		if ( ! source || gpuSource === white ) return null;
		const key = id + ':' + lodMax;
		let entry = environments.get( key );

		if ( entry && entry.version === source.version ) {

			entry.checked = frameNumber;
			return entry;

		}

		if ( entry ) gl.deleteTexture( entry.texture );
		entry = { version: source.version, lodMax, texture: prefilter( gpuSource, lodMax ), checked: frameNumber, stamp: ++ stamps };
		environments.set( key, entry );
		return entry;

	}

	// The frame's environments stacked in bands of one texture (see `Renderer.environmentInfo`).
	function environment( info, sources ) {

		if ( info.length === 0 ) return null;
		const lodMax = info[ 0 ], width = info[ 1 ], height = info[ 2 ], ids = Array.from( info.subarray( 3 ) );
		const maps = ids.map( ( id ) => prefiltered( id, lodMax, sources ) );
		if ( maps.some( ( map ) => map === null ) ) return null;
		if ( maps.length === 1 ) return maps[ 0 ].texture;
		const key = ids.join( ',' ) + ':' + lodMax + ':' + maps.map( ( map ) => map.stamp ).join( ',' );
		if ( stack && stack.key === key ) return stack.texture;

		if ( ! stack || stack.width !== width || stack.height !== height * maps.length ) {

			if ( stack ) gl.deleteTexture( stack.texture );
			stack = { texture: floatTexture( width, height * maps.length ), width, height: height * maps.length, key: '' };

		}

		gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, stackFramebuffer );
		gl.framebufferTexture2D( gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stack.texture, 0 );
		gl.bindFramebuffer( gl.READ_FRAMEBUFFER, environmentFramebuffer );

		maps.forEach( ( map, k ) => {

			gl.framebufferTexture2D( gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, map.texture, 0 );
			gl.blitFramebuffer( 0, 0, width, height, 0, k * height, width, ( k + 1 ) * height, gl.COLOR_BUFFER_BIT, gl.NEAREST );

		} );

		gl.framebufferTexture2D( gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0 );
		gl.bindFramebuffer( gl.READ_FRAMEBUFFER, null );
		gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, null );
		stack.key = key;
		return stack.texture;

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
		const source = kind === 1 ? prefiltered( id, lodMax, sources )?.texture : texture( id, sources );
		if ( ! source || source === white ) return null;
		upload( gl.UNIFORM_BUFFER, renderer.backgroundUniforms(), backgroundBuffer );
		return { texture: source, sampler: kind === 0 ? panoramaSampler : screenSampler };

	}

	// ---------------------------------------------------------------- frame

	gl.enable( gl.DEPTH_TEST );
	gl.frontFace( gl.CCW );
	const linearToSRGB = ( c ) => ( c <= 0.0031308 ? c * 12.92 : 1.055 * c ** ( 1 / 2.4 ) - 0.055 );

	function drawBackground( backdrop, srgb, flipY ) {

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

	// Draws `from` to `to` of the prepared frame with the mesh programs, the frame-wide
	// textures bound to their units.
	function drawRange( world, draws, from, to, srgb, flipY, objectData, materialData, environmentTexture, copy, sources, extras ) {

		gl.bindBufferBase( gl.UNIFORM_BUFFER, 0, frameBuffer );
		gl.activeTexture( gl.TEXTURE0 + SHADOW_UNIT );
		gl.bindTexture( gl.TEXTURE_2D_ARRAY, shadowTexture ?? ( ensureShadowTexture( 1, 1, 1, false ), shadowTexture ) );
		gl.activeTexture( gl.TEXTURE0 + ENVIRONMENT_UNIT );
		gl.bindTexture( gl.TEXTURE_2D, environmentTexture ?? white );
		gl.activeTexture( gl.TEXTURE0 + TRANSMISSION_UNIT );
		gl.bindTexture( gl.TEXTURE_2D, copy ?? white );
		gl.activeTexture( gl.TEXTURE0 + VSM_UNIT );
		gl.bindTexture( gl.TEXTURE_2D_ARRAY, vsmTexture ?? shadowTexture );
		gl.bindSampler( VSM_UNIT, vsmTexture ? null : depthSampler );
		gl.activeTexture( gl.TEXTURE0 + BONE_UNIT );
		gl.bindTexture( gl.TEXTURE_2D, boneTexture );
		let state = - 1, bound = null, set = null, triangles = 0, boundInstances, material = - 1, current = null;

		for ( let i = from, o = from * DRAW_FIELDS; i < to; i ++, o += DRAW_FIELDS ) {

			const entry = entries[ i ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ], custom = draws[ o + 7 ];
			const instance = perInstance[ i ], copies = instance ? draws[ o + 5 ] : 1;
			const quad = ( key & QUAD_KEY ) !== 0;
			const own = custom >= 16 ? extras?.shaderMaterials?.get( custom ) : null;

			if ( own ) {

				// a GLSL shader material: its program, the built-in uniforms of this draw, its uniforms
				const shader = shaderProgram( own, instance !== null, srgb );
				if ( shader !== current ) gl.useProgram( shader.id );
				current = shader;
				if ( shader.flip ) gl.uniform1f( shader.flip, flipY );
				const model = objectData.subarray( i * 64, i * 64 + 16 ), view = extras.view, modelView = multiply( view, model, new Float32Array( 16 ) );
				setUniforms( shader, own, { modelMatrix: model, viewMatrix: view, projectionMatrix: extras.projection, modelViewMatrix: modelView, normalMatrix: normalMatrix( modelView, new Float32Array( 9 ) ), cameraPosition: extras.position, isOrthographic: extras.orthographic }, sources );
				applyState( key );
				state = - 1;
				set = null;
				bindInstances( instance );
				boundInstances = instance;
				bindGeometry( entry );
				bindCustomAttributes( world, entry, shader );
				bound = null;
				draw( key, entry, start, vertices, copies );
				if ( ( key >> 5 & 3 ) === 0 ) triangles += vertices / 3 * copies;
				continue;

			}

			const shader = custom > 0 && custom < 16 ? effectProgram( custom, srgb ) : meshProgram( srgb, quad );

			if ( shader !== current ) {

				gl.useProgram( shader.id );
				gl.uniform1f( shader.uniform( 'flip_y' ), flipY );
				current = shader;

			}

			if ( key !== state ) applyState( state = key );

			const maps = setTextures[ draws[ o + 1 ] ];

			if ( maps !== set ) {

				bindMaps( maps );
				set = maps;

			}

			bindRange( 1, objectBuffer, i, OBJECT_STRIDE, objectData );

			if ( draws[ o + 6 ] !== material ) {

				material = draws[ o + 6 ];
				bindRange( 3, materialBuffer, material, MATERIAL_STRIDE, materialData );

			}

			if ( quad ) {

				const topology = key >> 5 & 3, [ first, count ] = quadInstances( topology, start, vertices );
				bindQuads( quadSource( world, entry ), topology, first );
				if ( count > 0 ) gl.drawArraysInstanced( gl.TRIANGLES, 0, 6, count );
				bound = null;
				boundInstances = undefined;
				continue;

			}

			if ( instance !== boundInstances ) {

				bindInstances( instance );
				boundInstances = instance;

			}

			if ( entry !== bound ) {

				bindGeometry( entry );
				bound = entry;

			}

			if ( key & WIREFRAME_KEY ) {

				drawWireframe( world, entry, start, vertices, copies );
				bound = null;

			} else draw( key, entry, start, vertices, copies );

			if ( ( key >> 5 & 3 ) === 0 ) triangles += vertices / 3 * copies;

		}

		gl.bindSampler( VSM_UNIT, null );
		return triangles;

	}

	return {

		name: 'webgl', isWebGLBackend: true, gl, info,

		/**
		 * Same arguments as the WebGPU host's `render`. `extras` carries what GLSL shader
		 * materials need: `{ shaderMaterials, view, projection, position, orthographic }`
		 * (the materials by custom id, the camera's view and projection matrices with WebGL
		 * depth, its world position).
		 */
		render( world, renderer, root, camera, clear, sources, instanceSources, target = null, pixelRatio = 1, extras = null ) {

			frameNumber ++;
			const offscreen = target ? renderTarget( target ) : null;
			drawingInto = target ? target.id : 0;
			const width = offscreen ? offscreen.width : Math.max( 1, canvas.width ), height = offscreen ? offscreen.height : Math.max( 1, canvas.height );
			renderer.setViewport( width, height, pixelRatio );
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

			const environmentTexture = environment( renderer.environmentInfo(), sources );
			const backdrop = background( renderer, sources );
			uploadBones( renderer );

			// Taken after the uploads above, which may have grown the module's memory.
			const objectData = count > 0 ? new Float32Array( memory().buffer, renderer.objectUniformsPtr(), renderer.objectUniformsLength() ) : new Float32Array( 0 );
			const materialData = new Float32Array( memory().buffer, renderer.materialUniformsPtr(), renderer.materialUniformsLength() );

			if ( ranges ) {

				if ( count > objectCapacity ) objectCapacity = Math.max( 64, Math.ceil( count * 1.5 ) );
				gl.bindBuffer( gl.UNIFORM_BUFFER, objectBuffer );
				gl.bufferData( gl.UNIFORM_BUFFER, objectCapacity * OBJECT_STRIDE, gl.DYNAMIC_DRAW );
				if ( count > 0 ) gl.bufferSubData( gl.UNIFORM_BUFFER, 0, objectData );
				const materials = materialData.length / MATERIAL_FLOATS;
				if ( materials > materialCapacity ) materialCapacity = Math.max( 16, Math.ceil( materials * 1.5 ) );
				gl.bindBuffer( gl.UNIFORM_BUFFER, materialBuffer );
				gl.bufferData( gl.UNIFORM_BUFFER, materialCapacity * MATERIAL_STRIDE, gl.DYNAMIC_DRAW );
				if ( materialData.length > 0 ) gl.bufferSubData( gl.UNIFORM_BUFFER, 0, materialData );

			}

			const shadowCalls = drawShadows( renderer, instanceSources, materialData );

			// Tone mapping applies only to what is drawn to the canvas, through a linear target.
			let toneMapping = offscreen ? 0 : frameUniforms[ TONE_MAPPING ];

			if ( toneMapping !== 0 && ! floatTargets ) {

				warn( 'tone mapping needs EXT_color_buffer_float; drawn without it' );
				toneMapping = 0;

			}

			// Render targets are drawn upside down (see `flip_y` in the GLSL), which also
			// turns the winding of front faces.
			const flipY = offscreen ? - 1 : 1;
			const transmissive = renderer.transmissiveCount();
			let copy = null;

			if ( transmissive > 0 ) {

				// the background and the opaque draws, into the copy transmissive materials read
				const copyTarget = transmissionTarget( width, height );
				gl.bindFramebuffer( gl.FRAMEBUFFER, copyTarget.framebuffer );
				gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
				gl.viewport( 0, 0, width, height );
				gl.depthMask( true );
				gl.clearColor( clear.r, clear.g, clear.b, clear.a );
				gl.clearDepth( 1 );
				gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
				gl.frontFace( gl.CW );
				if ( backdrop ) drawBackground( backdrop, false, - 1 );
				drawRange( world, draws, 0, renderer.opaqueCount(), false, - 1, objectData, materialData, environmentTexture, null, sources, extras );
				gl.bindTexture( gl.TEXTURE_2D, copyTarget.color );
				gl.generateMipmap( gl.TEXTURE_2D );
				copy = copyTarget.color;

			}

			// Canvas frames go through a linear half-float target when possible, so that
			// blending happens in linear light as on WebGPU; the output pass then tone-maps
			// (if asked) and encodes to sRGB.
			const linearTarget = ! offscreen && floatTargets ? hdrTarget( width, height ) : null;
			const srgb = ! offscreen && ! linearTarget;
			gl.bindFramebuffer( gl.FRAMEBUFFER, offscreen ? offscreen.draw : linearTarget ? linearTarget.draw : null );
			// extra colour attachments of a render target are not written
			if ( offscreen || linearTarget ) gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );
			gl.viewport( 0, 0, width, height );
			gl.depthMask( true );
			// the clear colour is linear; the canvas holds sRGB
			const encode = srgb ? linearToSRGB : ( c ) => c;
			gl.clearColor( encode( clear.r ), encode( clear.g ), encode( clear.b ), clear.a );
			gl.clearDepth( 1 );
			if ( extras?.load !== true ) gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
			gl.frontFace( offscreen ? gl.CW : gl.CCW );
			if ( backdrop ) drawBackground( backdrop, srgb, flipY );
			const triangles = drawRange( world, draws, 0, count, srgb, flipY, objectData, materialData, environmentTexture, copy, sources, extras );

			if ( offscreen && offscreen.draw !== offscreen.framebuffer ) {

				gl.bindFramebuffer( gl.READ_FRAMEBUFFER, offscreen.draw );
				gl.bindFramebuffer( gl.DRAW_FRAMEBUFFER, offscreen.framebuffer );
				gl.blitFramebuffer( 0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST );

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
			transmission?.release();
			for ( const texture_ of [ shadowTexture, vsmTexture, vsmScratch, boneTexture, stack?.texture ] ) if ( texture_ ) gl.deleteTexture( texture_ );
			for ( const buffer of [ frameBuffer, objectBuffer, materialBuffer, shadowObjectBuffer, backgroundBuffer, scratchBuffer ] ) gl.deleteBuffer( buffer );
			for ( const framebuffer of [ shadowFramebuffer, environmentFramebuffer, stackFramebuffer, vsmFramebuffer ] ) gl.deleteFramebuffer( framebuffer );
			for ( const sampler of [ panoramaSampler, screenSampler, depthSampler ] ) gl.deleteSampler( sampler );
			gl.deleteTexture( white );
			for ( const { id } of programs.values() ) gl.deleteProgram( id );
			programs.clear();

		}

	};

}
