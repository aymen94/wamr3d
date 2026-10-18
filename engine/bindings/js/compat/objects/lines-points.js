// Lines, line segments and loops, points and sprites.
//
// Part of the drawable objects; `../objects.js` gathers them.

import { hosted, w } from '../engine.js';
import { BufferGeometry, Float32BufferAttribute } from '../geometry.js';
import { LineBasicMaterial, PointsMaterial, SpriteMaterial } from '../materials.js';
import { Vector2 } from '../math.js';
import { Object3D } from '../object3d.js';

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
 * One point per vertex. As with the three.js WebGPU renderer, points are one pixel
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

/** A quad that always faces the camera, sized by its scale. `Raycaster` needs its `camera` (set by `setFromCamera`) to pick it. */
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
		hosted.count ++;
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

/** A line through the geometry's vertices and back to the first. Lines are one pixel wide. */
export class LineLoop extends Line {

	constructor( geometry, material ) {

		super( geometry, material );
		this.type = 'LineLoop';

	}

	_link() {

		w().setLineLoop( this.handle, this._geometry.handle, this._material.handle );

	}

}

LineLoop.prototype.isLineLoop = true;
