// Baseline: the scene driven entirely by three.js r186. No WAMR3D code runs here.

import { createDrawing, THREE } from './draw.js';
import { animate, boxData, floorData } from './scene.js';

export async function createEngine( canvas, description, cameraState ) {

	const drawing = createDrawing( canvas );
	const { count, parents, positions, scales, satellites } = description;

	function shape( data ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( data.positions, 3 ) );
		g.setIndex( new THREE.BufferAttribute( data.indices, 1 ) );
		g.computeVertexNormals();
		return { ...data, normals: g.getAttribute( 'normal' ).array };

	}

	const meshes = drawing.createMeshes( count, { floor: shape( floorData( 20 ) ), cube: shape( boxData( 1.4, 1.4, 1.4 ) ), satellite: shape( boxData( 1, 1, 1 ) ) } );
	const objects = meshes.map( ( mesh ) => mesh || new THREE.Object3D() );
	const root = objects[ 0 ];

	objects.forEach( ( object, i ) => {

		if ( parents[ i ] >= 0 ) objects[ parents[ i ] ].add( object );
		object.position.set( ...positions[ i ] );
		object.scale.setScalar( scales[ i ] );
		object.matrixWorldAutoUpdate = true;

	} );
	drawing.scene.add( root );

	const camera = new THREE.PerspectiveCamera();
	const angles = new Float32Array( count * 3 );
	const orbit = new THREE.Euler( 0, 0, 0, 'YXZ' ), target = new THREE.Vector3();

	return {

		name: 'three.js r186',
		objectCount: () => count,

		/** CPU side: this frame's rotations, world matrices and camera matrices. */
		update( time ) {

			animate( time, satellites, angles );
			for ( let i = 0, o = 0; i < count; i ++, o += 3 ) objects[ i ].rotation.set( angles[ o ], angles[ o + 1 ], angles[ o + 2 ], 'XYZ' );
			root.updateMatrixWorld();

			target.fromArray( cameraState.target );
			orbit.set( cameraState.pitch, cameraState.yaw, 0, 'YXZ' );
			camera.position.set( 0, 0, cameraState.distance ).applyEuler( orbit ).add( target );
			camera.lookAt( target );
			camera.fov = cameraState.fov;
			camera.aspect = cameraState.aspect;
			camera.near = cameraState.near;
			camera.far = cameraState.far;
			camera.updateProjectionMatrix();
			camera.updateMatrixWorld();

		},

		render() {

			drawing.renderer.render( drawing.scene, camera );

		},

		setSize: drawing.setSize

	};

}
