// Images, textures and materials, with the PBR material extensions.
//
// Part of the GLTFLoader add-on (`../GLTFLoader.js`).

import { Color, DoubleSide, LoaderUtils, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Texture, Vector2, SRGBColorSpace, LinearSRGBColorSpace, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from '../../../compat.js';
import { FILTERS, WRAPPINGS } from './common.js';

/** Methods of `GLTFParser`, copied onto its prototype. */
export class GLTFMaterials {

	// ---------------------------------------------------------------- textures and materials

	async loadImage( index ) {

		return this.cached( 'image:' + index, async () => {

			const definition = this.json.images[ index ];
			let url, revoke = false;

			if ( definition.bufferView !== undefined ) {

				const view = await this.getDependency( 'bufferView', definition.bufferView );
				url = URL.createObjectURL( new Blob( [ view ], { type: definition.mimeType } ) );
				revoke = true;

			} else {

				url = LoaderUtils.resolveURL( definition.uri, this.options.path );

			}

			try {

				return await new Promise( ( resolve, reject ) => this.textureLoader.load( url, resolve, undefined, reject ) );

			} finally {

				if ( revoke ) URL.revokeObjectURL( url );

			}

		} );

	}

	async loadKTX2( index ) {

		return this.cached( 'ktx2:' + index, async () => {

			const definition = this.json.images[ index ];
			const buffer = definition.bufferView !== undefined ? await this.getDependency( 'bufferView', definition.bufferView ) : await ( await fetch( LoaderUtils.resolveURL( definition.uri, this.options.path ), { headers: this.options.requestHeader } ) ).arrayBuffer();
			return new Promise( ( resolve, reject ) => this.options.ktx2Loader.parse( buffer, resolve, reject ) );

		} ).then( ( base ) => {

			// textures sharing an image share its pixels, each with its own sampler settings
			const texture = new base.constructor( base.image.data, base.image.width, base.image.height, base.format, base.type );
			for ( const key of [ 'colorSpace', 'generateMipmaps', 'magFilter', 'minFilter' ] ) texture[ key ] = base[ key ];
			texture.needsUpdate = true;
			return texture;

		} );

	}

	async loadTexture( index ) {

		const definition = this.json.textures[ index ], extensions = definition.extensions ?? {};
		let texture = null, source = definition.source;

		if ( extensions.KHR_texture_basisu ) {

			if ( ! this.options.ktx2Loader ) {

				if ( source === undefined ) throw new Error( 'WAMR3D: GLTFLoader: KHR_texture_basisu needs setKTX2Loader().' );

			} else {

				source = extensions.KHR_texture_basisu.source;
				texture = await this.loadKTX2( source );

			}

		}

		if ( texture === null ) {

			// WebP and AVIF are decoded by the browser; a failed decode falls back to the core image
			const modern = extensions.EXT_texture_avif?.source ?? extensions.EXT_texture_webp?.source;
			let image = null;

			if ( modern !== undefined ) {

				try {

					image = await this.loadImage( modern );
					source = modern;

				} catch ( error ) {

					if ( definition.source === undefined ) throw error;

				}

			}

			if ( source === undefined ) return null;
			if ( image === null ) image = await this.loadImage( source );
			texture = new Texture( image );

		}

		texture.flipY = false;
		texture.name = definition.name || this.json.images[ source ].name || '';
		const sampler = this.json.samplers?.[ definition.sampler ] ?? {};
		texture.magFilter = FILTERS[ sampler.magFilter ] ?? LinearFilter;
		texture.minFilter = FILTERS[ sampler.minFilter ] ?? LinearMipmapLinearFilter;
		texture.wrapS = WRAPPINGS[ sampler.wrapS ] ?? RepeatWrapping;
		texture.wrapT = WRAPPINGS[ sampler.wrapT ] ?? RepeatWrapping;
		texture.anisotropy = 4;
		texture.needsUpdate = true;
		this.associations.set( texture, { textures: index } );
		return texture;

	}

	// A texture for a material slot: a copy when the slot has its own uv set, transform or
	// colour space, as three.js's loader makes.
	async assignTexture( params, name, info, colorSpace ) {

		if ( ! info ) return;
		const base = await this.getDependency( 'texture', info.index );
		if ( ! base ) return;
		let texture = base;
		const transform = info.extensions?.KHR_texture_transform;
		const channel = transform?.texCoord ?? info.texCoord ?? 0;

		if ( transform || channel !== 0 || ( colorSpace && base.colorSpace !== colorSpace && base._assigned ) ) {

			texture = new Texture( base.image );
			for ( const key of [ 'flipY', 'magFilter', 'minFilter', 'wrapS', 'wrapT', 'anisotropy', 'name', 'type', 'generateMipmaps' ] ) texture[ key ] = base[ key ];
			texture.needsUpdate = true;

		}

		texture._assigned = true;
		texture.channel = channel;
		if ( colorSpace ) texture.colorSpace = colorSpace;

		if ( transform ) {

			if ( transform.offset ) texture.offset.fromArray( transform.offset );
			if ( transform.rotation !== undefined ) texture.rotation = transform.rotation;
			if ( transform.scale ) texture.repeat.fromArray( transform.scale );

		}

		params[ name ] = texture;

	}

	async loadMaterial( index ) {

		const definition = this.json.materials[ index ], extensions = definition.extensions ?? {};
		const params = {}, pending = [];

		if ( extensions.KHR_materials_unlit ) {

			const pbr = definition.pbrMetallicRoughness ?? {};
			params.color = new Color( 1, 1, 1 );
			params.opacity = 1;

			if ( Array.isArray( pbr.baseColorFactor ) ) {

				params.color.setRGB( pbr.baseColorFactor[ 0 ], pbr.baseColorFactor[ 1 ], pbr.baseColorFactor[ 2 ], LinearSRGBColorSpace );
				params.opacity = pbr.baseColorFactor[ 3 ];

			}

			pending.push( this.assignTexture( params, 'map', pbr.baseColorTexture, SRGBColorSpace ) );

		} else {

			const pbr = definition.pbrMetallicRoughness ?? {};
			params.color = new Color( 1, 1, 1 );
			params.opacity = 1;

			if ( Array.isArray( pbr.baseColorFactor ) ) {

				params.color.setRGB( pbr.baseColorFactor[ 0 ], pbr.baseColorFactor[ 1 ], pbr.baseColorFactor[ 2 ], LinearSRGBColorSpace );
				params.opacity = pbr.baseColorFactor[ 3 ];

			}

			params.metalness = pbr.metallicFactor ?? 1.0;
			params.roughness = pbr.roughnessFactor ?? 1.0;
			pending.push( this.assignTexture( params, 'map', pbr.baseColorTexture, SRGBColorSpace ) );
			pending.push( this.assignTexture( params, 'metalnessMap', pbr.metallicRoughnessTexture ) );
			pending.push( this.assignTexture( params, 'roughnessMap', pbr.metallicRoughnessTexture ) );
			this.physicalExtensions( extensions, params, pending );

		}

		if ( definition.doubleSided === true ) params.side = DoubleSide;
		const alphaMode = definition.alphaMode ?? 'OPAQUE';

		if ( alphaMode === 'BLEND' ) {

			params.transparent = true;
			params.depthWrite = false;

		} else {

			params.transparent = false;
			if ( alphaMode === 'MASK' ) params.alphaTest = definition.alphaCutoff ?? 0.5;

		}

		if ( definition.normalTexture !== undefined && ! extensions.KHR_materials_unlit ) {

			pending.push( this.assignTexture( params, 'normalMap', definition.normalTexture ) );
			const scale = definition.normalTexture.scale ?? 1;
			params.normalScale = new Vector2( scale, scale );

		}

		if ( definition.occlusionTexture !== undefined && ! extensions.KHR_materials_unlit ) {

			pending.push( this.assignTexture( params, 'aoMap', definition.occlusionTexture ) );
			if ( definition.occlusionTexture.strength !== undefined ) params.aoMapIntensity = definition.occlusionTexture.strength;

		}

		if ( definition.emissiveFactor !== undefined && ! extensions.KHR_materials_unlit ) {

			params.emissive = new Color().setRGB( definition.emissiveFactor[ 0 ], definition.emissiveFactor[ 1 ], definition.emissiveFactor[ 2 ], LinearSRGBColorSpace );

		}

		if ( definition.emissiveTexture !== undefined && ! extensions.KHR_materials_unlit ) pending.push( this.assignTexture( params, 'emissiveMap', definition.emissiveTexture, SRGBColorSpace ) );
		if ( extensions.KHR_materials_emissive_strength?.emissiveStrength !== undefined ) params.emissiveIntensity = extensions.KHR_materials_emissive_strength.emissiveStrength;
		await Promise.all( pending );

		const physical = [ 'KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion' ].some( ( name ) => extensions[ name ] );
		const Type = extensions.KHR_materials_unlit ? MeshBasicMaterial : physical ? MeshPhysicalMaterial : MeshStandardMaterial;
		const material = new Type();
		const { color, emissive, normalScale, ...rest } = params;
		material.setValues( rest );
		if ( color ) material.color.copy( color );
		if ( emissive && material.emissive ) material.emissive.copy( emissive );
		if ( normalScale && material.normalScale ) material.normalScale.copy( normalScale );
		material.name = definition.name || '';
		if ( definition.extras ) material.userData = definition.extras;
		this.associations.set( material, { materials: index } );
		return material;

	}

	physicalExtensions( extensions, params, pending ) {

		const e = extensions;

		if ( e.KHR_materials_clearcoat ) {

			const x = e.KHR_materials_clearcoat;
			params.clearcoat = x.clearcoatFactor ?? 0;
			params.clearcoatRoughness = x.clearcoatRoughnessFactor ?? 0;
			pending.push( this.assignTexture( params, 'clearcoatMap', x.clearcoatTexture ) );
			pending.push( this.assignTexture( params, 'clearcoatRoughnessMap', x.clearcoatRoughnessTexture ) );

			if ( x.clearcoatNormalTexture ) {

				pending.push( this.assignTexture( params, 'clearcoatNormalMap', x.clearcoatNormalTexture ) );
				const scale = x.clearcoatNormalTexture.scale ?? 1;
				params.clearcoatNormalScale = new Vector2( scale, scale );

			}

		}

		if ( e.KHR_materials_sheen ) {

			const x = e.KHR_materials_sheen;
			params.sheen = 1;
			params.sheenColor = x.sheenColorFactor ? new Color().setRGB( x.sheenColorFactor[ 0 ], x.sheenColorFactor[ 1 ], x.sheenColorFactor[ 2 ], LinearSRGBColorSpace ) : new Color( 0, 0, 0 );
			params.sheenRoughness = x.sheenRoughnessFactor ?? 0;
			pending.push( this.assignTexture( params, 'sheenColorMap', x.sheenColorTexture, SRGBColorSpace ) );
			pending.push( this.assignTexture( params, 'sheenRoughnessMap', x.sheenRoughnessTexture ) );

		}

		if ( e.KHR_materials_transmission ) {

			const x = e.KHR_materials_transmission;
			params.transmission = x.transmissionFactor ?? 0;
			pending.push( this.assignTexture( params, 'transmissionMap', x.transmissionTexture ) );

		}

		if ( e.KHR_materials_volume ) {

			const x = e.KHR_materials_volume;
			params.thickness = x.thicknessFactor ?? 0;
			params.attenuationDistance = x.attenuationDistance ?? Infinity;
			const c = x.attenuationColor ?? [ 1, 1, 1 ];
			params.attenuationColor = new Color().setRGB( c[ 0 ], c[ 1 ], c[ 2 ], LinearSRGBColorSpace );
			pending.push( this.assignTexture( params, 'thicknessMap', x.thicknessTexture ) );

		}

		if ( e.KHR_materials_ior ) params.ior = e.KHR_materials_ior.ior ?? 1.5;

		if ( e.KHR_materials_specular ) {

			const x = e.KHR_materials_specular;
			params.specularIntensity = x.specularFactor ?? 1.0;
			const c = x.specularColorFactor ?? [ 1, 1, 1 ];
			params.specularColor = new Color().setRGB( c[ 0 ], c[ 1 ], c[ 2 ], LinearSRGBColorSpace );
			pending.push( this.assignTexture( params, 'specularIntensityMap', x.specularTexture ) );
			pending.push( this.assignTexture( params, 'specularColorMap', x.specularColorTexture, SRGBColorSpace ) );

		}

		if ( e.KHR_materials_iridescence ) {

			const x = e.KHR_materials_iridescence;
			params.iridescence = x.iridescenceFactor ?? 0;
			params.iridescenceIOR = x.iridescenceIor ?? 1.3;
			params.iridescenceThicknessRange = [ x.iridescenceThicknessMinimum ?? 100, x.iridescenceThicknessMaximum ?? 400 ];
			pending.push( this.assignTexture( params, 'iridescenceMap', x.iridescenceTexture ) );
			pending.push( this.assignTexture( params, 'iridescenceThicknessMap', x.iridescenceThicknessTexture ) );

		}

		if ( e.KHR_materials_anisotropy ) {

			const x = e.KHR_materials_anisotropy;
			params.anisotropy = x.anisotropyStrength ?? 0;
			params.anisotropyRotation = x.anisotropyRotation ?? 0;
			pending.push( this.assignTexture( params, 'anisotropyMap', x.anisotropyTexture ) );

		}

		if ( e.KHR_materials_dispersion ) params.dispersion = e.KHR_materials_dispersion.dispersion ?? 0;

	}

}
