// Vector2, Vector3, Vector4, Quaternion, Euler, Matrix3 and Matrix4.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { AttributeLike, Elements, EulerLike, EulerOrder, QuatLike, Vec3Like } from './core.js';
import { Camera } from './objects.js';

export class Vector2 {

	constructor( x?: number, y?: number );
	readonly isVector2: true;
	x: number;
	y: number;
	/** Same as `x`. */
	width: number;
	/** Same as `y`. */
	height: number;
	set( x: number, y: number ): this;
	setScalar( s: number ): this;
	setX( x: number ): this;
	setY( y: number ): this;
	setComponent( index: number, value: number ): this;
	getComponent( index: number ): number;
	clone(): Vector2;
	copy( v: { x: number; y: number } ): this;
	add( v: Vector2 ): this;
	addScalar( s: number ): this;
	addVectors( a: Vector2, b: Vector2 ): this;
	addScaledVector( v: Vector2, s: number ): this;
	sub( v: Vector2 ): this;
	subScalar( s: number ): this;
	subVectors( a: Vector2, b: Vector2 ): this;
	multiply( v: Vector2 ): this;
	multiplyScalar( s: number ): this;
	divide( v: Vector2 ): this;
	divideScalar( s: number ): this;
	applyMatrix3( m: Matrix3 ): this;
	min( v: Vector2 ): this;
	max( v: Vector2 ): this;
	clamp( min: Vector2, max: Vector2 ): this;
	clampScalar( min: number, max: number ): this;
	clampLength( min: number, max: number ): this;
	floor(): this;
	ceil(): this;
	round(): this;
	roundToZero(): this;
	negate(): this;
	dot( v: Vector2 ): number;
	cross( v: Vector2 ): number;
	lengthSq(): number;
	length(): number;
	manhattanLength(): number;
	normalize(): this;
	angle(): number;
	angleTo( v: Vector2 ): number;
	distanceTo( v: Vector2 ): number;
	distanceToSquared( v: Vector2 ): number;
	manhattanDistanceTo( v: Vector2 ): number;
	setLength( length: number ): this;
	lerp( v: Vector2, alpha: number ): this;
	lerpVectors( v1: Vector2, v2: Vector2, alpha: number ): this;
	equals( v: Vector2 ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	fromBufferAttribute( attribute: AttributeLike, index: number ): this;
	rotateAround( center: Vector2, angle: number ): this;
	random(): this;
	[ Symbol.iterator ](): Iterator<number>;

}

export class Vector3 {

	constructor( x?: number, y?: number, z?: number );
	readonly isVector3: true;
	x: number;
	y: number;
	z: number;
	/** Without `z`, keeps the current `z`. */
	set( x: number, y: number, z?: number ): this;
	setScalar( s: number ): this;
	setX( x: number ): this;
	setY( y: number ): this;
	setZ( z: number ): this;
	setComponent( index: number, value: number ): this;
	getComponent( index: number ): number;
	clone(): Vector3;
	copy( v: Vec3Like ): this;
	add( v: Vec3Like ): this;
	addScalar( s: number ): this;
	addVectors( a: Vec3Like, b: Vec3Like ): this;
	addScaledVector( v: Vec3Like, s: number ): this;
	sub( v: Vec3Like ): this;
	subScalar( s: number ): this;
	subVectors( a: Vec3Like, b: Vec3Like ): this;
	multiply( v: Vec3Like ): this;
	multiplyScalar( s: number ): this;
	multiplyVectors( a: Vec3Like, b: Vec3Like ): this;
	applyEuler( euler: EulerLike ): this;
	applyAxisAngle( axis: Vec3Like, angle: number ): this;
	applyMatrix3( m: Elements ): this;
	applyNormalMatrix( m: Elements ): this;
	applyMatrix4( m: Elements ): this;
	applyQuaternion( q: QuatLike ): this;
	project( camera: Camera ): this;
	unproject( camera: Camera ): this;
	transformDirection( m: Elements ): this;
	divide( v: Vec3Like ): this;
	divideScalar( s: number ): this;
	min( v: Vec3Like ): this;
	max( v: Vec3Like ): this;
	clamp( min: Vec3Like, max: Vec3Like ): this;
	clampScalar( min: number, max: number ): this;
	clampLength( min: number, max: number ): this;
	floor(): this;
	ceil(): this;
	round(): this;
	roundToZero(): this;
	negate(): this;
	dot( v: Vec3Like ): number;
	lengthSq(): number;
	length(): number;
	manhattanLength(): number;
	normalize(): this;
	setLength( length: number ): this;
	lerp( v: Vec3Like, alpha: number ): this;
	lerpVectors( v1: Vec3Like, v2: Vec3Like, alpha: number ): this;
	cross( v: Vec3Like ): this;
	crossVectors( a: Vec3Like, b: Vec3Like ): this;
	projectOnVector( v: Vector3 ): this;
	projectOnPlane( planeNormal: Vector3 ): this;
	reflect( normal: Vec3Like ): this;
	angleTo( v: Vector3 ): number;
	distanceTo( v: Vec3Like ): number;
	distanceToSquared( v: Vec3Like ): number;
	manhattanDistanceTo( v: Vec3Like ): number;
	setFromSpherical( s: { radius: number; phi: number; theta: number } ): this;
	setFromSphericalCoords( radius: number, phi: number, theta: number ): this;
	setFromCylindrical( c: { radius: number; theta: number; y: number } ): this;
	setFromCylindricalCoords( radius: number, theta: number, y: number ): this;
	setFromMatrixPosition( m: Elements ): this;
	setFromMatrixScale( m: Elements ): this;
	setFromMatrixColumn( m: Elements, index: number ): this;
	setFromMatrix3Column( m: Elements, index: number ): this;
	setFromEuler( e: EulerLike ): this;
	setFromColor( c: { r: number; g: number; b: number } ): this;
	equals( v: Vec3Like ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	fromBufferAttribute( attribute: AttributeLike, index: number ): this;
	random(): this;
	randomDirection(): this;
	[ Symbol.iterator ](): Iterator<number>;

}

export class Vector4 {

	constructor( x?: number, y?: number, z?: number, w?: number );
	readonly isVector4: true;
	x: number;
	y: number;
	z: number;
	w: number;
	width: number;
	height: number;
	set( x: number, y: number, z: number, w: number ): this;
	setScalar( s: number ): this;
	setX( x: number ): this;
	setY( y: number ): this;
	setZ( z: number ): this;
	setW( w: number ): this;
	clone(): Vector4;
	copy( v: { x: number; y: number; z: number; w?: number } ): this;
	add( v: Vector4 ): this;
	addScalar( s: number ): this;
	addVectors( a: Vector4, b: Vector4 ): this;
	addScaledVector( v: Vector4, s: number ): this;
	sub( v: Vector4 ): this;
	subScalar( s: number ): this;
	subVectors( a: Vector4, b: Vector4 ): this;
	multiply( v: Vector4 ): this;
	multiplyScalar( s: number ): this;
	applyMatrix4( m: Elements ): this;
	divide( v: Vector4 ): this;
	divideScalar( s: number ): this;
	setAxisAngleFromQuaternion( q: QuatLike ): this;
	setAxisAngleFromRotationMatrix( m: Elements ): this;
	setFromMatrixPosition( m: Elements ): this;
	min( v: Vector4 ): this;
	max( v: Vector4 ): this;
	clamp( min: Vector4, max: Vector4 ): this;
	clampScalar( min: number, max: number ): this;
	clampLength( min: number, max: number ): this;
	floor(): this;
	ceil(): this;
	round(): this;
	roundToZero(): this;
	negate(): this;
	dot( v: Vector4 ): number;
	lengthSq(): number;
	length(): number;
	manhattanLength(): number;
	normalize(): this;
	setLength( length: number ): this;
	lerp( v: Vector4, alpha: number ): this;
	lerpVectors( v1: Vector4, v2: Vector4, alpha: number ): this;
	equals( v: Vector4 ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	fromBufferAttribute( attribute: AttributeLike, index: number ): this;
	random(): this;
	[ Symbol.iterator ](): Iterator<number>;

}

export class Quaternion {

	constructor( x?: number, y?: number, z?: number, w?: number );
	readonly isQuaternion: true;
	x: number;
	y: number;
	z: number;
	w: number;
	static slerpFlat( dst: number[] | Float32Array, dstOffset: number, src0: ArrayLike<number>, srcOffset0: number, src1: ArrayLike<number>, srcOffset1: number, t: number ): void;
	static multiplyQuaternionsFlat<T extends number[] | Float32Array>( dst: T, dstOffset: number, src0: ArrayLike<number>, srcOffset0: number, src1: ArrayLike<number>, srcOffset1: number ): T;
	set( x: number, y: number, z: number, w: number ): this;
	clone(): Quaternion;
	copy( q: QuatLike ): this;
	setFromEuler( euler: EulerLike ): this;
	setFromAxisAngle( axis: Vec3Like, angle: number ): this;
	setFromRotationMatrix( m: Elements ): this;
	setFromUnitVectors( vFrom: Vector3, vTo: Vec3Like ): this;
	angleTo( q: QuatLike ): number;
	rotateTowards( q: QuatLike, step: number ): this;
	identity(): this;
	invert(): this;
	conjugate(): this;
	dot( q: QuatLike ): number;
	lengthSq(): number;
	length(): number;
	normalize(): this;
	multiply( q: QuatLike ): this;
	premultiply( q: QuatLike ): this;
	multiplyQuaternions( a: QuatLike, b: QuatLike ): this;
	slerp( qb: QuatLike, t: number ): this;
	slerpQuaternions( qa: QuatLike, qb: QuatLike, t: number ): this;
	random(): this;
	equals( q: QuatLike ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	fromBufferAttribute( attribute: AttributeLike, index: number ): this;
	toJSON(): number[];
	[ Symbol.iterator ](): Iterator<number>;

}

export class Euler {

	constructor( x?: number, y?: number, z?: number, order?: EulerOrder );
	static DEFAULT_ORDER: EulerOrder;
	readonly isEuler: true;
	x: number;
	y: number;
	z: number;
	order: EulerOrder;
	set( x: number, y: number, z: number, order?: EulerOrder ): this;
	clone(): Euler;
	copy( euler: EulerLike ): this;
	setFromRotationMatrix( m: Elements, order?: EulerOrder ): this;
	setFromQuaternion( q: QuatLike, order?: EulerOrder ): this;
	setFromVector3( v: Vec3Like, order?: EulerOrder ): this;
	reorder( newOrder: EulerOrder ): this;
	equals( euler: EulerLike ): boolean;
	fromArray( array: ArrayLike<number | string> ): this;
	toArray( array?: Array<number | string>, offset?: number ): Array<number | string>;
	[ Symbol.iterator ](): Iterator<number | string>;

}

export class Matrix3 {

	/** Row-major arguments; `elements` are column-major. */
	constructor( n11?: number, n12?: number, n13?: number, n21?: number, n22?: number, n23?: number, n31?: number, n32?: number, n33?: number );
	readonly isMatrix3: true;
	/** The 9 elements, column-major. */
	elements: number[];
	set( n11: number, n12: number, n13: number, n21: number, n22: number, n23: number, n31: number, n32: number, n33: number ): this;
	identity(): this;
	copy( m: Elements ): this;
	extractBasis( xAxis: Vector3, yAxis: Vector3, zAxis: Vector3 ): this;
	setFromMatrix4( m: Elements ): this;
	multiply( m: Elements ): this;
	premultiply( m: Elements ): this;
	multiplyMatrices( a: Elements, b: Elements ): this;
	multiplyScalar( s: number ): this;
	determinant(): number;
	invert(): this;
	transpose(): this;
	getNormalMatrix( matrix4: Elements ): this;
	transposeIntoArray( r: number[] ): this;
	setUvTransform( tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number ): this;
	makeTranslation( x: number | Vector2, y?: number ): this;
	makeRotation( theta: number ): this;
	makeScale( x: number, y: number ): this;
	equals( matrix: Elements ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	clone(): Matrix3;

}

export class Matrix4 {

	/** Row-major arguments; `elements` are column-major. */
	constructor( n11?: number, n12?: number, n13?: number, n14?: number, n21?: number, n22?: number, n23?: number, n24?: number, n31?: number, n32?: number, n33?: number, n34?: number, n41?: number, n42?: number, n43?: number, n44?: number );
	readonly isMatrix4: true;
	/** The 16 elements, column-major. */
	elements: number[];
	set( n11: number, n12: number, n13: number, n14: number, n21: number, n22: number, n23: number, n24: number, n31: number, n32: number, n33: number, n34: number, n41: number, n42: number, n43: number, n44: number ): this;
	identity(): this;
	clone(): Matrix4;
	copy( m: Elements ): this;
	copyPosition( m: Elements ): this;
	setFromMatrix3( m: Elements ): this;
	extractBasis( xAxis: Vector3, yAxis: Vector3, zAxis: Vector3 ): this;
	makeBasis( xAxis: Vec3Like, yAxis: Vec3Like, zAxis: Vec3Like ): this;
	extractRotation( m: Matrix4 ): this;
	makeRotationFromEuler( euler: EulerLike ): this;
	makeRotationFromQuaternion( q: QuatLike ): this;
	lookAt( eye: Vec3Like, target: Vec3Like, up: Vec3Like ): this;
	multiply( m: Elements ): this;
	premultiply( m: Elements ): this;
	multiplyMatrices( a: Elements, b: Elements ): this;
	multiplyScalar( s: number ): this;
	determinant(): number;
	determinantAffine(): number;
	transpose(): this;
	setPosition( x: number | Vec3Like, y?: number, z?: number ): this;
	invert(): this;
	scale( v: Vec3Like ): this;
	getMaxScaleOnAxis(): number;
	makeTranslation( x: number | Vec3Like, y?: number, z?: number ): this;
	makeRotationX( theta: number ): this;
	makeRotationY( theta: number ): this;
	makeRotationZ( theta: number ): this;
	makeRotationAxis( axis: Vec3Like, angle: number ): this;
	makeScale( x: number, y: number, z: number ): this;
	makeShear( xy: number, xz: number, yx: number, yz: number, zx: number, zy: number ): this;
	compose( position: Vec3Like, quaternion: QuatLike, scale: Vec3Like ): this;
	decompose( position: Vec3Like & { set( x: number, y: number, z: number ): unknown }, quaternion: { setFromRotationMatrix( m: Matrix4 ): unknown; identity(): unknown }, scale: { set( x: number, y: number, z: number ): unknown } ): this;
	makePerspective( left: number, right: number, top: number, bottom: number, near: number, far: number, coordinateSystem?: number, reversedDepth?: boolean ): this;
	makeOrthographic( left: number, right: number, top: number, bottom: number, near: number, far: number, coordinateSystem?: number, reversedDepth?: boolean ): this;
	equals( matrix: Elements ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];

}
