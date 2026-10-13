// WAMR3D drawing its own scene with WebGPU: scene graph, transforms, culling, draw
// order and shading data all come from the WebAssembly engine.

import * as WAMR3D from '../../dist/wamr3d/compat.js';
import { buildScene, CAMERA } from './scene.js';

const $ = ( id ) => document.getElementById( id );
const params = new URLSearchParams( location.search );
const state = window.__native = { ready: false, error: null, frames: 0, calls: 0, triangles: 0, objects: 0, pick: null };

try {

	await WAMR3D.init();

	const canvas = $( 'view' );
	const renderer = new WAMR3D.WebGPURenderer( { canvas, antialias: true } );
	await renderer.init();

	const demo = buildScene( WAMR3D, Math.max( 0, Number( params.get( 'satellites' ) ?? 12 ) ), { standard: true, textured: params.get( 'textured' ) === '1', extras: true } );
	const view = { ...CAMERA };
	state.objects = demo.objectCount;
	$( 'objects' ).textContent = demo.objectCount;

	let dragging = false, moved = false;
	canvas.addEventListener( 'pointerdown', ( e ) => {

		dragging = true;
		moved = false;
		canvas.setPointerCapture( e.pointerId );

	} );
	canvas.addEventListener( 'pointermove', ( e ) => {

		if ( ! dragging ) return;
		moved = true;
		view.yaw -= e.movementX * 0.006;
		view.pitch = Math.max( - 1.5, Math.min( - 0.03, view.pitch - e.movementY * 0.006 ) );

	} );
	canvas.addEventListener( 'wheel', ( e ) => {

		e.preventDefault();
		view.distance = Math.max( 3, Math.min( 150, view.distance * Math.exp( e.deltaY * 0.001 ) ) );

	}, { passive: false } );

	// Click an object to recolour it.
	const raycaster = new WAMR3D.Raycaster(), pointer = new WAMR3D.Vector2();
	canvas.addEventListener( 'pointerup', ( e ) => {

		dragging = false;
		if ( moved ) return;
		const box = canvas.getBoundingClientRect();
		pointer.set( ( e.clientX - box.left ) / box.width * 2 - 1, 1 - ( e.clientY - box.top ) / box.height * 2 );
		raycaster.setFromCamera( pointer, demo.camera );
		const hit = raycaster.intersectObject( demo.scene ).find( ( candidate ) => candidate.object.isMesh );
		state.pick = hit ? hit.object.type : null;
		if ( ! hit ) return;
		hit.object.material = hit.object.material.clone();
		hit.object.material.color.setHSL( Math.random(), 0.75, 0.55 );

	} );

	const spin = params.get( 'spin' ) !== '0';
	let time = Number( params.get( 'time' ) ?? 0 ), last = performance.now(), shown = last, frames = 0;

	renderer.setAnimationLoop( ( now ) => {

		if ( spin ) time += Math.min( now - last, 100 ) / 1000;
		last = now;

		const width = canvas.clientWidth, height = canvas.clientHeight;
		if ( canvas.width !== width || canvas.height !== height ) renderer.setSize( width, height, false );

		demo.update( time );
		demo.orbit( view, width / Math.max( 1, height ) );
		renderer.render( demo.scene, demo.camera );

		frames ++;
		state.frames ++;
		state.calls = renderer.info.render.calls;
		state.triangles = renderer.info.render.triangles;
		state.yaw = view.yaw;
		state.ready = true;

		if ( now - shown >= 500 ) {

			$( 'fps' ).textContent = ( frames * 1000 / ( now - shown ) ).toFixed( 0 );
			$( 'calls' ).textContent = state.calls;
			$( 'triangles' ).textContent = state.triangles;
			frames = 0;
			shown = now;

		}

	} );

	$( 'status' ).textContent = 'WAMR3D · WebGPU';

} catch ( error ) {

	state.error = String( error?.stack || error );
	$( 'status' ).textContent = 'failed: ' + ( error?.message || error );
	console.error( error );

}
