// Draws the demo with WAMR3D's own WebGPU renderer: the engine culls, orders and packs
// the frame, and the package's WebGPU host issues the draw calls. No other library.

import { Renderer, Color } from '../../dist/wamr3d/index.js';
import { createBackend } from '../../dist/wamr3d/webgpu.js';

function linear( hex ) {

	const color = Color.fromHex( hex ), value = [ color.r, color.g, color.b ];
	color.free();
	return value;

}

export async function createNativeRenderer( canvas, world, root ) {

	const backend = await createBackend( canvas, { antialias: true } );
	const frame = new Renderer();
	const ratio = Math.min( window.devicePixelRatio, 2 );
	const [ r, g, b ] = linear( 0x14161a ), background = { r, g, b, a: 1 };

	const sky = linear( 0xbfd4ff ), ground = linear( 0x30281e );
	frame.setDirectionalLight( 4, 8, 5, 1, 1, 1, 2.2 );
	frame.setAmbientLight( ...sky.map( ( c ) => c * 0.9 ), ...ground.map( ( c ) => c * 0.9 ) );

	// A 20 x 20 grid of line segments just above the floor, the centre lines brighter.
	const positions = [], colors = [], center = linear( 0x5a6270 ), other = linear( 0x30353d );

	for ( let i = - 10; i <= 10; i ++ ) {

		positions.push( - 10, 0, i, 10, 0, i, i, 0, - 10, i, 0, 10 );
		for ( let k = 0; k < 4; k ++ ) colors.push( ...( i === 0 ? center : other ) );

	}

	const gridGeometry = world.createGeometry(), gridMaterial = world.createMaterial( 'grid' ), grid = world.createObject();
	world.setAttribute( gridGeometry, 'position', new Float32Array( positions ), 3 );
	world.setAttribute( gridGeometry, 'color', new Float32Array( colors ), 3 );
	world.setMaterialShading( gridMaterial, 1, 1, 0 );
	world.setMaterialState( gridMaterial, false, 1, true, true, true );
	world.setLine( grid, gridGeometry, gridMaterial, true );
	world.setPosition( grid, 0, 0.002, 0 );
	world.add( root, grid );

	const camera = world.createObject();
	let aspect = 0;

	return {

		name: 'WAMR3D (WebGPU)',
		info: backend.info,

		/** A material for one mesh colour; the engine owns it. */
		createMaterial( hex ) {

			const material = world.createMaterial( '' );
			world.setMaterialColor( material, ...linear( hex ) );
			world.setMaterialShading( material, 2, 0.55, 0.05 );
			return material;

		},

		/** The engine computes the view and projection from the orbit state. */
		setCamera( eye, { target, fov, aspect: nextAspect, near, far } ) {

			if ( nextAspect !== aspect ) world.setPerspectiveCamera( camera, fov, aspect = nextAspect, near, far, true );
			world.setPosition( camera, eye[ 0 ], eye[ 1 ], eye[ 2 ] );
			world.lookAt( camera, target[ 0 ], target[ 1 ], target[ 2 ] );
			world.updateMatrixWorld( camera, false );

		},

		setSize( width, height ) {

			canvas.width = Math.max( 1, Math.floor( width * ratio ) );
			canvas.height = Math.max( 1, Math.floor( height * ratio ) );

		},

		render() {

			backend.render( world, frame, root, camera, background );

		}

	};

}
