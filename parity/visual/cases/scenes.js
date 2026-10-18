// Fog, instancing, matrices, the other materials, environments and backgrounds.
//
// Part of the visual parity cases; `../cases.js` gathers them.

import { sky, stage } from './common.js';

export const SCENES = {

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

	},

	// Blinn-Phong, toon, normal and emissive spheres, and a closed line under them.
	materials( L ) {

		const { scene, camera } = stage( L, 0, 1.2, 6.5 );
		const sun = new L.DirectionalLight( 0xffffff, 2.5 );
		sun.position.set( 2, 4, 3 );
		scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.6 ) );

		const sphere = new L.SphereGeometry( 0.7, 40, 20 );
		[
			new L.MeshPhongMaterial( { color: 0x4f8cff, specular: 0xffffff, shininess: 60 } ),
			new L.MeshToonMaterial( { color: 0xff6b3d } ),
			new L.MeshNormalMaterial(),
			new L.MeshLambertMaterial( { color: 0x303030, emissive: 0x6fd08c, emissiveIntensity: 0.8 } )
		].forEach( ( material, i ) => {

			const mesh = new L.Mesh( sphere, material );
			mesh.position.set( ( i - 1.5 ) * 1.6, 0.4, 0 );
			scene.add( mesh );

		} );

		const outline = [ [ - 2.6, - 1.1 ], [ 2.6, - 1.1 ], [ 2.2, - 0.6 ], [ - 2.2, - 0.6 ] ].map( ( [ x, y ] ) => new L.Vector3( x, y, 0 ) );
		scene.add( new L.LineLoop( new L.BufferGeometry().setFromPoints( outline ), new L.LineBasicMaterial( { color: 0xffe08a } ) ) );
		return { scene, camera };

	},

	// A triangle whose vertex colours carry alpha, blended over a box.
	vertex_alpha( L ) {

		const { scene, camera } = stage( L, 0, 0, 3.5 );
		const box = new L.Mesh( new L.BoxGeometry( 1, 1, 1 ), new L.MeshBasicMaterial( { color: 0x4f8cff } ) );
		box.rotation.set( 0.4, 0.6, 0 );
		box.position.z = - 0.8;

		const geometry = new L.BufferGeometry();
		geometry.setAttribute( 'position', new L.Float32BufferAttribute( [ - 1.4, - 1, 0, 1.4, - 1, 0, 0, 1.2, 0 ], 3 ) );
		geometry.setAttribute( 'color', new L.Float32BufferAttribute( [ 1, 0.3, 0.2, 1, 0.3, 1, 0.4, 0.2, 1, 0.9, 0.3, 0.6 ], 4 ) );
		const triangle = new L.Mesh( geometry, new L.MeshBasicMaterial( { vertexColors: true, transparent: true, side: L.DoubleSide } ) );
		scene.add( box, triangle );
		return { scene, camera };

	},

	// Standard materials lit only by `scene.environment`, which is also the background.
	environment( L ) {

		const { scene, camera } = stage( L, 0, 0.5, 5 );
		const map = sky( L );
		scene.environment = map;
		scene.background = map;

		[ [ 0.05, 1 ], [ 0.45, 1 ], [ 0.6, 0 ] ].forEach( ( [ roughness, metalness ], i ) => {

			const ball = new L.Mesh( new L.SphereGeometry( 0.75, 48, 24 ), new L.MeshStandardMaterial( { color: 0xffffff, roughness, metalness } ) );
			ball.position.x = ( i - 1 ) * 1.8;
			scene.add( ball );

		} );

		return { scene, camera };

	},

	// A blurred, dimmed, rotated background, and an environment turned and weakened per scene.
	background_blurred( L ) {

		const { scene, camera } = stage( L, 0, 0.3, 4 );
		const map = sky( L );
		scene.background = map;
		scene.backgroundBlurriness = 0.3;
		scene.backgroundIntensity = 0.7;
		scene.backgroundRotation.y = 1.2;
		scene.environment = map;
		scene.environmentIntensity = 0.6;
		scene.environmentRotation.y = - 0.8;

		const knot = new L.Mesh( new L.TorusGeometry( 0.8, 0.3, 24, 64 ), new L.MeshStandardMaterial( { color: 0xe8e4d8, roughness: 0.25, metalness: 0.9 } ) );
		knot.rotation.set( 0.5, 0.3, 0 );
		scene.add( knot );
		return { scene, camera };

	}

};
