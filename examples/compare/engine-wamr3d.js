// WAMR3D side: scene state, transforms, world matrices, camera matrices and normals come
// from the WebAssembly engine. draw.js (the temporary rendering adapter) only draws them.

import { init, World, Vector3, Quaternion, Matrix4 } from '../../dist/wamr3d/index.js';
import { createDrawing, THREE } from './draw.js';
import { animate, boxData, floorData } from './scene.js';

export async function createEngine( canvas, description, cameraState ) {

	const initStart = performance.now();
	await init();
	const wasmInitMs = performance.now() - initStart;

	const drawing = createDrawing( canvas );
	const { count, parents, positions, scales, satellites } = description;

	const world = new World();
	const handles = world.createObjects( count );
	const childHandles = [], parentHandles = [], transforms = new Float32Array( count * 10 );

	for ( let i = 0; i < count; i ++ ) {

		if ( parents[ i ] >= 0 ) {

			parentHandles.push( handles[ parents[ i ] ] );
			childHandles.push( handles[ i ] );

		}

		transforms.set( [ ...positions[ i ], 0, 0, 0, 1, scales[ i ], scales[ i ], scales[ i ] ], i * 10 );

	}

	world.addMany( BigUint64Array.from( parentHandles ), BigUint64Array.from( childHandles ) );
	world.setTransforms( handles, transforms );

	function shape( data ) {

		const geometry = world.createGeometry();
		world.setAttribute( geometry, 'position', data.positions, 3 );
		world.setIndex( geometry, data.indices );
		world.computeVertexNormals( geometry );
		return { ...data, normals: world.getAttribute( geometry, 'normal' ) };

	}

	const meshes = drawing.createMeshes( count, { floor: shape( floorData( 20 ) ), cube: shape( boxData( 1.4, 1.4, 1.4 ) ), satellite: shape( boxData( 1, 1, 1 ) ) } );
	for ( const mesh of meshes ) {

		if ( ! mesh ) continue;
		mesh.matrixAutoUpdate = false;
		mesh.matrixWorldAutoUpdate = false;
		drawing.scene.add( mesh );

	}

	const camera = new THREE.PerspectiveCamera();
	camera.matrixAutoUpdate = false;
	camera.matrixWorldAutoUpdate = false;

	const angles = new Float32Array( count * 3 );
	const eye = new Vector3( 0, 0, 0 ), target = new Vector3( 0, 0, 0 ), up = new Vector3( 0, 1, 0 ), one = new Vector3( 1, 1, 1 );
	const orbit = new Quaternion( 0, 0, 0, 1 ), orientation = new Quaternion( 0, 0, 0, 1 );
	const look = new Matrix4(), cameraWorld = new Matrix4(), cameraView = new Matrix4(), projection = new Matrix4(), projectionInverse = new Matrix4();
	let matrices;

	return {

		name: 'WAMR3D',
		wasmInitMs,
		objectCount: () => world.objectCount(),

		/** CPU side: this frame's rotations, world matrices and camera matrices. */
		update( time ) {

			animate( time, satellites, angles );
			world.setRotations( handles, angles, 'XYZ' );
			world.updateMatrixWorld( handles[ 0 ], false );
			matrices = world.matricesWorld( handles );

			const { yaw, pitch, distance, fov, aspect, near, far } = cameraState;
			target.set( ...cameraState.target );
			orbit.setFromEuler( pitch, yaw, 0, 'YXZ' );
			eye.set( 0, 0, distance );
			eye.applyQuaternion( orbit );
			eye.add( target );
			look.identity();
			look.lookAt( eye, target, up );
			orientation.setFromRotationMatrix( look );
			cameraWorld.compose( eye, orientation, one );
			cameraView.copy( cameraWorld );
			cameraView.invert();
			const top = near * Math.tan( fov * Math.PI / 360 ), right = top * aspect;
			projection.makePerspective( - right, right, top, - top, near, far, false, false );
			projectionInverse.copy( projection );
			projectionInverse.invert();

		},

		/** Hands the computed matrices to the adapter and draws. */
		render() {

			for ( let i = 0; i < count; i ++ ) if ( meshes[ i ] ) meshes[ i ].matrixWorld.fromArray( matrices, i * 16 );
			camera.matrixWorld.fromArray( cameraWorld.toArray() );
			camera.matrixWorldInverse.fromArray( cameraView.toArray() );
			camera.projectionMatrix.fromArray( projection.toArray() );
			camera.projectionMatrixInverse.fromArray( projectionInverse.toArray() );
			drawing.renderer.render( drawing.scene, camera );

		},

		setSize: drawing.setSize

	};

}
