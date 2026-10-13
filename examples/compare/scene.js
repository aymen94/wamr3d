// The comparison scene, described once so both engines build and animate the same thing:
// a floor, a rotating cube, a ring pivot parented to the cube, and `satellites` small
// cubes parented to the pivot. Twelve satellites reproduce examples/browser.

export const ROOT = 0, FLOOR = 1, CUBE = 2, RING = 3, FIRST_SATELLITE = 4;
export const COLORS = [ 0xffb454, 0x6fd08c, 0xff6b9d ];
export const CAMERA = { yaw: 0.7, pitch: - 0.45, distance: 9, target: [ 0, 1.2, 0 ], fov: 50, near: 0.1, far: 200 };

export function describe( satellites ) {

	const parents = [ - 1, ROOT, ROOT, CUBE ];
	const positions = [ [ 0, 0, 0 ], [ 0, 0, 0 ], [ 0, 1.6, 0 ], [ 0, 0, 0 ] ];
	const scales = [ 1, 1, 1, 1 ];

	for ( let k = 0; k < satellites; k ++ ) {

		const ring = Math.floor( k / 12 );
		const angle = ( k % 12 ) / 12 * Math.PI * 2 + ring * 0.37;
		const radius = 2.6 + ring * 0.55;
		parents.push( RING );
		positions.push( [ Math.cos( angle ) * radius, ( ring % 7 ) * 0.35 * Math.sign( ring % 2 - 0.5 ), Math.sin( angle ) * radius ] );
		scales.push( 0.28 + 0.12 * ( k % 3 ) );

	}

	return { satellites, count: parents.length, parents, positions, scales };

}

/** Writes this frame's Euler angles (XYZ order), three per object, into `out`. */
export function animate( time, satellites, out ) {

	out[ CUBE * 3 ] = time * 0.6;
	out[ CUBE * 3 + 1 ] = time * 0.9;
	out[ RING * 3 + 1 ] = - time * 1.4;
	out[ RING * 3 + 2 ] = Math.sin( time * 0.5 ) * 0.35;

	for ( let k = 0, o = FIRST_SATELLITE * 3; k < satellites; k ++, o += 3 ) {

		out[ o ] = time * ( 1 + ( k % 40 ) * 0.1 );
		out[ o + 1 ] = time * 0.7;
		out[ o + 2 ] = k % 7;

	}

}

export function boxData( w, h, d ) {

	const [ x, y, z ] = [ w / 2, h / 2, d / 2 ];
	const faces = [
		[ [ x, - y, z ], [ x, - y, - z ], [ x, y, - z ], [ x, y, z ] ], [ [ - x, - y, - z ], [ - x, - y, z ], [ - x, y, z ], [ - x, y, - z ] ],
		[ [ - x, y, z ], [ x, y, z ], [ x, y, - z ], [ - x, y, - z ] ], [ [ - x, - y, - z ], [ x, - y, - z ], [ x, - y, z ], [ - x, - y, z ] ],
		[ [ - x, - y, z ], [ x, - y, z ], [ x, y, z ], [ - x, y, z ] ], [ [ x, - y, - z ], [ - x, - y, - z ], [ - x, y, - z ], [ x, y, - z ] ]
	];
	return {
		positions: new Float32Array( faces.flat( 2 ) ),
		indices: new Uint32Array( faces.flatMap( ( _, f ) => [ 0, 1, 2, 0, 2, 3 ].map( ( i ) => f * 4 + i ) ) )
	};

}

export function floorData( size ) {

	const s = size / 2;
	return { positions: new Float32Array( [ - s, 0, s, s, 0, s, s, 0, - s, - s, 0, - s ] ), indices: new Uint32Array( [ 0, 1, 2, 0, 2, 3 ] ) };

}
