// Times the three engine calls of the showcase's update step under Node.js, without a
// browser or a GPU:  node examples/showcase/profile.mjs [bodies]

import { init, World } from '../../dist/wamr3d/index.js';
import { layout, animate } from './scene.js';

await init();
const scene = layout( Number( process.argv[ 2 ] ) || 100000 ), { nodes, parent, position, scale, firstBody, bodies } = scene;
const world = new World(), stage = world.createObject(), handles = world.createObjects( nodes ), transforms = new Float32Array( nodes * 10 );
for ( let i = 0; i < nodes; i ++ ) transforms.set( [ position[ i * 3 ], position[ i * 3 + 1 ], position[ i * 3 + 2 ], 0, 0, 0, 1, scale[ i ], scale[ i ], scale[ i ] ], i * 10 );
world.addMany( BigUint64Array.from( parent.subarray( 1 ), ( p ) => handles[ p ] ), handles.subarray( 1 ) );
world.setTransforms( handles, transforms );
world.add( stage, handles[ 0 ] );
const items = handles.subarray( firstBody, firstBody + bodies );

const steps = { 'animate (JavaScript)': [], setRotations: [], updateMatrixWorld: [], matricesWorldPtr: [] };

for ( let frame = 0; frame < 60; frame ++ ) {

	const t0 = performance.now();
	const angles = animate( frame / 60, scene );
	const t1 = performance.now();
	world.setRotations( handles, angles, 'XYZ' );
	const t2 = performance.now();
	world.updateMatrixWorld( stage, false );
	const t3 = performance.now();
	world.matricesWorldPtr( items );
	const t4 = performance.now();
	if ( frame >= 10 ) [ t1 - t0, t2 - t1, t3 - t2, t4 - t3 ].forEach( ( ms, i ) => Object.values( steps )[ i ].push( ms ) );

}

const median = ( values ) => values.sort( ( a, b ) => a - b )[ values.length >> 1 ];
let total = 0;

for ( const [ name, values ] of Object.entries( steps ) ) {

	const ms = median( values );
	total += ms;
	console.log( `${name.padEnd( 22 )} ${ms.toFixed( 2 ).padStart( 7 )} ms   ${( ms * 1e6 / nodes ).toFixed( 0 ).padStart( 4 )} ns per node` );

}

console.log( `${'total'.padEnd( 22 )} ${total.toFixed( 2 ).padStart( 7 )} ms   for ${nodes.toLocaleString( 'en' )} nodes` );
