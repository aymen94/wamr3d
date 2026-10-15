// Textures, render targets and loading images.

import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NearestFilter, NoColorSpace, UVMapping, UnsignedByteType } from './constants.js';
import { ignored, lazyUUID } from './engine.js';
import { Vector2, Vector4 } from './math.js';

// Images live in the browser, so the engine only carries a texture's id and the
// renderer's host looks the image up here. A texture is kept until dispose().
export const textureSources = new Map();
let nextTextureId = 1;

export class Texture {

	constructor( image = null ) {

		this.id = nextTextureId ++;
		this.name = '';
		this.image = image;
		this.version = 0;
		this.flipY = true;
		this.wrapS = this.wrapT = ClampToEdgeWrapping;
		this.magFilter = LinearFilter;
		this.minFilter = LinearMipmapLinearFilter;
		this.generateMipmaps = true;
		this.colorSpace = NoColorSpace;
		this.offset = new Vector2( 0, 0 );
		this.repeat = new Vector2( 1, 1 );
		this.center = new Vector2( 0, 0 );
		this.rotation = 0;
		this.mapping = UVMapping;
		textureSources.set( this.id, this );

	}

	/** Set to true after changing `image` or its pixels. */
	set needsUpdate( value ) {

		if ( value ) this.version ++;

	}

	dispose() {

		textureSources.delete( this.id );

	}

}

Texture.prototype.isTexture = true;
lazyUUID( Texture );

// Backends that may hold the GPU side of render targets.
export const backends = new Set();

/**
 * Something to draw into instead of the canvas, with `texture` usable as a material's
 * map. As in three.js, what is drawn into it is linear colour without tone mapping.
 * `type` UnsignedByteType (default) stores 8 bits per channel, HalfFloatType or
 * FloatType 16-bit floats. `samples` above 1 multisamples (4x) when the renderer is
 * antialiased. Depth is always kept; there are no depth textures, stencil or multiple
 * colour attachments yet.
 */
export class RenderTarget {

	constructor( width = 1, height = 1, options = {} ) {

		this.width = width;
		this.height = height;
		this.depth = 1;
		this.samples = options.samples ?? 0;
		this.depthBuffer = options.depthBuffer ?? true;
		this.stencilBuffer = false;
		this.scissor = new Vector4( 0, 0, width, height );
		this.scissorTest = false;
		this.viewport = new Vector4( 0, 0, width, height );
		const texture = new Texture( { width, height, depth: 1 } );
		texture.isRenderTargetTexture = true;
		texture.renderTarget = this;
		texture.flipY = false;
		texture.generateMipmaps = options.generateMipmaps ?? false;
		texture.minFilter = options.minFilter ?? LinearFilter;
		texture.magFilter = options.magFilter ?? LinearFilter;
		texture.type = options.type ?? UnsignedByteType;
		texture.colorSpace = options.colorSpace ?? NoColorSpace;
		if ( options.depthTexture || ( options.count ?? 1 ) > 1 || options.stencilBuffer ) ignored( 'RenderTarget depth textures, stencil and multiple attachments' );
		this.texture = texture;
		this.textures = [ texture ];

	}

	setSize( width, height ) {

		this.width = this.texture.image.width = width;
		this.height = this.texture.image.height = height;
		this.viewport.set( 0, 0, width, height );
		this.scissor.set( 0, 0, width, height );

	}

	dispose() {

		for ( const backend of backends ) backend.disposeRenderTarget( this.texture.id );

	}

}

RenderTarget.prototype.isRenderTarget = true;

/** The same as `RenderTarget`; the name three.js code written for WebGL uses. */
export class WebGLRenderTarget extends RenderTarget {}

WebGLRenderTarget.prototype.isWebGLRenderTarget = true;

/** Pixels from an array: `data` is RGBA, one byte per channel, rows bottom to top. */
export class DataTexture extends Texture {

	constructor( data, width, height ) {

		super( { data, width, height } );
		this.flipY = false;
		this.generateMipmaps = false;
		this.magFilter = this.minFilter = NearestFilter;

	}

}

export class CanvasTexture extends Texture {

	constructor( canvas ) {

		super( canvas );
		this.needsUpdate = true;

	}

}

export class TextureLoader {

	load( url, onLoad, onProgress, onError ) {

		const texture = new Texture();

		fetch( url ).then( ( response ) => {

			if ( ! response.ok ) throw new Error( `WAMR3D: could not load ${url} (${response.status})` );
			return response.blob();

		} ).then( ( blob ) => createImageBitmap( blob ) ).then( ( image ) => {

			texture.image = image;
			texture.needsUpdate = true;
			if ( onLoad ) onLoad( texture );

		} ).catch( ( error ) => {

			if ( onError ) onError( error );
			else console.error( error );

		} );

		return texture;

	}

}
