// three.js add-on path: `three/addons/loaders/OBJLoader.js`.
//
// Wavefront OBJ text into a Group, written from the format: one Mesh per object (`o`)
// or group (`g`) with a material group per `usemtl`, LineSegments for `l` and Points for
// `p`. Vertices (`v`, with optional r g b colours), texture coordinates (`vt`) and normals
// (`vn`) are referenced by 1-based or negative (relative) indices; polygons are fanned
// into triangles. Faces without normals get them computed; `s off` gives flat shading.

import { BufferGeometry, FileLoader, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Loader, Mesh, MeshPhongMaterial, Points, PointsMaterial } from '../../compat.js';

class ParserState {

	constructor() {

		this.objects = [];
		this.vertices = [];
		this.normals = [];
		this.colors = [];
		this.uvs = [];
		this.materialLibraries = [];
		this.object = null;
		this.startObject( '', false );

	}

	startObject( name, fromDeclaration = true ) {

		// an object declared before any data takes the new name instead of a new object
		if ( this.object && this.object.fromDeclaration === false ) {

			this.object.name = name;
			this.object.fromDeclaration = fromDeclaration;
			return;

		}

		const previous = this.object?.currentMaterial();
		this.object?.finalize( true );
		const object = {
			name, fromDeclaration,
			geometry: { vertices: [], normals: [], colors: [], uvs: [], hasUVIndices: false, type: '' },
			materials: [],
			smooth: true,
			startMaterial( materialName, libraries ) {

				const last = this.currentMaterial();

				if ( last && last.groupEnd === - 1 ) {

					last.groupEnd = this.geometry.vertices.length / 3;
					last.groupCount = last.groupEnd - last.groupStart;

				}

				const material = { index: this.materials.length, name: materialName || '', mtllib: libraries.length ? libraries[ libraries.length - 1 ] : '', smooth: last ? last.smooth : this.smooth, groupStart: last ? last.groupEnd : 0, groupEnd: - 1, groupCount: - 1 };
				this.materials.push( material );
				return material;

			},
			currentMaterial() {

				return this.materials[ this.materials.length - 1 ];

			},
			finalize( end ) {

				const last = this.currentMaterial();

				if ( last && last.groupEnd === - 1 ) {

					last.groupEnd = this.geometry.vertices.length / 3;
					last.groupCount = last.groupEnd - last.groupStart;

				}

				// drop materials that received no faces, unless it is the only one
				if ( end && this.materials.length > 1 ) {

					for ( let i = this.materials.length - 1; i >= 0; i -- ) if ( this.materials[ i ].groupCount <= 0 ) this.materials.splice( i, 1 );

				}

				if ( end && this.materials.length === 0 ) this.materials.push( { name: '', smooth: this.smooth, groupStart: 0, groupEnd: - 1, groupCount: - 1 } );

			}
		};

		// keep the previous object's material when the new one declares none
		if ( previous && previous.name ) {

			const material = object.startMaterial( previous.name, this.materialLibraries );
			material.inherited = true;

		}

		this.objects.push( object );
		this.object = object;

	}

	finalize() {

		this.object?.finalize( true );

	}

	index( value, length ) {

		const i = parseInt( value, 10 );
		return ( i >= 0 ? i - 1 : i + length / 3 ) * 3;

	}

	uvIndex( value, length ) {

		const i = parseInt( value, 10 );
		return ( i >= 0 ? i - 1 : i + length / 2 ) * 2;

	}

	addVertex( a, b, c ) {

		const src = this.vertices, dst = this.object.geometry.vertices;
		for ( const i of [ a, b, c ] ) dst.push( src[ i ], src[ i + 1 ], src[ i + 2 ] );

	}

	addColor( a, b, c ) {

		const src = this.colors, dst = this.object.geometry.colors;
		for ( const i of [ a, b, c ] ) if ( src[ i ] !== undefined ) dst.push( src[ i ], src[ i + 1 ], src[ i + 2 ] );

	}

	addNormal( a, b, c ) {

		const src = this.normals, dst = this.object.geometry.normals;
		for ( const i of [ a, b, c ] ) dst.push( src[ i ], src[ i + 1 ], src[ i + 2 ] );

	}

	addUV( a, b, c ) {

		const src = this.uvs, dst = this.object.geometry.uvs;
		for ( const i of [ a, b, c ] ) dst.push( src[ i ], src[ i + 1 ] );

	}

	addFace( a, b, c, ua, ub, uc, na, nb, nc ) {

		const vl = this.vertices.length;
		const ia = this.index( a, vl ), ib = this.index( b, vl ), ic = this.index( c, vl );
		this.addVertex( ia, ib, ic );
		this.addColor( ia, ib, ic );

		if ( na !== undefined && na !== '' ) {

			const nl = this.normals.length;
			this.addNormal( this.index( na, nl ), this.index( nb, nl ), this.index( nc, nl ) );

		}

		if ( ua !== undefined && ua !== '' ) {

			const ul = this.uvs.length;
			this.addUV( this.uvIndex( ua, ul ), this.uvIndex( ub, ul ), this.uvIndex( uc, ul ) );
			this.object.geometry.hasUVIndices = true;

		} else {

			// faces without coordinates still get them, so the attribute stays aligned
			this.object.geometry.uvs.push( 0, 0, 0, 0, 0, 0 );

		}

	}

	addPointGeometry( values ) {

		this.object.geometry.type = 'Points';
		const vl = this.vertices.length;

		for ( const value of values ) {

			const i = this.index( value, vl );
			this.object.geometry.vertices.push( this.vertices[ i ], this.vertices[ i + 1 ], this.vertices[ i + 2 ] );
			if ( this.colors[ i ] !== undefined ) this.object.geometry.colors.push( this.colors[ i ], this.colors[ i + 1 ], this.colors[ i + 2 ] );

		}

	}

	addLineGeometry( vertices, uvs ) {

		this.object.geometry.type = 'Line';
		const vl = this.vertices.length, ul = this.uvs.length;

		// a polyline becomes segments between consecutive points
		for ( let k = 0; k < vertices.length - 1; k ++ ) {

			for ( const n of [ k, k + 1 ] ) {

				const i = this.index( vertices[ n ], vl );
				this.object.geometry.vertices.push( this.vertices[ i ], this.vertices[ i + 1 ], this.vertices[ i + 2 ] );
				if ( uvs[ n ] !== undefined && uvs[ n ] !== '' ) {

					const u = this.uvIndex( uvs[ n ], ul );
					this.object.geometry.uvs.push( this.uvs[ u ], this.uvs[ u + 1 ] );

				}

			}

		}

	}

}

export class OBJLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.materials = null;

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( text ) => {

			try {

				onLoad( this.parse( text ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	setMaterials( materials ) {

		this.materials = materials;
		return this;

	}

	parse( text ) {

		const state = new ParserState();
		if ( text.indexOf( '\r\n' ) !== - 1 ) text = text.replace( /\r\n/g, '\n' );
		if ( text.indexOf( '\\\n' ) !== - 1 ) text = text.replace( /\\\n/g, '' );

		for ( const raw of text.split( '\n' ) ) {

			const line = raw.trimStart();
			if ( line.length === 0 || line[ 0 ] === '#' ) continue;
			const parts = line.split( /\s+/ ), keyword = parts[ 0 ].toLowerCase();

			switch ( keyword ) {

				case 'v':
					state.vertices.push( parseFloat( parts[ 1 ] ), parseFloat( parts[ 2 ] ), parseFloat( parts[ 3 ] ) );
					if ( parts.length >= 7 ) state.colors.push( parseFloat( parts[ 4 ] ), parseFloat( parts[ 5 ] ), parseFloat( parts[ 6 ] ) );
					else state.colors.push( undefined, undefined, undefined );
					break;

				case 'vn':
					state.normals.push( parseFloat( parts[ 1 ] ), parseFloat( parts[ 2 ] ), parseFloat( parts[ 3 ] ) );
					break;

				case 'vt':
					state.uvs.push( parseFloat( parts[ 1 ] ), parseFloat( parts[ 2 ] ?? 0 ) );
					break;

				case 'f': {

					const corners = parts.slice( 1 ).filter( ( p ) => p.length > 0 ).map( ( p ) => p.split( '/' ) );
					for ( let k = 1; k < corners.length - 1; k ++ ) {

						const [ a, b, c ] = [ corners[ 0 ], corners[ k ], corners[ k + 1 ] ];
						state.addFace( a[ 0 ], b[ 0 ], c[ 0 ], a[ 1 ], b[ 1 ], c[ 1 ], a[ 2 ], b[ 2 ], c[ 2 ] );

					}

					break;

				}

				case 'l': {

					const corners = parts.slice( 1 ).filter( ( p ) => p.length > 0 ).map( ( p ) => p.split( '/' ) );
					state.addLineGeometry( corners.map( ( c ) => c[ 0 ] ), corners.map( ( c ) => c[ 1 ] ) );
					break;

				}

				case 'p':
					state.addPointGeometry( parts.slice( 1 ).filter( ( p ) => p.length > 0 ) );
					break;

				case 'o':
				case 'g':
					state.startObject( line.slice( keyword.length ).trim() );
					break;

				case 'usemtl':
					state.object.startMaterial( line.slice( 6 ).trim(), state.materialLibraries );
					break;

				case 'mtllib':
					state.materialLibraries.push( line.slice( 6 ).trim() );
					break;

				case 's': {

					const value = ( parts[ 1 ] ?? '' ).toLowerCase(), smooth = value !== '0' && value !== 'off' && value !== '';
					state.object.smooth = smooth;
					const material = state.object.currentMaterial();
					if ( material ) material.smooth = smooth;
					break;

				}

				default:
					// anything else (curves, surfaces, display attributes) is not drawn
					break;

			}

		}

		state.finalize();
		return this.build( state );

	}

	build( state ) {

		const container = new Group();
		container.materialLibraries = [ ...state.materialLibraries ];
		const hasPrimitives = state.objects.some( ( o ) => o.geometry.vertices.length > 0 );

		for ( const object of state.objects ) {

			const geometryData = object.geometry;
			if ( geometryData.vertices.length === 0 ) continue;
			const isLine = geometryData.type === 'Line', isPoints = geometryData.type === 'Points';
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new Float32BufferAttribute( geometryData.vertices, 3 ) );
			if ( geometryData.normals.length > 0 ) geometry.setAttribute( 'normal', new Float32BufferAttribute( geometryData.normals, 3 ) );
			const hasColors = geometryData.colors.length > 0 && geometryData.colors.length === geometryData.vertices.length;
			if ( hasColors ) geometry.setAttribute( 'color', new Float32BufferAttribute( geometryData.colors, 3 ) );
			if ( geometryData.hasUVIndices === true && geometryData.uvs.length / 2 === geometryData.vertices.length / 3 ) geometry.setAttribute( 'uv', new Float32BufferAttribute( geometryData.uvs, 2 ) );

			const materials = object.materials.map( ( source ) => {

				let material = this.materials?.create( source.name );

				if ( isLine && material && ! material.isLineBasicMaterial ) {

					const line = new LineBasicMaterial();
					line.copy( material );
					material = line;

				} else if ( isPoints && material && ! material.isPointsMaterial ) {

					const points = new PointsMaterial( { size: 10, sizeAttenuation: false } );
					points.copy( material );
					points.map = material.map;
					material = points;

				}

				if ( ! material ) {

					material = isLine ? new LineBasicMaterial() : isPoints ? new PointsMaterial( { size: 1, sizeAttenuation: false } ) : new MeshPhongMaterial();
					material.name = source.name;
					if ( ! isLine && ! isPoints ) material.flatShading = ! source.smooth;

				}

				if ( hasColors ) material.vertexColors = true;
				return material;

			} );

			// faces without normals get smooth ones (flat ones without `s`) from the geometry
			if ( ! isLine && ! isPoints && geometryData.normals.length === 0 ) geometry.computeVertexNormals();

			let mesh;

			if ( materials.length > 1 ) {

				object.materials.forEach( ( source, i ) => geometry.addGroup( source.groupStart, source.groupCount, i ) );
				mesh = isLine ? new LineSegments( geometry, materials ) : isPoints ? new Points( geometry, materials ) : new Mesh( geometry, materials );

			} else {

				mesh = isLine ? new LineSegments( geometry, materials[ 0 ] ) : isPoints ? new Points( geometry, materials[ 0 ] ) : new Mesh( geometry, materials[ 0 ] );

			}

			mesh.name = object.name;
			container.add( mesh );

		}

		// a file of bare vertices draws them as points
		if ( ! hasPrimitives && state.vertices.length > 0 ) {

			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new Float32BufferAttribute( state.vertices, 3 ) );
			const material = new PointsMaterial( { size: 1, sizeAttenuation: false } );
			if ( state.colors.length > 0 && state.colors[ 0 ] !== undefined ) {

				geometry.setAttribute( 'color', new Float32BufferAttribute( state.colors, 3 ) );
				material.vertexColors = true;

			}

			container.add( new Points( geometry, material ) );

		}

		return container;

	}

}
