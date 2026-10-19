// WAMR3D through its batched API: the scene graph lives in WebAssembly, every frame
// sends all rotations in one call, and the engine's own WebGPU renderer draws.
// No other library is loaded.

import { init, World, Renderer, Color, memory } from '../../dist/wamr3d/index.js';
import { createBackend } from '../../dist/wamr3d/webgpu.js';
import { createWebGLBackend } from '../../dist/wamr3d/webgl.js';
import { animate, cameraPosition, BACKGROUND, SUN_COLOR, PALETTE, CAMERA, SUN_LIGHT, FILL_LIGHT, SKY, GROUND, SHAPE_ARGUMENTS } from './scene.js';

const TAU = Math.PI * 2;

function linear( hex ) {

	const color = Color.fromHex( hex ), value = [ color.r, color.g, color.b ];
	color.free();
	return value;

}

// `webgl` draws the same prepared frames with the WebGL 2 host instead of WebGPU.
export async function createEngine( canvas, scene, config, webgl = false, mixed = false ) {

	await init();
	const backend = webgl ? await createWebGLBackend( canvas, { antialias: true } ) : await createBackend( canvas, { antialias: true } );
	const world = new World(), frame = new Renderer();
	const palette = PALETTE.map( linear );
	const { nodes, bodies, firstBody, parent, position, scale, bodyBelt, bodyShape, groups } = scene;
	const math = mixed ? await import( '../../dist/wamr3d/math.js' ) : null;

	// ---- scene graph: every node is an engine object; parents and transforms go in as arrays

	const stage = world.createObject(), handles = world.createObjects( nodes );
	const transforms = new Float32Array( nodes * 10 );
	const angles = scene.angles;
	const euler = mixed ? new math.Euler() : null;
	const quaternion = mixed ? new math.Quaternion() : null;

	for ( let i = 0; i < nodes; i ++ ) transforms.set( [ position[ i * 3 ], position[ i * 3 + 1 ], position[ i * 3 + 2 ], 0, 0, 0, 1, scale[ i ], scale[ i ], scale[ i ] ], i * 10 );

	world.addMany( BigUint64Array.from( parent.subarray( 1 ), ( p ) => handles[ p ] ), handles.subarray( 1 ) );
	world.setTransforms( handles, transforms );
	world.add( stage, handles[ 0 ] );

	// ---- geometry and materials

	const shapes = {
		box: world.createBoxGeometry( ...SHAPE_ARGUMENTS.box, 1, 1, 1 ),
		cone: world.createCylinderGeometry( 0, ...SHAPE_ARGUMENTS.cone, false, 0, TAU ),
		torus: world.createTorusGeometry( ...SHAPE_ARGUMENTS.torus, TAU, 0, TAU )
	};
	const shapeList = [ shapes.box, shapes.cone, shapes.torus ];

	function material( color, shading ) {

		const handle = world.createMaterial( '' );
		world.setMaterialColor( handle, ...color );
		world.setMaterialShading( handle, shading, 1, 0 );
		return handle;

	}

	const lit = [], instanceSources = new Map();
	let itemHandles = null, matricesPtr = 0, matricesVersion = 0;

	if ( config.mode === 'instanced' ) {

		// One instanced mesh per shape. Its instance matrices are the world matrices of
		// the bodies, viewed straight in the engine's memory: no copy on the way to the GPU.
		const white = material( [ 1, 1, 1 ], 0 );
		lit.push( white );
		itemHandles = new BigUint64Array( bodies );
		let offset = 0;

		groups.forEach( ( group, index ) => {

			const start = offset, count = group.bodies.length, colors = new Float32Array( count * 3 );

			group.bodies.forEach( ( body, k ) => {

				itemHandles[ start + k ] = handles[ firstBody + body ];
				colors.set( palette[ bodyBelt[ body ] ], k * 3 );

			} );
			offset += count;

			const object = world.createObject();
			world.add( stage, object );
			world.setRenderable( object, shapes[ group.shape ], white );
			world.setInstances( object, index + 1, count );
			instanceSources.set( index + 1, {
				get matrix() {

					return new Float32Array( memory().buffer, matricesPtr + start * 64, count * 16 );

				},
				get matrixVersion() {

					return matricesVersion;

				},
				color: colors, colorVersion: 0
			} );

		} );

	} else {

		// Every body is its own mesh: its own transform, culled and ordered on its own.
		const materials = palette.map( ( color ) => material( color, 0 ) );
		lit.push( ...materials );
		for ( let body = 0; body < bodies; body ++ ) world.setRenderable( handles[ firstBody + body ], shapeList[ bodyShape[ body ] ], materials[ bodyBelt[ body ] ] );

	}

	// ---- the sun: a bright core and a faint see-through halo

	const sphere = world.createSphereGeometry( 1, 32, 16, 0, TAU, 0, Math.PI );
	const core = world.createObject(), halo = world.createObject();
	const haloMaterial = material( linear( SUN_COLOR ), 1 );
	world.setMaterialState( haloMaterial, true, 0.12, true, false, false );
	world.setRenderable( core, sphere, material( linear( SUN_COLOR ), 1 ) );
	world.setRenderable( halo, sphere, haloMaterial );
	world.setScale( core, 2.2, 2.2, 2.2 );
	world.setScale( halo, 3.6, 3.6, 3.6 );
	world.add( stage, core );
	world.add( stage, halo );

	const camera = world.createObject();
	const [ r, g, b ] = linear( BACKGROUND ), background = { r, g, b, a: 1 }, sun = linear( SUN_COLOR ), sky = linear( SKY ), ground = linear( GROUND );
	let aspect = 0;

	return {

		name: mixed ? ( webgl ? 'WAMR3D · JS math + WebGL' : 'WAMR3D · JS math + WebGPU' ) : ( webgl ? 'WAMR3D · batched API · WebGL' : 'WAMR3D · batched API' ),
		detail: mixed ? 'wamr3d/math values build quaternions in JavaScript; the Wasm engine updates the scene and renders' : 'scene graph in WebAssembly, one call per frame for all rotations, WAMR3D renderer',

		setOptions( options ) {

			frame.clearLights();
			frame.addPointLight( 0, 0, 0, ...sun, options.sun, 0, SUN_LIGHT.decay );
			frame.addDirectionalLight( ...FILL_LIGHT.direction, 1, 1, 1, FILL_LIGHT.intensity );
			frame.setAmbientLight( ...sky.map( ( c ) => c * options.ambient ), ...ground.map( ( c ) => c * options.ambient ) );
			frame.setFog( options.fog ? 2 : 0, r, g, b, 0, 0, options.fogDensity );
			for ( const handle of lit ) world.setMaterialShading( handle, options.material === 'standard' ? 2 : 0, options.roughness, options.metalness );

		},

		update( time, view ) {

			if ( mixed ) {

				animate( time, scene );
				for ( let i = 0, a = 0, o = 0; i < nodes; i ++, a += 3, o += 10 ) {

					euler.set( angles[ a ], angles[ a + 1 ], angles[ a + 2 ], 'XYZ' );
					quaternion.setFromEuler( euler );
					transforms[ o + 3 ] = quaternion.x;
					transforms[ o + 4 ] = quaternion.y;
					transforms[ o + 5 ] = quaternion.z;
					transforms[ o + 6 ] = quaternion.w;

				}

				world.setTransforms( handles, transforms );

			} else {

				world.setRotations( handles, animate( time, scene ), 'XYZ' );

			}
			world.updateMatrixWorld( stage, false );

			if ( itemHandles ) {

				matricesPtr = world.matricesWorldPtr( itemHandles );
				matricesVersion ++;

			}

			if ( view.aspect !== aspect ) world.setPerspectiveCamera( camera, CAMERA.fov, aspect = view.aspect, CAMERA.near, CAMERA.far, true );
			world.setPosition( camera, ...cameraPosition( view ) );
			world.lookAt( camera, 0, 0, 0 );
			world.updateMatrixWorld( camera, false );

		},

		render() {

			backend.render( world, frame, stage, camera, background, undefined, instanceSources );

		},

		setSize( width, height ) {

			canvas.width = width;
			canvas.height = height;

		},

		info: () => ( { calls: backend.info.calls, triangles: backend.info.triangles } ),

		dispose() {

			backend.dispose();
			frame.free();
			world.free();

		}

	};

}
