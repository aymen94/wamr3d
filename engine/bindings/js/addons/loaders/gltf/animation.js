// Animation clips from glTF channels and samplers.
//
// Part of the GLTFLoader add-on (`../GLTFLoader.js`).

import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack, InterpolateDiscrete, InterpolateLinear } from '../../../compat.js';
import { GLTFCubicSplineInterpolant, GLTFCubicSplineQuaternionInterpolant, PATH_PROPERTIES, denormalized } from './common.js';

/** Methods of `GLTFParser`, copied onto its prototype. */
export class GLTFAnimation {

	// ---------------------------------------------------------------- animations

	async loadAnimation( index ) {

		const definition = this.json.animations[ index ], tracks = [];

		for ( const channel of definition.channels ) {

			const sampler = definition.samplers[ channel.sampler ], target = channel.target;
			if ( target.node === undefined ) continue;
			const [ input, output, node ] = await Promise.all( [ this.getDependency( 'accessor', sampler.input ), this.getDependency( 'accessor', sampler.output ), this.getDependency( 'node', target.node ) ] );
			const property = PATH_PROPERTIES[ target.path ];
			if ( property === undefined ) continue;
			node.updateMatrix?.();
			const interpolation = sampler.interpolation === 'CUBICSPLINE' ? 'CUBICSPLINE' : sampler.interpolation === 'STEP' ? InterpolateDiscrete : InterpolateLinear;
			const values = denormalized( output );
			const times = denormalized( input );
			const targets = [];

			if ( property === 'morphTargetInfluences' ) {

				node.traverse( ( object ) => {

					if ( object.morphTargetInfluences ) targets.push( object.name ? object.name : object.uuid );

				} );

			} else {

				targets.push( node.name ? node.name : node.uuid );

			}

			const Track = property === 'quaternion' ? QuaternionKeyframeTrack : property === 'morphTargetInfluences' ? NumberKeyframeTrack : VectorKeyframeTrack;

			for ( const name of targets ) {

				const track = new Track( name + '.' + property, times, values, interpolation === 'CUBICSPLINE' ? InterpolateLinear : interpolation );

				if ( interpolation === 'CUBICSPLINE' ) {

					const Cubic = Track === QuaternionKeyframeTrack ? GLTFCubicSplineQuaternionInterpolant : GLTFCubicSplineInterpolant;
					track.createInterpolant = function ( result ) {

						return new Cubic( this.times, this.values, this.getValueSize() / 3, result );

					};

					track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true;

				}

				tracks.push( track );

			}

		}

		const clip = new AnimationClip( definition.name || 'animation_' + index, undefined, tracks );
		this.associations.set( clip, { animations: index } );
		return clip;

	}

}
