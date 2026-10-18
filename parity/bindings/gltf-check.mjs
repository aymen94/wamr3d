// GLTFLoader on a small glTF built here (meshes, materials, morph targets, skins, sparse
// accessors, animation, cameras, lights, instancing, lines and points), parsed in Node
// through the built package. Run `npm run build` first.
import * as C from '../../dist/wamr3d/compat.js';
import { GLTFLoader } from '../../dist/wamr3d/addons/loaders/GLTFLoader.js';

await C.init();

// buffer: positions (3 vertices), normals, indices (uint16, padded), morph position deltas,
// joints (uint8 x4), weights (float x4), inverse bind matrices (2), times, translations, instance offsets
const f32 = ( a ) => new Uint8Array( new Float32Array( a ).buffer );
const parts = [];
let offset = 0;
const views = [];
const add = ( bytes, target ) => {

	while ( offset % 4 ) {

		parts.push( new Uint8Array( 1 ) ); offset ++;

	}

	views.push( { buffer: 0, byteOffset: offset, byteLength: bytes.length, ...( target ? { target } : {} ) } );
	parts.push( bytes ); offset += bytes.length;
	return views.length - 1;

};

const positions = add( f32( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ] ) );
const normals = add( f32( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ] ) );
const indices = add( new Uint8Array( new Uint16Array( [ 0, 1, 2 ] ).buffer ) );
const deltas = add( f32( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ] ) );
const joints = add( new Uint8Array( [ 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0 ] ) );
const weights = add( f32( [ 0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 ] ) );
const ibm = add( f32( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, - 1, 0, 0, 1 ] ) );
const times = add( f32( [ 0, 1 ] ) );
const translations = add( f32( [ 0, 0, 0, 2, 0, 0 ] ) );
const instanceOffsets = add( f32( [ 0, 0, 0, 5, 0, 0 ] ) );
const total = new Uint8Array( offset );
let o = 0;
for ( const p of parts ) {

	total.set( p, o ); o += p.length;

}

const uri = 'data:application/octet-stream;base64,' + Buffer.from( total ).toString( 'base64' );

const gltf = {
	asset: { version: '2.0' },
	extensionsUsed: [ 'KHR_lights_punctual', 'KHR_materials_clearcoat', 'EXT_mesh_gpu_instancing' ],
	extensions: { KHR_lights_punctual: { lights: [ { type: 'spot', color: [ 1, 0.5, 0.25 ], intensity: 3, spot: { innerConeAngle: 0.2, outerConeAngle: 0.4 } } ] } },
	buffers: [ { uri, byteLength: offset } ],
	bufferViews: views,
	accessors: [
		{ bufferView: positions, componentType: 5126, count: 3, type: 'VEC3', min: [ 0, 0, 0 ], max: [ 1, 1, 0 ] },
		{ bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' },
		{ bufferView: indices, componentType: 5123, count: 3, type: 'SCALAR' },
		{ bufferView: deltas, componentType: 5126, count: 3, type: 'VEC3' },
		{ bufferView: joints, componentType: 5121, count: 3, type: 'VEC4' },
		{ bufferView: weights, componentType: 5126, count: 3, type: 'VEC4' },
		{ bufferView: ibm, componentType: 5126, count: 2, type: 'MAT4' },
		{ bufferView: times, componentType: 5126, count: 2, type: 'SCALAR', min: [ 0 ], max: [ 1 ] },
		{ bufferView: translations, componentType: 5126, count: 2, type: 'VEC3' },
		{ bufferView: instanceOffsets, componentType: 5126, count: 2, type: 'VEC3' },
		{ componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 1, indices: { bufferView: indices, componentType: 5123 }, values: { bufferView: deltas } } }
	],
	materials: [
		{ name: 'red', pbrMetallicRoughness: { baseColorFactor: [ 1, 0, 0, 0.5 ], metallicFactor: 0.25, roughnessFactor: 0.75 }, alphaMode: 'BLEND', doubleSided: true, extensions: { KHR_materials_clearcoat: { clearcoatFactor: 0.5 } } },
		{ name: 'flat', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorFactor: [ 0, 1, 0, 1 ] } }
	],
	meshes: [
		{ name: 'morphed', primitives: [ { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, targets: [ { POSITION: 3 } ] } ], weights: [ 0.5 ], extras: { targetNames: [ 'lift' ] } },
		{ name: 'skinned', primitives: [ { attributes: { POSITION: 0, JOINTS_0: 4, WEIGHTS_0: 5 }, indices: 2, material: 1 } ] },
		{ name: 'lines', primitives: [ { attributes: { POSITION: 0 }, mode: 2 }, { attributes: { POSITION: 10 }, mode: 0 } ] }
	],
	skins: [ { joints: [ 3, 4 ], inverseBindMatrices: 6 } ],
	cameras: [ { type: 'perspective', perspective: { yfov: 0.8, aspectRatio: 1.5, znear: 0.1, zfar: 100 } } ],
	nodes: [
		{ name: 'morph node', mesh: 0, translation: [ 1, 2, 3 ] },
		{ name: 'skinned node', mesh: 1, skin: 0 },
		{ name: 'armature', children: [ 3 ] },
		{ name: 'bone a', children: [ 4 ] },
		{ name: 'bone b', translation: [ 1, 0, 0 ] },
		{ name: 'camera', camera: 0, matrix: [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1 ] },
		{ name: 'light', extensions: { KHR_lights_punctual: { light: 0 } } },
		{ name: 'many', mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 9 } } } },
		{ name: 'lines', mesh: 2 }
	],
	scenes: [ { name: 'main', nodes: [ 0, 1, 2, 5, 6, 7, 8 ] } ],
	scene: 0,
	animations: [ { name: 'move', channels: [ { sampler: 0, target: { node: 0, path: 'translation' } } ], samplers: [ { input: 7, output: 8 } ] } ]
};

const loader = new GLTFLoader();
const result = await loader.parseAsync( JSON.stringify( gltf ), '' );
let failed = 0;
const check = ( name, ok, detail = '' ) => {

	if ( ! ok ) failed ++;
	console.log( ( ok ? 'PASS  ' : 'FAIL  ' ) + name + ( detail ? ': ' + detail : '' ) );

};
const scene = result.scene;
const byName = ( n ) => scene.getObjectByName( n );
const morph = byName( 'morph_node' ) ?? byName( 'morph node' );
check( 'scene and names', scene.children.length === 7, scene.children.map( ( c ) => c.name + ':' + c.type ).join( ', ' ) );
check( 'node transform', morph && morph.position.x === 1 && morph.position.z === 3 );
check( 'material', morph && morph.material.isMeshPhysicalMaterial && Math.abs( morph.material.opacity - 0.5 ) < 1e-6 && morph.material.transparent && morph.material.side === C.DoubleSide && morph.material.clearcoat === 0.5, morph?.material?.type );
check( 'morph targets', morph && morph.morphTargetInfluences?.[ 0 ] === 0.5 && morph.morphTargetDictionary?.lift === 0 && morph.geometry.morphTargetsRelative === true );
const skinned = scene.getObjectByProperty( 'isSkinnedMesh', true );
check( 'skin', skinned && skinned.skeleton?.bones.length === 2 && skinned.skeleton.bones[ 0 ].isBone && skinned.material.isMeshBasicMaterial );
const camera = result.cameras[ 0 ];
check( 'camera', camera?.isPerspectiveCamera && Math.abs( camera.fov - 0.8 * 180 / Math.PI ) < 1e-4 && camera.aspect === 1.5 );
const light = scene.getObjectByProperty( 'isSpotLight', true );
check( 'light', light && light.intensity === 3 && Math.abs( light.angle - 0.4 ) < 1e-6 && Math.abs( light.penumbra - 0.5 ) < 1e-6 );
const instanced = scene.getObjectByProperty( 'isInstancedMesh', true );
const m = new C.Matrix4();
instanced?.getMatrixAt( 1, m );
check( 'instancing', instanced && instanced.count === 2 && m.elements[ 12 ] === 5 );
const lines = byName( 'lines' );
check( 'lines and points', lines && lines.children.length === 2 && lines.children[ 0 ].isLineLoop && lines.children[ 1 ].isPoints, lines?.children.map( ( c ) => c.type ).join( ',' ) );
const sparse = lines?.children[ 1 ].geometry.attributes.position;
check( 'sparse accessor', sparse && sparse.getZ( 0 ) === 1 && sparse.getZ( 1 ) === 0 );
const clip = result.animations[ 0 ];
check( 'animation', clip && clip.name === 'move' && clip.tracks.length === 1 && clip.duration === 1 && clip.tracks[ 0 ].name.endsWith( '.position' ) );
const mixer = new C.AnimationMixer( scene );
mixer.clipAction( clip ).play();
mixer.update( 0.5 );
check( 'animation plays', Math.abs( morph.position.x - 1 ) < 1e-6, 'x at t=0.5: ' + morph.position.x );
check( 'binary glb rejected without JSON', await loader.parseAsync( new Uint8Array( [ 0x67, 0x6C, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0 ] ).buffer, '' ).then( () => false, () => true ) );
process.exitCode = failed ? 1 : 0;
