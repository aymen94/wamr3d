// Curves, paths and shapes, and the triangulation of shapes with holes.

import * as W from '../index.js';
import earcut from './lib/earcut.js';
import { Color } from './math.js';
import { Matrix4, Vector2, Vector3 } from './values.js';

const clamp = ( value, min, max ) => Math.max( min, Math.min( max, value ) );

// ---------------------------------------------------------------- interpolation

export function CatmullRom( t, p0, p1, p2, p3 ) {

	const v0 = ( p2 - p0 ) * 0.5, v1 = ( p3 - p1 ) * 0.5, t2 = t * t, t3 = t * t2;
	return ( 2 * p1 - 2 * p2 + v0 + v1 ) * t3 + ( - 3 * p1 + 3 * p2 - 2 * v0 - v1 ) * t2 + v0 * t + p1;

}

export function QuadraticBezier( t, p0, p1, p2 ) {

	const k = 1 - t;
	return k * k * p0 + 2 * k * t * p1 + t * t * p2;

}

export function CubicBezier( t, p0, p1, p2, p3 ) {

	const k = 1 - t;
	return k * k * k * p0 + 3 * k * k * t * p1 + 3 * k * t * t * p2 + t * t * t * p3;

}

// ---------------------------------------------------------------- Box2

export class Box2 {

	constructor( min = new Vector2( Infinity, Infinity ), max = new Vector2( - Infinity, - Infinity ) ) {

		this.min = min;
		this.max = max;

	}

	set( min, max ) {

		this.min.copy( min );
		this.max.copy( max );
		return this;

	}

	setFromPoints( points ) {

		this.makeEmpty();
		for ( const point of points ) this.expandByPoint( point );
		return this;

	}

	setFromCenterAndSize( center, size ) {

		const hx = size.x / 2, hy = size.y / 2;
		this.min.set( center.x - hx, center.y - hy );
		this.max.set( center.x + hx, center.y + hy );
		return this;

	}

	clone() {

		return new Box2().copy( this );

	}

	copy( box ) {

		this.min.copy( box.min );
		this.max.copy( box.max );
		return this;

	}

	makeEmpty() {

		this.min.x = this.min.y = Infinity;
		this.max.x = this.max.y = - Infinity;
		return this;

	}

	isEmpty() {

		return this.max.x < this.min.x || this.max.y < this.min.y;

	}

	getCenter( target ) {

		return this.isEmpty() ? target.set( 0, 0 ) : target.addVectors( this.min, this.max ).multiplyScalar( 0.5 );

	}

	getSize( target ) {

		return this.isEmpty() ? target.set( 0, 0 ) : target.subVectors( this.max, this.min );

	}

	expandByPoint( point ) {

		this.min.min( point );
		this.max.max( point );
		return this;

	}

	expandByVector( vector ) {

		this.min.sub( vector );
		this.max.add( vector );
		return this;

	}

	expandByScalar( scalar ) {

		this.min.addScalar( - scalar );
		this.max.addScalar( scalar );
		return this;

	}

	containsPoint( point ) {

		return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y;

	}

	containsBox( box ) {

		return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y;

	}

	getParameter( point, target ) {

		return target.set( ( point.x - this.min.x ) / ( this.max.x - this.min.x ), ( point.y - this.min.y ) / ( this.max.y - this.min.y ) );

	}

	intersectsBox( box ) {

		return box.max.x >= this.min.x && box.min.x <= this.max.x && box.max.y >= this.min.y && box.min.y <= this.max.y;

	}

	clampPoint( point, target ) {

		return target.copy( point ).clamp( this.min, this.max );

	}

	distanceToPoint( point ) {

		return this.clampPoint( point, new Vector2() ).distanceTo( point );

	}

	intersect( box ) {

		this.min.max( box.min );
		this.max.min( box.max );
		if ( this.isEmpty() ) this.makeEmpty();
		return this;

	}

	union( box ) {

		this.min.min( box.min );
		this.max.max( box.max );
		return this;

	}

	translate( offset ) {

		this.min.add( offset );
		this.max.add( offset );
		return this;

	}

	equals( box ) {

		return box.min.equals( this.min ) && box.max.equals( this.max );

	}

}

Box2.prototype.isBox2 = true;

// ---------------------------------------------------------------- Curve

/** A curve over t in 0..1. Subclasses define `getPoint( t, target )`. */
export class Curve {

	constructor() {

		this.type = 'Curve';
		this.arcLengthDivisions = 200;
		this.needsUpdate = false;
		this.cacheArcLengths = null;

	}

	getPoint() {

		console.warn( 'WAMR3D: Curve: .getPoint() not implemented.' );
		return null;

	}

	getPointAt( u, target ) {

		return this.getPoint( this.getUtoTmapping( u ), target );

	}

	getPoints( divisions = 5 ) {

		const points = [];
		for ( let d = 0; d <= divisions; d ++ ) points.push( this.getPoint( d / divisions ) );
		return points;

	}

	getSpacedPoints( divisions = 5 ) {

		const points = [];
		for ( let d = 0; d <= divisions; d ++ ) points.push( this.getPointAt( d / divisions ) );
		return points;

	}

	getLength() {

		const lengths = this.getLengths();
		return lengths[ lengths.length - 1 ];

	}

	getLengths( divisions = this.arcLengthDivisions ) {

		if ( this.cacheArcLengths && this.cacheArcLengths.length === divisions + 1 && ! this.needsUpdate ) return this.cacheArcLengths;
		this.needsUpdate = false;
		const cache = [ 0 ];
		let last = this.getPoint( 0 ), sum = 0;

		for ( let p = 1; p <= divisions; p ++ ) {

			const current = this.getPoint( p / divisions );
			sum += current.distanceTo( last );
			cache.push( sum );
			last = current;

		}

		this.cacheArcLengths = cache;
		return cache;

	}

	updateArcLengths() {

		this.needsUpdate = true;
		this.getLengths();

	}

	// The t at which the arc length is `u` of the whole (or `distance`).
	getUtoTmapping( u, distance = null ) {

		const arcLengths = this.getLengths(), il = arcLengths.length;
		const target = distance ? distance : u * arcLengths[ il - 1 ];
		let low = 0, high = il - 1, i = 0;

		while ( low <= high ) {

			i = Math.floor( low + ( high - low ) / 2 );
			const comparison = arcLengths[ i ] - target;

			if ( comparison < 0 ) {

				low = i + 1;

			} else if ( comparison > 0 ) {

				high = i - 1;

			} else {

				high = i;
				break;

			}

		}

		i = high;
		if ( arcLengths[ i ] === target ) return i / ( il - 1 );
		const before = arcLengths[ i ], after = arcLengths[ i + 1 ];
		return ( i + ( target - before ) / ( after - before ) ) / ( il - 1 );

	}

	getTangent( t, target ) {

		const delta = 0.0001, t1 = Math.max( 0, t - delta ), t2 = Math.min( 1, t + delta );
		const pt1 = this.getPoint( t1 ), pt2 = this.getPoint( t2 );
		const tangent = target || ( pt1.isVector2 ? new Vector2() : new Vector3() );
		return tangent.copy( pt2 ).sub( pt1 ).normalize();

	}

	getTangentAt( u, target ) {

		return this.getTangent( this.getUtoTmapping( u ), target );

	}

	// Tangents, normals and binormals along the curve with the least twist (parallel
	// transport), evened out over a closed curve.
	computeFrenetFrames( segments, closed = false ) {

		const normal = new Vector3(), vec = new Vector3(), mat = new Matrix4();
		const tangents = [], normals = [], binormals = [];
		for ( let i = 0; i <= segments; i ++ ) tangents[ i ] = this.getTangentAt( i / segments, new Vector3() );

		normals[ 0 ] = new Vector3();
		binormals[ 0 ] = new Vector3();
		let min = Number.MAX_VALUE;
		const tx = Math.abs( tangents[ 0 ].x ), ty = Math.abs( tangents[ 0 ].y ), tz = Math.abs( tangents[ 0 ].z );

		if ( tx <= min ) {

			min = tx;
			normal.set( 1, 0, 0 );

		}

		if ( ty <= min ) {

			min = ty;
			normal.set( 0, 1, 0 );

		}

		if ( tz <= min ) normal.set( 0, 0, 1 );

		vec.crossVectors( tangents[ 0 ], normal ).normalize();
		normals[ 0 ].crossVectors( tangents[ 0 ], vec );
		binormals[ 0 ].crossVectors( tangents[ 0 ], normals[ 0 ] );

		for ( let i = 1; i <= segments; i ++ ) {

			normals[ i ] = normals[ i - 1 ].clone();
			binormals[ i ] = binormals[ i - 1 ].clone();
			vec.crossVectors( tangents[ i - 1 ], tangents[ i ] );

			if ( vec.length() > Number.EPSILON ) {

				vec.normalize();
				const theta = Math.acos( clamp( tangents[ i - 1 ].dot( tangents[ i ] ), - 1, 1 ) );
				normals[ i ].applyMatrix4( mat.makeRotationAxis( vec, theta ) );

			}

			binormals[ i ].crossVectors( tangents[ i ], normals[ i ] );

		}

		if ( closed === true ) {

			let theta = Math.acos( clamp( normals[ 0 ].dot( normals[ segments ] ), - 1, 1 ) ) / segments;
			if ( tangents[ 0 ].dot( vec.crossVectors( normals[ 0 ], normals[ segments ] ) ) > 0 ) theta = - theta;

			for ( let i = 1; i <= segments; i ++ ) {

				normals[ i ].applyMatrix4( mat.makeRotationAxis( tangents[ i ], theta * i ) );
				binormals[ i ].crossVectors( tangents[ i ], normals[ i ] );

			}

		}

		return { tangents, normals, binormals };

	}

	clone() {

		return new this.constructor().copy( this );

	}

	copy( source ) {

		this.arcLengthDivisions = source.arcLengthDivisions;
		return this;

	}

	toJSON() {

		return { metadata: { version: 4.7, type: 'Curve', generator: 'Curve.toJSON' }, arcLengthDivisions: this.arcLengthDivisions, type: this.type };

	}

	fromJSON( json ) {

		this.arcLengthDivisions = json.arcLengthDivisions;
		return this;

	}

}

// ---------------------------------------------------------------- curves

export class EllipseCurve extends Curve {

	constructor( aX = 0, aY = 0, xRadius = 1, yRadius = 1, aStartAngle = 0, aEndAngle = Math.PI * 2, aClockwise = false, aRotation = 0 ) {

		super();
		this.type = 'EllipseCurve';
		this.aX = aX;
		this.aY = aY;
		this.xRadius = xRadius;
		this.yRadius = yRadius;
		this.aStartAngle = aStartAngle;
		this.aEndAngle = aEndAngle;
		this.aClockwise = aClockwise;
		this.aRotation = aRotation;

	}

	getPoint( t, target = new Vector2() ) {

		const twoPi = Math.PI * 2;
		let deltaAngle = this.aEndAngle - this.aStartAngle;
		const samePoints = Math.abs( deltaAngle ) < Number.EPSILON;
		while ( deltaAngle < 0 ) deltaAngle += twoPi;
		while ( deltaAngle > twoPi ) deltaAngle -= twoPi;
		if ( deltaAngle < Number.EPSILON ) deltaAngle = samePoints ? 0 : twoPi;
		if ( this.aClockwise === true && ! samePoints ) deltaAngle = deltaAngle === twoPi ? - twoPi : deltaAngle - twoPi;

		const angle = this.aStartAngle + t * deltaAngle;
		let x = this.aX + this.xRadius * Math.cos( angle ), y = this.aY + this.yRadius * Math.sin( angle );

		if ( this.aRotation !== 0 ) {

			const cos = Math.cos( this.aRotation ), sin = Math.sin( this.aRotation ), tx = x - this.aX, ty = y - this.aY;
			x = tx * cos - ty * sin + this.aX;
			y = tx * sin + ty * cos + this.aY;

		}

		return target.set( x, y );

	}

	copy( source ) {

		super.copy( source );
		this.aX = source.aX;
		this.aY = source.aY;
		this.xRadius = source.xRadius;
		this.yRadius = source.yRadius;
		this.aStartAngle = source.aStartAngle;
		this.aEndAngle = source.aEndAngle;
		this.aClockwise = source.aClockwise;
		this.aRotation = source.aRotation;
		return this;

	}

}

EllipseCurve.prototype.isEllipseCurve = true;

export class ArcCurve extends EllipseCurve {

	constructor( aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise ) {

		super( aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise );
		this.type = 'ArcCurve';

	}

}

ArcCurve.prototype.isArcCurve = true;

// A cubic between x1 and x2 with Catmull-Rom tangents, uniform or non-uniform (by the
// chord lengths dt0, dt1, dt2 of the four points).
function cubicPoly() {

	let c0 = 0, c1 = 0, c2 = 0, c3 = 0;

	function init( x0, x1, t0, t1 ) {

		c0 = x0;
		c1 = t0;
		c2 = - 3 * x0 + 3 * x1 - 2 * t0 - t1;
		c3 = 2 * x0 - 2 * x1 + t0 + t1;

	}

	return {

		initCatmullRom( x0, x1, x2, x3, tension ) {

			init( x1, x2, tension * ( x2 - x0 ), tension * ( x3 - x1 ) );

		},

		initNonuniformCatmullRom( x0, x1, x2, x3, dt0, dt1, dt2 ) {

			const t1 = ( ( x1 - x0 ) / dt0 - ( x2 - x0 ) / ( dt0 + dt1 ) + ( x2 - x1 ) / dt1 ) * dt1;
			const t2 = ( ( x2 - x1 ) / dt1 - ( x3 - x1 ) / ( dt1 + dt2 ) + ( x3 - x2 ) / dt2 ) * dt1;
			init( x1, x2, t1, t2 );

		},

		calc( t ) {

			const t2 = t * t;
			return c0 + c1 * t + c2 * t2 + c3 * t2 * t;

		}

	};

}

const _tmp = new Vector3(), _tmp2 = new Vector3(), _px = cubicPoly(), _py = cubicPoly(), _pz = cubicPoly();

/** A smooth curve through `points`; `curveType` is 'centripetal' (default), 'chordal' or 'catmullrom' (with `tension`). */
export class CatmullRomCurve3 extends Curve {

	constructor( points = [], closed = false, curveType = 'centripetal', tension = 0.5 ) {

		super();
		this.type = 'CatmullRomCurve3';
		this.points = points;
		this.closed = closed;
		this.curveType = curveType;
		this.tension = tension;

	}

	getPoint( t, target = new Vector3() ) {

		const points = this.points, l = points.length;
		const p = ( l - ( this.closed ? 0 : 1 ) ) * t;
		let intPoint = Math.floor( p ), weight = p - intPoint;

		if ( this.closed ) {

			intPoint += intPoint > 0 ? 0 : ( Math.floor( Math.abs( intPoint ) / l ) + 1 ) * l;

		} else if ( weight === 0 && intPoint === l - 1 ) {

			intPoint = l - 2;
			weight = 1;

		}

		const p0 = this.closed || intPoint > 0 ? points[ ( intPoint - 1 ) % l ] : _tmp2.subVectors( points[ 0 ], points[ 1 ] ).add( points[ 0 ] );
		const p1 = points[ intPoint % l ], p2 = points[ ( intPoint + 1 ) % l ];
		const p3 = this.closed || intPoint + 2 < l ? points[ ( intPoint + 2 ) % l ] : _tmp.subVectors( points[ l - 1 ], points[ l - 2 ] ).add( points[ l - 1 ] );

		if ( this.curveType === 'centripetal' || this.curveType === 'chordal' ) {

			const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
			let dt0 = Math.pow( p0.distanceToSquared( p1 ), pow ), dt1 = Math.pow( p1.distanceToSquared( p2 ), pow ), dt2 = Math.pow( p2.distanceToSquared( p3 ), pow );
			// safety check for repeated points
			if ( dt1 < 1e-4 ) dt1 = 1.0;
			if ( dt0 < 1e-4 ) dt0 = dt1;
			if ( dt2 < 1e-4 ) dt2 = dt1;
			_px.initNonuniformCatmullRom( p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2 );
			_py.initNonuniformCatmullRom( p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2 );
			_pz.initNonuniformCatmullRom( p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2 );

		} else if ( this.curveType === 'catmullrom' ) {

			_px.initCatmullRom( p0.x, p1.x, p2.x, p3.x, this.tension );
			_py.initCatmullRom( p0.y, p1.y, p2.y, p3.y, this.tension );
			_pz.initCatmullRom( p0.z, p1.z, p2.z, p3.z, this.tension );

		}

		return target.set( _px.calc( weight ), _py.calc( weight ), _pz.calc( weight ) );

	}

	copy( source ) {

		super.copy( source );
		this.points = source.points.map( ( point ) => point.clone() );
		this.closed = source.closed;
		this.curveType = source.curveType;
		this.tension = source.tension;
		return this;

	}

}

CatmullRomCurve3.prototype.isCatmullRomCurve3 = true;

export class CubicBezierCurve extends Curve {

	constructor( v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2(), v3 = new Vector2() ) {

		super();
		this.type = 'CubicBezierCurve';
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
		this.v3 = v3;

	}

	getPoint( t, target = new Vector2() ) {

		const { v0, v1, v2, v3 } = this;
		return target.set( CubicBezier( t, v0.x, v1.x, v2.x, v3.x ), CubicBezier( t, v0.y, v1.y, v2.y, v3.y ) );

	}

	copy( source ) {

		super.copy( source );
		this.v0.copy( source.v0 );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		this.v3.copy( source.v3 );
		return this;

	}

}

CubicBezierCurve.prototype.isCubicBezierCurve = true;

export class CubicBezierCurve3 extends Curve {

	constructor( v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3() ) {

		super();
		this.type = 'CubicBezierCurve3';
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;
		this.v3 = v3;

	}

	getPoint( t, target = new Vector3() ) {

		const { v0, v1, v2, v3 } = this;
		return target.set( CubicBezier( t, v0.x, v1.x, v2.x, v3.x ), CubicBezier( t, v0.y, v1.y, v2.y, v3.y ), CubicBezier( t, v0.z, v1.z, v2.z, v3.z ) );

	}

	copy( source ) {

		super.copy( source );
		this.v0.copy( source.v0 );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		this.v3.copy( source.v3 );
		return this;

	}

}

CubicBezierCurve3.prototype.isCubicBezierCurve3 = true;

export class LineCurve extends Curve {

	constructor( v1 = new Vector2(), v2 = new Vector2() ) {

		super();
		this.type = 'LineCurve';
		this.v1 = v1;
		this.v2 = v2;

	}

	getPoint( t, target = new Vector2() ) {

		if ( t === 1 ) return target.copy( this.v2 );
		return target.copy( this.v2 ).sub( this.v1 ).multiplyScalar( t ).add( this.v1 );

	}

	getPointAt( u, target ) {

		return this.getPoint( u, target );

	}

	getTangent( t, target = new Vector2() ) {

		return target.subVectors( this.v2, this.v1 ).normalize();

	}

	getTangentAt( u, target ) {

		return this.getTangent( u, target );

	}

	copy( source ) {

		super.copy( source );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		return this;

	}

}

LineCurve.prototype.isLineCurve = true;

export class LineCurve3 extends Curve {

	constructor( v1 = new Vector3(), v2 = new Vector3() ) {

		super();
		this.type = 'LineCurve3';
		this.v1 = v1;
		this.v2 = v2;

	}

	getPoint( t, target = new Vector3() ) {

		if ( t === 1 ) return target.copy( this.v2 );
		return target.copy( this.v2 ).sub( this.v1 ).multiplyScalar( t ).add( this.v1 );

	}

	getPointAt( u, target ) {

		return this.getPoint( u, target );

	}

	getTangent( t, target = new Vector3() ) {

		return target.subVectors( this.v2, this.v1 ).normalize();

	}

	getTangentAt( u, target ) {

		return this.getTangent( u, target );

	}

	copy( source ) {

		super.copy( source );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		return this;

	}

}

LineCurve3.prototype.isLineCurve3 = true;

export class QuadraticBezierCurve extends Curve {

	constructor( v0 = new Vector2(), v1 = new Vector2(), v2 = new Vector2() ) {

		super();
		this.type = 'QuadraticBezierCurve';
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;

	}

	getPoint( t, target = new Vector2() ) {

		const { v0, v1, v2 } = this;
		return target.set( QuadraticBezier( t, v0.x, v1.x, v2.x ), QuadraticBezier( t, v0.y, v1.y, v2.y ) );

	}

	copy( source ) {

		super.copy( source );
		this.v0.copy( source.v0 );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		return this;

	}

}

QuadraticBezierCurve.prototype.isQuadraticBezierCurve = true;

export class QuadraticBezierCurve3 extends Curve {

	constructor( v0 = new Vector3(), v1 = new Vector3(), v2 = new Vector3() ) {

		super();
		this.type = 'QuadraticBezierCurve3';
		this.v0 = v0;
		this.v1 = v1;
		this.v2 = v2;

	}

	getPoint( t, target = new Vector3() ) {

		const { v0, v1, v2 } = this;
		return target.set( QuadraticBezier( t, v0.x, v1.x, v2.x ), QuadraticBezier( t, v0.y, v1.y, v2.y ), QuadraticBezier( t, v0.z, v1.z, v2.z ) );

	}

	copy( source ) {

		super.copy( source );
		this.v0.copy( source.v0 );
		this.v1.copy( source.v1 );
		this.v2.copy( source.v2 );
		return this;

	}

}

QuadraticBezierCurve3.prototype.isQuadraticBezierCurve3 = true;

/** A 2D Catmull-Rom spline through `points`. */
export class SplineCurve extends Curve {

	constructor( points = [] ) {

		super();
		this.type = 'SplineCurve';
		this.points = points;

	}

	getPoint( t, target = new Vector2() ) {

		const points = this.points, p = ( points.length - 1 ) * t;
		const intPoint = Math.floor( p ), weight = p - intPoint;
		const p0 = points[ intPoint === 0 ? intPoint : intPoint - 1 ];
		const p1 = points[ intPoint ];
		const p2 = points[ intPoint > points.length - 2 ? points.length - 1 : intPoint + 1 ];
		const p3 = points[ intPoint > points.length - 3 ? points.length - 1 : intPoint + 2 ];
		return target.set( CatmullRom( weight, p0.x, p1.x, p2.x, p3.x ), CatmullRom( weight, p0.y, p1.y, p2.y, p3.y ) );

	}

	copy( source ) {

		super.copy( source );
		this.points = source.points.map( ( point ) => point.clone() );
		return this;

	}

}

SplineCurve.prototype.isSplineCurve = true;

export const Curves = { ArcCurve, CatmullRomCurve3, CubicBezierCurve, CubicBezierCurve3, EllipseCurve, LineCurve, LineCurve3, QuadraticBezierCurve, QuadraticBezierCurve3, SplineCurve };

// ---------------------------------------------------------------- paths

/** Curves joined end to end, parameterized by arc length over the whole. */
export class CurvePath extends Curve {

	constructor() {

		super();
		this.type = 'CurvePath';
		this.curves = [];
		this.autoClose = false;

	}

	add( curve ) {

		this.curves.push( curve );

	}

	closePath() {

		const start = this.curves[ 0 ].getPoint( 0 ), end = this.curves[ this.curves.length - 1 ].getPoint( 1 );
		if ( ! start.equals( end ) ) this.curves.push( start.isVector2 === true ? new LineCurve( end, start ) : new LineCurve3( end, start ) );
		return this;

	}

	getPoint( t, target ) {

		const d = t * this.getLength(), lengths = this.getCurveLengths();

		for ( let i = 0; i < lengths.length; i ++ ) {

			if ( lengths[ i ] >= d ) {

				const diff = lengths[ i ] - d, curve = this.curves[ i ], length = curve.getLength();
				return curve.getPointAt( length === 0 ? 0 : 1 - diff / length, target );

			}

		}

		return null;

	}

	getLength() {

		const lengths = this.getCurveLengths();
		return lengths[ lengths.length - 1 ];

	}

	updateArcLengths() {

		this.needsUpdate = true;
		this.cacheLengths = null;
		this.getCurveLengths();

	}

	getCurveLengths() {

		if ( this.cacheLengths && this.cacheLengths.length === this.curves.length ) return this.cacheLengths;
		const lengths = [];
		let sums = 0;

		for ( const curve of this.curves ) {

			sums += curve.getLength();
			lengths.push( sums );

		}

		this.cacheLengths = lengths;
		return lengths;

	}

	getSpacedPoints( divisions = 40 ) {

		const points = [];
		for ( let i = 0; i <= divisions; i ++ ) points.push( this.getPoint( i / divisions ) );
		if ( this.autoClose ) points.push( points[ 0 ] );
		return points;

	}

	// Points per curve: two for lines, twice `divisions` for ellipses, per control point for splines.
	getPoints( divisions = 12 ) {

		const points = [];
		let last;

		for ( const curve of this.curves ) {

			const resolution = curve.isEllipseCurve ? divisions * 2 : ( curve.isLineCurve || curve.isLineCurve3 ) ? 1 : curve.isSplineCurve ? divisions * curve.points.length : divisions;

			for ( const point of curve.getPoints( resolution ) ) {

				if ( last && last.equals( point ) ) continue;
				points.push( point );
				last = point;

			}

		}

		if ( this.autoClose && points.length > 1 && ! points[ points.length - 1 ].equals( points[ 0 ] ) ) points.push( points[ 0 ] );
		return points;

	}

	copy( source ) {

		super.copy( source );
		this.curves = source.curves.map( ( curve ) => curve.clone() );
		this.autoClose = source.autoClose;
		return this;

	}

}

/** A 2D path drawn with canvas-like commands. */
export class Path extends CurvePath {

	constructor( points ) {

		super();
		this.type = 'Path';
		this.currentPoint = new Vector2();
		if ( points ) this.setFromPoints( points );

	}

	setFromPoints( points ) {

		this.moveTo( points[ 0 ].x, points[ 0 ].y );
		for ( let i = 1; i < points.length; i ++ ) this.lineTo( points[ i ].x, points[ i ].y );
		return this;

	}

	moveTo( x, y ) {

		this.currentPoint.set( x, y );
		return this;

	}

	lineTo( x, y ) {

		this.curves.push( new LineCurve( this.currentPoint.clone(), new Vector2( x, y ) ) );
		this.currentPoint.set( x, y );
		return this;

	}

	quadraticCurveTo( aCPx, aCPy, aX, aY ) {

		this.curves.push( new QuadraticBezierCurve( this.currentPoint.clone(), new Vector2( aCPx, aCPy ), new Vector2( aX, aY ) ) );
		this.currentPoint.set( aX, aY );
		return this;

	}

	bezierCurveTo( aCP1x, aCP1y, aCP2x, aCP2y, aX, aY ) {

		this.curves.push( new CubicBezierCurve( this.currentPoint.clone(), new Vector2( aCP1x, aCP1y ), new Vector2( aCP2x, aCP2y ), new Vector2( aX, aY ) ) );
		this.currentPoint.set( aX, aY );
		return this;

	}

	splineThru( pts ) {

		this.curves.push( new SplineCurve( [ this.currentPoint.clone() ].concat( pts ) ) );
		this.currentPoint.copy( pts[ pts.length - 1 ] );
		return this;

	}

	arc( aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise ) {

		this.absarc( aX + this.currentPoint.x, aY + this.currentPoint.y, aRadius, aStartAngle, aEndAngle, aClockwise );
		return this;

	}

	absarc( aX, aY, aRadius, aStartAngle, aEndAngle, aClockwise ) {

		this.absellipse( aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise );
		return this;

	}

	ellipse( aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation ) {

		this.absellipse( aX + this.currentPoint.x, aY + this.currentPoint.y, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation );
		return this;

	}

	// An ellipse joined to the path by a line when it does not start at the current point.
	absellipse( aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation ) {

		const curve = new EllipseCurve( aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation );

		if ( this.curves.length > 0 ) {

			const first = curve.getPoint( 0 );
			if ( ! first.equals( this.currentPoint ) ) this.lineTo( first.x, first.y );

		}

		this.curves.push( curve );
		this.currentPoint.copy( curve.getPoint( 1 ) );
		return this;

	}

	copy( source ) {

		super.copy( source );
		this.currentPoint.copy( source.currentPoint );
		return this;

	}

}

/** A closed 2D outline with optional `holes` (paths), for `ShapeGeometry` and `ExtrudeGeometry`. */
export class Shape extends Path {

	constructor( points ) {

		super( points );
		this.uuid = W.MathUtils.generateUUID();
		this.type = 'Shape';
		this.holes = [];

	}

	getPointsHoles( divisions ) {

		return this.holes.map( ( hole ) => hole.getPoints( divisions ) );

	}

	extractPoints( divisions ) {

		return { shape: this.getPoints( divisions ), holes: this.getPointsHoles( divisions ) };

	}

	copy( source ) {

		super.copy( source );
		this.holes = source.holes.map( ( hole ) => hole.clone() );
		return this;

	}

}

// ---------------------------------------------------------------- ShapeUtils

function removeDupEndPts( points ) {

	const l = points.length;
	if ( l > 2 && points[ l - 1 ].equals( points[ 0 ] ) ) points.pop();

}

export const Earcut = {

	triangulate( data, holeIndices, dim = 2 ) {

		return earcut( data, holeIndices, dim );

	}

};

export class ShapeUtils {

	/** Signed area of a contour; negative when clockwise. */
	static area( contour ) {

		const n = contour.length;
		let a = 0;
		for ( let p = n - 1, q = 0; q < n; p = q ++ ) a += contour[ p ].x * contour[ q ].y - contour[ q ].x * contour[ p ].y;
		return a * 0.5;

	}

	static isClockWise( pts ) {

		return ShapeUtils.area( pts ) < 0;

	}

	/** Triangles over the contour followed by the holes' points, as index triples. Removes duplicated end points in place. */
	static triangulateShape( contour, holes ) {

		const vertices = [], holeIndices = [], faces = [];
		removeDupEndPts( contour );
		for ( const point of contour ) vertices.push( point.x, point.y );
		let holeIndex = contour.length;
		holes.forEach( removeDupEndPts );

		for ( const hole of holes ) {

			holeIndices.push( holeIndex );
			holeIndex += hole.length;
			for ( const point of hole ) vertices.push( point.x, point.y );

		}

		const triangles = earcut( vertices, holeIndices );
		for ( let i = 0; i < triangles.length; i += 3 ) faces.push( triangles.slice( i, i + 3 ) );
		return faces;

	}

}

// ---------------------------------------------------------------- ShapePath

function pointInPolygon( p, polygon ) {

	let inside = false;

	for ( let i = 0, n = polygon.length, j = n - 1; i < n; j = i ++ ) {

		const a = polygon[ i ], b = polygon[ j ];
		if ( ( a.y > p.y ) !== ( b.y > p.y ) && p.x < ( b.x - a.x ) * ( p.y - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;

	}

	return inside;

}

// A point inside the polygon: the box centre, else the middle of the first span across it.
function interiorPoint( polygon, box ) {

	const point = box.getCenter( new Vector2() );
	if ( pointInPolygon( point, polygon ) ) return point;
	const y = point.y, intercepts = [];

	for ( let i = 0, n = polygon.length; i < n; i ++ ) {

		const a = polygon[ i ], b = polygon[ ( i + 1 ) % n ];
		if ( ( a.y > y ) !== ( b.y > y ) ) intercepts.push( a.x + ( y - a.y ) * ( b.x - a.x ) / ( b.y - a.y ) );

	}

	if ( intercepts.length > 1 ) {

		intercepts.sort( ( a, b ) => a - b );
		point.x = ( intercepts[ 0 ] + intercepts[ 1 ] ) / 2;

	}

	return point;

}

/** Sub-paths, as an SVG path gives them; `toShapes()` sorts them into outlines and holes by the fill rule. */
export class ShapePath {

	constructor() {

		this.type = 'ShapePath';
		this.color = new Color();
		this.subPaths = [];
		this.currentPath = null;
		this.userData = {};

	}

	moveTo( x, y ) {

		this.currentPath = new Path();
		this.subPaths.push( this.currentPath );
		this.currentPath.moveTo( x, y );
		return this;

	}

	lineTo( x, y ) {

		this.currentPath.lineTo( x, y );
		return this;

	}

	quadraticCurveTo( aCPx, aCPy, aX, aY ) {

		this.currentPath.quadraticCurveTo( aCPx, aCPy, aX, aY );
		return this;

	}

	bezierCurveTo( aCP1x, aCP1y, aCP2x, aCP2y, aX, aY ) {

		this.currentPath.bezierCurveTo( aCP1x, aCP1y, aCP2x, aCP2y, aX, aY );
		return this;

	}

	splineThru( pts ) {

		this.currentPath.splineThru( pts );
		return this;

	}

	// Each sub-path is nested in the smallest larger one containing it; with the winding
	// numbers so obtained, the fill rule ('nonzero' or 'evenodd', from
	// `userData.style.fillRule`) decides which are outlines and which are holes.
	toShapes() {

		let fillRule = ( this.userData.style && this.userData.style.fillRule ) || 'nonzero';

		if ( fillRule !== 'nonzero' && fillRule !== 'evenodd' ) {

			console.warn( `WAMR3D: Fill-rule "${fillRule}" is not supported, falling back to "nonzero".` );
			fillRule = 'nonzero';

		}

		const isInside = fillRule === 'nonzero' ? ( w ) => w !== 0 : ( w ) => ( w & 1 ) !== 0;
		const entries = [];

		for ( const subPath of this.subPaths ) {

			const points = subPath.getPoints();
			if ( points.length < 3 ) continue;
			const area = ShapeUtils.area( points );
			if ( area === 0 ) continue;
			const box = new Box2().setFromPoints( points );
			entries.push( { subPath, points, box, interior: interiorPoint( points, box ), absArea: Math.abs( area ), winding: area < 0 ? - 1 : 1, container: null, exclude: false, role: null } );

		}

		entries.sort( ( a, b ) => b.absArea - a.absArea );

		for ( let i = 0; i < entries.length; i ++ ) {

			const entry = entries[ i ];
			let containerWinding = 0;

			for ( let j = i - 1; j >= 0; j -- ) {

				const candidate = entries[ j ];
				if ( ! candidate.box.containsBox( entry.box ) || ! pointInPolygon( entry.interior, candidate.points ) ) continue;
				entry.container = candidate.exclude ? candidate.container : candidate;
				containerWinding = candidate.winding;
				entry.winding += containerWinding;
				break;

			}

			// a sub-path that does not change insideness draws nothing
			if ( isInside( entry.winding ) === isInside( containerWinding ) ) entry.exclude = true;

		}

		for ( const entry of entries ) {

			if ( ! entry.exclude ) entry.role = entry.container === null || entry.container.role === 'hole' ? 'outer' : 'hole';

		}

		const shapes = [], shapeOf = new Map();

		for ( const entry of entries ) {

			if ( entry.exclude || entry.role !== 'outer' ) continue;
			const shape = new Shape();
			shape.curves = entry.subPath.curves;
			shapes.push( shape );
			shapeOf.set( entry, shape );

		}

		for ( const entry of entries ) {

			if ( entry.exclude || entry.role !== 'hole' ) continue;
			const shape = shapeOf.get( entry.container );
			if ( ! shape ) continue;
			const hole = new Path();
			hole.curves = entry.subPath.curves;
			shape.holes.push( hole );

		}

		return shapes;

	}

}
