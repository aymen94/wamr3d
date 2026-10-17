// three.js add-on path: `three/addons/controls/FlyControls.js`.
//
// Free flight: WASD and R/F translate, Q/E roll, the arrow keys and the mouse (or a drag
// with `dragToLook`) turn. Call `update( delta )` each frame.

import { Controls, Quaternion, Vector3 } from '../../compat.js';

const _changeEvent = { type: 'change' }, _tmpQuaternion = new Quaternion(), EPS = 0.000001;

export class FlyControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );
		this.movementSpeed = 1.0;
		this.rollSpeed = 0.005;
		this.dragToLook = false;
		this.autoForward = false;
		this._moveState = { up: 0, down: 0, left: 0, right: 0, forward: 0, back: 0, pitchUp: 0, pitchDown: 0, yawLeft: 0, yawRight: 0, rollLeft: 0, rollRight: 0 };
		this._moveVector = new Vector3( 0, 0, 0 );
		this._rotationVector = new Vector3( 0, 0, 0 );
		this._lastQuaternion = new Quaternion();
		this._lastPosition = new Vector3();
		this._status = 0;
		this._onKeyDown = this._handleKeyDown.bind( this );
		this._onKeyUp = this._handleKeyUp.bind( this );
		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerUp = this._handlePointerUp.bind( this );
		this._onPointerCancel = () => {

			this._status = 0;
			this._moveState.yawLeft = this._moveState.pitchDown = 0;
			this._updateRotationVector();

		};

		this._onContextMenu = ( event ) => {

			if ( this.enabled ) event.preventDefault();

		};

		if ( domElement !== null ) this.connect( domElement );

	}

	connect( element ) {

		super.connect( element );
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		this.domElement.addEventListener( 'pointermove', this._onPointerMove );
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );
		this.domElement.addEventListener( 'pointercancel', this._onPointerCancel );
		this.domElement.addEventListener( 'contextmenu', this._onContextMenu );

	}

	disconnect() {

		if ( this.domElement === null ) return;
		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'pointercancel', this._onPointerCancel );
		this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );

	}

	dispose() {

		this.disconnect();

	}

	update( delta ) {

		if ( this.enabled === false ) return;
		const object = this.object, moveMult = delta * this.movementSpeed, rotMult = delta * this.rollSpeed;
		object.translateX( this._moveVector.x * moveMult );
		object.translateY( this._moveVector.y * moveMult );
		object.translateZ( this._moveVector.z * moveMult );
		_tmpQuaternion.set( this._rotationVector.x * rotMult, this._rotationVector.y * rotMult, this._rotationVector.z * rotMult, 1 ).normalize();
		object.quaternion.multiply( _tmpQuaternion );

		if ( this._lastPosition.distanceToSquared( object.position ) > EPS || 8 * ( 1 - this._lastQuaternion.dot( object.quaternion ) ) > EPS ) {

			this.dispatchEvent( _changeEvent );
			this._lastQuaternion.copy( object.quaternion );
			this._lastPosition.copy( object.position );

		}

	}

	_updateMovementVector() {

		const forward = ( this._moveState.forward || ( this.autoForward && ! this._moveState.back ) ) ? 1 : 0;
		this._moveVector.x = ( - this._moveState.left + this._moveState.right );
		this._moveVector.y = ( - this._moveState.down + this._moveState.up );
		this._moveVector.z = ( - forward + this._moveState.back );

	}

	_updateRotationVector() {

		this._rotationVector.x = ( - this._moveState.pitchDown + this._moveState.pitchUp );
		this._rotationVector.y = ( - this._moveState.yawRight + this._moveState.yawLeft );
		this._rotationVector.z = ( - this._moveState.rollRight + this._moveState.rollLeft );

	}

	_getContainerDimensions() {

		if ( this.domElement !== document ) return { size: [ this.domElement.offsetWidth, this.domElement.offsetHeight ], offset: [ this.domElement.offsetLeft, this.domElement.offsetTop ] };
		return { size: [ window.innerWidth, window.innerHeight ], offset: [ 0, 0 ] };

	}

	_handleKeyDown( event ) {

		if ( event.altKey || this.enabled === false ) return;
		const state = this._moveState;

		switch ( event.code ) {

			case 'ShiftLeft': case 'ShiftRight': this.movementSpeedMultiplier = 0.1; break;
			case 'KeyW': state.forward = 1; break;
			case 'KeyS': state.back = 1; break;
			case 'KeyA': state.left = 1; break;
			case 'KeyD': state.right = 1; break;
			case 'KeyR': state.up = 1; break;
			case 'KeyF': state.down = 1; break;
			case 'ArrowUp': state.pitchUp = 1; break;
			case 'ArrowDown': state.pitchDown = 1; break;
			case 'ArrowLeft': state.yawLeft = 1; break;
			case 'ArrowRight': state.yawRight = 1; break;
			case 'KeyQ': state.rollLeft = 1; break;
			case 'KeyE': state.rollRight = 1; break;

		}

		this._updateMovementVector();
		this._updateRotationVector();

	}

	_handleKeyUp( event ) {

		if ( this.enabled === false ) return;
		const state = this._moveState;

		switch ( event.code ) {

			case 'ShiftLeft': case 'ShiftRight': this.movementSpeedMultiplier = 1; break;
			case 'KeyW': state.forward = 0; break;
			case 'KeyS': state.back = 0; break;
			case 'KeyA': state.left = 0; break;
			case 'KeyD': state.right = 0; break;
			case 'KeyR': state.up = 0; break;
			case 'KeyF': state.down = 0; break;
			case 'ArrowUp': state.pitchUp = 0; break;
			case 'ArrowDown': state.pitchDown = 0; break;
			case 'ArrowLeft': state.yawLeft = 0; break;
			case 'ArrowRight': state.yawRight = 0; break;
			case 'KeyQ': state.rollLeft = 0; break;
			case 'KeyE': state.rollRight = 0; break;

		}

		this._updateMovementVector();
		this._updateRotationVector();

	}

	_handlePointerDown( event ) {

		if ( this.enabled === false ) return;

		if ( this.dragToLook ) {

			this._status ++;

		} else {

			switch ( event.button ) {

				case 0: this._moveState.forward = 1; break;
				case 2: this._moveState.back = 1; break;

			}

			this._updateMovementVector();

		}

	}

	_handlePointerMove( event ) {

		if ( this.enabled === false ) return;

		if ( ! this.dragToLook || this._status > 0 ) {

			const container = this._getContainerDimensions();
			const halfWidth = container.size[ 0 ] / 2, halfHeight = container.size[ 1 ] / 2;
			this._moveState.yawLeft = - ( ( event.pageX - container.offset[ 0 ] ) - halfWidth ) / halfWidth;
			this._moveState.pitchDown = ( ( event.pageY - container.offset[ 1 ] ) - halfHeight ) / halfHeight;
			this._updateRotationVector();

		}

	}

	_handlePointerUp( event ) {

		if ( this.enabled === false ) return;

		if ( this.dragToLook ) {

			this._status --;
			this._moveState.yawLeft = this._moveState.pitchDown = 0;

		} else {

			switch ( event.button ) {

				case 0: this._moveState.forward = 0; break;
				case 2: this._moveState.back = 0; break;

			}

			this._updateMovementVector();

		}

		this._updateRotationVector();

	}

}
