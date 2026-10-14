// Small stand-ins for the three.js add-on controls the ported examples use. They only
// touch `camera.position` and `camera.lookAt`, so they work with either library.
// They cover the options the ports set, not the whole add-on API.

class Point {

	constructor( x = 0, y = 0, z = 0 ) {

		this.set( x, y, z );

	}

	set( x, y, z ) {

		this.x = x;
		this.y = y;
		this.z = z;
		return this;

	}

}

/** Drag to orbit, wheel or pinch to zoom, around `target`. */
export class OrbitControls {

	constructor( camera, domElement ) {

		this.object = camera;
		this.domElement = domElement;
		this.target = new Point();
		this.minDistance = 0;
		this.maxDistance = Infinity;
		this.minPolarAngle = 0;
		this.maxPolarAngle = Math.PI;
		this.rotateSpeed = 1;

		const pointers = new Map();
		let pinch = 0;
		domElement.style.touchAction = 'none';
		domElement.addEventListener( 'pointerdown', ( event ) => {

			domElement.setPointerCapture( event.pointerId );
			pointers.set( event.pointerId, [ event.clientX, event.clientY ] );

		} );
		domElement.addEventListener( 'pointermove', ( event ) => {

			const last = pointers.get( event.pointerId );
			if ( ! last ) return;
			const dx = event.clientX - last[ 0 ], dy = event.clientY - last[ 1 ];
			pointers.set( event.pointerId, [ event.clientX, event.clientY ] );
			if ( pointers.size === 1 ) {

				const scale = 2 * Math.PI / domElement.clientHeight * this.rotateSpeed;
				this._rotate( - dx * scale, - dy * scale, 1 );

			} else if ( pointers.size === 2 ) {

				const [ a, b ] = [ ...pointers.values() ];
				const distance = Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] );
				if ( pinch > 0 ) this._rotate( 0, 0, pinch / distance );
				pinch = distance;

			}

		} );
		const release = ( event ) => {

			pointers.delete( event.pointerId );
			pinch = 0;

		};
		domElement.addEventListener( 'pointerup', release );
		domElement.addEventListener( 'pointercancel', release );
		domElement.addEventListener( 'wheel', ( event ) => {

			event.preventDefault();
			this._rotate( 0, 0, Math.exp( event.deltaY * 0.001 ) );

		}, { passive: false } );

	}

	_rotate( dTheta, dPhi, zoom ) {

		const p = this.object.position, t = this.target;
		const x = p.x - t.x, y = p.y - t.y, z = p.z - t.z;
		const radius = Math.min( this.maxDistance, Math.max( this.minDistance, Math.hypot( x, y, z ) * zoom ) );
		const theta = Math.atan2( x, z ) + dTheta;
		const phi = Math.min( this.maxPolarAngle, Math.max( this.minPolarAngle, Math.acos( Math.min( 1, Math.max( - 1, y / ( Math.hypot( x, y, z ) || 1 ) ) ) ) + dPhi ) );
		const clamped = Math.min( Math.PI - 1e-6, Math.max( 1e-6, phi ) );
		p.set( t.x + radius * Math.sin( clamped ) * Math.sin( theta ), t.y + radius * Math.cos( clamped ), t.z + radius * Math.sin( clamped ) * Math.cos( theta ) );
		this.object.lookAt( t.x, t.y, t.z );

	}

	update() {

		this._rotate( 0, 0, 1 );
		return true;

	}

}

/** The pointer's offset from the centre steers the view; W/S, arrows or mouse buttons move. */
export class FirstPersonControls {

	constructor( camera, domElement ) {

		this.object = camera;
		this.domElement = domElement;
		this.movementSpeed = 1;
		this.lookSpeed = 0.005;
		this.lookVertical = true;
		this.activeLook = true;

		this._lat = 0;
		this._lon = - 90;
		this._pointer = [ 0, 0 ];
		this._move = { forward: false, backward: false, left: false, right: false, up: false, down: false };

		domElement.addEventListener( 'contextmenu', ( event ) => event.preventDefault() );
		domElement.addEventListener( 'pointerdown', ( event ) => {

			if ( event.button === 0 ) this._move.forward = true;
			if ( event.button === 2 ) this._move.backward = true;

		} );
		domElement.addEventListener( 'pointerup', ( event ) => {

			if ( event.button === 0 ) this._move.forward = false;
			if ( event.button === 2 ) this._move.backward = false;

		} );
		domElement.addEventListener( 'pointermove', ( event ) => {

			const box = domElement.getBoundingClientRect();
			this._pointer = [ event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2 ];

		} );
		domElement.addEventListener( 'pointerleave', () => {

			this._pointer = [ 0, 0 ];

		} );
		const keys = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyR: 'up', KeyF: 'down' };
		window.addEventListener( 'keydown', ( event ) => {

			if ( keys[ event.code ] ) this._move[ keys[ event.code ] ] = true;

		} );
		window.addEventListener( 'keyup', ( event ) => {

			if ( keys[ event.code ] ) this._move[ keys[ event.code ] ] = false;

		} );

	}

	lookAt( x, y, z ) {

		const p = this.object.position, dx = x - p.x, dy = y - p.y, dz = z - p.z;
		this._lat = Math.asin( dy / Math.hypot( dx, dy, dz ) ) * 180 / Math.PI;
		this._lon = Math.atan2( dz, dx ) * 180 / Math.PI;
		return this;

	}

	update( delta ) {

		const p = this.object.position, step = delta * this.movementSpeed;
		const lat = Math.max( - 85, Math.min( 85, this._lat ) ) * Math.PI / 180, lon = this._lon * Math.PI / 180;
		const dir = [ Math.cos( lat ) * Math.cos( lon ), Math.sin( lat ), Math.cos( lat ) * Math.sin( lon ) ];
		const side = [ - Math.sin( lon ), 0, Math.cos( lon ) ];
		const m = this._move;
		const forward = ( m.forward ? 1 : 0 ) - ( m.backward ? 1 : 0 ), right = ( m.right ? 1 : 0 ) - ( m.left ? 1 : 0 ), up = ( m.up ? 1 : 0 ) - ( m.down ? 1 : 0 );
		p.set( p.x + ( dir[ 0 ] * forward + side[ 0 ] * right ) * step, p.y + ( dir[ 1 ] * forward + up ) * step, p.z + ( dir[ 2 ] * forward + side[ 2 ] * right ) * step );

		if ( this.activeLook ) {

			const look = delta * this.lookSpeed;
			this._lon += this._pointer[ 0 ] * look;
			if ( this.lookVertical ) this._lat -= this._pointer[ 1 ] * look;
			this._lat = Math.max( - 85, Math.min( 85, this._lat ) );

		}

		const la = this._lat * Math.PI / 180, lo = this._lon * Math.PI / 180;
		this.object.lookAt( p.x + Math.cos( la ) * Math.cos( lo ) * 100, p.y + Math.sin( la ) * 100, p.z + Math.cos( la ) * Math.sin( lo ) * 100 );
		return this;

	}

}
