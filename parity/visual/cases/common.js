// Helpers shared by the cases: the stage, test patterns, skies, generated textures and scenes.
//
// Part of the visual parity cases; `../cases.js` gathers them.

export const WIDTH = 512, HEIGHT = 384;

export const BACKGROUND = 0x14161a;

export function stage( L, x, y, z ) {

	const scene = new L.Scene();
	scene.background = new L.Color( BACKGROUND );
	const camera = new L.PerspectiveCamera( 50, WIDTH / HEIGHT, 0.1, 100 );
	camera.position.set( x, y, z );
	camera.lookAt( 0, 0, 0 );
	return { scene, camera };

}

// Asymmetric in both directions, so a flipped or transposed image cannot pass.
export function pattern( L ) {

	const size = 8, data = new Uint8Array( size * size * 4 );

	for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {

		const light = ( x + y ) % 2 === 0;
		const color = x < 2 && y < 2 ? [ 230, 60, 50 ] : x > 5 && y < 2 ? [ 60, 200, 90 ] : light ? [ 235, 225, 200 ] : [ 70, 110, 190 ];
		data.set( [ ...color, 255 ], ( y * size + x ) * 4 );

	}

	const texture = new L.DataTexture( data, size, size );
	texture.colorSpace = L.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;

}

export function toneMapped( L, toneMapping, exposure ) {

	const { scene, camera } = stage( L, 0, 0.4, 5 );
	const sun = new L.DirectionalLight( 0xffffff, 6 );
	sun.position.set( 2, 3, 4 );
	scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 1.5 ) );

	[ [ 0xff5a3a, 0.3, 0 ], [ 0xf0f0f0, 0.6, 0 ], [ 0x3a8cff, 0.25, 0.8 ] ].forEach( ( [ color, roughness, metalness ], i ) => {

		const ball = new L.Mesh( new L.SphereGeometry( 0.8, 48, 24 ), new L.MeshStandardMaterial( { color, roughness, metalness } ) );
		ball.position.x = ( i - 1 ) * 1.8;
		scene.add( ball );

	} );

	// A material that opts out keeps its colour: an unlit bar across the bottom.
	const bar = new L.Mesh( new L.BoxGeometry( 5, 0.3, 0.3 ), new L.MeshBasicMaterial( { color: 0xffffff, toneMapped: false } ) );
	bar.position.y = - 1.2;
	scene.add( bar );

	return { scene, camera, setup( renderer ) {

		renderer.toneMapping = toneMapping;
		renderer.toneMappingExposure = exposure;

	} };

}

// A smooth equirectangular sky (sRGB bytes): blue above, a warm horizon, dark ground, and a
// bright patch on the +X side, so that rotations and reflections show.
export function sky( L ) {

	const width = 128, height = 64, data = new Uint8Array( width * height * 4 );

	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const v = y / ( height - 1 ), u = x / ( width - 1 );
		const up = Math.max( 0, v - 0.5 ) * 2, down = Math.max( 0, 0.5 - v ) * 2;
		const patch = Math.max( 0, 1 - Math.hypot( ( u - 0.5 ) * 4, ( v - 0.62 ) * 6 ) );
		const r = 200 - up * 140 - down * 150 + patch * 55, g = 170 - up * 70 - down * 120 + patch * 70, b = 120 + up * 110 - down * 80 + patch * 60;
		data.set( [ r, g, b ].map( ( c ) => Math.max( 0, Math.min( 255, Math.round( c ) ) ) ).concat( 255 ), ( y * width + x ) * 4 );

	}

	const texture = new L.DataTexture( data, width, height );
	texture.colorSpace = L.SRGBColorSpace;
	texture.mapping = L.EquirectangularReflectionMapping;
	texture.magFilter = texture.minFilter = L.LinearFilter;
	texture.needsUpdate = true;
	return texture;

}

// An RGBA data texture of `size` squared filled by `texel( u, v )` (0..1 each, v up),
// returning four bytes.
export function generated( L, size, texel, colorSpace = L.NoColorSpace ) {

	const data = new Uint8Array( size * size * 4 );

	for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {

		data.set( texel( ( x + 0.5 ) / size, ( y + 0.5 ) / size ).map( ( c ) => Math.max( 0, Math.min( 255, Math.round( c ) ) ) ), ( y * size + x ) * 4 );

	}

	const texture = new L.DataTexture( data, size, size );
	texture.colorSpace = colorSpace;
	texture.magFilter = texture.minFilter = L.LinearFilter;
	texture.wrapS = texture.wrapT = L.RepeatWrapping;
	texture.needsUpdate = true;
	return texture;

}

// Tangent-space normals of round bumps on a grid, encoded as three.js expects.
export function bumps( L ) {

	return generated( L, 64, ( u, v ) => {

		const fx = ( u * 4 ) % 1 - 0.5, fy = ( v * 4 ) % 1 - 0.5, d2 = fx * fx + fy * fy;
		const inside = d2 < 0.16, nx = inside ? fx * 2.2 : 0, ny = inside ? fy * 2.2 : 0, length = Math.hypot( nx, ny, 1 );
		return [ ( nx / length * 0.5 + 0.5 ) * 255, ( ny / length * 0.5 + 0.5 ) * 255, ( 1 / length * 0.5 + 0.5 ) * 255, 255 ];

	} );

}

// Faces of a cube texture, each a flat colour with a lighter corner patch so that a face
// swapped, turned or mirrored is visible: +x red, -x cyan, +y light, -y dark, +z green, -z blue.
export function cubeFaces( L ) {

	const size = 32, colors = [ [ 200, 70, 60 ], [ 60, 180, 190 ], [ 230, 225, 210 ], [ 40, 35, 30 ], [ 80, 190, 90 ], [ 70, 90, 200 ] ];
	const faces = colors.map( ( color ) => {

		const data = new Uint8Array( size * size * 4 );
		for ( let y = 0; y < size; y ++ ) for ( let x = 0; x < size; x ++ ) {

			const corner = x < size / 3 && y < size / 3;
			data.set( [ ...color.map( ( c ) => ( corner ? Math.min( 255, c + 50 ) : c ) ), 255 ], ( y * size + x ) * 4 );

		}

		const face = new L.DataTexture( data, size, size );
		face.needsUpdate = true;
		return face;

	} );
	const texture = new L.CubeTexture( faces );
	texture.colorSpace = L.SRGBColorSpace;
	texture.magFilter = texture.minFilter = L.LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;

}

export function floorScene( L, x, y, z ) {

	const { scene, camera } = stage( L, x, y, z );
	const floor = new L.Mesh( new L.PlaneGeometry( 8, 8 ), new L.MeshLambertMaterial( { color: 0xd8d4cc } ) );
	floor.rotation.x = - Math.PI / 2;
	floor.position.y = - 0.8;
	floor.receiveShadow = true;
	scene.add( floor );
	return { scene, camera };

}
