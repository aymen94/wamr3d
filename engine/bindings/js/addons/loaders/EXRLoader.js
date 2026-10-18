// three.js add-on path: `three/addons/loaders/EXRLoader.js`.
//
// OpenEXR images (`.exr`) as float data textures, written from the OpenEXR file format:
// single-part scanline files with half, float or uint channels, uncompressed or with RLE,
// ZIPS, ZIP, PIZ, PXR24, B44 or B44A compression. R, G, B and A channels (or Y for
// luminance) become RGBA of `type` HalfFloatType (default) or FloatType; a missing alpha
// is 1. Tiled, multi-part and deep files and the lossy DWAA/DWAB compression are rejected.

import { DataTextureLoader, DataUtils, FloatType, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from '../../compat.js';
import { decompressB44, decompressPXR24, decompressRLE, decompressZIP } from './exr/compression.js';
import { decompressPIZ } from './exr/piz.js';

const MAGIC = 20000630;
const HALF = 1, FLOAT = 2;
const COMPRESSIONS = [ 'NO_COMPRESSION', 'RLE_COMPRESSION', 'ZIPS_COMPRESSION', 'ZIP_COMPRESSION', 'PIZ_COMPRESSION', 'PXR24_COMPRESSION', 'B44_COMPRESSION', 'B44A_COMPRESSION', 'DWAA_COMPRESSION', 'DWAB_COMPRESSION' ];
const LINES_PER_BLOCK = [ 1, 1, 1, 16, 32, 16, 32, 32, 32, 256 ];

function fail( message ) {

	throw new Error( 'WAMR3D: EXRLoader: ' + message );

}

class Reader {

	constructor( buffer ) {

		this.bytes = new Uint8Array( buffer );
		this.view = new DataView( buffer );
		this.offset = 0;

	}

	string() {

		const end = this.bytes.indexOf( 0, this.offset );
		const text = new TextDecoder().decode( this.bytes.subarray( this.offset, end ) );
		this.offset = end + 1;
		return text;

	}

	int32() {

		const value = this.view.getInt32( this.offset, true );
		this.offset += 4;
		return value;

	}

	uint32() {

		const value = this.view.getUint32( this.offset, true );
		this.offset += 4;
		return value;

	}

	uint8() {

		return this.bytes[ this.offset ++ ];

	}

	float32() {

		const value = this.view.getFloat32( this.offset, true );
		this.offset += 4;
		return value;

	}

	uint64() {

		const value = Number( this.view.getBigUint64( this.offset, true ) );
		this.offset += 8;
		return value;

	}

}

function readAttribute( reader, type, size ) {

	const start = reader.offset;
	let value;

	switch ( type ) {

		case 'string': value = new TextDecoder().decode( reader.bytes.subarray( start, start + size ) ); break;
		case 'int': value = reader.int32(); break;
		case 'float': value = reader.float32(); break;
		case 'compression': value = COMPRESSIONS[ reader.uint8() ]; break;
		case 'lineOrder': value = [ 'INCREASING_Y', 'DECREASING_Y', 'RANDOM_Y' ][ reader.uint8() ]; break;
		case 'box2i': value = { xMin: reader.int32(), yMin: reader.int32(), xMax: reader.int32(), yMax: reader.int32() }; break;
		case 'v2f': value = [ reader.float32(), reader.float32() ]; break;
		case 'v3f': value = [ reader.float32(), reader.float32(), reader.float32() ]; break;
		case 'chlist': {

			value = [];

			while ( reader.bytes[ reader.offset ] !== 0 ) {

				const name = reader.string(), pixelType = reader.int32(), pLinear = reader.uint8();
				reader.offset += 3;
				const xSampling = reader.int32(), ySampling = reader.int32();
				value.push( { name, pixelType, pLinear, xSampling, ySampling } );

			}

			break;

		}

		default: value = reader.bytes.slice( start, start + size );

	}

	reader.offset = start + size;
	return value;

}

function readHeader( reader ) {

	if ( reader.uint32() !== MAGIC ) fail( 'not an OpenEXR file (bad magic number)' );
	const version = reader.uint32();
	const flags = version >> 8;
	if ( flags & 0x02 ) fail( 'tiled images are not supported' );
	if ( flags & 0x08 ) fail( 'deep images are not supported' );
	if ( flags & 0x10 ) fail( 'multi-part files are not supported' );
	const header = { version: version & 0xff, spec: flags };

	for ( ;; ) {

		const name = reader.string();
		if ( name === '' ) break;
		const type = reader.string(), size = reader.uint32();
		header[ name ] = readAttribute( reader, type, size );

	}

	for ( const key of [ 'channels', 'compression', 'dataWindow' ] ) if ( header[ key ] === undefined ) fail( `missing the ${key} attribute` );
	return header;

}

const half = ( bits ) => DataUtils.fromHalfFloat( bits );

export class EXRLoader extends DataTextureLoader {

	constructor( manager ) {

		super( manager );
		this.type = HalfFloatType;
		this.outputFormat = RGBAFormat;

	}

	setDataType( value ) {

		this.type = value;
		return this;

	}

	setOutputFormat( value ) {

		this.outputFormat = value;
		return this;

	}

	parse( buffer ) {

		const reader = new Reader( buffer );
		const header = readHeader( reader );
		const compression = header.compression;
		const linesPerBlock = LINES_PER_BLOCK[ COMPRESSIONS.indexOf( compression ) ];
		if ( compression === 'DWAA_COMPRESSION' || compression === 'DWAB_COMPRESSION' ) fail( compression + ' is not supported' );
		const { xMin, yMin, xMax, yMax } = header.dataWindow;
		const width = xMax - xMin + 1, height = yMax - yMin + 1;
		const blocks = Math.ceil( height / linesPerBlock );
		// the offset table is skipped: blocks follow each other
		reader.offset += 8 * blocks;

		const channels = header.channels.map( ( c ) => ( { name: c.name, type: c.pixelType, width: Math.ceil( width / c.xSampling ), size: c.pixelType === HALF ? 1 : 2 } ) );
		if ( header.channels.some( ( c ) => c.xSampling !== 1 || c.ySampling !== 1 ) ) fail( 'subsampled channels are not supported' );
		const lineBytes = channels.reduce( ( sum, c ) => sum + c.width * ( c.type === HALF ? 2 : 4 ), 0 );

		// output channel per input channel: R, G, B, A, or Y as grey
		const targets = channels.map( ( c ) => {

			const name = c.name.split( '.' ).pop();
			return { R: [ 0 ], G: [ 1 ], B: [ 2 ], A: [ 3 ], Y: [ 0, 1, 2 ] }[ name ] ?? [];

		} );

		const isFloat = this.type === FloatType;
		if ( ! isFloat && this.type !== HalfFloatType ) fail( 'unsupported type ' + this.type );
		const data = isFloat ? new Float32Array( width * height * 4 ) : new Uint16Array( width * height * 4 );
		const one = isFloat ? 1 : DataUtils.toHalfFloat( 1 );
		if ( ! channels.some( ( c ) => c.name.split( '.' ).pop() === 'A' ) ) for ( let i = 3; i < data.length; i += 4 ) data[ i ] = one;

		for ( let b = 0; b < blocks; b ++ ) {

			const y = reader.int32(), size = reader.uint32(), position = reader.offset;
			reader.offset += size;
			const lines = Math.min( linesPerBlock, yMax - y + 1 );
			const expected = lines * lineBytes;
			let block;

			// a block that would not shrink is stored as it is
			if ( size === expected || compression === 'NO_COMPRESSION' ) block = reader.bytes.subarray( position, position + expected );
			else if ( compression === 'RLE_COMPRESSION' ) block = decompressRLE( reader.bytes, position, size, expected );
			else if ( compression === 'ZIPS_COMPRESSION' || compression === 'ZIP_COMPRESSION' ) block = decompressZIP( reader.bytes, position, size, expected );
			else if ( compression === 'PIZ_COMPRESSION' ) block = decompressPIZ( reader.bytes, position, size, channels, lines );
			else if ( compression === 'PXR24_COMPRESSION' ) block = decompressPXR24( reader.bytes, position, size, channels, lines );
			else block = decompressB44( reader.bytes, position, channels, lines );

			const view = new DataView( block.buffer, block.byteOffset, block.byteLength );
			let at = 0;

			for ( let line = 0; line < lines; line ++ ) {

				// rows bottom to top, as data textures hold them
				const row = height - 1 - ( y - yMin + line );

				channels.forEach( ( channel, c ) => {

					const outputs = targets[ c ];

					for ( let x = 0; x < channel.width; x ++ ) {

						let value;

						if ( channel.type === HALF ) {

							const bits = view.getUint16( at, true );
							at += 2;
							if ( outputs.length === 0 ) continue;
							value = isFloat ? half( bits ) : bits;

						} else {

							const v = channel.type === FLOAT ? view.getFloat32( at, true ) : view.getUint32( at, true );
							at += 4;
							if ( outputs.length === 0 ) continue;
							value = isFloat ? v : DataUtils.toHalfFloat( v );

						}

						const pixel = ( row * width + x ) * 4;
						for ( const o of outputs ) data[ pixel + o ] = value;

					}

				} );

			}

		}

		return { header, width, height, data, format: RGBAFormat, type: this.type, colorSpace: LinearSRGBColorSpace };

	}

	load( url, onLoad, onProgress, onError ) {

		return super.load( url, ( texture, data ) => {

			texture.colorSpace = LinearSRGBColorSpace;
			texture.minFilter = LinearFilter;
			texture.magFilter = LinearFilter;
			texture.generateMipmaps = false;
			texture.flipY = false;
			if ( onLoad ) onLoad( texture, data );

		}, onProgress, onError );

	}

}
