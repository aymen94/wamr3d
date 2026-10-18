// glTF constants, cubic-spline interpolants and accessor helpers.
//
// Part of the GLTFLoader add-on (`../GLTFLoader.js`).

import { Interpolant, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, LinearFilter, NearestMipmapNearestFilter, LinearMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapLinearFilter } from '../../../compat.js';

export const BINARY_MAGIC = 0x46546C67, CHUNK_JSON = 0x4E4F534A, CHUNK_BIN = 0x004E4942;
export const COMPONENT_TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
export const TYPE_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
export const ATTRIBUTES = { POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', TEXCOORD_2: 'uv2', TEXCOORD_3: 'uv3', COLOR_0: 'color', WEIGHTS_0: 'skinWeight', JOINTS_0: 'skinIndex' };
export const WRAPPINGS = { 33071: ClampToEdgeWrapping, 33648: MirroredRepeatWrapping, 10497: RepeatWrapping };
export const FILTERS = { 9728: NearestFilter, 9729: LinearFilter, 9984: NearestMipmapNearestFilter, 9985: LinearMipmapNearestFilter, 9986: NearestMipmapLinearFilter, 9987: LinearMipmapLinearFilter };
export const PATH_PROPERTIES = { scale: 'scale', translation: 'position', rotation: 'quaternion', weights: 'morphTargetInfluences' };

// ---------------------------------------------------------------- cubic spline

// glTF cubic-spline keys hold in-tangent, value and out-tangent; tangents scale with the
// key interval.
export class GLTFCubicSplineInterpolant extends Interpolant {

	copySampleValue_( index ) {

		const result = this.resultBuffer, values = this.sampleValues, size = this.valueSize, offset = index * size * 3 + size;
		for ( let i = 0; i !== size; i ++ ) result[ i ] = values[ offset + i ];
		return result;

	}

	interpolate_( i1, t0, t, t1 ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, stride2 = stride * 2, stride3 = stride * 3;
		const td = t1 - t0, p = ( t - t0 ) / td, pp = p * p, ppp = pp * p;
		const offset1 = i1 * stride3, offset0 = offset1 - stride3;
		const s2 = - 2 * ppp + 3 * pp, s3 = ppp - pp, s0 = 1 - s2, s1 = s3 - pp + p;

		for ( let i = 0; i !== stride; i ++ ) {

			const p0 = values[ offset0 + i + stride ], m0 = values[ offset0 + i + stride2 ] * td;
			const p1 = values[ offset1 + i + stride ], m1 = values[ offset1 + i ] * td;
			result[ i ] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;

		}

		return result;

	}

}

export class GLTFCubicSplineQuaternionInterpolant extends GLTFCubicSplineInterpolant {

	interpolate_( i1, t0, t, t1 ) {

		const result = super.interpolate_( i1, t0, t, t1 );
		const length = Math.hypot( result[ 0 ], result[ 1 ], result[ 2 ], result[ 3 ] ) || 1;
		for ( let i = 0; i < 4; i ++ ) result[ i ] /= length;
		return result;

	}

}

// Floats of an accessor, normalized integers mapped to 0..1 or -1..1.
export function denormalized( attribute ) {

	const array = attribute.isInterleavedBufferAttribute ? attribute.clone().array : attribute.array;
	if ( array instanceof Float32Array ) return array;
	const scale = { Int8Array: 127, Uint8Array: 255, Int16Array: 32767, Uint16Array: 65535 }[ array.constructor.name ] ?? 1;
	const out = new Float32Array( array.length );
	for ( let i = 0; i < array.length; i ++ ) out[ i ] = attribute.normalized ? Math.max( array[ i ] / scale, - 1 ) : array[ i ];
	return out;

}

// Triangle strips (5) and fans (6) as a triangle list.
export function toTriangles( geometry, mode ) {

	let index = geometry.getIndex();

	if ( index === null ) {

		const count = geometry.attributes.position.count;
		geometry.setIndex( Array.from( { length: count }, ( _, i ) => i ) );
		index = geometry.getIndex();

	}

	const source = index.array, list = [];

	if ( mode === 6 ) {

		for ( let i = 1; i < source.length - 1; i ++ ) list.push( source[ 0 ], source[ i ], source[ i + 1 ] );

	} else {

		for ( let i = 0; i < source.length - 2; i ++ ) {

			if ( i % 2 === 0 ) list.push( source[ i ], source[ i + 1 ], source[ i + 2 ] );
			else list.push( source[ i + 2 ], source[ i + 1 ], source[ i ] );

		}

	}

	geometry.setIndex( list );

}

// A node used twice gets a copy of its mesh (geometry and materials shared).
export function cloneObject( object ) {

	return object.clone();

}
