// Attributes and geometries.

import * as W from '../index.js';
import { GEOMETRY, finalizer, lazyUUID, w } from './engine.js';
import { Box3, Matrix4, Sphere, Vector3 } from './math.js';

// ---------------------------------------------------------------- geometry

function toFloat32( array ) {

	return array instanceof Float32Array ? array : Float32Array.from( array );

}

function toUint32( array ) {

	return array instanceof Uint32Array ? array : Uint32Array.from( array );

}

// Integer arrays marked `normalized` read as 0..1 (unsigned) or -1..1 (signed), as the GPU
// reads them: the divisor, and whether the type is signed.
const NORMALIZED = new Map( [
	[ Uint8Array, [ 255, false ] ], [ Uint8ClampedArray, [ 255, false ] ], [ Int8Array, [ 127, true ] ],
	[ Uint16Array, [ 65535, false ] ], [ Int16Array, [ 32767, true ] ], [ Uint32Array, [ 4294967295, false ] ], [ Int32Array, [ 2147483647, true ] ]
] );

function denormalize( value, array ) {

	const [ divisor, signed ] = NORMALIZED.get( array.constructor ) ?? [ 1, false ];
	return signed ? Math.max( value / divisor, - 1 ) : value / divisor;

}

function normalize( value, array ) {

	const [ divisor ] = NORMALIZED.get( array.constructor ) ?? [ 1 ];
	return Math.round( value * divisor );

}

// The floats the engine stores for an attribute: its items in order (gathered from an
// interleaved buffer), normalized values mapped as the GPU would.
function attributeFloats( attribute ) {

	const interleaved = attribute.isInterleavedBufferAttribute === true;
	const source = interleaved ? attribute.data.array : attribute.array;
	const scale = attribute.normalized && NORMALIZED.has( source.constructor );
	if ( ! interleaved && ! scale ) return toFloat32( source );

	const { itemSize, count } = attribute, out = new Float32Array( count * itemSize );
	const stride = interleaved ? attribute.data.stride : itemSize, offset = interleaved ? attribute.offset : 0;

	for ( let i = 0, o = 0; i < count; i ++ ) {

		for ( let k = 0, j = i * stride + offset; k < itemSize; k ++, j ++ ) out[ o ++ ] = scale ? denormalize( source[ j ], source ) : source[ j ];

	}

	return out;

}

// Component accessors shared by `BufferAttribute` and `InterleavedBufferAttribute`;
// `_at( index )` is where an item starts in `array`. Normalized values are converted as
// in three.js.
const ACCESSORS = {

	getComponent( index, component ) {

		const value = this.array[ this._at( index ) + component ];
		return this.normalized ? denormalize( value, this.array ) : value;

	},

	setComponent( index, component, value ) {

		this.array[ this._at( index ) + component ] = this.normalized ? normalize( value, this.array ) : value;
		return this;

	},

	getX( index ) {

		return this.getComponent( index, 0 );

	},

	getY( index ) {

		return this.getComponent( index, 1 );

	},

	getZ( index ) {

		return this.getComponent( index, 2 );

	},

	getW( index ) {

		return this.getComponent( index, 3 );

	},

	setX( index, x ) {

		return this.setComponent( index, 0, x );

	},

	setY( index, y ) {

		return this.setComponent( index, 1, y );

	},

	setZ( index, z ) {

		return this.setComponent( index, 2, z );

	},

	setW( index, w_ ) {

		return this.setComponent( index, 3, w_ );

	},

	setXY( index, x, y ) {

		return this.setComponent( index, 0, x ).setComponent( index, 1, y );

	},

	setXYZ( index, x, y, z ) {

		return this.setComponent( index, 0, x ).setComponent( index, 1, y ).setComponent( index, 2, z );

	},

	setXYZW( index, x, y, z, w_ ) {

		return this.setComponent( index, 0, x ).setComponent( index, 1, y ).setComponent( index, 2, z ).setComponent( index, 3, w_ );

	}

};

// Sends an attribute's current data to the geometry it is set on.
function pushAttribute( attribute ) {

	if ( attribute._geometry === null ) return;
	const handle = attribute._geometry.handle;

	if ( attribute._name === 'index' ) {

		w().setIndex( handle, toUint32( attribute.array ) );

	} else {

		W.attributeView( w(), handle, attribute._name ).set( attributeFloats( attribute ) );
		w().markAttributeNeedsUpdate( handle, attribute._name );

	}

}

export class BufferAttribute {

	constructor( array, itemSize, normalized = false ) {

		this.name = '';
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
		pushAttribute( this );

	}

	_at( index ) {

		return index * this.itemSize;

	}

	setUsage() {

		return this;

	}

	/** A new attribute with a copy of the array, not attached to any geometry. */
	clone() {

		return new this.constructor( this.array.slice(), this.itemSize, this.normalized );

	}

}

Object.assign( BufferAttribute.prototype, ACCESSORS );
BufferAttribute.prototype.isBufferAttribute = true;

/**
 * Several attributes packed in one array, `stride` numbers per vertex. The engine keeps
 * each attribute separately: setting `needsUpdate` sends every attribute that uses it again.
 */
export class InterleavedBuffer {

	constructor( array, stride ) {

		this.array = array;
		this.stride = stride;
		this.count = array.length / stride;
		this.version = 0;
		this._users = new Set();

	}

	set needsUpdate( value ) {

		if ( ! value ) return;
		this.version ++;
		for ( const attribute of this._users ) pushAttribute( attribute );

	}

	setUsage() {

		return this;

	}

	set( value, offset = 0 ) {

		this.array.set( value, offset );
		return this;

	}

	clone() {

		return new InterleavedBuffer( this.array.slice(), this.stride );

	}

}

InterleavedBuffer.prototype.isInterleavedBuffer = true;

/** `itemSize` numbers per vertex, starting `offset` numbers into each vertex of `interleavedBuffer`. */
export class InterleavedBufferAttribute {

	constructor( interleavedBuffer, itemSize, offset, normalized = false ) {

		this.name = '';
		this.data = interleavedBuffer;
		this.itemSize = itemSize;
		this.offset = offset;
		this.normalized = normalized;
		this._geometry = null;
		this._name = '';

	}

	get count() {

		return this.data.count;

	}

	get array() {

		return this.data.array;

	}

	set needsUpdate( value ) {

		this.data.needsUpdate = value;

	}

	_at( index ) {

		return index * this.data.stride + this.offset;

	}

	/** A plain `BufferAttribute` with this attribute's values, as three.js's `clone()` without arguments gives. */
	clone() {

		const array = new this.array.constructor( this.count * this.itemSize );
		for ( let i = 0, o = 0; i < this.count; i ++ ) for ( let k = 0; k < this.itemSize; k ++ ) array[ o ++ ] = this.array[ this._at( i ) + k ];
		return new BufferAttribute( array, this.itemSize, this.normalized );

	}

}

Object.assign( InterleavedBufferAttribute.prototype, ACCESSORS );
InterleavedBufferAttribute.prototype.isInterleavedBufferAttribute = true;

function typedAttribute( TypedArray ) {

	return class extends BufferAttribute {

		constructor( array, itemSize, normalized ) {

			super( array instanceof TypedArray ? array : new TypedArray( array ), itemSize, normalized );

		}

	};

}

export const Float32BufferAttribute = typedAttribute( Float32Array );
export const Int8BufferAttribute = typedAttribute( Int8Array ), Uint8BufferAttribute = typedAttribute( Uint8Array ), Uint8ClampedBufferAttribute = typedAttribute( Uint8ClampedArray );
export const Int16BufferAttribute = typedAttribute( Int16Array ), Uint16BufferAttribute = typedAttribute( Uint16Array );
export const Int32BufferAttribute = typedAttribute( Int32Array ), Uint32BufferAttribute = typedAttribute( Uint32Array );

const ADOPT = Symbol( 'adopt' );

export class BufferGeometry {

	constructor( key, handle ) {

		this.handle = key === ADOPT ? handle : w().createGeometry();
		this.type = 'BufferGeometry';
		this.name = '';
		this.drawRange = { start: 0, count: Infinity };
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

	/** Integer data is stored as floats (normalized when the attribute says so); interleaved data is copied out per attribute. */
	setAttribute( name, attribute ) {

		w().setAttribute( this.handle, name, attributeFloats( attribute ), attribute.itemSize );
		attribute._geometry = this;
		attribute._name = name;
		if ( attribute.isInterleavedBufferAttribute ) attribute.data._users.add( attribute );
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

		this.drawRange.start = start;
		this.drawRange.count = count;
		// the engine counts in 32 bits; Infinity means everything
		w().setDrawRange( this.handle, start, Math.min( count, 0xffffffff ) );

	}

	deleteAttribute( name ) {

		w().deleteAttribute( this.handle, name );
		delete this.attributes[ name ];
		return this;

	}

	clearGroups() {

		w().clearGroups( this.handle );
		this.groups = [];

	}

	/** Positions from an array of `Vector2` or `Vector3`, as three.js does. */
	setFromPoints( points ) {

		const position = this.attributes.position;

		if ( position === undefined ) {

			const array = new Float32Array( points.length * 3 );
			points.forEach( ( p, i ) => array.set( [ p.x, p.y, p.z || 0 ], i * 3 ) );
			return this.setAttribute( 'position', new Float32BufferAttribute( array, 3 ) );

		}

		const count = Math.min( points.length, position.count );
		for ( let i = 0; i < count; i ++ ) position.setXYZ( i, points[ i ].x, points[ i ].y, points[ i ].z || 0 );
		if ( points.length > position.count ) console.warn( 'WAMR3D: BufferGeometry: buffer size too small for points data. Use .dispose() and create a new geometry.' );
		position.needsUpdate = true;
		return this;

	}

	/** Copies attributes (as new arrays), index, groups, draw range, bounding volumes and `userData`. */
	copy( source ) {

		if ( source.index === null && this.index !== null ) throw new Error( 'WAMR3D: removing an index is not supported; copy into a new BufferGeometry' );
		for ( const name of Object.keys( this.attributes ) ) if ( source.attributes[ name ] === undefined ) this.deleteAttribute( name );
		this.name = source.name;
		if ( source.index !== null ) this.setIndex( source.index.clone() );
		for ( const [ name, attribute ] of Object.entries( source.attributes ) ) this.setAttribute( name, attribute.clone() );
		this.clearGroups();
		for ( const group of source.groups ) this.addGroup( group.start, group.count, group.materialIndex );
		this.boundingBox = source.boundingBox && source.boundingBox.clone();
		this.boundingSphere = source.boundingSphere && source.boundingSphere.clone();
		this.setDrawRange( source.drawRange.start, source.drawRange.count );
		this.userData = JSON.parse( JSON.stringify( source.userData ) );
		if ( source.parameters ) this.parameters = { ...source.parameters };
		return this;

	}

	/** A copy; built-in shapes are rebuilt from their `parameters` and keep their class. */
	clone() {

		const copy = this.parameters ? new this.constructor( ...Object.values( this.parameters ) ) : new this.constructor();
		return copy.copy( this );

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
lazyUUID( BufferGeometry );

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
