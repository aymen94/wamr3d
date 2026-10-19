// Measures the comparison scene in a real browser (headless Chrome or Edge), one engine
// at a time: warm-up, then a fixed sampling period, for several object counts.
//
//   node examples/browser/serve.mjs        (in another terminal)
//   node examples/compare/measure.mjs [--gpu]
//
// --gpu asks the browser for hardware rendering instead of software rendering. It is
// needed for the WebGPU rows (three-webgpu, native, api), which are skipped without it.
// --engines=a,b limits the run to those engines; --counts=12,2000 sets the object counts.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:8080/examples/';
const WARMUP_MS = 3000, SAMPLE_MS = 8000;
const option = ( name ) => process.argv.find( ( a ) => a.startsWith( `--${name}=` ) )?.split( '=' )[ 1 ].split( ',' );
const gpu = process.argv.includes( '--gpu' );
const [ WIDTH, HEIGHT ] = ( option( 'size' )?.[ 0 ] ?? '1280x720' ).split( 'x' ).map( Number );
const COUNTS = option( 'counts' )?.map( Number ) ?? [ 12, 2000, 10000 ];
const ENGINES = option( 'engines' ) ?? ( gpu ? [ 'three-webgl', 'three-webgpu', 'api', 'native', 'native-mix', 'api-webgl', 'native-webgl', 'native-mix-webgl', 'three', 'wamr3d' ] : [ 'three', 'wamr3d' ] );
const port = 9400 + Math.floor( Math.random() * 500 );

const browserChoice = process.argv.find( ( a ) => a.startsWith( '--browser=' ) )?.slice( 10 ).toLowerCase();
const browser = [
	...( browserChoice === 'edge' ? [ 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' ] : browserChoice === 'chrome' ? [ 'C:/Program Files/Google/Chrome/Application/chrome.exe' ] : [] ),
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-measure-' ) );
const flags = [ '--headless=new', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--window-size=${WIDTH},${HEIGHT}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding' ];
flags.push( ...( gpu ? [ '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu' ] : [ '--enable-unsafe-swiftshader' ] ) );
const child = spawn( browser, [ ...flags, 'about:blank' ], { stdio: 'ignore' } );
const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

const summary = ( values ) => {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const at = ( p ) => sorted[ Math.min( sorted.length - 1, Math.floor( sorted.length * p ) ) ];
	return { median: at( 0.5 ), p95: at( 0.95 ), mean: sorted.reduce( ( a, b ) => a + b, 0 ) / sorted.length };

};

try {

	let target;
	for ( let i = 0; i < 40 && ! target; i ++ ) {

		await sleep( 250 );
		target = await fetch( `http://127.0.0.1:${port}/json` ).then( ( r ) => r.json() ).then( ( pages ) => pages.find( ( p ) => p.type === 'page' ) ).catch( () => undefined );

	}

	const socket = new WebSocket( target.webSocketDebuggerUrl );
	await new Promise( ( resolve ) => socket.addEventListener( 'open', resolve ) );
	let id = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( event ) => {

		const message = JSON.parse( event.data );
		pending.get( message.id )?.( message.result );

	} );
	const send = ( method, params = {} ) => new Promise( ( resolve ) => {

		pending.set( ++ id, resolve );
		socket.send( JSON.stringify( { id, method, params } ) );

	} );
	const evaluate = async ( expression ) => JSON.parse( ( await send( 'Runtime.evaluate', { expression: `JSON.stringify(${expression})`, returnByValue: true } ) ).result.value ?? 'null' );

	const rows = [];
	// The window size includes space the page does not get; fix the page's viewport exactly.
	await send( 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false } );
	let environment = '', canvasSize = '?';

	for ( const satellites of COUNTS ) for ( const engine of ENGINES ) {

		const url = `${BASE}compare/run.html?engine=${engine}&satellites=${satellites}`;
		await send( 'Page.navigate', { url } );

		let ready = false;
		for ( let i = 0; i < 120 && ! ready; i ++ ) {

			await sleep( 250 );
			const state = await evaluate( 'window.__stats ? { ready: window.__stats.ready, error: window.__stats.error } : null' );
			if ( state?.error ) throw new Error( state.error );
			ready = state?.ready === true;

		}

		await sleep( WARMUP_MS );
		await evaluate( '( window.__stats.reset(), 0 )' );
		await sleep( SAMPLE_MS );
		const stats = await evaluate( '( ( { frame, update, render, firstFrameMs, wasmInitMs, objects, gpu, name } ) => ( { frame, update, render, firstFrameMs, wasmInitMs, objects, gpu, name } ) )( window.__stats )' );

		environment = stats.gpu;
		canvasSize = await evaluate( '( ( c ) => c ? `${c.width}x${c.height}` : "?" )( document.querySelector( "canvas" ) )' );
		rows.push( { engine, name: stats.name, objects: stats.objects, frames: stats.frame.length, frame: summary( stats.frame ), update: summary( stats.update ), render: summary( stats.render ), firstFrameMs: stats.firstFrameMs, wasmInitMs: stats.wasmInitMs } );

	}

	const version = await send( 'Browser.getVersion' );
	console.log( `${version.product}, ${os.platform()} ${os.arch()}, ${os.cpus()[ 0 ].model.trim()}` );
	console.log( `GPU: ${environment}` );
	console.log( 'three-webgl, three-webgpu: three.js with its own renderer. api: WAMR3D object API and WebGPU renderer. These three run the same scene code.' );
	console.log( 'native: WAMR3D batched API and WebGPU renderer; native-mix: wamr3d/math JavaScript values feed batched transforms to the same Wasm scene and renderer. The -webgl variants use WAMR3D WebGL 2.' );
	console.log( 'three, wamr3d: three.js and WAMR3D transforms, both drawn by the three.js WebGL renderer (with a grid).' );
	console.log( `window ${WIDTH}x${HEIGHT}, canvas ${canvasSize}, pixel ratio 1, warm-up ${WARMUP_MS / 1000} s, sample ${SAMPLE_MS / 1000} s per run, one engine per page load` );
	console.log( '' );
	console.log( 'objects  engine         frames   frame ms (median / p95)   fps   CPU update ms (median / p95)   draw submit ms (median)   first frame ms   wasm init ms' );
	const f = ( x, digits = 2 ) => x.toFixed( digits );
	for ( const r of rows ) {

		console.log( [
			String( r.objects ).padStart( 7 ), ' ', r.engine.padEnd( 13 ), String( r.frames ).padStart( 7 ),
			`${f( r.frame.median )} / ${f( r.frame.p95 )}`.padStart( 22 ), f( 1000 / r.frame.median, 0 ).padStart( 9 ),
			`${f( r.update.median, 3 )} / ${f( r.update.p95, 3 )}`.padStart( 24 ), f( r.render.median, 3 ).padStart( 22 ),
			f( r.firstFrameMs, 0 ).padStart( 19 ), ( r.wasmInitMs === null ? '-' : f( r.wasmInitMs, 1 ) ).padStart( 14 ), '   ', r.name
		].join( '' ) );

	}

	socket.close();

} finally {

	child.kill();

	// On Windows the browser relaunches itself, so the process started above is not the
	// one that keeps running. Everything using this run's profile folder is stopped.
	if ( process.platform === 'win32' ) {

		const filter = `$_.Name -match 'chrome|msedge' -and $_.CommandLine -like '*${path.basename( profile )}*'`;
		spawnSync( 'powershell', [ '-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { ${filter} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }` ] );

	}

}
