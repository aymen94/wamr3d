// The effect shaders (copy, luminosity high-pass, FXAA, output) and their settings.
//
// Part of the post-processing add-on; `../passes.js` gathers it.

import { Vector2 } from '../../../compat.js';

// Effect ids of the renderer (see `EffectMaterial`).
export const COPY = 1, HIGH_PASS = 2, BLUR = 3, BLOOM = 4, FXAA = 5, OUTPUT = 6;

// ---------------------------------------------------------------- shaders

const VERTEX = 'varying vec2 vUv;\nvoid main() {\n\tvUv = uv;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}';

/** three.js `CopyShader`; drawn by the renderer's copy effect. */
export const CopyShader = {
	name: 'CopyShader',
	effect: COPY,
	uniforms: { tDiffuse: { value: null }, opacity: { value: 1.0 } },
	vertexShader: VERTEX,
	fragmentShader: 'uniform float opacity;\nuniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n\tgl_FragColor = texture2D( tDiffuse, vUv ) * opacity;\n}'
};

/** three.js `LuminosityHighPassShader`; drawn by the renderer's high-pass effect. */
export const LuminosityHighPassShader = {
	name: 'LuminosityHighPassShader',
	effect: HIGH_PASS,
	uniforms: { tDiffuse: { value: null }, luminosityThreshold: { value: 1.0 }, smoothWidth: { value: 1.0 }, defaultColor: { value: null }, defaultOpacity: { value: 0.0 } },
	vertexShader: VERTEX,
	fragmentShader: ''
};

/** three.js `FXAAShader`; drawn by the renderer's FXAA effect (`resolution` is taken from the input). */
export const FXAAShader = {
	name: 'FXAAShader',
	effect: FXAA,
	uniforms: { tDiffuse: { value: null }, resolution: { value: new Vector2( 1 / 1024, 1 / 512 ) } },
	vertexShader: VERTEX,
	fragmentShader: ''
};

/** three.js `OutputShader`; drawn by the renderer's output effect. */
export const OutputShader = {
	name: 'OutputShader',
	effect: OUTPUT,
	uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 } },
	vertexShader: VERTEX,
	fragmentShader: ''
};

// The 16 settings of an effect from a shader's uniforms.
export function effectParams( effect, uniforms, out ) {

	const value = ( name, fallback ) => uniforms[ name ]?.value ?? fallback;
	out.fill( 0 );

	if ( effect === COPY ) {

		out[ 0 ] = value( 'opacity', 1 );

	} else if ( effect === HIGH_PASS ) {

		const color = value( 'defaultColor', null );
		out[ 0 ] = value( 'luminosityThreshold', 1 );
		out[ 1 ] = value( 'smoothWidth', 1 );
		out[ 4 ] = color ? color.r : 0;
		out[ 5 ] = color ? color.g : 0;
		out[ 6 ] = color ? color.b : 0;
		out[ 7 ] = value( 'defaultOpacity', 0 );

	}

	return out;

}
