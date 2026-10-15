// WebGPU host for the WAMR3D renderer.
//
// The engine decides what is drawn (culling, order, pipeline state, uniform data,
// shader); this file only turns that into WebGPU calls and keeps the GPU copies of
// geometry and textures up to date.

import { Renderer, memory } from './index.js';
import { HDR_FORMAT, HDR_KEY, LINEAR, MIPMAPPED, MIP_LINEAR, RGBA8_KEY, SINGLE_KEY, WRAPS } from './webgpu/formats.js';
import { createEnvironmentPasses } from './webgpu/environment.js';

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
const VERTEX_COLOR_SLOT = 3;
// The same with colours of four floats (alpha included).
const VERTEX_BUFFERS_RGBA = VERTEX_BUFFERS.map( ( buffer, slot ) => ( slot === VERTEX_COLOR_SLOT ? { arrayStride: 16, attributes: [ { shaderLocation: slot, offset: 0, format: 'float32x4' } ] } : buffer ) );
const MATRIX_SLOT = ATTRIBUTES.length, COLOR_SLOT = ATTRIBUTES.length + 1, DRAW_FIELDS = 6;
// Engine pipeline-key bits: a line strip closed back to its first vertex, and colours of four floats.
const LOOP_KEY = 1 << 7, RGBA_COLOR_KEY = 1 << 8;

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

/**
 * `fallbackAdapter` asks for the browser's software adapter, where it has one: slow, but
 * it draws without a usable GPU.
 */
export async function createBackend( canvas, { antialias = true, powerPreference = 'high-performance', fallbackAdapter = false } = {} ) {

	if ( ! globalThis.navigator?.gpu ) throw new Error( 'WAMR3D: WebGPU is not available in this browser' );
	const adapter = await navigator.gpu.requestAdapter( fallbackAdapter ? { forceFallbackAdapter: true } : { powerPreference } );
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
	// A texture and its sampler per slot: colour, normal, roughness, metalness, emissive,
	// alpha and ambient-occlusion maps (the order of `Renderer.textureSets`).
	const TEXTURE_SLOTS = Renderer.textureSlots();
	const textureLayout = device.createBindGroupLayout( { entries: Array.from( { length: TEXTURE_SLOTS * 2 }, ( _, binding ) => ( binding % 2 === 0
		? { binding, visibility: GPUShaderStage.FRAGMENT, texture: {} }
		: { binding, visibility: GPUShaderStage.FRAGMENT, sampler: {} } ) ) } );
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
	const environmentPasses = createEnvironmentPasses( device, { format, samples, texture, textureOf: ( id ) => textures.get( id )?.texture ?? null, frame: () => frameNumber } );
	const { sampler: environmentSampler, empty: noEnvironmentView, environment, background, backgroundPipeline } = environmentPasses;
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
	// 5-6 topology, 7 line loop, 8 colours of four floats; HDR_KEY marks pipelines that
	// draw into the linear target.
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
				buffers: key & RGBA_COLOR_KEY ? VERTEX_BUFFERS_RGBA : VERTEX_BUFFERS
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
	// Bound in place of an attribute a geometry does not have; sized for the widest input.
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

	// The view and sampler of a texture, made once per upload. Bind groups are made per
	// set of textures (see `textureSetGroup`) and remember the bindings they were made from.
	function textureBinding( gpuTexture, source ) {

		const filter = ( value ) => ( LINEAR.has( value ?? 1006 ) ? 'linear' : 'nearest' );
		const sampler = device.createSampler( {
			magFilter: filter( source?.magFilter ), minFilter: filter( source?.minFilter ),
			mipmapFilter: MIP_LINEAR.has( source?.minFilter ) ? 'linear' : 'nearest',
			addressModeU: WRAPS[ source?.wrapS ] ?? 'clamp-to-edge', addressModeV: WRAPS[ source?.wrapT ] ?? 'clamp-to-edge'
		} );
		return { view: gpuTexture.createView(), sampler };

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
	const whiteBinding = textureBinding( white, null );

	// A material's texture. Uploaded when the source's version changes; a source that is
	// not ready yet (an image still loading) draws as white.
	function texture( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );

		if ( source?.isRenderTargetTexture ) {

			// Not while drawing into the same target; not before it was drawn once.
			if ( id === drawingInto ) return whiteBinding;
			return renderTargets.get( id )?.binding ?? whiteBinding;

		}

		const image = source?.image;
		if ( ! image || ! ( image.data || image.width > 0 ) ) return whiteBinding;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, binding: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.binding;

		const { width, height } = image, srgb = source.colorSpace === 'srgb';
		const levels = source.generateMipmaps !== false && MIPMAPPED.has( source.minFilter ) ? Math.floor( Math.log2( Math.max( width, height ) ) ) + 1 : 1;

		if ( ! entry.texture || entry.texture.width !== width || entry.texture.height !== height || entry.srgb !== srgb || entry.texture.mipLevelCount !== levels ) {

			entry.texture?.destroy();
			entry.texture = createTexture( width, height, entry.srgb = srgb, levels );

		}

		if ( image.data ) device.queue.writeTexture( { texture: entry.texture }, image.data, { bytesPerRow: width * 4 }, [ width, height ] );
		else device.queue.copyExternalImageToTexture( { source: image, flipY: source.flipY !== false }, { texture: entry.texture }, [ width, height ] );
		if ( levels > 1 ) generateMipmaps( entry.texture );

		entry.binding = textureBinding( entry.texture, source );
		entry.version = source.version;
		return entry.binding;

	}

	// One bind group per distinct set of textures, kept while each of its textures keeps
	// the binding it was made with.
	const textureSets = new Map(), setGroups = [];

	function textureSetGroup( sets, set, sources ) {

		const ids = sets.subarray( set * TEXTURE_SLOTS, ( set + 1 ) * TEXTURE_SLOTS ), key = ids.join( ',' );
		const bindings = Array.from( ids, ( id ) => texture( id, sources ) );
		let entry = textureSets.get( key );

		if ( ! entry || entry.bindings.some( ( binding, i ) => binding !== bindings[ i ] ) ) {

			const group = device.createBindGroup( { layout: textureLayout, entries: bindings.flatMap( ( binding, i ) => [ { binding: 2 * i, resource: binding.view }, { binding: 2 * i + 1, resource: binding.sampler } ] ) } );
			textureSets.set( key, entry = { bindings, group, checked: 0 } );

		}

		entry.checked = frameNumber;
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
			binding: null, release() {

				color.destroy();
				colorMultisample?.destroy();
				depth.destroy();

			}
		};
		entry.binding = textureBinding( color, target.texture );
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

		if ( ! entry ) geometries.set( slot, entry = { generation, handle: BigInt( generation ) << 32n | BigInt( slot ), buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], sizes: [ 0, 0, 0, 0 ], index: null, indexVersion: - 1, loops: null, checked: 0 } );
		entry.checked = frameNumber;
		const colorSize = state[ o + 4 + ATTRIBUTES.length * 2 ];

		for ( let i = 0, p = o + 3; i < ATTRIBUTES.length; i ++, p += 2 ) {

			const version = state[ p ], address = state[ p + 1 ], size = i === VERTEX_COLOR_SLOT ? colorSize : ATTRIBUTES[ i ][ 1 ];

			if ( address === 0 ) {

				entry.buffers[ i ]?.destroy();
				entry.buffers[ i ] = null;
				entry.versions[ i ] = - 1;
				zeroBytes = Math.max( zeroBytes, vertices * 16 );
				continue;

			}

			if ( version === entry.versions[ i ] && size === entry.sizes[ i ] ) continue;
			// Created per upload: the index read below may grow the module's memory.
			entry.buffers[ i ] = upload( new Float32Array( memory().buffer, address, vertices * size ), entry.buffers[ i ], GPUBufferUsage.VERTEX );
			entry.versions[ i ] = version;
			entry.sizes[ i ] = size;

		}

		const indexVersion = state[ o + 3 + ATTRIBUTES.length * 2 ];

		if ( indexVersion !== entry.indexVersion ) {

			const index = world.getIndex( entry.handle );

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

	// The index of a line loop over `count` vertices from `start`: those vertices (through
	// the geometry's index, if any), then the first one again. Kept per geometry until its
	// index changes.
	function loopIndex( world, entry, start, count ) {

		if ( entry.loops === null || entry.loopsVersion !== entry.indexVersion ) {

			if ( entry.loops ) for ( const buffer of entry.loops.values() ) buffer.destroy();
			entry.loops = new Map();
			entry.loopsVersion = entry.indexVersion;

		}

		const key = start + ':' + count;
		let buffer = entry.loops.get( key );
		if ( buffer ) return buffer;

		const data = new Uint32Array( count + 1 );

		if ( entry.index ) {

			const index = world.getIndex( entry.handle );
			for ( let i = 0; i < count; i ++ ) data[ i ] = index[ start + i ];

		} else {

			for ( let i = 0; i < count; i ++ ) data[ i ] = start + i;

		}

		data[ count ] = data[ 0 ];
		buffer = upload( data, null, GPUBufferUsage.INDEX );
		entry.loops.set( key, buffer );
		return buffer;

	}

	function release( entry ) {

		if ( entry.release ) return entry.release();
		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.index?.destroy();
		if ( entry.loops ) for ( const buffer of entry.loops.values() ) buffer.destroy();

	}

	return {

		name: fallbackAdapter ? 'webgpu-software' : 'webgpu', isWebGPUBackend: true, device, format, info,

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

			const sets = renderer.textureSets();
			setGroups.length = sets.length / TEXTURE_SLOTS;
			for ( let set = 0; set < setGroups.length; set ++ ) setGroups[ set ] = textureSetGroup( sets, set, sources );

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				entries[ i ] = distinct[ slots[ i ] ];
				groups[ i ] = setGroups[ draws[ o + 1 ] ];
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

			const backdrop = background( renderer, sources );

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

			if ( backdrop ) {

				pass.setPipeline( backgroundPipeline( variant ) );
				pass.setBindGroup( 0, backdrop );
				pass.draw( 3 );

			}

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

				if ( key & LOOP_KEY ) {

					if ( vertices > 0 ) {

						pass.setIndexBuffer( loopIndex( world, entry, start, vertices ), 'uint32' );
						pass.drawIndexed( vertices + 1, copies, 0 );
						// the geometry's own index buffer is bound again by the next draw
						bound = null;

					}

				} else if ( entry.index ) pass.drawIndexed( vertices, copies, start );
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

				for ( const [ key, entry ] of textureSets ) {

					if ( frameNumber - entry.checked >= UNUSED_FRAMES ) textureSets.delete( key );

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
			environmentPasses.dispose();
			context.unconfigure();
			device.destroy();

		}

	};

}
