// Texture maps, wireframes, physical materials, point and basic shadows, cube environments and more shapes.
//
// Part of the visual parity cases; `../cases.js` gathers them.

import { bumps, cubeFaces, floorScene, generated, pattern, sky, stage } from './common.js';

export const MAPS = {

	// Normal, roughness, metalness, emissive, alpha and ambient-occlusion maps, and an alpha test.
	texture_maps( L ) {

		const { scene, camera } = stage( L, 0, 1.6, 6.5 );
		camera.lookAt( 0, 0.2, 0 );
		const sun = new L.DirectionalLight( 0xffffff, 2.2 );
		sun.position.set( - 2, 3, 4 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.9 ) );
		scene.environment = sky( L );

		// bumps lit from the upper left, at two strengths
		const bumpy = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshStandardMaterial( { color: 0xd8c8b0, roughness: 0.6, normalMap: bumps( L ) } ) );
		bumpy.position.set( - 2.1, 0.9, 0 );
		const flatter = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshPhongMaterial( { color: 0x8fb0d8, shininess: 40, normalMap: bumps( L ), normalScale: new L.Vector2( 0.4, - 0.4 ) } ) );
		flatter.position.set( - 2.1, - 0.9, 0 );

		// metal stripes (blue) and rough bands (green) reflecting the environment
		const surface = generated( L, 32, ( u, v ) => [ 0, v < 0.5 ? 40 : 230, u % 0.25 < 0.125 ? 255 : 0, 255 ] );
		const ball = new L.Mesh( new L.SphereGeometry( 0.85, 48, 24 ), new L.MeshStandardMaterial( { color: 0xffffff, roughness: 1, metalness: 1, roughnessMap: surface, metalnessMap: surface } ) );
		ball.position.set( 0, 0.9, 0 );

		// glowing squares, and occlusion darkening toward one edge
		const glow = generated( L, 16, ( u, v ) => ( ( u * 2 | 0 ) + ( v * 2 | 0 ) ) % 2 ? [ 255, 140, 40, 255 ] : [ 0, 0, 0, 255 ], L.SRGBColorSpace );
		const panel = new L.Mesh( new L.BoxGeometry( 1.2, 1.2, 0.3 ), new L.MeshLambertMaterial( { color: 0x404448, emissive: 0xffffff, emissiveMap: glow } ) );
		panel.position.set( 0, - 0.9, 0 );
		panel.rotation.y = 0.4;
		const shaded = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshToonMaterial( { color: 0x6fd08c, aoMap: generated( L, 16, ( u ) => [ 255 * u, 0, 0, 255 ] ), aoMapIntensity: 0.9 } ) );
		shaded.position.set( 2.1, - 0.9, 0 );

		// a cut-out: circles kept by a grey alpha map and the alpha test
		const holes = generated( L, 32, ( u, v ) => {

			const grey = Math.hypot( ( u * 3 ) % 1 - 0.5, ( v * 3 ) % 1 - 0.5 ) < 0.35 ? 255 : 0;
			return [ grey, grey, grey, 255 ];

		} );
		const cutout = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshBasicMaterial( { color: 0xffe08a, alphaMap: holes, alphaTest: 0.5, side: L.DoubleSide } ) );
		cutout.position.set( 2.1, 0.9, 0 );

		scene.add( bumpy, flatter, ball, panel, shaded, cutout );
		return { scene, camera };

	},

	// Wireframes of an indexed torus (unlit) and a lit sphere.
	wireframe( L ) {

		const { scene, camera } = stage( L, 0, 1.2, 4.5 );
		const sun = new L.DirectionalLight( 0xffffff, 2.5 );
		sun.position.set( 2, 3, 4 );
		const torus = new L.Mesh( new L.TorusGeometry( 0.8, 0.3, 8, 24 ), new L.MeshBasicMaterial( { color: 0xffb454, wireframe: true } ) );
		torus.position.x = - 1.1;
		torus.rotation.x = 0.6;
		const ball = new L.Mesh( new L.SphereGeometry( 0.9, 16, 10 ), new L.MeshLambertMaterial( { color: 0x4f8cff, wireframe: true } ) );
		ball.position.x = 1.1;
		scene.add( sun, new L.AmbientLight( 0xffffff, 0.3 ), torus, ball );
		return { scene, camera };

	},

	// Light, bump, displacement, specular and gradient maps.
	maps_extra( L ) {

		const { scene, camera } = stage( L, 0, 1.8, 6.5 );
		camera.lookAt( 0, 0.1, 0 );
		const sun = new L.DirectionalLight( 0xffffff, 2.2 );
		sun.position.set( - 2, 3, 4 );
		scene.add( sun, new L.AmbientLight( 0xffffff, 0.4 ) );

		const baked = generated( L, 16, ( u, v ) => [ 255 * u, 120, 255 * v, 255 ], L.SRGBColorSpace );
		const unlit = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshBasicMaterial( { color: 0xffffff, lightMap: baked, lightMapIntensity: 2 } ) );
		unlit.position.set( - 2.1, 0.9, 0 );
		const lit = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshLambertMaterial( { color: 0xd8c8b0, lightMap: baked, lightMapIntensity: 1.5 } ) );
		lit.position.set( - 2.1, - 0.9, 0 );

		const ridges = generated( L, 32, ( u ) => {

			const h = 127.5 + 127.5 * Math.sin( u * Math.PI * 8 );
			return [ h, h, h, 255 ];

		} );
		const bumped = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6 ), new L.MeshStandardMaterial( { color: 0x8fb0d8, roughness: 0.5, bumpMap: ridges, bumpScale: 4 } ) );
		bumped.position.set( 0, 0.9, 0 );

		const hill = generated( L, 32, ( u, v ) => {

			const h = 255 * Math.max( 0, 1 - Math.hypot( u - 0.5, v - 0.5 ) * 2.5 );
			return [ h, h, h, 255 ];

		} );
		const displaced = new L.Mesh( new L.PlaneGeometry( 1.6, 1.6, 32, 32 ), new L.MeshLambertMaterial( { color: 0x6fd08c, displacementMap: hill, displacementScale: 0.6, displacementBias: - 0.1 } ) );
		displaced.position.set( 0, - 1, 0 );
		displaced.rotation.x = - 0.9;

		const stripes = generated( L, 16, ( u ) => ( u % 0.5 < 0.25 ? [ 255, 255, 255, 255 ] : [ 30, 30, 30, 255 ] ) );
		const shiny = new L.Mesh( new L.SphereGeometry( 0.75, 48, 24 ), new L.MeshPhongMaterial( { color: 0xd85a3a, specular: 0xffffff, shininess: 60, specularMap: stripes } ) );
		shiny.position.set( 2.1, 0.9, 0 );

		const tones = new L.DataTexture( new Uint8Array( [ 60, 60, 60, 255, 150, 150, 150, 255, 255, 255, 255, 255 ] ), 3, 1 );
		tones.needsUpdate = true;
		const toon = new L.Mesh( new L.SphereGeometry( 0.75, 48, 24 ), new L.MeshToonMaterial( { color: 0xffb454, gradientMap: tones } ) );
		toon.position.set( 2.1, - 0.9, 0 );

		scene.add( unlit, lit, bumped, displaced, shiny, toon );
		return { scene, camera };

	},

	// Clearcoat, sheen and the specular layer of the physical material, with an environment.
	physical( L ) {

		const { scene, camera } = stage( L, 0, 0.5, 5 );
		const sun = new L.DirectionalLight( 0xffffff, 2 );
		sun.position.set( 2, 3, 4 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.5 ) );
		scene.environment = sky( L );
		const materials = [
			new L.MeshPhysicalMaterial( { color: 0xb02020, roughness: 0.6, clearcoat: 1, clearcoatRoughness: 0.1 } ),
			new L.MeshPhysicalMaterial( { color: 0x303060, roughness: 0.9, sheen: 1, sheenColor: 0xff9060, sheenRoughness: 0.4 } ),
			new L.MeshPhysicalMaterial( { color: 0x206040, roughness: 0.3, ior: 2.2, specularIntensity: 0.8, specularColor: 0xffd0a0 } )
		];
		materials.forEach( ( material, i ) => {

			const ball = new L.Mesh( new L.SphereGeometry( 0.75, 48, 24 ), material );
			ball.position.x = ( i - 1 ) * 1.8;
			scene.add( ball );

		} );
		return { scene, camera };

	},

	// A point light casting onto the floor in several directions, PCF filtered.
	shadows_point( L ) {

		const { scene, camera } = floorScene( L, 0, 4, 5.5 );
		[ [ - 1.6, 0 ], [ 1.4, 0.3 ], [ 0, - 1.5 ], [ 0.2, 1.6 ] ].forEach( ( [ x, z ], i ) => {

			const box = new L.Mesh( new L.BoxGeometry( 0.5, 1, 0.5 ), new L.MeshLambertMaterial( { color: [ 0x4f8cff, 0xd85a3a, 0x6fd08c, 0xffb454 ][ i ] } ) );
			box.position.set( x, - 0.3, z );
			box.castShadow = true;
			scene.add( box );

		} );
		const bulb = new L.PointLight( 0xffffff, 30, 0, 2 );
		bulb.position.set( 0, 1.2, 0 );
		bulb.castShadow = true;
		bulb.shadow.mapSize.set( 512, 512 );
		bulb.shadow.bias = - 0.002;
		scene.add( bulb, new L.AmbientLight( 0xffffff, 0.15 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// A directional shadow with BasicShadowMap: one unfiltered comparison.
	shadows_basic( L ) {

		const { scene, camera } = floorScene( L, 0, 3.4, 5.2 );
		const box = new L.Mesh( new L.BoxGeometry( 1, 1, 1 ), new L.MeshLambertMaterial( { color: 0x4f8cff } ) );
		box.position.set( - 0.8, - 0.2, 0 );
		box.rotation.y = 0.5;
		box.castShadow = true;
		const ball = new L.Mesh( new L.SphereGeometry( 0.6, 32, 16 ), new L.MeshLambertMaterial( { color: 0xd85a3a } ) );
		ball.position.set( 1, 0.1, 0.3 );
		ball.castShadow = true;
		const sun = new L.DirectionalLight( 0xffffff, 3 );
		sun.position.set( 2.5, 5, 2 );
		sun.castShadow = true;
		sun.shadow.mapSize.set( 1024, 1024 );
		sun.shadow.camera.left = sun.shadow.camera.bottom = - 4;
		sun.shadow.camera.right = sun.shadow.camera.top = 4;
		sun.shadow.camera.far = 20;
		sun.shadow.camera.updateProjectionMatrix();
		sun.shadow.bias = - 0.0005;
		scene.add( box, ball, sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.6 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = L.BasicShadowMap;

		} };

	},

	// A cube texture as background and environment.
	cube_environment( L ) {

		const { scene, camera } = stage( L, 0, 0.5, 5 );
		camera.lookAt( 0.5, 0.3, 0 );
		const map = cubeFaces( L );
		scene.background = map;
		scene.environment = map;
		[ [ 0.05, 1 ], [ 0.5, 0 ] ].forEach( ( [ roughness, metalness ], i ) => {

			const ball = new L.Mesh( new L.SphereGeometry( 0.8, 48, 24 ), new L.MeshStandardMaterial( { color: 0xffffff, roughness, metalness } ) );
			ball.position.x = ( i - 0.5 ) * 2;
			scene.add( ball );

		} );
		return { scene, camera };

	},

	// The polyhedra, torus knot, lathe and capsule shapes.
	shapes_more( L ) {

		const { scene, camera } = stage( L, 0, 1.5, 7 );
		const sun = new L.DirectionalLight( 0xffffff, 2.5 );
		sun.position.set( 2, 3, 4 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.7 ) );
		const profile = [ [ 0, - 0.7 ], [ 0.5, - 0.5 ], [ 0.3, 0 ], [ 0.6, 0.5 ], [ 0, 0.7 ] ].map( ( [ x, y ] ) => new L.Vector2( x, y ) );
		const geometries = [
			new L.TetrahedronGeometry( 0.7 ), new L.OctahedronGeometry( 0.7 ), new L.DodecahedronGeometry( 0.7 ), new L.IcosahedronGeometry( 0.7, 1 ),
			new L.TorusKnotGeometry( 0.45, 0.15, 64, 8 ), new L.LatheGeometry( profile, 16 ), new L.CapsuleGeometry( 0.35, 0.6, 4, 12 ), new L.IcosahedronGeometry( 0.7, 3 )
		];
		geometries.forEach( ( geometry, i ) => {

			const mesh = new L.Mesh( geometry, new L.MeshStandardMaterial( { color: [ 0x4f8cff, 0xd85a3a, 0x6fd08c, 0xffb454 ][ i % 4 ], roughness: 0.5 } ) );
			mesh.position.set( ( i % 4 - 1.5 ) * 1.8, i < 4 ? 0.9 : - 0.9, 0 );
			mesh.rotation.set( 0.4, 0.6, 0 );
			scene.add( mesh );

		} );
		return { scene, camera };

	},

	// Custom blending: additive with ones, reverse subtraction, multiply by the destination,
	// and max, over a pattern. Alpha has its own function that keeps the target opaque, so
	// that the canvas is compared without its alpha.
	blending_custom( L ) {

		const { scene, camera } = stage( L, 0, 0, 6 );
		scene.background = new L.Color( 0x406080 );
		const stripes = new L.Mesh( new L.PlaneGeometry( 8, 4 ), new L.MeshBasicMaterial( { map: pattern( L ) } ) );
		stripes.position.z = - 1;
		scene.add( stripes );
		const settings = [
			[ L.OneFactor, L.OneFactor, L.AddEquation, 0xff4020 ],
			[ L.OneFactor, L.OneFactor, L.ReverseSubtractEquation, 0x60c040 ],
			[ L.DstColorFactor, L.ZeroFactor, L.AddEquation, 0xffd060 ],
			[ L.OneFactor, L.OneFactor, L.MaxEquation, 0x2080ff ]
		];
		settings.forEach( ( [ src, dst, equation, color ], i ) => {

			const material = new L.MeshBasicMaterial( { color, transparent: true, opacity: 0.8, blending: L.CustomBlending, blendSrc: src, blendDst: dst, blendEquation: equation } );
			material.blendSrcAlpha = L.ZeroFactor;
			material.blendDstAlpha = L.OneFactor;
			material.blendEquationAlpha = L.AddEquation;
			const quad = new L.Mesh( new L.PlaneGeometry( 1.5, 2.2 ), material );
			quad.position.set( - 2.7 + i * 1.8, 0, 0 );
			scene.add( quad );

		} );
		return { scene, camera };

	},

	// Flat shading on low-polygon spheres: standard, Phong and normal materials.
	flat_shading( L ) {

		const { scene, camera } = stage( L, 0, 1, 6 );
		const sun = new L.DirectionalLight( 0xffffff, 2.5 );
		sun.position.set( 2, 4, 3 );
		scene.add( sun, new L.AmbientLight( 0xffffff, 0.3 ) );
		const geometry = new L.SphereGeometry( 0.9, 10, 6 );
		const materials = [
			new L.MeshStandardMaterial( { color: 0xff8040, roughness: 0.5, metalness: 0, flatShading: true } ),
			new L.MeshPhongMaterial( { color: 0x40a0ff, shininess: 60, flatShading: true } ),
			new L.MeshNormalMaterial( { flatShading: true } )
		];
		materials.forEach( ( material, i ) => {

			const mesh = new L.Mesh( geometry, material );
			mesh.position.x = ( i - 1 ) * 2.1;
			mesh.rotation.y = 0.4;
			scene.add( mesh );

		} );
		return { scene, camera };

	}

};
