// WAMR3D on its own: the engine updates the scene and prepares the frame, and the
// package's WebGPU host draws it. No other library is loaded.
//
// engine=native uses the batched World calls; engine=api builds and animates the same
// scene through the object API, one property at a time.

import { init, World, Renderer, Color } from '../../dist/wamr3d/index.js';
import { createBackend } from '../../dist/wamr3d/webgpu.js';
import { animate, boxData, floorData, COLORS, FLOOR, CUBE, FIRST_SATELLITE } from './scene.js';


export async function createEngine( canvas, description, cameraState ) {

	const initStart = performance.now();
	await init();
	const wasmInitMs = performance.now() - initStart;

	const backend = await createBackend( canvas, { antialias: true } );
	const { count, parents, positions, scales, satellites } = description;

	const world = new World(), frame = new Renderer();
	const handles = world.createObjects( count ), camera = world.createObject();
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
		return geometry;

	}

	const materials = [ 0x2a2f38, 0x4f8cff, ...COLORS ].map( ( hex ) => {

		const material = world.createMaterial( '' ), color = Color.fromHex( hex );
		world.setMaterialColor( material, color.r, color.g, color.b );
		world.setMaterialShading( material, 2, 0.55, 0.05 );
		color.free();
		return material;

	} );

	const floor = shape( floorData( 20 ) ), cube = shape( boxData( 1.4, 1.4, 1.4 ) ), satellite = shape( boxData( 1, 1, 1 ) );

	for ( let i = FLOOR; i < count; i ++ ) {

		if ( i === FLOOR ) world.setRenderable( handles[ i ], floor, materials[ 0 ] );
		else if ( i === CUBE ) world.setRenderable( handles[ i ], cube, materials[ 1 ] );
		else if ( i >= FIRST_SATELLITE ) world.setRenderable( handles[ i ], satellite, materials[ 2 + ( i - FIRST_SATELLITE ) % 3 ] );
		world.setFrustumCulled( handles[ i ], false );

	}

	const sky = Color.fromHex( 0xbfd4ff ), ground = Color.fromHex( 0x30281e ), back = Color.fromHex( 0x14161a );
	const BACKGROUND = { r: back.r, g: back.g, b: back.b, a: 1 };
	frame.setDirectionalLight( 4, 8, 5, 1, 1, 1, 2.2 );
	frame.setAmbientLight( sky.r * 0.9, sky.g * 0.9, sky.b * 0.9, ground.r * 0.9, ground.g * 0.9, ground.b * 0.9 );

	const angles = new Float32Array( count * 3 );
	let aspect = 0;

	return {

		name: 'WAMR3D (WebGPU)',
		wasmInitMs,
		objectCount: () => world.objectCount() - 1,

		/** CPU side: this frame's rotations, world matrices and camera matrices. */
		update( time ) {

			animate( time, satellites, angles );
			world.setRotations( handles, angles, 'XYZ' );
			world.updateMatrixWorld( handles[ 0 ], false );

			const { yaw, pitch, distance, target, fov, near, far } = cameraState;

			if ( cameraState.aspect !== aspect ) {

				aspect = cameraState.aspect;
				world.setPerspectiveCamera( camera, fov, aspect, near, far, true );

			}

			const flat = distance * Math.cos( pitch );
			world.setPosition( camera, target[ 0 ] + flat * Math.sin( yaw ), target[ 1 ] - distance * Math.sin( pitch ), target[ 2 ] + flat * Math.cos( yaw ) );
			world.lookAt( camera, target[ 0 ], target[ 1 ], target[ 2 ] );
			world.updateMatrixWorld( camera, false );

		},

		/** Culling, ordering and uniform packing in the engine, then the WebGPU calls. */
		render() {

			backend.render( world, frame, handles[ 0 ], camera, BACKGROUND );

		},

		setSize( width, height ) {

			canvas.width = width;
			canvas.height = height;

		}

	};

}

export async function createApiEngine( canvas, description, cameraState ) {

	const WAMR3D = await import( '../../dist/wamr3d/compat.js' );
	const { buildScene } = await import( '../webgpu/scene.js' );

	const initStart = performance.now();
	await WAMR3D.init();
	const wasmInitMs = performance.now() - initStart;

	const renderer = new WAMR3D.WebGPURenderer( { canvas, antialias: true } );
	await renderer.init();
	const demo = buildScene( WAMR3D, description.satellites, { standard: true } );
	demo.scene.traverse( ( object ) => ( object.frustumCulled = false ) );

	return {

		name: 'WAMR3D object API (WebGPU)',
		wasmInitMs,
		objectCount: () => demo.objectCount,

		update( time ) {

			demo.update( time );
			demo.orbit( cameraState, cameraState.aspect );
			demo.scene.updateMatrixWorld();
			demo.camera.updateMatrixWorld();

		},

		render() {

			renderer.render( demo.scene, demo.camera );

		},

		setSize( width, height ) {

			renderer.setSize( width, height, false );

		}

	};

}
