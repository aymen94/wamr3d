// FBX animation stacks into AnimationClips: curve nodes on a model's translation,
// rotation (with its pre- and post-rotation) and scaling, and on blend shape channels'
// deform percent, sampled at the union of their keys.
//
// Part of the FBXLoader add-on (`../FBXLoader.js`).

import { AnimationClip, Euler, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from '../../../compat.js';
import { arrayOf, properties } from './parser.js';

// FBX time is in units of 1/46186158000 s.
const TICKS_PER_SECOND = 46186158000;
const DEG = Math.PI / 180;

function readCurve( node ) {

	const times = Array.from( arrayOf( node, 'KeyTime' ), ( t ) => t / TICKS_PER_SECOND );
	const values = Array.from( arrayOf( node, 'KeyValueFloat' ) );
	return { times, values };

}

function sample( curve, time ) {

	const { times, values } = curve;
	if ( times.length === 0 ) return 0;
	if ( time <= times[ 0 ] ) return values[ 0 ];
	if ( time >= times[ times.length - 1 ] ) return values[ values.length - 1 ];
	let i = 1;
	while ( times[ i ] < time ) i ++;
	const t = ( time - times[ i - 1 ] ) / ( times[ i ] - times[ i - 1 ] );
	return values[ i - 1 ] + ( values[ i ] - values[ i - 1 ] ) * t;

}

// The curves of a curve node per axis, with the node's own values for missing axes.
function axisCurves( scene, curveNodeId, defaults ) {

	const node = scene.objects.get( curveNodeId );
	const props = properties( node );
	const axes = [ 'X', 'Y', 'Z' ].map( ( axis, i ) => {

		const link = scene.childrenOf( curveNodeId ).find( ( c ) => c.relationship === 'd|' + axis );
		const curve = link ? readCurve( scene.objects.get( link.id ) ) : null;
		const fallback = props[ 'd|' + axis ]?.value ?? defaults[ i ];
		return { curve, fallback };

	} );

	const times = [ ...new Set( axes.flatMap( ( a ) => a.curve?.times ?? [] ) ) ].sort( ( a, b ) => a - b );
	return { axes, times };

}

function vectorTrack( name, curves ) {

	if ( curves.times.length === 0 ) return null;
	const values = [];
	for ( const time of curves.times ) for ( const { curve, fallback } of curves.axes ) values.push( curve ? sample( curve, time ) : fallback );
	return new VectorKeyframeTrack( name, curves.times, values );

}

function rotationTrack( name, curves, transform ) {

	if ( curves.times.length === 0 ) return null;
	const euler = new Euler(), quaternion = new Quaternion(), previous = new Quaternion();
	const values = [];

	curves.times.forEach( ( time, k ) => {

		const [ x, y, z ] = curves.axes.map( ( { curve, fallback } ) => ( curve ? sample( curve, time ) : fallback ) * DEG );
		euler.set( x, y, z, transform.eulerOrder );
		quaternion.setFromEuler( euler );
		if ( transform.preRotation ) quaternion.premultiply( transform.preRotation );
		if ( transform.postRotationInverse ) quaternion.multiply( transform.postRotationInverse );
		// the shorter way between keys
		if ( k > 0 && previous.dot( quaternion ) < 0 ) quaternion.set( - quaternion.x, - quaternion.y, - quaternion.z, - quaternion.w );
		previous.copy( quaternion );
		values.push( quaternion.x, quaternion.y, quaternion.z, quaternion.w );

	} );

	return new QuaternionKeyframeTrack( name, curves.times, values );

}

/**
 * One clip per `AnimationStack`. `scene` gives `objects` (id -> node), `childrenOf(id)` and
 * `parentsOf(id)` (connections as `{ id, relationship }`), `models` (id -> Object3D),
 * `transforms` (id -> the model's Lcl values and rotation data) and `morphChannels` (channel id -> [ { mesh, index } ]).
 */
export function parseAnimations( scene ) {

	const clips = [];

	for ( const [ stackId, stack ] of scene.objects ) {

		if ( stack.name !== 'AnimationStack' ) continue;
		const tracks = [];

		for ( const layer of scene.childrenOf( stackId ) ) {

			for ( const curveNodeLink of scene.childrenOf( layer.id ) ) {

				const curveNodeId = curveNodeLink.id;
				if ( scene.objects.get( curveNodeId )?.name !== 'AnimationCurveNode' ) continue;

				for ( const target of scene.parentsOf( curveNodeId ) ) {

					const model = scene.models.get( target.id );

					if ( model ) {

						const transform = scene.transforms.get( target.id );

						if ( target.relationship === 'Lcl Translation' ) {

							const track = vectorTrack( model.name + '.position', axisCurves( scene, curveNodeId, transform.translation ) );
							if ( track ) tracks.push( track );

						} else if ( target.relationship === 'Lcl Rotation' ) {

							const track = rotationTrack( model.name + '.quaternion', axisCurves( scene, curveNodeId, transform.rotation ), transform );
							if ( track ) tracks.push( track );

						} else if ( target.relationship === 'Lcl Scaling' ) {

							const track = vectorTrack( model.name + '.scale', axisCurves( scene, curveNodeId, transform.scaling ) );
							if ( track ) tracks.push( track );

						}

					} else if ( target.relationship === 'DeformPercent' && scene.morphChannels.has( target.id ) ) {

						const link = scene.childrenOf( curveNodeId ).find( ( c ) => c.relationship === 'd|DeformPercent' );
						if ( ! link ) continue;
						const curve = readCurve( scene.objects.get( link.id ) );

						for ( const { mesh, index } of scene.morphChannels.get( target.id ) ) {

							tracks.push( new NumberKeyframeTrack( `${mesh.name}.morphTargetInfluences[${index}]`, curve.times, curve.values.map( ( v ) => v / 100 ) ) );

						}

					}

				}

			}

		}

		const name = String( stack.props[ 1 ] ?? '' ).replace( /^AnimStack::/, '' );
		clips.push( new AnimationClip( name, - 1, tracks ) );

	}

	return clips;

}
