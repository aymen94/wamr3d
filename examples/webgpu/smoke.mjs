// Checks the WebGPU renderer in headless Chrome or Edge: the image must match the
// reference render of the same scene, and the demo must animate, orbit and pick.
//
//   node examples/browser/serve.mjs        (in another terminal)
//   node examples/webgpu/smoke.mjs
//
// Needs a GPU that the browser exposes to WebGPU.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:8080/examples/webgpu/';
const MEAN_LIMIT = 1.5, DIFFERENT_LIMIT = 0.02;
const port = 9400 + Math.floor( Math.random() * 500 );
const browser = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-webgpu-' ) );
const child = spawn( browser, [ '--headless=new', '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank' ], { stdio: 'ignore' } );
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
	const read = async ( name ) => JSON.parse( ( await send( 'Runtime.evaluate', { expression: `JSON.stringify(window.${name} ?? null)`, returnByValue: true } ) ).result.value );
	const open = async ( page, name ) => {

		await send( 'Page.navigate', { url: BASE + page } );

		for ( let i = 0; i < 80; i ++ ) {

			await sleep( 250 );
			const state = await read( name );
			if ( state?.ready || state?.error ) return state;

		}

		return { error: 'timed out' };

	};
	const shot = async ( file ) => {

		const out = path.join( os.tmpdir(), file );
		fs.writeFileSync( out, Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'png' } ) ).data, 'base64' ) );
		return out;

	};

	const cases = {};
	for ( const [ name, query ] of [ [ 'diffuse', '' ], [ 'standard', '?standard' ], [ 'textured', '?standard&textured' ] ] ) cases[ name ] = await open( 'visual.html' + query, '__visual' );
	const visualShot = await shot( 'wamr3d-webgpu-visual.png' );

	let before = await open( 'index.html?satellites=200', '__native' );
	await sleep( 1500 );
	before = await read( '__native' );
	const mouse = ( type, x, y, buttons ) => send( 'Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 } );
	await mouse( 'mousePressed', 640, 400, 1 );
	for ( let x = 640; x <= 840; x += 20 ) await mouse( 'mouseMoved', x, 400, 1 );
	await mouse( 'mouseReleased', 840, 400, 0 );
	await sleep( 500 );
	const orbited = await read( '__native' );
	await mouse( 'mousePressed', 640, 620, 1 );
	await mouse( 'mouseReleased', 640, 620, 0 );
	await sleep( 500 );
	const after = await read( '__native' );
	const demoShot = await shot( 'wamr3d-webgpu-demo.png' );

	const checks = {
		...Object.fromEntries( Object.entries( cases ).map( ( [ name, v ] ) => [
			`${name}: image matches the reference (mean difference ${v.meanDifference?.toFixed( 3 )} of 255, ${( v.differentFraction * 100 ).toFixed( 2 )}% of pixels off, ${( v.coveredFraction * 100 ).toFixed( 0 )}% covered)`,
			! v.error && v.meanDifference <= MEAN_LIMIT && v.differentFraction <= DIFFERENT_LIMIT && v.coveredFraction > 0.3
		] ) ),
		'demo runs without error': ! after?.error && before?.ready === true,
		'frames are being rendered': after?.frames > before?.frames && before?.frames > 0,
		[ `objects are drawn (${after?.calls} draw calls, ${after?.triangles} triangles)` ]: after?.calls > 100,
		'dragging orbits the camera': orbited?.yaw !== before?.yaw,
		[ `clicking picks an object (${after?.pick})` ]: after?.pick === 'Mesh'
	};

	for ( const [ name, ok ] of Object.entries( checks ) ) console.log( `${ok ? 'PASS' : 'FAIL'}  ${name}` );
	for ( const error of [ ...Object.values( cases ).map( ( v ) => v.error ), after?.error ] ) if ( error ) console.log( error );
	console.log( `screenshots: ${visualShot}, ${demoShot}` );

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
