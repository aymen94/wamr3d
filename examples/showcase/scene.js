// The showcase scene, described once as plain arrays so that every engine builds and
// animates exactly the same thing: a sun, eight tilted belts turning around it, each
// belt made of clusters that spin, each cluster carrying ten tumbling bodies.
//
// It is a scene graph four levels deep (root > belt > cluster > body). Every frame only
// rotations change; where a body ends up is the product of its three ancestors.

export const DEFAULTS = {
	engine: 'wamr3d', count: 10000, mode: 'objects', shape: 'mix', material: 'standard',
	roughness: 0.4, metalness: 0.1, sun: 45, ambient: 1.1, fog: true, fogDensity: 0.008, speed: 1, orbit: true
};

export const BACKGROUND = 0x070a12, SUN_COLOR = 0xffd9a0;
export const PALETTE = [ 0xff6b6b, 0xffb454, 0xffe08a, 0x6fd08c, 0x4fd1c5, 0x4f8cff, 0xb48cff, 0xff6b9d ];
export const SHAPES = [ 'box', 'cone', 'torus' ];
export const CAMERA = { fov: 55, near: 0.5, far: 400, yaw: 0.6, pitch: - 0.36, distance: 50 };
export const SUN_LIGHT = { decay: 1 }, FILL_LIGHT = { direction: [ 0.4, 1, 0.6 ], intensity: 0.35 }, SKY = 0xbfd4ff, GROUND = 0x30281e;

const BELTS = 8, PER_CLUSTER = 10, TAU = Math.PI * 2;

function random( seed ) {

	return () => {

		seed = ( seed + 0x6D2B79F5 ) >>> 0;
		let t = seed;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/**
 * Node arrays for `count` bodies. Node 0 is the root, then the belts, the clusters and
 * the bodies. `base` and `speed` hold three Euler angles (XYZ) per node: the angle at
 * time zero and its change per second.
 */
export function layout( count, shape = 'mix' ) {

	const next = random( 186 );
	const clusters = Math.max( BELTS, Math.round( count / PER_CLUSTER ) ), bodies = clusters * PER_CLUSTER;
	const nodes = 1 + BELTS + clusters + bodies;
	const parent = new Int32Array( nodes ).fill( - 1 ), position = new Float32Array( nodes * 3 ), scale = new Float32Array( nodes ).fill( 1 );
	const base = new Float32Array( nodes * 3 ), speed = new Float32Array( nodes * 3 );
	const bodyBelt = new Uint8Array( bodies ), bodyShape = new Uint8Array( bodies );

	const radius = ( belt ) => 7 + belt * 3.4;
	const weights = Array.from( { length: BELTS }, ( _, belt ) => radius( belt ) ), total = weights.reduce( ( a, b ) => a + b, 0 );

	for ( let belt = 0; belt < BELTS; belt ++ ) {

		const node = 1 + belt;
		parent[ node ] = 0;
		base[ node * 3 ] = ( next() - 0.5 ) * 0.5;
		base[ node * 3 + 1 ] = next() * TAU;
		base[ node * 3 + 2 ] = ( next() - 0.5 ) * 0.5;
		speed[ node * 3 + 1 ] = 0.28 / ( 1 + belt * 0.35 );

	}

	// larger belts get proportionally more clusters, so all are equally dense
	const bodySize = 0.62 * Math.cbrt( 2000 / bodies ), firstCluster = 1 + BELTS, firstBody = firstCluster + clusters;
	const shapeIndex = SHAPES.indexOf( shape );
	let cluster = 0;

	for ( let belt = 0; belt < BELTS; belt ++ ) {

		const share = belt === BELTS - 1 ? clusters - cluster : Math.round( clusters * weights[ belt ] / total );

		for ( let k = 0; k < share && cluster < clusters; k ++, cluster ++ ) {

			const node = firstCluster + cluster, angle = ( k + next() * 0.8 ) / share * TAU, r = radius( belt ) + ( next() - 0.5 ) * 2.4;
			parent[ node ] = 1 + belt;
			position.set( [ Math.cos( angle ) * r, ( next() - 0.5 ) * 1.2, Math.sin( angle ) * r ], node * 3 );
			for ( let a = 0; a < 3; a ++ ) base[ node * 3 + a ] = next() * TAU;
			speed.set( [ ( next() - 0.5 ) * 0.6, ( 0.4 + next() * 0.8 ) * ( next() < 0.5 ? - 1 : 1 ), ( next() - 0.5 ) * 0.6 ], node * 3 );

			for ( let j = 0; j < PER_CLUSTER; j ++ ) {

				const body = cluster * PER_CLUSTER + j, child = firstBody + body;
				const theta = next() * TAU, height = next() * 2 - 1, flat = Math.sqrt( 1 - height * height ), reach = 0.6 + next() * 0.9;
				parent[ child ] = node;
				position.set( [ Math.cos( theta ) * flat * reach, height * reach, Math.sin( theta ) * flat * reach ], child * 3 );
				scale[ child ] = bodySize * ( 0.6 + next() * 0.8 );
				for ( let a = 0; a < 3; a ++ ) base[ child * 3 + a ] = next() * TAU;
				speed.set( [ ( 0.5 + next() * 2 ) * ( next() < 0.5 ? - 1 : 1 ), ( 0.5 + next() * 2 ) * ( next() < 0.5 ? - 1 : 1 ), 0 ], child * 3 );
				bodyBelt[ body ] = belt;
				bodyShape[ body ] = shapeIndex === - 1 ? body % SHAPES.length : shapeIndex;

			}

		}

	}

	// bodies grouped by shape, for instanced drawing: one instanced mesh per shape
	const groups = SHAPES.map( ( name, index ) => ( { shape: name, bodies: Array.from( bodyShape.keys() ).filter( ( body ) => bodyShape[ body ] === index ) } ) ).filter( ( group ) => group.bodies.length > 0 );

	return { nodes, bodies, clusters, belts: BELTS, firstBody, parent, position, scale, base, speed, bodyBelt, bodyShape, groups, angles: new Float32Array( nodes * 3 ) };

}

/** This frame's Euler angles of every node, into `scene.angles`. Kept within one turn so 32-bit floats stay exact. */
export function animate( time, scene ) {

	const { base, speed, angles } = scene;
	for ( let i = 0; i < angles.length; i ++ ) angles[ i ] = ( base[ i ] + time * speed[ i ] ) % TAU;
	return angles;

}

export function cameraPosition( { yaw, pitch, distance } ) {

	const flat = distance * Math.cos( pitch );
	return [ flat * Math.sin( yaw ), - distance * Math.sin( pitch ), flat * Math.cos( yaw ) ];

}

/** Constructor arguments of each shape, the same for every engine. */
export const SHAPE_ARGUMENTS = {
	box: [ 1, 1, 1 ],
	cone: [ 0.6, 1.3, 10, 1 ],
	torus: [ 0.5, 0.2, 8, 16 ]
};
