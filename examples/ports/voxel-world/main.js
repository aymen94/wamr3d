// three.js example "webgl_geometry_minecraft", MIT License, © three.js authors.
// https://threejs.org/examples/#webgl_geometry_minecraft

import { loadLibrary, Stats } from '../lib.js';
import { FirstPersonControls } from '../controls.js';
import { ImprovedNoise } from './ImprovedNoise.js';

const THREE = await loadLibrary();

let container, stats;

let camera, controls, scene, renderer;

const worldWidth = 128, worldDepth = 128;
const worldHalfWidth = worldWidth / 2;
const worldHalfDepth = worldDepth / 2;
const data = generateHeight( worldWidth, worldDepth );

const timer = new THREE.Timer( performance.now() );

init();

function init() {

	container = document.getElementById( 'container' );

	camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 20000 );
	camera.position.y = getY( worldHalfWidth, worldHalfDepth ) * 100 + 100;

	scene = new THREE.Scene();
	scene.background = new THREE.Color( 0xbfd1e5 );

	// sides

	const pxGeometry = new THREE.PlaneGeometry( 100, 100 );
	pxGeometry.attributes.uv.array[ 1 ] = 0.5;
	pxGeometry.attributes.uv.array[ 3 ] = 0.5;
	pxGeometry.rotateY( Math.PI / 2 );
	pxGeometry.translate( 50, 0, 0 );

	const nxGeometry = new THREE.PlaneGeometry( 100, 100 );
	nxGeometry.attributes.uv.array[ 1 ] = 0.5;
	nxGeometry.attributes.uv.array[ 3 ] = 0.5;
	nxGeometry.rotateY( - Math.PI / 2 );
	nxGeometry.translate( - 50, 0, 0 );

	const pyGeometry = new THREE.PlaneGeometry( 100, 100 );
	pyGeometry.attributes.uv.array[ 5 ] = 0.5;
	pyGeometry.attributes.uv.array[ 7 ] = 0.5;
	pyGeometry.rotateX( - Math.PI / 2 );
	pyGeometry.translate( 0, 50, 0 );

	const pzGeometry = new THREE.PlaneGeometry( 100, 100 );
	pzGeometry.attributes.uv.array[ 1 ] = 0.5;
	pzGeometry.attributes.uv.array[ 3 ] = 0.5;
	pzGeometry.translate( 0, 0, 50 );

	const nzGeometry = new THREE.PlaneGeometry( 100, 100 );
	nzGeometry.attributes.uv.array[ 1 ] = 0.5;
	nzGeometry.attributes.uv.array[ 3 ] = 0.5;
	nzGeometry.rotateY( Math.PI );
	nzGeometry.translate( 0, 0, - 50 );

	// Each face is recorded with its offset and merged once below. The original clones a
	// face per block (`geometry.clone().applyMatrix4( matrix )`) and merges the clones
	// with the BufferGeometryUtils add-on; WAMR3D geometries have no `clone()` yet.
	const geometries = [];

	for ( let z = 0; z < worldDepth; z ++ ) {

		for ( let x = 0; x < worldWidth; x ++ ) {

			const h = getY( x, z );

			const offset = [
				x * 100 - worldHalfWidth * 100,
				h * 100,
				z * 100 - worldHalfDepth * 100
			];

			const px = getY( x + 1, z );
			const nx = getY( x - 1, z );
			const pz = getY( x, z + 1 );
			const nz = getY( x, z - 1 );

			geometries.push( [ pyGeometry, offset ] );

			if ( ( px !== h && px !== h + 1 ) || x === 0 ) {

				geometries.push( [ pxGeometry, offset ] );

			}

			if ( ( nx !== h && nx !== h + 1 ) || x === worldWidth - 1 ) {

				geometries.push( [ nxGeometry, offset ] );

			}

			if ( ( pz !== h && pz !== h + 1 ) || z === worldDepth - 1 ) {

				geometries.push( [ pzGeometry, offset ] );

			}

			if ( ( nz !== h && nz !== h + 1 ) || z === 0 ) {

				geometries.push( [ nzGeometry, offset ] );

			}

		}

	}

	const geometry = mergeGeometries( geometries );
	geometry.computeBoundingSphere();

	// The original loads `textures/minecraft/atlas.png`; the same layout (grass top in the
	// upper half, the side in the lower half) is painted here.
	const texture = new THREE.CanvasTexture( paintAtlas() );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.magFilter = THREE.NearestFilter;

	const mesh = new THREE.Mesh( geometry, new THREE.MeshLambertMaterial( { map: texture, side: THREE.DoubleSide } ) );
	scene.add( mesh );

	const ambientLight = new THREE.AmbientLight( 0xeeeeee, 3 );
	scene.add( ambientLight );

	const directionalLight = new THREE.DirectionalLight( 0xffffff, 12 );
	directionalLight.position.set( 1, 1, 0.5 ).normalize();
	scene.add( directionalLight );

	renderer = new THREE.WebGPURenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animate );
	container.appendChild( renderer.domElement );

	controls = new FirstPersonControls( camera, renderer.domElement );

	controls.movementSpeed = 1000;
	controls.lookSpeed = 0.2;
	controls.lookVertical = true;

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

function generateHeight( width, height ) {

	const data = [], perlin = new ImprovedNoise(),
		size = width * height, z = Math.random() * 100;

	let quality = 2;

	for ( let j = 0; j < 4; j ++ ) {

		if ( j === 0 ) for ( let i = 0; i < size; i ++ ) data[ i ] = 0;

		for ( let i = 0; i < size; i ++ ) {

			const x = i % width, y = ( i / width ) | 0;
			data[ i ] += perlin.noise( x / quality, y / quality, z ) * quality;

		}

		quality *= 4;

	}

	return data;

}

function getY( x, z ) {

	return ( data[ x + z * worldWidth ] * 0.15 ) | 0;

}

function mergeGeometries( faces ) {

	let vertices = 0, indices = 0;
	for ( const [ face ] of faces ) {

		vertices += face.attributes.position.count;
		indices += face.index.count;

	}

	const position = new Float32Array( vertices * 3 ), normal = new Float32Array( vertices * 3 ), uv = new Float32Array( vertices * 2 );
	const index = new Uint32Array( indices );
	let v = 0, i = 0;

	for ( const [ face, [ ox, oy, oz ] ] of faces ) {

		const p = face.attributes.position.array, n = face.attributes.normal.array, t = face.attributes.uv.array, f = face.index.array;
		for ( let k = 0; k < f.length; k ++ ) index[ i ++ ] = f[ k ] + v;
		for ( let k = 0, count = face.attributes.position.count; k < count; k ++, v ++ ) {

			position[ v * 3 ] = p[ k * 3 ] + ox;
			position[ v * 3 + 1 ] = p[ k * 3 + 1 ] + oy;
			position[ v * 3 + 2 ] = p[ k * 3 + 2 ] + oz;
			normal.set( [ n[ k * 3 ], n[ k * 3 + 1 ], n[ k * 3 + 2 ] ], v * 3 );
			uv.set( [ t[ k * 2 ], t[ k * 2 + 1 ] ], v * 2 );

		}

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normal, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	geometry.setIndex( new THREE.BufferAttribute( index, 1 ) );
	return geometry;

}

function paintAtlas() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 16;
	canvas.height = 32;
	const context = canvas.getContext( '2d' );
	const pixel = ( x, y, [ r, g, b ], spread ) => {

		const k = 1 + ( Math.random() - 0.5 ) * spread;
		context.fillStyle = `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
		context.fillRect( x, y, 1, 1 );

	};

	const grass = [ 106, 170, 64 ], dirt = [ 134, 96, 67 ];
	for ( let y = 0; y < 16; y ++ ) for ( let x = 0; x < 16; x ++ ) pixel( x, y, grass, 0.35 );
	for ( let y = 16; y < 32; y ++ ) for ( let x = 0; x < 16; x ++ ) pixel( x, y, y < 19 + ( Math.random() * 3 | 0 ) ? grass : dirt, 0.3 );
	return canvas;

}

function animate( timestamp ) {

	timer.update( timestamp );

	render();
	stats.update();

}

function render() {

	controls.update( timer.getDelta() );
	renderer.render( scene, camera );

}
