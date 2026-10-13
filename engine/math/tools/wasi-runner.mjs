// Runs a wasm32-wasip1 test binary under Node's WASI, so `cargo test --target wasm32-wasip1`
// works (see .cargo/config.toml). This is how the simd128 path is executed: it only exists
// on wasm32. The parity fixtures are mounted at /parity.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';

const [ file, ...args ] = process.argv.slice( 2 );
const parity = fileURLToPath( new URL( '../../../parity/math', import.meta.url ) );

const wasi = new WASI( {
	version: 'preview1',
	args: [ file, ...args ],
	env: { WAMR_PARITY_DIR: '/parity' },
	preopens: { '/parity': parity }
} );

const module = await WebAssembly.compile( fs.readFileSync( file ) );
const instance = await WebAssembly.instantiate( module, wasi.getImportObject() );
process.exit( wasi.start( instance ) );
