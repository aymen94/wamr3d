// EffectComposer: passes run in order between two render targets.
//
// Part of the post-processing add-on; `../passes.js` gathers it.

import { HalfFloatType, Vector2, WebGLRenderTarget } from '../../../compat.js';
import { CopyShader } from './shaders.js';
import { ShaderPass } from './passes.js';

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
