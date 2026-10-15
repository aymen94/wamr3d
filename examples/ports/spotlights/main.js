// three.js example "webgl_lights_spotlights", MIT License, © three.js authors.
// https://threejs.org/examples/#webgl_lights_spotlights

import TWEEN from 'https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@23.1.3/dist/tween.esm.js';
import { loadLibrary, Stats } from '../lib.js';
import { OrbitControls } from '../controls.js';

const THREE = await loadLibrary();
const stats = new Stats();

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setAnimationLoop( animate );

const camera = new THREE.PerspectiveCamera( 35, window.innerWidth / window.innerHeight, 0.1, 100 );

const controls = new OrbitControls( camera, renderer.domElement );

const scene = new THREE.Scene();

// MeshPhongMaterial is not available in WAMR3D; Lambert gives the same diffuse look.
const matFloor = new THREE.MeshLambertMaterial( { color: 0x808080 } );
const matBox = new THREE.MeshLambertMaterial( { color: 0xaaaaaa } );

const geoFloor = new THREE.PlaneGeometry( 100, 100 );
const geoBox = new THREE.BoxGeometry( 0.3, 0.1, 0.2 );

const mshFloor = new THREE.Mesh( geoFloor, matFloor );
mshFloor.rotation.x = - Math.PI * 0.5;
const mshBox = new THREE.Mesh( geoBox, matBox );

const ambient = new THREE.AmbientLight( 0x444444 );

const spotLight1 = createSpotlight( 0xFF7F00 );
const spotLight2 = createSpotlight( 0x00FF7F );
const spotLight3 = createSpotlight( 0x7F00FF );

function init() {

	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;

	camera.position.set( 4.6, 2.2, - 2.1 );

	spotLight1.position.set( 1.5, 4, 4.5 );
	spotLight2.position.set( 0, 4, 3.5 );
	spotLight3.position.set( - 1.5, 4, 4.5 );

	mshFloor.receiveShadow = true;
	mshFloor.position.set( 0, - 0.05, 0 );

	mshBox.castShadow = true;
	mshBox.receiveShadow = true;
	mshBox.position.set( 0, 0.5, 0 );

	scene.add( mshFloor );
	scene.add( mshBox );
	scene.add( ambient );
	scene.add( spotLight1, spotLight2, spotLight3 );

	// SpotLightHelper is not available in WAMR3D yet, so the cones are not drawn.

	document.body.appendChild( renderer.domElement );
	window.addEventListener( 'resize', onWindowResize );

	controls.target.set( 0, 0.5, 0 );
	controls.maxPolarAngle = Math.PI / 2;
	controls.minDistance = 1;
	controls.maxDistance = 10;
	controls.update();

}

function createSpotlight( color ) {

	const newObj = new THREE.SpotLight( color, 10 );

	newObj.castShadow = true;
	newObj.angle = 0.3;
	newObj.penumbra = 0.2;
	newObj.decay = 2;
	newObj.distance = 50;

	return newObj;

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}

function tween( light ) {

	new TWEEN.Tween( light ).to( {
		angle: ( Math.random() * 0.7 ) + 0.1,
		penumbra: Math.random() + 1
	}, Math.random() * 3000 + 2000 )
		.easing( TWEEN.Easing.Quadratic.Out ).start();

	new TWEEN.Tween( light.position ).to( {
		x: ( Math.random() * 3 ) - 1.5,
		y: ( Math.random() * 1 ) + 1.5,
		z: ( Math.random() * 3 ) - 1.5
	}, Math.random() * 3000 + 2000 )
		.easing( TWEEN.Easing.Quadratic.Out ).start();

}

function updateTweens() {

	tween( spotLight1 );
	tween( spotLight2 );
	tween( spotLight3 );

	setTimeout( updateTweens, 5000 );

}

function animate() {

	TWEEN.update();

	renderer.render( scene, camera );

	stats.update();

}

init();

updateTweens();
