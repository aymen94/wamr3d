// Geometries (attributes, morph targets, strips and fans) and meshes of every primitive mode.
//
// Part of the GLTFLoader add-on (`../GLTFLoader.js`).

import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshStandardMaterial, Points, PointsMaterial, SkinnedMesh } from '../../../compat.js';
import { ATTRIBUTES, COMPONENT_TYPES, toTriangles } from './common.js';

/** Methods of `GLTFParser`, copied onto its prototype. */
export class GLTFMeshes {

	// ---------------------------------------------------------------- geometry and meshes

	async loadGeometry( primitive ) {

		const draco = primitive.extensions?.KHR_draco_mesh_compression;
		const key = JSON.stringify( [ primitive.attributes, primitive.indices, primitive.targets, primitive.mode, draco ] );

		return this.cached( 'geometry:' + key, async () => {

			const geometry = draco ? await this.decodeDraco( primitive, draco ) : new BufferGeometry();

			for ( const [ name, accessor ] of Object.entries( primitive.attributes ) ) {

				const attributeName = ATTRIBUTES[ name ] ?? name.toLowerCase();
				// a vertex skinned by more than four joints keeps the first four
				if ( geometry.attributes[ attributeName ] !== undefined ) continue;
				geometry.setAttribute( attributeName, await this.getDependency( 'accessor', accessor ) );

			}

			if ( primitive.indices !== undefined && ! draco ) {

				const index = await this.getDependency( 'accessor', primitive.indices );
				geometry.setIndex( index.isInterleavedBufferAttribute ? index.clone() : index );

			}

			const position = this.json.accessors[ primitive.attributes.POSITION ];

			if ( position?.min && position?.max ) {

				geometry.computeBoundingBox();
				geometry.computeBoundingSphere();

			}

			if ( primitive.targets ) {

				const positions = [], normals = [], colors = [];

				for ( const target of primitive.targets ) {

					if ( target.POSITION !== undefined ) positions.push( await this.getDependency( 'accessor', target.POSITION ) );
					if ( target.NORMAL !== undefined ) normals.push( await this.getDependency( 'accessor', target.NORMAL ) );
					if ( target.COLOR_0 !== undefined ) colors.push( await this.getDependency( 'accessor', target.COLOR_0 ) );

				}

				// glTF targets are offsets from the base
				if ( positions.length ) geometry.morphAttributes.position = positions;
				if ( normals.length ) geometry.morphAttributes.normal = normals;
				if ( colors.length ) geometry.morphAttributes.color = colors;
				geometry.morphTargetsRelative = true;

			}

			if ( primitive.mode === 5 || primitive.mode === 6 ) toTriangles( geometry, primitive.mode );
			return geometry;

		} );

	}

	// The attributes Draco compressed, typed and normalized as their accessors say.
	async decodeDraco( primitive, extension ) {

		const ids = {}, types = {}, normalized = {};

		for ( const [ name, id ] of Object.entries( extension.attributes ) ) {

			const attributeName = ATTRIBUTES[ name ] ?? name.toLowerCase();
			const accessor = this.json.accessors[ primitive.attributes[ name ] ];
			ids[ attributeName ] = id;
			types[ attributeName ] = COMPONENT_TYPES[ accessor?.componentType ?? 5126 ].name;
			normalized[ attributeName ] = accessor?.normalized === true;

		}

		const buffer = await this.getDependency( 'bufferView', extension.bufferView );
		const geometry = await new Promise( ( resolve, reject ) => this.options.dracoLoader.decodeDracoFile( buffer, resolve, ids, types, undefined, reject ) );

		for ( const name in geometry.attributes ) {

			const attribute = geometry.attributes[ name ];
			if ( normalized[ name ] ) geometry.setAttribute( name, new BufferAttribute( attribute.array, attribute.itemSize, true ) );

		}

		return geometry;

	}

	async loadMesh( index ) {

		const definition = this.json.meshes[ index ], skinned = this.skinnedMeshes.has( index );
		const meshes = [];

		for ( let i = 0; i < definition.primitives.length; i ++ ) {

			const primitive = definition.primitives[ i ];
			if ( primitive.extensions?.KHR_draco_mesh_compression && ! this.options.dracoLoader ) throw new Error( 'WAMR3D: GLTFLoader: KHR_draco_mesh_compression needs setDRACOLoader().' );
			const geometry = await this.loadGeometry( primitive );
			let material = primitive.material !== undefined ? await this.getDependency( 'material', primitive.material ) : this.defaultMaterial();
			const mode = primitive.mode ?? 4;
			let mesh;

			if ( mode === 4 || mode === 5 || mode === 6 ) {

				// derived tangents follow GL's y, glTF's normal maps the other way
				if ( geometry.attributes.tangent === undefined && material.normalScale && ! material._flippedNormalScale ) {

					material = material.clone();
					material.normalScale.y *= - 1;
					if ( material.clearcoatNormalScale ) material.clearcoatNormalScale.y *= - 1;
					material._flippedNormalScale = true;

				}

				if ( geometry.attributes.color !== undefined && ! material.vertexColors ) {

					material = material.clone();
					material.vertexColors = true;

				}

				mesh = skinned ? new SkinnedMesh( geometry, material ) : new Mesh( geometry, material );
				if ( skinned && geometry.attributes.skinWeight !== undefined && ! geometry.attributes.skinWeight.normalized ) mesh.normalizeSkinWeights();

			} else {

				const lineMaterial = mode === 0 ? new PointsMaterial( { color: material.color, size: 1, sizeAttenuation: false } ) : new LineBasicMaterial( { color: material.color } );
				if ( geometry.attributes.color !== undefined ) lineMaterial.vertexColors = true;
				mesh = mode === 0 ? new Points( geometry, lineMaterial ) : mode === 1 ? new LineSegments( geometry, lineMaterial ) : mode === 3 ? new Line( geometry, lineMaterial ) : new LineLoop( geometry, lineMaterial );

			}

			if ( Object.keys( mesh.geometry.morphAttributes ).length > 0 ) {

				mesh.updateMorphTargets();
				const names = definition.extras?.targetNames;

				if ( Array.isArray( names ) ) {

					mesh.morphTargetDictionary = {};
					names.forEach( ( name, k ) => {

						mesh.morphTargetDictionary[ name ] = k;

					} );

				}

				if ( definition.weights ) definition.weights.forEach( ( weight, k ) => {

					mesh.morphTargetInfluences[ k ] = weight;

				} );

			}

			mesh.name = this.createUniqueName( definition.name || 'mesh_' + index );
			if ( definition.extras ) mesh.userData = definition.extras;
			this.associations.set( mesh, { meshes: index, primitives: i } );
			meshes.push( mesh );

		}

		if ( meshes.length === 1 ) return meshes[ 0 ];
		const group = new Group();
		for ( const mesh of meshes ) group.add( mesh );
		return group;

	}

	defaultMaterial() {

		return this.cached( 'material:default', () => new MeshStandardMaterial( { color: 0xffffff, emissive: 0x000000, metalness: 1, roughness: 1, transparent: false, depthTest: true, side: 0 } ) );

	}

}
