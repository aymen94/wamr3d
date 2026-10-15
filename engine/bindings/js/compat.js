// WAMR3D object API.
//
//   import * as WAMR3D from 'wamr3d/compat';
//   await WAMR3D.init();
//   const scene = new WAMR3D.Scene();
//   const mesh = new WAMR3D.Mesh( new WAMR3D.BoxGeometry(), new WAMR3D.MeshLambertMaterial( { color: 0x4f8cff } ) );
//   scene.add( mesh );
//   mesh.rotation.y = 0.5;
//
// Classes, properties and chaining over the engine. All state lives in one World inside
// the WebAssembly module; the objects here are thin handles onto it.


import * as W from './index.js';

export { FrontSide, BackSide, DoubleSide, BasicShadowMap, PCFShadowMap, PCFSoftShadowMap, VSMShadowMap, NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping, ACESFilmicToneMapping, CustomToneMapping, AgXToneMapping, NeutralToneMapping, WebGLCoordinateSystem, WebGPUCoordinateSystem, NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace, RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping, NearestFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter, LinearFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter, UnsignedByteType, FloatType, HalfFloatType, UVMapping, CubeReflectionMapping, CubeRefractionMapping, EquirectangularReflectionMapping, EquirectangularRefractionMapping, CubeUVReflectionMapping } from './compat/constants.js';
export { init, getWorld } from './compat/engine.js';
export { Vector2, Vector3, Vector4, Quaternion, Euler, Matrix3, Matrix4, ColorManagement, Color, Box3, Sphere, Plane, Ray, Frustum, Line3, Triangle, Spherical, Cylindrical } from './compat/math.js';
export { Object3D, Group, Scene, Fog, FogExp2 } from './compat/object3d.js';
export { Mesh, InstancedBufferAttribute, InstancedMesh, Line, Points, Sprite, LineSegments, LineLoop, LOD, GridHelper, AxesHelper } from './compat/objects.js';
export { Camera, PerspectiveCamera, OrthographicCamera } from './compat/cameras.js';
export { Light, AmbientLight, HemisphereLight, DirectionalLight, LightShadow, DirectionalLightShadow, SpotLightShadow, PointLightShadow, PointLight, SpotLight } from './compat/lights.js';
export { BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Float32BufferAttribute, Int8BufferAttribute, Uint8BufferAttribute, Uint8ClampedBufferAttribute, Int16BufferAttribute, Uint16BufferAttribute, Int32BufferAttribute, Uint32BufferAttribute, BufferGeometry, BoxGeometry, PlaneGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, CircleGeometry, RingGeometry, TorusGeometry } from './compat/geometry.js';
export { Texture, RenderTarget, WebGLRenderTarget, DataTexture, CanvasTexture, TextureLoader } from './compat/textures.js';
export { Material, MeshBasicMaterial, LineBasicMaterial, PointsMaterial, SpriteMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshToonMaterial, MeshNormalMaterial, MeshStandardMaterial, MeshPhysicalMaterial } from './compat/materials.js';
export { Raycaster } from './compat/picking.js';
export { WebGLRenderer, WebGPURenderer } from './compat/renderer.js';

export const MathUtils = W.MathUtils;
export const Timer = W.Timer;

// ---------------------------------------------------------------- time

export class Clock {

	constructor( autoStart = true ) {

		this.autoStart = autoStart;
		this.startTime = 0;
		this.oldTime = 0;
		this.elapsedTime = 0;
		this.running = false;

	}

	start() {

		this.startTime = this.oldTime = performance.now();
		this.elapsedTime = 0;
		this.running = true;

	}

	stop() {

		this.getElapsedTime();
		this.running = this.autoStart = false;

	}

	getElapsedTime() {

		this.getDelta();
		return this.elapsedTime;

	}

	getDelta() {

		if ( this.autoStart && ! this.running ) {

			this.start();
			return 0;

		}

		if ( ! this.running ) return 0;
		const now = performance.now(), delta = ( now - this.oldTime ) / 1000;
		this.oldTime = now;
		this.elapsedTime += delta;
		return delta;

	}

}

// ---------------------------------------------------------------- not available yet

// Named so that code using them fails with a clear message instead of "not a constructor".
function missing( name, hint = '' ) {

	return class {

		constructor() {

			throw new Error( `WAMR3D: ${name} is not available yet${hint}` );

		}

	};

}

export const RectAreaLight = missing( 'RectAreaLight' );
export const SkinnedMesh = missing( 'SkinnedMesh' );
export const ShaderMaterial = missing( 'ShaderMaterial' );
export const IcosahedronGeometry = missing( 'IcosahedronGeometry' ), CapsuleGeometry = missing( 'CapsuleGeometry' );
export const AnimationMixer = missing( 'AnimationMixer' ), CubeTextureLoader = missing( 'CubeTextureLoader' ), ObjectLoader = missing( 'ObjectLoader' );
