// init, getWorld, the basic constants and value types.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import * as W from '../index.js';
import { Euler, Matrix3, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from './vectors.js';
import { Box3, Color, Cylindrical, Line3, ObjectEuler, ObjectQuaternion, ObjectVector3, Plane, Ray, Sphere, Spherical, Triangle } from './shapes.js';

export function init( source?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module ): Promise<void>;
/** The World behind every object created here, for the batched low-level calls. */
export function getWorld(): W.World;

export const FrontSide: 0;
export const NoToneMapping: 0, LinearToneMapping: 1, ReinhardToneMapping: 2, CineonToneMapping: 3, ACESFilmicToneMapping: 4, CustomToneMapping: 5, AgXToneMapping: 6, NeutralToneMapping: 7;
export type ToneMapping = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const BackSide: 1;
export const DoubleSide: 2;
export const WebGLCoordinateSystem: 2000;
export const WebGPUCoordinateSystem: 2001;
export const MathUtils: typeof W.MathUtils;
export const Timer: typeof W.Timer;

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
export type ColorRepresentation = Color | number | string;

/**
 * The engine's method set with chaining: methods that return nothing in the engine
 * class return `this` here, and a trailing `target` argument receives the result.
 * Getters of engine values (`box.min`) give the classes of this module.
 */
export type Chained<Base, Self> = {
	[ K in keyof Base ]: Base[ K ] extends ( ...args: infer A ) => infer R ? ( ...args: Loose<A> ) => ( [ R ] extends [ void ] ? Self : Adopted<R> ) : Adopted<Base[ K ]>;
};

// Arguments are the classes of this module, or values owned by an object (`mesh.position`).
export type Loose<A extends unknown[]> = { [ I in keyof A ]: Given<A[ I ]> };
export type Given<T> =
	T extends W.Quaternion ? Quaternion | ObjectQuaternion : T extends W.Vector3 ? Vector3 | ObjectVector3 : T extends W.Euler ? Euler | ObjectEuler :
	T extends W.Matrix4 ? Matrix4 : T extends W.Matrix3 ? Matrix3 : T extends W.Vector2 ? Vector2 : T extends W.Vector4 ? Vector4 : T extends W.Color ? Color :
	T extends W.Box3 ? Box3 : T extends W.Sphere ? Sphere : T extends W.Plane ? Plane : T extends W.Ray ? Ray :
	T extends W.Line3 ? Line3 : T extends W.Triangle ? Triangle : T extends W.Spherical ? Spherical : T extends W.Cylindrical ? Cylindrical : T;

// Engine values come back as the classes of this module.
export type Adopted<R> =
	R extends W.Vector3 ? Vector3 : R extends W.Quaternion ? Quaternion : R extends W.Matrix4 ? Matrix4 : R extends W.Euler ? Euler :
	R extends W.Vector2 ? Vector2 : R extends W.Vector4 ? Vector4 : R extends W.Matrix3 ? Matrix3 : R extends W.Color ? Color :
	R extends W.Box3 ? Box3 : R extends W.Sphere ? Sphere : R extends W.Plane ? Plane : R extends W.Ray ? Ray :
	R extends W.Line3 ? Line3 : R extends W.Triangle ? Triangle : R extends W.Spherical ? Spherical : R extends W.Cylindrical ? Cylindrical : R;

export interface Vec3Like { x: number; y: number; z: number }
export interface QuatLike { x: number; y: number; z: number; w: number }
export interface EulerLike { x: number; y: number; z: number; order: string }
export interface AttributeLike { getX( i: number ): number; getY( i: number ): number; getZ( i: number ): number; getW( i: number ): number }
export interface Elements { elements: ArrayLike<number> }
