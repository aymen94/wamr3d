// GLSL shader materials with three.js's lights and shadows. three.js's WebGPU renderer
// draws no GLSL, so the references of these cases are drawn by three.js's WebGLRenderer,
// and WAMR3D draws them with WebGL 2 (see WEBGL_REFERENCE in `../cases.js`).
//
// Part of the visual parity cases; `../cases.js` gathers them.

import { stage } from './common.js';

// three.js's documented recipe for a shader material that receives shadows: the vertex
// chunks up to `shadowmap_vertex`, then `getShadowMask()` in the fragment stage.
const VERTEX = `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
	#include <beginnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	vNormal = normalize( transformedNormal );
	vViewPosition = - mvPosition.xyz;
}
`;

// Lambert-like light from every kind, each times the shadow mask.
const MASK_FRAGMENT = `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform vec3 diffuse;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main() {
	vec3 normal = normalize( vNormal );
	vec3 geometryPosition = - vViewPosition;
	vec3 direct = vec3( 0.0 );
	IncidentLight light;
	#if NUM_DIR_LIGHTS > 0
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
			getDirectionalLightInfo( directionalLights[ i ], light );
			direct += light.color * saturate( dot( normal, light.direction ) );
		}
	#endif
	#if NUM_SPOT_LIGHTS > 0
		for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
			getSpotLightInfo( spotLights[ i ], geometryPosition, light );
			direct += light.color * saturate( dot( normal, light.direction ) );
		}
	#endif
	#if NUM_POINT_LIGHTS > 0
		for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
			getPointLightInfo( pointLights[ i ], geometryPosition, light );
			direct += light.color * saturate( dot( normal, light.direction ) );
		}
	#endif
	gl_FragColor = vec4( diffuse * ( ambientLightColor + direct * getShadowMask() ), 1.0 );
	#include <colorspace_fragment>
}
`;

// three.js's own pattern of lights_fragment_begin: an unrolled loop over the directional
// lights, each shadowed by its own map, the lights without shadows after those with.
const UNROLLED_FRAGMENT = `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform vec3 diffuse;
varying vec3 vNormal;
void main() {
	vec3 normal = normalize( vNormal );
	vec3 irradiance = ambientLightColor;
	#if NUM_DIR_LIGHTS > 0
		DirectionalLight directionalLight;
		float shadow;
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
			DirectionalLightShadow directionalLightShadow;
		#endif
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
			directionalLight = directionalLights[ i ];
			shadow = 1.0;
			#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
				directionalLightShadow = directionalLightShadows[ i ];
				shadow = receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
			#endif
			irradiance += directionalLight.color * saturate( dot( normal, directionalLight.direction ) ) * shadow;
		}
		#pragma unroll_loop_end
	#endif
	gl_FragColor = vec4( diffuse * irradiance, 1.0 );
	#include <colorspace_fragment>
}
`;

function material( L, color, fragmentShader = MASK_FRAGMENT ) {

	return new L.ShaderMaterial( {
		lights: true,
		uniforms: L.UniformsUtils.merge( [ L.UniformsLib.lights, { diffuse: { value: new L.Color( color ) } } ] ),
		vertexShader: VERTEX,
		fragmentShader
	} );

}

// A floor, a box that casts and receives, a ball and a ring that cast, and three instanced
// posts; `fragment` is the shader of every material.
function shadowScene( L, fragment ) {

	const { scene, camera } = stage( L, 0, 4.5, 7 );
	const floor = new L.Mesh( new L.PlaneGeometry( 10, 10 ), material( L, 0xd8d0c0, fragment ) );
	floor.rotation.x = - Math.PI / 2;
	floor.position.y = - 1;
	floor.receiveShadow = true;
	const box = new L.Mesh( new L.BoxGeometry( 1.2, 1.2, 1.2 ), material( L, 0x4f8cff, fragment ) );
	box.position.set( - 1.4, - 0.4, 0 );
	box.rotation.y = 0.5;
	box.castShadow = box.receiveShadow = true;
	const ball = new L.Mesh( new L.SphereGeometry( 0.6, 32, 16 ), material( L, 0xff6a3a, fragment ) );
	ball.position.set( 0.9, 0.3, 0.6 );
	ball.castShadow = true;
	const ring = new L.Mesh( new L.TorusGeometry( 0.45, 0.14, 16, 48 ), material( L, 0x6ad06a, fragment ) );
	ring.position.set( 0.2, 0.9, - 1.2 );
	ring.rotation.x = 1.1;
	ring.castShadow = ring.receiveShadow = true;
	const posts = new L.InstancedMesh( new L.CylinderGeometry( 0.12, 0.12, 1.4, 16 ), material( L, 0xe0c060, fragment ), 3 );
	const place = new L.Matrix4();

	for ( let i = 0; i < 3; i ++ ) {

		place.makeTranslation( 2.2, - 0.3, - 1.5 + i * 1.1 );
		posts.setMatrixAt( i, place );

	}

	posts.castShadow = posts.receiveShadow = true;
	scene.add( floor, box, ball, ring, posts );
	return { scene, camera };

}

function sun( L, color, intensity, x, y, z ) {

	const light = new L.DirectionalLight( color, intensity );
	light.position.set( x, y, z );
	light.castShadow = true;
	light.shadow.mapSize.set( 1024, 1024 );
	light.shadow.camera.left = light.shadow.camera.bottom = - 5;
	light.shadow.camera.right = light.shadow.camera.top = 5;
	light.shadow.camera.far = 20;
	light.shadow.camera.updateProjectionMatrix();
	light.shadow.bias = - 0.0005;
	return light;

}

export const SHADER = {

	// A directional light's shadow through getShadowMask(), PCF, with a shadow intensity
	// below 1 and a radius; the ball does not receive.
	shader_shadows_directional( L ) {

		const { scene, camera } = shadowScene( L, MASK_FRAGMENT );
		const light = sun( L, 0xffffff, 1.5, 3, 6, 2 );
		light.shadow.intensity = 0.9;
		light.shadow.radius = 2;
		scene.add( light, new L.AmbientLight( 0x8090a0, 0.6 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// Two directional lights, one without a shadow and met first by WAMR3D's traversal:
	// three.js puts the shadowed one first, and the unrolled loop pairs light i with
	// shadow map i.
	shader_shadows_unrolled( L ) {

		const { scene, camera } = shadowScene( L, UNROLLED_FRAGMENT );
		const fill = new L.DirectionalLight( 0xffd0a0, 0.9 );
		fill.position.set( - 4, 3, 1 );
		scene.add( sun( L, 0xffffff, 1.2, 2, 6, 3 ), fill, new L.AmbientLight( 0x8090a0, 0.5 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// A spot light's and a point light's shadows through getShadowMask(), PCF.
	shader_shadows_spot_point( L ) {

		const { scene, camera } = shadowScene( L, MASK_FRAGMENT );
		const spot = new L.SpotLight( 0xffffff, 40, 0, 0.6, 0.3, 2 );
		spot.position.set( - 2, 6, 3 );
		spot.castShadow = true;
		spot.shadow.mapSize.set( 1024, 1024 );
		spot.shadow.bias = - 0.0005;
		const bulb = new L.PointLight( 0xffe0b0, 12, 0, 2 );
		bulb.position.set( 1.5, 2.2, - 0.2 );
		bulb.castShadow = true;
		bulb.shadow.mapSize.set( 512, 512 );
		bulb.shadow.bias = - 0.002;
		scene.add( spot, spot.target, bulb, new L.AmbientLight( 0x8090a0, 0.4 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;

		} };

	},

	// VSMShadowMap: a directional light's blurred moments.
	shader_shadows_vsm( L ) {

		const { scene, camera } = shadowScene( L, MASK_FRAGMENT );
		const light = sun( L, 0xffffff, 1.5, 3, 6, 2 );
		light.shadow.radius = 4;
		light.shadow.blurSamples = 8;
		light.shadow.bias = - 0.002;
		scene.add( light, new L.AmbientLight( 0x8090a0, 0.5 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = L.VSMShadowMap;

		} };

	},

	// BasicShadowMap: unfiltered maps of a directional and a point light.
	shader_shadows_basic( L ) {

		const { scene, camera } = shadowScene( L, MASK_FRAGMENT );
		const bulb = new L.PointLight( 0xffe0b0, 8, 0, 2 );
		bulb.position.set( - 0.5, 2.4, 1.6 );
		bulb.castShadow = true;
		bulb.shadow.mapSize.set( 512, 512 );
		bulb.shadow.bias = - 0.002;
		scene.add( sun( L, 0xffffff, 1.1, 3, 6, 2 ), bulb, new L.AmbientLight( 0x8090a0, 0.5 ) );
		return { scene, camera, setup( renderer ) {

			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = L.BasicShadowMap;

		} };

	}

};
