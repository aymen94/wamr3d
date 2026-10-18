// Loaders, audio, helpers and picking.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { ColorRepresentation, Vec3Like } from './core.js';
import { Vector2, Vector3 } from './vectors.js';
import { Box3, Color, Plane, Ray } from './shapes.js';
import { Camera, DirectionalLight, HemisphereLight, LOD, Line, LineSegments, Mesh, Object3D, PointLight, SpotLight } from './objects.js';
import { BufferGeometry } from './geometry.js';
import { CubeTexture, DataTexture, Material, Texture } from './materials.js';
import { Points, Sprite } from './rendering.js';
import { Bone } from './extras.js';
import { AnimationClip } from './animation.js';

// ---------------------------------------------------------------- loaders

export const Cache: { enabled: boolean; files: Record<string, any>; add( key: string, file: any ): void; get( key: string ): any; remove( key: string ): void; clear(): void };

export class LoadingManager {
	constructor( onLoad?: () => void, onProgress?: ( url: string, loaded: number, total: number ) => void, onError?: ( url: string ) => void );
	onStart?: ( url: string, loaded: number, total: number ) => void;
	onLoad?: () => void;
	onProgress?: ( url: string, loaded: number, total: number ) => void;
	onError?: ( url: string ) => void;
	itemStart( url: string ): void;
	itemEnd( url: string ): void;
	itemError( url: string ): void;
	resolveURL( url: string ): string;
	setURLModifier( callback?: ( url: string ) => string ): this;
	addHandler( regex: RegExp, loader: Loader ): this;
	removeHandler( regex: RegExp ): this;
	getHandler( file: string ): Loader | null;
	abort(): this;
}

export const DefaultLoadingManager: LoadingManager;

export class Loader<T = unknown> {
	constructor( manager?: LoadingManager );
	manager: LoadingManager;
	crossOrigin: string;
	withCredentials: boolean;
	path: string;
	resourcePath: string;
	requestHeader: Record<string, string>;
	load( url: string, onLoad?: ( data: T ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): any;
	loadAsync( url: string, onProgress?: ( event: ProgressEvent ) => void ): Promise<T>;
	setCrossOrigin( crossOrigin: string ): this;
	setWithCredentials( value: boolean ): this;
	setPath( path: string ): this;
	setResourcePath( resourcePath: string ): this;
	setRequestHeader( requestHeader: Record<string, string> ): this;
	abort(): this;
	static DEFAULT_MATERIAL_NAME: string;
}

export const LoaderUtils: { extractUrlBase( url: string ): string; resolveURL( url: string, path: string ): string };

export class FileLoader extends Loader<string | ArrayBuffer | any> {
	mimeType: string;
	responseType: '' | 'arraybuffer' | 'blob' | 'document' | 'json' | 'text';
	setResponseType( value: string ): this;
	setMimeType( value: string ): this;
}

export class ImageLoader extends Loader<HTMLImageElement> {}
export class ImageBitmapLoader extends Loader<ImageBitmap> { setOptions( options: ImageBitmapOptions ): this; }
export class TextureLoader extends Loader<Texture> { load( url: string, onLoad?: ( texture: Texture ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): Texture; }
export class CubeTextureLoader extends Loader<CubeTexture> { load( urls: string | string[], onLoad?: ( texture: CubeTexture ) => void, onProgress?: ( event: ProgressEvent ) => void, onError?: ( error: unknown ) => void ): CubeTexture; }
export class DataTextureLoader extends Loader<DataTexture> { parse( buffer: ArrayBuffer ): any; }
export class AnimationLoader extends Loader<AnimationClip[]> { parse( json: any ): AnimationClip[]; }
export class BufferGeometryLoader extends Loader<BufferGeometry> { parse( json: any ): BufferGeometry; }
export class MaterialLoader extends Loader<Material> { textures: Record<string, Texture>; setTextures( textures: Record<string, Texture> ): this; parse( json: any ): Material; static createMaterialFromType( type: string ): Material; }
export class ObjectLoader extends Loader<Object3D> { parse( json: any, onLoad?: ( object: Object3D ) => void ): void; parseAsync( json: any ): Promise<Object3D>; }

// ---------------------------------------------------------------- audio

export const AudioContext: { getContext(): globalThis.AudioContext; setContext( context: globalThis.AudioContext ): void };

export class AudioListener extends Object3D {
	context: globalThis.AudioContext;
	gain: GainNode;
	filter: AudioNode | null;
	timeDelta: number;
	getInput(): GainNode;
	removeFilter(): this;
	getFilter(): AudioNode | null;
	setFilter( value: AudioNode ): this;
	getMasterVolume(): number;
	setMasterVolume( value: number ): this;
}

export class Audio<N extends AudioNode = GainNode> extends Object3D {
	constructor( listener: AudioListener );
	listener: AudioListener;
	context: globalThis.AudioContext;
	gain: GainNode;
	autoplay: boolean;
	buffer: AudioBuffer | null;
	detune: number;
	loop: boolean;
	loopStart: number;
	loopEnd: number;
	offset: number;
	duration: number | undefined;
	playbackRate: number;
	isPlaying: boolean;
	hasPlaybackControl: boolean;
	sourceType: string;
	source: AudioNode | null;
	filters: AudioNode[];
	getOutput(): N;
	setNodeSource( audioNode: AudioNode ): this;
	setMediaElementSource( mediaElement: HTMLMediaElement ): this;
	setMediaStreamSource( mediaStream: MediaStream ): this;
	setBuffer( audioBuffer: AudioBuffer ): this;
	play( delay?: number ): this | undefined;
	pause(): this | undefined;
	stop( delay?: number ): this | undefined;
	connect(): this;
	disconnect(): this | undefined;
	getFilters(): AudioNode[];
	setFilters( value: AudioNode[] ): this;
	setDetune( value: number ): this;
	getDetune(): number;
	getFilter(): AudioNode;
	setFilter( filter: AudioNode ): this;
	setPlaybackRate( value: number ): this | undefined;
	getPlaybackRate(): number;
	onEnded(): void;
	getLoop(): boolean;
	setLoop( value: boolean ): this | undefined;
	setLoopStart( value: number ): this;
	setLoopEnd( value: number ): this;
	getVolume(): number;
	setVolume( value: number ): this;
}

export class PositionalAudio extends Audio<PannerNode> {
	panner: PannerNode;
	getRefDistance(): number;
	setRefDistance( value: number ): this;
	getRolloffFactor(): number;
	setRolloffFactor( value: number ): this;
	getDistanceModel(): string;
	setDistanceModel( value: DistanceModelType ): this;
	getMaxDistance(): number;
	setMaxDistance( value: number ): this;
	setDirectionalCone( coneInnerAngle: number, coneOuterAngle: number, coneOuterGain: number ): this;
}

export class AudioAnalyser {
	constructor( audio: Audio<any>, fftSize?: number );
	analyser: AnalyserNode;
	data: Uint8Array;
	getFrequencyData(): Uint8Array;
	getAverageFrequency(): number;
}

export class AudioLoader extends Loader<AudioBuffer> {}

// ---------------------------------------------------------------- helpers

export class ArrowHelper extends Object3D {
	constructor( dir?: Vector3, origin?: Vector3, length?: number, color?: ColorRepresentation, headLength?: number, headWidth?: number );
	line: Line;
	cone: Mesh;
	setDirection( dir: Vector3 ): void;
	setLength( length: number, headLength?: number, headWidth?: number ): void;
	setColor( color: ColorRepresentation ): void;
	dispose(): void;
}
export class BoxHelper extends LineSegments { constructor( object?: Object3D, color?: ColorRepresentation ); update(): void; setFromObject( object: Object3D ): this; }
export class Box3Helper extends LineSegments { constructor( box: Box3, color?: ColorRepresentation ); box: Box3; }
export class PlaneHelper extends Line { constructor( plane: Plane, size?: number, hex?: ColorRepresentation ); plane: Plane; size: number; }
export class CameraHelper extends LineSegments { constructor( camera: Camera ); camera: Camera; update(): void; setColors( frustum: Color, cone: Color, up: Color, target: Color, cross: Color ): this; }
export class DirectionalLightHelper extends Object3D { constructor( light: DirectionalLight, size?: number, color?: ColorRepresentation ); light: DirectionalLight; update(): void; dispose(): void; }
export class PointLightHelper extends Mesh { constructor( light: PointLight, sphereSize?: number, color?: ColorRepresentation ); light: PointLight; update(): void; }
export class SpotLightHelper extends Object3D { constructor( light: SpotLight, color?: ColorRepresentation ); light: SpotLight; update(): void; dispose(): void; }
export class HemisphereLightHelper extends Object3D { constructor( light: HemisphereLight, size: number, color?: ColorRepresentation ); light: HemisphereLight; update(): void; dispose(): void; }
export class PolarGridHelper extends LineSegments { constructor( radius?: number, sectors?: number, rings?: number, divisions?: number, color1?: ColorRepresentation, color2?: ColorRepresentation ); }
export class SkeletonHelper extends LineSegments { constructor( object: Object3D ); root: Object3D; bones: Bone[]; setColors( color1: Color, color2: Color ): this; }

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
	/** For an `InstancedMesh`: the instance that was hit. */
	instanceId?: number;

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
