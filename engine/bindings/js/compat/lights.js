// Lights and their shadow settings.

import { OrthographicCamera, PerspectiveCamera } from './cameras.js';
import { Color, Vector2 } from './math.js';
import { Object3D } from './object3d.js';

// ---------------------------------------------------------------- lights

export class Light extends Object3D {

	constructor( color = 0xffffff, intensity = 1 ) {

		super();
		this.type = 'Light';
		this.color = new Color( color );
		this.intensity = intensity;

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.color.copy( source.color );
		this.intensity = source.intensity;
		return this;

	}

}

Light.prototype.isLight = true;

export class AmbientLight extends Light {

	constructor( color, intensity ) {

		super( color, intensity );
		this.type = 'AmbientLight';

	}

}

AmbientLight.prototype.isAmbientLight = true;

export class HemisphereLight extends Light {

	constructor( skyColor, groundColor = 0xffffff, intensity ) {

		super( skyColor, intensity );
		this.type = 'HemisphereLight';
		this.groundColor = new Color( groundColor );
		this.position.set( 0, 1, 0 );

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.groundColor.copy( source.groundColor );
		return this;

	}

}

HemisphereLight.prototype.isHemisphereLight = true;

export class DirectionalLight extends Light {

	constructor( color, intensity ) {

		super( color, intensity );
		this.type = 'DirectionalLight';
		this.position.set( 0, 1, 0 );
		this.target = new Object3D();
		this.shadow = new DirectionalLightShadow();

	}

}

DirectionalLight.prototype.isDirectionalLight = true;

// ---------------------------------------------------------------- shadows

/** A light's shadow settings, with the three.js defaults. */
export class LightShadow {

	constructor( camera ) {

		this.camera = camera;
		this.intensity = 1;
		this.bias = 0;
		this.normalBias = 0;
		this.radius = 1;
		this.blurSamples = 8;
		this.mapSize = new Vector2( 512, 512 );
		this.map = null;
		this.autoUpdate = true;
		this.needsUpdate = false;

	}

	copy( source ) {

		this.camera = source.camera.clone();
		this.intensity = source.intensity;
		this.bias = source.bias;
		this.radius = source.radius;
		this.normalBias = source.normalBias;
		this.mapSize.copy( source.mapSize );
		return this;

	}

	clone() {

		return new this.constructor().copy( this );

	}

	dispose() {}

}

export class DirectionalLightShadow extends LightShadow {

	constructor() {

		super( new OrthographicCamera( - 5, 5, 5, - 5, 0.5, 500 ) );

	}

}

DirectionalLightShadow.prototype.isDirectionalLightShadow = true;

/** The camera's field of view follows the light's cone: `2 * angle * focus`. */
export class SpotLightShadow extends LightShadow {

	constructor() {

		super( new PerspectiveCamera( 50, 1, 0.5, 500 ) );
		this.focus = 1;
		this.aspect = 1;

	}

	copy( source ) {

		super.copy( source );
		this.focus = source.focus;
		this.aspect = source.aspect;
		return this;

	}

}

SpotLightShadow.prototype.isSpotLightShadow = true;

/** Accepted so code runs; point lights do not cast shadows yet. */
export class PointLightShadow extends LightShadow {

	constructor() {

		super( new PerspectiveCamera( 90, 1, 0.5, 500 ) );

	}

}

PointLightShadow.prototype.isPointLightShadow = true;

/** Shines in all directions from its position. `distance` 0 means no cutoff. */
export class PointLight extends Light {

	constructor( color, intensity, distance = 0, decay = 2 ) {

		super( color, intensity );
		this.type = 'PointLight';
		this.distance = distance;
		this.decay = decay;
		this.shadow = new PointLightShadow();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.distance = source.distance;
		this.decay = source.decay;
		return this;

	}

}

PointLight.prototype.isPointLight = true;

/** A cone of light from its position towards `target`. `angle` is the cone's half angle. */
export class SpotLight extends Light {

	constructor( color, intensity, distance = 0, angle = Math.PI / 3, penumbra = 0, decay = 2 ) {

		super( color, intensity );
		this.type = 'SpotLight';
		this.position.set( 0, 1, 0 );
		this.target = new Object3D();
		this.distance = distance;
		this.angle = angle;
		this.penumbra = penumbra;
		this.decay = decay;
		this.shadow = new SpotLightShadow();

	}

	copy( source, recursive ) {

		super.copy( source, recursive );
		this.distance = source.distance;
		this.angle = source.angle;
		this.penumbra = source.penumbra;
		this.decay = source.decay;
		return this;

	}

}

SpotLight.prototype.isSpotLight = true;
