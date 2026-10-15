// Inspired by the three.js example "webgl_materials_car".
// https://threejs.org/examples/#webgl_materials_car
// Written for WAMR3D: the original loads a Ferrari glTF (with Draco compression) and paints
// it with MeshPhysicalMaterial clear coat and glass transmission under an HDR environment.
// WAMR3D has no glTF loader, MeshPhysicalMaterial or environment maps in the object API,
// so this car is built from primitives and lit with ordinary lights. The scene layout,
// moving grid, spinning wheels and colour pickers follow the original.

import { loadLibrary, Stats } from '../lib.js';
import { OrbitControls } from '../controls.js';

const THREE = await loadLibrary();
const stats = new Stats();

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild( renderer.domElement );

const camera = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 0.1, 100 );
camera.position.set( 4.25, 1.4, - 4.5 );

const controls = new OrbitControls( camera, renderer.domElement );
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI / 2;
controls.target.set( 0, 0.5, 0 );
controls.update();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x333333 );
scene.fog = new THREE.Fog( 0x333333, 10, 15 );

scene.add( new THREE.HemisphereLight( 0xffffff, 0x3a3a3a, 1.6 ) );
const key = new THREE.DirectionalLight( 0xfff1e0, 3 );
key.position.set( 4, 6, - 5 );
scene.add( key );
const rim = new THREE.DirectionalLight( 0xc8dcff, 1.6 );
rim.position.set( - 5, 3, 5 );
scene.add( rim );

const grid = new THREE.GridHelper( 20, 40, 0xffffff, 0xffffff );
grid.material.opacity = 0.2;
grid.material.depthWrite = false;
grid.material.transparent = true;
scene.add( grid );

// Materials

const bodyMaterial = new THREE.MeshStandardMaterial( { color: 0xff0000, metalness: 0.55, roughness: 0.28 } );
const detailsMaterial = new THREE.MeshStandardMaterial( { color: 0xffffff, metalness: 0.6, roughness: 0.35 } );
const glassMaterial = new THREE.MeshStandardMaterial( { color: 0xffffff, metalness: 0.25, roughness: 0, transparent: true, opacity: 0.3 } );
const tyreMaterial = new THREE.MeshStandardMaterial( { color: 0x151515, roughness: 0.9 } );
const headlightMaterial = new THREE.MeshBasicMaterial( { color: 0xfff6dc } );
const taillightMaterial = new THREE.MeshBasicMaterial( { color: 0xff2020 } );

const bodyColorInput = document.getElementById( 'body-color' );
bodyColorInput.addEventListener( 'input', function () {

	bodyMaterial.color.set( this.value );

} );

const detailsColorInput = document.getElementById( 'details-color' );
detailsColorInput.addEventListener( 'input', function () {

	detailsMaterial.color.set( this.value );

} );

const glassColorInput = document.getElementById( 'glass-color' );
glassColorInput.addEventListener( 'input', function () {

	glassMaterial.color.set( this.value );

} );

// Car, front towards -z

/** A box whose top face is narrowed, shortened, shifted along z, and lowered at the front. */
function taperedBox( width, height, depth, { top = 1, topDepth = 1, shift = 0, frontDrop = 0 } = {} ) {

	const box = new THREE.BoxGeometry( width, height, depth );
	const array = Float32Array.from( box.attributes.position.array );
	const index = Array.from( box.index.array );
	box.dispose();

	for ( let i = 0; i < array.length; i += 3 ) {

		if ( array[ i + 1 ] <= 0 ) continue;
		const front = array[ i + 2 ] < 0;
		array[ i ] *= top;
		array[ i + 2 ] = array[ i + 2 ] * topDepth + shift;
		if ( front ) array[ i + 1 ] -= frontDrop;

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( array, 3 ) );
	geometry.setIndex( index );
	geometry.computeVertexNormals();
	return geometry;

}

function part( geometry, material, x, y, z ) {

	const mesh = new THREE.Mesh( geometry, material );
	mesh.position.set( x, y, z );
	car.add( mesh );
	return mesh;

}

const car = new THREE.Group();
scene.add( car );

part( taperedBox( 1.9, 0.46, 4.4, { top: 0.94, topDepth: 0.92, frontDrop: 0.14 } ), bodyMaterial, 0, 0.53, 0 );
part( taperedBox( 1.62, 0.44, 2.1, { top: 0.78, topDepth: 0.48, shift: 0.22 } ), glassMaterial, 0, 0.98, 0.3 );
part( taperedBox( 1.27, 0.05, 1.0, { top: 0.95, topDepth: 0.9 } ), bodyMaterial, 0, 1.225, 0.52 );

// Bumpers, side skirts and the rear wing in the details colour.
part( new THREE.BoxGeometry( 1.75, 0.12, 0.16 ), detailsMaterial, 0, 0.33, - 2.2 );
part( new THREE.BoxGeometry( 1.75, 0.12, 0.16 ), detailsMaterial, 0, 0.36, 2.2 );
for ( const side of [ - 1, 1 ] ) part( new THREE.BoxGeometry( 0.06, 0.08, 1.5 ), detailsMaterial, side * 0.96, 0.36, 0 );
part( new THREE.BoxGeometry( 1.7, 0.05, 0.32 ), detailsMaterial, 0, 1.0, 2.0 );
for ( const side of [ - 1, 1 ] ) part( new THREE.BoxGeometry( 0.05, 0.2, 0.12 ), detailsMaterial, side * 0.6, 0.86, 2.02 );

for ( const side of [ - 1, 1 ] ) {

	part( new THREE.BoxGeometry( 0.42, 0.08, 0.04 ), headlightMaterial, side * 0.62, 0.6, - 2.18 );
	part( new THREE.BoxGeometry( 0.44, 0.07, 0.04 ), taillightMaterial, side * 0.6, 0.66, 2.2 );

}

const wheels = [];
const tyreGeometry = new THREE.CylinderGeometry( 0.33, 0.33, 0.26, 40 );
tyreGeometry.rotateZ( Math.PI / 2 );
const rimGeometry = new THREE.CylinderGeometry( 0.21, 0.21, 0.27, 24 );
rimGeometry.rotateZ( Math.PI / 2 );
const spokeGeometry = new THREE.BoxGeometry( 0.28, 0.38, 0.045 );

for ( const [ x, z ] of [ [ - 0.88, - 1.38 ], [ 0.88, - 1.38 ], [ - 0.88, 1.34 ], [ 0.88, 1.34 ] ] ) {

	const wheel = new THREE.Group();
	wheel.position.set( x, 0.33, z );
	wheel.add( new THREE.Mesh( tyreGeometry, tyreMaterial ) );
	wheel.add( new THREE.Mesh( rimGeometry, tyreMaterial ) );
	for ( let i = 0; i < 5; i ++ ) {

		const spoke = new THREE.Mesh( spokeGeometry, detailsMaterial );
		spoke.rotation.x = i * Math.PI / 5;
		wheel.add( spoke );

	}

	car.add( wheel );
	wheels.push( wheel );

}

// A soft dark patch under the car stands in for the original's baked shadow texture.
const canvas = document.createElement( 'canvas' );
canvas.width = 128;
canvas.height = 256;
const context = canvas.getContext( '2d' );
context.filter = 'blur(14px)';
context.fillStyle = 'rgba(0, 0, 0, 0.85)';
context.fillRect( 26, 30, 76, 196 );
const shadow = new THREE.Mesh(
	new THREE.PlaneGeometry( 0.655 * 4, 1.3 * 4 ),
	new THREE.MeshBasicMaterial( { map: new THREE.CanvasTexture( canvas ), transparent: true, depthWrite: false } )
);
shadow.rotation.x = - Math.PI / 2;
shadow.position.y = 0.002;
car.add( shadow );

window.addEventListener( 'resize', () => {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

renderer.setAnimationLoop( () => {

	controls.update();

	// The ground moves backwards at one unit a second; the wheels roll to match it.
	const time = performance.now() / 1000;
	for ( const wheel of wheels ) wheel.rotation.x = - time / 0.33;
	grid.position.z = time % 1;

	renderer.render( scene, camera );
	stats.update();

} );
