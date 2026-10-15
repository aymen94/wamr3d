// Inspired by the three.js example "webgl_gpgpu_water".
// https://threejs.org/examples/#webgl_gpgpu_water
// Written for WAMR3D: the original runs its height field on the GPU with
// GPUComputationRenderer and a custom ShaderMaterial, neither of which WAMR3D has, so this
// page runs the same kind of wave equation in JavaScript and updates an ordinary
// BufferGeometry every frame.

import { loadLibrary, Stats } from '../lib.js';
import { OrbitControls } from '../controls.js';

const THREE = await loadLibrary();
const stats = new Stats();

const WIDTH = 128;
const BOUNDS = 6;
const SPACING = BOUNDS / ( WIDTH - 1 );

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x9fc6de );
scene.fog = new THREE.Fog( 0x9fc6de, 12, 30 );

const camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.1, 100 );
camera.position.set( 0, 5, 7.4 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.set( 0, 0, 0 );
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 3;
controls.maxDistance = 16;
controls.update();

scene.add( new THREE.HemisphereLight( 0xdff1ff, 0x335566, 1.4 ) );
const sun = new THREE.DirectionalLight( 0xfff4e0, 3 );
sun.position.set( - 3, 6, - 4 );
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = - 5;
sun.shadow.camera.right = sun.shadow.camera.top = 5;
scene.add( sun );

// The pool: a floor and four walls around the water.
const stone = new THREE.MeshStandardMaterial( { color: 0xd8d2c4, roughness: 0.85 } );
const floor = new THREE.Mesh( new THREE.BoxGeometry( BOUNDS + 0.6, 0.3, BOUNDS + 0.6 ), stone );
floor.position.y = - 0.9;
floor.receiveShadow = true;
scene.add( floor );

for ( const [ x, z, w, d ] of [ [ 0, - 1, BOUNDS + 0.6, 0.3 ], [ 0, 1, BOUNDS + 0.6, 0.3 ], [ - 1, 0, 0.3, BOUNDS ], [ 1, 0, 0.3, BOUNDS ] ] ) {

	const wall = new THREE.Mesh( new THREE.BoxGeometry( w, 1.2, d ), stone );
	wall.position.set( x * ( BOUNDS / 2 + 0.15 ), - 0.25, z * ( BOUNDS / 2 + 0.15 ) );
	wall.castShadow = wall.receiveShadow = true;
	scene.add( wall );

}

const ground = new THREE.Mesh( new THREE.PlaneGeometry( 80, 80 ), new THREE.MeshLambertMaterial( { color: 0x7c9a5c } ) );
ground.rotation.x = - Math.PI / 2;
ground.position.y = - 0.85;
ground.receiveShadow = true;
scene.add( ground );

// The water surface: one vertex per height-field cell. After rotateX the plane lies in
// XZ, row r at z = -BOUNDS/2 + r * SPACING and column c at x = -BOUNDS/2 + c * SPACING.
const geometry = new THREE.PlaneGeometry( BOUNDS, BOUNDS, WIDTH - 1, WIDTH - 1 );
geometry.rotateX( - Math.PI / 2 );
const water = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { color: 0x0f5a86, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.93 } ) );
water.receiveShadow = true;
scene.add( water );

let height = new Float32Array( WIDTH * WIDTH );
let previous = new Float32Array( WIDTH * WIDTH );

function disturb( x, z, radius, depth ) {

	const cx = ( x + BOUNDS / 2 ) / SPACING, cz = ( z + BOUNDS / 2 ) / SPACING, r = radius / SPACING;
	for ( let row = Math.max( 1, Math.floor( cz - r ) ); row <= Math.min( WIDTH - 2, Math.ceil( cz + r ) ); row ++ ) {

		for ( let col = Math.max( 1, Math.floor( cx - r ) ); col <= Math.min( WIDTH - 2, Math.ceil( cx + r ) ); col ++ ) {

			const d = Math.hypot( col - cx, row - cz ) / r;
			if ( d < 1 ) height[ row * WIDTH + col ] -= depth * 0.5 * ( Math.cos( d * Math.PI ) + 1 );

		}

	}

}

// One step of the discrete wave equation; the edge cells stay at rest.
function simulate() {

	const next = previous;
	for ( let row = 1; row < WIDTH - 1; row ++ ) {

		for ( let col = 1; col < WIDTH - 1; col ++ ) {

			const i = row * WIDTH + col;
			const neighbours = height[ i - 1 ] + height[ i + 1 ] + height[ i - WIDTH ] + height[ i + WIDTH ];
			next[ i ] = ( neighbours * 0.5 - next[ i ] ) * 0.985;

		}

	}

	previous = height;
	height = next;

}

function heightAt( x, z ) {

	const col = Math.min( WIDTH - 1, Math.max( 0, Math.round( ( x + BOUNDS / 2 ) / SPACING ) ) );
	const row = Math.min( WIDTH - 1, Math.max( 0, Math.round( ( z + BOUNDS / 2 ) / SPACING ) ) );
	return height[ row * WIDTH + col ];

}

const positions = geometry.attributes.position;
const normals = geometry.attributes.normal;

function writeSurface() {

	const p = positions.array, n = normals.array;
	for ( let row = 0; row < WIDTH; row ++ ) {

		for ( let col = 0; col < WIDTH; col ++ ) {

			const i = row * WIDTH + col;
			p[ i * 3 + 1 ] = height[ i ];
			const dx = ( height[ row * WIDTH + Math.min( WIDTH - 1, col + 1 ) ] - height[ row * WIDTH + Math.max( 0, col - 1 ) ] ) / ( 2 * SPACING );
			const dz = ( height[ Math.min( WIDTH - 1, row + 1 ) * WIDTH + col ] - height[ Math.max( 0, row - 1 ) * WIDTH + col ] ) / ( 2 * SPACING );
			const length = Math.hypot( dx, 1, dz );
			n[ i * 3 ] = - dx / length;
			n[ i * 3 + 1 ] = 1 / length;
			n[ i * 3 + 2 ] = - dz / length;

		}

	}

	positions.needsUpdate = true;
	normals.needsUpdate = true;

}

// Floating balls ride the surface and slide down its slope.
const balls = [];
const ballColors = [ 0xffc93c, 0xff6b6b, 0x5ee6a8, 0xffffff, 0xa98bff ];
for ( let i = 0; i < 5; i ++ ) {

	const ball = new THREE.Mesh( new THREE.SphereGeometry( 0.16, 24, 16 ), new THREE.MeshStandardMaterial( { color: ballColors[ i ], roughness: 0.35 } ) );
	ball.castShadow = true;
	ball.position.set( ( Math.random() - 0.5 ) * 4, 0, ( Math.random() - 0.5 ) * 4 );
	ball.userData.velocity = { x: 0, z: 0 };
	scene.add( ball );
	balls.push( ball );

}

function floatBalls() {

	const limit = BOUNDS / 2 - 0.25;
	for ( const ball of balls ) {

		const { x, z } = ball.position;
		const v = ball.userData.velocity;
		v.x = ( v.x - ( heightAt( x + 0.05, z ) - heightAt( x - 0.05, z ) ) * 0.12 ) * 0.97;
		v.z = ( v.z - ( heightAt( x, z + 0.05 ) - heightAt( x, z - 0.05 ) ) * 0.12 ) * 0.97;
		ball.position.x = Math.min( limit, Math.max( - limit, x + v.x ) );
		ball.position.z = Math.min( limit, Math.max( - limit, z + v.z ) );
		if ( Math.abs( ball.position.x ) === limit ) v.x *= - 0.5;
		if ( Math.abs( ball.position.z ) === limit ) v.z *= - 0.5;
		ball.position.y += ( heightAt( ball.position.x, ball.position.z ) + 0.08 - ball.position.y ) * 0.3;

	}

}

// The pointer drags a ripple across the water; the surface is treated as the plane y = 0.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false, lastPointer = - Infinity;

renderer.domElement.addEventListener( 'pointermove', ( event ) => {

	pointer.set( event.clientX / window.innerWidth * 2 - 1, - ( event.clientY / window.innerHeight ) * 2 + 1 );
	pointerActive = ! event.buttons;
	lastPointer = performance.now();

} );
renderer.domElement.addEventListener( 'pointerleave', () => pointerActive = false );

function pointerOnWater() {

	raycaster.setFromCamera( pointer, camera );
	const { origin, direction } = raycaster.ray;
	if ( direction.y >= 0 ) return null;
	const t = - origin.y / direction.y;
	const x = origin.x + direction.x * t, z = origin.z + direction.z * t;
	return Math.abs( x ) < BOUNDS / 2 && Math.abs( z ) < BOUNDS / 2 ? { x, z } : null;

}

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

let nextDrop = 0;

renderer.setAnimationLoop( ( time ) => {

	const seconds = time / 1000;

	if ( pointerActive ) {

		const hit = pointerOnWater();
		if ( hit ) disturb( hit.x, hit.z, 0.2, 0.012 );

	}

	// Rain when the pointer has been away for a while.
	if ( performance.now() - lastPointer > 3000 && seconds > nextDrop ) {

		disturb( ( Math.random() - 0.5 ) * BOUNDS * 0.85, ( Math.random() - 0.5 ) * BOUNDS * 0.85, 0.12 + Math.random() * 0.15, 0.22 );
		nextDrop = seconds + 0.25 + Math.random() * 0.6;

	}

	simulate();
	writeSurface();
	floatBalls();

	renderer.render( scene, camera );
	stats.update();

} );
