// Shared by the ported examples. Each port was written for three.js; here it receives
// the library from `loadLibrary()` instead of `import * as THREE from 'three'`, so the
// same code runs on WAMR3D (the default) or, with `?engine=three`, on three.js r186
// loaded from a CDN for comparison. WAMR3D never loads three.js.

import { THREE_VERSION, loadThreeWebGPU } from '../three-reference.js';

const params = new URLSearchParams( location.search );
export const engine = params.get( 'engine' ) === 'three' ? 'three' : 'wamr3d';

// Read by `check.mjs`.
const state = window.__port = { engine, ready: false, frames: 0, error: null };

function panel() {

	let element = document.getElementById( 'engine' );
	if ( element ) return element;
	element = document.createElement( 'div' );
	element.id = 'engine';
	document.body.append( element );
	return element;

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
	element.innerHTML = `<strong>${engine === 'three' ? `three.js r${THREE_VERSION.split( '.' )[ 1 ]}` : 'WAMR3D'}</strong> · WebGPU · <span data-fps>– fps</span><br><a href="${other.href}">run on ${engine === 'three' ? 'WAMR3D' : 'three.js'} instead</a>`;

	const THREE = engine === 'three' ? await loadThreeWebGPU() : await import( '../../dist/wamr3d/compat.js' );
	if ( engine === 'wamr3d' ) await THREE.init();
	state.ready = true;
	return THREE;

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
		if ( now - this._since < 500 ) return;
		const fps = panel().querySelector( '[data-fps]' );
		if ( fps ) fps.textContent = `${Math.round( this._count * 1000 / ( now - this._since ) )} fps`;
		this._count = 0;
		this._since = now;

	}

}
