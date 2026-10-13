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

// Vertex inputs of the shader, in location order: name, floats per vertex.
const ATTRIBUTES = [ [ 'position', 3 ], [ 'normal', 3 ], [ 'uv', 2 ], [ 'color', 3 ] ];
const TOPOLOGIES = [ 'triangle-list', 'line-strip', 'line-list' ];

// Per-instance inputs follow the per-vertex ones: a matrix as four columns, then a colour.
const VERTEX_BUFFERS = [
	...ATTRIBUTES.map( ( [ , size ], shaderLocation ) => ( { arrayStride: size * 4, attributes: [ { shaderLocation, offset: 0, format: `float32x${size}` } ] } ) ),
	{ arrayStride: 64, stepMode: 'instance', attributes: [ 0, 1, 2, 3 ].map( ( column ) => ( { shaderLocation: 4 + column, offset: column * 16, format: 'float32x4' } ) ) },
	{ arrayStride: 12, stepMode: 'instance', attributes: [ { shaderLocation: 8, offset: 0, format: 'float32x3' } ] }
];
const MATRIX_SLOT = ATTRIBUTES.length, COLOR_SLOT = ATTRIBUTES.length + 1, DRAW_FIELDS = 6;

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
	const module = device.createShaderModule( { code: Renderer.shaderSource() } );

	const frameLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} } ] } );
	const objectLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true, minBindingSize: objectBindingBytes } } ] } );
	const textureLayout = device.createBindGroupLayout( { entries: [ { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} } ] } );
	const layout = device.createPipelineLayout( { bindGroupLayouts: [ frameLayout, objectLayout, textureLayout ] } );

	// Pipelines are created the first time a state is drawn and kept. The key is the
	// engine's pipeline state: bits 0-1 side, 2 blending, 3 depth write, 4 depth test,
	// 5-6 primitive.
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
			fragment: { module, entryPoint: 'fragment', targets: [ { format, blend } ] },
			primitive: { topology, frontFace: 'ccw', cullMode: [ 'back', 'front', 'none' ][ key & 3 ], stripIndexFormat: topology === 'line-strip' ? 'uint32' : undefined },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: ( key & 8 ) !== 0, depthCompare: key & 16 ? 'less-equal' : 'always' },
			multisample: { count: samples }
		} );
		pipelines.set( key, value );
		return value;

	}

	let frameBuffer = null, frameGroup = null;
	let objectBuffer = null, objectGroup = null, objectCapacity = 0;
	let depthTexture = null, colorTexture = null, targetWidth = 0, targetHeight = 0;
	// Bound in place of an attribute a geometry does not have.
	let zeros = null, zeroBytes = 16;
	const geometries = new Map(), textures = new Map(), blits = new Map(), instanced = new Map();

	// What an object without instances is drawn with: one identity matrix. `ones` is the
	// instance colour of everything that has none, and grows with the largest count.
	const identity = device.createBuffer( { size: 64, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } );
	device.queue.writeBuffer( identity, 0, new Float32Array( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] ) );
	let ones = null, oneCount = 1;
	let frameNumber = 0;
	const info = { calls: 0, triangles: 0, candidates: 0, geometries: 0, textures: 0, pipelines: 0, uploads: 0 };

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

	function ensureTargets() {

		const width = Math.max( 1, canvas.width ), height = Math.max( 1, canvas.height );
		if ( width === targetWidth && height === targetHeight ) return;
		depthTexture?.destroy();
		colorTexture?.destroy();
		depthTexture = device.createTexture( { size: [ width, height ], format: 'depth24plus', sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT } );
		colorTexture = samples > 1 ? device.createTexture( { size: [ width, height ], format, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT } ) : null;
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
	// only when its version changes.
	function geometry( world, handle ) {

		let entry = geometries.get( handle );
		if ( entry && entry.checked === frameNumber ) return entry;
		if ( ! entry ) geometries.set( handle, entry = { buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], index: null, indexVersion: - 1, checked: 0 } );
		entry.checked = frameNumber;

		const vertices = world.attributeCount( handle, 'position' );

		for ( let i = 0; i < ATTRIBUTES.length; i ++ ) {

			const [ name, size ] = ATTRIBUTES[ i ];

			if ( i > 0 && ! ( world.hasAttribute( handle, name ) && world.attributeLength( handle, name ) === vertices * size ) ) {

				entry.buffers[ i ]?.destroy();
				entry.buffers[ i ] = null;
				entry.versions[ i ] = - 1;
				zeroBytes = Math.max( zeroBytes, vertices * 12 );
				continue;

			}

			const version = world.attributeVersion( handle, name );
			if ( version === entry.versions[ i ] ) continue;
			entry.buffers[ i ] = upload( new Float32Array( memory().buffer, world.attributePtr( handle, name ), vertices * size ), entry.buffers[ i ], GPUBufferUsage.VERTEX );
			entry.versions[ i ] = version;

		}

		const indexVersion = world.indexVersion( handle );

		if ( indexVersion !== entry.indexVersion ) {

			const index = world.getIndex( handle );

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

		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.index?.destroy();

	}

	return {

		device, format, info,

		/**
		 * `instanceSources` maps instance ids to `{ matrix, matrixVersion, color, colorVersion }`
		 * (16 floats and optionally 3 floats per instance).
		 * `clear` is a linear colour `{ r, g, b, a }`. `sources` maps texture ids to `{ image, version, flipY, magFilter, minFilter, wrapS, wrapT, colorSpace, generateMipmaps }`. */
		render( world, renderer, root, camera, clear, sources, instanceSources ) {

			frameNumber ++;
			ensureTargets();

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

			const handles = renderer.drawGeometries(), draws = renderer.drawInfo();
			const entries = new Array( count ), groups = new Array( count ), perInstance = new Array( count );

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				entries[ i ] = geometry( world, handles[ i ] );
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

			const view = context.getCurrentTexture().createView( { format } );
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass( {
				colorAttachments: [ {
					view: colorTexture ? colorTexture.createView() : view,
					resolveTarget: colorTexture ? view : undefined,
					clearValue: clear, loadOp: 'clear', storeOp: colorTexture ? 'discard' : 'store'
				} ],
				depthStencilAttachment: { view: depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
			} );

			pass.setBindGroup( 0, frameGroup );
			let state = - 1, bound = null, map = null, triangles = 0, boundInstances;

			for ( let i = 0, o = 0; i < count; i ++, o += DRAW_FIELDS ) {

				const entry = entries[ i ], key = draws[ o ], start = draws[ o + 2 ], vertices = draws[ o + 3 ];
				const instance = perInstance[ i ], copies = instance ? draws[ o + 5 ] : 1;
				if ( key !== state ) pass.setPipeline( pipeline( state = key ) );

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
				if ( key >> 5 === 0 ) triangles += vertices / 3 * copies;

			}

			pass.end();
			device.queue.submit( [ encoder.finish() ] );

			info.calls = count;
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

		dispose() {

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
			context.unconfigure();
			device.destroy();

		}

	};

}
