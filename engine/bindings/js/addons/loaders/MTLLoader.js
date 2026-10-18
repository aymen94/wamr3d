// three.js add-on path: `three/addons/loaders/MTLLoader.js`.
//
// Wavefront MTL material libraries, written from the format: each `newmtl` starts a
// material; `Kd`, `Ks` and `Ke` are its diffuse, specular and emissive colours, `Ns` its
// shininess, `d` (or `Tr`, its inverse) its opacity, and `map_Kd`, `map_Ks`, `map_Ke`,
// `map_d`, `map_Bump`/`bump`, `norm` and `disp` its texture maps (with `-s`, `-o` and
// `-bm` options). The materials are MeshPhongMaterial, as in three.js.

import { Color, ColorManagement, DefaultLoadingManager, FileLoader, FrontSide, Loader, LoaderUtils, MeshPhongMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2 } from '../../compat.js';

export class MTLLoader extends Loader {

	constructor( manager ) {

		super( manager );
		this.materialOptions = undefined;

	}

	load( url, onLoad, onProgress, onError ) {

		const path = this.path === '' ? LoaderUtils.extractUrlBase( url ) : this.path;
		const loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( url, ( text ) => {

			try {

				onLoad( this.parse( text, path ) );

			} catch ( error ) {

				if ( onError ) onError( error );
				else console.error( error );
				this.manager.itemError( url );

			}

		}, onProgress, onError );

	}

	setMaterialOptions( value ) {

		this.materialOptions = value;
		return this;

	}

	parse( text, path ) {

		const materialsInfo = {}, materialsArray = [];
		let info = null;

		for ( const raw of text.split( '\n' ) ) {

			const line = raw.trim();
			if ( line.length === 0 || line[ 0 ] === '#' ) continue;
			const space = line.indexOf( ' ' );
			const key = ( space >= 0 ? line.substring( 0, space ) : line ).toLowerCase();
			const value = space >= 0 ? line.substring( space + 1 ).trim() : '';

			if ( key === 'newmtl' ) {

				info = { name: value };
				materialsInfo[ value ] = info;

			} else if ( info ) {

				if ( key === 'ka' || key === 'kd' || key === 'ks' || key === 'ke' ) info[ key ] = value.split( /\s+/ ).slice( 0, 3 ).map( parseFloat );
				else info[ key ] = value;

			}

		}

		const creator = new MaterialCreator( this.resourcePath || path, this.materialOptions );
		creator.setCrossOrigin( this.crossOrigin );
		creator.setManager( this.manager );
		creator.setMaterials( materialsInfo );
		creator.materialsArray = materialsArray;
		return creator;

	}

}

/**
 * The materials of one library. Options: `side`, `wrap` (texture wrapping),
 * `normalizeRGB` (scale colours down so none exceeds 1), `ignoreZeroRGBs` (drop black
 * colours), `invertTrProperty` (read `Tr` as opacity).
 */
export class MaterialCreator {

	constructor( baseUrl = '', options = {} ) {

		this.baseUrl = baseUrl;
		this.options = options;
		this.materialsInfo = {};
		this.materials = {};
		this.materialsArray = [];
		this.nameLookup = {};
		this.crossOrigin = 'anonymous';
		this.side = this.options?.side ?? FrontSide;
		this.wrap = this.options?.wrap ?? RepeatWrapping;
		this.manager = DefaultLoadingManager;

	}

	setCrossOrigin( value ) {

		this.crossOrigin = value;
		return this;

	}

	setManager( value ) {

		this.manager = value;

	}

	setMaterials( materialsInfo ) {

		this.materialsInfo = this.convert( materialsInfo );
		this.materials = {};
		this.materialsArray = [];
		this.nameLookup = {};

	}

	convert( materialsInfo ) {

		if ( ! this.options ) return materialsInfo;
		const converted = {};

		for ( const name in materialsInfo ) {

			const source = materialsInfo[ name ], covmat = {};
			converted[ name ] = covmat;

			for ( const key in source ) {

				let value = source[ key ];

				if ( key === 'kd' || key === 'ka' || key === 'ks' ) {

					if ( this.options.normalizeRGB ) value = [ value[ 0 ] / 255, value[ 1 ] / 255, value[ 2 ] / 255 ];
					if ( this.options.ignoreZeroRGBs && value[ 0 ] === 0 && value[ 1 ] === 0 && value[ 2 ] === 0 ) continue;

				}

				covmat[ key ] = value;

			}

		}

		return converted;

	}

	preload() {

		for ( const name in this.materialsInfo ) this.create( name );

	}

	getIndex( materialName ) {

		return this.nameLookup[ materialName ];

	}

	getAsArray() {

		let index = 0;

		for ( const name in this.materialsInfo ) {

			this.materialsArray[ index ] = this.create( name );
			this.nameLookup[ name ] = index;
			index ++;

		}

		return this.materialsArray;

	}

	create( materialName ) {

		if ( this.materials[ materialName ] === undefined ) this.createMaterial_( materialName );
		return this.materials[ materialName ];

	}

	createMaterial_( materialName ) {

		const mat = this.materialsInfo[ materialName ];
		const params = { name: materialName, side: this.side };
		const resolve = ( url ) => ( typeof url !== 'string' || url === '' ? '' : /^https?:\/\//i.test( url ) ? url : this.baseUrl + url );

		const setMap = ( mapType, value ) => {

			if ( params[ mapType ] ) return;
			const texParams = this.getTextureParams( value, params );
			const map = this.loadTexture( resolve( texParams.url ) );
			map.repeat.copy( texParams.scale );
			map.offset.copy( texParams.offset );
			map.wrapS = this.wrap;
			map.wrapT = this.wrap;
			if ( mapType === 'map' || mapType === 'emissiveMap' ) map.colorSpace = SRGBColorSpace;
			params[ mapType ] = map;

		};

		for ( const prop in mat ) {

			const value = mat[ prop ];
			if ( value === '' ) continue;

			switch ( prop.toLowerCase() ) {

				case 'kd':
					params.color = ColorManagement.toWorkingColorSpace( new Color().fromArray( value ), SRGBColorSpace );
					break;

				case 'ks':
					params.specular = ColorManagement.toWorkingColorSpace( new Color().fromArray( value ), SRGBColorSpace );
					break;

				case 'ke':
					params.emissive = ColorManagement.toWorkingColorSpace( new Color().fromArray( value ), SRGBColorSpace );
					break;

				case 'map_kd':
					setMap( 'map', value );
					break;

				case 'map_ks':
					setMap( 'specularMap', value );
					break;

				case 'map_ke':
					setMap( 'emissiveMap', value );
					break;

				case 'norm':
					setMap( 'normalMap', value );
					break;

				case 'map_bump':
				case 'bump':
					setMap( 'bumpMap', value );
					break;

				case 'disp':
					setMap( 'displacementMap', value );
					break;

				case 'map_d':
					setMap( 'alphaMap', value );
					params.transparent = true;
					break;

				case 'ns':
					params.shininess = parseFloat( value );
					break;

				case 'd': {

					const n = parseFloat( value );

					if ( n < 1 ) {

						params.opacity = n;
						params.transparent = true;

					}

					break;

				}

				case 'tr': {

					let n = parseFloat( value );
					if ( this.options?.invertTrProperty ) n = 1 - n;

					if ( n > 0 ) {

						params.opacity = 1 - n;
						params.transparent = true;

					}

					break;

				}

				default:
					break;

			}

		}

		this.materials[ materialName ] = new MeshPhongMaterial( params );
		return this.materials[ materialName ];

	}

	// A map statement's options (`-bm` bump scale, `-s` scale, `-o` offset) and its file.
	getTextureParams( value, matParams ) {

		const texParams = { scale: new Vector2( 1, 1 ), offset: new Vector2( 0, 0 ) };
		const items = value.split( /\s+/ );
		let pos = items.indexOf( '-bm' );

		if ( pos >= 0 ) {

			matParams.bumpScale = parseFloat( items[ pos + 1 ] );
			items.splice( pos, 2 );

		}

		pos = items.indexOf( '-s' );

		if ( pos >= 0 ) {

			texParams.scale.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
			items.splice( pos, 4 );

		}

		pos = items.indexOf( '-o' );

		if ( pos >= 0 ) {

			texParams.offset.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
			items.splice( pos, 4 );

		}

		texParams.url = items.join( ' ' ).trim();
		return texParams;

	}

	loadTexture( url, mapping, onLoad, onProgress, onError ) {

		const manager = this.manager ?? DefaultLoadingManager;
		const loader = manager.getHandler?.( url ) ?? new TextureLoader( manager );
		if ( loader.setCrossOrigin ) loader.setCrossOrigin( this.crossOrigin );
		const texture = loader.load( url, onLoad, onProgress, onError );
		if ( mapping !== undefined ) texture.mapping = mapping;
		return texture;

	}

}
