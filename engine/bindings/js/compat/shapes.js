// Geometries built from shapes, paths and other geometries. They are computed here and
// handed to the engine as plain attributes.

import { QuadraticBezierCurve3, Shape, ShapeUtils } from './curves.js';
import { BufferGeometry, Float32BufferAttribute } from './geometry.js';
import { Vector2, Vector3 } from './values.js';

const DEG2RAD = Math.PI / 180;

/** The flat triangulation of one shape or an array of shapes (one group per shape), in the XY plane. */
export class ShapeGeometry extends BufferGeometry {

	constructor( shapes = new Shape( [ new Vector2( 0, 0.5 ), new Vector2( - 0.5, - 0.5 ), new Vector2( 0.5, - 0.5 ) ] ), curveSegments = 12 ) {

		super();
		this.type = 'ShapeGeometry';
		this.parameters = { shapes, curveSegments };

		const indices = [], vertices = [], normals = [], uvs = [];
		let groupStart = 0, groupCount = 0;

		const addShape = ( shape ) => {

			const indexOffset = vertices.length / 3, points = shape.extractPoints( curveSegments );
			let shapeVertices = points.shape;
			const shapeHoles = points.holes;
			if ( ShapeUtils.isClockWise( shapeVertices ) === false ) shapeVertices = shapeVertices.reverse();

			for ( let i = 0; i < shapeHoles.length; i ++ ) {

				if ( ShapeUtils.isClockWise( shapeHoles[ i ] ) === true ) shapeHoles[ i ] = shapeHoles[ i ].reverse();

			}

			const faces = ShapeUtils.triangulateShape( shapeVertices, shapeHoles );
			for ( const hole of shapeHoles ) shapeVertices = shapeVertices.concat( hole );

			for ( const vertex of shapeVertices ) {

				vertices.push( vertex.x, vertex.y, 0 );
				normals.push( 0, 0, 1 );
				uvs.push( vertex.x, vertex.y );

			}

			for ( const face of faces ) {

				indices.push( face[ 0 ] + indexOffset, face[ 1 ] + indexOffset, face[ 2 ] + indexOffset );
				groupCount += 3;

			}

		};

		if ( Array.isArray( shapes ) === false ) {

			addShape( shapes );

		} else {

			for ( let i = 0; i < shapes.length; i ++ ) {

				addShape( shapes[ i ] );
				this.addGroup( groupStart, groupCount, i );
				groupStart += groupCount;
				groupCount = 0;

			}

		}

		this.setIndex( indices );
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

	}

}

/** World-space uvs of the lids (x, y) and the side walls (along the wall, 1 - z). */
export const WorldUVGenerator = {

	generateTopUV( geometry, vertices, indexA, indexB, indexC ) {

		return [
			new Vector2( vertices[ indexA * 3 ], vertices[ indexA * 3 + 1 ] ),
			new Vector2( vertices[ indexB * 3 ], vertices[ indexB * 3 + 1 ] ),
			new Vector2( vertices[ indexC * 3 ], vertices[ indexC * 3 + 1 ] )
		];

	},

	generateSideWallUV( geometry, vertices, indexA, indexB, indexC, indexD ) {

		const a = indexA * 3, b = indexB * 3, c = indexC * 3, d = indexD * 3;
		// along x when the wall runs more along x than y
		const k = Math.abs( vertices[ a + 1 ] - vertices[ b + 1 ] ) < Math.abs( vertices[ a ] - vertices[ b ] ) ? 0 : 1;
		return [
			new Vector2( vertices[ a + k ], 1 - vertices[ a + 2 ] ),
			new Vector2( vertices[ b + k ], 1 - vertices[ b + 2 ] ),
			new Vector2( vertices[ c + k ], 1 - vertices[ c + 2 ] ),
			new Vector2( vertices[ d + k ], 1 - vertices[ d + 2 ] )
		];

	}

};

/**
 * Shapes pushed along z by `depth` (or along `extrudePath`), with optional rounded bevels.
 * Group 0 holds the lids, group 1 the side walls. Not indexed.
 */
export class ExtrudeGeometry extends BufferGeometry {

	constructor( shapes = new Shape( [ new Vector2( 0.5, 0.5 ), new Vector2( - 0.5, 0.5 ), new Vector2( - 0.5, - 0.5 ), new Vector2( 0.5, - 0.5 ) ] ), options = {} ) {

		super();
		this.type = 'ExtrudeGeometry';
		this.parameters = { shapes, options };
		shapes = Array.isArray( shapes ) ? shapes : [ shapes ];
		const verticesArray = [], uvArray = [], groups = [];
		for ( const shape of shapes ) extrudeShape( shape, options, verticesArray, uvArray, groups, this );
		for ( const [ start, count, index ] of groups ) this.addGroup( start, count, index );
		this.setAttribute( 'position', new Float32BufferAttribute( verticesArray, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvArray, 2 ) );
		this.computeVertexNormals();

	}

}

// The direction to move a contour point by for a bevel of size 1: out along the bisector
// of its two edges, at most sqrt(2) long.
function bevelVector( inPt, inPrev, inNext ) {

	let tx, ty, shrink;
	const prevX = inPt.x - inPrev.x, prevY = inPt.y - inPrev.y;
	const nextX = inNext.x - inPt.x, nextY = inNext.y - inPt.y;
	const prevLengthSq = prevX * prevX + prevY * prevY;
	const collinear = prevX * nextY - prevY * nextX;

	if ( Math.abs( collinear ) > Number.EPSILON ) {

		const prevLength = Math.sqrt( prevLengthSq ), nextLength = Math.sqrt( nextX * nextX + nextY * nextY );
		// both edges shifted outwards by 1, then intersected
		const prevShiftX = inPrev.x - prevY / prevLength, prevShiftY = inPrev.y + prevX / prevLength;
		const nextShiftX = inNext.x - nextY / nextLength, nextShiftY = inNext.y + nextX / nextLength;
		const sf = ( ( nextShiftX - prevShiftX ) * nextY - ( nextShiftY - prevShiftY ) * nextX ) / ( prevX * nextY - prevY * nextX );
		tx = prevShiftX + prevX * sf - inPt.x;
		ty = prevShiftY + prevY * sf - inPt.y;
		const lengthSq = tx * tx + ty * ty;
		if ( lengthSq <= 2 ) return new Vector2( tx, ty );
		shrink = Math.sqrt( lengthSq / 2 );

	} else {

		// collinear edges: straight on, or folding back
		let sameDirection = false;

		if ( prevX > Number.EPSILON ) {

			if ( nextX > Number.EPSILON ) sameDirection = true;

		} else if ( prevX < - Number.EPSILON ) {

			if ( nextX < - Number.EPSILON ) sameDirection = true;

		} else if ( Math.sign( prevY ) === Math.sign( nextY ) ) {

			sameDirection = true;

		}

		if ( sameDirection ) {

			tx = - prevY;
			ty = prevX;
			shrink = Math.sqrt( prevLengthSq );

		} else {

			tx = prevX;
			ty = prevY;
			shrink = Math.sqrt( prevLengthSq / 2 );

		}

	}

	return new Vector2( tx / shrink, ty / shrink );

}

// Removes points closer to the previous one than a tolerance relative to their size.
function mergeOverlappingPoints( points ) {

	const THRESHOLD_SQ = 1e-20;
	let previous = points[ 0 ];

	for ( let i = 1; i <= points.length; i ++ ) {

		const current = i % points.length, point = points[ current ];
		const dx = point.x - previous.x, dy = point.y - previous.y;
		const scale = Math.max( Math.abs( point.x ), Math.abs( point.y ), Math.abs( previous.x ), Math.abs( previous.y ) );

		if ( dx * dx + dy * dy <= THRESHOLD_SQ * scale * scale ) {

			points.splice( current, 1 );
			i --;
			continue;

		}

		previous = point;

	}

}

function extrudeShape( shape, options, verticesArray, uvArray, groups, scope ) {

	const placeholder = [];
	const curveSegments = options.curveSegments ?? 12, steps = options.steps ?? 1, depth = options.depth ?? 1;
	let bevelEnabled = options.bevelEnabled ?? true, bevelThickness = options.bevelThickness ?? 0.2;
	let bevelSize = options.bevelSize ?? bevelThickness - 0.1, bevelOffset = options.bevelOffset ?? 0, bevelSegments = options.bevelSegments ?? 3;
	const extrudePath = options.extrudePath, uvgen = options.UVGenerator ?? WorldUVGenerator;
	let extrudePts, extrudeByPath = false, frames, binormal, normal, position2;

	if ( extrudePath ) {

		extrudePts = extrudePath.getSpacedPoints( steps );
		extrudeByPath = true;
		// bevels are not supported along a path
		bevelEnabled = false;
		frames = extrudePath.computeFrenetFrames( steps, extrudePath.isCatmullRomCurve3 ? extrudePath.closed : false );
		binormal = new Vector3();
		normal = new Vector3();
		position2 = new Vector3();

	}

	if ( ! bevelEnabled ) bevelSegments = bevelThickness = bevelSize = bevelOffset = 0;

	const shapePoints = shape.extractPoints( curveSegments );
	let vertices = shapePoints.shape;
	const holes = shapePoints.holes;

	if ( ! ShapeUtils.isClockWise( vertices ) ) {

		vertices = vertices.reverse();
		for ( let h = 0; h < holes.length; h ++ ) if ( ShapeUtils.isClockWise( holes[ h ] ) ) holes[ h ] = holes[ h ].reverse();

	}

	mergeOverlappingPoints( vertices );
	holes.forEach( mergeOverlappingPoints );

	// `contour` is the outline only, `vertices` the outline followed by the holes
	const contour = vertices;
	for ( const hole of holes ) vertices = vertices.concat( hole );
	const scalePt2 = ( pt, vec, size ) => pt.clone().addScaledVector( vec, size );
	const vlen = vertices.length;

	const movements = ( points ) => points.map( ( point, i ) => bevelVector( point, points[ ( i + points.length - 1 ) % points.length ], points[ ( i + 1 ) % points.length ] ) );
	const contourMovements = movements( contour ), holesMovements = holes.map( movements );
	const verticesMovements = contourMovements.concat( ...holesMovements );
	const v = ( x, y, z ) => placeholder.push( x, y, z );

	let faces;

	if ( bevelSegments === 0 ) {

		faces = ShapeUtils.triangulateShape( contour, holes );

	} else {

		const contracted = [], expandedHoles = [];

		for ( let b = 0; b < bevelSegments; b ++ ) {

			const t = b / bevelSegments, z = bevelThickness * Math.cos( t * Math.PI / 2 ), bs = bevelSize * Math.sin( t * Math.PI / 2 ) + bevelOffset;

			for ( let i = 0; i < contour.length; i ++ ) {

				const vert = scalePt2( contour[ i ], contourMovements[ i ], bs );
				v( vert.x, vert.y, - z );
				if ( t === 0 ) contracted.push( vert );

			}

			for ( let h = 0; h < holes.length; h ++ ) {

				const hole = holes[ h ], holeVertices = [];

				for ( let i = 0; i < hole.length; i ++ ) {

					const vert = scalePt2( hole[ i ], holesMovements[ h ][ i ], bs );
					v( vert.x, vert.y, - z );
					if ( t === 0 ) holeVertices.push( vert );

				}

				if ( t === 0 ) expandedHoles.push( holeVertices );

			}

		}

		faces = ShapeUtils.triangulateShape( contracted, expandedHoles );

	}

	const bs = bevelSize + bevelOffset;

	// the back lid and every step along the extrusion
	for ( let s = 0; s <= steps; s ++ ) {

		for ( let i = 0; i < vlen; i ++ ) {

			const vert = bevelEnabled ? scalePt2( vertices[ i ], verticesMovements[ i ], bs ) : vertices[ i ];

			if ( ! extrudeByPath ) {

				v( vert.x, vert.y, depth / steps * s );

			} else {

				normal.copy( frames.normals[ s ] ).multiplyScalar( vert.x );
				binormal.copy( frames.binormals[ s ] ).multiplyScalar( vert.y );
				position2.copy( extrudePts[ s ] ).add( normal ).add( binormal );
				v( position2.x, position2.y, position2.z );

			}

		}

	}

	// the front bevel, back to the full outline
	for ( let b = bevelSegments - 1; b >= 0; b -- ) {

		const t = b / bevelSegments, z = bevelThickness * Math.cos( t * Math.PI / 2 ), size = bevelSize * Math.sin( t * Math.PI / 2 ) + bevelOffset;

		for ( let i = 0; i < contour.length; i ++ ) {

			const vert = scalePt2( contour[ i ], contourMovements[ i ], size );
			v( vert.x, vert.y, depth + z );

		}

		for ( let h = 0; h < holes.length; h ++ ) {

			const hole = holes[ h ];

			for ( let i = 0; i < hole.length; i ++ ) {

				const vert = scalePt2( hole[ i ], holesMovements[ h ][ i ], size );
				if ( ! extrudeByPath ) v( vert.x, vert.y, depth + z );
				else v( vert.x, vert.y + extrudePts[ steps - 1 ].y, extrudePts[ steps - 1 ].x + z );

			}

		}

	}

	const addVertex = ( index ) => verticesArray.push( placeholder[ index * 3 ], placeholder[ index * 3 + 1 ], placeholder[ index * 3 + 2 ] );
	const addUV = ( uv ) => uvArray.push( uv.x, uv.y );

	const f3 = ( a, b, c ) => {

		addVertex( a );
		addVertex( b );
		addVertex( c );
		const next = verticesArray.length / 3;
		const uvs = uvgen.generateTopUV( scope, verticesArray, next - 3, next - 2, next - 1 );
		addUV( uvs[ 0 ] );
		addUV( uvs[ 1 ] );
		addUV( uvs[ 2 ] );

	};

	const f4 = ( a, b, c, d ) => {

		addVertex( a );
		addVertex( b );
		addVertex( d );
		addVertex( b );
		addVertex( c );
		addVertex( d );
		const next = verticesArray.length / 3;
		const uvs = uvgen.generateSideWallUV( scope, verticesArray, next - 6, next - 3, next - 2, next - 1 );
		addUV( uvs[ 0 ] );
		addUV( uvs[ 1 ] );
		addUV( uvs[ 3 ] );
		addUV( uvs[ 1 ] );
		addUV( uvs[ 2 ] );
		addUV( uvs[ 3 ] );

	};

	// lids
	let start = verticesArray.length / 3;
	const back = 0, front = vlen * ( bevelEnabled ? steps + bevelSegments * 2 : steps );
	for ( const face of faces ) f3( face[ 2 ] + back, face[ 1 ] + back, face[ 0 ] + back );
	for ( const face of faces ) f3( face[ 0 ] + front, face[ 1 ] + front, face[ 2 ] + front );
	groups.push( [ start, verticesArray.length / 3 - start, 0 ] );

	// side walls of the outline, then of each hole
	start = verticesArray.length / 3;

	const sidewalls = ( points, offset ) => {

		for ( let i = points.length - 1; i >= 0; i -- ) {

			const j = i, k = i - 1 < 0 ? points.length - 1 : i - 1;

			for ( let s = 0, sl = steps + bevelSegments * 2; s < sl; s ++ ) {

				const slen1 = vlen * s, slen2 = vlen * ( s + 1 );
				f4( offset + j + slen1, offset + k + slen1, offset + k + slen2, offset + j + slen2 );

			}

		}

	};

	let layerOffset = 0;
	sidewalls( contour, layerOffset );
	layerOffset += contour.length;

	for ( const hole of holes ) {

		sidewalls( hole, layerOffset );
		layerOffset += hole.length;

	}

	groups.push( [ start, verticesArray.length / 3 - start, 1 ] );

}

/** A tube of `radius` around `path` (a 3D curve), with `radialSegments` around and `tubularSegments` along. */
export class TubeGeometry extends BufferGeometry {

	constructor( path = new QuadraticBezierCurve3( new Vector3( - 1, - 1, 0 ), new Vector3( - 1, 1, 0 ), new Vector3( 1, 1, 0 ) ), tubularSegments = 64, radius = 1, radialSegments = 8, closed = false ) {

		super();
		this.type = 'TubeGeometry';
		this.parameters = { path, tubularSegments, radius, radialSegments, closed };

		const frames = path.computeFrenetFrames( tubularSegments, closed );
		this.tangents = frames.tangents;
		this.normals = frames.normals;
		this.binormals = frames.binormals;

		const rings = tubularSegments + 1, ring = radialSegments + 1;
		const vertices = new Float32Array( rings * ring * 3 ), normals = new Float32Array( rings * ring * 3 ), uvs = new Float32Array( rings * ring * 2 );
		const P = new Vector3();

		for ( let i = 0; i < rings; i ++ ) {

			// a closed tube ends on its first ring
			const segment = i === tubularSegments && closed ? 0 : i;
			path.getPointAt( segment / tubularSegments, P );
			const N = frames.normals[ segment ], B = frames.binormals[ segment ];

			for ( let j = 0; j <= radialSegments; j ++ ) {

				const angle = j / radialSegments * Math.PI * 2, sin = Math.sin( angle ), cos = - Math.cos( angle );
				let nx = cos * N.x + sin * B.x, ny = cos * N.y + sin * B.y, nz = cos * N.z + sin * B.z;
				const length = Math.hypot( nx, ny, nz ) || 1;
				nx /= length;
				ny /= length;
				nz /= length;
				const o = ( i * ring + j ) * 3;
				normals[ o ] = nx;
				normals[ o + 1 ] = ny;
				normals[ o + 2 ] = nz;
				vertices[ o ] = P.x + radius * nx;
				vertices[ o + 1 ] = P.y + radius * ny;
				vertices[ o + 2 ] = P.z + radius * nz;
				uvs[ ( i * ring + j ) * 2 ] = i / tubularSegments;
				uvs[ ( i * ring + j ) * 2 + 1 ] = j / radialSegments;

			}

		}

		const indices = new Uint32Array( tubularSegments * radialSegments * 6 );

		for ( let j = 1, o = 0; j <= tubularSegments; j ++ ) {

			for ( let i = 1; i <= radialSegments; i ++ ) {

				const a = ring * ( j - 1 ) + ( i - 1 ), b = ring * j + ( i - 1 ), c = ring * j + i, d = ring * ( j - 1 ) + i;
				indices[ o ++ ] = a;
				indices[ o ++ ] = b;
				indices[ o ++ ] = d;
				indices[ o ++ ] = b;
				indices[ o ++ ] = c;
				indices[ o ++ ] = d;

			}

		}

		this.setIndex( indices );
		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );
		this.setAttribute( 'normal', new Float32BufferAttribute( normals, 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );

	}

}

// Each triangle's vertex indices, from the index or in order.
function triangleIndex( geometry ) {

	const index = geometry.getIndex(), position = geometry.getAttribute( 'position' );
	if ( index ) return Array.from( { length: index.count }, ( _, i ) => index.getX( i ) );
	return Array.from( { length: position.count }, ( _, i ) => i );

}

/**
 * Line segments along the edges of `geometry` where its faces meet at more than
 * `thresholdAngle` degrees, and along open edges. For `LineSegments`.
 */
export class EdgesGeometry extends BufferGeometry {

	constructor( geometry = null, thresholdAngle = 1 ) {

		super();
		this.type = 'EdgesGeometry';
		this.parameters = { geometry, thresholdAngle };
		if ( geometry === null ) return;

		const precision = Math.pow( 10, 4 ), thresholdDot = Math.cos( DEG2RAD * thresholdAngle );
		const position = geometry.getAttribute( 'position' ), indices = triangleIndex( geometry );
		const points = [ new Vector3(), new Vector3(), new Vector3() ], hashes = [ '', '', '' ], corner = [ 0, 0, 0 ];
		const edgeData = new Map(), vertices = [];
		const hashOf = ( p ) => `${Math.round( p.x * precision )},${Math.round( p.y * precision )},${Math.round( p.z * precision )}`;
		const ab = new Vector3(), cb = new Vector3();

		for ( let i = 0; i + 2 < indices.length; i += 3 ) {

			for ( let j = 0; j < 3; j ++ ) {

				corner[ j ] = indices[ i + j ];
				points[ j ].fromBufferAttribute( position, corner[ j ] );
				hashes[ j ] = hashOf( points[ j ] );

			}

			// degenerate triangles have no normal
			if ( hashes[ 0 ] === hashes[ 1 ] || hashes[ 1 ] === hashes[ 2 ] || hashes[ 2 ] === hashes[ 0 ] ) continue;
			const normal = cb.subVectors( points[ 2 ], points[ 1 ] ).cross( ab.subVectors( points[ 0 ], points[ 1 ] ) ).clone();
			const lengthSq = normal.lengthSq();
			if ( lengthSq > 0 ) normal.multiplyScalar( 1 / Math.sqrt( lengthSq ) );
			else normal.set( 0, 0, 0 );

			for ( let j = 0; j < 3; j ++ ) {

				const next = ( j + 1 ) % 3, hash = `${hashes[ j ]}_${hashes[ next ]}`, reverse = `${hashes[ next ]}_${hashes[ j ]}`;
				const shared = edgeData.get( reverse );

				if ( shared ) {

					// the second face of an edge: kept if the faces meet sharply enough
					if ( normal.dot( shared.normal ) <= thresholdDot ) {

						vertices.push( points[ j ].x, points[ j ].y, points[ j ].z, points[ next ].x, points[ next ].y, points[ next ].z );

					}

					edgeData.set( reverse, null );

				} else if ( ! edgeData.has( hash ) ) {

					edgeData.set( hash, { index0: corner[ j ], index1: corner[ next ], normal } );

				}

			}

		}

		// edges with a single face
		for ( const data of edgeData.values() ) {

			if ( ! data ) continue;
			points[ 0 ].fromBufferAttribute( position, data.index0 );
			points[ 1 ].fromBufferAttribute( position, data.index1 );
			vertices.push( points[ 0 ].x, points[ 0 ].y, points[ 0 ].z, points[ 1 ].x, points[ 1 ].y, points[ 1 ].z );

		}

		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );

	}

}

/** Line segments along every distinct triangle edge of `geometry` (per group when indexed). For `LineSegments`. */
export class WireframeGeometry extends BufferGeometry {

	constructor( geometry = null ) {

		super();
		this.type = 'WireframeGeometry';
		this.parameters = { geometry };
		if ( geometry === null ) return;

		const vertices = [], edges = new Set(), start = new Vector3(), end = new Vector3();
		const position = geometry.attributes.position, index = geometry.index;

		const edge = ( a, b ) => {

			start.fromBufferAttribute( position, a );
			end.fromBufferAttribute( position, b );
			const forward = `${start.x},${start.y},${start.z}-${end.x},${end.y},${end.z}`;
			if ( edges.has( forward ) ) return;
			edges.add( forward );
			edges.add( `${end.x},${end.y},${end.z}-${start.x},${start.y},${start.z}` );
			vertices.push( start.x, start.y, start.z, end.x, end.y, end.z );

		};

		if ( index !== null ) {

			const groups = geometry.groups.length > 0 ? geometry.groups : [ { start: 0, count: index.count, materialIndex: 0 } ];

			for ( const group of groups ) {

				for ( let i = group.start, l = group.start + group.count; i < l; i += 3 ) {

					for ( let j = 0; j < 3; j ++ ) edge( index.getX( i + j ), index.getX( i + ( j + 1 ) % 3 ) );

				}

			}

		} else {

			for ( let i = 0, l = position.count / 3; i < l; i ++ ) {

				for ( let j = 0; j < 3; j ++ ) edge( 3 * i + j, 3 * i + ( j + 1 ) % 3 );

			}

		}

		this.setAttribute( 'position', new Float32BufferAttribute( vertices, 3 ) );

	}

}
