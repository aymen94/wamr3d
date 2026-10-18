// OpenEXR block decompressors other than PIZ: RLE, ZIPS/ZIP, PXR24 and B44/B44A. Each
// returns the block's bytes in scanline layout (line by line, each channel's values).
// Written from the OpenEXR file format.
//
// Part of the EXRLoader add-on (`../EXRLoader.js`).

import { unzlib } from '../lib/inflate.js';

const HALF = 1, FLOAT = 2;

// RLE and ZIP store bytes split into two halves (even, then odd positions) and coded as
// differences from the previous byte.
function predictAndInterleave( source ) {

	for ( let i = 1; i < source.length; i ++ ) source[ i ] = ( source[ i - 1 ] + source[ i ] - 128 ) & 0xff;
	const out = new Uint8Array( source.length ), half = ( source.length + 1 ) >> 1;

	for ( let i = 0, a = 0, b = half; i < source.length; i ++ ) out[ i ] = i & 1 ? source[ b ++ ] : source[ a ++ ];
	return out;

}

export function decompressRLE( bytes, position, length, size ) {

	const out = new Uint8Array( size );
	let at = position, o = 0;
	const end = position + length;

	while ( at < end && o < size ) {

		const count = ( bytes[ at ++ ] << 24 ) >> 24;

		if ( count < 0 ) {

			out.set( bytes.subarray( at, at - count ), o );
			o -= count;
			at -= count;

		} else {

			out.fill( bytes[ at ++ ], o, o + count + 1 );
			o += count + 1;

		}

	}

	return predictAndInterleave( out );

}

export function decompressZIP( bytes, position, length, size ) {

	return predictAndInterleave( unzlib( bytes.subarray( position, position + length ), size ) );

}

// PXR24: deflated planes of the values' bytes per line and channel, most significant
// first, each value the difference from the previous one; floats keep 24 bits.
export function decompressPXR24( bytes, position, length, channels, lines ) {

	let total = 0;
	for ( const channel of channels ) total += channel.width * lines * ( channel.type === HALF ? 2 : 4 );
	const source = unzlib( bytes.subarray( position, position + length ) );
	const out = new Uint8Array( total ), view = new DataView( out.buffer );
	let at = 0, o = 0;

	for ( let y = 0; y < lines; y ++ ) {

		for ( const channel of channels ) {

			const n = channel.width;

			if ( channel.type === HALF ) {

				let pixel = 0;

				for ( let x = 0; x < n; x ++ ) {

					pixel = ( pixel + ( ( source[ at + x ] << 8 ) | source[ at + n + x ] ) ) & 0xffff;
					view.setUint16( o, pixel, true );
					o += 2;

				}

				at += 2 * n;

			} else {

				const planes = channel.type === FLOAT ? 3 : 4;
				let pixel = 0;

				for ( let x = 0; x < n; x ++ ) {

					let difference = ( source[ at + x ] << 24 ) | ( source[ at + n + x ] << 16 ) | ( source[ at + 2 * n + x ] << 8 );
					if ( planes === 4 ) difference |= source[ at + 3 * n + x ];
					pixel = ( pixel + difference ) | 0;
					view.setUint32( o, pixel >>> 0, true );
					o += 4;

				}

				at += planes * n;

			}

		}

	}

	return out;

}

// One 4 x 4 block of halves: 3 bytes when flat, else 14 bytes of a start value, a shift
// and fifteen 6-bit differences, the values mapped to an ordered form.
function unpackB44( bytes, at, s ) {

	if ( bytes[ at + 2 ] >= ( 13 << 2 ) ) {

		s.fill( ( bytes[ at ] << 8 ) | bytes[ at + 1 ] );
		s.flat = true;

	} else {

		const b = ( i ) => bytes[ at + i ];
		const shift = b( 2 ) >> 2, bias = 0x20 << shift;
		const d = ( v ) => ( v & 0x3f ) << shift;
		s[ 0 ] = ( b( 0 ) << 8 ) | b( 1 );
		s[ 4 ] = s[ 0 ] + d( ( b( 2 ) << 4 ) | ( b( 3 ) >> 4 ) ) - bias;
		s[ 8 ] = s[ 4 ] + d( ( b( 3 ) << 2 ) | ( b( 4 ) >> 6 ) ) - bias;
		s[ 12 ] = s[ 8 ] + d( b( 4 ) ) - bias;
		s[ 1 ] = s[ 0 ] + d( b( 5 ) >> 2 ) - bias;
		s[ 5 ] = s[ 4 ] + d( ( b( 5 ) << 4 ) | ( b( 6 ) >> 4 ) ) - bias;
		s[ 9 ] = s[ 8 ] + d( ( b( 6 ) << 2 ) | ( b( 7 ) >> 6 ) ) - bias;
		s[ 13 ] = s[ 12 ] + d( b( 7 ) ) - bias;
		s[ 2 ] = s[ 1 ] + d( b( 8 ) >> 2 ) - bias;
		s[ 6 ] = s[ 5 ] + d( ( b( 8 ) << 4 ) | ( b( 9 ) >> 4 ) ) - bias;
		s[ 10 ] = s[ 9 ] + d( ( b( 9 ) << 2 ) | ( b( 10 ) >> 6 ) ) - bias;
		s[ 14 ] = s[ 13 ] + d( b( 10 ) ) - bias;
		s[ 3 ] = s[ 2 ] + d( b( 11 ) >> 2 ) - bias;
		s[ 7 ] = s[ 6 ] + d( ( b( 11 ) << 4 ) | ( b( 12 ) >> 4 ) ) - bias;
		s[ 11 ] = s[ 10 ] + d( ( b( 12 ) << 2 ) | ( b( 13 ) >> 6 ) ) - bias;
		s[ 15 ] = s[ 14 ] + d( b( 13 ) ) - bias;
		s.flat = false;

	}

	for ( let i = 0; i < 16; i ++ ) s[ i ] = s[ i ] & 0x8000 ? s[ i ] & 0x7fff : ~ s[ i ] & 0xffff;

}

export function decompressB44( bytes, position, channels, lines ) {

	const planes = [];
	let at = position, total = 0;
	const s = new Uint16Array( 16 );

	for ( const channel of channels ) {

		const n = channel.width;

		if ( channel.type !== HALF ) {

			// stored as they are
			const plane = bytes.slice( at, at + n * lines * 4 );
			at += n * lines * 4;
			planes.push( plane );
			total += plane.length;
			continue;

		}

		const plane = new Uint16Array( n * lines );

		for ( let by = 0; by < lines; by += 4 ) {

			for ( let bx = 0; bx < n; bx += 4 ) {

				unpackB44( bytes, at, s );
				at += s.flat ? 3 : 14;

				for ( let y = 0; y < 4 && by + y < lines; y ++ ) {

					for ( let x = 0; x < 4 && bx + x < n; x ++ ) plane[ ( by + y ) * n + bx + x ] = s[ y * 4 + x ];

				}

			}

		}

		const planeBytes = new Uint8Array( plane.buffer );
		planes.push( planeBytes );
		total += planeBytes.length;

	}

	const out = new Uint8Array( total );
	let o = 0;

	for ( let y = 0; y < lines; y ++ ) {

		channels.forEach( ( channel, c ) => {

			const lineBytes = channel.width * ( channel.type === HALF ? 2 : 4 );
			out.set( planes[ c ].subarray( y * lineBytes, ( y + 1 ) * lineBytes ), o );
			o += lineBytes;

		} );

	}

	return out;

}
