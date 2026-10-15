// Builds the WAMR3D WebAssembly module and assembles the importable package in dist/wamr3d.
//
//   node engine/bindings/build.mjs
//
// Needs: a Rust toolchain with the wasm32-unknown-unknown target, and the wasm-bindgen
// CLI at the version pinned in engine/bindings/Cargo.toml. Both are looked up on PATH
// and then in ~/.cargo/bin.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const engine = path.resolve( here, '..' );
const dist = path.resolve( engine, '..', 'dist', 'wamr3d' );
const exe = process.platform === 'win32' ? '.exe' : '';

function tool( name ) {

	const inCargoHome = path.join( os.homedir(), '.cargo', 'bin', name + exe );
	return fs.existsSync( inCargoHome ) ? inCargoHome : name;

}

function run( command, args ) {

	console.log( `> ${path.basename( command )} ${args.join( ' ' )}` );
	execFileSync( command, args, { cwd: engine, stdio: 'inherit', env } );

}

// WebAssembly SIMD is on unless --no-simd is given: every browser with WebGPU has it. The
// SIMD kernels give the same results bit for bit as the scalar ones (DECISIONS.md D3).
const simd = ! process.argv.includes( '--no-simd' );
const env = simd ? { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-feature=+simd128`.trim() } : process.env;

run( tool( 'cargo' ), [ 'build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'wamr3d', ...( simd ? [ '--features', 'wamr-math/simd' ] : [] ) ] );

fs.rmSync( dist, { recursive: true, force: true } );
run( tool( 'wasm-bindgen' ), [
	'--target', 'web',
	'--out-dir', dist,
	'--out-name', 'wamr3d_wasm',
	path.join( engine, 'target', 'wasm32-unknown-unknown', 'release', 'wamr3d.wasm' )
] );

for ( const file of [ 'index.js', 'index.d.ts', 'compat.js', 'compat.d.ts', 'webgpu.js', 'webgl.js', 'package.json', 'README.md' ] ) {

	fs.copyFileSync( path.join( here, 'js', file ), path.join( dist, file ) );

}

// The modules behind compat.js and webgpu.js.
for ( const folder of [ 'compat', 'webgpu' ] ) {

	if ( fs.existsSync( path.join( here, 'js', folder ) ) ) fs.cpSync( path.join( here, 'js', folder ), path.join( dist, folder ), { recursive: true } );

}

const wasm = fs.statSync( path.join( dist, 'wamr3d_wasm_bg.wasm' ) ).size;
console.log( `built ${dist} (wamr3d_wasm_bg.wasm: ${( wasm / 1024 ).toFixed( 1 )} KiB)` );
