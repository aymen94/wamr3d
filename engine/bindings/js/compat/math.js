// Math classes: the values kept in JavaScript (`values.js` and `Color`), and the classes
// over engine values (planes, rays, frustums, segments, triangles, spherical and
// cylindrical coordinates) with chaining, `target` arguments and defaults.

import * as W from '../index.js';
import { LinearSRGBColorSpace, NoColorSpace, SRGBColorSpace, WebGLCoordinateSystem, WebGPUCoordinateSystem } from './constants.js';
import { ignored } from './engine.js';
import { Box3, Euler, Matrix3, Matrix4, Quaternion, Sphere, Vector2, Vector3, Vector4 } from './values.js';

export { Box3, Euler, Matrix3, Matrix4, Quaternion, Sphere, Vector2, Vector3, Vector4 };

// ---------------------------------------------------------------- the engine boundary

// An engine copy of a JavaScript value, for an engine method's argument. Copies are
// pushed to `temporaries`, which the caller frees after the call. Other arguments,
// engine objects included, pass unchanged.
export function toEngine( value, temporaries ) {

	if ( value === null || typeof value !== 'object' || value.__wbg_ptr !== undefined ) return value;
	let copy;

	if ( value.isVector3 ) copy = new W.Vector3( value.x, value.y, value.z );
	else if ( value.isMatrix4 ) ( copy = new W.Matrix4() ).fromArray( value.elements );
	else if ( value.isQuaternion ) copy = new W.Quaternion( value.x, value.y, value.z, value.w );
	else if ( value.isVector2 ) copy = new W.Vector2( value.x, value.y );
	else if ( value.isVector4 ) copy = new W.Vector4( value.x, value.y, value.z, value.w );
	else if ( value.isMatrix3 ) ( copy = new W.Matrix3() ).fromArray( value.elements );
	else if ( value.isEuler ) copy = new W.Euler( value.x, value.y, value.z, value.order );
	else if ( value.isBox3 ) ( copy = new W.Box3() ).set( toEngine( value.min, temporaries ), toEngine( value.max, temporaries ) );
	else if ( value.isSphere ) copy = new W.Sphere( toEngine( value.center, temporaries ), value.radius );
	else return value;

	temporaries.push( copy );
	return copy;

}

function free( temporaries ) {

	for ( const value of temporaries ) value.free();

}

// One reused engine vector per slot, for engine calls that read a vector and keep nothing.
const scratch = [];

export function engineVector( v, slot = 0 ) {

	const vector = scratch[ slot ] ??= new W.Vector3( 0, 0, 0 );
	vector.set( v.x, v.y, v.z );
	return vector;

}

const compatByBase = new Map();
const NULLABLE = new Set( [ 'intersectSphere', 'distanceToPlane', 'intersectPlane', 'intersectBox', 'intersectTriangle', 'getBarycoord' ] );

// A value returned by the engine as a class of this module: JavaScript values are copied
// out and the engine value freed; other engine values take the module's class.
function adopt( value ) {

	if ( value === null || typeof value !== 'object' ) return value;

	if ( value instanceof W.Vector3 ) return release( value, new Vector3( value.x, value.y, value.z ) );
	if ( value instanceof W.Matrix4 ) return release( value, new Matrix4().fromArray( value.toArray() ) );
	if ( value instanceof W.Quaternion ) return release( value, new Quaternion( value.x, value.y, value.z, value.w ) );
	if ( value instanceof W.Vector2 ) return release( value, new Vector2( value.x, value.y ) );
	if ( value instanceof W.Vector4 ) return release( value, new Vector4( value.x, value.y, value.z, value.w ) );
	if ( value instanceof W.Matrix3 ) return release( value, new Matrix3().fromArray( value.toArray() ) );
	if ( value instanceof W.Euler ) return release( value, new Euler( value.x, value.y, value.z, value.order ) );
	if ( value instanceof W.Box3 ) return release( value, new Box3( adopt( value.min ), adopt( value.max ) ) );
	if ( value instanceof W.Sphere ) return release( value, new Sphere( adopt( value.center ), value.radius ) );

	const prototype = compatByBase.get( Object.getPrototypeOf( value ) );
	if ( prototype ) Object.setPrototypeOf( value, prototype );
	return value;

}

function release( engineValue, value ) {

	engineValue.free();
	return value;

}

// Gives a class the calling conventions of its engine base class plus: methods return
// `this` for chaining, a trailing `target` argument receives the result, methods that
// can fail return null, and JavaScript values are accepted wherever the engine takes its
// own.
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

				const value = args[ i ];
				if ( value !== null && typeof value === 'object' && value.__wbg_ptr === undefined && ! ArrayBuffer.isView( value ) ) args[ i ] = toEngine( value, temporaries ??= [] );

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

			if ( temporaries ) free( temporaries );

			if ( result === undefined ) return NULLABLE.has( key ) ? null : this;

			if ( target !== null && target !== undefined && typeof result === 'object' ) {

				if ( ArrayBuffer.isView( result ) ) {

					for ( let i = 0; i < result.length; i ++ ) target[ offset + i ] = result[ i ];
					return target;

				}

				if ( typeof target.copy === 'function' ) {

					const value = adopt( result );
					target.copy( value );
					value.free?.();
					return target;

				}

			}

			return adopt( result );

		};

	}

}

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

const srgbToLinear = ( c ) => ( c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 ) );
const linearToSRGB = ( c ) => ( c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow( c, 0.41666 ) - 0.055 );

function hueToRGB( p, q, t ) {

	if ( t < 0 ) t += 1;
	if ( t > 1 ) t -= 1;
	if ( t < 1 / 6 ) return p + ( q - p ) * 6 * t;
	if ( t < 1 / 2 ) return q;
	if ( t < 2 / 3 ) return p + ( q - p ) * 6 * ( 2 / 3 - t );
	return p;

}

// CSS colours (names, `#rgb`, `rgb()`, `hsl()`) are parsed by the engine; it gives the
// linear components.
let parser = null;

/** Components in the linear working colour space; `r`, `g` and `b` are plain numbers. */
export class Color {

	/** `new Color()`, `new Color(0xff8800)`, `new Color('orange')` or `new Color(r, g, b)`. */
	constructor( r, g, b ) {

		this.r = 1;
		this.g = 1;
		this.b = 1;
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

	setScalar( s ) {

		this.r = s;
		this.g = s;
		this.b = s;
		return this;

	}

	/** Components in `colorSpace` (default: the linear working space). */
	setRGB( r, g, b, colorSpace = LinearSRGBColorSpace ) {

		this.r = r;
		this.g = g;
		this.b = b;
		if ( ! linearSpace( colorSpace ) ) this.convertSRGBToLinear();
		return this;

	}

	/** A hex number in `colorSpace` (default: sRGB). */
	setHex( hex, colorSpace = SRGBColorSpace ) {

		hex = Math.floor( hex );
		return this.setRGB( ( hex >> 16 & 255 ) / 255, ( hex >> 8 & 255 ) / 255, ( hex & 255 ) / 255, colorSpace );

	}

	/** Hue, saturation and lightness in `colorSpace` (default: the linear working space). */
	setHSL( h, s, l, colorSpace = LinearSRGBColorSpace ) {

		h = ( ( h % 1 ) + 1 ) % 1;
		s = Math.min( Math.max( s, 0 ), 1 );
		l = Math.min( Math.max( l, 0 ), 1 );

		if ( s === 0 ) {

			this.r = this.g = this.b = l;

		} else {

			const p = l <= 0.5 ? l * ( 1 + s ) : l + s - l * s, q = 2 * l - p;
			this.r = hueToRGB( q, p, h + 1 / 3 );
			this.g = hueToRGB( q, p, h );
			this.b = hueToRGB( q, p, h - 1 / 3 );

		}

		if ( ! linearSpace( colorSpace ) ) this.convertSRGBToLinear();
		return this;

	}

	/** A CSS colour whose numbers are in `colorSpace` (default: sRGB). */
	setStyle( style, colorSpace = SRGBColorSpace ) {

		parser ??= new W.Color( 1, 1, 1 );
		parser.setRGB( this.r, this.g, this.b );
		parser.setStyle( style );
		if ( linearSpace( colorSpace ) ) parser.convertLinearToSRGB();
		this.r = parser.r;
		this.g = parser.g;
		this.b = parser.b;
		return this;

	}

	setColorName( style, colorSpace = SRGBColorSpace ) {

		return this.setStyle( style, colorSpace );

	}

	clone() {

		return new this.constructor( this.r, this.g, this.b );

	}

	copy( color ) {

		this.r = color.r;
		this.g = color.g;
		this.b = color.b;
		return this;

	}

	copySRGBToLinear( color ) {

		this.r = srgbToLinear( color.r );
		this.g = srgbToLinear( color.g );
		this.b = srgbToLinear( color.b );
		return this;

	}

	copyLinearToSRGB( color ) {

		this.r = linearToSRGB( color.r );
		this.g = linearToSRGB( color.g );
		this.b = linearToSRGB( color.b );
		return this;

	}

	convertSRGBToLinear() {

		return this.copySRGBToLinear( this );

	}

	convertLinearToSRGB() {

		return this.copyLinearToSRGB( this );

	}

	// The components in `colorSpace`, in `scratchColor`.
	_in( colorSpace ) {

		scratchColor.copy( this );
		if ( ! linearSpace( colorSpace ) ) scratchColor.convertLinearToSRGB();
		return scratchColor;

	}

	getHex( colorSpace = SRGBColorSpace ) {

		const c = this._in( colorSpace ), byte = ( value ) => Math.round( Math.min( Math.max( value * 255, 0 ), 255 ) );
		return byte( c.r ) * 65536 + byte( c.g ) * 256 + byte( c.b );

	}

	getHexString( colorSpace = SRGBColorSpace ) {

		return ( '000000' + this.getHex( colorSpace ).toString( 16 ) ).slice( - 6 );

	}

	getHSL( target = {}, colorSpace = LinearSRGBColorSpace ) {

		const c = this._in( colorSpace ), r = c.r, g = c.g, b = c.b;
		const max = Math.max( r, g, b ), min = Math.min( r, g, b ), lightness = ( min + max ) / 2;
		let hue = 0, saturation = 0;

		if ( min !== max ) {

			const delta = max - min;
			saturation = lightness <= 0.5 ? delta / ( max + min ) : delta / ( 2 - max - min );
			if ( max === r ) hue = ( g - b ) / delta + ( g < b ? 6 : 0 );
			else if ( max === g ) hue = ( b - r ) / delta + 2;
			else hue = ( r - g ) / delta + 4;
			hue /= 6;

		}

		target.h = hue;
		target.s = saturation;
		target.l = lightness;
		return target;

	}

	getRGB( target, colorSpace = LinearSRGBColorSpace ) {

		const c = this._in( colorSpace );
		target.r = c.r;
		target.g = c.g;
		target.b = c.b;
		return target;

	}

	getStyle( colorSpace = SRGBColorSpace ) {

		const c = this._in( colorSpace );
		if ( colorSpace !== SRGBColorSpace ) return `color(${colorSpace} ${c.r.toFixed( 3 )} ${c.g.toFixed( 3 )} ${c.b.toFixed( 3 )})`;
		return `rgb(${Math.round( c.r * 255 )},${Math.round( c.g * 255 )},${Math.round( c.b * 255 )})`;

	}

	offsetHSL( h, s, l ) {

		const hsl = this.getHSL( hslA );
		return this.setHSL( hsl.h + h, hsl.s + s, hsl.l + l );

	}

	add( color ) {

		this.r += color.r;
		this.g += color.g;
		this.b += color.b;
		return this;

	}

	addColors( color1, color2 ) {

		this.r = color1.r + color2.r;
		this.g = color1.g + color2.g;
		this.b = color1.b + color2.b;
		return this;

	}

	addScalar( s ) {

		this.r += s;
		this.g += s;
		this.b += s;
		return this;

	}

	sub( color ) {

		this.r = Math.max( 0, this.r - color.r );
		this.g = Math.max( 0, this.g - color.g );
		this.b = Math.max( 0, this.b - color.b );
		return this;

	}

	multiply( color ) {

		this.r *= color.r;
		this.g *= color.g;
		this.b *= color.b;
		return this;

	}

	multiplyScalar( s ) {

		this.r *= s;
		this.g *= s;
		this.b *= s;
		return this;

	}

	lerp( color, alpha ) {

		this.r += ( color.r - this.r ) * alpha;
		this.g += ( color.g - this.g ) * alpha;
		this.b += ( color.b - this.b ) * alpha;
		return this;

	}

	lerpColors( color1, color2, alpha ) {

		this.r = color1.r + ( color2.r - color1.r ) * alpha;
		this.g = color1.g + ( color2.g - color1.g ) * alpha;
		this.b = color1.b + ( color2.b - color1.b ) * alpha;
		return this;

	}

	lerpHSL( color, alpha ) {

		const a = this.getHSL( hslA ), b = color.getHSL( hslB );
		return this.setHSL( a.h + ( b.h - a.h ) * alpha, a.s + ( b.s - a.s ) * alpha, a.l + ( b.l - a.l ) * alpha );

	}

	setFromVector3( v ) {

		this.r = v.x;
		this.g = v.y;
		this.b = v.z;
		return this;

	}

	applyMatrix3( m ) {

		const r = this.r, g = this.g, b = this.b, e = m.elements;
		this.r = e[ 0 ] * r + e[ 3 ] * g + e[ 6 ] * b;
		this.g = e[ 1 ] * r + e[ 4 ] * g + e[ 7 ] * b;
		this.b = e[ 2 ] * r + e[ 5 ] * g + e[ 8 ] * b;
		return this;

	}

	equals( c ) {

		return c.r === this.r && c.g === this.g && c.b === this.b;

	}

	fromArray( array, offset = 0 ) {

		this.r = array[ offset ];
		this.g = array[ offset + 1 ];
		this.b = array[ offset + 2 ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.r;
		array[ offset + 1 ] = this.g;
		array[ offset + 2 ] = this.b;
		return array;

	}

	fromBufferAttribute( attribute, index ) {

		this.r = attribute.getX( index );
		this.g = attribute.getY( index );
		this.b = attribute.getZ( index );
		return this;

	}

	toJSON() {

		return this.getHex();

	}

	* [ Symbol.iterator ]() {

		yield this.r;
		yield this.g;
		yield this.b;

	}

}

Color.prototype.isColor = true;
const scratchColor = new Color(), hslA = { h: 0, s: 0, l: 0 }, hslB = { h: 0, s: 0, l: 0 };


// Min and max of a box as six numbers.
export function boxNumbers( box ) {

	const min = box.min, max = box.max;
	return [ min.x, min.y, min.z, max.x, max.y, max.z ];

}

// Grows `bounds` (min xyz, max xyz) by the box `b` transformed by the column-major
// matrix at `m[ o ]`: the box around its eight transformed corners, as Box3.applyMatrix4 does.
export function expandByTransformedBox( bounds, b, m, o = 0 ) {

	if ( b[ 0 ] > b[ 3 ] || b[ 1 ] > b[ 4 ] || b[ 2 ] > b[ 5 ] ) return;

	for ( let corner = 0; corner < 8; corner ++ ) {

		const x = b[ corner & 1 ? 3 : 0 ], y = b[ corner & 2 ? 4 : 1 ], z = b[ corner & 4 ? 5 : 2 ];
		const px = m[ o ] * x + m[ o + 4 ] * y + m[ o + 8 ] * z + m[ o + 12 ];
		const py = m[ o + 1 ] * x + m[ o + 5 ] * y + m[ o + 9 ] * z + m[ o + 13 ];
		const pz = m[ o + 2 ] * x + m[ o + 6 ] * y + m[ o + 10 ] * z + m[ o + 14 ];
		if ( px < bounds[ 0 ] ) bounds[ 0 ] = px;
		if ( py < bounds[ 1 ] ) bounds[ 1 ] = py;
		if ( pz < bounds[ 2 ] ) bounds[ 2 ] = pz;
		if ( px > bounds[ 3 ] ) bounds[ 3 ] = px;
		if ( py > bounds[ 4 ] ) bounds[ 4 ] = py;
		if ( pz > bounds[ 5 ] ) bounds[ 5 ] = pz;

	}

}

// Sets `box` to six numbers, or empties it when they describe no box.
export function setBox( box, bounds ) {

	if ( bounds[ 0 ] > bounds[ 3 ] || bounds[ 1 ] > bounds[ 4 ] || bounds[ 2 ] > bounds[ 5 ] ) return box.makeEmpty();
	box.min.set( bounds[ 0 ], bounds[ 1 ], bounds[ 2 ] );
	box.max.set( bounds[ 3 ], bounds[ 4 ], bounds[ 5 ] );
	return box;

}

// Constructs an engine class from JavaScript values.
function construct( Base, self, args ) {

	const temporaries = [];
	const value = Reflect.construct( Base, args.map( ( a ) => toEngine( a, temporaries ) ), self );
	free( temporaries );
	return value;

}

export class Plane extends W.Plane {

	constructor( normal = new Vector3( 1, 0, 0 ), constant = 0 ) {

		return construct( W.Plane, new.target, [ normal, constant ] );

	}

}

export class Ray extends W.Ray {

	constructor( origin = new Vector3(), direction = new Vector3( 0, 0, - 1 ) ) {

		return construct( W.Ray, new.target, [ origin, direction ] );

	}

}

export class Frustum extends W.Frustum {

	setFromProjectionMatrix( m, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		const temporaries = [];
		super.setFromProjectionMatrix( toEngine( m, temporaries ), coordinateSystem === WebGPUCoordinateSystem, reversedDepth );
		free( temporaries );
		return this;

	}

}

/** A segment from `start` to `end`. `start` and `end` read as copies; change them with `set`. */
export class Line3 extends W.Line3 {

	constructor( start = new Vector3(), end = new Vector3() ) {

		return construct( W.Line3, new.target, [ start, end ] );

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

		return construct( W.Triangle, new.target, [ a, b, c ] );

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
		target.setScalar( 0 );
		target.addScaledVector( v1, weights.x );
		target.addScaledVector( v2, weights.y );
		target.addScaledVector( v3, weights.z );
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
	[ Plane, W.Plane, 'Plane' ], [ Ray, W.Ray, 'Ray' ], [ Frustum, W.Frustum, 'Frustum' ],
	[ Line3, W.Line3, 'Line3' ], [ Triangle, W.Triangle, 'Triangle' ], [ Spherical, W.Spherical, 'Spherical' ], [ Cylindrical, W.Cylindrical, 'Cylindrical' ]
] ) extend( Compat, Base, name );
