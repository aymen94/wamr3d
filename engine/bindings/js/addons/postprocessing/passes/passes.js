// RenderPass, ShaderPass, OutputPass, FXAAPass and UnrealBloomPass.
//
// Part of the post-processing add-on; `../passes.js` gathers it.

import { Color, HalfFloatType, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget } from '../../../compat.js';
import { EffectMaterial } from '../../../compat/materials.js';
import { BLOOM, BLUR, COPY, FXAAShader, HIGH_PASS, OUTPUT, OutputShader, effectParams } from './shaders.js';
import { FullScreenQuad, Pass, drawQuad } from './pass.js';

/** Draws a scene into the read buffer (or the canvas when last). */
export class RenderPass extends Pass {

	constructor( scene, camera, overrideMaterial = null, clearColor = null, clearAlpha = null ) {

		super();
		this.scene = scene;
		this.camera = camera;
		this.overrideMaterial = overrideMaterial;
		this.clearColor = clearColor;
		this.clearAlpha = clearAlpha;
		this.clear = true;
		this.clearDepth = false;
		this.needsSwap = false;

	}

	render( renderer, writeBuffer, readBuffer ) {

		const autoClear = renderer.autoClear, clearColor = renderer.getClearColor( new Color() );
		if ( this.clearColor !== null ) renderer.setClearColor( this.clearColor );
		renderer.autoClear = this.clear;
		renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );
		const override = this.scene.overrideMaterial;
		if ( this.overrideMaterial !== null ) this.scene.overrideMaterial = this.overrideMaterial;
		renderer.render( this.scene, this.camera );
		this.scene.overrideMaterial = override;
		renderer.autoClear = autoClear;
		renderer.setClearColor( clearColor );

	}

}

/**
 * A full-screen shader over the read buffer. three.js shaders that WAMR3D knows
 * (CopyShader, LuminosityHighPassShader, FXAAShader, OutputShader) draw with its effects;
 * others are a GLSL `ShaderMaterial` (WebGL 2 only).
 */
export class ShaderPass extends Pass {

	constructor( shader, textureID = 'tDiffuse' ) {

		super();
		this.textureID = textureID;

		if ( shader instanceof ShaderMaterial ) {

			this.uniforms = shader.uniforms;
			this.material = shader;

		} else if ( shader ) {

			this.uniforms = UniformsUtils.clone( shader.uniforms );
			this.effect = shader.effect ?? 0;
			this.material = this.effect ? new EffectMaterial( this.effect ) : new ShaderMaterial( { name: shader.name ?? 'unspecified', defines: Object.assign( {}, shader.defines ), uniforms: this.uniforms, vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader } );

		}

		this.fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer ) {

		if ( this.uniforms[ this.textureID ] ) this.uniforms[ this.textureID ].value = readBuffer.texture;

		if ( this.effect ) {

			this.material.map = readBuffer.texture;
			if ( this.effect === OUTPUT ) {

				this.material.params[ 0 ] = renderer.toneMapping;
				this.material.params[ 1 ] = renderer.toneMappingExposure;

			} else effectParams( this.effect, this.uniforms, this.material.params );

		}

		drawQuad( renderer, this.fsQuad, this.renderToScreen ? null : writeBuffer, ! this.clear );

	}

	dispose() {

		this.material.dispose();
		this.fsQuad.dispose();

	}

}

/** three.js `OutputPass`: tone mapping (the renderer's) as the last pass; the canvas encodes to sRGB. */
export class OutputPass extends ShaderPass {

	constructor() {

		super( OutputShader );
		this.isOutputPass = true;

	}

}

/** three.js `FXAAPass`: FXAA over the read buffer. */
export class FXAAPass extends ShaderPass {

	constructor() {

		super( FXAAShader );
		this.isFXAAPass = true;

	}

}

const KERNEL_SIZES = [ 3, 5, 7, 9, 11 ];

/**
 * three.js `UnrealBloomPass`: the bright parts of the read buffer, blurred at five sizes
 * and added back. `strength`, `radius` and `threshold` as in three.js.
 */
export class UnrealBloomPass extends Pass {

	constructor( resolution = new Vector2( 256, 256 ), strength = 1, radius = 0, threshold = 0 ) {

		super();
		this.strength = strength;
		this.radius = radius;
		this.threshold = threshold;
		this.resolution = resolution.clone();
		this.clearColor = null;
		this.needsSwap = false;
		this.nMips = 5;
		const size = ( level ) => [ Math.max( 1, Math.round( this.resolution.x / 2 ** ( level + 1 ) ) ), Math.max( 1, Math.round( this.resolution.y / 2 ** ( level + 1 ) ) ) ];
		const target = ( [ w, h ] ) => new WebGLRenderTarget( w, h, { type: HalfFloatType } );
		this.renderTargetBright = target( size( 0 ) );
		this.renderTargetsHorizontal = KERNEL_SIZES.map( ( _, i ) => target( size( i ) ) );
		this.renderTargetsVertical = KERNEL_SIZES.map( ( _, i ) => target( size( i ) ) );
		this._highPass = new EffectMaterial( HIGH_PASS );
		this._blur = new EffectMaterial( BLUR );
		this._composite = new EffectMaterial( BLOOM );
		this._copy = new EffectMaterial( COPY );
		this._copy.params[ 0 ] = 1;
		this._blend = new EffectMaterial( COPY );
		this._blend.params[ 0 ] = 1;
		this._blend.transparent = true;
		this._blend.blending = 2;
		this.fsQuad = new FullScreenQuad( this._copy );

	}

	setSize( width, height ) {

		this.resolution.set( width, height );

		for ( let i = 0; i < this.nMips; i ++ ) {

			const w = Math.max( 1, Math.round( width / 2 ** ( i + 1 ) ) ), h = Math.max( 1, Math.round( height / 2 ** ( i + 1 ) ) );
			this.renderTargetsHorizontal[ i ].setSize( w, h );
			this.renderTargetsVertical[ i ].setSize( w, h );
			if ( i === 0 ) this.renderTargetBright.setSize( w, h );

		}

	}

	render( renderer, writeBuffer, readBuffer ) {

		const quad = this.fsQuad;

		if ( this.renderToScreen ) {

			quad.material = this._copy;
			this._copy.map = readBuffer.texture;
			drawQuad( renderer, quad, null );

		}

		// the bright parts
		const high = this._highPass;
		high.map = readBuffer.texture;
		high.params.fill( 0 );
		high.params[ 0 ] = this.threshold;
		high.params[ 1 ] = 0.01;
		quad.material = high;
		drawQuad( renderer, quad, this.renderTargetBright );

		// blurred at each size, from the previous size's result
		let input = this.renderTargetBright;
		quad.material = this._blur;

		for ( let i = 0; i < this.nMips; i ++ ) {

			const blur = this._blur;
			blur.params.fill( 0 );
			blur.params[ 2 ] = blur.params[ 3 ] = KERNEL_SIZES[ i ];
			blur.map = input.texture;
			blur.params[ 0 ] = 1;
			drawQuad( renderer, quad, this.renderTargetsHorizontal[ i ] );
			blur.map = this.renderTargetsHorizontal[ i ].texture;
			blur.params[ 0 ] = 0;
			blur.params[ 1 ] = 1;
			drawQuad( renderer, quad, this.renderTargetsVertical[ i ] );
			input = this.renderTargetsVertical[ i ];

		}

		// the composite, added onto the read buffer (or the canvas)
		const composite = this._composite;
		[ composite.map, composite.normalMap, composite.roughnessMap, composite.metalnessMap, composite.emissiveMap ] = this.renderTargetsVertical.map( ( t ) => t.texture );
		composite.params.fill( 0 );
		composite.params[ 0 ] = this.strength;
		composite.params[ 1 ] = this.radius;
		quad.material = composite;
		drawQuad( renderer, quad, this.renderTargetsHorizontal[ 0 ] );
		this._blend.map = this.renderTargetsHorizontal[ 0 ].texture;
		quad.material = this._blend;
		drawQuad( renderer, quad, this.renderToScreen ? null : readBuffer, true );

	}

	dispose() {

		for ( const target of [ this.renderTargetBright, ...this.renderTargetsHorizontal, ...this.renderTargetsVertical ] ) target.dispose();
		for ( const material of [ this._highPass, this._blur, this._composite, this._copy, this._blend ] ) material.dispose();
		this.fsQuad.dispose();

	}

}
