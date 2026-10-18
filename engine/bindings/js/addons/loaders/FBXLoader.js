// three.js add-on path: `three/addons/loaders/FBXLoader.js`.
//
// Autodesk FBX files (binary and ASCII, version 7.0 and later) into a Group with
// `animations`, written from the FBX document structure: models (meshes, bones, nulls,
// cameras, lights, NURBS curves) with their transforms (pivots, offsets, pre- and
// post-rotations, rotation order), geometry with normals, uv sets, colours and material
// groups, Phong and Lambert materials with embedded or external textures, skins (clusters),
// blend shapes, and animation stacks. Texture files the browser cannot decode (TGA, DDS)
// need a loader added with `LoadingManager.addHandler`.

import { Bone, FileLoader, Group, Line, LineBasicMaterial, Loader, LoaderUtils, Matrix4, Mesh, MeshPhongMaterial, PropertyBinding, Skeleton, SkinnedMesh } from '../../compat.js';
import { arrayOf, child, children, fbxVersion, isBinary, parseASCII, parseBinary, properties } from './fbx/parser.js';
import { buildCurve, buildGeometry } from './fbx/geometry.js';
import { buildCamera, buildLight, buildMaterial, loadTexture, localMatrix, modelTransform, stripPrefix } from './fbx/objects.js';
import { parseAnimations } from './fbx/animation.js';

export class FBXLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const path = this.path === '' ? LoaderUtils.extractUrlBase( url ) : this.path;
		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, ( buffer ) => {

			try {

				onLoad( this.parse( buffer, path ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( buffer, path ) {

		const version = fbxVersion( buffer );
		if ( version < 7000 ) throw new Error( `WAMR3D: FBXLoader: FBX version ${version} is not supported; versions 7.0 and later are.` );
		const tree = isBinary( buffer ) ? parseBinary( buffer ) : parseASCII( new TextDecoder().decode( buffer ) );
		return new FBXScene( tree, { manager: this.manager, crossOrigin: this.crossOrigin, resourcePath: this.resourcePath || path || '' } ).build();

	}

}

class FBXScene {

	constructor( tree, options ) {

		this.manager = options.manager;
		this.crossOrigin = options.crossOrigin;
		this.resourcePath = options.resourcePath;
		this.objects = new Map();
		this.children = new Map();
		this.parents = new Map();
		this.models = new Map();
		this.transforms = new Map();
		this.morphChannels = new Map();

		for ( const node of child( tree, 'Objects' )?.children ?? [] ) this.objects.set( String( node.props[ 0 ] ), node );

		for ( const connection of children( child( tree, 'Connections' ), 'C' ) ) {

			const [ , from, to, relationship = '' ] = connection.props;
			const childId = String( from ), parentId = String( to );
			if ( ! this.children.has( parentId ) ) this.children.set( parentId, [] );
			if ( ! this.parents.has( childId ) ) this.parents.set( childId, [] );
			this.children.get( parentId ).push( { id: childId, relationship } );
			this.parents.get( childId ).push( { id: parentId, relationship } );

		}

	}

	childrenOf( id ) {

		return this.children.get( String( id ) ) ?? [];

	}

	parentsOf( id ) {

		return this.parents.get( String( id ) ) ?? [];

	}

	// Connected children of one object type (`Geometry`, `Material`, ...), in connection order.
	connected( id, type ) {

		return this.childrenOf( id ).filter( ( c ) => this.objects.get( c.id )?.name === type );

	}

	build() {

		const textures = new Map(), materials = new Map();

		for ( const [ id, node ] of this.objects ) {

			if ( node.name === 'Texture' ) textures.set( id, loadTexture( this, id ) );

		}

		for ( const [ id, node ] of this.objects ) {

			if ( node.name === 'Material' ) materials.set( id, buildMaterial( this, id, textures ) );

		}

		const skins = this.parseSkins();
		const sceneGraph = new Group();
		const names = {};

		for ( const [ id, node ] of this.objects ) {

			if ( node.name !== 'Model' ) continue;
			const object = this.buildModel( id, node, materials, skins );
			const base = PropertyBinding.sanitizeNodeName( stripPrefix( node.props[ 1 ] ) );
			object.name = base in names ? base + '_' + ( ++ names[ base ] ) : ( names[ base ] = 0, base );
			const transform = modelTransform( node );
			this.transforms.set( id, transform );
			const local = localMatrix( transform );
			// FBX cameras look along +X
			if ( object.isCamera ) local.multiply( new Matrix4().makeRotationY( - Math.PI / 2 ) );
			local.decompose( object.position, object.quaternion, object.scale );
			this.models.set( id, object );

		}

		// the model hierarchy
		for ( const [ id, object ] of this.models ) {

			const parent = this.parentsOf( id ).map( ( p ) => this.models.get( p.id ) ).find( Boolean );
			( parent ?? sceneGraph ).add( object );

		}

		sceneGraph.updateMatrixWorld( true );
		this.bindSkeletons( skins );
		sceneGraph.animations = parseAnimations( this );
		return sceneGraph;

	}

	// Skin deformers by geometry id: control point weights and the clusters' bones.
	parseSkins() {

		const skins = new Map();

		for ( const [ id, node ] of this.objects ) {

			if ( node.name !== 'Deformer' || node.props[ 2 ] !== 'Skin' ) continue;
			const clusters = [];

			for ( const link of this.childrenOf( id ) ) {

				const cluster = this.objects.get( link.id );
				if ( cluster?.name !== 'Deformer' || cluster.props[ 2 ] !== 'Cluster' ) continue;
				const bone = this.childrenOf( link.id ).find( ( c ) => this.objects.get( c.id )?.name === 'Model' );
				clusters.push( {
					bone: bone?.id ?? null,
					indices: arrayOf( cluster, 'Indexes' ),
					weights: arrayOf( cluster, 'Weights' ),
					transform: new Matrix4().fromArray( Array.from( arrayOf( cluster, 'Transform' ) ) ),
					transformLink: new Matrix4().fromArray( Array.from( arrayOf( cluster, 'TransformLink' ) ) )
				} );

			}

			const weights = new Map();

			clusters.forEach( ( cluster, bone ) => {

				for ( let i = 0; i < cluster.indices.length; i ++ ) {

					const vertex = cluster.indices[ i ];
					if ( ! weights.has( vertex ) ) weights.set( vertex, [] );
					weights.get( vertex ).push( [ bone, cluster.weights[ i ] ] );

				}

			} );

			for ( const geometry of this.parentsOf( id ) ) skins.set( geometry.id, { clusters, weights, meshes: [] } );

		}

		return skins;

	}

	// Blend shape channels of a geometry, each with its first shape's offsets.
	morphShapes( geometryId ) {

		const channels = [];

		for ( const deformer of this.childrenOf( geometryId ) ) {

			const node = this.objects.get( deformer.id );
			if ( node?.name !== 'Deformer' || node.props[ 2 ] !== 'BlendShape' ) continue;

			for ( const channelLink of this.childrenOf( deformer.id ) ) {

				const channel = this.objects.get( channelLink.id );
				if ( channel?.props[ 2 ] !== 'BlendShapeChannel' ) continue;
				const shapeLink = this.childrenOf( channelLink.id ).find( ( c ) => this.objects.get( c.id )?.name === 'Geometry' );
				if ( ! shapeLink ) continue;
				const shape = this.objects.get( shapeLink.id );
				channels.push( {
					id: channelLink.id,
					name: stripPrefix( channel.props[ 1 ] ),
					indices: arrayOf( shape, 'Indexes' ),
					vertices: arrayOf( shape, 'Vertices' ),
					percent: Number( properties( channel ).DeformPercent?.value ?? 0 )
				} );

			}

		}

		return channels;

	}

	buildModel( id, node, materials, skins ) {

		const type = node.props[ 2 ];

		if ( type === 'LimbNode' || type === 'Limb' || type === 'Root' ) return new Bone();
		const attribute = this.childrenOf( id ).map( ( c ) => this.objects.get( c.id ) ).find( ( n ) => n?.name === 'NodeAttribute' );
		if ( type === 'Camera' && attribute ) return buildCamera( attribute );
		if ( type === 'Light' && attribute ) return buildLight( attribute );
		const geometryLink = this.connected( id, 'Geometry' )[ 0 ];
		if ( ! geometryLink ) return new Group();
		const geometryNode = this.objects.get( geometryLink.id );
		const transform = modelTransform( node ).geometric;

		if ( geometryNode.props[ 2 ] === 'NurbsCurve' ) {

			const geometry = buildCurve( geometryNode );
			if ( transform ) geometry.applyMatrix4( transform );
			return new Line( geometry, new LineBasicMaterial( { color: 0x3300ff } ) );

		}

		const skin = skins.get( geometryLink.id ) ?? null;
		const shapes = this.morphShapes( geometryLink.id );
		const geometry = buildGeometry( geometryNode, { skin: skin?.weights ?? null, shapes, transform } );
		const list = this.connected( id, 'Material' ).map( ( m ) => materials.get( m.id ) ).filter( Boolean );
		if ( list.length === 0 ) list.push( new MeshPhongMaterial( { name: Loader.DEFAULT_MATERIAL_NAME, color: 0xcccccc } ) );
		if ( geometry.attributes.color ) for ( const material of list ) material.vertexColors = true;
		const material = list.length === 1 ? list[ 0 ] : list;
		const mesh = skin ? new SkinnedMesh( geometry, material ) : new Mesh( geometry, material );
		if ( skin ) skin.meshes.push( mesh );

		if ( shapes.length ) {

			mesh.updateMorphTargets();
			mesh.morphTargetDictionary = {};

			shapes.forEach( ( shape, index ) => {

				mesh.morphTargetDictionary[ shape.name ] = index;
				mesh.morphTargetInfluences[ index ] = shape.percent / 100;
				if ( ! this.morphChannels.has( shape.id ) ) this.morphChannels.set( shape.id, [] );
				this.morphChannels.get( shape.id ).push( { mesh, index } );

			} );

		}

		return mesh;

	}

	bindSkeletons( skins ) {

		for ( const skin of skins.values() ) {

			const bones = skin.clusters.map( ( c ) => this.models.get( c.bone ) ?? new Bone() );
			const inverses = skin.clusters.map( ( c ) => c.transformLink.clone().invert() );
			const skeleton = new Skeleton( bones, inverses );
			// the mesh's world matrix when it was bound
			const bindMatrix = skin.clusters[ 0 ]?.transform;

			for ( const mesh of skin.meshes ) mesh.bind( skeleton, bindMatrix ?? mesh.matrixWorld );

		}

	}

}
