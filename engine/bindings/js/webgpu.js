// WebGPU host for the WAMR3D renderer.
//
// The engine decides what is drawn (culling, order, pipeline state, uniform data,
// shader); this file only turns that into WebGPU calls and keeps the GPU copies of
// geometry and textures up to date.

import { Renderer, memory } from './index.js';

const WRAPS = { 1000: 'repeat', 1001: 'clamp-to-edge', 1002: 'mirror-repeat' };
// Texture filter constants: nearest 1003, linear 1006, and their mipmapped variants.
const LINEAR = new Set( [ 1006, 1007, 1008 ] ), MIPMAPPED = new Set( [ 1004, 1005, 1007, 1008 ] ), MIP_LINEAR = new Set( [ 1005, 1008 ] );
const UNUSED_FRAMES = 300;

// Vertex inputs of the shader, in location order: name, floats per vertex. The same
// order as the records of `Renderer.geometryState`.
const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
const TOPOLOGIES = [ 'triangle-list', 'line-strip', 'line-list', 'point-list' ];

// Per-instance inputs follow the per-vertex ones: a matrix as four columns, then a colour.
const VERTEX_BUFFERS = [
	...ATTRIBUTES.map( ( [ , size ], shaderLocation ) => ( { arrayStride: size * 4, attributes: [ { shaderLocation, offset: 0, format: `float32x${size}` } ] } ) ),
	{ arrayStride: 64, stepMode: 'instance', attributes: [ 0, 1, 2, 3 ].map( ( column ) => ( { shaderLocation: 4 + column, offset: column * 16, format: 'float32x4' } ) ) },
	{ arrayStride: 12, stepMode: 'instance', attributes: [ { shaderLocation: 8, offset: 0, format: 'float32x3' } ] }
];
const MATRIX_SLOT = ATTRIBUTES.length, COLOR_SLOT = ATTRIBUTES.length + 1, DRAW_FIELDS = 6;
// With tone mapping the scene is drawn into this linear format, then tone-mapped onto the canvas.
const HDR_FORMAT = 'rgba16float', HDR_KEY = 1 << 10;
// Render targets hold linear colour without encoding (three.js NoColorSpace); RGBA8_KEY
// marks pipelines for such a target, SINGLE_KEY those without multisampling.
const RGBA8_KEY = 1 << 11, SINGLE_KEY = 1 << 12;

// Prefiltered environments (three.js PMREM): smallest face of the detailed levels, and
// the extra, ever blurrier levels kept at that size.
const LOD_MIN = 4, EXTRA_LODS = 6;
const FACE_ORDER = [ 3, 1, 5, 0, 4, 2 ];

// The quads of one level of the cube-UV layout, with the direction each texel stands
// for: positions are clip coordinates, then the direction (6 floats per vertex).
function cubeUVLevel( size ) {

	const texel = 1 / ( size - 2 ), min = - texel, max = 1 + texel;
	const uv = [ min, min, max, min, max, max, min, min, max, max, min, max ];
	const data = new Float32Array( 6 * 6 * 6 );

	for ( let face = 0; face < 6; face ++ ) {

		const x = ( face % 3 ) * 2 / 3 - 1, y = face > 2 ? 0 : - 1;
		const corners = [ x, y, x + 2 / 3, y, x + 2 / 3, y + 1, x, y, x + 2 / 3, y + 1, x, y + 1 ];
		const index = FACE_ORDER[ face ];

		for ( let vertex = 0; vertex < 6; vertex ++ ) {

			const u = uv[ vertex * 2 ] * 2 - 1, v = uv[ vertex * 2 + 1 ] * 2 - 1;
			const direction = [ [ 1, v, u ], [ - u, 1, - v ], [ - u, v, 1 ], [ - 1, v, - u ], [ - u, - 1, v ], [ u, v, - 1 ] ][ index ];
			data.set( [ corners[ vertex * 2 ], corners[ vertex * 2 + 1 ], 0, ...direction ], ( index * 6 + vertex ) * 6 );

		}

	}

	return data;

}

const BLIT = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
struct Output { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Output {
    var output: Output;
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    output.position = vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
    output.uv = vec2<f32>(corner.x, 1.0 - corner.y);
    return output;
}
@fragment fn fragment(input: Output) -> @location(0) vec4<f32> {
    return textureSample(source, source_sampler, input.uv);
}`;

export async function createBackend( canvas, { antialias = true, powerPreference = 'high-performance' } = {} ) {

	if ( ! globalThis.navigator?.gpu ) throw new Error( 'WAMR3D: WebGPU is not available in this browser' );
	const adapter = await navigator.gpu.requestAdapter( { powerPreference } );
	if ( ! adapter ) throw new Error( 'WAMR3D: no WebGPU adapter found' );
	const device = await adapter.requestDevice();

	const context = canvas.getContext( 'webgpu' );
	// The shader writes linear colour into an sRGB view of the canvas, so blending and
	// the multisample resolve happen in linear light and the GPU encodes on write.
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat(), format = canvasFormat + '-srgb';
	context.configure( { device, format: canvasFormat, viewFormats: [ format ], alphaMode: 'opaque' } );

	const samples = antialias ? 4 : 1;
	const stride = Renderer.objectUniformSize(), objectBindingBytes = Renderer.objectBindingSize();
	const GEOMETRY_FIELDS = Renderer.geometryStateSize();
	const module = device.createShaderModule( { code: Renderer.shaderSource() } );
	const TONE_MAPPING = Renderer.toneMappingIndex(), EXPOSURE = Renderer.toneMappingExposureIndex();

	const frameLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} } ] } );
	const objectLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: objectBindingBytes } } ] } );
	const textureLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} } ] } );
	// Group 3 holds what the whole frame samples: the shadow maps and the environment.
	const shadowLayout = device.createBindGroupLayout( { entries: [
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
		{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
		{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
	] } );
	const layout = device.createPipelineLayout( { bindGroupLayouts: [ frameLayout, objectLayout, textureLayout, shadowLayout ] } );

	// Shadow maps: one layer per shadow-casting light, depth only. Bilinear comparison
	// sampling, as three.js uses for PCFShadowMap when the device supports it.
	const MAX_SHADOWS = Renderer.maxShadows(), SHADOW_FORMAT = 'depth32float';
	const shadowSampler = device.createSampler( { compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' } );
	const shadowModule = device.createShaderModule( { code: Renderer.shadowShaderSource() } );
	const shadowCameraLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { hasDynamicOffset: true, minBindingSize: 64 } } ] } );
	const shadowPipelineLayout = device.createPipelineLayout( { bindGroupLayouts: [ shadowCameraLayout, objectLayout ] } );
	const shadowPipelines = new Map();
	let shadowTexture = device.createTexture( { size: [ 1, 1, 1 ], format: SHADOW_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
	const environmentSampler = device.createSampler( { magFilter: 'linear', minFilter: 'linear' } );
	const noEnvironment = device.createTexture( { size: [ 1, 1 ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING } );
	const noEnvironmentView = noEnvironment.createView();
	let environmentView = noEnvironmentView, shadowGroup = null;

	function frameTexturesGroup() {

		shadowGroup = device.createBindGroup( { layout: shadowLayout, entries: [
			{ binding: 0, resource: shadowTexture.createView( { dimension: '2d-array' } ) },
			{ binding: 1, resource: shadowSampler },
			{ binding: 2, resource: environmentView },
			{ binding: 3, resource: environmentSampler }
		] } );

	}

	frameTexturesGroup();

	// Prefiltered environment maps by source texture id, rebuilt when the source changes.
	const environments = new Map();
	let pmrem = null;

	function prefilter( source, gpuSource, lodMax ) {

		if ( ! pmrem ) {

			const pmremModule = device.createShaderModule( { code: Renderer.pmremShaderSource() } );
			const vertex = { module: pmremModule, entryPoint: 'vertex', buffers: [ { arrayStride: 24, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' } ] } ] };
			pmrem = {
				equirect: device.createRenderPipeline( { layout: 'auto', vertex, fragment: { module: pmremModule, entryPoint: 'equirect', targets: [ { format: HDR_FORMAT } ] } } ),
				ggx: device.createRenderPipeline( { layout: 'auto', vertex, fragment: { module: pmremModule, entryPoint: 'ggx', targets: [ { format: HDR_FORMAT } ] } } ),
				sampler: device.createSampler( { magFilter: 'linear', minFilter: 'linear' } ),
				levels: new Map()
			};

		}

		const cubeSize = 2 ** lodMax, width = 3 * Math.max( cubeSize, 16 * 7 ), height = 4 * cubeSize;
		const total = lodMax - LOD_MIN + 1 + EXTRA_LODS, sizes = [];
		for ( let i = 0, lod = lodMax; i < total; i ++ ) {

			sizes.push( 2 ** lod );
			if ( lod > LOD_MIN ) lod --;

		}

		const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
		const cubeUV = device.createTexture( { size: [ width, height ], format: HDR_FORMAT, usage } );
		const pingPong = device.createTexture( { size: [ width, height ], format: HDR_FORMAT, usage } );
		const cubeView = cubeUV.createView(), pingView = pingPong.createView();
		const passes = 1 + 2 * ( total - 1 );
		const settings = device.createBuffer( { size: 256 * passes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
		const filter = ( value ) => ( LINEAR.has( value ?? 1006 ) ? 'linear' : 'nearest' );
		const sourceSampler = device.createSampler( { magFilter: filter( source.magFilter ), minFilter: filter( source.minFilter ), addressModeU: WRAPS[ source.wrapS ] ?? 'clamp-to-edge', addressModeV: WRAPS[ source.wrapT ] ?? 'clamp-to-edge' } );

		const level = ( size ) => {

			let buffer = pmrem.levels.get( size );
			if ( ! buffer ) {

				const data = cubeUVLevel( size );
				buffer = device.createBuffer( { size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } );
				device.queue.writeBuffer( buffer, 0, data );
				pmrem.levels.set( size, buffer );

			}

			return buffer;

		};

		const encoder = device.createCommandEncoder();
		const draw = ( pass, pipeline, sourceView, sampler, levelSize, target, clear, x, y, w, h ) => {

			const group = device.createBindGroup( { layout: pipeline.getBindGroupLayout( 0 ), entries: [
				{ binding: 0, resource: { buffer: settings, offset: pass * 256, size: 32 } },
				{ binding: 1, resource: sourceView },
				{ binding: 2, resource: sampler }
			] } );
			const renderPass = encoder.beginRenderPass( { colorAttachments: [ { view: target, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } } ] } );
			renderPass.setViewport( x, y, w, h, 0, 1 );
			renderPass.setScissorRect( x, y, w, h );
			renderPass.setPipeline( pipeline );
			renderPass.setBindGroup( 0, group );
			renderPass.setVertexBuffer( 0, level( levelSize ) );
			renderPass.draw( 36 );
			renderPass.end();

		};

		const uniforms = new Float32Array( 64 * passes );
		const set = ( pass, roughness, mip ) => uniforms.set( [ roughness, mip, 1 / width, 1 / height, lodMax, 0, 0, 0 ], pass * 64 );
		set( 0, 0, 0 );
		draw( 0, pmrem.equirect, gpuSource.createView(), sourceSampler, sizes[ 0 ], cubeView, true, 0, 0, 3 * cubeSize, 2 * cubeSize );

		// Each level is convolved from the one before into the ping-pong target, then
		// copied back (roughness 0 reads one texel), as three.js does.
		for ( let out = 1, pass = 1; out < total; out ++, pass += 2 ) {

			const target = out / ( total - 1 ), previous = ( out - 1 ) / ( total - 1 );
			const roughness = Math.sqrt( target * target - previous * previous ) * target * 1.25;
			const size = sizes[ out ];
			const x = 3 * size * ( out > lodMax - LOD_MIN ? out - lodMax + LOD_MIN : 0 ), y = 4 * ( cubeSize - size );
			set( pass, roughness, lodMax - ( out - 1 ) );
			set( pass + 1, 0, lodMax - out );
			draw( pass, pmrem.ggx, cubeView, pmrem.sampler, size, pingView, out === 1, x, y, 3 * size, 2 * size );
			draw( pass + 1, pmrem.ggx, pingView, pmrem.sampler, size, cubeView, false, x, y, 3 * size, 2 * size );

		}

		device.queue.writeBuffer( settings, 0, uniforms );
		device.queue.submit( [ encoder.finish() ] );
		pingPong.destroy();
		settings.destroy();
		return cubeUV;

	}

	// The prefiltered map of the frame's environment, or the empty one while the source
	// is not ready.
	function environment( info, sources ) {

		if ( info.length === 0 ) return noEnvironmentView;
		const [ id, lodMax ] = info, source = sources?.get( id );
		texture( id, sources );
		const gpuSource = textures.get( id )?.texture;
		if ( ! source || ! gpuSource ) return null;

		let entry = environments.get( id );
		if ( entry && entry.version === source.version && entry.lodMax === lodMax ) {

			entry.checked = frameNumber;
			return entry.view;

		}

		entry?.texture.destroy();
		const cubeUV = prefilter( source, gpuSource, lodMax );
		entry = { version: source.version, lodMax, texture: cubeUV, view: cubeUV.createView(), checked: frameNumber };
		environments.set( id, entry );
		return entry.view;

	}
	let shadowCameras = null, shadowCameraGroup = null, shadowObjects = null, shadowObjectGroup = null, shadowObjectCapacity = 0;

	// Casters draw their back faces (three.js draws the opposite of `material.side`).
	function shadowPipeline( key ) {

		let value = shadowPipelines.get( key );
		if ( value ) return value;
		value = device.createRenderPipeline( {
			layout: shadowPipelineLayout,
			vertex: { module: shadowModule, entryPoint: 'vertex', buffers: VERTEX_BUFFERS.map( ( buffer, slot ) => ( slot === 0 || slot === MATRIX_SLOT ? buffer : null ) ) },
			primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: [ 'back', 'front', 'none' ][ key & 3 ] },
			depthStencil: { format: SHADOW_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' }
		} );
		shadowPipelines.set( key, value );
		return value;

	}

	function ensureShadowTexture( width, height ) {

		if ( shadowTexture.width === width && shadowTexture.height === height && shadowTexture.depthOrArrayLayers === MAX_SHADOWS ) return;
		shadowTexture.destroy();
		shadowTexture = device.createTexture( { size: [ width, height, MAX_SHADOWS ], format: SHADOW_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
		frameTexturesGroup();

	}

	// Draws each shadow pass of the prepared frame into its layer. Casters use the same
	// geometry and instance buffers as the main pass.
	function drawShadows( encoder, renderer, sources, instanceSources ) {

		const passes = renderer.shadowCount();
		if ( passes === 0 ) return 0;
		const [ width, height ] = renderer.shadowMapSize();
		ensureShadowTexture( width, height );

		if ( ! shadowCameras ) {

			shadowCameras = device.createBuffer( { size: 256 * MAX_SHADOWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
			shadowCameraGroup = device.createBindGroup( { layout: shadowCameraLayout, entries: [ { binding: 0, resource: { buffer: shadowCameras, size: 64 } } ] } );

		}

		const infos = [], uniforms = [];
		let total = 0;

		for ( let p = 0; p < passes; p ++ ) {

			const info = renderer.shadowPassInfo( p );
			infos.push( { layer: info[ 0 ], width: info[ 1 ], height: info[ 2 ], draws: renderer.shadowDrawInfo( p ), slots: renderer.shadowDrawGeometrySlots( p ), first: total } );
			device.queue.writeBuffer( shadowCameras, p * 256, new Float32Array( info.subarray( 3, 19 ) ) );
			const objectData = renderer.shadowObjectUniforms( p );
			uniforms.push( objectData );
			total += objectData.length / ( stride / 4 );

		}

		if ( total > shadowObjectCapacity ) {

			shadowObjects?.destroy();
			shadowObjectCapacity = Math.max( 64, Math.ceil( total * 1.5 ) );
			shadowObjects = device.createBuffer( { size: shadowObjectCapacity * stride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
			shadowObjectGroup = device.createBindGroup( { layout: objectLayout, entries: [ { binding: 0, resource: { buffer: shadowObjects, size: objectBindingBytes } } ] } );

		}

		let calls = 0;

		for ( let p = 0; p < passes; p ++ ) {

			const { layer, width: w, height: h, draws, slots, first } = infos[ p ];
			if ( uniforms[ p ].length > 0 ) device.queue.writeBuffer( shadowObjects, first * stride, uniforms[ p ] );

			const pass = encoder.beginRenderPass( {
				colorAttachments: [],
				depthStencilAttachment: { view: shadowTexture.createView( { dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 } ), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }
			} );
			pass.setViewport( 0, 0, w, h, 0, 1 );
			pass.setBindGroup( 0, shadowCameraGroup, [ p * 256 ] );
			let state = - 1, bound = null, boundInstances;

			for ( let i = 0, o = 0; i < slots.length; i ++, o += DRAW_FIELDS ) {

				const entry = distinct[ slots[ i ] ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				const instance = instances( draws[ o + 4 ], draws[ o + 5 ], instanceSources ), copies = instance ? draws[ o + 5 ] : 1;
				if ( key !== state ) pass.setPipeline( shadowPipeline( state = key ) );

				if ( instance !== boundInstances ) {

					pass.setVertexBuffer( MATRIX_SLOT, instance ? instance.matrix : identity );
					boundInstances = instance;

				}

				if ( entry !== bound ) {

					pass.setVertexBuffer( 0, entry.buffers[ 0 ] );
					if ( entry.index ) pass.setIndexBuffer( entry.index, 'uint32' );
					bound = entry;

				}

				pass.setBindGroup( 1, shadowObjectGroup, [ ( first + i ) * stride ] );
				if ( entry.index ) pass.drawIndexed( vertices, copies, start );
				else pass.draw( vertices, copies, start );
				calls ++;

			}

			pass.end();

		}

		return calls;

	}

	// Pipelines are created the first time a state is drawn and kept. The key is the
	// engine's pipeline state: bits 0-1 side, 2 blending, 3 depth write, 4 depth test,
	// 5-6 primitive; HDR_KEY marks pipelines that draw into the linear target.
	const pipelines = new Map();

	function pipeline( key ) {

		let value = pipelines.get( key );
		if ( value ) return value;

		const topology = TOPOLOGIES[ key >> 5 & 3 ];
		const blend = key & 4 ? {
			color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
			alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
		} : undefined;

		value = device.createRenderPipeline( {
			layout,
			vertex: {
				module, entryPoint: 'vertex',
				buffers: VERTEX_BUFFERS
			},
			fragment: { module, entryPoint: 'fragment', targets: [ { format: key & HDR_KEY ? HDR_FORMAT : key & RGBA8_KEY ? 'rgba8unorm' : format, blend } ] },
			primitive: { topology, frontFace: 'ccw', cullMode: [ 'back', 'front', 'none' ][ key & 3 ], stripIndexFormat: topology === 'line-strip' ? 'uint32' : undefined },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: ( key & 8 ) !== 0, depthCompare: key & 16 ? 'less-equal' : 'always' },
			multisample: { count: key & SINGLE_KEY ? 1 : samples }
		} );
		pipelines.set( key, value );
		return value;

	}

	let frameBuffer = null, frameGroup = null;
	let objectBuffer = null, objectGroup = null, objectCapacity = 0;
	let depthTexture = null, colorTexture = null, depthView = null, colorView = null, targetWidth = 0, targetHeight = 0;
	// The linear target of a tone-mapped frame, its multisampled companion, and the output pass.
	let hdrTexture = null, hdrMultisample = null, hdrView = null, hdrMultisampleView = null, outputGroup = null, outputPipeline = null, outputSettings = null;
	// Bound in place of an attribute a geometry does not have.
	let zeros = null, zeroBytes = 16;
	const geometries = new Map(), textures = new Map(), blits = new Map(), instanced = new Map();
	// Per-frame lists, kept between frames so that drawing does not allocate them.
	const entries = [], groups = [], perInstance = [], distinct = [];

	// What an object without instances is drawn with: one identity matrix. `ones` is the
	// instance colour of everything that has none, and grows with the largest count.
	const identity = device.createBuffer( { size: 64, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } );
	device.queue.writeBuffer( identity, 0, new Float32Array( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] ) );
	let ones = null, oneCount = 1;
	let frameNumber = 0, drawingInto = 0;
	const info = { calls: 0, shadowCalls: 0, triangles: 0, candidates: 0, geometries: 0, textures: 0, pipelines: 0, uploads: 0 };

	function textureGroup( gpuTexture, source ) {

		const filter = ( value ) => ( LINEAR.has( value ?? 1006 ) ? 'linear' : 'nearest' );
		const sampler = device.createSampler( {
			magFilter: filter( source?.magFilter ), minFilter: filter( source?.minFilter ),
			mipmapFilter: MIP_LINEAR.has( source?.minFilter ) ? 'linear' : 'nearest',
			addressModeU: WRAPS[ source?.wrapS ] ?? 'clamp-to-edge', addressModeV: WRAPS[ source?.wrapT ] ?? 'clamp-to-edge'
		} );
		return device.createBindGroup( { layout: textureLayout, entries: [ { binding: 0, resource: gpuTexture.createView() }, { binding: 1, resource: sampler } ] } );

	}

	function createTexture( width, height, srgb, mipLevelCount = 1 ) {

		return device.createTexture( { size: [ width, height ], mipLevelCount, format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT } );

	}

	// Fills every mip level from the one above it with a filtered draw.
	function generateMipmaps( gpuTexture ) {

		let blit = blits.get( gpuTexture.format );

		if ( ! blit ) {

			const blitModule = device.createShaderModule( { code: BLIT } );
			blit = {
				pipeline: device.createRenderPipeline( { layout: 'auto', vertex: { module: blitModule, entryPoint: 'vertex' }, fragment: { module: blitModule, entryPoint: 'fragment', targets: [ { format: gpuTexture.format } ] } } ),
				sampler: device.createSampler( { magFilter: 'linear', minFilter: 'linear' } )
			};
			blits.set( gpuTexture.format, blit );

		}

		const encoder = device.createCommandEncoder();

		for ( let level = 1; level < gpuTexture.mipLevelCount; level ++ ) {

			const group = device.createBindGroup( { layout: blit.pipeline.getBindGroupLayout( 0 ), entries: [
				{ binding: 0, resource: gpuTexture.createView( { baseMipLevel: level - 1, mipLevelCount: 1 } ) },
				{ binding: 1, resource: blit.sampler }
			] } );
			const pass = encoder.beginRenderPass( { colorAttachments: [ { view: gpuTexture.createView( { baseMipLevel: level, mipLevelCount: 1 } ), loadOp: 'clear', storeOp: 'store' } ] } );
			pass.setPipeline( blit.pipeline );
			pass.setBindGroup( 0, group );
			pass.draw( 3 );
			pass.end();

		}

		device.queue.submit( [ encoder.finish() ] );

	}

	const white = createTexture( 1, 1, false );
	device.queue.writeTexture( { texture: white }, new Uint8Array( [ 255, 255, 255, 255 ] ), {}, [ 1, 1 ] );
	const whiteGroup = textureGroup( white, null );

	// A material's colour texture. Uploaded when the source's version changes; a source
	// that is not ready yet (an image still loading) draws as white.
	function texture( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );

		if ( source?.isRenderTargetTexture ) {

			// Not while drawing into the same target; not before it was drawn once.
			if ( id === drawingInto ) return whiteGroup;
			return renderTargets.get( id )?.group ?? whiteGroup;

		}

		const image = source?.image;
		if ( ! image || ! ( image.data || image.width > 0 ) ) return whiteGroup;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, group: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.group;

		const { width, height } = image, srgb = source.colorSpace === 'srgb';
		const levels = source.generateMipmaps !== false && MIPMAPPED.has( source.minFilter ) ? Math.floor( Math.log2( Math.max( width, height ) ) ) + 1 : 1;

		if ( ! entry.texture || entry.texture.width !== width || entry.texture.height !== height || entry.srgb !== srgb || entry.texture.mipLevelCount !== levels ) {

			entry.texture?.destroy();
			entry.texture = createTexture( width, height, entry.srgb = srgb, levels );

		}

		if ( image.data ) device.queue.writeTexture( { texture: entry.texture }, image.data, { bytesPerRow: width * 4 }, [ width, height ] );
		else device.queue.copyExternalImageToTexture( { source: image, flipY: source.flipY !== false }, { texture: entry.texture }, [ width, height ] );
		if ( levels > 1 ) generateMipmaps( entry.texture );

		entry.group = textureGroup( entry.texture, source );
		entry.version = source.version;
		return entry.group;

	}

	function ensureHdrTargets() {

		if ( hdrTexture && hdrTexture.width === targetWidth && hdrTexture.height === targetHeight ) return;
		hdrTexture?.destroy();
		hdrMultisample?.destroy();
		hdrTexture = device.createTexture( { size: [ targetWidth, targetHeight ], format: HDR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING } );
		hdrMultisample = samples > 1 ? device.createTexture( { size: [ targetWidth, targetHeight ], format: HDR_FORMAT, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT } ) : null;
		hdrView = hdrTexture.createView();
		hdrMultisampleView = hdrMultisample ? hdrMultisample.createView() : null;

		if ( ! outputPipeline ) {

			const outputModule = device.createShaderModule( { code: Renderer.outputShaderSource() } );
			outputPipeline = device.createRenderPipeline( { layout: 'auto', vertex: { module: outputModule, entryPoint: 'vertex' }, fragment: { module: outputModule, entryPoint: 'fragment', targets: [ { format } ] } } );
			outputSettings = device.createBuffer( { size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );

		}

		outputGroup = device.createBindGroup( { layout: outputPipeline.getBindGroupLayout( 0 ), entries: [ { binding: 0, resource: { buffer: outputSettings } }, { binding: 1, resource: hdrView } ] } );

	}

	// GPU side of render targets, by the id of their texture: colour (multisampled when
	// asked), depth, and the bind group that samples the colour as a material map.
	const renderTargets = new Map();

	function renderTarget( target ) {

		let entry = renderTargets.get( target.id );
		// Multisampling needs pipelines for 4 samples, which exist only with antialias.
		const { width, height } = target, float = target.type !== 'byte', multisampled = target.samples > 1 && samples > 1;
		if ( entry && entry.width === width && entry.height === height && entry.float === float && entry.multisampled === multisampled ) return entry;
		if ( entry ) release( entry );

		const colorFormat = float ? HDR_FORMAT : 'rgba8unorm';
		const color = device.createTexture( { size: [ width, height ], format: colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING } );
		const colorMultisample = multisampled ? device.createTexture( { size: [ width, height ], format: colorFormat, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT } ) : null;
		const depth = device.createTexture( { size: [ width, height ], format: 'depth24plus', sampleCount: multisampled ? 4 : 1, usage: GPUTextureUsage.RENDER_ATTACHMENT } );
		entry = {
			width, height, float, multisampled, color, colorMultisample, depth,
			view: color.createView(), multisampleView: colorMultisample?.createView() ?? null, depthView: depth.createView(),
			variant: ( float ? HDR_KEY : RGBA8_KEY ) | ( multisampled ? 0 : SINGLE_KEY ),
			group: null, release() {

				color.destroy();
				colorMultisample?.destroy();
				depth.destroy();

			}
		};
		entry.group = textureGroup( color, target.texture );
		renderTargets.set( target.id, entry );
		return entry;

	}

	function ensureTargets() {

		const width = Math.max( 1, canvas.width ), height = Math.max( 1, canvas.height );
		if ( width === targetWidth && height === targetHeight ) return;
		depthTexture?.destroy();
		colorTexture?.destroy();
		depthTexture = device.createTexture( { size: [ width, height ], format: 'depth24plus', sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT } );
		colorTexture = samples > 1 ? device.createTexture( { size: [ width, height ], format, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT } ) : null;
		depthView = depthTexture.createView();
		colorView = colorTexture ? colorTexture.createView() : null;
		targetWidth = width;
		targetHeight = height;

	}

	function upload( data, existing, usage ) {

		let buffer = existing;

		if ( ! buffer || buffer.size < data.byteLength ) {

			existing?.destroy();
			buffer = device.createBuffer( { size: Math.max( 16, data.byteLength ), usage: usage | GPUBufferUsage.COPY_DST } );

		}

		device.queue.writeBuffer( buffer, 0, data );
		info.uploads ++;
		return buffer;

	}

	// GPU buffers follow the engine's data: an attribute or the index is uploaded again
	// only when its version changes. `state[ o ... ]` is the geometry's record from
	// `Renderer.geometryState`. Entries are keyed by the handle's slot; a new generation
	// in the slot means the geometry was disposed and the slot reused.
	function geometry( world, state, o ) {

		const slot = state[ o ], generation = state[ o + 1 ], vertices = state[ o + 2 ];
		let entry = geometries.get( slot );

		if ( entry && entry.generation !== generation ) {

			release( entry );
			entry = undefined;

		}

		if ( ! entry ) geometries.set( slot, entry = { generation, buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], index: null, indexVersion: - 1, checked: 0 } );
		entry.checked = frameNumber;

		for ( let i = 0, p = o + 3; i < ATTRIBUTES.length; i ++, p += 2 ) {

			const version = state[ p ], address = state[ p + 1 ];

			if ( address === 0 ) {

				entry.buffers[ i ]?.destroy();
				entry.buffers[ i ] = null;
				entry.versions[ i ] = - 1;
				zeroBytes = Math.max( zeroBytes, vertices * 12 );
				continue;

			}

			if ( version === entry.versions[ i ] ) continue;
			// Created per upload: the index read below may grow the module's memory.
			entry.buffers[ i ] = upload( new Float32Array( memory().buffer, address, vertices * ATTRIBUTES[ i ][ 1 ] ), entry.buffers[ i ], GPUBufferUsage.VERTEX );
			entry.versions[ i ] = version;

		}

		const indexVersion = state[ o + 3 + ATTRIBUTES.length * 2 ];

		if ( indexVersion !== entry.indexVersion ) {

			const index = world.getIndex( BigInt( generation ) << 32n | BigInt( slot ) );

			if ( index.length === 0 ) {

				entry.index?.destroy();
				entry.index = null;

			} else {

				entry.index = upload( index, entry.index, GPUBufferUsage.INDEX );

			}

			entry.indexVersion = indexVersion;

		}

		return entry;

	}

	// Instance matrices and colours live in typed arrays on the JavaScript side; they are
	// uploaded when their version changes.
	function instances( id, count, sources ) {

		const source = id === 0 ? null : sources?.get( id );
		if ( ! source ) return null;

		let entry = instanced.get( id );
		if ( ! entry ) instanced.set( id, entry = { matrix: null, color: null, matrixVersion: - 1, colorVersion: - 1, checked: 0 } );
		entry.checked = frameNumber;

		if ( entry.matrixVersion !== source.matrixVersion ) {

			entry.matrix = upload( source.matrix, entry.matrix, GPUBufferUsage.VERTEX );
			entry.matrixVersion = source.matrixVersion;

		}

		if ( source.color === null ) {

			entry.color?.destroy();
			entry.color = null;
			entry.colorVersion = - 1;
			oneCount = Math.max( oneCount, count );

		} else if ( entry.colorVersion !== source.colorVersion ) {

			entry.color = upload( source.color, entry.color, GPUBufferUsage.VERTEX );
			entry.colorVersion = source.colorVersion;

		}

		return entry;

	}

	function release( entry ) {

		if ( entry.release ) return entry.release();
		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.index?.destroy();

	}

	return {

		device, format, info,

		/**
		 * `instanceSources` maps instance ids to `{ matrix, matrixVersion, color, colorVersion }`
		 * (16 floats and optionally 3 floats per instance).
		 * `clear` is a linear colour `{ r, g, b, a }`. `sources` maps texture ids to `{ image, version, flipY, magFilter, minFilter, wrapS, wrapT, colorSpace, generateMipmaps }`.
		 * `target`, when given, is a render target `{ id, width, height, samples, type, texture }`
		 * (`type` 'byte' or 'float'): the frame is drawn into it, without tone mapping. */
		render( world, renderer, root, camera, clear, sources, instanceSources, target = null ) {

			frameNumber ++;
			const offscreen = target ? renderTarget( target ) : null;
			drawingInto = target ? target.id : 0;
			if ( ! offscreen ) ensureTargets();

			const count = renderer.prepare( world, root, camera );
			info.candidates = renderer.candidateCount();

			const frameUniforms = renderer.frameUniforms();

			if ( ! frameBuffer ) {

				frameBuffer = device.createBuffer( { size: frameUniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
				frameGroup = device.createBindGroup( { layout: frameLayout, entries: [ { binding: 0, resource: { buffer: frameBuffer } } ] } );

			}

			device.queue.writeBuffer( frameBuffer, 0, frameUniforms );

			if ( count > objectCapacity ) {

				objectBuffer?.destroy();
				objectCapacity = Math.max( 64, Math.ceil( count * 1.5 ) );
				objectBuffer = device.createBuffer( { size: objectCapacity * stride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
				objectGroup = device.createBindGroup( { layout: objectLayout, entries: [ { binding: 0, resource: { buffer: objectBuffer, size: objectBindingBytes } } ] } );

			}

			const geometryState = renderer.geometryState(), slots = renderer.drawGeometrySlots(), draws = renderer.drawInfo();
			const records = geometryState.length / GEOMETRY_FIELDS;
			entries.length = groups.length = perInstance.length = count;
			distinct.length = records;
			for ( let r = 0; r < records; r ++ ) distinct[ r ] = geometry( world, geometryState, r * GEOMETRY_FIELDS );

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				entries[ i ] = distinct[ slots[ i ] ];
				groups[ i ] = texture( draws[ o + 1 ], sources );
				perInstance[ i ] = instances( draws[ o + 4 ], draws[ o + 5 ], instanceSources );

			}

			if ( ! ones || ones.size < oneCount * 12 ) {

				ones?.destroy();
				ones = device.createBuffer( { size: oneCount * 12, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } );
				device.queue.writeBuffer( ones, 0, new Float32Array( oneCount * 3 ).fill( 1 ) );

			}

			if ( ! zeros || zeros.size < zeroBytes ) {

				zeros?.destroy();
				zeros = device.createBuffer( { size: zeroBytes, usage: GPUBufferUsage.VERTEX } );

			}

			// Taken after the uploads above, which may have grown the module's memory.
			if ( count > 0 ) device.queue.writeBuffer( objectBuffer, 0, new Float32Array( memory().buffer, renderer.objectUniformsPtr(), renderer.objectUniformsLength() ) );

			const nextEnvironment = environment( renderer.environmentInfo(), sources ) ?? noEnvironmentView;
			if ( nextEnvironment !== environmentView ) {

				environmentView = nextEnvironment;
				frameTexturesGroup();

			}

			const encoder = device.createCommandEncoder();
			const shadowCalls = drawShadows( encoder, renderer, sources, instanceSources );
			// Tone mapping applies only to what is drawn to the canvas, as in three.js.
			const toneMapping = offscreen ? 0 : frameUniforms[ TONE_MAPPING ], hdr = toneMapping !== 0;
			if ( hdr ) ensureHdrTargets();
			const view = offscreen ? null : context.getCurrentTexture().createView( { format } );
			const colorTarget = offscreen ? offscreen.view : hdr ? hdrView : view;
			const multisampled = offscreen ? offscreen.multisampleView : hdr ? hdrMultisampleView : colorView;
			const variant = offscreen ? offscreen.variant : hdr ? HDR_KEY : 0;
			const pass = encoder.beginRenderPass( {
				colorAttachments: [ {
					view: multisampled ?? colorTarget,
					resolveTarget: multisampled ? colorTarget : undefined,
					clearValue: clear, loadOp: 'clear', storeOp: multisampled ? 'discard' : 'store'
				} ],
				depthStencilAttachment: { view: offscreen ? offscreen.depthView : depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
			} );

			pass.setBindGroup( 0, frameGroup );
			pass.setBindGroup( 3, shadowGroup );
			let state = - 1, bound = null, map = null, triangles = 0, boundInstances;

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				const entry = entries[ i ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				const instance = perInstance[ i ], copies = instance ? draws[ o + 5 ] : 1;
				if ( key !== state ) pass.setPipeline( pipeline( ( state = key ) | variant ) );

				if ( instance !== boundInstances ) {

					pass.setVertexBuffer( MATRIX_SLOT, instance ? instance.matrix : identity );
					pass.setVertexBuffer( COLOR_SLOT, instance?.color ?? ones );
					boundInstances = instance;

				}

				if ( entry !== bound ) {

					for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) pass.setVertexBuffer( slot, entry.buffers[ slot ] ?? zeros );
					if ( entry.index ) pass.setIndexBuffer( entry.index, 'uint32' );
					bound = entry;

				}

				if ( groups[ i ] !== map ) pass.setBindGroup( 2, map = groups[ i ] );
				pass.setBindGroup( 1, objectGroup, [ i * stride ] );
				if ( entry.index ) pass.drawIndexed( vertices, copies, start );
				else pass.draw( vertices, copies, start );
				if ( ( key >> 5 & 3 ) === 0 ) triangles += vertices / 3 * copies;

			}

			pass.end();

			if ( hdr ) {

				device.queue.writeBuffer( outputSettings, 0, new Float32Array( [ toneMapping, frameUniforms[ EXPOSURE ], 0, 0 ] ) );
				const output = encoder.beginRenderPass( { colorAttachments: [ { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } } ] } );
				output.setPipeline( outputPipeline );
				output.setBindGroup( 0, outputGroup );
				output.draw( 3 );
				output.end();

			}

			device.queue.submit( [ encoder.finish() ] );
			drawingInto = 0;

			info.calls = count;
			info.shadowCalls = shadowCalls;
			info.triangles = triangles;
			info.geometries = geometries.size;
			info.textures = textures.size;
			info.pipelines = pipelines.size;

			if ( frameNumber % UNUSED_FRAMES === 0 ) {

				for ( const [ handle, entry ] of geometries ) {

					if ( frameNumber - entry.checked < UNUSED_FRAMES ) continue;
					release( entry );
					geometries.delete( handle );

				}

				for ( const [ id, entry ] of textures ) {

					if ( frameNumber - entry.checked < UNUSED_FRAMES ) continue;
					entry.texture?.destroy();
					textures.delete( id );

				}

				for ( const [ id, entry ] of instanced ) {

					if ( frameNumber - entry.checked < UNUSED_FRAMES ) continue;
					entry.matrix?.destroy();
					entry.color?.destroy();
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
			for ( const entry of textures.values() ) entry.texture?.destroy();
			textures.clear();
			for ( const entry of instanced.values() ) {

				entry.matrix?.destroy();
				entry.color?.destroy();

			}

			instanced.clear();
			white.destroy();
			identity.destroy();
			ones?.destroy();
			zeros?.destroy();
			objectBuffer?.destroy();
			frameBuffer?.destroy();
			depthTexture?.destroy();
			colorTexture?.destroy();
			hdrTexture?.destroy();
			hdrMultisample?.destroy();
			outputSettings?.destroy();
			shadowTexture.destroy();
			shadowCameras?.destroy();
			shadowObjects?.destroy();
			noEnvironment.destroy();
			for ( const entry of environments.values() ) entry.texture.destroy();
			environments.clear();
			if ( pmrem ) for ( const buffer of pmrem.levels.values() ) buffer.destroy();
			context.unconfigure();
			device.destroy();

		}

	};

}
