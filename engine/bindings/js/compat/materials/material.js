// Material: the base class, its settings, maps and the engine material behind it.
//
// Part of the materials; `../materials.js` gathers them.

import { AddEquation, FrontSide, NormalBlending, OneMinusSrcAlphaFactor, SrcAlphaFactor } from '../constants.js';
import { MATERIAL, finalizer, ignored, lazyUUID, w } from '../engine.js';
import { Color, Matrix4, Vector2 } from '../math.js';
import { withEvents } from '../events.js';
import { environmentReady, environmentWidth } from './environment.js';

const MATERIAL_KEYS = new Set( [ 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'color', 'side', 'name', 'map', 'userData', 'transparent', 'opacity', 'depthTest', 'depthWrite', 'vertexColors', 'alphaTest', 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'premultipliedAlpha', 'flatShading', 'linewidth', 'linecap', 'linejoin', 'dithering', 'shadowSide', 'visible', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits' ] );
export const EMISSIVE_KEYS = [ 'emissive', 'emissiveIntensity' ];
export const ENVIRONMENT_KEYS = [ 'envMap', 'envMapIntensity', 'envMapRotation' ];
// The texture maps beside `map` that materials have by class,
// and the settings that come with them, with three.js's defaults.
export const MAP_KEYS = [ 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap' ];
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
const COPIED_KEYS = [ 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'premultipliedAlpha', 'flatShading', 'linewidth', 'size', 'sizeAttenuation', 'rotation', 'toneMapped', 'fog', 'roughness', 'metalness', 'specular', 'shininess', 'alphaTest', 'wireframe', 'wireframeLinewidth', ...EMISSIVE_KEYS, ...ENVIRONMENT_KEYS, ...ALL_MAPS, ...MAP_SETTING_KEYS ];

// Gives a material the maps of its class, with three.js's defaults.
export function withMaps( material, maps ) {

	for ( const name of maps ) {

		material[ name ] = null;
		for ( const [ key, initial ] of Object.entries( MAP_SETTINGS[ name ] ?? {} ) ) material[ key ] = initial();

	}

}

// The keys a class accepts for its maps.
export const mapKeys = ( maps ) => maps.flatMap( ( name ) => [ name, ...Object.keys( MAP_SETTINGS[ name ] ?? {} ) ] );
export const LIT_MAPS = [ 'normalMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'bumpMap', 'displacementMap' ];
// Meshes draw their triangles' edges as lines; lines are always one pixel wide.
export const WIREFRAME_KEYS = [ 'wireframe', 'wireframeLinewidth' ];

export function withWireframe( material ) {

	material.wireframe = false;
	material.wireframeLinewidth = 1;

}

// The factors and equations of `CustomBlending` in 22 bits (see the engine's
// `Material::custom_blending`); alpha takes the colour's settings where it has none.
function customBlending( m ) {

	const factor = ( f ) => Math.min( 15, Math.max( 0, ( f ?? 204 ) - 200 ) ), equation = ( e ) => Math.min( 4, Math.max( 0, ( e ?? 100 ) - 100 ) );
	return factor( m.blendSrc ) | factor( m.blendDst ) << 4 | equation( m.blendEquation ) << 8
		| factor( m.blendSrcAlpha ?? m.blendSrc ) << 11 | factor( m.blendDstAlpha ?? m.blendDst ) << 15 | equation( m.blendEquationAlpha ?? m.blendEquation ) << 19;

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
		this.blendSrc = SrcAlphaFactor;
		this.blendDst = OneMinusSrcAlphaFactor;
		this.blendEquation = AddEquation;
		this.blendSrcAlpha = null;
		this.blendDstAlpha = null;
		this.blendEquationAlpha = null;
		this.premultipliedAlpha = false;
		this.flatShading = false;
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

		const blending = this.blending, premultiplied = this.premultipliedAlpha === true, custom = customBlending( this );
		if ( blending !== sent[ 60 ] || premultiplied !== sent[ 61 ] || custom !== sent[ 70 ] ) w().setMaterialBlending( this.handle, sent[ 60 ] = blending, sent[ 61 ] = premultiplied, sent[ 70 ] = custom );
		const flat = this.flatShading === true;
		if ( flat !== sent[ 71 ] ) w().setMaterialFlatShading( this.handle, sent[ 71 ] = flat );
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
