// Loaders: the three.js loading manager, cache and file loaders, and the loaders of
// three.js's JSON formats for geometries, materials, animations and whole scenes.

import { AnimationClip } from './animation.js';
import * as Geometries from './geometry.js';
import * as Shapes from './shapes.js';
import { Shape } from './curves.js';
import * as Materials from './materials.js';
import * as Objects from './objects.js';
import * as Lights from './lights.js';
import { OrthographicCamera, PerspectiveCamera } from './cameras.js';
import { Fog, FogExp2, Group, Object3D, Scene } from './object3d.js';
import { Color, Matrix4 } from './math.js';
import { CubeTexture, DataTexture, Texture } from './textures.js';

// ---------------------------------------------------------------- Cache and manager

/** three.js `Cache`: loaded files by URL, used by FileLoader and ImageLoader when enabled. */
export const Cache = {

	enabled: false,
	files: {},

	add( key, file ) {

		if ( this.enabled ) this.files[ key ] = file;

	},

	get( key ) {

		return this.enabled ? this.files[ key ] : undefined;

	},

	remove( key ) {

		delete this.files[ key ];

	},

	clear() {

		this.files = {};

	}

};

/** three.js `LoadingManager`: counts loads in progress and reports start, progress, end and errors. */
export class LoadingManager {

	constructor( onLoad, onProgress, onError ) {

		let isLoading = false, itemsLoaded = 0, itemsTotal = 0, urlModifier;
		const handlers = [], scope = this;
		this.onStart = undefined;
		this.onLoad = onLoad;
		this.onProgress = onProgress;
		this.onError = onError;
		this.abortController = new AbortController();

		this.itemStart = function ( url ) {

			itemsTotal ++;
			if ( isLoading === false && scope.onStart !== undefined ) scope.onStart( url, itemsLoaded, itemsTotal );
			isLoading = true;

		};

		this.itemEnd = function ( url ) {

			itemsLoaded ++;
			if ( scope.onProgress !== undefined ) scope.onProgress( url, itemsLoaded, itemsTotal );

			if ( itemsLoaded === itemsTotal ) {

				isLoading = false;
				if ( scope.onLoad !== undefined ) scope.onLoad();

			}

		};

		this.itemError = function ( url ) {

			if ( scope.onError !== undefined ) scope.onError( url );

		};

		this.resolveURL = function ( url ) {

			return urlModifier ? urlModifier( url ) : url;

		};

		this.setURLModifier = function ( transform ) {

			urlModifier = transform;
			return this;

		};

		this.addHandler = function ( regex, loader ) {

			handlers.push( regex, loader );
			return this;

		};

		this.removeHandler = function ( regex ) {

			const index = handlers.indexOf( regex );
			if ( index !== - 1 ) handlers.splice( index, 2 );
			return this;

		};

		this.getHandler = function ( file ) {

			for ( let i = 0; i < handlers.length; i += 2 ) {

				const regex = handlers[ i ];
				if ( regex.global ) regex.lastIndex = 0;
				if ( regex.test( file ) ) return handlers[ i + 1 ];

			}

			return null;

		};

		this.abort = function () {

			this.abortController.abort();
			this.abortController = new AbortController();
			return this;

		};

	}

}

export const DefaultLoadingManager = new LoadingManager();

/** three.js `Loader`: path, resource path, credentials and request headers shared by loaders. */
export class Loader {

	constructor( manager ) {

		this.manager = manager !== undefined ? manager : DefaultLoadingManager;
		this.crossOrigin = 'anonymous';
		this.withCredentials = false;
		this.path = '';
		this.resourcePath = '';
		this.requestHeader = {};

	}

	load() {}

	loadAsync( url, onProgress ) {

		return new Promise( ( resolve, reject ) => this.load( url, resolve, onProgress, reject ) );

	}

	parse() {}

	setCrossOrigin( crossOrigin ) {

		this.crossOrigin = crossOrigin;
		return this;

	}

	setWithCredentials( value ) {

		this.withCredentials = value;
		return this;

	}

	setPath( path ) {

		this.path = path;
		return this;

	}

	setResourcePath( resourcePath ) {

		this.resourcePath = resourcePath;
		return this;

	}

	setRequestHeader( requestHeader ) {

		this.requestHeader = requestHeader;
		return this;

	}

	abort() {

		return this;

	}

}

Loader.DEFAULT_MATERIAL_NAME = '__DEFAULT';

// ---------------------------------------------------------------- files

const loading = {};

/** three.js `FileLoader`: text, JSON, ArrayBuffer, Blob or documents by `responseType`. */
export class FileLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.mimeType = '';
		this.responseType = '';
		this._abortController = new AbortController();

	}

	load( url, onLoad, onProgress, onError ) {

		if ( url === undefined ) url = '';
		if ( this.path !== undefined ) url = this.path + url;
		url = this.manager.resolveURL( url );
		const cached = Cache.get( `file:${url}` );

		if ( cached !== undefined ) {

			this.manager.itemStart( url );
			setTimeout( () => {

				if ( onLoad ) onLoad( cached );
				this.manager.itemEnd( url );

			}, 0 );
			return cached;

		}

		if ( loading[ url ] !== undefined ) {

			loading[ url ].push( { onLoad, onProgress, onError } );
			return;

		}

		loading[ url ] = [ { onLoad, onProgress, onError } ];
		const request = new Request( url, { headers: new Headers( this.requestHeader ), credentials: this.withCredentials ? 'include' : 'same-origin', signal: this.manager.abortController.signal } );
		const mimeType = this.mimeType, responseType = this.responseType;
		this.manager.itemStart( url );

		fetch( request ).then( ( response ) => {

			if ( response.status !== 200 && response.status !== 0 ) throw new HttpError( `fetch for "${response.url}" responded with ${response.status}: ${response.statusText}`, response );
			const callbacks = loading[ url ], total = Number( response.headers.get( 'Content-Length' ) ) || 0;

			// progress as the body arrives, when anyone listens and the size is known
			if ( typeof ReadableStream === 'undefined' || response.body === null || response.body.getReader === undefined || ! callbacks.some( ( c ) => c.onProgress ) ) return response;
			const reader = response.body.getReader();
			let loaded = 0;
			const stream = new ReadableStream( {
				start( controller ) {

					const read = () => reader.read().then( ( { done, value } ) => {

						if ( done ) {

							controller.close();
							return;

						}

						loaded += value.byteLength;
						const event = new ProgressEvent( 'progress', { lengthComputable: total > 0, loaded, total } );
						for ( const callback of callbacks ) if ( callback.onProgress ) callback.onProgress( event );
						controller.enqueue( value );
						read();

					}, ( e ) => controller.error( e ) );
					read();

				}
			} );
			return new Response( stream );

		} ).then( ( response ) => {

			switch ( responseType ) {

				case 'arraybuffer': return response.arrayBuffer();
				case 'blob': return response.blob();
				case 'document': return response.text().then( ( text ) => new DOMParser().parseFromString( text, mimeType ) );
				case 'json': return response.json();
				default: return response.text();

			}

		} ).then( ( data ) => {

			Cache.add( `file:${url}`, data );
			const callbacks = loading[ url ];
			delete loading[ url ];
			for ( const callback of callbacks ) if ( callback.onLoad ) callback.onLoad( data );

		} ).catch( ( error ) => {

			const callbacks = loading[ url ];

			if ( callbacks === undefined ) {

				this.manager.itemError( url );
				throw error;

			}

			delete loading[ url ];
			for ( const callback of callbacks ) if ( callback.onError ) callback.onError( error );
			this.manager.itemError( url );

		} ).finally( () => this.manager.itemEnd( url ) );

	}

	setResponseType( value ) {

		this.responseType = value;
		return this;

	}

	setMimeType( value ) {

		this.mimeType = value;
		return this;

	}

}

class HttpError extends Error {

	constructor( message, response ) {

		super( message );
		this.response = response;

	}

}

/** three.js `ImageLoader`: an `HTMLImageElement` for a URL. */
export class ImageLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		if ( this.path !== undefined ) url = this.path + url;
		url = this.manager.resolveURL( url );
		const cached = Cache.get( `image:${url}` );

		if ( cached !== undefined ) {

			this.manager.itemStart( url );
			setTimeout( () => {

				if ( onLoad ) onLoad( cached );
				this.manager.itemEnd( url );

			}, 0 );
			return cached;

		}

		const image = document.createElementNS( 'http://www.w3.org/1999/xhtml', 'img' );
		const loaded = () => {

			Cache.add( `image:${url}`, image );
			if ( onLoad ) onLoad( image );
			this.manager.itemEnd( url );

		};

		const failed = ( event ) => {

			if ( onError ) onError( event );
			this.manager.itemError( url );
			this.manager.itemEnd( url );

		};

		image.addEventListener( 'load', loaded, { once: true } );
		image.addEventListener( 'error', failed, { once: true } );
		if ( url.slice( 0, 5 ) !== 'data:' && this.crossOrigin !== undefined ) image.crossOrigin = this.crossOrigin;
		this.manager.itemStart( url );
		image.src = url;
		return image;

	}

}

/** three.js `ImageBitmapLoader`: an `ImageBitmap` for a URL (`setOptions` passes `createImageBitmap` options). */
export class ImageBitmapLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.isImageBitmapLoader = true;
		this.options = { premultiplyAlpha: 'none' };

	}

	setOptions( options ) {

		this.options = options;
		return this;

	}

	load( url, onLoad, onProgress, onError ) {

		if ( url === undefined ) url = '';
		if ( this.path !== undefined ) url = this.path + url;
		url = this.manager.resolveURL( url );
		const cached = Cache.get( `image-bitmap:${url}` );

		if ( cached !== undefined ) {

			this.manager.itemStart( url );
			Promise.resolve( cached ).then( ( bitmap ) => {

				if ( onLoad ) onLoad( bitmap );
				this.manager.itemEnd( url );

			} );
			return;

		}

		this.manager.itemStart( url );
		const promise = fetch( url, { credentials: this.crossOrigin === 'anonymous' ? 'same-origin' : 'include', headers: this.requestHeader } )
			.then( ( response ) => response.blob() )
			.then( ( blob ) => createImageBitmap( blob, Object.assign( this.options, { colorSpaceConversion: 'none' } ) ) )
			.then( ( bitmap ) => {

				Cache.add( `image-bitmap:${url}`, bitmap );
				if ( onLoad ) onLoad( bitmap );
				this.manager.itemEnd( url );
				return bitmap;

			} ).catch( ( error ) => {

				if ( onError ) onError( error );
				Cache.remove( `image-bitmap:${url}` );
				this.manager.itemError( url );
				this.manager.itemEnd( url );

			} );
		Cache.add( `image-bitmap:${url}`, promise );

	}

}

/** Loads an image into a `Texture` (three.js `TextureLoader`). */
export class TextureLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const texture = new Texture();
		const loader = new ImageLoader( this.manager );
		loader.setCrossOrigin( this.crossOrigin );
		loader.setPath( this.path );
		loader.load( url, ( image ) => {

			texture.image = image;
			texture.needsUpdate = true;
			if ( onLoad !== undefined ) onLoad( texture );

		}, onProgress, onError );
		return texture;

	}

}

/** Six images into a `CubeTexture` (+x, -x, +y, -y, +z, -z), as three.js `CubeTextureLoader`. */
export class CubeTextureLoader extends Loader {

	load( urls, onLoad, onProgress, onError ) {

		const texture = new CubeTexture();
		texture.colorSpace = 'srgb';
		const loader = new ImageLoader( this.manager );
		loader.setCrossOrigin( this.crossOrigin );
		loader.setPath( this.path );
		let loaded = 0;
		const images = new Array( 6 ).fill( null );

		urls.forEach( ( url, i ) => loader.load( url, ( image ) => {

			images[ i ] = image;
			loaded ++;

			if ( loaded === 6 ) {

				texture.image = images;
				texture.needsUpdate = true;
				if ( onLoad ) onLoad( texture );

			}

		}, undefined, onError ) );

		return texture;

	}

}

/**
 * three.js `DataTextureLoader`: subclasses implement `parse( buffer )` returning `{ data,
 * width, height, type, ... }` (as the RGBE and EXR loaders do), loaded into a DataTexture.
 */
export class DataTextureLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const texture = new DataTexture();
		const loader = new FileLoader( this.manager );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setPath( this.path );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, ( buffer ) => {

			let data;

			try {

				data = this.parse( buffer );

			} catch ( error ) {

				if ( onError !== undefined ) onError( error );
				else console.error( error );
				return;

			}

			if ( data.image !== undefined ) texture.image = data.image;
			else if ( data.data !== undefined ) texture.image = { width: data.width, height: data.height, data: data.data };
			for ( const key of [ 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'colorSpace', 'flipY', 'format', 'type', 'mapping', 'generateMipmaps' ] ) if ( data[ key ] !== undefined ) texture[ key ] = data[ key ];
			if ( data.minFilter === undefined ) texture.minFilter = 1006;
			if ( data.magFilter === undefined ) texture.magFilter = 1006;
			texture.needsUpdate = true;
			if ( onLoad ) onLoad( texture, data );

		}, onProgress, onError );

		return texture;

	}

}

/** three.js `LoaderUtils`. */
export const LoaderUtils = {

	extractUrlBase( url ) {

		const index = url.lastIndexOf( '/' );
		return index === - 1 ? './' : url.slice( 0, index + 1 );

	},

	resolveURL( url, path ) {

		if ( typeof url !== 'string' || url === '' ) return '';
		if ( /^https?:\/\//i.test( path ) && /^\//.test( url ) ) path = path.replace( /(^https?:\/\/[^/]+).*/i, '$1' );
		if ( /^(https?:)?\/\//i.test( url ) ) return url;
		if ( /^data:.*,.*$/i.test( url ) ) return url;
		if ( /^blob:.*$/i.test( url ) ) return url;
		return path + url;

	}

};

// ---------------------------------------------------------------- JSON formats

const TYPED_ARRAYS = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };

/** three.js `AnimationLoader`: clips from three.js's JSON. */
export class AnimationLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( text ) => {

			try {

				onLoad( this.parse( JSON.parse( text ) ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( json ) {

		return json.map( ( clip ) => AnimationClip.parse( clip ) );

	}

}

function attributeFromJSON( json ) {

	const array = new TYPED_ARRAYS[ json.type ]( json.array );
	const attribute = new Geometries.BufferAttribute( array, json.itemSize, json.normalized );
	if ( json.name !== undefined ) attribute.name = json.name;
	return attribute;

}

/** three.js `BufferGeometryLoader`: a BufferGeometry from three.js's JSON (non-interleaved data). */
export class BufferGeometryLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( text ) => {

			try {

				onLoad( this.parse( JSON.parse( text ) ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	parse( json ) {

		const geometry = new Geometries.BufferGeometry(), data = json.data;
		if ( data.index !== undefined ) geometry.setIndex( attributeFromJSON( data.index ) );
		for ( const [ name, attribute ] of Object.entries( data.attributes ) ) geometry.setAttribute( name, attributeFromJSON( attribute ) );

		if ( data.morphAttributes ) {

			for ( const [ name, list ] of Object.entries( data.morphAttributes ) ) geometry.morphAttributes[ name ] = list.map( attributeFromJSON );

		}

		if ( data.morphTargetsRelative ) geometry.morphTargetsRelative = true;
		for ( const group of data.groups ?? data.offsets ?? data.drawcalls ?? [] ) geometry.addGroup( group.start, group.count, group.materialIndex );
		if ( json.name ) geometry.name = json.name;
		if ( json.userData ) geometry.userData = json.userData;
		return geometry;

	}

}

const MATERIALS = {
	MeshBasicMaterial: Materials.MeshBasicMaterial, MeshLambertMaterial: Materials.MeshLambertMaterial, MeshPhongMaterial: Materials.MeshPhongMaterial,
	MeshToonMaterial: Materials.MeshToonMaterial, MeshNormalMaterial: Materials.MeshNormalMaterial, MeshStandardMaterial: Materials.MeshStandardMaterial,
	MeshPhysicalMaterial: Materials.MeshPhysicalMaterial, LineBasicMaterial: Materials.LineBasicMaterial, PointsMaterial: Materials.PointsMaterial,
	SpriteMaterial: Materials.SpriteMaterial, ShaderMaterial: Materials.ShaderMaterial, RawShaderMaterial: Materials.RawShaderMaterial, Material: Materials.Material
};
const COLOR_KEYS = [ 'color', 'emissive', 'specular', 'sheenColor', 'attenuationColor', 'specularColor' ];
const PLAIN_KEYS = [ 'name', 'roughness', 'metalness', 'shininess', 'clearcoat', 'clearcoatRoughness', 'ior', 'sheen', 'sheenRoughness', 'transmission', 'thickness', 'attenuationDistance', 'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange', 'anisotropy', 'anisotropyRotation', 'dispersion', 'specularIntensity', 'emissiveIntensity', 'size', 'sizeAttenuation', 'blending', 'side', 'opacity', 'transparent', 'alphaTest', 'depthTest', 'depthWrite', 'wireframe', 'linewidth', 'vertexColors', 'rotation', 'toneMapped', 'fog', 'envMapIntensity', 'lightMapIntensity', 'aoMapIntensity', 'bumpScale', 'displacementScale', 'displacementBias', 'premultipliedAlpha', 'userData', 'defines', 'vertexShader', 'fragmentShader', 'glslVersion' ];
const MAP_KEYS = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap', 'specularMap', 'gradientMap', 'envMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap' ];

/** three.js `MaterialLoader`: a material from three.js's JSON; `setTextures` gives the textures by uuid. */
export class MaterialLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.textures = {};

	}

	setTextures( value ) {

		this.textures = value;
		return this;

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.load( url, ( text ) => {

			try {

				onLoad( this.parse( JSON.parse( text ) ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );

			}

		}, onProgress, onError );

	}

	parse( json ) {

		const Type = MATERIALS[ json.type ] ?? Materials.MeshStandardMaterial;
		const material = new Type();
		if ( json.uuid !== undefined ) material.uuid = json.uuid;
		for ( const key of COLOR_KEYS ) if ( json[ key ] !== undefined && material[ key ]?.isColor ) material[ key ].setHex( json[ key ] );
		for ( const key of PLAIN_KEYS ) if ( json[ key ] !== undefined ) material[ key ] = json[ key ];
		if ( json.normalScale !== undefined && material.normalScale ) material.normalScale.fromArray( Array.isArray( json.normalScale ) ? json.normalScale : [ json.normalScale, json.normalScale ] );

		if ( json.uniforms !== undefined && material.isShaderMaterial ) {

			for ( const [ name, uniform ] of Object.entries( json.uniforms ) ) {

				const value = uniform.type === 't' ? this.textures[ uniform.value ] : uniform.type === 'c' ? new Color().setHex( uniform.value ) : uniform.value;
				material.uniforms[ name ] = { value };

			}

		}

		for ( const key of MAP_KEYS ) if ( json[ key ] !== undefined ) material[ key ] = this.textures[ json[ key ] ] ?? null;
		return material;

	}

	static createMaterialFromType( type ) {

		return new ( MATERIALS[ type ] ?? Materials.Material )();

	}

}

const GEOMETRIES = { ...Geometries, ...Shapes };

/**
 * three.js `ObjectLoader`: scenes and objects from three.js's JSON (`object.toJSON()`):
 * built-in and buffer geometries, shapes, materials, images and textures, meshes, lines,
 * points, sprites, groups, lights, cameras, fog and animations.
 */
export class ObjectLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const path = this.path === '' ? LoaderUtils.extractUrlBase( url ) : this.path;
		this.resourcePath = this.resourcePath || path;
		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( text ) => {

			let json;

			try {

				json = JSON.parse( text );

			} catch ( error ) {

				if ( onError ) onError( error );
				return;

			}

			this.parse( json, onLoad );

		}, onProgress, onError );

	}

	async loadAsync( url, onProgress ) {

		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		const text = await loader.loadAsync( url, onProgress );
		return this.parseAsync( JSON.parse( text ) );

	}

	parse( json, onLoad ) {

		this.parseAsync( json ).then( ( object ) => {

			if ( onLoad ) onLoad( object );

		} );

	}

	async parseAsync( json ) {

		const shapes = Object.fromEntries( ( json.shapes ?? [] ).map( ( data ) => [ data.uuid, this.parseShape( data ) ] ) );
		const geometries = Object.fromEntries( ( json.geometries ?? [] ).map( ( data ) => [ data.uuid, this.parseGeometry( data, shapes ) ] ) );
		const images = await this.parseImages( json.images ?? [] );
		const textures = Object.fromEntries( ( json.textures ?? [] ).map( ( data ) => [ data.uuid, this.parseTexture( data, images ) ] ) );
		const materialLoader = new MaterialLoader().setTextures( textures );
		const materials = Object.fromEntries( ( json.materials ?? [] ).map( ( data ) => [ data.uuid, materialLoader.parse( data ) ] ) );
		const animations = Object.fromEntries( ( json.animations ?? [] ).map( ( data ) => [ data.uuid, AnimationClip.parse( data ) ] ) );
		const object = this.parseObject( json.object, geometries, materials, textures, animations );
		this.bindSkeletons( object, json.skeletons ?? [] );
		return object;

	}

	parseShape( data ) {

		const shape = new Shape();
		shape.uuid = data.uuid;
		return shape;

	}

	parseGeometry( data, shapes ) {

		if ( data.type === 'BufferGeometry' || data.type === 'InstancedBufferGeometry' ) {

			const geometry = new BufferGeometryLoader().parse( data );
			geometry.uuid = data.uuid;
			return geometry;

		}

		const Type = GEOMETRIES[ data.type ];

		if ( ! Type ) {

			console.warn( `WAMR3D: ObjectLoader: unsupported geometry type "${data.type}"` );
			return new Geometries.BufferGeometry();

		}

		const p = { ...data };
		const ordered = {
			BoxGeometry: [ 'width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments' ],
			PlaneGeometry: [ 'width', 'height', 'widthSegments', 'heightSegments' ],
			SphereGeometry: [ 'radius', 'widthSegments', 'heightSegments', 'phiStart', 'phiLength', 'thetaStart', 'thetaLength' ],
			CylinderGeometry: [ 'radiusTop', 'radiusBottom', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength' ],
			ConeGeometry: [ 'radius', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength' ],
			CircleGeometry: [ 'radius', 'segments', 'thetaStart', 'thetaLength' ],
			RingGeometry: [ 'innerRadius', 'outerRadius', 'thetaSegments', 'phiSegments', 'thetaStart', 'thetaLength' ],
			TorusGeometry: [ 'radius', 'tube', 'radialSegments', 'tubularSegments', 'arc' ],
			TorusKnotGeometry: [ 'radius', 'tube', 'tubularSegments', 'radialSegments', 'p', 'q' ],
			TetrahedronGeometry: [ 'radius', 'detail' ], OctahedronGeometry: [ 'radius', 'detail' ], DodecahedronGeometry: [ 'radius', 'detail' ], IcosahedronGeometry: [ 'radius', 'detail' ],
			CapsuleGeometry: [ 'radius', 'height', 'capSegments', 'radialSegments', 'heightSegments' ],
			ShapeGeometry: [ 'shapes', 'curveSegments' ]
		}[ data.type ];
		if ( data.shapes ) p.shapes = ( Array.isArray( data.shapes ) ? data.shapes : [ data.shapes ] ).map( ( uuid ) => shapes[ uuid ] );
		const geometry = ordered ? new Type( ...ordered.map( ( key ) => p[ key ] ) ) : new Type();
		geometry.uuid = data.uuid;
		if ( data.name ) geometry.name = data.name;
		return geometry;

	}

	async parseImages( list ) {

		const out = {};

		await Promise.all( list.map( async ( data ) => {

			const load = async ( url ) => {

				if ( typeof url === 'object' ) return { data: new TYPED_ARRAYS[ url.type ]( url.data ), width: url.width, height: url.height };
				const full = /^(\/\/)|([a-z]+:(\/\/)?)/i.test( url ) ? url : this.resourcePath + url;
				return new Promise( ( resolve ) => new ImageLoader( this.manager ).setCrossOrigin( this.crossOrigin ).load( full, resolve, undefined, () => resolve( null ) ) );

			};

			out[ data.uuid ] = Array.isArray( data.url ) ? await Promise.all( data.url.map( load ) ) : await load( data.url );

		} ) );

		return out;

	}

	parseTexture( data, images ) {

		const image = images[ data.image ];
		const texture = Array.isArray( image ) ? new CubeTexture( image ) : image?.data ? new DataTexture( image.data, image.width, image.height ) : new Texture( image ?? null );
		texture.uuid = data.uuid;
		if ( data.name ) texture.name = data.name;
		if ( data.mapping !== undefined ) texture.mapping = data.mapping;
		if ( data.channel !== undefined ) texture.channel = data.channel;
		if ( data.offset ) texture.offset.fromArray( data.offset );
		if ( data.repeat ) texture.repeat.fromArray( data.repeat );
		if ( data.center ) texture.center.fromArray( data.center );
		if ( data.rotation !== undefined ) texture.rotation = data.rotation;
		if ( data.wrap ) [ texture.wrapS, texture.wrapT ] = data.wrap;
		for ( const key of [ 'format', 'type', 'colorSpace', 'minFilter', 'magFilter', 'anisotropy', 'flipY', 'generateMipmaps' ] ) if ( data[ key ] !== undefined ) texture[ key ] = data[ key ];
		texture.needsUpdate = true;
		return texture;

	}

	parseObject( data, geometries, materials, textures, animations ) {

		const material = ( value ) => ( Array.isArray( value ) ? value.map( ( uuid ) => materials[ uuid ] ) : materials[ value ] );
		const geometry = geometries[ data.geometry ];
		let object;

		switch ( data.type ) {

			case 'Scene':
				object = new Scene();
				if ( data.background !== undefined ) object.background = typeof data.background === 'number' ? new Color( data.background ) : textures[ data.background ] ?? null;
				if ( data.environment !== undefined ) object.environment = textures[ data.environment ] ?? null;
				if ( data.fog !== undefined ) object.fog = data.fog.type === 'Fog' ? new Fog( data.fog.color, data.fog.near, data.fog.far ) : new FogExp2( data.fog.color, data.fog.density );
				if ( data.backgroundBlurriness !== undefined ) object.backgroundBlurriness = data.backgroundBlurriness;
				if ( data.backgroundIntensity !== undefined ) object.backgroundIntensity = data.backgroundIntensity;
				break;
			case 'PerspectiveCamera':
				object = new PerspectiveCamera( data.fov, data.aspect, data.near, data.far );
				if ( data.zoom !== undefined ) object.zoom = data.zoom;
				break;
			case 'OrthographicCamera':
				object = new OrthographicCamera( data.left, data.right, data.top, data.bottom, data.near, data.far );
				if ( data.zoom !== undefined ) object.zoom = data.zoom;
				break;
			case 'AmbientLight': object = new Lights.AmbientLight( data.color, data.intensity ); break;
			case 'DirectionalLight': object = new Lights.DirectionalLight( data.color, data.intensity ); break;
			case 'PointLight': object = new Lights.PointLight( data.color, data.intensity, data.distance, data.decay ); break;
			case 'RectAreaLight': object = new Lights.RectAreaLight( data.color, data.intensity, data.width, data.height ); break;
			case 'SpotLight': object = new Lights.SpotLight( data.color, data.intensity, data.distance, data.angle, data.penumbra, data.decay ); break;
			case 'HemisphereLight': object = new Lights.HemisphereLight( data.color, data.groundColor, data.intensity ); break;
			case 'LightProbe': object = new Lights.LightProbe().fromJSON( data ); break;
			case 'SkinnedMesh': object = new Objects.SkinnedMesh( geometry, material( data.material ) ); object._skeletonUuid = data.skeleton; object._bindMatrix = data.bindMatrix; object.bindMode = data.bindMode ?? 'attached'; break;
			case 'Mesh': object = new Objects.Mesh( geometry, material( data.material ) ); break;
			case 'InstancedMesh': {

				object = new Objects.InstancedMesh( geometry, material( data.material ), data.count );
				object.instanceMatrix.array.set( data.instanceMatrix.array );
				object.instanceMatrix.needsUpdate = true;
				if ( data.instanceColor ) {

					object.instanceColor = new Objects.InstancedBufferAttribute( new Float32Array( data.instanceColor.array ), data.instanceColor.itemSize );

				}

				break;

			}

			case 'LOD': object = new Objects.LOD(); break;
			case 'Line': object = new Objects.Line( geometry, material( data.material ) ); break;
			case 'LineLoop': object = new Objects.LineLoop( geometry, material( data.material ) ); break;
			case 'LineSegments': object = new Objects.LineSegments( geometry, material( data.material ) ); break;
			case 'Points': object = new Objects.Points( geometry, material( data.material ) ); break;
			case 'Sprite': object = new Objects.Sprite( material( data.material ) ); break;
			case 'Group': object = new Group(); break;
			case 'Bone': object = new Objects.Bone(); break;
			default: object = new Object3D();

		}

		object.uuid = data.uuid;
		if ( data.name !== undefined ) object.name = data.name;

		if ( data.matrix !== undefined ) {

			const matrix = new Matrix4().fromArray( data.matrix );
			if ( data.matrixAutoUpdate === false ) {

				object.matrixAutoUpdate = false;
				object.matrix.copy( matrix );

			} else {

				matrix.decompose( object.position, object.quaternion, object.scale );

			}

		} else {

			if ( data.position !== undefined ) object.position.fromArray( data.position );
			if ( data.rotation !== undefined ) object.rotation.fromArray( data.rotation );
			if ( data.quaternion !== undefined ) object.quaternion.fromArray( data.quaternion );
			if ( data.scale !== undefined ) object.scale.fromArray( data.scale );

		}

		if ( data.up !== undefined ) object.up.fromArray( data.up );
		if ( data.castShadow !== undefined ) object.castShadow = data.castShadow;
		if ( data.receiveShadow !== undefined ) object.receiveShadow = data.receiveShadow;

		if ( data.shadow && object.shadow ) {

			const shadow = object.shadow;
			if ( data.shadow.intensity !== undefined ) shadow.intensity = data.shadow.intensity;
			if ( data.shadow.bias !== undefined ) shadow.bias = data.shadow.bias;
			if ( data.shadow.normalBias !== undefined ) shadow.normalBias = data.shadow.normalBias;
			if ( data.shadow.radius !== undefined ) shadow.radius = data.shadow.radius;
			if ( data.shadow.mapSize !== undefined ) shadow.mapSize.fromArray( data.shadow.mapSize );

		}

		if ( data.visible !== undefined ) object.visible = data.visible;
		if ( data.frustumCulled !== undefined ) object.frustumCulled = data.frustumCulled;
		if ( data.renderOrder !== undefined ) object.renderOrder = data.renderOrder;
		if ( data.userData !== undefined ) object.userData = data.userData;
		if ( data.layers !== undefined ) object.layers.mask = data.layers;
		for ( const child of data.children ?? [] ) object.add( this.parseObject( child, geometries, materials, textures, animations ) );
		if ( data.animations ) object.animations = data.animations.map( ( uuid ) => animations[ uuid ] ).filter( Boolean );

		if ( data.type === 'LOD' ) {

			if ( data.autoUpdate !== undefined ) object.autoUpdate = data.autoUpdate;

			for ( const level of data.levels ?? [] ) {

				const child = object.getObjectByProperty( 'uuid', level.object );
				if ( child !== undefined ) object.addLevel( child, level.distance, level.hysteresis );

			}

		}

		if ( data.target !== undefined && object.target ) object._targetUuid = data.target;
		return object;

	}

	bindSkeletons( root, skeletons ) {

		const bones = new Map();
		root.traverse( ( object ) => {

			if ( object.isBone ) bones.set( object.uuid, object );

		} );
		const byUuid = Object.fromEntries( skeletons.map( ( data ) => [ data.uuid, new Objects.Skeleton( data.bones.map( ( uuid ) => bones.get( uuid ) ?? new Objects.Bone() ), data.boneInverses.map( ( m ) => new Matrix4().fromArray( m ) ) ) ] ) );

		root.traverse( ( object ) => {

			if ( object.isSkinnedMesh && object._skeletonUuid !== undefined && byUuid[ object._skeletonUuid ] ) object.bind( byUuid[ object._skeletonUuid ], object._bindMatrix ? new Matrix4().fromArray( object._bindMatrix ) : undefined );
			if ( object._targetUuid !== undefined ) {

				const target = root.getObjectByProperty( 'uuid', object._targetUuid );
				if ( target ) object.target = target;

			}

		} );

	}

}
