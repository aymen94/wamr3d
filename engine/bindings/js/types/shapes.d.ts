// Colours, colour spaces, boxes, spheres, planes, rays, frustums, segments, triangles and coordinates.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import * as W from '../index.js';
import { AttributeLike, Chained, ColorRepresentation, Elements, Vec3Like } from './core.js';
import { Euler, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from './vectors.js';
import { Object3D } from './objects.js';
import { BufferAttribute, InterleavedBufferAttribute } from './geometry.js';

export const NoColorSpace: '';
export const SRGBColorSpace: 'srgb';
export const LinearSRGBColorSpace: 'srgb-linear';
export type ColorSpace = '' | 'srgb' | 'srgb-linear';

/** Colours are kept in the linear working colour space; `enabled` is always true. */
export const ColorManagement: { enabled: boolean; readonly workingColorSpace: 'srgb-linear'; convert( color: Color, source: ColorSpace, target: ColorSpace ): Color; toWorkingColorSpace( color: Color, colorSpace: ColorSpace ): Color; fromWorkingColorSpace( color: Color, colorSpace: ColorSpace ): Color };

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
