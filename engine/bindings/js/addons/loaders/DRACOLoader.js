// three.js add-on path: `three/addons/loaders/DRACOLoader.js`.
//
// Draco-compressed geometry (`.drc` files and glTF's KHR_draco_mesh_compression) into a
// BufferGeometry, decoded by Google's Draco decoder, which the application serves as
// three.js's loader expects: `setDecoderPath( path )` names the folder holding
// `draco_wasm_wrapper.js` and `draco_decoder.wasm` (or `draco_decoder.js` with
// `setDecoderConfig( { type: 'js' } )`). The decoder runs on the main thread, once loaded.

import { BufferAttribute, BufferGeometry, Color, FileLoader, Loader, LinearSRGBColorSpace, SRGBColorSpace } from '../../compat.js';

const DEFAULT_ATTRIBUTE_IDS = { position: 'POSITION', normal: 'NORMAL', color: 'COLOR', uv: 'TEX_COORD' };
const DEFAULT_ATTRIBUTE_TYPES = { position: 'Float32Array', normal: 'Float32Array', color: 'Float32Array', uv: 'Float32Array' };
const ARRAY_TYPES = { Float32Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array };

export class DRACOLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.decoderPath = '';
		this.decoderConfig = {};
		this.decoderBinary = null;
		this.decoderPending = null;
		this.workerLimit = 4;
		this.defaultAttributeIDs = { ...DEFAULT_ATTRIBUTE_IDS };
		this.defaultAttributeTypes = { ...DEFAULT_ATTRIBUTE_TYPES };

	}

	setDecoderPath( path ) {

		this.decoderPath = path;
		return this;

	}

	setDecoderConfig( config ) {

		this.decoderConfig = config;
		return this;

	}

	/** Kept for three.js compatibility: decoding runs on the main thread. */
	setWorkerLimit( workerLimit ) {

		this.workerLimit = workerLimit;
		return this;

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( buffer ) => this.parse( buffer, onLoad, onError ), onProgress, onError );

	}

	parse( buffer, onLoad, onError = () => {} ) {

		this.decodeDracoFile( buffer, onLoad, null, null, SRGBColorSpace, onError ).catch( onError );

	}

	decodeDracoFile( buffer, callback, attributeIDs, attributeTypes, vertexColorSpace = LinearSRGBColorSpace, onError = () => {} ) {

		const config = {
			attributeIDs: attributeIDs || this.defaultAttributeIDs,
			attributeTypes: attributeTypes || this.defaultAttributeTypes,
			useUniqueIDs: !! attributeIDs,
			vertexColorSpace
		};
		return this.decodeGeometry( buffer, config ).then( callback ).catch( onError );

	}

	async decodeGeometry( buffer, config ) {

		const draco = await this._initDecoder();
		return buildGeometry( decode( draco, buffer, config ), config );

	}

	/** Starts loading the decoder; `decodeGeometry` waits for it. */
	preload() {

		this._initDecoder();
		return this;

	}

	_initDecoder() {

		if ( this.decoderPending ) return this.decoderPending;
		const useJS = typeof WebAssembly !== 'object' || this.decoderConfig.type === 'js';
		const files = useJS ? [ this._loadFile( 'draco_decoder.js', 'text' ) ] : [ this._loadFile( 'draco_wasm_wrapper.js', 'text' ), this._loadFile( 'draco_decoder.wasm', 'arraybuffer' ) ];

		this.decoderPending = Promise.all( files ).then( ( [ source, wasm ] ) => {

			// the decoder's script defines `DracoDecoderModule`, a factory taking emscripten options
			const factory = new Function( source + '\nreturn DracoDecoderModule;' )();
			const options = { ...this.decoderConfig };
			if ( wasm ) options.wasmBinary = wasm;
			return new Promise( ( resolve ) => {

				options.onModuleLoaded = ( draco ) => resolve( { draco } );
				factory( options );

			} ).then( ( { draco } ) => draco );

		} );

		return this.decoderPending;

	}

	_loadFile( name, responseType ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.decoderPath );
		loader.setResponseType( responseType );
		loader.setWithCredentials( this.withCredentials );
		return new Promise( ( resolve, reject ) => loader.load( name, resolve, undefined, reject ) );

	}

	dispose() {

		this.decoderPending = null;
		return this;

	}

}

// Decodes one Draco buffer into plain arrays: { index, attributes: [ { name, array, itemSize } ] }.
function decode( draco, buffer, config ) {

	const array = new Int8Array( buffer );
	const decoder = new draco.Decoder();
	let geometry = null;

	try {

		const type = decoder.GetEncodedGeometryType( array );
		let status;

		if ( type === draco.TRIANGULAR_MESH ) {

			geometry = new draco.Mesh();
			status = decoder.DecodeArrayToMesh( array, array.byteLength, geometry );

		} else if ( type === draco.POINT_CLOUD ) {

			geometry = new draco.PointCloud();
			status = decoder.DecodeArrayToPointCloud( array, array.byteLength, geometry );

		} else {

			throw new Error( 'WAMR3D: DRACOLoader: unexpected geometry type.' );

		}

		if ( ! status.ok() || geometry.ptr === 0 ) throw new Error( 'WAMR3D: DRACOLoader: decoding failed: ' + status.error_msg() );

		const result = { index: null, attributes: [] };

		for ( const name in config.attributeIDs ) {

			const ArrayType = ARRAY_TYPES[ config.attributeTypes[ name ] ] ?? Float32Array;
			let attribute;

			if ( config.useUniqueIDs ) {

				attribute = decoder.GetAttributeByUniqueId( geometry, config.attributeIDs[ name ] );

			} else {

				const id = decoder.GetAttributeId( geometry, draco[ config.attributeIDs[ name ] ] );
				if ( id === - 1 ) continue;
				attribute = decoder.GetAttribute( geometry, id );

			}

			const entry = decodeAttribute( draco, decoder, geometry, name, ArrayType, attribute );
			if ( name === 'color' ) entry.vertexColorSpace = config.vertexColorSpace;
			result.attributes.push( entry );

		}

		if ( type === draco.TRIANGULAR_MESH ) {

			const count = geometry.num_faces() * 3, bytes = count * 4;
			const pointer = draco._malloc( bytes );
			decoder.GetTrianglesUInt32Array( geometry, bytes, pointer );
			result.index = new Uint32Array( draco.HEAPF32.buffer, pointer, count ).slice();
			draco._free( pointer );

		}

		return result;

	} finally {

		if ( geometry ) draco.destroy( geometry );
		draco.destroy( decoder );

	}

}

function decodeAttribute( draco, decoder, geometry, name, ArrayType, attribute ) {

	const itemSize = attribute.num_components(), count = geometry.num_points() * itemSize;
	const bytes = count * ArrayType.BYTES_PER_ELEMENT;
	const dataType = {
		Float32Array: draco.DT_FLOAT32, Int8Array: draco.DT_INT8, Int16Array: draco.DT_INT16, Int32Array: draco.DT_INT32,
		Uint8Array: draco.DT_UINT8, Uint16Array: draco.DT_UINT16, Uint32Array: draco.DT_UINT32
	}[ ArrayType.name ];
	const pointer = draco._malloc( bytes );
	decoder.GetAttributeDataArrayForAllPoints( geometry, attribute, dataType, bytes, pointer );
	const array = new ArrayType( draco.HEAPF32.buffer, pointer, count ).slice();
	draco._free( pointer );
	return { name, array, itemSize };

}

function buildGeometry( data, config ) {

	const geometry = new BufferGeometry();
	if ( data.index ) geometry.setIndex( new BufferAttribute( data.index, 1 ) );

	for ( const entry of data.attributes ) {

		const attribute = new BufferAttribute( entry.array, entry.itemSize );
		if ( entry.name === 'color' ) toWorkingColorSpace( attribute, entry.vertexColorSpace );
		geometry.setAttribute( entry.name, attribute );

	}

	return geometry;

}

// Draco files store vertex colours as authored (sRGB for `.drc` files); the working colour
// space is linear.
const color = new Color();

function toWorkingColorSpace( attribute, colorSpace ) {

	if ( colorSpace !== SRGBColorSpace || ! ( attribute.array instanceof Float32Array ) ) return;

	for ( let i = 0; i < attribute.count; i ++ ) {

		color.fromBufferAttribute( attribute, i );
		color.setRGB( color.r, color.g, color.b, SRGBColorSpace );
		attribute.setXYZ( i, color.r, color.g, color.b );

	}

}
