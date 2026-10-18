// three.js add-on path: `three/addons/loaders/GLTFLoader.js`.
//
// glTF 2.0 (`.gltf` with external or embedded buffers, and binary `.glb`) into WAMR3D
// objects, with the result three.js's GLTFLoader gives: `{ scene, scenes, animations,
// cameras, asset, parser, userData }`. Supported: meshes of every primitive mode, sparse
// and interleaved accessors, KHR_mesh_quantization, morph targets, skins, animations
// (linear, step and cubic-spline), cameras, materials with every core texture,
// KHR_texture_transform, KHR_materials_unlit, emissive_strength, ior, specular,
// clearcoat, sheen, transmission, volume, iridescence, anisotropy and dispersion,
// KHR_lights_punctual, EXT_mesh_gpu_instancing, EXT_texture_webp and EXT_texture_avif.
// Compressed assets decode as in three.js, through the decoders the application sets:
// KHR_draco_mesh_compression with `setDRACOLoader`, KHR_texture_basisu with
// `setKTX2Loader`, EXT_meshopt_compression and KHR_meshopt_compression with
// `setMeshoptDecoder` (meshoptimizer's `MeshoptDecoder`).

import { BufferAttribute, Group, ImageBitmapLoader, InterleavedBuffer, InterleavedBufferAttribute, Loader, LoaderUtils, PropertyBinding, FileLoader } from '../../compat.js';
import { BINARY_MAGIC, CHUNK_BIN, CHUNK_JSON, COMPONENT_TYPES, TYPE_SIZES } from './gltf/common.js';
import { GLTFMaterials } from './gltf/materials.js';
import { GLTFMeshes } from './gltf/meshes.js';
import { GLTFNodes } from './gltf/nodes.js';
import { GLTFAnimation } from './gltf/animation.js';

// ---------------------------------------------------------------- loader

export class GLTFLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.dracoLoader = null;
		this.ktx2Loader = null;
		this.meshoptDecoder = null;
		this.pluginCallbacks = [];

	}

	load( url, onLoad, onProgress, onError ) {

		const resourcePath = this.resourcePath !== '' ? this.resourcePath : this.path !== '' ? LoaderUtils.resolveURL( LoaderUtils.extractUrlBase( url ), this.path ) : LoaderUtils.extractUrlBase( url );
		this.manager.itemStart( url );
		const failed = ( error ) => {

			if ( onError ) onError( error );
			else console.error( error );
			this.manager.itemError( url );
			this.manager.itemEnd( url );

		};

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( data ) => {

			try {

				this.parse( data, resourcePath, ( gltf ) => {

					onLoad( gltf );
					this.manager.itemEnd( url );

				}, failed );

			} catch ( error ) {

				failed( error );

			}

		}, onProgress, failed );

	}

	setDRACOLoader( loader ) {

		this.dracoLoader = loader;
		return this;

	}

	setKTX2Loader( loader ) {

		this.ktx2Loader = loader;
		return this;

	}

	setMeshoptDecoder( decoder ) {

		this.meshoptDecoder = decoder;
		return this;

	}

	register( callback ) {

		if ( ! this.pluginCallbacks.includes( callback ) ) this.pluginCallbacks.push( callback );
		return this;

	}

	unregister( callback ) {

		const index = this.pluginCallbacks.indexOf( callback );
		if ( index !== - 1 ) this.pluginCallbacks.splice( index, 1 );
		return this;

	}

	parse( data, path, onLoad, onError ) {

		let json, body = null;

		try {

			if ( typeof data === 'string' ) {

				json = JSON.parse( data );

			} else if ( data instanceof ArrayBuffer && new DataView( data ).getUint32( 0, true ) === BINARY_MAGIC ) {

				( { json, body } = parseBinary( data ) );

			} else {

				json = JSON.parse( new TextDecoder().decode( data ) );

			}

		} catch ( error ) {

			if ( onError ) onError( error );
			return;

		}

		if ( json.asset === undefined || Number( json.asset.version?.[ 0 ] ) < 2 ) {

			if ( onError ) onError( new Error( 'WAMR3D: GLTFLoader: unsupported asset; glTF versions >= 2.0 are supported.' ) );
			return;

		}

		const decoders = { KHR_draco_mesh_compression: this.dracoLoader, KHR_texture_basisu: this.ktx2Loader, EXT_meshopt_compression: this.meshoptDecoder, KHR_meshopt_compression: this.meshoptDecoder };
		const missing = ( json.extensionsRequired ?? [] ).filter( ( name ) => name in decoders && ! decoders[ name ] );

		if ( missing.length > 0 ) {

			const setter = { KHR_draco_mesh_compression: 'setDRACOLoader', KHR_texture_basisu: 'setKTX2Loader' };
			if ( onError ) onError( new Error( `WAMR3D: GLTFLoader: ${missing.map( ( name ) => `${name} needs ${setter[ name ] ?? 'setMeshoptDecoder'}()` ).join( ', ' )}.` ) );
			return;

		}

		const parser = new GLTFParser( json, { path: path || this.resourcePath || '', crossOrigin: this.crossOrigin, requestHeader: this.requestHeader, manager: this.manager, body, dracoLoader: this.dracoLoader, ktx2Loader: this.ktx2Loader, meshoptDecoder: this.meshoptDecoder } );
		parser.parse( onLoad, onError );

	}

	parseAsync( data, path ) {

		return new Promise( ( resolve, reject ) => this.parse( data, path, resolve, reject ) );

	}

}

function parseBinary( data ) {

	const view = new DataView( data ), length = view.getUint32( 8, true );
	let offset = 12, json = null, body = null;

	while ( offset < length ) {

		const chunkLength = view.getUint32( offset, true ), chunkType = view.getUint32( offset + 4, true );
		offset += 8;
		if ( chunkType === CHUNK_JSON ) json = JSON.parse( new TextDecoder().decode( new Uint8Array( data, offset, chunkLength ) ) );
		else if ( chunkType === CHUNK_BIN ) body = data.slice( offset, offset + chunkLength );
		offset += chunkLength;

	}

	if ( json === null ) throw new Error( 'WAMR3D: GLTFLoader: JSON content not found.' );
	return { json, body };

}

// ---------------------------------------------------------------- parser

class GLTFParser {

	constructor( json, options ) {

		this.json = json;
		this.options = options;
		this.extensions = {};
		this.plugins = {};
		this.cache = new Map();
		this.associations = new Map();
		this.uniqueNames = {};
		this.nodeObjects = [];
		this.textureLoader = new ImageBitmapLoader( options.manager );
		this.textureLoader.setOptions( { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } );
		this.textureLoader.setCrossOrigin( options.crossOrigin );
		this.textureLoader.setRequestHeader( options.requestHeader );

	}

	cached( key, create ) {

		if ( ! this.cache.has( key ) ) this.cache.set( key, create() );
		return this.cache.get( key );

	}

	async parse( onLoad, onError ) {

		try {

			const json = this.json;
			// joints become bones, meshes that are skinned become skinned meshes
			this.markDefs();
			const scenes = await Promise.all( ( json.scenes ?? [] ).map( ( _, i ) => this.getDependency( 'scene', i ) ) );
			const animations = await Promise.all( ( json.animations ?? [] ).map( ( _, i ) => this.getDependency( 'animation', i ) ) );
			const cameras = await Promise.all( ( json.cameras ?? [] ).map( ( _, i ) => this.getDependency( 'camera', i ) ) );
			const scene = scenes[ json.scene ?? 0 ] ?? scenes[ 0 ] ?? new Group();
			const result = { scene, scenes, animations, cameras, asset: json.asset, parser: this, userData: {} };
			if ( json.extras ) result.userData = json.extras;
			onLoad( result );

		} catch ( error ) {

			if ( onError ) onError( error );
			else console.error( error );

		}

	}

	markDefs() {

		const json = this.json;
		this.joints = new Set();
		this.skinnedMeshes = new Set();
		for ( const skin of json.skins ?? [] ) for ( const joint of skin.joints ) this.joints.add( joint );
		for ( const node of json.nodes ?? [] ) if ( node.mesh !== undefined && node.skin !== undefined ) this.skinnedMeshes.add( node.mesh );

	}

	getDependency( type, index ) {

		return this.cached( type + ':' + index, () => {

			switch ( type ) {

				case 'scene': return this.loadScene( index );
				case 'node': return this.loadNode( index );
				case 'mesh': return this.loadMesh( index );
				case 'accessor': return this.loadAccessor( index );
				case 'bufferView': return this.loadBufferView( index );
				case 'buffer': return this.loadBuffer( index );
				case 'material': return this.loadMaterial( index );
				case 'texture': return this.loadTexture( index );
				case 'skin': return this.loadSkin( index );
				case 'animation': return this.loadAnimation( index );
				case 'camera': return this.loadCamera( index );
				default: throw new Error( 'WAMR3D: GLTFLoader: unknown type ' + type );

			}

		} );

	}

	createUniqueName( original ) {

		const sanitized = PropertyBinding.sanitizeNodeName( original || '' );

		if ( sanitized in this.uniqueNames ) {

			return sanitized + '_' + ( ++ this.uniqueNames[ sanitized ] );

		}

		this.uniqueNames[ sanitized ] = 0;
		return sanitized;

	}

	// ---------------------------------------------------------------- data

	async loadBuffer( index ) {

		const definition = this.json.buffers[ index ];
		const meshopt = definition.extensions?.EXT_meshopt_compression ?? definition.extensions?.KHR_meshopt_compression;
		// a fallback buffer of meshopt data is never read when the decoder is set
		if ( meshopt?.fallback && this.options.meshoptDecoder ) return null;

		if ( definition.uri === undefined ) {

			if ( index === 0 && this.options.body ) return this.options.body;
			throw new Error( 'WAMR3D: GLTFLoader: buffer ' + index + ' is missing.' );

		}

		const url = LoaderUtils.resolveURL( definition.uri, this.options.path );
		const response = await fetch( url, { headers: this.options.requestHeader } );
		if ( ! response.ok ) throw new Error( `WAMR3D: GLTFLoader: failed to load buffer "${definition.uri}".` );
		return response.arrayBuffer();

	}

	async loadBufferView( index ) {

		const definition = this.json.bufferViews[ index ];
		const meshopt = definition.extensions?.EXT_meshopt_compression ?? definition.extensions?.KHR_meshopt_compression;
		if ( meshopt && this.options.meshoptDecoder ) return this.decodeMeshopt( meshopt );
		const buffer = await this.getDependency( 'buffer', definition.buffer );
		const offset = definition.byteOffset ?? 0;
		return buffer.slice( offset, offset + definition.byteLength );

	}

	async decodeMeshopt( extension ) {

		const decoder = this.options.meshoptDecoder;
		if ( decoder.supported === false ) throw new Error( 'WAMR3D: GLTFLoader: the meshopt decoder is not supported in this browser.' );
		await decoder.ready;
		const buffer = await this.getDependency( 'buffer', extension.buffer );
		const source = new Uint8Array( buffer, extension.byteOffset ?? 0, extension.byteLength );
		const { count, byteStride } = extension;

		if ( decoder.decodeGltfBufferAsync ) {

			const decoded = await decoder.decodeGltfBufferAsync( count, byteStride, source, extension.mode, extension.filter );
			return decoded.buffer.slice( decoded.byteOffset, decoded.byteOffset + decoded.byteLength );

		}

		const result = new Uint8Array( count * byteStride );
		decoder.decodeGltfBuffer( result, count, byteStride, source, extension.mode, extension.filter );
		return result.buffer;

	}

	async loadAccessor( index ) {

		const definition = this.json.accessors[ index ];
		const itemSize = TYPE_SIZES[ definition.type ], TypedArray = COMPONENT_TYPES[ definition.componentType ];
		const elementBytes = TypedArray.BYTES_PER_ELEMENT, itemBytes = elementBytes * itemSize;
		const normalized = definition.normalized === true;
		let attribute;

		if ( definition.bufferView === undefined ) {

			// all zeros, unless sparse values follow
			attribute = new BufferAttribute( new TypedArray( definition.count * itemSize ), itemSize, normalized );

		} else {

			const bufferView = await this.getDependency( 'bufferView', definition.bufferView );
			const byteStride = this.json.bufferViews[ definition.bufferView ].byteStride;
			const byteOffset = definition.byteOffset ?? 0;

			if ( byteStride && byteStride !== itemBytes ) {

				// interleaved: one InterleavedBuffer per bufferView and stride window
				const slice = Math.floor( byteOffset / byteStride );
				const key = 'interleaved:' + definition.bufferView + ':' + definition.componentType + ':' + slice + ':' + definition.count;
				const buffer = this.cached( key, () => new InterleavedBuffer( new TypedArray( bufferView, slice * byteStride, definition.count * byteStride / elementBytes ), byteStride / elementBytes ) );
				attribute = new InterleavedBufferAttribute( buffer, itemSize, ( byteOffset % byteStride ) / elementBytes, normalized );

			} else {

				attribute = new BufferAttribute( new TypedArray( bufferView, byteOffset, definition.count * itemSize ), itemSize, normalized );

			}

		}

		if ( definition.sparse !== undefined ) {

			const sparse = definition.sparse;
			const indicesView = await this.getDependency( 'bufferView', sparse.indices.bufferView );
			const valuesView = await this.getDependency( 'bufferView', sparse.values.bufferView );
			const indices = new COMPONENT_TYPES[ sparse.indices.componentType ]( indicesView, sparse.indices.byteOffset ?? 0, sparse.count );
			const values = new TypedArray( valuesView, sparse.values.byteOffset ?? 0, sparse.count * itemSize );
			// a copy, so that the shared buffer view is not changed
			const dense = new TypedArray( definition.count * itemSize );
			for ( let i = 0; i < definition.count; i ++ ) for ( let k = 0; k < itemSize; k ++ ) dense[ i * itemSize + k ] = attribute.isInterleavedBufferAttribute ? attribute.array[ i * attribute.data.stride + attribute.offset + k ] : attribute.array[ i * itemSize + k ];
			for ( let i = 0; i < indices.length; i ++ ) for ( let k = 0; k < itemSize; k ++ ) dense[ indices[ i ] * itemSize + k ] = values[ i * itemSize + k ];
			attribute = new BufferAttribute( dense, itemSize, normalized );

		}

		return attribute;

	}

}

// The methods in `gltf/` complete the class.
for ( const part of [ GLTFMaterials, GLTFMeshes, GLTFNodes, GLTFAnimation ] ) {

	for ( const name of Object.getOwnPropertyNames( part.prototype ) ) {

		if ( name !== 'constructor' ) Object.defineProperty( GLTFParser.prototype, name, Object.getOwnPropertyDescriptor( part.prototype, name ) );

	}

}

