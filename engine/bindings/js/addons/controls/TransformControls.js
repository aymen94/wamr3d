// three.js add-on path: `three/addons/controls/TransformControls.js`.
//
// Moves, turns and scales an object with a gizmo, written to three.js's documented API:
// `attach( object )`, `getHelper()` (the gizmo to add to the scene), `mode` (translate,
// rotate, scale), `space` (world, local), `axis`, snapping, `size`, translation limits,
// and the events `change`, `mouseDown`, `mouseUp`, `objectChange`, `dragging-changed`
// and `axis-changed`. Handles are picked with a raycaster on invisible, larger meshes;
// a drag follows the pointer on a plane through the object chosen for the axis.

import {
	BoxGeometry, BufferGeometry, Controls, CylinderGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial,
	Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Plane, PlaneGeometry, Quaternion, Raycaster, SphereGeometry,
	TorusGeometry, Vector2, Vector3
} from '../../compat.js';

const _changeEvent = { type: 'change' }, _mouseDownEvent = { type: 'mouseDown', mode: null }, _mouseUpEvent = { type: 'mouseUp', mode: null }, _objectChangeEvent = { type: 'objectChange' };
const AXES = { X: new Vector3( 1, 0, 0 ), Y: new Vector3( 0, 1, 0 ), Z: new Vector3( 0, 0, 1 ) };
const COLORS = { X: 0xff3352, Y: 0x8adb00, Z: 0x2c8fff, E: 0xffff00, XYZ: 0xffffff, active: 0xffff00 };

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _q1 = new Quaternion(), _pointer = new Vector2();

// ---------------------------------------------------------------- gizmo parts

const handleMaterial = ( color, opacity = 1 ) => new MeshBasicMaterial( { color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: 2 } );
const lineMaterial = ( color ) => new LineBasicMaterial( { color, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false } );
const pickerMaterial = () => new MeshBasicMaterial( { transparent: true, opacity: 0.15, depthTest: false, depthWrite: false, side: 2 } );

function circle( radius, axis, arc = Math.PI * 2, segments = 64 ) {

	const points = [];

	for ( let i = 0; i <= segments; i ++ ) {

		const a = i / segments * arc, c = Math.cos( a ) * radius, s = Math.sin( a ) * radius;
		points.push( ...( axis === 'X' ? [ 0, c, s ] : axis === 'Y' ? [ c, 0, s ] : [ c, s, 0 ] ) );

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( points, 3 ) );
	return geometry;

}

// A shape standing along +Y turned to lie along `axis`.
function along( object, axis ) {

	if ( axis === 'X' ) object.rotation.set( 0, 0, - Math.PI / 2 );
	else if ( axis === 'Z' ) object.rotation.set( Math.PI / 2, 0, 0 );
	return object;

}

function handle( name, object, kind ) {

	object.name = name;
	object.userData.kind = kind;
	object.renderOrder = Infinity;
	return object;

}

function buildGizmo() {

	const gizmo = { translate: new Group(), rotate: new Group(), scale: new Group() };
	const pickers = { translate: new Group(), rotate: new Group(), scale: new Group() };
	const shaft = new CylinderGeometry( 0.0075, 0.0075, 0.5, 6 );
	shaft.translate( 0, 0.25, 0 );
	const arrow = new CylinderGeometry( 0, 0.04, 0.1, 12 );
	arrow.translate( 0, 0.55, 0 );
	const cube = new BoxGeometry( 0.08, 0.08, 0.08 );
	cube.translate( 0, 0.55, 0 );
	const pickShaft = new CylinderGeometry( 0.2, 0, 0.6, 4 );
	pickShaft.translate( 0, 0.3, 0 );

	for ( const axis of [ 'X', 'Y', 'Z' ] ) {

		const color = COLORS[ axis ];
		gizmo.translate.add( handle( axis, along( new Mesh( shaft, handleMaterial( color ) ), axis ), 'axis' ), handle( axis, along( new Mesh( arrow, handleMaterial( color ) ), axis ), 'axis' ) );
		gizmo.scale.add( handle( axis, along( new Mesh( shaft, handleMaterial( color ) ), axis ), 'axis' ), handle( axis, along( new Mesh( cube, handleMaterial( color ) ), axis ), 'axis' ) );
		gizmo.rotate.add( handle( axis, new Line( circle( 0.5, axis ), lineMaterial( color ) ), 'axis' ) );
		pickers.translate.add( handle( axis, along( new Mesh( pickShaft, pickerMaterial() ), axis ), 'axis' ) );
		pickers.scale.add( handle( axis, along( new Mesh( pickShaft, pickerMaterial() ), axis ), 'axis' ) );
		const ring = new Mesh( new TorusGeometry( 0.5, 0.1, 4, 24 ), pickerMaterial() );
		if ( axis === 'X' ) ring.rotation.set( 0, Math.PI / 2, 0 );
		else if ( axis === 'Y' ) ring.rotation.set( Math.PI / 2, 0, 0 );
		pickers.rotate.add( handle( axis, ring, 'axis' ) );

	}

	// planes between two axes, coloured as the third
	for ( const [ plane, normal, x, y, z ] of [ [ 'XY', 'Z', 0.15, 0.15, 0 ], [ 'YZ', 'X', 0, 0.15, 0.15 ], [ 'XZ', 'Y', 0.15, 0, 0.15 ] ] ) {

		const square = new Mesh( new PlaneGeometry( 0.1, 0.1 ), handleMaterial( COLORS[ normal ], 0.5 ) );
		square.position.set( x, y, z );
		if ( plane === 'YZ' ) square.rotation.set( 0, Math.PI / 2, 0 );
		else if ( plane === 'XZ' ) square.rotation.set( - Math.PI / 2, 0, 0 );
		gizmo.translate.add( handle( plane, square, 'plane' ) );
		const picker = new Mesh( new PlaneGeometry( 0.2, 0.2 ), pickerMaterial() );
		picker.position.copy( square.position );
		picker.rotation.copy( square.rotation );
		pickers.translate.add( handle( plane, picker, 'plane' ) );

	}

	gizmo.translate.add( handle( 'XYZ', new Mesh( new OctahedronGeometry( 0.1, 0 ), handleMaterial( COLORS.XYZ, 0.25 ) ), 'center' ) );
	pickers.translate.add( handle( 'XYZ', new Mesh( new OctahedronGeometry( 0.2, 0 ), pickerMaterial() ), 'center' ) );
	gizmo.scale.add( handle( 'XYZ', new Mesh( new BoxGeometry( 0.1, 0.1, 0.1 ), handleMaterial( COLORS.XYZ, 0.25 ) ), 'center' ) );
	pickers.scale.add( handle( 'XYZ', new Mesh( new BoxGeometry( 0.2, 0.2, 0.2 ), pickerMaterial() ), 'center' ) );
	// the outer ring turns about the view direction
	gizmo.rotate.add( handle( 'E', new Line( circle( 0.75, 'Z' ), lineMaterial( COLORS.E ) ), 'eye' ) );
	pickers.rotate.add( handle( 'E', new Mesh( new TorusGeometry( 0.75, 0.1, 2, 24 ), pickerMaterial() ), 'eye' ) );
	gizmo.rotate.add( handle( 'XYZE', new Mesh( new SphereGeometry( 0.25, 10, 8 ), handleMaterial( 0x787878, 0.1 ) ), 'free' ) );
	pickers.rotate.add( handle( 'XYZE', new Mesh( new SphereGeometry( 0.25, 10, 8 ), pickerMaterial() ), 'free' ) );
	for ( const group of Object.values( pickers ) ) group.visible = false;
	return { gizmo, pickers };

}

// The gizmo in the scene: it follows the attached object and keeps its size on screen.
class TransformControlsRoot extends Object3D {

	constructor( controls ) {

		super();
		this.isTransformControlsRoot = true;
		this.controls = controls;
		const { gizmo, pickers } = buildGizmo();
		this.gizmo = gizmo;
		this.pickers = pickers;
		for ( const mode of [ 'translate', 'rotate', 'scale' ] ) this.add( gizmo[ mode ], pickers[ mode ] );
		this.visible = false;

	}

	_onFrame() {

		this.controls.updateGizmo();

	}

	dispose() {

		this.traverse( ( child ) => {

			child.geometry?.dispose();
			child.material?.dispose();

		} );

	}

}

// ---------------------------------------------------------------- controls

export class TransformControls extends Controls {

	constructor( camera, domElement = null ) {

		super( undefined, domElement );
		this.camera = camera;
		this.object = undefined;
		this.mode = 'translate';
		this.space = 'world';
		this.size = 1;
		this.dragging = false;
		this.showX = this.showY = this.showZ = this.showE = true;
		this.translationSnap = null;
		this.rotationSnap = null;
		this.scaleSnap = null;
		this.minX = this.minY = this.minZ = - Infinity;
		this.maxX = this.maxY = this.maxZ = Infinity;
		this._axis = null;
		this._root = new TransformControlsRoot( this );
		this._raycaster = new Raycaster();
		this._plane = new Plane();
		this._pointStart = new Vector3();
		this._pointEnd = new Vector3();
		this._positionStart = new Vector3();
		this._quaternionStart = new Quaternion();
		this._scaleStart = new Vector3();
		this._worldPositionStart = new Vector3();
		this._worldQuaternionStart = new Quaternion();
		this._parentQuaternionInverse = new Quaternion();
		this._parentScale = new Vector3( 1, 1, 1 );
		this._onPointerDown = ( event ) => this._handlePointerDown( event );
		this._onPointerHover = ( event ) => this._handlePointerHover( event );
		this._onPointerMove = ( event ) => this._handlePointerMove( event );
		this._onPointerUp = ( event ) => this._handlePointerUp( event );
		if ( domElement !== null ) this.connect( domElement );

	}

	get axis() {

		return this._axis;

	}

	set axis( value ) {

		if ( value === this._axis ) return;
		this._axis = value;
		this.dispatchEvent( { type: 'axis-changed', value } );

	}

	connect( element ) {

		super.connect( element );
		if ( ! this.domElement ) return;
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointermove', this._onPointerHover );
		this.domElement.addEventListener( 'pointerup', this._onPointerUp );
		this.domElement.style.touchAction = 'none';

	}

	disconnect() {

		if ( ! this.domElement ) return;
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointermove', this._onPointerHover );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerup', this._onPointerUp );
		this.domElement.style.touchAction = 'auto';

	}

	/** The gizmo: add it to the scene. */
	getHelper() {

		return this._root;

	}

	attach( object ) {

		this.object = object;
		this._root.visible = true;
		return this;

	}

	detach() {

		this.object = undefined;
		this.axis = null;
		this._root.visible = false;
		return this;

	}

	reset() {

		if ( ! this.enabled || ! this.dragging ) return;
		this.object.position.copy( this._positionStart );
		this.object.quaternion.copy( this._quaternionStart );
		this.object.scale.copy( this._scaleStart );
		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _objectChangeEvent );
		this._setDragging( false );

	}

	getMode() {

		return this.mode;

	}

	getRaycaster() {

		return this._raycaster;

	}

	setMode( mode ) {

		this.mode = mode;

	}

	setTranslationSnap( value ) {

		this.translationSnap = value;

	}

	setRotationSnap( value ) {

		this.rotationSnap = value;

	}

	setScaleSnap( value ) {

		this.scaleSnap = value;

	}

	setSize( value ) {

		this.size = value;

	}

	setSpace( value ) {

		this.space = value;

	}

	dispose() {

		this.disconnect();
		this._root.dispose();

	}

	// ---------------------------------------------------------------- gizmo

	// The orientation of the handles: the object's in local space (scale always uses it).
	_gizmoQuaternion( target ) {

		if ( this.object && ( this.space === 'local' || this.mode === 'scale' ) ) return this.object.getWorldQuaternion( target );
		return target.set( 0, 0, 0, 1 );

	}

	updateGizmo() {

		const root = this._root, object = this.object;
		if ( ! object ) return;
		const camera = this.camera;
		object.getWorldPosition( root.position );
		this._gizmoQuaternion( root.quaternion );
		const eye = camera.getWorldPosition( _v1 );
		const factor = camera.isOrthographicCamera ? ( camera.top - camera.bottom ) / camera.zoom : eye.distanceTo( root.position ) * Math.min( 1.9 * Math.tan( Math.PI * camera.fov / 360 ) / camera.zoom, 7 );
		root.scale.setScalar( factor * this.size / 4 );
		const show = { X: this.showX, Y: this.showY, Z: this.showZ, E: this.showE };

		for ( const mode of [ 'translate', 'rotate', 'scale' ] ) {

			root.gizmo[ mode ].visible = mode === this.mode;

			for ( const child of root.gizmo[ mode ].children ) {

				const name = child.name;
				child.visible = [ ...name ].every( ( letter ) => show[ letter ] !== false ) || name === 'XYZ' || name === 'XYZE';
				const active = this.axis !== null && ( name === this.axis || ( this.axis.length > 1 && this.axis.split( '' ).every( ( a ) => name.includes( a ) ) && name.length === this.axis.length ) );
				const base = COLORS[ name ] ?? COLORS[ [ 'X', 'Y', 'Z' ].find( ( a ) => ! name.includes( a ) ) ] ?? 0xffffff;
				child.material.color.setHex( active ? COLORS.active : base );

			}

			// the eye ring faces the camera
			const ring = root.gizmo.rotate.children.find( ( c ) => c.name === 'E' ), ringPicker = root.pickers.rotate.children.find( ( c ) => c.name === 'E' );
			const look = _q1.copy( root.quaternion ).invert().multiply( camera.getWorldQuaternion( new Quaternion() ) );
			for ( const r of [ ring, ringPicker ] ) if ( r ) r.quaternion.copy( look );

		}

		// picking reads the handles' world matrices before the next render computes them
		root.updateMatrixWorld( true );

	}

	// ---------------------------------------------------------------- pointer

	_pointerFrom( event ) {

		const rect = this.domElement.getBoundingClientRect();
		_pointer.set( ( event.clientX - rect.left ) / rect.width * 2 - 1, - ( event.clientY - rect.top ) / rect.height * 2 + 1 );
		return { x: _pointer.x, y: _pointer.y, button: event.button };

	}

	_handlePointerHover( event ) {

		if ( ! this.enabled || this.dragging ) return;
		this.pointerHover( this._pointerFrom( event ) );

	}

	_handlePointerDown( event ) {

		if ( ! this.enabled || ! this.object ) return;
		if ( event.pointerType !== 'mouse' || document.pointerLockElement ) this.pointerHover( this._pointerFrom( event ) );
		this.domElement.setPointerCapture?.( event.pointerId );
		this.domElement.removeEventListener( 'pointermove', this._onPointerHover );
		this.domElement.addEventListener( 'pointermove', this._onPointerMove );
		this.pointerDown( this._pointerFrom( event ) );

	}

	_handlePointerMove( event ) {

		if ( ! this.enabled ) return;
		this.pointerMove( this._pointerFrom( event ) );

	}

	_handlePointerUp( event ) {

		if ( ! this.enabled ) return;
		this.domElement.releasePointerCapture?.( event.pointerId );
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.addEventListener( 'pointermove', this._onPointerHover );
		this.pointerUp( this._pointerFrom( event ) );

	}

	pointerHover( pointer ) {

		if ( this.object === undefined || this.dragging === true ) return;
		this.updateGizmo();
		this._raycaster.setFromCamera( pointer, this.camera );
		const hit = this._raycaster.intersectObjects( this._root.pickers[ this.mode ].children, true )[ 0 ];
		this.axis = hit ? hit.object.name : null;

	}

	// The plane a drag follows: through the gizmo, containing the axis and facing the
	// camera as much as it can, or the plane of two axes, or the one facing the camera.
	_dragPlane() {

		const eye = this.camera.getWorldPosition( _v1 ).sub( this._root.position ).normalize();
		const rotation = this._gizmoQuaternion( new Quaternion() );
		const axis = this.axis, normal = _v2;

		if ( this.mode === 'rotate' && ( axis === 'X' || axis === 'Y' || axis === 'Z' ) ) normal.copy( AXES[ axis ] ).applyQuaternion( rotation );
		else if ( axis === 'X' || axis === 'Y' || axis === 'Z' ) {

			const direction = _v3.copy( AXES[ axis ] ).applyQuaternion( rotation );
			normal.copy( direction ).cross( eye ).cross( direction );
			if ( normal.lengthSq() < 1e-10 ) normal.copy( eye );

		} else if ( axis === 'XY' || axis === 'YZ' || axis === 'XZ' ) {

			normal.copy( AXES[ [ 'X', 'Y', 'Z' ].find( ( a ) => ! axis.includes( a ) ) ] ).applyQuaternion( rotation );

		} else normal.copy( eye );

		return this._plane.setFromNormalAndCoplanarPoint( normal.normalize(), this._root.position );

	}

	_intersect( pointer, target ) {

		this._raycaster.setFromCamera( pointer, this.camera );
		return this._raycaster.ray.intersectPlane( this._plane, target );

	}

	pointerDown( pointer ) {

		if ( this.object === undefined || this.dragging === true || ( pointer != null && pointer.button !== 0 && pointer.button !== undefined ) ) return;
		if ( this.axis === null ) return;
		this.updateGizmo();
		this._dragPlane();
		if ( this._intersect( pointer, this._pointStart ) === null ) return;
		const object = this.object;
		this._positionStart.copy( object.position );
		this._quaternionStart.copy( object.quaternion );
		this._scaleStart.copy( object.scale );
		object.getWorldPosition( this._worldPositionStart );
		object.getWorldQuaternion( this._worldQuaternionStart );

		if ( object.parent ) {

			object.parent.getWorldQuaternion( this._parentQuaternionInverse ).invert();
			object.parent.getWorldScale( this._parentScale );

		} else {

			this._parentQuaternionInverse.set( 0, 0, 0, 1 );
			this._parentScale.set( 1, 1, 1 );

		}

		this._setDragging( true );
		_mouseDownEvent.mode = this.mode;
		this.dispatchEvent( _mouseDownEvent );

	}

	pointerMove( pointer ) {

		const axis = this.axis, object = this.object;
		if ( object === undefined || axis === null || this.dragging === false || ( pointer !== null && pointer.button !== undefined && pointer.button !== - 1 && pointer.button !== 0 ) ) return;
		if ( this._intersect( pointer, this._pointEnd ) === null ) return;
		const rotation = this._gizmoQuaternion( new Quaternion() );
		const offset = _v1.copy( this._pointEnd ).sub( this._pointStart );

		if ( this.mode === 'translate' ) {

			// keep only the movement along the chosen axes, in the gizmo's frame
			const local = offset.applyQuaternion( _q1.copy( rotation ).invert() );
			if ( ! axis.includes( 'X' ) ) local.x = 0;
			if ( ! axis.includes( 'Y' ) ) local.y = 0;
			if ( ! axis.includes( 'Z' ) ) local.z = 0;
			local.applyQuaternion( rotation ).applyQuaternion( this._parentQuaternionInverse ).divide( this._parentScale );
			object.position.copy( local ).add( this._positionStart );

			if ( this.translationSnap ) {

				const snap = this.translationSnap, round = ( v ) => Math.round( v / snap ) * snap;
				if ( axis.includes( 'X' ) ) object.position.x = round( object.position.x );
				if ( axis.includes( 'Y' ) ) object.position.y = round( object.position.y );
				if ( axis.includes( 'Z' ) ) object.position.z = round( object.position.z );

			}

			object.position.x = Math.max( this.minX, Math.min( this.maxX, object.position.x ) );
			object.position.y = Math.max( this.minY, Math.min( this.maxY, object.position.y ) );
			object.position.z = Math.max( this.minZ, Math.min( this.maxZ, object.position.z ) );

		} else if ( this.mode === 'scale' ) {

			const center = this._root.position;

			if ( axis === 'XYZ' ) {

				// uniform: the drag's length along the screen's up-right diagonal
				const d = offset.dot( _v2.set( 1, 1, 0 ).applyQuaternion( this.camera.getWorldQuaternion( new Quaternion() ) ).normalize() );
				const s = Math.max( 0.0001, 1 + d / ( center.distanceTo( this.camera.getWorldPosition( _v3 ) ) * 0.25 ) );
				object.scale.copy( this._scaleStart ).multiplyScalar( s );

			} else {

				const start = _v2.copy( this._pointStart ).sub( center ).applyQuaternion( _q1.copy( rotation ).invert() );
				const end = _v3.copy( this._pointEnd ).sub( center ).applyQuaternion( _q1 );
				const ratio = ( a ) => ( Math.abs( start[ a ] ) > 1e-6 ? end[ a ] / start[ a ] : 1 );
				object.scale.copy( this._scaleStart );
				if ( axis.includes( 'X' ) ) object.scale.x *= ratio( 'x' );
				if ( axis.includes( 'Y' ) ) object.scale.y *= ratio( 'y' );
				if ( axis.includes( 'Z' ) ) object.scale.z *= ratio( 'z' );

			}

			if ( this.scaleSnap ) {

				const snap = this.scaleSnap, round = ( v ) => Math.round( v / snap ) * snap || snap;
				object.scale.set( round( object.scale.x ), round( object.scale.y ), round( object.scale.z ) );

			}

		} else if ( this.mode === 'rotate' ) {

			const center = this._root.position, eye = this.camera.getWorldPosition( new Vector3() ).sub( center ).normalize();
			const rotationAxis = new Vector3();
			let angle;

			if ( axis === 'XYZE' ) {

				// free rotation: about the axis across the drag, by its length
				rotationAxis.copy( offset ).cross( eye ).normalize();
				angle = offset.length() / ( center.distanceTo( this.camera.getWorldPosition( _v3 ) ) * 0.25 ) * 2;

			} else {

				rotationAxis.copy( axis === 'E' ? eye : AXES[ axis ] );
				if ( axis !== 'E' ) rotationAxis.applyQuaternion( rotation );
				const a = _v2.copy( this._pointStart ).sub( center ), b = _v3.copy( this._pointEnd ).sub( center );
				angle = Math.atan2( a.clone().cross( b ).dot( rotationAxis ), a.dot( b ) );

			}

			if ( this.rotationSnap ) angle = Math.round( angle / this.rotationSnap ) * this.rotationSnap;
			if ( rotationAxis.lengthSq() === 0 || ! Number.isFinite( angle ) ) return;
			// rotate in world space, then express in the parent's frame
			const delta = new Quaternion().setFromAxisAngle( rotationAxis, angle );
			const world = delta.multiply( this._worldQuaternionStart );
			object.quaternion.copy( this._parentQuaternionInverse ).multiply( world );

		}

		this.dispatchEvent( _changeEvent );
		this.dispatchEvent( _objectChangeEvent );

	}

	pointerUp( pointer ) {

		if ( pointer !== null && pointer.button !== undefined && pointer.button !== 0 ) return;

		if ( this.dragging && this.axis !== null ) {

			_mouseUpEvent.mode = this.mode;
			this.dispatchEvent( _mouseUpEvent );

		}

		this._setDragging( false );
		this.axis = null;

	}

	_setDragging( value ) {

		if ( this.dragging === value ) return;
		this.dragging = value;
		this.dispatchEvent( { type: 'dragging-changed', value } );

	}

}
