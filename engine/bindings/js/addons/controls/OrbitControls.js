// three.js add-on paths: `three/addons/controls/OrbitControls.js` (OrbitControls) and
// `three/addons/controls/MapControls.js` (MapControls).
//
// Orbits the camera around `target`: left drag rotates, wheel or middle drag dollies,
// right drag (or shift/ctrl/meta with left) pans; one finger rotates, two dolly and pan.

import { Controls, MOUSE, Quaternion, TOUCH, Vector2, Vector3, Plane, Ray } from '../../compat.js';

// Spherical coordinates in JavaScript: the controls change them on every pointer move.
class Spherical {

	constructor( radius = 1, phi = 0, theta = 0 ) {

		this.radius = radius;
		this.phi = phi;
		this.theta = theta;

	}

	set( radius, phi, theta ) {

		this.radius = radius;
		this.phi = phi;
		this.theta = theta;
		return this;

	}

	// keeps phi a little away from the poles
	makeSafe() {

		const EPS = 0.000001;
		this.phi = Math.max( EPS, Math.min( Math.PI - EPS, this.phi ) );
		return this;

	}

	setFromVector3( v ) {

		this.radius = Math.sqrt( v.x * v.x + v.y * v.y + v.z * v.z );

		if ( this.radius === 0 ) {

			this.theta = 0;
			this.phi = 0;

		} else {

			this.theta = Math.atan2( v.x, v.z );
			this.phi = Math.acos( Math.max( - 1, Math.min( 1, v.y / this.radius ) ) );

		}

		return this;

	}

}

const _changeEvent = { type: 'change' }, _startEvent = { type: 'start' }, _endEvent = { type: 'end' };
const _ray = new Ray(), _plane = new Plane(), _TILT_LIMIT = Math.cos( 70 * Math.PI / 180 );
const _v = new Vector3(), _twoPI = 2 * Math.PI;
const STATE = { NONE: - 1, ROTATE: 0, DOLLY: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_PAN: 4, TOUCH_DOLLY_PAN: 5, TOUCH_DOLLY_ROTATE: 6 };
const EPS = 0.000001;

export class OrbitControls extends Controls {

	constructor( object, domElement = null ) {

		super( object, domElement );
		this.state = STATE.NONE;
		this.target = new Vector3();
		this.cursor = new Vector3();
		this.minDistance = 0;
		this.maxDistance = Infinity;
		this.minZoom = 0;
		this.maxZoom = Infinity;
		this.minTargetRadius = 0;
		this.maxTargetRadius = Infinity;
		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;
		this.minAzimuthAngle = - Infinity;
		this.maxAzimuthAngle = Infinity;
		this.enableDamping = false;
		this.dampingFactor = 0.05;
		this.enableZoom = true;
		this.zoomSpeed = 1.0;
		this.enableRotate = true;
		this.rotateSpeed = 1.0;
		this.keyRotateSpeed = 1.0;
		this.enablePan = true;
		this.panSpeed = 1.0;
		this.screenSpacePanning = true;
		this.keyPanSpeed = 7.0;
		this.zoomToCursor = false;
		this.autoRotate = false;
		this.autoRotateSpeed = 2.0;
		this.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
		this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
		this.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
		this.target0 = this.target.clone();
		this.position0 = this.object.position.clone();
		this.zoom0 = this.object.zoom;
		this._domElementKeyEvents = null;

		this._lastPosition = new Vector3();
		this._lastQuaternion = new Quaternion();
		this._lastTargetPosition = new Vector3();
		this._quat = new Quaternion().setFromUnitVectors( new Vector3( object.up.x, object.up.y, object.up.z ), new Vector3( 0, 1, 0 ) );
		this._quatInverse = this._quat.clone().invert();
		this._spherical = new Spherical();
		this._sphericalDelta = new Spherical();
		this._scale = 1;
		this._panOffset = new Vector3();
		this._rotateStart = new Vector2();
		this._rotateEnd = new Vector2();
		this._rotateDelta = new Vector2();
		this._panStart = new Vector2();
		this._panEnd = new Vector2();
		this._panDelta = new Vector2();
		this._dollyStart = new Vector2();
		this._dollyEnd = new Vector2();
		this._dollyDelta = new Vector2();
		this._dollyDirection = new Vector3();
		this._mouse = new Vector2();
		this._performCursorZoom = false;
		this._pointers = [];
		this._pointerPositions = {};
		this._controlActive = false;

		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerUp = this._handlePointerUp.bind( this );
		this._onContextMenu = ( event ) => {

			if ( this.enabled ) event.preventDefault();

		};

		this._onMouseWheel = this._handleMouseWheel.bind( this );
		this._onKeyDown = this._handleKeyDown.bind( this );
		this._onTouchStart = this._handleTouchStart.bind( this );
		this._onTouchMove = this._handleTouchMove.bind( this );
		this._onMouseDown = this._handleMouseDown.bind( this );
		this._onMouseMove = this._handleMouseMove.bind( this );
		this._interceptControlDown = this._handleControlDown.bind( this );
		this._interceptControlUp = this._handleControlUp.bind( this );

		if ( this.domElement !== null ) this.connect( this.domElement );
		this.update();

	}

	connect( element ) {

		super.connect( element );
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointercancel', this._onPointerUp );
		this.domElement.addEventListener( 'contextmenu', this._onContextMenu );
		this.domElement.addEventListener( 'wheel', this._onMouseWheel, { passive: false } );
		const document = this.domElement.getRootNode();
		document.addEventListener( 'keydown', this._interceptControlDown, { passive: true, capture: true } );
		this.domElement.style.touchAction = 'none';

	}

	disconnect() {

		if ( this.domElement === null ) return;
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.removeEventListener( 'pointercancel', this._onPointerUp );
		this.domElement.removeEventListener( 'wheel', this._onMouseWheel );
		this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );
		this.stopListenToKeyEvents();
		const document = this.domElement.getRootNode();
		document.removeEventListener( 'keydown', this._interceptControlDown, { capture: true } );
		this.domElement.style.touchAction = 'auto';

	}

	dispose() {

		this.disconnect();

	}

	getPolarAngle() {

		return this._spherical.phi;

	}

	getAzimuthalAngle() {

		return this._spherical.theta;

	}

	getDistance() {

		return this.object.position.distanceTo( this.target );

	}

	listenToKeyEvents( domElement ) {

		domElement.addEventListener( 'keydown', this._onKeyDown );
		this._domElementKeyEvents = domElement;

	}

	stopListenToKeyEvents() {

		if ( this._domElementKeyEvents !== null ) {

			this._domElementKeyEvents.removeEventListener( 'keydown', this._onKeyDown );
			this._domElementKeyEvents = null;

		}

	}

	saveState() {

		this.target0.copy( this.target );
		this.position0.copy( this.object.position );
		this.zoom0 = this.object.zoom;

	}

	reset() {

		this.target.copy( this.target0 );
		this.object.position.copy( this.position0 );
		this.object.zoom = this.zoom0;
		this.object.updateProjectionMatrix();
		this.dispatchEvent( _changeEvent );
		this.update();
		this.state = STATE.NONE;

	}

	pan( deltaX, deltaY ) {

		this._pan( deltaX, deltaY );
		this.update();

	}

	dollyIn( dollyScale ) {

		this._dollyIn( dollyScale );
		this.update();

	}

	dollyOut( dollyScale ) {

		this._dollyOut( dollyScale );
		this.update();

	}

	rotateLeft( angle ) {

		this._rotateLeft( angle );
		this.update();

	}

	rotateUp( angle ) {

		this._rotateUp( angle );
		this.update();

	}

	update( deltaTime = null ) {

		const position = this.object.position;
		const offset = _v.copy( position ).sub( this.target );
		// rotate offset to "y-axis-is-up" space
		offset.applyQuaternion( this._quat );
		this._spherical.setFromVector3( offset );
		if ( this.autoRotate && this.state === STATE.NONE ) this._rotateLeft( this._getAutoRotationAngle( deltaTime ) );

		if ( this.enableDamping ) {

			this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor;
			this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor;

		} else {

			this._spherical.theta += this._sphericalDelta.theta;
			this._spherical.phi += this._sphericalDelta.phi;

		}

		// restrict theta to be between desired limits
		let min = this.minAzimuthAngle, max = this.maxAzimuthAngle;

		if ( isFinite( min ) && isFinite( max ) ) {

			if ( min < - Math.PI ) min += _twoPI; else if ( min > Math.PI ) min -= _twoPI;
			if ( max < - Math.PI ) max += _twoPI; else if ( max > Math.PI ) max -= _twoPI;

			if ( min <= max ) {

				this._spherical.theta = Math.max( min, Math.min( max, this._spherical.theta ) );

			} else {

				this._spherical.theta = ( this._spherical.theta > ( min + max ) / 2 ) ? Math.max( min, this._spherical.theta ) : Math.min( max, this._spherical.theta );

			}

		}

		// restrict phi to be between desired limits
		this._spherical.phi = Math.max( this.minPolarAngle, Math.min( this.maxPolarAngle, this._spherical.phi ) );
		this._spherical.makeSafe();

		// move target to panned location
		if ( this.enableDamping === true ) this.target.addScaledVector( this._panOffset, this.dampingFactor );
		else this.target.add( this._panOffset );

		// limit the target distance from the cursor to create a sphere around the center of interest
		this.target.sub( this.cursor );
		this.target.clampLength( this.minTargetRadius, this.maxTargetRadius );
		this.target.add( this.cursor );

		let zoomChanged = false;

		// adjust the camera position based on zoom only if we're not zooming to the cursor or if it's an ortho camera
		if ( this.zoomToCursor && this._performCursorZoom || this.object.isOrthographicCamera ) {

			this._spherical.radius = this._clampDistance( this._spherical.radius );

		} else {

			const prevRadius = this._spherical.radius;
			this._spherical.radius = this._clampDistance( this._spherical.radius * this._scale );
			zoomChanged = prevRadius != this._spherical.radius;

		}

		{

			const { radius, phi, theta } = this._spherical, sinPhiRadius = Math.sin( phi ) * radius;
			offset.set( sinPhiRadius * Math.sin( theta ), Math.cos( phi ) * radius, sinPhiRadius * Math.cos( theta ) );

		}
		// rotate offset back to "camera-up-vector-is-up" space
		offset.applyQuaternion( this._quatInverse );
		position.copy( this.target ).add( offset );
		this.object.lookAt( this.target );

		if ( this.enableDamping === true ) {

			this._sphericalDelta.theta *= ( 1 - this.dampingFactor );
			this._sphericalDelta.phi *= ( 1 - this.dampingFactor );
			this._panOffset.multiplyScalar( 1 - this.dampingFactor );

		} else {

			this._sphericalDelta.set( 0, 0, 0 );
			this._panOffset.set( 0, 0, 0 );

		}

		// adjust camera position
		if ( this.zoomToCursor && this._performCursorZoom ) {

			let newRadius = null;

			if ( this.object.isPerspectiveCamera ) {

				// move the camera down the pointer ray; this method avoids numerical instability
				const prevRadius = offset.length();
				newRadius = this._clampDistance( prevRadius * this._scale );
				const radiusDelta = prevRadius - newRadius;
				this.object.position.addScaledVector( this._dollyDirection, radiusDelta );
				this.object.updateMatrixWorld();
				zoomChanged = !! radiusDelta;

			} else if ( this.object.isOrthographicCamera ) {

				// adjust the ortho camera position based on zoom changes
				const mouseBefore = new Vector3( this._mouse.x, this._mouse.y, 0 );
				mouseBefore.unproject( this.object );
				const prevZoom = this.object.zoom;
				this.object.zoom = Math.max( this.minZoom, Math.min( this.maxZoom, this.object.zoom / this._scale ) );
				this.object.updateProjectionMatrix();
				zoomChanged = prevZoom !== this.object.zoom;
				const mouseAfter = new Vector3( this._mouse.x, this._mouse.y, 0 );
				mouseAfter.unproject( this.object );
				this.object.position.sub( mouseAfter ).add( mouseBefore );
				this.object.updateMatrixWorld();
				newRadius = offset.length();

			} else {

				console.warn( 'WAMR3D: OrbitControls encountered an unknown camera type - zoom to cursor disabled.' );
				this.zoomToCursor = false;

			}

			// handle the placement of the target
			if ( newRadius !== null ) {

				if ( this.screenSpacePanning ) {

					// position the orbit target in front of the new camera position
					this.target.set( 0, 0, - 1 ).transformDirection( this.object.matrix ).multiplyScalar( newRadius ).add( this.object.position );

				} else {

					// get the ray and translation plane to compute target
					_ray.origin.copy( this.object.position );
					_ray.direction.set( 0, 0, - 1 ).transformDirection( this.object.matrix );

					// if the camera is 20 degrees above the horizon then don't adjust the focus target to avoid
					// extremely large values
					if ( Math.abs( this.object.up.dot( _ray.direction ) ) < _TILT_LIMIT ) {

						this.object.lookAt( this.target );

					} else {

						_plane.setFromNormalAndCoplanarPoint( this.object.up, this.target );
						_ray.intersectPlane( _plane, this.target );

					}

				}

			}

		} else if ( this.object.isOrthographicCamera ) {

			const prevZoom = this.object.zoom;
			this.object.zoom = Math.max( this.minZoom, Math.min( this.maxZoom, this.object.zoom / this._scale ) );

			if ( prevZoom !== this.object.zoom ) {

				this.object.updateProjectionMatrix();
				zoomChanged = true;

			}

		}

		this._scale = 1;
		this._performCursorZoom = false;

		// update condition is:
		// min(camera displacement, camera rotation in radians)^2 > EPS
		// using small-angle approximation cos(x/2) = 1 - x^2 / 8
		if ( zoomChanged || this._lastPosition.distanceToSquared( this.object.position ) > EPS || 8 * ( 1 - this._lastQuaternion.dot( this.object.quaternion ) ) > EPS || this._lastTargetPosition.distanceToSquared( this.target ) > EPS ) {

			this.dispatchEvent( _changeEvent );
			this._lastPosition.copy( this.object.position );
			this._lastQuaternion.copy( this.object.quaternion );
			this._lastTargetPosition.copy( this.target );
			return true;

		}

		return false;

	}

	_getAutoRotationAngle( deltaTime ) {

		if ( deltaTime !== null ) return ( _twoPI / 60 * this.autoRotateSpeed ) * deltaTime;
		return _twoPI / 60 / 60 * this.autoRotateSpeed;

	}

	_getZoomScale( delta ) {

		const normalizedDelta = Math.abs( delta * 0.01 );
		return Math.pow( 0.95, this.zoomSpeed * normalizedDelta );

	}

	_rotateLeft( angle ) {

		this._sphericalDelta.theta -= angle;

	}

	_rotateUp( angle ) {

		this._sphericalDelta.phi -= angle;

	}

	_panLeft( distance, objectMatrix ) {

		_v.setFromMatrixColumn( objectMatrix, 0 );
		_v.multiplyScalar( - distance );
		this._panOffset.add( _v );

	}

	_panUp( distance, objectMatrix ) {

		if ( this.screenSpacePanning === true ) {

			_v.setFromMatrixColumn( objectMatrix, 1 );

		} else {

			_v.setFromMatrixColumn( objectMatrix, 0 );
			_v.crossVectors( this.object.up, _v );

		}

		_v.multiplyScalar( distance );
		this._panOffset.add( _v );

	}

	// deltaX and deltaY are in pixels; right and down are positive
	_pan( deltaX, deltaY ) {

		const element = this.domElement;

		if ( this.object.isPerspectiveCamera ) {

			// perspective
			const position = this.object.position;
			const offset = new Vector3().copy( position ).sub( this.target );
			let targetDistance = offset.length();
			// half of the fov is center to top of screen
			targetDistance *= Math.tan( ( this.object.fov / 2 ) * Math.PI / 180.0 );
			// we use only clientHeight here so aspect ratio does not distort speed
			const matrix = this.object.matrix;
			this._panLeft( 2 * deltaX * targetDistance / element.clientHeight, matrix );
			this._panUp( 2 * deltaY * targetDistance / element.clientHeight, matrix );

		} else if ( this.object.isOrthographicCamera ) {

			// orthographic
			const matrix = this.object.matrix;
			this._panLeft( deltaX * ( this.object.right - this.object.left ) / this.object.zoom / element.clientWidth, matrix );
			this._panUp( deltaY * ( this.object.top - this.object.bottom ) / this.object.zoom / element.clientHeight, matrix );

		} else {

			// camera neither orthographic nor perspective
			console.warn( 'WAMR3D: OrbitControls encountered an unknown camera type - pan disabled.' );
			this.enablePan = false;

		}

	}

	_dollyOut( dollyScale ) {

		if ( this.object.isPerspectiveCamera || this.object.isOrthographicCamera ) {

			this._scale /= dollyScale;

		} else {

			console.warn( 'WAMR3D: OrbitControls encountered an unknown camera type - dolly/zoom disabled.' );
			this.enableZoom = false;

		}

	}

	_dollyIn( dollyScale ) {

		if ( this.object.isPerspectiveCamera || this.object.isOrthographicCamera ) {

			this._scale *= dollyScale;

		} else {

			console.warn( 'WAMR3D: OrbitControls encountered an unknown camera type - dolly/zoom disabled.' );
			this.enableZoom = false;

		}

	}

	_updateZoomParameters( x, y ) {

		if ( ! this.zoomToCursor ) return;
		this._performCursorZoom = true;
		const rect = this.domElement.getBoundingClientRect();
		const dx = x - rect.left, dy = y - rect.top, w = rect.width, h = rect.height;
		this._mouse.x = ( dx / w ) * 2 - 1;
		this._mouse.y = - ( dy / h ) * 2 + 1;
		this._dollyDirection.set( this._mouse.x, this._mouse.y, 1 ).unproject( this.object ).sub( this.object.position ).normalize();

	}

	_clampDistance( dist ) {

		return Math.max( this.minDistance, Math.min( this.maxDistance, dist ) );

	}

	// event callbacks - update the object state

	_handleMouseDownRotate( event ) {

		this._rotateStart.set( event.clientX, event.clientY );

	}

	_handleMouseDownDolly( event ) {

		this._updateZoomParameters( event.clientX, event.clientX );
		this._dollyStart.set( event.clientX, event.clientY );

	}

	_handleMouseDownPan( event ) {

		this._panStart.set( event.clientX, event.clientY );

	}

	_handleMouseMoveRotate( event ) {

		this._rotateEnd.set( event.clientX, event.clientY );
		this._rotateDelta.subVectors( this._rotateEnd, this._rotateStart ).multiplyScalar( this.rotateSpeed );
		const element = this.domElement;
		this._rotateLeft( _twoPI * this._rotateDelta.x / element.clientHeight ); // yes, height
		this._rotateUp( _twoPI * this._rotateDelta.y / element.clientHeight );
		this._rotateStart.copy( this._rotateEnd );
		this.update();

	}

	_handleMouseMoveDolly( event ) {

		this._dollyEnd.set( event.clientX, event.clientY );
		this._dollyDelta.subVectors( this._dollyEnd, this._dollyStart );
		if ( this._dollyDelta.y > 0 ) this._dollyOut( this._getZoomScale( this._dollyDelta.y ) );
		else if ( this._dollyDelta.y < 0 ) this._dollyIn( this._getZoomScale( this._dollyDelta.y ) );
		this._dollyStart.copy( this._dollyEnd );
		this.update();

	}

	_handleMouseMovePan( event ) {

		this._panEnd.set( event.clientX, event.clientY );
		this._panDelta.subVectors( this._panEnd, this._panStart ).multiplyScalar( this.panSpeed );
		this._pan( this._panDelta.x, this._panDelta.y );
		this._panStart.copy( this._panEnd );
		this.update();

	}

	_handleMouseWheel( event ) {

		if ( this.enabled === false || this.enableZoom === false || this.state !== STATE.NONE ) return;
		event.preventDefault();
		this.dispatchEvent( _startEvent );
		this._handleWheelZoom( this._customWheelEvent( event ) );
		this.dispatchEvent( _endEvent );

	}

	_handleWheelZoom( event ) {

		this._updateZoomParameters( event.clientX, event.clientY );
		if ( event.deltaY < 0 ) this._dollyIn( this._getZoomScale( event.deltaY ) );
		else if ( event.deltaY > 0 ) this._dollyOut( this._getZoomScale( event.deltaY ) );
		this.update();

	}

	_handleKeyDown( event ) {

		if ( this.enabled === false ) return;
		let needsUpdate = false;
		const element = this.domElement;

		switch ( event.code ) {

			case this.keys.UP:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enableRotate ) this._rotateUp( _twoPI * this.keyRotateSpeed / element.clientHeight );

				} else if ( this.enablePan ) {

					this._pan( 0, this.keyPanSpeed );

				}

				needsUpdate = true;
				break;

			case this.keys.BOTTOM:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enableRotate ) this._rotateUp( - _twoPI * this.keyRotateSpeed / element.clientHeight );

				} else if ( this.enablePan ) {

					this._pan( 0, - this.keyPanSpeed );

				}

				needsUpdate = true;
				break;

			case this.keys.LEFT:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enableRotate ) this._rotateLeft( _twoPI * this.keyRotateSpeed / element.clientHeight );

				} else if ( this.enablePan ) {

					this._pan( this.keyPanSpeed, 0 );

				}

				needsUpdate = true;
				break;

			case this.keys.RIGHT:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enableRotate ) this._rotateLeft( - _twoPI * this.keyRotateSpeed / element.clientHeight );

				} else if ( this.enablePan ) {

					this._pan( - this.keyPanSpeed, 0 );

				}

				needsUpdate = true;
				break;

		}

		if ( needsUpdate ) {

			// prevent the browser from scrolling on cursor keys
			event.preventDefault();
			this.update();

		}

	}

	_handleTouchStartRotate( event ) {

		if ( this._pointers.length === 1 ) {

			this._rotateStart.set( event.pageX, event.pageY );

		} else {

			const position = this._getSecondPointerPosition( event );
			this._rotateStart.set( 0.5 * ( event.pageX + position.x ), 0.5 * ( event.pageY + position.y ) );

		}

	}

	_handleTouchStartPan( event ) {

		if ( this._pointers.length === 1 ) {

			this._panStart.set( event.pageX, event.pageY );

		} else {

			const position = this._getSecondPointerPosition( event );
			this._panStart.set( 0.5 * ( event.pageX + position.x ), 0.5 * ( event.pageY + position.y ) );

		}

	}

	_handleTouchStartDolly( event ) {

		const position = this._getSecondPointerPosition( event );
		const dx = event.pageX - position.x, dy = event.pageY - position.y;
		this._dollyStart.set( 0, Math.sqrt( dx * dx + dy * dy ) );

	}

	_handleTouchStartDollyPan( event ) {

		if ( this.enableZoom ) this._handleTouchStartDolly( event );
		if ( this.enablePan ) this._handleTouchStartPan( event );

	}

	_handleTouchStartDollyRotate( event ) {

		if ( this.enableZoom ) this._handleTouchStartDolly( event );
		if ( this.enableRotate ) this._handleTouchStartRotate( event );

	}

	_handleTouchMoveRotate( event ) {

		if ( this._pointers.length == 1 ) {

			this._rotateEnd.set( event.pageX, event.pageY );

		} else {

			const position = this._getSecondPointerPosition( event );
			this._rotateEnd.set( 0.5 * ( event.pageX + position.x ), 0.5 * ( event.pageY + position.y ) );

		}

		this._rotateDelta.subVectors( this._rotateEnd, this._rotateStart ).multiplyScalar( this.rotateSpeed );
		const element = this.domElement;
		this._rotateLeft( _twoPI * this._rotateDelta.x / element.clientHeight ); // yes, height
		this._rotateUp( _twoPI * this._rotateDelta.y / element.clientHeight );
		this._rotateStart.copy( this._rotateEnd );

	}

	_handleTouchMovePan( event ) {

		if ( this._pointers.length === 1 ) {

			this._panEnd.set( event.pageX, event.pageY );

		} else {

			const position = this._getSecondPointerPosition( event );
			this._panEnd.set( 0.5 * ( event.pageX + position.x ), 0.5 * ( event.pageY + position.y ) );

		}

		this._panDelta.subVectors( this._panEnd, this._panStart ).multiplyScalar( this.panSpeed );
		this._pan( this._panDelta.x, this._panDelta.y );
		this._panStart.copy( this._panEnd );

	}

	_handleTouchMoveDolly( event ) {

		const position = this._getSecondPointerPosition( event );
		const dx = event.pageX - position.x, dy = event.pageY - position.y;
		const distance = Math.sqrt( dx * dx + dy * dy );
		this._dollyEnd.set( 0, distance );
		this._dollyDelta.set( 0, Math.pow( this._dollyEnd.y / this._dollyStart.y, this.zoomSpeed ) );
		this._dollyOut( this._dollyDelta.y );
		this._dollyStart.copy( this._dollyEnd );
		const centerX = ( event.pageX + position.x ) * 0.5, centerY = ( event.pageY + position.y ) * 0.5;
		this._updateZoomParameters( centerX, centerY );

	}

	_handleTouchMoveDollyPan( event ) {

		if ( this.enableZoom ) this._handleTouchMoveDolly( event );
		if ( this.enablePan ) this._handleTouchMovePan( event );

	}

	_handleTouchMoveDollyRotate( event ) {

		if ( this.enableZoom ) this._handleTouchMoveDolly( event );
		if ( this.enableRotate ) this._handleTouchMoveRotate( event );

	}

	// pointers

	_addPointer( event ) {

		this._pointers.push( event.pointerId );

	}

	_removePointer( event ) {

		delete this._pointerPositions[ event.pointerId ];
		const index = this._pointers.indexOf( event.pointerId );
		if ( index !== - 1 ) this._pointers.splice( index, 1 );

	}

	_isTrackingPointer( event ) {

		return this._pointers.includes( event.pointerId );

	}

	_trackPointer( event ) {

		let position = this._pointerPositions[ event.pointerId ];

		if ( position === undefined ) {

			position = new Vector2();
			this._pointerPositions[ event.pointerId ] = position;

		}

		position.set( event.pageX, event.pageY );

	}

	_getSecondPointerPosition( event ) {

		const pointerId = ( event.pointerId === this._pointers[ 0 ] ) ? this._pointers[ 1 ] : this._pointers[ 0 ];
		return this._pointerPositions[ pointerId ];

	}

	_customWheelEvent( event ) {

		const mode = event.deltaMode;
		// minimal wheel event altered to meet delta-zoom demand
		const newEvent = { clientX: event.clientX, clientY: event.clientY, deltaY: event.deltaY };

		switch ( mode ) {

			case 1: // LINE_MODE
				newEvent.deltaY *= 16;
				break;

			case 2: // PAGE_MODE
				newEvent.deltaY *= 100;
				break;

		}

		// detect if event was triggered by pinching
		if ( event.ctrlKey && ! this._controlActive ) newEvent.deltaY *= 10;
		return newEvent;

	}

	_handlePointerDown( event ) {

		if ( this.enabled === false ) return;

		if ( this._pointers.length === 0 ) {

			this.domElement.setPointerCapture( event.pointerId );
			this.domElement.ownerDocument.addEventListener( 'pointermove', this._onPointerMove );
			this.domElement.ownerDocument.addEventListener( 'pointerup', this._onPointerUp );

		}

		if ( this._isTrackingPointer( event ) ) return;
		this._addPointer( event );
		if ( event.pointerType === 'touch' ) this._onTouchStart( event );
		else this._onMouseDown( event );

	}

	_handlePointerMove( event ) {

		if ( this.enabled === false ) return;
		if ( event.pointerType === 'touch' ) this._onTouchMove( event );
		else this._onMouseMove( event );

	}

	_handlePointerUp( event ) {

		this._removePointer( event );

		switch ( this._pointers.length ) {

			case 0:
				this.domElement.releasePointerCapture( event.pointerId );
				this.domElement.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
				this.domElement.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );
				this.dispatchEvent( _endEvent );
				this.state = STATE.NONE;
				break;

			case 1: {

				const pointerId = this._pointers[ 0 ];
				const position = this._pointerPositions[ pointerId ];
				// minimal placeholder event - allows state correction on pointer-up
				this._onTouchStart( { pointerId, pageX: position.x, pageY: position.y } );
				break;

			}

		}

	}

	_handleMouseDown( event ) {

		let mouseAction;

		switch ( event.button ) {

			case 0: mouseAction = this.mouseButtons.LEFT; break;
			case 1: mouseAction = this.mouseButtons.MIDDLE; break;
			case 2: mouseAction = this.mouseButtons.RIGHT; break;
			default: mouseAction = - 1;

		}

		switch ( mouseAction ) {

			case MOUSE.DOLLY:
				if ( this.enableZoom === false ) return;
				this._handleMouseDownDolly( event );
				this.state = STATE.DOLLY;
				break;

			case MOUSE.ROTATE:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enablePan === false ) return;
					this._handleMouseDownPan( event );
					this.state = STATE.PAN;

				} else {

					if ( this.enableRotate === false ) return;
					this._handleMouseDownRotate( event );
					this.state = STATE.ROTATE;

				}

				break;

			case MOUSE.PAN:
				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( this.enableRotate === false ) return;
					this._handleMouseDownRotate( event );
					this.state = STATE.ROTATE;

				} else {

					if ( this.enablePan === false ) return;
					this._handleMouseDownPan( event );
					this.state = STATE.PAN;

				}

				break;

			default:
				this.state = STATE.NONE;

		}

		if ( this.state !== STATE.NONE ) this.dispatchEvent( _startEvent );

	}

	_handleMouseMove( event ) {

		switch ( this.state ) {

			case STATE.ROTATE:
				if ( this.enableRotate === false ) return;
				this._handleMouseMoveRotate( event );
				break;

			case STATE.DOLLY:
				if ( this.enableZoom === false ) return;
				this._handleMouseMoveDolly( event );
				break;

			case STATE.PAN:
				if ( this.enablePan === false ) return;
				this._handleMouseMovePan( event );
				break;

		}

	}

	_handleTouchStart( event ) {

		this._trackPointer( event );

		switch ( this._pointers.length ) {

			case 1:
				switch ( this.touches.ONE ) {

					case TOUCH.ROTATE:
						if ( this.enableRotate === false ) return;
						this._handleTouchStartRotate( event );
						this.state = STATE.TOUCH_ROTATE;
						break;

					case TOUCH.PAN:
						if ( this.enablePan === false ) return;
						this._handleTouchStartPan( event );
						this.state = STATE.TOUCH_PAN;
						break;

					default:
						this.state = STATE.NONE;

				}

				break;

			case 2:
				switch ( this.touches.TWO ) {

					case TOUCH.DOLLY_PAN:
						if ( this.enableZoom === false && this.enablePan === false ) return;
						this._handleTouchStartDollyPan( event );
						this.state = STATE.TOUCH_DOLLY_PAN;
						break;

					case TOUCH.DOLLY_ROTATE:
						if ( this.enableZoom === false && this.enableRotate === false ) return;
						this._handleTouchStartDollyRotate( event );
						this.state = STATE.TOUCH_DOLLY_ROTATE;
						break;

					default:
						this.state = STATE.NONE;

				}

				break;

			default:
				this.state = STATE.NONE;

		}

		if ( this.state !== STATE.NONE ) this.dispatchEvent( _startEvent );

	}

	_handleTouchMove( event ) {

		this._trackPointer( event );

		switch ( this.state ) {

			case STATE.TOUCH_ROTATE:
				if ( this.enableRotate === false ) return;
				this._handleTouchMoveRotate( event );
				this.update();
				break;

			case STATE.TOUCH_PAN:
				if ( this.enablePan === false ) return;
				this._handleTouchMovePan( event );
				this.update();
				break;

			case STATE.TOUCH_DOLLY_PAN:
				if ( this.enableZoom === false && this.enablePan === false ) return;
				this._handleTouchMoveDollyPan( event );
				this.update();
				break;

			case STATE.TOUCH_DOLLY_ROTATE:
				if ( this.enableZoom === false && this.enableRotate === false ) return;
				this._handleTouchMoveDollyRotate( event );
				this.update();
				break;

			default:
				this.state = STATE.NONE;

		}

	}

	_handleControlDown( event ) {

		if ( event.key === 'Control' ) {

			this._controlActive = true;
			const document = this.domElement.getRootNode();
			document.addEventListener( 'keyup', this._interceptControlUp, { passive: true, capture: true } );

		}

	}

	_handleControlUp( event ) {

		if ( event.key === 'Control' ) {

			this._controlActive = false;
			const document = this.domElement.getRootNode();
			document.removeEventListener( 'keyup', this._interceptControlUp, { passive: true, capture: true } );

		}

	}

}

/** OrbitControls set up for maps: left drag pans, right drag rotates, panning in the ground plane. */
export class MapControls extends OrbitControls {

	constructor( object, domElement ) {

		super( object, domElement );
		this.screenSpacePanning = false;
		this.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
		this.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };

	}

}
