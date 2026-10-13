// The visual parity cases, written once against a library object `L`. generate mode
// passes three.js r186 with its WebGPU renderer and stores the image; check mode passes
// WAMR3D and compares.

export const WIDTH = 512, HEIGHT = 384;

// Only `run.mjs --generate` loads this: the three.js r186 WebGPU build that draws the
// reference images. Checking against the stored images needs no three.js.
export const REFERENCE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.webgpu.js';

// Agreed tolerance (DECISIONS.md D27): mean absolute difference per channel, of 255,
// and the fraction of pixels with any channel off by more than PIXEL_THRESHOLD.
export const MEAN_LIMIT = 1.5, DIFFERENT_LIMIT = 0.02, PIXEL_THRESHOLD = 12;

const BACKGROUND = 0x14161a;

function stage( L, x, y, z ) {

	const scene = new L.Scene();
	scene.background = new L.Color( BACKGROUND );
	const camera = new L.PerspectiveCamera( 50, WIDTH / HEIGHT, 0.1, 100 );
	camera.position.set( x, y, z );
	camera.lookAt( 0, 0, 0 );
	return { scene, camera };

}

// Asymmetric in both directions, so a flipped or transposed image cannot pass.
function pattern( L ) {

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

export const CASES = {

	// Unlit, two overlapping boxes: transforms, projection and the depth test.
	cube( L ) {

		const { scene, camera } = stage( L, 2.4, 1.8, 3.2 );
		const cube = new L.Mesh( new L.BoxGeometry( 1.4, 1.4, 1.4 ), new L.MeshBasicMaterial( { color: 0x4f8cff } ) );
		cube.rotation.set( 0.3, 0.5, 0.1 );
		const other = new L.Mesh( new L.BoxGeometry( 2.4, 0.5, 0.5 ), new L.MeshBasicMaterial( { color: 0xffb454 } ) );
		other.position.set( 0.2, 0.1, 0.3 );
		other.rotation.y = - 0.6;
		scene.add( cube, other );
		return { scene, camera };

	},

	// Physically based material under a directional light and sky/ground ambient.
	sphere( L ) {

		const { scene, camera } = stage( L, 0, 0.6, 3.4 );
		const sun = new L.DirectionalLight( 0xffffff, 2.5 );
		sun.position.set( 3, 4, 2 );
		const ball = new L.Mesh( new L.SphereGeometry( 1, 48, 24 ), new L.MeshStandardMaterial( { color: 0xd85a3a, roughness: 0.45, metalness: 0.1 } ) );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.8 ), ball );
		return { scene, camera };

	},

	// Unlit textured plane seen at an angle: uv orientation, colour space and sampling.
	plane( L ) {

		const { scene, camera } = stage( L, 1.2, 2.2, 3 );
		const plane = new L.Mesh( new L.PlaneGeometry( 4, 3 ), new L.MeshBasicMaterial( { map: pattern( L ) } ) );
		plane.rotation.x = - 1.1;
		scene.add( plane );
		return { scene, camera };

	},

	// One counter-clockwise, front-sided triangle in the upper left quarter. It is at the
	// first probe and nowhere near the two mirrored ones, which pins the Y direction,
	// the X direction and the winding.
	triangle( L ) {

		const { scene, camera } = stage( L, 0, 0, 3 );
		const geometry = new L.BufferGeometry();
		geometry.setAttribute( 'position', new L.BufferAttribute( new Float32Array( [ - 1.5, 1.2, 0, - 1.5, 0, 0, 0, 1.2, 0 ] ), 3 ) );
		geometry.setAttribute( 'normal', new L.BufferAttribute( new Float32Array( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ] ), 3 ) );
		scene.add( new L.Mesh( geometry, new L.MeshBasicMaterial( { color: 0x6fd08c } ) ) );
		return { scene, camera, probes: [ { x: 91, y: 68, covered: true }, { x: 421, y: 68, covered: false }, { x: 91, y: 316, covered: false } ] };

	},

	// Point, spot and two directional lights on diffuse and physically based surfaces.
	lights( L ) {

		const { scene, camera } = stage( L, 3.2, 3.4, 5.2 );
		const floor = new L.Mesh( new L.PlaneGeometry( 9, 9 ), new L.MeshStandardMaterial( { color: 0x8a8f98, roughness: 0.8, metalness: 0 } ) );
		floor.rotation.x = - Math.PI / 2;
		const ball = new L.Mesh( new L.SphereGeometry( 0.8, 40, 20 ), new L.MeshStandardMaterial( { color: 0xe8e4d8, roughness: 0.35, metalness: 0.2 } ) );
		ball.position.set( - 1.2, 0.8, 0 );
		const box = new L.Mesh( new L.BoxGeometry( 1.2, 1.2, 1.2 ), new L.MeshLambertMaterial( { color: 0x4f8cff } ) );
		box.position.set( 1.3, 0.6, 0.4 );
		box.rotation.y = 0.5;

		const point = new L.PointLight( 0xffb454, 12, 6, 2 );
		point.position.set( 0, 1.4, 1.6 );
		const spot = new L.SpotLight( 0x9fffc0, 40, 0, 0.45, 0.4, 2 );
		spot.position.set( - 2.5, 4, - 1 );
		spot.target.position.set( - 0.8, 0, 0.4 );
		const sun = new L.DirectionalLight( 0xffffff, 0.6 );
		sun.position.set( 2, 3, 1 );
		const back = new L.DirectionalLight( 0x6a7cff, 0.5 );
		back.position.set( - 3, 1, - 4 );

		scene.add( floor, ball, box, point, spot, spot.target, sun, back, new L.AmbientLight( 0xffffff, 0.15 ) );
		return { scene, camera };

	},

	// Blended surfaces over opaque ones, added nearest first so the order must be sorted.
	transparent( L ) {

		const { scene, camera } = stage( L, 0.8, 1.2, 4.5 );
		scene.add( new L.HemisphereLight( 0xffffff, 0x404040, 2.5 ) );
		const box = new L.Mesh( new L.BoxGeometry( 1.2, 1.2, 1.2 ), new L.MeshLambertMaterial( { color: 0xffb454 } ) );
		box.position.z = - 1.5;
		box.rotation.set( 0.4, 0.6, 0 );
		scene.add( box );

		[ [ 0x4f8cff, 0.5, 1 ], [ 0xff6b9d, 0.6, 0 ], [ 0x6fd08c, 0.4, - 0.8 ] ].forEach( ( [ color, opacity, z ], i ) => {

			const pane = new L.Mesh( new L.PlaneGeometry( 1.8, 1.8 ), new L.MeshBasicMaterial( { color, transparent: true, opacity, side: L.DoubleSide, depthWrite: false } ) );
			pane.position.set( ( i - 1 ) * 0.7, ( i - 1 ) * 0.3, z );
			scene.add( pane );

		} );

		return { scene, camera };

	},

	// A grid of segments with per-vertex colours and a connected line.
	lines( L ) {

		const { scene, camera } = stage( L, 2.5, 3, 4 );
		const positions = [], colors = [];

		for ( let i = - 4; i <= 4; i ++ ) {

			positions.push( i / 2, 0, - 2, i / 2, 0, 2, - 2, 0, i / 2, 2, 0, i / 2 );
			const c = i === 0 ? [ 1, 0.35, 0.2 ] : [ 0.25, 0.5, 1 ];
			colors.push( ...c, ...c, ...c, ...c );

		}

		const grid = new L.BufferGeometry();
		grid.setAttribute( 'position', new L.BufferAttribute( new Float32Array( positions ), 3 ) );
		grid.setAttribute( 'color', new L.BufferAttribute( new Float32Array( colors ), 3 ) );
		scene.add( new L.LineSegments( grid, new L.LineBasicMaterial( { vertexColors: true } ) ) );

		const path = [];
		for ( let i = 0; i <= 64; i ++ ) path.push( Math.cos( i / 64 * Math.PI * 4 ) * 1.2, i / 64 * 1.5, Math.sin( i / 64 * Math.PI * 4 ) * 1.2 );
		const spiral = new L.BufferGeometry();
		spiral.setAttribute( 'position', new L.BufferAttribute( new Float32Array( path ), 3 ) );
		scene.add( new L.Line( spiral, new L.LineBasicMaterial( { color: 0x6fd08c } ) ) );
		return { scene, camera };

	},

	// The round shapes, on a floor with a repeated, mipmapped texture.
	shapes( L ) {

		const { scene, camera } = stage( L, 0, 3.6, 6 );
		const sun = new L.DirectionalLight( 0xffffff, 2.2 );
		sun.position.set( 2, 5, 3 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.9 ) );

		const size = 32, data = new Uint8Array( size * size * 4 );
		for ( let i = 0; i < size * size; i ++ ) data.set( ( ( i % size >> 3 ) + ( i / size >> 3 ) ) % 2 ? [ 200, 205, 215, 255 ] : [ 60, 70, 90, 255 ], i * 4 );
		const tiles = new L.DataTexture( data, size, size );
		tiles.colorSpace = L.SRGBColorSpace;
		tiles.wrapS = tiles.wrapT = L.RepeatWrapping;
		tiles.repeat.set( 6, 4 );
		tiles.offset.set( 0.125, 0.25 );
		tiles.magFilter = L.LinearFilter;
		tiles.minFilter = L.LinearMipmapLinearFilter;
		tiles.generateMipmaps = true;
		tiles.needsUpdate = true;

		const floor = new L.Mesh( new L.PlaneGeometry( 12, 8 ), new L.MeshLambertMaterial( { map: tiles } ) );
		floor.rotation.x = - Math.PI / 2;
		scene.add( floor );

		const shapes = [
			[ new L.CylinderGeometry( 0.5, 0.7, 1.4, 24, 2 ), 0x4f8cff ],
			[ new L.ConeGeometry( 0.7, 1.5, 24 ), 0xffb454 ],
			[ new L.TorusGeometry( 0.55, 0.22, 12, 36 ), 0x6fd08c ],
			[ new L.RingGeometry( 0.3, 0.7, 24, 2 ), 0xff6b9d ],
			[ new L.CircleGeometry( 0.7, 24, 0.4, 4.5 ), 0xe8e4d8 ]
		];

		shapes.forEach( ( [ geometry, color ], i ) => {

			const mesh = new L.Mesh( geometry, new L.MeshStandardMaterial( { color, roughness: 0.5, metalness: 0.1, side: i > 2 ? L.DoubleSide : L.FrontSide } ) );
			mesh.position.set( ( i - 2 ) * 1.9, 0.9, i % 2 ? 0.8 : - 0.4 );
			mesh.rotation.set( i > 1 ? - 0.5 : 0, i * 0.4, 0 );
			scene.add( mesh );

		} );

		return { scene, camera };

	}

};

// Appended cases: fog, instancing, material arrays, hand-set matrices and the helpers.
Object.assign( CASES, {

	// Linear fog over a receding row of boxes and a grid helper.
	fog( L ) {

		const { scene, camera } = stage( L, 2.5, 2.2, 6 );
		scene.background = new L.Color( 0x7a8fa6 );
		scene.fog = new L.Fog( 0x7a8fa6, 5, 16 );
		const sun = new L.DirectionalLight( 0xffffff, 2 );
		sun.position.set( 3, 5, 2 );
		scene.add( sun, new L.AmbientLight( 0xffffff, 0.4 ), new L.GridHelper( 24, 24, 0xffffff, 0x202830 ) );
		const box = new L.BoxGeometry( 0.9, 0.9, 0.9 );
		const materials = [ new L.MeshStandardMaterial( { color: 0xff6b3d, roughness: 0.6, metalness: 0 } ), new L.MeshLambertMaterial( { color: 0x4f8cff } ), new L.MeshBasicMaterial( { color: 0xffe08a } ) ];

		for ( let i = 0; i < 9; i ++ ) {

			const mesh = new L.Mesh( box, materials[ i % 3 ] );
			mesh.position.set( ( i % 3 - 1 ) * 1.6, 0.45, 2 - i * 1.5 );
			scene.add( mesh );

		}

		return { scene, camera };

	},

	// One instanced mesh with per-instance scale, rotation and colour, under squared-exponential fog.
	instances( L ) {

		const { scene, camera } = stage( L, 0, 4.5, 8 );
		scene.background = new L.Color( 0x20242c );
		scene.fog = new L.FogExp2( 0x20242c, 0.07 );
		const sun = new L.DirectionalLight( 0xffffff, 2.4 );
		sun.position.set( 2, 6, 4 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.8 ) );

		const count = 90, mesh = new L.InstancedMesh( new L.ConeGeometry( 0.3, 0.8, 12 ), new L.MeshStandardMaterial( { roughness: 0.5, metalness: 0 } ), count );
		const matrix = new L.Matrix4(), position = new L.Vector3(), rotation = new L.Quaternion(), scale = new L.Vector3(), color = new L.Color();

		for ( let i = 0; i < count; i ++ ) {

			const angle = i * 0.55, radius = 0.5 + i * 0.045;
			position.set( Math.cos( angle ) * radius, 0.3 + ( i % 5 ) * 0.12, Math.sin( angle ) * radius - 1 );
			rotation.setFromEuler( new L.Euler( i * 0.2, i * 0.37, 0 ) );
			scale.set( 0.6 + ( i % 4 ) * 0.25, 1 + ( i % 3 ) * 0.5, 0.6 + ( i % 2 ) * 0.5 );
			mesh.setMatrixAt( i, matrix.compose( position, rotation, scale ) );
			mesh.setColorAt( i, color.setHSL( i / count, 0.7, 0.55 ) );

		}

		mesh.position.y = 0.2;
		mesh.rotation.y = 0.3;
		mesh.count = 80;
		scene.add( mesh );
		return { scene, camera };

	},

	// A box with a material per side, objects whose matrices are set by hand, and the axes helper.
	matrices( L ) {

		const { scene, camera } = stage( L, 3, 2.6, 4.2 );
		scene.add( new L.HemisphereLight( 0xffffff, 0x303030, 2.4 ), new L.AxesHelper( 2.5 ) );

		const sides = [ 0xff6b6b, 0xffb454, 0xffe08a, 0x6fd08c, 0x4f8cff, 0xb48cff ].map( ( color, i ) => i === 2
			? new L.MeshBasicMaterial( { color, transparent: true, opacity: 0.4 } )
			: i % 2 ? new L.MeshLambertMaterial( { color } ) : new L.MeshBasicMaterial( { color } ) );
		const box = new L.Mesh( new L.BoxGeometry( 1.3, 1.3, 1.3 ), sides );
		box.matrixAutoUpdate = false;
		box.matrix.makeRotationY( 0.6 ).setPosition( 0.2, 0.8, 0.1 );
		box.matrixWorldNeedsUpdate = true;

		// frozen where it was when the matrix stopped following; the later move must not show
		const frozen = new L.Mesh( new L.TorusGeometry( 0.5, 0.18, 10, 32 ), new L.MeshLambertMaterial( { color: 0xe8e4d8 } ) );
		frozen.position.set( - 1.4, 0.7, 0.6 );
		frozen.rotation.x = 1.1;
		frozen.updateMatrix();
		frozen.matrixAutoUpdate = false;
		frozen.position.set( 5, 5, 5 );

		const child = new L.Mesh( new L.SphereGeometry( 0.25, 20, 10 ), new L.MeshLambertMaterial( { color: 0xff6b9d } ) );
		child.position.set( 0, 1.1, 0 );
		box.add( child );

		scene.add( box, frozen );
		return { scene, camera };

	}

} );

export const BACKGROUND_RGB = [ BACKGROUND >> 16, BACKGROUND >> 8 & 255, BACKGROUND & 255 ];
