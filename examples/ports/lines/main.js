// three.js example "webgl_buffergeometry_lines" (r186), MIT License, © three.js authors.
// https://threejs.org/examples/#webgl_buffergeometry_lines

import { loadLibrary, Stats } from '../lib.js';

const THREE = await loadLibrary();

let container, stats, timer;

let camera, scene, renderer;
let line;

const segments = 10000;
const r = 800;
let t = 0;

// WAMR3D has no morph targets yet: the blend towards the target shape runs here, on the
// position attribute, instead of `line.morphTargetInfluences[ 0 ]`.
let basePositions, targetPositions;

init();

function init() {

	container = document.getElementById( 'container' );

	//

	camera = new THREE.PerspectiveCamera( 27, window.innerWidth / window.innerHeight, 1, 4000 );
	camera.position.z = 2750;

	scene = new THREE.Scene();

	timer = new THREE.Timer( performance.now() );

	const geometry = new THREE.BufferGeometry();
	const material = new THREE.LineBasicMaterial( { vertexColors: true } );

	const positions = [];
	const colors = [];

	for ( let i = 0; i < segments; i ++ ) {

		const x = Math.random() * r - r / 2;
		const y = Math.random() * r - r / 2;
		const z = Math.random() * r - r / 2;

		// positions

		positions.push( x, y, z );

		// colors

		colors.push( ( x / r ) + 0.5 );
		colors.push( ( y / r ) + 0.5 );
		colors.push( ( z / r ) + 0.5 );

	}

	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	basePositions = Float32Array.from( positions );
	generateMorphTargets();

	geometry.computeBoundingSphere();

	line = new THREE.Line( geometry, material );
	scene.add( line );

	//

	renderer = new THREE.WebGPURenderer();
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animate );

	container.appendChild( renderer.domElement );

	//

	stats = new Stats();
	container.appendChild( stats.dom );

	//

	window.addEventListener( 'resize', onWindowResize );

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}

//

function animate( timestamp ) {

	timer.update( timestamp );

	const delta = timer.getDelta();
	const time = timer.getElapsed();

	line.rotation.x = time * 0.25;
	line.rotation.y = time * 0.5;

	t += delta * 0.5;
	morph( Math.abs( Math.sin( t ) ) );

	renderer.render( scene, camera );

	stats.update();

}

function generateMorphTargets() {

	const data = [];

	for ( let i = 0; i < segments; i ++ ) {

		const x = Math.random() * r - r / 2;
		const y = Math.random() * r - r / 2;
		const z = Math.random() * r - r / 2;

		data.push( x, y, z );

	}

	targetPositions = Float32Array.from( data );

}

function morph( influence ) {

	const attribute = line.geometry.attributes.position;
	const array = attribute.array;
	for ( let i = 0; i < array.length; i ++ ) array[ i ] = basePositions[ i ] + ( targetPositions[ i ] - basePositions[ i ] ) * influence;
	attribute.needsUpdate = true;

}
