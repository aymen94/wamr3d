// Flat number arrays to three.js objects and back.
//
// Part of the math fixture generator; `../generate.mjs` runs it.

import { Vector2 } from 'three/src/math/Vector2.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Vector4 } from 'three/src/math/Vector4.js';
import { Matrix3 } from 'three/src/math/Matrix3.js';
import { Matrix4 } from 'three/src/math/Matrix4.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import { Euler } from 'three/src/math/Euler.js';
import { Color } from 'three/src/math/Color.js';
import { Box3 } from 'three/src/math/Box3.js';
import { Sphere } from 'three/src/math/Sphere.js';
import { Plane } from 'three/src/math/Plane.js';
import { Ray } from 'three/src/math/Ray.js';
import { Frustum } from 'three/src/math/Frustum.js';
import { Triangle } from 'three/src/math/Triangle.js';
import { Line3 } from 'three/src/math/Line3.js';
import { Spherical } from 'three/src/math/Spherical.js';
import { Cylindrical } from 'three/src/math/Cylindrical.js';
import { ORDERS } from './common.js';

export const v3 = ( a, o = 0 ) => new Vector3( a[ o ], a[ o + 1 ], a[ o + 2 ] );
const points = ( a ) => Array.from( { length: a[ 0 ] }, ( _, i ) => v3( a, 1 + i * 3 ) );

export const DEC = {
	s: ( a ) => a[ 0 ],
	i: ( a ) => a[ 0 ],
	b: ( a ) => a[ 0 ] === 1,
	v2: ( a ) => new Vector2( a[ 0 ], a[ 1 ] ),
	v3: ( a ) => v3( a ),
	v4: ( a ) => new Vector4( a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ] ),
	q: ( a ) => new Quaternion( a[ 0 ], a[ 1 ], a[ 2 ], a[ 3 ] ),
	e: ( a ) => new Euler( a[ 0 ], a[ 1 ], a[ 2 ], ORDERS[ a[ 3 ] ] ),
	m3: ( a ) => new Matrix3().fromArray( a ),
	m4: ( a ) => new Matrix4().fromArray( a ),
	c: ( a ) => new Color().fromArray( a ),
	box: ( a ) => new Box3( v3( a, 0 ), v3( a, 3 ) ),
	sph: ( a ) => new Sphere( v3( a ), a[ 3 ] ),
	pl: ( a ) => new Plane( v3( a ), a[ 3 ] ),
	ray: ( a ) => new Ray( v3( a, 0 ), v3( a, 3 ) ),
	line: ( a ) => new Line3( v3( a, 0 ), v3( a, 3 ) ),
	tri: ( a ) => new Triangle( v3( a, 0 ), v3( a, 3 ), v3( a, 6 ) ),
	fr: ( a ) => new Frustum( ...[ 0, 4, 8, 12, 16, 20 ].map( ( o ) => new Plane( v3( a, o ), a[ o + 3 ] ) ) ),
	sphl: ( a ) => new Spherical( a[ 0 ], a[ 1 ], a[ 2 ] ),
	cyl: ( a ) => new Cylindrical( a[ 0 ], a[ 1 ], a[ 2 ] ),
	pts: ( a ) => points( a )
};

const ENC = {
	s: ( v ) => [ v ],
	i: ( v ) => [ v ],
	b: ( v ) => [ v ? 1 : 0 ],
	v2: ( v ) => [ v.x, v.y ],
	v3: ( v ) => [ v.x, v.y, v.z ],
	v4: ( v ) => [ v.x, v.y, v.z, v.w ],
	q: ( v ) => ( Array.isArray( v ) ? v.slice( 0, 4 ) : [ v.x, v.y, v.z, v.w ] ),
	e: ( v ) => [ v.x, v.y, v.z, ORDERS.indexOf( v.order ) ],
	m3: ( v ) => [ ...v.elements ],
	m4: ( v ) => [ ...v.elements ],
	c: ( v ) => [ v.r, v.g, v.b ],
	hsl: ( v ) => [ v.h, v.s, v.l ],
	box: ( v ) => [ ...v.min.toArray(), ...v.max.toArray() ],
	sph: ( v ) => [ ...v.center.toArray(), v.radius ],
	pl: ( v ) => [ ...v.normal.toArray(), v.constant ],
	ray: ( v ) => [ ...v.origin.toArray(), ...v.direction.toArray() ],
	line: ( v ) => [ ...v.start.toArray(), ...v.end.toArray() ],
	tri: ( v ) => [ ...v.a.toArray(), ...v.b.toArray(), ...v.c.toArray() ],
	fr: ( v ) => v.planes.flatMap( ( p ) => [ ...p.normal.toArray(), p.constant ] ),
	sphl: ( v ) => [ v.radius, v.phi, v.theta ],
	cyl: ( v ) => [ v.radius, v.theta, v.y ]
};

// `ret` is a kind, "opt:<kind>" (null -> [0], value -> [1, ...]), "str", or an array of those.
export function encode( ret, value, extra ) {

	if ( Array.isArray( ret ) ) return ret.flatMap( ( k, i ) => encode( k, value[ i ], extra ) );
	if ( ret === 'str' ) {

		extra.os = value;
		return [];

	}

	if ( ret.startsWith( 'opt:' ) ) return value === null ? [ 0 ] : [ 1, ...ENC[ ret.slice( 4 ) ]( value ) ];
	return ENC[ ret ]( value );

}
