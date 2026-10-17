// three.js add-on path: `three/addons/controls/PointerLockControls.js`.
//
// First-person look with the pointer locked: mouse movement turns the camera, `lock()`
// requests the lock, `moveForward` and `moveRight` walk in the ground plane.

import { Controls, Euler, Vector3 } from '../../compat.js';

const _euler = new Euler( 0, 0, 0, 'YXZ' ), _vector = new Vector3();
const _changeEvent = { type: 'change' }, _lockEvent = { type: 'lock' }, _unlockEvent = { type: 'unlock' };
const _HALF_PI = Math.PI / 2;

export class PointerLockControls extends Controls {

	constructor( camera, domElement = null ) {

		super( camera, domElement );
		this.isLocked = false;
		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;
		this.pointerSpeed = 1.0;
		this._onMouseMove = this._handleMouseMove.bind( this );
		this._onPointerlockChange = this._handlePointerlockChange.bind( this );
		this._onPointerlockError = () => console.error( 'WAMR3D: PointerLockControls: unable to use Pointer Lock API' );
		if ( this.domElement !== null ) this.connect( this.domElement );

	}

	connect( element ) {

		super.connect( element );
		this.domElement.ownerDocument.addEventListener( 'mousemove', this._onMouseMove );
		this.domElement.ownerDocument.addEventListener( 'pointerlockchange', this._onPointerlockChange );
		this.domElement.ownerDocument.addEventListener( 'pointerlockerror', this._onPointerlockError );

	}

	disconnect() {

		if ( this.domElement === null ) return;
		this.domElement.ownerDocument.removeEventListener( 'mousemove', this._onMouseMove );
		this.domElement.ownerDocument.removeEventListener( 'pointerlockchange', this._onPointerlockChange );
		this.domElement.ownerDocument.removeEventListener( 'pointerlockerror', this._onPointerlockError );

	}

	dispose() {

		this.disconnect();

	}

	getObject() {

		return this.object;

	}

	getDirection( v ) {

		return v.set( 0, 0, - 1 ).applyQuaternion( this.object.quaternion );

	}

	moveForward( distance ) {

		if ( this.enabled === false ) return;
		const camera = this.object;
		// move forward parallel to the xz-plane: camera.up is the y-axis
		_vector.setFromMatrixColumn( camera.matrix, 0 );
		_vector.crossVectors( camera.up, _vector );
		camera.position.addScaledVector( _vector, distance );

	}

	moveRight( distance ) {

		if ( this.enabled === false ) return;
		const camera = this.object;
		_vector.setFromMatrixColumn( camera.matrix, 0 );
		camera.position.addScaledVector( _vector, distance );

	}

	lock( unadjustedMovement = false ) {

		this.domElement.requestPointerLock( { unadjustedMovement } );

	}

	unlock() {

		this.domElement.ownerDocument.exitPointerLock();

	}

	_handleMouseMove( event ) {

		if ( this.enabled === false || this.isLocked === false ) return;
		const camera = this.object;
		_euler.setFromQuaternion( camera.quaternion );
		_euler.y -= event.movementX * 0.002 * this.pointerSpeed;
		_euler.x -= event.movementY * 0.002 * this.pointerSpeed;
		_euler.x = Math.max( _HALF_PI - this.maxPolarAngle, Math.min( _HALF_PI - this.minPolarAngle, _euler.x ) );
		camera.quaternion.setFromEuler( _euler );
		this.dispatchEvent( _changeEvent );

	}

	_handlePointerlockChange() {

		if ( this.domElement.ownerDocument.pointerLockElement === this.domElement ) {

			this.dispatchEvent( _lockEvent );
			this.isLocked = true;

		} else {

			this.dispatchEvent( _unlockEvent );
			this.isLocked = false;

		}

	}

}
