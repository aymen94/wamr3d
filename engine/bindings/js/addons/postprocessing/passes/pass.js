// Pass and FullScreenQuad: the base of every pass, and drawing an effect over the target.
//
// Part of the post-processing add-on; `../passes.js` gathers it.

import { Mesh, NoToneMapping, OrthographicCamera, PlaneGeometry, Scene } from '../../../compat.js';

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
export function drawQuad( renderer, quad, target, keep = false ) {

	const autoClear = renderer.autoClear;
	renderer.setRenderTarget( target );
	renderer.autoClear = ! keep;
	quad.render( renderer );
	renderer.autoClear = autoClear;

}
