// OBJLoader, MTLLoader and HDRLoader on small files built here, parsed in Node through
// the built package. Run `npm run build` first.
import * as C from '../../dist/wamr3d/compat.js';
import { OBJLoader } from '../../dist/wamr3d/addons/loaders/OBJLoader.js';
import { MTLLoader } from '../../dist/wamr3d/addons/loaders/MTLLoader.js';
import { HDRLoader } from '../../dist/wamr3d/addons/loaders/HDRLoader.js';
import { RGBELoader } from '../../dist/wamr3d/addons/loaders/RGBELoader.js';

await C.init();

let failed = 0;
const check = ( name, ok, detail = '' ) => {

	if ( ! ok ) failed ++;
	console.log( ( ok ? 'PASS  ' : 'FAIL  ' ) + name + ( detail ? ': ' + detail : '' ) );

};

const close = ( a, b, e = 1e-6 ) => Math.abs( a - b ) <= e;

// ---------------------------------------------------------------- MTL and OBJ

const mtl = new MTLLoader().parse( `
# two materials
newmtl red
Kd 1 0 0
Ks 0.5 0.5 0.5
Ns 40
d 0.5
newmtl green
Kd 0 1 0
Tr 0
`, '' );
mtl.preload();
const red = mtl.create( 'red' );
check( 'MTL material', red.isMeshPhongMaterial && red.name === 'red' && red.color.r === 1 && red.color.g === 0 && red.shininess === 40 && red.opacity === 0.5 && red.transparent === true );
check( 'MTL specular is converted from sRGB', close( red.specular.r, 0.21404114, 1e-5 ) );

const obj = new OBJLoader().setMaterials( mtl ).parse( `
mtllib cube.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
o quad
usemtl red
f 1/1/1 2/2/1 3/3/1 4/4/1
usemtl green
f -5/1/1 -3/3/1 -1/4/1
o line
l 1 2 3
o dots
p 1 3 5
` );
const [ quad, line, dots ] = obj.children;
check( 'OBJ objects', obj.children.length === 3 && quad.name === 'quad' && line.name === 'line' && dots.name === 'dots', obj.children.map( ( c ) => c.type + ':' + c.name ).join( ', ' ) );
check( 'OBJ polygon fan and negative indices', quad.isMesh && quad.geometry.attributes.position.count === 9 && quad.geometry.attributes.position.getZ( 8 ) === 1 );
check( 'OBJ material groups', Array.isArray( quad.material ) && quad.material.length === 2 && quad.geometry.groups.length === 2 && quad.geometry.groups[ 1 ].start === 6 && quad.material[ 1 ].name === 'green' );
check( 'OBJ uvs and normals', quad.geometry.attributes.uv.count === 9 && quad.geometry.attributes.normal.getZ( 0 ) === 1 && quad.geometry.attributes.uv.getX( 1 ) === 1 );
check( 'OBJ lines', line.isLineSegments && line.geometry.attributes.position.count === 4 );
check( 'OBJ points', dots.isPoints && dots.geometry.attributes.position.count === 3 );
check( 'OBJ material libraries', obj.materialLibraries[ 0 ] === 'cube.mtl' );

const flat = new OBJLoader().parse( 'v 0 0 0\nv 1 0 0\nv 0 1 0\ns off\nf 1 2 3\n' ).children[ 0 ];
check( 'OBJ without normals: computed, flat with `s off`', flat.geometry.attributes.normal.getZ( 0 ) === 1 && flat.material.flatShading === true && flat.material.isMeshPhongMaterial );

// ---------------------------------------------------------------- HDR

// value = mantissa * 2^(exponent - 136): (128, 64, 32, e = 129) is (1, 0.5, 0.25)
const header = ( w, h ) => new TextEncoder().encode( `#?RADIANCE\n# test\nFORMAT=32-bit_rle_rgbe\nEXPOSURE=2\n\n-Y ${h} +X ${w}\n` );
const join = ( ...parts ) => {

	const out = new Uint8Array( parts.reduce( ( n, p ) => n + p.length, 0 ) );
	let o = 0;
	for ( const p of parts ) {

		out.set( p, o ); o += p.length;

	}

	return out.buffer;

};

const flatFile = join( header( 2, 1 ), new Uint8Array( [ 128, 64, 32, 129, 0, 0, 0, 0 ] ) );
const flatData = new HDRLoader().setDataType( C.FloatType ).parse( flatFile );
check( 'HDR flat pixels', flatData.width === 2 && flatData.height === 1 && Array.from( flatData.data ).join() === '1,0.5,0.25,1,0,0,0,1' && flatData.exposure === 2, Array.from( flatData.data ).join() );

// an 8-wide scanline, run-length encoded: one run per channel, red as literals
const rle = [ 2, 2, 0, 8, 8, 10, 20, 30, 40, 50, 60, 70, 80, 128 + 8, 64, 128 + 8, 0, 128 + 8, 136 ];
const rleData = new HDRLoader().parse( join( header( 8, 1 ), new Uint8Array( rle ) ) );
check( 'HDR run-length scanlines as half floats', rleData.type === C.HalfFloatType && rleData.data instanceof Uint16Array && C.DataUtils.fromHalfFloat( rleData.data[ 4 ] ) === 20 && C.DataUtils.fromHalfFloat( rleData.data[ 5 ] ) === 64, [ 0, 4, 5 ].map( ( i ) => C.DataUtils.fromHalfFloat( rleData.data[ i ] ) ).join() );
check( 'RGBELoader is HDRLoader', new RGBELoader() instanceof HDRLoader );
check( 'HDR rejects other files', ( () => {

	try {

		new HDRLoader().parse( new TextEncoder().encode( 'not an image' ).buffer );
		return false;

	} catch {

		return true;

	}

} )() );

process.exitCode = failed ? 1 : 0;
