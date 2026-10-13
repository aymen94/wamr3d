// Compiled, never run: checks that ordinary application code type-checks against the
// typings of the object API.
//
//   node engine/bindings/build.mjs
//   tsc -p parity/bindings

import * as THREE from '../../dist/wamr3d/compat.js';

export async function main( canvas: HTMLCanvasElement ): Promise<void> {

	await THREE.init();

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x14161a );
	scene.fog = new THREE.Fog( 0x14161a, 5, 50 );

	const camera = new THREE.PerspectiveCamera( 50, canvas.width / canvas.height, 0.1, 100 );
	camera.position.set( 3, 2, 5 ).multiplyScalar( 1.5 );
	camera.lookAt( 0, 0, 0 );

	const material = new THREE.MeshStandardMaterial( { color: 0x4f8cff, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.8 } );
	const cube = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 1 ), material );
	cube.rotation.y += 0.01;
	cube.quaternion.normalize();
	cube.scale.setScalar( 2 );
	cube.matrixAutoUpdate = false;
	cube.matrix.makeRotationY( 0.5 ).setPosition( 1, 2, 3 );

	const sides: THREE.Material[] = [ 0, 1, 2, 3, 4, 5 ].map( ( i ) => new THREE.MeshBasicMaterial( { color: i * 40, side: THREE.DoubleSide } ) );
	const box = new THREE.Mesh( new THREE.BoxGeometry(), sides );

	const instances = new THREE.InstancedMesh( new THREE.ConeGeometry( 0.3, 0.8 ), new THREE.MeshLambertMaterial(), 100 );
	instances.setMatrixAt( 0, new THREE.Matrix4().makeTranslation( 1, 0, 0 ) );
	instances.setColorAt( 0, new THREE.Color( 'tomato' ) );
	instances.instanceMatrix.needsUpdate = true;
	if ( instances.instanceColor ) instances.instanceColor.needsUpdate = true;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( [ 0, 0, 0, 1, 1, 1 ] ), 3 ) );
	const line = new THREE.Line( geometry, new THREE.LineBasicMaterial( { color: 0xffffff, vertexColors: false } ) );

	const texture = new THREE.TextureLoader().load( 'checker.png' );
	texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set( 4, 4 );
	texture.colorSpace = THREE.SRGBColorSpace;
	const floor = new THREE.Mesh( new THREE.PlaneGeometry( 20, 20 ), new THREE.MeshLambertMaterial( { map: texture } ) );
	floor.rotation.x = - Math.PI / 2;

	const sun = new THREE.DirectionalLight( 0xffffff, 2 );
	sun.position.set( 4, 8, 5 );
	const lamp = new THREE.PointLight( 0xffb454, 10, 8, 2 );
	const spot = new THREE.SpotLight( 0xffffff, 20, 0, Math.PI / 6, 0.3 );
	spot.target.position.set( 0, 0, 1 );

	scene.add( cube, box, instances, line, floor, sun, lamp, spot, spot.target, new THREE.HemisphereLight( 0xbfd4ff, 0x30281e, 1 ), new THREE.GridHelper( 20, 20 ), new THREE.AxesHelper( 2 ) );

	const raycaster = new THREE.Raycaster();
	raycaster.params.Line.threshold = 0.1;
	raycaster.setFromCamera( new THREE.Vector2( 0, 0 ), camera );
	const hit: THREE.Intersection | undefined = raycaster.intersectObjects( scene.children )[ 0 ];
	if ( hit && hit.face ) hit.face.normal.clone().applyQuaternion( cube.quaternion );

	const renderer = new THREE.WebGPURenderer( { canvas, antialias: true } );
	await renderer.init();
	renderer.setPixelRatio( 2 );
	renderer.setSize( 800, 600 );
	const clock = new THREE.Clock();

	renderer.setAnimationLoop( () => {

		cube.rotation.x += clock.getDelta();
		renderer.render( scene, camera );

	} );

}
