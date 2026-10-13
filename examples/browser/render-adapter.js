// Reference rendering adapter, used with ?renderer=three or when WebGPU is missing.
//
// The demo is normally drawn by WAMR3D itself (native-renderer.js). This file draws the
// same engine output with an external WebGL renderer for comparison. It only consumes
// data: vertex arrays, world matrices and camera matrices, all produced by WAMR3D. It
// computes no transforms itself; every automatic matrix update of the renderer is off.

import { loadThreeWebGL } from '../three-reference.js';

const THREE = await loadThreeWebGL();

export function createRenderAdapter( canvas ) {

	const renderer = new THREE.WebGLRenderer( { canvas, antialias: true } );
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x14161a );
	scene.matrixWorldAutoUpdate = false;

	const sun = new THREE.DirectionalLight( 0xffffff, 2.2 );
	sun.position.set( 4, 8, 5 );
	const fill = new THREE.HemisphereLight( 0xbfd4ff, 0x30281e, 0.9 );
	const grid = new THREE.GridHelper( 20, 20, 0x5a6270, 0x30353d );
	grid.position.y = 0.002;
	scene.add( sun, sun.target, fill, grid );
	// static helpers: place them once, since automatic updates are off
	for ( const object of [ sun, sun.target, fill, grid ] ) object.updateMatrixWorld( true );

	const camera = new THREE.PerspectiveCamera();
	camera.matrixAutoUpdate = false;
	camera.matrixWorldAutoUpdate = false;

	const meshes = [];

	return {

		/** Adds a mesh drawn with world matrix number `index` of setWorldMatrices(). */
		addMesh( index, { positions, normals, indices }, color ) {

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
			geometry.setIndex( new THREE.BufferAttribute( indices, 1 ) );

			const mesh = new THREE.Mesh( geometry, new THREE.MeshStandardMaterial( { color, roughness: 0.55, metalness: 0.05 } ) );
			mesh.matrixAutoUpdate = false;
			mesh.matrixWorldAutoUpdate = false;
			mesh.frustumCulled = false;
			scene.add( mesh );
			meshes.push( { mesh, index } );

		},

		/** `matrices`: 16 numbers per object, column-major. */
		setWorldMatrices( matrices ) {

			for ( const { mesh, index } of meshes ) mesh.matrixWorld.fromArray( matrices, index * 16 );

		},

		setCamera( world, view, projection, projectionInverse ) {

			camera.matrixWorld.fromArray( world );
			camera.matrixWorldInverse.fromArray( view );
			camera.projectionMatrix.fromArray( projection );
			camera.projectionMatrixInverse.fromArray( projectionInverse );

		},

		setSize( width, height ) {

			renderer.setSize( width, height, false );

		},

		render() {

			renderer.render( scene, camera );

		}

	};

}
