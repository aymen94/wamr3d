// FBX documents, binary and ASCII, into one tree of `{ name, props, children }` nodes.
// Arrays (binary array properties, ASCII `*N { a: ... }` blocks) become one typed-array
// property. 64-bit integers are Numbers when exact, else decimal strings (object ids).
//
// Part of the FBXLoader add-on (`../FBXLoader.js`).

import { unzlib } from '../lib/inflate.js';

const BINARY_MAGIC = 'Kaydara FBX Binary  \0';

export function isBinary( buffer ) {

	return buffer.byteLength >= 27 && new TextDecoder().decode( new Uint8Array( buffer, 0, 21 ) ) === BINARY_MAGIC;

}

export function fbxVersion( buffer ) {

	if ( isBinary( buffer ) ) return new DataView( buffer ).getUint32( 23, true );
	const match = /FBXVersion: (\d+)/.exec( new TextDecoder().decode( new Uint8Array( buffer, 0, Math.min( buffer.byteLength, 4096 ) ) ) );
	return match ? Number( match[ 1 ] ) : 0;

}

const int64 = ( value ) => ( value >= BigInt( Number.MIN_SAFE_INTEGER ) && value <= BigInt( Number.MAX_SAFE_INTEGER ) ? Number( value ) : value.toString() );

// Binary strings name objects "Name\x00\x01Class"; ASCII ones "Class::Name".
const objectName = ( text ) => {

	const split = text.indexOf( '\x00\x01' );
	return split === - 1 ? text : text.slice( split + 2 ) + '::' + text.slice( 0, split );

};

// ---------------------------------------------------------------- binary

export function parseBinary( buffer ) {

	const view = new DataView( buffer ), bytes = new Uint8Array( buffer );
	const version = view.getUint32( 23, true ), wide = version >= 7500;
	const decoder = new TextDecoder();
	let offset = 27;

	const uint = () => {

		let value;
		if ( wide ) {

			value = Number( view.getBigUint64( offset, true ) );
			offset += 8;

		} else {

			value = view.getUint32( offset, true );
			offset += 4;

		}

		return value;

	};

	const array = ( Type, bytesPer, convert ) => {

		const length = view.getUint32( offset, true ), encoding = view.getUint32( offset + 4, true ), compressed = view.getUint32( offset + 8, true );
		offset += 12;
		let data = bytes.subarray( offset, offset + compressed );
		offset += compressed;
		data = encoding === 1 ? unzlib( data, length * bytesPer ) : data.slice();
		const typed = new Type( data.buffer, data.byteOffset, length );
		return convert ? convert( typed ) : typed;

	};

	const property = () => {

		const type = String.fromCharCode( bytes[ offset ++ ] );
		let value;

		switch ( type ) {

			case 'C': value = bytes[ offset ] !== 0; offset += 1; break;
			case 'Y': value = view.getInt16( offset, true ); offset += 2; break;
			case 'I': value = view.getInt32( offset, true ); offset += 4; break;
			case 'F': value = view.getFloat32( offset, true ); offset += 4; break;
			case 'D': value = view.getFloat64( offset, true ); offset += 8; break;
			case 'L': value = int64( view.getBigInt64( offset, true ) ); offset += 8; break;
			case 'S': case 'R': {

				const length = view.getUint32( offset, true );
				offset += 4;
				const data = bytes.slice( offset, offset + length );
				offset += length;
				value = type === 'S' ? objectName( decoder.decode( data ) ) : data;
				break;

			}

			case 'f': value = array( Float32Array, 4 ); break;
			case 'd': value = array( Float64Array, 8 ); break;
			case 'i': value = array( Int32Array, 4 ); break;
			case 'l': value = array( BigInt64Array, 8, ( a ) => Float64Array.from( a, Number ) ); break;
			case 'b': case 'c': value = array( Uint8Array, 1 ); break;
			default: throw new Error( 'WAMR3D: FBXLoader: unknown property type ' + type );

		}

		return value;

	};

	const node = () => {

		const end = uint(), count = uint();
		uint();
		const nameLength = bytes[ offset ++ ];
		const name = decoder.decode( bytes.subarray( offset, offset + nameLength ) );
		offset += nameLength;
		// the null record that closes a list
		if ( end === 0 ) return null;
		const props = [];
		for ( let i = 0; i < count; i ++ ) props.push( property() );
		const children = [];

		while ( offset < end ) {

			const child = node();
			if ( child ) children.push( child );

		}

		offset = end;
		return { name, props, children };

	};

	const root = { name: '', props: [], children: [] };

	while ( offset < buffer.byteLength - ( wide ? 25 : 13 ) ) {

		const child = node();
		if ( ! child ) break;
		root.children.push( child );

	}

	return root;

}

// ---------------------------------------------------------------- ASCII

const TOKEN = /\s*(?:;[^\n]*|("[^"]*")|([A-Za-z_][\w|.\-]*):|\*(\d+)|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([A-Za-z_][\w|.\-#]*)|([{},]))/y;

export function parseASCII( text ) {

	const tokens = [];
	TOKEN.lastIndex = 0;

	while ( TOKEN.lastIndex < text.length ) {

		const start = TOKEN.lastIndex, match = TOKEN.exec( text );
		if ( ! match ) {

			if ( /^\s*$/.test( text.slice( start ) ) ) break;
			throw new Error( 'WAMR3D: FBXLoader: unexpected text at ' + start );

		}

		if ( match[ 1 ] !== undefined ) tokens.push( { value: match[ 1 ].slice( 1, - 1 ) } );
		else if ( match[ 2 ] !== undefined ) tokens.push( { key: match[ 2 ] } );
		else if ( match[ 3 ] !== undefined ) tokens.push( { count: Number( match[ 3 ] ) } );
		else if ( match[ 4 ] !== undefined ) {

			const digits = match[ 4 ];
			tokens.push( { value: /^-?\d{16,}$/.test( digits ) && ! Number.isSafeInteger( Number( digits ) ) ? BigInt( digits ).toString() : Number( digits ) } );

		} else if ( match[ 5 ] !== undefined ) tokens.push( { value: match[ 5 ] } );
		else if ( match[ 6 ] !== undefined ) tokens.push( { symbol: match[ 6 ] } );

	}

	let at = 0;

	const list = ( closing ) => {

		const nodes = [];

		while ( at < tokens.length ) {

			const token = tokens[ at ];

			if ( token.symbol === '}' ) {

				if ( ! closing ) throw new Error( 'WAMR3D: FBXLoader: unbalanced braces.' );
				at ++;
				return nodes;

			}

			if ( token.key === undefined ) throw new Error( 'WAMR3D: FBXLoader: expected a node name.' );
			at ++;
			const node = { name: token.key, props: [], children: [] };
			let arrayLength = - 1;

			// values separated by commas, then optionally a block
			while ( at < tokens.length ) {

				const next = tokens[ at ];

				if ( next.count !== undefined ) {

					arrayLength = next.count;
					at ++;

				} else if ( next.value !== undefined ) {

					node.props.push( next.value );
					at ++;

				} else if ( next.symbol === ',' ) {

					at ++;

				} else break;

			}

			if ( tokens[ at ]?.symbol === '{' ) {

				at ++;
				node.children = list( true );

			}

			if ( arrayLength >= 0 ) {

				const values = node.children.find( ( c ) => c.name === 'a' )?.props ?? [];
				node.props = [ Float64Array.from( values ) ];
				node.children = [];

			}

			nodes.push( node );

		}

		if ( closing ) throw new Error( 'WAMR3D: FBXLoader: unexpected end of the file.' );
		return nodes;

	};

	return { name: '', props: [], children: list( false ) };

}

// ---------------------------------------------------------------- tree helpers

export function child( node, name ) {

	return node?.children.find( ( c ) => c.name === name );

}

export function children( node, name ) {

	return node ? node.children.filter( ( c ) => c.name === name ) : [];

}

/** The `Properties70` of a node: name -> { type, value } (value a number, string or array). */
export function properties( node ) {

	const result = {};
	const block = child( node, 'Properties70' );
	if ( ! block ) return result;

	for ( const p of block.children ) {

		if ( p.name !== 'P' ) continue;
		const [ name, type, , , ...values ] = p.props;
		result[ name ] = { type, value: values.length === 1 ? values[ 0 ] : values };

	}

	return result;

}

/** A node's array property (`Vertices`, `PolygonVertexIndex`, ...), or an empty array. */
export function arrayOf( node, name ) {

	return child( node, name )?.props[ 0 ] ?? [];

}
