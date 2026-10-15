// The same scene written once against a three.js-style library `L`, and run with:
//   three-webgpu, three-webgl   three.js with its own renderer (the reference, loaded from a CDN)
//   wamr3d-api, wamr3d-api-webgl WAMR3D's object API with its own WebGPU or WebGL 2 renderer
// The code below is identical for all three; only the import and the renderer differ.

import { loadThreeWebGL, loadThreeWebGPU } from '../three-reference.js';
import { animate, cameraPosition, BACKGROUND, SUN_COLOR, PALETTE, CAMERA, SUN_LIGHT, FILL_LIGHT, SKY, GROUND, SHAPE_ARGUMENTS } from './scene.js';

async function library( kind, canvas ) {

	if ( kind === 'wamr3d-api' || kind === 'wamr3d-api-webgl' ) {

		const webgl = kind === 'wamr3d-api-webgl';
		const L = await import( '../../dist/wamr3d/compat.js' );
		await L.init();
		const renderer = new L.WebGPURenderer( { canvas, antialias: true, backend: webgl ? 'webgl' : 'webgpu' } );
		await renderer.init();
		return { L, renderer, name: webgl ? 'WAMR3D · object API · WebGL' : 'WAMR3D · object API', detail: `three.js-style classes over the WebAssembly engine, WAMR3D ${webgl ? 'WebGL 2' : 'WebGPU'} renderer` };

	}

	if ( kind === 'three-webgpu' ) {

		const L = await loadThreeWebGPU();
		const renderer = new L.WebGPURenderer( { canvas, antialias: true } );
		await renderer.init();
		const fallback = ! renderer.backend.isWebGPUBackend;
		// this renderer clears its counters after each frame unless told not to
		renderer.info.autoReset = false;
		return { L, renderer, name: fallback ? 'three.js · WebGL 2 fallback' : 'three.js · WebGPU', detail: 'three.js alone, its WebGPU renderer' };

	}

	const L = await loadThreeWebGL();
	const renderer = new L.WebGLRenderer( { canvas, antialias: true, powerPreference: 'high-performance' } );
	return { L, renderer, name: 'three.js · WebGL', detail: 'three.js alone, its WebGL renderer' };

}

export async function createEngine( kind, canvas, scene, config ) {

	const { L, renderer, name, detail } = await library( kind, canvas );
	renderer.setPixelRatio( 1 );
	const { nodes, bodies, firstBody, parent, position, scale, bodyBelt, bodyShape, groups } = scene;
	const instanced = config.mode === 'instanced';

	const stage = new L.Scene();
	stage.background = new L.Color( BACKGROUND );
	// world matrices are updated once, in update(), not a second time inside render()
	stage.matrixWorldAutoUpdate = false;

	const geometries = { box: new L.BoxGeometry( ...SHAPE_ARGUMENTS.box ), cone: new L.ConeGeometry( ...SHAPE_ARGUMENTS.cone ), torus: new L.TorusGeometry( ...SHAPE_ARGUMENTS.torus ) };
	const shapeList = [ geometries.box, geometries.cone, geometries.torus ];
	const surface = ( color ) => ( config.material === 'standard' ? new L.MeshStandardMaterial( { color } ) : new L.MeshLambertMaterial( { color } ) );
	const materials = instanced ? [ surface( 0xffffff ) ] : PALETTE.map( surface );
	const colors = PALETTE.map( ( hex ) => new L.Color( hex ) );

	// ---- scene graph

	const objects = new Array( nodes );

	for ( let i = 0; i < nodes; i ++ ) {

		const body = i - firstBody;
		const object = body < 0 ? new L.Group() : instanced ? new L.Object3D() : new L.Mesh( shapeList[ bodyShape[ body ] ], materials[ bodyBelt[ body ] ] );
		object.position.set( position[ i * 3 ], position[ i * 3 + 1 ], position[ i * 3 + 2 ] );
		object.scale.setScalar( scale[ i ] );
		objects[ i ] = object;
		if ( parent[ i ] >= 0 ) objects[ parent[ i ] ].add( object );

	}

	stage.add( objects[ 0 ] );

	// ---- instanced drawing: one instanced mesh per shape, fed with the bodies' world matrices

	const swarms = groups.map( ( group ) => {

		if ( ! instanced ) return null;
		const count = group.bodies.length, mesh = new L.InstancedMesh( geometries[ group.shape ], materials[ 0 ], count ), tint = new Float32Array( count * 3 );
		group.bodies.forEach( ( body, k ) => tint.set( [ colors[ bodyBelt[ body ] ].r, colors[ bodyBelt[ body ] ].g, colors[ bodyBelt[ body ] ].b ], k * 3 ) );
		mesh.instanceColor = new L.InstancedBufferAttribute( tint, 3 );
		mesh.frustumCulled = false;
		stage.add( mesh );
		const items = group.bodies.map( ( body ) => objects[ firstBody + body ] );
		return { mesh, items, handles: kind === 'wamr3d-api' ? BigUint64Array.from( items, ( item ) => item.handle ) : null };

	} ).filter( Boolean );

	// ---- sun and lights

	const sphere = new L.SphereGeometry( 1, 32, 16 );
	const core = new L.Mesh( sphere, new L.MeshBasicMaterial( { color: SUN_COLOR } ) );
	const halo = new L.Mesh( sphere, new L.MeshBasicMaterial( { color: SUN_COLOR, transparent: true, opacity: 0.12, depthWrite: false } ) );
	core.scale.setScalar( 2.2 );
	halo.scale.setScalar( 3.6 );
	const sun = new L.PointLight( SUN_COLOR, 1, 0, SUN_LIGHT.decay ), fill = new L.DirectionalLight( 0xffffff, FILL_LIGHT.intensity ), ambient = new L.HemisphereLight( SKY, GROUND, 1 );
	fill.position.set( ...FILL_LIGHT.direction );
	stage.add( core, halo, sun, fill, ambient );

	const camera = new L.PerspectiveCamera( CAMERA.fov, 1, CAMERA.near, CAMERA.far );
	const fog = new L.FogExp2( BACKGROUND, 0 );

	return {

		name, detail,

		setOptions( options ) {

			sun.intensity = options.sun;
			ambient.intensity = options.ambient;
			fog.density = options.fogDensity;
			stage.fog = options.fog ? fog : null;

			if ( options.material === 'standard' ) for ( const each of materials ) {

				each.roughness = options.roughness;
				each.metalness = options.metalness;

			}

		},

		update( time, view ) {

			const angles = animate( time, scene );
			for ( let i = 0, o = 0; i < nodes; i ++, o += 3 ) objects[ i ].rotation.set( angles[ o ], angles[ o + 1 ], angles[ o + 2 ] );
			stage.updateMatrixWorld();

			for ( const { mesh, items, handles } of swarms ) {

				const array = mesh.instanceMatrix.array;

				if ( handles ) {

					array.set( L.getWorld().matricesWorld( handles ) );

				} else {

					for ( let k = 0, o = 0; k < items.length; k ++ ) {

						const elements = items[ k ].matrixWorld.elements;
						for ( let e = 0; e < 16; e ++ ) array[ o ++ ] = elements[ e ];

					}

				}

				mesh.instanceMatrix.needsUpdate = true;

			}

			if ( camera.aspect !== view.aspect ) {

				camera.aspect = view.aspect;
				camera.updateProjectionMatrix();

			}

			camera.position.set( ...cameraPosition( view ) );
			camera.lookAt( 0, 0, 0 );
			camera.updateMatrixWorld();

		},

		render() {

			if ( kind === 'three-webgpu' ) renderer.info.reset();
			renderer.render( stage, camera );

		},

		setSize( width, height ) {

			renderer.setSize( width, height, false );

		},

		info() {

			const render = renderer.info.render;
			return { calls: render.drawCalls ?? render.calls, triangles: render.triangles };

		},

		dispose() {

			const all = [];
			stage.traverse( ( object ) => all.push( object ) );
			// only WAMR3D objects own engine memory; three.js objects are left to the garbage collector
			if ( kind === 'wamr3d-api' ) for ( let i = all.length - 1; i >= 0; i -- ) all[ i ].dispose();
			for ( const resource of [ ...Object.values( geometries ), sphere, ...materials, core.material, halo.material ] ) resource.dispose();
			renderer.dispose();
			if ( renderer.forceContextLoss ) renderer.forceContextLoss();

		}

	};

}
