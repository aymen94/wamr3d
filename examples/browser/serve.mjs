// Static file server for the browser demo. Builds the WebAssembly package first if it
// is missing.
//
//   node examples/browser/serve.mjs [port]
//
// then open http://localhost:8080/examples/browser/

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..', '..' );
const port = Number( process.argv[ 2 ] ) || 8080;

if ( ! fs.existsSync( path.join( root, 'dist', 'wamr3d', 'wamr3d_wasm_bg.wasm' ) ) ) {

	console.log( 'dist/wamr3d not found, building it...' );
	execFileSync( process.execPath, [ path.join( root, 'engine', 'bindings', 'build.mjs' ) ], { stdio: 'inherit' } );

}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/vnd.microsoft.icon' };

http.createServer( ( request, response ) => {

	let file = path.join( root, decodeURIComponent( new URL( request.url, 'http://localhost' ).pathname ) );
	if ( ! file.startsWith( root ) ) return response.writeHead( 403 ).end();
	if ( fs.existsSync( file ) && fs.statSync( file ).isDirectory() ) file = path.join( file, 'index.html' );

	fs.readFile( file, ( error, data ) => {

		if ( error ) return response.writeHead( 404 ).end( 'not found' );
		response.writeHead( 200, { 'Content-Type': types[ path.extname( file ) ] || 'application/octet-stream', 'Cache-Control': 'no-store' } ).end( data );

	} );

} ).listen( port, () => console.log( `WAMR3D demo: http://localhost:${port}/examples/browser/` ) );
