// Benchmark of the object API: the same three.js-style application code run against
// `wamr3d/compat` and against three.js.
//
//   node engine/bindings/build.mjs && node bench/compat.mjs [--json=out.json]
//
// Each workload is written once against a library object `L`. Workloads are warmed up,
// then timed SAMPLES times; the table shows medians. No GPU is involved: drawing is
// measured in the browser by examples/showcase/check.mjs and examples/compare/measure.mjs.
//
// Each library runs in its own Node.js process (`--side=three|wamr3d`). In one process the
// two runs of a workload share V8's inline-cache feedback, which slowed whichever library
// ran second by up to 3.7x.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const WARMUP = 5;
const SAMPLES = 21;

const side = process.argv.find( ( a ) => a.startsWith( '--side=' ) )?.slice( 7 );
const only = process.argv.find( ( a ) => a.startsWith( '--only=' ) )?.slice( 7 );
const json = process.argv.find( ( a ) => a.startsWith( '--json=' ) )?.slice( 7 );

async function library() {

	if ( side === 'wamr3d' ) {

		const W = await import( '../dist/wamr3d/compat.js' );
		await W.init();
		return W;

	}

	return import( 'three/src/Three.Core.js' ).catch( () => {

		console.error( 'bench: three is not installed; run `npm install` at the repository root' );
		process.exit( 1 );

	} );

}

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

// Each entry: name, operations per run, setup( L ) returning the function to time.
const workloads = [

	[ 'math: vector chain (set, applyQuaternion, add, normalize, dot)', 100_000, ( L ) => {

		const v = new L.Vector3(), offset = new L.Vector3( 1, 2, 3 ), direction = new L.Vector3( 0, 1, 0 );
		const q = new L.Quaternion().setFromAxisAngle( new L.Vector3( 0, 1, 0 ), 0.3 );
		return () => {

			for ( let i = 0; i < 100_000; i ++ ) sink += v.set( i * 1e-3, 1, 2 ).applyQuaternion( q ).add( offset ).normalize().dot( direction );

		};

	} ],

	[ 'math: new Vector3 per operation (allocation churn)', 100_000, ( L ) => () => {

		for ( let i = 0; i < 100_000; i ++ ) sink += new L.Vector3( i, 1, 2 ).length();

	} ],

	[ 'math: Matrix4 compose, multiply, invert', 50_000, ( L ) => {

		const m = new L.Matrix4(), out = new L.Matrix4(), parent = new L.Matrix4().makeRotationY( 0.4 );
		const p = new L.Vector3( 1, 2, 3 ), q = new L.Quaternion( 0.1, 0.2, 0.3, 0.9 ).normalize(), s = new L.Vector3( 1, 2, 1 );
		return () => {

			for ( let i = 0; i < 50_000; i ++ ) {

				p.x = i * 1e-3;
				out.multiplyMatrices( parent, m.compose( p, q, s ) ).invert();

			}

			sink += out.elements[ 12 ];

		};

	} ],

	[ 'math: Quaternion.setFromEuler + slerp', 100_000, ( L ) => {

		const e = new L.Euler(), q = new L.Quaternion(), target = new L.Quaternion( 0, 1, 0, 0 );
		return () => {

			for ( let i = 0; i < 100_000; i ++ ) sink += q.setFromEuler( e.set( i * 1e-4, 0.2, 0.3 ) ).slerp( target, 0.5 ).w;

		};

	} ],

	[ 'math: Box3.expandByPoint + Sphere.containsPoint', 100_000, ( L ) => {

		const box = new L.Box3(), sphere = new L.Sphere( new L.Vector3(), 50 ), p = new L.Vector3();
		return () => {

			box.makeEmpty();
			for ( let i = 0; i < 100_000; i ++ ) {

				box.expandByPoint( p.set( i % 97, i % 89, i % 83 ) );
				if ( sphere.containsPoint( p ) ) sink ++;

			}

		};

	} ],

	[ 'math: Color.setHSL + lerp', 100_000, ( L ) => {

		const c = new L.Color(), target = new L.Color( 0xff8800 );
		return () => {

			for ( let i = 0; i < 100_000; i ++ ) sink += c.setHSL( ( i % 360 ) / 360, 0.5, 0.5 ).lerp( target, 0.25 ).r;

		};

	} ],

	[ 'scene: 10,000 meshes, set rotation + position.y, updateMatrixWorld', 10_000, ( L ) => {

		const { scene, meshes } = tree( L, 10_000 );
		let frame = 0;
		return () => {

			frame ++;
			for ( let i = 0; i < meshes.length; i ++ ) {

				const mesh = meshes[ i ];
				mesh.rotation.set( frame * 0.01, i * 0.001, 0 );
				mesh.position.y = Math.sin( frame + i );

			}

			scene.updateMatrixWorld();

		};

	} ],

	[ 'scene: 10,000 meshes, rotation.y += and position.x read', 10_000, ( L ) => {

		const { scene, meshes } = tree( L, 10_000 );
		return () => {

			for ( let i = 0; i < meshes.length; i ++ ) {

				meshes[ i ].rotation.y += 0.01;
				sink += meshes[ i ].position.x;

			}

			scene.updateMatrixWorld();

		};

	} ],

	[ 'scene: read matrixWorld.elements of 10,000 meshes', 10_000, ( L ) => {

		const { scene, meshes } = tree( L, 10_000 );
		scene.updateMatrixWorld();
		return () => {

			for ( let i = 0; i < meshes.length; i ++ ) sink += meshes[ i ].matrixWorld.elements[ 13 ];

		};

	} ],

	[ 'scene: getWorldPosition of 10,000 meshes', 10_000, ( L ) => {

		const { scene, meshes } = tree( L, 10_000 );
		const target = new L.Vector3();
		scene.updateMatrixWorld();
		return () => {

			for ( let i = 0; i < meshes.length; i ++ ) sink += meshes[ i ].getWorldPosition( target ).y;

		};

	} ],

	[ 'scene: object.lookAt on 10,000 meshes', 10_000, ( L ) => {

		const { scene, meshes } = tree( L, 10_000 );
		const target = new L.Vector3( 0, 10, 0 );
		scene.updateMatrixWorld();
		return () => {

			for ( let i = 0; i < meshes.length; i ++ ) meshes[ i ].lookAt( target );

		};

	} ],

	[ 'scene: create + add + remove 10,000 meshes', 10_000, ( L ) => {

		const geometry = new L.BoxGeometry(), material = new L.MeshBasicMaterial();
		return () => {

			const group = new L.Group();
			for ( let i = 0; i < 10_000; i ++ ) group.add( new L.Mesh( geometry, material ) );
			group.clear();
			if ( group.dispose ) group.dispose();

		};

	} ],

	[ 'picking: 100 rays against 1,000 boxes', 100, ( L ) => {

		const { scene } = tree( L, 1_000 );
		scene.updateMatrixWorld();
		const raycaster = new L.Raycaster(), origin = new L.Vector3( 0, 0, 30 ), direction = new L.Vector3();
		return () => {

			for ( let i = 0; i < 100; i ++ ) {

				raycaster.set( origin, direction.set( ( i % 10 - 5 ) * 0.05, ( Math.floor( i / 10 ) - 5 ) * 0.05, - 1 ).normalize() );
				sink += raycaster.intersectObject( scene, true ).length;

			}

		};

	} ],

];

// 10 groups of meshes on a ring, as an application would build them.
function tree( L, count ) {

	const scene = new L.Scene(), geometry = new L.BoxGeometry( 0.5, 0.5, 0.5 ), material = new L.MeshLambertMaterial( { color: 0x4488ff } );
	const groups = Array.from( { length: 10 }, ( _, g ) => {

		const group = new L.Group();
		group.position.set( Math.cos( g ) * 10, 0, Math.sin( g ) * 10 );
		scene.add( group );
		return group;

	} );
	const meshes = [];

	for ( let i = 0; i < count; i ++ ) {

		const mesh = new L.Mesh( geometry, material );
		mesh.position.set( ( i % 20 ) - 10, Math.floor( i / 20 ) % 20 - 10, - Math.floor( i / 400 ) );
		groups[ i % 10 ].add( mesh );
		meshes.push( mesh );

	}

	return { scene, meshes };

}

const selected = workloads.filter( ( [ name ] ) => ! only || name.includes( only ) );

if ( side ) {

	// Child: time this library only and hand the medians to the parent.
	const L = await library();
	const times = selected.map( ( [ , , setup ] ) => time( setup( L ) ) );
	if ( Number.isNaN( sink ) ) throw new Error( 'unreachable' );
	process.stdout.write( JSON.stringify( times ) );

} else {

	const run = ( name ) => JSON.parse( execFileSync( process.execPath, [ fileURLToPath( import.meta.url ), `--side=${name}`, ...( only ? [ `--only=${only}` ] : [] ) ], { encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'inherit' ] } ) );
	const threeTimes = run( 'three' ), wamrTimes = run( 'wamr3d' );
	const rows = [];

	console.log( `node ${process.version}, ${process.platform} ${process.arch}; ${WARMUP} warm-up runs, median of ${SAMPLES}; each library in its own process` );
	console.log( '' );
	console.log( `${'workload'.padEnd( 70 )}  three ms  wamr3d ms   wamr3d/three` );

	selected.forEach( ( [ name, operations ], i ) => {

		const three = threeTimes[ i ], wamr3d = wamrTimes[ i ];
		rows.push( { name, operations, three, wamr3d } );
		console.log( `${name.padEnd( 70 )}${three.toFixed( 3 ).padStart( 9 )}${wamr3d.toFixed( 3 ).padStart( 11 )}   ${( wamr3d / three ).toFixed( 2 ).padStart( 8 )}x` );

	} );

	console.log( '' );
	console.log( 'wamr3d/three: below 1 means WAMR3D was faster.' );
	if ( json ) fs.writeFileSync( json, JSON.stringify( { node: process.version, rows }, null, '	' ) );

}
