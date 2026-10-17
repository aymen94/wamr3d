import * as W from './index.js';

export function init( source?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module ): Promise<void>;
/** The World behind every object created here, for the batched low-level calls. */
export function getWorld(): W.World;

export const FrontSide: 0;
export const NoToneMapping: 0, LinearToneMapping: 1, ReinhardToneMapping: 2, CineonToneMapping: 3, ACESFilmicToneMapping: 4, CustomToneMapping: 5, AgXToneMapping: 6, NeutralToneMapping: 7;
export type ToneMapping = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const BackSide: 1;
export const DoubleSide: 2;
export const WebGLCoordinateSystem: 2000;
export const WebGPUCoordinateSystem: 2001;
export const MathUtils: typeof W.MathUtils;
export const Timer: typeof W.Timer;

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
export type ColorRepresentation = Color | number | string;

/**
 * The engine's method set with chaining: methods that return nothing in the engine
 * class return `this` here, and a trailing `target` argument receives the result.
 * Getters of engine values (`box.min`) give the classes of this module.
 */
type Chained<Base, Self> = {
	[ K in keyof Base ]: Base[ K ] extends ( ...args: infer A ) => infer R ? ( ...args: Loose<A> ) => ( [ R ] extends [ void ] ? Self : Adopted<R> ) : Adopted<Base[ K ]>;
};

// Arguments are the classes of this module, or values owned by an object (`mesh.position`).
type Loose<A extends unknown[]> = { [ I in keyof A ]: Given<A[ I ]> };
type Given<T> =
	T extends W.Quaternion ? Quaternion | ObjectQuaternion : T extends W.Vector3 ? Vector3 | ObjectVector3 : T extends W.Euler ? Euler | ObjectEuler :
	T extends W.Matrix4 ? Matrix4 : T extends W.Matrix3 ? Matrix3 : T extends W.Vector2 ? Vector2 : T extends W.Vector4 ? Vector4 : T extends W.Color ? Color :
	T extends W.Box3 ? Box3 : T extends W.Sphere ? Sphere : T extends W.Plane ? Plane : T extends W.Ray ? Ray :
	T extends W.Line3 ? Line3 : T extends W.Triangle ? Triangle : T extends W.Spherical ? Spherical : T extends W.Cylindrical ? Cylindrical : T;

// Engine values come back as the classes of this module.
type Adopted<R> =
	R extends W.Vector3 ? Vector3 : R extends W.Quaternion ? Quaternion : R extends W.Matrix4 ? Matrix4 : R extends W.Euler ? Euler :
	R extends W.Vector2 ? Vector2 : R extends W.Vector4 ? Vector4 : R extends W.Matrix3 ? Matrix3 : R extends W.Color ? Color :
	R extends W.Box3 ? Box3 : R extends W.Sphere ? Sphere : R extends W.Plane ? Plane : R extends W.Ray ? Ray :
	R extends W.Line3 ? Line3 : R extends W.Triangle ? Triangle : R extends W.Spherical ? Spherical : R extends W.Cylindrical ? Cylindrical : R;

interface Vec3Like { x: number; y: number; z: number }
interface QuatLike { x: number; y: number; z: number; w: number }
interface EulerLike { x: number; y: number; z: number; order: string }
interface AttributeLike { getX( i: number ): number; getY( i: number ): number; getZ( i: number ): number; getW( i: number ): number }
interface Elements { elements: ArrayLike<number> }

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

export const NoColorSpace: '';
export const SRGBColorSpace: 'srgb';
export const LinearSRGBColorSpace: 'srgb-linear';
export type ColorSpace = '' | 'srgb' | 'srgb-linear';

/** Colours are kept in the linear working colour space; `enabled` is always true. */
export const ColorManagement: { enabled: boolean; readonly workingColorSpace: 'srgb-linear' };

export class Color {

	constructor( r?: ColorRepresentation, g?: number, b?: number );
	readonly isColor: true;
	/** Linear working-space components. */
	r: number;
	g: number;
	b: number;
	set( r: ColorRepresentation, g?: number, b?: number ): this;
	setScalar( s: number ): this;
	/** Components in `colorSpace`, the linear working space by default. */
	setRGB( r: number, g: number, b: number, colorSpace?: ColorSpace ): this;
	/** sRGB by default. */
	setHex( hex: number, colorSpace?: ColorSpace ): this;
	setHSL( h: number, s: number, l: number, colorSpace?: ColorSpace ): this;
	setStyle( style: string, colorSpace?: ColorSpace ): this;
	setColorName( style: string, colorSpace?: ColorSpace ): this;
	clone(): Color;
	copy( color: { r: number; g: number; b: number } ): this;
	copySRGBToLinear( color: Color ): this;
	copyLinearToSRGB( color: Color ): this;
	convertSRGBToLinear(): this;
	convertLinearToSRGB(): this;
	getHex( colorSpace?: ColorSpace ): number;
	getHexString( colorSpace?: ColorSpace ): string;
	getHSL<T extends { h?: number; s?: number; l?: number }>( target?: T, colorSpace?: ColorSpace ): T & { h: number; s: number; l: number };
	getRGB<T extends { r: number; g: number; b: number }>( target: T, colorSpace?: ColorSpace ): T;
	getStyle( colorSpace?: ColorSpace ): string;
	offsetHSL( h: number, s: number, l: number ): this;
	add( color: Color ): this;
	addColors( color1: Color, color2: Color ): this;
	addScalar( s: number ): this;
	sub( color: Color ): this;
	multiply( color: Color ): this;
	multiplyScalar( s: number ): this;
	lerp( color: Color, alpha: number ): this;
	lerpColors( color1: Color, color2: Color, alpha: number ): this;
	lerpHSL( color: Color, alpha: number ): this;
	setFromVector3( v: Vec3Like ): this;
	applyMatrix3( m: Elements ): this;
	equals( c: Color ): boolean;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	fromBufferAttribute( attribute: AttributeLike, index: number ): this;
	toJSON(): number;
	[ Symbol.iterator ](): Iterator<number>;

}

export class Box3 {

	constructor( min?: Vector3, max?: Vector3 );
	readonly isBox3: true;
	min: Vector3;
	max: Vector3;
	set( min: Vec3Like, max: Vec3Like ): this;
	setFromArray( array: ArrayLike<number> ): this;
	setFromBufferAttribute( attribute: AttributeLike & { count: number } ): this;
	setFromPoints( points: Vec3Like[] ): this;
	setFromCenterAndSize( center: Vec3Like, size: Vec3Like ): this;
	/** The world-space box around `object` and its descendants; with `precise`, from every vertex. */
	setFromObject( object: Object3D, precise?: boolean ): this;
	expandByObject( object: Object3D, precise?: boolean ): this;
	clone(): Box3;
	copy( box: Box3 ): this;
	makeEmpty(): this;
	isEmpty(): boolean;
	getCenter( target?: Vector3 ): Vector3;
	getSize( target?: Vector3 ): Vector3;
	expandByPoint( point: Vec3Like ): this;
	expandByVector( vector: Vec3Like ): this;
	expandByScalar( scalar: number ): this;
	containsPoint( point: Vec3Like ): boolean;
	containsBox( box: Box3 ): boolean;
	getParameter( point: Vec3Like, target: Vector3 ): Vector3;
	intersectsBox( box: Box3 ): boolean;
	intersectsSphere( sphere: Sphere ): boolean;
	intersectsPlane( plane: Plane ): boolean;
	intersectsTriangle( triangle: Triangle ): boolean;
	clampPoint( point: Vec3Like, target?: Vector3 ): Vector3;
	distanceToPoint( point: Vec3Like ): number;
	getBoundingSphere( target?: Sphere ): Sphere;
	intersect( box: Box3 ): this;
	union( box: Box3 ): this;
	applyMatrix4( matrix: Elements ): this;
	translate( offset: Vec3Like ): this;
	equals( box: Box3 ): boolean;
	toJSON(): { min: number[]; max: number[] };
	fromJSON( json: { min: number[]; max: number[] } ): this;

}

export class Sphere {

	constructor( center?: Vector3, radius?: number );
	readonly isSphere: true;
	center: Vector3;
	radius: number;
	set( center: Vec3Like, radius: number ): this;
	setFromPoints( points: Vec3Like[], optionalCenter?: Vec3Like ): this;
	copy( sphere: Sphere ): this;
	isEmpty(): boolean;
	makeEmpty(): this;
	containsPoint( point: Vector3 ): boolean;
	distanceToPoint( point: Vector3 ): number;
	intersectsSphere( sphere: Sphere ): boolean;
	intersectsBox( box: Box3 ): boolean;
	intersectsPlane( plane: Plane ): boolean;
	clampPoint( point: Vec3Like, target?: Vector3 ): Vector3;
	getBoundingBox( target?: Box3 ): Box3;
	applyMatrix4( matrix: Matrix4 ): this;
	translate( offset: Vec3Like ): this;
	expandByPoint( point: Vec3Like ): this;
	union( sphere: Sphere ): this;
	equals( sphere: Sphere ): boolean;
	clone(): Sphere;
	toJSON(): { radius: number; center: number[] };
	fromJSON( json: { radius: number; center: number[] } ): this;

}

declare const PlaneBase: new ( normal: W.Vector3, constant: number ) => Chained<Omit<W.Plane, 'projectPoint' | 'coplanarPoint'>, Plane>;
export class Plane extends PlaneBase {

	constructor( normal?: Vector3, constant?: number );
	readonly isPlane: true;
	projectPoint( point: Vector3, target?: Vector3 ): Vector3;
	coplanarPoint( target?: Vector3 ): Vector3;

}

declare const RayBase: new ( origin: W.Vector3, direction: W.Vector3 ) => Chained<Omit<W.Ray, 'at' | 'closestPointToPoint' | 'intersectSphere' | 'intersectPlane' | 'intersectBox' | 'intersectTriangle' | 'distanceToPlane'>, Ray>;
export class Ray extends RayBase {

	constructor( origin?: Vector3, direction?: Vector3 );
	readonly isRay: true;
	at( t: number, target?: Vector3 ): Vector3;
	closestPointToPoint( point: Vector3, target?: Vector3 ): Vector3;
	distanceToPlane( plane: Plane ): number | null;
	intersectSphere( sphere: Sphere, target?: Vector3 ): Vector3 | null;
	intersectPlane( plane: Plane, target?: Vector3 ): Vector3 | null;
	intersectBox( box: Box3, target?: Vector3 ): Vector3 | null;
	intersectTriangle( a: Vector3, b: Vector3, c: Vector3, backfaceCulling: boolean, target?: Vector3 ): Vector3 | null;

}

declare const FrustumBase: new () => Chained<Omit<W.Frustum, 'setFromProjectionMatrix'>, Frustum>;
export class Frustum extends FrustumBase {

	readonly isFrustum: true;
	setFromProjectionMatrix( m: Matrix4, coordinateSystem?: number, reversedDepth?: boolean ): this;

}

declare const Line3Base: new ( start: W.Vector3, end: W.Vector3 ) => Chained<Omit<W.Line3, 'getCenter' | 'delta' | 'at' | 'closestPointToPoint'>, Line3>;
/** `start` and `end` read as copies; change them with `set`. */
export class Line3 extends Line3Base {

	constructor( start?: Vector3, end?: Vector3 );
	readonly isLine3: true;
	getCenter( target?: Vector3 ): Vector3;
	delta( target?: Vector3 ): Vector3;
	at( t: number, target?: Vector3 ): Vector3;
	closestPointToPoint( point: Vector3, clampToLine: boolean, target?: Vector3 ): Vector3;

}

declare const TriangleBase: new ( a: W.Vector3, b: W.Vector3, c: W.Vector3 ) => Chained<Omit<W.Triangle, 'getMidpoint' | 'getNormal' | 'getPlane' | 'getBarycoord' | 'closestPointToPoint'>, Triangle>;
/** `a`, `b` and `c` read as copies; change them with `set`. */
export class Triangle extends TriangleBase {

	constructor( a?: Vector3, b?: Vector3, c?: Vector3 );
	readonly isTriangle: true;
	getMidpoint( target?: Vector3 ): Vector3;
	getNormal( target?: Vector3 ): Vector3;
	getPlane( target?: Plane ): Plane;
	getBarycoord( point: Vector3, target?: Vector3 ): Vector3 | null;
	closestPointToPoint( point: Vector3, target?: Vector3 ): Vector3;
	getInterpolation<T extends Vector2 | Vector3 | Vector4>( point: Vector3, v1: T, v2: T, v3: T, target: T ): T | null;
	setFromPointsAndIndices( points: Vector3[], i0: number, i1: number, i2: number ): this;
	setFromAttributeAndIndices( attribute: BufferAttribute | InterleavedBufferAttribute, i0: number, i1: number, i2: number ): this;
	static getNormal( a: Vector3, b: Vector3, c: Vector3, target: Vector3 ): Vector3;
	static getBarycoord( point: Vector3, a: Vector3, b: Vector3, c: Vector3, target: Vector3 ): Vector3 | null;
	static containsPoint( point: Vector3, a: Vector3, b: Vector3, c: Vector3 ): boolean;
	static getInterpolation<T extends Vector2 | Vector3 | Vector4>( point: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, v1: T, v2: T, v3: T, target: T ): T | null;
	static isFrontFacing( a: Vector3, b: Vector3, c: Vector3, direction: Vector3 ): boolean;

}

declare const SphericalBase: new ( radius: number, phi: number, theta: number ) => Chained<W.Spherical, Spherical>;
/** Radius, polar angle `phi` from +Y and azimuth `theta` around Y. */
export class Spherical extends SphericalBase {

	constructor( radius?: number, phi?: number, theta?: number );
	readonly isSpherical: true;

}

declare const CylindricalBase: new ( radius: number, theta: number, y: number ) => Chained<W.Cylindrical, Cylindrical>;
export class Cylindrical extends CylindricalBase {

	constructor( radius?: number, theta?: number, y?: number );
	readonly isCylindrical: true;

}

/** `object.position`, `object.scale`, `object.up`: a Vector3 whose numbers live in the engine. */
export type ObjectVector3 = Omit<Vector3, 'free' | typeof Symbol.dispose>;
export type ObjectEuler = Omit<Euler, 'free' | typeof Symbol.dispose>;
export type ObjectQuaternion = Omit<Quaternion, 'free' | typeof Symbol.dispose>;

export class Layers {

	mask: number;
	set( layer: number ): void;
	enable( layer: number ): void;
	enableAll(): void;
	toggle( layer: number ): void;
	disable( layer: number ): void;
	disableAll(): void;
	test( layers: { mask: number } ): boolean;
	isEnabled( layer: number ): boolean;

}

export class Object3D {

	readonly isObject3D: true;
	/** The engine handle, for the low-level World API. */
	readonly handle: bigint;
	readonly id: number;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	parent: Object3D | null;
	children: Object3D[];
	userData: Record<string, any>;
	visible: boolean;
	renderOrder: number;
	frustumCulled: boolean;
	/** Always true; setting it to false throws. */
	/** With `false` the local matrix is yours: change it through `object.matrix`. */
	matrixAutoUpdate: boolean;
	matrixWorldAutoUpdate: boolean;
	matrixWorldNeedsUpdate: boolean;
	readonly position: ObjectVector3;
	readonly rotation: ObjectEuler;
	readonly quaternion: ObjectQuaternion;
	readonly scale: ObjectVector3;
	readonly up: ObjectVector3;
	readonly layers: Layers;
	/** A copy of the local matrix. */
	matrix: Matrix4;
	/** The world matrix, refreshed from the engine on each access; the same object every time. */
	readonly matrixWorld: Matrix4;

	add( ...children: Object3D[] ): this;
	remove( ...children: Object3D[] ): this;
	removeFromParent(): this;
	clear(): this;
	attach( child: Object3D ): this;
	lookAt( target: Vec3Like ): void;
	lookAt( x: number, y: number, z: number ): void;
	rotateOnAxis( axis: Vec3Like, angle: number ): this;
	rotateX( angle: number ): this;
	rotateY( angle: number ): this;
	rotateZ( angle: number ): this;
	translateOnAxis( axis: Vec3Like, distance: number ): this;
	translateX( distance: number ): this;
	translateY( distance: number ): this;
	translateZ( distance: number ): this;
	updateMatrix(): void;
	updateMatrixWorld( force?: boolean ): void;
	updateWorldMatrix( updateParents: boolean, updateChildren?: boolean ): void;
	getWorldPosition( target?: Vector3 ): Vector3;
	getWorldQuaternion( target?: Quaternion ): Quaternion;
	getWorldScale( target?: Vector3 ): Vector3;
	getWorldDirection( target?: Vector3 ): Vector3;
	localToWorld( v: Vector3 ): Vector3;
	worldToLocal( v: Vector3 ): Vector3;
	traverse( callback: ( object: Object3D ) => void ): void;
	traverseVisible( callback: ( object: Object3D ) => void ): void;
	traverseAncestors( callback: ( object: Object3D ) => void ): void;
	getObjectByName( name: string ): Object3D | undefined;
	getObjectById( id: number ): Object3D | undefined;
	getObjectByProperty( name: string, value: any ): Object3D | undefined;
	clone( recursive?: boolean ): this;
	copy( source: this, recursive?: boolean ): this;
	/** Releases the object in the engine now instead of at garbage collection. */
	dispose(): void;

}

export class Group extends Object3D { readonly isGroup: true }

export class Scene extends Object3D {

	readonly isScene: true;
	/** A colour, an equirectangular texture (`mapping = EquirectangularReflectionMapping`) drawn around the camera, or another texture stretched over the frame. */
	background: Color | Texture | null;
	/** An equirectangular texture that lights standard materials without their own `envMap`. */
	environment: Texture | null;
	environmentIntensity: number;
	environmentRotation: Euler;
	/** Above 0, an equirectangular background is read blurred from its prefiltered map. */
	backgroundBlurriness: number;
	backgroundIntensity: number;
	backgroundRotation: Euler;
	fog: Fog | FogExp2 | null;

}

export class Mesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isMesh: true;
	geometry: G;
	material: M;

}

export class Camera extends Object3D {

	readonly isCamera: true;
	near: number;
	far: number;
	zoom: number;
	readonly projectionMatrix: Matrix4;
	readonly projectionMatrixInverse: Matrix4;
	readonly matrixWorldInverse: Matrix4;
	updateProjectionMatrix(): void;
	setViewOffset( fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number ): void;
	clearViewOffset(): void;

}

export class PerspectiveCamera extends Camera {

	constructor( fov?: number, aspect?: number, near?: number, far?: number );
	readonly isPerspectiveCamera: true;
	fov: number;
	aspect: number;

}

export class OrthographicCamera extends Camera {

	constructor( left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number );
	readonly isOrthographicCamera: true;
	left: number;
	right: number;
	top: number;
	bottom: number;

}

/** One connected line through the geometry's vertices, one pixel wide. */
export class Line<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isLine: true;
	geometry: G;
	material: M;

}

/** Separate segments, one per pair of vertices. */
export class Fog {

	constructor( color: ColorRepresentation, near?: number, far?: number );
	readonly isFog: true;
	name: string;
	color: Color;
	near: number;
	far: number;
	clone(): Fog;

}

export class FogExp2 {

	constructor( color: ColorRepresentation, density?: number );
	readonly isFogExp2: true;
	name: string;
	color: Color;
	density: number;
	clone(): FogExp2;

}

/** Per-instance numbers of an `InstancedMesh`. Set `needsUpdate = true` after changing `array`. */
export class InstancedBufferAttribute {

	constructor( array: Float32Array, itemSize: number );
	readonly isInstancedBufferAttribute: true;
	array: Float32Array;
	itemSize: number;
	count: number;
	version: number;
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;

}

/** One geometry drawn `count` times in a single draw call. Instances are not culled one by one; `Raycaster` reports the `instanceId` it hit. */
export class InstancedMesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Mesh<G, M> {

	constructor( geometry: G, material: M, count: number );
	readonly isInstancedMesh: true;
	readonly instanceMatrix: InstancedBufferAttribute;
	instanceColor: InstancedBufferAttribute | null;
	count: number;
	setMatrixAt( index: number, matrix: Matrix4 ): void;
	getMatrixAt( index: number, matrix: Matrix4 ): Matrix4;
	setColorAt( index: number, color: Color ): void;
	getColorAt( index: number, color: Color ): Color;
	/** Local box around the drawn instances; filled by `computeBoundingBox`. */
	boundingBox: Box3 | null;
	computeBoundingBox(): void;

}

export class GridHelper extends LineSegments<BufferGeometry, LineBasicMaterial> {

	constructor( size?: number, divisions?: number, color1?: ColorRepresentation, color2?: ColorRepresentation );

}

export class AxesHelper extends LineSegments<BufferGeometry, LineBasicMaterial> {

	constructor( size?: number );
	setColors( xAxisColor: ColorRepresentation, yAxisColor: ColorRepresentation, zAxisColor: ColorRepresentation ): this;

}

export class LineSegments<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {

	readonly isLineSegments: true;

}

/** A line through the geometry's vertices and back to the first, one pixel wide. */
export class LineLoop<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {

	readonly isLineLoop: true;

}

/** Shows one level by distance from the camera; with `autoUpdate` the renderer calls `update`. */
export class LOD extends Object3D {

	readonly isLOD: true;
	readonly levels: { distance: number; hysteresis: number; object: Object3D }[];
	autoUpdate: boolean;
	addLevel( object: Object3D, distance?: number, hysteresis?: number ): this;
	removeLevel( distance: number ): boolean;
	getCurrentLevel(): number;
	getObjectForDistance( distance: number ): Object3D | null;
	update( camera: Camera ): void;

}

export class Light extends Object3D {

	constructor( color?: ColorRepresentation, intensity?: number );
	readonly isLight: true;
	color: Color;
	intensity: number;

}

export class AmbientLight extends Light { readonly isAmbientLight: true }

export class HemisphereLight extends Light {

	constructor( skyColor?: ColorRepresentation, groundColor?: ColorRepresentation, intensity?: number );
	readonly isHemisphereLight: true;
	groundColor: Color;

}

export class DirectionalLight extends Light {

	readonly isDirectionalLight: true;
	target: Object3D;

}

/** `distance` 0 means no cutoff. */
export class PointLight extends Light {

	constructor( color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number );
	readonly isPointLight: true;
	distance: number;
	decay: number;

}

/** `angle` is the cone's half angle in radians; `penumbra` (0..1) the soft share of the cone. */
export class SpotLight extends Light {

	constructor( color?: ColorRepresentation, intensity?: number, distance?: number, angle?: number, penumbra?: number, decay?: number );
	readonly isSpotLight: true;
	target: Object3D;
	distance: number;
	angle: number;
	penumbra: number;
	decay: number;

}

type NumberArray = number[] | Float32Array | Uint32Array | Uint16Array | Uint8Array | Uint8ClampedArray | Int32Array | Int16Array | Int8Array;

/** Item accessors; values of `normalized` integer arrays read and write as 0..1 or -1..1. */
interface AttributeAccessors {

	getComponent( index: number, component: number ): number;
	setComponent( index: number, component: number, value: number ): this;
	getX( index: number ): number;
	getY( index: number ): number;
	getZ( index: number ): number;
	getW( index: number ): number;
	setX( index: number, x: number ): this;
	setY( index: number, y: number ): this;
	setZ( index: number, z: number ): this;
	setW( index: number, w: number ): this;
	setXY( index: number, x: number, y: number ): this;
	setXYZ( index: number, x: number, y: number, z: number ): this;
	setXYZW( index: number, x: number, y: number, z: number, w: number ): this;

}

/** The engine stores attributes as floats; integer arrays marked `normalized` are converted to 0..1 (or -1..1). */
export interface BufferAttribute extends AttributeAccessors {}
export class BufferAttribute {

	constructor( array: NumberArray, itemSize: number, normalized?: boolean );
	readonly isBufferAttribute: true;
	name: string;
	array: NumberArray;
	itemSize: number;
	normalized: boolean;
	count: number;
	version: number;
	/** Set to true after changing `array` to send the new data to the engine. */
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;
	clone(): this;

}

export class Float32BufferAttribute extends BufferAttribute {}
export class Int8BufferAttribute extends BufferAttribute {}
export class Uint8BufferAttribute extends BufferAttribute {}
export class Uint8ClampedBufferAttribute extends BufferAttribute {}
export class Int16BufferAttribute extends BufferAttribute {}
export class Uint16BufferAttribute extends BufferAttribute {}
export class Int32BufferAttribute extends BufferAttribute {}
export class Uint32BufferAttribute extends BufferAttribute {}

/** Attributes packed in one array, `stride` numbers per vertex. Each attribute is copied out to the engine; `needsUpdate` sends them all again. */
export class InterleavedBuffer {

	constructor( array: NumberArray, stride: number );
	readonly isInterleavedBuffer: true;
	array: NumberArray;
	stride: number;
	count: number;
	version: number;
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;
	set( value: ArrayLike<number>, offset?: number ): this;
	clone(): InterleavedBuffer;

}

export interface InterleavedBufferAttribute extends AttributeAccessors {}
export class InterleavedBufferAttribute {

	constructor( interleavedBuffer: InterleavedBuffer, itemSize: number, offset: number, normalized?: boolean );
	readonly isInterleavedBufferAttribute: true;
	name: string;
	data: InterleavedBuffer;
	itemSize: number;
	offset: number;
	normalized: boolean;
	readonly count: number;
	readonly array: NumberArray;
	set needsUpdate( value: boolean );
	/** A plain `BufferAttribute` with this attribute's values. */
	clone(): BufferAttribute;

}

export class BufferGeometry {

	readonly isBufferGeometry: true;
	readonly handle: bigint;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	attributes: Record<string, BufferAttribute | InterleavedBufferAttribute>;
	index: BufferAttribute | null;
	drawRange: { start: number; count: number };
	groups: { start: number; count: number; materialIndex: number }[];
	boundingBox: Box3 | null;
	boundingSphere: Sphere | null;
	userData: Record<string, any>;

	setAttribute( name: string, attribute: BufferAttribute | InterleavedBufferAttribute ): this;
	getAttribute( name: string ): BufferAttribute | InterleavedBufferAttribute | undefined;
	hasAttribute( name: string ): boolean;
	deleteAttribute( name: string ): this;
	setFromPoints( points: { x: number; y: number; z?: number }[] ): this;
	setIndex( index: BufferAttribute | NumberArray ): this;
	getIndex(): BufferAttribute | null;
	addGroup( start: number, count: number, materialIndex?: number ): void;
	clearGroups(): void;
	setDrawRange( start: number, count: number ): void;
	computeVertexNormals(): void;
	computeTangents(): void;
	computeBoundingBox(): void;
	computeBoundingSphere(): void;
	applyMatrix4( matrix: Matrix4 ): this;
	translate( x: number, y: number, z: number ): this;
	scale( x: number, y: number, z: number ): this;
	rotateX( angle: number ): this;
	rotateY( angle: number ): this;
	rotateZ( angle: number ): this;
	center(): this;
	toNonIndexed(): BufferGeometry;
	/** Copies attributes (as new arrays), index, groups, draw range, bounding volumes and `userData`. */
	copy( source: BufferGeometry ): this;
	/** Built-in shapes are rebuilt from `parameters` and keep their class. */
	clone(): this;
	dispose(): void;

}

export class BoxGeometry extends BufferGeometry {

	constructor( width?: number, height?: number, depth?: number, widthSegments?: number, heightSegments?: number, depthSegments?: number );

}

export class PlaneGeometry extends BufferGeometry {

	constructor( width?: number, height?: number, widthSegments?: number, heightSegments?: number );

}

export class SphereGeometry extends BufferGeometry {

	constructor( radius?: number, widthSegments?: number, heightSegments?: number, phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number );

}

export class CylinderGeometry extends BufferGeometry {

	constructor( radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean, thetaStart?: number, thetaLength?: number );

}

export class ConeGeometry extends CylinderGeometry {

	constructor( radius?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean, thetaStart?: number, thetaLength?: number );

}

export class CircleGeometry extends BufferGeometry {

	constructor( radius?: number, segments?: number, thetaStart?: number, thetaLength?: number );

}

export class RingGeometry extends BufferGeometry {

	constructor( innerRadius?: number, outerRadius?: number, thetaSegments?: number, phiSegments?: number, thetaStart?: number, thetaLength?: number );

}

export class TorusGeometry extends BufferGeometry {

	constructor( radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number, arc?: number, thetaStart?: number, thetaLength?: number );

}

/** Triangles `indices` over the xyz `vertices`, subdivided `detail` times and pushed out to `radius`. Not indexed: flat normals at detail 0, smooth otherwise. */
export class PolyhedronGeometry extends BufferGeometry {

	constructor( vertices?: ArrayLike<number>, indices?: ArrayLike<number>, radius?: number, detail?: number );

}

export class TetrahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class OctahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class DodecahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class IcosahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class TorusKnotGeometry extends BufferGeometry {

	constructor( radius?: number, tube?: number, tubularSegments?: number, radialSegments?: number, p?: number, q?: number );

}

/** Turns the profile `points` (x from the axis, y along it) around the y-axis. */
export class LatheGeometry extends BufferGeometry {

	constructor( points?: Vector2[], segments?: number, phiStart?: number, phiLength?: number );

}

export class CapsuleGeometry extends BufferGeometry {

	constructor( radius?: number, height?: number, capSegments?: number, radialSegments?: number, heightSegments?: number );

}

export const RepeatWrapping: 1000;
export const ClampToEdgeWrapping: 1001;
export const MirroredRepeatWrapping: 1002;
export const NearestFilter: 1003;
export const NearestMipmapNearestFilter: 1004;
export const NearestMipmapLinearFilter: 1005;
export const LinearFilter: 1006;
export const LinearMipmapNearestFilter: 1007;
export const LinearMipmapLinearFilter: 1008;
export const UVMapping: 300, CubeReflectionMapping: 301, CubeRefractionMapping: 302;
export const EquirectangularReflectionMapping: 303, EquirectangularRefractionMapping: 304, CubeUVReflectionMapping: 306;

export class Texture {

	constructor( image?: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | { data: Uint8Array; width: number; height: number } | null );
	readonly isTexture: true;
	readonly id: number;
	/** Made on first read. */
	uuid: string;
	name: string;
	/** `EquirectangularReflectionMapping` for environment maps and panoramic backgrounds (cube textures need none). */
	mapping: number;
	image: any;
	version: number;
	flipY: boolean;
	wrapS: number;
	wrapT: number;
	magFilter: number;
	/** Mipmaps are built when this is one of the mipmap filters and `generateMipmaps` is set. */
	minFilter: number;
	generateMipmaps: boolean;
	offset: Vector2;
	repeat: Vector2;
	center: Vector2;
	rotation: number;
	colorSpace: ColorSpace;
	set needsUpdate( value: boolean );
	dispose(): void;

}

/** `data` is RGBA, one byte per channel. */
export class DataTexture extends Texture {

	constructor( data: Uint8Array, width: number, height: number );
	readonly isDataTexture: true;

}

export class CanvasTexture extends Texture {

	constructor( canvas: HTMLCanvasElement | OffscreenCanvas );
	readonly isCanvasTexture: true;

}

export class TextureLoader {

	load( url: string, onLoad?: ( texture: Texture ) => void, onProgress?: unknown, onError?: ( error: unknown ) => void ): Texture;

}

/** Six square images (+x, -x, +y, -y, +z, -z) for environments and backgrounds; drawn through an equirectangular image four faces wide. */
export class CubeTexture extends Texture {

	constructor( images?: Array<ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | { data: Uint8Array; width: number; height: number }>, mapping?: number );
	readonly isCubeTexture: true;
	images: any[];

}

export class CubeTextureLoader {

	setPath( path: string ): this;
	load( urls: string[], onLoad?: ( texture: CubeTexture ) => void, onProgress?: unknown, onError?: ( error: unknown ) => void ): CubeTexture;

}

export interface MaterialParameters {

	color?: ColorRepresentation;
	side?: 0 | 1 | 2;
	name?: string;
	map?: Texture | null;
	transparent?: boolean;
	opacity?: number;
	depthTest?: boolean;
	depthWrite?: boolean;
	vertexColors?: boolean;
	/** Any other parameter is stored, has no effect, and logs one warning. */
	[ key: string ]: any;

}

export class Material {

	constructor( parameters?: MaterialParameters );
	readonly isMaterial: true;
	readonly handle: bigint;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	color: Color;
	map: Texture | null;
	side: 0 | 1 | 2;
	/** Blend with what is behind, using `opacity` and the map's alpha. */
	transparent: boolean;
	opacity: number;
	depthTest: boolean;
	depthWrite: boolean;
	/** Multiply the colour by the geometry's `color` attribute (three floats per vertex, or four with alpha). */
	vertexColors: boolean;
	/** Accepted for compatibility. As with the three.js WebGPU renderer, tone mapping is applied to the whole frame, so this has no effect on screen output. */
	toneMapped: boolean;
	/** Fragments whose alpha is at or below this are discarded; 0 keeps them all. Not applied to shadows. */
	alphaTest: number;
	userData: Record<string, any>;
	setValues( parameters: MaterialParameters ): void;
	copy( source: Material ): this;
	clone(): this;
	dispose(): void;

}

/** Every map uses the colour map's uv transform (or the first map's, without `map`). */
interface AlphaMap {

	/** Alpha in the red channel, as three.js reads it (grey maps read the same in every channel). */
	alphaMap: Texture | null;

}

interface OcclusionMap {

	/** Ambient occlusion in the red channel; dims indirect light only. */
	aoMap: Texture | null;
	aoMapIntensity: number;

}

interface NormalMap {

	/** Tangent space; the tangent frame comes from screen-space derivatives, not a `tangent` attribute. */
	normalMap: Texture | null;
	normalScale: Vector2;

}

interface LightMap {

	/** Baked light in rgb, scaled by `lightMapIntensity` and added to the light arriving from all around. Read with the shared uv transform from the first uv set. */
	lightMap: Texture | null;
	lightMapIntensity: number;

}

interface SurfaceMaps {

	/** Height in the red channel; its change across the pixel tilts the normal. Not used together with `normalMap`, which takes precedence. */
	bumpMap: Texture | null;
	bumpScale: number;
	/** Moves vertices along their normal by red times `displacementScale` plus `displacementBias`. Shadows are cast from the undisplaced mesh. */
	displacementMap: Texture | null;
	displacementScale: number;
	displacementBias: number;

}

interface Wireframe {

	/** Draws the edges of each triangle as one-pixel lines. */
	wireframe: boolean;
	/** Accepted; values other than 1 log a warning (lines are one pixel wide). */
	wireframeLinewidth: number;

}

interface LitMaps extends AlphaMap, OcclusionMap, NormalMap, LightMap, SurfaceMaps, Wireframe {

	/** Multiplies `emissive`. */
	emissiveMap: Texture | null;

}

interface Emissive {

	/** Light the surface gives off, multiplied by `emissiveIntensity`. */
	emissive: Color;
	emissiveIntensity: number;

}

/** Shows its colour (and map) as is, without lighting; a light map adds baked light. */
export interface MeshBasicMaterial extends AlphaMap, OcclusionMap, LightMap, Wireframe {}
export class MeshBasicMaterial extends Material { readonly isMeshBasicMaterial: true }
/** Diffuse (Lambert) lighting. */
export interface MeshLambertMaterial extends Emissive, LitMaps {}
export class MeshLambertMaterial extends Material { readonly isMeshLambertMaterial: true }
/** Diffuse lighting plus a Blinn-Phong highlight. */
export interface MeshPhongMaterial extends Emissive, LitMaps {}
export class MeshPhongMaterial extends Material {

	readonly isMeshPhongMaterial: true;
	specular: Color;
	shininess: number;
	/** Strength of the highlight in the red channel. */
	specularMap: Texture | null;

}
/** Diffuse lighting in tones: two without a gradient map. */
export interface MeshToonMaterial extends Emissive, LitMaps {}
export class MeshToonMaterial extends Material {

	readonly isMeshToonMaterial: true;
	/** Tones in the red channel, read at n.l / 2 + 1/2 across (usually with `NearestFilter`). */
	gradientMap: Texture | null;

}
/** The view-space normal as a colour. */
export interface MeshNormalMaterial extends NormalMap, SurfaceMaps, Wireframe {}
export class MeshNormalMaterial extends Material { readonly isMeshNormalMaterial: true }
/** For `Line`, `LineSegments` and `LineLoop`. Lines are one pixel wide. */
export class LineBasicMaterial extends Material { readonly isLineBasicMaterial: true }

/** Physically based lighting from `roughness` and `metalness`, with reflections of `envMap` or `scene.environment` (equirectangular). One environment map is drawn per frame. */
export interface MeshStandardMaterial extends Emissive, LitMaps {}
export class MeshStandardMaterial extends Material {

	constructor( parameters?: MaterialParameters & { roughness?: number; metalness?: number } );
	readonly isMeshStandardMaterial: true;
	roughness: number;
	metalness: number;
	envMap: Texture | null;
	envMapIntensity: number;
	envMapRotation: Euler;
	/** Roughness in the green channel, multiplying `roughness`. */
	roughnessMap: Texture | null;
	/** Metalness in the blue channel, multiplying `metalness`. */
	metalnessMap: Texture | null;

}

/**
 * `MeshStandardMaterial` with clearcoat, sheen and the specular layer (`ior`,
 * `specularIntensity`, `specularColor`). Transmission, iridescence, anisotropy, dispersion
 * and the maps of the extra layers are kept but not drawn (one warning when used).
 */
export class MeshPhysicalMaterial extends MeshStandardMaterial {

	readonly isMeshPhysicalMaterial: true;
	clearcoat: number;
	clearcoatRoughness: number;
	ior: number;
	reflectivity: number;
	sheen: number;
	sheenColor: Color;
	sheenRoughness: number;
	transmission: number;
	thickness: number;
	attenuationColor: Color;
	attenuationDistance: number;
	iridescence: number;
	iridescenceIOR: number;
	specularIntensity: number;
	specularColor: Color;
	dispersion: number;
	anisotropy: number;
	anisotropyRotation: number;

}

export class Clock {

	constructor( autoStart?: boolean );
	autoStart: boolean;
	elapsedTime: number;
	running: boolean;
	start(): void;
	stop(): void;
	getElapsedTime(): number;
	getDelta(): number;

}

/** Present so that using it fails with a clear error. */
/** One pixel per vertex, as with the three.js WebGPU renderer. */
export class Points<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isPoints: true;
	geometry: G;
	material: M;

}

/** A quad facing the camera, sized by its scale. `Raycaster` needs its `camera` (set by `setFromCamera`) to pick it. */
export class Sprite<M extends Material = SpriteMaterial> extends Object3D {

	constructor( material?: M );
	readonly isSprite: true;
	readonly geometry: BufferGeometry;
	material: M;
	center: Vector2;

}

/** `size` and `sizeAttenuation` are kept but have no effect: points are one pixel. */
export class PointsMaterial extends Material {

	constructor( parameters?: MaterialParameters & { size?: number; sizeAttenuation?: boolean } );
	readonly isPointsMaterial: true;
	size: number;
	sizeAttenuation: boolean;

}

export interface SpriteMaterial extends AlphaMap {}
export class SpriteMaterial extends Material {

	constructor( parameters?: MaterialParameters & { rotation?: number; sizeAttenuation?: boolean } );
	readonly isSpriteMaterial: true;
	rotation: number;
	sizeAttenuation: boolean;

}

export const UnsignedByteType: 1009, FloatType: 1015, HalfFloatType: 1016;

export interface RenderTargetOptions {

	type?: 1009 | 1015 | 1016;
	samples?: number;
	depthBuffer?: boolean;
	generateMipmaps?: boolean;
	minFilter?: number;
	magFilter?: number;
	colorSpace?: ColorSpace;

}

/** Drawn into with `renderer.setRenderTarget( target )`; `texture` can be a material's map. Linear colour, no tone mapping. */
export class RenderTarget {

	constructor( width?: number, height?: number, options?: RenderTargetOptions );
	readonly isRenderTarget: true;
	width: number;
	height: number;
	samples: number;
	readonly texture: Texture;
	setSize( width: number, height: number ): void;
	dispose(): void;

}

export class WebGLRenderTarget extends RenderTarget {}

// ---------------------------------------------------------------- events, skins, lights

export class EventDispatcher<E extends { type: string } = { type: string; [ key: string ]: any }> {
	addEventListener( type: string, listener: ( event: any ) => void ): void;
	hasEventListener( type: string, listener: ( event: any ) => void ): boolean;
	removeEventListener( type: string, listener: ( event: any ) => void ): void;
	dispatchEvent( event: E ): void;
}

export class Controls<O extends Object3D = Object3D> extends EventDispatcher {
	constructor( object: O, domElement?: HTMLElement | null );
	object: O;
	domElement: HTMLElement | null;
	enabled: boolean;
	state: number;
	keys: Record<string, any>;
	mouseButtons: Record<string, number | null>;
	touches: Record<string, number | null>;
	connect( element: HTMLElement ): void;
	disconnect(): void;
	dispose(): void;
	update( delta?: number ): void;
}

export class Bone extends Object3D { readonly isBone: true }

export class Skeleton {
	constructor( bones?: Bone[], boneInverses?: Matrix4[] );
	uuid: string;
	bones: Bone[];
	boneInverses: Matrix4[];
	boneMatrices: Float32Array | null;
	boneTexture: null;
	init(): void;
	calculateInverses(): void;
	pose(): void;
	update(): void;
	clone(): Skeleton;
	computeBoneTexture(): this;
	getBoneByName( name: string ): Bone | undefined;
	dispose(): void;
}

export class SkinnedMesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Mesh<G, M> {
	readonly isSkinnedMesh: true;
	bindMode: 'attached' | 'detached';
	bindMatrix: Matrix4;
	bindMatrixInverse: Matrix4;
	skeleton: Skeleton | undefined;
	boundingBox: Box3 | null;
	boundingSphere: any;
	bind( skeleton: Skeleton, bindMatrix?: Matrix4 ): void;
	pose(): void;
	normalizeSkinWeights(): void;
	applyBoneTransform( index: number, target: Vector3 ): Vector3;
	computeBoundingBox(): void;
	computeBoundingSphere(): void;
}

export class RectAreaLight extends Light {
	constructor( color?: ColorRepresentation, intensity?: number, width?: number, height?: number );
	readonly isRectAreaLight: true;
	width: number;
	height: number;
	power: number;
}

export class SphericalHarmonics3 {
	coefficients: Vector3[];
	set( coefficients: Vector3[] ): this;
	zero(): this;
	getAt( normal: Vector3, target: Vector3 ): Vector3;
	getIrradianceAt( normal: Vector3, target: Vector3 ): Vector3;
	add( sh: SphericalHarmonics3 ): this;
	addScaledSH( sh: SphericalHarmonics3, s: number ): this;
	scale( s: number ): this;
	lerp( sh: SphericalHarmonics3, alpha: number ): this;
	equals( sh: SphericalHarmonics3 ): boolean;
	copy( sh: SphericalHarmonics3 ): this;
	clone(): SphericalHarmonics3;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	static getBasisAt( normal: Vector3, shBasis: number[] ): void;
}

export class LightProbe extends Light {
	constructor( sh?: SphericalHarmonics3, intensity?: number );
	readonly isLightProbe: true;
	sh: SphericalHarmonics3;
}

// ---------------------------------------------------------------- shader materials and textures

export interface IUniform<T = any> { value: T }

export class ShaderMaterial extends Material {
	constructor( parameters?: Record<string, any> );
	readonly isShaderMaterial: true;
	uniforms: Record<string, IUniform>;
	defines: Record<string, any>;
	vertexShader: string;
	fragmentShader: string;
	glslVersion: string | null;
	lights: boolean;
	fog: boolean;
	wireframe: boolean;
	set needsUpdate( value: boolean );
}

export class RawShaderMaterial extends ShaderMaterial { readonly isRawShaderMaterial: true }

export const UniformsUtils: { clone( uniforms: Record<string, IUniform> ): Record<string, IUniform>; merge( uniforms: Record<string, IUniform>[] ): Record<string, IUniform> };

export class DepthTexture extends Texture {
	constructor( width: number, height: number, type?: number );
	readonly isDepthTexture: true;
}

// ---------------------------------------------------------------- curves and shapes

export class Curve<T extends Vector2 | Vector3 = Vector2 | Vector3> {
	type: string;
	arcLengthDivisions: number;
	getPoint( t: number, target?: T ): T;
	getPointAt( u: number, target?: T ): T;
	getPoints( divisions?: number ): T[];
	getSpacedPoints( divisions?: number ): T[];
	getLength(): number;
	getLengths( divisions?: number ): number[];
	updateArcLengths(): void;
	getUtoTmapping( u: number, distance?: number | null ): number;
	getTangent( t: number, target?: T ): T;
	getTangentAt( u: number, target?: T ): T;
	computeFrenetFrames( segments: number, closed?: boolean ): { tangents: Vector3[]; normals: Vector3[]; binormals: Vector3[] };
	clone(): this;
	copy( source: Curve<T> ): this;
}

export class EllipseCurve extends Curve<Vector2> { constructor( aX?: number, aY?: number, xRadius?: number, yRadius?: number, aStartAngle?: number, aEndAngle?: number, aClockwise?: boolean, aRotation?: number ); }
export class ArcCurve extends EllipseCurve { constructor( aX?: number, aY?: number, aRadius?: number, aStartAngle?: number, aEndAngle?: number, aClockwise?: boolean ); }
export class CatmullRomCurve3 extends Curve<Vector3> { constructor( points?: Vector3[], closed?: boolean, curveType?: 'centripetal' | 'chordal' | 'catmullrom', tension?: number ); points: Vector3[]; closed: boolean; }
export class CubicBezierCurve extends Curve<Vector2> { constructor( v0?: Vector2, v1?: Vector2, v2?: Vector2, v3?: Vector2 ); }
export class CubicBezierCurve3 extends Curve<Vector3> { constructor( v0?: Vector3, v1?: Vector3, v2?: Vector3, v3?: Vector3 ); }
export class LineCurve extends Curve<Vector2> { constructor( v1?: Vector2, v2?: Vector2 ); }
export class LineCurve3 extends Curve<Vector3> { constructor( v1?: Vector3, v2?: Vector3 ); }
export class QuadraticBezierCurve extends Curve<Vector2> { constructor( v0?: Vector2, v1?: Vector2, v2?: Vector2 ); }
export class QuadraticBezierCurve3 extends Curve<Vector3> { constructor( v0?: Vector3, v1?: Vector3, v2?: Vector3 ); }
export class SplineCurve extends Curve<Vector2> { constructor( points?: Vector2[] ); points: Vector2[]; }
export const Curves: Record<string, new ( ...args: any[] ) => Curve>;

export class CurvePath<T extends Vector2 | Vector3 = Vector2 | Vector3> extends Curve<T> {
	curves: Curve<T>[];
	autoClose: boolean;
	add( curve: Curve<T> ): void;
	closePath(): this;
	getCurveLengths(): number[];
}

export class Path extends CurvePath<Vector2> {
	constructor( points?: Vector2[] );
	currentPoint: Vector2;
	setFromPoints( points: Vector2[] ): this;
	moveTo( x: number, y: number ): this;
	lineTo( x: number, y: number ): this;
	quadraticCurveTo( aCPx: number, aCPy: number, aX: number, aY: number ): this;
	bezierCurveTo( aCP1x: number, aCP1y: number, aCP2x: number, aCP2y: number, aX: number, aY: number ): this;
	splineThru( pts: Vector2[] ): this;
	arc( aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean ): this;
	absarc( aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean ): this;
	ellipse( aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number ): this;
	absellipse( aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number ): this;
}

export class Shape extends Path {
	uuid: string;
	holes: Path[];
	getPointsHoles( divisions: number ): Vector2[][];
	extractPoints( divisions: number ): { shape: Vector2[]; holes: Vector2[][] };
}

export class ShapePath {
	subPaths: Path[];
	currentPath: Path | null;
	color: Color;
	userData: Record<string, any>;
	moveTo( x: number, y: number ): this;
	lineTo( x: number, y: number ): this;
	quadraticCurveTo( aCPx: number, aCPy: number, aX: number, aY: number ): this;
	bezierCurveTo( aCP1x: number, aCP1y: number, aCP2x: number, aCP2y: number, aX: number, aY: number ): this;
	splineThru( pts: Vector2[] ): this;
	toShapes(): Shape[];
}

export class ShapeUtils {
	static area( contour: Vector2[] ): number;
	static isClockWise( pts: Vector2[] ): boolean;
	static triangulateShape( contour: Vector2[], holes: Vector2[][] ): number[][];
}

export const Earcut: { triangulate( data: ArrayLike<number>, holeIndices?: number[], dim?: number ): number[] };

export class Box2 {
	constructor( min?: Vector2, max?: Vector2 );
	min: Vector2;
	max: Vector2;
	[ method: string ]: any;
}

export class ShapeGeometry extends BufferGeometry { constructor( shapes?: Shape | Shape[], curveSegments?: number ); }
export class ExtrudeGeometry extends BufferGeometry { constructor( shapes?: Shape | Shape[], options?: Record<string, any> ); }
export class TubeGeometry extends BufferGeometry { constructor( path?: Curve<Vector3>, tubularSegments?: number, radius?: number, radialSegments?: number, closed?: boolean ); tangents: Vector3[]; normals: Vector3[]; binormals: Vector3[]; }
export class EdgesGeometry extends BufferGeometry { constructor( geometry?: BufferGeometry | null, thresholdAngle?: number ); }
export class WireframeGeometry extends BufferGeometry { constructor( geometry?: BufferGeometry | null ); }

// ---------------------------------------------------------------- animation

export class Interpolant {
	constructor( parameterPositions: ArrayLike<number>, sampleValues: ArrayLike<number>, sampleSize: number, resultBuffer?: ArrayLike<number> );
	evaluate( t: number ): ArrayLike<number>;
	[ key: string ]: any;
}
export class DiscreteInterpolant extends Interpolant {}
export class LinearInterpolant extends Interpolant {}
export class QuaternionLinearInterpolant extends Interpolant {}
export class CubicInterpolant extends Interpolant {}
export class BezierInterpolant extends Interpolant {}

export class KeyframeTrack {
	constructor( name: string, times: ArrayLike<number>, values: ArrayLike<any>, interpolation?: number );
	name: string;
	times: Float32Array;
	values: any;
	ValueTypeName: string;
	setInterpolation( interpolation: number ): this;
	getInterpolation(): number;
	getValueSize(): number;
	shift( timeOffset: number ): this;
	scale( timeScale: number ): this;
	trim( startTime: number, endTime: number ): this;
	validate(): boolean;
	optimize(): this;
	clone(): this;
	static toJSON( track: KeyframeTrack ): any;
}
export class BooleanKeyframeTrack extends KeyframeTrack {}
export class ColorKeyframeTrack extends KeyframeTrack {}
export class NumberKeyframeTrack extends KeyframeTrack {}
export class QuaternionKeyframeTrack extends KeyframeTrack {}
export class StringKeyframeTrack extends KeyframeTrack {}
export class VectorKeyframeTrack extends KeyframeTrack {}

export class AnimationClip {
	constructor( name?: string, duration?: number, tracks?: KeyframeTrack[], blendMode?: number );
	name: string;
	tracks: KeyframeTrack[];
	duration: number;
	blendMode: number;
	uuid: string;
	userData: Record<string, any>;
	resetDuration(): this;
	trim(): this;
	validate(): boolean;
	optimize(): this;
	clone(): this;
	toJSON(): any;
	static parse( json: any ): AnimationClip;
	static toJSON( clip: AnimationClip ): any;
	static findByName( objectOrClipArray: AnimationClip[] | Object3D, name: string ): AnimationClip | null;
	static CreateFromMorphTargetSequence( name: string, morphTargetSequence: Array<{ name: string }>, fps: number, noLoop: boolean ): AnimationClip;
	static CreateClipsFromMorphTargetSequences( morphTargets: Array<{ name: string }>, fps: number, noLoop: boolean ): AnimationClip[];
}

export class AnimationAction {
	loop: number;
	time: number;
	timeScale: number;
	weight: number;
	repetitions: number;
	paused: boolean;
	enabled: boolean;
	clampWhenFinished: boolean;
	zeroSlopeAtStart: boolean;
	zeroSlopeAtEnd: boolean;
	blendMode: number;
	play(): this;
	stop(): this;
	reset(): this;
	isRunning(): boolean;
	isScheduled(): boolean;
	startAt( time: number ): this;
	setLoop( mode: number, repetitions: number ): this;
	setEffectiveWeight( weight: number ): this;
	getEffectiveWeight(): number;
	fadeIn( duration: number ): this;
	fadeOut( duration: number ): this;
	crossFadeFrom( fadeOutAction: AnimationAction, duration: number, warp?: boolean ): this;
	crossFadeTo( fadeInAction: AnimationAction, duration: number, warp?: boolean ): this;
	stopFading(): this;
	setEffectiveTimeScale( timeScale: number ): this;
	getEffectiveTimeScale(): number;
	setDuration( duration: number ): this;
	syncWith( action: AnimationAction ): this;
	halt( duration: number ): this;
	warp( startTimeScale: number, endTimeScale: number, duration: number ): this;
	stopWarping(): this;
	getMixer(): AnimationMixer;
	getClip(): AnimationClip;
	getRoot(): Object3D;
}

export class AnimationMixer extends EventDispatcher {
	constructor( root: Object3D | AnimationObjectGroup );
	time: number;
	timeScale: number;
	clipAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup, blendMode?: number ): AnimationAction;
	existingAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup ): AnimationAction | null;
	stopAllAction(): this;
	update( deltaTime: number ): this;
	setTime( time: number ): this;
	getRoot(): Object3D | AnimationObjectGroup;
	uncacheClip( clip: AnimationClip ): void;
	uncacheRoot( root: Object3D | AnimationObjectGroup ): void;
	uncacheAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup ): void;
}

export class AnimationObjectGroup {
	constructor( ...objects: Object3D[] );
	uuid: string;
	add( ...objects: Object3D[] ): void;
	remove( ...objects: Object3D[] ): void;
	uncache( ...objects: Object3D[] ): void;
}

export class PropertyBinding {
	constructor( rootNode: any, path: string, parsedPath?: any );
	static create( root: any, path: string, parsedPath?: any ): PropertyBinding;
	static sanitizeNodeName( name: string ): string;
	static parseTrackName( trackName: string ): any;
	static findNode( root: any, nodeName: string | number ): any;
	getValue( array: ArrayLike<number>, offset: number ): void;
	setValue( array: ArrayLike<number>, offset: number ): void;
	bind(): void;
	unbind(): void;
}

export class PropertyMixer { constructor( binding: PropertyBinding, typeName: string, valueSize: number ); [ key: string ]: any; }

export const AnimationUtils: Record<string, ( ...args: any[] ) => any>;

// ---------------------------------------------------------------- loaders

export const Cache: { enabled: boolean; files: Record<string, any>; add( key: string, file: any ): void; get( key: string ): any; remove( key: string ): void; clear(): void };

export class LoadingManager {
	constructor( onLoad?: () => void, onProgress?: ( url: string, loaded: number, total: number ) => void, onError?: ( url: string ) => void );
	onStart?: ( url: string, loaded: number, total: number ) => void;
	onLoad?: () => void;
	onProgress?: ( url: string, loaded: number, total: number ) => void;
	onError?: ( url: string ) => void;
	itemStart( url: string ): void;
	itemEnd( url: string ): void;
	itemError( url: string ): void;
	resolveURL( url: string ): string;
	setURLModifier( callback?: ( url: string ) => string ): this;
	addHandler( regex: RegExp, loader: Loader ): this;
	removeHandler( regex: RegExp ): this;
	getHandler( file: string ): Loader | null;
	abort(): this;
}

export const DefaultLoadingManager: LoadingManager;

export class Loader<T = unknown> {
	constructor( manager?: LoadingManager );
	manager: LoadingManager;
	crossOrigin: string;
	withCredentials: boolean;
	path: string;
	resourcePath: string;
	requestHeader: Record<string, string>;
	load( url: string, onLoad?: ( data: T ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): any;
	loadAsync( url: string, onProgress?: ( event: ProgressEvent ) => void ): Promise<T>;
	setCrossOrigin( crossOrigin: string ): this;
	setWithCredentials( value: boolean ): this;
	setPath( path: string ): this;
	setResourcePath( resourcePath: string ): this;
	setRequestHeader( requestHeader: Record<string, string> ): this;
	abort(): this;
	static DEFAULT_MATERIAL_NAME: string;
}

export const LoaderUtils: { extractUrlBase( url: string ): string; resolveURL( url: string, path: string ): string };

export class FileLoader extends Loader<string | ArrayBuffer | any> {
	mimeType: string;
	responseType: '' | 'arraybuffer' | 'blob' | 'document' | 'json' | 'text';
	setResponseType( value: string ): this;
	setMimeType( value: string ): this;
}

export class ImageLoader extends Loader<HTMLImageElement> {}
export class ImageBitmapLoader extends Loader<ImageBitmap> { setOptions( options: ImageBitmapOptions ): this; }
export class TextureLoader extends Loader<Texture> { load( url: string, onLoad?: ( texture: Texture ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): Texture; }
export class CubeTextureLoader extends Loader<CubeTexture> { load( urls: string[], onLoad?: ( texture: CubeTexture ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): CubeTexture; }
export class DataTextureLoader extends Loader<DataTexture> { parse( buffer: ArrayBuffer ): any; }
export class AnimationLoader extends Loader<AnimationClip[]> { parse( json: any ): AnimationClip[]; }
export class BufferGeometryLoader extends Loader<BufferGeometry> { parse( json: any ): BufferGeometry; }
export class MaterialLoader extends Loader<Material> { textures: Record<string, Texture>; setTextures( textures: Record<string, Texture> ): this; parse( json: any ): Material; static createMaterialFromType( type: string ): Material; }
export class ObjectLoader extends Loader<Object3D> { parse( json: any, onLoad?: ( object: Object3D ) => void ): void; parseAsync( json: any ): Promise<Object3D>; }

// ---------------------------------------------------------------- audio

export const AudioContext: { getContext(): globalThis.AudioContext; setContext( context: globalThis.AudioContext ): void };

export class AudioListener extends Object3D {
	context: globalThis.AudioContext;
	gain: GainNode;
	filter: AudioNode | null;
	timeDelta: number;
	getInput(): GainNode;
	removeFilter(): this;
	getFilter(): AudioNode | null;
	setFilter( value: AudioNode ): this;
	getMasterVolume(): number;
	setMasterVolume( value: number ): this;
}

export class Audio<N extends AudioNode = GainNode> extends Object3D {
	constructor( listener: AudioListener );
	listener: AudioListener;
	context: globalThis.AudioContext;
	gain: GainNode;
	autoplay: boolean;
	buffer: AudioBuffer | null;
	detune: number;
	loop: boolean;
	loopStart: number;
	loopEnd: number;
	offset: number;
	duration: number | undefined;
	playbackRate: number;
	isPlaying: boolean;
	hasPlaybackControl: boolean;
	sourceType: string;
	source: AudioNode | null;
	filters: AudioNode[];
	getOutput(): N;
	setNodeSource( audioNode: AudioNode ): this;
	setMediaElementSource( mediaElement: HTMLMediaElement ): this;
	setMediaStreamSource( mediaStream: MediaStream ): this;
	setBuffer( audioBuffer: AudioBuffer ): this;
	play( delay?: number ): this | undefined;
	pause(): this | undefined;
	stop( delay?: number ): this | undefined;
	connect(): this;
	disconnect(): this | undefined;
	getFilters(): AudioNode[];
	setFilters( value: AudioNode[] ): this;
	setDetune( value: number ): this;
	getDetune(): number;
	getFilter(): AudioNode;
	setFilter( filter: AudioNode ): this;
	setPlaybackRate( value: number ): this | undefined;
	getPlaybackRate(): number;
	onEnded(): void;
	getLoop(): boolean;
	setLoop( value: boolean ): this | undefined;
	setLoopStart( value: number ): this;
	setLoopEnd( value: number ): this;
	getVolume(): number;
	setVolume( value: number ): this;
}

export class PositionalAudio extends Audio<PannerNode> {
	panner: PannerNode;
	getRefDistance(): number;
	setRefDistance( value: number ): this;
	getRolloffFactor(): number;
	setRolloffFactor( value: number ): this;
	getDistanceModel(): string;
	setDistanceModel( value: DistanceModelType ): this;
	getMaxDistance(): number;
	setMaxDistance( value: number ): this;
	setDirectionalCone( coneInnerAngle: number, coneOuterAngle: number, coneOuterGain: number ): this;
}

export class AudioAnalyser {
	constructor( audio: Audio<any>, fftSize?: number );
	analyser: AnalyserNode;
	data: Uint8Array;
	getFrequencyData(): Uint8Array;
	getAverageFrequency(): number;
}

export class AudioLoader extends Loader<AudioBuffer> {}

// ---------------------------------------------------------------- helpers

export class ArrowHelper extends Object3D {
	constructor( dir?: Vector3, origin?: Vector3, length?: number, color?: ColorRepresentation, headLength?: number, headWidth?: number );
	line: Line;
	cone: Mesh;
	setDirection( dir: Vector3 ): void;
	setLength( length: number, headLength?: number, headWidth?: number ): void;
	setColor( color: ColorRepresentation ): void;
	dispose(): void;
}
export class BoxHelper extends LineSegments { constructor( object?: Object3D, color?: ColorRepresentation ); update(): void; setFromObject( object: Object3D ): this; }
export class Box3Helper extends LineSegments { constructor( box: Box3, color?: ColorRepresentation ); box: Box3; }
export class PlaneHelper extends Line { constructor( plane: Plane, size?: number, hex?: ColorRepresentation ); plane: Plane; size: number; }
export class CameraHelper extends LineSegments { constructor( camera: Camera ); camera: Camera; update(): void; setColors( frustum: Color, cone: Color, up: Color, target: Color, cross: Color ): this; }
export class DirectionalLightHelper extends Object3D { constructor( light: DirectionalLight, size?: number, color?: ColorRepresentation ); light: DirectionalLight; update(): void; dispose(): void; }
export class PointLightHelper extends Mesh { constructor( light: PointLight, sphereSize?: number, color?: ColorRepresentation ); light: PointLight; update(): void; }
export class SpotLightHelper extends Object3D { constructor( light: SpotLight, color?: ColorRepresentation ); light: SpotLight; update(): void; dispose(): void; }
export class HemisphereLightHelper extends Object3D { constructor( light: HemisphereLight, size: number, color?: ColorRepresentation ); light: HemisphereLight; update(): void; dispose(): void; }
export class PolarGridHelper extends LineSegments { constructor( radius?: number, sectors?: number, rings?: number, divisions?: number, color1?: ColorRepresentation, color2?: ColorRepresentation ); }
export class SkeletonHelper extends LineSegments { constructor( object: Object3D ); root: Object3D; bones: Bone[]; setColors( color1: Color, color2: Color ): this; }

export interface Intersection {

	distance: number;
	point: Vector3;
	object: Object3D;
	/** For a line: where the segment that was hit starts. */
	index?: number;
	/** `null` for a line. */
	faceIndex: number | null;
	face: { a: number; b: number; c: number; normal: Vector3; materialIndex: number } | null;
	barycoord: Vector3 | null;
	uv?: Vector2;
	normal?: Vector3;
	/** For an `InstancedMesh`: the instance that was hit. */
	instanceId?: number;

}

export class Raycaster {

	constructor( origin?: Vector3, direction?: Vector3, near?: number, far?: number );
	ray: Ray;
	near: number;
	far: number;
	camera: Camera | null;
	/** `Line.threshold` is how close, in world units, the ray must pass to a line to hit it. */
	params: { Mesh: object; Line: { threshold: number }; LOD: object; Points: { threshold: number }; Sprite: object };
	set( origin: Vec3Like, direction: Vec3Like ): void;
	setFromCamera( coords: { x: number; y: number }, camera: Camera ): void;
	intersectObject( object: Object3D, recursive?: boolean, intersects?: Intersection[] ): Intersection[];
	intersectObjects( objects: Object3D[], recursive?: boolean, intersects?: Intersection[] ): Intersection[];

}

export interface WebGPURendererParameters {

	canvas?: HTMLCanvasElement;
	antialias?: boolean;
	powerPreference?: 'high-performance' | 'low-power';
	/** `'auto'` (default): WebGPU, else WebGL 2, else a software WebGPU adapter. `'webgpu'` or `'webgl'`: only that API. */
	backend?: 'auto' | 'webgpu' | 'webgl';
	/** As in three.js: the same as `backend: 'webgl'`. */
	forceWebGL?: boolean;

}

/** What draws the frames: WebGPU (`'webgpu'`, or `'webgpu-software'` on the browser's software adapter) or WebGL 2. */
export interface RenderBackend {

	readonly name: 'webgpu' | 'webgpu-software' | 'webgl';
	readonly isWebGPUBackend?: true;
	readonly isWebGLBackend?: true;

}

/** Draws a scene with WebGPU, or WebGL 2 where WebGPU is missing. `await renderer.init()` before the first `render`. */
export class WebGPURenderer {

	/** The backend drawing the frames, once `init()` has finished; otherwise null. */
	readonly backend: RenderBackend | null;

	/** Draws into `target` until set back to null (the canvas). */
	setRenderTarget( target: RenderTarget | null ): void;
	getRenderTarget(): RenderTarget | null;

	/** Applied when drawing to the canvas. `CustomToneMapping` is not supported and draws like `NoToneMapping`. */
	toneMapping: ToneMapping;
	toneMappingExposure: number;

	constructor( parameters?: WebGPURendererParameters );
	/** False on `WebGLRenderer`. */
	readonly isWebGPURenderer: boolean;
	domElement: HTMLCanvasElement;
	info: { render: { calls: number; triangles: number }; memory: { geometries: number } };
	init(): Promise<this>;
	getPixelRatio(): number;
	setPixelRatio( value: number ): void;
	setSize( width: number, height: number, updateStyle?: boolean ): void;
	getSize( target: Vector2 ): Vector2;
	setClearColor( color: ColorRepresentation ): void;
	getClearColor( target: Color ): Color;
	render( scene: Scene, camera: Camera ): void;
	renderAsync( scene: Scene, camera: Camera ): Promise<void>;
	setAnimationLoop( callback: ( ( time: number ) => void ) | null ): void;
	dispose(): void;

}

/** The same renderer drawing with WebGL 2, for code written for three.js's `WebGLRenderer`; it starts `init()` itself. */
export class WebGLRenderer extends WebGPURenderer {

	readonly isWebGLRenderer: true;

}
