// Browser smoke test: opens the demo in headless Chrome or Edge, waits for frames,
// drags the mouse across the canvas and reads the page's diagnostics.
//
//   node examples/browser/serve.mjs        (in another terminal)
//   node examples/browser/smoke.mjs [url]
//
// The default page loads no three.js. Add ?compare=1 for the transform check against
// three.js and ?renderer=three for the reference adapter; both load it from a CDN.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[ 2 ] || 'http://localhost:8080/examples/browser/';
const adapter = url.includes( 'renderer=three' ), comparing = url.includes( 'compare=1' );
const port = 9400 + Math.floor( Math.random() * 500 );
const browser = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-smoke-' ) );
const child = spawn( browser, [ '--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1280,800', url ], { stdio: 'ignore' } );
const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

let failed = true;

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
	const read = async ( expression ) => ( await send( 'Runtime.evaluate', { expression: `JSON.stringify(${expression})`, returnByValue: true } ) ).result.value;
	const state = async () => JSON.parse( await read( '({ ...window.__wamr3d, fps: document.getElementById("fps").textContent, parityText: document.getElementById("parity").textContent, three: performance.getEntriesByType("resource").filter((e) => /three/.test(e.name)).length })' ) );

	await sleep( 3000 );
	const before = await state();

	const mouse = ( type, x, y, buttons ) => send( 'Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 } );
	await mouse( 'mousePressed', 640, 400, 1 );
	for ( let x = 640; x <= 840; x += 20 ) await mouse( 'mouseMoved', x, 400 + ( x - 640 ) / 4, 1 );
	await mouse( 'mouseReleased', 840, 450, 0 );
	await sleep( 1000 );
	const after = await state();

	const screenshot = await send( 'Page.captureScreenshot', { format: 'png' } );
	const shot = path.join( os.tmpdir(), 'wamr3d-smoke.png' );
	fs.writeFileSync( shot, Buffer.from( screenshot.data, 'base64' ) );

	const checks = {
		'WebAssembly initialized': after.wasm === 'ready',
		'no page error': after.error === null,
		'frames are being rendered': after.frames > before.frames && before.frames > 0,
		'frame rate is shown': /^\d+$/.test( after.fps ),
		[ `drawn by ${after.renderer} (${after.calls} draw calls)` ]: adapter ? after.renderer === 'three.js WebGL adapter' : after.renderer === 'WAMR3D (WebGPU)' && after.calls === 15,
		'objects in world': after.objects === ( adapter ? 16 : 18 ),
		[ comparing ? 'transform parity with three.js passes' : 'comparison is off' ]: after.parity === ( comparing ? 'pass' : 'off' ),
		[ adapter || comparing ? `three.js was loaded from the CDN (${after.three} files)` : 'three.js was not loaded' ]: adapter || comparing ? after.three > 0 : after.three === 0,
		'dragging orbits the camera': after.camera.yaw !== before.camera.yaw && after.camera.pitch !== before.camera.pitch
	};

	for ( const [ name, ok ] of Object.entries( checks ) ) console.log( `${ok ? 'PASS' : 'FAIL'}  ${name}` );
	console.log( `frames ${before.frames} -> ${after.frames}, ${after.fps} fps, largest difference ${after.largestDifference?.toExponential( 2 )}, yaw ${before.camera.yaw.toFixed( 3 )} -> ${after.camera.yaw.toFixed( 3 )}` );
	if ( after.error ) console.log( after.error );
	console.log( `screenshot: ${shot}` );

	failed = Object.values( checks ).includes( false );
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

process.exit( failed ? 1 : 0 );
