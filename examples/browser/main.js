// WAMR3D browser demo. JavaScript computes lightweight animation and orbit inputs;
// batched transforms, world matrices, camera view, culling and drawing run in Wasm.
// With ?renderer=three (or without WebGPU), render-adapter.js draws the scene instead.

import { init, version, World, Vector3, Quaternion, Matrix4, Timer } from '../../dist/wamr3d/index.js';
import { Euler as JSEuler, Quaternion as JSQuaternion } from '../../dist/wamr3d/math.js';
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

	place( CUBE, 0, 1.6, 0 );
	for ( let k = 0; k < SATELLITES; k ++ ) {

		const angle = k / SATELLITES * Math.PI * 2;
		place( FIRST_SATELLITE + k, Math.cos( angle ) * 2.6, 0, Math.sin( angle ) * 2.6 );
		scale( FIRST_SATELLITE + k, 0.28 + 0.12 * ( k % 3 ) );

	}
	const frameTransforms = new Float32Array( handles.length * 10 );
	for ( let i = 0, o = 0; i < handles.length; i ++, o += 10 ) {

		frameTransforms[ o ] = pose[ i ].position[ 0 ];
		frameTransforms[ o + 1 ] = pose[ i ].position[ 1 ];
		frameTransforms[ o + 2 ] = pose[ i ].position[ 2 ];
		frameTransforms[ o + 6 ] = 1;
		frameTransforms[ o + 7 ] = pose[ i ].scale[ 0 ];
		frameTransforms[ o + 8 ] = pose[ i ].scale[ 1 ];
		frameTransforms[ o + 9 ] = pose[ i ].scale[ 2 ];

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

	function updateCameraMatrices() {

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

	const eyePosition = new Float32Array( 3 );

	function updateCameraEye() {

		const { yaw, pitch, distance } = cameraState;
		const sinPitch = Math.sin( pitch );
		const cosPitch = Math.cos( pitch );
		const sinYaw = Math.sin( yaw );
		const cosYaw = Math.cos( yaw );
		eyePosition[ 0 ] = cameraState.target[ 0 ] + distance * cosPitch * sinYaw;
		eyePosition[ 1 ] = cameraState.target[ 1 ] - distance * sinPitch;
		eyePosition[ 2 ] = cameraState.target[ 2 ] + distance * cosPitch * cosYaw;

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
	const euler = new JSEuler(), quaternion = new JSQuaternion();
	let time = 0, framesInWindow = 0, windowStart = performance.now();

	function frame( now ) {

		timer.update( now );
		if ( $( 'spin' ).checked ) time += Math.min( timer.getDelta(), 0.1 );

		pose[ CUBE ].rotation[ 0 ] = time * 0.6; pose[ CUBE ].rotation[ 1 ] = time * 0.9; pose[ CUBE ].rotation[ 2 ] = 0;
		pose[ RING ].rotation[ 0 ] = 0; pose[ RING ].rotation[ 1 ] = - time * 1.4; pose[ RING ].rotation[ 2 ] = Math.sin( time * 0.5 ) * 0.35;
		if ( reference ) {

			reference.setRotation( CUBE, ...pose[ CUBE ].rotation );
			reference.setRotation( RING, ...pose[ RING ].rotation );

		}
		for ( let k = 0; k < SATELLITES; k ++ ) {

			const index = FIRST_SATELLITE + k, rotation = pose[ index ].rotation;
			rotation[ 0 ] = time * ( 1 + k * 0.1 );
			rotation[ 1 ] = time * 0.7;
			rotation[ 2 ] = k;
			if ( reference ) reference.setRotation( index, rotation[ 0 ], rotation[ 1 ], rotation[ 2 ] );

		}
		for ( let i = CUBE; i < handles.length; i ++ ) {

			const rotation = pose[ i ].rotation, offset = i * 10;
			euler.set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ], 'XYZ' );
			quaternion.setFromEuler( euler );
			frameTransforms[ offset + 3 ] = quaternion.x;
			frameTransforms[ offset + 4 ] = quaternion.y;
			frameTransforms[ offset + 5 ] = quaternion.z;
			frameTransforms[ offset + 6 ] = quaternion.w;

		}
		world.setTransforms( handles, frameTransforms );

		world.updateMatrixWorld( handles[ ROOT ], false );
		const matrices = native && ! $( 'compare' ).checked ? null : world.matricesWorld( handles );
		updateCameraEye();
		let cameraWorldElements = null, cameraViewElements = null, projectionElements = null;

		if ( native ) {

			native.setCamera( eyePosition, cameraState );
			status.calls = native.info.calls;

		} else {

			updateCameraMatrices();
			cameraWorldElements = cameraWorld.toArray(); cameraViewElements = cameraView.toArray(); projectionElements = projection.toArray();

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

			if ( ! cameraWorldElements ) {

				updateCameraMatrices();
				cameraWorldElements = cameraWorld.toArray(); cameraViewElements = cameraView.toArray(); projectionElements = projection.toArray();

			}

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
