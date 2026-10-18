// Cameras, skins, punctual lights, nodes with GPU instancing, and scenes.
//
// Part of the GLTFLoader add-on (`../GLTFLoader.js`).

import { Bone, Color, DirectionalLight, Group, InstancedMesh, Matrix4, Object3D, OrthographicCamera, PerspectiveCamera, PointLight, Quaternion, Skeleton, SpotLight, Vector3, LinearSRGBColorSpace } from '../../../compat.js';
import { cloneObject } from './common.js';

/** Methods of `GLTFParser`, copied onto its prototype. */
export class GLTFNodes {

	// ---------------------------------------------------------------- cameras, skins, nodes

	async loadCamera( index ) {

		const definition = this.json.cameras[ index ];
		let camera;

		if ( definition.type === 'perspective' ) {

			const p = definition.perspective;
			camera = new PerspectiveCamera( p.yfov * 180 / Math.PI, p.aspectRatio || 1, p.znear || 1, p.zfar || 2e6 );

		} else {

			const o = definition.orthographic;
			camera = new OrthographicCamera( - o.xmag, o.xmag, o.ymag, - o.ymag, o.znear, o.zfar );

		}

		if ( definition.name ) camera.name = this.createUniqueName( definition.name );
		if ( definition.extras ) camera.userData = definition.extras;
		return camera;

	}

	async loadSkin( index ) {

		const definition = this.json.skins[ index ];
		const inverses = definition.inverseBindMatrices !== undefined ? await this.getDependency( 'accessor', definition.inverseBindMatrices ) : null;
		const bones = await Promise.all( definition.joints.map( ( joint ) => this.getDependency( 'node', joint ) ) );
		const boneInverses = bones.map( ( _, i ) => ( inverses ? new Matrix4().fromArray( inverses.array, i * 16 ) : new Matrix4() ) );
		return new Skeleton( bones, boneInverses );

	}

	loadLight( index ) {

		const definition = this.json.extensions.KHR_lights_punctual.lights[ index ];
		const color = new Color( 0xffffff );
		if ( definition.color ) color.setRGB( definition.color[ 0 ], definition.color[ 1 ], definition.color[ 2 ], LinearSRGBColorSpace );
		const range = definition.range ?? 0;
		let light;

		switch ( definition.type ) {

			case 'directional':
				light = new DirectionalLight( color );
				light.target.position.set( 0, 0, - 1 );
				light.add( light.target );
				break;

			case 'point':
				light = new PointLight( color );
				light.distance = range;
				break;

			case 'spot': {

				light = new SpotLight( color );
				light.distance = range;
				const spot = definition.spot ?? {}, inner = spot.innerConeAngle ?? 0, outer = spot.outerConeAngle ?? Math.PI / 4;
				light.angle = outer;
				light.penumbra = 1.0 - inner / outer;
				light.target.position.set( 0, 0, - 1 );
				light.add( light.target );
				break;

			}

			default:
				throw new Error( 'WAMR3D: GLTFLoader: unexpected light type ' + definition.type );

		}

		light.position.set( 0, 0, 0 );
		light.decay = 2;
		if ( definition.intensity !== undefined ) light.intensity = definition.intensity;
		light.name = this.createUniqueName( definition.name || 'light_' + index );
		return light;

	}

	async loadNode( index ) {

		const definition = this.json.nodes[ index ];
		const name = definition.name ? this.createUniqueName( definition.name ) : '';
		let node;

		if ( definition.mesh !== undefined ) {

			const mesh = await this.getDependency( 'mesh', definition.mesh );
			node = this.cache.has( 'node-mesh:' + definition.mesh ) ? cloneObject( mesh ) : mesh;
			this.cache.set( 'node-mesh:' + definition.mesh, true );
			const instancing = definition.extensions?.EXT_mesh_gpu_instancing;
			if ( instancing ) node = await this.instanced( node, instancing.attributes );

		}

		const children = [];
		if ( node !== undefined ) children.push( node );
		if ( definition.camera !== undefined ) children.push( await this.getDependency( 'camera', definition.camera ) );
		const lightIndex = definition.extensions?.KHR_lights_punctual?.light;
		if ( lightIndex !== undefined ) children.push( this.loadLight( lightIndex ) );

		let object;

		if ( this.joints.has( index ) ) object = new Bone();
		else if ( children.length === 1 ) object = children.shift();
		else object = new Object3D();

		for ( const child of children ) object.add( child );
		if ( name ) object.name = name;
		if ( definition.extras ) object.userData = { ...object.userData, ...definition.extras };

		if ( definition.matrix !== undefined ) {

			const matrix = new Matrix4().fromArray( definition.matrix ), position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
			matrix.decompose( position, quaternion, scale );
			object.position.copy( position );
			object.quaternion.copy( quaternion );
			object.scale.copy( scale );

		} else {

			if ( definition.translation ) object.position.fromArray( definition.translation );
			if ( definition.rotation ) object.quaternion.fromArray( definition.rotation );
			if ( definition.scale ) object.scale.fromArray( definition.scale );

		}

		this.associations.set( object, { nodes: index } );
		this.nodeObjects[ index ] = object;
		return object;

	}

	async instanced( mesh, attributes ) {

		if ( ! mesh.isMesh ) return mesh;
		const read = async ( name ) => ( attributes[ name ] !== undefined ? this.getDependency( 'accessor', attributes[ name ] ) : null );
		const [ translation, rotation, scale ] = await Promise.all( [ read( 'TRANSLATION' ), read( 'ROTATION' ), read( 'SCALE' ) ] );
		const count = ( translation ?? rotation ?? scale ).count;
		const instanced = new InstancedMesh( mesh.geometry, mesh.material, count );
		const matrix = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3( 1, 1, 1 );

		for ( let i = 0; i < count; i ++ ) {

			if ( translation ) p.fromBufferAttribute( translation, i );
			if ( rotation ) q.set( rotation.getX( i ), rotation.getY( i ), rotation.getZ( i ), rotation.getW( i ) );
			if ( scale ) s.fromBufferAttribute( scale, i );
			instanced.setMatrixAt( i, matrix.compose( p, q, s ) );

		}

		instanced.instanceMatrix.needsUpdate = true;
		instanced.name = mesh.name;
		instanced.userData = mesh.userData;
		return instanced;

	}

	async loadScene( index ) {

		const definition = this.json.scenes[ index ];
		const scene = new Group();
		if ( definition.name ) scene.name = this.createUniqueName( definition.name );
		if ( definition.extras ) scene.userData = definition.extras;
		const roots = await Promise.all( ( definition.nodes ?? [] ).map( ( node ) => this.buildNodeHierarchy( node ) ) );
		for ( const root of roots ) scene.add( root );

		// skins bind once the hierarchy exists; the mesh's own transform does not move it
		// (glTF), which three.js's attached bind mode with an identity bind matrix gives
		const skins = [];
		const visit = async ( nodeIndex ) => {

			const definition_ = this.json.nodes[ nodeIndex ];
			if ( definition_.skin !== undefined ) skins.push( [ nodeIndex, definition_.skin ] );
			for ( const child of definition_.children ?? [] ) await visit( child );

		};

		for ( const node of definition.nodes ?? [] ) await visit( node );

		for ( const [ nodeIndex, skinIndex ] of skins ) {

			const skeleton = await this.getDependency( 'skin', skinIndex ), object = this.nodeObjects[ nodeIndex ];
			object.traverse( ( mesh ) => {

				if ( mesh.isSkinnedMesh ) mesh.bind( skeleton, new Matrix4() );

			} );

		}

		return scene;

	}

	async buildNodeHierarchy( index ) {

		const object = await this.getDependency( 'node', index ), definition = this.json.nodes[ index ];
		const children = await Promise.all( ( definition.children ?? [] ).map( ( child ) => this.buildNodeHierarchy( child ) ) );
		for ( const child of children ) object.add( child );
		return object;

	}

}
