// Audio through the Web Audio API, placed by the scene (three.js's audio classes). The
// listener and positional sounds follow their objects' world transforms each frame the
// renderer draws (`_onFrame`).

import { FileLoader, Loader } from './loaders.js';
import { Object3D } from './object3d.js';
import { Quaternion, Vector3 } from './values.js';

let context;

/** three.js `AudioContext`: the one Web Audio context shared by all audio objects. */
export const AudioContext = {

	getContext() {

		if ( context === undefined ) context = new ( globalThis.AudioContext || globalThis.webkitAudioContext )();
		return context;

	},

	setContext( value ) {

		context = value;

	}

};

const _position = new Vector3(), _quaternion = new Quaternion(), _scale = new Vector3(), _orientation = new Vector3();

/** The listener's ears, usually a child of the camera. */
export class AudioListener extends Object3D {

	constructor() {

		super();
		this.type = 'AudioListener';
		this.context = AudioContext.getContext();
		this.gain = this.context.createGain();
		this.gain.connect( this.context.destination );
		this.filter = null;
		this.timeDelta = 0;
		this._clock = performance.now();

	}

	getInput() {

		return this.gain;

	}

	removeFilter() {

		if ( this.filter !== null ) {

			this.gain.disconnect( this.filter );
			this.filter.disconnect( this.context.destination );
			this.gain.connect( this.context.destination );
			this.filter = null;

		}

		return this;

	}

	getFilter() {

		return this.filter;

	}

	setFilter( value ) {

		if ( this.filter !== null ) {

			this.gain.disconnect( this.filter );
			this.filter.disconnect( this.context.destination );

		} else {

			this.gain.disconnect( this.context.destination );

		}

		this.filter = value;
		this.gain.connect( this.filter );
		this.filter.connect( this.context.destination );
		return this;

	}

	getMasterVolume() {

		return this.gain.gain.value;

	}

	setMasterVolume( value ) {

		this.gain.gain.setTargetAtTime( value, this.context.currentTime, 0.01 );
		return this;

	}

	// Places the Web Audio listener at the object, facing its -z with its +y up.
	_onFrame() {

		const now = performance.now();
		this.timeDelta = ( now - this._clock ) / 1000;
		this._clock = now;
		const listener = this.context.listener, up = this.up;
		this.matrixWorld.decompose( _position, _quaternion, _scale );
		_orientation.set( 0, 0, - 1 ).applyQuaternion( _quaternion );
		const upWorld = new Vector3( up.x, up.y, up.z ).applyQuaternion( _quaternion );

		if ( listener.positionX ) {

			const endTime = this.context.currentTime + this.timeDelta;
			listener.positionX.linearRampToValueAtTime( _position.x, endTime );
			listener.positionY.linearRampToValueAtTime( _position.y, endTime );
			listener.positionZ.linearRampToValueAtTime( _position.z, endTime );
			listener.forwardX.linearRampToValueAtTime( _orientation.x, endTime );
			listener.forwardY.linearRampToValueAtTime( _orientation.y, endTime );
			listener.forwardZ.linearRampToValueAtTime( _orientation.z, endTime );
			listener.upX.linearRampToValueAtTime( upWorld.x, endTime );
			listener.upY.linearRampToValueAtTime( upWorld.y, endTime );
			listener.upZ.linearRampToValueAtTime( upWorld.z, endTime );

		} else {

			listener.setPosition( _position.x, _position.y, _position.z );
			listener.setOrientation( _orientation.x, _orientation.y, _orientation.z, upWorld.x, upWorld.y, upWorld.z );

		}

	}

}

AudioListener.prototype.isAudioListener = true;

/** A non-positional sound: a buffer, media element or stream played through the listener. */
export class Audio extends Object3D {

	constructor( listener ) {

		super();
		this.type = 'Audio';
		this.listener = listener;
		this.context = listener.context;
		this.gain = this.context.createGain();
		this.gain.connect( listener.getInput() );
		this.autoplay = false;
		this.buffer = null;
		this.detune = 0;
		this.loop = false;
		this.loopStart = 0;
		this.loopEnd = 0;
		this.offset = 0;
		this.duration = undefined;
		this.playbackRate = 1;
		this.isPlaying = false;
		this.hasPlaybackControl = true;
		this.source = null;
		this.sourceType = 'empty';
		this._startedAt = 0;
		this._progress = 0;
		this._connected = false;
		this.filters = [];

	}

	getOutput() {

		return this.gain;

	}

	setNodeSource( audioNode ) {

		this.hasPlaybackControl = false;
		this.sourceType = 'audioNode';
		this.source = audioNode;
		this.connect();
		return this;

	}

	setMediaElementSource( mediaElement ) {

		this.hasPlaybackControl = false;
		this.sourceType = 'mediaNode';
		this.source = this.context.createMediaElementSource( mediaElement );
		this.connect();
		return this;

	}

	setMediaStreamSource( mediaStream ) {

		this.hasPlaybackControl = false;
		this.sourceType = 'mediaStreamNode';
		this.source = this.context.createMediaStreamSource( mediaStream );
		this.connect();
		return this;

	}

	setBuffer( audioBuffer ) {

		this.buffer = audioBuffer;
		this.sourceType = 'buffer';
		if ( this.autoplay ) this.play();
		return this;

	}

	play( delay = 0 ) {

		if ( this.isPlaying === true ) {

			console.warn( 'WAMR3D: Audio: Audio is already playing.' );
			return;

		}

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return;

		}

		this._startedAt = this.context.currentTime + delay;
		const source = this.context.createBufferSource();
		source.buffer = this.buffer;
		source.loop = this.loop;
		source.loopStart = this.loopStart;
		source.loopEnd = this.loopEnd;
		source.onended = this.onEnded.bind( this );
		source.start( this._startedAt, this._progress + this.offset, this.duration );
		this.isPlaying = true;
		this.source = source;
		this.setDetune( this.detune );
		this.setPlaybackRate( this.playbackRate );
		return this.connect();

	}

	pause() {

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return;

		}

		if ( this.isPlaying === true ) {

			// where to resume, within the loop if it loops
			this._progress += Math.max( this.context.currentTime - this._startedAt, 0 ) * this.playbackRate;
			if ( this.loop === true ) this._progress = this._progress % ( this.duration || this.buffer.duration );
			this.source.stop();
			this.source.onended = null;
			this.isPlaying = false;

		}

		return this;

	}

	stop( delay = 0 ) {

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return;

		}

		this._progress = 0;

		if ( this.source !== null ) {

			this.source.stop( this.context.currentTime + delay );
			this.source.onended = null;

		}

		this.isPlaying = false;
		return this;

	}

	connect() {

		if ( this.filters.length > 0 ) {

			this.source.connect( this.filters[ 0 ] );
			for ( let i = 1; i < this.filters.length; i ++ ) this.filters[ i - 1 ].connect( this.filters[ i ] );
			this.filters[ this.filters.length - 1 ].connect( this.getOutput() );

		} else {

			this.source.connect( this.getOutput() );

		}

		this._connected = true;
		return this;

	}

	disconnect() {

		if ( this._connected === false ) return;

		if ( this.filters.length > 0 ) {

			this.source.disconnect( this.filters[ 0 ] );
			for ( let i = 1; i < this.filters.length; i ++ ) this.filters[ i - 1 ].disconnect( this.filters[ i ] );
			this.filters[ this.filters.length - 1 ].disconnect( this.getOutput() );

		} else {

			this.source.disconnect( this.getOutput() );

		}

		this._connected = false;
		return this;

	}

	getFilters() {

		return this.filters;

	}

	setFilters( value ) {

		if ( ! value ) value = [];

		if ( this._connected === true ) {

			this.disconnect();
			this.filters = value.slice();
			this.connect();

		} else {

			this.filters = value.slice();

		}

		return this;

	}

	setDetune( value ) {

		this.detune = value;
		if ( this.isPlaying === true && this.source.detune !== undefined ) this.source.detune.setTargetAtTime( this.detune, this.context.currentTime, 0.01 );
		return this;

	}

	getDetune() {

		return this.detune;

	}

	getFilter() {

		return this.getFilters()[ 0 ];

	}

	setFilter( filter ) {

		return this.setFilters( filter ? [ filter ] : [] );

	}

	setPlaybackRate( value ) {

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return;

		}

		this.playbackRate = value;
		if ( this.isPlaying === true ) this.source.playbackRate.setTargetAtTime( this.playbackRate, this.context.currentTime, 0.01 );
		return this;

	}

	getPlaybackRate() {

		return this.playbackRate;

	}

	onEnded() {

		this.isPlaying = false;
		this._progress = 0;

	}

	getLoop() {

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return false;

		}

		return this.loop;

	}

	setLoop( value ) {

		if ( this.hasPlaybackControl === false ) {

			console.warn( 'WAMR3D: Audio: this Audio has no playback control.' );
			return;

		}

		this.loop = value;
		if ( this.isPlaying === true ) this.source.loop = this.loop;
		return this;

	}

	setLoopStart( value ) {

		this.loopStart = value;
		return this;

	}

	setLoopEnd( value ) {

		this.loopEnd = value;
		return this;

	}

	getVolume() {

		return this.gain.gain.value;

	}

	setVolume( value ) {

		this.gain.gain.setTargetAtTime( value, this.context.currentTime, 0.01 );
		return this;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		if ( source.sourceType !== 'buffer' ) {

			console.warn( 'WAMR3D: Audio: Audio source type cannot be copied.' );
			return this;

		}

		this.autoplay = source.autoplay;
		this.buffer = source.buffer;
		this.detune = source.detune;
		this.loop = source.loop;
		this.loopStart = source.loopStart;
		this.loopEnd = source.loopEnd;
		this.offset = source.offset;
		this.duration = source.duration;
		this.playbackRate = source.playbackRate;
		this.hasPlaybackControl = source.hasPlaybackControl;
		this.sourceType = source.sourceType;
		this.filters = source.filters.slice();
		return this;

	}

	clone( recursive ) {

		return new this.constructor( this.listener ).copy( this, recursive );

	}

}

/** A sound from the object's place, panned and attenuated by distance (an HRTF panner). */
export class PositionalAudio extends Audio {

	constructor( listener ) {

		super( listener );
		this.type = 'PositionalAudio';
		this.panner = this.context.createPanner();
		this.panner.panningModel = 'HRTF';
		this.panner.connect( this.gain );

	}

	connect() {

		super.connect();
		this.panner.connect( this.gain );
		return this;

	}

	disconnect() {

		super.disconnect();
		this.panner.disconnect( this.gain );
		return this;

	}

	getOutput() {

		return this.panner;

	}

	getRefDistance() {

		return this.panner.refDistance;

	}

	setRefDistance( value ) {

		this.panner.refDistance = value;
		return this;

	}

	getRolloffFactor() {

		return this.panner.rolloffFactor;

	}

	setRolloffFactor( value ) {

		this.panner.rolloffFactor = value;
		return this;

	}

	getDistanceModel() {

		return this.panner.distanceModel;

	}

	setDistanceModel( value ) {

		this.panner.distanceModel = value;
		return this;

	}

	getMaxDistance() {

		return this.panner.maxDistance;

	}

	setMaxDistance( value ) {

		this.panner.maxDistance = value;
		return this;

	}

	setDirectionalCone( coneInnerAngle, coneOuterAngle, coneOuterGain ) {

		this.panner.coneInnerAngle = coneInnerAngle;
		this.panner.coneOuterAngle = coneOuterAngle;
		this.panner.coneOuterGain = coneOuterGain;
		return this;

	}

	// The panner at the object, facing its +z.
	_onFrame() {

		if ( this.hasPlaybackControl === true && this.isPlaying === false ) return;
		this.matrixWorld.decompose( _position, _quaternion, _scale );
		_orientation.set( 0, 0, 1 ).applyQuaternion( _quaternion );
		const panner = this.panner;

		if ( panner.positionX ) {

			const endTime = this.context.currentTime + this.listener.timeDelta;
			panner.positionX.linearRampToValueAtTime( _position.x, endTime );
			panner.positionY.linearRampToValueAtTime( _position.y, endTime );
			panner.positionZ.linearRampToValueAtTime( _position.z, endTime );
			panner.orientationX.linearRampToValueAtTime( _orientation.x, endTime );
			panner.orientationY.linearRampToValueAtTime( _orientation.y, endTime );
			panner.orientationZ.linearRampToValueAtTime( _orientation.z, endTime );

		} else {

			panner.setPosition( _position.x, _position.y, _position.z );
			panner.setOrientation( _orientation.x, _orientation.y, _orientation.z );

		}

	}

}

/** Frequency data of a sound (three.js `AudioAnalyser`). */
export class AudioAnalyser {

	constructor( audio, fftSize = 2048 ) {

		this.analyser = audio.context.createAnalyser();
		this.analyser.fftSize = fftSize;
		this.data = new Uint8Array( this.analyser.frequencyBinCount );
		audio.getOutput().connect( this.analyser );

	}

	getFrequencyData() {

		this.analyser.getByteFrequencyData( this.data );
		return this.data;

	}

	getAverageFrequency() {

		let value = 0;
		const data = this.getFrequencyData();
		for ( let i = 0; i < data.length; i ++ ) value += data[ i ];
		return value / data.length;

	}

}

/** Decodes a sound file into an `AudioBuffer` (three.js `AudioLoader`). */
export class AudioLoader extends Loader {

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );
		loader.setResponseType( 'arraybuffer' );
		loader.setPath( this.path );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		const failed = ( error ) => {

			if ( onError ) onError( error );
			else console.error( error );
			this.manager.itemError( url );

		};

		loader.load( url, ( buffer ) => {

			try {

				// decodeAudioData detaches the buffer; a copy keeps the cached file usable
				AudioContext.getContext().decodeAudioData( buffer.slice( 0 ), onLoad ).catch( failed );

			} catch ( error ) {

				failed( error );

			}

		}, onProgress, onError );

	}

}
