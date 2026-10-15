// Opens every ported example in headless Chrome or Edge and checks that it draws frames
// without errors, on WAMR3D and, with --three, also on three.js (loaded from a CDN).
//
//   node examples/browser/serve.mjs                (in another terminal)
//   node examples/ports/check.mjs [--three] [--webgl] [--only=stack,city] [--shots=folder] [--thumbs=folder]
//
// Needs a GPU that the browser exposes to WebGPU.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const option = ( name, fallback ) => process.argv.find( ( a ) => a.startsWith( `--${name}=` ) )?.split( '=' )[ 1 ] ?? fallback;
// --base=http://localhost:4173/examples/ports/ checks the built website instead.
const BASE = option( 'base', 'http://localhost:8080/examples/ports/' );
const here = path.dirname( fileURLToPath( import.meta.url ) );
const all = fs.readdirSync( here, { withFileTypes: true } ).filter( ( e ) => e.isDirectory() && fs.existsSync( path.join( here, e.name, 'index.html' ) ) ).map( ( e ) => e.name );
const ports = option( 'only', '' ) ? option( 'only', '' ).split( ',' ) : all;
// --webgl also runs WAMR3D on its WebGL 2 backend
const engines = [ 'wamr3d', ...( process.argv.includes( '--webgl' ) ? [ 'wamr3d-webgl' ] : [] ), ...( process.argv.includes( '--three' ) ? [ 'three' ] : [] ) ];
const shots = option( 'shots', '' );
if ( shots ) fs.mkdirSync( shots, { recursive: true } );
// --thumbs=website/images/examples writes the 640×360 card images of the website.
const thumbs = option( 'thumbs', '' );
if ( thumbs ) fs.mkdirSync( thumbs, { recursive: true } );

const port = 9400 + Math.floor( Math.random() * 500 );
const browser = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-ports-' ) );
const child = spawn( browser, [ '--headless=new', '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1280,720', 'about:blank' ], { stdio: 'ignore' } );
const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );
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
	let problems = [];
	socket.addEventListener( 'message', ( event ) => {

		const message = JSON.parse( event.data );
		if ( message.method === 'Runtime.exceptionThrown' ) problems.push( message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text );
		if ( message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error' ) problems.push( message.params.args.map( ( a ) => a.value ?? a.description ).join( ' ' ) );
		pending.get( message.id )?.( message.result );

	} );
	const send = ( method, params = {} ) => new Promise( ( resolve ) => {

		pending.set( ++ id, resolve );
		socket.send( JSON.stringify( { id, method, params } ) );

	} );
	const evaluate = async ( expression ) => JSON.parse( ( await send( 'Runtime.evaluate', { expression: `JSON.stringify(${expression})`, returnByValue: true } ) ).result.value ?? 'null' );
	await send( 'Runtime.enable' );
	await send( 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false } );

	for ( const name of ports ) {

		for ( const engine of engines ) {

			problems = [];
			await send( 'Page.navigate', { url: `${BASE}${name}/${engine === 'three' ? '?engine=three' : engine === 'wamr3d-webgl' ? '?backend=webgl' : ''}` } );
			let state = null;
			const started = Date.now();
			while ( Date.now() - started < 20000 ) {

				await sleep( 500 );
				state = await evaluate( 'window.__port ?? null' );
				if ( state?.error || state?.frames > 60 ) break;

			}

			const ok = state && ! state.error && state.frames > 60 && problems.length === 0;
			console.log( `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd( 18 )} ${engine.padEnd( 7 )} ${state?.frames ?? 0} frames${state?.error ? ` · ${state.error}` : ''}${problems.length ? ` · ${problems[ 0 ]}` : ''}` );
			if ( ! ok ) failed = true;
			if ( shots ) fs.writeFileSync( path.join( shots, `${name}-${engine}.png` ), Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'png' } ) ).data, 'base64' ) );
			if ( thumbs && engine === 'wamr3d' ) {

				await evaluate( 'document.querySelectorAll( "#info, #engine, #controls, #instructions" ).forEach( ( e ) => e.style.visibility = "hidden" )' );
				await sleep( 100 );
				const clip = { x: 0, y: 0, width: 1280, height: 720, scale: 0.5 };
				fs.writeFileSync( path.join( thumbs, `${name}.jpg` ), Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'jpeg', quality: 78, clip } ) ).data, 'base64' ) );

			}

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
