// Small math in JavaScript or in WebAssembly: three.js against the low-level `wamr3d` math
// classes (engine objects, every call crosses into WebAssembly) and `wamr3d/math` (the same
// operations as JavaScript values). The last row is a whole update of 10,000 objects:
// per-object math, then transforms and world matrices.
//
//   node engine/bindings/build.mjs && node bench/math.mjs [--json=out.json]
//
// Each library runs in its own Node.js process (`--side=`), so V8's inline-cache feedback
// from one does not slow the other. Medians of SAMPLES runs after WARMUP runs.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const WARMUP = 5;
const SAMPLES = 25;
const N = 100_000;
const COUNT = 10_000;
const SIDES = [ 'three', 'wasm', 'js' ];

const side = process.argv.find( ( a ) => a.startsWith( '--side=' ) )?.slice( 7 );
const json = process.argv.find( ( a ) => a.startsWith( '--json=' ) )?.slice( 7 );

function time( fn ) {

	for ( let i = 0; i < WARMUP; i ++ ) fn();
	const samples = [];
	for ( let i = 0; i < SAMPLES; i ++ ) {

		const start = performance.now();
		fn();
		samples.push( performance.now() - start );

	}

	samples.sort( ( a, b ) => a - b );
	return samples[ samples.length >> 1 ];

}

let sink = 0;

// Each side writes the same work in its library's style; the low-level classes do not chain.
async function workloads() {

	if ( side === 'three' ) {

		const T = await import( 'three/src/Three.Core.js' ).catch( () => {

			console.error( 'bench: three is not installed; run `npm install` at the repository root' );
			process.exit( 1 );

		} );
		const a = new T.Matrix4().makeRotationY( 0.3 ), b = new T.Matrix4().makeTranslation( 1, 2, 3 ), m = new T.Matrix4();
		const v = new T.Vector3(), q = new T.Quaternion().setFromAxisAngle( new T.Vector3( 0, 1, 0 ), 0.5 );
		const scene = new T.Object3D(), objects = [];
		for ( let i = 0; i < COUNT; i ++ ) scene.add( objects[ objects.push( new T.Object3D() ) - 1 ] );
		const axis = new T.Vector3( 0, 1, 0 ), p = new T.Vector3();
		let frame = 0;
		return [
			() => { for ( let i = 0; i < N; i ++ ) v.set( i, 1, 2 ).applyMatrix4( a ); sink += v.x; },
			() => { for ( let i = 0; i < N; i ++ ) v.set( i, 1, 2 ).applyQuaternion( q ); sink += v.x; },
			() => { for ( let i = 0; i < N; i ++ ) m.multiplyMatrices( a, b ); sink += m.elements[ 12 ]; },
			() => { for ( let i = 0; i < N; i ++ ) m.copy( a ).invert(); sink += m.elements[ 0 ]; },
			() => { for ( let i = 0; i < N; i ++ ) sink += v.x; },
			() => {

				frame ++;
				for ( let i = 0; i < COUNT; i ++ ) {

					const o = objects[ i ];
					o.position.copy( p.set( i * 0.01, 0, 0 ).applyMatrix4( a ) );
					o.quaternion.setFromAxisAngle( axis, frame * 0.01 + i * 1e-4 );

				}

				scene.updateMatrixWorld();

			}
		];

	}

	const W = await import( '../dist/wamr3d/index.js' );
	await W.init();
	const world = new W.World();
	const handles = world.createObjects( COUNT + 1 );
	const root = handles[ 0 ], children = handles.subarray( 1 );
	world.addMany( new BigUint64Array( COUNT ).fill( root ), children );
	world.drainEvents();
	const transforms = new Float32Array( COUNT * 10 );
	let frame = 0;

	if ( side === 'wasm' ) {

		const a = new W.Matrix4(), b = new W.Matrix4(), m = new W.Matrix4();
		a.makeRotationY( 0.3 ); b.makeTranslation( 1, 2, 3 );
		const v = new W.Vector3( 0, 0, 0 ), q = new W.Quaternion( 0, 0, 0, 1 ), axis = new W.Vector3( 0, 1, 0 );
		q.setFromAxisAngle( axis, 0.5 );
		const p = new W.Vector3( 0, 0, 0 ), r = new W.Quaternion( 0, 0, 0, 1 );
		return [
			() => { for ( let i = 0; i < N; i ++ ) { v.set( i, 1, 2 ); v.applyMatrix4( a ); } sink += v.x; },
			() => { for ( let i = 0; i < N; i ++ ) { v.set( i, 1, 2 ); v.applyQuaternion( q ); } sink += v.x; },
			() => { for ( let i = 0; i < N; i ++ ) m.multiplyMatrices( a, b ); sink += m.determinant(); },
			() => { for ( let i = 0; i < N; i ++ ) { m.copy( a ); m.invert(); } sink += m.determinant(); },
			() => { for ( let i = 0; i < N; i ++ ) sink += v.x; },
			() => {

				frame ++;
				for ( let i = 0, o = 0; i < COUNT; i ++, o += 10 ) {

					p.set( i * 0.01, 0, 0 );
					p.applyMatrix4( a );
					r.setFromAxisAngle( axis, frame * 0.01 + i * 1e-4 );
					transforms[ o ] = p.x; transforms[ o + 1 ] = p.y; transforms[ o + 2 ] = p.z;
					transforms[ o + 3 ] = r.x; transforms[ o + 4 ] = r.y; transforms[ o + 5 ] = r.z; transforms[ o + 6 ] = r.w;
					transforms[ o + 7 ] = 1; transforms[ o + 8 ] = 1; transforms[ o + 9 ] = 1;

				}

				world.setTransforms( children, transforms );
				world.updateMatrixWorld( root, false );

			}
		];

	}

	const M = await import( '../dist/wamr3d/math.js' );
	const a = new M.Matrix4().makeRotationY( 0.3 ), b = new M.Matrix4().makeTranslation( 1, 2, 3 ), m = new M.Matrix4();
	const v = new M.Vector3(), q = new M.Quaternion().setFromAxisAngle( new M.Vector3( 0, 1, 0 ), 0.5 );
	const axis = new M.Vector3( 0, 1, 0 ), p = new M.Vector3(), r = new M.Quaternion();
	return [
		() => { for ( let i = 0; i < N; i ++ ) v.set( i, 1, 2 ).applyMatrix4( a ); sink += v.x; },
		() => { for ( let i = 0; i < N; i ++ ) v.set( i, 1, 2 ).applyQuaternion( q ); sink += v.x; },
		() => { for ( let i = 0; i < N; i ++ ) m.multiplyMatrices( a, b ); sink += m.elements[ 12 ]; },
		() => { for ( let i = 0; i < N; i ++ ) m.copy( a ).invert(); sink += m.elements[ 0 ]; },
		() => { for ( let i = 0; i < N; i ++ ) sink += v.x; },
		() => {

			frame ++;
			for ( let i = 0, o = 0; i < COUNT; i ++, o += 10 ) {

				p.set( i * 0.01, 0, 0 ).applyMatrix4( a );
				r.setFromAxisAngle( axis, frame * 0.01 + i * 1e-4 );
				transforms[ o ] = p.x; transforms[ o + 1 ] = p.y; transforms[ o + 2 ] = p.z;
				transforms[ o + 3 ] = r.x; transforms[ o + 4 ] = r.y; transforms[ o + 5 ] = r.z; transforms[ o + 6 ] = r.w;
				transforms[ o + 7 ] = 1; transforms[ o + 8 ] = 1; transforms[ o + 9 ] = 1;

			}

			world.setTransforms( children, transforms );
			world.updateMatrixWorld( root, false );

		}
	];

}

const names = [
	'Vector3.applyMatrix4 (100,000)',
	'Vector3.applyQuaternion (100,000)',
	'Matrix4.multiplyMatrices (100,000)',
	'Matrix4.invert, copy + invert (100,000)',
	'getter v.x (100,000)',
	'10,000 objects: math per object, set transforms, update'
];

if ( side ) {

	const fns = await workloads();
	const times = fns.map( time );
	if ( Number.isNaN( sink ) ) throw new Error( 'unreachable' );
	process.stdout.write( JSON.stringify( times ) );

} else {

	const run = ( name ) => JSON.parse( execFileSync( process.execPath, [ fileURLToPath( import.meta.url ), `--side=${name}` ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'inherit' ] } ) );
	const results = Object.fromEntries( SIDES.map( ( s ) => [ s, run( s ) ] ) );
	const rows = names.map( ( name, i ) => ( { name, three: results.three[ i ], wasm: results.wasm[ i ], js: results.js[ i ] } ) );

	console.log( `node ${process.version}, ${process.platform} ${process.arch}; ${WARMUP} warm-up runs, median of ${SAMPLES}; each library in its own process` );
	console.log( 'wasm: low-level wamr3d math classes (every call crosses into WebAssembly); js: wamr3d/math (JavaScript values).' );
	console.log( 'In the last row both WAMR3D sides send the transforms in one setTransforms call and update world matrices in the engine.' );
	console.log( '' );
	console.log( `${'workload'.padEnd( 58 )}  three ms   wasm ms     js ms   wasm/three   js/three` );
	for ( const r of rows ) console.log( `${r.name.padEnd( 58 )}${r.three.toFixed( 3 ).padStart( 9 )}${r.wasm.toFixed( 3 ).padStart( 10 )}${r.js.toFixed( 3 ).padStart( 10 )}${( r.wasm / r.three ).toFixed( 2 ).padStart( 12 )}x${( r.js / r.three ).toFixed( 2 ).padStart( 10 )}x` );
	console.log( '' );
	console.log( 'x/three: below 1 means faster than three.js.' );
	if ( json ) fs.writeFileSync( json, JSON.stringify( { node: process.version, rows }, null, '\t' ) );

}
