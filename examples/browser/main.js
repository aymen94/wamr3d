// WAMR3D browser demo. The engine (WebAssembly) owns the scene: objects, hierarchy,
// transforms, world matrices, camera and projection matrices, and vertex normals, and
// its own WebGPU renderer draws it. With ?renderer=three (or without WebGPU) the
// picture is drawn by the reference adapter in render-adapter.js instead.

import { init, version, World, Vector3, Quaternion, Matrix4, Timer } from '../../dist/wamr3d/index.js';
import { createNativeRenderer } from './native-renderer.js';

const PARITY_TOLERANCE = 1e-5;
const $ = ( id ) => document.getElementById( id );
const status = { wasm: 'loading', renderer: null, calls: 0, frames: 0, objects: 0, parity: 'pending', largestDifference: null, error: null, camera: null };
window.__wamr3d = status;

function fail( error ) {

	status.wasm = 'failed';
	status.error = String( error?.stack || error );
	$( 'wasm' ).textContent = 'failed';
	$( 'wasm' ).className = 'bad';
	console.error( error );

}

// Vertex data for a box and a floor quad. Normals are not supplied: the engine computes them.
function boxData( w, h, d ) {

	const [ x, y, z ] = [ w / 2, h / 2, d / 2 ];
	const faces = [
		[ [ x, - y, z ], [ x, - y, - z ], [ x, y, - z ], [ x, y, z ] ], [ [ - x, - y, - z ], [ - x, - y, z ], [ - x, y, z ], [ - x, y, - z ] ],
		[ [ - x, y, z ], [ x, y, z ], [ x, y, - z ], [ - x, y, - z ] ], [ [ - x, - y, - z ], [ x, - y, - z ], [ x, - y, z ], [ - x, - y, z ] ],
		[ [ - x, - y, z ], [ x, - y, z ], [ x, y, z ], [ - x, y, z ] ], [ [ x, - y, - z ], [ - x, - y, - z ], [ - x, y, - z ], [ x, y, - z ] ]
	];
	const positions = new Float32Array( faces.flat( 2 ) );
	const indices = new Uint32Array( faces.flatMap( ( _, f ) => [ 0, 1, 2, 0, 2, 3 ].map( ( i ) => f * 4 + i ) ) );
	return { positions, indices };

}

function floorData( size ) {

	const s = size / 2;
	return { positions: new Float32Array( [ - s, 0, s, s, 0, s, s, 0, - s, - s, 0, - s ] ), indices: new Uint32Array( [ 0, 1, 2, 0, 2, 3 ] ) };

}

async function start() {

	await init();
	status.wasm = 'ready';
	$( 'wasm' ).textContent = `ready (v${version()})`;
	$( 'wasm' ).className = 'ok';

	const canvas = $( 'view' );
	const world = new World();

	// ---- scene, described once: [parent index, colour, geometry]

	const SATELLITES = 12;
	const ROOT = 0, FLOOR = 1, CUBE = 2, RING = 3, FIRST_SATELLITE = 4;
	const parents = [ - 1, ROOT, ROOT, CUBE, ...Array( SATELLITES ).fill( RING ) ];
	const handles = world.createObjects( parents.length );
	parents.forEach( ( parent, i ) => {

		if ( parent >= 0 ) world.add( handles[ parent ], handles[ i ] );

	} );

	// The reference check recomputes everything with three.js. It is loaded only when
	// comparison mode is switched on; until then the inputs are just remembered.
	const pose = parents.map( () => ( { position: [ 0, 0, 0 ], scale: [ 1, 1, 1 ], rotation: [ 0, 0, 0 ] } ) );
	let reference = null, referenceLoading = null;

	function loadReference() {

		return referenceLoading ??= import( './reference-check.js' ).then( ( { createReferenceCheck } ) => {

			const check = createReferenceCheck( parents );

			pose.forEach( ( each, i ) => {

				check.setPosition( i, ...each.position );
				check.setScale( i, ...each.scale );
				check.setRotation( i, ...each.rotation );

			} );
			reference = check;

		} ).catch( ( error ) => {

			status.parity = 'unavailable';
			console.warn( `the three.js reference could not be loaded: ${error.message}` );

		} );

	}

	$( 'compare' ).checked = new URLSearchParams( location.search ).get( 'compare' ) === '1';

	// ---- renderer: native by default, the reference adapter on request or as a fallback

	let native = null, adapter = null;

	if ( new URLSearchParams( location.search ).get( 'renderer' ) !== 'three' ) {

		try {

			native = await createNativeRenderer( canvas, world, handles[ ROOT ] );

		} catch ( error ) {

			console.warn( `${error.message}; drawing with the reference adapter instead` );

		}

	}

	if ( ! native ) adapter = ( await import( './render-adapter.js' ) ).createRenderAdapter( canvas );
	const renderer = native ?? adapter;
	status.renderer = native ? native.name : 'three.js WebGL adapter';
	$( 'renderer' ).textContent = status.renderer;

	function place( i, x, y, z ) {

		world.setPosition( handles[ i ], x, y, z );
		pose[ i ].position = [ x, y, z ];
		if ( reference ) reference.setPosition( i, x, y, z );

	}

	function scale( i, s ) {

		world.setScale( handles[ i ], s, s, s );
		pose[ i ].scale = [ s, s, s ];
		if ( reference ) reference.setScale( i, s, s, s );

	}

	function rotate( i, x, y, z ) {

		world.setRotation( handles[ i ], x, y, z, 'XYZ' );
		pose[ i ].rotation = [ x, y, z ];
		if ( reference ) reference.setRotation( i, x, y, z );

	}

	place( CUBE, 0, 1.6, 0 );
	for ( let k = 0; k < SATELLITES; k ++ ) {

		const angle = k / SATELLITES * Math.PI * 2;
		place( FIRST_SATELLITE + k, Math.cos( angle ) * 2.6, 0, Math.sin( angle ) * 2.6 );
		scale( FIRST_SATELLITE + k, 0.28 + 0.12 * ( k % 3 ) );

	}

	// ---- geometry: uploaded to the engine, normals computed there, then handed to the adapter

	function mesh( index, data, color ) {

		const geometry = world.createGeometry();
		world.setAttribute( geometry, 'position', data.positions, 3 );
		world.setIndex( geometry, data.indices );
		world.computeVertexNormals( geometry );
		if ( adapter ) adapter.addMesh( index, { positions: data.positions, normals: world.getAttribute( geometry, 'normal' ), indices: data.indices }, color );
		if ( ! materials.has( color ) ) materials.set( color, native ? native.createMaterial( color ) : world.createMaterial( '' ) );
		world.setRenderable( handles[ index ], geometry, materials.get( color ) );

	}

	const materials = new Map();
	mesh( FLOOR, floorData( 20 ), 0x2a2f38 );
	mesh( CUBE, boxData( 1.4, 1.4, 1.4 ), 0x4f8cff );
	for ( let k = 0; k < SATELLITES; k ++ ) mesh( FIRST_SATELLITE + k, boxData( 1, 1, 1 ), [ 0xffb454, 0x6fd08c, 0xff6b9d ][ k % 3 ] );

	// ---- camera, computed by the engine

	const cameraState = { yaw: 0.7, pitch: - 0.45, distance: 9, target: [ 0, 1.2, 0 ], fov: 50, aspect: 1, near: 0.1, far: 100 };
	status.camera = cameraState;
	const eye = new Vector3( 0, 0, 0 ), target = new Vector3( ...cameraState.target ), up = new Vector3( 0, 1, 0 ), one = new Vector3( 1, 1, 1 );
	const orbit = new Quaternion( 0, 0, 0, 1 ), orientation = new Quaternion( 0, 0, 0, 1 );
	const look = new Matrix4(), cameraWorld = new Matrix4(), cameraView = new Matrix4(), projection = new Matrix4(), projectionInverse = new Matrix4();

	function updateCamera() {

		const { yaw, pitch, distance, fov, aspect, near, far } = cameraState;

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

	}

	function resize() {

		const width = canvas.clientWidth, height = canvas.clientHeight;
		renderer.setSize( width, height );
		cameraState.aspect = width / Math.max( 1, height );

	}

	window.addEventListener( 'resize', resize );
	resize();

	// ---- controls

	let dragging = false;
	canvas.addEventListener( 'pointerdown', ( e ) => {

		dragging = true;
		canvas.setPointerCapture( e.pointerId );

	} );
	canvas.addEventListener( 'pointerup', () => ( dragging = false ) );
	canvas.addEventListener( 'pointermove', ( e ) => {

		if ( ! dragging ) return;
		cameraState.yaw -= e.movementX * 0.006;
		cameraState.pitch = Math.max( - 1.5, Math.min( - 0.03, cameraState.pitch - e.movementY * 0.006 ) );

	} );
	canvas.addEventListener( 'wheel', ( e ) => {

		e.preventDefault();
		cameraState.distance = Math.max( 3, Math.min( 40, cameraState.distance * Math.exp( e.deltaY * 0.001 ) ) );

	}, { passive: false } );

	// ---- frame loop

	const timer = new Timer( performance.now() );
	let time = 0, framesInWindow = 0, windowStart = performance.now();

	function frame( now ) {

		timer.update( now );
		if ( $( 'spin' ).checked ) time += Math.min( timer.getDelta(), 0.1 );

		rotate( CUBE, time * 0.6, time * 0.9, 0 );
		rotate( RING, 0, - time * 1.4, Math.sin( time * 0.5 ) * 0.35 );
		for ( let k = 0; k < SATELLITES; k ++ ) rotate( FIRST_SATELLITE + k, time * ( 1 + k * 0.1 ), time * 0.7, k );

		world.updateMatrixWorld( handles[ ROOT ], false );
		const matrices = world.matricesWorld( handles );
		updateCamera();

		const cameraWorldElements = cameraWorld.toArray(), cameraViewElements = cameraView.toArray(), projectionElements = projection.toArray();

		if ( native ) {

			native.setCamera( [ eye.x, eye.y, eye.z ], cameraState );
			status.calls = native.info.calls;

		} else {

			adapter.setWorldMatrices( matrices );
			adapter.setCamera( cameraWorldElements, cameraViewElements, projectionElements, projectionInverse.toArray() );

		}

		renderer.render();

		if ( $( 'compare' ).checked && ! reference ) {

			loadReference();
			if ( status.parity !== 'unavailable' ) status.parity = 'loading';
			$( 'parity' ).textContent = status.parity === 'unavailable' ? 'three.js could not be loaded' : 'loading three.js…';
			$( 'parity' ).className = 'muted';

		} else if ( $( 'compare' ).checked ) {

			const largest = reference.check( matrices, cameraWorldElements, cameraViewElements, projectionElements, cameraState );
			const pass = largest <= PARITY_TOLERANCE;
			status.parity = pass ? 'pass' : 'fail';
			status.largestDifference = largest;
			$( 'parity' ).textContent = pass ? `match (tolerance ${PARITY_TOLERANCE})` : 'MISMATCH';
			$( 'parity' ).className = pass ? 'ok' : 'bad';
			$( 'difference' ).textContent = largest.toExponential( 2 );

		} else {

			status.parity = 'off';
			$( 'parity' ).textContent = 'off';
			$( 'parity' ).className = 'muted';
			$( 'difference' ).textContent = '–';

		}

		status.frames ++;
		framesInWindow ++;
		if ( now - windowStart >= 500 ) {

			$( 'fps' ).textContent = ( framesInWindow * 1000 / ( now - windowStart ) ).toFixed( 0 );
			status.objects = world.objectCount();
			$( 'objects' ).textContent = status.objects;
			framesInWindow = 0;
			windowStart = now;

		}

		requestAnimationFrame( frame );

	}

	status.objects = world.objectCount();
	$( 'objects' ).textContent = status.objects;
	requestAnimationFrame( frame );

}

start().catch( fail );
window.addEventListener( 'error', ( e ) => fail( e.error || e.message ) );
