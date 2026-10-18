// The keyframe animation system.
//
// Part of the typings of `wamr3d/compat`; `../compat.d.ts` gathers them.

import { Object3D } from './objects.js';
import { EventDispatcher } from './extras.js';

// ---------------------------------------------------------------- animation

export class Interpolant {
	constructor( parameterPositions: ArrayLike<number>, sampleValues: ArrayLike<number>, sampleSize: number, resultBuffer?: ArrayLike<number> );
	evaluate( t: number ): ArrayLike<number>;
	[ key: string ]: any;
}
export class DiscreteInterpolant extends Interpolant {}
export class LinearInterpolant extends Interpolant {}
export class QuaternionLinearInterpolant extends Interpolant {}
export class CubicInterpolant extends Interpolant {}
export class BezierInterpolant extends Interpolant {}

export class KeyframeTrack {
	constructor( name: string, times: ArrayLike<number>, values: ArrayLike<any>, interpolation?: number );
	name: string;
	times: Float32Array;
	values: any;
	ValueTypeName: string;
	setInterpolation( interpolation: number ): this;
	getInterpolation(): number;
	getValueSize(): number;
	shift( timeOffset: number ): this;
	scale( timeScale: number ): this;
	trim( startTime: number, endTime: number ): this;
	validate(): boolean;
	optimize(): this;
	clone(): this;
	static toJSON( track: KeyframeTrack ): any;
}
export class BooleanKeyframeTrack extends KeyframeTrack {}
export class ColorKeyframeTrack extends KeyframeTrack {}
export class NumberKeyframeTrack extends KeyframeTrack {}
export class QuaternionKeyframeTrack extends KeyframeTrack {}
export class StringKeyframeTrack extends KeyframeTrack {}
export class VectorKeyframeTrack extends KeyframeTrack {}

export class AnimationClip {
	constructor( name?: string, duration?: number, tracks?: KeyframeTrack[], blendMode?: number );
	name: string;
	tracks: KeyframeTrack[];
	duration: number;
	blendMode: number;
	uuid: string;
	userData: Record<string, any>;
	resetDuration(): this;
	trim(): this;
	validate(): boolean;
	optimize(): this;
	clone(): this;
	toJSON(): any;
	static parse( json: any ): AnimationClip;
	static toJSON( clip: AnimationClip ): any;
	static findByName( objectOrClipArray: AnimationClip[] | Object3D, name: string ): AnimationClip | null;
	static CreateFromMorphTargetSequence( name: string, morphTargetSequence: Array<{ name: string }>, fps: number, noLoop: boolean ): AnimationClip;
	static CreateClipsFromMorphTargetSequences( morphTargets: Array<{ name: string }>, fps: number, noLoop: boolean ): AnimationClip[];
}

export class AnimationAction {
	loop: number;
	time: number;
	timeScale: number;
	weight: number;
	repetitions: number;
	paused: boolean;
	enabled: boolean;
	clampWhenFinished: boolean;
	zeroSlopeAtStart: boolean;
	zeroSlopeAtEnd: boolean;
	blendMode: number;
	play(): this;
	stop(): this;
	reset(): this;
	isRunning(): boolean;
	isScheduled(): boolean;
	startAt( time: number ): this;
	setLoop( mode: number, repetitions: number ): this;
	setEffectiveWeight( weight: number ): this;
	getEffectiveWeight(): number;
	fadeIn( duration: number ): this;
	fadeOut( duration: number ): this;
	crossFadeFrom( fadeOutAction: AnimationAction, duration: number, warp?: boolean ): this;
	crossFadeTo( fadeInAction: AnimationAction, duration: number, warp?: boolean ): this;
	stopFading(): this;
	setEffectiveTimeScale( timeScale: number ): this;
	getEffectiveTimeScale(): number;
	setDuration( duration: number ): this;
	syncWith( action: AnimationAction ): this;
	halt( duration: number ): this;
	warp( startTimeScale: number, endTimeScale: number, duration: number ): this;
	stopWarping(): this;
	getMixer(): AnimationMixer;
	getClip(): AnimationClip;
	getRoot(): Object3D;
}

export class AnimationMixer extends EventDispatcher {
	constructor( root: Object3D | AnimationObjectGroup );
	time: number;
	timeScale: number;
	clipAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup, blendMode?: number ): AnimationAction;
	existingAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup ): AnimationAction | null;
	stopAllAction(): this;
	update( deltaTime: number ): this;
	setTime( time: number ): this;
	getRoot(): Object3D | AnimationObjectGroup;
	uncacheClip( clip: AnimationClip ): void;
	uncacheRoot( root: Object3D | AnimationObjectGroup ): void;
	uncacheAction( clip: AnimationClip | string, root?: Object3D | AnimationObjectGroup ): void;
}

export class AnimationObjectGroup {
	constructor( ...objects: Object3D[] );
	uuid: string;
	add( ...objects: Object3D[] ): void;
	remove( ...objects: Object3D[] ): void;
	uncache( ...objects: Object3D[] ): void;
}

export class PropertyBinding {
	constructor( rootNode: any, path: string, parsedPath?: any );
	static create( root: any, path: string, parsedPath?: any ): PropertyBinding;
	static sanitizeNodeName( name: string ): string;
	static parseTrackName( trackName: string ): any;
	static findNode( root: any, nodeName: string | number ): any;
	getValue( array: ArrayLike<number>, offset: number ): void;
	setValue( array: ArrayLike<number>, offset: number ): void;
	bind(): void;
	unbind(): void;
}

export class PropertyMixer { constructor( binding: PropertyBinding, typeName: string, valueSize: number ); [ key: string ]: any; }

export const AnimationUtils: Record<string, ( ...args: any[] ) => any>;
