// Showcase page: builds the scene with the chosen engine, runs the frame loop, shows
// timings, and applies every change of the settings panel without reloading.
//
// URL parameters mirror the settings (engine, count, mode, shape, ...). `bench=2000,10000`
// runs the comparison for those sizes on load and leaves the rows in
// `window.__showcase.results` for examples/showcase/measure.mjs.

import { DEFAULTS, CAMERA, layout } from './scene.js';

const ENGINES = [
	[ 'wamr3d', 'WAMR3D · batched API' ],
	[ 'wamr3d-mix', 'WAMR3D · JS math + WebGPU' ],
	[ 'wamr3d-api', 'WAMR3D · object API' ],
	[ 'wamr3d-webgl', 'WAMR3D · batched API · WebGL' ],
	[ 'wamr3d-mix-webgl', 'WAMR3D · JS math + WebGL' ],
	[ 'wamr3d-api-webgl', 'WAMR3D · object API · WebGL' ],
	[ 'three-webgpu', 'three.js · WebGPU' ],
	[ 'three-webgl', 'three.js · WebGL' ]
];

// `rebuild` settings change what the scene is made of; the others are applied to the running scene.
const CONTROLS = [
	{ group: 'Renderer' },
	{ key: 'engine', label: 'Engine', options: ENGINES, rebuild: true },
	{ group: 'Scene' },
	{ key: 'count', label: 'Bodies', options: [ 2000, 5000, 10000, 25000, 50000, 100000 ].map( ( n ) => [ n, n.toLocaleString( 'en' ) ] ), rebuild: true },
	{ key: 'mode', label: 'Drawn as', options: [ [ 'objects', 'separate meshes' ], [ 'instanced', 'instanced meshes' ] ], rebuild: true },
	{ key: 'shape', label: 'Shape', options: [ [ 'mix', 'mixed' ], [ 'box', 'boxes' ], [ 'cone', 'cones' ], [ 'torus', 'rings' ] ], rebuild: true },
	{ key: 'speed', label: 'Speed', min: 0, max: 4, step: 0.05 },
	{ key: 'orbit', label: 'Orbit the camera', check: true },
	{ group: 'Material' },
	{ key: 'material', label: 'Shading', options: [ [ 'standard', 'physically based' ], [ 'lambert', 'diffuse' ] ], rebuild: true },
	{ key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
	{ key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 },
	{ group: 'Light and fog' },
	{ key: 'sun', label: 'Sun', min: 0, max: 100, step: 1 },
	{ key: 'ambient', label: 'Sky light', min: 0, max: 2, step: 0.05 },
	{ key: 'fog', label: 'Fog', check: true },
	{ key: 'fogDensity', label: 'Fog density', min: 0, max: 0.04, step: 0.001 }
];

const $ = ( id ) => document.getElementById( id );
const params = new URLSearchParams( location.search );
const config = { ...DEFAULTS };

for ( const key of Object.keys( DEFAULTS ) ) {

	if ( ! params.has( key ) ) continue;
	const value = params.get( key );
	config[ key ] = typeof DEFAULTS[ key ] === 'number' ? Number( value ) : typeof DEFAULTS[ key ] === 'boolean' ? value !== '0' && value !== 'false' : value;

}

const state = window.__showcase = { ready: false, error: null, engine: null, frames: 0, calls: 0, config, results: [], benchDone: false, stats: null };
const view = { yaw: CAMERA.yaw, pitch: CAMERA.pitch, distance: CAMERA.distance, aspect: 1 };
const samples = { frame: [], update: [], submit: [] };
const median = ( values ) => ( values.length ? [ ...values ].sort( ( a, b ) => a - b )[ values.length >> 1 ] : 0 );

let engine = null, scene = null, building = null, time = 0, comparing = false;

// ---------------------------------------------------------------- building

async function build() {

	// one build at a time; a change made meanwhile is picked up by the build that follows
	if ( building ) return building.then( build );

	building = ( async () => {

		const wanted = JSON.stringify( [ config.engine, config.count, config.mode, config.shape, config.material ] );
		state.ready = false;
		$( 'engine' ).textContent = 'building…';
		$( 'error' ).textContent = '';

		if ( engine ) engine.dispose();
		engine = null;

		// a canvas keeps the kind of context it was first given, so each engine gets a new one
		const canvas = document.createElement( 'canvas' );
		$( 'stage' ).replaceChildren( canvas );
		attach( canvas );

		try {

			const started = performance.now();
			scene = layout( config.count, config.shape );
			const batched = config.engine.startsWith( 'wamr3d' ) && ! config.engine.startsWith( 'wamr3d-api' );
			const module = batched ? await import( './engine-wamr3d.js' ) : await import( './engine-library.js' );
			const webgl = config.engine === 'wamr3d-webgl' || config.engine === 'wamr3d-api-webgl' || config.engine === 'wamr3d-mix-webgl';
			const mixed = config.engine === 'wamr3d-mix' || config.engine === 'wamr3d-mix-webgl';
			engine = batched ? await module.createEngine( canvas, scene, config, webgl, mixed ) : await module.createEngine( config.engine, canvas, scene, config );
			engine.setOptions( config );
			state.buildMs = performance.now() - started;
			state.engine = engine.name;
			state.frames = 0;
			for ( const list of Object.values( samples ) ) list.length = 0;

			$( 'engine' ).textContent = engine.name;
			$( 'nodes' ).textContent = scene.nodes.toLocaleString( 'en' );
			$( 'summary' ).textContent = `${scene.bodies.toLocaleString( 'en' )} bodies as ${config.mode === 'instanced' ? `${scene.groups.length} instanced mesh${scene.groups.length > 1 ? 'es' : ''}` : 'separate meshes'} · ${config.material === 'standard' ? 'physically based' : 'diffuse'} · ${engine.detail}`;

		} catch ( error ) {

			state.error = String( error?.stack || error );
			$( 'engine' ).textContent = 'failed';
			$( 'error' ).textContent = String( error?.message || error );
			console.error( error );

		}

		building = null;
		// settings changed while this was building
		if ( wanted !== JSON.stringify( [ config.engine, config.count, config.mode, config.shape, config.material ] ) ) return build();

	} )();

	return building;

}

// ---------------------------------------------------------------- camera

function attach( canvas ) {

	let dragging = false;
	canvas.addEventListener( 'pointerdown', ( event ) => {

		dragging = true;
		canvas.setPointerCapture( event.pointerId );

	} );
	canvas.addEventListener( 'pointerup', () => ( dragging = false ) );
	canvas.addEventListener( 'pointermove', ( event ) => {

		if ( ! dragging ) return;
		view.yaw -= event.movementX * 0.005;
		view.pitch = Math.max( - 1.5, Math.min( 1.5, view.pitch - event.movementY * 0.005 ) );

	} );
	canvas.addEventListener( 'wheel', ( event ) => {

		event.preventDefault();
		view.distance = Math.max( 8, Math.min( 220, view.distance * Math.exp( event.deltaY * 0.001 ) ) );

	}, { passive: false } );

}

// ---------------------------------------------------------------- frame loop

let last = performance.now(), shown = last;

function frame( now ) {

	requestAnimationFrame( frame );
	const delta = now - last;
	last = now;
	if ( ! engine || building ) return;

	const seconds = Math.min( delta, 100 ) / 1000;
	time += seconds * config.speed;
	if ( config.orbit ) view.yaw += seconds * 0.06;

	const canvas = $( 'stage' ).firstChild, ratio = Math.min( window.devicePixelRatio, 1.5 );
	const width = Math.max( 1, Math.floor( canvas.clientWidth * ratio ) ), height = Math.max( 1, Math.floor( canvas.clientHeight * ratio ) );
	if ( canvas.width !== width || canvas.height !== height ) engine.setSize( width, height );
	view.aspect = width / height;

	const t0 = performance.now();
	engine.update( time, view );
	const t1 = performance.now();
	engine.render();
	const t2 = performance.now();

	// the first frames include compiling shaders and uploading buffers
	if ( state.frames > 2 ) {

		samples.frame.push( delta );
		samples.update.push( t1 - t0 );
		samples.submit.push( t2 - t1 );
		for ( const list of Object.values( samples ) ) if ( list.length > 240 ) list.shift();

	}

	state.frames ++;
	state.ready = true;

	if ( now - shown >= 400 && samples.frame.length > 0 ) {

		shown = now;
		const info = engine.info(), frameMs = median( samples.frame );
		state.calls = info.calls;
		state.stats = { fps: 1000 / frameMs, frame: frameMs, update: median( samples.update ), submit: median( samples.submit ), calls: info.calls, triangles: info.triangles };
		$( 'fps' ).textContent = state.stats.fps.toFixed( 0 );
		$( 'frame' ).textContent = frameMs.toFixed( 1 ) + ' ms';
		$( 'update' ).textContent = state.stats.update.toFixed( 2 ) + ' ms';
		$( 'submit' ).textContent = state.stats.submit.toFixed( 2 ) + ' ms';
		$( 'calls' ).textContent = info.calls.toLocaleString( 'en' );
		$( 'triangles' ).textContent = Math.round( info.triangles ).toLocaleString( 'en' );

	}

}

// ---------------------------------------------------------------- settings panel

const inputs = {};

function setting( key, value ) {

	config[ key ] = value;
	const control = CONTROLS.find( ( c ) => c.key === key );
	if ( control.rebuild ) return build();
	if ( engine ) engine.setOptions( config );

}

for ( const control of CONTROLS ) {

	if ( control.group ) {

		$( 'controls' ).append( Object.assign( document.createElement( 'h2' ), { textContent: control.group } ) );
		continue;

	}

	const { key } = control, label = document.createElement( 'label' );
	let input;

	if ( control.options ) {

		input = document.createElement( 'select' );
		for ( const [ value, text ] of control.options ) input.append( new Option( text, value, false, String( config[ key ] ) === String( value ) ) );
		input.addEventListener( 'change', () => setting( key, typeof DEFAULTS[ key ] === 'number' ? Number( input.value ) : input.value ) );
		label.append( control.label, input );

	} else if ( control.check ) {

		input = Object.assign( document.createElement( 'input' ), { type: 'checkbox', checked: config[ key ] } );
		input.addEventListener( 'change', () => setting( key, input.checked ) );
		label.className = 'check';
		label.append( input, control.label );

	} else {

		const output = document.createElement( 'output' );
		input = Object.assign( document.createElement( 'input' ), { type: 'range', min: control.min, max: control.max, step: control.step } );
		input.value = config[ key ];
		output.textContent = config[ key ];
		input.addEventListener( 'input', () => {

			output.textContent = input.value;
			setting( key, Number( input.value ) );

		} );
		label.append( control.label, input, output );

	}

	inputs[ key ] = input;
	$( 'controls' ).append( label );

}

// ---------------------------------------------------------------- comparison

const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

// Runs one engine with the current settings: waits for it to draw, lets it settle, then
// samples. Slow engines get fewer frames rather than more time.
async function measure( name ) {

	config.engine = name;
	inputs.engine.value = name;
	await build();
	if ( state.error ) return { engine: name, label: name, error: state.error };

	const waitFor = async ( frames, limit ) => {

		const until = performance.now() + limit;
		while ( state.frames < frames && performance.now() < until ) await sleep( 50 );

	};

	await waitFor( 4, 60000 );
	await sleep( 1500 );
	for ( const list of Object.values( samples ) ) list.length = 0;
	const from = state.frames, started = performance.now();
	await sleep( 4000 );
	await waitFor( from + 8, 30000 );
	const elapsed = performance.now() - started, frames = state.frames - from, info = engine.info();

	return {
		engine: name, label: engine.name, bodies: scene.bodies, mode: config.mode,
		fps: frames * 1000 / elapsed, frame: median( samples.frame ), update: median( samples.update ), submit: median( samples.submit ),
		calls: info.calls, buildMs: state.buildMs, frames
	};

}

function showResults( rows ) {

	const best = ( key ) => Math.min( ...rows.filter( ( r ) => ! r.error ).map( ( r ) => r[ key ] ) );
	const cell = ( row, key, digits ) => `<td class="${row[ key ] === best( key ) ? 'best' : ''}">${row[ key ].toFixed( digits )}</td>`;
	$( 'results' ).innerHTML = `<h2>Same scene, ${rows[ 0 ].bodies?.toLocaleString( 'en' )} bodies, ${rows[ 0 ].mode}</h2><table><tr><th>renderer</th><th>fps</th><th>update ms</th><th>submit ms</th><th>calls</th></tr>`
		+ rows.map( ( row ) => row.error ? `<tr><td>${row.label}</td><td colspan="4">failed</td></tr>` : `<tr><td>${row.label}</td><td class="${row.fps === Math.max( ...rows.filter( ( r ) => ! r.error ).map( ( r ) => r.fps ) ) ? 'best' : ''}">${row.fps.toFixed( 0 )}</td>${cell( row, 'update', 2 )}${cell( row, 'submit', 2 )}<td>${row.calls}</td></tr>` ).join( '' )
		+ '</table><div class="muted">medians over 4 s after a 1.5 s warm-up, one engine at a time; the frame rate is capped by the display</div>';

}

async function compare( engines = ENGINES.map( ( [ name ] ) => name ) ) {

	if ( comparing ) return [];
	comparing = true;
	$( 'compare' ).disabled = true;
	const chosen = config.engine, rows = [];

	for ( const name of engines ) {

		$( 'compare' ).textContent = `Measuring ${name}…`;
		rows.push( await measure( name ) );
		showResults( rows );

	}

	config.engine = chosen;
	inputs.engine.value = chosen;
	await build();
	$( 'compare' ).textContent = 'Compare all eight paths';
	$( 'compare' ).disabled = false;
	comparing = false;
	return rows;

}

$( 'compare' ).addEventListener( 'click', () => compare() );

// ---------------------------------------------------------------- start

requestAnimationFrame( frame );

if ( params.has( 'bench' ) ) {

	const engines = params.get( 'engines' )?.split( ',' ) ?? ENGINES.map( ( [ name ] ) => name );

	for ( const mode of ( params.get( 'modes' ) ?? 'objects,instanced' ).split( ',' ) ) for ( const count of params.get( 'bench' ).split( ',' ).map( Number ) ) {

		config.mode = inputs.mode.value = mode;
		config.count = count;
		state.results.push( ...await compare( engines ) );

	}

	state.benchDone = true;

} else {

	await build();

}
