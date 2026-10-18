// Events, skinning, more lights, shader materials and more textures.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { ColorRepresentation, init } from './core.js';
import { Matrix4, Vector3 } from './vectors.js';
import { Box3 } from './shapes.js';
import { Light, Mesh, Object3D } from './objects.js';
import { BufferGeometry } from './geometry.js';
import { Material, Texture } from './materials.js';

// ---------------------------------------------------------------- events, skins, lights

export class EventDispatcher<E extends { type: string } = { type: string; [ key: string ]: any }> {
	addEventListener( type: string, listener: ( event: any ) => void ): void;
	hasEventListener( type: string, listener: ( event: any ) => void ): boolean;
	removeEventListener( type: string, listener: ( event: any ) => void ): void;
	dispatchEvent( event: E ): void;
}

export class Controls<O extends Object3D = Object3D> extends EventDispatcher {
	constructor( object: O, domElement?: HTMLElement | null );
	object: O;
	domElement: HTMLElement | null;
	enabled: boolean;
	state: number;
	keys: Record<string, any>;
	mouseButtons: Record<string, number | null>;
	touches: Record<string, number | null>;
	connect( element: HTMLElement ): void;
	disconnect(): void;
	dispose(): void;
	update( delta?: number ): void;
}

export class Bone extends Object3D { readonly isBone: true }

export class Skeleton {
	constructor( bones?: Bone[], boneInverses?: Matrix4[] );
	uuid: string;
	bones: Bone[];
	boneInverses: Matrix4[];
	boneMatrices: Float32Array | null;
	boneTexture: null;
	init(): void;
	calculateInverses(): void;
	pose(): void;
	update(): void;
	clone(): Skeleton;
	computeBoneTexture(): this;
	getBoneByName( name: string ): Bone | undefined;
	dispose(): void;
}

export class SkinnedMesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Mesh<G, M> {
	readonly isSkinnedMesh: true;
	bindMode: 'attached' | 'detached';
	bindMatrix: Matrix4;
	bindMatrixInverse: Matrix4;
	skeleton: Skeleton | undefined;
	boundingBox: Box3 | null;
	boundingSphere: any;
	bind( skeleton: Skeleton, bindMatrix?: Matrix4 ): void;
	pose(): void;
	normalizeSkinWeights(): void;
	applyBoneTransform( index: number, target: Vector3 ): Vector3;
	computeBoundingBox(): void;
	computeBoundingSphere(): void;
}

export class RectAreaLight extends Light {
	constructor( color?: ColorRepresentation, intensity?: number, width?: number, height?: number );
	readonly isRectAreaLight: true;
	width: number;
	height: number;
	power: number;
}

export class SphericalHarmonics3 {
	coefficients: Vector3[];
	set( coefficients: Vector3[] ): this;
	zero(): this;
	getAt( normal: Vector3, target: Vector3 ): Vector3;
	getIrradianceAt( normal: Vector3, target: Vector3 ): Vector3;
	add( sh: SphericalHarmonics3 ): this;
	addScaledSH( sh: SphericalHarmonics3, s: number ): this;
	scale( s: number ): this;
	lerp( sh: SphericalHarmonics3, alpha: number ): this;
	equals( sh: SphericalHarmonics3 ): boolean;
	copy( sh: SphericalHarmonics3 ): this;
	clone(): SphericalHarmonics3;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	toArray( array?: number[], offset?: number ): number[];
	static getBasisAt( normal: Vector3, shBasis: number[] ): void;
}

export class LightProbe extends Light {
	constructor( sh?: SphericalHarmonics3, intensity?: number );
	readonly isLightProbe: true;
	sh: SphericalHarmonics3;
}

// ---------------------------------------------------------------- shader materials and textures

export interface IUniform<T = any> { value: T }

export class ShaderMaterial extends Material {
	constructor( parameters?: Record<string, any> );
	readonly isShaderMaterial: true;
	uniforms: Record<string, IUniform>;
	defines: Record<string, any>;
	vertexShader: string;
	fragmentShader: string;
	glslVersion: string | null;
	lights: boolean;
	fog: boolean;
	wireframe: boolean;
	set needsUpdate( value: boolean );
}

export class RawShaderMaterial extends ShaderMaterial { readonly isRawShaderMaterial: true }

export const UniformsUtils: { clone( uniforms: Record<string, IUniform> ): Record<string, IUniform>; merge( uniforms: Record<string, IUniform>[] ): Record<string, IUniform> };

export class DepthTexture extends Texture {
	constructor( width: number, height: number, type?: number );
	readonly isDepthTexture: true;
}

/** Conversion between 32-bit floats and the 16-bit half floats of `HalfFloatType` textures. */
export const DataUtils: { toHalfFloat( value: number ): number; fromHalfFloat( value: number ): number };
