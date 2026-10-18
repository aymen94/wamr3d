// Render pipelines by state key, and the effect pipelines.
//
// Part of the WebGPU host; `../webgpu.js` creates the device and draws the frames.

import { Renderer } from '../index.js';
import { BLEND_FACTORS, HDR_FORMAT, HDR_KEY, RGBA8_KEY, SINGLE_KEY, customBlend } from './formats.js';
import { PREMULTIPLIED_KEY, QUAD_KEY, TOPOLOGIES, quadBuffers, vertexBuffers } from './constants.js';

/** Adds this part's functions and state to the host context `ctx`. */
export function installPipelines( ctx ) {

	const { device, format, layout, module, samples } = ctx;

	// Pipelines are created the first time a state is drawn and kept. The key is the
	// engine's pipeline state (see `Renderer.drawInfo`); HDR_KEY, RGBA8_KEY and
	// SINGLE_KEY mark pipelines that draw into the linear target or a render target.
	const pipelines = new Map();

	function blend( key, custom = 0 ) {

		if ( ( key & 4 ) === 0 ) return undefined;
		if ( ( key >> 11 & 7 ) === 5 ) return customBlend( custom );
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

	// `custom` is the material's packed custom blending, read only with CustomBlending.
	function pipeline( key, custom = 0 ) {

		const id = ( key & 4 ) && ( key >> 11 & 7 ) === 5 ? key + ':' + custom : key;
		let value = pipelines.get( id );
		if ( value ) return value;
		const quad = ( key & QUAD_KEY ) !== 0, topology = quad ? 'triangle-list' : TOPOLOGIES[ key >> 5 & 3 ];

		value = device.createRenderPipeline( {
			layout,
			vertex: quad ? { module, entryPoint: 'vertex_quad', buffers: quadBuffers( key ) } : { module, entryPoint: 'vertex', buffers: vertexBuffers( key ) },
			fragment: { module, entryPoint: 'fragment', targets: [ { format: key & HDR_KEY ? HDR_FORMAT : key & RGBA8_KEY ? 'rgba8unorm' : format, blend: blend( key, custom ) } ] },
			primitive: { topology, frontFace: 'ccw', cullMode: quad ? 'none' : [ 'back', 'front', 'none' ][ key & 3 ], stripIndexFormat: topology === 'line-strip' ? 'uint32' : undefined },
			depthStencil: { format: 'depth24plus', depthWriteEnabled: ( key & 8 ) !== 0, depthCompare: key & 16 ? 'less-equal' : 'always' },
			multisample: { count: key & SINGLE_KEY ? 1 : samples }
		} );
		pipelines.set( id, value );
		return value;

	}

	Object.assign( ctx, { effectPipeline, pipeline, pipelines } );

}
