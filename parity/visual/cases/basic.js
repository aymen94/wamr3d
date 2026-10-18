// Unlit and lit primitives, lines, shapes, tone mapping, shadows, points, sprites and render targets.
//
// Part of the visual parity cases; `../cases.js` gathers them.

import { pattern, stage, toneMapped } from './common.js';

export const BASIC = {

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

	},

	// Bright physically based spheres through a tone-mapping operator: one case per
	// operator, each with an exposure other than 1.
	tonemapping_aces( L ) {

		return toneMapped( L, L.ACESFilmicToneMapping, 1.4 );

	},

	tonemapping_agx( L ) {

		return toneMapped( L, L.AgXToneMapping, 1.2 );

	},

	tonemapping_neutral( L ) {

		return toneMapped( L, L.NeutralToneMapping, 1.6 );

	},

	tonemapping_linear( L ) {

		return toneMapped( L, L.LinearToneMapping, 0.8 );

	},

	tonemapping_reinhard( L ) {

		return toneMapped( L, L.ReinhardToneMapping, 1.5 );

	},

	tonemapping_cineon( L ) {

		return toneMapped( L, L.CineonToneMapping, 1.1 );

	},

	// A directional light's shadow: casters (one double-sided), a receiver, a shadow
	// camera narrowed from the default, and a shadow intensity below 1.
	shadows_directional( L ) {

		const { scene, camera } = stage( L, 0, 3.4, 5.2 );
		// A Lambert floor: the same scene with a physically based floor differs from three.js
		// by about 1.8 of 255 without shadows (STATUS.md), which would hide what is tested here.
		const floor = new L.Mesh( new L.PlaneGeometry( 8, 8 ), new L.MeshLambertMaterial( { color: 0xd8d4cc } ) );
		floor.rotation.x = - Math.PI / 2;
		floor.position.y = - 0.8;
		floor.receiveShadow = true;
		const box = new L.Mesh( new L.BoxGeometry( 1, 1, 1 ), new L.MeshStandardMaterial( { color: 0x4f8cff, roughness: 0.5 } ) );
		box.position.set( - 1, - 0.2, 0 );
		box.rotation.y = 0.5;
		box.castShadow = box.receiveShadow = true;
		const ball = new L.Mesh( new L.SphereGeometry( 0.6, 32, 16 ), new L.MeshStandardMaterial( { color: 0xd85a3a, roughness: 0.4 } ) );
		ball.position.set( 1, 0.1, 0.3 );
		ball.castShadow = true;
		const card = new L.Mesh( new L.PlaneGeometry( 0.8, 1.2 ), new L.MeshStandardMaterial( { color: 0x6fd08c, side: L.DoubleSide } ) );
		card.position.set( 0.1, 0, - 1.2 );
		card.rotation.y = 0.7;
		card.castShadow = true;

		const sun = new L.DirectionalLight( 0xffffff, 3 );
		sun.position.set( 2.5, 5, 2 );
		sun.castShadow = true;
		sun.shadow.mapSize.set( 1024, 1024 );
		sun.shadow.camera.left = sun.shadow.camera.bottom = - 4;
		sun.shadow.camera.right = sun.shadow.camera.top = 4;
		sun.shadow.camera.far = 20;
		sun.shadow.camera.updateProjectionMatrix();
		sun.shadow.intensity = 0.85;
		sun.shadow.bias = - 0.0005;
		scene.add( floor, box, ball, card, sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.6 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// A spot light's shadow: perspective shadow camera from the cone, a non-zero radius.
	shadows_spot( L ) {

		const { scene, camera } = stage( L, 0, 3, 5 );
		const floor = new L.Mesh( new L.PlaneGeometry( 8, 8 ), new L.MeshLambertMaterial( { color: 0xcfcfcf } ) );
		floor.rotation.x = - Math.PI / 2;
		floor.position.y = - 0.8;
		floor.receiveShadow = true;
		const pillar = new L.Mesh( new L.CylinderGeometry( 0.3, 0.3, 1.6, 24 ), new L.MeshLambertMaterial( { color: 0xffb454 } ) );
		pillar.castShadow = true;
		const spot = new L.SpotLight( 0xffffff, 40, 0, Math.PI / 5, 0.3, 2 );
		spot.position.set( - 2, 3.5, 1 );
		spot.castShadow = true;
		spot.shadow.mapSize.set( 1024, 1024 );
		spot.shadow.radius = 2;
		spot.shadow.bias = - 0.0008;
		scene.add( floor, pillar, spot, spot.target, new L.AmbientLight( 0xffffff, 0.2 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// A grid of points with vertex colours, seen in perspective: one pixel each.
	points( L ) {

		const { scene, camera } = stage( L, 0.6, 1.4, 3.2 );
		const positions = [], colors = [];

		for ( let i = 0; i < 120; i ++ ) for ( let j = 0; j < 100; j ++ ) {

			const x = ( i / 119 - 0.5 ) * 4, z = ( j / 99 - 0.5 ) * 3;
			positions.push( x, Math.sin( x * 2 ) * Math.cos( z * 2 ) * 0.4, z );
			colors.push( i / 119, 0.4 + 0.6 * j / 99, 1 - i / 119 );

		}

		const geometry = new L.BufferGeometry();
		geometry.setAttribute( 'position', new L.Float32BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'color', new L.Float32BufferAttribute( colors, 3 ) );
		scene.add( new L.Points( geometry, new L.PointsMaterial( { vertexColors: true } ) ) );
		return { scene, camera };

	},

	// Sprites: scale, a map, a centre other than the middle, rotation, a sprite whose
	// size does not change with distance, and a translucent one.
	sprites( L ) {

		const { scene, camera } = stage( L, 0.4, 0.8, 4 );
		const map = pattern( L );
		const items = [
			[ { map }, [ - 1.4, 0.4, 0 ], [ 1, 1 ] ],
			[ { color: 0x4f8cff, rotation: 0.6 }, [ 0, 0.5, - 1 ], [ 1.2, 0.6 ] ],
			[ { color: 0xffb454, sizeAttenuation: false }, [ 1.3, - 0.4, - 2 ], [ 0.12, 0.12 ] ],
			[ { color: 0xff6b9d, opacity: 0.5 }, [ 0.4, - 0.3, 0.6 ], [ 0.9, 0.9 ] ],
			[ { map, rotation: - 0.4 }, [ - 0.4, - 0.8, - 0.5 ], [ 0.8, 0.5 ] ]
		];

		items.forEach( ( [ parameters, position, scale ], i ) => {

			const sprite = new L.Sprite( new L.SpriteMaterial( parameters ) );
			sprite.position.set( ...position );
			sprite.scale.set( scale[ 0 ], scale[ 1 ], 1 );
			if ( i === 4 ) sprite.center.set( 0, 1 );
			scene.add( sprite );

		} );

		return { scene, camera };

	},

	// A scene drawn into a render target, then shown on a plane as its map. The inner
	// scene is asymmetric so that a flipped texture would fail.
	render_target( L ) {

		const { scene, camera } = stage( L, 0, 0.3, 3.4 );
		const target = new L.RenderTarget( 256, 256 );

		const inner = new L.Scene();
		inner.background = new L.Color( 0x203040 );
		const innerCamera = new L.PerspectiveCamera( 45, 1, 0.1, 20 );
		innerCamera.position.set( 0, 0, 4 );
		const marker = new L.Mesh( new L.BoxGeometry( 0.8, 0.8, 0.8 ), new L.MeshBasicMaterial( { color: 0xff5a3a } ) );
		marker.position.set( - 0.9, 0.9, 0 );
		const bar = new L.Mesh( new L.BoxGeometry( 2.4, 0.3, 0.3 ), new L.MeshBasicMaterial( { color: 0x6fd08c } ) );
		bar.position.set( 0.3, - 0.9, 0 );
		bar.rotation.z = 0.3;
		const ball = new L.Mesh( new L.SphereGeometry( 0.5, 32, 16 ), new L.MeshBasicMaterial( { color: 0x4f8cff } ) );
		ball.position.set( 0.9, 0.5, - 0.5 );
		inner.add( marker, bar, ball );

		const screen = new L.Mesh( new L.PlaneGeometry( 2, 2 ), new L.MeshBasicMaterial( { map: target.texture } ) );
		screen.position.x = - 0.9;
		screen.rotation.y = 0.25;
		const plain = new L.Mesh( new L.PlaneGeometry( 1, 1 ), new L.MeshBasicMaterial( { color: 0xffb454 } ) );
		plain.position.set( 1.4, 0, 0 );
		scene.add( screen, plain );

		return { scene, camera, setup( renderer ) {

			renderer.setRenderTarget( target );
			renderer.render( inner, innerCamera );
			renderer.setRenderTarget( null );

		} };

	},

	// Twelve coloured point lights on a floor: more than the eight the renderer used to take.
	lights_many( L ) {

		const { scene, camera } = stage( L, 0, 4.2, 5.2 );
		const floor = new L.Mesh( new L.PlaneGeometry( 8, 8 ), new L.MeshStandardMaterial( { color: 0xd0d0d0, roughness: 0.7 } ) );
		floor.rotation.x = - Math.PI / 2;
		scene.add( floor );

		for ( let i = 0; i < 12; i ++ ) {

			const angle = i / 12 * Math.PI * 2, color = new L.Color().setHSL( i / 12, 0.9, 0.5 );
			const light = new L.PointLight( color, 3, 3.5, 2 );
			light.position.set( Math.cos( angle ) * 2.6, 0.5, Math.sin( angle ) * 2.6 );
			scene.add( light );

		}

		return { scene, camera };

	}

};
