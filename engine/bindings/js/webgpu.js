// WebGPU host for the WAMR3D renderer.
//
// The engine decides what is drawn (culling, order, pipeline state, uniform data,
// shader); this file only turns that into WebGPU calls and keeps the GPU copies of
// geometry and textures up to date.

import { Renderer, memory } from './index.js';
import { BLEND_FACTORS, HDR_FORMAT, HDR_KEY, LINEAR, MIPMAPPED, MIP_LINEAR, RGBA8_KEY, SINGLE_KEY, WRAPS, auxRecord, quadInstances } from './webgpu/formats.js';
import { createEnvironmentPasses } from './webgpu/environment.js';

const UNUSED_FRAMES = 300;
const warned = new Set();
const warnOnce = ( what ) => {

	if ( warned.has( what ) ) return;
	warned.add( what );
	console.warn( `WAMR3D (WebGPU): ${what}` );

};

// Vertex inputs with a buffer of their own, in location order: name, floats per vertex.
// They are the first records of `Renderer.geometryState`; tangent, uv1, skinIndex and
// skinWeight follow and are interleaved into one buffer (`AUX_SLOT`).
const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
const AUX_ATTRIBUTES = 4, AUX_STRIDE = 56;
const TOPOLOGIES = [ 'triangle-list', 'line-strip', 'line-list', 'point-list' ];
const VERTEX_COLOR_SLOT = 3, MATRIX_SLOT = 4, COLOR_SLOT = 5, AUX_SLOT = 6;

// Engine pipeline-key bits: a line strip closed back to its first vertex, colours of four
// floats, a mesh drawn as the edges of its triangles, interleaved extra attributes,
// premultiplied alpha, and points or lines drawn as quads.
const LOOP_KEY = 1 << 7, RGBA_COLOR_KEY = 1 << 8, WIREFRAME_KEY = 1 << 9, AUX_KEY = 1 << 10, PREMULTIPLIED_KEY = 1 << 14, QUAD_KEY = 1 << 15;
// Host-only bit of shadow pipelines: the caster has an alpha test.
const ALPHA_TEST_KEY = 1 << 23;

const vertexBuffers = ( key ) => [
	{ arrayStride: 12, attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' } ] },
	{ arrayStride: 12, attributes: [ { shaderLocation: 1, offset: 0, format: 'float32x3' } ] },
	{ arrayStride: 8, attributes: [ { shaderLocation: 2, offset: 0, format: 'float32x2' } ] },
	key & RGBA_COLOR_KEY ? { arrayStride: 16, attributes: [ { shaderLocation: 3, offset: 0, format: 'float32x4' } ] } : { arrayStride: 12, attributes: [ { shaderLocation: 3, offset: 0, format: 'float32x3' } ] },
	{ arrayStride: 64, stepMode: 'instance', attributes: [ 0, 1, 2, 3 ].map( ( column ) => ( { shaderLocation: 4 + column, offset: column * 16, format: 'float32x4' } ) ) },
	{ arrayStride: 12, stepMode: 'instance', attributes: [ { shaderLocation: 8, offset: 0, format: 'float32x3' } ] },
	// with a stride of 0 every vertex reads the same zeros
	{ arrayStride: key & AUX_KEY ? AUX_STRIDE : 0, attributes: [
		{ shaderLocation: 9, offset: 0, format: 'float32x4' }, { shaderLocation: 10, offset: 16, format: 'float32x2' },
		{ shaderLocation: 11, offset: 24, format: 'float32x4' }, { shaderLocation: 12, offset: 40, format: 'float32x4' }
	] }
];

// Points and lines as quads read their vertices per instance: a point, a strip's
// consecutive pair, or a list's pair (see `vertex_quad`).
function quadBuffers( key ) {

	const topology = key >> 5 & 3, components = key & RGBA_COLOR_KEY ? 4 : 3, pairs = topology === 2;
	const second = topology === 3 ? 0 : 12, colorSecond = topology === 3 ? 0 : components * 4;
	return [
		{ arrayStride: pairs ? 24 : 12, stepMode: 'instance', attributes: [ { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 13, offset: second, format: 'float32x3' } ] },
		null, null,
		{ arrayStride: ( pairs ? 2 : 1 ) * components * 4, stepMode: 'instance', attributes: [ { shaderLocation: 3, offset: 0, format: `float32x${components}` }, { shaderLocation: 14, offset: colorSecond, format: `float32x${components}` } ] }
	];

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

// Indices of a wireframe over `count` triangle vertices: two per edge, three edges per triangle.
const wireframeCount = ( count ) => Math.floor( count / 3 ) * 6;

// A cube face: an image, `{ data, width, height }`, or a DataTexture (as three.js accepts).
const cubeFace = ( face ) => ( face?.isDataTexture ? face.image : face );
// Whether all six square faces of a cube texture have arrived.
const cubeReady = ( images ) => Array.isArray( images ) && images.length === 6 && images.map( cubeFace ).every( ( image, i, faces ) => image && ( image.data || image.width > 0 ) && image.width === faces[ 0 ].width );
// Data textures of float or half-float type are uploaded as rgba16float or rgba32float.
const dataFormat = ( source ) => ( source?.type === 1015 ? 'rgba32float' : source?.type === 1016 ? 'rgba16float' : null );

/**
 * `fallbackAdapter` asks for the browser's software adapter, where it has one: slow, but
 * it draws without a usable GPU.
 */
export async function createBackend( canvas, { antialias = true, powerPreference = 'high-performance', fallbackAdapter = false } = {} ) {

	if ( ! globalThis.navigator?.gpu ) throw new Error( 'WAMR3D: WebGPU is not available in this browser' );
	const adapter = await navigator.gpu.requestAdapter( fallbackAdapter ? { forceFallbackAdapter: true } : { powerPreference } );
	if ( ! adapter ) throw new Error( 'WAMR3D: no WebGPU adapter found' );
	const features = [ 'float32-filterable' ].filter( ( name ) => adapter.features.has( name ) );
	const device = await adapter.requestDevice( { requiredFeatures: features } );

	const context = canvas.getContext( 'webgpu' );
	// The shader writes linear colour into an sRGB view of the canvas, so blending and
	// the multisample resolve happen in linear light and the GPU encodes on write.
	const canvasFormat = navigator.gpu.getPreferredCanvasFormat(), format = canvasFormat + '-srgb';
	context.configure( { device, format: canvasFormat, viewFormats: [ format ], alphaMode: 'opaque' } );

	const samples = antialias ? 4 : 1;
	const stride = Renderer.objectUniformSize(), objectBindingBytes = Renderer.objectBindingSize(), materialStride = Renderer.materialUniformSize();
	const GEOMETRY_FIELDS = Renderer.geometryStateSize(), DRAW_FIELDS = Renderer.drawInfoSize();
	const module = device.createShaderModule( { code: Renderer.shaderSource() } );
	const TONE_MAPPING = Renderer.toneMappingIndex(), EXPOSURE = Renderer.toneMappingExposureIndex();
	const MATERIAL_FLOATS = materialStride / 4;

	const frameLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} } ] } );
	const objectLayout = device.createBindGroupLayout( { entries: [
		{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: objectBindingBytes } },
		{ binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: materialStride } }
	] } );
	// A texture and its sampler per slot (the order of `Renderer.textureSets`). Only the
	// displacement slot is read by the vertex stage.
	const TEXTURE_SLOTS = Renderer.textureSlots(), DISPLACEMENT_SLOT = Renderer.displacementSlot();
	const stages = ( binding ) => ( binding >> 1 === DISPLACEMENT_SLOT ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT : GPUShaderStage.FRAGMENT );
	const textureLayout = device.createBindGroupLayout( { entries: Array.from( { length: TEXTURE_SLOTS * 2 }, ( _, binding ) => ( binding % 2 === 0
		? { binding, visibility: stages( binding ), texture: {} }
		: { binding, visibility: stages( binding ), sampler: {} } ) ) } );
	// Group 3 holds what the whole frame samples: the shadow maps, the environments, the
	// bones, the copy transmissive materials read, and the blurred VSM moments.
	const frameTexturesLayout = device.createBindGroupLayout( { entries: [
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
		{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
		{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
		{ binding: 4, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } },
		{ binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
		{ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: '2d-array' } }
	] } );
	const layout = device.createPipelineLayout( { bindGroupLayouts: [ frameLayout, objectLayout, textureLayout, frameTexturesLayout ] } );

	// Shadow maps: one layer per map (a point light has six), depth only, as many layers as
	// the frames have needed so far. Bilinear comparison sampling, as three.js uses for
	// PCFShadowMap when the device supports it; basic filtering samples texel centres.
	const MAX_SHADOWS = Renderer.maxShadows(), SHADOW_FORMAT = 'depth32float';
	const shadowSampler = device.createSampler( { compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' } );
	const shadowModule = device.createShaderModule( { code: Renderer.shadowShaderSource() } );
	const shadowCameraLayout = device.createBindGroupLayout( { entries: [ { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { hasDynamicOffset: true, minBindingSize: 64 } } ] } );
	const boneLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } } ] } );
	const shadowPipelineLayout = device.createPipelineLayout( { bindGroupLayouts: [ shadowCameraLayout, objectLayout, textureLayout, boneLayout ] } );
	const shadowPipelines = new Map();
	let shadowTexture = device.createTexture( { size: [ 1, 1, 1 ], format: SHADOW_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
	const environmentPasses = createEnvironmentPasses( device, { format, samples, texture, textureOf: ( id ) => textures.get( id )?.texture ?? renderTargetBindings.get( id )?.texture ?? null, frame: () => frameNumber } );
	const { sampler: environmentSampler, empty: noEnvironmentView, environment, background, backgroundPipeline } = environmentPasses;
	let environmentView = noEnvironmentView;

	// Bones: a float texture 1024 texels wide, four texels per matrix, grown as needed.
	const BONES_PER_ROW = Renderer.boneTextureMatricesPerRow();
	let boneTexture = device.createTexture( { size: [ 4, 1 ], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST } );
	let boneView = boneTexture.createView(), boneGroup = null;
	// The transmission copy and the VSM moments; small placeholders until a frame needs them.
	const emptyFloat = device.createTexture( { size: [ 1, 1 ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING } );
	const emptyFloatView = emptyFloat.createView();
	let transmission = null, vsmTexture = null, vsmView = null, vsmScratch = null;
	const emptyVsm = device.createTexture( { size: [ 1, 1, 1 ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING } );
	const emptyVsmView = emptyVsm.createView( { dimension: '2d-array' } );
	// Two versions of group 3: one reading the transmission copy, one with the
	// placeholder for the pass that draws the copy (a texture cannot be read and drawn
	// into at once).
	let frameTexturesGroup = null, frameTexturesGroupNoCopy = null;

	function rebuildFrameTextures() {

		const entries = ( copy ) => [
			{ binding: 0, resource: shadowTexture.createView( { dimension: '2d-array' } ) },
			{ binding: 1, resource: shadowSampler },
			{ binding: 2, resource: environmentView },
			{ binding: 3, resource: environmentSampler },
			{ binding: 4, resource: boneView },
			{ binding: 5, resource: copy },
			{ binding: 6, resource: vsmView ?? emptyVsmView }
		];
		frameTexturesGroup = device.createBindGroup( { layout: frameTexturesLayout, entries: entries( transmission?.view ?? emptyFloatView ) } );
		frameTexturesGroupNoCopy = transmission ? device.createBindGroup( { layout: frameTexturesLayout, entries: entries( emptyFloatView ) } ) : frameTexturesGroup;
		boneGroup = device.createBindGroup( { layout: boneLayout, entries: [ { binding: 0, resource: boneView } ] } );

	}

	rebuildFrameTextures();

	// Uploads the frame's skinning matrices, growing the bone texture when needed.
	function uploadBones( renderer ) {

		const length = renderer.skinMatricesLength();
		if ( length === 0 ) return;
		const matrices = length / 16, rows = Math.ceil( matrices / BONES_PER_ROW ), width = BONES_PER_ROW * 4;

		if ( boneTexture.width !== width || boneTexture.height < rows ) {

			boneTexture.destroy();
			boneTexture = device.createTexture( { size: [ width, Math.max( rows, boneTexture.height * 2, 1 ) ], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST } );
			boneView = boneTexture.createView();
			rebuildFrameTextures();

		}

		// whole rows; the last one is padded with what the module's memory holds after it
		const data = new Float32Array( memory().buffer, renderer.skinMatricesPtr(), length );
		const full = Math.floor( matrices / BONES_PER_ROW );
		if ( full > 0 ) device.queue.writeTexture( { texture: boneTexture }, data, { bytesPerRow: width * 16, offset: 0 }, [ width, full ] );
		const rest = matrices - full * BONES_PER_ROW;
		if ( rest > 0 ) device.queue.writeTexture( { texture: boneTexture, origin: [ 0, full ] }, data, { bytesPerRow: width * 16, offset: full * BONES_PER_ROW * 64 }, [ rest * 4, 1 ] );

	}

	let shadowCameras = null, shadowCameraGroup = null, shadowObjects = null, shadowObjectGroup = null, shadowObjectCapacity = 0;

	// Casters draw their back faces (three.js draws the opposite of `material.side`). Only
	// casters with an alpha test run a fragment stage.
	function shadowPipeline( key, vsm ) {

		const pipelineKey = key | ( vsm ? 1 << 24 : 0 );
		let value = shadowPipelines.get( pipelineKey );
		if ( value ) return value;
		value = device.createRenderPipeline( {
			layout: shadowPipelineLayout,
			vertex: { module: shadowModule, entryPoint: 'vertex', buffers: vertexBuffers( key ) },
			fragment: key & ALPHA_TEST_KEY ? { module: shadowModule, entryPoint: 'fragment', targets: [] } : undefined,
			primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: [ 'back', 'front', 'none' ][ key & 3 ] },
			depthStencil: { format: SHADOW_FORMAT, depthWriteEnabled: true, depthCompare: 'less-equal' }
		} );
		shadowPipelines.set( pipelineKey, value );
		return value;

	}

	function ensureShadowTexture( width, height, layers, vsm ) {

		const sameSize = shadowTexture.width === width && shadowTexture.height === height;

		if ( ! sameSize || shadowTexture.depthOrArrayLayers < layers ) {

			const count = Math.min( MAX_SHADOWS, sameSize ? Math.max( layers, shadowTexture.depthOrArrayLayers ) : layers );
			shadowTexture.destroy();
			shadowTexture = device.createTexture( { size: [ width, height, count ], format: SHADOW_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
			rebuildFrameTextures();

		}

		if ( vsm && ( ! vsmTexture || vsmTexture.width !== width || vsmTexture.height !== height || vsmTexture.depthOrArrayLayers !== shadowTexture.depthOrArrayLayers ) ) {

			vsmTexture?.destroy();
			vsmScratch?.destroy();
			vsmTexture = device.createTexture( { size: [ width, height, shadowTexture.depthOrArrayLayers ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
			vsmScratch = device.createTexture( { size: [ width, height ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );
			vsmView = vsmTexture.createView( { dimension: '2d-array' } );
			rebuildFrameTextures();

		}

	}

	// The VSM blur: the depth of each pass's layer, vertically into a scratch texture of
	// moments, then horizontally into the layer of the moments array.
	let vsm = null;

	function blurShadows( encoder, renderer, passes ) {

		if ( ! vsm ) {

			const vsmModule = device.createShaderModule( { code: Renderer.vsmShaderSource() } );
			const vsmLayout = device.createBindGroupLayout( { entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: 16 } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }
			] } );
			const pipelineLayout = device.createPipelineLayout( { bindGroupLayouts: [ vsmLayout ] } );
			const make = ( entryPoint ) => device.createRenderPipeline( { layout: pipelineLayout, vertex: { module: vsmModule, entryPoint: 'vertex' }, fragment: { module: vsmModule, entryPoint, targets: [ { format: HDR_FORMAT } ] } } );
			vsm = { layout: vsmLayout, vertical: make( 'vertical' ), horizontal: make( 'horizontal' ), settings: device.createBuffer( { size: 256 * MAX_SHADOWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } ), placeholder: device.createTexture( { size: [ 1, 1 ], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING } ) };

		}

		const settings = new Float32Array( 64 * passes );
		const group = ( depthView, momentsView ) => device.createBindGroup( { layout: vsm.layout, entries: [
			{ binding: 0, resource: { buffer: vsm.settings, size: 16 } },
			{ binding: 1, resource: depthView },
			{ binding: 2, resource: momentsView }
		] } );
		const vertical = group( shadowTexture.createView( { dimension: '2d-array' } ), vsm.placeholder.createView() );
		const horizontal = group( shadowTexture.createView( { dimension: '2d-array' } ), vsmScratch.createView() );

		for ( let p = 0; p < passes; p ++ ) {

			const info = renderer.shadowPassInfo( p ), blur = renderer.shadowBlur( p );
			settings.set( [ blur[ 0 ], blur[ 1 ], info[ 0 ], 0 ], p * 64 );

		}

		device.queue.writeBuffer( vsm.settings, 0, settings );

		for ( let p = 0; p < passes; p ++ ) {

			const info = renderer.shadowPassInfo( p );
			const layer = info[ 0 ], w = info[ 1 ], h = info[ 2 ];
			const first = encoder.beginRenderPass( { colorAttachments: [ { view: vsmScratch.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 0, a: 1 } } ] } );
			first.setViewport( 0, 0, w, h, 0, 1 );
			first.setPipeline( vsm.vertical );
			first.setBindGroup( 0, vertical, [ p * 256 ] );
			first.draw( 3 );
			first.end();
			const second = encoder.beginRenderPass( { colorAttachments: [ { view: vsmTexture.createView( { dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 } ), loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 0, a: 1 } } ] } );
			second.setViewport( 0, 0, w, h, 0, 1 );
			second.setPipeline( vsm.horizontal );
			second.setBindGroup( 0, horizontal, [ p * 256 ] );
			second.draw( 3 );
			second.end();

		}

	}

	// Draws each shadow pass of the prepared frame into its layer. Casters use the same
	// geometry, instance, material and texture buffers as the main pass.
	function drawShadows( encoder, renderer, instanceSources, materialData ) {

		const passes = renderer.shadowCount();
		if ( passes === 0 ) return 0;
		const [ width, height ] = renderer.shadowMapSize();
		const variance = renderer.shadowFilter() === 2;
		ensureShadowTexture( width, height, passes, variance );

		if ( ! shadowCameras ) {

			shadowCameras = device.createBuffer( { size: 256 * MAX_SHADOWS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
			shadowCameraGroup = device.createBindGroup( { layout: shadowCameraLayout, entries: [ { binding: 1, resource: { buffer: shadowCameras, size: 64 } } ] } );

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
			shadowObjectGroup = null;

		}

		shadowObjectGroup ??= device.createBindGroup( { layout: objectLayout, entries: [ { binding: 0, resource: { buffer: shadowObjects, size: objectBindingBytes } }, { binding: 1, resource: { buffer: materialBuffer, size: materialStride } } ] } );
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
			pass.setBindGroup( 3, boneGroup );
			let state = - 1, bound = null, boundInstances, map = null;

			for ( let i = 0, o = 0; i < slots.length; i ++, o += DRAW_FIELDS ) {

				const entry = distinct[ slots[ i ] ], material = draws[ o + 6 ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				// surface.w of the material block is its alpha test
				const key = draws[ o ] | ( materialData[ material * MATERIAL_FLOATS + 23 ] > 0 ? ALPHA_TEST_KEY : 0 );
				const instance = instances( draws[ o + 4 ], draws[ o + 5 ], instanceSources ), copies = instance ? draws[ o + 5 ] : 1;
				if ( key !== state ) pass.setPipeline( shadowPipeline( state = key, variance ) );

				if ( instance !== boundInstances ) {

					pass.setVertexBuffer( MATRIX_SLOT, instance ? instance.matrix : identity );
					pass.setVertexBuffer( COLOR_SLOT, instance?.color ?? ones );
					boundInstances = instance;

				}

				if ( entry !== bound ) {

					bindGeometry( pass, entry );
					bound = entry;

				}

				const set = setGroups[ draws[ o + 1 ] ];
				if ( set !== map ) pass.setBindGroup( 2, map = set );
				pass.setBindGroup( 1, shadowObjectGroup, [ ( first + i ) * stride, material * materialStride ] );
				if ( entry.index ) pass.drawIndexed( vertices, copies, start );
				else pass.draw( vertices, copies, start );
				calls ++;

			}

			pass.end();

		}

		if ( variance ) blurShadows( encoder, renderer, passes );
		return calls;

	}

	// Pipelines are created the first time a state is drawn and kept. The key is the
	// engine's pipeline state (see `Renderer.drawInfo`); HDR_KEY, RGBA8_KEY and
	// SINGLE_KEY mark pipelines that draw into the linear target or a render target.
	const pipelines = new Map();

	function blend( key ) {

		if ( ( key & 4 ) === 0 ) return undefined;
		const factors = BLEND_FACTORS[ ( key & PREMULTIPLIED_KEY ? 5 : 0 ) + Math.max( 1, key >> 11 & 7 ) - 1 ];
		return { color: { srcFactor: factors[ 0 ], dstFactor: factors[ 1 ] }, alpha: { srcFactor: factors[ 2 ], dstFactor: factors[ 3 ] } };

	}

	// The pipeline of a full-screen effect (`custom` 1 to 6), with the draw's blending and depth.
	let effectModule = null;

	function effectPipeline( key, custom ) {

		const id = key + custom * 0x2000000;
		let value = pipelines.get( id );
		if ( value ) return value;
		effectModule ??= device.createShaderModule( { code: Renderer.effectShaderSource() } );
		value = device.createRenderPipeline( {
			layout,
			vertex: { module: effectModule, entryPoint: 'vertex_effect', buffers: vertexBuffers( key ) },
			fragment: { module: effectModule, entryPoint: Renderer.effectEntryPoint( custom ), targets: [ { format: key & HDR_KEY ? HDR_FORMAT : key & RGBA8_KEY ? 'rgba8unorm' : format, blend: blend( key ) } ] },
			primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none' },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: ( key & 8 ) !== 0, depthCompare: key & 16 ? 'less-equal' : 'always' },
			multisample: { count: key & SINGLE_KEY ? 1 : samples }
		} );
		pipelines.set( id, value );
		return value;

	}

	function pipeline( key ) {

		let value = pipelines.get( key );
		if ( value ) return value;
		const quad = ( key & QUAD_KEY ) !== 0, topology = quad ? 'triangle-list' : TOPOLOGIES[ key >> 5 & 3 ];

		value = device.createRenderPipeline( {
			layout,
			vertex: quad ? { module, entryPoint: 'vertex_quad', buffers: quadBuffers( key ) } : { module, entryPoint: 'vertex', buffers: vertexBuffers( key ) },
			fragment: { module, entryPoint: 'fragment', targets: [ { format: key & HDR_KEY ? HDR_FORMAT : key & RGBA8_KEY ? 'rgba8unorm' : format, blend: blend( key ) } ] },
			primitive: { topology, frontFace: 'ccw', cullMode: quad ? 'none' : [ 'back', 'front', 'none' ][ key & 3 ], stripIndexFormat: topology === 'line-strip' ? 'uint32' : undefined },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: ( key & 8 ) !== 0, depthCompare: key & 16 ? 'less-equal' : 'always' },
			multisample: { count: key & SINGLE_KEY ? 1 : samples }
		} );
		pipelines.set( key, value );
		return value;

	}

	let frameBuffer = null, frameGroup = null;
	let objectBuffer = null, objectCapacity = 0, materialBuffer = null, materialCapacity = 0, objectGroup = null;
	let depthTexture = null, colorTexture = null, depthView = null, colorView = null, targetWidth = 0, targetHeight = 0;
	// The linear target of a tone-mapped frame, its multisampled companion, and the output pass.
	let hdrTexture = null, hdrMultisample = null, hdrView = null, hdrMultisampleView = null, outputGroup = null, outputPipeline = null, outputSettings = null;
	// Bound in place of an attribute a geometry does not have; sized for the widest input.
	let zeros = null, zeroBytes = 64;
	const auxZeros = device.createBuffer( { size: 64, usage: GPUBufferUsage.VERTEX } );
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

		const filterable = gpuTexture.format !== 'rgba32float' || device.features.has( 'float32-filterable' );
		const filter = ( value ) => ( filterable && LINEAR.has( value ?? 1006 ) ? 'linear' : 'nearest' );
		const sampler = device.createSampler( {
			magFilter: filter( source?.magFilter ), minFilter: filter( source?.minFilter ),
			mipmapFilter: filterable && MIP_LINEAR.has( source?.minFilter ) ? 'linear' : 'nearest',
			addressModeU: WRAPS[ source?.wrapS ] ?? 'clamp-to-edge', addressModeV: WRAPS[ source?.wrapT ] ?? 'clamp-to-edge',
			maxAnisotropy: filterable && ( source?.anisotropy ?? 1 ) > 1 && LINEAR.has( source?.magFilter ?? 1006 ) && MIP_LINEAR.has( source?.minFilter ) ? Math.min( 16, source.anisotropy ) : 1
		} );
		return { view: gpuTexture.createView(), sampler };

	}

	function createTexture( width, height, textureFormat, mipLevelCount = 1 ) {

		return device.createTexture( { size: [ width, height ], mipLevelCount, format: textureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT } );

	}

	// Fills every mip level from the one above it with a filtered draw.
	function generateMipmaps( gpuTexture, encoder = null ) {

		let blit = blits.get( gpuTexture.format );

		if ( ! blit ) {

			const blitModule = device.createShaderModule( { code: BLIT } );
			blit = {
				pipeline: device.createRenderPipeline( { layout: 'auto', vertex: { module: blitModule, entryPoint: 'vertex' }, fragment: { module: blitModule, entryPoint: 'fragment', targets: [ { format: gpuTexture.format } ] } } ),
				sampler: device.createSampler( { magFilter: 'linear', minFilter: 'linear' } )
			};
			blits.set( gpuTexture.format, blit );

		}

		const own = encoder === null, commands = encoder ?? device.createCommandEncoder();

		for ( let level = 1; level < gpuTexture.mipLevelCount; level ++ ) {

			const group = device.createBindGroup( { layout: blit.pipeline.getBindGroupLayout( 0 ), entries: [
				{ binding: 0, resource: gpuTexture.createView( { baseMipLevel: level - 1, mipLevelCount: 1 } ) },
				{ binding: 1, resource: blit.sampler }
			] } );
			const pass = commands.beginRenderPass( { colorAttachments: [ { view: gpuTexture.createView( { baseMipLevel: level, mipLevelCount: 1 } ), loadOp: 'clear', storeOp: 'store' } ] } );
			pass.setPipeline( blit.pipeline );
			pass.setBindGroup( 0, group );
			pass.draw( 3 );
			pass.end();

		}

		if ( own ) device.queue.submit( [ commands.finish() ] );

	}

	const white = createTexture( 1, 1, 'rgba8unorm' );
	device.queue.writeTexture( { texture: white }, new Uint8Array( [ 255, 255, 255, 255 ] ), {}, [ 1, 1 ] );
	const whiteBinding = textureBinding( white, null );

	// A material's texture. Uploaded when the source's version changes; a source that is
	// not ready yet (an image still loading) draws as white.
	function texture( id, sources ) {

		const source = id === 0 ? null : sources?.get( id );

		if ( source?.isRenderTargetTexture || source?.isDepthTexture ) {

			// Not while drawing into the same target; not before it was drawn once.
			if ( id === drawingInto ) return whiteBinding;
			// depth reads as a depth texture, which the material slots (filterable floats) cannot bind
			const binding = renderTargetBindings.get( id );
			return binding && ! binding.depth ? binding : whiteBinding;

		}

		if ( source?.isCubeTexture ) return cubeTexture( id, source );
		const image = source?.image;
		if ( ! image || ! ( image.data || image.width > 0 ) ) return whiteBinding;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, binding: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.binding;

		const { width, height } = image, float = image.data ? dataFormat( source ) : null;
		const textureFormat = float ?? ( source.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm' );
		const levels = ! float && source.generateMipmaps !== false && MIPMAPPED.has( source.minFilter ) ? Math.floor( Math.log2( Math.max( width, height ) ) ) + 1 : 1;

		if ( ! entry.texture || entry.texture.width !== width || entry.texture.height !== height || entry.texture.format !== textureFormat || entry.texture.mipLevelCount !== levels ) {

			entry.texture?.destroy();
			entry.texture = createTexture( width, height, textureFormat, levels );

		}

		if ( image.data ) {

			// float data is RGBA of 32-bit floats; half floats arrive as Uint16Array
			const bytes = textureFormat === 'rgba32float' ? 16 : textureFormat === 'rgba16float' ? 8 : 4;
			device.queue.writeTexture( { texture: entry.texture }, image.data, { bytesPerRow: width * bytes }, [ width, height ] );

		} else {

			device.queue.copyExternalImageToTexture( { source: image, flipY: source.flipY !== false }, { texture: entry.texture }, [ width, height ] );

		}

		if ( levels > 1 ) generateMipmaps( entry.texture );
		entry.binding = textureBinding( entry.texture, source );
		entry.version = source.version;
		return entry.binding;

	}

	// A cube texture becomes an equirectangular image (four faces wide, two high) on each
	// upload, so environments and backgrounds take it like any panorama. Float faces
	// (three.js HDR cube maps) keep a float format. White until its six images have arrived.
	let cubePass = null;

	function cubeTexture( id, source ) {

		if ( ! cubeReady( source.image ) ) return whiteBinding;

		let entry = textures.get( id );
		if ( ! entry ) textures.set( id, entry = { texture: null, binding: null, version: - 1, checked: 0 } );
		entry.checked = frameNumber;
		if ( entry.version === source.version ) return entry.binding;

		const images = source.image.map( cubeFace ), size = images[ 0 ].width;
		const faceSource = source.image[ 0 ]?.isDataTexture ? source.image[ 0 ] : source;
		const float = images[ 0 ].data ? dataFormat( faceSource ) : null;
		// faces are sampled filtered; rgba32float may not be, so float faces go to rgba16float
		const faceFormat = float ?? ( source.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm' ), format_ = float ? HDR_FORMAT : faceFormat;
		const faces = device.createTexture( { size: [ size, size, 6 ], format: faceFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT } );
		const bytes = faceFormat === 'rgba32float' ? 16 : faceFormat === 'rgba16float' ? 8 : 4;

		images.forEach( ( image, layer ) => {

			if ( image.data ) device.queue.writeTexture( { texture: faces, origin: [ 0, 0, layer ] }, image.data, { bytesPerRow: size * bytes, rowsPerImage: size }, [ size, size, 1 ] );
			else device.queue.copyExternalImageToTexture( { source: image, flipY: false }, { texture: faces, origin: [ 0, 0, layer ] }, [ size, size ] );

		} );

		const width = Math.min( 4 * size, device.limits.maxTextureDimension2D ), height = width / 2;

		if ( ! entry.texture || entry.texture.width !== width || entry.texture.format !== format_ ) {

			entry.texture?.destroy();
			entry.texture = device.createTexture( { size: [ width, height ], format: format_, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT } );

		}

		if ( ! cubePass ) {

			const cubeModule = device.createShaderModule( { code: Renderer.cubeToEquirectShaderSource() } );
			cubePass = { module: cubeModule, pipelines: new Map(), sampler: device.createSampler( { magFilter: 'linear', minFilter: 'linear' } ), nearest: device.createSampler( {} ) };

		}

		let converter = cubePass.pipelines.get( format_ );
		if ( ! converter ) cubePass.pipelines.set( format_, converter = device.createRenderPipeline( { layout: 'auto', vertex: { module: cubePass.module, entryPoint: 'vertex' }, fragment: { module: cubePass.module, entryPoint: 'fragment', targets: [ { format: format_ } ] } } ) );

		const filterable = faceFormat !== 'rgba32float' || device.features.has( 'float32-filterable' );
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass( { colorAttachments: [ { view: entry.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } } ] } );
		pass.setPipeline( converter );
		pass.setBindGroup( 0, device.createBindGroup( { layout: converter.getBindGroupLayout( 0 ), entries: [ { binding: 0, resource: faces.createView( { dimension: 'cube' } ) }, { binding: 1, resource: filterable ? cubePass.sampler : cubePass.nearest } ] } ) );
		pass.draw( 3 );
		pass.end();
		device.queue.submit( [ encoder.finish() ] );
		faces.destroy();

		entry.binding = { view: entry.texture.createView(), sampler: cubePass.sampler };
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

	// The mipmapped copy of the opaque scene that transmissive materials read, as large as
	// the frame.
	function ensureTransmission( width, height ) {

		if ( transmission && transmission.width === width && transmission.height === height ) return transmission;
		transmission?.texture.destroy();
		transmission?.depth.destroy();
		const levels = Math.floor( Math.log2( Math.max( width, height ) ) ) + 1;
		const texture_ = device.createTexture( { size: [ width, height ], format: HDR_FORMAT, mipLevelCount: levels, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING } );
		const depth = device.createTexture( { size: [ width, height ], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT } );
		transmission = { width, height, texture: texture_, depth, view: texture_.createView(), target: texture_.createView( { baseMipLevel: 0, mipLevelCount: 1 } ), depthView: depth.createView() };
		rebuildFrameTextures();
		return transmission;

	}

	// GPU side of render targets, by the id of their texture: colour attachments
	// (multisampled when asked), depth (sampled when the target has a depth texture), and
	// the bindings that read them as material maps.
	const renderTargets = new Map(), renderTargetBindings = new Map();

	function renderTarget( target ) {

		let entry = renderTargets.get( target.id );
		// Multisampling needs pipelines for 4 samples, which exist only with antialias.
		const { width, height } = target, float = target.type !== 'byte', multisampled = target.samples > 1 && samples > 1;
		const count = target.textures?.length ?? 1, depthTexture_ = target.depthTexture ?? null;
		if ( entry && entry.width === width && entry.height === height && entry.float === float && entry.multisampled === multisampled && entry.count === count && entry.depthId === ( depthTexture_?.id ?? 0 ) ) return entry;
		if ( entry ) entry.release();

		const colorFormat = float ? HDR_FORMAT : 'rgba8unorm';
		const colors = [], multisampledColors = [];

		for ( let i = 0; i < count; i ++ ) {

			colors.push( device.createTexture( { size: [ width, height ], format: colorFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING } ) );
			if ( multisampled ) multisampledColors.push( device.createTexture( { size: [ width, height ], format: colorFormat, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT } ) );

		}

		// with a depth texture, the depth is resolved into a single-sampled copy for sampling
		const depth = device.createTexture( { size: [ width, height ], format: depthTexture_ ? 'depth32float' : 'depth24plus', sampleCount: multisampled && ! depthTexture_ ? 4 : 1, usage: GPUTextureUsage.RENDER_ATTACHMENT | ( depthTexture_ ? GPUTextureUsage.TEXTURE_BINDING : 0 ) } );
		entry = {
			width, height, float, multisampled: multisampled && ! depthTexture_, count, depthId: depthTexture_?.id ?? 0, colors, multisampledColors, depth,
			views: colors.map( ( c ) => c.createView() ), multisampleViews: multisampledColors.map( ( c ) => c.createView() ), depthView: depth.createView(),
			variant: ( float ? HDR_KEY : RGBA8_KEY ) | ( multisampled && ! depthTexture_ ? 0 : SINGLE_KEY ),
			release() {

				for ( const c of colors ) c.destroy();
				for ( const c of multisampledColors ) c.destroy();
				depth.destroy();
				for ( const texture_ of target.textures ?? [ target.texture ] ) renderTargetBindings.delete( texture_.id );
				if ( depthTexture_ ) renderTargetBindings.delete( depthTexture_.id );

			}
		};
		// with a depth texture the target is single-sampled: the colour is read as drawn
		if ( depthTexture_ ) entry.multisampleViews = [];
		( target.textures ?? [ target.texture ] ).forEach( ( texture_, i ) => renderTargetBindings.set( texture_.id, { ...textureBinding( colors[ i ], texture_ ), texture: colors[ i ] } ) );
		if ( depthTexture_ ) renderTargetBindings.set( depthTexture_.id, { view: entry.depthView, sampler: device.createSampler( {} ), depth: true } );
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

		if ( ! entry ) geometries.set( slot, entry = { generation, handle: BigInt( generation ) << 32n | BigInt( slot ), vertices: 0, buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], sizes: [ 0, 0, 0, 0 ], aux: null, auxVersions: '', index: null, indexVersion: - 1, loops: null, quads: null, checked: 0 } );
		entry.checked = frameNumber;
		entry.vertices = vertices;
		const records = ATTRIBUTES.length + AUX_ATTRIBUTES;
		const colorSize = state[ o + 4 + records * 2 ];

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

		// tangent, uv1, skinIndex and skinWeight, interleaved when any of them changed
		const auxKey = auxRecord( state, o + 3 + ATTRIBUTES.length * 2, AUX_ATTRIBUTES );

		if ( auxKey !== entry.auxVersions ) {

			entry.auxVersions = auxKey;

			if ( auxKey === '' ) {

				entry.aux?.destroy();
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

				entry.aux = upload( data, entry.aux, GPUBufferUsage.VERTEX );

			}

		}

		const indexVersion = state[ o + 3 + records * 2 ];

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

	function bindGeometry( pass, entry ) {

		for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) pass.setVertexBuffer( slot, entry.buffers[ slot ] ?? zeros );
		pass.setVertexBuffer( AUX_SLOT, entry.aux ?? auxZeros );
		if ( entry.index ) pass.setIndexBuffer( entry.index, 'uint32' );

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

	// The vertices of an indexed geometry in index order, for quads (which read vertices
	// per instance and so cannot follow an index), kept until the index or data changes.
	function quadSource( world, entry ) {

		if ( ! entry.index ) return entry;
		const key = entry.indexVersion + ':' + entry.versions[ 0 ] + ':' + entry.versions[ 3 ];
		if ( entry.quads && entry.quads.key === key ) return entry.quads;
		entry.quads?.position?.destroy();
		entry.quads?.color?.destroy();
		const index = world.getIndex( entry.handle ), position = world.getAttribute( entry.handle, 'position' );
		const unrolled = ( data, size ) => {

			const out = new Float32Array( index.length * size );
			for ( let i = 0; i < index.length; i ++ ) for ( let k = 0; k < size; k ++ ) out[ i * size + k ] = data[ index[ i ] * size + k ];
			return out;

		};

		const colorSize = entry.sizes[ VERTEX_COLOR_SLOT ];
		const color = entry.buffers[ VERTEX_COLOR_SLOT ] ? upload( unrolled( world.getAttribute( entry.handle, 'color' ), colorSize ), null, GPUBufferUsage.VERTEX ) : null;
		zeroBytes = Math.max( zeroBytes, index.length * 16 );
		entry.quads = { key, position: upload( unrolled( position, 3 ), null, GPUBufferUsage.VERTEX ), color, index: null };
		entry.quads.buffers = [ entry.quads.position, null, null, color ];
		return entry.quads;

	}

	// Indices derived from the `count` vertices from `start` (through the geometry's index,
	// if any): for a line loop those vertices then the first one again, for a wireframe
	// the three edges of each triangle (as three.js builds them, shared edges twice).
	// Kept per geometry until its index changes.
	function derivedIndex( world, entry, start, count, wireframe ) {

		if ( entry.loops === null || entry.loopsVersion !== entry.indexVersion ) {

			if ( entry.loops ) for ( const buffer of entry.loops.values() ) buffer.destroy();
			entry.loops = new Map();
			entry.loopsVersion = entry.indexVersion;

		}

		const key = ( wireframe ? 'w' : 'l' ) + start + ':' + count;
		let buffer = entry.loops.get( key );
		if ( buffer ) return buffer;

		const vertices = new Uint32Array( count );

		if ( entry.index ) {

			const index = world.getIndex( entry.handle );
			for ( let i = 0; i < count; i ++ ) vertices[ i ] = index[ start + i ];

		} else {

			for ( let i = 0; i < count; i ++ ) vertices[ i ] = start + i;

		}

		let data;

		if ( wireframe ) {

			data = new Uint32Array( wireframeCount( count ) );

			for ( let i = 0, o = 0; o < data.length; i += 3, o += 6 ) {

				const a = vertices[ i ], b = vertices[ i + 1 ], c = vertices[ i + 2 ];
				data[ o ] = a; data[ o + 1 ] = b; data[ o + 2 ] = b; data[ o + 3 ] = c; data[ o + 4 ] = c; data[ o + 5 ] = a;

			}

		} else {

			data = new Uint32Array( count + 1 );
			data.set( vertices );
			data[ count ] = vertices[ 0 ];

		}

		buffer = upload( data, null, GPUBufferUsage.INDEX );
		entry.loops.set( key, buffer );
		return buffer;

	}

	function release( entry ) {

		if ( entry.release ) return entry.release();
		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.aux?.destroy();
		entry.index?.destroy();
		entry.quads?.position?.destroy();
		entry.quads?.color?.destroy();
		if ( entry.loops ) for ( const buffer of entry.loops.values() ) buffer.destroy();

	}

	// Records the draws `from` to `to` of the prepared frame into `pass`.
	function drawRange( pass, world, draws, from, to, variant, frameTextures ) {

		pass.setBindGroup( 0, frameGroup );
		pass.setBindGroup( 3, frameTextures );
		let state = - 1, bound = null, map = null, triangles = 0, boundInstances = undefined;

		for ( let i = from, o = from * DRAW_FIELDS; i < to; i ++, o += DRAW_FIELDS ) {

			const entry = entries[ i ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ], material = draws[ o + 6 ], custom = draws[ o + 7 ];
			const instance = perInstance[ i ], copies = instance ? draws[ o + 5 ] : 1;

			if ( custom > 0 && custom < 16 ) {

				pass.setPipeline( effectPipeline( key | variant, custom ) );
				state = - 1;

			} else {

				// three.js's WebGPURenderer draws no GLSL shader materials either; they draw with their colour
				if ( custom >= 16 ) warnOnce( 'ShaderMaterial and RawShaderMaterial (GLSL) draw only on WebGL 2; drawn unlit' );
				if ( key !== state ) pass.setPipeline( pipeline( ( state = key ) | variant ) );

			}
			if ( groups[ i ] !== map ) pass.setBindGroup( 2, map = groups[ i ] );
			pass.setBindGroup( 1, objectGroup, [ i * stride, material * materialStride ] );

			if ( key & QUAD_KEY ) {

				// points or segments as instances of a six-vertex quad
				const source = quadSource( world, entry ), topology = key >> 5 & 3;
				const [ first, count ] = quadInstances( topology, start, vertices );
				pass.setVertexBuffer( 0, source.buffers[ 0 ] ?? zeros );
				pass.setVertexBuffer( VERTEX_COLOR_SLOT, source.buffers[ VERTEX_COLOR_SLOT ] ?? zeros );
				bound = null;
				if ( count > 0 ) pass.draw( 6, count, 0, first );
				continue;

			}

			if ( instance !== boundInstances ) {

				pass.setVertexBuffer( MATRIX_SLOT, instance ? instance.matrix : identity );
				pass.setVertexBuffer( COLOR_SLOT, instance?.color ?? ones );
				boundInstances = instance;

			}

			if ( entry !== bound ) {

				bindGeometry( pass, entry );
				bound = entry;

			}

			if ( key & ( LOOP_KEY | WIREFRAME_KEY ) ) {

				const wireframe = ( key & WIREFRAME_KEY ) !== 0, indices = wireframe ? wireframeCount( vertices ) : vertices + 1;

				if ( indices > 1 ) {

					pass.setIndexBuffer( derivedIndex( world, entry, start, vertices, wireframe ), 'uint32' );
					pass.drawIndexed( indices, copies, 0 );
					// the geometry's own index buffer is bound again by the next draw
					bound = null;

				}

			} else if ( entry.index ) pass.drawIndexed( vertices, copies, start );
			else pass.draw( vertices, copies, start );
			if ( ( key >> 5 & 3 ) === 0 ) triangles += vertices / 3 * copies;

		}

		return triangles;

	}

	return {

		name: fallbackAdapter ? 'webgpu-software' : 'webgpu', isWebGPUBackend: true, device, format, info,

		/**
		 * `instanceSources` maps instance ids to `{ matrix, matrixVersion, color, colorVersion }`
		 * (16 floats and optionally 3 floats per instance).
		 * `clear` is a linear colour `{ r, g, b, a }`. `sources` maps texture ids to `{ image, version, flipY, magFilter, minFilter, wrapS, wrapT, colorSpace, generateMipmaps, type }`.
		 * `target`, when given, is a render target `{ id, width, height, samples, type, texture, textures, depthTexture }`
		 * (`type` 'byte' or 'float'): the frame is drawn into it, without tone mapping.
		 * `pixelRatio` sizes points and lines drawn as quads. */
		render( world, renderer, root, camera, clear, sources, instanceSources, target = null, pixelRatio = 1, extras = null ) {

			const load = extras?.load === true;

			frameNumber ++;
			const offscreen = target ? renderTarget( target ) : null;
			drawingInto = target ? target.id : 0;
			if ( ! offscreen ) ensureTargets();
			const width = offscreen ? offscreen.width : targetWidth, height = offscreen ? offscreen.height : targetHeight;
			renderer.setViewport( width, height, pixelRatio );

			const count = renderer.prepare( world, root, camera );
			info.candidates = renderer.candidateCount();

			const frameUniforms = renderer.frameUniforms();

			if ( ! frameBuffer ) {

				frameBuffer = device.createBuffer( { size: frameUniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
				frameGroup = device.createBindGroup( { layout: frameLayout, entries: [ { binding: 0, resource: { buffer: frameBuffer } } ] } );

			}

			device.queue.writeBuffer( frameBuffer, 0, frameUniforms );

			const materialCount = renderer.materialUniformsLength() / MATERIAL_FLOATS;

			if ( count > objectCapacity || materialCount > materialCapacity || ! objectGroup ) {

				if ( count > objectCapacity || ! objectBuffer ) {

					objectBuffer?.destroy();
					objectCapacity = Math.max( 64, Math.ceil( count * 1.5 ) );
					objectBuffer = device.createBuffer( { size: objectCapacity * stride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );

				}

				if ( materialCount > materialCapacity || ! materialBuffer ) {

					materialBuffer?.destroy();
					materialCapacity = Math.max( 16, Math.ceil( materialCount * 1.5 ) );
					materialBuffer = device.createBuffer( { size: materialCapacity * materialStride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
					shadowObjectGroup = null;

				}

				objectGroup = device.createBindGroup( { layout: objectLayout, entries: [ { binding: 0, resource: { buffer: objectBuffer, size: objectBindingBytes } }, { binding: 1, resource: { buffer: materialBuffer, size: materialStride } } ] } );

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

			const nextEnvironment = environment( renderer.environmentInfo(), sources ) ?? noEnvironmentView;

			if ( nextEnvironment !== environmentView ) {

				environmentView = nextEnvironment;
				rebuildFrameTextures();

			}

			const backdrop = background( renderer, sources );
			uploadBones( renderer );
			const transmissive = renderer.transmissiveCount(), opaque = renderer.opaqueCount();
			if ( transmissive > 0 ) ensureTransmission( width, height );

			// Taken after the uploads above, which may have grown the module's memory.
			const materialData = new Float32Array( memory().buffer, renderer.materialUniformsPtr(), renderer.materialUniformsLength() );
			if ( materialData.length > 0 ) device.queue.writeBuffer( materialBuffer, 0, materialData );
			if ( count > 0 ) device.queue.writeBuffer( objectBuffer, 0, new Float32Array( memory().buffer, renderer.objectUniformsPtr(), renderer.objectUniformsLength() ) );

			const encoder = device.createCommandEncoder();
			const shadowCalls = drawShadows( encoder, renderer, instanceSources, materialData );
			// Tone mapping applies only to what is drawn to the canvas, as in three.js.
			const toneMapping = offscreen ? 0 : frameUniforms[ TONE_MAPPING ], hdr = toneMapping !== 0;
			if ( hdr ) ensureHdrTargets();

			if ( transmissive > 0 ) {

				// the background and the opaque draws, into the copy transmissive materials read
				const copy = encoder.beginRenderPass( {
					colorAttachments: [ { view: transmission.target, clearValue: clear, loadOp: 'clear', storeOp: 'store' } ],
					depthStencilAttachment: { view: transmission.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
				} );

				if ( backdrop ) {

					copy.setPipeline( backgroundPipeline( HDR_KEY | SINGLE_KEY ) );
					copy.setBindGroup( 0, backdrop );
					copy.draw( 3 );

				}

				drawRange( copy, world, draws, 0, opaque, HDR_KEY | SINGLE_KEY, frameTexturesGroupNoCopy );
				copy.end();
				generateMipmaps( transmission.texture, encoder );

			}

			const view = offscreen ? null : context.getCurrentTexture().createView( { format } );
			const variant = offscreen ? offscreen.variant : hdr ? HDR_KEY : 0;
			const colorAttachments = offscreen
				? offscreen.views.map( ( resolved, i ) => {

					const multisampled = offscreen.multisampleViews[ i ];
					return { view: multisampled ?? resolved, resolveTarget: multisampled ? resolved : undefined, clearValue: clear, loadOp: load ? 'load' : 'clear', storeOp: multisampled && ! load ? 'discard' : 'store' };

				} )
				: [ { view: ( hdr ? hdrMultisampleView : colorView ) ?? ( hdr ? hdrView : view ), resolveTarget: ( hdr ? hdrMultisampleView : colorView ) ? ( hdr ? hdrView : view ) : undefined, clearValue: clear, loadOp: load ? 'load' : 'clear', storeOp: ( hdr ? hdrMultisampleView : colorView ) && ! load ? 'discard' : 'store' } ];
			// a render target's extra colour attachments repeat the first output
			if ( offscreen && offscreen.count > 1 ) colorAttachments.length = 1;
			const pass = encoder.beginRenderPass( {
				colorAttachments,
				depthStencilAttachment: { view: offscreen ? offscreen.depthView : depthView, depthClearValue: 1, depthLoadOp: load ? 'load' : 'clear', depthStoreOp: offscreen?.depthId || load ? 'store' : 'discard' }
			} );

			if ( backdrop ) {

				pass.setPipeline( backgroundPipeline( variant ) );
				pass.setBindGroup( 0, backdrop );
				pass.draw( 3 );

			}

			const triangles = drawRange( pass, world, draws, 0, count, variant, frameTexturesGroup );
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
			for ( const resource of [ white, identity, auxZeros, ones, zeros, objectBuffer, materialBuffer, frameBuffer, depthTexture, colorTexture, hdrTexture, hdrMultisample, outputSettings, shadowTexture, shadowCameras, shadowObjects, boneTexture, emptyFloat, emptyVsm, vsmTexture, vsmScratch, transmission?.texture, transmission?.depth, vsm?.settings, vsm?.placeholder ] ) resource?.destroy();
			environmentPasses.dispose();
			context.unconfigure();
			device.destroy();

		}

	};

}
