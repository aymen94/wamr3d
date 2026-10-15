// Materials, and the environment map a frame is lit by.

import { FrontSide } from './constants.js';
import { MATERIAL, finalizer, ignored, lazyUUID, w } from './engine.js';
import { Color, Euler, Vector2 } from './math.js';

const MATERIAL_KEYS = new Set( [ 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'color', 'side', 'name', 'map', 'userData', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'vertexColors', 'alphaTest' ] );
const EMISSIVE_KEYS = [ 'emissive', 'emissiveIntensity' ];
const ENVIRONMENT_KEYS = [ 'envMap', 'envMapIntensity', 'envMapRotation' ];
// The texture maps beside `map`, in the engine's order, and their settings.
const MAP_KEYS = [ 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap' ];
const MAP_SETTING_KEYS = [ 'normalScale', 'aoMapIntensity' ];
// Properties `copy` carries over when the source has them, besides the common ones.
const COPIED_KEYS = [ 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'roughness', 'metalness', 'specular', 'shininess', 'alphaTest', ...EMISSIVE_KEYS, ...ENVIRONMENT_KEYS, ...MAP_KEYS, ...MAP_SETTING_KEYS ];

// Gives a material the maps of its class, with three.js's defaults.
function withMaps( material, maps ) {

	for ( const name of maps ) material[ name ] = null;
	if ( maps.includes( 'normalMap' ) ) material.normalScale = new Vector2( 1, 1 );
	if ( maps.includes( 'aoMap' ) ) material.aoMapIntensity = 1;

}

// The keys a class accepts for its maps.
const mapKeys = ( maps ) => [ ...maps, ...( maps.includes( 'normalMap' ) ? [ 'normalScale' ] : [] ), ...( maps.includes( 'aoMap' ) ? [ 'aoMapIntensity' ] : [] ) ];
const LIT_MAPS = [ 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap' ];

export class Material {

	constructor( parameters ) {

		this.handle = w().createMaterial( '' );
		this.type = 'Material';
		this.name = '';
		this.color = new Color( 0xffffff );
		this.map = null;
		this.transparent = false;
		this.opacity = 1;
		this.depthTest = true;
		this.depthWrite = true;
		this.vertexColors = false;
		this.toneMapped = true;
		this.alphaTest = 0;
		this.userData = {};
		this._side = FrontSide;
		this._sent = new Array( 39 ).fill( NaN );
		finalizer.register( this, { kind: MATERIAL, handle: this.handle }, this );
		if ( parameters ) this.setValues( parameters );

	}

	get side() {

		return this._side;

	}

	set side( value ) {

		w().setMaterialSide( this.handle, this._side = value );

	}

	setValues( parameters ) {

		for ( const [ key, value ] of Object.entries( parameters ) ) {

			if ( value === undefined ) continue;
			if ( ! MATERIAL_KEYS.has( key ) && ! this._keys.has( key ) ) ignored( `${this.constructor.name}.${key}` );
			const current = this[ key ];
			if ( current && current.isColor ) current.set( value );
			else if ( current && current.isVector2 && value && value.isVector2 ) current.copy( value );
			else if ( current && current.isEuler && value && value.isEuler ) current.copy( value );
			else this[ key ] = value;

		}

	}

	// Colours, numbers and maps are plain values that can change at any time, so they are
	// sent when drawing. `environment` is the renderer's choice of environment map for
	// the frame.
	_sync( environment ) {

		const { r, g, b } = this.color, sent = this._sent;
		if ( r !== sent[ 0 ] || g !== sent[ 1 ] || b !== sent[ 2 ] ) w().setMaterialColor( this.handle, sent[ 0 ] = r, sent[ 1 ] = g, sent[ 2 ] = b );

		const roughness = this.roughness ?? 1, metalness = this.metalness ?? 0;
		if ( roughness !== sent[ 3 ] || metalness !== sent[ 4 ] ) w().setMaterialShading( this.handle, this._shading, sent[ 3 ] = roughness, sent[ 4 ] = metalness );

		const map = this.map ? this.map.id : 0;
		if ( map !== sent[ 5 ] ) w().setMaterialMap( this.handle, sent[ 5 ] = map );

		const { transparent, opacity, depthTest, depthWrite, vertexColors } = this;

		if ( transparent !== sent[ 6 ] || opacity !== sent[ 7 ] || depthTest !== sent[ 8 ] || depthWrite !== sent[ 9 ] || vertexColors !== sent[ 10 ] ) {

			w().setMaterialState( this.handle, sent[ 6 ] = transparent, sent[ 7 ] = opacity, sent[ 8 ] = depthTest, sent[ 9 ] = depthWrite, sent[ 10 ] = vertexColors );

		}

		const spriteRotation = this.rotation ?? 0, sizeAttenuation = this.sizeAttenuation ?? true;
		if ( spriteRotation !== sent[ 18 ] || sizeAttenuation !== sent[ 19 ] ) w().setMaterialSprite( this.handle, sent[ 18 ] = spriteRotation, sent[ 19 ] = sizeAttenuation );

		// All maps share one uv transform: the colour map's, else the first other map's.
		const uvSource = this.map ?? this.normalMap ?? this.roughnessMap ?? this.metalnessMap ?? this.emissiveMap ?? this.alphaMap ?? this.aoMap;

		if ( uvSource ) {

			const { offset, repeat, center, rotation } = uvSource;
			const ox = offset.x, oy = offset.y, rx = repeat.x, ry = repeat.y, cx = center.x, cy = center.y;

			if ( ox !== sent[ 11 ] || oy !== sent[ 12 ] || rx !== sent[ 13 ] || ry !== sent[ 14 ] || rotation !== sent[ 15 ] || cx !== sent[ 16 ] || cy !== sent[ 17 ] ) {

				w().setMaterialMapTransform( this.handle, sent[ 11 ] = ox, sent[ 12 ] = oy, sent[ 13 ] = rx, sent[ 14 ] = ry, sent[ 15 ] = rotation, sent[ 16 ] = cx, sent[ 17 ] = cy );

			}

		}

		const normal = this.normalMap?.id ?? 0, rough = this.roughnessMap?.id ?? 0, metal = this.metalnessMap?.id ?? 0, glow = this.emissiveMap?.id ?? 0, mask = this.alphaMap?.id ?? 0, shade = this.aoMap?.id ?? 0;

		if ( normal !== sent[ 29 ] || rough !== sent[ 30 ] || metal !== sent[ 31 ] || glow !== sent[ 32 ] || mask !== sent[ 33 ] || shade !== sent[ 34 ] ) {

			w().setMaterialMaps( this.handle, sent[ 29 ] = normal, sent[ 30 ] = rough, sent[ 31 ] = metal, sent[ 32 ] = glow, sent[ 33 ] = mask, sent[ 34 ] = shade );

		}

		const scale = normal !== 0 ? this.normalScale : null, sx = scale ? scale.x : 1, sy = scale ? scale.y : 1, ao = this.aoMapIntensity ?? 1, alphaTest = this.alphaTest;
		if ( sx !== sent[ 35 ] || sy !== sent[ 36 ] || ao !== sent[ 37 ] || alphaTest !== sent[ 38 ] ) w().setMaterialMapSettings( this.handle, sent[ 35 ] = sx, sent[ 36 ] = sy, sent[ 37 ] = ao, sent[ 38 ] = alphaTest );

		const emissive = this.emissive;

		if ( emissive !== undefined ) {

			const k = this.emissiveIntensity, er = emissive.r * k, eg = emissive.g * k, eb = emissive.b * k;
			if ( er !== sent[ 20 ] || eg !== sent[ 21 ] || eb !== sent[ 22 ] ) w().setMaterialEmissive( this.handle, sent[ 20 ] = er, sent[ 21 ] = eg, sent[ 22 ] = eb );

		}

		const specular = this.specular;

		if ( specular !== undefined ) {

			const sr = specular.r, sg = specular.g, sb = specular.b, shininess = this.shininess;
			if ( sr !== sent[ 23 ] || sg !== sent[ 24 ] || sb !== sent[ 25 ] || shininess !== sent[ 26 ] ) w().setMaterialSpecular( this.handle, sent[ 23 ] = sr, sent[ 24 ] = sg, sent[ 25 ] = sb, sent[ 26 ] = shininess );

		}

		if ( this._shading === 2 ) {

			const intensity = environment.intensityFor( this ), uses = intensity >= 0;
			if ( uses !== sent[ 27 ] || ( uses && intensity !== sent[ 28 ] ) ) w().setMaterialEnvironment( this.handle, sent[ 27 ] = uses, sent[ 28 ] = uses ? intensity : 1 );

		}

	}

	copy( source ) {

		this.name = source.name;
		this.color.copy( source.color );
		this.side = source.side;
		this.map = source.map;
		this.transparent = source.transparent;
		this.opacity = source.opacity;
		this.depthTest = source.depthTest;
		this.depthWrite = source.depthWrite;
		this.vertexColors = source.vertexColors;
		this.userData = JSON.parse( JSON.stringify( source.userData ) );

		for ( const key of COPIED_KEYS ) {

			const value = source[ key ];
			if ( value === undefined ) continue;
			if ( value !== null && ( value.isColor || value.isEuler || value.isVector2 ) && this[ key ] ) this[ key ].copy( value );
			else this[ key ] = value;

		}

		return this;

	}

	clone() {

		return new this.constructor().copy( this );

	}

	dispose() {

		finalizer.unregister( this );
		w().disposeMaterial( this.handle );

	}

}

Material.prototype.isMaterial = true;
Material.prototype._shading = 0;
Material.prototype._keys = new Set();
lazyUUID( Material );

/** Shows its colour (and map) as is, without lighting. */
export class MeshBasicMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshBasicMaterial';
		withMaps( this, [ 'alphaMap', 'aoMap' ] );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshBasicMaterial.prototype._shading = 1;
MeshBasicMaterial.prototype._keys = new Set( mapKeys( [ 'alphaMap', 'aoMap' ] ) );
MeshBasicMaterial.prototype.isMeshBasicMaterial = true;

/** For `Line`, `LineSegments` and `LineLoop`: the colour as is, without lighting. */
export class LineBasicMaterial extends Material {

	constructor( parameters ) {

		super( parameters );
		this.type = 'LineBasicMaterial';

	}

}

LineBasicMaterial.prototype._shading = 1;
LineBasicMaterial.prototype.isLineBasicMaterial = true;

/**
 * For `Points`: the colour (and vertex colours) as is, without lighting. `size` and
 * `sizeAttenuation` are kept but have no effect: points are one pixel, as with the
 * three.js WebGPU renderer. `map` is not supported on points.
 */
export class PointsMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'PointsMaterial';
		this.size = 1;
		this.sizeAttenuation = true;
		if ( parameters ) this.setValues( parameters );

	}

}

PointsMaterial.prototype._shading = 1;
PointsMaterial.prototype.isPointsMaterial = true;

/** For `Sprite`: colour and map without lighting, `rotation` in radians, transparent by default. */
export class SpriteMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'SpriteMaterial';
		this.transparent = true;
		this.rotation = 0;
		this.sizeAttenuation = true;
		withMaps( this, [ 'alphaMap' ] );
		if ( parameters ) this.setValues( parameters );

	}

}

SpriteMaterial.prototype._shading = 1;
SpriteMaterial.prototype._keys = new Set( [ 'alphaMap' ] );
SpriteMaterial.prototype.isSpriteMaterial = true;

/** Diffuse (Lambert) lighting, plus `emissive` light. */
export class MeshLambertMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshLambertMaterial';
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		withMaps( this, this._maps );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshLambertMaterial.prototype._maps = LIT_MAPS;
MeshLambertMaterial.prototype._keys = new Set( [ ...EMISSIVE_KEYS, ...mapKeys( LIT_MAPS ) ] );
MeshLambertMaterial.prototype.isMeshLambertMaterial = true;

/** Diffuse lighting plus a Blinn-Phong highlight (`specular`, `shininess`), and `emissive` light. */
export class MeshPhongMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshPhongMaterial';
		this.specular = new Color( 0x111111 );
		this.shininess = 30;
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		withMaps( this, this._maps );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshPhongMaterial.prototype._shading = 3;
MeshPhongMaterial.prototype._maps = LIT_MAPS;
MeshPhongMaterial.prototype._keys = new Set( [ 'specular', 'shininess', ...EMISSIVE_KEYS, ...mapKeys( LIT_MAPS ) ] );
MeshPhongMaterial.prototype.isMeshPhongMaterial = true;

/** Diffuse lighting in two tones (the default without `gradientMap`), and `emissive` light. */
export class MeshToonMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshToonMaterial';
		this.gradientMap = null;
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		withMaps( this, this._maps );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshToonMaterial.prototype._shading = 5;
MeshToonMaterial.prototype._maps = LIT_MAPS;
MeshToonMaterial.prototype._keys = new Set( [ ...EMISSIVE_KEYS, ...mapKeys( LIT_MAPS ) ] );
MeshToonMaterial.prototype.isMeshToonMaterial = true;

/** The surface normal in view space as a colour; no lights, colour or fog. */
export class MeshNormalMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshNormalMaterial';
		withMaps( this, [ 'normalMap' ] );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshNormalMaterial.prototype._shading = 4;
MeshNormalMaterial.prototype._keys = new Set( mapKeys( [ 'normalMap' ] ) );
MeshNormalMaterial.prototype.isMeshNormalMaterial = true;

/**
 * Physically based: diffuse plus a specular highlight from `roughness` and `metalness`,
 * `emissive` light, and reflections of `envMap` or `scene.environment` (an
 * equirectangular texture). Other maps are not supported.
 */
export class MeshStandardMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshStandardMaterial';
		this.roughness = 1;
		this.metalness = 0;
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		this.envMap = null;
		this.envMapIntensity = 1;
		this.envMapRotation = new Euler();
		withMaps( this, MAP_KEYS );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshStandardMaterial.prototype._shading = 2;
MeshStandardMaterial.prototype._maps = MAP_KEYS;
MeshStandardMaterial.prototype._keys = new Set( [ 'roughness', 'metalness', ...EMISSIVE_KEYS, ...ENVIRONMENT_KEYS, ...mapKeys( MAP_KEYS ) ] );
MeshStandardMaterial.prototype.isMeshStandardMaterial = true;

const PHYSICAL_KEYS = [ 'clearcoat', 'clearcoatRoughness', 'ior', 'reflectivity', 'sheen', 'sheenColor', 'sheenRoughness', 'transmission', 'thickness', 'attenuationColor', 'attenuationDistance', 'iridescence', 'iridescenceIOR', 'specularIntensity', 'specularColor', 'dispersion', 'anisotropy', 'anisotropyRotation' ];

/**
 * Drawn as `MeshStandardMaterial`. The physical extensions (clearcoat, sheen,
 * transmission, iridescence, anisotropy, dispersion, and an `ior` or specular layer other
 * than the defaults) are kept but not drawn; using them logs one warning.
 */
export class MeshPhysicalMaterial extends MeshStandardMaterial {

	constructor( parameters ) {

		super();
		this.type = 'MeshPhysicalMaterial';
		this.clearcoat = 0;
		this.clearcoatRoughness = 0;
		this.ior = 1.5;
		this.sheen = 0;
		this.sheenColor = new Color( 0x000000 );
		this.sheenRoughness = 1;
		this.transmission = 0;
		this.thickness = 0;
		this.attenuationColor = new Color( 1, 1, 1 );
		this.attenuationDistance = Infinity;
		this.iridescence = 0;
		this.iridescenceIOR = 1.3;
		this.specularIntensity = 1;
		this.specularColor = new Color( 1, 1, 1 );
		this.dispersion = 0;
		this.anisotropy = 0;
		this.anisotropyRotation = 0;
		if ( parameters ) this.setValues( parameters );

	}

	// three.js derives `reflectivity` from `ior`.
	get reflectivity() {

		return Math.min( Math.max( 2.5 * ( this.ior - 1 ) / ( this.ior + 1 ), 0 ), 1 );

	}

	set reflectivity( value ) {

		this.ior = ( 1 + 0.4 * value ) / ( 1 - 0.4 * value );

	}

	copy( source ) {

		super.copy( source );
		for ( const key of PHYSICAL_KEYS ) {

			const value = source[ key ];
			if ( key === 'reflectivity' || value === undefined ) continue;
			if ( value !== null && value.isColor ) this[ key ].copy( value );
			else this[ key ] = value;

		}

		return this;

	}

	_sync( environment ) {

		const s = this.specularColor;
		if ( this.clearcoat > 0 || this.sheen > 0 || this.transmission > 0 || this.iridescence > 0 || this.anisotropy !== 0 || this.dispersion > 0 || this.ior !== 1.5 || this.specularIntensity !== 1 || s.r !== 1 || s.g !== 1 || s.b !== 1 ) {

			ignored( 'MeshPhysicalMaterial clearcoat, sheen, transmission, iridescence, anisotropy, dispersion, ior and specular layer' );

		}

		super._sync( environment );

	}

}

MeshPhysicalMaterial.prototype._keys = new Set( [ ...MeshStandardMaterial.prototype._keys, ...PHYSICAL_KEYS ] );
MeshPhysicalMaterial.prototype.isMeshPhysicalMaterial = true;

// The environment map a frame is lit by. As in three.js, a standard material uses its
// own `envMap`, or else `scene.environment`; one map is drawn per frame, the scene's or
// else the first material's, with that one's rotation.
export class FrameEnvironment {

	constructor() {

		this.scene = null;
		this.sceneIntensity = 1;
		this.texture = null;
		this.rotation = null;

	}

	begin( scene ) {

		const environment = scene.environment ?? null;
		this.scene = environment !== null && environment.isTexture ? environment : null;
		if ( environment !== null && this.scene === null ) ignored( 'a scene environment that is not a Texture' );
		this.sceneIntensity = scene.environmentIntensity ?? 1;
		this.texture = this.scene !== null && environmentReady( this.scene ) ? this.scene : null;
		this.rotation = this.texture !== null ? scene.environmentRotation : null;

	}

	// The intensity `material` is lit by the frame's map with, or -1 when it is not lit.
	intensityFor( material ) {

		const own = material.envMap ?? null, map = own ?? this.scene;
		if ( map === null || ! environmentReady( map ) ) return - 1;

		if ( this.texture === null ) {

			this.texture = map;
			this.rotation = material.envMapRotation;

		}

		if ( map !== this.texture ) {

			ignored( 'more than one environment map in a frame (the first is used)' );
			return - 1;

		}

		return own !== null ? material.envMapIntensity : this.sceneIntensity;

	}

}

// An environment or background can be drawn once its image has arrived.
export function environmentReady( texture ) {

	if ( texture.isRenderTargetTexture ) {

		ignored( 'a render target texture as environment map or scene background' );
		return false;

	}

	const image = texture.image;
	return image !== null && image !== undefined && ( image.data !== undefined || image.width > 0 );

}
