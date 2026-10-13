// Visual parity for the WebGPU renderer, in headless Chrome or Edge.
//
//   node examples/browser/serve.mjs        (in another terminal)
//   node parity/visual/run.mjs             draw each case with WAMR3D, compare with reference/<case>.png
//   node parity/visual/run.mjs --generate  draw each case with three.js r186 and store reference/<case>.png
//   --headed opens a visible browser window instead of a headless one; --browser=edge uses Edge.
//
// Differences and the WAMR3D images go to parity/visual/out/. Needs a GPU that the
// browser exposes to WebGPU.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.js';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const BASE = 'http://localhost:8080/parity/visual/index.html';
const generate = process.argv.includes( '--generate' );
const headed = process.argv.includes( '--headed' ), edge = process.argv.includes( '--browser=edge' );
const port = 9400 + Math.floor( Math.random() * 500 );
const browser = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) && ( ! edge || candidate.includes( 'msedge' ) ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-visual-' ) );
const child = spawn( browser, [ ...( headed ? [] : [ '--headless=new' ] ), '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank' ], { stdio: 'ignore' } );
const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );
const save = ( file, dataUrl ) => fs.writeFileSync( file, Buffer.from( dataUrl.split( ',' )[ 1 ], 'base64' ) );

let failed = false;

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

	const out = path.join( here, 'out' );
	fs.mkdirSync( generate ? path.join( here, 'reference' ) : out, { recursive: true } );

	for ( const name of Object.keys( CASES ) ) {

		await send( 'Page.navigate', { url: `${BASE}?case=${name}${generate ? '&mode=generate' : ''}` } );
		let state = null;

		for ( let i = 0; i < 80 && ! state?.ready; i ++ ) {

			await sleep( 250 );
			state = JSON.parse( ( await send( 'Runtime.evaluate', { expression: 'JSON.stringify(window.__visual?.case === ' + JSON.stringify( name ) + ' ? window.__visual : null)', returnByValue: true } ) ).result.value );

		}

		if ( ! state?.ready || state.error ) {

			failed = true;
			console.log( `FAIL  ${name}: ${state?.error ?? 'timed out'}` );

		} else if ( generate ) {

			save( path.join( here, 'reference', `${name}.png` ), state.png );
			console.log( `wrote reference/${name}.png` );

		} else {

			save( path.join( out, `${name}.difference.png` ), state.png );
			save( path.join( out, `${name}.png` ), state.actualPng );
			if ( ! state.pass ) failed = true;
			const probes = state.probes ? `, probes ${state.probesPass ? 'ok' : 'WRONG'}` : '';
			console.log( `${state.pass ? 'PASS' : 'FAIL'}  ${name}: mean difference ${state.meanDifference.toFixed( 3 )} of 255, ${( state.differentFraction * 100 ).toFixed( 2 )}% of pixels off, ${( state.coveredFraction * 100 ).toFixed( 0 )}% covered${probes}` );

		}

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

process.exit( failed ? 1 : 0 );
