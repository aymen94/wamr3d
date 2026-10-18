// zlib (RFC 1950) and raw DEFLATE (RFC 1951) decompression, synchronous, for loaders whose
// formats embed deflated data (EXR, FBX). Written from the RFCs.

const LENGTH_BASE = new Uint16Array( [ 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 ] );
const LENGTH_EXTRA = new Uint8Array( [ 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 ] );
const DISTANCE_BASE = new Uint16Array( [ 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577 ] );
const DISTANCE_EXTRA = new Uint8Array( [ 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 ] );
const CODE_LENGTH_ORDER = new Uint8Array( [ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ] );

// A canonical Huffman code as counts per length and symbols in code order.
function buildCode( lengths, offset, count ) {

	const counts = new Uint16Array( 16 ), symbols = new Uint16Array( count ), offsets = new Uint16Array( 16 );
	for ( let i = 0; i < count; i ++ ) counts[ lengths[ offset + i ] ] ++;
	counts[ 0 ] = 0;
	for ( let i = 1; i < 16; i ++ ) offsets[ i ] = offsets[ i - 1 ] + counts[ i - 1 ];
	for ( let i = 0; i < count; i ++ ) if ( lengths[ offset + i ] ) symbols[ offsets[ lengths[ offset + i ] ] ++ ] = i;
	return { counts, symbols };

}

let fixedLiterals = null, fixedDistances = null;

function fixedCodes() {

	if ( fixedLiterals ) return;
	const lengths = new Uint8Array( 320 );
	for ( let i = 0; i < 144; i ++ ) lengths[ i ] = 8;
	for ( let i = 144; i < 256; i ++ ) lengths[ i ] = 9;
	for ( let i = 256; i < 280; i ++ ) lengths[ i ] = 7;
	for ( let i = 280; i < 288; i ++ ) lengths[ i ] = 8;
	for ( let i = 288; i < 320; i ++ ) lengths[ i ] = 5;
	fixedLiterals = buildCode( lengths, 0, 288 );
	fixedDistances = buildCode( lengths, 288, 32 );

}

class Inflater {

	constructor( input, size ) {

		this.input = input;
		this.position = 0;
		this.bitBuffer = 0;
		this.bitCount = 0;
		this.output = new Uint8Array( size > 0 ? size : Math.max( 1024, input.length * 4 ) );
		this.length = 0;

	}

	bits( count ) {

		while ( this.bitCount < count ) {

			if ( this.position >= this.input.length ) throw new Error( 'WAMR3D: inflate: unexpected end of data.' );
			this.bitBuffer |= this.input[ this.position ++ ] << this.bitCount;
			this.bitCount += 8;

		}

		const value = this.bitBuffer & ( ( 1 << count ) - 1 );
		this.bitBuffer >>>= count;
		this.bitCount -= count;
		return value;

	}

	// Codes are read bit by bit, most significant first, against the canonical counts.
	symbol( code ) {

		let value = 0, first = 0, index = 0;

		for ( let length = 1; length < 16; length ++ ) {

			value |= this.bits( 1 );
			const count = code.counts[ length ];
			if ( value - first < count ) return code.symbols[ index + value - first ];
			index += count;
			first = ( first + count ) << 1;
			value <<= 1;

		}

		throw new Error( 'WAMR3D: inflate: invalid Huffman code.' );

	}

	reserve( extra ) {

		if ( this.length + extra <= this.output.length ) return;
		const grown = new Uint8Array( Math.max( this.output.length * 2, this.length + extra ) );
		grown.set( this.output.subarray( 0, this.length ) );
		this.output = grown;

	}

	stored() {

		this.bitBuffer = 0;
		this.bitCount = 0;
		const input = this.input, at = this.position;
		const length = input[ at ] | ( input[ at + 1 ] << 8 );
		this.position = at + 4;
		this.reserve( length );
		this.output.set( input.subarray( this.position, this.position + length ), this.length );
		this.length += length;
		this.position += length;

	}

	dynamicCodes() {

		const literalCount = this.bits( 5 ) + 257, distanceCount = this.bits( 5 ) + 1, lengthCount = this.bits( 4 ) + 4;
		const lengths = new Uint8Array( 320 );
		for ( let i = 0; i < lengthCount; i ++ ) lengths[ CODE_LENGTH_ORDER[ i ] ] = this.bits( 3 );
		const lengthCode = buildCode( lengths, 0, 19 );
		lengths.fill( 0 );
		let i = 0;

		while ( i < literalCount + distanceCount ) {

			const symbol = this.symbol( lengthCode );

			if ( symbol < 16 ) {

				lengths[ i ++ ] = symbol;

			} else {

				let repeat, value = 0;
				if ( symbol === 16 ) {

					if ( i === 0 ) throw new Error( 'WAMR3D: inflate: repeat without a previous length.' );
					value = lengths[ i - 1 ];
					repeat = 3 + this.bits( 2 );

				} else if ( symbol === 17 ) repeat = 3 + this.bits( 3 );
				else repeat = 11 + this.bits( 7 );

				while ( repeat -- ) lengths[ i ++ ] = value;

			}

		}

		const distances = new Uint8Array( 32 );
		distances.set( lengths.subarray( literalCount, literalCount + distanceCount ) );
		return [ buildCode( lengths, 0, literalCount ), buildCode( distances, 0, 32 ) ];

	}

	block( literals, distances ) {

		for ( ;; ) {

			const symbol = this.symbol( literals );

			if ( symbol < 256 ) {

				this.reserve( 1 );
				this.output[ this.length ++ ] = symbol;

			} else if ( symbol === 256 ) {

				return;

			} else {

				const lengthIndex = symbol - 257;
				const length = LENGTH_BASE[ lengthIndex ] + this.bits( LENGTH_EXTRA[ lengthIndex ] );
				const distanceIndex = this.symbol( distances );
				const distance = DISTANCE_BASE[ distanceIndex ] + this.bits( DISTANCE_EXTRA[ distanceIndex ] );
				if ( distance > this.length ) throw new Error( 'WAMR3D: inflate: distance beyond the output.' );
				this.reserve( length );
				const output = this.output;
				for ( let k = 0, from = this.length - distance; k < length; k ++ ) output[ this.length ++ ] = output[ from + k ];

			}

		}

	}

	run() {

		let last;

		do {

			last = this.bits( 1 );
			const type = this.bits( 2 );

			if ( type === 0 ) this.stored();
			else if ( type === 1 ) {

				fixedCodes();
				this.block( fixedLiterals, fixedDistances );

			} else if ( type === 2 ) this.block( ...this.dynamicCodes() );
			else throw new Error( 'WAMR3D: inflate: invalid block type.' );

		} while ( ! last );

		return this.output.length === this.length ? this.output : this.output.slice( 0, this.length );

	}

}

/** Raw DEFLATE data. `size`, when known, is the decompressed length. */
export function inflateRaw( input, size = 0 ) {

	return new Inflater( input, size ).run();

}

/** zlib data: a two-byte header, DEFLATE data and an Adler-32 checksum (not checked). */
export function unzlib( input, size = 0 ) {

	if ( ( input[ 0 ] & 0x0f ) !== 8 || ( ( input[ 0 ] << 8 ) | input[ 1 ] ) % 31 !== 0 ) throw new Error( 'WAMR3D: inflate: not zlib data.' );
	if ( input[ 1 ] & 0x20 ) throw new Error( 'WAMR3D: inflate: preset dictionaries are not supported.' );
	return inflateRaw( input.subarray( 2 ), size );

}
