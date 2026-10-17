// Post-processing in the shape of three.js's EffectComposer add-ons. The built-in passes
// (copy, luminosity high pass, bloom, FXAA, output) draw with the renderer's own effect
// shaders on WebGPU and WebGL 2; a ShaderPass with any other shader draws its GLSL, which
// needs the WebGL 2 backend (as three.js's WebGPURenderer, WebGPU draws no GLSL).

import { Color, HalfFloatType, Mesh, NoToneMapping, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, UniformsUtils, Vector2, WebGLRenderTarget } from '../../compat.js';
import { EffectMaterial } from '../../compat/materials.js';

// Effect ids of the renderer (see `EffectMaterial`).
const COPY = 1, HIGH_PASS = 2, BLUR = 3, BLOOM = 4, FXAA = 5, OUTPUT = 6;

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
function effectParams( effect, uniforms, out ) {

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

// ---------------------------------------------------------------- Pass

export class Pass {

	constructor() {

		this.isPass = true;
		this.enabled = true;
		this.needsSwap = true;
		this.clear = false;
		this.renderToScreen = false;

	}

	setSize() {}

	render() {

		console.error( 'WAMR3D: Pass: .render() must be implemented in derived pass.' );

	}

	dispose() {}

}

let quadGeometry = null, quadCamera = null;

/** A quad covering the target, drawn with `material` (three.js `FullScreenQuad`). */
export class FullScreenQuad {

	constructor( material ) {

		quadGeometry ??= new PlaneGeometry( 2, 2 );
		quadCamera ??= new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this._scene = new Scene();
		this._mesh = new Mesh( quadGeometry, material );
		this._mesh.frustumCulled = false;
		this._scene.add( this._mesh );

	}

	get material() {

		return this._mesh.material;

	}

	set material( value ) {

		this._mesh.material = value;

	}

	// Without the renderer's tone mapping: effects tone-map in OutputPass, as in three.js.
	render( renderer ) {

		const toneMapping = renderer.toneMapping;
		renderer.toneMapping = NoToneMapping;
		renderer.render( this._scene, quadCamera );
		renderer.toneMapping = toneMapping;

	}

	dispose() {

		this._scene.remove( this._mesh );
		this._mesh.dispose();

	}

}

// Draws `quad` into `target` (null for the canvas), optionally over what it holds.
function drawQuad( renderer, quad, target, keep = false ) {

	const autoClear = renderer.autoClear;
	renderer.setRenderTarget( target );
	renderer.autoClear = ! keep;
	quad.render( renderer );
	renderer.autoClear = autoClear;

}

// ---------------------------------------------------------------- passes

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
		if ( overrideMaterial ) console.warn( 'WAMR3D: RenderPass: overrideMaterial is not supported and has no effect' );

	}

	render( renderer, writeBuffer, readBuffer ) {

		const autoClear = renderer.autoClear, clearColor = renderer.getClearColor( new Color() );
		if ( this.clearColor !== null ) renderer.setClearColor( this.clearColor );
		renderer.autoClear = this.clear;
		renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );
		renderer.render( this.scene, this.camera );
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

// ---------------------------------------------------------------- EffectComposer

/** three.js `EffectComposer`: passes over two half-float render targets, the last to the canvas. */
export class EffectComposer {

	constructor( renderer, renderTarget ) {

		this.renderer = renderer;
		this._pixelRatio = renderer.getPixelRatio();
		const size = renderer.getSize( new Vector2() );
		this._width = size.width ?? size.x;
		this._height = size.height ?? size.y;

		if ( renderTarget === undefined ) {

			renderTarget = new WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType } );
			renderTarget.texture.name = 'EffectComposer.rt1';

		} else {

			renderTarget.texture.name = 'EffectComposer.rt1';

		}

		this.renderTarget1 = renderTarget;
		this.renderTarget2 = new WebGLRenderTarget( this.renderTarget1.width, this.renderTarget1.height, { type: renderTarget.texture.type } );
		this.renderTarget2.texture.name = 'EffectComposer.rt2';
		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;
		this.renderToScreen = true;
		this.passes = [];
		this.copyPass = new ShaderPass( CopyShader );
		this.copyPass.material.blending = 0;
		this.clock = { last: performance.now() };

	}

	swapBuffers() {

		const tmp = this.readBuffer;
		this.readBuffer = this.writeBuffer;
		this.writeBuffer = tmp;

	}

	addPass( pass ) {

		this.passes.push( pass );
		pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

	}

	insertPass( pass, index ) {

		this.passes.splice( index, 0, pass );
		pass.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

	}

	removePass( pass ) {

		const index = this.passes.indexOf( pass );
		if ( index !== - 1 ) this.passes.splice( index, 1 );

	}

	isLastEnabledPass( passIndex ) {

		for ( let i = passIndex + 1; i < this.passes.length; i ++ ) if ( this.passes[ i ].enabled ) return false;
		return true;

	}

	render( deltaTime ) {

		if ( deltaTime === undefined ) {

			const now = performance.now();
			deltaTime = ( now - this.clock.last ) / 1000;
			this.clock.last = now;

		}

		const currentTarget = this.renderer.getRenderTarget();

		for ( let i = 0; i < this.passes.length; i ++ ) {

			const pass = this.passes[ i ];
			if ( pass.enabled === false ) continue;
			pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass( i );
			pass.render( this.renderer, this.writeBuffer, this.readBuffer, deltaTime, false );
			if ( pass.needsSwap ) this.swapBuffers();

		}

		this.renderer.setRenderTarget( currentTarget );

	}

	reset( renderTarget ) {

		if ( renderTarget === undefined ) {

			const size = this.renderer.getSize( new Vector2() );
			this._pixelRatio = this.renderer.getPixelRatio();
			this._width = size.width ?? size.x;
			this._height = size.height ?? size.y;
			renderTarget = this.renderTarget1.clone ? this.renderTarget1.clone() : new WebGLRenderTarget( this._width * this._pixelRatio, this._height * this._pixelRatio, { type: HalfFloatType } );
			renderTarget.setSize( this._width * this._pixelRatio, this._height * this._pixelRatio );

		}

		this.renderTarget1.dispose();
		this.renderTarget2.dispose();
		this.renderTarget1 = renderTarget;
		this.renderTarget2 = new WebGLRenderTarget( renderTarget.width, renderTarget.height, { type: renderTarget.texture.type } );
		this.writeBuffer = this.renderTarget1;
		this.readBuffer = this.renderTarget2;

	}

	setSize( width, height ) {

		this._width = width;
		this._height = height;
		const w = this._width * this._pixelRatio, h = this._height * this._pixelRatio;
		this.renderTarget1.setSize( w, h );
		this.renderTarget2.setSize( w, h );
		for ( const pass of this.passes ) pass.setSize( w, h );

	}

	setPixelRatio( pixelRatio ) {

		this._pixelRatio = pixelRatio;
		this.setSize( this._width, this._height );

	}

	dispose() {

		this.renderTarget1.dispose();
		this.renderTarget2.dispose();
		this.copyPass.dispose();

	}

}
