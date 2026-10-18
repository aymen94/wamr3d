// three.js add-on path: `three/addons/controls/ArcballControls.js`.
//
// Arcball navigation around a centre: dragging rotates the scene as if grabbing a ball
// (inside the ball's silhouette the rotation follows the sphere, outside a hyperbolic
// sheet, so rolling about the view axis is possible), panning moves the centre with the
// camera, the wheel zooms (towards the cursor with `cursorZoom`) and shift + wheel changes
// the field of view while keeping the centre's framing. With `enableAnimations` rotations
// keep spinning and slow down by `dampingFactor`; a double click focuses the point under
// the cursor when `scene` is given. With a scene, `enableGizmos` shows the ball as three
// circles and `enableGrid` a grid while panning. Actions are bound with
// `setMouseAction( operation, mouse, key )`: operations 'ROTATE', 'PAN', 'ZOOM' and 'FOV',
// mouse 0, 1, 2 or 'WHEEL', key 'SHIFT', 'CTRL' or null.

import { BufferGeometry, Controls, EllipseCurve, Float32BufferAttribute, GridHelper, Group, LineBasicMaterial, LineLoop, MathUtils, Matrix4, Quaternion, Raycaster, Vector2, Vector3 } from '../../compat.js';

const _changeEvent = { type: 'change' }, _startEvent = { type: 'start' }, _endEvent = { type: 'end' };
const _v1 = new Vector3(), _v2 = new Vector3(), _axis = new Vector3(), _q = new Quaternion();

export class ArcballControls extends Controls {

	constructor( camera, domElement = null, scene = null ) {

		super( camera, domElement );
		this.camera = null;
		this.scene = scene;
		this.target = new Vector3();
		this.mouseActions = [];
		this.adjustNearFar = false;
		this.scaleFactor = 1.1;
		this.dampingFactor = 25;
		this.wMax = 20;
		this.enableAnimations = true;
		this.enableGrid = false;
		this.cursorZoom = false;
		this.minFov = 5;
		this.maxFov = 90;
		this.rotateSpeed = 1;
		this.enablePan = true;
		this.enableRotate = true;
		this.enableZoom = true;
		this.enableGizmos = true;
		this.enableFocus = true;
		this.focusAnimationTime = 500;
		this.minDistance = 0;
		this.maxDistance = Infinity;
		this.minZoom = 0;
		this.maxZoom = Infinity;
		this.radiusFactor = 0.67;
		this._tbRadius = 1;
		this._raycaster = new Raycaster();
		this._gizmos = new Group();
		this._grid = null;
		this._state = null;
		this._pointers = new Map();
		this._start = new Vector3();
		this._startPan = new Vector3();
		this._startScale = 0;
		this._lastMove = { time: 0, angle: 0, axis: new Vector3() };
		this._spin = null;
		this._focus = null;
		this._frame = 0;
		this._saved = null;

		for ( const [ operation, mouse, key ] of [ [ 'PAN', 0, 'CTRL' ], [ 'PAN', 2, null ], [ 'ROTATE', 0, null ], [ 'ZOOM', 'WHEEL', null ], [ 'ZOOM', 1, null ], [ 'FOV', 'WHEEL', 'SHIFT' ], [ 'FOV', 1, 'SHIFT' ] ] ) this.setMouseAction( operation, mouse, key );

		this._onPointerDown = this._pointerDown.bind( this );
		this._onPointerMove = this._pointerMove.bind( this );
		this._onPointerUp = this._pointerUp.bind( this );
		this._onWheel = this._wheel.bind( this );
		this._onDoubleClick = this._doubleClick.bind( this );
		this._onContextMenu = ( event ) => {

			if ( this.enabled && this.mouseActions.some( ( a ) => a.mouse === 2 ) ) event.preventDefault();

		};

		this.setCamera( camera );
		if ( this.scene ) this.scene.add( this._gizmos );
		if ( domElement !== null ) this.connect( domElement );

	}

	connect( element ) {

		super.connect( element );
		element.addEventListener( 'pointerdown', this._onPointerDown );
		element.addEventListener( 'pointercancel', this._onPointerUp );
		element.addEventListener( 'wheel', this._onWheel, { passive: false } );
		element.addEventListener( 'dblclick', this._onDoubleClick );
		element.addEventListener( 'contextmenu', this._onContextMenu );
		element.style.touchAction = 'none';

	}

	disconnect() {

		const element = this.domElement;
		if ( element === null ) return;
		element.removeEventListener( 'pointerdown', this._onPointerDown );
		element.removeEventListener( 'pointercancel', this._onPointerUp );
		element.removeEventListener( 'wheel', this._onWheel );
		element.removeEventListener( 'dblclick', this._onDoubleClick );
		element.removeEventListener( 'contextmenu', this._onContextMenu );
		element.ownerDocument.removeEventListener( 'pointermove', this._onPointerMove );
		element.ownerDocument.removeEventListener( 'pointerup', this._onPointerUp );
		element.style.touchAction = 'auto';

	}

	dispose() {

		this.disconnect();
		cancelAnimationFrame( this._frame );
		this._gizmos.removeFromParent();
		this._grid?.removeFromParent();

	}

	// ---------------------------------------------------------------- public API

	setCamera( camera ) {

		this.camera = this.object = camera;
		camera.lookAt( this.target );
		this._updateRadius();
		this.saveState();

	}

	setTbRadius( value ) {

		this.radiusFactor = value;
		this._updateRadius();
		this.dispatchEvent( _changeEvent );

	}

	setMouseAction( operation, mouse, key = null ) {

		if ( ! [ 'PAN', 'ROTATE', 'ZOOM', 'FOV' ].includes( operation ) || ! [ 0, 1, 2, 'WHEEL' ].includes( mouse ) || ! [ 'SHIFT', 'CTRL', null ].includes( key ) ) return false;
		if ( mouse === 'WHEEL' && operation !== 'ZOOM' && operation !== 'FOV' ) return false;
		this.unsetMouseAction( mouse, key );
		this.mouseActions.push( { operation, mouse, key } );
		return true;

	}

	unsetMouseAction( mouse, key = null ) {

		const before = this.mouseActions.length;
		this.mouseActions = this.mouseActions.filter( ( a ) => a.mouse !== mouse || a.key !== key );
		return this.mouseActions.length !== before;

	}

	getRaycaster() {

		return this._raycaster;

	}

	setGizmosVisible( value ) {

		this.enableGizmos = value;
		this._gizmos.visible = value;
		this.dispatchEvent( _changeEvent );

	}

	activateGizmos( isActive ) {

		for ( const circle of this._gizmos.children ) {

			circle.material.opacity = isActive ? 1 : 0.6;
			circle.material.needsUpdate = true;

		}

	}

	saveState() {

		const camera = this.camera;
		this._saved = { matrix: camera.matrix.clone(), target: this.target.clone(), zoom: camera.zoom, fov: camera.fov, near: camera.near, far: camera.far, up: camera.up.clone() };

	}

	reset() {

		const s = this._saved, camera = this.camera;
		if ( ! s ) return;
		this._stop();
		s.matrix.decompose( camera.position, camera.quaternion, camera.scale );
		camera.up.copy( s.up );
		this.target.copy( s.target );
		camera.zoom = s.zoom;
		camera.near = s.near;
		camera.far = s.far;
		if ( camera.isPerspectiveCamera ) camera.fov = s.fov;
		camera.updateProjectionMatrix();
		this._updateRadius();
		this.dispatchEvent( _changeEvent );

	}

	/** The state as JSON on the clipboard. */
	copyState() {

		const camera = this.camera;
		const state = { arcballState: { cameraMatrix: camera.matrix.toArray(), cameraUp: camera.up.toArray(), cameraNear: camera.near, cameraFar: camera.far, cameraZoom: camera.zoom, cameraFov: camera.fov, gizmoMatrix: new Matrix4().makeTranslation( this.target.x, this.target.y, this.target.z ).toArray() } };
		return navigator.clipboard?.writeText( JSON.stringify( state ) );

	}

	/** Reads a state written by `copyState` from the clipboard. */
	async pasteState() {

		const text = await navigator.clipboard?.readText();
		if ( ! text ) return;
		const state = JSON.parse( text ).arcballState, camera = this.camera;
		new Matrix4().fromArray( state.cameraMatrix ).decompose( camera.position, camera.quaternion, camera.scale );
		camera.up.fromArray( state.cameraUp );
		Object.assign( camera, { near: state.cameraNear, far: state.cameraFar, zoom: state.cameraZoom } );
		if ( camera.isPerspectiveCamera ) camera.fov = state.cameraFov;
		camera.updateProjectionMatrix();
		this.target.setFromMatrixPosition( new Matrix4().fromArray( state.gizmoMatrix ) );
		this._updateRadius();
		this.dispatchEvent( _changeEvent );

	}

	update() {

		this._updateRadius();

	}

	// ---------------------------------------------------------------- geometry of the ball

	_updateRadius() {

		const camera = this.camera, distance = camera.position.distanceTo( this.target );

		if ( camera.isOrthographicCamera ) {

			this._tbRadius = Math.min( camera.top, camera.right ) / camera.zoom * this.radiusFactor;

		} else {

			const halfV = MathUtils.degToRad( camera.fov * 0.5 ), halfH = Math.atan( camera.aspect * Math.tan( halfV ) );
			this._tbRadius = Math.tan( Math.min( halfV, halfH ) ) * distance * this.radiusFactor;

		}

		this._updateGizmos();

	}

	_updateGizmos() {

		const gizmos = this._gizmos;

		if ( gizmos.children.length === 0 ) {

			const points = new EllipseCurve( 0, 0, 1, 1 ).getPoints( 64 ).flatMap( ( p ) => [ p.x, p.y, 0 ] );

			for ( const [ color, rotate ] of [ [ 0x00ff00, ( o ) => o.rotation.set( Math.PI / 2, 0, 0 ) ], [ 0xff0000, ( o ) => o.rotation.set( 0, Math.PI / 2, 0 ) ], [ 0x0000ff, () => {} ] ] ) {

				const geometry = new BufferGeometry();
				geometry.setAttribute( 'position', new Float32BufferAttribute( points.slice( 0, - 3 ), 3 ) );
				const circle = new LineLoop( geometry, new LineBasicMaterial( { color, transparent: true, opacity: 0.6, depthTest: false } ) );
				rotate( circle );
				circle.renderOrder = Infinity;
				gizmos.add( circle );

			}

		}

		gizmos.position.copy( this.target );
		gizmos.scale.setScalar( this._tbRadius );
		gizmos.visible = this.enableGizmos && this.scene !== null;

	}

	// The pointer in normalized device coordinates.
	_ndc( event, target = new Vector2() ) {

		const rect = this.domElement.getBoundingClientRect();
		return target.set( ( event.clientX - rect.left ) / rect.width * 2 - 1, - ( event.clientY - rect.top ) / rect.height * 2 + 1 );

	}

	// The pointer on the plane through the centre facing the camera, in world space.
	_onPlane( ndc, target = new Vector3() ) {

		this._raycaster.setFromCamera( ndc, this.camera );
		const ray = this._raycaster.ray, normal = this.camera.getWorldDirection( _v2 );
		const denominator = normal.dot( ray.direction );
		const t = Math.abs( denominator ) < 1e-9 ? 0 : _v1.copy( this.target ).sub( ray.origin ).dot( normal ) / denominator;
		return target.copy( ray.origin ).addScaledVector( ray.direction, t );

	}

	// The pointer on the ball (or its hyperbolic sheet), relative to the centre, in world space.
	_onBall( ndc, target = new Vector3() ) {

		const point = this._onPlane( ndc, target ).sub( this.target );
		const r2 = this._tbRadius * this._tbRadius, d2 = point.lengthSq();
		const height = d2 <= r2 / 2 ? Math.sqrt( r2 - d2 ) : r2 / 2 / Math.sqrt( d2 );
		return point.addScaledVector( this.camera.getWorldDirection( _v2 ), - height );

	}

	// ---------------------------------------------------------------- motions

	_rotate( axis, angle ) {

		_q.setFromAxisAngle( axis, - angle );
		const camera = this.camera;
		camera.position.sub( this.target ).applyQuaternion( _q ).add( this.target );
		camera.quaternion.premultiply( _q );
		camera.up.applyQuaternion( _q );

	}

	_pan( delta ) {

		this.camera.position.add( delta );
		this.target.add( delta );
		this._updateGizmos();

	}

	// Scales the distance to `center` (the centre, or the point under the cursor).
	_scale( factor, center = this.target ) {

		const camera = this.camera;

		if ( camera.isOrthographicCamera ) {

			const zoom = MathUtils.clamp( camera.zoom / factor, this.minZoom, this.maxZoom );
			const applied = camera.zoom / zoom;
			camera.zoom = zoom;
			camera.updateProjectionMatrix();

			if ( center !== this.target ) {

				// keep the cursor's point where it is on screen
				_v1.copy( this.target ).sub( center ).multiplyScalar( applied - 1 );
				this._pan( _v1 );

			}

		} else {

			const distance = camera.position.distanceTo( this.target );
			const next = MathUtils.clamp( distance * factor, this.minDistance, this.maxDistance );
			const applied = next / distance;
			_v1.copy( camera.position ).sub( center ).multiplyScalar( applied ).add( center );
			const shift = _v2.copy( _v1 ).sub( camera.position );
			camera.position.copy( _v1 );
			if ( center !== this.target ) this.target.add( shift.projectOnPlane( camera.getWorldDirection( new Vector3() ) ) );

			if ( this.adjustNearFar ) {

				camera.near *= applied;
				camera.far *= applied;
				camera.updateProjectionMatrix();

			}

		}

		this._updateRadius();

	}

	_fov( factor ) {

		const camera = this.camera;
		if ( ! camera.isPerspectiveCamera ) return this._scale( factor );
		const before = MathUtils.degToRad( camera.fov * 0.5 );
		const fov = MathUtils.clamp( camera.fov * factor, this.minFov, this.maxFov );
		const after = MathUtils.degToRad( fov * 0.5 );
		// keep the centre's plane framed the same
		const distance = camera.position.distanceTo( this.target ), next = distance * Math.tan( before ) / Math.tan( after );
		camera.getWorldDirection( _v1 );
		camera.position.copy( this.target ).addScaledVector( _v1, - next );
		camera.fov = fov;
		camera.updateProjectionMatrix();
		this._updateRadius();

	}

	_stop() {

		cancelAnimationFrame( this._frame );
		this._spin = this._focus = null;

	}

	// Spinning after release, and focus animations.
	_animate( time ) {

		let active = false;

		if ( this._spin ) {

			const s = this._spin, dt = ( time - s.time ) / 1000;
			s.time = time;
			// the angular speed falls by `dampingFactor` radians per second each second
			s.speed = Math.max( 0, s.speed - this.dampingFactor * dt );

			if ( s.speed > 0 ) {

				this._rotate( s.axis, s.speed * dt );
				active = true;

			} else this._spin = null;

		}

		if ( this._focus ) {

			const f = this._focus, t = Math.min( 1, ( time - f.start ) / this.focusAnimationTime ), ease = t * t * ( 3 - 2 * t );
			_v1.lerpVectors( f.from, f.to, ease ).sub( this.target );
			this._pan( _v1 );
			if ( t < 1 ) active = true;
			else this._focus = null;

		}

		this._updateGizmos();
		this.dispatchEvent( _changeEvent );
		if ( active ) this._frame = requestAnimationFrame( ( t ) => this._animate( t ) );
		else this.dispatchEvent( _endEvent );

	}

	// ---------------------------------------------------------------- events

	_action( mouse, event ) {

		const key = event.ctrlKey || event.metaKey ? 'CTRL' : event.shiftKey ? 'SHIFT' : null;
		return this.mouseActions.find( ( a ) => a.mouse === mouse && a.key === key )?.operation ?? null;

	}

	_pointerDown( event ) {

		if ( ! this.enabled ) return;
		this._stop();
		this._pointers.set( event.pointerId, this._ndc( event ) );

		if ( this._pointers.size === 1 ) {

			const document = this.domElement.ownerDocument;
			document.addEventListener( 'pointermove', this._onPointerMove );
			document.addEventListener( 'pointerup', this._onPointerUp );
			this.domElement.setPointerCapture?.( event.pointerId );

		}

		const ndc = this._pointers.get( event.pointerId );
		const operation = this._pointers.size > 1 ? 'TOUCH' : event.pointerType === 'mouse' ? this._action( event.button, event ) : 'ROTATE';
		this._state = operation;

		if ( operation === 'ROTATE' && this.enableRotate ) {

			this._onBall( ndc, this._start );
			this._lastMove.time = performance.now();
			this._lastMove.angle = 0;
			this.activateGizmos( true );

		} else if ( operation === 'PAN' && this.enablePan ) {

			this._onPlane( ndc, this._startPan );
			this._showGrid( true );

		} else if ( operation === 'ZOOM' || operation === 'FOV' ) {

			this._startScale = ndc.y;

		} else if ( operation === 'TOUCH' ) {

			const [ a, b ] = [ ...this._pointers.values() ];
			this._startScale = a.distanceTo( b );
			this._onPlane( new Vector2().addVectors( a, b ).multiplyScalar( 0.5 ), this._startPan );

		}

		this.dispatchEvent( _startEvent );

	}

	_pointerMove( event ) {

		if ( ! this.enabled || ! this._pointers.has( event.pointerId ) ) return;
		const ndc = this._ndc( event, this._pointers.get( event.pointerId ) );
		const state = this._state;

		if ( state === 'ROTATE' && this.enableRotate ) {

			const current = this._onBall( ndc, new Vector3() );
			const angle = this._start.angleTo( current ) * this.rotateSpeed;

			if ( angle > 0 ) {

				_axis.crossVectors( this._start, current ).normalize();
				this._rotate( _axis, angle );
				// the ball turned with the camera: the next increment starts from the new point
				this._start.copy( this._onBall( ndc, current ) );
				const now = performance.now();
				this._lastMove = { time: now, angle: angle / Math.max( ( now - this._lastMove.time ) / 1000, 1e-3 ), axis: _axis.clone() };

			}

		} else if ( state === 'PAN' && this.enablePan ) {

			const current = this._onPlane( ndc, new Vector3() );
			this._pan( _v1.copy( this._startPan ).sub( current ) );

		} else if ( ( state === 'ZOOM' || state === 'FOV' ) && this.enableZoom ) {

			const factor = Math.pow( this.scaleFactor, ( ndc.y - this._startScale ) * 4 );
			this._startScale = ndc.y;
			if ( state === 'FOV' ) this._fov( 1 / factor );
			else this._scale( 1 / factor );

		} else if ( state === 'TOUCH' && this._pointers.size >= 2 ) {

			const [ a, b ] = [ ...this._pointers.values() ];
			const distance = a.distanceTo( b );
			if ( this.enableZoom && distance > 0 ) this._scale( this._startScale / distance );
			this._startScale = distance;

			if ( this.enablePan ) {

				const current = this._onPlane( new Vector2().addVectors( a, b ).multiplyScalar( 0.5 ), new Vector3() );
				this._pan( _v1.copy( this._startPan ).sub( current ) );

			}

		}

		this.dispatchEvent( _changeEvent );

	}

	_pointerUp( event ) {

		this._pointers.delete( event.pointerId );
		this.domElement.releasePointerCapture?.( event.pointerId );
		if ( this._pointers.size > 0 ) return;
		const document = this.domElement.ownerDocument;
		document.removeEventListener( 'pointermove', this._onPointerMove );
		document.removeEventListener( 'pointerup', this._onPointerUp );
		this.activateGizmos( false );
		this._showGrid( false );

		// a rotation released while moving keeps spinning
		const move = this._lastMove;

		if ( this._state === 'ROTATE' && this.enableAnimations && performance.now() - move.time < 50 && move.angle > 0 ) {

			const speed = Math.min( move.angle, this.wMax );
			this._spin = { axis: move.axis, speed, time: performance.now() };
			this._frame = requestAnimationFrame( ( t ) => this._animate( t ) );

		} else {

			this.dispatchEvent( _endEvent );

		}

		this._state = null;

	}

	_wheel( event ) {

		if ( ! this.enabled || ! this.enableZoom ) return;
		const operation = this._action( 'WHEEL', event );
		if ( operation === null ) return;
		event.preventDefault();
		this._stop();
		this.dispatchEvent( _startEvent );
		const factor = event.deltaY > 0 ? this.scaleFactor : 1 / this.scaleFactor;

		if ( operation === 'FOV' ) this._fov( factor );
		else if ( this.cursorZoom && this.enablePan ) this._scale( factor, this._onPlane( this._ndc( event ), new Vector3() ) );
		else this._scale( factor );

		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _endEvent );

	}

	_doubleClick( event ) {

		if ( ! this.enabled || ! this.enableFocus || this.scene === null ) return;
		this._raycaster.setFromCamera( this._ndc( event ), this.camera );
		const hit = this._raycaster.intersectObjects( this.scene.children, true ).find( ( h ) => ! this._gizmos.children.includes( h.object ) && h.object !== this._grid );
		if ( ! hit ) return;
		this._stop();
		this.dispatchEvent( _startEvent );
		this._focus = { from: this.target.clone(), to: hit.point.clone(), start: performance.now() };
		this._frame = requestAnimationFrame( ( t ) => this._animate( t ) );

	}

	_showGrid( visible ) {

		if ( ! this.enableGrid || this.scene === null ) return;

		if ( visible ) {

			const size = this._tbRadius * 4;
			this._grid ??= new GridHelper( 1, 10, 0x888888, 0x888888 );
			this._grid.scale.setScalar( size );
			this._grid.position.copy( this.target );
			// the grid lies in the plane facing the camera
			this._grid.quaternion.copy( this.camera.quaternion );
			this._grid.rotateX( Math.PI / 2 );
			this.scene.add( this._grid );

		} else {

			this._grid?.removeFromParent();

		}

	}

}
