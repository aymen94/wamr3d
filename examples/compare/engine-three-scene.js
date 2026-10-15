// three.js on its own, building and animating the scene from the same scene code
// as the WAMR3D object API (examples/webgpu/scene.js) and drawing it with its own
// WebGPU or WebGL renderer. No WAMR3D code runs here.

import { buildScene } from '../webgpu/scene.js';
import { loadThreeWebGL, loadThreeWebGPU } from '../three-reference.js';

export async function createEngine( canvas, description, cameraState, webgpu ) {

	const THREE = await ( webgpu ? loadThreeWebGPU() : loadThreeWebGL() );
	const renderer = webgpu ? new THREE.WebGPURenderer( { canvas, antialias: true } ) : new THREE.WebGLRenderer( { canvas, antialias: true } );
	if ( webgpu ) await renderer.init();
	renderer.setPixelRatio( 1 );

	// The WebGPU renderer falls back to WebGL 2 when the browser has no WebGPU.
	const backend = ! webgpu ? 'WebGL' : renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 fallback';
	const demo = buildScene( THREE, description.satellites, { standard: true } );
	demo.scene.traverse( ( object ) => ( object.frustumCulled = false ) );

	return {

		name: `three.js (${backend})`,
		objectCount: () => demo.objectCount,

		update( time ) {

			demo.update( time );
			demo.orbit( cameraState, cameraState.aspect );
			demo.scene.updateMatrixWorld();
			demo.camera.updateMatrixWorld();

		},

		render() {

			renderer.render( demo.scene, demo.camera );

		},

		setSize( width, height ) {

			renderer.setSize( width, height, false );

		}

	};

}
