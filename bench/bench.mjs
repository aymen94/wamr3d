// Benchmark: the same workloads in WAMR3D (dist/wamr3d) and in three.js.
//
//   node engine/bindings/build.mjs && node bench/bench.mjs
//
// Each workload is warmed up, then timed SAMPLES times; the table shows the median, the
// fastest sample and the spread. Inputs are generated once and shared by both sides.
// One-time start-up cost is measured separately at the top.

import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const WARMUP = 5;
const SAMPLES = 25;

// ---- start-up

const wasmUrl = new URL( '../dist/wamr3d/wamr3d_wasm_bg.wasm', import.meta.url );
const wasmBytes = fs.readFileSync( wasmUrl );

let t0 = performance.now();
const wamr = await import( '../dist/wamr3d/index.js' );
const wamrImportMs = performance.now() - t0;
t0 = performance.now();
await wamr.init();
const wamrInitMs = performance.now() - t0;

t0 = performance.now();
// the comparison side: `npm install` at the repository root fetches the pinned `three` package
const T = await import( 'three/src/Three.Core.js' ).catch( () => {

	console.error( 'bench: three is not installed; run `npm install` at the repository root to get the comparison side' );
	process.exit( 1 );

} );
const threeImportMs = performance.now() - t0;

const { World, Vector3, Quaternion, Matrix4 } = wamr;

// ---- shared inputs

let seed = 186;
const random = () => {

	seed = ( seed + 0x6D2B79F5 ) >>> 0;
	let t = seed;
	t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
	t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
	return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

};
const u = ( lo, hi ) => Math.fround( lo + random() * ( hi - lo ) );

function trsElements() {

	const q = new T.Quaternion( u( - 1, 1 ), u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize();
	return new Float32Array( new T.Matrix4().compose( new T.Vector3( u( - 3, 3 ), u( - 3, 3 ), u( - 3, 3 ) ), q, new T.Vector3( u( 0.5, 2 ), u( 0.5, 2 ), u( 0.5, 2 ) ) ).elements );

}

// ---- measurement

const results = [];

function time( fn ) {

	for ( let i = 0; i < WARMUP; i ++ ) fn();
	const samples = [];
	for ( let i = 0; i < SAMPLES; i ++ ) {

		const start = performance.now();
		fn();
		samples.push( performance.now() - start );

	}

	samples.sort( ( a, b ) => a - b );
	const mean = samples.reduce( ( a, b ) => a + b, 0 ) / samples.length;
	return { median: samples[ samples.length >> 1 ], min: samples[ 0 ], max: samples[ samples.length - 1 ], mean };

}

function bench( name, operations, sides ) {

	const row = { name, operations, sides: {} };
	for ( const [ label, fn ] of Object.entries( sides ) ) row.sides[ label ] = time( fn );
	results.push( row );

}

// ---- 1. math, one engine call per operation (each WAMR3D call crosses the JS/Wasm boundary)

{

	const N = 200_000;
	const ea = trsElements(), eb = trsElements();

	const a3 = new T.Matrix4().fromArray( ea ), b3 = new T.Matrix4().fromArray( eb ), out3 = new T.Matrix4();
	const a = new Matrix4(), b = new Matrix4(), out = new Matrix4();
	a.fromArray( ea );
	b.fromArray( eb );

	bench( 'Matrix4.multiplyMatrices', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) out3.multiplyMatrices( a3, b3 );

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) out.multiplyMatrices( a, b );

		}
	} );

	bench( 'Matrix4.invert (copy + invert)', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) out3.copy( a3 ).invert();

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) {

				out.copy( a );
				out.invert();

			}

		}
	} );

	const v3 = new T.Vector3( 0.3, - 0.2, 0.9 ), q3 = new T.Quaternion( 0.1, 0.2, 0.3, 0.9 ).normalize();
	const v = new Vector3( 0.3, - 0.2, 0.9 ), q = new Quaternion( q3.x, q3.y, q3.z, q3.w );
	const rotation3 = new T.Matrix4().makeRotationFromQuaternion( q3 ), rotation = new Matrix4();
	rotation.makeRotationFromQuaternion( q );

	bench( 'Vector3.applyMatrix4', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) v3.applyMatrix4( rotation3 );

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) v.applyMatrix4( rotation );

		}
	} );

	bench( 'Vector3.applyQuaternion', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) v3.applyQuaternion( q3 );

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) v.applyQuaternion( q );

		}
	} );

	// the cheapest possible calls, to show the cost of the boundary itself
	const world = new World();
	const handle = world.createObject();
	const object3 = new T.Object3D();
	let sink = 0;

	bench( 'boundary: getter (v.x)', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) sink += v3.x;

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) sink += v.x;

		}
	} );

	bench( 'boundary: call with a handle (isAlive / .visible)', N, {
		three: () => {

			for ( let i = 0; i < N; i ++ ) sink += object3.visible ? 1 : 0;

		},
		wamr3d: () => {

			for ( let i = 0; i < N; i ++ ) sink += world.isAlive( handle ) ? 1 : 0;

		}
	} );

	if ( Number.isNaN( sink ) ) throw new Error( 'unreachable' );

}

// ---- 2. scene graph: 10,000 objects, 4 children per parent

{

	const COUNT = 10_000;
	const transforms = new Float32Array( COUNT * 10 );
	for ( let i = 0; i < COUNT; i ++ ) {

		const q = new T.Quaternion( u( - 1, 1 ), u( - 1, 1 ), u( - 1, 1 ), u( 0.1, 1 ) ).normalize();
		transforms.set( [ u( - 2, 2 ), u( - 2, 2 ), u( - 2, 2 ), q.x, q.y, q.z, q.w, u( 0.9, 1.1 ), u( 0.9, 1.1 ), u( 0.9, 1.1 ) ], i * 10 );

	}

	const objects = Array.from( { length: COUNT }, () => new T.Object3D() );
	for ( let i = 1; i < COUNT; i ++ ) objects[ ( i - 1 ) >> 2 ].add( objects[ i ] );

	const world = new World();
	const handles = world.createObjects( COUNT );
	const parents = new BigUint64Array( COUNT - 1 );
	for ( let i = 1; i < COUNT; i ++ ) parents[ i - 1 ] = handles[ ( i - 1 ) >> 2 ];
	world.addMany( parents, handles.subarray( 1 ) );
	world.drainEvents();

	const setThree = () => {

		for ( let i = 0, o = 0; i < COUNT; i ++, o += 10 ) {

			const object = objects[ i ];
			object.position.set( transforms[ o ], transforms[ o + 1 ], transforms[ o + 2 ] );
			object.quaternion.set( transforms[ o + 3 ], transforms[ o + 4 ], transforms[ o + 5 ], transforms[ o + 6 ] );
			object.scale.set( transforms[ o + 7 ], transforms[ o + 8 ], transforms[ o + 9 ] );

		}

	};

	const setWamrPerObject = () => {

		for ( let i = 0, o = 0; i < COUNT; i ++, o += 10 ) {

			const handle = handles[ i ];
			world.setPosition( handle, transforms[ o ], transforms[ o + 1 ], transforms[ o + 2 ] );
			world.setQuaternion( handle, transforms[ o + 3 ], transforms[ o + 4 ], transforms[ o + 5 ], transforms[ o + 6 ] );
			world.setScale( handle, transforms[ o + 7 ], transforms[ o + 8 ], transforms[ o + 9 ] );

		}

	};

	setThree();
	world.setTransforms( handles, transforms );

	bench( 'scene: update 10,000 world matrices (transforms unchanged, forced)', COUNT, {
		three: () => objects[ 0 ].updateMatrixWorld( true ),
		wamr3d: () => world.updateMatrixWorld( handles[ 0 ], true )
	} );

	bench( 'scene: set 10,000 transforms + update, one call per property', COUNT, {
		three: () => {

			setThree();
			objects[ 0 ].updateMatrixWorld();

		},
		wamr3d: () => {

			setWamrPerObject();
			world.updateMatrixWorld( handles[ 0 ], false );

		}
	} );

	bench( 'scene: set 10,000 transforms + update, one batched call', COUNT, {
		three: () => {

			setThree();
			objects[ 0 ].updateMatrixWorld();

		},
		wamr3d: () => {

			world.setTransforms( handles, transforms );
			world.updateMatrixWorld( handles[ 0 ], false );

		}
	} );

	bench( 'scene: read back 10,000 world matrices into one Float32Array', COUNT, {
		three: () => {

			const out = new Float32Array( COUNT * 16 );
			for ( let i = 0; i < COUNT; i ++ ) out.set( objects[ i ].matrixWorld.elements, i * 16 );
			return out;

		},
		wamr3d: () => world.matricesWorld( handles )
	} );

	bench( 'scene: create + parent + destroy 10,000 objects', COUNT, {
		three: () => {

			const created = Array.from( { length: COUNT }, () => new T.Object3D() );
			for ( let i = 1; i < COUNT; i ++ ) created[ ( i - 1 ) >> 2 ].add( created[ i ] );
			created[ 0 ].clear();

		},
		wamr3d: () => {

			const created = world.createObjects( COUNT );
			const createdParents = new BigUint64Array( COUNT - 1 );
			for ( let i = 1; i < COUNT; i ++ ) createdParents[ i - 1 ] = created[ ( i - 1 ) >> 2 ];
			world.addMany( createdParents, created.subarray( 1 ) );
			world.destroyRecursive( created[ 0 ] );
			world.drainEvents();

		}
	} );

}

// ---- 3. geometry: a 256 x 256 grid (66,049 vertices, 131,072 triangles)

{

	const N = 256, vertexCount = ( N + 1 ) * ( N + 1 );
	const positions = new Float32Array( vertexCount * 3 ), indices = new Uint32Array( N * N * 6 );
	for ( let y = 0, i = 0; y <= N; y ++ ) for ( let x = 0; x <= N; x ++, i += 3 ) positions.set( [ x / N, y / N, u( - 0.05, 0.05 ) ], i );
	for ( let y = 0, k = 0; y < N; y ++ ) for ( let x = 0; x < N; x ++, k += 6 ) {

		const i = y * ( N + 1 ) + x;
		indices.set( [ i, i + 1, i + N + 2, i, i + N + 2, i + N + 1 ], k );

	}

	const geometry3 = new T.BufferGeometry();
	geometry3.setAttribute( 'position', new T.BufferAttribute( positions.slice(), 3 ) );
	geometry3.setIndex( new T.BufferAttribute( indices.slice(), 1 ) );

	const world = new World();
	const geometry = world.createGeometry();
	world.setAttribute( geometry, 'position', positions, 3 );
	world.setIndex( geometry, indices );

	bench( 'geometry: computeVertexNormals', vertexCount, {
		three: () => geometry3.computeVertexNormals(),
		wamr3d: () => world.computeVertexNormals( geometry )
	} );

	bench( 'geometry: computeBoundingSphere', vertexCount, {
		three: () => geometry3.computeBoundingSphere(),
		wamr3d: () => world.computeBoundingSphere( geometry )
	} );

	const spin3 = new T.Matrix4().makeRotationY( 0.01 ), spin = new Matrix4();
	spin.makeRotationY( 0.01 );

	bench( 'geometry: applyMatrix4 (positions + normals)', vertexCount, {
		three: () => geometry3.applyMatrix4( spin3 ),
		wamr3d: () => world.applyMatrix4ToGeometry( geometry, spin )
	} );

	bench( 'geometry: upload positions + index (copy into the engine)', vertexCount, {
		three: () => {

			const g = new T.BufferGeometry();
			g.setAttribute( 'position', new T.BufferAttribute( positions.slice(), 3 ) );
			g.setIndex( new T.BufferAttribute( indices.slice(), 1 ) );

		},
		wamr3d: () => {

			const g = world.createGeometry();
			world.setAttribute( g, 'position', positions, 3 );
			world.setIndex( g, indices );
			world.disposeGeometry( g );

		}
	} );

}

// ---- report

const ms = ( x ) => x.toFixed( 3 ).padStart( 9 );
const perOp = ( row, side ) => ( row.sides[ side ].median * 1e6 / row.operations ).toFixed( 1 ).padStart( 8 );

console.log( `node ${process.version}, ${process.platform} ${process.arch}; ${WARMUP} warm-up runs, ${SAMPLES} samples per workload` );
console.log( '' );
console.log( 'start-up (one time, not included below)' );
console.log( `  wamr3d: import ${wamrImportMs.toFixed( 1 )} ms, init (compile + instantiate ${( wasmBytes.length / 1024 ).toFixed( 0 )} KiB of wasm) ${wamrInitMs.toFixed( 1 )} ms` );
console.log( `  three:  import ${threeImportMs.toFixed( 1 )} ms (unbundled source modules)` );
console.log( '' );
console.log( 'workload                                                              side      median ms    min ms    max ms   ns/op   wamr3d/three' );

for ( const row of results ) {

	const ratio = row.sides.wamr3d.median / row.sides.three.median;
	for ( const side of [ 'three', 'wamr3d' ] ) {

		const s = row.sides[ side ];
		console.log( `${( side === 'three' ? row.name : '' ).padEnd( 70 )}${side.padEnd( 8 )}${ms( s.median )}  ${ms( s.min )} ${ms( s.max )} ${perOp( row, side )}   ${side === 'wamr3d' ? ratio.toFixed( 2 ) + 'x' : ''}` );

	}

}

console.log( '' );
console.log( 'wamr3d/three is the ratio of median times: below 1 means WAMR3D was faster, above 1 slower.' );
