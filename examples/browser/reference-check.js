// Comparison mode: recomputes the demo's transforms with three.js (loaded from a
// CDN when the mode is switched on) from the same inputs and reports how far WAMR3D's
// results are from it. Used for checking only; nothing here feeds the picture.

import { loadThreeWebGL } from '../three-reference.js';

const THREE = await loadThreeWebGL();

export function createReferenceCheck( parents ) {

	const objects = parents.map( () => new THREE.Object3D() );
	parents.forEach( ( parent, i ) => {

		if ( parent >= 0 ) objects[ parent ].add( objects[ i ] );

	} );

	const camera = new THREE.PerspectiveCamera();
	let largest = 0;

	function compare( got, expected, offset = 0 ) {

		for ( let i = 0; i < 16; i ++ ) {

			const difference = Math.abs( got[ offset + i ] - expected[ i ] ) / Math.max( 1, Math.abs( expected[ i ] ) );
			if ( ! ( difference <= largest ) ) largest = difference;

		}

	}

	return {

		setPosition( i, x, y, z ) {

			objects[ i ].position.set( x, y, z );

		},

		setScale( i, x, y, z ) {

			objects[ i ].scale.set( x, y, z );

		},

		setRotation( i, x, y, z ) {

			objects[ i ].rotation.set( x, y, z, 'XYZ' );

		},

		/** Returns the largest scaled difference over all world matrices and the camera matrices. */
		check( worldMatrices, cameraWorld, cameraView, projection, cameraState ) {

			largest = 0;
			objects[ 0 ].updateMatrixWorld();
			objects.forEach( ( object, i ) => compare( worldMatrices, object.matrixWorld.elements, i * 16 ) );

			const { yaw, pitch, distance, target, fov, aspect, near, far } = cameraState;
			camera.position.set( 0, 0, distance ).applyEuler( new THREE.Euler( pitch, yaw, 0, 'YXZ' ) ).add( new THREE.Vector3( ...target ) );
			camera.lookAt( ...target );
			camera.fov = fov;
			camera.aspect = aspect;
			camera.near = near;
			camera.far = far;
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld();

			compare( cameraWorld, camera.matrixWorld.elements );
			compare( cameraView, camera.matrixWorldInverse.elements );
			compare( projection, camera.projectionMatrix.elements );

			return largest;

		}

	};

}
