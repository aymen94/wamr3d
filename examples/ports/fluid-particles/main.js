// Inspired by the three.js example "webgpu_compute_particles_fluid".
// https://threejs.org/examples/#webgpu_compute_particles_fluid
// Written for WAMR3D: the original simulates on the GPU with TSL compute shaders, which
// WAMR3D does not have, so this page simulates on the CPU (`fluid.js`) and draws the
// particles as one InstancedMesh.

import { loadLibrary, Stats } from '../lib.js';
import { OrbitControls } from '../controls.js';
import { Fluid } from './fluid.js';

const THREE = await loadLibrary();
const stats = new Stats();

// Simulation units to world units.
const SCALE = 0.25;
const fluid = new Fluid( { width: 24, height: 14, depth: 8, blockX: 20, blockY: 18, blockZ: 11 } );
const offset = [ - fluid.width / 2, - fluid.height / 2, - fluid.depth / 2 ];

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x0b0f17 );

const camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.1, 100 );
camera.position.set( 0, 2.2, 7.5 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.set( 0, - 0.4, 0 );
controls.minDistance = 3;
controls.maxDistance = 14;
controls.update();

scene.add( new THREE.HemisphereLight( 0xbfdcff, 0x1a1e28, 1.2 ) );
const sun = new THREE.DirectionalLight( 0xffffff, 2.5 );
sun.position.set( 3, 6, 4 );
scene.add( sun );

// The tank tilts; particles live in its frame, so tilting it sloshes the fluid.
const tank = new THREE.Group();
scene.add( tank );

const edges = [];
const hx = fluid.width * SCALE / 2, hy = fluid.height * SCALE / 2, hz = fluid.depth * SCALE / 2;
for ( const [ a, b ] of [ [ 0, 1 ], [ 1, 3 ], [ 3, 2 ], [ 2, 0 ], [ 4, 5 ], [ 5, 7 ], [ 7, 6 ], [ 6, 4 ], [ 0, 4 ], [ 1, 5 ], [ 2, 6 ], [ 3, 7 ] ] ) {

	for ( const c of [ a, b ] ) edges.push( c & 1 ? hx : - hx, c & 2 ? hy : - hy, c & 4 ? hz : - hz );

}

const frame = new THREE.BufferGeometry();
frame.setAttribute( 'position', new THREE.Float32BufferAttribute( edges, 3 ) );
tank.add( new THREE.LineSegments( frame, new THREE.LineBasicMaterial( { color: 0x5b6b85 } ) ) );

const floor = new THREE.Mesh( new THREE.PlaneGeometry( 30, 30 ), new THREE.MeshStandardMaterial( { color: 0x151b26, roughness: 0.9 } ) );
floor.rotation.x = - Math.PI / 2;
floor.position.y = - hy - 0.6;
scene.add( floor );

const particles = new THREE.InstancedMesh(
	new THREE.SphereGeometry( 0.3 * SCALE, 10, 6 ),
	new THREE.MeshStandardMaterial( { roughness: 0.25, metalness: 0.1 } ),
	fluid.count
);

const white = new THREE.Color( 0xffffff );
for ( let i = 0; i < fluid.count; i ++ ) particles.setColorAt( i, white );
tank.add( particles );

const deep = new THREE.Color( 0x0a3dd6 ), mid = new THREE.Color( 0x20c4ff ), foam = new THREE.Color( 0xf2fbff );

function writeInstances() {

	const matrices = particles.instanceMatrix.array;
	const colors = particles.instanceColor.array;
	const { position, velocity } = fluid;

	for ( let i = 0; i < fluid.count; i ++ ) {

		// Identity rotation and scale; only the translation column changes.
		const m = i * 16;
		matrices[ m ] = matrices[ m + 5 ] = matrices[ m + 10 ] = matrices[ m + 15 ] = 1;
		matrices[ m + 12 ] = ( position[ i * 3 ] + offset[ 0 ] ) * SCALE;
		matrices[ m + 13 ] = ( position[ i * 3 + 1 ] + offset[ 1 ] ) * SCALE;
		matrices[ m + 14 ] = ( position[ i * 3 + 2 ] + offset[ 2 ] ) * SCALE;

		const speed = Math.min( 1, Math.hypot( velocity[ i * 3 ], velocity[ i * 3 + 1 ], velocity[ i * 3 + 2 ] ) * 6 );
		const [ from, to, t ] = speed < 0.5 ? [ deep, mid, speed * 2 ] : [ mid, foam, speed * 2 - 1 ];
		colors[ i * 3 ] = from.r + ( to.r - from.r ) * t;
		colors[ i * 3 + 1 ] = from.g + ( to.g - from.g ) * t;
		colors[ i * 3 + 2 ] = from.b + ( to.b - from.b ) * t;

	}

	particles.instanceMatrix.needsUpdate = true;
	particles.instanceColor.needsUpdate = true;

}

// Tilt follows the pointer while it moves and sways by itself when it is idle.
let pointerTilt = 0, lastPointer = - Infinity, tilt = 0;
renderer.domElement.addEventListener( 'pointermove', ( event ) => {

	if ( event.buttons ) return;
	pointerTilt = ( event.clientX / window.innerWidth * 2 - 1 ) * 0.45;
	lastPointer = performance.now();

} );

// A double click splashes where the fluid is, below the pointer.
renderer.domElement.addEventListener( 'dblclick', ( event ) => {

	const x = ( event.clientX / window.innerWidth ) * fluid.width;
	fluid.splash( x, 1, fluid.depth / 2, 5, 0.25 );

} );

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

let nextDrop = 4;

renderer.setAnimationLoop( ( time ) => {

	const elapsed = time / 1000;

	const idle = performance.now() - lastPointer > 2500;
	const target = idle ? Math.sin( elapsed * 0.7 ) * 0.3 : pointerTilt;
	tilt += ( target - tilt ) * 0.05;
	tank.rotation.z = tilt;

	// Gravity in the tank's frame: world down rotated by the opposite of the tilt.
	const g = 0.006;
	fluid.gravity[ 0 ] = - Math.sin( tilt ) * g;
	fluid.gravity[ 1 ] = - Math.cos( tilt ) * g;

	if ( idle && elapsed > nextDrop ) {

		fluid.splash( 3 + Math.random() * ( fluid.width - 6 ), 1, fluid.depth / 2, 4, 0.2 );
		nextDrop = elapsed + 5 + Math.random() * 3;

	}

	fluid.step();
	writeInstances();
	renderer.render( scene, camera );
	stats.update();

} );
