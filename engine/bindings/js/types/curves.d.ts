// Curves, paths and shapes.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { Vector2, Vector3 } from './vectors.js';
import { Color } from './shapes.js';
import { BufferGeometry } from './geometry.js';

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
