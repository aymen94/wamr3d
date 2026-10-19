// Drives the showcase in headless Chrome or Edge.
//
//   node examples/browser/serve.mjs                (in another terminal)
//   node examples/showcase/check.mjs               works through the settings panel and all eight paths
//   node examples/showcase/check.mjs --measure     runs the built-in comparison and prints the table
//       [--counts=2000,10000,50000] [--modes=objects,instanced] [--engines=wamr3d,three-webgl]
//
// Needs a GPU that the browser exposes to WebGPU.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:8080/examples/showcase/';
const option = ( name, fallback ) => process.argv.find( ( a ) => a.startsWith( `--${name}=` ) )?.split( '=' )[ 1 ] ?? fallback;
const measure = process.argv.includes( '--measure' );
const [ WIDTH, HEIGHT ] = option( 'size', '1280x720' ).split( 'x' ).map( Number );
const port = 9400 + Math.floor( Math.random() * 500 );
const browserChoice = option( 'browser', '' ).toLowerCase();
const browser = [
	...( browserChoice === 'edge' ? [ 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' ] : browserChoice === 'chrome' ? [ 'C:/Program Files/Google/Chrome/Application/chrome.exe' ] : [] ),
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/usr/bin/google-chrome', '/usr/bin/chromium'
].find( ( candidate ) => fs.existsSync( candidate ) );
if ( ! browser ) throw new Error( 'no Chrome or Edge found' );

const profile = fs.mkdtempSync( path.join( os.tmpdir(), 'wamr3d-showcase-' ) );
const child = spawn( browser, [ '--headless=new', '--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--window-size=${WIDTH},${HEIGHT}`, 'about:blank' ], { stdio: 'ignore' } );
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
	const pending = new Map(), problems = [];
	socket.addEventListener( 'message', ( event ) => {

		const message = JSON.parse( event.data );
		if ( message.method === 'Runtime.exceptionThrown' ) problems.push( message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text );
		if ( message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error' ) problems.push( message.params.args.map( ( a ) => a.value ?? a.description ).join( ' ' ) );
		pending.get( message.id )?.( message.result );

	} );
	// A page that stops answering fails the run instead of stalling it.
	const send = ( method, params = {} ) => new Promise( ( resolve, reject ) => {

		const timer = setTimeout( () => reject( new Error( `the page did not answer ${method} within 30 s` ) ), 30000 );
		pending.set( ++ id, ( result ) => { clearTimeout( timer ); resolve( result ); } );
		socket.send( JSON.stringify( { id, method, params } ) );

	} );
	const evaluate = async ( expression ) => JSON.parse( ( await send( 'Runtime.evaluate', { expression: `JSON.stringify(${expression})`, returnByValue: true } ) ).result.value ?? 'null' );
	await send( 'Runtime.enable' );
	// The window size includes space the page does not get; fix the page's viewport exactly.
	await send( 'Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false } );

	if ( measure ) {

		const counts = option( 'counts', '2000,10000,50000' ), modes = option( 'modes', 'objects,instanced' ), engines = option( 'engines', '' );
		await send( 'Page.navigate', { url: `${BASE}?bench=${counts}&modes=${modes}${engines ? `&engines=${engines}` : ''}` } );
		let printed = 0;

		console.log( `${( await send( 'Browser.getVersion' ) ).product}, ${os.cpus()[ 0 ].model.trim()}; window ${WIDTH}x${HEIGHT}; medians over 4 s after a 1.5 s warm-up; one engine at a time` );
		console.log( 'update = animation, transforms and world matrices on the CPU; submit = the renderer on the CPU. GPU time is not measured; it only shows in fps (display limit 60).' );
		console.log( '\nbodies   drawn as    renderer                           fps   frame ms   update ms   submit ms   draw calls   build ms' );

		for ( ;; ) {

			await sleep( 1000 );
			const state = await evaluate( '{ rows: window.__showcase?.results ?? [], done: window.__showcase?.benchDone === true }' );

			for ( const row of state.rows.slice( printed ) ) {

				printed ++;
				if ( row.error ) console.log( `${row.engine}: failed: ${row.error.split( '\n' )[ 0 ]}` );
				else console.log( [ String( row.bodies ).padStart( 6 ), '   ', row.mode.padEnd( 12 ), row.label.padEnd( 30 ), row.fps.toFixed( 1 ).padStart( 8 ), row.frame.toFixed( 1 ).padStart( 11 ), row.update.toFixed( 2 ).padStart( 12 ), row.submit.toFixed( 2 ).padStart( 12 ), String( row.calls ).padStart( 13 ), row.buildMs.toFixed( 0 ).padStart( 11 ) ].join( '' ) );

			}

			if ( state.done ) break;

		}
		console.log( `canvas ${await evaluate( '( ( c ) => c && c.width + "x" + c.height )( document.querySelector( "#stage canvas" ) )' )}, device pixel ratio ${await evaluate( 'devicePixelRatio' )}` );

	} else {

		const read = () => evaluate( '( ( s ) => s && { ready: s.ready, error: s.error, engine: s.engine, frames: s.frames, stats: s.stats, config: s.config, three: performance.getEntriesByType( "resource" ).filter( ( e ) => /three/.test( e.name ) ).length } )( window.__showcase )' );
		const settle = async () => {

			for ( let i = 0; i < 120; i ++ ) {

				await sleep( 250 );
				const state = await read();
				if ( state?.error || ( state?.ready && state.frames > 90 && state.stats ) ) return state;

			}

			return ( await read() ) ?? { error: 'timed out' };

		};
		// sets a control of the settings panel the way a person would, through its input element
		const set = ( index, value ) => evaluate( `( ( input ) => { if ( input.type === 'checkbox' ) input.checked = ${JSON.stringify( value )}; else input.value = ${JSON.stringify( value )}; input.dispatchEvent( new Event( input.type === 'range' ? 'input' : 'change' ) ); return true; } )( document.querySelectorAll( '#controls select, #controls input' )[ ${index} ] )` );
		const checks = [];
		const check = ( name, ok ) => {

			checks.push( ok );
			console.log( `${ok ? 'PASS' : 'FAIL'}  ${name}` );

		};

		// controls in page order: 0 engine, 1 bodies, 2 drawn as, 3 shape, 4 speed, 5 orbit, 6 shading, 7 roughness, 8 metalness, 9 sun, 10 sky, 11 fog, 12 fog density
		await send( 'Page.navigate', { url: `${BASE}?count=2000` } );
		let state = await settle();
		check( `starts with ${state.engine}: ${state.stats?.calls} draw calls at ${state.stats?.fps.toFixed( 0 )} fps`, ! state.error && state.engine === 'WAMR3D · batched API' && state.stats.calls > 1500 );

		check( 'three.js is not loaded while WAMR3D draws', state.three === 0 );

		const before = state.frames;
		await set( 11, false );
		await set( 12, '0.03' );
		await set( 7, '0.9' );
		await set( 9, '80' );
		await set( 4, '3' );
		await set( 5, false );
		await sleep( 600 );
		state = await read();
		check( 'light, fog, material and speed change while it runs', ! state.error && state.frames > before && state.config.fog === false && state.config.roughness === 0.9 && state.config.sun === 80 && state.config.speed === 3 );

		await set( 2, 'instanced' );
		state = await settle();
		check( `switching to instanced meshes rebuilds in place: ${state.stats?.calls} draw calls`, ! state.error && state.stats.calls === 5 );

		await set( 1, '10000' );
		await set( 3, 'torus' );
		state = await settle();
		check( `10,000 bodies of one shape: ${state.stats?.calls} draw calls, ${Math.round( state.stats?.triangles ).toLocaleString( 'en' )} triangles`, ! state.error && state.stats.calls === 3 && state.stats.triangles > 2_000_000 );

		for ( const [ engine, name ] of [ [ 'wamr3d-api', 'WAMR3D · object API' ], [ 'wamr3d-api-webgl', 'WAMR3D · object API · WebGL' ], [ 'wamr3d-webgl', 'WAMR3D · batched API · WebGL' ], [ 'wamr3d-mix', 'WAMR3D · JS math + WebGPU' ], [ 'wamr3d-mix-webgl', 'WAMR3D · JS math + WebGL' ], [ 'three-webgpu', 'three.js · WebGPU' ], [ 'three-webgl', 'three.js · WebGL' ], [ 'wamr3d', 'WAMR3D · batched API' ] ] ) {

			await set( 0, engine );
			state = await settle();
			check( `engine ${engine} draws the same scene: ${state.stats?.fps.toFixed( 0 )} fps, update ${state.stats?.update.toFixed( 1 )} ms`, ! state.error && state.engine === name && state.frames > 20 );

		}

		await set( 2, 'objects' );
		await set( 6, 'lambert' );
		state = await settle();
		check( `back to separate meshes with diffuse shading: ${state.stats?.calls} draw calls`, ! state.error && state.stats.calls > 5000 && state.config.material === 'lambert' );

		check( `no errors in the console${problems.length ? ': ' + problems[ 0 ] : ''}`, problems.length === 0 );

		const shot = path.join( os.tmpdir(), 'wamr3d-showcase.png' );
		fs.writeFileSync( shot, Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'png' } ) ).data, 'base64' ) );
		console.log( `screenshot: ${shot}` );
		failed = checks.includes( false );

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
