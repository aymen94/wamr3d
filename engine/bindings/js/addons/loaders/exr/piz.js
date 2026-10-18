// PIZ decompression of OpenEXR blocks: a bitmap-compacted range of 16-bit values, Huffman
// coded with run lengths, then a 2D Haar wavelet per channel. Written from the OpenEXR
// file format and its PIZ description.
//
// Part of the EXRLoader add-on (`../EXRLoader.js`).

const USHORT_RANGE = 1 << 16;
const BITMAP_SIZE = USHORT_RANGE >> 3;
const HUF_ENCBITS = 16;
const HUF_DECBITS = 14;
const HUF_ENCSIZE = ( 1 << HUF_ENCBITS ) + 1;
const HUF_DECSIZE = 1 << HUF_DECBITS;
const HUF_DECMASK = HUF_DECSIZE - 1;
const SHORT_ZEROCODE_RUN = 59;
const LONG_ZEROCODE_RUN = 63;
const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;

function fail( message ) {

	throw new Error( 'WAMR3D: EXRLoader: PIZ: ' + message );

}

// Bit reader over bytes, most significant bit first. Code lengths reach 58 bits, so the
// buffer is kept as a Number below 2^53 and long reads use arithmetic.
class Bits {

	constructor( bytes, position ) {

		this.bytes = bytes;
		this.position = position;
		this.value = 0;
		this.count = 0;

	}

	readByte() {

		this.value = ( this.value % 2 ** this.count ) * 256 + this.bytes[ this.position ++ ];
		this.count += 8;

	}

	read( count ) {

		while ( this.count < count ) this.readByte();
		this.count -= count;
		return Math.floor( this.value / 2 ** this.count ) % 2 ** count;

	}

	peek( count ) {

		return Math.floor( this.value / 2 ** ( this.count - count ) ) % 2 ** count;

	}

}

// Code lengths, then canonical codes, as in the PIZ encoding table.
function unpackEncodingTable( bits, min, max, lengths ) {

	for ( ; min <= max; min ++ ) {

		const length = lengths[ min ] = bits.read( 6 );

		if ( length === LONG_ZEROCODE_RUN ) {

			let run = bits.read( 8 ) + SHORTEST_LONG_RUN;
			if ( min + run > max + 1 ) fail( 'table overrun' );
			while ( run -- ) lengths[ min ++ ] = 0;
			min --;

		} else if ( length >= SHORT_ZEROCODE_RUN ) {

			let run = length - SHORT_ZEROCODE_RUN + 2;
			if ( min + run > max + 1 ) fail( 'table overrun' );
			while ( run -- ) lengths[ min ++ ] = 0;
			min --;

		}

	}

	// canonical codes: the longest codes are numbered first
	const counts = new Array( 59 ).fill( 0 ), codes = new Float64Array( HUF_ENCSIZE );
	for ( let i = 0; i < HUF_ENCSIZE; i ++ ) counts[ lengths[ i ] ] ++;
	let code = 0;

	for ( let i = 58; i > 0; i -- ) {

		const next = ( code + counts[ i ] ) / 2;
		counts[ i ] = code;
		code = Math.floor( next );

	}

	for ( let i = 0; i < HUF_ENCSIZE; i ++ ) if ( lengths[ i ] > 0 ) codes[ i ] = counts[ lengths[ i ] ] ++;
	return codes;

}

// Codes up to 14 bits index a table directly; longer ones list their symbols under
// their first 14 bits.
function buildDecodingTable( lengths, codes, min, max ) {

	const table = { length: new Uint8Array( HUF_DECSIZE ), literal: new Int32Array( HUF_DECSIZE ), long: new Array( HUF_DECSIZE ) };

	for ( ; min <= max; min ++ ) {

		const length = lengths[ min ], code = codes[ min ];
		if ( length === 0 ) continue;
		if ( code >= 2 ** length ) fail( 'invalid code' );

		if ( length > HUF_DECBITS ) {

			const slot = Math.floor( code / 2 ** ( length - HUF_DECBITS ) );
			if ( table.length[ slot ] ) fail( 'invalid table entry' );
			( table.long[ slot ] ??= [] ).push( min );

		} else {

			const first = code * 2 ** ( HUF_DECBITS - length ), count = 2 ** ( HUF_DECBITS - length );

			for ( let i = first; i < first + count; i ++ ) {

				if ( table.length[ i ] || table.long[ i ] ) fail( 'invalid table entry' );
				table.length[ i ] = length;
				table.literal[ i ] = min;

			}

		}

	}

	return table;

}

function decodeHuffman( bytes, position, bitCount, lengths, codes, table, runCode, output ) {

	const bits = new Bits( bytes, position ), end = position + Math.ceil( bitCount / 8 );
	let written = 0;

	const emit = ( symbol ) => {

		if ( symbol === runCode ) {

			if ( bits.count < 8 ) bits.readByte();
			bits.count -= 8;
			let run = Math.floor( bits.value / 2 ** bits.count ) % 256;
			if ( written + run > output.length ) fail( 'run overflows the output' );
			const value = output[ written - 1 ];
			while ( run -- > 0 ) output[ written ++ ] = value;

		} else {

			if ( written >= output.length ) fail( 'too much data' );
			output[ written ++ ] = symbol;

		}

	};

	while ( bits.position < end ) {

		bits.readByte();

		while ( bits.count >= HUF_DECBITS ) {

			const slot = bits.peek( HUF_DECBITS ) & HUF_DECMASK;

			if ( table.length[ slot ] ) {

				bits.count -= table.length[ slot ];
				emit( table.literal[ slot ] );

			} else {

				const candidates = table.long[ slot ];
				if ( ! candidates ) fail( 'invalid code' );
				let found = false;

				for ( const symbol of candidates ) {

					const length = lengths[ symbol ];
					while ( bits.count < length && bits.position < end ) bits.readByte();

					if ( bits.count >= length && bits.peek( length ) === codes[ symbol ] ) {

						bits.count -= length;
						emit( symbol );
						found = true;
						break;

					}

				}

				if ( ! found ) fail( 'invalid code' );

			}

		}

	}

	// the bits past the end of the last code are padding
	const padding = ( 8 - bitCount ) & 7;
	bits.value = Math.floor( bits.value / 2 ** padding );
	bits.count -= padding;

	while ( bits.count > 0 ) {

		const slot = ( bits.value * 2 ** ( HUF_DECBITS - bits.count ) ) % HUF_DECSIZE;
		if ( ! table.length[ slot ] ) fail( 'invalid code' );
		bits.count -= table.length[ slot ];
		emit( table.literal[ slot ] );

	}

	if ( written !== output.length ) fail( 'not enough data' );

}

function decompressHuffman( bytes, position, length, output ) {

	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const min = view.getUint32( position, true ), max = view.getUint32( position + 4, true );
	const bitCount = view.getUint32( position + 12, true );
	if ( min >= HUF_ENCSIZE || max >= HUF_ENCSIZE ) fail( 'invalid table size' );
	const bits = new Bits( bytes, position + 20 ), lengths = new Uint8Array( HUF_ENCSIZE );
	const codes = unpackEncodingTable( bits, min, max, lengths );
	if ( bitCount > 8 * ( length - ( bits.position - position ) ) ) fail( 'not enough data' );
	const table = buildDecodingTable( lengths, codes, min, max );
	decodeHuffman( bytes, bits.position, bitCount, lengths, codes, table, max, output );

}

// ---------------------------------------------------------------- wavelet

function decode14( l, h, out, a, b ) {

	const ls = ( l << 16 ) >> 16, hs = ( h << 16 ) >> 16;
	const ai = ls + ( hs & 1 ) + ( hs >> 1 );
	out[ a ] = ai & 0xffff;
	out[ b ] = ( ai - hs ) & 0xffff;

}

function decode16( l, h, out, a, b ) {

	const bb = ( l - ( h >> 1 ) ) & 0xffff;
	out[ a ] = ( h + bb - 0x8000 ) & 0xffff;
	out[ b ] = bb;

}

// Inverse of the 2D Haar transform over `nx` x `ny` values `ox` and `oy` apart.
function waveletDecode( data, start, nx, ox, ny, oy, max ) {

	const decode = max < ( 1 << 14 ) ? decode14 : decode16;
	const pair = new Uint16Array( 4 );
	const n = Math.min( nx, ny );
	let p = 1;
	while ( p <= n ) p <<= 1;
	p >>= 1;
	let p2 = p;
	p >>= 1;

	while ( p >= 1 ) {

		let py = start;
		const ey = start + oy * ( ny - p2 );
		const oy1 = oy * p, oy2 = oy * p2, ox1 = ox * p, ox2 = ox * p2;

		for ( ; py <= ey; py += oy2 ) {

			let px = py;
			const ex = py + ox * ( nx - p2 );

			for ( ; px <= ex; px += ox2 ) {

				const p01 = px + ox1, p10 = px + oy1, p11 = p10 + ox1;
				decode( data[ px ], data[ p10 ], pair, 0, 1 );
				decode( data[ p01 ], data[ p11 ], pair, 2, 3 );
				decode( pair[ 0 ], pair[ 2 ], data, px, p01 );
				decode( pair[ 1 ], pair[ 3 ], data, p10, p11 );

			}

			if ( nx & p ) {

				const p10 = px + oy1;
				decode( data[ px ], data[ p10 ], pair, 0, 1 );
				data[ px ] = pair[ 0 ];
				data[ p10 ] = pair[ 1 ];

			}

		}

		if ( ny & p ) {

			let px = py;
			const ex = py + ox * ( nx - p2 );

			for ( ; px <= ex; px += ox2 ) {

				const p01 = px + ox1;
				decode( data[ px ], data[ p01 ], pair, 0, 1 );
				data[ px ] = pair[ 0 ];
				data[ p01 ] = pair[ 1 ];

			}

		}

		p2 = p;
		p >>= 1;

	}

}

/**
 * Decompresses one PIZ block of `lines` scanlines. `channels` have `size` (16-bit words
 * per value: 1 for half, 2 for float and uint) and `width` (values per line). Returns the
 * block's bytes in scanline layout.
 */
export function decompressPIZ( bytes, position, length, channels, lines ) {

	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const bitmap = new Uint8Array( BITMAP_SIZE );
	const minNonZero = view.getUint16( position, true ), maxNonZero = view.getUint16( position + 2, true );
	let at = position + 4;
	if ( maxNonZero >= BITMAP_SIZE ) fail( 'invalid bitmap size' );

	if ( minNonZero <= maxNonZero ) {

		bitmap.set( bytes.subarray( at, at + maxNonZero - minNonZero + 1 ), minNonZero );
		at += maxNonZero - minNonZero + 1;

	}

	// the values that occur, in order: the Huffman data indexes this table
	const lut = new Uint16Array( USHORT_RANGE );
	let k = 0;
	for ( let i = 0; i < USHORT_RANGE; i ++ ) if ( i === 0 || ( bitmap[ i >> 3 ] & ( 1 << ( i & 7 ) ) ) ) lut[ k ++ ] = i;
	const maxValue = k - 1;

	let total = 0;
	for ( const channel of channels ) total += channel.width * lines * channel.size;
	const data = new Uint16Array( total );
	const huffmanLength = view.getUint32( at, true );
	at += 4;
	decompressHuffman( bytes, at, Math.min( huffmanLength, length - ( at - position ) ), data );

	let offset = 0;

	for ( const channel of channels ) {

		for ( let j = 0; j < channel.size; j ++ ) waveletDecode( data, offset + j, channel.width, channel.size, lines, channel.width * channel.size, maxValue );
		offset += channel.width * lines * channel.size;

	}

	for ( let i = 0; i < total; i ++ ) data[ i ] = lut[ data[ i ] ];

	// channel planes back to scanlines: line by line, each channel's values
	const out = new Uint16Array( total );
	const starts = [];
	offset = 0;

	for ( const channel of channels ) {

		starts.push( offset );
		offset += channel.width * lines * channel.size;

	}

	let o = 0;

	for ( let y = 0; y < lines; y ++ ) {

		channels.forEach( ( channel, c ) => {

			const count = channel.width * channel.size;
			out.set( data.subarray( starts[ c ], starts[ c ] + count ), o );
			starts[ c ] += count;
			o += count;

		} );

	}

	return new Uint8Array( out.buffer );

}
