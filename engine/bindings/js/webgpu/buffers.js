// Vertex, index and instance buffers, quads and derived indices.
//
// Part of the WebGPU host; `../webgpu.js` creates the device and draws the frames.

import { memory } from '../index.js';
import { auxRecord } from './formats.js';
import { ATTRIBUTES, AUX_ATTRIBUTES, AUX_FLOATS, AUX_OFFSETS, AUX_SIZES, AUX_SLOT, VERTEX_COLOR_SLOT, wireframeCount } from './constants.js';

/** Adds this part's functions and state to the host context `ctx`. */
export function installBuffers( ctx ) {

	const { auxZeros, device, geometries, info, instanced } = ctx;

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

	// Small geometries without tangents, second uvs or skinning share buffers: one pool per
	// set of inputs (which of position, normal, uv and colour the shader reads, and the
	// colour's floats), with a buffer per input and one for the indices. A draw reaches its
	// geometry through `baseVertex` and `firstIndex`, so going from one pooled geometry to
	// another of the same pool binds nothing; indices stay relative to their geometry.
	// Pools grow by copying into larger buffers, which happens only while geometries are
	// uploaded, before the frame's passes are recorded.
	const POOL_MAX_VERTICES = 65536, POOL_MAX_INDICES = 393216, POOL_MIN_VERTICES = 16384, POOL_MIN_INDICES = 49152;
	const pools = new Map();

	function poolSignature( state, o, vertices, colorSize, auxKey ) {

		if ( auxKey !== '' || vertices === 0 || vertices > POOL_MAX_VERTICES ) return - 1;
		let signature = 0;
		for ( let i = 0, p = o + 4; i < ATTRIBUTES.length; i ++, p += 2 ) if ( state[ p ] !== 0 ) signature |= 1 << i;
		return signature & 1 << VERTEX_COLOR_SLOT ? signature | colorSize << 4 : signature;

	}

	// First fit in a list of free `start, length` pairs in address order.
	function allocate( free, length ) {

		for ( let i = 0; i < free.length; i += 2 ) {

			if ( free[ i + 1 ] < length ) continue;
			const start = free[ i ];
			if ( free[ i + 1 ] === length ) free.splice( i, 2 );
			else {

				free[ i ] += length;
				free[ i + 1 ] -= length;

			}

			return start;

		}

		return - 1;

	}

	function deallocate( free, start, length ) {

		let i = 0;
		while ( i < free.length && free[ i ] < start ) i += 2;
		free.splice( i, 0, start, length );

		if ( i + 2 < free.length && start + length === free[ i + 2 ] ) {

			free[ i + 1 ] += free[ i + 3 ];
			free.splice( i + 2, 2 );

		}

		if ( i > 0 && free[ i - 2 ] + free[ i - 1 ] === start ) {

			free[ i - 1 ] += free[ i + 1 ];
			free.splice( i, 2 );

		}

	}

	function poolStride( pool, slot ) {

		return slot === VERTEX_COLOR_SLOT ? pool.colorSize * 4 : ATTRIBUTES[ slot ][ 1 ] * 4;

	}

	// Moves the pool's buffers (`slots`, or the index when `slots` is null) to larger ones.
	function growPool( pool, needed, indices ) {

		const old = indices ? pool.indexCapacity : pool.vertexCapacity;
		const capacity = Math.max( old * 2, old + needed, indices ? POOL_MIN_INDICES : POOL_MIN_VERTICES );
		if ( capacity * 16 > device.limits.maxBufferSize ) return false;
		const encoder = device.createCommandEncoder(), retired = [];

		const replace = ( buffer, stride, usage ) => {

			const next = device.createBuffer( { size: capacity * stride, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC } );

			if ( buffer ) {

				encoder.copyBufferToBuffer( buffer, 0, next, 0, old * stride );
				retired.push( buffer );

			}

			return next;

		};

		if ( indices ) {

			pool.index = replace( pool.index, 4, GPUBufferUsage.INDEX );
			pool.indexCapacity = capacity;
			deallocate( pool.indexFree, old, capacity - old );

		} else {

			for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) if ( pool.signature & 1 << slot ) pool.buffers[ slot ] = replace( pool.buffers[ slot ], poolStride( pool, slot ), GPUBufferUsage.VERTEX );
			pool.vertexCapacity = capacity;
			deallocate( pool.vertexFree, old, capacity - old );
			// inputs the pool's geometries lack are bound to zeros, read up to the pool's size
			if ( ( pool.signature & 15 ) !== 15 ) ctx.zeroBytes = Math.max( ctx.zeroBytes, capacity * 16 );

		}

		device.queue.submit( [ encoder.finish() ] );
		for ( const buffer of retired ) buffer.destroy();
		for ( const entry of pool.members ) poolBuffers( entry );
		return true;

	}

	function poolBuffers( entry ) {

		const pool = entry.pool;
		for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) entry.buffers[ slot ] = pool.buffers[ slot ];
		entry.index = entry.indexCount > 0 ? pool.index : null;

	}

	// Moves `entry` into the pool for `signature`; its attributes are written afterwards
	// (their versions are reset), its index here. Returns false if it stays on its own.
	function joinPool( world, entry, signature, vertices ) {

		const index = world.getIndex( entry.handle );
		if ( index.length > POOL_MAX_INDICES ) return false;
		let pool = pools.get( signature );
		if ( ! pool ) pools.set( signature, pool = { signature, colorSize: signature >> 4, buffers: [ null, null, null, null ], index: null, vertexCapacity: 0, indexCapacity: 0, vertexFree: [], indexFree: [], members: new Set() } );

		let base = allocate( pool.vertexFree, vertices );
		if ( base < 0 && growPool( pool, vertices, false ) ) base = allocate( pool.vertexFree, vertices );
		if ( base < 0 ) return false;
		let first = 0;

		if ( index.length > 0 ) {

			first = allocate( pool.indexFree, index.length );
			if ( first < 0 && growPool( pool, index.length, true ) ) first = allocate( pool.indexFree, index.length );

			if ( first < 0 ) {

				deallocate( pool.vertexFree, base, vertices );
				return false;

			}

			device.queue.writeBuffer( pool.index, first * 4, index );
			info.uploads ++;

		}

		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.index?.destroy();
		entry.pool = pool;
		entry.baseVertex = base;
		entry.firstIndex = first;
		entry.indexCount = index.length;
		entry.poolVertices = vertices;
		entry.versions.fill( - 1 );
		pool.members.add( entry );
		poolBuffers( entry );
		return true;

	}

	function leavePool( entry ) {

		const pool = entry.pool;
		pool.members.delete( entry );
		deallocate( pool.vertexFree, entry.baseVertex, entry.poolVertices );
		if ( entry.indexCount > 0 ) deallocate( pool.indexFree, entry.firstIndex, entry.indexCount );
		entry.pool = null;
		entry.baseVertex = entry.firstIndex = entry.indexCount = 0;
		entry.buffers.fill( null );
		entry.versions.fill( - 1 );
		entry.index = null;
		entry.indexVersion = - 1;

	}

	function disposePools() {

		for ( const pool of pools.values() ) {

			for ( const buffer of pool.buffers ) buffer?.destroy();
			pool.index?.destroy();

		}

		pools.clear();

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

		if ( ! entry ) geometries.set( slot, entry = { generation, handle: BigInt( generation ) << 32n | BigInt( slot ), vertices: 0, buffers: [ null, null, null, null ], versions: [ - 1, - 1, - 1, - 1 ], sizes: [ 0, 0, 0, 0 ], aux: null, auxVersions: '', index: null, indexVersion: - 1, loops: null, quads: null, checked: 0, pool: null, baseVertex: 0, firstIndex: 0, indexCount: 0, poolVertices: 0, refused: - 2 } );
		entry.checked = ctx.frameNumber;
		entry.vertices = vertices;
		const records = ATTRIBUTES.length + AUX_ATTRIBUTES;
		const colorSize = state[ o + 4 + records * 2 ], indexVersion = state[ o + 3 + records * 2 ];
		const auxKey = auxRecord( state, o + 3 + ATTRIBUTES.length * 2, AUX_ATTRIBUTES );
		const signature = poolSignature( state, o, vertices, colorSize, auxKey );
		// a geometry whose inputs, size or index changed is placed again
		if ( entry.pool && ( signature !== entry.pool.signature || vertices !== entry.poolVertices || indexVersion !== entry.indexVersion ) ) leavePool( entry );

		if ( ! entry.pool && signature >= 0 && entry.refused !== indexVersion ) {

			if ( joinPool( world, entry, signature, vertices ) ) entry.indexVersion = indexVersion;
			else entry.refused = indexVersion;

		}

		for ( let i = 0, p = o + 3; i < ATTRIBUTES.length; i ++, p += 2 ) {

			const version = state[ p ], address = state[ p + 1 ], size = i === VERTEX_COLOR_SLOT ? colorSize : ATTRIBUTES[ i ][ 1 ];

			if ( address === 0 ) {

				entry.buffers[ i ]?.destroy();
				entry.buffers[ i ] = null;
				entry.versions[ i ] = - 1;
				ctx.zeroBytes = Math.max( ctx.zeroBytes, vertices * 16 );
				continue;

			}

			if ( version === entry.versions[ i ] && size === entry.sizes[ i ] ) continue;
			// Created per upload: the index read below may grow the module's memory.
			const data = new Float32Array( memory().buffer, address, vertices * size );

			if ( entry.pool ) {

				device.queue.writeBuffer( entry.pool.buffers[ i ], entry.baseVertex * size * 4, data );
				info.uploads ++;

			} else {

				entry.buffers[ i ] = upload( data, entry.buffers[ i ], GPUBufferUsage.VERTEX );

			}

			entry.versions[ i ] = version;
			entry.sizes[ i ] = size;

		}

		// tangent, uv1, skinIndex and skinWeight, interleaved when any of them changed
		if ( auxKey !== entry.auxVersions ) {

			entry.auxVersions = auxKey;

			if ( auxKey === '' ) {

				entry.aux?.destroy();
				entry.aux = null;

			} else {

				const data = new Float32Array( vertices * AUX_FLOATS ), view = new Float32Array( memory().buffer );
				const offsets = AUX_OFFSETS, sizes = AUX_SIZES;

				for ( let a = 0, p = o + 3 + ATTRIBUTES.length * 2; a < AUX_ATTRIBUTES; a ++, p += 2 ) {

					const address = state[ p + 1 ];
					if ( address === 0 ) continue;
					const base = address >>> 2, size = sizes[ a ], offset = offsets[ a ];
					for ( let v = 0; v < vertices; v ++ ) for ( let k = 0; k < size; k ++ ) data[ v * AUX_FLOATS + offset + k ] = view[ base + v * size + k ];

				}

				entry.aux = upload( data, entry.aux, GPUBufferUsage.VERTEX );

			}

		}

		// a pooled geometry's index was written when it joined the pool
		if ( ! entry.pool && indexVersion !== entry.indexVersion ) {

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

	// What the pass in `boundPass` has bound to the geometry slots (the aux slot last) and as
	// its index, so that only changed bindings are set. `forgetBindings` is called by code
	// that binds those slots itself.
	let boundPass = null, boundIndex = null;
	const boundSlots = [ null, null, null, null, null ];

	function bindGeometry( pass, entry ) {

		if ( pass !== boundPass ) {

			boundPass = pass;
			boundSlots.fill( null );
			boundIndex = null;

		}

		for ( let slot = 0; slot < ATTRIBUTES.length; slot ++ ) {

			const buffer = entry.buffers[ slot ] ?? ctx.zeros;
			if ( buffer !== boundSlots[ slot ] ) pass.setVertexBuffer( slot, boundSlots[ slot ] = buffer );

		}

		const aux = entry.aux ?? auxZeros;
		if ( aux !== boundSlots[ ATTRIBUTES.length ] ) pass.setVertexBuffer( AUX_SLOT, boundSlots[ ATTRIBUTES.length ] = aux );
		if ( entry.index && entry.index !== boundIndex ) pass.setIndexBuffer( boundIndex = entry.index, 'uint32' );

	}

	// 0, 1, 2... as u32: draws that are not direct read their object block's index from it
	// at a stride of 0, bound at the index (see `OBJECT_SLOT`). Grown before any pass of a
	// frame is recorded.
	ctx.objectSlots = null;

	function ensureObjectSlots( count ) {

		if ( ctx.objectSlots && ctx.objectSlots.size >= count * 4 ) return;
		const values = new Uint32Array( Math.max( 64, count ) );
		for ( let i = 0; i < values.length; i ++ ) values[ i ] = i;
		ctx.objectSlots?.destroy();
		ctx.objectSlots = device.createBuffer( { size: values.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } );
		device.queue.writeBuffer( ctx.objectSlots, 0, values );

	}

	function forgetBindings() {

		boundPass = boundIndex = null;
		boundSlots.fill( null );

	}

	// Instance matrices and colours live in typed arrays on the JavaScript side; they are
	// uploaded when their version changes.
	function instances( id, count, sources ) {

		const source = id === 0 ? null : sources?.get( id );
		if ( ! source ) return null;

		let entry = instanced.get( id );
		if ( ! entry ) instanced.set( id, entry = { matrix: null, color: null, matrixVersion: - 1, colorVersion: - 1, checked: 0 } );
		entry.checked = ctx.frameNumber;

		if ( entry.matrixVersion !== source.matrixVersion ) {

			entry.matrix = upload( source.matrix, entry.matrix, GPUBufferUsage.VERTEX );
			entry.matrixVersion = source.matrixVersion;

		}

		if ( source.color === null ) {

			entry.color?.destroy();
			entry.color = null;
			entry.colorVersion = - 1;
			ctx.oneCount = Math.max( ctx.oneCount, count );

		} else if ( entry.colorVersion !== source.colorVersion ) {

			entry.color = upload( source.color, entry.color, GPUBufferUsage.VERTEX );
			entry.colorVersion = source.colorVersion;

		}

		return entry;

	}

	// The vertices of an indexed geometry in index order, for quads (which read vertices
	// per instance and so cannot follow an index), kept until the index or data changes.
	// A line loop gets the `count` vertices from `start` and then the first again, so that
	// its closing segment is drawn too; the result then starts at 0.
	function quadSource( world, entry, start = 0, count = 0, loop = false ) {

		const dashed = ( ',' + entry.auxVersions ).includes( ',4:' );

		if ( ! entry.index && ! loop ) {

			// line distances in a buffer of their own, read per instance like the positions
			if ( entry.distanceKey !== entry.auxVersions ) {

				entry.distance?.destroy();
				entry.distance = dashed ? upload( new Float32Array( world.getAttribute( entry.handle, 'lineDistance' ) ), null, GPUBufferUsage.VERTEX ) : null;
				entry.distanceKey = entry.auxVersions;

			}

			return entry;

		}

		const key = entry.indexVersion + ':' + entry.versions[ 0 ] + ':' + entry.versions[ 3 ] + ':' + entry.auxVersions + ( loop ? ':' + start + ':' + count : '' );
		if ( entry.quads && entry.quads.key === key ) return entry.quads;
		entry.quads?.position?.destroy();
		entry.quads?.color?.destroy();
		entry.quads?.distance?.destroy();
		const position = world.getAttribute( entry.handle, 'position' );
		let index = entry.index ? world.getIndex( entry.handle ) : null;

		if ( loop ) {

			const order = new Uint32Array( count + 1 );
			for ( let i = 0; i < count; i ++ ) order[ i ] = index ? index[ start + i ] : start + i;
			order[ count ] = order[ 0 ];
			index = order;

		}

		const unrolled = ( data, size ) => {

			const out = new Float32Array( index.length * size );
			for ( let i = 0; i < index.length; i ++ ) for ( let k = 0; k < size; k ++ ) out[ i * size + k ] = data[ index[ i ] * size + k ];
			return out;

		};

		const colorSize = entry.sizes[ VERTEX_COLOR_SLOT ];
		const color = entry.buffers[ VERTEX_COLOR_SLOT ] ? upload( unrolled( world.getAttribute( entry.handle, 'color' ), colorSize ), null, GPUBufferUsage.VERTEX ) : null;
		ctx.zeroBytes = Math.max( ctx.zeroBytes, index.length * 16 );
		const distance = dashed ? upload( unrolled( world.getAttribute( entry.handle, 'lineDistance' ), 1 ), null, GPUBufferUsage.VERTEX ) : null;
		entry.quads = { key, position: upload( unrolled( position, 3 ), null, GPUBufferUsage.VERTEX ), color, distance, index: null };
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
		if ( entry.pool ) leavePool( entry );
		for ( const buffer of entry.buffers ) buffer?.destroy();
		entry.aux?.destroy();
		entry.index?.destroy();
		entry.quads?.position?.destroy();
		entry.quads?.color?.destroy();
		entry.quads?.distance?.destroy();
		entry.distance?.destroy();
		if ( entry.loops ) for ( const buffer of entry.loops.values() ) buffer.destroy();

	}

	Object.assign( ctx, { bindGeometry, derivedIndex, disposePools, ensureObjectSlots, forgetBindings, geometry, instances, quadSource, release } );

}
