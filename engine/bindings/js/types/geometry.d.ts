// Buffer attributes, interleaved buffers and the built-in geometries.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { Matrix4, Vector2 } from './vectors.js';
import { Box3, Sphere } from './shapes.js';
import { AttributeAccessors, NumberArray } from './objects.js';

/** The engine stores attributes as floats; integer arrays marked `normalized` are converted to 0..1 (or -1..1). */
export interface BufferAttribute extends AttributeAccessors {}
export class BufferAttribute {

	constructor( array: NumberArray, itemSize: number, normalized?: boolean );
	readonly isBufferAttribute: true;
	name: string;
	array: NumberArray;
	itemSize: number;
	normalized: boolean;
	count: number;
	version: number;
	/** Set to true after changing `array` to send the new data to the engine. */
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;
	clone(): this;

}

export class Float32BufferAttribute extends BufferAttribute {}
export class Int8BufferAttribute extends BufferAttribute {}
export class Uint8BufferAttribute extends BufferAttribute {}
export class Uint8ClampedBufferAttribute extends BufferAttribute {}
export class Int16BufferAttribute extends BufferAttribute {}
export class Uint16BufferAttribute extends BufferAttribute {}
export class Int32BufferAttribute extends BufferAttribute {}
export class Uint32BufferAttribute extends BufferAttribute {}

/** Attributes packed in one array, `stride` numbers per vertex. Each attribute is copied out to the engine; `needsUpdate` sends them all again. */
export class InterleavedBuffer {

	constructor( array: NumberArray, stride: number );
	readonly isInterleavedBuffer: true;
	array: NumberArray;
	stride: number;
	count: number;
	version: number;
	set needsUpdate( value: boolean );
	setUsage( usage: number ): this;
	set( value: ArrayLike<number>, offset?: number ): this;
	clone(): InterleavedBuffer;

}

export interface InterleavedBufferAttribute extends AttributeAccessors {}
export class InterleavedBufferAttribute {

	constructor( interleavedBuffer: InterleavedBuffer, itemSize: number, offset: number, normalized?: boolean );
	readonly isInterleavedBufferAttribute: true;
	name: string;
	data: InterleavedBuffer;
	itemSize: number;
	offset: number;
	normalized: boolean;
	readonly count: number;
	readonly array: NumberArray;
	set needsUpdate( value: boolean );
	/** A plain `BufferAttribute` with this attribute's values. */
	clone(): BufferAttribute;

}

export class BufferGeometry {

	readonly isBufferGeometry: true;
	readonly handle: bigint;
	/** Made on first read. */
	uuid: string;
	type: string;
	name: string;
	attributes: Record<string, BufferAttribute | InterleavedBufferAttribute>;
	index: BufferAttribute | null;
	drawRange: { start: number; count: number };
	groups: { start: number; count: number; materialIndex: number }[];
	boundingBox: Box3 | null;
	boundingSphere: Sphere | null;
	userData: Record<string, any>;

	setAttribute( name: string, attribute: BufferAttribute | InterleavedBufferAttribute ): this;
	getAttribute( name: string ): BufferAttribute | InterleavedBufferAttribute | undefined;
	hasAttribute( name: string ): boolean;
	deleteAttribute( name: string ): this;
	setFromPoints( points: { x: number; y: number; z?: number }[] ): this;
	setIndex( index: BufferAttribute | NumberArray ): this;
	getIndex(): BufferAttribute | null;
	addGroup( start: number, count: number, materialIndex?: number ): void;
	clearGroups(): void;
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
	/** Copies attributes (as new arrays), index, groups, draw range, bounding volumes and `userData`. */
	copy( source: BufferGeometry ): this;
	/** Built-in shapes are rebuilt from `parameters` and keep their class. */
	clone(): this;
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

/** Triangles `indices` over the xyz `vertices`, subdivided `detail` times and pushed out to `radius`. Not indexed: flat normals at detail 0, smooth otherwise. */
export class PolyhedronGeometry extends BufferGeometry {

	constructor( vertices?: ArrayLike<number>, indices?: ArrayLike<number>, radius?: number, detail?: number );

}

export class TetrahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class OctahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class DodecahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class IcosahedronGeometry extends BufferGeometry {

	constructor( radius?: number, detail?: number );

}

export class TorusKnotGeometry extends BufferGeometry {

	constructor( radius?: number, tube?: number, tubularSegments?: number, radialSegments?: number, p?: number, q?: number );

}

/** Turns the profile `points` (x from the axis, y along it) around the y-axis. */
export class LatheGeometry extends BufferGeometry {

	constructor( points?: Vector2[], segments?: number, phiStart?: number, phiLength?: number );

}

export class CapsuleGeometry extends BufferGeometry {

	constructor( radius?: number, height?: number, capSegments?: number, radialSegments?: number, heightSegments?: number );

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
export const UVMapping: 300, CubeReflectionMapping: 301, CubeRefractionMapping: 302;
export const EquirectangularReflectionMapping: 303, EquirectangularRefractionMapping: 304, CubeUVReflectionMapping: 306;
