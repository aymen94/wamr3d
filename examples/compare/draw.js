// Drawing shared by both sides of the comparison: the same WebGL renderer, lights,
// materials and meshes, so that any difference in frame time comes from how the
// transforms are produced, not from what is drawn. three.js r186 does the drawing in
// both cases; for WAMR3D that is the temporary rendering adapter.

import { loadThreeWebGL } from '../three-reference.js';
import { COLORS, FLOOR, CUBE, FIRST_SATELLITE } from './scene.js';

const THREE = await loadThreeWebGL();

export { THREE };

export function createDrawing( canvas ) {

	const renderer = new THREE.WebGLRenderer( { canvas, antialias: true } );
	renderer.setPixelRatio( 1 );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x14161a );
	scene.matrixWorldAutoUpdate = false;

	const sun = new THREE.DirectionalLight( 0xffffff, 2.2 );
	sun.position.set( 4, 8, 5 );
	const fill = new THREE.HemisphereLight( 0xbfd4ff, 0x30281e, 0.9 );
	const grid = new THREE.GridHelper( 20, 20, 0x5a6270, 0x30353d );
	grid.position.y = 0.002;
	scene.add( sun, sun.target, fill, grid );
	for ( const object of [ sun, sun.target, fill, grid ] ) object.updateMatrixWorld( true );

	const materials = [ 0x2a2f38, 0x4f8cff, ...COLORS ].map( ( color ) => new THREE.MeshStandardMaterial( { color, roughness: 0.55, metalness: 0.05 } ) );

	function geometry( { positions, normals, indices } ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		g.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );
		g.setIndex( new THREE.BufferAttribute( indices, 1 ) );
		return g;

	}

	return {

		renderer, scene,

		/** One mesh per drawable object; `shapes` holds floor, cube and satellite vertex data. */
		createMeshes( count, shapes ) {

			const geometries = { floor: geometry( shapes.floor ), cube: geometry( shapes.cube ), satellite: geometry( shapes.satellite ) };
			const meshes = new Array( count ).fill( null );

			for ( let i = FLOOR; i < count; i ++ ) {

				if ( i === FLOOR ) meshes[ i ] = new THREE.Mesh( geometries.floor, materials[ 0 ] );
				else if ( i === CUBE ) meshes[ i ] = new THREE.Mesh( geometries.cube, materials[ 1 ] );
				else if ( i >= FIRST_SATELLITE ) meshes[ i ] = new THREE.Mesh( geometries.satellite, materials[ 2 + ( i - FIRST_SATELLITE ) % 3 ] );
				if ( meshes[ i ] ) meshes[ i ].frustumCulled = false;

			}

			return meshes;

		},

		setSize( width, height ) {

			renderer.setSize( width, height, false );

		}

	};

}
