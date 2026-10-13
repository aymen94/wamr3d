// Runs one application-style script against the WAMR3D object API and compares every
// number it produces with what three.js r186 produced for the same script.
//
//   node engine/bindings/build.mjs
//   node parity/bindings/compat-check.mjs             compare with the stored values (no three.js needed)
//   node parity/bindings/compat-check.mjs --generate  run the script on three.js r186 and store its values
//
// --generate needs the pinned reference: `npm install` at the repository root.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../../dist/wamr3d/compat.js';

const EXPECTED = fileURLToPath( new URL( './compat-expected.json', import.meta.url ) );
const generate = process.argv.includes( '--generate' );

await C.init();

const TOLERANCE = 1e-5;

// Written the way an application would be. `L` is the library.
function scenario( L ) {

	const out = [];
	const put = ( label, values ) => out.push( [ label, Array.from( values, Number ) ] );

	// constructors with defaults, properties and chaining
	const a = new L.Vector3( 1, 2, 3 ).add( new L.Vector3( 0.5, - 1, 2 ) ).multiplyScalar( 0.5 ).normalize();
	const b = new L.Vector3().copy( a ).cross( new L.Vector3( 0, 1, 0 ) ).negate();
	b.x += 0.25;
	put( 'vector chain', [ a.x, a.y, a.z, b.x, b.y, b.z, a.dot( b ), a.clone().lerp( b, 0.3 ).length(), new L.Vector2( 3, 4 ).length(), new L.Vector4().w ] );

	const q = new L.Quaternion().setFromEuler( new L.Euler( 0.3, - 0.7, 1.1, 'YXZ' ) ).multiply( new L.Quaternion().setFromAxisAngle( new L.Vector3( 0, 0, 1 ), 0.4 ) );
	const e = new L.Euler().setFromQuaternion( q, 'ZYX' );
	put( 'rotation chain', [ q.x, q.y, q.z, q.w, e.x, e.y, e.z, new L.Quaternion().slerp( q, 0.25 ).w ] );

	const m = new L.Matrix4().compose( new L.Vector3( 1, 2, 3 ), q, new L.Vector3( 2, 1, 0.5 ) );
	const position = new L.Vector3(), rotation = new L.Quaternion(), scale = new L.Vector3();
	m.clone().invert().multiply( new L.Matrix4().makeRotationY( 0.3 ) ).decompose( position, rotation, scale );
	put( 'matrix chain', [ ...m.elements, m.determinant(), ...position.toArray(), ...rotation.toArray(), ...scale.toArray(), ...new L.Matrix3().setFromMatrix4( m ).invert().elements ] );

	const color = new L.Color( 0x4f8cff ), named = new L.Color( 'tomato' ).lerp( color, 0.5 ), hsl = named.getHSL( {} );
	put( 'color', [ color.r, color.g, color.b, color.getHex(), named.r, named.g, named.b, hsl.h, hsl.s, hsl.l, new L.Color().r, new L.Color( 0.1, 0.2, 0.3 ).offsetHSL( 0.1, 0, 0 ).g ] );

	const box = new L.Box3().setFromCenterAndSize( new L.Vector3( 1, 0, - 1 ), new L.Vector3( 2, 4, 6 ) ).expandByPoint( a );
	const center = box.getCenter( new L.Vector3() ), sphere = box.getBoundingSphere( new L.Sphere() );
	const ray = new L.Ray( new L.Vector3( 5, 1, 4 ), new L.Vector3( - 4, - 1, - 5 ).normalize() );
	const hit = ray.intersectBox( box, new L.Vector3() ), miss = new L.Ray( new L.Vector3( 0, 50, 0 ), new L.Vector3( 0, 1, 0 ) ).intersectBox( box, new L.Vector3() );
	const plane = new L.Plane().setFromNormalAndCoplanarPoint( new L.Vector3( 0, 1, 0 ), new L.Vector3( 0, - 2, 0 ) );
	put( 'shapes', [ ...center.toArray(), sphere.radius, ...hit.toArray(), miss === null ? 1 : 0, ray.distanceToPlane( plane ), ...ray.at( 2, new L.Vector3() ).toArray(), box.containsPoint( center ) ? 1 : 0, L.MathUtils.degToRad( 90 ), L.MathUtils.clamp( 5, 0, 1 ) ] );

	// scene graph
	const scene = new L.Scene();
	const arm = new L.Group(), cubeMaterial = new L.MeshStandardMaterial( { color: 0xff8800, side: L.DoubleSide } );
	const cube = new L.Mesh( new L.BoxGeometry( 2, 1, 3, 2, 2, 2 ), cubeMaterial );
	const ball = new L.Mesh( new L.SphereGeometry( 0.75, 16, 12 ), new L.MeshBasicMaterial() );
	const floor = new L.Mesh( new L.PlaneGeometry( 20, 20 ), new L.MeshLambertMaterial( { color: 'gray' } ) );
	cube.name = 'cube';
	scene.add( arm, floor );
	arm.add( cube );
	cube.add( ball );

	arm.position.set( 1, 0.5, - 2 );
	arm.rotation.y = 0.6;
	arm.scale.setScalar( 1.5 );
	cube.position.x = 2;
	cube.position.y += 1;
	cube.rotation.set( 0.2, 0.4, - 0.3 );
	cube.rotateX( 0.25 ).translateZ( 0.5 );
	cube.quaternion.multiply( new L.Quaternion().setFromAxisAngle( new L.Vector3( 0, 1, 0 ), 0.1 ) );
	ball.position.copy( new L.Vector3( 0, 1.5, 0.5 ) ).multiplyScalar( 1.2 );
	floor.rotation.x = - Math.PI / 2;
	floor.position.y = - 3;
	scene.updateMatrixWorld();

	put( 'transforms', [ ...cube.position.toArray(), cube.rotation.x, cube.rotation.y, cube.rotation.z, ...cube.quaternion.toArray(), arm.scale.x, ball.position.length(), cube.position.clone().distanceTo( ball.position ) ] );
	put( 'world matrices', [ ...arm.matrixWorld.elements, ...cube.matrixWorld.elements, ...ball.matrixWorld.elements, ...floor.matrix.elements ] );
	put( 'world queries', [ ...ball.getWorldPosition( new L.Vector3() ).toArray(), ...cube.getWorldQuaternion( new L.Quaternion() ).toArray(), ...cube.getWorldScale( new L.Vector3() ).toArray(), ...cube.getWorldDirection( new L.Vector3() ).toArray(), ...cube.localToWorld( new L.Vector3( 1, 1, 1 ) ).toArray(), ...ball.worldToLocal( new L.Vector3( 1, 2, 3 ) ).toArray() ] );
	put( 'graph', [ scene.children.length, cube.parent === arm ? 1 : 0, ball.parent === cube ? 1 : 0, scene.getObjectByName( 'cube' ) === cube ? 1 : 0, cube.isMesh ? 1 : 0, cubeMaterial.side, cubeMaterial.color.getHex(), cubeMaterial.roughness ] );

	let visited = 0;
	scene.traverse( () => visited ++ );
	scene.attach( ball );
	scene.updateMatrixWorld();
	put( 'attach', [ visited, scene.children.length, cube.children.length, ...ball.matrixWorld.elements ] );
	cube.attach( ball );

	// geometry
	const geometry = cube.geometry;
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	const triangle = new L.BufferGeometry();
	triangle.setAttribute( 'position', new L.BufferAttribute( new Float32Array( [ 0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 3, 1 ] ), 3 ) );
	triangle.setIndex( [ 0, 1, 2, 2, 1, 3 ] );
	triangle.computeVertexNormals();
	put( 'geometry', [ geometry.attributes.position.count, geometry.index.count, ...geometry.attributes.position.array.slice( 0, 12 ), ...geometry.attributes.uv.array.slice( 0, 8 ), ...geometry.boundingBox.min.toArray(), ...geometry.boundingBox.max.toArray(), geometry.boundingSphere.radius, ...triangle.attributes.normal.array, ball.geometry.attributes.normal.count, floor.geometry.parameters.width ] );

	// round shapes, lines, lights, material and texture defaults
	for ( const shape of [ new L.CylinderGeometry( 0.5, 1, 2, 9, 2 ), new L.ConeGeometry( 1, 2, 7 ), new L.CircleGeometry( 1.5, 6 ), new L.RingGeometry( 0.4, 1.2, 8, 2 ), new L.TorusGeometry( 1, 0.3, 5, 9 ) ] ) {

		shape.computeBoundingBox();
		const { position, normal, uv } = shape.attributes;
		put( shape.type, [ position.count, shape.index.count, ...position.array.slice( 0, 30 ), ...normal.array.slice( 0, 30 ), ...uv.array.slice( 0, 20 ), ...shape.boundingBox.min.toArray(), ...shape.boundingBox.max.toArray() ] );

	}

	const segments = new L.LineSegments( triangle, new L.LineBasicMaterial( { color: 0x336699, vertexColors: true } ) );
	const strip = new L.Line( triangle );
	const point = new L.PointLight( 0xff8800, 3 ), spot = new L.SpotLight();
	const glass = new L.MeshStandardMaterial( { transparent: true, opacity: 0.25, depthWrite: false } );
	const texture = new L.DataTexture( new Uint8Array( 16 ), 2, 2 );
	texture.repeat.set( 2, 3 );
	put( 'lines lights materials', [
		segments.isLine, segments.isLineSegments, strip.isLine, strip.isLineSegments === true, segments.type.length, strip.material.isLineBasicMaterial, ...segments.material.color.toArray(), segments.material.vertexColors,
		point.isPointLight, point.distance, point.decay, point.intensity, ...point.color.toArray(), spot.isSpotLight, spot.distance, spot.angle, spot.penumbra, spot.decay, ...spot.position.toArray(), spot.target.isObject3D,
		glass.transparent, glass.opacity, glass.depthWrite, glass.depthTest, glass.vertexColors, new L.MeshBasicMaterial().opacity, new L.MeshBasicMaterial().transparent,
		...texture.repeat.toArray(), ...texture.offset.toArray(), ...texture.center.toArray(), texture.rotation, texture.generateMipmaps, new L.Texture().generateMipmaps, new L.Texture().minFilter, L.LinearMipmapLinearFilter
	] );

	// transforms written and read back in every order, without and with the engine in between
	const pivot = new L.Object3D();
	pivot.rotation.set( 0.3, - 0.8, 1.1, 'ZYX' );
	const q1 = pivot.quaternion.toArray();
	pivot.quaternion.x += 0.2;
	pivot.quaternion.normalize();
	const e1 = [ pivot.rotation.x, pivot.rotation.y, pivot.rotation.z ];
	pivot.rotation.y += 0.25;
	pivot.rotation.order = 'YXZ';
	pivot.position.x = 3;
	pivot.position.y += 2;
	pivot.scale.setScalar( 2 ).multiplyScalar( 1.5 );
	pivot.lookAt( 4, 1, - 2 );
	pivot.position.z -= 1;
	pivot.rotateY( 0.4 );
	pivot.translateX( 2 );
	pivot.updateMatrix();
	put( 'transform round trips', [ ...q1, ...e1, ...pivot.quaternion.toArray(), pivot.rotation.x, pivot.rotation.y, pivot.rotation.z, pivot.rotation.order.length, ...pivot.position.toArray(), ...pivot.scale.toArray(), ...pivot.matrix.elements ] );

	// a matrix set by hand
	const manual = new L.Object3D(), manualChild = new L.Object3D();
	manual.position.set( 1, 2, 3 );
	manual.updateMatrix();
	manual.matrixAutoUpdate = false;
	manual.position.set( 9, 9, 9 );
	manual.add( manualChild );
	manualChild.position.set( 0, 1, 0 );
	manual.updateMatrixWorld( true );
	const kept = [ ...manualChild.matrixWorld.elements ];
	manual.matrix.makeRotationY( 0.7 ).setPosition( - 2, 0.5, 4 );
	manual.matrixWorldNeedsUpdate = true;
	manual.updateMatrixWorld( true );
	const copyOfManual = manual.clone();
	copyOfManual.updateMatrixWorld( true );
	put( 'matrixAutoUpdate false', [ ...kept, ...manualChild.matrixWorld.elements, ...manual.matrix.elements, manual.matrixAutoUpdate, copyOfManual.matrixAutoUpdate, ...copyOfManual.matrixWorld.elements, ...manual.position.toArray() ] );

	// fog, helpers, instances, material arrays
	const mist = new L.Fog( 0x336699, 2, 50 ), haze = new L.FogExp2( 0xffffff );
	const gridHelper = new L.GridHelper( 8, 4, 0xff0000, 0x00ff00 ), axes = new L.AxesHelper( 2 ).setColors( 0xff0000, 'green', 0x0000ff );
	const many = new L.InstancedMesh( new L.BoxGeometry(), new L.MeshBasicMaterial(), 4 );
	many.setMatrixAt( 2, new L.Matrix4().makeTranslation( 1, 2, 3 ) );
	many.setColorAt( 1, new L.Color( 0.25, 0.5, 0.75 ) );
	many.count = 3;
	const sides = new L.Mesh( new L.BoxGeometry(), [ 0, 1, 2, 3, 4, 5 ].map( ( i ) => new L.MeshBasicMaterial( { color: i * 40 } ) ) );
	put( 'fog helpers instances', [
		mist.isFog, mist.near, mist.far, ...mist.color.toArray(), haze.isFogExp2, haze.density, mist.clone().far,
		gridHelper.isLineSegments, gridHelper.type.length, gridHelper.geometry.attributes.position.count, ...gridHelper.geometry.attributes.position.array, ...gridHelper.geometry.attributes.color.array, gridHelper.material.vertexColors,
		axes.type.length, ...axes.geometry.attributes.position.array, ...axes.geometry.attributes.color.array,
		many.isInstancedMesh, many.count, many.instanceMatrix.count, ...many.instanceMatrix.array, ...many.instanceColor.array, ...many.getMatrixAt( 2, new L.Matrix4() ).elements, ...many.getColorAt( 1, new L.Color() ).toArray(),
		Array.isArray( sides.material ), sides.material.length, sides.geometry.groups.length, ...sides.geometry.groups.flatMap( ( g ) => [ g.start, g.count, g.materialIndex ] )
	] );

	// picking lines
	const wire = new L.LineSegments( gridHelper.geometry, gridHelper.material ), path = new L.Line( gridHelper.geometry );
	wire.position.set( 0.5, 1, 0 );
	wire.scale.set( 1, 1, 2 );
	wire.updateMatrixWorld();
	path.rotation.z = 0.3;
	path.updateMatrixWorld();
	const picker = new L.Raycaster( new L.Vector3( 0.6, 6, 0.3 ), new L.Vector3( 0, - 1, 0 ) );
	picker.params.Line.threshold = 0.25;
	const lineHits = [ ...picker.intersectObject( wire ), ...picker.intersectObject( path ) ];
	put( 'line picking', [ lineHits.length, ...lineHits.flatMap( ( hit ) => [ hit.distance, hit.index, ...hit.point.toArray(), hit.face === null, hit.object === wire ] ) ] );

	// cameras
	const camera = new L.PerspectiveCamera( 55, 1.5, 0.1, 100 );
	camera.position.set( 6, 5, 9 );
	camera.lookAt( 1, 0.5, - 2 );
	camera.updateMatrixWorld();
	camera.zoom = 1.25;
	camera.fov = 48;
	camera.updateProjectionMatrix();
	const screen = ball.getWorldPosition( new L.Vector3() ).project( camera );
	put( 'perspective camera', [ ...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements, ...camera.projectionMatrixInverse.elements, ...screen.toArray(), ...new L.Vector3( 0.2, - 0.3, 0.5 ).unproject( camera ).toArray(), ...camera.getWorldDirection( new L.Vector3() ).toArray() ] );

	const ortho = new L.OrthographicCamera( - 8, 8, 6, - 6, 0.5, 60 );
	ortho.position.set( - 4, 7, 10 );
	ortho.lookAt( new L.Vector3( 1, 0, - 2 ) );
	ortho.updateMatrixWorld();
	put( 'orthographic camera', [ ...ortho.projectionMatrix.elements, ...ortho.matrixWorldInverse.elements ] );

	// picking
	const raycaster = new L.Raycaster();
	const picks = [];

	for ( const [ x, y, eye ] of [ [ 0, 0, camera ], [ 0.12, 0.2, camera ], [ - 0.2, - 0.15, camera ], [ 0.9, 0.9, camera ], [ 0.3, 0.1, ortho ], [ 0, - 0.5, ortho ] ] ) {

		raycaster.setFromCamera( new L.Vector2( x, y ), eye );
		const hits = raycaster.intersectObjects( scene.children, true );
		picks.push( hits.length, ...raycaster.ray.direction.toArray() );
		for ( const h of hits ) picks.push( h.distance, ...h.point.toArray(), h.faceIndex, h.face.a, ...h.face.normal.toArray(), ...h.uv.toArray(), h.object === cube ? 1 : h.object === ball ? 2 : h.object === floor ? 3 : 0 );

	}

	put( 'picking', picks );

	// cloning and removal
	const copy = arm.clone();
	copy.position.x -= 5;
	scene.add( copy );
	scene.updateMatrixWorld();
	put( 'clone', [ copy.children.length, copy.children[ 0 ].children.length, copy.children[ 0 ].name === 'cube' ? 1 : 0, copy.children[ 0 ].geometry === cube.geometry ? 1 : 0, ...copy.children[ 0 ].children[ 0 ].matrixWorld.elements ] );

	arm.remove( cube );
	cube.visible = false;
	copy.removeFromParent();
	put( 'removal', [ scene.children.length, arm.children.length, cube.parent === null ? 1 : 0, copy.parent === null ? 1 : 0, cube.visible ? 1 : 0, cube.layers.mask ] );

	return out;

}

// JSON has no Infinity or NaN; they are stored as strings.
const encode = ( value ) => ( Number.isFinite( value ) ? value : String( value ) );
let expected;

if ( generate ) {

	const T = await import( 'three/src/Three.Core.js' );
	expected = scenario( T );
	const lines = expected.map( ( [ label, values ] ) => JSON.stringify( [ label, values.map( encode ) ] ) );
	fs.writeFileSync( EXPECTED, `{"reference":"three@0.186.1","generator":"parity/bindings/compat-check.mjs --generate","groups":[\n${lines.join( ',\n' )}\n]}\n` );
	console.log( `stored ${expected.length} groups from three.js r186 in ${EXPECTED}` );

} else {

	expected = JSON.parse( fs.readFileSync( EXPECTED, 'utf8' ) ).groups.map( ( [ label, values ] ) => [ label, values.map( Number ) ] );

}

const actual = scenario( C );
if ( actual.length !== expected.length ) throw new Error( `the script produced ${actual.length} groups but ${expected.length} are stored; run with --generate after changing the script` );
let values = 0, worst = 0;
const failures = [];

expected.forEach( ( [ label, want ], i ) => {

	const got = actual[ i ][ 1 ];
	if ( actual[ i ][ 0 ] !== label ) failures.push( `group ${i} is "${actual[ i ][ 0 ]}" but "${label}" is stored; run with --generate after changing the script` );
	if ( got.length !== want.length ) failures.push( `${label}: ${got.length} values, expected ${want.length}` );

	for ( let k = 0; k < Math.min( got.length, want.length ); k ++ ) {

		// non-finite values must match exactly
		const error = Number.isFinite( want[ k ] ) ? Math.abs( got[ k ] - want[ k ] ) / Math.max( 1, Math.abs( want[ k ] ) ) : Object.is( got[ k ], want[ k ] ) ? 0 : Infinity;
		values ++;
		if ( error > worst ) worst = error;
		if ( ! ( error <= TOLERANCE ) ) failures.push( `${label}[${k}]: got ${got[ k ]}, expected ${want[ k ]}` );

	}

} );

console.log( `${values} values against three.js r186${generate ? '' : ' (stored)'}, largest scaled error ${worst.toExponential( 3 )} (tolerance ${TOLERANCE})` );

if ( failures.length > 0 ) {

	console.log( `FAILED: ${failures.length} mismatches` );
	for ( const line of failures.slice( 0, 25 ) ) console.log( line );
	process.exit( 1 );

}

console.log( 'ok' );
