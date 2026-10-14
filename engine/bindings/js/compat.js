// WAMR3D object API.
//
//   import * as WAMR3D from 'wamr3d/compat';
//   await WAMR3D.init();
//   const scene = new WAMR3D.Scene();
//   const mesh = new WAMR3D.Mesh( new WAMR3D.BoxGeometry(), new WAMR3D.MeshLambertMaterial( { color: 0x4f8cff } ) );
//   scene.add( mesh );
//   mesh.rotation.y = 0.5;
//
// Classes, properties and chaining over the engine. All state lives in one World inside
// the WebAssembly module; the objects here are thin handles onto it.

import * as W from './index.js';
import { createBackend } from './webgpu.js';

export const FrontSide = 0, BackSide = 1, DoubleSide = 2;
export const BasicShadowMap = 0, PCFShadowMap = 1, PCFSoftShadowMap = 2, VSMShadowMap = 3;
export const NoToneMapping = 0, LinearToneMapping = 1, ReinhardToneMapping = 2, CineonToneMapping = 3, ACESFilmicToneMapping = 4, CustomToneMapping = 5, AgXToneMapping = 6, NeutralToneMapping = 7;
export const WebGLCoordinateSystem = 2000, WebGPUCoordinateSystem = 2001;
export const MathUtils = W.MathUtils;
export const Timer = W.Timer;

let world = null;

/** Loads the WebAssembly module and creates the world. Call once, before anything else. */
export async function init( source ) {

	await W.init( source );
	world ??= new W.World();

}

// Transform writes are kept on the JavaScript side and sent in one call the next time
// the engine is used, so every engine access goes through here.
function w() {

	if ( world === null ) throw new Error( 'WAMR3D: call init() first' );
	if ( dirty.length !== 0 ) flush();
	if ( touched.length !== 0 ) pushMatrices();
	return world;

}

/** The World behind every object created here, for the batched low-level calls. */
export function getWorld() {

	return w();

}

// ---------------------------------------------------------------- math

const compatByBase = new Map();
const NULLABLE = new Set( [ 'intersectSphere', 'distanceToPlane', 'intersectPlane', 'intersectBox', 'intersectTriangle' ] );

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

		Compat.prototype[ key ] = function ( ...args ) {

			const target = args.length > arity ? args[ arity ] : null, offset = args[ arity + 1 ] || 0;
			if ( args.length > arity ) args.length = arity;
			let temporaries = null;

			for ( let i = 0; i < args.length; i ++ ) {

				if ( args[ i ] !== null && typeof args[ i ] === 'object' && args[ i ]._o !== undefined && args[ i ]._p !== undefined ) ( temporaries ??= [] ).push( args[ i ] = args[ i ].clone() );

			}

			const result = method.apply( this, args );
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

		const source = q instanceof Bound ? q.clone() : q;
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

	getHSL( target = {} ) {

		const hsl = super.getHSL();
		target.h = hsl[ 0 ];
		target.s = hsl[ 1 ];
		target.l = hsl[ 2 ];
		return target;

	}

}

Color.prototype.fromArray = function ( array, offset = 0 ) {

	return this.setRGB( array[ offset ], array[ offset + 1 ], array[ offset + 2 ] );

};

export class Box3 extends W.Box3 {

	constructor( min, max ) {

		super();
		if ( min && max ) this.set( min, max );

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

for ( const [ Compat, Base, name ] of [
	[ Vector2, W.Vector2, 'Vector2' ], [ Vector3, W.Vector3, 'Vector3' ], [ Vector4, W.Vector4, 'Vector4' ], [ Quaternion, W.Quaternion, 'Quaternion' ],
	[ Euler, W.Euler, 'Euler' ], [ Matrix3, W.Matrix3, 'Matrix3' ], [ Matrix4, W.Matrix4, 'Matrix4' ], [ Color, W.Color, 'Color' ], [ Box3, W.Box3, 'Box3' ],
	[ Sphere, W.Sphere, 'Sphere' ], [ Plane, W.Plane, 'Plane' ], [ Ray, W.Ray, 'Ray' ], [ Frustum, W.Frustum, 'Frustum' ]
] ) extend( Compat, Base, name );

// ---------------------------------------------------------------- transform properties

// `object.position` and friends. The numbers are kept here, next to the object, so that
// reading and writing them does not call into WebAssembly. Written parts are sent to
// the engine in one batch (see `w()`); parts the engine changed are read back on demand.
//
// Per object: `_t` holds position (0), Euler angles (3), quaternion (6), scale (10),
// up (13) and the Euler order index (16). `_dirty` has a bit per part written here and
// not yet sent; `_stale` a bit per part whose numbers in `_t` are out of date.

const POSITION = 1, ROTATION = 2, QUATERNION = 4, SCALE = 8, UP = 16, ALL_PARTS = 31;
const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];
const VALUES = 17;

const dirty = [], touched = [];
let flushCapacity = 0, flushHandles = null, flushMasks = null, flushValues = null;

function flush() {

	const count = dirty.length;

	if ( count > flushCapacity ) {

		flushCapacity = Math.max( 64, count * 2 );
		flushHandles = new BigUint64Array( flushCapacity );
		flushMasks = new Uint8Array( flushCapacity );
		flushValues = new Float32Array( flushCapacity * VALUES );

	}

	for ( let i = 0, o = 0; i < count; i ++ ) {

		const object = dirty[ i ], t = object._t, mask = object._dirty;
		flushHandles[ i ] = object.handle;
		flushMasks[ i ] = mask;
		for ( let k = 0; k < VALUES; k ++ ) flushValues[ o ++ ] = t[ k ];

		// the engine derives each of these from the other
		if ( mask & ROTATION ) object._stale |= QUATERNION;
		if ( mask & QUATERNION ) object._stale |= ROTATION;
		object._dirty = 0;

	}

	dirty.length = 0;
	world.applyTransforms( flushHandles.subarray( 0, count ), flushMasks.subarray( 0, count ), flushValues.subarray( 0, count * VALUES ) );

}

// Local matrices of objects with `matrixAutoUpdate = false` that were handed out since
// the last engine access, and so may have been changed.
function pushMatrices() {

	for ( const object of touched ) {

		object._matrixTouched = false;
		if ( ! object._matrixAutoUpdate ) world.setMatrix( object.handle, object._matrix.toArray() );

	}

	touched.length = 0;

}

function refresh( object ) {

	if ( dirty.length !== 0 ) flush();
	const values = world.transformValues( object.handle ), t = object._t;
	for ( let k = 0; k < VALUES; k ++ ) t[ k ] = values[ k ];
	object._stale = 0;

}

// Before reading a part, or writing one number of it: what was written to the part it
// depends on must reach the engine first, and stale numbers must be read back.
function ready( object, part, other ) {

	if ( ( object._dirty & other ) !== 0 ) flush();
	if ( ( object._stale & part ) !== 0 ) refresh( object );

}

function mark( object, part ) {

	if ( object._dirty === 0 ) dirty.push( object );
	object._dirty |= part;

}

class Bound {

	constructor( owner, slot, part, other = 0 ) {

		this._o = owner;
		this._s = slot;
		this._p = part;
		this._q = other;

	}

	// Replaces the whole part, so nothing has to be read back first.
	_write( count, a, b, c, d ) {

		const object = this._o, t = object._t, s = this._s;
		if ( ( object._dirty & this._q ) !== 0 ) flush();
		t[ s ] = a;
		t[ s + 1 ] = b;
		t[ s + 2 ] = c;
		if ( count === 4 ) t[ s + 3 ] = d;
		object._stale &= ~ this._p;
		mark( object, this._p );
		return this;

	}

}

function components( Class, names ) {

	names.forEach( ( name, i ) => Object.defineProperty( Class.prototype, name, {
		get() {

			const object = this._o;
			if ( ( object._dirty & this._q ) !== 0 || ( object._stale & this._p ) !== 0 ) ready( object, this._p, this._q );
			return object._t[ this._s + i ];

		},
		set( value ) {

			const object = this._o;
			if ( ( object._dirty & this._q ) !== 0 || ( object._stale & this._p ) !== 0 ) ready( object, this._p, this._q );
			object._t[ this._s + i ] = value;
			mark( object, this._p );

		}
	} ) );

}

function delegate( Class, Value ) {

	for ( const key of Object.getOwnPropertyNames( Value.prototype ) ) {

		if ( key === 'constructor' || key in Class.prototype || typeof Object.getOwnPropertyDescriptor( Value.prototype, key ).value !== 'function' ) continue;

		Class.prototype[ key ] = function ( ...args ) {

			const value = this.clone(), result = value[ key ]( ...args );
			if ( result !== value ) return result;
			this.copy( value );
			value.free();
			return this;

		};

	}

}

class BoundVector3 extends Bound {

	set( x, y, z ) {

		return this._write( 3, x, y, z );

	}

	setScalar( value ) {

		return this._write( 3, value, value, value );

	}

	copy( v ) {

		return this._write( 3, v.x, v.y, v.z );

	}

	clone() {

		return new Vector3( this.x, this.y, this.z );

	}

}

class BoundEuler extends Bound {

	get order() {

		const object = this._o;
		ready( object, ROTATION, QUATERNION );
		return ORDERS[ object._t[ 16 ] ];

	}

	set order( value ) {

		const object = this._o, index = ORDERS.indexOf( value );
		if ( index === - 1 ) throw new Error( `WAMR3D: unknown Euler order: ${value}` );
		ready( object, ROTATION, QUATERNION );
		object._t[ 16 ] = index;
		mark( object, ROTATION );

	}

	set( x, y, z, order ) {

		if ( order !== undefined ) {

			const index = ORDERS.indexOf( order );
			if ( index === - 1 ) throw new Error( `WAMR3D: unknown Euler order: ${order}` );
			this._o._t[ 16 ] = index;

		}

		return this._write( 3, x, y, z );

	}

	copy( e ) {

		return this.set( e.x, e.y, e.z, e.order );

	}

	clone() {

		return new Euler( this.x, this.y, this.z, this.order );

	}

}

class BoundQuaternion extends Bound {

	set( x, y, z, w_ ) {

		return this._write( 4, x, y, z, w_ );

	}

	copy( q ) {

		return this._write( 4, q.x, q.y, q.z, q.w );

	}

	clone() {

		return new Quaternion( this.x, this.y, this.z, this.w );

	}

}

components( BoundVector3, [ 'x', 'y', 'z' ] );
components( BoundEuler, [ 'x', 'y', 'z' ] );
components( BoundQuaternion, [ 'x', 'y', 'z', 'w' ] );
delegate( BoundVector3, Vector3 );
delegate( BoundEuler, Euler );
delegate( BoundQuaternion, Quaternion );
BoundVector3.prototype.isVector3 = BoundEuler.prototype.isEuler = BoundQuaternion.prototype.isQuaternion = true;

class BoundLayers {

	constructor( owner ) {

		this._o = owner;
		this._m = undefined;

	}

	// The mask is kept here after the first read, so tests and toggles cost no engine call.
	get mask() {

		return this._m ??= w().layers( this._o.handle );

	}

	set mask( value ) {

		w().setLayers( this._o.handle, this._m = value >>> 0 );

	}

	set( layer ) {

		this.mask = 1 << layer;

	}

	enable( layer ) {

		this.mask |= 1 << layer;

	}

	enableAll() {

		this.mask = 0xffffffff;

	}

	toggle( layer ) {

		this.mask ^= 1 << layer;

	}

	disable( layer ) {

		this.mask &= ~ ( 1 << layer );

	}

	disableAll() {

		this.mask = 0;

	}

	test( layers ) {

		return ( this.mask & layers.mask ) !== 0;

	}

	isEnabled( layer ) {

		return ( this.mask & ( 1 << layer ) ) !== 0;

	}

}

// ---------------------------------------------------------------- objects

const OBJECT = 0, GEOMETRY = 1, MATERIAL = 2;
const objects = new Map();

// Engine resources are released when the JavaScript object that owns them is collected.
const finalizer = new FinalizationRegistry( ( { kind, handle, instances } ) => {

	if ( world === null ) return;

	if ( kind === OBJECT ) {

		if ( instances ) instanceSources.delete( instances );
		objects.delete( handle );
		world.destroy( handle );

	} else if ( kind === GEOMETRY ) {

		world.disposeGeometry( handle );

	} else {

		world.disposeMaterial( handle );

	}

} );

const AXES = {};

function axis( name ) {

	return AXES[ name ] ??= new Vector3( name === 'x' ? 1 : 0, name === 'y' ? 1 : 0, name === 'z' ? 1 : 0 );

}

function vector( v ) {

	return v instanceof W.Vector3 ? v : new Vector3( v.x, v.y, v.z );

}

let nextId = 1;

export class Object3D {

	constructor() {

		const handle = w().createObject();
		this.handle = handle;
		this._t = [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0 ];
		this._dirty = 0;
		this._stale = 0;
		this._matrixAutoUpdate = true;
		this._matrix = null;
		this._matrixWorld = null;
		this._matrixTouched = false;
		this.matrixWorldNeedsUpdate = false;
		this.id = nextId ++;
		this.type = 'Object3D';
		this.parent = null;
		this.children = [];
		this.userData = {};
		this.matrixWorldAutoUpdate = true;
		this.position = new BoundVector3( this, 0, POSITION );
		this.rotation = new BoundEuler( this, 3, ROTATION, QUATERNION );
		this.quaternion = new BoundQuaternion( this, 6, QUATERNION, ROTATION );
		this.scale = new BoundVector3( this, 10, SCALE );
		this.up = new BoundVector3( this, 13, UP );
		this.layers = new BoundLayers( this );
		this._name = '';
		this._visible = true;
		this._renderOrder = 0;
		this._frustumCulled = true;
		this._castShadow = false;
		this._receiveShadow = false;
		objects.set( handle, new WeakRef( this ) );
		finalizer.register( this, this._token = { kind: OBJECT, handle, instances: 0 }, this );

	}

	get name() {

		return this._name;

	}

	set name( value ) {

		w().setName( this.handle, this._name = String( value ) );

	}

	get visible() {

		return this._visible;

	}

	set visible( value ) {

		w().setVisible( this.handle, this._visible = !! value );

	}

	get matrixAutoUpdate() {

		return this._matrixAutoUpdate;

	}

	/**
	 * With `false` the local matrix is yours: change it through `object.matrix` and its
	 * methods. Position, rotation and scale are then only applied by `updateMatrix()`.
	 */
	set matrixAutoUpdate( value ) {

		value = !! value;
		if ( value === this._matrixAutoUpdate ) return;
		if ( ! value ) ( this._matrix ??= new Matrix4() ).fromArray( w().matrix( this.handle ) );
		w().setMatrixAutoUpdate( this.handle, value );
		this._matrixAutoUpdate = value;

	}

	get renderOrder() {

		return this._renderOrder;

	}

	set renderOrder( value ) {

		w().setRenderOrder( this.handle, this._renderOrder = value );

	}

	get castShadow() {

		return this._castShadow;

	}

	set castShadow( value ) {

		w().setShadowFlags( this.handle, this._castShadow = !! value, this._receiveShadow );

	}

	get receiveShadow() {

		return this._receiveShadow;

	}

	set receiveShadow( value ) {

		w().setShadowFlags( this.handle, this._castShadow, this._receiveShadow = !! value );

	}

	get frustumCulled() {

		return this._frustumCulled;

	}

	set frustumCulled( value ) {

		w().setFrustumCulled( this.handle, this._frustumCulled = !! value );

	}

	/**
	 * The local matrix. While `matrixAutoUpdate` is true it is a copy, refreshed on every
	 * access; with `matrixAutoUpdate = false` it is the matrix the object uses.
	 */
	get matrix() {

		const matrix = this._matrix ??= new Matrix4();

		if ( this._matrixAutoUpdate ) {

			matrix.fromArray( w().matrix( this.handle ) );

		} else if ( ! this._matrixTouched ) {

			this._matrixTouched = true;
			touched.push( this );

		}

		return matrix;

	}

	set matrix( value ) {

		this.matrix.copy( value );

	}

	/** The world matrix: one `Matrix4` per object, refreshed from the engine on each access. */
	get matrixWorld() {

		return ( this._matrixWorld ??= new Matrix4() ).fromArray( w().matrixWorld( this.handle ) );

	}

	add( ...children ) {

		for ( const child of children ) {

			if ( child === this || ! w().add( this.handle, child.handle ) ) continue;
			child._detach();
			child.parent = this;
			this.children.push( child );

		}

		return this;

	}

	remove( ...children ) {

		for ( const child of children ) {

			if ( child.parent !== this ) continue;
			w().remove( this.handle, child.handle );
			child._detach();

		}

		return this;

	}

	removeFromParent() {

		if ( this.parent !== null ) this.parent.remove( this );
		return this;

	}

	clear() {

		return this.remove( ...this.children );

	}

	/** Adds `child` while keeping its world transform. */
	attach( child ) {

		if ( w().attach( this.handle, child.handle ) ) {

			child._stale = ALL_PARTS;
			child._detach();
			child.parent = this;
			this.children.push( child );

		}

		return this;

	}

	_detach() {

		if ( this.parent === null ) return;
		const siblings = this.parent.children, index = siblings.indexOf( this );
		if ( index !== - 1 ) siblings.splice( index, 1 );
		this.parent = null;

	}

	lookAt( x, y, z ) {

		if ( typeof x === 'object' ) w().lookAt( this.handle, x.x, x.y, x.z );
		else w().lookAt( this.handle, x, y, z );
		this._stale = ALL_PARTS;

	}

	rotateOnAxis( axis_, angle ) {

		w().rotateOnAxis( this.handle, vector( axis_ ), angle );
		this._stale = ALL_PARTS;
		return this;

	}

	rotateX( angle ) {

		return this.rotateOnAxis( axis( 'x' ), angle );

	}

	rotateY( angle ) {

		return this.rotateOnAxis( axis( 'y' ), angle );

	}

	rotateZ( angle ) {

		return this.rotateOnAxis( axis( 'z' ), angle );

	}

	translateOnAxis( axis_, distance ) {

		w().translateOnAxis( this.handle, vector( axis_ ), distance );
		this._stale = ALL_PARTS;
		return this;

	}

	translateX( distance ) {

		return this.translateOnAxis( axis( 'x' ), distance );

	}

	translateY( distance ) {

		return this.translateOnAxis( axis( 'y' ), distance );

	}

	translateZ( distance ) {

		return this.translateOnAxis( axis( 'z' ), distance );

	}

	updateMatrix() {

		w().updateMatrix( this.handle );
		if ( ! this._matrixAutoUpdate ) this._matrix.fromArray( world.matrix( this.handle ) );

	}

	updateMatrixWorld( force = false ) {

		w().updateMatrixWorld( this.handle, force );

	}

	updateWorldMatrix( updateParents ) {

		if ( updateParents && this.parent !== null ) this.parent.updateWorldMatrix( true );
		w().updateMatrixWorld( this.handle, false );

	}

	getWorldPosition( target = new Vector3() ) {

		return target.fromArray( w().getWorldPosition( this.handle ) );

	}

	getWorldQuaternion( target = new Quaternion() ) {

		return target.fromArray( w().getWorldQuaternion( this.handle ) );

	}

	getWorldScale( target = new Vector3() ) {

		return target.fromArray( w().getWorldScale( this.handle ) );

	}

	getWorldDirection( target = new Vector3() ) {

		return target.fromArray( w().getWorldDirection( this.handle ) );

	}

	localToWorld( v ) {

		return v.fromArray( w().localToWorld( this.handle, v.x, v.y, v.z ) );

	}

	worldToLocal( v ) {

		return v.fromArray( w().worldToLocal( this.handle, v.x, v.y, v.z ) );

	}

	traverse( callback ) {

		callback( this );
		for ( const child of this.children ) child.traverse( callback );

	}

	traverseVisible( callback ) {

		if ( ! this._visible ) return;
		callback( this );
		for ( const child of this.children ) child.traverseVisible( callback );

	}

	traverseAncestors( callback ) {

		if ( this.parent === null ) return;
		callback( this.parent );
		this.parent.traverseAncestors( callback );

	}

	getObjectByProperty( name, value ) {

		if ( this[ name ] === value ) return this;

		for ( const child of this.children ) {

			const found = child.getObjectByProperty( name, value );
			if ( found !== undefined ) return found;

		}

		return undefined;

	}

	getObjectByName( name ) {

		return this.getObjectByProperty( 'name', name );

	}

	getObjectById( id ) {

		return this.getObjectByProperty( 'id', id );

	}

	clone( recursive = true ) {

		return new this.constructor().copy( this, recursive );

	}

	copy( source, recursive = true ) {

		this.name = source.name;
		this.up.copy( source.up );
		this.position.copy( source.position );
		this.rotation.order = source.rotation.order;
		this.quaternion.copy( source.quaternion );
		this.scale.copy( source.scale );
		this.visible = source.visible;
		this.renderOrder = source.renderOrder;
		this.frustumCulled = source.frustumCulled;
		this.castShadow = source.castShadow;
		this.receiveShadow = source.receiveShadow;
		this.layers.mask = source.layers.mask;
		this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;

		if ( ! source.matrixAutoUpdate ) {

			this.matrixAutoUpdate = false;
			this.matrix.copy( source.matrix );

		}

		this.userData = JSON.parse( JSON.stringify( source.userData ) );
		if ( recursive ) for ( const child of source.children ) this.add( child.clone() );
		return this;

	}

	/** Releases the object in the engine now instead of at garbage collection. */
	dispose() {

		this.removeFromParent();
		this.clear();
		finalizer.unregister( this );
		objects.delete( this.handle );
		w().destroy( this.handle );

	}

}

Object3D.prototype.isObject3D = true;

export class Group extends Object3D {

	constructor() {

		super();
		this.type = 'Group';

	}

}

Group.prototype.isGroup = true;

export class Scene extends Object3D {

	constructor() {

		super();
		this.type = 'Scene';
		this.background = null;
		this.fog = null;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.background = source.background && source.background.clone();
		this.fog = source.fog && source.fog.clone();
		return this;

	}

}

Scene.prototype.isScene = true;

/** Fades objects towards `color` between the distances `near` and `far` from the camera. */
export class Fog {

	constructor( color, near = 1, far = 1000 ) {

		this.name = '';
		this.color = new Color( color );
		this.near = near;
		this.far = far;

	}

	clone() {

		return new Fog( this.color, this.near, this.far );

	}

}

Fog.prototype.isFog = true;

/** Fog that thickens with the square of the distance from the camera. */
export class FogExp2 {

	constructor( color, density = 0.00025 ) {

		this.name = '';
		this.color = new Color( color );
		this.density = density;

	}

	clone() {

		return new FogExp2( this.color, this.density );

	}

}

FogExp2.prototype.isFogExp2 = true;

export class Mesh extends Object3D {

	constructor( geometry = new BufferGeometry(), material = new MeshBasicMaterial() ) {

		super();
		this.type = 'Mesh';
		this._geometry = geometry;
		this._material = material;
		this._link();

	}

	get geometry() {

		return this._geometry;

	}

	set geometry( value ) {

		this._geometry = value;
		this._link();

	}

	get material() {

		return this._material;

	}

	set material( value ) {

		this._material = value;
		this._link();

	}

	// An array of materials draws each geometry group with the material at its
	// `materialIndex`. Assign a new array to change it; edits in place are not seen.
	_link() {

		const material = this._material, list = Array.isArray( material );
		w().setRenderable( this.handle, this._geometry.handle, ( list ? material[ 0 ] : material ).handle );
		if ( list || this._listed ) world.setMaterials( this.handle, list ? BigUint64Array.from( material, ( m ) => m.handle ) : new BigUint64Array( 0 ) );
		this._listed = list;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this._geometry = source.geometry;
		this._material = source.material;
		this._link();
		return this;

	}

}

Mesh.prototype.isMesh = true;

/** Per-instance numbers of an `InstancedMesh`. Set `needsUpdate = true` after changing `array`. */
export class InstancedBufferAttribute {

	constructor( array, itemSize ) {

		this.array = array;
		this.itemSize = itemSize;
		this.count = array.length / itemSize;
		this.version = 0;

	}

	set needsUpdate( value ) {

		if ( value ) this.version ++;

	}

	setUsage() {

		return this;

	}

}

InstancedBufferAttribute.prototype.isInstancedBufferAttribute = true;

// What the renderer reads for an instanced mesh. It does not refer to the mesh, so the
// mesh can still be collected.
class InstanceData {

	constructor( count ) {

		const matrices = new Float32Array( count * 16 );
		for ( let i = 0; i < matrices.length; i += 16 ) matrices[ i ] = matrices[ i + 5 ] = matrices[ i + 10 ] = matrices[ i + 15 ] = 1;
		this.matrices = new InstancedBufferAttribute( matrices, 16 );
		this.colors = null;

	}

	get matrix() {

		return this.matrices.array;

	}

	get matrixVersion() {

		return this.matrices.version;

	}

	get color() {

		return this.colors ? this.colors.array : null;

	}

	get colorVersion() {

		return this.colors ? this.colors.version : 0;

	}

}

const instanceSources = new Map();
let nextInstanceId = 1;

/**
 * Draws one geometry `count` times, each with its own matrix (and optionally colour),
 * in a single draw call. Instances are not culled one by one, and picking treats the
 * mesh as a single object at its own transform.
 */
export class InstancedMesh extends Mesh {

	constructor( geometry, material, count ) {

		super( geometry, material );
		this.type = 'InstancedMesh';
		this._instances = new InstanceData( count );
		this._capacity = count;
		this._count = count;
		this._token.instances = nextInstanceId ++;
		instanceSources.set( this._token.instances, this._instances );
		w().setInstances( this.handle, this._token.instances, count );

	}

	get instanceMatrix() {

		return this._instances.matrices;

	}

	get instanceColor() {

		return this._instances.colors;

	}

	set instanceColor( value ) {

		this._instances.colors = value;

	}

	/** How many of the instances are drawn; at most the count given to the constructor. */
	get count() {

		return this._count;

	}

	set count( value ) {

		this._count = Math.max( 0, Math.min( this._capacity, value ) );
		w().setInstances( this.handle, this._token.instances, this._count );

	}

	setMatrixAt( index, matrix ) {

		matrix.toArray( this._instances.matrices.array, index * 16 );

	}

	getMatrixAt( index, matrix ) {

		return matrix.fromArray( this._instances.matrices.array, index * 16 );

	}

	setColorAt( index, color ) {

		this._instances.colors ??= new InstancedBufferAttribute( new Float32Array( this._capacity * 3 ).fill( 1 ), 3 );
		color.toArray( this._instances.colors.array, index * 3 );

	}

	getColorAt( index, color ) {

		const array = this._instances.colors ? this._instances.colors.array : null;
		return array ? color.setRGB( array[ index * 3 ], array[ index * 3 + 1 ], array[ index * 3 + 2 ] ) : color.setRGB( 1, 1, 1 );

	}

	dispose() {

		instanceSources.delete( this._token.instances );
		super.dispose();

	}

}

InstancedMesh.prototype.isInstancedMesh = true;

/** One connected line through the geometry's vertices. Lines are one pixel wide. */
export class Line extends Object3D {

	constructor( geometry = new BufferGeometry(), material = new LineBasicMaterial() ) {

		super();
		this.type = 'Line';
		this._geometry = geometry;
		this._material = material;
		this._link();

	}

	get geometry() {

		return this._geometry;

	}

	set geometry( value ) {

		this._geometry = value;
		this._link();

	}

	get material() {

		return this._material;

	}

	set material( value ) {

		this._material = value;
		this._link();

	}

	_link() {

		w().setLine( this.handle, this._geometry.handle, this._material.handle, this.isLineSegments === true );

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this._geometry = source.geometry;
		this._material = source.material;
		this._link();
		return this;

	}

}

Line.prototype.isLine = true;

/**
 * One point per vertex. As with the three.js r186 WebGPU renderer, points are one pixel
 * in size: `PointsMaterial.size` has no effect.
 */
export class Points extends Object3D {

	constructor( geometry = new BufferGeometry(), material = new PointsMaterial() ) {

		super();
		this.type = 'Points';
		this._geometry = geometry;
		this._material = material;
		this._link();

	}

	get geometry() {

		return this._geometry;

	}

	set geometry( value ) {

		this._geometry = value;
		this._link();

	}

	get material() {

		return this._material;

	}

	set material( value ) {

		this._material = value;
		this._link();

	}

	_link() {

		w().setPoints( this.handle, this._geometry.handle, this._material.handle );

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this._geometry = source.geometry;
		this._material = source.material;
		this._link();
		return this;

	}

}

Points.prototype.isPoints = true;

let spriteGeometry = null;

/** A quad that always faces the camera, sized by its scale. Not picked by `Raycaster` yet. */
export class Sprite extends Object3D {

	constructor( material = new SpriteMaterial() ) {

		super();
		this.type = 'Sprite';
		spriteGeometry ??= new BufferGeometry()
			.setAttribute( 'position', new Float32BufferAttribute( [ - 0.5, - 0.5, 0, 0.5, - 0.5, 0, 0.5, 0.5, 0, - 0.5, 0.5, 0 ], 3 ) )
			.setAttribute( 'uv', new Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 1 ], 2 ) )
			.setIndex( [ 0, 1, 2, 0, 2, 3 ] );
		this.geometry = spriteGeometry;
		this.center = new Vector2( 0.5, 0.5 );
		this._sentCenter = [ NaN, NaN ];
		this._material = material;
		this._link();

	}

	get material() {

		return this._material;

	}

	set material( value ) {

		this._material = value;
		this._link();

	}

	_link() {

		const { x, y } = this.center;
		w().setSprite( this.handle, this.geometry.handle, this._material.handle, this._sentCenter[ 0 ] = x, this._sentCenter[ 1 ] = y );

	}

	// The centre is a plain value that can change at any time, so it is sent when drawing.
	_syncCenter() {

		if ( this.center.x !== this._sentCenter[ 0 ] || this.center.y !== this._sentCenter[ 1 ] ) this._link();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.center.copy( source.center );
		this._material = source.material;
		this._link();
		return this;

	}

}

Sprite.prototype.isSprite = true;

/** Separate segments, one per pair of vertices. */
export class LineSegments extends Line {

	constructor( geometry, material ) {

		super( geometry, material );
		this.type = 'LineSegments';

	}

}

LineSegments.prototype.isLineSegments = true;

/** A square grid of lines in the XZ plane; the two centre lines use `color1`. */
export class GridHelper extends LineSegments {

	constructor( size = 10, divisions = 10, color1 = 0x444444, color2 = 0x888888 ) {

		color1 = new Color( color1 );
		color2 = new Color( color2 );
		const center = divisions / 2, step = size / divisions, halfSize = size / 2;
		const vertices = [], colors = [];

		for ( let i = 0, k = - halfSize; i <= divisions; i ++, k += step ) {

			vertices.push( - halfSize, 0, k, halfSize, 0, k, k, 0, - halfSize, k, 0, halfSize );
			const color = i === center ? color1 : color2;
			for ( let j = 0; j < 4; j ++ ) colors.push( color.r, color.g, color.b );

		}

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( vertices ), 3 ) );
		geometry.setAttribute( 'color', new BufferAttribute( new Float32Array( colors ), 3 ) );
		super( geometry, new LineBasicMaterial( { vertexColors: true, toneMapped: false } ) );
		this.type = 'GridHelper';

	}

	dispose() {

		this.geometry.dispose();
		this.material.dispose();
		super.dispose();

	}

}

/** The three axes as lines from the origin: X red, Y green, Z blue. */
export class AxesHelper extends LineSegments {

	constructor( size = 1 ) {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [ 0, 0, 0, size, 0, 0, 0, 0, 0, 0, size, 0, 0, 0, 0, 0, 0, size ] ), 3 ) );
		geometry.setAttribute( 'color', new BufferAttribute( new Float32Array( [ 1, 0, 0, 1, 0.6, 0, 0, 1, 0, 0.6, 1, 0, 0, 0, 1, 0, 0.6, 1 ] ), 3 ) );
		super( geometry, new LineBasicMaterial( { vertexColors: true, toneMapped: false } ) );
		this.type = 'AxesHelper';

	}

	setColors( xAxisColor, yAxisColor, zAxisColor ) {

		const color = new Color(), attribute = this.geometry.attributes.color, array = attribute.array;

		[ xAxisColor, yAxisColor, zAxisColor ].forEach( ( value, i ) => {

			color.set( value );
			for ( let j = 0; j < 2; j ++ ) array.set( [ color.r, color.g, color.b ], i * 6 + j * 3 );

		} );

		attribute.needsUpdate = true;
		return this;

	}

	dispose() {

		this.geometry.dispose();
		this.material.dispose();
		super.dispose();

	}

}

// ---------------------------------------------------------------- cameras

export class Camera extends Object3D {

	constructor() {

		super();
		this.type = 'Camera';
		this._projectionMatrix = null;
		this._projectionMatrixInverse = null;
		this._matrixWorldInverse = null;

	}

	// Like `matrixWorld`: one persistent matrix each, refreshed on access.
	get projectionMatrix() {

		return ( this._projectionMatrix ??= new Matrix4() ).fromArray( w().projectionMatrix( this.handle ) );

	}

	get projectionMatrixInverse() {

		return ( this._projectionMatrixInverse ??= new Matrix4() ).fromArray( w().projectionMatrixInverse( this.handle ) );

	}

	get matrixWorldInverse() {

		return ( this._matrixWorldInverse ??= new Matrix4() ).fromArray( w().matrixWorldInverse( this.handle ) );

	}

	setViewOffset( fullWidth, fullHeight, x, y, width, height ) {

		this.view = { enabled: true, fullWidth, fullHeight, offsetX: x, offsetY: y, width, height };
		this.updateProjectionMatrix();

	}

	clearViewOffset() {

		if ( this.view ) this.view.enabled = false;
		this.updateProjectionMatrix();

	}

	_applyZoomAndView() {

		if ( this.zoom !== 1 ) w().setCameraZoom( this.handle, this.zoom );
		const v = this.view;
		if ( v && v.enabled ) w().setCameraViewOffset( this.handle, v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height );

	}

}

Camera.prototype.isCamera = true;

export class PerspectiveCamera extends Camera {

	constructor( fov = 50, aspect = 1, near = 0.1, far = 2000 ) {

		super();
		this.type = 'PerspectiveCamera';
		this.fov = fov;
		this.aspect = aspect;
		this.near = near;
		this.far = far;
		this.zoom = 1;
		this.view = null;
		this.updateProjectionMatrix();

	}

	updateProjectionMatrix() {

		w().setPerspectiveCamera( this.handle, this.fov, this.aspect, this.near, this.far, false );
		this._applyZoomAndView();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		Object.assign( this, { fov: source.fov, aspect: source.aspect, near: source.near, far: source.far, zoom: source.zoom, view: source.view && { ...source.view } } );
		this.updateProjectionMatrix();
		return this;

	}

}

PerspectiveCamera.prototype.isPerspectiveCamera = true;

export class OrthographicCamera extends Camera {

	constructor( left = - 1, right = 1, top = 1, bottom = - 1, near = 0.1, far = 2000 ) {

		super();
		this.type = 'OrthographicCamera';
		this.left = left;
		this.right = right;
		this.top = top;
		this.bottom = bottom;
		this.near = near;
		this.far = far;
		this.zoom = 1;
		this.view = null;
		this.updateProjectionMatrix();

	}

	updateProjectionMatrix() {

		w().setOrthographicCamera( this.handle, this.left, this.right, this.top, this.bottom, this.near, this.far, false );
		this._applyZoomAndView();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		Object.assign( this, { left: source.left, right: source.right, top: source.top, bottom: source.bottom, near: source.near, far: source.far, zoom: source.zoom, view: source.view && { ...source.view } } );
		this.updateProjectionMatrix();
		return this;

	}

}

OrthographicCamera.prototype.isOrthographicCamera = true;

// ---------------------------------------------------------------- lights

export class Light extends Object3D {

	constructor( color = 0xffffff, intensity = 1 ) {

		super();
		this.type = 'Light';
		this.color = new Color( color );
		this.intensity = intensity;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.color.copy( source.color );
		this.intensity = source.intensity;
		return this;

	}

}

Light.prototype.isLight = true;

export class AmbientLight extends Light {

	constructor( color, intensity ) {

		super( color, intensity );
		this.type = 'AmbientLight';

	}

}

AmbientLight.prototype.isAmbientLight = true;

export class HemisphereLight extends Light {

	constructor( skyColor, groundColor = 0xffffff, intensity ) {

		super( skyColor, intensity );
		this.type = 'HemisphereLight';
		this.groundColor = new Color( groundColor );
		this.position.set( 0, 1, 0 );

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.groundColor.copy( source.groundColor );
		return this;

	}

}

HemisphereLight.prototype.isHemisphereLight = true;

export class DirectionalLight extends Light {

	constructor( color, intensity ) {

		super( color, intensity );
		this.type = 'DirectionalLight';
		this.position.set( 0, 1, 0 );
		this.target = new Object3D();
		this.shadow = new DirectionalLightShadow();

	}

}

DirectionalLight.prototype.isDirectionalLight = true;

// ---------------------------------------------------------------- shadows

/** A light's shadow settings, with the three.js defaults. */
export class LightShadow {

	constructor( camera ) {

		this.camera = camera;
		this.intensity = 1;
		this.bias = 0;
		this.normalBias = 0;
		this.radius = 1;
		this.blurSamples = 8;
		this.mapSize = new Vector2( 512, 512 );
		this.map = null;
		this.autoUpdate = true;
		this.needsUpdate = false;

	}

	copy( source ) {

		this.camera = source.camera.clone();
		this.intensity = source.intensity;
		this.bias = source.bias;
		this.radius = source.radius;
		this.normalBias = source.normalBias;
		this.mapSize.copy( source.mapSize );
		return this;

	}

	clone() {

		return new this.constructor().copy( this );

	}

	dispose() {}

}

export class DirectionalLightShadow extends LightShadow {

	constructor() {

		super( new OrthographicCamera( - 5, 5, 5, - 5, 0.5, 500 ) );

	}

}

DirectionalLightShadow.prototype.isDirectionalLightShadow = true;

/** The camera's field of view follows the light's cone: `2 * angle * focus`. */
export class SpotLightShadow extends LightShadow {

	constructor() {

		super( new PerspectiveCamera( 50, 1, 0.5, 500 ) );
		this.focus = 1;
		this.aspect = 1;

	}

	copy( source ) {

		super.copy( source );
		this.focus = source.focus;
		this.aspect = source.aspect;
		return this;

	}

}

SpotLightShadow.prototype.isSpotLightShadow = true;

/** Accepted so code runs; point lights do not cast shadows yet. */
export class PointLightShadow extends LightShadow {

	constructor() {

		super( new PerspectiveCamera( 90, 1, 0.5, 500 ) );

	}

}

PointLightShadow.prototype.isPointLightShadow = true;

/** Shines in all directions from its position. `distance` 0 means no cutoff. */
export class PointLight extends Light {

	constructor( color, intensity, distance = 0, decay = 2 ) {

		super( color, intensity );
		this.type = 'PointLight';
		this.distance = distance;
		this.decay = decay;
		this.shadow = new PointLightShadow();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.distance = source.distance;
		this.decay = source.decay;
		return this;

	}

}

PointLight.prototype.isPointLight = true;

/** A cone of light from its position towards `target`. `angle` is the cone's half angle. */
export class SpotLight extends Light {

	constructor( color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2 ) {

		super( color, intensity );
		this.type = 'SpotLight';
		this.position.set( 0, 1, 0 );
		this.target = new Object3D();
		this.distance = distance;
		this.angle = angle;
		this.penumbra = penumbra;
		this.decay = decay;
		this.shadow = new SpotLightShadow();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.distance = source.distance;
		this.angle = source.angle;
		this.penumbra = source.penumbra;
		this.decay = source.decay;
		return this;

	}

}

SpotLight.prototype.isSpotLight = true;

// ---------------------------------------------------------------- geometry

function toFloat32( array ) {

	return array instanceof Float32Array ? array : Float32Array.from( array );

}

function toUint32( array ) {

	return array instanceof Uint32Array ? array : Uint32Array.from( array );

}

export class BufferAttribute {

	constructor( array, itemSize, normalized = false ) {

		this.array = array;
		this.itemSize = itemSize;
		this.normalized = normalized;
		this.count = array.length / itemSize;
		this.version = 0;
		this._geometry = null;
		this._name = '';

	}

	/** Set to true after changing `array` to send the new data to the engine. */
	set needsUpdate( value ) {

		if ( ! value ) return;
		this.version ++;
		if ( this._geometry === null ) return;
		const handle = this._geometry.handle;

		if ( this._name === 'index' ) {

			w().setIndex( handle, toUint32( this.array ) );

		} else {

			W.attributeView( w(), handle, this._name ).set( this.array );
			w().markAttributeNeedsUpdate( handle, this._name );

		}

	}

	getX( index ) {

		return this.array[ index * this.itemSize ];

	}

	getY( index ) {

		return this.array[ index * this.itemSize + 1 ];

	}

	getZ( index ) {

		return this.array[ index * this.itemSize + 2 ];

	}

	getW( index ) {

		return this.array[ index * this.itemSize + 3 ];

	}

	setX( index, x ) {

		this.array[ index * this.itemSize ] = x;
		return this;

	}

	setY( index, y ) {

		this.array[ index * this.itemSize + 1 ] = y;
		return this;

	}

	setZ( index, z ) {

		this.array[ index * this.itemSize + 2 ] = z;
		return this;

	}

	setXY( index, x, y ) {

		const array = this.array, i = index * this.itemSize;
		array[ i ] = x;
		array[ i + 1 ] = y;
		return this;

	}

	setXYZ( index, x, y, z ) {

		const array = this.array, i = index * this.itemSize;
		array[ i ] = x;
		array[ i + 1 ] = y;
		array[ i + 2 ] = z;
		return this;

	}

	setXYZW( index, x, y, z, w_ ) {

		const array = this.array, i = index * this.itemSize;
		array[ i ] = x;
		array[ i + 1 ] = y;
		array[ i + 2 ] = z;
		array[ i + 3 ] = w_;
		return this;

	}

}

BufferAttribute.prototype.isBufferAttribute = true;

function typedAttribute( TypedArray ) {

	return class extends BufferAttribute {

		constructor( array, itemSize, normalized ) {

			super( array instanceof TypedArray ? array : new TypedArray( array ), itemSize, normalized );

		}

	};

}

export const Float32BufferAttribute = typedAttribute( Float32Array );
export const Uint16BufferAttribute = typedAttribute( Uint16Array );
export const Uint32BufferAttribute = typedAttribute( Uint32Array );

const ADOPT = Symbol( 'adopt' );

export class BufferGeometry {

	constructor( key, handle ) {

		this.handle = key === ADOPT ? handle : w().createGeometry();
		this.type = 'BufferGeometry';
		this.attributes = {};
		this.index = null;
		this.groups = [];
		this.boundingBox = null;
		this.boundingSphere = null;
		this.userData = {};
		finalizer.register( this, { kind: GEOMETRY, handle: this.handle }, this );
		if ( key === ADOPT ) this._pull();

	}

	// Mirrors the engine's data into `attributes` and `index`.
	_pull( names = [ 'position', 'normal', 'uv', 'tangent' ] ) {

		for ( const name of names ) {

			if ( ! w().hasAttribute( this.handle, name ) ) continue;
			const data = w().getAttribute( this.handle, name );
			const attribute = new BufferAttribute( data, data.length / w().attributeCount( this.handle, name ) );
			attribute._geometry = this;
			attribute._name = name;
			this.attributes[ name ] = attribute;

		}

		const groups = w().getGroups( this.handle );
		this.groups = [];
		for ( let i = 0; i < groups.length; i += 3 ) this.groups.push( { start: groups[ i ], count: groups[ i + 1 ], materialIndex: groups[ i + 2 ] } );

		if ( this.index === null ) {

			const index = w().getIndex( this.handle );

			if ( index.length > 0 ) {

				this.index = new BufferAttribute( index, 1 );
				this.index._geometry = this;
				this.index._name = 'index';

			}

		}

	}

	setAttribute( name, attribute ) {

		w().setAttribute( this.handle, name, toFloat32( attribute.array ), attribute.itemSize );
		attribute._geometry = this;
		attribute._name = name;
		this.attributes[ name ] = attribute;
		return this;

	}

	getAttribute( name ) {

		return this.attributes[ name ];

	}

	hasAttribute( name ) {

		return this.attributes[ name ] !== undefined;

	}

	setIndex( index ) {

		if ( index === null ) throw new Error( 'WAMR3D: removing an index is not supported; use toNonIndexed()' );
		const attribute = Array.isArray( index ) || ArrayBuffer.isView( index ) ? new BufferAttribute( Uint32Array.from( index ), 1 ) : index;
		w().setIndex( this.handle, toUint32( attribute.array ) );
		attribute._geometry = this;
		attribute._name = 'index';
		this.index = attribute;
		return this;

	}

	getIndex() {

		return this.index;

	}

	addGroup( start, count, materialIndex = 0 ) {

		w().addGroup( this.handle, start, count, materialIndex );
		this.groups.push( { start, count, materialIndex } );

	}

	setDrawRange( start, count ) {

		w().setDrawRange( this.handle, start, count );

	}

	computeVertexNormals() {

		w().computeVertexNormals( this.handle );
		this._pull( [ 'normal' ] );

	}

	computeTangents() {

		w().computeTangents( this.handle );
		this._pull( [ 'tangent' ] );

	}

	computeBoundingBox() {

		const b = w().computeBoundingBox( this.handle );
		this.boundingBox = new Box3( new Vector3( b[ 0 ], b[ 1 ], b[ 2 ] ), new Vector3( b[ 3 ], b[ 4 ], b[ 5 ] ) );

	}

	computeBoundingSphere() {

		const s = w().computeBoundingSphere( this.handle );
		this.boundingSphere = new Sphere( new Vector3( s[ 0 ], s[ 1 ], s[ 2 ] ), s[ 3 ] );

	}

	applyMatrix4( matrix ) {

		w().applyMatrix4ToGeometry( this.handle, matrix );
		this._pull( [ 'position', 'normal', 'tangent' ] );
		if ( this.boundingBox !== null ) this.computeBoundingBox();
		if ( this.boundingSphere !== null ) this.computeBoundingSphere();
		return this;

	}

	translate( x, y, z ) {

		return this.applyMatrix4( new Matrix4().makeTranslation( x, y, z ) );

	}

	scale( x, y, z ) {

		return this.applyMatrix4( new Matrix4().makeScale( x, y, z ) );

	}

	rotateX( angle ) {

		return this.applyMatrix4( new Matrix4().makeRotationX( angle ) );

	}

	rotateY( angle ) {

		return this.applyMatrix4( new Matrix4().makeRotationY( angle ) );

	}

	rotateZ( angle ) {

		return this.applyMatrix4( new Matrix4().makeRotationZ( angle ) );

	}

	center() {

		w().centerGeometry( this.handle );
		this._pull( [ 'position' ] );
		return this;

	}

	toNonIndexed() {

		return new BufferGeometry( ADOPT, w().toNonIndexed( this.handle ) );

	}

	dispose() {

		finalizer.unregister( this );
		w().disposeGeometry( this.handle );

	}

}

BufferGeometry.prototype.isBufferGeometry = true;

export class BoxGeometry extends BufferGeometry {

	constructor( width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1 ) {

		super( ADOPT, w().createBoxGeometry( width, height, depth, widthSegments, heightSegments, depthSegments ) );
		this.type = 'BoxGeometry';
		this.parameters = { width, height, depth, widthSegments, heightSegments, depthSegments };

	}

}

export class PlaneGeometry extends BufferGeometry {

	constructor( width = 1, height = 1, widthSegments = 1, heightSegments = 1 ) {

		super( ADOPT, w().createPlaneGeometry( width, height, widthSegments, heightSegments ) );
		this.type = 'PlaneGeometry';
		this.parameters = { width, height, widthSegments, heightSegments };

	}

}

export class SphereGeometry extends BufferGeometry {

	constructor( radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI ) {

		super( ADOPT, w().createSphereGeometry( radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength ) );
		this.type = 'SphereGeometry';
		this.parameters = { radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength };

	}

}

export class CylinderGeometry extends BufferGeometry {

	constructor( radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( ADOPT, w().createCylinderGeometry( radiusTop, radiusBottom, height, Math.floor( radialSegments ), Math.floor( heightSegments ), openEnded, thetaStart, thetaLength ) );
		this.type = 'CylinderGeometry';
		this.parameters = { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };

	}

}

export class ConeGeometry extends CylinderGeometry {

	constructor( radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( 0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength );
		this.type = 'ConeGeometry';
		this.parameters = { radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };

	}

}

export class CircleGeometry extends BufferGeometry {

	constructor( radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( ADOPT, w().createCircleGeometry( radius, segments, thetaStart, thetaLength ) );
		this.type = 'CircleGeometry';
		this.parameters = { radius, segments, thetaStart, thetaLength };

	}

}

export class RingGeometry extends BufferGeometry {

	constructor( innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( ADOPT, w().createRingGeometry( innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength ) );
		this.type = 'RingGeometry';
		this.parameters = { innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength };

	}

}

export class TorusGeometry extends BufferGeometry {

	constructor( radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI * 2 ) {

		super( ADOPT, w().createTorusGeometry( radius, tube, Math.floor( radialSegments ), Math.floor( tubularSegments ), arc, thetaStart, thetaLength ) );
		this.type = 'TorusGeometry';
		this.parameters = { radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength };

	}

}

// ---------------------------------------------------------------- textures and materials

export const RepeatWrapping = 1000, ClampToEdgeWrapping = 1001, MirroredRepeatWrapping = 1002;
export const NearestFilter = 1003, NearestMipmapNearestFilter = 1004, NearestMipmapLinearFilter = 1005;
export const LinearFilter = 1006, LinearMipmapNearestFilter = 1007, LinearMipmapLinearFilter = 1008;
export const NoColorSpace = '', SRGBColorSpace = 'srgb';
export const UnsignedByteType = 1009, FloatType = 1015, HalfFloatType = 1016;

const warned = new Set();

function ignored( what ) {

	if ( warned.has( what ) ) return;
	warned.add( what );
	console.warn( `WAMR3D: ${what} is not supported yet and has no effect` );

}

// Images live in the browser, so the engine only carries a texture's id and the
// renderer's host looks the image up here. A texture is kept until dispose().
const textureSources = new Map();
let nextTextureId = 1;

export class Texture {

	constructor( image = null ) {

		this.id = nextTextureId ++;
		this.name = '';
		this.image = image;
		this.version = 0;
		this.flipY = true;
		this.wrapS = this.wrapT = ClampToEdgeWrapping;
		this.magFilter = LinearFilter;
		this.minFilter = LinearMipmapLinearFilter;
		this.generateMipmaps = true;
		this.colorSpace = NoColorSpace;
		this.offset = new Vector2( 0, 0 );
		this.repeat = new Vector2( 1, 1 );
		this.center = new Vector2( 0, 0 );
		this.rotation = 0;
		textureSources.set( this.id, this );

	}

	/** Set to true after changing `image` or its pixels. */
	set needsUpdate( value ) {

		if ( value ) this.version ++;

	}

	dispose() {

		textureSources.delete( this.id );

	}

}

Texture.prototype.isTexture = true;

// Backends that may hold the GPU side of render targets.
const backends = new Set();

/**
 * Something to draw into instead of the canvas, with `texture` usable as a material's
 * map. As in three.js, what is drawn into it is linear colour without tone mapping.
 * `type` UnsignedByteType (default) stores 8 bits per channel, HalfFloatType or
 * FloatType 16-bit floats. `samples` above 1 multisamples (4x) when the renderer is
 * antialiased. Depth is always kept; there are no depth textures, stencil or multiple
 * colour attachments yet.
 */
export class RenderTarget {

	constructor( width = 1, height = 1, options = {} ) {

		this.width = width;
		this.height = height;
		this.depth = 1;
		this.samples = options.samples ?? 0;
		this.depthBuffer = options.depthBuffer ?? true;
		this.stencilBuffer = false;
		this.scissor = new Vector4( 0, 0, width, height );
		this.scissorTest = false;
		this.viewport = new Vector4( 0, 0, width, height );
		const texture = new Texture( { width, height, depth: 1 } );
		texture.isRenderTargetTexture = true;
		texture.renderTarget = this;
		texture.flipY = false;
		texture.generateMipmaps = options.generateMipmaps ?? false;
		texture.minFilter = options.minFilter ?? LinearFilter;
		texture.magFilter = options.magFilter ?? LinearFilter;
		texture.type = options.type ?? UnsignedByteType;
		texture.colorSpace = options.colorSpace ?? NoColorSpace;
		if ( options.depthTexture || ( options.count ?? 1 ) > 1 || options.stencilBuffer ) ignored( 'RenderTarget depth textures, stencil and multiple attachments' );
		this.texture = texture;
		this.textures = [ texture ];

	}

	setSize( width, height ) {

		this.width = this.texture.image.width = width;
		this.height = this.texture.image.height = height;
		this.viewport.set( 0, 0, width, height );
		this.scissor.set( 0, 0, width, height );

	}

	dispose() {

		for ( const backend of backends ) backend.disposeRenderTarget( this.texture.id );

	}

}

RenderTarget.prototype.isRenderTarget = true;

/** The same as `RenderTarget`; the name three.js code written for WebGL uses. */
export class WebGLRenderTarget extends RenderTarget {}

WebGLRenderTarget.prototype.isWebGLRenderTarget = true;

/** Pixels from an array: `data` is RGBA, one byte per channel, rows bottom to top. */
export class DataTexture extends Texture {

	constructor( data, width, height ) {

		super( { data, width, height } );
		this.flipY = false;
		this.generateMipmaps = false;
		this.magFilter = this.minFilter = NearestFilter;

	}

}

export class CanvasTexture extends Texture {

	constructor( canvas ) {

		super( canvas );
		this.needsUpdate = true;

	}

}

export class TextureLoader {

	load( url, onLoad, onProgress, onError ) {

		const texture = new Texture();

		fetch( url ).then( ( response ) => {

			if ( ! response.ok ) throw new Error( `WAMR3D: could not load ${url} (${response.status})` );
			return response.blob();

		} ).then( ( blob ) => createImageBitmap( blob ) ).then( ( image ) => {

			texture.image = image;
			texture.needsUpdate = true;
			if ( onLoad ) onLoad( texture );

		} ).catch( ( error ) => {

			if ( onError ) onError( error );
			else console.error( error );

		} );

		return texture;

	}

}

const MATERIAL_KEYS = new Set( [ 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'color', 'side', 'name', 'map', 'roughness', 'metalness', 'userData', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'vertexColors' ] );

export class Material {

	constructor( parameters ) {

		this.handle = w().createMaterial( '' );
		this.type = 'Material';
		this.name = '';
		this.color = new Color( 0xffffff );
		this.map = null;
		this.transparent = false;
		this.opacity = 1;
		this.depthTest = true;
		this.depthWrite = true;
		this.vertexColors = false;
		this.toneMapped = true;
		this.userData = {};
		this._side = FrontSide;
		this._sent = new Array( 20 ).fill( NaN );
		finalizer.register( this, { kind: MATERIAL, handle: this.handle }, this );
		if ( parameters ) this.setValues( parameters );

	}

	get side() {

		return this._side;

	}

	set side( value ) {

		w().setMaterialSide( this.handle, this._side = value );

	}

	setValues( parameters ) {

		for ( const [ key, value ] of Object.entries( parameters ) ) {

			if ( value === undefined ) continue;
			if ( ! MATERIAL_KEYS.has( key ) || ( ( key === 'roughness' || key === 'metalness' ) && this._shading !== 2 ) ) ignored( `${this.constructor.name}.${key}` );
			if ( key === 'color' ) this.color.set( value );
			else this[ key ] = value;

		}

	}

	// Colours, numbers and maps are plain values that can change at any time, so they are
	// sent when drawing.
	_sync() {

		const { r, g, b } = this.color, sent = this._sent;
		if ( r !== sent[ 0 ] || g !== sent[ 1 ] || b !== sent[ 2 ] ) w().setMaterialColor( this.handle, sent[ 0 ] = r, sent[ 1 ] = g, sent[ 2 ] = b );

		const roughness = this.roughness ?? 1, metalness = this.metalness ?? 0;
		if ( roughness !== sent[ 3 ] || metalness !== sent[ 4 ] ) w().setMaterialShading( this.handle, this._shading, sent[ 3 ] = roughness, sent[ 4 ] = metalness );

		const map = this.map ? this.map.id : 0;
		if ( map !== sent[ 5 ] ) w().setMaterialMap( this.handle, sent[ 5 ] = map );

		const { transparent, opacity, depthTest, depthWrite, vertexColors } = this;

		if ( transparent !== sent[ 6 ] || opacity !== sent[ 7 ] || depthTest !== sent[ 8 ] || depthWrite !== sent[ 9 ] || vertexColors !== sent[ 10 ] ) {

			w().setMaterialState( this.handle, sent[ 6 ] = transparent, sent[ 7 ] = opacity, sent[ 8 ] = depthTest, sent[ 9 ] = depthWrite, sent[ 10 ] = vertexColors );

		}

		const spriteRotation = this.rotation ?? 0, sizeAttenuation = this.sizeAttenuation ?? true;
		if ( spriteRotation !== sent[ 18 ] || sizeAttenuation !== sent[ 19 ] ) w().setMaterialSprite( this.handle, sent[ 18 ] = spriteRotation, sent[ 19 ] = sizeAttenuation );

		if ( this.map ) {

			const { offset, repeat, center, rotation } = this.map;
			const ox = offset.x, oy = offset.y, rx = repeat.x, ry = repeat.y, cx = center.x, cy = center.y;

			if ( ox !== sent[ 11 ] || oy !== sent[ 12 ] || rx !== sent[ 13 ] || ry !== sent[ 14 ] || rotation !== sent[ 15 ] || cx !== sent[ 16 ] || cy !== sent[ 17 ] ) {

				w().setMaterialMapTransform( this.handle, sent[ 11 ] = ox, sent[ 12 ] = oy, sent[ 13 ] = rx, sent[ 14 ] = ry, sent[ 15 ] = rotation, sent[ 16 ] = cx, sent[ 17 ] = cy );

			}

		}

	}

	clone() {

		const copy = new this.constructor();
		copy.name = this.name;
		copy.color.copy( this.color );
		copy.side = this.side;
		copy.map = this.map;
		copy.transparent = this.transparent;
		copy.opacity = this.opacity;
		copy.depthTest = this.depthTest;
		copy.depthWrite = this.depthWrite;
		copy.vertexColors = this.vertexColors;
		if ( this.roughness !== undefined ) copy.roughness = this.roughness;
		if ( this.metalness !== undefined ) copy.metalness = this.metalness;
		return copy;

	}

	dispose() {

		finalizer.unregister( this );
		w().disposeMaterial( this.handle );

	}

}

Material.prototype.isMaterial = true;
Material.prototype._shading = 0;

/** Shows its colour (and map) as is, without lighting. */
export class MeshBasicMaterial extends Material {

	constructor( parameters ) {

		super( parameters );
		this.type = 'MeshBasicMaterial';

	}

}

MeshBasicMaterial.prototype._shading = 1;

/** For `Line` and `LineSegments`: the colour as is, without lighting. */
export class LineBasicMaterial extends Material {

	constructor( parameters ) {

		super( parameters );
		this.type = 'LineBasicMaterial';

	}

}

LineBasicMaterial.prototype._shading = 1;
LineBasicMaterial.prototype.isLineBasicMaterial = true;

/**
 * For `Points`: the colour (and vertex colours) as is, without lighting. `size` and
 * `sizeAttenuation` are kept but have no effect: points are one pixel, as with the
 * three.js r186 WebGPU renderer. `map` is not supported on points.
 */
export class PointsMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'PointsMaterial';
		this.size = 1;
		this.sizeAttenuation = true;
		if ( parameters ) this.setValues( parameters );

	}

}

PointsMaterial.prototype._shading = 1;
PointsMaterial.prototype.isPointsMaterial = true;

/** For `Sprite`: colour and map without lighting, `rotation` in radians, transparent by default. */
export class SpriteMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'SpriteMaterial';
		this.transparent = true;
		this.rotation = 0;
		this.sizeAttenuation = true;
		if ( parameters ) this.setValues( parameters );

	}

}

SpriteMaterial.prototype._shading = 1;
SpriteMaterial.prototype.isSpriteMaterial = true;

/** Diffuse (Lambert) lighting. */
export class MeshLambertMaterial extends Material {

	constructor( parameters ) {

		super( parameters );
		this.type = 'MeshLambertMaterial';

	}

}

/**
 * Physically based: diffuse plus a specular highlight from `roughness` and `metalness`.
 * There are no environment reflections yet, so metals look dark away from the highlight.
 */
export class MeshStandardMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshStandardMaterial';
		this.roughness = 1;
		this.metalness = 0;
		if ( parameters ) this.setValues( parameters );

	}

}

MeshStandardMaterial.prototype._shading = 2;

// ---------------------------------------------------------------- time

export class Clock {

	constructor( autoStart = true ) {

		this.autoStart = autoStart;
		this.startTime = 0;
		this.oldTime = 0;
		this.elapsedTime = 0;
		this.running = false;

	}

	start() {

		this.startTime = this.oldTime = performance.now();
		this.elapsedTime = 0;
		this.running = true;

	}

	stop() {

		this.getElapsedTime();
		this.running = this.autoStart = false;

	}

	getElapsedTime() {

		this.getDelta();
		return this.elapsedTime;

	}

	getDelta() {

		if ( this.autoStart && ! this.running ) {

			this.start();
			return 0;

		}

		if ( ! this.running ) return 0;
		const now = performance.now(), delta = ( now - this.oldTime ) / 1000;
		this.oldTime = now;
		this.elapsedTime += delta;
		return delta;

	}

}

// ---------------------------------------------------------------- not available yet

// Named so that code using them fails with a clear message instead of "not a constructor".
function missing( name, hint = '' ) {

	return class {

		constructor() {

			throw new Error( `WAMR3D: ${name} is not available yet${hint}` );

		}

	};

}

export const WebGLRenderer = missing( 'WebGLRenderer', '; use WebGPURenderer' );
export const RectAreaLight = missing( 'RectAreaLight' );
export const LineLoop = missing( 'LineLoop' );
export const SkinnedMesh = missing( 'SkinnedMesh' ), LOD = missing( 'LOD' );
export const MeshPhongMaterial = missing( 'MeshPhongMaterial', '; use MeshLambertMaterial or MeshStandardMaterial' ), MeshPhysicalMaterial = missing( 'MeshPhysicalMaterial', '; use MeshStandardMaterial' );
export const MeshToonMaterial = missing( 'MeshToonMaterial' ), MeshNormalMaterial = missing( 'MeshNormalMaterial' ), ShaderMaterial = missing( 'ShaderMaterial' );
export const IcosahedronGeometry = missing( 'IcosahedronGeometry' ), CapsuleGeometry = missing( 'CapsuleGeometry' );
export const AnimationMixer = missing( 'AnimationMixer' ), CubeTextureLoader = missing( 'CubeTextureLoader' ), ObjectLoader = missing( 'ObjectLoader' );

// ---------------------------------------------------------------- picking

export class Raycaster {

	constructor( origin = new Vector3(), direction = new Vector3( 0, 0, - 1 ), near = 0, far = Infinity ) {

		this.ray = new Ray( origin, direction );
		this.near = near;
		this.far = far;
		this.camera = null;
		this.params = { Mesh: {}, Line: { threshold: 1 }, LOD: {}, Points: { threshold: 1 }, Sprite: {} };

	}

	set( origin, direction ) {

		this.ray.set( vector( origin ), vector( direction ) );

	}

	/** `coords` are normalized device coordinates: x and y from -1 to 1, y up. */
	setFromCamera( coords, camera ) {

		const origin = new Vector3(), direction = new Vector3(), matrixWorld = camera.matrixWorld;

		if ( camera.isPerspectiveCamera ) {

			origin.setFromMatrixPosition( matrixWorld );
			direction.set( coords.x, coords.y, 0.5 ).unproject( camera ).sub( origin ).normalize();

		} else {

			origin.set( coords.x, coords.y, ( camera.near + camera.far ) / ( camera.near - camera.far ) ).unproject( camera );
			direction.set( 0, 0, - 1 ).transformDirection( matrixWorld );

		}

		this.ray.set( origin, direction );
		this.camera = camera;

	}

	intersectObject( object, recursive = true, intersects = [] ) {

		const origin = this.ray.origin, direction = this.ray.direction;
		const hits = w().raycast( object.handle, recursive, origin, direction, this.near, this.far, this.params.Line.threshold, this.params.Points.threshold );

		for ( let i = 0; i < hits.length; i ++ ) {

			const segment = hits.lineIndex( i );

			if ( segment !== undefined ) {

				intersects.push( { distance: hits.distance( i ), point: new Vector3().fromArray( hits.point( i ) ), index: segment, face: null, faceIndex: null, barycoord: null, object: objects.get( hits.object( i ) )?.deref() } );
				continue;

			}

			const face = hits.faceVertices( i ), uv = hits.uv( i ), normal = hits.normal( i );
			const hit = {
				distance: hits.distance( i ),
				point: new Vector3().fromArray( hits.point( i ) ),
				object: objects.get( hits.object( i ) )?.deref(),
				faceIndex: hits.faceIndex( i ),
				face: { a: face[ 0 ], b: face[ 1 ], c: face[ 2 ], normal: new Vector3().fromArray( hits.faceNormal( i ) ), materialIndex: 0 },
				barycoord: new Vector3().fromArray( hits.barycoord( i ) )
			};
			if ( uv ) hit.uv = new Vector2().fromArray( uv );
			if ( normal ) hit.normal = new Vector3().fromArray( normal );
			intersects.push( hit );

		}

		hits.free();
		origin.free();
		direction.free();
		return intersects.sort( ( a, b ) => a.distance - b.distance );

	}

	intersectObjects( list, recursive = true, intersects = [] ) {

		for ( const object of list ) this.intersectObject( object, recursive, intersects );
		return intersects;

	}

}

// ---------------------------------------------------------------- renderer

let frameStamp = 0;
const linear = ( { r, g, b } ) => ( { r, g, b, a: 1 } );

/** Draws a scene with WebGPU. `await renderer.init()` before the first `render`. */
export class WebGPURenderer {

	constructor( { canvas, antialias = false, powerPreference } = {} ) {

		this.domElement = canvas ?? document.createElement( 'canvas' );
		this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0 } };
		this._options = { antialias, powerPreference };
		this._pixelRatio = 1;
		this._width = this.domElement.width;
		this._height = this.domElement.height;
		this._clearColor = new Color( 0x000000 );
		this.toneMapping = NoToneMapping;
		this.toneMappingExposure = 1;
		this.shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false, type: PCFShadowMap };
		this._backend = null;
		this._frame = null;
		this._renderTarget = null;
		this._initializing = null;
		this._loop = null;

	}

	init() {

		return this._initializing ??= createBackend( this.domElement, this._options ).then( ( backend ) => {

			this._backend = backend;
			backends.add( backend );
			this._frame = new W.Renderer();
			return this;

		} );

	}

	getPixelRatio() {

		return this._pixelRatio;

	}

	setPixelRatio( value ) {

		this._pixelRatio = value;
		this.setSize( this._width, this._height, false );

	}

	setSize( width, height, updateStyle = true ) {

		this._width = width;
		this._height = height;
		this.domElement.width = Math.floor( width * this._pixelRatio );
		this.domElement.height = Math.floor( height * this._pixelRatio );

		if ( updateStyle ) {

			this.domElement.style.width = width + 'px';
			this.domElement.style.height = height + 'px';

		}

	}

	getSize( target ) {

		return target.set( this._width, this._height );

	}

	/** Draws into `target` until set back to null (the canvas). */
	setRenderTarget( target ) {

		this._renderTarget = target ?? null;

	}

	getRenderTarget() {

		return this._renderTarget;

	}

	setClearColor( color ) {

		this._clearColor.set( color );

	}

	getClearColor( target ) {

		return target.copy( this._clearColor );

	}

	render( scene, camera ) {

		if ( this._backend === null ) return;

		if ( scene.background && ! scene.background.isColor ) ignored( 'a scene background that is not a Color' );
		if ( scene.matrixWorldAutoUpdate ) scene.updateMatrixWorld();
		if ( camera.parent === null && camera.matrixWorldAutoUpdate ) camera.updateMatrixWorld();

		const sky = [ 0, 0, 0 ], ground = [ 0, 0, 0 ], frame = this._frame, MAX_LIGHTS = W.Renderer.maxLights();
		let lights = 0;
		if ( this.toneMapping === CustomToneMapping ) ignored( 'CustomToneMapping' );
		frame.setToneMapping( this.toneMapping, this.toneMappingExposure );
		const shadows = this.shadowMap.enabled === true;
		frame.setShadowsEnabled( shadows );
		if ( shadows && this.shadowMap.type !== PCFShadowMap ) ignored( 'shadowMap.type other than PCFShadowMap (drawn as PCFShadowMap)' );
		const stamp = ++ frameStamp;
		frame.clearLights();
		const stack = [ scene ];

		while ( stack.length > 0 ) {

			const object = stack.pop();
			if ( ! object._visible ) continue;

			if ( object._material !== undefined ) {

				// Materials are shared by many objects; each is sent once per frame.
				const material = object._material;

				if ( Array.isArray( material ) ) {

					for ( const each of material ) if ( each._frame !== stamp ) {

						each._frame = stamp;
						each._sync();

					}

				} else if ( material._frame !== stamp ) {

					material._frame = stamp;
					material._sync();

				}

				if ( object.isSprite ) object._syncCenter();

			} else if ( object.isLight ) {

				const { r, g, b } = object.color, k = object.intensity;

				if ( object.isDirectionalLight || object.isPointLight || object.isSpotLight ) {

					if ( ++ lights > MAX_LIGHTS ) {

						ignored( `more than ${MAX_LIGHTS} directional, point and spot lights` );

					} else {

						const from = w().matrixWorld( object.handle ), to = object.target ? w().matrixWorld( object.target.handle ) : null;
						if ( object.isDirectionalLight ) frame.addDirectionalLight( from[ 12 ] - to[ 12 ], from[ 13 ] - to[ 13 ], from[ 14 ] - to[ 14 ], r, g, b, k );
						else if ( object.isPointLight ) frame.addPointLight( from[ 12 ], from[ 13 ], from[ 14 ], r, g, b, k, object.distance, object.decay );
						else frame.addSpotLight( from[ 12 ], from[ 13 ], from[ 14 ], to[ 12 ], to[ 13 ], to[ 14 ], r, g, b, k, object.distance, object.decay, object.angle, object.penumbra );

						if ( shadows && object.castShadow ) {

							const shadow = object.shadow, c = shadow.camera, size = shadow.mapSize;
							if ( object.isPointLight ) ignored( 'shadows of point lights' );
							else if ( object.isDirectionalLight ) frame.setLastLightShadow( true, c.left, c.right, c.top, c.bottom, c.near, c.far, to[ 12 ], to[ 13 ], to[ 14 ], shadow.bias, shadow.normalBias, shadow.intensity, shadow.radius, size.width, size.height );
							else frame.setLastLightShadow( false, 2 * object.angle * shadow.focus * 180 / Math.PI, size.width / size.height * shadow.aspect, 0, 0, c.near, object.distance || c.far, to[ 12 ], to[ 13 ], to[ 14 ], shadow.bias, shadow.normalBias, shadow.intensity, shadow.radius, size.width, size.height );

						}

					}

				} else if ( object.isHemisphereLight ) {

					const c = object.groundColor;
					sky[ 0 ] += r * k; sky[ 1 ] += g * k; sky[ 2 ] += b * k;
					ground[ 0 ] += c.r * k; ground[ 1 ] += c.g * k; ground[ 2 ] += c.b * k;

				} else if ( object.isAmbientLight ) {

					sky[ 0 ] += r * k; sky[ 1 ] += g * k; sky[ 2 ] += b * k;
					ground[ 0 ] += r * k; ground[ 1 ] += g * k; ground[ 2 ] += b * k;

				}

			}

			const children = object.children;
			for ( let i = 0; i < children.length; i ++ ) stack.push( children[ i ] );

		}

		this._frame.setAmbientLight( ...sky, ...ground );

		const fog = scene.fog;
		if ( fog ) frame.setFog( fog.isFogExp2 ? 2 : 1, fog.color.r, fog.color.g, fog.color.b, fog.near ?? 0, fog.far ?? 0, fog.density ?? 0 );
		else frame.setFog( 0, 0, 0, 0, 0, 0, 0 );

		const backend = this._backend;
		const rt = this._renderTarget, texture = rt?.texture;
		const target = rt ? { id: texture.id, width: Math.max( 1, rt.width | 0 ), height: Math.max( 1, rt.height | 0 ), samples: rt.samples, type: texture.type === UnsignedByteType ? 'byte' : 'float', texture } : null;
		backend.render( w(), this._frame, scene.handle, camera.handle, linear( scene.background && scene.background.isColor ? scene.background : this._clearColor ), textureSources, instanceSources, target );
		this.info.render.calls = backend.info.calls;
		this.info.render.triangles = backend.info.triangles;
		this.info.memory.geometries = backend.info.geometries;

	}

	async renderAsync( scene, camera ) {

		await this.init();
		this.render( scene, camera );

	}

	/** Calls `callback( time )` every animation frame; pass null to stop. */
	setAnimationLoop( callback ) {

		this._loop = callback;
		if ( callback === null ) return;
		this.init();

		const tick = ( time ) => {

			if ( this._loop !== callback ) return;
			requestAnimationFrame( tick );
			if ( this._backend !== null ) callback( time );

		};

		requestAnimationFrame( tick );

	}

	dispose() {

		this._loop = null;
		backends.delete( this._backend );
		this._backend?.dispose();
		this._frame?.free();
		this._backend = this._frame = null;

	}

}

WebGPURenderer.prototype.isWebGPURenderer = true;
