// three.js add-on path: `three/addons/loaders/KTX2Loader.js`.
//
// KTX 2.0 textures (`.ktx2`, and glTF's KHR_texture_basisu), written from the container
// format. Basis Universal payloads (ETC1S/BasisLZ and UASTC) are transcoded by Binomial's
// transcoder, which the application serves as three.js's loader expects:
// `setTranscoderPath( path )` names the folder holding `basis_transcoder.js` and
// `basis_transcoder.wasm`. The engine samples uncompressed textures, so Basis payloads are
// transcoded to RGBA8 and mipmapped on the GPU. Uncompressed RGBA8, RGBA16F and RGBA32F
// payloads without supercompression are read without the transcoder.

import { DataTexture, FileLoader, FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Loader, RGBAFormat, SRGBColorSpace, UnsignedByteType } from '../../compat.js';

const IDENTIFIER = [ 0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A ];
const VK_FORMAT_UNDEFINED = 0;
const VK_FORMATS = {
	37: { type: UnsignedByteType, colorSpace: LinearSRGBColorSpace, bytes: 4 }, // R8G8B8A8_UNORM
	43: { type: UnsignedByteType, colorSpace: SRGBColorSpace, bytes: 4 }, // R8G8B8A8_SRGB
	97: { type: HalfFloatType, colorSpace: LinearSRGBColorSpace, bytes: 8 }, // R16G16B16A16_SFLOAT
	109: { type: FloatType, colorSpace: LinearSRGBColorSpace, bytes: 16 } // R32G32B32A32_SFLOAT
};
const SUPERCOMPRESSION_NONE = 0;
const TRANSFER_SRGB = 2;
// the transcoder's `transcoder_texture_format` for 32-bit RGBA
const BASIS_RGBA32 = 13;

export class KTX2Loader extends Loader {

	constructor( manager ) {

		super( manager );
		this.transcoderPath = '';
		this.transcoderPending = null;
		this.workerLimit = 4;

	}

	setTranscoderPath( path ) {

		this.transcoderPath = path;
		return this;

	}

	/** Kept for three.js compatibility: transcoding runs on the main thread. */
	setWorkerLimit( workerLimit ) {

		this.workerLimit = workerLimit;
		return this;

	}

	/** Kept for three.js compatibility: the engine draws uncompressed textures on every device. */
	detectSupport( /* renderer */ ) {

		return this;

	}

	async detectSupportAsync( renderer ) {

		return this.detectSupport( renderer );

	}

	init() {

		if ( this.transcoderPending ) return this.transcoderPending;
		const files = [ this._loadFile( 'basis_transcoder.js', 'text' ), this._loadFile( 'basis_transcoder.wasm', 'arraybuffer' ) ];

		this.transcoderPending = Promise.all( files ).then( ( [ source, wasmBinary ] ) => {

			// the transcoder's script defines `BASIS`, a factory returning a promise-like module
			const factory = new Function( source + '\nreturn BASIS;' )();
			return new Promise( ( resolve ) => {

				factory( { wasmBinary, onRuntimeInitialized() {} } ).then( ( basis ) => {

					basis.initializeBasis();
					resolve( { basis } );

				} );

			} ).then( ( { basis } ) => basis );

		} );

		return this.transcoderPending;

	}

	_loadFile( name, responseType ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.transcoderPath );
		loader.setResponseType( responseType );
		loader.setWithCredentials( this.withCredentials );
		return new Promise( ( resolve, reject ) => loader.load( name, resolve, undefined, reject ) );

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( buffer ) => this.parse( buffer, onLoad, onError ), onProgress, onError );

	}

	parse( buffer, onLoad, onError ) {

		this._createTexture( buffer ).then( ( texture ) => {

			if ( onLoad ) onLoad( texture );

		} ).catch( ( error ) => {

			if ( onError ) onError( error );
			else console.error( error );

		} );

	}

	async _createTexture( buffer ) {

		const header = readHeader( new Uint8Array( buffer ) );
		const { width, height, data, type, colorSpace } = header.vkFormat === VK_FORMAT_UNDEFINED ? await this._transcode( buffer, header ) : readUncompressed( buffer, header );
		const texture = new DataTexture( data, width, height, RGBAFormat, type );
		texture.colorSpace = colorSpace;
		texture.flipY = false;
		texture.magFilter = LinearFilter;
		texture.minFilter = type === UnsignedByteType ? LinearMipmapLinearFilter : LinearFilter;
		texture.generateMipmaps = type === UnsignedByteType;
		texture.needsUpdate = true;
		return texture;

	}

	async _transcode( buffer, header ) {

		const basis = await this.init();
		const file = new basis.KTX2File( new Uint8Array( buffer ) );

		try {

			if ( ! file.isValid() ) throw new Error( 'WAMR3D: KTX2Loader: invalid or unsupported .ktx2 file.' );
			if ( ! file.startTranscoding() ) throw new Error( 'WAMR3D: KTX2Loader: startTranscoding failed.' );
			const width = file.getWidth(), height = file.getHeight();
			const size = file.getImageTranscodedSizeInBytes( 0, 0, 0, BASIS_RGBA32 );
			const data = new Uint8Array( size );
			if ( ! file.transcodeImage( data, 0, 0, 0, BASIS_RGBA32, 0, - 1, - 1 ) ) throw new Error( 'WAMR3D: KTX2Loader: transcodeImage failed.' );
			return { width, height, data, type: UnsignedByteType, colorSpace: header.transfer === TRANSFER_SRGB ? SRGBColorSpace : LinearSRGBColorSpace };

		} finally {

			file.close();
			file.delete();

		}

	}

	dispose() {

		this.transcoderPending = null;
		return this;

	}

}

function readHeader( bytes ) {

	for ( let i = 0; i < IDENTIFIER.length; i ++ ) if ( bytes[ i ] !== IDENTIFIER[ i ] ) throw new Error( 'WAMR3D: KTX2Loader: missing KTX 2.0 identifier.' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const header = {
		vkFormat: view.getUint32( 12, true ),
		width: view.getUint32( 20, true ),
		height: Math.max( 1, view.getUint32( 24, true ) ),
		depth: view.getUint32( 28, true ),
		layers: view.getUint32( 32, true ),
		faces: view.getUint32( 36, true ),
		levels: Math.max( 1, view.getUint32( 40, true ) ),
		supercompression: view.getUint32( 44, true ),
		transfer: 0
	};
	const dfdOffset = view.getUint32( 48, true ), dfdLength = view.getUint32( 52, true );

	// the basic data format descriptor block: total size, then the block header, then
	// colour model, primaries, transfer function and flags
	if ( dfdLength >= 16 ) header.transfer = bytes[ dfdOffset + 14 ];

	if ( header.depth > 1 || header.layers > 1 || header.faces > 1 ) throw new Error( 'WAMR3D: KTX2Loader: array, cube and 3D textures are not supported.' );
	// level 0 is the first entry of the level index
	header.level0 = { offset: Number( view.getBigUint64( 80, true ) ), length: Number( view.getBigUint64( 88, true ) ) };
	return header;

}

function readUncompressed( buffer, header ) {

	const format = VK_FORMATS[ header.vkFormat ];
	if ( ! format ) throw new Error( 'WAMR3D: KTX2Loader: unsupported vkFormat ' + header.vkFormat + '.' );
	if ( header.supercompression !== SUPERCOMPRESSION_NONE ) throw new Error( 'WAMR3D: KTX2Loader: supercompressed (Zstandard or ZLIB) uncompressed formats are not supported.' );
	const { width, height } = header, bytes = buffer.slice( header.level0.offset, header.level0.offset + width * height * format.bytes );
	const data = format.type === FloatType ? new Float32Array( bytes ) : format.type === HalfFloatType ? new Uint16Array( bytes ) : new Uint8Array( bytes );
	return { width, height, data, type: format.type, colorSpace: format.colorSpace };

}
