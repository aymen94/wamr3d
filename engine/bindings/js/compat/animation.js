// Keyframe animation: tracks, clips, the mixer and its actions, and the bindings that
// write animated values into objects, materials and bones. All of it runs in JavaScript;
// transforms written by the mixer reach the engine in the next batched update.

import * as W from '../index.js';
import { AdditiveAnimationBlendMode, InterpolateBezier, InterpolateDiscrete, InterpolateLinear, InterpolateSmooth, LoopOnce, LoopPingPong, LoopRepeat, NormalAnimationBlendMode, WrapAroundEnding, ZeroCurvatureEnding, ZeroSlopeEnding } from './constants.js';
import { EventDispatcher } from './events.js';
import { Quaternion } from './values.js';

const isTypedArray = ( object ) => ArrayBuffer.isView( object ) && ! ( object instanceof DataView );

// ---------------------------------------------------------------- interpolants

/** Samples `sampleValues` (`sampleSize` per key) at a time between the `parameterPositions`. */
export class Interpolant {

	constructor( parameterPositions, sampleValues, sampleSize, resultBuffer ) {

		this.parameterPositions = parameterPositions;
		this._cachedIndex = 0;
		this.resultBuffer = resultBuffer !== undefined ? resultBuffer : new sampleValues.constructor( sampleSize );
		this.sampleValues = sampleValues;
		this.valueSize = sampleSize;
		this.settings = null;
		this.DefaultSettings_ = {};

	}

	// Finds the interval around `t`, starting from the last one: a short linear scan
	// either way covers playback, a binary search covers jumps.
	evaluate( t ) {

		const pp = this.parameterPositions;
		let i1 = this._cachedIndex, t1 = pp[ i1 ], t0 = pp[ i1 - 1 ];

		validate_interval: {

			seek: {

				let right;

				linear_scan: {

					forward_scan: if ( ! ( t < t1 ) ) {

						for ( let giveUpAt = i1 + 2; ; ) {

							if ( t1 === undefined ) {

								if ( t < t0 ) break forward_scan;
								// after the end
								i1 = pp.length;
								this._cachedIndex = i1;
								return this.copySampleValue_( i1 - 1 );

							}

							if ( i1 === giveUpAt ) break;
							t0 = t1;
							t1 = pp[ ++ i1 ];
							if ( t < t1 ) break seek;

						}

						right = pp.length;
						break linear_scan;

					}

					if ( ! ( t >= t0 ) ) {

						const t1global = pp[ 1 ];

						if ( t < t1global ) {

							i1 = 2;
							t0 = t1global;

						}

						for ( let giveUpAt = i1 - 2; ; ) {

							if ( t0 === undefined ) {

								// before the start
								this._cachedIndex = 0;
								return this.copySampleValue_( 0 );

							}

							if ( i1 === giveUpAt ) break;
							t1 = t0;
							t0 = pp[ -- i1 - 1 ];
							if ( t >= t0 ) break seek;

						}

						right = i1;
						i1 = 0;
						break linear_scan;

					}

					break validate_interval;

				}

				while ( i1 < right ) {

					const mid = ( i1 + right ) >>> 1;
					if ( t < pp[ mid ] ) right = mid;
					else i1 = mid + 1;

				}

				t1 = pp[ i1 ];
				t0 = pp[ i1 - 1 ];

				if ( t0 === undefined ) {

					this._cachedIndex = 0;
					return this.copySampleValue_( 0 );

				}

				if ( t1 === undefined ) {

					i1 = pp.length;
					this._cachedIndex = i1;
					return this.copySampleValue_( i1 - 1 );

				}

			}

			this._cachedIndex = i1;
			this.intervalChanged_( i1, t0, t1 );

		}

		return this.interpolate_( i1, t0, t, t1 );

	}

	getSettings_() {

		return this.settings || this.DefaultSettings_;

	}

	copySampleValue_( index ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, offset = index * stride;
		for ( let i = 0; i !== stride; ++ i ) result[ i ] = values[ offset + i ];
		return result;

	}

	interpolate_() {

		throw new Error( 'WAMR3D: Interpolant: call to abstract method' );

	}

	intervalChanged_() {}

}

export class DiscreteInterpolant extends Interpolant {

	interpolate_( i1 ) {

		return this.copySampleValue_( i1 - 1 );

	}

}

export class LinearInterpolant extends Interpolant {

	interpolate_( i1, t0, t, t1 ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize;
		const offset1 = i1 * stride, offset0 = offset1 - stride, weight1 = ( t - t0 ) / ( t1 - t0 ), weight0 = 1 - weight1;
		for ( let i = 0; i !== stride; ++ i ) result[ i ] = values[ offset0 + i ] * weight0 + values[ offset1 + i ] * weight1;
		return result;

	}

}

export class QuaternionLinearInterpolant extends Interpolant {

	interpolate_( i1, t0, t, t1 ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize, alpha = ( t - t0 ) / ( t1 - t0 );
		let offset = i1 * stride;
		for ( let end = offset + stride; offset !== end; offset += 4 ) Quaternion.slerpFlat( result, 0, values, offset - stride, values, offset, alpha );
		return result;

	}

}

/** Cubic Hermite spline through the keys; the slopes at the first and last key follow `settings.endingStart` and `endingEnd`. */
export class CubicInterpolant extends Interpolant {

	constructor( parameterPositions, sampleValues, sampleSize, resultBuffer ) {

		super( parameterPositions, sampleValues, sampleSize, resultBuffer );
		this._weightPrev = - 0;
		this._offsetPrev = - 0;
		this._weightNext = - 0;
		this._offsetNext = - 0;
		this.DefaultSettings_ = { endingStart: ZeroCurvatureEnding, endingEnd: ZeroCurvatureEnding };

	}

	intervalChanged_( i1, t0, t1 ) {

		const pp = this.parameterPositions;
		let iPrev = i1 - 2, iNext = i1 + 1, tPrev = pp[ iPrev ], tNext = pp[ iNext ];

		if ( tPrev === undefined ) {

			switch ( this.getSettings_().endingStart ) {

				case ZeroSlopeEnding:
					iPrev = i1;
					tPrev = 2 * t0 - t1;
					break;
				case WrapAroundEnding:
					iPrev = pp.length - 2;
					tPrev = t0 + pp[ iPrev ] - pp[ iPrev + 1 ];
					break;
				default:
					iPrev = i1;
					tPrev = t1;

			}

		}

		if ( tNext === undefined ) {

			switch ( this.getSettings_().endingEnd ) {

				case ZeroSlopeEnding:
					iNext = i1;
					tNext = 2 * t1 - t0;
					break;
				case WrapAroundEnding:
					iNext = 1;
					tNext = t1 + pp[ 1 ] - pp[ 0 ];
					break;
				default:
					iNext = i1 - 1;
					tNext = t0;

			}

		}

		const halfDt = ( t1 - t0 ) * 0.5, stride = this.valueSize;
		this._weightPrev = halfDt / ( t0 - tPrev );
		this._weightNext = halfDt / ( tNext - t1 );
		this._offsetPrev = iPrev * stride;
		this._offsetNext = iNext * stride;

	}

	interpolate_( i1, t0, t, t1 ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize;
		const o1 = i1 * stride, o0 = o1 - stride, oP = this._offsetPrev, oN = this._offsetNext, wP = this._weightPrev, wN = this._weightNext;
		const p = ( t - t0 ) / ( t1 - t0 ), pp = p * p, ppp = pp * p;
		const sP = - wP * ppp + 2 * wP * pp - wP * p;
		const s0 = ( 1 + wP ) * ppp + ( - 1.5 - 2 * wP ) * pp + ( - 0.5 + wP ) * p + 1;
		const s1 = ( - 1 - wN ) * ppp + ( 1.5 + wN ) * pp + 0.5 * p;
		const sN = wN * ppp - wN * pp;
		for ( let i = 0; i !== stride; ++ i ) result[ i ] = sP * values[ oP + i ] + s0 * values[ o0 + i ] + s1 * values[ o1 + i ] + sN * values[ oN + i ];
		return result;

	}

}

function cubicBezier( s, p0, p1, p2, p3 ) {

	const k = 1 - s;
	return k * k * k * p0 + 3 * k * k * s * p1 + 3 * k * s * s * p2 + s * s * s * p3;

}

function cubicBezierSlope( s, p0, p1, p2, p3 ) {

	const k = 1 - s;
	return 3 * k * k * ( p1 - p0 ) + 6 * k * s * ( p2 - p1 ) + 3 * s * s * ( p3 - p2 );

}

// The Bezier parameter whose time is `x`, by Newton steps from the linear guess.
function solveBezierParameter( x, x0, x1, x2, x3 ) {

	let s = ( x - x0 ) / ( x3 - x0 );

	for ( let i = 0; i < 8; i ++ ) {

		const error = cubicBezier( s, x0, x1, x2, x3 ) - x;
		if ( Math.abs( error ) < 1e-10 ) break;
		const slope = cubicBezierSlope( s, x0, x1, x2, x3 );
		if ( Math.abs( slope ) < 1e-10 ) break;
		s = Math.max( 0, Math.min( 1, s - error / slope ) );

	}

	return s;

}

/** Bezier segments with (time, value) tangent handles per key and component; linear without tangents. */
export class BezierInterpolant extends Interpolant {

	interpolate_( i1, t0, t, t1 ) {

		const result = this.resultBuffer, values = this.sampleValues, stride = this.valueSize;
		const offset1 = i1 * stride, offset0 = offset1 - stride, inTangents = this.inTangents, outTangents = this.outTangents;

		if ( ! inTangents || ! outTangents ) {

			const weight1 = ( t - t0 ) / ( t1 - t0 ), weight0 = 1 - weight1;
			for ( let i = 0; i !== stride; ++ i ) result[ i ] = values[ offset0 + i ] * weight0 + values[ offset1 + i ] * weight1;
			return result;

		}

		const tangentStride = stride * 2, i0 = i1 - 1;

		for ( let i = 0; i !== stride; ++ i ) {

			const out = i0 * tangentStride + i * 2, into = i1 * tangentStride + i * 2;
			const s = solveBezierParameter( t, t0, outTangents[ out ], inTangents[ into ], t1 );
			result[ i ] = cubicBezier( s, values[ offset0 + i ], outTangents[ out + 1 ], inTangents[ into + 1 ], values[ offset1 + i ] );

		}

		return result;

	}

}

// ---------------------------------------------------------------- AnimationUtils

function convertArray( array, type ) {

	if ( ! array || array.constructor === type ) return array;
	if ( typeof type.BYTES_PER_ELEMENT === 'number' ) return new type( array );
	return Array.prototype.slice.call( array );

}

function hasTangents( settings ) {

	return settings !== undefined && settings !== null && settings.inTangents !== undefined && settings.outTangents !== undefined;

}

function getKeyframeOrder( times ) {

	const result = Array.from( { length: times.length }, ( _, i ) => i );
	result.sort( ( i, j ) => times[ i ] - times[ j ] );
	return result;

}

function sortedArray( values, stride, order ) {

	const result = new values.constructor( values.length );

	for ( let i = 0, dst = 0; dst !== values.length; ++ i ) {

		const src = order[ i ] * stride;
		for ( let j = 0; j !== stride; ++ j ) result[ dst ++ ] = values[ src + j ];

	}

	return result;

}

function flattenJSON( jsonKeys, times, values, valuePropertyName ) {

	let i = 1, key = jsonKeys[ 0 ];
	while ( key !== undefined && key[ valuePropertyName ] === undefined ) key = jsonKeys[ i ++ ];
	if ( key === undefined ) return;
	let value = key[ valuePropertyName ];
	if ( value === undefined ) return;
	const push = Array.isArray( value ) ? ( v ) => values.push( ...v ) : value.toArray !== undefined ? ( v ) => v.toArray( values, values.length ) : ( v ) => values.push( v );

	do {

		value = key[ valuePropertyName ];

		if ( value !== undefined ) {

			times.push( key.time );
			push( value );

		}

		key = jsonKeys[ i ++ ];

	} while ( key !== undefined );

}

export const AnimationUtils = {

	convertArray,
	isTypedArray,
	hasTangents,
	getKeyframeOrder,
	sortedArray,
	flattenJSON,

	/** The keys of `sourceClip` from frame `startFrame` up to `endFrame`, shifted to start at 0. */
	subclip( sourceClip, name, startFrame, endFrame, fps = 30 ) {

		const clip = sourceClip.clone();
		clip.name = name;
		const tracks = [];

		for ( const track of clip.tracks ) {

			const valueSize = track.getValueSize(), times = [], values = [];

			for ( let j = 0; j < track.times.length; ++ j ) {

				const frame = track.times[ j ] * fps;
				if ( frame < startFrame || frame >= endFrame ) continue;
				times.push( track.times[ j ] );
				for ( let k = 0; k < valueSize; ++ k ) values.push( track.values[ j * valueSize + k ] );

			}

			if ( times.length === 0 ) continue;
			track.times = convertArray( times, track.times.constructor );
			track.values = convertArray( values, track.values.constructor );
			tracks.push( track );

		}

		clip.tracks = tracks;
		let minStartTime = Infinity;
		for ( const track of clip.tracks ) minStartTime = Math.min( minStartTime, track.times[ 0 ] );
		for ( const track of clip.tracks ) track.shift( - 1 * minStartTime );
		clip.resetDuration();
		return clip;

	},

	/** Makes `targetClip` relative to the pose of `referenceClip` at `referenceFrame`, for additive blending. */
	makeClipAdditive( targetClip, referenceFrame = 0, referenceClip = targetClip, fps = 30 ) {

		if ( fps <= 0 ) fps = 30;
		const referenceTime = referenceFrame / fps;

		for ( const referenceTrack of referenceClip.tracks ) {

			const type = referenceTrack.ValueTypeName;
			if ( type === 'bool' || type === 'string' ) continue;
			const targetTrack = targetClip.tracks.find( ( track ) => track.name === referenceTrack.name && track.ValueTypeName === type );
			if ( targetTrack === undefined ) continue;

			const referenceValueSize = referenceTrack.getValueSize(), targetValueSize = targetTrack.getValueSize();
			// glTF cubic splines store in-tangent, value, out-tangent per key
			const referenceOffset = referenceTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline ? referenceValueSize / 3 : 0;
			const targetOffset = targetTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline ? targetValueSize / 3 : 0;
			const lastIndex = referenceTrack.times.length - 1;
			let referenceValue;

			if ( referenceTime <= referenceTrack.times[ 0 ] ) {

				referenceValue = referenceTrack.values.slice( referenceOffset, referenceValueSize - referenceOffset );

			} else if ( referenceTime >= referenceTrack.times[ lastIndex ] ) {

				const start = lastIndex * referenceValueSize + referenceOffset;
				referenceValue = referenceTrack.values.slice( start, start + referenceValueSize - referenceOffset );

			} else {

				const interpolant = referenceTrack.createInterpolant();
				interpolant.evaluate( referenceTime );
				referenceValue = interpolant.resultBuffer.slice( referenceOffset, referenceValueSize - referenceOffset );

			}

			if ( type === 'quaternion' ) new Quaternion().fromArray( referenceValue ).normalize().conjugate().toArray( referenceValue );

			for ( let j = 0; j < targetTrack.times.length; ++ j ) {

				const valueStart = j * targetValueSize + targetOffset;

				if ( type === 'quaternion' ) {

					Quaternion.multiplyQuaternionsFlat( targetTrack.values, valueStart, referenceValue, 0, targetTrack.values, valueStart );

				} else {

					const valueEnd = targetValueSize - targetOffset * 2;
					for ( let k = 0; k < valueEnd; ++ k ) targetTrack.values[ valueStart + k ] -= referenceValue[ k ];

				}

			}

		}

		targetClip.blendMode = AdditiveAnimationBlendMode;
		return targetClip;

	}

};

// ---------------------------------------------------------------- tracks

function scaleTangentTimes( tangents, timeScale ) {

	for ( let i = 0; i < tangents.length; i += 2 ) tangents[ i ] *= timeScale;

}

/** Values of one property over time. `name` is a binding path such as `'bone.quaternion'` or `'.material.opacity'`. */
export class KeyframeTrack {

	constructor( name, times, values, interpolation ) {

		if ( name === undefined ) throw new Error( 'WAMR3D: KeyframeTrack: track name is undefined' );
		if ( times === undefined || times.length === 0 ) throw new Error( 'WAMR3D: KeyframeTrack: no keyframes in track named ' + name );
		this.name = name;
		this.times = convertArray( times, this.TimeBufferType );
		this.values = convertArray( values, this.ValueBufferType );
		this.setInterpolation( interpolation || this.DefaultInterpolation );

	}

	static toJSON( track ) {

		const trackType = track.constructor;
		let json;

		if ( trackType.toJSON !== this.toJSON ) {

			json = trackType.toJSON( track );

		} else {

			json = { name: track.name, times: convertArray( track.times, Array ), values: convertArray( track.values, Array ) };
			const interpolation = track.getInterpolation();
			if ( interpolation !== track.DefaultInterpolation ) json.interpolation = interpolation;
			if ( hasTangents( track.settings ) ) json.settings = { inTangents: convertArray( track.settings.inTangents, Array ), outTangents: convertArray( track.settings.outTangents, Array ) };

		}

		json.type = track.ValueTypeName;
		return json;

	}

	InterpolantFactoryMethodDiscrete( result ) {

		return new DiscreteInterpolant( this.times, this.values, this.getValueSize(), result );

	}

	InterpolantFactoryMethodLinear( result ) {

		return new LinearInterpolant( this.times, this.values, this.getValueSize(), result );

	}

	InterpolantFactoryMethodSmooth( result ) {

		return new CubicInterpolant( this.times, this.values, this.getValueSize(), result );

	}

	InterpolantFactoryMethodBezier( result ) {

		const interpolant = new BezierInterpolant( this.times, this.values, this.getValueSize(), result );

		if ( this.settings ) {

			interpolant.inTangents = this.settings.inTangents;
			interpolant.outTangents = this.settings.outTangents;

		}

		return interpolant;

	}

	setInterpolation( interpolation ) {

		const factories = {
			[ InterpolateDiscrete ]: this.InterpolantFactoryMethodDiscrete,
			[ InterpolateLinear ]: this.InterpolantFactoryMethodLinear,
			[ InterpolateSmooth ]: this.InterpolantFactoryMethodSmooth,
			[ InterpolateBezier ]: this.InterpolantFactoryMethodBezier
		};
		const factoryMethod = factories[ interpolation ];

		if ( factoryMethod === undefined ) {

			const message = 'unsupported interpolation for ' + this.ValueTypeName + ' keyframe track named ' + this.name;

			if ( this.createInterpolant === undefined ) {

				if ( interpolation !== this.DefaultInterpolation ) this.setInterpolation( this.DefaultInterpolation );
				else throw new Error( message );

			}

			console.warn( 'WAMR3D: KeyframeTrack:', message );
			return this;

		}

		this.createInterpolant = factoryMethod;
		return this;

	}

	getInterpolation() {

		switch ( this.createInterpolant ) {

			case this.InterpolantFactoryMethodDiscrete: return InterpolateDiscrete;
			case this.InterpolantFactoryMethodLinear: return InterpolateLinear;
			case this.InterpolantFactoryMethodSmooth: return InterpolateSmooth;
			case this.InterpolantFactoryMethodBezier: return InterpolateBezier;

		}

		return undefined;

	}

	getValueSize() {

		return this.values.length / this.times.length;

	}

	shift( timeOffset ) {

		if ( timeOffset !== 0 ) for ( let i = 0; i < this.times.length; ++ i ) this.times[ i ] += timeOffset;
		return this;

	}

	scale( timeScale ) {

		if ( timeScale !== 1 ) {

			for ( let i = 0; i < this.times.length; ++ i ) this.times[ i ] *= timeScale;

			if ( hasTangents( this.settings ) ) {

				scaleTangentTimes( this.settings.inTangents, timeScale );
				scaleTangentTimes( this.settings.outTangents, timeScale );

			}

		}

		return this;

	}

	/** Keeps the keys from `startTime` to `endTime`, at least one. */
	trim( startTime, endTime ) {

		const times = this.times, nKeys = times.length;
		let from = 0, to = nKeys - 1;
		while ( from !== nKeys && times[ from ] < startTime ) ++ from;
		while ( to !== - 1 && times[ to ] > endTime ) -- to;
		++ to;

		if ( from !== 0 || to !== nKeys ) {

			if ( from >= to ) {

				to = Math.max( to, 1 );
				from = to - 1;

			}

			const stride = this.getValueSize();
			this.times = times.slice( from, to );
			this.values = this.values.slice( from * stride, to * stride );

		}

		return this;

	}

	validate() {

		let valid = true;
		const valueSize = this.getValueSize();

		if ( valueSize - Math.floor( valueSize ) !== 0 ) {

			console.error( 'WAMR3D: KeyframeTrack: invalid value size in track.', this );
			valid = false;

		}

		const times = this.times, values = this.values;

		if ( times.length === 0 ) {

			console.error( 'WAMR3D: KeyframeTrack: track is empty.', this );
			valid = false;

		}

		let previous = null;

		for ( let i = 0; i !== times.length; i ++ ) {

			const current = times[ i ];

			if ( typeof current === 'number' && isNaN( current ) ) {

				console.error( 'WAMR3D: KeyframeTrack: time is not a valid number.', this, i, current );
				valid = false;
				break;

			}

			if ( previous !== null && previous > current ) {

				console.error( 'WAMR3D: KeyframeTrack: out of order keys.', this, i, current, previous );
				valid = false;
				break;

			}

			previous = current;

		}

		if ( values !== undefined && isTypedArray( values ) ) {

			for ( let i = 0; i !== values.length; ++ i ) {

				if ( isNaN( values[ i ] ) ) {

					console.error( 'WAMR3D: KeyframeTrack: value is not a valid number.', this, i, values[ i ] );
					valid = false;
					break;

				}

			}

		}

		return valid;

	}

	/** Removes keys equal to both neighbours (and duplicate times); smooth tracks keep every key. */
	optimize() {

		const times = this.times.slice(), values = this.values.slice(), stride = this.getValueSize();
		const smooth = this.getInterpolation() === InterpolateSmooth, lastIndex = times.length - 1;
		let writeIndex = 1;

		for ( let i = 1; i < lastIndex; ++ i ) {

			let keep = false;
			const time = times[ i ], timeNext = times[ i + 1 ];

			if ( time !== timeNext && ( i !== 1 || time !== times[ 0 ] ) ) {

				if ( ! smooth ) {

					const offset = i * stride, offsetP = offset - stride, offsetN = offset + stride;

					for ( let j = 0; j !== stride; ++ j ) {

						const value = values[ offset + j ];

						if ( value !== values[ offsetP + j ] || value !== values[ offsetN + j ] ) {

							keep = true;
							break;

						}

					}

				} else {

					keep = true;

				}

			}

			if ( keep ) {

				if ( i !== writeIndex ) {

					times[ writeIndex ] = times[ i ];
					for ( let j = 0; j !== stride; ++ j ) values[ writeIndex * stride + j ] = values[ i * stride + j ];

				}

				++ writeIndex;

			}

		}

		if ( lastIndex > 0 ) {

			times[ writeIndex ] = times[ lastIndex ];
			for ( let j = 0; j !== stride; ++ j ) values[ writeIndex * stride + j ] = values[ lastIndex * stride + j ];
			++ writeIndex;

		}

		if ( writeIndex !== times.length ) {

			this.times = times.slice( 0, writeIndex );
			this.values = values.slice( 0, writeIndex * stride );

		} else {

			this.times = times;
			this.values = values;

		}

		return this;

	}

	clone() {

		const track = new this.constructor( this.name, this.times.slice(), this.values.slice() );
		track.createInterpolant = this.createInterpolant;
		if ( hasTangents( this.settings ) ) track.settings = { inTangents: this.settings.inTangents.slice(), outTangents: this.settings.outTangents.slice() };
		return track;

	}

}

KeyframeTrack.prototype.ValueTypeName = '';
KeyframeTrack.prototype.TimeBufferType = Float32Array;
KeyframeTrack.prototype.ValueBufferType = Float32Array;
KeyframeTrack.prototype.DefaultInterpolation = InterpolateLinear;

export class BooleanKeyframeTrack extends KeyframeTrack {

	constructor( name, times, values ) {

		super( name, times, values );

	}

}

BooleanKeyframeTrack.prototype.ValueTypeName = 'bool';
BooleanKeyframeTrack.prototype.ValueBufferType = Array;
BooleanKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodLinear = undefined;
BooleanKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

export class ColorKeyframeTrack extends KeyframeTrack {}

ColorKeyframeTrack.prototype.ValueTypeName = 'color';

export class NumberKeyframeTrack extends KeyframeTrack {}

NumberKeyframeTrack.prototype.ValueTypeName = 'number';

export class QuaternionKeyframeTrack extends KeyframeTrack {

	InterpolantFactoryMethodLinear( result ) {

		return new QuaternionLinearInterpolant( this.times, this.values, this.getValueSize(), result );

	}

}

QuaternionKeyframeTrack.prototype.ValueTypeName = 'quaternion';
QuaternionKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

export class StringKeyframeTrack extends KeyframeTrack {

	constructor( name, times, values ) {

		super( name, times, values );

	}

}

StringKeyframeTrack.prototype.ValueTypeName = 'string';
StringKeyframeTrack.prototype.ValueBufferType = Array;
StringKeyframeTrack.prototype.DefaultInterpolation = InterpolateDiscrete;
StringKeyframeTrack.prototype.InterpolantFactoryMethodLinear = undefined;
StringKeyframeTrack.prototype.InterpolantFactoryMethodSmooth = undefined;

export class VectorKeyframeTrack extends KeyframeTrack {}

VectorKeyframeTrack.prototype.ValueTypeName = 'vector';

function trackTypeForValueTypeName( typeName ) {

	switch ( typeName.toLowerCase() ) {

		case 'scalar': case 'double': case 'float': case 'number': case 'integer': return NumberKeyframeTrack;
		case 'vector': case 'vector2': case 'vector3': case 'vector4': return VectorKeyframeTrack;
		case 'color': return ColorKeyframeTrack;
		case 'quaternion': return QuaternionKeyframeTrack;
		case 'bool': case 'boolean': return BooleanKeyframeTrack;
		case 'string': return StringKeyframeTrack;

	}

	throw new Error( 'WAMR3D: KeyframeTrack: unsupported typeName: ' + typeName );

}

function parseKeyframeTrack( json ) {

	if ( json.type === undefined ) throw new Error( 'WAMR3D: KeyframeTrack: track type undefined, can not parse' );
	const trackType = trackTypeForValueTypeName( json.type );

	if ( json.times === undefined ) {

		const times = [], values = [];
		flattenJSON( json.keys, times, values, 'value' );
		json.times = times;
		json.values = values;

	}

	const track = trackType.parse !== undefined ? trackType.parse( json ) : new trackType( json.name, json.times, json.values, json.interpolation );
	if ( hasTangents( json.settings ) ) track.settings = { inTangents: convertArray( json.settings.inTangents, Float32Array ), outTangents: convertArray( json.settings.outTangents, Float32Array ) };
	return track;

}

// ---------------------------------------------------------------- AnimationClip

/** A named set of tracks played together. `duration` -1 means the last key of any track. */
export class AnimationClip {

	constructor( name = '', duration = - 1, tracks = [], blendMode = NormalAnimationBlendMode ) {

		this.name = name;
		this.tracks = tracks;
		this.duration = duration;
		this.blendMode = blendMode;
		this.uuid = W.MathUtils.generateUUID();
		this.userData = {};
		if ( this.duration < 0 ) this.resetDuration();

	}

	static parse( json ) {

		const frameTime = 1.0 / ( json.fps || 1.0 );
		const tracks = json.tracks.map( ( track ) => parseKeyframeTrack( track ).scale( frameTime ) );
		const clip = new this( json.name, json.duration, tracks, json.blendMode );
		clip.uuid = json.uuid;
		clip.userData = JSON.parse( json.userData || '{}' );
		return clip;

	}

	static toJSON( clip ) {

		return { name: clip.name, duration: clip.duration, tracks: clip.tracks.map( ( track ) => KeyframeTrack.toJSON( track ) ), uuid: clip.uuid, blendMode: clip.blendMode, userData: JSON.stringify( clip.userData ) };

	}

	/** Plays the morph targets one after another, each at full weight on its frame. */
	static CreateFromMorphTargetSequence( name, morphTargetSequence, fps, noLoop ) {

		const n = morphTargetSequence.length, tracks = [];

		for ( let i = 0; i < n; i ++ ) {

			let times = [ ( i + n - 1 ) % n, i, ( i + 1 ) % n ], values = [ 0, 1, 0 ];
			const order = getKeyframeOrder( times );
			times = sortedArray( times, 1, order );
			values = sortedArray( values, 1, order );

			// the first target is also the last, for a seamless loop
			if ( ! noLoop && times[ 0 ] === 0 ) {

				times.push( n );
				values.push( values[ 0 ] );

			}

			tracks.push( new NumberKeyframeTrack( '.morphTargetInfluences[' + morphTargetSequence[ i ].name + ']', times, values ).scale( 1.0 / fps ) );

		}

		return new this( name, - 1, tracks );

	}

	static findByName( objectOrClipArray, name ) {

		let clips = objectOrClipArray;

		if ( ! Array.isArray( objectOrClipArray ) ) {

			const o = objectOrClipArray;
			clips = ( o.geometry && o.geometry.animations ) || o.animations;

		}

		for ( const clip of clips ) if ( clip.name === name ) return clip;
		return null;

	}

	/** One clip per name prefix of morph targets numbered like `walk001`, `walk002`. */
	static CreateClipsFromMorphTargetSequences( morphTargets, fps, noLoop ) {

		const byName = {}, pattern = /^([\w-]*?)([\d]+)$/;

		for ( const morphTarget of morphTargets ) {

			const parts = morphTarget.name.match( pattern );
			if ( parts && parts.length > 1 ) ( byName[ parts[ 1 ] ] ??= [] ).push( morphTarget );

		}

		return Object.keys( byName ).map( ( name ) => this.CreateFromMorphTargetSequence( name, byName[ name ], fps, noLoop ) );

	}

	resetDuration() {

		let duration = 0;
		for ( const track of this.tracks ) duration = Math.max( duration, track.times[ track.times.length - 1 ] );
		this.duration = duration;
		return this;

	}

	trim() {

		for ( const track of this.tracks ) track.trim( 0, this.duration );
		return this;

	}

	validate() {

		let valid = true;
		for ( const track of this.tracks ) valid = valid && track.validate();
		return valid;

	}

	optimize() {

		for ( const track of this.tracks ) track.optimize();
		return this;

	}

	clone() {

		const clip = new this.constructor( this.name, this.duration, this.tracks.map( ( track ) => track.clone() ), this.blendMode );
		clip.userData = JSON.parse( JSON.stringify( this.userData ) );
		return clip;

	}

	toJSON() {

		return this.constructor.toJSON( this );

	}

}

// ---------------------------------------------------------------- PropertyBinding

const RESERVED = '\\[\\]\\.:\\/';
const reservedRe = new RegExp( '[' + RESERVED + ']', 'g' );
const wordChar = '[^' + RESERVED + ']';
const wordCharOrDot = '[^' + RESERVED.replace( '\\.', '' ) + ']';
const directoryRe = /((?:WC+[\/:])*)/.source.replace( 'WC', wordChar );
const nodeRe = /(WCOD+)?/.source.replace( 'WCOD', wordCharOrDot );
const objectRe = /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace( 'WC', wordChar );
const propertyRe = /\.(WC+)(?:\[(.+)\])?/.source.replace( 'WC', wordChar );
const trackRe = new RegExp( '^' + directoryRe + nodeRe + objectRe + propertyRe + '$' );
const supportedObjectNames = [ 'material', 'materials', 'bones', 'map' ];

// One path bound in every object of an AnimationObjectGroup.
class Composite {

	constructor( targetGroup, path, parsedPath ) {

		this._targetGroup = targetGroup;
		this._bindings = targetGroup.subscribe_( path, parsedPath || PropertyBinding.parseTrackName( path ) );

	}

	getValue( array, offset ) {

		this.bind();
		const binding = this._bindings[ this._targetGroup.nCachedObjects_ ];
		if ( binding !== undefined ) binding.getValue( array, offset );

	}

	setValue( array, offset ) {

		const bindings = this._bindings;
		for ( let i = this._targetGroup.nCachedObjects_; i !== bindings.length; ++ i ) bindings[ i ].setValue( array, offset );

	}

	bind() {

		const bindings = this._bindings;
		for ( let i = this._targetGroup.nCachedObjects_; i !== bindings.length; ++ i ) bindings[ i ].bind();

	}

	unbind() {

		const bindings = this._bindings;
		for ( let i = this._targetGroup.nCachedObjects_; i !== bindings.length; ++ i ) bindings[ i ].unbind();

	}

}

const BINDING_DIRECT = 0, BINDING_ARRAY = 1, BINDING_ELEMENT = 2, BINDING_FROM_TO_ARRAY = 3;
const VERSION_NONE = 0, VERSION_NEEDS_UPDATE = 1, VERSION_MATRIX_WORLD = 2;

/** Reads and writes the property a track path names, below `rootNode`. Binds lazily on first use. */
export class PropertyBinding {

	constructor( rootNode, path, parsedPath ) {

		this.path = path;
		this.parsedPath = parsedPath || PropertyBinding.parseTrackName( path );
		this.node = PropertyBinding.findNode( rootNode, this.parsedPath.nodeName );
		this.rootNode = rootNode;
		this.getValue = this._getValue_unbound;
		this.setValue = this._setValue_unbound;

	}

	static create( root, path, parsedPath ) {

		return root && root.isAnimationObjectGroup ? new PropertyBinding.Composite( root, path, parsedPath ) : new PropertyBinding( root, path, parsedPath );

	}

	/** Spaces become underscores and the path's reserved characters are removed. */
	static sanitizeNodeName( name ) {

		return name.replace( /\s/g, '_' ).replace( reservedRe, '' );

	}

	static parseTrackName( trackName ) {

		const matches = trackRe.exec( trackName );
		if ( matches === null ) throw new Error( 'WAMR3D: PropertyBinding: cannot parse trackName: ' + trackName );
		const results = { nodeName: matches[ 2 ], objectName: matches[ 3 ], objectIndex: matches[ 4 ], propertyName: matches[ 5 ], propertyIndex: matches[ 6 ] };
		const lastDot = results.nodeName && results.nodeName.lastIndexOf( '.' );

		// 'node.material.opacity': the object name was read as part of the node name
		if ( lastDot !== undefined && lastDot !== - 1 ) {

			const objectName = results.nodeName.substring( lastDot + 1 );

			if ( supportedObjectNames.indexOf( objectName ) !== - 1 ) {

				results.nodeName = results.nodeName.substring( 0, lastDot );
				results.objectName = objectName;

			}

		}

		if ( results.propertyName === null || results.propertyName.length === 0 ) throw new Error( 'WAMR3D: PropertyBinding: can not parse propertyName from trackName: ' + trackName );
		return results;

	}

	static findNode( root, nodeName ) {

		if ( nodeName === undefined || nodeName === '' || nodeName === '.' || nodeName === - 1 || nodeName === root.name || nodeName === root.uuid ) return root;

		if ( root.skeleton ) {

			const bone = root.skeleton.getBoneByName( nodeName );
			if ( bone !== undefined ) return bone;

		}

		if ( root.children ) {

			const search = ( children ) => {

				for ( const child of children ) {

					if ( child.name === nodeName || child.uuid === nodeName ) return child;
					const found = search( child.children );
					if ( found ) return found;

				}

				return null;

			};

			const found = search( root.children );
			if ( found ) return found;

		}

		return null;

	}

	_getValue_unavailable() {}

	_setValue_unavailable() {}

	_getValue_direct( buffer, offset ) {

		buffer[ offset ] = this.targetObject[ this.propertyName ];

	}

	_getValue_array( buffer, offset ) {

		const source = this.resolvedProperty;
		for ( let i = 0; i !== source.length; ++ i ) buffer[ offset ++ ] = source[ i ];

	}

	_getValue_arrayElement( buffer, offset ) {

		buffer[ offset ] = this.resolvedProperty[ this.propertyIndex ];

	}

	_getValue_toArray( buffer, offset ) {

		this.resolvedProperty.toArray( buffer, offset );

	}

	_setValue_direct( buffer, offset ) {

		this.targetObject[ this.propertyName ] = buffer[ offset ];

	}

	_setValue_direct_setNeedsUpdate( buffer, offset ) {

		this.targetObject[ this.propertyName ] = buffer[ offset ];
		this.targetObject.needsUpdate = true;

	}

	_setValue_direct_setMatrixWorldNeedsUpdate( buffer, offset ) {

		this.targetObject[ this.propertyName ] = buffer[ offset ];
		this.targetObject.matrixWorldNeedsUpdate = true;

	}

	_setValue_array( buffer, offset ) {

		const dest = this.resolvedProperty;
		for ( let i = 0; i !== dest.length; ++ i ) dest[ i ] = buffer[ offset ++ ];

	}

	_setValue_array_setNeedsUpdate( buffer, offset ) {

		this._setValue_array( buffer, offset );
		this.targetObject.needsUpdate = true;

	}

	_setValue_array_setMatrixWorldNeedsUpdate( buffer, offset ) {

		this._setValue_array( buffer, offset );
		this.targetObject.matrixWorldNeedsUpdate = true;

	}

	_setValue_arrayElement( buffer, offset ) {

		this.resolvedProperty[ this.propertyIndex ] = buffer[ offset ];

	}

	_setValue_arrayElement_setNeedsUpdate( buffer, offset ) {

		this.resolvedProperty[ this.propertyIndex ] = buffer[ offset ];
		this.targetObject.needsUpdate = true;

	}

	_setValue_arrayElement_setMatrixWorldNeedsUpdate( buffer, offset ) {

		this.resolvedProperty[ this.propertyIndex ] = buffer[ offset ];
		this.targetObject.matrixWorldNeedsUpdate = true;

	}

	_setValue_fromArray( buffer, offset ) {

		this.resolvedProperty.fromArray( buffer, offset );

	}

	_setValue_fromArray_setNeedsUpdate( buffer, offset ) {

		this.resolvedProperty.fromArray( buffer, offset );
		this.targetObject.needsUpdate = true;

	}

	_setValue_fromArray_setMatrixWorldNeedsUpdate( buffer, offset ) {

		this.resolvedProperty.fromArray( buffer, offset );
		this.targetObject.matrixWorldNeedsUpdate = true;

	}

	_getValue_unbound( targetArray, offset ) {

		this.bind();
		this.getValue( targetArray, offset );

	}

	_setValue_unbound( sourceArray, offset ) {

		this.bind();
		this.setValue( sourceArray, offset );

	}

	// Resolves the path to an object and property once, then picks the getter and setter
	// for that kind of property.
	bind() {

		let targetObject = this.node;
		const parsedPath = this.parsedPath, objectName = parsedPath.objectName, propertyName = parsedPath.propertyName;
		let propertyIndex = parsedPath.propertyIndex;

		if ( ! targetObject ) {

			targetObject = PropertyBinding.findNode( this.rootNode, parsedPath.nodeName );
			this.node = targetObject;

		}

		this.getValue = this._getValue_unavailable;
		this.setValue = this._setValue_unavailable;

		if ( ! targetObject ) {

			console.warn( 'WAMR3D: PropertyBinding: no target node found for track: ' + this.path + '.' );
			return;

		}

		if ( objectName ) {

			let objectIndex = parsedPath.objectIndex;

			switch ( objectName ) {

				case 'materials':
					if ( ! targetObject.material || ! targetObject.material.materials ) {

						console.error( 'WAMR3D: PropertyBinding: can not bind to material.materials.', this );
						return;

					}

					targetObject = targetObject.material.materials;
					break;

				case 'bones':
					if ( ! targetObject.skeleton ) {

						console.error( 'WAMR3D: PropertyBinding: can not bind to bones as node does not have a skeleton.', this );
						return;

					}

					targetObject = targetObject.skeleton.bones;

					// a bone may be named instead of numbered
					for ( let i = 0; i < targetObject.length; i ++ ) {

						if ( targetObject[ i ].name === objectIndex ) {

							objectIndex = i;
							break;

						}

					}

					break;

				case 'map':
					if ( 'map' in targetObject ) {

						targetObject = targetObject.map;
						break;

					}

					if ( ! targetObject.material || ! targetObject.material.map ) {

						console.error( 'WAMR3D: PropertyBinding: can not bind to material.map.', this );
						return;

					}

					targetObject = targetObject.material.map;
					break;

				default:
					if ( targetObject[ objectName ] === undefined ) {

						console.error( 'WAMR3D: PropertyBinding: can not bind to objectName of node undefined.', this );
						return;

					}

					targetObject = targetObject[ objectName ];

			}

			if ( objectIndex !== undefined ) {

				if ( targetObject[ objectIndex ] === undefined ) {

					console.error( 'WAMR3D: PropertyBinding: trying to bind to objectIndex of objectName, but is undefined.', this, targetObject );
					return;

				}

				targetObject = targetObject[ objectIndex ];

			}

		}

		const nodeProperty = targetObject[ propertyName ];

		if ( nodeProperty === undefined ) {

			console.error( 'WAMR3D: PropertyBinding: trying to update property for track: ' + parsedPath.nodeName + '.' + propertyName + " but it wasn't found.", targetObject );
			return;

		}

		this.targetObject = targetObject;
		const versioning = targetObject.isMaterial === true ? VERSION_NEEDS_UPDATE : targetObject.isObject3D === true ? VERSION_MATRIX_WORLD : VERSION_NONE;
		let bindingType = BINDING_DIRECT;

		if ( propertyIndex !== undefined ) {

			if ( propertyName === 'morphTargetInfluences' ) {

				if ( ! targetObject.geometry || ! targetObject.geometry.morphAttributes ) {

					console.error( 'WAMR3D: PropertyBinding: can not bind to morphTargetInfluences because node does not have a geometry with morphAttributes.', this );
					return;

				}

				if ( targetObject.morphTargetDictionary[ propertyIndex ] !== undefined ) propertyIndex = targetObject.morphTargetDictionary[ propertyIndex ];

			}

			bindingType = BINDING_ELEMENT;
			this.resolvedProperty = nodeProperty;
			this.propertyIndex = propertyIndex;

		} else if ( nodeProperty.fromArray !== undefined && nodeProperty.toArray !== undefined ) {

			bindingType = BINDING_FROM_TO_ARRAY;
			this.resolvedProperty = nodeProperty;

		} else if ( Array.isArray( nodeProperty ) ) {

			bindingType = BINDING_ARRAY;
			this.resolvedProperty = nodeProperty;

		} else {

			this.propertyName = propertyName;

		}

		this.getValue = this.GetterByBindingType[ bindingType ];
		this.setValue = this.SetterByBindingTypeAndVersioning[ bindingType ][ versioning ];

	}

	unbind() {

		this.node = null;
		this.getValue = this._getValue_unbound;
		this.setValue = this._setValue_unbound;

	}

}

PropertyBinding.Composite = Composite;
PropertyBinding.prototype.BindingType = { Direct: BINDING_DIRECT, EntireArray: BINDING_ARRAY, ArrayElement: BINDING_ELEMENT, HasFromToArray: BINDING_FROM_TO_ARRAY };
PropertyBinding.prototype.Versioning = { None: VERSION_NONE, NeedsUpdate: VERSION_NEEDS_UPDATE, MatrixWorldNeedsUpdate: VERSION_MATRIX_WORLD };
PropertyBinding.prototype.GetterByBindingType = [
	PropertyBinding.prototype._getValue_direct,
	PropertyBinding.prototype._getValue_array,
	PropertyBinding.prototype._getValue_arrayElement,
	PropertyBinding.prototype._getValue_toArray
];
PropertyBinding.prototype.SetterByBindingTypeAndVersioning = [
	[ PropertyBinding.prototype._setValue_direct, PropertyBinding.prototype._setValue_direct_setNeedsUpdate, PropertyBinding.prototype._setValue_direct_setMatrixWorldNeedsUpdate ],
	[ PropertyBinding.prototype._setValue_array, PropertyBinding.prototype._setValue_array_setNeedsUpdate, PropertyBinding.prototype._setValue_array_setMatrixWorldNeedsUpdate ],
	[ PropertyBinding.prototype._setValue_arrayElement, PropertyBinding.prototype._setValue_arrayElement_setNeedsUpdate, PropertyBinding.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate ],
	[ PropertyBinding.prototype._setValue_fromArray, PropertyBinding.prototype._setValue_fromArray_setNeedsUpdate, PropertyBinding.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate ]
];

// ---------------------------------------------------------------- PropertyMixer

// Blends the values the actions write to one binding. The buffer holds, `valueSize` each:
// the incoming value, two accumulators (alternating between frames), the original value,
// the additive accumulator, and for quaternions a work area.
export class PropertyMixer {

	constructor( binding, typeName, valueSize ) {

		this.binding = binding;
		this.valueSize = valueSize;
		let mixFunction, mixFunctionAdditive, setIdentity;

		switch ( typeName ) {

			case 'quaternion':
				mixFunction = this._slerp;
				mixFunctionAdditive = this._slerpAdditive;
				setIdentity = this._setAdditiveIdentityQuaternion;
				this.buffer = new Float64Array( valueSize * 6 );
				this._workIndex = 5;
				break;

			case 'string':
			case 'bool':
				mixFunction = mixFunctionAdditive = this._select;
				setIdentity = this._setAdditiveIdentityOther;
				this.buffer = new Array( valueSize * 5 );
				break;

			default:
				mixFunction = this._lerp;
				mixFunctionAdditive = this._lerpAdditive;
				setIdentity = this._setAdditiveIdentityNumeric;
				this.buffer = new Float64Array( valueSize * 5 );

		}

		this._mixBufferRegion = mixFunction;
		this._mixBufferRegionAdditive = mixFunctionAdditive;
		this._setIdentity = setIdentity;
		this._origIndex = 3;
		this._addIndex = 4;
		this.cumulativeWeight = 0;
		this.cumulativeWeightAdditive = 0;
		this.useCount = 0;
		this.referenceCount = 0;

	}

	accumulate( accuIndex, weight ) {

		const buffer = this.buffer, stride = this.valueSize, offset = accuIndex * stride + stride;
		let currentWeight = this.cumulativeWeight;

		if ( currentWeight === 0 ) {

			for ( let i = 0; i !== stride; ++ i ) buffer[ offset + i ] = buffer[ i ];
			currentWeight = weight;

		} else {

			currentWeight += weight;
			this._mixBufferRegion( buffer, offset, 0, weight / currentWeight, stride );

		}

		this.cumulativeWeight = currentWeight;

	}

	accumulateAdditive( weight ) {

		const buffer = this.buffer, stride = this.valueSize, offset = stride * this._addIndex;
		if ( this.cumulativeWeightAdditive === 0 ) this._setIdentity();
		this._mixBufferRegionAdditive( buffer, offset, 0, weight, stride );
		this.cumulativeWeightAdditive += weight;

	}

	// Writes the blend, filled up with the original value below full weight, and only when
	// it differs from the other accumulator's (the last frame's) value.
	apply( accuIndex ) {

		const stride = this.valueSize, buffer = this.buffer, offset = accuIndex * stride + stride;
		const weight = this.cumulativeWeight, weightAdditive = this.cumulativeWeightAdditive, binding = this.binding;
		this.cumulativeWeight = 0;
		this.cumulativeWeightAdditive = 0;
		if ( weight < 1 ) this._mixBufferRegion( buffer, offset, stride * this._origIndex, 1 - weight, stride );
		if ( weightAdditive > 0 ) this._mixBufferRegionAdditive( buffer, offset, this._addIndex * stride, 1, stride );

		for ( let i = stride, e = stride + stride; i !== e; ++ i ) {

			if ( buffer[ i ] !== buffer[ i + stride ] ) {

				binding.setValue( buffer, offset );
				break;

			}

		}

	}

	saveOriginalState() {

		const buffer = this.buffer, stride = this.valueSize, original = stride * this._origIndex;
		this.binding.getValue( buffer, original );
		// both accumulators start at the original value
		for ( let i = stride, e = original; i !== e; ++ i ) buffer[ i ] = buffer[ original + ( i % stride ) ];
		this._setIdentity();
		this.cumulativeWeight = 0;
		this.cumulativeWeightAdditive = 0;

	}

	restoreOriginalState() {

		this.binding.setValue( this.buffer, this.valueSize * 3 );

	}

	_setAdditiveIdentityNumeric() {

		const start = this._addIndex * this.valueSize;
		this.buffer.fill( 0, start, start + this.valueSize );

	}

	_setAdditiveIdentityQuaternion() {

		this._setAdditiveIdentityNumeric();
		this.buffer[ this._addIndex * this.valueSize + 3 ] = 1;

	}

	_setAdditiveIdentityOther() {

		const start = this._origIndex * this.valueSize, target = this._addIndex * this.valueSize;
		for ( let i = 0; i < this.valueSize; i ++ ) this.buffer[ target + i ] = this.buffer[ start + i ];

	}

	_select( buffer, dstOffset, srcOffset, t, stride ) {

		if ( t >= 0.5 ) for ( let i = 0; i !== stride; ++ i ) buffer[ dstOffset + i ] = buffer[ srcOffset + i ];

	}

	_slerp( buffer, dstOffset, srcOffset, t ) {

		Quaternion.slerpFlat( buffer, dstOffset, buffer, dstOffset, buffer, srcOffset, t );

	}

	_slerpAdditive( buffer, dstOffset, srcOffset, t, stride ) {

		const work = this._workIndex * stride;
		Quaternion.multiplyQuaternionsFlat( buffer, work, buffer, dstOffset, buffer, srcOffset );
		Quaternion.slerpFlat( buffer, dstOffset, buffer, dstOffset, buffer, work, t );

	}

	_lerp( buffer, dstOffset, srcOffset, t, stride ) {

		const s = 1 - t;

		for ( let i = 0; i !== stride; ++ i ) {

			const j = dstOffset + i;
			buffer[ j ] = buffer[ j ] * s + buffer[ srcOffset + i ] * t;

		}

	}

	_lerpAdditive( buffer, dstOffset, srcOffset, t, stride ) {

		for ( let i = 0; i !== stride; ++ i ) {

			const j = dstOffset + i;
			buffer[ j ] = buffer[ j ] + buffer[ srcOffset + i ] * t;

		}

	}

}

// ---------------------------------------------------------------- AnimationAction

/** One clip playing on one root: time, loop, weight, fading and warping. Made by `mixer.clipAction`. */
export class AnimationAction {

	constructor( mixer, clip, localRoot = null, blendMode = clip.blendMode ) {

		this._mixer = mixer;
		this._clip = clip;
		this._localRoot = localRoot;
		this.blendMode = blendMode;
		const interpolantSettings = { endingStart: ZeroCurvatureEnding, endingEnd: ZeroCurvatureEnding };
		this._interpolants = clip.tracks.map( ( track ) => {

			const interpolant = track.createInterpolant( null );
			interpolant.settings = interpolantSettings;
			return interpolant;

		} );
		this._interpolantSettings = interpolantSettings;
		this._propertyBindings = new Array( clip.tracks.length );
		this._cacheIndex = null;
		this._byClipCacheIndex = null;
		this._timeScaleInterpolant = null;
		this._restoreTimeScale = null;
		this._weightInterpolant = null;
		this.loop = LoopRepeat;
		this._loopCount = - 1;
		this._startTime = null;
		this.time = 0;
		this.timeScale = 1;
		this._effectiveTimeScale = 1;
		this.weight = 1;
		this._effectiveWeight = 1;
		this.repetitions = Infinity;
		this.paused = false;
		this.enabled = true;
		this.clampWhenFinished = false;
		this.zeroSlopeAtStart = true;
		this.zeroSlopeAtEnd = true;

	}

	play() {

		this._mixer._activateAction( this );
		return this;

	}

	stop() {

		this._mixer._deactivateAction( this );
		return this.reset();

	}

	reset() {

		this.paused = false;
		this.enabled = true;
		this.time = 0;
		this._loopCount = - 1;
		this._startTime = null;
		return this.stopFading().stopWarping();

	}

	isRunning() {

		return this.enabled && ! this.paused && this.timeScale !== 0 && this._startTime === null && this._mixer._isActiveAction( this );

	}

	isScheduled() {

		return this._mixer._isActiveAction( this );

	}

	startAt( time ) {

		this._startTime = time;
		return this;

	}

	setLoop( mode, repetitions ) {

		this.loop = mode;
		this.repetitions = repetitions;
		return this;

	}

	setEffectiveWeight( weight ) {

		this.weight = weight;
		this._effectiveWeight = this.enabled ? weight : 0;
		return this.stopFading();

	}

	getEffectiveWeight() {

		return this._effectiveWeight;

	}

	fadeIn( duration ) {

		return this._scheduleFading( duration, 0, 1 );

	}

	fadeOut( duration ) {

		return this._scheduleFading( duration, 1, 0 );

	}

	crossFadeFrom( fadeOutAction, duration, warp = false ) {

		fadeOutAction.fadeOut( duration );
		this.fadeIn( duration );

		if ( warp === true ) {

			const fadeInDuration = this._clip.duration, fadeOutDuration = fadeOutAction._clip.duration;
			fadeOutAction._restoreTimeScale = fadeOutAction.timeScale;
			this._restoreTimeScale = this.timeScale;
			fadeOutAction.warp( 1.0, fadeOutDuration / fadeInDuration, duration );
			this.warp( fadeInDuration / fadeOutDuration, 1.0, duration );

		}

		return this;

	}

	crossFadeTo( fadeInAction, duration, warp = false ) {

		return fadeInAction.crossFadeFrom( this, duration, warp );

	}

	stopFading() {

		const interpolant = this._weightInterpolant;

		if ( interpolant !== null ) {

			this._weightInterpolant = null;
			this._mixer._takeBackControlInterpolant( interpolant );

		}

		return this;

	}

	setEffectiveTimeScale( timeScale ) {

		this.timeScale = timeScale;
		this._effectiveTimeScale = this.paused ? 0 : timeScale;
		return this.stopWarping();

	}

	getEffectiveTimeScale() {

		return this._effectiveTimeScale;

	}

	setDuration( duration ) {

		this.timeScale = this._clip.duration / duration;
		return this.stopWarping();

	}

	syncWith( action ) {

		this.time = action.time;
		this.timeScale = action.timeScale;
		return this.stopWarping();

	}

	halt( duration ) {

		return this.warp( this._effectiveTimeScale, 0, duration );

	}

	warp( startTimeScale, endTimeScale, duration ) {

		const now = this._mixer.time, timeScale = this.timeScale;
		const interpolant = this._timeScaleInterpolant ??= this._mixer._lendControlInterpolant();
		const times = interpolant.parameterPositions, values = interpolant.sampleValues;
		times[ 0 ] = now;
		times[ 1 ] = now + duration;
		values[ 0 ] = startTimeScale / timeScale;
		values[ 1 ] = endTimeScale / timeScale;
		return this;

	}

	stopWarping() {

		const interpolant = this._timeScaleInterpolant;

		if ( interpolant !== null ) {

			this._timeScaleInterpolant = null;
			this._mixer._takeBackControlInterpolant( interpolant );

		}

		this._restoreTimeScale = null;
		return this;

	}

	getMixer() {

		return this._mixer;

	}

	getClip() {

		return this._clip;

	}

	getRoot() {

		return this._localRoot || this._mixer._root;

	}

	_update( time, deltaTime, timeDirection, accuIndex ) {

		if ( ! this.enabled ) {

			this._updateWeight( time );
			return;

		}

		const startTime = this._startTime;

		if ( startTime !== null ) {

			// a scheduled start: nothing moves until it is reached
			const timeRunning = ( time - startTime ) * timeDirection;

			if ( timeRunning < 0 || timeDirection === 0 ) {

				deltaTime = 0;

			} else {

				this._startTime = null;
				deltaTime = timeDirection * timeRunning;

			}

		}

		deltaTime *= this._updateTimeScale( time );
		const clipTime = this._updateTime( deltaTime );
		const weight = this._updateWeight( time );
		if ( weight <= 0 ) return;
		const interpolants = this._interpolants, mixers = this._propertyBindings;

		if ( this.blendMode === AdditiveAnimationBlendMode ) {

			for ( let j = 0; j !== interpolants.length; ++ j ) {

				interpolants[ j ].evaluate( clipTime );
				mixers[ j ].accumulateAdditive( weight );

			}

		} else {

			for ( let j = 0; j !== interpolants.length; ++ j ) {

				interpolants[ j ].evaluate( clipTime );
				mixers[ j ].accumulate( accuIndex, weight );

			}

		}

	}

	_updateWeight( time ) {

		let weight = 0;

		if ( this.enabled ) {

			weight = this.weight;
			const interpolant = this._weightInterpolant;

			if ( interpolant !== null ) {

				const value = interpolant.evaluate( time )[ 0 ];
				weight *= value;

				if ( time > interpolant.parameterPositions[ 1 ] ) {

					this.stopFading();
					if ( value === 0 ) this.enabled = false;

				}

			}

		}

		this._effectiveWeight = weight;
		return weight;

	}

	_updateTimeScale( time ) {

		let timeScale = 0;

		if ( ! this.paused ) {

			timeScale = this.timeScale;
			const interpolant = this._timeScaleInterpolant;

			if ( interpolant !== null ) {

				timeScale *= interpolant.evaluate( time )[ 0 ];

				if ( time > interpolant.parameterPositions[ 1 ] ) {

					if ( timeScale === 0 ) {

						this.paused = true;

					} else {

						if ( this._restoreTimeScale !== null ) timeScale = this._restoreTimeScale;
						this.timeScale = timeScale;

					}

					this.stopWarping();

				}

			}

		}

		this._effectiveTimeScale = timeScale;
		return timeScale;

	}

	// Advances the time, handles looping and ending, and returns the time in the clip.
	_updateTime( deltaTime ) {

		const duration = this._clip.duration, loop = this.loop;
		let time = this.time + deltaTime, loopCount = this._loopCount;
		const pingPong = loop === LoopPingPong;

		if ( deltaTime === 0 ) {

			if ( loopCount === - 1 ) return time;
			return pingPong && ( loopCount & 1 ) === 1 ? duration - time : time;

		}

		if ( loop === LoopOnce ) {

			if ( loopCount === - 1 ) {

				this._loopCount = 0;
				this._setEndings( true, true, false );

			}

			if ( time >= duration || time < 0 ) {

				time = time >= duration ? duration : 0;
				if ( this.clampWhenFinished ) this.paused = true;
				else this.enabled = false;
				this.time = time;
				this._mixer.dispatchEvent( { type: 'finished', action: this, direction: deltaTime < 0 ? - 1 : 1 } );

			} else {

				this.time = time;

			}

		} else {

			if ( loopCount === - 1 ) {

				if ( deltaTime >= 0 ) {

					loopCount = 0;
					this._setEndings( true, this.repetitions === 0, pingPong );

				} else {

					this._setEndings( this.repetitions === 0, true, pingPong );

				}

			}

			if ( time >= duration || time < 0 ) {

				const loopDelta = Math.floor( time / duration );
				time -= duration * loopDelta;
				loopCount += Math.abs( loopDelta );
				const pending = this.repetitions - loopCount;

				if ( pending <= 0 ) {

					if ( this.clampWhenFinished ) this.paused = true;
					else this.enabled = false;
					time = deltaTime > 0 ? duration : 0;
					this.time = time;
					this._mixer.dispatchEvent( { type: 'finished', action: this, direction: deltaTime > 0 ? 1 : - 1 } );

				} else {

					if ( pending === 1 ) {

						const atStart = deltaTime < 0;
						this._setEndings( atStart, ! atStart, pingPong );

					} else {

						this._setEndings( false, false, pingPong );

					}

					this._loopCount = loopCount;
					this.time = time;
					this._mixer.dispatchEvent( { type: 'loop', action: this, loopDelta } );

				}

			} else {

				this._loopCount = loopCount;
				this.time = time;

			}

			if ( pingPong && ( loopCount & 1 ) === 1 ) return duration - time;

		}

		return time;

	}

	_setEndings( atStart, atEnd, pingPong ) {

		const settings = this._interpolantSettings;

		if ( pingPong ) {

			settings.endingStart = settings.endingEnd = ZeroSlopeEnding;

		} else {

			settings.endingStart = atStart ? ( this.zeroSlopeAtStart ? ZeroSlopeEnding : ZeroCurvatureEnding ) : WrapAroundEnding;
			settings.endingEnd = atEnd ? ( this.zeroSlopeAtEnd ? ZeroSlopeEnding : ZeroCurvatureEnding ) : WrapAroundEnding;

		}

	}

	_scheduleFading( duration, weightNow, weightThen ) {

		const now = this._mixer.time;
		const interpolant = this._weightInterpolant ??= this._mixer._lendControlInterpolant();
		const times = interpolant.parameterPositions, values = interpolant.sampleValues;
		times[ 0 ] = now;
		values[ 0 ] = weightNow;
		times[ 1 ] = now + duration;
		values[ 1 ] = weightThen;
		return this;

	}

}

// ---------------------------------------------------------------- AnimationMixer

const controlResultBuffer = new Float32Array( 1 );

/**
 * Plays clips on the objects below `root`. Call `update( delta )` once per frame. Actions
 * and bindings are kept in arrays with the active ones first, so an update walks only
 * those.
 */
export class AnimationMixer extends EventDispatcher {

	constructor( root ) {

		super();
		this._root = root;
		this._initMemoryManager();
		this._accuIndex = 0;
		this.time = 0;
		this.timeScale = 1.0;

	}

	_bindAction( action, prototypeAction ) {

		const root = action._localRoot || this._root, tracks = action._clip.tracks, bindings = action._propertyBindings, interpolants = action._interpolants;
		const rootUuid = root.uuid, bindingsByName = this._bindingsByRootAndName[ rootUuid ] ??= {};

		for ( let i = 0; i !== tracks.length; ++ i ) {

			const track = tracks[ i ], trackName = track.name;
			let binding = bindingsByName[ trackName ];

			if ( binding !== undefined ) {

				++ binding.referenceCount;
				bindings[ i ] = binding;

			} else {

				binding = bindings[ i ];

				if ( binding !== undefined ) {

					// an existing binding re-entering the cache
					if ( binding._cacheIndex === null ) {

						++ binding.referenceCount;
						this._addInactiveBinding( binding, rootUuid, trackName );

					}

					continue;

				}

				const path = prototypeAction && prototypeAction._propertyBindings[ i ].binding.parsedPath;
				binding = new PropertyMixer( PropertyBinding.create( root, trackName, path ), track.ValueTypeName, track.getValueSize() );
				++ binding.referenceCount;
				this._addInactiveBinding( binding, rootUuid, trackName );
				bindings[ i ] = binding;

			}

			interpolants[ i ].resultBuffer = binding.buffer;

		}

	}

	_activateAction( action ) {

		if ( this._isActiveAction( action ) ) return;

		if ( action._cacheIndex === null ) {

			const rootUuid = ( action._localRoot || this._root ).uuid, clipUuid = action._clip.uuid, actionsForClip = this._actionsByClip[ clipUuid ];
			this._bindAction( action, actionsForClip && actionsForClip.knownActions[ 0 ] );
			this._addInactiveAction( action, clipUuid, rootUuid );

		}

		for ( const binding of action._propertyBindings ) {

			if ( binding.useCount ++ === 0 ) {

				this._lendBinding( binding );
				binding.saveOriginalState();

			}

		}

		this._lendAction( action );

	}

	_deactivateAction( action ) {

		if ( ! this._isActiveAction( action ) ) return;

		for ( const binding of action._propertyBindings ) {

			if ( -- binding.useCount === 0 ) {

				binding.restoreOriginalState();
				this._takeBackBinding( binding );

			}

		}

		this._takeBackAction( action );

	}

	_initMemoryManager() {

		this._actions = [];
		this._nActiveActions = 0;
		this._actionsByClip = {};
		this._bindings = [];
		this._nActiveBindings = 0;
		this._bindingsByRootAndName = {};
		this._controlInterpolants = [];
		this._nActiveControlInterpolants = 0;
		const scope = this;
		this.stats = {
			actions: { get total() { return scope._actions.length; }, get inUse() { return scope._nActiveActions; } },
			bindings: { get total() { return scope._bindings.length; }, get inUse() { return scope._nActiveBindings; } },
			controlInterpolants: { get total() { return scope._controlInterpolants.length; }, get inUse() { return scope._nActiveControlInterpolants; } }
		};

	}

	_isActiveAction( action ) {

		const index = action._cacheIndex;
		return index !== null && index < this._nActiveActions;

	}

	_addInactiveAction( action, clipUuid, rootUuid ) {

		const actions = this._actions;
		let actionsForClip = this._actionsByClip[ clipUuid ];

		if ( actionsForClip === undefined ) {

			actionsForClip = { knownActions: [ action ], actionByRoot: {} };
			action._byClipCacheIndex = 0;
			this._actionsByClip[ clipUuid ] = actionsForClip;

		} else {

			action._byClipCacheIndex = actionsForClip.knownActions.length;
			actionsForClip.knownActions.push( action );

		}

		action._cacheIndex = actions.length;
		actions.push( action );
		actionsForClip.actionByRoot[ rootUuid ] = action;

	}

	_removeInactiveAction( action ) {

		const actions = this._actions, last = actions[ actions.length - 1 ], cacheIndex = action._cacheIndex;
		last._cacheIndex = cacheIndex;
		actions[ cacheIndex ] = last;
		actions.pop();
		action._cacheIndex = null;

		const clipUuid = action._clip.uuid, actionsForClip = this._actionsByClip[ clipUuid ], known = actionsForClip.knownActions;
		const lastKnown = known[ known.length - 1 ], byClipCacheIndex = action._byClipCacheIndex;
		lastKnown._byClipCacheIndex = byClipCacheIndex;
		known[ byClipCacheIndex ] = lastKnown;
		known.pop();
		action._byClipCacheIndex = null;
		delete actionsForClip.actionByRoot[ ( action._localRoot || this._root ).uuid ];
		if ( known.length === 0 ) delete this._actionsByClip[ clipUuid ];
		this._removeInactiveBindingsForAction( action );

	}

	_removeInactiveBindingsForAction( action ) {

		for ( const binding of action._propertyBindings ) if ( -- binding.referenceCount === 0 ) this._removeInactiveBinding( binding );

	}

	_lendAction( action ) {

		const actions = this._actions, prevIndex = action._cacheIndex, lastActiveIndex = this._nActiveActions ++, firstInactive = actions[ lastActiveIndex ];
		action._cacheIndex = lastActiveIndex;
		actions[ lastActiveIndex ] = action;
		firstInactive._cacheIndex = prevIndex;
		actions[ prevIndex ] = firstInactive;

	}

	_takeBackAction( action ) {

		const actions = this._actions, prevIndex = action._cacheIndex, firstInactiveIndex = -- this._nActiveActions, lastActive = actions[ firstInactiveIndex ];
		action._cacheIndex = firstInactiveIndex;
		actions[ firstInactiveIndex ] = action;
		lastActive._cacheIndex = prevIndex;
		actions[ prevIndex ] = lastActive;

	}

	_addInactiveBinding( binding, rootUuid, trackName ) {

		( this._bindingsByRootAndName[ rootUuid ] ??= {} )[ trackName ] = binding;
		binding._cacheIndex = this._bindings.length;
		this._bindings.push( binding );

	}

	_removeInactiveBinding( binding ) {

		const bindings = this._bindings, propertyBinding = binding.binding, rootUuid = propertyBinding.rootNode.uuid;
		const byName = this._bindingsByRootAndName[ rootUuid ], last = bindings[ bindings.length - 1 ], cacheIndex = binding._cacheIndex;
		last._cacheIndex = cacheIndex;
		bindings[ cacheIndex ] = last;
		bindings.pop();
		delete byName[ propertyBinding.path ];
		if ( Object.keys( byName ).length === 0 ) delete this._bindingsByRootAndName[ rootUuid ];

	}

	_lendBinding( binding ) {

		const bindings = this._bindings, prevIndex = binding._cacheIndex, lastActiveIndex = this._nActiveBindings ++, firstInactive = bindings[ lastActiveIndex ];
		binding._cacheIndex = lastActiveIndex;
		bindings[ lastActiveIndex ] = binding;
		firstInactive._cacheIndex = prevIndex;
		bindings[ prevIndex ] = firstInactive;

	}

	_takeBackBinding( binding ) {

		const bindings = this._bindings, prevIndex = binding._cacheIndex, firstInactiveIndex = -- this._nActiveBindings, lastActive = bindings[ firstInactiveIndex ];
		binding._cacheIndex = firstInactiveIndex;
		bindings[ firstInactiveIndex ] = binding;
		lastActive._cacheIndex = prevIndex;
		bindings[ prevIndex ] = lastActive;

	}

	// Two-key interpolants for fading and warping, reused.
	_lendControlInterpolant() {

		const interpolants = this._controlInterpolants, lastActiveIndex = this._nActiveControlInterpolants ++;
		let interpolant = interpolants[ lastActiveIndex ];

		if ( interpolant === undefined ) {

			interpolant = new LinearInterpolant( new Float32Array( 2 ), new Float32Array( 2 ), 1, controlResultBuffer );
			interpolant.__cacheIndex = lastActiveIndex;
			interpolants[ lastActiveIndex ] = interpolant;

		}

		return interpolant;

	}

	_takeBackControlInterpolant( interpolant ) {

		const interpolants = this._controlInterpolants, prevIndex = interpolant.__cacheIndex, firstInactiveIndex = -- this._nActiveControlInterpolants, lastActive = interpolants[ firstInactiveIndex ];
		interpolant.__cacheIndex = firstInactiveIndex;
		interpolants[ firstInactiveIndex ] = interpolant;
		lastActive.__cacheIndex = prevIndex;
		interpolants[ prevIndex ] = lastActive;

	}

	/** The action of `clip` (or the clip named so) on `optionalRoot` or the mixer's root, made once. */
	clipAction( clip, optionalRoot, blendMode ) {

		const root = optionalRoot || this._root, rootUuid = root.uuid;
		let clipObject = typeof clip === 'string' ? AnimationClip.findByName( root, clip ) : clip;
		const clipUuid = clipObject !== null ? clipObject.uuid : clip, actionsForClip = this._actionsByClip[ clipUuid ];
		let prototypeAction = null;
		if ( blendMode === undefined ) blendMode = clipObject !== null ? clipObject.blendMode : NormalAnimationBlendMode;

		if ( actionsForClip !== undefined ) {

			const existing = actionsForClip.actionByRoot[ rootUuid ];
			if ( existing !== undefined && existing.blendMode === blendMode ) return existing;
			prototypeAction = actionsForClip.knownActions[ 0 ];
			if ( clipObject === null ) clipObject = prototypeAction._clip;

		}

		if ( clipObject === null ) return null;
		const action = new AnimationAction( this, clipObject, optionalRoot, blendMode );
		this._bindAction( action, prototypeAction );
		this._addInactiveAction( action, clipUuid, rootUuid );
		return action;

	}

	existingAction( clip, optionalRoot ) {

		const root = optionalRoot || this._root;
		const clipObject = typeof clip === 'string' ? AnimationClip.findByName( root, clip ) : clip;
		const actionsForClip = this._actionsByClip[ clipObject ? clipObject.uuid : clip ];
		return actionsForClip !== undefined ? actionsForClip.actionByRoot[ root.uuid ] || null : null;

	}

	stopAllAction() {

		for ( let i = this._nActiveActions - 1; i >= 0; -- i ) this._actions[ i ].stop();
		return this;

	}

	update( deltaTime ) {

		deltaTime *= this.timeScale;
		const actions = this._actions, nActions = this._nActiveActions, time = this.time += deltaTime;
		const timeDirection = Math.sign( deltaTime ), accuIndex = this._accuIndex ^= 1;
		for ( let i = 0; i !== nActions; ++ i ) actions[ i ]._update( time, deltaTime, timeDirection, accuIndex );
		const bindings = this._bindings, nBindings = this._nActiveBindings;
		for ( let i = 0; i !== nBindings; ++ i ) bindings[ i ].apply( accuIndex );
		return this;

	}

	setTime( time ) {

		this.time = 0;
		for ( const action of this._actions ) action.time = 0;
		return this.update( time );

	}

	getRoot() {

		return this._root;

	}

	uncacheClip( clip ) {

		const actions = this._actions, clipUuid = clip.uuid, actionsForClip = this._actionsByClip[ clipUuid ];
		if ( actionsForClip === undefined ) return;

		for ( const action of actionsForClip.knownActions ) {

			this._deactivateAction( action );
			const cacheIndex = action._cacheIndex, last = actions[ actions.length - 1 ];
			action._cacheIndex = null;
			action._byClipCacheIndex = null;
			last._cacheIndex = cacheIndex;
			actions[ cacheIndex ] = last;
			actions.pop();
			this._removeInactiveBindingsForAction( action );

		}

		delete this._actionsByClip[ clipUuid ];

	}

	uncacheRoot( root ) {

		const rootUuid = root.uuid;

		for ( const clipUuid in this._actionsByClip ) {

			const action = this._actionsByClip[ clipUuid ].actionByRoot[ rootUuid ];

			if ( action !== undefined ) {

				this._deactivateAction( action );
				this._removeInactiveAction( action );

			}

		}

		const byName = this._bindingsByRootAndName[ rootUuid ];

		if ( byName !== undefined ) {

			for ( const trackName in byName ) {

				const binding = byName[ trackName ];
				binding.restoreOriginalState();
				this._removeInactiveBinding( binding );

			}

		}

	}

	uncacheAction( clip, optionalRoot ) {

		const action = this.existingAction( clip, optionalRoot );

		if ( action !== null ) {

			this._deactivateAction( action );
			this._removeInactiveAction( action );

		}

	}

}

// ---------------------------------------------------------------- AnimationObjectGroup

/**
 * Objects animated together by one action. Removed objects stay cached at the front of
 * the arrays (below `nCachedObjects_`) until `uncache`.
 */
export class AnimationObjectGroup {

	constructor( ...objects ) {

		this.uuid = W.MathUtils.generateUUID();
		this._objects = objects;
		this.nCachedObjects_ = 0;
		this._indicesByUUID = {};
		objects.forEach( ( object, i ) => {

			this._indicesByUUID[ object.uuid ] = i;

		} );
		this._paths = [];
		this._parsedPaths = [];
		this._bindings = [];
		this._bindingsIndicesByPath = {};
		const scope = this;
		this.stats = {
			objects: { get total() { return scope._objects.length; }, get inUse() { return this.total - scope.nCachedObjects_; } },
			get bindingsPerObject() { return scope._bindings.length; }
		};

	}

	add( ...added ) {

		const objects = this._objects, indicesByUUID = this._indicesByUUID, paths = this._paths, parsedPaths = this._parsedPaths, bindings = this._bindings;
		let knownObject, nObjects = objects.length, nCachedObjects = this.nCachedObjects_;

		for ( const object of added ) {

			const uuid = object.uuid;
			let index = indicesByUUID[ uuid ];

			if ( index === undefined ) {

				index = nObjects ++;
				indicesByUUID[ uuid ] = index;
				objects.push( object );
				for ( let j = 0; j !== bindings.length; ++ j ) bindings[ j ].push( new PropertyBinding( object, paths[ j ], parsedPaths[ j ] ) );

			} else if ( index < nCachedObjects ) {

				knownObject = objects[ index ];
				// moved from the cached part to the active part
				const firstActiveIndex = -- nCachedObjects, lastCachedObject = objects[ firstActiveIndex ];
				indicesByUUID[ lastCachedObject.uuid ] = index;
				objects[ index ] = lastCachedObject;
				indicesByUUID[ uuid ] = firstActiveIndex;
				objects[ firstActiveIndex ] = object;

				for ( let j = 0; j !== bindings.length; ++ j ) {

					const forPath = bindings[ j ], lastCached = forPath[ firstActiveIndex ];
					let binding = forPath[ index ];
					forPath[ index ] = lastCached;
					if ( binding === undefined ) binding = new PropertyBinding( object, paths[ j ], parsedPaths[ j ] );
					forPath[ firstActiveIndex ] = binding;

				}

			} else if ( objects[ index ] !== knownObject ) {

				console.error( 'WAMR3D: AnimationObjectGroup: different objects with the same UUID detected. Clean the caches or recreate your infrastructure when reloading scenes.' );

			}

		}

		this.nCachedObjects_ = nCachedObjects;

	}

	remove( ...removed ) {

		const objects = this._objects, indicesByUUID = this._indicesByUUID, bindings = this._bindings;
		let nCachedObjects = this.nCachedObjects_;

		for ( const object of removed ) {

			const uuid = object.uuid, index = indicesByUUID[ uuid ];
			if ( index === undefined || index < nCachedObjects ) continue;
			const lastCachedIndex = nCachedObjects ++, firstActiveObject = objects[ lastCachedIndex ];
			indicesByUUID[ firstActiveObject.uuid ] = index;
			objects[ index ] = firstActiveObject;
			indicesByUUID[ uuid ] = lastCachedIndex;
			objects[ lastCachedIndex ] = object;

			for ( let j = 0; j !== bindings.length; ++ j ) {

				const forPath = bindings[ j ], firstActive = forPath[ lastCachedIndex ], binding = forPath[ index ];
				forPath[ index ] = firstActive;
				forPath[ lastCachedIndex ] = binding;

			}

		}

		this.nCachedObjects_ = nCachedObjects;

	}

	uncache( ...uncached ) {

		const objects = this._objects, indicesByUUID = this._indicesByUUID, bindings = this._bindings;
		let nCachedObjects = this.nCachedObjects_, nObjects = objects.length;

		for ( const object of uncached ) {

			const uuid = object.uuid, index = indicesByUUID[ uuid ];
			if ( index === undefined ) continue;
			delete indicesByUUID[ uuid ];

			if ( index < nCachedObjects ) {

				// a cached object: fill its place with the last cached one, and that place with the last object
				const firstActiveIndex = -- nCachedObjects, lastCachedObject = objects[ firstActiveIndex ], lastIndex = -- nObjects, lastObject = objects[ lastIndex ];
				if ( index !== firstActiveIndex ) indicesByUUID[ lastCachedObject.uuid ] = index;
				objects[ index ] = lastCachedObject;
				if ( firstActiveIndex !== lastIndex ) indicesByUUID[ lastObject.uuid ] = firstActiveIndex;
				objects[ firstActiveIndex ] = lastObject;
				objects.pop();

				for ( let j = 0; j !== bindings.length; ++ j ) {

					const forPath = bindings[ j ], lastCached = forPath[ firstActiveIndex ], last = forPath[ lastIndex ];
					forPath[ index ] = lastCached;
					forPath[ firstActiveIndex ] = last;
					forPath.pop();

				}

			} else {

				const lastIndex = -- nObjects, lastObject = objects[ lastIndex ];
				if ( index !== lastIndex ) indicesByUUID[ lastObject.uuid ] = index;
				objects[ index ] = lastObject;
				objects.pop();

				for ( let j = 0; j !== bindings.length; ++ j ) {

					const forPath = bindings[ j ];
					forPath[ index ] = forPath[ lastIndex ];
					forPath.pop();

				}

			}

		}

		this.nCachedObjects_ = nCachedObjects;

	}

	subscribe_( path, parsedPath ) {

		let index = this._bindingsIndicesByPath[ path ];
		if ( index !== undefined ) return this._bindings[ index ];
		const objects = this._objects, forPath = new Array( objects.length );
		index = this._bindings.length;
		this._bindingsIndicesByPath[ path ] = index;
		this._paths.push( path );
		this._parsedPaths.push( parsedPath );
		this._bindings.push( forPath );
		for ( let i = this.nCachedObjects_; i !== objects.length; ++ i ) forPath[ i ] = new PropertyBinding( objects[ i ], path, parsedPath );
		return forPath;

	}

	unsubscribe_( path ) {

		const index = this._bindingsIndicesByPath[ path ];
		if ( index === undefined ) return;
		const paths = this._paths, parsedPaths = this._parsedPaths, bindings = this._bindings, last = bindings.length - 1;
		this._bindingsIndicesByPath[ paths[ last ] ] = index;
		bindings[ index ] = bindings[ last ];
		bindings.pop();
		parsedPaths[ index ] = parsedPaths[ last ];
		parsedPaths.pop();
		paths[ index ] = paths[ last ];
		paths.pop();

	}

}

AnimationObjectGroup.prototype.isAnimationObjectGroup = true;

