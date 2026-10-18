// three.js's wide-line add-ons over WAMR3D lines: lines whose material has a `linewidth`
// above one pixel are drawn by the renderer as screen-space quads.

import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, LineSegments, Vector2 } from '../../compat.js';

/**
 * three.js `LineMaterial`: `linewidth` in pixels (times the pixel ratio), or in world
 * units with `worldUnits`; dashes along `computeLineDistances()` with `dashed`.
 * `dashOffset` does not move the dashes.
 */
export class LineMaterial extends LineBasicMaterial {

	constructor( parameters = {} ) {

		const { dashed, worldUnits, resolution, alphaToCoverage, dashScale, dashSize, gapSize, dashOffset, ...rest } = parameters;
		super( rest );
		this.type = 'LineMaterial';
		this.isLineMaterial = true;
		if ( rest.linewidth === undefined ) this.linewidth = 1;
		this.dashed = dashed ?? false;
		this.worldUnits = worldUnits ?? false;
		this.resolution = resolution ?? new Vector2( 1, 1 );
		this.dashScale = dashScale ?? 1;
		this.dashSize = dashSize ?? 1;
		this.gapSize = gapSize ?? 1;
		this.dashOffset = dashOffset ?? 0;
		this.alphaToCoverage = alphaToCoverage ?? false;

	}

}

function pairs( array ) {

	return array instanceof Float32Array ? array : new Float32Array( array );

}

/** three.js `LineSegmentsGeometry`: segments from pairs of points. */
export class LineSegmentsGeometry extends BufferGeometry {

	constructor() {

		super();
		this.type = 'LineSegmentsGeometry';
		this.isLineSegmentsGeometry = true;

	}

	setPositions( array ) {

		return this.setAttribute( 'position', new Float32BufferAttribute( pairs( array ), 3 ) );

	}

	setColors( array ) {

		return this.setAttribute( 'color', new Float32BufferAttribute( pairs( array ), 3 ) );

	}

	fromLineSegments( lineSegments ) {

		return this.setPositions( lineSegments.geometry.attributes.position.array );

	}

	fromEdgesGeometry( geometry ) {

		return this.setPositions( geometry.attributes.position.array );

	}

	fromWireframeGeometry( geometry ) {

		return this.setPositions( geometry.attributes.position.array );

	}

}

/** three.js `LineGeometry`: one connected line through the points. */
export class LineGeometry extends LineSegmentsGeometry {

	constructor() {

		super();
		this.type = 'LineGeometry';
		this.isLineGeometry = true;

	}

	setFromPoints( points ) {

		const array = new Float32Array( points.length * 3 );
		points.forEach( ( p, i ) => array.set( [ p.x, p.y, p.z ?? 0 ], i * 3 ) );
		return this.setPositions( array );

	}

	fromLine( line ) {

		return this.setPositions( line.geometry.attributes.position.array );

	}

}

export class LineSegments2 extends LineSegments {

	constructor( geometry = new LineSegmentsGeometry(), material = new LineMaterial( { color: Math.random() * 0xffffff } ) ) {

		super( geometry, material );
		this.type = 'LineSegments2';
		this.isLineSegments2 = true;

	}

}

export class Line2 extends Line {

	constructor( geometry = new LineGeometry(), material = new LineMaterial( { color: Math.random() * 0xffffff } ) ) {

		super( geometry, material );
		this.type = 'Line2';
		this.isLine2 = true;

	}

}
