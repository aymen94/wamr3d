// Math classes over the engine values: chaining, `target` arguments, defaults.

import * as W from '../index.js';
import { LinearSRGBColorSpace, NoColorSpace, SRGBColorSpace, WebGLCoordinateSystem, WebGPUCoordinateSystem } from './constants.js';
import { ignored } from './engine.js';

// ---------------------------------------------------------------- math

const compatByBase = new Map();
const NULLABLE = new Set( [ 'intersectSphere', 'distanceToPlane', 'intersectPlane', 'intersectBox', 'intersectTriangle', 'getBarycoord' ] );

function adopt( value ) {

	if ( value !== null && typeof value === 'object' ) {

		const prototype = compatByBase.get( Object.getPrototypeOf( value ) );
		if ( prototype ) Object.setPrototypeOf( value, prototype );

	}

	return value;

}

// Gives a class the calling conventions of its engine base class plus: methods return
// `this` for chaining, a trailing `target` argument receives the result, and methods
// that can fail return null.
function extend( Compat, Base, name ) {

	compatByBase.set( Base.prototype, Compat.prototype );
	Compat.prototype[ 'is' + name ] = true;

	for ( const key of Object.getOwnPropertyNames( Base.prototype ) ) {

		if ( key === 'constructor' || key === 'free' || key.startsWith( '__' ) || Object.hasOwn( Compat.prototype, key ) ) continue;
		const descriptor = Object.getOwnPropertyDescriptor( Base.prototype, key );

		if ( descriptor.get ) {

			Object.defineProperty( Compat.prototype, key, { get() {

				return adopt( descriptor.get.call( this ) );

			}, set: descriptor.set, configurable: true } );
			continue;

		}

		const method = descriptor.value;
		if ( typeof method !== 'function' ) continue;
		const arity = method.length;

		Compat.prototype[ key ] = function () {

			// Reuse the arguments object instead of allocating a rest array on every call.
			const args = arguments;
			const target = args.length > arity ? args[ arity ] : null, offset = args[ arity + 1 ] || 0;
			if ( args.length > arity ) args.length = arity;
			let temporaries = null;

			for ( let i = 0; i < args.length; i ++ ) {

				if ( args[ i ] !== null && typeof args[ i ] === 'object' && args[ i ]._o !== undefined && args[ i ]._p !== undefined ) ( temporaries ??= [] ).push( args[ i ] = args[ i ].clone() );

			}

			let result;
			switch ( args.length ) {

				case 0: result = method.call( this ); break;
				case 1: result = method.call( this, args[ 0 ] ); break;
				case 2: result = method.call( this, args[ 0 ], args[ 1 ] ); break;
				case 3: result = method.call( this, args[ 0 ], args[ 1 ], args[ 2 ] ); break;
				case 4: result = method.call( this, args[ 0 ], args[ 1 ], args[ 2 ], args[ 3 ] ); break;
				default: result = method.apply( this, args );

			}

			if ( temporaries ) for ( const t of temporaries ) t.free();

			if ( result === undefined ) return NULLABLE.has( key ) ? null : this;

			if ( target !== null && target !== undefined && typeof result === 'object' ) {

				if ( ArrayBuffer.isView( result ) ) {

					for ( let i = 0; i < result.length; i ++ ) target[ offset + i ] = result[ i ];
					return target;

				}

				if ( typeof target.copy === 'function' ) {

					target.copy( adopt( result ) );
					result.free();
					return target;

				}

			}

			return adopt( result );

		};

	}

}

function fromArray( count ) {

	return function ( array, offset = 0 ) {

		return count === 2 ? this.set( array[ offset ], array[ offset + 1 ] )
			: count === 3 ? this.set( array[ offset ], array[ offset + 1 ], array[ offset + 2 ] )
				: this.set( array[ offset ], array[ offset + 1 ], array[ offset + 2 ], array[ offset + 3 ] );

	};

}

export class Vector2 extends W.Vector2 {

	constructor( x = 0, y = 0 ) {

		super( x, y );

	}

	get width() {

		return this.x;

	}

	set width( value ) {

		this.x = value;

	}

	get height() {

		return this.y;

	}

	set height( value ) {

		this.y = value;

	}

}

Vector2.prototype.fromArray = fromArray( 2 );

export class Vector3 extends W.Vector3 {

	constructor( x = 0, y = 0, z = 0 ) {

		super( x, y, z );

	}

	/** World space to normalized device coordinates of `camera`. */
	project( camera ) {

		return this.applyMatrix4( camera.matrixWorldInverse ).applyMatrix4( camera.projectionMatrix );

	}

	/** Normalized device coordinates of `camera` to world space. */
	unproject( camera ) {

		return this.applyMatrix4( camera.projectionMatrixInverse ).applyMatrix4( camera.matrixWorld );

	}

}

Vector3.prototype.fromArray = fromArray( 3 );

export class Vector4 extends W.Vector4 {

	constructor( x = 0, y = 0, z = 0, w = 1 ) {

		super( x, y, z, w );

	}

}

Vector4.prototype.fromArray = fromArray( 4 );

export class Quaternion extends W.Quaternion {

	constructor( x = 0, y = 0, z = 0, w = 1 ) {

		super( x, y, z, w );

	}

	setFromEuler( euler ) {

		super.setFromEuler( euler.x, euler.y, euler.z, euler.order );
		return this;

	}

}

Quaternion.prototype.fromArray = fromArray( 4 );

export class Euler extends W.Euler {

	constructor( x = 0, y = 0, z = 0, order = 'XYZ' ) {

		super( x, y, z, order );

	}

	get order() {

		return super.order;

	}

	set order( value ) {

		super.setOrder( value );

	}

	set( x, y, z, order = this.order ) {

		super.set( x, y, z, order );
		return this;

	}

	setFromQuaternion( q, order = this.order ) {

		const source = q._o !== undefined && q._p !== undefined ? q.clone() : q;
		super.setFromQuaternion( source, order );
		return this;

	}

	setFromRotationMatrix( m, order = this.order ) {

		super.setFromRotationMatrix( m, order );
		return this;

	}

	fromArray( array ) {

		return this.set( array[ 0 ], array[ 1 ], array[ 2 ], array[ 3 ] ?? this.order );

	}

}

function elementsFromArray( Base, count ) {

	return function ( array, offset = 0 ) {

		Base.prototype.fromArray.call( this, offset === 0 && array.length === count ? array : Array.prototype.slice.call( array, offset, offset + count ) );
		return this;

	};

}

export class Matrix3 extends W.Matrix3 {

	/** A copy of the 9 elements, column-major. Write back with `fromArray`. */
	get elements() {

		return super.toArray();

	}

}

Matrix3.prototype.fromArray = elementsFromArray( W.Matrix3, 9 );

export class Matrix4 extends W.Matrix4 {

	/** A copy of the 16 elements, column-major. Write back with `fromArray`. */
	get elements() {

		return super.toArray();

	}

	/** Sets the elements from row-major arguments. */
	set( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

		return this.fromArray( [ n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44 ] );

	}

	setPosition( x, y, z ) {

		if ( typeof x === 'object' ) super.setPosition( x.x, x.y, x.z );
		else super.setPosition( x, y, z );
		return this;

	}

	decompose( position, quaternion, scale ) {

		const v = super.decompose();
		position.set( v[ 0 ], v[ 1 ], v[ 2 ] );
		quaternion.set( v[ 3 ], v[ 4 ], v[ 5 ], v[ 6 ] );
		scale.set( v[ 7 ], v[ 8 ], v[ 9 ] );
		return this;

	}

	makePerspective( left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		super.makePerspective( left, right, top, bottom, near, far, coordinateSystem === WebGPUCoordinateSystem, reversedDepth );
		return this;

	}

	makeOrthographic( left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		super.makeOrthographic( left, right, top, bottom, near, far, coordinateSystem === WebGPUCoordinateSystem, reversedDepth );
		return this;

	}

}

Matrix4.prototype.fromArray = elementsFromArray( W.Matrix4, 16 );


/**
 * Colours are stored in the linear working colour space (`LinearSRGBColorSpace`), as with
 * three.js colour management. Only `SRGBColorSpace` and `LinearSRGBColorSpace` are known.
 */
export const ColorManagement = {

	get enabled() {

		return true;

	},

	set enabled( value ) {

		if ( ! value ) ignored( 'ColorManagement.enabled = false' );

	},

	workingColorSpace: LinearSRGBColorSpace

};

function linearSpace( colorSpace ) {

	if ( colorSpace === LinearSRGBColorSpace || colorSpace === NoColorSpace ) return true;
	if ( colorSpace !== SRGBColorSpace ) throw new Error( `WAMR3D: unknown colour space: ${colorSpace}` );
	return false;

}

export class Color extends W.Color {

	/** `new Color()`, `new Color(0xff8800)`, `new Color('orange')` or `new Color(r, g, b)`. */
	constructor( r, g, b ) {

		super( 1, 1, 1 );
		if ( r !== undefined ) this.set( r, g, b );

	}

	set( r, g, b ) {

		if ( g === undefined && b === undefined ) {

			if ( r && r.isColor ) this.copy( r );
			else if ( typeof r === 'number' ) this.setHex( r );
			else if ( typeof r === 'string' ) this.setStyle( r );

		} else {

			this.setRGB( r, g, b );

		}

		return this;

	}

	/** Components in `colorSpace` (default: the linear working space). */
	setRGB( r, g, b, colorSpace = LinearSRGBColorSpace ) {

		super.setRGB( r, g, b );
		if ( ! linearSpace( colorSpace ) ) super.convertSRGBToLinear();
		return this;

	}

	/** A hex number in `colorSpace` (default: sRGB). */
	setHex( hex, colorSpace = SRGBColorSpace ) {

		if ( linearSpace( colorSpace ) ) super.setRGB( ( hex >> 16 & 255 ) / 255, ( hex >> 8 & 255 ) / 255, ( hex & 255 ) / 255 );
		else super.setHex( hex );
		return this;

	}

	/** A CSS colour whose numbers are in `colorSpace` (default: sRGB). */
	setStyle( style, colorSpace = SRGBColorSpace ) {

		super.setStyle( style );
		if ( linearSpace( colorSpace ) ) super.convertLinearToSRGB();
		return this;

	}

	/** Hue, saturation and lightness in `colorSpace` (default: the linear working space). */
	setHSL( h, s, l, colorSpace = LinearSRGBColorSpace ) {

		super.setHSL( h, s, l );
		if ( ! linearSpace( colorSpace ) ) super.convertSRGBToLinear();
		return this;

	}

	// The value in `colorSpace`: this colour, or a converted copy the caller frees.
	_in( colorSpace ) {

		if ( linearSpace( colorSpace ) ) return this;
		const copy = W.Color.prototype.clone.call( this );
		copy.convertLinearToSRGB();
		return copy;

	}

	getHex( colorSpace = SRGBColorSpace ) {

		if ( ! linearSpace( colorSpace ) ) return super.getHex();
		const byte = ( value ) => Math.round( Math.min( Math.max( value * 255, 0 ), 255 ) );
		return byte( this.r ) * 65536 + byte( this.g ) * 256 + byte( this.b );

	}

	getHexString( colorSpace = SRGBColorSpace ) {

		return ( '000000' + this.getHex( colorSpace ).toString( 16 ) ).slice( - 6 );

	}

	getStyle( colorSpace = SRGBColorSpace ) {

		if ( ! linearSpace( colorSpace ) ) return super.getStyle();
		return `color(${colorSpace} ${this.r.toFixed( 3 )} ${this.g.toFixed( 3 )} ${this.b.toFixed( 3 )})`;

	}

	getRGB( target, colorSpace = LinearSRGBColorSpace ) {

		const source = this._in( colorSpace );
		target.r = source.r;
		target.g = source.g;
		target.b = source.b;
		if ( source !== this ) source.free();
		return target;

	}

	getHSL( target = {}, colorSpace = LinearSRGBColorSpace ) {

		const source = this._in( colorSpace ), hsl = W.Color.prototype.getHSL.call( source );
		if ( source !== this ) source.free();
		target.h = hsl[ 0 ];
		target.s = hsl[ 1 ];
		target.l = hsl[ 2 ];
		return target;

	}

}

Color.prototype.fromArray = function ( array, offset = 0 ) {

	return this.setRGB( array[ offset ], array[ offset + 1 ], array[ offset + 2 ] );

};

// Min and max of a box as six numbers, without keeping engine values around.
export function boxNumbers( box ) {

	const min = box.min, max = box.max, out = [ min.x, min.y, min.z, max.x, max.y, max.z ];
	min.free();
	max.free();
	return out;

}

// Grows `bounds` (min xyz, max xyz) by the box `b` transformed by the column-major
// matrix at `m[ o ]`: the box around its eight transformed corners, as Box3.applyMatrix4 does.
export function expandByTransformedBox( bounds, b, m, o = 0 ) {

	if ( b[ 0 ] > b[ 3 ] || b[ 1 ] > b[ 4 ] || b[ 2 ] > b[ 5 ] ) return;

	for ( let corner = 0; corner < 8; corner ++ ) {

		const x = b[ corner & 1 ? 3 : 0 ], y = b[ corner & 2 ? 4 : 1 ], z = b[ corner & 4 ? 5 : 2 ];
		expandByPoint( bounds,
			m[ o ] * x + m[ o + 4 ] * y + m[ o + 8 ] * z + m[ o + 12 ],
			m[ o + 1 ] * x + m[ o + 5 ] * y + m[ o + 9 ] * z + m[ o + 13 ],
			m[ o + 2 ] * x + m[ o + 6 ] * y + m[ o + 10 ] * z + m[ o + 14 ] );

	}

}

// Sets `box` to six numbers, or empties it when they describe no box.
export function setBox( box, bounds ) {

	if ( bounds[ 0 ] > bounds[ 3 ] || bounds[ 1 ] > bounds[ 4 ] || bounds[ 2 ] > bounds[ 5 ] ) {

		box.makeEmpty();
		return box;

	}

	const min = new W.Vector3( bounds[ 0 ], bounds[ 1 ], bounds[ 2 ] ), max = new W.Vector3( bounds[ 3 ], bounds[ 4 ], bounds[ 5 ] );
	W.Box3.prototype.set.call( box, min, max );
	min.free();
	max.free();
	return box;

}

function expandByPoint( bounds, x, y, z ) {

	if ( x < bounds[ 0 ] ) bounds[ 0 ] = x;
	if ( y < bounds[ 1 ] ) bounds[ 1 ] = y;
	if ( z < bounds[ 2 ] ) bounds[ 2 ] = z;
	if ( x > bounds[ 3 ] ) bounds[ 3 ] = x;
	if ( y > bounds[ 4 ] ) bounds[ 4 ] = y;
	if ( z > bounds[ 5 ] ) bounds[ 5 ] = z;

}

function expandBoundsByObject( bounds, object, precise ) {

	object.updateWorldMatrix( false, false );
	const geometry = object.geometry;

	if ( geometry !== undefined && geometry.isBufferGeometry ) {

		const m = object.matrixWorld.elements, position = geometry.attributes.position;

		if ( precise && position !== undefined && ! object.isInstancedMesh ) {

			for ( let i = 0; i < position.count; i ++ ) {

				const x = position.getX( i ), y = position.getY( i ), z = position.getZ( i );
				expandByPoint( bounds, m[ 0 ] * x + m[ 4 ] * y + m[ 8 ] * z + m[ 12 ], m[ 1 ] * x + m[ 5 ] * y + m[ 9 ] * z + m[ 13 ], m[ 2 ] * x + m[ 6 ] * y + m[ 10 ] * z + m[ 14 ] );

			}

		} else {

			let box;

			if ( object.isInstancedMesh ) {

				if ( object.boundingBox === null ) object.computeBoundingBox();
				box = object.boundingBox;

			} else {

				if ( geometry.boundingBox === null ) geometry.computeBoundingBox();
				box = geometry.boundingBox;

			}

			expandByTransformedBox( bounds, boxNumbers( box ), m );

		}

	}

	for ( const child of object.children ) expandBoundsByObject( bounds, child, precise );

}

export class Box3 extends W.Box3 {

	constructor( min, max ) {

		super();
		if ( min && max ) this.set( min, max );

	}

	/**
	 * The world-space box around `object` and its descendants: their geometries' boxes
	 * transformed by their world matrices, or every vertex with `precise`.
	 */
	setFromObject( object, precise = false ) {

		this.makeEmpty();
		return this.expandByObject( object, precise );

	}

	expandByObject( object, precise = false ) {

		const bounds = this.isEmpty() ? [ Infinity, Infinity, Infinity, - Infinity, - Infinity, - Infinity ] : boxNumbers( this );
		expandBoundsByObject( bounds, object, precise );
		return setBox( this, bounds );

	}

}

export class Sphere extends W.Sphere {

	constructor( center = new Vector3(), radius = - 1 ) {

		super( center, radius );

	}

}

export class Plane extends W.Plane {

	constructor( normal = new Vector3( 1, 0, 0 ), constant = 0 ) {

		super( normal, constant );

	}

}

export class Ray extends W.Ray {

	constructor( origin = new Vector3(), direction = new Vector3( 0, 0, - 1 ) ) {

		super( origin, direction );

	}

}

export class Frustum extends W.Frustum {

	setFromProjectionMatrix( m, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		super.setFromProjectionMatrix( m, coordinateSystem === WebGPUCoordinateSystem, reversedDepth );
		return this;

	}

}

/** A segment from `start` to `end`. `start` and `end` read as copies; change them with `set`. */
export class Line3 extends W.Line3 {

	constructor( start = new Vector3(), end = new Vector3() ) {

		super( start, end );

	}

}

// A temporary triangle for the static helpers, freed after use.
function withTriangle( a, b, c, use ) {

	const triangle = new Triangle( a, b, c );

	try {

		return use( triangle );

	} finally {

		triangle.free();

	}

}

/** `a`, `b` and `c` read as copies; change them with `set`. */
export class Triangle extends W.Triangle {

	constructor( a = new Vector3(), b = new Vector3(), c = new Vector3() ) {

		super( a, b, c );

	}

	setFromPointsAndIndices( points, i0, i1, i2 ) {

		return this.set( points[ i0 ], points[ i1 ], points[ i2 ] );

	}

	setFromAttributeAndIndices( attribute, i0, i1, i2 ) {

		const vertex = ( i ) => new Vector3( attribute.getX( i ), attribute.getY( i ), attribute.getZ( i ) );
		return this.set( vertex( i0 ), vertex( i1 ), vertex( i2 ) );

	}

	/** `v1`, `v2`, `v3` weighted by the barycentric coordinates of `point`; null for a degenerate triangle. */
	getInterpolation( point, v1, v2, v3, target ) {

		const weights = this.getBarycoord( point );
		if ( weights === null ) return null;
		const { x, y, z } = weights;
		weights.free();
		target.setScalar( 0 );
		target.addScaledVector( v1, x );
		target.addScaledVector( v2, y );
		target.addScaledVector( v3, z );
		return target;

	}

	static getNormal( a, b, c, target ) {

		return withTriangle( a, b, c, ( t ) => t.getNormal( target ) );

	}

	static getBarycoord( point, a, b, c, target ) {

		return withTriangle( a, b, c, ( t ) => t.getBarycoord( point, target ) );

	}

	static containsPoint( point, a, b, c ) {

		return withTriangle( a, b, c, ( t ) => t.containsPoint( point ) );

	}

	static getInterpolation( point, p1, p2, p3, v1, v2, v3, target ) {

		return withTriangle( p1, p2, p3, ( t ) => t.getInterpolation( point, v1, v2, v3, target ) );

	}

	static isFrontFacing( a, b, c, direction ) {

		return withTriangle( a, b, c, ( t ) => t.isFrontFacing( direction ) );

	}

}

/** Radius, polar angle `phi` from +Y and azimuth `theta` around Y. */
export class Spherical extends W.Spherical {

	constructor( radius = 1, phi = 0, theta = 0 ) {

		super( radius, phi, theta );

	}

}

/** Distance `radius` from the Y axis, angle `theta` around it, and height `y`. */
export class Cylindrical extends W.Cylindrical {

	constructor( radius = 1, theta = 0, y = 0 ) {

		super( radius, theta, y );

	}

}

for ( const [ Compat, Base, name ] of [
	[ Vector2, W.Vector2, 'Vector2' ], [ Vector3, W.Vector3, 'Vector3' ], [ Vector4, W.Vector4, 'Vector4' ], [ Quaternion, W.Quaternion, 'Quaternion' ],
	[ Euler, W.Euler, 'Euler' ], [ Matrix3, W.Matrix3, 'Matrix3' ], [ Matrix4, W.Matrix4, 'Matrix4' ], [ Color, W.Color, 'Color' ], [ Box3, W.Box3, 'Box3' ],
	[ Sphere, W.Sphere, 'Sphere' ], [ Plane, W.Plane, 'Plane' ], [ Ray, W.Ray, 'Ray' ], [ Frustum, W.Frustum, 'Frustum' ],
	[ Line3, W.Line3, 'Line3' ], [ Triangle, W.Triangle, 'Triangle' ], [ Spherical, W.Spherical, 'Spherical' ], [ Cylindrical, W.Cylindrical, 'Cylindrical' ]
] ) extend( Compat, Base, name );
