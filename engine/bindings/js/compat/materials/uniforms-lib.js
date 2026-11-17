// UniformsLib: three.js's uniform sets of its built-in shaders, which shader materials
// merge into their own (`UniformsUtils.merge( [ UniformsLib.lights, ... ] )`).
//
// Part of the materials; `../materials.js` gathers them. Ported from three.js (MIT).

import { Color, Matrix3, Vector2, Vector3 } from '../math.js';

/**
 * three.js `UniformsLib`. The values are what three.js starts them with; with `lights` or
 * `fog` on a shader material, the renderer gives the frame's values to those uniforms by
 * name whether or not the material has them.
 */
export const UniformsLib = {

	common: {
		diffuse: { value: new Color( 0xffffff ) },
		opacity: { value: 1.0 },
		map: { value: null },
		mapTransform: { value: new Matrix3() },
		alphaMap: { value: null },
		alphaMapTransform: { value: new Matrix3() },
		alphaTest: { value: 0 }
	},

	specularmap: {
		specularMap: { value: null },
		specularMapTransform: { value: new Matrix3() }
	},

	envmap: {
		envMap: { value: null },
		envMapRotation: { value: new Matrix3() },
		reflectivity: { value: 1.0 },
		ior: { value: 1.5 },
		refractionRatio: { value: 0.98 },
		dfgLUT: { value: null }
	},

	aomap: {
		aoMap: { value: null },
		aoMapIntensity: { value: 1 },
		aoMapTransform: { value: new Matrix3() }
	},

	lightmap: {
		lightMap: { value: null },
		lightMapIntensity: { value: 1 },
		lightMapTransform: { value: new Matrix3() }
	},

	bumpmap: {
		bumpMap: { value: null },
		bumpMapTransform: { value: new Matrix3() },
		bumpScale: { value: 1 }
	},

	normalmap: {
		normalMap: { value: null },
		normalMapTransform: { value: new Matrix3() },
		normalScale: { value: new Vector2( 1, 1 ) }
	},

	displacementmap: {
		displacementMap: { value: null },
		displacementMapTransform: { value: new Matrix3() },
		displacementScale: { value: 1 },
		displacementBias: { value: 0 }
	},

	emissivemap: {
		emissiveMap: { value: null },
		emissiveMapTransform: { value: new Matrix3() }
	},

	metalnessmap: {
		metalnessMap: { value: null },
		metalnessMapTransform: { value: new Matrix3() }
	},

	roughnessmap: {
		roughnessMap: { value: null },
		roughnessMapTransform: { value: new Matrix3() }
	},

	gradientmap: {
		gradientMap: { value: null }
	},

	fog: {
		fogDensity: { value: 0.00025 },
		fogNear: { value: 1 },
		fogFar: { value: 2000 },
		fogColor: { value: new Color( 0xffffff ) }
	},

	lights: {
		ambientLightColor: { value: [] },
		lightProbe: { value: [] },
		sunLights: { value: [], properties: { direction: {}, color: {} } },
		sunLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } },
		sunShadowMatrix: { value: [] },
		sunShadowCascade: { value: [] },
		directionalLights: { value: [], properties: { direction: {}, color: {} } },
		directionalLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } },
		directionalShadowMatrix: { value: [] },
		spotLights: { value: [], properties: { color: {}, position: {}, direction: {}, distance: {}, coneCos: {}, penumbraCos: {}, decay: {} } },
		spotLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} } },
		spotLightMap: { value: [] },
		spotLightMatrix: { value: [] },
		pointLights: { value: [], properties: { color: {}, position: {}, decay: {}, distance: {} } },
		pointLightShadows: { value: [], properties: { shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {}, shadowCameraNear: {}, shadowCameraFar: {} } },
		pointShadowMatrix: { value: [] },
		hemisphereLights: { value: [], properties: { direction: {}, skyColor: {}, groundColor: {} } },
		rectAreaLights: { value: [], properties: { color: {}, position: {}, width: {}, height: {} } },
		ltc_1: { value: null },
		ltc_2: { value: null },
		probesSH: { value: null },
		probesMin: { value: new Vector3() },
		probesMax: { value: new Vector3() },
		probesResolution: { value: new Vector3() }
	},

	points: {
		diffuse: { value: new Color( 0xffffff ) },
		opacity: { value: 1.0 },
		size: { value: 1.0 },
		scale: { value: 1.0 },
		map: { value: null },
		alphaMap: { value: null },
		alphaMapTransform: { value: new Matrix3() },
		alphaTest: { value: 0 },
		uvTransform: { value: new Matrix3() }
	},

	sprite: {
		diffuse: { value: new Color( 0xffffff ) },
		opacity: { value: 1.0 },
		center: { value: new Vector2( 0.5, 0.5 ) },
		rotation: { value: 0.0 },
		map: { value: null },
		mapTransform: { value: new Matrix3() },
		alphaMap: { value: null },
		alphaMapTransform: { value: new Matrix3() },
		alphaTest: { value: 0 }
	}

};
