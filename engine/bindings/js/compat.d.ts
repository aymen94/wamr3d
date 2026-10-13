import * as W from './index.js';

export function init( source?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module ): Promise<void>;
/** The World behind every object created here, for the batched low-level calls. */
export function getWorld(): W.World;

export const FrontSide: 0;
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
 */
type Chained<Base, Self> = {
	[ K in keyof Base ]: Base[ K ] extends ( ...args: infer A ) => infer R ? ( ...args: Loose<A> ) => ( [ R ] extends [ void ] ? Self : Adopted<R> ) : Base[ K ];
};

// Arguments are the classes of this module, or values owned by an object (`mesh.position`).
type Loose<A extends unknown[]> = { [ I in keyof A ]: Given<A[ I ]> };
type Given<T> =
	T extends W.Quaternion ? Quaternion | ObjectQuaternion : T extends W.Vector3 ? Vector3 | ObjectVector3 : T extends W.Euler ? Euler | ObjectEuler :
	T extends W.Matrix4 ? Matrix4 : T extends W.Matrix3 ? Matrix3 : T extends W.Vector2 ? Vector2 : T extends W.Vector4 ? Vector4 : T extends W.Color ? Color :
	T extends W.Box3 ? Box3 : T extends W.Sphere ? Sphere : T extends W.Plane ? Plane : T extends W.Ray ? Ray : T;

// Engine values come back as the classes of this module.
type Adopted<R> =
	R extends W.Vector3 ? Vector3 : R extends W.Quaternion ? Quaternion : R extends W.Matrix4 ? Matrix4 : R extends W.Euler ? Euler :
	R extends W.Vector2 ? Vector2 : R extends W.Vector4 ? Vector4 : R extends W.Matrix3 ? Matrix3 : R extends W.Color ? Color :
	R extends W.Box3 ? Box3 : R extends W.Sphere ? Sphere : R extends W.Plane ? Plane : R extends W.Ray ? Ray : R;

interface Vec3Like { x: number; y: number; z: number }

declare const Vector2Base: new ( x: number, y: number ) => Chained<W.Vector2, Vector2>;
export class Vector2 extends Vector2Base {

	constructor( x?: number, y?: number );
	readonly isVector2: true;
	fromArray( array: ArrayLike<number>, offset?: number ): this;

}

declare const Vector3Base: new ( x: number, y: number, z: number ) => Chained<W.Vector3, Vector3>;
export class Vector3 extends Vector3Base {

	constructor( x?: number, y?: number, z?: number );
	readonly isVector3: true;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	project( camera: Camera ): this;
	unproject( camera: Camera ): this;

}

declare const Vector4Base: new ( x: number, y: number, z: number, w: number ) => Chained<W.Vector4, Vector4>;
export class Vector4 extends Vector4Base {

	constructor( x?: number, y?: number, z?: number, w?: number );
	readonly isVector4: true;
	fromArray( array: ArrayLike<number>, offset?: number ): this;

}

declare const QuaternionBase: new ( x: number, y: number, z: number, w: number ) => Chained<Omit<W.Quaternion, 'setFromEuler'>, Quaternion>;
export class Quaternion extends QuaternionBase {

	constructor( x?: number, y?: number, z?: number, w?: number );
	readonly isQuaternion: true;
	setFromEuler( euler: { x: number; y: number; z: number; order: string } ): this;
	fromArray( array: ArrayLike<number>, offset?: number ): this;

}

declare const EulerBase: new ( x: number, y: number, z: number, order: string ) => Chained<Omit<W.Euler, 'set' | 'setFromQuaternion' | 'setFromRotationMatrix' | 'order'>, Euler>;
export class Euler extends EulerBase {

	constructor( x?: number, y?: number, z?: number, order?: EulerOrder );
	readonly isEuler: true;
	order: EulerOrder;
	set( x: number, y: number, z: number, order?: EulerOrder ): this;
	setFromQuaternion( q: Quaternion, order?: EulerOrder ): this;
	setFromRotationMatrix( m: Matrix4, order?: EulerOrder ): this;
	fromArray( array: ArrayLike<number | string> ): this;

}

declare const Matrix3Base: new () => Chained<Omit<W.Matrix3, 'fromArray'>, Matrix3>;
export class Matrix3 extends Matrix3Base {

	readonly isMatrix3: true;
	/** A copy of the 9 elements, column-major. Write back with `fromArray`. */
	readonly elements: Float32Array;
	fromArray( array: ArrayLike<number>, offset?: number ): this;

}

declare const Matrix4Base: new () => Chained<Omit<W.Matrix4, 'fromArray' | 'setPosition' | 'decompose' | 'makePerspective' | 'makeOrthographic'>, Matrix4>;
export class Matrix4 extends Matrix4Base {

	readonly isMatrix4: true;
	/** A copy of the 16 elements, column-major. Write back with `fromArray`. */
	readonly elements: Float32Array;
	fromArray( array: ArrayLike<number>, offset?: number ): this;
	/** Row-major arguments. */
	set( ...elements: number[] ): this;
	setPosition( x: number | Vec3Like, y?: number, z?: number ): this;
	decompose( position: Vec3Like & { set: Function }, quaternion: { set: Function }, scale: { set: Function } ): this;
	makePerspective( left: number, right: number, top: number, bottom: number, near: number, far: number, coordinateSystem?: number, reversedDepth?: boolean ): this;
	makeOrthographic( left: number, right: number, top: number, bottom: number, near: number, far: number, coordinateSystem?: number, reversedDepth?: boolean ): this;

}

declare const ColorBase: new ( r: number, g: number, b: number ) => Chained<Omit<W.Color, 'getHSL'>, Color>;
export class Color extends ColorBase {

	constructor( r?: ColorRepresentation, g?: number, b?: number );
	readonly isColor: true;
	set( r: ColorRepresentation, g?: number, b?: number ): this;
	getHSL( target?: { h?: number; s?: number; l?: number } ): { h: number; s: number; l: number };
	fromArray( array: ArrayLike<number>, offset?: number ): this;

}

declare const Box3Base: new () => Chained<Omit<W.Box3, 'getCenter' | 'getSize' | 'clampPoint' | 'getBoundingSphere'>, Box3>;
export class Box3 extends Box3Base {

	constructor( min?: Vector3, max?: Vector3 );
	readonly isBox3: true;
	getCenter( target?: Vector3 ): Vector3;
	getSize( target?: Vector3 ): Vector3;
	clampPoint( point: Vector3, target?: Vector3 ): Vector3;
	getBoundingSphere( target?: Sphere ): Sphere;

}

declare const SphereBase: new ( center: W.Vector3, radius: number ) => Chained<Omit<W.Sphere, 'clampPoint' | 'getBoundingBox'>, Sphere>;
export class Sphere extends SphereBase {

	constructor( center?: Vector3, radius?: number );
	readonly isSphere: true;
	clampPoint( point: Vector3, target?: Vector3 ): Vector3;
	getBoundingBox( target?: Box3 ): Box3;

}

declare const PlaneBase: new ( normal: W.Vector3, constant: number ) => Chained<Omit<W.Plane, 'projectPoint' | 'coplanarPoint'>, Plane>;
export class Plane extends PlaneBase {

	constructor( normal?: Vector3, constant?: number );
	readonly isPlane: true;
	projectPoint( point: Vector3, target?: Vector3 ): Vector3;
	coplanarPoint( target?: Vector3 ): Vector3;

}

declare const RayBase: new ( origin: W.Vector3, direction: W.Vector3 ) => Chained<Omit<W.Ray, 'at' | 'closestPointToPoint' | 'intersectSphere' | 'intersectPlane' | 'intersectBox' | 'intersectTriangle' | 'distanceToPlane'>, Ray>;
export class Ray extends RayBase {

	constructor( origin?: Vector3, direction?: Vector3 );
	readonly isRay: true;
	at( t: number, target?: Vector3 ): Vector3;
	closestPointToPoint( point: Vector3, target?: Vector3 ): Vector3;
	distanceToPlane( plane: Plane ): number | null;
	intersectSphere( sphere: Sphere, target?: Vector3 ): Vector3 | null;
	intersectPlane( plane: Plane, target?: Vector3 ): Vector3 | null;
	intersectBox( box: Box3, target?: Vector3 ): Vector3 | null;
	intersectTriangle( a: Vector3, b: Vector3, c: Vector3, backfaceCulling: boolean, target?: Vector3 ): Vector3 | null;

}

declare const FrustumBase: new () => Chained<Omit<W.Frustum, 'setFromProjectionMatrix'>, Frustum>;
export class Frustum extends FrustumBase {

	readonly isFrustum: true;
	setFromProjectionMatrix( m: Matrix4, coordinateSystem?: number, reversedDepth?: boolean ): this;

}

/** `object.position`, `object.scale`, `object.up`: a Vector3 whose numbers live in the engine. */
export type ObjectVector3 = Omit<Vector3, 'free' | typeof Symbol.dispose>;
export type ObjectEuler = Omit<Euler, 'free' | typeof Symbol.dispose>;
export type ObjectQuaternion = Omit<Quaternion, 'free' | typeof Symbol.dispose>;

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
	/** A copy of the world matrix. */
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
	background: Color | null;
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

/** One geometry drawn `count` times in a single draw call. Instances are not culled or picked one by one. */
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

type NumberArray = number[] | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

export class BufferAttribute {

	constructor( array: NumberArray, itemSize: number, normalized?: boolean );
	readonly isBufferAttribute: true;
	array: NumberArray;
	itemSize: number;
	count: number;
	version: number;
	/** Set to true after changing `array` to send the new data to the engine. */
	set needsUpdate( value: boolean );
	getX( index: number ): number;
	getY( index: number ): number;
	getZ( index: number ): number;
	setXYZ( index: number, x: number, y: number, z: number ): this;

}

export class Float32BufferAttribute extends BufferAttribute {}
export class Uint16BufferAttribute extends BufferAttribute {}
export class Uint32BufferAttribute extends BufferAttribute {}

export class BufferGeometry {

	readonly isBufferGeometry: true;
	readonly handle: bigint;
	type: string;
	attributes: Record<string, BufferAttribute>;
	index: BufferAttribute | null;
	groups: { start: number; count: number; materialIndex: number }[];
	boundingBox: Box3 | null;
	boundingSphere: Sphere | null;
	userData: Record<string, any>;

	setAttribute( name: string, attribute: BufferAttribute ): this;
	getAttribute( name: string ): BufferAttribute | undefined;
	hasAttribute( name: string ): boolean;
	setIndex( index: BufferAttribute | NumberArray ): this;
	getIndex(): BufferAttribute | null;
	addGroup( start: number, count: number, materialIndex?: number ): void;
	setDrawRange( start: number, count: number ): void;
	computeVertexNormals(): void;
	computeTangents(): void;
	computeBoundingBox(): void;
	computeBoundingSphere(): void;
	applyMatrix4( matrix: Matrix4 ): this;
	translate( x: number, y: number, z: number ): this;
	scale( x: number, y: number, z: number ): this;
	rotateX( angle: number ): this;
	rotateY( angle: number ): this;
	rotateZ( angle: number ): this;
	center(): this;
	toNonIndexed(): BufferGeometry;
	dispose(): void;

}

export class BoxGeometry extends BufferGeometry {

	constructor( width?: number, height?: number, depth?: number, widthSegments?: number, heightSegments?: number, depthSegments?: number );

}

export class PlaneGeometry extends BufferGeometry {

	constructor( width?: number, height?: number, widthSegments?: number, heightSegments?: number );

}

export class SphereGeometry extends BufferGeometry {

	constructor( radius?: number, widthSegments?: number, heightSegments?: number, phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number );

}

export class CylinderGeometry extends BufferGeometry {

	constructor( radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean, thetaStart?: number, thetaLength?: number );

}

export class ConeGeometry extends CylinderGeometry {

	constructor( radius?: number, height?: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean, thetaStart?: number, thetaLength?: number );

}

export class CircleGeometry extends BufferGeometry {

	constructor( radius?: number, segments?: number, thetaStart?: number, thetaLength?: number );

}

export class RingGeometry extends BufferGeometry {

	constructor( innerRadius?: number, outerRadius?: number, thetaSegments?: number, phiSegments?: number, thetaStart?: number, thetaLength?: number );

}

export class TorusGeometry extends BufferGeometry {

	constructor( radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number, arc?: number, thetaStart?: number, thetaLength?: number );

}

export const RepeatWrapping: 1000;
export const ClampToEdgeWrapping: 1001;
export const MirroredRepeatWrapping: 1002;
export const NearestFilter: 1003;
export const NearestMipmapNearestFilter: 1004;
export const NearestMipmapLinearFilter: 1005;
export const LinearFilter: 1006;
export const LinearMipmapNearestFilter: 1007;
export const LinearMipmapLinearFilter: 1008;
export const NoColorSpace: '';
export const SRGBColorSpace: 'srgb';

export class Texture {

	constructor( image?: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | { data: Uint8Array; width: number; height: number } | null );
	readonly isTexture: true;
	readonly id: number;
	name: string;
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
	colorSpace: '' | 'srgb';
	set needsUpdate( value: boolean );
	dispose(): void;

}

/** `data` is RGBA, one byte per channel. */
export class DataTexture extends Texture {

	constructor( data: Uint8Array, width: number, height: number );

}

export class CanvasTexture extends Texture {

	constructor( canvas: HTMLCanvasElement | OffscreenCanvas );

}

export class TextureLoader {

	load( url: string, onLoad?: ( texture: Texture ) => void, onProgress?: unknown, onError?: ( error: unknown ) => void ): Texture;

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
	type: string;
	name: string;
	color: Color;
	map: Texture | null;
	side: 0 | 1 | 2;
	/** Blend with what is behind, using `opacity` and the map's alpha. */
	transparent: boolean;
	opacity: number;
	depthTest: boolean;
	depthWrite: boolean;
	/** Multiply the colour by the geometry's `color` attribute (three floats per vertex). */
	vertexColors: boolean;
	userData: Record<string, any>;
	setValues( parameters: MaterialParameters ): void;
	clone(): this;
	dispose(): void;

}

/** Shows its colour (and map) as is, without lighting. */
export class MeshBasicMaterial extends Material {}
/** Diffuse (Lambert) lighting. */
export class MeshLambertMaterial extends Material {}
/** For `Line` and `LineSegments`. Lines are one pixel wide. */
export class LineBasicMaterial extends Material { readonly isLineBasicMaterial: true }

/** Physically based direct lighting from `roughness` and `metalness`; no environment reflections yet. */
export class MeshStandardMaterial extends Material {

	constructor( parameters?: MaterialParameters & { roughness?: number; metalness?: number } );
	roughness: number;
	metalness: number;

}

export class Clock {

	constructor( autoStart?: boolean );
	autoStart: boolean;
	elapsedTime: number;
	running: boolean;
	start(): void;
	stop(): void;
	getElapsedTime(): number;
	getDelta(): number;

}

/** Present so that using it fails with a clear error. */
type NotAvailable = new ( ...args: any[] ) => never;
export const WebGLRenderer: NotAvailable, RectAreaLight: NotAvailable, LineLoop: NotAvailable, Points: NotAvailable, Sprite: NotAvailable, SkinnedMesh: NotAvailable, LOD: NotAvailable, MeshPhongMaterial: NotAvailable, MeshPhysicalMaterial: NotAvailable, MeshToonMaterial: NotAvailable, MeshNormalMaterial: NotAvailable, ShaderMaterial: NotAvailable, PointsMaterial: NotAvailable, SpriteMaterial: NotAvailable, IcosahedronGeometry: NotAvailable, CapsuleGeometry: NotAvailable, AnimationMixer: NotAvailable, CubeTextureLoader: NotAvailable, ObjectLoader: NotAvailable;

export interface Intersection {

	distance: number;
	point: Vector3;
	object: Object3D;
	/** For a line: where the segment that was hit starts. */
	index?: number;
	/** `null` for a line. */
	faceIndex: number | null;
	face: { a: number; b: number; c: number; normal: Vector3; materialIndex: number } | null;
	barycoord: Vector3 | null;
	uv?: Vector2;
	normal?: Vector3;

}

export class Raycaster {

	constructor( origin?: Vector3, direction?: Vector3, near?: number, far?: number );
	ray: Ray;
	near: number;
	far: number;
	camera: Camera | null;
	/** `Line.threshold` is how close, in world units, the ray must pass to a line to hit it. */
	params: { Mesh: object; Line: { threshold: number }; LOD: object; Points: { threshold: number }; Sprite: object };
	set( origin: Vec3Like, direction: Vec3Like ): void;
	setFromCamera( coords: { x: number; y: number }, camera: Camera ): void;
	intersectObject( object: Object3D, recursive?: boolean, intersects?: Intersection[] ): Intersection[];
	intersectObjects( objects: Object3D[], recursive?: boolean, intersects?: Intersection[] ): Intersection[];

}

export interface WebGPURendererParameters {

	canvas?: HTMLCanvasElement;
	antialias?: boolean;
	powerPreference?: 'high-performance' | 'low-power';

}

/** Draws a scene with WebGPU. `await renderer.init()` before the first `render`. */
export class WebGPURenderer {

	constructor( parameters?: WebGPURendererParameters );
	readonly isWebGPURenderer: true;
	domElement: HTMLCanvasElement;
	info: { render: { calls: number; triangles: number }; memory: { geometries: number } };
	init(): Promise<this>;
	getPixelRatio(): number;
	setPixelRatio( value: number ): void;
	setSize( width: number, height: number, updateStyle?: boolean ): void;
	getSize( target: Vector2 ): Vector2;
	setClearColor( color: ColorRepresentation ): void;
	getClearColor( target: Color ): Color;
	render( scene: Scene, camera: Camera ): void;
	renderAsync( scene: Scene, camera: Camera ): Promise<void>;
	setAnimationLoop( callback: ( ( time: number ) => void ) | null ): void;
	dispose(): void;

}
