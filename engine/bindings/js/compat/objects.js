// Meshes, instancing, lines, points, sprites, levels of detail and the helpers.

import { hosted, instanceSources, w, world } from './engine.js';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from './geometry.js';
import { LineBasicMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial } from './materials.js';
import { Box3, Color, Vector2, boxNumbers, expandByTransformedBox, setBox } from './math.js';
import { Object3D } from './object3d.js';

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

let nextInstanceId = 1;

/**
 * Draws one geometry `count` times, each with its own matrix (and optionally colour),
 * in a single draw call. Instances are not culled one by one. `Raycaster` tests each
 * instance and reports its `instanceId`.
 */
export class InstancedMesh extends Mesh {

	constructor( geometry, material, count ) {

		super( geometry, material );
		this.type = 'InstancedMesh';
		this._instances = new InstanceData( count );
		this._capacity = count;
		this._count = count;
		this.boundingBox = null;
		hosted.count ++;
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

	/** The local box around every drawn instance; kept in `boundingBox`. */
	computeBoundingBox() {

		const geometry = this.geometry, matrices = this._instances.matrices.array;
		if ( geometry.boundingBox === null ) geometry.computeBoundingBox();
		const box = boxNumbers( geometry.boundingBox ), bounds = [ Infinity, Infinity, Infinity, - Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < this._count; i ++ ) expandByTransformedBox( bounds, box, matrices, i * 16 );
		setBox( this.boundingBox ??= new Box3(), bounds );

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

/**
 * Shows one of its levels by distance from the camera. With `autoUpdate` (the default)
 * the renderer calls `update( camera )` before drawing.
 */
export class LOD extends Object3D {

	constructor() {

		super();
		this.type = 'LOD';
		this._currentLevel = 0;
		Object.defineProperty( this, 'levels', { enumerable: true, value: [] } );
		this.autoUpdate = true;

	}

	copy( source ) {

		super.copy( source, false );
		for ( const level of source.levels ) this.addLevel( level.object.clone(), level.distance, level.hysteresis );
		this.autoUpdate = source.autoUpdate;
		return this;

	}

	addLevel( object, distance = 0, hysteresis = 0 ) {

		distance = Math.abs( distance );
		const levels = this.levels;
		let l;
		for ( l = 0; l < levels.length; l ++ ) if ( distance < levels[ l ].distance ) break;
		levels.splice( l, 0, { distance, hysteresis, object } );
		this.add( object );
		return this;

	}

	removeLevel( distance ) {

		const levels = this.levels;

		for ( let i = 0; i < levels.length; i ++ ) {

			if ( levels[ i ].distance === distance ) {

				const [ removed ] = levels.splice( i, 1 );
				this.remove( removed.object );
				return true;

			}

		}

		return false;

	}

	getCurrentLevel() {

		return this._currentLevel;

	}

	getObjectForDistance( distance ) {

		const levels = this.levels;
		if ( levels.length === 0 ) return null;
		let i;

		for ( i = 1; i < levels.length; i ++ ) {

			let levelDistance = levels[ i ].distance;
			if ( levels[ i ].object.visible ) levelDistance -= levelDistance * levels[ i ].hysteresis;
			if ( distance < levelDistance ) break;

		}

		return levels[ i - 1 ].object;

	}

	update( camera ) {

		const levels = this.levels;
		if ( levels.length <= 1 ) return;

		const a = w().matrixWorld( camera.handle ), b = world.matrixWorld( this.handle );
		const distance = Math.hypot( a[ 12 ] - b[ 12 ], a[ 13 ] - b[ 13 ], a[ 14 ] - b[ 14 ] ) / camera.zoom;
		levels[ 0 ].object.visible = true;
		let i;

		for ( i = 1; i < levels.length; i ++ ) {

			let levelDistance = levels[ i ].distance;
			if ( levels[ i ].object.visible ) levelDistance -= levelDistance * levels[ i ].hysteresis;
			if ( distance < levelDistance ) break;
			levels[ i - 1 ].object.visible = false;
			levels[ i ].object.visible = true;

		}

		this._currentLevel = i - 1;
		for ( ; i < levels.length; i ++ ) levels[ i ].object.visible = false;

	}

}

LOD.prototype.isLOD = true;

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
