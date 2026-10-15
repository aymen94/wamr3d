// Shared by the ported examples. Each port was written for three.js; here it receives
// the library from `loadLibrary()` instead of `import * as THREE from 'three'`, so the
// same code runs on WAMR3D (the default) or, with `?engine=three`, on three.js r186
// loaded from a CDN for comparison. WAMR3D never loads three.js.

import { THREE_VERSION, loadThreeWebGPU } from '../three-reference.js';

const params = new URLSearchParams( location.search );
export const engine = params.get( 'engine' ) === 'three' ? 'three' : 'wamr3d';

// Read by `check.mjs`.
const state = window.__port = { engine, ready: false, frames: 0, error: null };

// Per-frame measurements shown in the info box, so the two engines can be compared on
// the same page. `render` is the CPU time spent inside `renderer.render()`; `frame` is
// the whole animation-loop callback. GPU time is not measured.
const metrics = { loadStart: performance.now(), loaded: 0, renderer: null, render: 0, frame: 0, renders: 0, frames: 0 };

function panel() {

	let element = document.getElementById( 'engine' );
	if ( element ) return element;
	element = document.createElement( 'div' );
	element.id = 'engine';
	const info = document.getElementById( 'info' );
	if ( info ) info.insertBefore( element, info.querySelector( 'details' ) );
	else document.body.append( element );
	return element;

}

// The info box folds down to its title and a one-line summary. On a phone, or a screen
// too short for it, it starts folded so it does not cover the scene or the game's own UI.
function setupInfo() {

	const info = document.getElementById( 'info' );
	const title = info?.querySelector( 'h1' );
	if ( ! title ) return;
	const toggle = document.createElement( 'button' );
	toggle.type = 'button';
	toggle.className = 'info-toggle';
	const set = ( collapsed ) => {

		info.classList.toggle( 'collapsed', collapsed );
		toggle.textContent = collapsed ? 'Info' : 'Hide';
		toggle.setAttribute( 'aria-expanded', String( ! collapsed ) );

	};
	toggle.addEventListener( 'click', () => set( ! info.classList.contains( 'collapsed' ) ) );
	title.append( toggle );
	set( matchMedia( '(max-width: 640px), (max-height: 500px)' ).matches );

}

setupInfo();

function row( label, key ) {

	return `<dt>${label}</dt><dd data-metric="${key}">–</dd>`;

}

function fail( error ) {

	const message = error?.message ?? String( error );
	if ( state.error === null ) state.error = message;
	const box = document.createElement( 'div' );
	box.className = 'port-error';
	const webgpu = 'gpu' in navigator ? '' : ' This browser has no WebGPU: use a current Chrome or Edge.';
	box.textContent = `${message}${webgpu}`;
	document.body.append( box );

}

window.addEventListener( 'error', ( event ) => fail( event.error ?? event.message ) );
window.addEventListener( 'unhandledrejection', ( event ) => fail( event.reason ) );

/** The library the port runs on: `wamr3d/compat` after `init()`, or three.js r186. */
export async function loadLibrary() {

	const element = panel();
	const other = new URL( location.href );
	if ( engine === 'three' ) other.searchParams.delete( 'engine' );
	else other.searchParams.set( 'engine', 'three' );
	element.innerHTML = `<div class="engine-head"><strong>${engine === 'three' ? `three.js r${THREE_VERSION.split( '.' )[ 1 ]}` : 'WAMR3D'}</strong> · WebGPU · <a href="${other.href}">run on ${engine === 'three' ? 'WAMR3D' : 'three.js'} instead</a></div>`
		+ '<dl class="metrics">'
		+ row( 'Frame rate', 'fps' ) + row( 'Frame interval', 'interval' )
		+ row( 'CPU per frame', 'frame' ) + row( 'CPU in render()', 'render' )
		+ row( 'Draw calls', 'calls' ) + row( 'Triangles', 'triangles' )
		+ row( 'Start-up', 'load' ) + row( 'JS heap', 'heap' )
		+ '</dl>'
		+ '<div class="mini" data-metric="mini">–</div>';

	const library = engine === 'three' ? await loadThreeWebGPU() : await import( '../../dist/wamr3d/compat.js' );
	if ( engine === 'wamr3d' ) await library.init();
	state.ready = true;
	return measured( library );

}

// The same library with a `WebGPURenderer` that times its own `render()` calls and
// animation-loop callbacks. Everything else is passed through unchanged.
function measured( library ) {

	class WebGPURenderer extends library.WebGPURenderer {

		constructor( ...args ) {

			super( ...args );
			metrics.renderer = this;

		}

		render( ...args ) {

			const start = performance.now();
			const result = super.render( ...args );
			metrics.render += performance.now() - start;
			metrics.renders ++;
			return result;

		}

		setAnimationLoop( callback ) {

			return super.setAnimationLoop( callback && ( ( ...args ) => {

				const start = performance.now();
				callback( ...args );
				metrics.frame += performance.now() - start;
				metrics.frames ++;

			} ) );

		}

	}

	return { ...library, WebGPURenderer };

}

function show( key, text ) {

	const cell = panel().querySelector( `[data-metric="${key}"]` );
	if ( cell ) cell.textContent = text;

}

function report( count, elapsed ) {

	const ms = ( value ) => `${value.toFixed( 2 )} ms`;
	show( 'fps', `${Math.round( count * 1000 / elapsed )} fps` );
	show( 'interval', ms( elapsed / count ) );
	show( 'frame', metrics.frames ? ms( metrics.frame / metrics.frames ) : '–' );
	show( 'render', metrics.renders ? ms( metrics.render / metrics.renders ) : '–' );

	const info = metrics.renderer?.info?.render;
	const calls = info ? ( info.drawCalls ?? info.calls ) : null;
	if ( info ) {

		show( 'calls', calls.toLocaleString() );
		show( 'triangles', Math.round( info.triangles ).toLocaleString() );

	}
	show( 'mini', `${engine === 'three' ? 'three.js' : 'WAMR3D'} · ${Math.round( count * 1000 / elapsed )} fps${info ? ` · ${calls.toLocaleString()} calls` : ''}` );

	if ( metrics.loaded ) show( 'load', `${Math.round( metrics.loaded - metrics.loadStart )} ms` );
	const heap = performance.memory?.usedJSHeapSize;
	show( 'heap', heap ? `${( heap / 1048576 ).toFixed( 1 )} MB` : 'n/a' );

	metrics.render = metrics.frame = 0;
	metrics.renders = metrics.frames = 0;

}

/** Stands in for `three/addons/libs/stats.module.js`: counts frames, shows the rate. */
export class Stats {

	constructor() {

		this.dom = document.createElement( 'span' );
		this._count = 0;
		this._since = performance.now();

	}

	update() {

		state.frames ++;
		this._count ++;
		const now = performance.now();
		if ( ! metrics.loaded ) metrics.loaded = now;
		if ( now - this._since < 500 ) return;
		report( this._count, now - this._since );
		this._count = 0;
		this._since = now;

	}

}
