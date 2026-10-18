// FBX textures, materials, cameras, lights and model transforms.
//
// Part of the FBXLoader add-on (`../FBXLoader.js`).

import { ClampToEdgeWrapping, Color, DirectionalLight, EquirectangularReflectionMapping, Euler, Matrix4, MeshLambertMaterial, MeshPhongMaterial, Object3D, OrthographicCamera, PerspectiveCamera, PointLight, Quaternion, RepeatWrapping, SpotLight, SRGBColorSpace, Texture, TextureLoader, Vector3 } from '../../../compat.js';
import { child, properties } from './parser.js';

const DEG = Math.PI / 180;
// FBX rotation orders name the order rotations apply; three.js's the order of the matrix product.
const EULER_ORDERS = [ 'ZYX', 'YZX', 'XZY', 'ZXY', 'YXZ', 'XYZ' ];
const MIME_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', avif: 'image/avif' };

export const stripPrefix = ( name ) => String( name ?? '' ).replace( /^[^:]*::/, '' );
const vector = ( p, fallback ) => ( Array.isArray( p?.value ) ? p.value.map( Number ) : fallback );

// ---------------------------------------------------------------- transforms

function eulerQuaternion( degrees, order ) {

	return new Quaternion().setFromEuler( new Euler( degrees[ 0 ] * DEG, degrees[ 1 ] * DEG, degrees[ 2 ] * DEG, order ) );

}

/** A model's local transform data from its properties. */
export function modelTransform( node ) {

	const p = properties( node );
	const eulerOrder = EULER_ORDERS[ p.RotationOrder?.value ?? 0 ] ?? 'ZYX';
	const active = Number( p.RotationActive?.value ?? 0 ) !== 0;
	const transform = {
		eulerOrder,
		translation: vector( p[ 'Lcl Translation' ], [ 0, 0, 0 ] ),
		rotation: vector( p[ 'Lcl Rotation' ], [ 0, 0, 0 ] ),
		scaling: vector( p[ 'Lcl Scaling' ], [ 1, 1, 1 ] ),
		// pre- and post-rotations apply when rotation is active, always in X, Y, Z order
		preRotation: active && p.PreRotation ? eulerQuaternion( vector( p.PreRotation ), 'ZYX' ) : null,
		postRotationInverse: active && p.PostRotation ? eulerQuaternion( vector( p.PostRotation ), 'ZYX' ).invert() : null,
		rotationOffset: vector( p.RotationOffset, null ), rotationPivot: vector( p.RotationPivot, null ),
		scalingOffset: vector( p.ScalingOffset, null ), scalingPivot: vector( p.ScalingPivot, null ),
		geometric: null
	};

	const gt = vector( p.GeometricTranslation, null ), gr = vector( p.GeometricRotation, null ), gs = vector( p.GeometricScaling, null );

	if ( gt || gr || gs ) {

		transform.geometric = new Matrix4().compose(
			new Vector3().fromArray( gt ?? [ 0, 0, 0 ] ),
			gr ? eulerQuaternion( gr, eulerOrder ) : new Quaternion(),
			new Vector3().fromArray( gs ?? [ 1, 1, 1 ] )
		);

	}

	return transform;

}

const translation = ( v ) => new Matrix4().makeTranslation( v[ 0 ], v[ 1 ], v[ 2 ] );

/** T * Roff * Rp * Rpre * R * Rpost^-1 * Rp^-1 * Soff * Sp * S * Sp^-1, the FBX local transform. */
export function localMatrix( transform ) {

	const rotation = eulerQuaternion( transform.rotation, transform.eulerOrder );
	if ( transform.preRotation ) rotation.premultiply( transform.preRotation );
	if ( transform.postRotationInverse ) rotation.multiply( transform.postRotationInverse );
	const matrix = translation( transform.translation );
	if ( transform.rotationOffset ) matrix.multiply( translation( transform.rotationOffset ) );
	if ( transform.rotationPivot ) matrix.multiply( translation( transform.rotationPivot ) );
	matrix.multiply( new Matrix4().makeRotationFromQuaternion( rotation ) );
	if ( transform.rotationPivot ) matrix.multiply( translation( transform.rotationPivot.map( ( v ) => - v ) ) );
	if ( transform.scalingOffset ) matrix.multiply( translation( transform.scalingOffset ) );
	if ( transform.scalingPivot ) matrix.multiply( translation( transform.scalingPivot ) );
	matrix.multiply( new Matrix4().makeScale( transform.scaling[ 0 ], transform.scaling[ 1 ], transform.scaling[ 2 ] ) );
	if ( transform.scalingPivot ) matrix.multiply( translation( transform.scalingPivot.map( ( v ) => - v ) ) );
	return matrix;

}

// ---------------------------------------------------------------- textures

/** A texture node, its image from the connected video's embedded content or from a file. */
export function loadTexture( scene, id ) {

	const node = scene.objects.get( id ), p = properties( node );
	const video = scene.childrenOf( id ).map( ( c ) => scene.objects.get( c.id ) ).find( ( n ) => n?.name === 'Video' );
	const fileName = String( child( node, 'RelativeFilename' )?.props[ 0 ] || child( node, 'FileName' )?.props[ 0 ] || child( video, 'RelativeFilename' )?.props[ 0 ] || child( video, 'Filename' )?.props[ 0 ] || '' );
	const base = fileName.replace( /\\/g, '/' ).split( '/' ).pop();
	const extension = base.split( '.' ).pop().toLowerCase();
	const content = child( video, 'Content' )?.props[ 0 ];
	let url = null;

	if ( content instanceof Uint8Array && content.length > 0 ) {

		url = URL.createObjectURL( new Blob( [ content ], { type: MIME_TYPES[ extension ] ?? 'image/png' } ) );

	} else if ( typeof content === 'string' && content.length > 0 ) {

		// ASCII files embed base64
		url = 'data:' + ( MIME_TYPES[ extension ] ?? 'image/png' ) + ';base64,' + content;

	} else if ( base ) {

		url = scene.resourcePath + base;

	}

	const handler = scene.manager.getHandler( base );
	let texture;

	if ( url === null ) {

		texture = new Texture();

	} else if ( handler ) {

		texture = handler.load( url );

	} else if ( ! MIME_TYPES[ extension ] ) {

		console.warn( `WAMR3D: FBXLoader: no loader for "${base}"; add one with LoadingManager.addHandler().` );
		texture = new Texture();

	} else {

		texture = new TextureLoader( scene.manager ).setCrossOrigin( scene.crossOrigin ).load( url );

	}

	texture.name = stripPrefix( node.props[ 1 ] );
	const wrap = ( value ) => ( Number( value ?? 0 ) === 0 ? RepeatWrapping : ClampToEdgeWrapping );
	texture.wrapS = wrap( p.WrapModeU?.value );
	texture.wrapT = wrap( p.WrapModeV?.value );
	const scale = vector( p.Scaling, null ), offset = vector( p.Translation, null );
	if ( scale ) texture.repeat.set( scale[ 0 ], scale[ 1 ] );
	if ( offset ) texture.offset.set( offset[ 0 ], offset[ 1 ] );
	return texture;

}

// ---------------------------------------------------------------- materials

const color = ( p ) => new Color().setRGB( p.value[ 0 ], p.value[ 1 ], p.value[ 2 ], SRGBColorSpace );

export function buildMaterial( scene, id, textures ) {

	const node = scene.objects.get( id ), p = properties( node );
	const shading = String( child( node, 'ShadingModel' )?.props[ 0 ] ?? p.ShadingModel?.value ?? 'phong' ).toLowerCase();
	const params = {};
	const diffuse = p.DiffuseColor ?? p.Diffuse;
	if ( Array.isArray( diffuse?.value ) ) params.color = color( diffuse );
	if ( p.DisplacementFactor ) params.displacementScale = Number( p.DisplacementFactor.value );
	const emissive = p.EmissiveColor ?? p.Emissive;
	if ( Array.isArray( emissive?.value ) ) params.emissive = color( emissive );
	if ( p.EmissiveFactor ) params.emissiveIntensity = Number( p.EmissiveFactor.value );
	if ( p.Opacity ) params.opacity = Number( p.Opacity.value );
	if ( params.opacity < 1 ) params.transparent = true;
	if ( p.ReflectionFactor ) params.reflectivity = Number( p.ReflectionFactor.value );
	const shininess = p.Shininess ?? p.ShininessExponent;
	if ( shininess ) params.shininess = Number( shininess.value );
	const specular = p.SpecularColor ?? p.Specular;
	if ( Array.isArray( specular?.value ) ) params.specular = color( specular );
	if ( p.BumpFactor ) params.bumpScale = Number( p.BumpFactor.value );

	for ( const link of scene.childrenOf( id ) ) {

		const texture = textures.get( link.id );
		if ( ! texture ) continue;

		switch ( link.relationship ) {

			case 'Bump': params.bumpMap = texture; break;
			case 'Maya|TEX_ao_map': params.aoMap = texture; break;
			case 'DiffuseColor': case 'Maya|TEX_color_map': params.map = texture; texture.colorSpace = SRGBColorSpace; break;
			case 'DisplacementColor': params.displacementMap = texture; break;
			case 'EmissiveColor': params.emissiveMap = texture; texture.colorSpace = SRGBColorSpace; break;
			case 'NormalMap': case 'Maya|TEX_normal_map': params.normalMap = texture; break;
			case 'ReflectionColor': params.envMap = texture; texture.mapping = EquirectangularReflectionMapping; texture.colorSpace = SRGBColorSpace; break;
			case 'SpecularColor': params.specularMap = texture; texture.colorSpace = SRGBColorSpace; break;
			case 'TransparentColor': case 'TransparencyFactor': params.alphaMap = texture; params.transparent = true; break;
			default: break;

		}

	}

	const material = shading === 'lambert' ? new MeshLambertMaterial() : new MeshPhongMaterial();
	if ( shading === 'lambert' ) for ( const key of [ 'specular', 'shininess', 'specularMap', 'reflectivity' ] ) delete params[ key ];
	material.setValues( params );
	material.name = stripPrefix( node.props[ 1 ] );
	return material;

}

// ---------------------------------------------------------------- cameras and lights

/** A camera from its node attribute. FBX cameras look along +X, three.js's along -Z. */
export function buildCamera( attribute ) {

	const p = properties( attribute );
	const near = Number( p.NearPlane?.value ?? 1 ), far = Number( p.FarPlane?.value ?? 1000 );
	const width = Number( p.AspectWidth?.value ?? 1 ), height = Number( p.AspectHeight?.value ?? 1 );
	const aspect = width / ( height || 1 );
	let camera;

	if ( Number( p.CameraProjectionType?.value ?? 0 ) === 1 ) {

		const zoom = Number( p.OrthoZoom?.value ?? 1 ), half = zoom * 0.5;
		camera = new OrthographicCamera( - half * aspect, half * aspect, half, - half, near, far );

	} else {

		camera = new PerspectiveCamera( 45, aspect, near, far );
		if ( p.FieldOfView ) camera.fov = Number( p.FieldOfView.value );
		else if ( p.FocalLength ) camera.setFocalLength( Number( p.FocalLength.value ) );
		camera.updateProjectionMatrix();

	}

	return camera;

}

/** A light from its node attribute. FBX lights shine along -Y. */
export function buildLight( attribute ) {

	const p = properties( attribute );
	const type = Number( p.LightType?.value ?? 0 );
	const lightColor = Array.isArray( p.Color?.value ) ? color( p.Color ) : new Color( 1, 1, 1 );
	const intensity = p.Intensity ? Number( p.Intensity.value ) / 100 : 1;
	if ( Number( p.CastLightOnObject?.value ?? 1 ) === 0 ) return new Object3D();
	const distance = Number( p.EnableFarAttenuation?.value ?? 0 ) === 1 ? Number( p.FarAttenuationEnd?.value ?? 0 ) : 0;
	const decay = 1;
	let light;

	if ( type === 1 ) {

		light = new DirectionalLight( lightColor, intensity );

	} else if ( type === 2 ) {

		const outer = Number( p.OuterAngle?.value ?? 45 ) * DEG, inner = Number( p.InnerAngle?.value ?? 0 ) * DEG;
		light = new SpotLight( lightColor, intensity, distance, outer / 2, outer > 0 ? Math.max( 0, Math.min( 1, 1 - inner / outer ) ) : 0, decay );

	} else {

		if ( type !== 0 ) console.warn( 'WAMR3D: FBXLoader: area and volume lights load as point lights.' );
		light = new PointLight( lightColor, intensity, distance, decay );

	}

	if ( light.target ) {

		light.target.position.set( 0, - 1, 0 );
		light.add( light.target );

	}

	if ( Number( p.CastShadows?.value ?? 0 ) === 1 ) light.castShadow = true;
	return light;

}
