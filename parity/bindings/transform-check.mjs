// TransformControls driven through its pointer methods (as a test page would), in Node
// through the built package. Run `npm run build` first.
import * as C from '../../dist/wamr3d/compat.js';
import { TransformControls } from '../../dist/wamr3d/addons/controls/TransformControls.js';

await C.init();

let failed = 0;
const check = ( name, ok, detail = '' ) => {

	if ( ! ok ) failed ++;
	console.log( ( ok ? 'PASS  ' : 'FAIL  ' ) + name + ( detail ? ': ' + detail : '' ) );

};

const close = ( a, b, e = 1e-4 ) => Math.abs( a - b ) <= e;
const camera = new C.PerspectiveCamera( 50, 1, 0.1, 100 );
camera.position.set( 0, 0, 10 );
camera.lookAt( 0, 0, 0 );
const scene = new C.Scene();
scene.add( camera );
const box = new C.Mesh( new C.BoxGeometry(), new C.MeshBasicMaterial() );
scene.add( box );
scene.updateMatrixWorld( true );

const controls = new TransformControls( camera );
scene.add( controls.getHelper() );
const events = [];
for ( const type of [ 'change', 'objectChange', 'mouseDown', 'mouseUp', 'dragging-changed', 'axis-changed' ] ) controls.addEventListener( type, ( e ) => events.push( type + ( e.value !== undefined ? ':' + e.value : '' ) ) );
controls.attach( box );
check( 'attach shows the gizmo', controls.getHelper().visible === true && controls.object === box );

const drag = ( axis, from, to ) => {

	controls.axis = axis;
	controls.pointerDown( { x: from[ 0 ], y: from[ 1 ], button: 0 } );
	controls.pointerMove( { x: to[ 0 ], y: to[ 1 ], button: 0 } );
	controls.pointerUp( { x: to[ 0 ], y: to[ 1 ], button: 0 } );
	box.updateMatrixWorld( true );

};

// hovering the X arrow picks it
controls.updateGizmo();
const tip = new C.Vector3( 1, 0, 0 ).multiplyScalar( controls.getHelper().scale.x * 0.5 ).project( camera );
controls.pointerHover( { x: tip.x, y: tip.y } );
check( 'hover picks the axis under the pointer', controls.axis === 'X', String( controls.axis ) );

drag( 'X', [ 0, 0 ], [ 0.2, 0.1 ] );
check( 'translate along X only', box.position.x > 0.5 && box.position.y === 0 && box.position.z === 0, box.position.toArray().join() );
check( 'events of a drag', [ 'axis-changed:X', 'dragging-changed:true', 'mouseDown', 'change', 'objectChange', 'mouseUp', 'dragging-changed:false' ].every( ( e ) => events.includes( e ) ), events.join() );

box.position.set( 0, 0, 0 );
controls.setTranslationSnap( 1 );
drag( 'XY', [ 0, 0 ], [ 0.13, 0.27 ] );
check( 'plane translation with snapping', Number.isInteger( box.position.x ) && Number.isInteger( box.position.y ) && box.position.y > 0 && box.position.z === 0, box.position.toArray().join() );
controls.setTranslationSnap( null );

box.position.set( 0, 0, 0 );
box.updateMatrixWorld( true );
controls.setMode( 'rotate' );
drag( 'Z', [ 0.2, 0 ], [ 0, 0.2 ] );
const euler = new C.Euler().setFromQuaternion( box.quaternion );
check( 'rotate about Z', close( euler.z, Math.PI / 2, 1e-3 ) && close( euler.x, 0 ) && close( euler.y, 0 ), euler.toArray().slice( 0, 3 ).join() );

controls.setRotationSnap( Math.PI / 4 );
box.quaternion.set( 0, 0, 0, 1 );
drag( 'Z', [ 0.2, 0 ], [ 0.2, 0.1 ] );
check( 'rotation snapping', close( new C.Euler().setFromQuaternion( box.quaternion ).z, Math.PI / 4, 1e-4 ) );
controls.setRotationSnap( null );

box.quaternion.set( 0, 0, 0, 1 );
box.updateMatrixWorld( true );
controls.setMode( 'scale' );
drag( 'X', [ 0.1, 0 ], [ 0.2, 0 ] );
check( 'scale along X', close( box.scale.x, 2, 1e-3 ) && box.scale.y === 1 && box.scale.z === 1, box.scale.toArray().join() );

controls.detach();
check( 'detach hides the gizmo', controls.getHelper().visible === false && controls.object === undefined );
controls.dispose();
process.exitCode = failed ? 1 : 0;
