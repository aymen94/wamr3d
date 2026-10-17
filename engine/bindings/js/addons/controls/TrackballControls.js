// three.js add-on path: `three/addons/controls/TrackballControls.js`.
//
// Rotates the camera freely around `target` (no fixed up), zooms and pans: left drag
// rotates, middle drag zooms, right drag pans. Call `update()` each frame.

import { Controls, MOUSE, Quaternion, Vector2, Vector3 } from '../../compat.js';

const STATE = { NONE: - 1, ROTATE: 0, ZOOM: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_ZOOM_PAN: 4 };
const _changeEvent = { type: 'change' }, _startEvent = { type: 'start' }, _endEvent = { type: 'end' };
const _EPS = 0.000001;

export class TrackballControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );
		this.enabled = true;
		this.screen = { left: 0, top: 0, width: 0, height: 0 };
		this.rotateSpeed = 1.0;
		this.zoomSpeed = 1.2;
		this.panSpeed = 0.3;
		this.noRotate = false;
		this.noZoom = false;
		this.noPan = false;
		this.staticMoving = false;
		this.dynamicDampingFactor = 0.2;
		this.minDistance = 0;
		this.maxDistance = Infinity;
		this.minZoom = 0;
		this.maxZoom = Infinity;
		this.keys = [ 'KeyA', 'KeyS', 'KeyD' ];
		this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
		this.target = new Vector3();
		this.state = STATE.NONE;
		this.keyState = STATE.NONE;
		this._lastPosition = new Vector3();
		this._lastZoom = 1;
		this._touchZoomDistanceStart = 0;
		this._touchZoomDistanceEnd = 0;
		this._lastAngle = 0;
		this._eye = new Vector3();
		this._movePrev = new Vector2();
		this._moveCurr = new Vector2();
		this._lastAxis = new Vector3();
		this._zoomStart = new Vector2();
		this._zoomEnd = new Vector2();
		this._panStart = new Vector2();
		this._panEnd = new Vector2();
		this._pointers = [];
		this._pointerPositions = {};
		this.target0 = this.target.clone();
		this.position0 = this.object.position.clone();
		this.up0 = this.object.up.clone();
		this.zoom0 = this.object.zoom;
		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerUp = this._handlePointerUp.bind( this );
		this._onPointerCancel = this._handlePointerUp.bind( this );
		this._onContextMenu = ( event ) => {

			if ( this.enabled ) event.preventDefault();

		};

		this._onMouseWheel = this._handleMouseWheel.bind( this );
		this._onKeyDown = this._handleKeyDown.bind( this );
		this._onKeyUp = () => {

			if ( this.enabled === false ) return;
			this.keyState = STATE.NONE;
			window.addEventListener( 'keydown', this._onKeyDown );

		};

		if ( domElement !== null ) {

			this.connect( domElement );
			this.handleResize();

		}

		this.update();

	}

	connect( element ) {

		super.connect( element );
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointercancel', this._onPointerCancel );
		this.domElement.addEventListener( 'wheel', this._onMouseWheel, { passive: false } );
		this.domElement.addEventListener( 'contextmenu', this._onContextMenu );
		this.domElement.style.touchAction = 'none';

	}

	disconnect() {

		if ( this.domElement === null ) return;
		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'pointercancel', this._onPointerCancel );
		this.domElement.removeEventListener( 'wheel', this._onMouseWheel );
		this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );
		this.domElement.style.touchAction = 'auto';

	}

	dispose() {

		this.disconnect();

	}

	handleResize() {

		const box = this.domElement.getBoundingClientRect();
		const d = this.domElement.ownerDocument.documentElement;
		this.screen.left = box.left + window.pageXOffset - d.clientLeft;
		this.screen.top = box.top + window.pageYOffset - d.clientTop;
		this.screen.width = box.width;
		this.screen.height = box.height;

	}

	update() {

		this._eye.subVectors( this.object.position, this.target );
		if ( ! this.noRotate ) this._rotateCamera();
		if ( ! this.noZoom ) this._zoomCamera();
		if ( ! this.noPan ) this._panCamera();
		this.object.position.addVectors( this.target, this._eye );

		if ( this.object.isPerspectiveCamera ) {

			this._checkDistances();
			this.object.lookAt( this.target );

			if ( this._lastPosition.distanceToSquared( this.object.position ) > _EPS ) {

				this.dispatchEvent( _changeEvent );
				this._lastPosition.copy( this.object.position );

			}

		} else if ( this.object.isOrthographicCamera ) {

			this.object.lookAt( this.target );

			if ( this._lastPosition.distanceToSquared( this.object.position ) > _EPS || this._lastZoom !== this.object.zoom ) {

				this.dispatchEvent( _changeEvent );
				this._lastPosition.copy( this.object.position );
				this._lastZoom = this.object.zoom;

			}

		}

	}

	reset() {

		this.state = STATE.NONE;
		this.keyState = STATE.NONE;
		this.target.copy( this.target0 );
		this.object.position.copy( this.position0 );
		this.object.up.copy( this.up0 );
		this.object.zoom = this.zoom0;
		this.object.updateProjectionMatrix();
		this._eye.subVectors( this.object.position, this.target );
		this.object.lookAt( this.target );
		this.dispatchEvent( _changeEvent );
		this._lastPosition.copy( this.object.position );
		this._lastZoom = this.object.zoom;

	}

	_panCamera() {

		const mouseChange = new Vector2().copy( this._panEnd ).sub( this._panStart );
		if ( ! mouseChange.lengthSq() ) return;

		if ( this.object.isOrthographicCamera ) {

			const scaleX = ( this.object.right - this.object.left ) / this.object.zoom / this.domElement.clientWidth;
			const scaleY = ( this.object.top - this.object.bottom ) / this.object.zoom / this.domElement.clientWidth;
			mouseChange.x *= scaleX;
			mouseChange.y *= scaleY;

		}

		mouseChange.multiplyScalar( this._eye.length() * this.panSpeed );
		const pan = new Vector3().copy( this._eye ).cross( this.object.up ).setLength( mouseChange.x );
		pan.add( new Vector3( this.object.up.x, this.object.up.y, this.object.up.z ).setLength( mouseChange.y ) );
		this.object.position.add( pan );
		this.target.add( pan );
		if ( this.staticMoving ) this._panStart.copy( this._panEnd );
		else this._panStart.add( mouseChange.subVectors( this._panEnd, this._panStart ).multiplyScalar( this.dynamicDampingFactor ) );

	}

	_rotateCamera() {

		const moveDirection = new Vector3( this._moveCurr.x - this._movePrev.x, this._moveCurr.y - this._movePrev.y, 0 );
		let angle = moveDirection.length();

		if ( angle ) {

			this._eye.copy( this.object.position ).sub( this.target );
			const eyeDirection = new Vector3().copy( this._eye ).normalize();
			const objectUpDirection = new Vector3( this.object.up.x, this.object.up.y, this.object.up.z ).normalize();
			const objectSidewaysDirection = new Vector3().crossVectors( objectUpDirection, eyeDirection ).normalize();
			objectUpDirection.setLength( this._moveCurr.y - this._movePrev.y );
			objectSidewaysDirection.setLength( this._moveCurr.x - this._movePrev.x );
			moveDirection.copy( objectUpDirection.add( objectSidewaysDirection ) );
			const axis = new Vector3().crossVectors( moveDirection, this._eye ).normalize();
			angle *= this.rotateSpeed;
			const quaternion = new Quaternion().setFromAxisAngle( axis, angle );
			this._eye.applyQuaternion( quaternion );
			this.object.up.applyQuaternion( quaternion );
			this._lastAxis.copy( axis );
			this._lastAngle = angle;

		} else if ( ! this.staticMoving && this._lastAngle ) {

			this._lastAngle *= Math.sqrt( 1.0 - this.dynamicDampingFactor );
			this._eye.copy( this.object.position ).sub( this.target );
			const quaternion = new Quaternion().setFromAxisAngle( this._lastAxis, this._lastAngle );
			this._eye.applyQuaternion( quaternion );
			this.object.up.applyQuaternion( quaternion );

		}

		this._movePrev.copy( this._moveCurr );

	}

	_zoomCamera() {

		let factor;

		if ( this.state === STATE.TOUCH_ZOOM_PAN ) {

			factor = this._touchZoomDistanceStart / this._touchZoomDistanceEnd;
			this._touchZoomDistanceStart = this._touchZoomDistanceEnd;

			if ( this.object.isPerspectiveCamera ) {

				this._eye.multiplyScalar( factor );

			} else if ( this.object.isOrthographicCamera ) {

				this.object.zoom = Math.max( this.minZoom, Math.min( this.maxZoom, this.object.zoom / factor ) );
				if ( this._lastZoom !== this.object.zoom ) this.object.updateProjectionMatrix();

			}

		} else {

			factor = 1.0 + ( this._zoomEnd.y - this._zoomStart.y ) * this.zoomSpeed;

			if ( factor !== 1.0 && factor > 0.0 ) {

				if ( this.object.isPerspectiveCamera ) {

					this._eye.multiplyScalar( factor );

				} else if ( this.object.isOrthographicCamera ) {

					this.object.zoom = Math.max( this.minZoom, Math.min( this.maxZoom, this.object.zoom / factor ) );
					if ( this._lastZoom !== this.object.zoom ) this.object.updateProjectionMatrix();

				}

			}

			if ( this.staticMoving ) this._zoomStart.copy( this._zoomEnd );
			else this._zoomStart.y += ( this._zoomEnd.y - this._zoomStart.y ) * this.dynamicDampingFactor;

		}

	}

	_getMouseOnScreen( pageX, pageY ) {

		return new Vector2( ( pageX - this.screen.left ) / this.screen.width, ( pageY - this.screen.top ) / this.screen.height );

	}

	_getMouseOnCircle( pageX, pageY ) {

		return new Vector2( ( pageX - this.screen.width * 0.5 - this.screen.left ) / ( this.screen.width * 0.5 ), ( this.screen.height + 2 * ( this.screen.top - pageY ) ) / this.screen.width );

	}

	_checkDistances() {

		if ( ! this.noZoom || ! this.noPan ) {

			if ( this._eye.lengthSq() > this.maxDistance * this.maxDistance ) {

				this.object.position.addVectors( this.target, this._eye.setLength( this.maxDistance ) );
				this._zoomStart.copy( this._zoomEnd );

			}

			if ( this._eye.lengthSq() < this.minDistance * this.minDistance ) {

				this.object.position.addVectors( this.target, this._eye.setLength( this.minDistance ) );
				this._zoomStart.copy( this._zoomEnd );

			}

		}

	}

	_handlePointerDown( event ) {

		if ( this.enabled === false ) return;

		if ( this._pointers.length === 0 ) {

			this.domElement.setPointerCapture( event.pointerId );
			this.domElement.addEventListener( 'pointermove', this._onPointerMove );
			this.domElement.addEventListener( 'pointerup', this._onPointerUp );

		}

		this._pointers.push( event.pointerId );
		this._pointerPositions[ event.pointerId ] = new Vector2( event.pageX, event.pageY );

		if ( event.pointerType === 'touch' ) {

			if ( this._pointers.length === 1 ) {

				this.state = STATE.TOUCH_ROTATE;
				this._moveCurr.copy( this._getMouseOnCircle( event.pageX, event.pageY ) );
				this._movePrev.copy( this._moveCurr );

			} else {

				this.state = STATE.TOUCH_ZOOM_PAN;
				const [ a, b ] = this._pointers.map( ( id ) => this._pointerPositions[ id ] );
				this._touchZoomDistanceEnd = this._touchZoomDistanceStart = a.distanceTo( b );
				const x = ( a.x + b.x ) / 2, y = ( a.y + b.y ) / 2;
				this._panStart.copy( this._getMouseOnScreen( x, y ) );
				this._panEnd.copy( this._panStart );

			}

			this.dispatchEvent( _startEvent );
			return;

		}

		let mouseAction;

		switch ( event.button ) {

			case 0: mouseAction = this.mouseButtons.LEFT; break;
			case 1: mouseAction = this.mouseButtons.MIDDLE; break;
			case 2: mouseAction = this.mouseButtons.RIGHT; break;
			default: mouseAction = - 1;

		}

		const state = this.keyState !== STATE.NONE ? this.keyState : mouseAction === MOUSE.DOLLY ? STATE.ZOOM : mouseAction === MOUSE.ROTATE ? STATE.ROTATE : mouseAction === MOUSE.PAN ? STATE.PAN : STATE.NONE;
		this.state = state;

		if ( state === STATE.ROTATE && ! this.noRotate ) {

			this._moveCurr.copy( this._getMouseOnCircle( event.pageX, event.pageY ) );
			this._movePrev.copy( this._moveCurr );

		} else if ( state === STATE.ZOOM && ! this.noZoom ) {

			this._zoomStart.copy( this._getMouseOnScreen( event.pageX, event.pageY ) );
			this._zoomEnd.copy( this._zoomStart );

		} else if ( state === STATE.PAN && ! this.noPan ) {

			this._panStart.copy( this._getMouseOnScreen( event.pageX, event.pageY ) );
			this._panEnd.copy( this._panStart );

		}

		this.dispatchEvent( _startEvent );

	}

	_handlePointerMove( event ) {

		if ( this.enabled === false ) return;
		this._pointerPositions[ event.pointerId ]?.set( event.pageX, event.pageY );

		if ( event.pointerType === 'touch' ) {

			if ( this._pointers.length === 1 ) {

				this._movePrev.copy( this._moveCurr );
				this._moveCurr.copy( this._getMouseOnCircle( event.pageX, event.pageY ) );

			} else {

				const [ a, b ] = this._pointers.map( ( id ) => this._pointerPositions[ id ] );
				this._touchZoomDistanceEnd = a.distanceTo( b );
				this._panEnd.copy( this._getMouseOnScreen( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2 ) );

			}

			return;

		}

		if ( this.state === STATE.ROTATE && ! this.noRotate ) {

			this._movePrev.copy( this._moveCurr );
			this._moveCurr.copy( this._getMouseOnCircle( event.pageX, event.pageY ) );

		} else if ( this.state === STATE.ZOOM && ! this.noZoom ) {

			this._zoomEnd.copy( this._getMouseOnScreen( event.pageX, event.pageY ) );

		} else if ( this.state === STATE.PAN && ! this.noPan ) {

			this._panEnd.copy( this._getMouseOnScreen( event.pageX, event.pageY ) );

		}

	}

	_handlePointerUp( event ) {

		const index = this._pointers.indexOf( event.pointerId );
		if ( index !== - 1 ) this._pointers.splice( index, 1 );
		delete this._pointerPositions[ event.pointerId ];

		if ( this._pointers.length === 0 ) {

			this.domElement.releasePointerCapture( event.pointerId );
			this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
			this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
			this.state = STATE.NONE;

		} else if ( event.pointerType === 'touch' ) {

			const position = this._pointerPositions[ this._pointers[ 0 ] ];
			this.state = STATE.TOUCH_ROTATE;
			this._moveCurr.copy( this._getMouseOnCircle( position.x, position.y ) );
			this._movePrev.copy( this._moveCurr );

		}

		this.dispatchEvent( _endEvent );

	}

	_handleMouseWheel( event ) {

		if ( this.enabled === false || this.noZoom === true ) return;
		event.preventDefault();

		switch ( event.deltaMode ) {

			case 2: this._zoomStart.y -= event.deltaY * 0.025; break;
			case 1: this._zoomStart.y -= event.deltaY * 0.01; break;
			default: this._zoomStart.y -= event.deltaY * 0.00025;

		}

		this.dispatchEvent( _startEvent );
		this.dispatchEvent( _endEvent );

	}

	_handleKeyDown( event ) {

		if ( this.enabled === false ) return;
		window.removeEventListener( 'keydown', this._onKeyDown );
		if ( this.keyState !== STATE.NONE ) return;
		if ( event.code === this.keys[ STATE.ROTATE ] && ! this.noRotate ) this.keyState = STATE.ROTATE;
		else if ( event.code === this.keys[ STATE.ZOOM ] && ! this.noZoom ) this.keyState = STATE.ZOOM;
		else if ( event.code === this.keys[ STATE.PAN ] && ! this.noPan ) this.keyState = STATE.PAN;

	}

}
