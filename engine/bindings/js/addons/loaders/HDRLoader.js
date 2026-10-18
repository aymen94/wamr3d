// three.js add-on path: `three/addons/loaders/HDRLoader.js`.
//
// Radiance HDR (`.hdr`, RGBE) images as float data textures, written from the format:
// a text header (`#?RADIANCE` or `#?RGBE`, `FORMAT=32-bit_rle_rgbe`, optional `GAMMA=`
// and `EXPOSURE=`, a blank line, then the resolution `-Y height +X width`), then the
// scanlines, run-length encoded per channel or stored flat. Each pixel is three 8-bit
// mantissas with a shared exponent: value = mantissa * 2^(exponent - 136).

import { DataTextureLoader, DataUtils, FloatType, HalfFloatType, LinearFilter, LinearSRGBColorSpace } from '../../compat.js';

const decoder = new TextDecoder();

function fail( message ) {

	throw new Error( 'WAMR3D: HDRLoader: ' + message );

}

// The header's lines up to and including the resolution line, and the offset after it.
function readHeader( bytes ) {

	let offset = 0;
	const line = () => {

		const end = bytes.indexOf( 10, offset );
		if ( end < 0 ) fail( 'unexpected end of the header' );
		const text = decoder.decode( bytes.subarray( offset, end ) );
		offset = end + 1;
		return text;

	};

	const first = line();
	if ( ! /^#\?(RADIANCE|RGBE)/.test( first ) ) fail( 'not a Radiance HDR file (bad signature)' );
	const header = { string: first + '\n', comments: '', format: '', gamma: 1, exposure: 1, width: 0, height: 0 };

	for ( ;; ) {

		const text = line();
		header.string += text + '\n';
		if ( text.startsWith( '#' ) ) {

			header.comments += text + '\n';
			continue;

		}

		let match;
		if ( ( match = /^\s*FORMAT=(\S+)\s*$/.exec( text ) ) ) header.format = match[ 1 ];
		else if ( ( match = /^\s*GAMMA=(\d+(\.\d+)?)\s*$/.exec( text ) ) ) header.gamma = parseFloat( match[ 1 ] );
		else if ( ( match = /^\s*EXPOSURE=\s*(\d+(\.\d+)?)\s*$/.exec( text ) ) ) header.exposure = parseFloat( match[ 1 ] );
		else if ( ( match = /^\s*-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec( text ) ) ) {

			header.height = parseInt( match[ 1 ], 10 );
			header.width = parseInt( match[ 2 ], 10 );
			break;

		}

	}

	if ( header.format !== '32-bit_rle_rgbe' && header.format !== '' ) fail( 'unsupported format ' + header.format );
	if ( ! header.width || ! header.height ) fail( 'missing image size' );
	return { header, offset };

}

// RGBE bytes of the whole image, top row first.
function readPixels( bytes, offset, width, height ) {

	const out = new Uint8Array( width * height * 4 );
	const flat = width < 8 || width > 0x7fff || bytes[ offset ] !== 2 || bytes[ offset + 1 ] !== 2 || bytes[ offset + 2 ] & 0x80;

	if ( flat ) {

		if ( bytes.length - offset < out.length ) fail( 'truncated pixel data' );
		out.set( bytes.subarray( offset, offset + out.length ) );
		return out;

	}

	const scanline = new Uint8Array( width * 4 );

	for ( let y = 0; y < height; y ++ ) {

		if ( offset + 4 > bytes.length ) fail( 'truncated pixel data' );
		if ( bytes[ offset ] !== 2 || bytes[ offset + 1 ] !== 2 || ( bytes[ offset + 2 ] << 8 | bytes[ offset + 3 ] ) !== width ) fail( 'bad scanline header' );
		offset += 4;

		// four runs, one per channel, each of `width` bytes
		for ( let channel = 0; channel < 4; channel ++ ) {

			let x = 0;
			const base = channel * width;

			while ( x < width ) {

				let count = bytes[ offset ++ ];

				if ( count > 128 ) {

					count -= 128;
					if ( x + count > width ) fail( 'bad run length' );
					scanline.fill( bytes[ offset ++ ], base + x, base + x + count );

				} else {

					if ( count === 0 || x + count > width ) fail( 'bad run length' );
					scanline.set( bytes.subarray( offset, offset + count ), base + x );
					offset += count;

				}

				x += count;

			}

		}

		const row = y * width * 4;
		for ( let x = 0; x < width; x ++ ) for ( let c = 0; c < 4; c ++ ) out[ row + x * 4 + c ] = scanline[ c * width + x ];

	}

	return out;

}

export class HDRLoader extends DataTextureLoader {

	constructor( manager ) {

		super( manager );
		this.type = HalfFloatType;

	}

	setDataType( value ) {

		this.type = value;
		return this;

	}

	parse( buffer ) {

		const bytes = new Uint8Array( buffer );
		const { header, offset } = readHeader( bytes );
		const { width, height } = header;
		const rgbe = readPixels( bytes, offset, width, height );
		const count = width * height;
		const data = this.type === FloatType ? new Float32Array( count * 4 ) : new Uint16Array( count * 4 );
		if ( this.type !== FloatType && this.type !== HalfFloatType ) fail( 'unsupported type ' + this.type );

		for ( let i = 0; i < count; i ++ ) {

			const e = rgbe[ i * 4 + 3 ], scale = e === 0 ? 0 : Math.pow( 2, e - 136 );

			for ( let c = 0; c < 3; c ++ ) {

				const value = rgbe[ i * 4 + c ] * scale;
				data[ i * 4 + c ] = this.type === FloatType ? value : DataUtils.toHalfFloat( value );

			}

			data[ i * 4 + 3 ] = this.type === FloatType ? 1 : DataUtils.toHalfFloat( 1 );

		}

		return { width, height, data, header: header.string, gamma: header.gamma, exposure: header.exposure, type: this.type };

	}

	load( url, onLoad, onProgress, onError ) {

		return super.load( url, ( texture, data ) => {

			texture.colorSpace = LinearSRGBColorSpace;
			texture.minFilter = LinearFilter;
			texture.magFilter = LinearFilter;
			texture.generateMipmaps = false;
			texture.flipY = true;
			if ( onLoad ) onLoad( texture, data );

		}, onProgress, onError );

	}

}
