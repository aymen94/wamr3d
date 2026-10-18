// FBX mesh geometry: polygons with their layer elements (normals, uv sets, colours,
// materials) triangulated into a non-indexed BufferGeometry, one group per material,
// with skin weights and blend shapes per control point.
//
// Part of the FBXLoader add-on (`../FBXLoader.js`).

import { BufferGeometry, Color, Float32BufferAttribute, ShapeUtils, SRGBColorSpace, Vector2, Vector3 } from '../../../compat.js';
import { arrayOf, child, children } from './parser.js';

// A layer element's values and how they map onto polygon vertices.
function layerElement( node, dataName, indexNames, size ) {

	if ( ! node ) return null;
	const mapping = child( node, 'MappingInformationType' )?.props[ 0 ] ?? 'ByPolygonVertex';
	const reference = child( node, 'ReferenceInformationType' )?.props[ 0 ] ?? 'Direct';
	let indices = null;

	for ( const name of indexNames ) {

		const found = child( node, name );
		if ( found ) indices = found.props[ 0 ];

	}

	return { data: arrayOf( node, dataName ), indices, mapping, reference, size };

}

function layerValue( info, polygonVertex, polygon, vertex, out ) {

	let index;

	switch ( info.mapping ) {

		case 'ByPolygonVertex': index = polygonVertex; break;
		case 'ByPolygon': index = polygon; break;
		case 'ByVertice': case 'ByVertex': index = vertex; break;
		case 'AllSame': index = 0; break;
		default: index = polygonVertex;

	}

	if ( ( info.reference === 'IndexToDirect' || info.reference === 'Index' ) && info.indices ) index = info.indices[ index ];
	for ( let k = 0; k < info.size; k ++ ) out[ k ] = info.data[ index * info.size + k ] ?? 0;
	return out;

}

// Corner positions of one polygon split into triangles (local corner indices).
const _normal = new Vector3(), _a = new Vector3(), _b = new Vector3(), _u = new Vector3(), _v = new Vector3();

function triangulate( corners, vertices ) {

	const n = corners.length;
	if ( n === 3 ) return [ 0, 1, 2 ];
	if ( n < 3 ) return [];
	const point = ( i, target ) => target.fromArray( vertices, corners[ i ] * 3 );

	if ( n === 4 ) {

		// split along the shorter diagonal
		const d02 = point( 0, _a ).distanceToSquared( point( 2, _b ) ), d13 = point( 1, _a ).distanceToSquared( point( 3, _b ) );
		return d02 <= d13 ? [ 0, 1, 2, 0, 2, 3 ] : [ 0, 1, 3, 1, 2, 3 ];

	}

	// Newell's normal, then the polygon projected onto its plane
	_normal.set( 0, 0, 0 );

	for ( let i = 0; i < n; i ++ ) {

		point( i, _a );
		point( ( i + 1 ) % n, _b );
		_normal.x += ( _a.y - _b.y ) * ( _a.z + _b.z );
		_normal.y += ( _a.z - _b.z ) * ( _a.x + _b.x );
		_normal.z += ( _a.x - _b.x ) * ( _a.y + _b.y );

	}

	_normal.normalize();
	_u.set( 1, 0, 0 );
	if ( Math.abs( _normal.x ) > 0.9 ) _u.set( 0, 1, 0 );
	_u.cross( _normal ).normalize();
	_v.crossVectors( _normal, _u );
	const contour = [];
	for ( let i = 0; i < n; i ++ ) contour.push( new Vector2( point( i, _a ).dot( _u ), _a.dot( _v ) ) );
	// the projected polygon turns counter-clockwise; triangles keep that turn
	const result = [];

	for ( const [ a, b, c ] of ShapeUtils.triangulateShape( contour.slice(), [] ) ) {

		const area = ( contour[ b ].x - contour[ a ].x ) * ( contour[ c ].y - contour[ a ].y ) - ( contour[ c ].x - contour[ a ].x ) * ( contour[ b ].y - contour[ a ].y );
		result.push( ...( area < 0 ? [ a, c, b ] : [ a, b, c ] ) );

	}

	return result;

}

/**
 * The geometry of a `Geometry` node of type Mesh. `skin` maps control points to
 * `[ [ bone, weight ], ... ]`; `shapes` lists `{ name, indices, vertices }` blend shapes
 * (offsets per listed control point).
 */
export function buildGeometry( node, { skin = null, shapes = [], transform = null } = {} ) {

	const vertices = arrayOf( node, 'Vertices' ), polygonIndex = arrayOf( node, 'PolygonVertexIndex' );
	const normals = layerElement( child( node, 'LayerElementNormal' ), 'Normals', [ 'NormalsIndex', 'NormalIndex' ], 3 );
	const uvs = children( node, 'LayerElementUV' ).map( ( layer ) => layerElement( layer, 'UV', [ 'UVIndex' ], 2 ) );
	const colors = layerElement( child( node, 'LayerElementColor' ), 'Colors', [ 'ColorIndex' ], 4 );
	const materials = layerElement( child( node, 'LayerElementMaterial' ), 'Materials', [], 1 );

	// per material, the triangles' corners: [ polygon vertex, polygon, control point ]
	const buckets = new Map();
	let corners = [], polygon = 0;

	for ( let i = 0; i < polygonIndex.length; i ++ ) {

		let vertex = polygonIndex[ i ];
		const last = vertex < 0;
		if ( last ) vertex = ~ vertex;
		corners.push( { vertex, polygonVertex: i } );
		if ( ! last ) continue;

		const material = materials && materials.data.length ? ( materials.mapping === 'AllSame' ? materials.data[ 0 ] : materials.data[ polygon ] ?? 0 ) : 0;
		if ( ! buckets.has( material ) ) buckets.set( material, [] );
		const list = buckets.get( material );
		for ( const k of triangulate( corners.map( ( c ) => c.vertex ), vertices ) ) list.push( corners[ k ].polygonVertex, polygon, corners[ k ].vertex );
		corners = [];
		polygon ++;

	}

	const order = [ ...buckets.keys() ].sort( ( a, b ) => a - b );
	const count = order.reduce( ( sum, key ) => sum + buckets.get( key ).length / 3, 0 );
	const position = new Float32Array( count * 3 );
	const normal = normals ? new Float32Array( count * 3 ) : null;
	const uv = uvs.map( () => new Float32Array( count * 2 ) );
	const color = colors ? new Float32Array( count * 3 ) : null;
	const skinIndex = skin ? new Float32Array( count * 4 ) : null, skinWeight = skin ? new Float32Array( count * 4 ) : null;
	const shapeOffsets = shapes.map( ( shape ) => {

		const offsets = new Map();
		for ( let i = 0; i < shape.indices.length; i ++ ) offsets.set( shape.indices[ i ], i );
		return { shape, offsets, array: new Float32Array( count * 3 ) };

	} );

	const geometry = new BufferGeometry();
	const value = [ 0, 0, 0, 0 ], linear = new Color();
	let o = 0;

	for ( const key of order ) {

		const list = buckets.get( key ), start = o;

		for ( let i = 0; i < list.length; i += 3, o ++ ) {

			const polygonVertex = list[ i ], poly = list[ i + 1 ], vertex = list[ i + 2 ];
			for ( let k = 0; k < 3; k ++ ) position[ o * 3 + k ] = vertices[ vertex * 3 + k ];

			if ( normal ) {

				layerValue( normals, polygonVertex, poly, vertex, value );
				normal.set( value.slice( 0, 3 ), o * 3 );

			}

			uvs.forEach( ( info, set ) => {

				layerValue( info, polygonVertex, poly, vertex, value );
				uv[ set ][ o * 2 ] = value[ 0 ];
				uv[ set ][ o * 2 + 1 ] = value[ 1 ];

			} );

			if ( color ) {

				layerValue( colors, polygonVertex, poly, vertex, value );
				linear.setRGB( value[ 0 ], value[ 1 ], value[ 2 ], SRGBColorSpace );
				color[ o * 3 ] = linear.r;
				color[ o * 3 + 1 ] = linear.g;
				color[ o * 3 + 2 ] = linear.b;

			}

			if ( skin ) {

				// the four strongest influences, weights summing to one
				const influences = ( skin.get( vertex ) ?? [] ).slice().sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, 4 );
				const total = influences.reduce( ( sum, [ , w ] ) => sum + w, 0 ) || 1;

				influences.forEach( ( [ bone, weight ], k ) => {

					skinIndex[ o * 4 + k ] = bone;
					skinWeight[ o * 4 + k ] = weight / total;

				} );

			}

			for ( const { shape, offsets, array } of shapeOffsets ) {

				const index = offsets.get( vertex );
				if ( index !== undefined ) for ( let k = 0; k < 3; k ++ ) array[ o * 3 + k ] = shape.vertices[ index * 3 + k ];

			}

		}

		geometry.addGroup( start, o - start, key );

	}

	geometry.setAttribute( 'position', new Float32BufferAttribute( position, 3 ) );
	if ( normal ) geometry.setAttribute( 'normal', new Float32BufferAttribute( normal, 3 ) );
	uv.forEach( ( array, set ) => geometry.setAttribute( set === 0 ? 'uv' : 'uv' + set, new Float32BufferAttribute( array, 2 ) ) );
	if ( color ) geometry.setAttribute( 'color', new Float32BufferAttribute( color, 3 ) );

	if ( skin ) {

		geometry.setAttribute( 'skinIndex', new Float32BufferAttribute( skinIndex, 4 ) );
		geometry.setAttribute( 'skinWeight', new Float32BufferAttribute( skinWeight, 4 ) );

	}

	if ( shapeOffsets.length ) {

		geometry.morphAttributes.position = shapeOffsets.map( ( { shape, array } ) => {

			const attribute = new Float32BufferAttribute( array, 3 );
			attribute.name = shape.name;
			return attribute;

		} );
		geometry.morphTargetsRelative = true;

	}

	if ( order.length === 1 ) geometry.clearGroups();
	if ( transform ) geometry.applyMatrix4( transform );
	if ( ! normal ) geometry.computeVertexNormals();
	return geometry;

}

/** The control points of a `NurbsCurve` geometry as a polyline (its control polygon, evaluated). */
export function buildCurve( node ) {

	const order = Number( child( node, 'Order' )?.props[ 0 ] ?? 4 );
	const points = arrayOf( node, 'Points' ), knots = arrayOf( node, 'KnotVector' );
	const control = [];
	for ( let i = 0; i < points.length; i += 4 ) control.push( [ points[ i ], points[ i + 1 ], points[ i + 2 ], points[ i + 3 ] || 1 ] );
	const geometry = new BufferGeometry();
	const degree = order - 1;

	if ( knots.length !== control.length + order ) {

		geometry.setAttribute( 'position', new Float32BufferAttribute( control.flatMap( ( p ) => p.slice( 0, 3 ) ), 3 ) );
		return geometry;

	}

	// de Boor's algorithm over the rational control points
	const start = knots[ degree ], end = knots[ control.length ], samples = control.length * 12;
	const positions = [];

	for ( let s = 0; s <= samples; s ++ ) {

		const t = Math.min( start + ( end - start ) * s / samples, end - 1e-9 * ( end - start ) );
		let span = degree;
		while ( span < control.length - 1 && knots[ span + 1 ] <= t ) span ++;
		const d = [];

		for ( let j = 0; j <= degree; j ++ ) {

			const p = control[ span - degree + j ];
			d.push( [ p[ 0 ] * p[ 3 ], p[ 1 ] * p[ 3 ], p[ 2 ] * p[ 3 ], p[ 3 ] ] );

		}

		for ( let r = 1; r <= degree; r ++ ) {

			for ( let j = degree; j >= r; j -- ) {

				const i = span - degree + j;
				const alpha = ( t - knots[ i ] ) / ( knots[ i + degree + 1 - r ] - knots[ i ] || 1 );
				for ( let k = 0; k < 4; k ++ ) d[ j ][ k ] = ( 1 - alpha ) * d[ j - 1 ][ k ] + alpha * d[ j ][ k ];

			}

		}

		const w = d[ degree ][ 3 ] || 1;
		positions.push( d[ degree ][ 0 ] / w, d[ degree ][ 1 ] / w, d[ degree ][ 2 ] / w );

	}

	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	return geometry;

}
