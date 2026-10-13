// Runs the comparison scene with one engine and reports timings.
//
// URL parameters: engine=<name> (see ENGINES), satellites=<count> (default 12), spin=0 to pause.
// Timings are kept in window.__stats for examples/compare/measure.mjs.

import { describe, CAMERA } from './scene.js';

// three-webgpu, three-webgl and api run the same scene code (examples/webgpu/scene.js),
// each with its own renderer. three and wamr3d share one three.js WebGL renderer.
const ENGINES = {
	'three-webgpu': ( ...args ) => import( './engine-three-scene.js' ).then( ( m ) => m.createEngine( ...args, true ) ),
	'three-webgl': ( ...args ) => import( './engine-three-scene.js' ).then( ( m ) => m.createEngine( ...args, false ) ),
	api: ( ...args ) => import( './engine-native.js' ).then( ( m ) => m.createApiEngine( ...args ) ),
	native: ( ...args ) => import( './engine-native.js' ).then( ( m ) => m.createEngine( ...args ) ),
	three: ( ...args ) => import( './engine-three.js' ).then( ( m ) => m.createEngine( ...args ) ),
	wamr3d: ( ...args ) => import( './engine-wamr3d.js' ).then( ( m ) => m.createEngine( ...args ) )
};

export async function run( defaultEngine ) {

	const params = new URLSearchParams( location.search );
	const engineName = params.get( 'engine' ) || defaultEngine;
	const satellites = Math.max( 0, Number( params.get( 'satellites' ) ?? 12 ) );
	const $ = ( id ) => document.getElementById( id );

	const stats = window.__stats = { engine: engineName, ready: false, error: null, frames: 0, frame: [], update: [], render: [], firstFrameMs: null, wasmInitMs: null, objects: 0, gpu: '' };
	stats.reset = () => {

		stats.frame.length = stats.update.length = stats.render.length = 0;

	};

	try {

		const canvas = $( 'view' );
		const cameraState = { ...CAMERA, aspect: 1 };
		if ( ! ENGINES[ engineName ] ) throw new Error( `unknown engine "${engineName}"; use one of ${Object.keys( ENGINES ).join( ', ' )}` );
		const engine = await ENGINES[ engineName ]( canvas, describe( satellites ), cameraState );

		const resize = () => {

			engine.setSize( canvas.clientWidth, canvas.clientHeight );
			cameraState.aspect = canvas.clientWidth / Math.max( 1, canvas.clientHeight );

		};
		window.addEventListener( 'resize', resize );
		resize();

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
			cameraState.distance = Math.max( 3, Math.min( 150, cameraState.distance * Math.exp( e.deltaY * 0.001 ) ) );

		}, { passive: false } );

		const gl = document.createElement( 'canvas' ).getContext( 'webgl2' );
		const info = gl?.getExtension( 'WEBGL_debug_renderer_info' );
		stats.gpu = info ? gl.getParameter( info.UNMASKED_RENDERER_WEBGL ) : 'unknown';
		stats.wasmInitMs = engine.wasmInitMs ?? null;
		stats.objects = engine.objectCount();
		stats.name = engine.name;

		$( 'engine' ).textContent = engine.name;
		$( 'objects' ).textContent = stats.objects;
		$( 'wasm' ).textContent = stats.wasmInitMs === null ? 'not used' : stats.wasmInitMs.toFixed( 1 ) + ' ms';

		const median = ( values ) => values.length ? [ ...values ].sort( ( a, b ) => a - b )[ values.length >> 1 ] : 0;
		const spin = params.get( 'spin' ) !== '0';
		let time = 0, last = performance.now(), panelAt = last;

		function frame( now ) {

			const delta = now - last;
			last = now;
			if ( spin ) time += Math.min( delta, 100 ) / 1000;

			const t0 = performance.now();
			engine.update( time );
			const t1 = performance.now();
			engine.render();
			const t2 = performance.now();

			if ( stats.frames > 0 ) {

				stats.frame.push( delta );
				stats.update.push( t1 - t0 );
				stats.render.push( t2 - t1 );
				if ( stats.frame.length > 6000 ) stats.reset();

			} else {

				stats.firstFrameMs = t2;
				$( 'first' ).textContent = t2.toFixed( 0 ) + ' ms';

			}

			stats.frames ++;
			stats.ready = true;

			if ( now - panelAt >= 500 ) {

				const recent = stats.frame.slice( - 60 );
				const frameMs = median( recent );
				$( 'fps' ).textContent = frameMs > 0 ? ( 1000 / frameMs ).toFixed( 0 ) : '–';
				$( 'frame' ).textContent = frameMs.toFixed( 2 ) + ' ms';
				$( 'update' ).textContent = median( stats.update.slice( - 60 ) ).toFixed( 3 ) + ' ms';
				$( 'render' ).textContent = median( stats.render.slice( - 60 ) ).toFixed( 3 ) + ' ms';
				panelAt = now;

			}

			requestAnimationFrame( frame );

		}

		requestAnimationFrame( frame );

	} catch ( error ) {

		stats.error = String( error?.stack || error );
		$( 'engine' ).textContent = 'failed: ' + error;
		console.error( error );

	}

}
