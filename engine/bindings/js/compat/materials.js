// Materials, and the environment map a frame is lit by.

import { FrontSide, NormalBlending } from './constants.js';
import { MATERIAL, finalizer, ignored, lazyUUID, w } from './engine.js';
import { Color, Euler, Matrix4, Vector2 } from './math.js';
import { withEvents } from './events.js';

const MATERIAL_KEYS = new Set( [ 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'color', 'side', 'name', 'map', 'userData', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'vertexColors', 'alphaTest', 'blending', 'premultipliedAlpha', 'linewidth', 'linecap', 'linejoin', 'dithering', 'shadowSide', 'visible', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits' ] );
const EMISSIVE_KEYS = [ 'emissive', 'emissiveIntensity' ];
const ENVIRONMENT_KEYS = [ 'envMap', 'envMapIntensity', 'envMapRotation' ];
// The texture maps beside `map` that materials have by class,
// and the settings that come with them, with three.js's defaults.
const MAP_KEYS = [ 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap' ];
const ALL_MAPS = [ 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap', 'specularMap', 'gradientMap' ];
const MAP_SETTINGS = {
	normalMap: { normalScale: () => new Vector2( 1, 1 ) },
	aoMap: { aoMapIntensity: () => 1 },
	lightMap: { lightMapIntensity: () => 1 },
	bumpMap: { bumpScale: () => 1 },
	displacementMap: { displacementScale: () => 1, displacementBias: () => 0 }
};
const MAP_SETTING_KEYS = Object.values( MAP_SETTINGS ).flatMap( ( settings ) => Object.keys( settings ) );
// Every map in the engine's map table order (`setMaterialMapTextures`, `setMaterialMapUv`).
const MAP_TABLE = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap', 'specularMap', 'gradientMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap' ];
const _rotation = new Matrix4();

// The inverse of an Euler rotation as a column-major 3x3 matrix (a rotation's inverse
// is its transpose).
export function inverseRotation( euler, out = new Float32Array( 9 ) ) {

	const e = _rotation.makeRotationFromEuler( euler ).elements;
	out[ 0 ] = e[ 0 ]; out[ 1 ] = e[ 4 ]; out[ 2 ] = e[ 8 ];
	out[ 3 ] = e[ 1 ]; out[ 4 ] = e[ 5 ]; out[ 5 ] = e[ 9 ];
	out[ 6 ] = e[ 2 ]; out[ 7 ] = e[ 6 ]; out[ 8 ] = e[ 10 ];
	return out;

}
// Properties `copy` carries over when the source has them, besides the common ones.
const COPIED_KEYS = [ 'blending', 'premultipliedAlpha', 'linewidth', 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'roughness', 'metalness', 'specular', 'shininess', 'alphaTest', 'wireframe', 'wireframeLinewidth', ...EMISSIVE_KEYS, ...ENVIRONMENT_KEYS, ...ALL_MAPS, ...MAP_SETTING_KEYS ];

// Gives a material the maps of its class, with three.js's defaults.
function withMaps( material, maps ) {

	for ( const name of maps ) {

		material[ name ] = null;
		for ( const [ key, initial ] of Object.entries( MAP_SETTINGS[ name ] ?? {} ) ) material[ key ] = initial();

	}

}

// The keys a class accepts for its maps.
const mapKeys = ( maps ) => maps.flatMap( ( name ) => [ name, ...Object.keys( MAP_SETTINGS[ name ] ?? {} ) ] );
const LIT_MAPS = [ 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap' ];
// Meshes draw their triangles' edges as lines; lines are always one pixel wide.
const WIREFRAME_KEYS = [ 'wireframe', 'wireframeLinewidth' ];

function withWireframe( material ) {

	material.wireframe = false;
	material.wireframeLinewidth = 1;

}

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
		this.blending = NormalBlending;
		this.premultipliedAlpha = false;
		this.userData = {};
		this._side = FrontSide;
		this._sent = new Array( 80 ).fill( NaN );
		// per map of the table: texture id, then offset, repeat, rotation, centre and uv set
		this._sentMaps = new Float64Array( MAP_TABLE.length * 9 ).fill( NaN );
		this._mapIds = new Uint32Array( MAP_TABLE.length );
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

		const { transparent, opacity, depthTest, depthWrite, vertexColors } = this;

		if ( transparent !== sent[ 6 ] || opacity !== sent[ 7 ] || depthTest !== sent[ 8 ] || depthWrite !== sent[ 9 ] || vertexColors !== sent[ 10 ] ) {

			w().setMaterialState( this.handle, sent[ 6 ] = transparent, sent[ 7 ] = opacity, sent[ 8 ] = depthTest, sent[ 9 ] = depthWrite, sent[ 10 ] = vertexColors );

		}

		const spriteRotation = this.rotation ?? 0, sizeAttenuation = this.sizeAttenuation ?? true;
		if ( spriteRotation !== sent[ 18 ] || sizeAttenuation !== sent[ 19 ] ) w().setMaterialSprite( this.handle, sent[ 18 ] = spriteRotation, sent[ 19 ] = sizeAttenuation );

		this._syncMaps();

		const scale = this.normalMap ? this.normalScale : null, sx = scale ? scale.x : 1, sy = scale ? scale.y : 1, ao = this.aoMapIntensity ?? 1, alphaTest = this.alphaTest;
		if ( sx !== sent[ 35 ] || sy !== sent[ 36 ] || ao !== sent[ 37 ] || alphaTest !== sent[ 38 ] ) w().setMaterialMapSettings( this.handle, sent[ 35 ] = sx, sent[ 36 ] = sy, sent[ 37 ] = ao, sent[ 38 ] = alphaTest );

		const blending = this.blending, premultiplied = this.premultipliedAlpha === true;
		if ( blending !== sent[ 60 ] || premultiplied !== sent[ 61 ] ) w().setMaterialBlending( this.handle, sent[ 60 ] = blending, sent[ 61 ] = premultiplied );
		const pointSize = this.isPointsMaterial ? this.size : 1, lineWidth = this.linewidth ?? 1;
		if ( pointSize !== sent[ 62 ] || lineWidth !== sent[ 63 ] ) w().setMaterialSizes( this.handle, sent[ 62 ] = pointSize, sent[ 63 ] = lineWidth );

		const lightIntensity = this.lightMapIntensity ?? 1, bumpScale = this.bumpScale ?? 1, displacementScale = this.displacementScale ?? 1, displacementBias = this.displacementBias ?? 0;

		if ( lightIntensity !== sent[ 44 ] || bumpScale !== sent[ 45 ] || displacementScale !== sent[ 46 ] || displacementBias !== sent[ 47 ] ) {

			w().setMaterialMapStrengths( this.handle, sent[ 44 ] = lightIntensity, sent[ 45 ] = bumpScale, sent[ 46 ] = displacementScale, sent[ 47 ] = displacementBias );

		}

		const wireframe = this.wireframe === true;
		if ( wireframe !== sent[ 48 ] ) w().setMaterialWireframe( this.handle, sent[ 48 ] = wireframe );
		if ( wireframe && this.wireframeLinewidth !== 1 ) ignored( 'wireframeLinewidth other than 1 (lines are one pixel wide)' );

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
			const own = uses && this.envMap && environmentReady( this.envMap ) ? this.envMap : null, id = own ? own.id : 0;
			const r = this.envMapRotation, width = own ? environmentWidth( own ) : 0;

			if ( id !== sent[ 64 ] || width !== sent[ 65 ] || ( own && ( r.x !== sent[ 66 ] || r.y !== sent[ 67 ] || r.z !== sent[ 68 ] || r.order !== sent[ 69 ] ) ) ) {

				w().setMaterialEnvMap( this.handle, sent[ 64 ] = id, sent[ 65 ] = width, inverseRotation( r ) );
				sent[ 66 ] = r.x;
				sent[ 67 ] = r.y;
				sent[ 68 ] = r.z;
				sent[ 69 ] = r.order;

			}

		}

	}

	// The textures of every map, and each one's uv transform and set (three.js
	// `texture.offset`, `repeat`, `rotation`, `center` and `channel`).
	_syncMaps() {

		const sentMaps = this._sentMaps, ids = this._mapIds;
		let changed = false;

		for ( let k = 0; k < MAP_TABLE.length; k ++ ) {

			const texture = this[ MAP_TABLE[ k ] ] ?? null, id = texture ? texture.id : 0, o = k * 9;

			if ( id !== sentMaps[ o ] ) {

				sentMaps[ o ] = ids[ k ] = id;
				changed = true;

			}

			if ( texture === null ) continue;
			const { offset, repeat, center, rotation } = texture, channel = texture.channel ?? 0;

			if ( offset.x !== sentMaps[ o + 1 ] || offset.y !== sentMaps[ o + 2 ] || repeat.x !== sentMaps[ o + 3 ] || repeat.y !== sentMaps[ o + 4 ] || rotation !== sentMaps[ o + 5 ] || center.x !== sentMaps[ o + 6 ] || center.y !== sentMaps[ o + 7 ] || channel !== sentMaps[ o + 8 ] ) {

				w().setMaterialMapUv( this.handle, k, sentMaps[ o + 1 ] = offset.x, sentMaps[ o + 2 ] = offset.y, sentMaps[ o + 3 ] = repeat.x, sentMaps[ o + 4 ] = repeat.y, sentMaps[ o + 5 ] = rotation, sentMaps[ o + 6 ] = center.x, sentMaps[ o + 7 ] = center.y, sentMaps[ o + 8 ] = channel );

			}

		}

		if ( changed ) w().setMaterialMapTextures( this.handle, 0, ids );

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
		this.dispatchEvent( { type: 'dispose' } );

	}

}

Material.prototype.isMaterial = true;
withEvents( Material );
Material.prototype._shading = 0;
Material.prototype._keys = new Set();
lazyUUID( Material );

const BASIC_MAPS = [ 'alphaMap', 'aoMap', 'lightMap' ];

/** Shows its colour (and map) as is, without lighting; a light map adds baked light. */
export class MeshBasicMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshBasicMaterial';
		withMaps( this, BASIC_MAPS );
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshBasicMaterial.prototype._shading = 1;
MeshBasicMaterial.prototype._keys = new Set( [ ...mapKeys( BASIC_MAPS ), ...WIREFRAME_KEYS ] );
MeshBasicMaterial.prototype.isMeshBasicMaterial = true;

/** For `Line`, `LineSegments` and `LineLoop`: the colour as is, without lighting. */
export class LineBasicMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'LineBasicMaterial';
		this.linewidth = 1;
		if ( parameters ) this.setValues( parameters );

	}

}

LineBasicMaterial.prototype._shading = 1;
LineBasicMaterial.prototype.isLineBasicMaterial = true;

/**
 * For `Points`: the colour (and vertex colours, `map` and `alphaMap`) as is, without
 * lighting. Points larger than one pixel are drawn as squares of `size` pixels (times the
 * pixel ratio, smaller with distance under `sizeAttenuation`), as three.js's
 * WebGLRenderer draws them.
 */
export class PointsMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'PointsMaterial';
		this.size = 1;
		this.sizeAttenuation = true;
		withMaps( this, [ 'alphaMap' ] );
		if ( parameters ) this.setValues( parameters );

	}

}

PointsMaterial.prototype._shading = 1;
PointsMaterial.prototype._keys = new Set( [ 'alphaMap' ] );
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
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshLambertMaterial.prototype._maps = LIT_MAPS;
MeshLambertMaterial.prototype._keys = new Set( [ ...EMISSIVE_KEYS, ...mapKeys( LIT_MAPS ), ...WIREFRAME_KEYS ] );
MeshLambertMaterial.prototype.isMeshLambertMaterial = true;

/** Diffuse lighting plus a Blinn-Phong highlight (`specular`, `shininess`, scaled by `specularMap`), and `emissive` light. */
export class MeshPhongMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshPhongMaterial';
		this.specular = new Color( 0x111111 );
		this.shininess = 30;
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		withMaps( this, this._maps );
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

const PHONG_MAPS = [ ...LIT_MAPS, 'specularMap' ];
MeshPhongMaterial.prototype._shading = 3;
MeshPhongMaterial.prototype._maps = PHONG_MAPS;
MeshPhongMaterial.prototype._keys = new Set( [ 'specular', 'shininess', ...EMISSIVE_KEYS, ...mapKeys( PHONG_MAPS ), ...WIREFRAME_KEYS ] );
MeshPhongMaterial.prototype.isMeshPhongMaterial = true;

/** Diffuse lighting in tones: two without a `gradientMap`, else its red channel along n.l. Plus `emissive` light. */
export class MeshToonMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshToonMaterial';
		this.emissive = new Color( 0x000000 );
		this.emissiveIntensity = 1;
		withMaps( this, this._maps );
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

const TOON_MAPS = [ ...LIT_MAPS, 'gradientMap' ];
MeshToonMaterial.prototype._shading = 5;
MeshToonMaterial.prototype._maps = TOON_MAPS;
MeshToonMaterial.prototype._keys = new Set( [ ...EMISSIVE_KEYS, ...mapKeys( TOON_MAPS ), ...WIREFRAME_KEYS ] );
MeshToonMaterial.prototype.isMeshToonMaterial = true;

const NORMAL_MAPS = [ 'normalMap', 'bumpMap', 'displacementMap' ];

/** The surface normal in view space as a colour; no lights, colour or fog. */
export class MeshNormalMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'MeshNormalMaterial';
		withMaps( this, NORMAL_MAPS );
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshNormalMaterial.prototype._shading = 4;
MeshNormalMaterial.prototype._keys = new Set( [ ...mapKeys( NORMAL_MAPS ), ...WIREFRAME_KEYS ] );
MeshNormalMaterial.prototype.isMeshNormalMaterial = true;

/**
 * Physically based: diffuse plus a specular highlight from `roughness` and `metalness`,
 * `emissive` light, and reflections of `envMap` or `scene.environment` (an
 * equirectangular texture).
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
		withWireframe( this );
		if ( parameters ) this.setValues( parameters );

	}

}

MeshStandardMaterial.prototype._shading = 2;
MeshStandardMaterial.prototype._maps = MAP_KEYS;
MeshStandardMaterial.prototype._keys = new Set( [ 'roughness', 'metalness', ...EMISSIVE_KEYS, ...ENVIRONMENT_KEYS, ...mapKeys( MAP_KEYS ), ...WIREFRAME_KEYS ] );
MeshStandardMaterial.prototype.isMeshStandardMaterial = true;

const PHYSICAL_KEYS = [ 'clearcoat', 'clearcoatRoughness', 'ior', 'reflectivity', 'sheen', 'sheenColor', 'sheenRoughness', 'transmission', 'thickness', 'attenuationColor', 'attenuationDistance', 'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange', 'specularIntensity', 'specularColor', 'dispersion', 'anisotropy', 'anisotropyRotation', 'clearcoatNormalScale' ];

/**
 * `MeshStandardMaterial` with three.js's clearcoat, sheen, specular layer (`ior`,
 * `specularIntensity`, `specularColor`), iridescence, anisotropy and transmission (with
 * `thickness`, attenuation and `dispersion`), and the maps of those layers.
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
		this.iridescenceThicknessRange = [ 100, 400 ];
		this.clearcoatNormalScale = new Vector2( 1, 1 );
		for ( const key of PHYSICAL_MAP_KEYS ) this[ key ] = null;
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

		const sent = this._sent, sheen = this.sheen, c = this.sheenColor, s = this.specularColor;
		const values = [ this.clearcoat, this.clearcoatRoughness, c.r * sheen, c.g * sheen, c.b * sheen, this.sheenRoughness, this.ior, this.specularIntensity, s.r, s.g, s.b ];
		let changed = false;

		for ( let i = 0; i < values.length; i ++ ) {

			if ( values[ i ] !== sent[ 49 + i ] ) changed = true;
			sent[ 49 + i ] = values[ i ];

		}

		if ( changed ) w().setMaterialPhysical( this.handle, ...values );
		const a = this.attenuationColor, range = this.iridescenceThicknessRange, n = this.clearcoatNormalScale;
		const extensions = [ this.transmission, this.thickness, a.r, a.g, a.b, this.attenuationDistance, this.dispersion, this.iridescence, this.iridescenceIOR, range[ 0 ], range[ 1 ], this.anisotropy, this.anisotropyRotation, n.x, n.y ];
		changed = false;

		for ( let i = 0; i < extensions.length; i ++ ) {

			if ( extensions[ i ] !== sent[ 70 + i ] ) changed = true;
			sent[ 70 + i ] = extensions[ i ];

		}

		if ( changed ) w().setMaterialPhysicalExtensions( this.handle, ...extensions );
		super._sync( environment );

	}

}

// Maps of the extra layers.
const PHYSICAL_MAP_KEYS = [ 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'sheenColorMap', 'sheenRoughnessMap', 'specularIntensityMap', 'specularColorMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap' ];
MeshPhysicalMaterial.prototype._keys = new Set( [ ...MeshStandardMaterial.prototype._keys, ...PHYSICAL_KEYS, ...PHYSICAL_MAP_KEYS ] );
MeshPhysicalMaterial.prototype.isMeshPhysicalMaterial = true;

// The environment a frame's standard materials are lit by: as in three.js, a material's
// own `envMap`, or else `scene.environment`. The engine stacks every distinct map of a
// frame (up to eight) in one texture.
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

	// The intensity `material` is lit with, or -1 when it has no environment.
	intensityFor( material ) {

		const own = material.envMap ?? null;
		if ( own !== null ) return environmentReady( own ) ? material.envMapIntensity : - 1;
		return this.texture !== null ? this.sceneIntensity : - 1;

	}

}

// An environment or background can be drawn once its image has arrived.
export function environmentReady( texture ) {

	// a render target's texture once something was drawn into it
	if ( texture.isRenderTargetTexture ) return texture.version > 0;

	const image = texture.image, loaded = ( each ) => each !== null && each !== undefined && ( each.data !== undefined || each.width > 0 );
	if ( texture.isCubeTexture ) return Array.isArray( image ) && image.length === 6 && image.every( ( face ) => loaded( face?.isDataTexture ? face.image : face ) );
	return loaded( image );

}

// Width of the equirectangular image an environment or background is drawn from: a cube
// texture becomes one four faces wide.
export function environmentWidth( texture ) {

	if ( texture.isRenderTargetTexture ) return texture.renderTarget.width;
	if ( ! texture.isCubeTexture ) return texture.image.width;
	const face = texture.image[ 0 ];
	return 4 * ( face.isDataTexture ? face.image.width : face.width );

}

// ---------------------------------------------------------------- shader materials

/** Shader materials by their custom id, for the WebGL 2 host. */
export const shaderMaterials = new Map();
let nextShaderId = 16;

/**
 * three.js `ShaderMaterial`: GLSL `vertexShader` and `fragmentShader` with `uniforms`
 * (`{ name: { value } }`) and `defines`, compiled with three.js's built-in uniforms
 * (`modelMatrix`, `modelViewMatrix`, `projectionMatrix`, `viewMatrix`, `normalMatrix`,
 * `cameraPosition`) and attributes (`position`, `normal`, `uv`, and any other attribute of
 * the geometry). Drawn on WebGL 2 only, as three.js's WebGPURenderer draws no GLSL
 * either; on WebGPU it draws unlit in `color`. Lights and fog are not provided to it.
 * Set `needsUpdate = true` after changing the shaders or defines.
 */
export class ShaderMaterial extends Material {

	constructor( parameters ) {

		super();
		this.type = 'ShaderMaterial';
		this.defines = {};
		this.uniforms = {};
		this.uniformsGroups = [];
		this.vertexShader = 'void main() {\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}';
		this.fragmentShader = 'void main() {\n\tgl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n}';
		this.linewidth = 1;
		this.wireframe = false;
		this.wireframeLinewidth = 1;
		this.fog = false;
		this.lights = false;
		this.clipping = false;
		this.extensions = { clipCullDistance: false, multiDraw: false };
		this.defaultAttributeValues = { color: [ 1, 1, 1 ], uv: [ 0, 0 ], uv1: [ 0, 0 ] };
		this.index0AttributeName = undefined;
		this.uniformsNeedUpdate = false;
		this.glslVersion = null;
		this.id = nextShaderId ++;
		this.version = 0;
		shaderMaterials.set( this.id, this );
		if ( parameters ) this.setValues( parameters );

	}

	/** Set to true after changing the shaders or defines: the program is compiled again. */
	set needsUpdate( value ) {

		if ( value ) this.version ++;

	}

	setValues( parameters ) {

		for ( const [ key, value ] of Object.entries( parameters ) ) {

			if ( value !== undefined && ( key === 'uniforms' || key === 'defines' || key === 'vertexShader' || key === 'fragmentShader' || key === 'glslVersion' || key === 'lights' || key === 'fog' || key === 'extensions' || key === 'wireframe' ) ) this[ key ] = value;

		}

		const rest = Object.fromEntries( Object.entries( parameters ).filter( ( [ key ] ) => ! [ 'uniforms', 'defines', 'vertexShader', 'fragmentShader', 'glslVersion', 'lights', 'fog', 'extensions', 'wireframe' ].includes( key ) ) );
		super.setValues( rest );

	}

	_sync( environment ) {

		if ( this._sent[ 79 ] !== this.id ) w().setMaterialCustom( this.handle, this._sent[ 79 ] = this.id, new Float32Array( 0 ) );
		super._sync( environment );

	}

	copy( source ) {

		super.copy( source );
		this.fragmentShader = source.fragmentShader;
		this.vertexShader = source.vertexShader;
		this.uniforms = cloneUniforms( source.uniforms );
		this.defines = Object.assign( {}, source.defines );
		this.glslVersion = source.glslVersion;
		this.lights = source.lights;
		this.fog = source.fog;
		this.extensions = Object.assign( {}, source.extensions );
		return this;

	}

	dispose() {

		shaderMaterials.delete( this.id );
		super.dispose();

	}

}

ShaderMaterial.prototype._shading = 1;
ShaderMaterial.prototype.isShaderMaterial = true;

/** three.js `RawShaderMaterial`: the shaders are compiled as given, without built-in declarations. */
export class RawShaderMaterial extends ShaderMaterial {

	constructor( parameters ) {

		super( parameters );
		this.type = 'RawShaderMaterial';

	}

}

RawShaderMaterial.prototype.isRawShaderMaterial = true;

/** A copy of uniforms, values cloned where they can be (three.js `UniformsUtils.clone`). */
export function cloneUniforms( source ) {

	const out = {};

	for ( const [ name, uniform ] of Object.entries( source ?? {} ) ) {

		const value = uniform.value;
		out[ name ] = { value: value && ( value.isColor || value.isMatrix3 || value.isMatrix4 || value.isVector2 || value.isVector3 || value.isVector4 || value.isQuaternion ) ? value.clone() : Array.isArray( value ) ? value.slice() : value };

	}

	return out;

}

/** Merges uniform sets, later ones winning (three.js `UniformsUtils.merge`). */
export function mergeUniforms( sets ) {

	return Object.assign( {}, ...sets.map( cloneUniforms ) );

}

export const UniformsUtils = { clone: cloneUniforms, merge: mergeUniforms };

/**
 * A full-screen effect of the renderer, for post-processing: `effect` is its id (1 copy,
 * 2 luminosity high pass, 3 blur, 4 bloom composite, 5 FXAA, 6 output), `params` its 16
 * settings, and `map`, `normalMap`, ... its inputs in slot order.
 */
export class EffectMaterial extends Material {

	constructor( effect ) {

		super();
		this.type = 'EffectMaterial';
		this.effect = effect;
		this.params = new Float32Array( 16 );
		this.depthTest = false;
		this.depthWrite = false;
		this.normalMap = this.roughnessMap = this.metalnessMap = this.emissiveMap = null;
		this._sentParams = new Float32Array( 16 ).fill( NaN );

	}

	_sync( environment ) {

		let changed = this._sent[ 79 ] !== this.effect;
		for ( let i = 0; ! changed && i < 16; i ++ ) changed = this.params[ i ] !== this._sentParams[ i ];

		if ( changed ) {

			this._sentParams.set( this.params );
			w().setMaterialCustom( this.handle, this._sent[ 79 ] = this.effect, this.params );

		}

		super._sync( environment );

	}

}

EffectMaterial.prototype._shading = 1;
