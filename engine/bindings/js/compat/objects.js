// Meshes, instancing, lines, points, sprites, levels of detail and the helpers.

import { hosted, instanceSources, w, world } from './engine.js';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from './geometry.js';
import { LineBasicMaterial, MeshBasicMaterial, PointsMaterial, SpriteMaterial } from './materials.js';
import { Box3, Color, Matrix4, Quaternion, Sphere, Vector2, Vector3, Vector4, boxNumbers, expandByTransformedBox, setBox } from './math.js';
import * as W from '../index.js';
import { Object3D } from './object3d.js';

export class Mesh extends Object3D {

	constructor( geometry = new BufferGeometry(), material = new MeshBasicMaterial() ) {

		super();
		this.type = 'Mesh';
		this._geometry = geometry;
		this._material = material;
		this._morphed = 0;
		this._link();
		this.updateMorphTargets();

	}

	get geometry() {

		return this._geometry;

	}

	set geometry( value ) {

		this._geometry = value;
		this._link();
		this.updateMorphTargets();

	}

	get material() {

		return this._material;

	}

	set material( value ) {

		this._material = value;
		this._link();

	}

	/** Sets `morphTargetInfluences` and `morphTargetDictionary` from the geometry's morph targets, as three.js does. */
	updateMorphTargets() {

		const morphAttributes = this._geometry.morphAttributes ?? {}, keys = Object.keys( morphAttributes );
		if ( keys.length === 0 ) return;
		const targets = morphAttributes[ keys[ 0 ] ];
		if ( targets === undefined ) return;
		this.morphTargetInfluences = [];
		this.morphTargetDictionary = {};

		for ( let m = 0; m < targets.length; m ++ ) {

			const name = targets[ m ].name || String( m );
			this.morphTargetInfluences.push( 0 );
			this.morphTargetDictionary[ name ] = m;

		}

	}

	// Blends the morph targets into the mesh's own copy of the geometry when the weights or
	// targets changed. Called by the renderer before drawing.
	_syncMorph() {

		const geometry = this._geometry, influences = this.morphTargetInfluences;
		const active = influences !== undefined && influences.length > 0 && geometry._hasMorphs?.();

		if ( ! active ) {

			if ( this._morphed !== 0 ) {

				w().disposeGeometry( this._morphed );
				this._morphed = this._token.morphed = 0;
				this._link();

			}

			return;

		}

		geometry._syncMorphAttributes();
		let sent = this._sentInfluences;

		if ( this._morphed === 0 ) {

			this._morphed = this._token.morphed = w().createGeometry();
			sent = null;
			this._link();

		}

		let changed = ! sent || sent.length !== influences.length || this._morphStamp !== geometry._morphStamp || this._morphRelative !== geometry.morphTargetsRelative;
		for ( let i = 0; ! changed && i < influences.length; i ++ ) changed = sent[ i ] !== influences[ i ];
		if ( ! changed ) return;
		this._sentInfluences = Float32Array.from( influences );
		this._morphStamp = geometry._morphStamp;
		this._morphRelative = geometry.morphTargetsRelative;
		w().morphGeometry( geometry.handle, this._morphed, this._sentInfluences, geometry.morphTargetsRelative );

	}

	// An array of materials draws each geometry group with the material at its
	// `materialIndex`. Assign a new array to change it; edits in place are not seen.
	_link() {

		const material = this._material, list = Array.isArray( material );
		w().setRenderable( this.handle, this._morphed !== 0 && this._morphed !== undefined ? this._morphed : this._geometry.handle, ( list ? material[ 0 ] : material ).handle );
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


// ---------------------------------------------------------------- skinning

/** A joint of a skeleton: an ordinary object that skinned vertices follow. */
export class Bone extends Object3D {

	constructor() {

		super();
		this.type = 'Bone';

	}

}

Bone.prototype.isBone = true;

const _offset = new Matrix4(), _inverse = new Matrix4(), _position = new Vector3(), _quaternion = new Quaternion(), _scale = new Vector3();

/**
 * Bones and their inverse bind matrices. The engine computes the skinning matrices
 * from the bones' world matrices each frame; `update()` fills `boneMatrices` for code
 * that reads them.
 */
export class Skeleton {

	constructor( bones = [], boneInverses = [] ) {

		this.uuid = W.MathUtils.generateUUID();
		this.bones = bones.slice( 0 );
		this.boneInverses = boneInverses;
		this.boneMatrices = null;
		this.boneTexture = null;
		this._version = 0;
		this.init();

	}

	init() {

		const bones = this.bones, inverses = this.boneInverses;
		this.boneMatrices = new Float32Array( bones.length * 16 );

		if ( inverses.length === 0 ) {

			this.calculateInverses();

		} else if ( bones.length !== inverses.length ) {

			console.warn( 'WAMR3D: Skeleton: the number of inverse bone matrices does not match the number of bones.' );
			this.boneInverses = bones.map( () => new Matrix4() );

		}

		this._version ++;

	}

	/** The inverse bind matrices from the bones' current world matrices. */
	calculateInverses() {

		this.boneInverses = this.bones.map( ( bone ) => ( bone ? bone.matrixWorld.clone().invert() : new Matrix4() ) );
		this._version ++;

	}

	/** Moves the bones back to the bind pose. */
	pose() {

		const worlds = new Map();
		this.bones.forEach( ( bone, i ) => {

			if ( bone ) worlds.set( bone, this.boneInverses[ i ].clone().invert() );

		} );

		for ( const bone of this.bones ) {

			if ( ! bone ) continue;
			const parent = bone.parent, world = worlds.get( bone );
			const local = parent ? _offset.copy( worlds.get( parent ) ?? parent.matrixWorld ).invert().multiply( world ) : _offset.copy( world );
			local.decompose( _position, _quaternion, _scale );
			bone.position.copy( _position );
			bone.quaternion.copy( _quaternion );
			bone.scale.copy( _scale );

		}

	}

	/** Fills `boneMatrices` with each bone's world matrix times its inverse bind matrix. */
	update() {

		const matrices = this.boneMatrices;

		this.bones.forEach( ( bone, i ) => {

			_offset.multiplyMatrices( bone ? bone.matrixWorld : _inverse.identity(), this.boneInverses[ i ] );
			_offset.toArray( matrices, i * 16 );

		} );

	}

	clone() {

		return new Skeleton( this.bones, this.boneInverses );

	}

	/** The bones are drawn from a texture the renderer keeps; there is nothing to make. */
	computeBoneTexture() {

		return this;

	}

	getBoneByName( name ) {

		return this.bones.find( ( bone ) => bone.name === name );

	}

	dispose() {}

}

/**
 * A mesh deformed by the bones of its `skeleton`, weighted by the geometry's `skinIndex`
 * and `skinWeight` attributes. Skinned on the GPU; raycasts test the posed triangles.
 * Skinned meshes are not frustum-culled.
 */
export class SkinnedMesh extends Mesh {

	constructor( geometry, material ) {

		super( geometry, material );
		this.type = 'SkinnedMesh';
		this.bindMode = 'attached';
		this.bindMatrix = new Matrix4();
		this.bindMatrixInverse = new Matrix4();
		this.skeleton = undefined;
		this.boundingBox = null;
		this.boundingSphere = null;
		this._skinKey = '';

	}

	bind( skeleton, bindMatrix ) {

		this.skeleton = skeleton;

		if ( bindMatrix === undefined ) {

			this.updateMatrixWorld( true );
			this.skeleton.calculateInverses();
			bindMatrix = this.matrixWorld;

		}

		this.bindMatrix.copy( bindMatrix );
		this.bindMatrixInverse.copy( bindMatrix ).invert();
		this._skinKey = '';

	}

	pose() {

		this.skeleton.pose();

	}

	/** Scales each vertex's weights to sum to 1. */
	normalizeSkinWeights() {

		const weights = this.geometry.attributes.skinWeight, vector = new Vector4();

		for ( let i = 0; i < weights.count; i ++ ) {

			vector.fromBufferAttribute( weights, i );
			const scale = 1.0 / vector.manhattanLength();
			if ( scale !== Infinity ) vector.multiplyScalar( scale );
			else vector.set( 1, 0, 0, 0 );
			weights.setXYZW( i, vector.x, vector.y, vector.z, vector.w );

		}

		weights.needsUpdate = true;

	}

	// Sends the skeleton when it or the bind matrices changed. Called by the renderer.
	_syncSkin() {

		const skeleton = this.skeleton;
		if ( ! skeleton ) return;
		const bindMatrix = this.bindMatrix.elements;
		const key = skeleton.uuid + ':' + skeleton._version + ':' + skeleton.bones.length + ':' + this.bindMode + ':' + bindMatrix.join( ',' );
		if ( key === this._skinKey ) return;
		this._skinKey = key;
		const bones = BigUint64Array.from( skeleton.bones, ( bone ) => ( bone ? bone.handle : 0n ) );
		const inverses = new Float32Array( skeleton.bones.length * 16 );
		skeleton.boneInverses.forEach( ( matrix, i ) => matrix.toArray( inverses, i * 16 ) );
		w().setSkin( this.handle, bones, inverses, Float32Array.from( bindMatrix ), Float32Array.from( this.bindMatrixInverse.elements ), this.bindMode === 'detached' );

	}

	/** The position of vertex `index` in the current pose, in the mesh's local space (three.js `applyBoneTransform`). */
	applyBoneTransform( index, target ) {

		this._syncSkin();
		const matrices = w().skinMatrices( this.handle ), geometry = this.geometry;
		const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
		const x = target.x, y = target.y, z = target.z;
		let px = 0, py = 0, pz = 0;

		for ( let k = 0; k < 4; k ++ ) {

			const weight = skinWeight.getComponent( index, k );
			if ( weight === 0 ) continue;
			const o = skinIndex.getComponent( index, k ) * 16;
			px += weight * ( matrices[ o ] * x + matrices[ o + 4 ] * y + matrices[ o + 8 ] * z + matrices[ o + 12 ] );
			py += weight * ( matrices[ o + 1 ] * x + matrices[ o + 5 ] * y + matrices[ o + 9 ] * z + matrices[ o + 13 ] );
			pz += weight * ( matrices[ o + 2 ] * x + matrices[ o + 6 ] * y + matrices[ o + 10 ] * z + matrices[ o + 14 ] );

		}

		return target.set( px, py, pz );

	}

	/** The local box around the posed vertices. */
	computeBoundingBox() {

		const position = this.geometry.attributes.position, point = new Vector3();
		this.boundingBox ??= new Box3();
		this.boundingBox.makeEmpty();

		for ( let i = 0; i < position.count; i ++ ) {

			point.fromBufferAttribute( position, i );
			this.boundingBox.expandByPoint( this.applyBoneTransform( i, point ) );

		}

	}

	/** The local sphere around the posed vertices. */
	computeBoundingSphere() {

		const position = this.geometry.attributes.position, point = new Vector3();
		this.computeBoundingBox();
		this.boundingSphere ??= new Sphere();
		this.boundingBox.getCenter( this.boundingSphere.center );
		let radius = 0;

		for ( let i = 0; i < position.count; i ++ ) {

			point.fromBufferAttribute( position, i );
			radius = Math.max( radius, this.boundingSphere.center.distanceToSquared( this.applyBoneTransform( i, point ) ) );

		}

		this.boundingSphere.radius = Math.sqrt( radius );

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.bindMode = source.bindMode;
		this.bindMatrix.copy( source.bindMatrix );
		this.bindMatrixInverse.copy( source.bindMatrixInverse );
		this.skeleton = source.skeleton;
		this._skinKey = '';
		return this;

	}

	dispose() {

		w().clearSkin( this.handle );
		super.dispose();

	}

}

SkinnedMesh.prototype.isSkinnedMesh = true;
