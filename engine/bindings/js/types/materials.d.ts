// Textures and the built-in materials.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { ColorRepresentation } from './core.js';
import { Euler, Vector2 } from './vectors.js';
import { Color, ColorSpace } from './shapes.js';

export class Texture {

	constructor( image?: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | { data: Uint8Array; width: number; height: number } | null );
	readonly isTexture: true;
	readonly id: number;
	/** Made on first read. */
	uuid: string;
	name: string;
	/** `EquirectangularReflectionMapping` for environment maps and panoramic backgrounds (cube textures need none). */
	mapping: number;
	image: any;
	version: number;
	flipY: boolean;
	wrapS: number;
	wrapT: number;
	magFilter: number;
	/** Mipmaps are built when this is one of the mipmap filters and `generateMipmaps` is set. */
	minFilter: number;
	generateMipmaps: boolean;
	offset: Vector2;
	repeat: Vector2;
	center: Vector2;
	rotation: number;
	colorSpace: ColorSpace;
	set needsUpdate( value: boolean );
	dispose(): void;

}

/** `data` is RGBA, one byte per channel. */
export class DataTexture extends Texture {

	constructor( data: Uint8Array, width: number, height: number );
	readonly isDataTexture: true;

}

export class CanvasTexture extends Texture {

	constructor( canvas: HTMLCanvasElement | OffscreenCanvas );
	readonly isCanvasTexture: true;

}

/** Six square images (+x, -x, +y, -y, +z, -z) for environments and backgrounds; drawn through an equirectangular image four faces wide. */
export class CubeTexture extends Texture {

	constructor( images?: Array<ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | { data: Uint8Array; width: number; height: number }>, mapping?: number );
	readonly isCubeTexture: true;
	images: any[];

}

export interface MaterialParameters {

	color?: ColorRepresentation;
	side?: 0 | 1 | 2;
	name?: string;
	map?: Texture | null;
	transparent?: boolean;
	opacity?: number;
	depthTest?: boolean;
	depthWrite?: boolean;
	vertexColors?: boolean;
	/** Any other parameter is stored, has no effect, and logs one warning. */
	[ key: string ]: any;

}

export class Material {

	constructor( parameters?: MaterialParameters );
	readonly isMaterial: true;
	readonly handle: bigint;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	color: Color;
	map: Texture | null;
	side: 0 | 1 | 2;
	/** Blend with what is behind, using `opacity` and the map's alpha. */
	transparent: boolean;
	opacity: number;
	/** three.js blending of a transparent material: 0 none, 1 normal, 2 additive, 3 subtractive, 4 multiply, 5 custom. */
	blending: number;
	/** Factors (`ZeroFactor`...) and equations (`AddEquation`...) of `CustomBlending`; the alpha ones default to the colour's. */
	blendSrc: number;
	blendDst: number;
	blendEquation: number;
	blendSrcAlpha: number | null;
	blendDstAlpha: number | null;
	blendEquationAlpha: number | null;
	premultipliedAlpha: boolean;
	/** Light each triangle with its own face normal (for lit and normal materials). */
	flatShading: boolean;
	depthTest: boolean;
	depthWrite: boolean;
	/** Multiply the colour by the geometry's `color` attribute (three floats per vertex, or four with alpha). */
	vertexColors: boolean;
	/** Accepted for compatibility. As with the three.js WebGPU renderer, tone mapping is applied to the whole frame, so this has no effect on screen output. */
	toneMapped: boolean;
	/** Fragments whose alpha is at or below this are discarded; 0 keeps them all. Not applied to shadows. */
	alphaTest: number;
	userData: Record<string, any>;
	setValues( parameters: MaterialParameters ): void;
	copy( source: Material ): this;
	clone(): this;
	dispose(): void;

}

/** Every map uses the colour map's uv transform (or the first map's, without `map`). */
export interface AlphaMap {

	/** Alpha in the red channel, as three.js reads it (grey maps read the same in every channel). */
	alphaMap: Texture | null;

}

export interface OcclusionMap {

	/** Ambient occlusion in the red channel; dims indirect light only. */
	aoMap: Texture | null;
	aoMapIntensity: number;

}

export interface NormalMap {

	/** Tangent space; the tangent frame comes from screen-space derivatives, not a `tangent` attribute. */
	normalMap: Texture | null;
	normalScale: Vector2;

}

export interface LightMap {

	/** Baked light in rgb, scaled by `lightMapIntensity` and added to the light arriving from all around. Read with the shared uv transform from the first uv set. */
	lightMap: Texture | null;
	lightMapIntensity: number;

}

export interface SurfaceMaps {

	/** Height in the red channel; its change across the pixel tilts the normal. Not used together with `normalMap`, which takes precedence. */
	bumpMap: Texture | null;
	bumpScale: number;
	/** Moves vertices along their normal by red times `displacementScale` plus `displacementBias`. Shadows are cast from the undisplaced mesh. */
	displacementMap: Texture | null;
	displacementScale: number;
	displacementBias: number;

}

export interface Wireframe {

	/** Draws the edges of each triangle as one-pixel lines. */
	wireframe: boolean;
	/** Accepted; values other than 1 log a warning (lines are one pixel wide). */
	wireframeLinewidth: number;

}

export interface LitMaps extends AlphaMap, OcclusionMap, NormalMap, LightMap, SurfaceMaps, Wireframe {

	/** Multiplies `emissive`. */
	emissiveMap: Texture | null;

}

export interface Emissive {

	/** Light the surface gives off, multiplied by `emissiveIntensity`. */
	emissive: Color;
	emissiveIntensity: number;

}

/** Shows its colour (and map) as is, without lighting; a light map adds baked light. */
export interface MeshBasicMaterial extends AlphaMap, OcclusionMap, LightMap, Wireframe {}
export class MeshBasicMaterial extends Material { readonly isMeshBasicMaterial: true }
/** Diffuse (Lambert) lighting. */
export interface MeshLambertMaterial extends Emissive, LitMaps {}
export class MeshLambertMaterial extends Material { readonly isMeshLambertMaterial: true }
/** Diffuse lighting plus a Blinn-Phong highlight. */
export interface MeshPhongMaterial extends Emissive, LitMaps {}
export class MeshPhongMaterial extends Material {

	readonly isMeshPhongMaterial: true;
	specular: Color;
	shininess: number;
	/** Strength of the highlight in the red channel. */
	specularMap: Texture | null;

}
/** Diffuse lighting in tones: two without a gradient map. */
export interface MeshToonMaterial extends Emissive, LitMaps {}
export class MeshToonMaterial extends Material {

	readonly isMeshToonMaterial: true;
	/** Tones in the red channel, read at n.l / 2 + 1/2 across (usually with `NearestFilter`). */
	gradientMap: Texture | null;

}
/** The view-space normal as a colour. */
export interface MeshNormalMaterial extends NormalMap, SurfaceMaps, Wireframe {}
export class MeshNormalMaterial extends Material { readonly isMeshNormalMaterial: true }
/** For `Line`, `LineSegments` and `LineLoop`. Lines are one pixel wide. */
export class LineBasicMaterial extends Material { readonly isLineBasicMaterial: true }

/** Physically based lighting from `roughness` and `metalness`, with reflections of `envMap` or `scene.environment` (equirectangular). One environment map is drawn per frame. */
export interface MeshStandardMaterial extends Emissive, LitMaps {}
export class MeshStandardMaterial extends Material {

	constructor( parameters?: MaterialParameters & { roughness?: number; metalness?: number } );
	readonly isMeshStandardMaterial: true;
	roughness: number;
	metalness: number;
	envMap: Texture | null;
	envMapIntensity: number;
	envMapRotation: Euler;
	/** Roughness in the green channel, multiplying `roughness`. */
	roughnessMap: Texture | null;
	/** Metalness in the blue channel, multiplying `metalness`. */
	metalnessMap: Texture | null;

}

/**
 * `MeshStandardMaterial` with clearcoat, sheen and the specular layer (`ior`,
 * `specularIntensity`, `specularColor`). Transmission, iridescence, anisotropy, dispersion
 * and the maps of the extra layers are kept but not drawn (one warning when used).
 */
export class MeshPhysicalMaterial extends MeshStandardMaterial {

	readonly isMeshPhysicalMaterial: true;
	clearcoat: number;
	clearcoatRoughness: number;
	ior: number;
	reflectivity: number;
	sheen: number;
	sheenColor: Color;
	sheenRoughness: number;
	transmission: number;
	thickness: number;
	attenuationColor: Color;
	attenuationDistance: number;
	iridescence: number;
	iridescenceIOR: number;
	specularIntensity: number;
	specularColor: Color;
	dispersion: number;
	anisotropy: number;
	anisotropyRotation: number;

}
