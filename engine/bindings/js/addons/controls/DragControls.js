// three.js add-on path: `three/addons/controls/DragControls.js`.
//
// Drags `objects` with the pointer in the plane facing the camera through the grabbed
// point, raising `dragstart`, `drag`, `dragend`, `hoveron` and `hoveroff`.

import { Controls, Matrix4, Plane, Raycaster, Vector2, Vector3 } from '../../compat.js';

const _plane = new Plane(), _pointer = new Vector2(), _offset = new Vector3(), _intersection = new Vector3(), _worldPosition = new Vector3(), _inverseMatrix = new Matrix4();

export class DragControls extends Controls {

	constructor( objects, camera, domElement = null ) {

		super( camera, domElement );
		this.objects = objects;
		this.recursive = true;
		this.transformGroup = false;
		this.rotateSpeed = 1;
		this.raycaster = new Raycaster();
		this._selected = null;
		this._hovered = null;
		this._intersections = [];
		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerCancel = this._handlePointerCancel.bind( this );
		this._onContextMenu = ( event ) => {

			if ( this.enabled ) event.preventDefault();

		};

		if ( domElement !== null ) this.connect( domElement );

	}

	connect( element ) {

		super.connect( element );
		this.domElement.addEventListener( 'pointermove', this._onPointerMove );
		this.domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.addEventListener( 'pointerup', this._onPointerCancel );
		this.domElement.addEventListener( 'pointerleave', this._onPointerCancel );
		this.domElement.addEventListener( 'contextmenu', this._onContextMenu );
		this.domElement.style.touchAction = 'none';

	}

	disconnect() {

		if ( this.domElement === null ) return;
		this.domElement.removeEventListener( 'pointermove', this._onPointerMove );
		this.domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this.domElement.removeEventListener( 'pointerup', this._onPointerCancel );
		this.domElement.removeEventListener( 'pointerleave', this._onPointerCancel );
		this.domElement.removeEventListener( 'contextmenu', this._onContextMenu );
		this.domElement.style.touchAction = 'auto';
		this.domElement.style.cursor = '';

	}

	dispose() {

		this.disconnect();

	}

	_updatePointer( event ) {

		const rect = this.domElement.getBoundingClientRect();
		_pointer.x = ( event.clientX - rect.left ) / rect.width * 2 - 1;
		_pointer.y = - ( event.clientY - rect.top ) / rect.height * 2 + 1;

	}

	_findGroup( object, group = null ) {

		if ( object.isGroup ) group = object;
		if ( object.parent === null ) return group;
		return this._findGroup( object.parent, group );

	}

	_handlePointerMove( event ) {

		if ( this.enabled === false ) return;
		this._updatePointer( event );
		this.raycaster.setFromCamera( _pointer, this.object );

		if ( this._selected ) {

			if ( this.raycaster.ray.intersectPlane( _plane, _intersection ) ) {

				const parent = this._selected.parent;
				_inverseMatrix.copy( parent.matrixWorld ).invert();
				this._selected.position.copy( _intersection.sub( _offset ).applyMatrix4( _inverseMatrix ) );

			}

			this.dispatchEvent( { type: 'drag', object: this._selected } );
			return;

		}

		// hover support
		if ( event.pointerType === 'mouse' || event.pointerType === 'pen' ) {

			this._intersections.length = 0;
			this.raycaster.intersectObjects( this.objects, this.recursive, this._intersections );

			if ( this._intersections.length > 0 ) {

				const object = this._intersections[ 0 ].object;
				_plane.setFromNormalAndCoplanarPoint( this.object.getWorldDirection( _plane.normal ), _worldPosition.setFromMatrixPosition( object.matrixWorld ) );

				if ( this._hovered !== object && this._hovered !== null ) {

					this.dispatchEvent( { type: 'hoveroff', object: this._hovered } );
					this.domElement.style.cursor = 'auto';
					this._hovered = null;

				}

				if ( this._hovered !== object ) {

					this.dispatchEvent( { type: 'hoveron', object } );
					this.domElement.style.cursor = 'pointer';
					this._hovered = object;

				}

			} else if ( this._hovered !== null ) {

				this.dispatchEvent( { type: 'hoveroff', object: this._hovered } );
				this.domElement.style.cursor = 'auto';
				this._hovered = null;

			}

		}

	}

	_handlePointerDown( event ) {

		if ( this.enabled === false ) return;
		this._updatePointer( event );
		this._intersections.length = 0;
		this.raycaster.setFromCamera( _pointer, this.object );
		this.raycaster.intersectObjects( this.objects, this.recursive, this._intersections );

		if ( this._intersections.length > 0 ) {

			this._selected = this.transformGroup === true ? this._findGroup( this._intersections[ 0 ].object ) ?? this._intersections[ 0 ].object : this._intersections[ 0 ].object;
			_plane.setFromNormalAndCoplanarPoint( this.object.getWorldDirection( _plane.normal ), _worldPosition.setFromMatrixPosition( this._selected.matrixWorld ) );

			if ( this.raycaster.ray.intersectPlane( _plane, _intersection ) ) {

				_inverseMatrix.copy( this._selected.parent.matrixWorld ).invert();
				_offset.copy( _intersection ).sub( _worldPosition.setFromMatrixPosition( this._selected.matrixWorld ) );

			}

			this.domElement.style.cursor = 'move';
			this.dispatchEvent( { type: 'dragstart', object: this._selected } );

		}

	}

	_handlePointerCancel() {

		if ( this.enabled === false ) return;

		if ( this._selected ) {

			this.dispatchEvent( { type: 'dragend', object: this._selected } );
			this._selected = null;

		}

		this.domElement.style.cursor = this._hovered ? 'pointer' : 'auto';

	}

	getRaycaster() {

		return this.raycaster;

	}

	setObjects( objects ) {

		this.objects = objects;

	}

	getObjects() {

		return this.objects;

	}

}
