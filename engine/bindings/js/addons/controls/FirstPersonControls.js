// three.js add-on path: `three/addons/controls/FirstPersonControls.js`.
//
// Look with the mouse position (or a drag with `activeLook` and `mouseDragOn`), walk with
// WASD or the arrow keys, rise and fall with R and F. Call `update( delta )` each frame.

import { Controls, Vector3 } from '../../compat.js';

const _lookDirection = new Vector3(), _target = new Vector3();
const DEG = Math.PI / 180, clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );

export class FirstPersonControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );
		this.movementSpeed = 1.0;
		this.lookSpeed = 0.005;
		this.lookVertical = true;
		this.autoForward = false;
		this.activeLook = true;
		this.heightSpeed = false;
		this.heightCoef = 1.0;
		this.heightMin = 0.0;
		this.heightMax = 1.0;
		this.constrainVertical = false;
		this.verticalMin = 0;
		this.verticalMax = Math.PI;
		this.mouseDragOn = false;
		this._autoSpeedFactor = 0.0;
		this._pointerX = 0;
		this._pointerY = 0;
		this._moveForward = this._moveBackward = this._moveLeft = this._moveRight = this._moveUp = this._moveDown = false;
		this._viewHalfX = 0;
		this._viewHalfY = 0;
		this._lat = 0;
		this._lon = 0;
		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerUp = this._handlePointerUp.bind( this );
		this._onContextMenu = ( event ) => event.preventDefault();
		this._onKeyDown = this._handleKeyDown.bind( this );
		this._onKeyUp = this._handleKeyUp.bind( this );

		if ( domElement !== null ) {

			this.connect( domElement );
			this.handleResize();

		}

		this._setOrientation();

	}

	connect( element ) {

		super.connect( element );
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		this.domElement.addEventListener( 'pointermove', this._onPointerMove );
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );
		this.domElement.addEventListener( 'contextmenu', this._onContextMenu );

	}

	disconnect() {

		if ( this.domElement === null ) return;
		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );

	}

	dispose() {

		this.disconnect();

	}

	handleResize() {

		if ( this.domElement === document ) {

			this._viewHalfX = window.innerWidth / 2;
			this._viewHalfY = window.innerHeight / 2;

		} else {

			this._viewHalfX = this.domElement.offsetWidth / 2;
			this._viewHalfY = this.domElement.offsetHeight / 2;

		}

	}

	lookAt( x, y, z ) {

		if ( x.isVector3 ) _target.copy( x );
		else _target.set( x, y, z );
		this.object.lookAt( _target );
		this._setOrientation();
		return this;

	}

	update( delta ) {

		if ( this.enabled === false ) return;

		if ( this.heightSpeed ) {

			const y = clamp( this.object.position.y, this.heightMin, this.heightMax );
			this._autoSpeedFactor = delta * ( ( y - this.heightMin ) * this.heightCoef );

		} else {

			this._autoSpeedFactor = 0.0;

		}

		const actualMoveSpeed = delta * this.movementSpeed;
		if ( this._moveForward || ( this.autoForward && ! this._moveBackward ) ) this.object.translateZ( - ( actualMoveSpeed + this._autoSpeedFactor ) );
		if ( this._moveBackward ) this.object.translateZ( actualMoveSpeed );
		if ( this._moveLeft ) this.object.translateX( - actualMoveSpeed );
		if ( this._moveRight ) this.object.translateX( actualMoveSpeed );
		if ( this._moveUp ) this.object.translateY( actualMoveSpeed );
		if ( this._moveDown ) this.object.translateY( - actualMoveSpeed );
		let actualLookSpeed = delta * this.lookSpeed;
		if ( ! this.activeLook ) actualLookSpeed = 0;
		let verticalLookRatio = 1;
		if ( this.constrainVertical ) verticalLookRatio = Math.PI / ( this.verticalMax - this.verticalMin );
		this._lon -= this._pointerX * actualLookSpeed;
		if ( this.lookVertical ) this._lat -= this._pointerY * actualLookSpeed * verticalLookRatio;
		this._lat = Math.max( - 85, Math.min( 85, this._lat ) );
		let phi = ( 90 - this._lat ) * DEG;
		const theta = this._lon * DEG;
		if ( this.constrainVertical ) phi = this.verticalMin + phi / Math.PI * ( this.verticalMax - this.verticalMin );
		const position = this.object.position;
		const sinPhi = Math.sin( phi );
		_target.set( position.x + sinPhi * Math.cos( theta ) * 100, position.y + Math.cos( phi ) * 100, position.z + sinPhi * Math.sin( theta ) * 100 );
		this.object.lookAt( _target );

	}

	_setOrientation() {

		const quaternion = this.object.quaternion;
		_lookDirection.set( 0, 0, - 1 ).applyQuaternion( quaternion );
		const radius = _lookDirection.length() || 1;
		const theta = Math.atan2( _lookDirection.x, _lookDirection.z ), phi = Math.acos( Math.max( - 1, Math.min( 1, _lookDirection.y / radius ) ) );
		this._lat = 90 - phi / DEG;
		this._lon = theta / DEG;

	}

	_handlePointerDown( event ) {

		if ( this.domElement !== document ) this.domElement.focus();

		if ( this.activeLook ) {

			switch ( event.button ) {

				case 0: this._moveForward = true; break;
				case 2: this._moveBackward = true; break;

			}

		}

		this.mouseDragOn = true;

	}

	_handlePointerUp( event ) {

		if ( this.activeLook ) {

			switch ( event.button ) {

				case 0: this._moveForward = false; break;
				case 2: this._moveBackward = false; break;

			}

		}

		this.mouseDragOn = false;

	}

	_handlePointerMove( event ) {

		if ( this.domElement === document ) {

			this._pointerX = event.pageX - this._viewHalfX;
			this._pointerY = event.pageY - this._viewHalfY;

		} else {

			this._pointerX = event.pageX - this.domElement.offsetLeft - this._viewHalfX;
			this._pointerY = event.pageY - this.domElement.offsetTop - this._viewHalfY;

		}

	}

	_handleKeyDown( event ) {

		switch ( event.code ) {

			case 'ArrowUp': case 'KeyW': this._moveForward = true; break;
			case 'ArrowLeft': case 'KeyA': this._moveLeft = true; break;
			case 'ArrowDown': case 'KeyS': this._moveBackward = true; break;
			case 'ArrowRight': case 'KeyD': this._moveRight = true; break;
			case 'KeyR': this._moveUp = true; break;
			case 'KeyF': this._moveDown = true; break;

		}

	}

	_handleKeyUp( event ) {

		switch ( event.code ) {

			case 'ArrowUp': case 'KeyW': this._moveForward = false; break;
			case 'ArrowLeft': case 'KeyA': this._moveLeft = false; break;
			case 'ArrowDown': case 'KeyS': this._moveBackward = false; break;
			case 'ArrowRight': case 'KeyD': this._moveRight = false; break;
			case 'KeyR': this._moveUp = false; break;
			case 'KeyF': this._moveDown = false; break;

		}

	}

}

