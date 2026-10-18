// Layers, Object3D, scenes, meshes, cameras, lines, fog, instancing, helpers, LOD and lights.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { ColorRepresentation, Vec3Like } from './core.js';
import { Euler, Matrix4, Quaternion, Vector3 } from './vectors.js';
import { Box3, Color, ObjectEuler, ObjectQuaternion, ObjectVector3 } from './shapes.js';
import { BufferGeometry } from './geometry.js';
import { LineBasicMaterial, Material, Texture } from './materials.js';

export class Layers {

	mask: number;
	set( layer: number ): void;
	enable( layer: number ): void;
	enableAll(): void;
	toggle( layer: number ): void;
	disable( layer: number ): void;
	disableAll(): void;
	test( layers: { mask: number } ): boolean;
	isEnabled( layer: number ): boolean;

}

export class Object3D {

	readonly isObject3D: true;
	/** The engine handle, for the low-level World API. */
	readonly handle: bigint;
	readonly id: number;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	parent: Object3D | null;
	children: Object3D[];
	userData: Record<string, any>;
	visible: boolean;
	renderOrder: number;
	frustumCulled: boolean;
	/** Always true; setting it to false throws. */
	/** With `false` the local matrix is yours: change it through `object.matrix`. */
	matrixAutoUpdate: boolean;
	matrixWorldAutoUpdate: boolean;
	matrixWorldNeedsUpdate: boolean;
	readonly position: ObjectVector3;
	readonly rotation: ObjectEuler;
	readonly quaternion: ObjectQuaternion;
	readonly scale: ObjectVector3;
	readonly up: ObjectVector3;
	readonly layers: Layers;
	/** A copy of the local matrix. */
	matrix: Matrix4;
	/** The world matrix, refreshed from the engine on each access; the same object every time. */
	readonly matrixWorld: Matrix4;

	add( ...children: Object3D[] ): this;
	remove( ...children: Object3D[] ): this;
	removeFromParent(): this;
	clear(): this;
	attach( child: Object3D ): this;
	lookAt( target: Vec3Like ): void;
	lookAt( x: number, y: number, z: number ): void;
	rotateOnAxis( axis: Vec3Like, angle: number ): this;
	rotateX( angle: number ): this;
	rotateY( angle: number ): this;
	rotateZ( angle: number ): this;
	translateOnAxis( axis: Vec3Like, distance: number ): this;
	translateX( distance: number ): this;
	translateY( distance: number ): this;
	translateZ( distance: number ): this;
	updateMatrix(): void;
	updateMatrixWorld( force?: boolean ): void;
	updateWorldMatrix( updateParents: boolean, updateChildren?: boolean ): void;
	getWorldPosition( target?: Vector3 ): Vector3;
	getWorldQuaternion( target?: Quaternion ): Quaternion;
	getWorldScale( target?: Vector3 ): Vector3;
	getWorldDirection( target?: Vector3 ): Vector3;
	localToWorld( v: Vector3 ): Vector3;
	worldToLocal( v: Vector3 ): Vector3;
	traverse( callback: ( object: Object3D ) => void ): void;
	traverseVisible( callback: ( object: Object3D ) => void ): void;
	traverseAncestors( callback: ( object: Object3D ) => void ): void;
	getObjectByName( name: string ): Object3D | undefined;
	getObjectById( id: number ): Object3D | undefined;
	getObjectByProperty( name: string, value: any ): Object3D | undefined;
	clone( recursive?: boolean ): this;
	copy( source: this, recursive?: boolean ): this;
	/** Releases the object in the engine now instead of at garbage collection. */
	dispose(): void;

}

export class Group extends Object3D { readonly isGroup: true }

export class Scene extends Object3D {

	readonly isScene: true;
	/** A colour, an equirectangular texture (`mapping = EquirectangularReflectionMapping`) drawn around the camera, or another texture stretched over the frame. */
	background: Color | Texture | null;
	/** An equirectangular texture that lights standard materials without their own `envMap`. */
	environment: Texture | null;
	environmentIntensity: number;
	environmentRotation: Euler;
	/** Above 0, an equirectangular background is read blurred from its prefiltered map. */
	backgroundBlurriness: number;
	backgroundIntensity: number;
	backgroundRotation: Euler;
	fog: Fog | FogExp2 | null;

}

export class Mesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isMesh: true;
	geometry: G;
	material: M;

}

export class Camera extends Object3D {

	readonly isCamera: true;
	near: number;
	far: number;
	zoom: number;
	readonly projectionMatrix: Matrix4;
	readonly projectionMatrixInverse: Matrix4;
	readonly matrixWorldInverse: Matrix4;
	updateProjectionMatrix(): void;
	setViewOffset( fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number ): void;
	clearViewOffset(): void;

}

export class PerspectiveCamera extends Camera {

	constructor( fov?: number, aspect?: number, near?: number, far?: number );
	readonly isPerspectiveCamera: true;
	fov: number;
	aspect: number;

}

export class OrthographicCamera extends Camera {

	constructor( left?: number, right?: number, top?: number, bottom?: number, near?: number, far?: number );
	readonly isOrthographicCamera: true;
	left: number;
	right: number;
	top: number;
	bottom: number;

}

/** One connected line through the geometry's vertices, one pixel wide. */
export class Line<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Object3D {

	constructor( geometry?: G, material?: M );
	readonly isLine: true;
	geometry: G;
	material: M;

}

/** Separate segments, one per pair of vertices. */
export class Fog {

	constructor( color: ColorRepresentation, near?: number, far?: number );
	readonly isFog: true;
	name: string;
	color: Color;
	near: number;
	far: number;
	clone(): Fog;

}

export class FogExp2 {

	constructor( color: ColorRepresentation, density?: number );
	readonly isFogExp2: true;
	name: string;
	color: Color;
	density: number;
	clone(): FogExp2;

}

/** Per-instance numbers of an `InstancedMesh`. Set `needsUpdate = true` after changing `array`. */
export class InstancedBufferAttribute {

	constructor( array: Float32Array, itemSize: number );
	readonly isInstancedBufferAttribute: true;
	array: Float32Array;
	itemSize: number;
	count: number;
	version: number;
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;

}

/** One geometry drawn `count` times in a single draw call. Instances are not culled one by one; `Raycaster` reports the `instanceId` it hit. */
export class InstancedMesh<G extends BufferGeometry = BufferGeometry, M extends Material | Material[] = Material> extends Mesh<G, M> {

	constructor( geometry: G, material: M, count: number );
	readonly isInstancedMesh: true;
	readonly instanceMatrix: InstancedBufferAttribute;
	instanceColor: InstancedBufferAttribute | null;
	count: number;
	setMatrixAt( index: number, matrix: Matrix4 ): void;
	getMatrixAt( index: number, matrix: Matrix4 ): Matrix4;
	setColorAt( index: number, color: Color ): void;
	getColorAt( index: number, color: Color ): Color;
	/** Local box around the drawn instances; filled by `computeBoundingBox`. */
	boundingBox: Box3 | null;
	computeBoundingBox(): void;

}

export class GridHelper extends LineSegments<BufferGeometry, LineBasicMaterial> {

	constructor( size?: number, divisions?: number, color1?: ColorRepresentation, color2?: ColorRepresentation );

}

export class AxesHelper extends LineSegments<BufferGeometry, LineBasicMaterial> {

	constructor( size?: number );
	setColors( xAxisColor: ColorRepresentation, yAxisColor: ColorRepresentation, zAxisColor: ColorRepresentation ): this;

}

export class LineSegments<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {

	readonly isLineSegments: true;

}

/** A line through the geometry's vertices and back to the first, one pixel wide. */
export class LineLoop<G extends BufferGeometry = BufferGeometry, M extends Material = Material> extends Line<G, M> {

	readonly isLineLoop: true;

}

/** Shows one level by distance from the camera; with `autoUpdate` the renderer calls `update`. */
export class LOD extends Object3D {

	readonly isLOD: true;
	readonly levels: { distance: number; hysteresis: number; object: Object3D }[];
	autoUpdate: boolean;
	addLevel( object: Object3D, distance?: number, hysteresis?: number ): this;
	removeLevel( distance: number ): boolean;
	getCurrentLevel(): number;
	getObjectForDistance( distance: number ): Object3D | null;
	update( camera: Camera ): void;

}

export class Light extends Object3D {

	constructor( color?: ColorRepresentation, intensity?: number );
	readonly isLight: true;
	color: Color;
	intensity: number;

}

export class AmbientLight extends Light { readonly isAmbientLight: true }

export class HemisphereLight extends Light {

	constructor( skyColor?: ColorRepresentation, groundColor?: ColorRepresentation, intensity?: number );
	readonly isHemisphereLight: true;
	groundColor: Color;

}

export class DirectionalLight extends Light {

	readonly isDirectionalLight: true;
	target: Object3D;

}

/** `distance` 0 means no cutoff. */
export class PointLight extends Light {

	constructor( color?: ColorRepresentation, intensity?: number, distance?: number, decay?: number );
	readonly isPointLight: true;
	distance: number;
	decay: number;

}

/** `angle` is the cone's half angle in radians; `penumbra` (0..1) the soft share of the cone. */
export class SpotLight extends Light {

	constructor( color?: ColorRepresentation, intensity?: number, distance?: number, angle?: number, penumbra?: number, decay?: number );
	readonly isSpotLight: true;
	target: Object3D;
	distance: number;
	angle: number;
	penumbra: number;
	decay: number;

}

export type NumberArray = number[] | Float32Array | Uint32Array | Uint16Array | Uint8Array | Uint8ClampedArray | Int32Array | Int16Array | Int8Array;

/** Item accessors; values of `normalized` integer arrays read and write as 0..1 or -1..1. */
export interface AttributeAccessors {

	getComponent( index: number, component: number ): number;
	setComponent( index: number, component: number, value: number ): this;
	getX( index: number ): number;
	getY( index: number ): number;
	getZ( index: number ): number;
	getW( index: number ): number;
	setX( index: number, x: number ): this;
	setY( index: number, y: number ): this;
	setZ( index: number, z: number ): this;
	setW( index: number, w: number ): this;
	setXY( index: number, x: number, y: number ): this;
	setXYZ( index: number, x: number, y: number, z: number ): this;
	setXYZW( index: number, x: number, y: number, z: number, w: number ): this;

}
