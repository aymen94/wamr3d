// Object3D, groups, scenes and fog.

import * as W from '../index.js';
import { ALL_PARTS, OBJECT, POSITION, QUATERNION, ROTATION, SCALE, UP, finalizer, lazyUUID, objects, peek, readFloats, readStamp, touched, w, world } from './engine.js';
import { Color, Euler, Matrix4, Quaternion, Vector3, engineVector } from './math.js';
import { withEvents } from './events.js';
import { BoundEuler, BoundLayers, BoundQuaternion, BoundVector3 } from './transform.js';

const AXES = {};

function axis( name ) {

	return AXES[ name ] ??= new Vector3( name === 'x' ? 1 : 0, name === 'y' ? 1 : 0, name === 'z' ? 1 : 0 );

}

let nextId = 1;
const readout = [ 0, 0, 0, 0 ];

// A world-space value of `object` (0 position, 1 quaternion, 2 scale, 3 direction) into
// `target`, read from the engine without allocating.
function worldValue( object, what, target ) {

	if ( ! readFloats( w().worldValuePtr( object.handle, what ), readout, what === 1 ? 4 : 3 ) ) throw new Error( 'WAMR3D: object handle is not alive' );
	return target.fromArray( readout );

}


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
		this._matrixWorldStamp = - 1;
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
		if ( ! value ) readFloats( w().matrixPtr( this.handle ), ( this._matrix ??= new Matrix4() ).elements, 16 );
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

			readFloats( w().matrixPtr( this.handle ), matrix.elements, 16 );

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

		const matrix = this._matrixWorld ??= new Matrix4(), stamp = readStamp();

		// read again only when the engine may have changed it since the last read; world
		// matrices change only through engine calls, not through pending transform writes
		if ( stamp === 0 || stamp !== this._matrixWorldStamp ) {

			readFloats( peek().matrixWorldPtr( this.handle ), matrix.elements, 16 );
			this._matrixWorldStamp = stamp;

		}

		return matrix;

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

		w().rotateOnAxis( this.handle, engineVector( axis_ ), angle );
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

		w().translateOnAxis( this.handle, engineVector( axis_ ), distance );
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

		return worldValue( this, 0, target );

	}

	getWorldQuaternion( target = new Quaternion() ) {

		return worldValue( this, 1, target );

	}

	getWorldScale( target = new Vector3() ) {

		return worldValue( this, 2, target );

	}

	getWorldDirection( target = new Vector3() ) {

		return worldValue( this, 3, target );

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
withEvents( Object3D );
lazyUUID( Object3D );

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
		// An equirectangular texture that lights standard materials without an `envMap`.
		this.environment = null;
		this.environmentIntensity = 1;
		this.environmentRotation = new Euler();
		this.backgroundBlurriness = 0;
		this.backgroundIntensity = 1;
		this.backgroundRotation = new Euler();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.background = source.background && ( source.background.isColor ? source.background.clone() : source.background );
		this.environment = source.environment;
		this.fog = source.fog && source.fog.clone();
		this.environmentIntensity = source.environmentIntensity;
		this.environmentRotation.copy( source.environmentRotation );
		this.backgroundBlurriness = source.backgroundBlurriness;
		this.backgroundIntensity = source.backgroundIntensity;
		this.backgroundRotation.copy( source.backgroundRotation );
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
