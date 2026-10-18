// Runs every operation on its samples and writes one fixture file per type.
//
// Part of the math fixture generator; `../generate.mjs` runs it.

import fs from 'node:fs';
import path from 'node:path';
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Frustum } from 'three/src/math/Frustum.js';
import { OUT_DIR, RANDOM_CASES, f } from './common.js';
import { fnv1a, mulberry32 } from './random.js';
import { SAMPLES } from './samples.js';
import { DEC, encode } from './codec.js';
import { CS, OPS, pointInTriangle } from './ops.js';

function sample( kind, i, j, edgeRounds, rng ) {

	const s = SAMPLES[ kind ];
	if ( ! s ) throw new Error( 'unknown sample kind: ' + kind );
	const flat = i < edgeRounds ? s.edges[ ( i * ( j * 2 + 1 ) + j ) % s.edges.length ] : s.rand( rng );
	return s.int ? flat.slice() : flat.map( f );

}

function runOp( o ) {

	const rng = mulberry32( fnv1a( o.name ) );
	const edgeRounds = o.args.reduce( ( n, k ) => Math.max( n, SAMPLES[ k ].edges.length ), 0 );
	const strings = o.strings || [ undefined ];
	const count = o.strings ? Math.max( strings.length, edgeRounds ) : edgeRounds + RANDOM_CASES;
	const cases = [];

	for ( let i = 0; i < count; i ++ ) {

		let flats = o.args.map( ( k, j ) => sample( k, i, j, edgeRounds, rng ) );
		if ( o.minPoints ) while ( flats[ 0 ][ 0 ] < o.minPoints ) flats = o.args.map( ( k, j ) => sample( k, edgeRounds, j, edgeRounds, rng ) );

		const str = strings[ i % strings.length ];
		const decoded = () => o.args.map( ( k, j ) => DEC[ SAMPLES[ k ].base ]( flats[ j ] ) );
		const c = { op: o.name, in: flats.flat() };
		if ( str !== undefined ) c.s = str;

		if ( o.derived === 'pointInTriangle' ) {

			// replace the two weights with the derived f32 point so the engine needs no helper
			const [ t, a, b ] = decoded();
			const p = pointInTriangle( t, a, b );
			c.in = [ ...flats[ 0 ], p.x, p.y, p.z ];

		}

		if ( o.inputMatrix ) {

			// the op consumes one pre-multiplied f32 matrix: record that instead of its factors
			const [ p, v, cs, rev ] = decoded();
			const m = p.multiply( v ).toArray().map( f );
			c.in = [ ...m, cs, rev ? 1 : 0 ];
			c.out = encode( o.ret, new Frustum().setFromProjectionMatrix( new Matrix4().fromArray( m ), CS( cs ), rev ), c );
			cases.push( c );
			continue;

		}

		const args = decoded();
		if ( str !== undefined ) args.push( str );
		const extra = {};
		c.out = encode( o.ret, o.fn( ...args ), extra );
		if ( extra.os !== undefined ) c.os = extra.os;
		cases.push( c );

	}

	return cases;

}

const num = ( x ) => ( Number.isFinite( x ) ? ( Object.is( x, - 0 ) ? '0' : String( x ) ) : JSON.stringify( String( x ) ) );
const arr = ( a ) => '[' + a.map( num ).join( ',' ) + ']';

function serialize( type, cases ) {

	const meta = {
		type,
		reference: 'three@0.186.1 src/math',
		generator: 'parity/math/gen/generate.mjs',
		inputs: 'float inputs are f32-rounded (Math.fround) before three.js sees them',
		tolerance: '|got - out| <= 1e-6 * max(1, |out|)',
		cases: cases.length
	};
	const lines = cases.map( ( c ) => {

		let s = '{"op":' + JSON.stringify( c.op ) + ',"in":' + arr( c.in );
		if ( c.s !== undefined ) s += ',"s":' + JSON.stringify( c.s );
		s += ',"out":' + arr( c.out );
		if ( c.os !== undefined ) s += ',"os":' + JSON.stringify( c.os );
		return s + '}';

	} );
	return '{"meta":' + JSON.stringify( meta ) + ',\n"cases":[\n' + lines.join( ',\n' ) + '\n]}\n';

}

const byType = new Map();
for ( const o of OPS ) {

	const type = o.name.split( '.' )[ 0 ];
	if ( ! byType.has( type ) ) byType.set( type, [] );
	byType.get( type ).push( ...runOp( o ) );

}

let total = 0;
const opNames = OPS.map( ( o ) => o.name );
for ( const [ type, cases ] of byType ) {

	fs.writeFileSync( path.join( OUT_DIR, type + '.json' ), serialize( type, cases ) );
	console.log( `${type}.json`.padEnd( 24 ) + String( cases.length ).padStart( 6 ) + ' cases' );
	total += cases.length;

}

fs.writeFileSync( path.join( OUT_DIR, 'ops.json' ), JSON.stringify( opNames, null, '\t' ) + '\n' );
console.log( `${opNames.length} ops, ${total} cases -> ${OUT_DIR}` );
