// The demo scene, written once against a library object `L`. The demo passes WAMR3D;
// the visual check also passes the reference library, so both draw from this same code.

import { describe, animate, COLORS, CAMERA, CUBE, RING, FIRST_SATELLITE } from '../compare/scene.js';

export { CAMERA };

function checker( L ) {

	const size = 8, data = new Uint8Array( size * size * 4 );

	for ( let i = 0; i < size * size; i ++ ) {

		const light = ( i + ( i >> 3 ) ) % 2 === 0;
		data.set( light ? [ 235, 225, 200, 255 ] : [ 70, 110, 190, 255 ], i * 4 );

	}

	const texture = new L.DataTexture( data, size, size );
	texture.colorSpace = L.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;

}

function grid( L, size, divisions ) {

	const half = size / 2, positions = [], colors = [];

	for ( let i = 0; i <= divisions; i ++ ) {

		const k = - half + i * size / divisions, c = i === divisions / 2 ? [ 0.1, 0.12, 0.16 ] : [ 0.03, 0.035, 0.045 ];
		positions.push( - half, 0, k, half, 0, k, k, 0, - half, k, 0, half );
		colors.push( ...c, ...c, ...c, ...c );

	}

	const geometry = new L.BufferGeometry();
	geometry.setAttribute( 'position', new L.BufferAttribute( new Float32Array( positions ), 3 ) );
	geometry.setAttribute( 'color', new L.BufferAttribute( new Float32Array( colors ), 3 ) );
	const lines = new L.LineSegments( geometry, new L.LineBasicMaterial( { vertexColors: true } ) );
	lines.position.y = 0.002;
	return lines;

}

/**
 * `standard` uses physically based materials; `textured` puts a checker map on the floor and the ball;
 * `extras` adds a line grid, a see-through ring and a point light circling the cube.
 */
export function buildScene( L, satellites = 12, { standard = false, textured = false, extras = false } = {} ) {

	const material = ( parameters ) => standard ? new L.MeshStandardMaterial( { ...parameters, roughness: 0.55, metalness: 0.05 } ) : new L.MeshLambertMaterial( parameters );
	const map = textured ? checker( L ) : null;

	const { count, positions, scales } = describe( satellites );

	const scene = new L.Scene();
	scene.background = new L.Color( 0x14161a );

	const sun = new L.DirectionalLight( 0xffffff, 2.2 );
	sun.position.set( 4, 8, 5 );
	scene.add( sun, new L.HemisphereLight( 0xbfd4ff, 0x30281e, 0.9 ) );

	const floor = new L.Mesh( new L.PlaneGeometry( 20, 20 ), textured ? new L.MeshBasicMaterial( { map } ) : material( { color: 0x2a2f38 } ) );
	floor.rotation.x = - Math.PI / 2;

	const cube = new L.Mesh( new L.BoxGeometry( 1.4, 1.4, 1.4 ), material( { color: 0x4f8cff } ) );
	cube.position.set( ...positions[ CUBE ] );

	const ball = new L.Mesh( new L.SphereGeometry( 0.5, 32, 16 ), material( textured ? { map } : { color: 0xe8e4d8 } ) );
	ball.position.y = 1.25;

	const ring = new L.Group();
	scene.add( floor, cube );
	cube.add( ring, ball );

	const box = new L.BoxGeometry( 1, 1, 1 );
	const materials = COLORS.map( ( color ) => material( { color } ) );
	const spinning = [ null, null, cube, ring ];

	for ( let i = FIRST_SATELLITE; i < count; i ++ ) {

		const satellite = new L.Mesh( box, materials[ ( i - FIRST_SATELLITE ) % 3 ] );
		satellite.position.set( ...positions[ i ] );
		satellite.scale.setScalar( scales[ i ] );
		ring.add( satellite );
		spinning.push( satellite );

	}

	let lamp = null;

	if ( extras ) {

		const halo = new L.Mesh( new L.TorusGeometry( 1.5, 0.08, 10, 64 ), new L.MeshStandardMaterial( { color: 0x9fd8ff, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.45 } ) );
		halo.rotation.x = Math.PI / 2;
		lamp = new L.PointLight( 0xffb454, 14, 9 );
		lamp.add( new L.Mesh( new L.SphereGeometry( 0.07, 12, 8 ), new L.MeshBasicMaterial( { color: 0xffd9a0 } ) ) );
		cube.add( halo );
		scene.add( lamp );
		if ( ! textured ) scene.add( grid( L, 20, 20 ) );

	}

	const camera = new L.PerspectiveCamera( CAMERA.fov, 1, CAMERA.near, CAMERA.far );
	const angles = new Float32Array( count * 3 );

	return {

		scene, camera, cube, ball, objectCount: count + 3,

		update( time ) {

			animate( time, satellites, angles );
			for ( let i = CUBE; i < count; i ++ ) spinning[ i ].rotation.set( angles[ i * 3 ], angles[ i * 3 + 1 ], angles[ i * 3 + 2 ] );
			spinning[ RING ].rotation.set( 0, angles[ RING * 3 + 1 ], angles[ RING * 3 + 2 ] );
			if ( lamp ) lamp.position.set( Math.cos( time * 0.8 ) * 3.4, 0.7 + Math.sin( time * 1.3 ) * 0.3, Math.sin( time * 0.8 ) * 3.4 );

		},

		orbit( { yaw, pitch, distance, target }, aspect ) {

			const flat = distance * Math.cos( pitch );
			camera.position.set( target[ 0 ] + flat * Math.sin( yaw ), target[ 1 ] - distance * Math.sin( pitch ), target[ 2 ] + flat * Math.cos( yaw ) );
			camera.lookAt( ...target );

			if ( camera.aspect !== aspect ) {

				camera.aspect = aspect;
				camera.updateProjectionMatrix();

			}

		}

	};

}
