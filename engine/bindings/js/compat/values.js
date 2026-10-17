// Vectors, quaternions, Euler angles, matrices, boxes and spheres of the object API, kept in
// JavaScript. They are small values that applications create and change constantly; doing
// that work across the WebAssembly boundary made each call several times slower than
// three.js. The engine gets them as numbers or arrays where it needs them (see
// `math.js`).
//
// Behaviour follows three.js (MIT License, Copyright 2010-2026 three.js authors); numbers
// are 64-bit here, as in three.js.

const clamp = ( value, min, max ) => Math.max( min, Math.min( max, value ) );

// ---------------------------------------------------------------- Vector2

export class Vector2 {

	constructor( x = 0, y = 0 ) {

		this.x = x;
		this.y = y;

	}

	get width() {

		return this.x;

	}

	set width( value ) {

		this.x = value;

	}

	get height() {

		return this.y;

	}

	set height( value ) {

		this.y = value;

	}

	set( x, y ) {

		this.x = x;
		this.y = y;
		return this;

	}

	setScalar( s ) {

		this.x = s;
		this.y = s;
		return this;

	}

	setX( x ) {

		this.x = x;
		return this;

	}

	setY( y ) {

		this.y = y;
		return this;

	}

	setComponent( index, value ) {

		if ( index === 0 ) this.x = value;
		else if ( index === 1 ) this.y = value;
		else throw new Error( 'WAMR3D: Vector2 index is out of range: ' + index );
		return this;

	}

	getComponent( index ) {

		if ( index === 0 ) return this.x;
		if ( index === 1 ) return this.y;
		throw new Error( 'WAMR3D: Vector2 index is out of range: ' + index );

	}

	clone() {

		return new this.constructor( this.x, this.y );

	}

	copy( v ) {

		this.x = v.x;
		this.y = v.y;
		return this;

	}

	add( v ) {

		this.x += v.x;
		this.y += v.y;
		return this;

	}

	addScalar( s ) {

		this.x += s;
		this.y += s;
		return this;

	}

	addVectors( a, b ) {

		this.x = a.x + b.x;
		this.y = a.y + b.y;
		return this;

	}

	addScaledVector( v, s ) {

		this.x += v.x * s;
		this.y += v.y * s;
		return this;

	}

	sub( v ) {

		this.x -= v.x;
		this.y -= v.y;
		return this;

	}

	subScalar( s ) {

		this.x -= s;
		this.y -= s;
		return this;

	}

	subVectors( a, b ) {

		this.x = a.x - b.x;
		this.y = a.y - b.y;
		return this;

	}

	multiply( v ) {

		this.x *= v.x;
		this.y *= v.y;
		return this;

	}

	multiplyScalar( s ) {

		this.x *= s;
		this.y *= s;
		return this;

	}

	divide( v ) {

		this.x /= v.x;
		this.y /= v.y;
		return this;

	}

	divideScalar( s ) {

		return this.multiplyScalar( 1 / s );

	}

	applyMatrix3( m ) {

		const x = this.x, y = this.y, e = m.elements;
		this.x = e[ 0 ] * x + e[ 3 ] * y + e[ 6 ];
		this.y = e[ 1 ] * x + e[ 4 ] * y + e[ 7 ];
		return this;

	}

	min( v ) {

		this.x = Math.min( this.x, v.x );
		this.y = Math.min( this.y, v.y );
		return this;

	}

	max( v ) {

		this.x = Math.max( this.x, v.x );
		this.y = Math.max( this.y, v.y );
		return this;

	}

	clamp( min, max ) {

		this.x = clamp( this.x, min.x, max.x );
		this.y = clamp( this.y, min.y, max.y );
		return this;

	}

	clampScalar( min, max ) {

		this.x = clamp( this.x, min, max );
		this.y = clamp( this.y, min, max );
		return this;

	}

	clampLength( min, max ) {

		const length = this.length();
		return this.divideScalar( length || 1 ).multiplyScalar( clamp( length, min, max ) );

	}

	floor() {

		this.x = Math.floor( this.x );
		this.y = Math.floor( this.y );
		return this;

	}

	ceil() {

		this.x = Math.ceil( this.x );
		this.y = Math.ceil( this.y );
		return this;

	}

	round() {

		this.x = Math.round( this.x );
		this.y = Math.round( this.y );
		return this;

	}

	roundToZero() {

		this.x = Math.trunc( this.x );
		this.y = Math.trunc( this.y );
		return this;

	}

	negate() {

		this.x = - this.x;
		this.y = - this.y;
		return this;

	}

	dot( v ) {

		return this.x * v.x + this.y * v.y;

	}

	cross( v ) {

		return this.x * v.y - this.y * v.x;

	}

	lengthSq() {

		return this.x * this.x + this.y * this.y;

	}

	length() {

		return Math.sqrt( this.x * this.x + this.y * this.y );

	}

	manhattanLength() {

		return Math.abs( this.x ) + Math.abs( this.y );

	}

	normalize() {

		return this.divideScalar( this.length() || 1 );

	}

	angle() {

		return Math.atan2( - this.y, - this.x ) + Math.PI;

	}

	angleTo( v ) {

		const denominator = Math.sqrt( this.lengthSq() * v.lengthSq() );
		if ( denominator === 0 ) return Math.PI / 2;
		return Math.acos( clamp( this.dot( v ) / denominator, - 1, 1 ) );

	}

	distanceTo( v ) {

		return Math.sqrt( this.distanceToSquared( v ) );

	}

	distanceToSquared( v ) {

		const dx = this.x - v.x, dy = this.y - v.y;
		return dx * dx + dy * dy;

	}

	manhattanDistanceTo( v ) {

		return Math.abs( this.x - v.x ) + Math.abs( this.y - v.y );

	}

	setLength( length ) {

		return this.normalize().multiplyScalar( length );

	}

	lerp( v, alpha ) {

		this.x += ( v.x - this.x ) * alpha;
		this.y += ( v.y - this.y ) * alpha;
		return this;

	}

	lerpVectors( v1, v2, alpha ) {

		this.x = v1.x + ( v2.x - v1.x ) * alpha;
		this.y = v1.y + ( v2.y - v1.y ) * alpha;
		return this;

	}

	equals( v ) {

		return v.x === this.x && v.y === this.y;

	}

	fromArray( array, offset = 0 ) {

		this.x = array[ offset ];
		this.y = array[ offset + 1 ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.x;
		array[ offset + 1 ] = this.y;
		return array;

	}

	fromBufferAttribute( attribute, index ) {

		this.x = attribute.getX( index );
		this.y = attribute.getY( index );
		return this;

	}

	rotateAround( center, angle ) {

		const c = Math.cos( angle ), s = Math.sin( angle );
		const x = this.x - center.x, y = this.y - center.y;
		this.x = x * c - y * s + center.x;
		this.y = x * s + y * c + center.y;
		return this;

	}

	random() {

		this.x = Math.random();
		this.y = Math.random();
		return this;

	}

	* [ Symbol.iterator ]() {

		yield this.x;
		yield this.y;

	}

}

Vector2.prototype.isVector2 = true;

// ---------------------------------------------------------------- Vector3

export class Vector3 {

	constructor( x = 0, y = 0, z = 0 ) {

		this.x = x;
		this.y = y;
		this.z = z;

	}

	set( x, y, z ) {

		// sprite.scale.set( x, y ) keeps z, as in three.js
		if ( z === undefined ) z = this.z;
		this.x = x;
		this.y = y;
		this.z = z;
		return this;

	}

	setScalar( s ) {

		this.x = s;
		this.y = s;
		this.z = s;
		return this;

	}

	setX( x ) {

		this.x = x;
		return this;

	}

	setY( y ) {

		this.y = y;
		return this;

	}

	setZ( z ) {

		this.z = z;
		return this;

	}

	setComponent( index, value ) {

		if ( index === 0 ) this.x = value;
		else if ( index === 1 ) this.y = value;
		else if ( index === 2 ) this.z = value;
		else throw new Error( 'WAMR3D: Vector3 index is out of range: ' + index );
		return this;

	}

	getComponent( index ) {

		if ( index === 0 ) return this.x;
		if ( index === 1 ) return this.y;
		if ( index === 2 ) return this.z;
		throw new Error( 'WAMR3D: Vector3 index is out of range: ' + index );

	}

	clone() {

		return new this.constructor( this.x, this.y, this.z );

	}

	copy( v ) {

		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		return this;

	}

	add( v ) {

		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		return this;

	}

	addScalar( s ) {

		this.x += s;
		this.y += s;
		this.z += s;
		return this;

	}

	addVectors( a, b ) {

		this.x = a.x + b.x;
		this.y = a.y + b.y;
		this.z = a.z + b.z;
		return this;

	}

	addScaledVector( v, s ) {

		this.x += v.x * s;
		this.y += v.y * s;
		this.z += v.z * s;
		return this;

	}

	sub( v ) {

		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		return this;

	}

	subScalar( s ) {

		this.x -= s;
		this.y -= s;
		this.z -= s;
		return this;

	}

	subVectors( a, b ) {

		this.x = a.x - b.x;
		this.y = a.y - b.y;
		this.z = a.z - b.z;
		return this;

	}

	multiply( v ) {

		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		return this;

	}

	multiplyScalar( s ) {

		this.x *= s;
		this.y *= s;
		this.z *= s;
		return this;

	}

	multiplyVectors( a, b ) {

		this.x = a.x * b.x;
		this.y = a.y * b.y;
		this.z = a.z * b.z;
		return this;

	}

	applyEuler( euler ) {

		return this.applyQuaternion( _quaternion.setFromEuler( euler ) );

	}

	applyAxisAngle( axis, angle ) {

		return this.applyQuaternion( _quaternion.setFromAxisAngle( axis, angle ) );

	}

	applyMatrix3( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		this.x = e[ 0 ] * x + e[ 3 ] * y + e[ 6 ] * z;
		this.y = e[ 1 ] * x + e[ 4 ] * y + e[ 7 ] * z;
		this.z = e[ 2 ] * x + e[ 5 ] * y + e[ 8 ] * z;
		return this;

	}

	applyNormalMatrix( m ) {

		return this.applyMatrix3( m ).normalize();

	}

	applyMatrix4( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		const w = 1 / ( e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ] );
		this.x = ( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] ) * w;
		this.y = ( e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ] ) * w;
		this.z = ( e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] ) * w;
		return this;

	}

	applyQuaternion( q ) {

		const vx = this.x, vy = this.y, vz = this.z;
		const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
		const tx = 2 * ( qy * vz - qz * vy );
		const ty = 2 * ( qz * vx - qx * vz );
		const tz = 2 * ( qx * vy - qy * vx );
		this.x = vx + qw * tx + qy * tz - qz * ty;
		this.y = vy + qw * ty + qz * tx - qx * tz;
		this.z = vz + qw * tz + qx * ty - qy * tx;
		return this;

	}

	/** World space to normalized device coordinates of `camera`. */
	project( camera ) {

		return this.applyMatrix4( camera.matrixWorldInverse ).applyMatrix4( camera.projectionMatrix );

	}

	/** Normalized device coordinates of `camera` to world space. */
	unproject( camera ) {

		return this.applyMatrix4( camera.projectionMatrixInverse ).applyMatrix4( camera.matrixWorld );

	}

	transformDirection( m ) {

		const x = this.x, y = this.y, z = this.z, e = m.elements;
		this.x = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z;
		this.y = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z;
		this.z = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z;
		return this.normalize();

	}

	divide( v ) {

		this.x /= v.x;
		this.y /= v.y;
		this.z /= v.z;
		return this;

	}

	divideScalar( s ) {

		return this.multiplyScalar( 1 / s );

	}

	min( v ) {

		this.x = Math.min( this.x, v.x );
		this.y = Math.min( this.y, v.y );
		this.z = Math.min( this.z, v.z );
		return this;

	}

	max( v ) {

		this.x = Math.max( this.x, v.x );
		this.y = Math.max( this.y, v.y );
		this.z = Math.max( this.z, v.z );
		return this;

	}

	clamp( min, max ) {

		this.x = clamp( this.x, min.x, max.x );
		this.y = clamp( this.y, min.y, max.y );
		this.z = clamp( this.z, min.z, max.z );
		return this;

	}

	clampScalar( min, max ) {

		this.x = clamp( this.x, min, max );
		this.y = clamp( this.y, min, max );
		this.z = clamp( this.z, min, max );
		return this;

	}

	clampLength( min, max ) {

		const length = this.length();
		return this.divideScalar( length || 1 ).multiplyScalar( clamp( length, min, max ) );

	}

	floor() {

		this.x = Math.floor( this.x );
		this.y = Math.floor( this.y );
		this.z = Math.floor( this.z );
		return this;

	}

	ceil() {

		this.x = Math.ceil( this.x );
		this.y = Math.ceil( this.y );
		this.z = Math.ceil( this.z );
		return this;

	}

	round() {

		this.x = Math.round( this.x );
		this.y = Math.round( this.y );
		this.z = Math.round( this.z );
		return this;

	}

	roundToZero() {

		this.x = Math.trunc( this.x );
		this.y = Math.trunc( this.y );
		this.z = Math.trunc( this.z );
		return this;

	}

	negate() {

		this.x = - this.x;
		this.y = - this.y;
		this.z = - this.z;
		return this;

	}

	dot( v ) {

		return this.x * v.x + this.y * v.y + this.z * v.z;

	}

	lengthSq() {

		return this.x * this.x + this.y * this.y + this.z * this.z;

	}

	length() {

		return Math.sqrt( this.x * this.x + this.y * this.y + this.z * this.z );

	}

	manhattanLength() {

		return Math.abs( this.x ) + Math.abs( this.y ) + Math.abs( this.z );

	}

	normalize() {

		return this.divideScalar( this.length() || 1 );

	}

	setLength( length ) {

		return this.normalize().multiplyScalar( length );

	}

	lerp( v, alpha ) {

		this.x += ( v.x - this.x ) * alpha;
		this.y += ( v.y - this.y ) * alpha;
		this.z += ( v.z - this.z ) * alpha;
		return this;

	}

	lerpVectors( v1, v2, alpha ) {

		this.x = v1.x + ( v2.x - v1.x ) * alpha;
		this.y = v1.y + ( v2.y - v1.y ) * alpha;
		this.z = v1.z + ( v2.z - v1.z ) * alpha;
		return this;

	}

	cross( v ) {

		return this.crossVectors( this, v );

	}

	crossVectors( a, b ) {

		const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
		this.x = ay * bz - az * by;
		this.y = az * bx - ax * bz;
		this.z = ax * by - ay * bx;
		return this;

	}

	projectOnVector( v ) {

		const denominator = v.lengthSq();
		if ( denominator === 0 ) return this.set( 0, 0, 0 );
		const scalar = v.dot( this ) / denominator;
		return this.copy( v ).multiplyScalar( scalar );

	}

	projectOnPlane( planeNormal ) {

		_vector.copy( this ).projectOnVector( planeNormal );
		return this.sub( _vector );

	}

	reflect( normal ) {

		return this.sub( _vector.copy( normal ).multiplyScalar( 2 * this.dot( normal ) ) );

	}

	angleTo( v ) {

		const denominator = Math.sqrt( this.lengthSq() * v.lengthSq() );
		if ( denominator === 0 ) return Math.PI / 2;
		return Math.acos( clamp( this.dot( v ) / denominator, - 1, 1 ) );

	}

	distanceTo( v ) {

		return Math.sqrt( this.distanceToSquared( v ) );

	}

	distanceToSquared( v ) {

		const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
		return dx * dx + dy * dy + dz * dz;

	}

	manhattanDistanceTo( v ) {

		return Math.abs( this.x - v.x ) + Math.abs( this.y - v.y ) + Math.abs( this.z - v.z );

	}

	setFromSpherical( s ) {

		return this.setFromSphericalCoords( s.radius, s.phi, s.theta );

	}

	setFromSphericalCoords( radius, phi, theta ) {

		const sinPhiRadius = Math.sin( phi ) * radius;
		this.x = sinPhiRadius * Math.sin( theta );
		this.y = Math.cos( phi ) * radius;
		this.z = sinPhiRadius * Math.cos( theta );
		return this;

	}

	setFromCylindrical( c ) {

		return this.setFromCylindricalCoords( c.radius, c.theta, c.y );

	}

	setFromCylindricalCoords( radius, theta, y ) {

		this.x = radius * Math.sin( theta );
		this.y = y;
		this.z = radius * Math.cos( theta );
		return this;

	}

	setFromMatrixPosition( m ) {

		const e = m.elements;
		this.x = e[ 12 ];
		this.y = e[ 13 ];
		this.z = e[ 14 ];
		return this;

	}

	setFromMatrixScale( m ) {

		const sx = this.setFromMatrixColumn( m, 0 ).length();
		const sy = this.setFromMatrixColumn( m, 1 ).length();
		const sz = this.setFromMatrixColumn( m, 2 ).length();
		this.x = sx;
		this.y = sy;
		this.z = sz;
		return this;

	}

	setFromMatrixColumn( m, index ) {

		return this.fromArray( m.elements, index * 4 );

	}

	setFromMatrix3Column( m, index ) {

		return this.fromArray( m.elements, index * 3 );

	}

	setFromEuler( e ) {

		this.x = e.x;
		this.y = e.y;
		this.z = e.z;
		return this;

	}

	setFromColor( c ) {

		this.x = c.r;
		this.y = c.g;
		this.z = c.b;
		return this;

	}

	equals( v ) {

		return v.x === this.x && v.y === this.y && v.z === this.z;

	}

	fromArray( array, offset = 0 ) {

		this.x = array[ offset ];
		this.y = array[ offset + 1 ];
		this.z = array[ offset + 2 ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.x;
		array[ offset + 1 ] = this.y;
		array[ offset + 2 ] = this.z;
		return array;

	}

	fromBufferAttribute( attribute, index ) {

		this.x = attribute.getX( index );
		this.y = attribute.getY( index );
		this.z = attribute.getZ( index );
		return this;

	}

	random() {

		this.x = Math.random();
		this.y = Math.random();
		this.z = Math.random();
		return this;

	}

	randomDirection() {

		const theta = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, c = Math.sqrt( 1 - u * u );
		this.x = c * Math.cos( theta );
		this.y = u;
		this.z = c * Math.sin( theta );
		return this;

	}

	* [ Symbol.iterator ]() {

		yield this.x;
		yield this.y;
		yield this.z;

	}

}

Vector3.prototype.isVector3 = true;

// ---------------------------------------------------------------- Vector4

export class Vector4 {

	constructor( x = 0, y = 0, z = 0, w = 1 ) {

		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;

	}

	get width() {

		return this.z;

	}

	set width( value ) {

		this.z = value;

	}

	get height() {

		return this.w;

	}

	set height( value ) {

		this.w = value;

	}

	set( x, y, z, w ) {

		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;

	}

	setScalar( s ) {

		this.x = s;
		this.y = s;
		this.z = s;
		this.w = s;
		return this;

	}

	setX( x ) {

		this.x = x;
		return this;

	}

	setY( y ) {

		this.y = y;
		return this;

	}

	setZ( z ) {

		this.z = z;
		return this;

	}

	setW( w ) {

		this.w = w;
		return this;

	}

	clone() {

		return new this.constructor( this.x, this.y, this.z, this.w );

	}

	copy( v ) {

		this.x = v.x;
		this.y = v.y;
		this.z = v.z;
		this.w = v.w !== undefined ? v.w : 1;
		return this;

	}

	add( v ) {

		this.x += v.x;
		this.y += v.y;
		this.z += v.z;
		this.w += v.w;
		return this;

	}

	addScalar( s ) {

		this.x += s;
		this.y += s;
		this.z += s;
		this.w += s;
		return this;

	}

	addVectors( a, b ) {

		this.x = a.x + b.x;
		this.y = a.y + b.y;
		this.z = a.z + b.z;
		this.w = a.w + b.w;
		return this;

	}

	addScaledVector( v, s ) {

		this.x += v.x * s;
		this.y += v.y * s;
		this.z += v.z * s;
		this.w += v.w * s;
		return this;

	}

	sub( v ) {

		this.x -= v.x;
		this.y -= v.y;
		this.z -= v.z;
		this.w -= v.w;
		return this;

	}

	subScalar( s ) {

		this.x -= s;
		this.y -= s;
		this.z -= s;
		this.w -= s;
		return this;

	}

	subVectors( a, b ) {

		this.x = a.x - b.x;
		this.y = a.y - b.y;
		this.z = a.z - b.z;
		this.w = a.w - b.w;
		return this;

	}

	multiply( v ) {

		this.x *= v.x;
		this.y *= v.y;
		this.z *= v.z;
		this.w *= v.w;
		return this;

	}

	multiplyScalar( s ) {

		this.x *= s;
		this.y *= s;
		this.z *= s;
		this.w *= s;
		return this;

	}

	applyMatrix4( m ) {

		const x = this.x, y = this.y, z = this.z, w = this.w, e = m.elements;
		this.x = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] * w;
		this.y = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ] * w;
		this.z = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] * w;
		this.w = e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ] * w;
		return this;

	}

	divide( v ) {

		this.x /= v.x;
		this.y /= v.y;
		this.z /= v.z;
		this.w /= v.w;
		return this;

	}

	divideScalar( s ) {

		return this.multiplyScalar( 1 / s );

	}

	setAxisAngleFromQuaternion( q ) {

		this.w = 2 * Math.acos( q.w );
		const s = Math.sqrt( 1 - q.w * q.w );

		if ( s < 0.0001 ) {

			this.x = 1;
			this.y = 0;
			this.z = 0;

		} else {

			this.x = q.x / s;
			this.y = q.y / s;
			this.z = q.z / s;

		}

		return this;

	}

	setAxisAngleFromRotationMatrix( m ) {

		const epsilon = 0.01, epsilon2 = 0.1, te = m.elements;
		const m11 = te[ 0 ], m12 = te[ 4 ], m13 = te[ 8 ];
		const m21 = te[ 1 ], m22 = te[ 5 ], m23 = te[ 9 ];
		const m31 = te[ 2 ], m32 = te[ 6 ], m33 = te[ 10 ];

		if ( Math.abs( m12 - m21 ) < epsilon && Math.abs( m13 - m31 ) < epsilon && Math.abs( m23 - m32 ) < epsilon ) {

			// a symmetric matrix: no rotation, or half a turn
			if ( Math.abs( m12 + m21 ) < epsilon2 && Math.abs( m13 + m31 ) < epsilon2 && Math.abs( m23 + m32 ) < epsilon2 && Math.abs( m11 + m22 + m33 - 3 ) < epsilon2 ) {

				return this.set( 1, 0, 0, 0 );

			}

			const xx = ( m11 + 1 ) / 2, yy = ( m22 + 1 ) / 2, zz = ( m33 + 1 ) / 2;
			const xy = ( m12 + m21 ) / 4, xz = ( m13 + m31 ) / 4, yz = ( m23 + m32 ) / 4;
			let x, y, z;

			if ( xx > yy && xx > zz ) {

				if ( xx < epsilon ) {

					x = 0;
					y = 0.707106781;
					z = 0.707106781;

				} else {

					x = Math.sqrt( xx );
					y = xy / x;
					z = xz / x;

				}

			} else if ( yy > zz ) {

				if ( yy < epsilon ) {

					x = 0.707106781;
					y = 0;
					z = 0.707106781;

				} else {

					y = Math.sqrt( yy );
					x = xy / y;
					z = yz / y;

				}

			} else if ( zz < epsilon ) {

				x = 0.707106781;
				y = 0.707106781;
				z = 0;

			} else {

				z = Math.sqrt( zz );
				x = xz / z;
				y = yz / z;

			}

			return this.set( x, y, z, Math.PI );

		}

		let s = Math.sqrt( ( m32 - m23 ) * ( m32 - m23 ) + ( m13 - m31 ) * ( m13 - m31 ) + ( m21 - m12 ) * ( m21 - m12 ) );
		if ( Math.abs( s ) < 0.001 ) s = 1;
		this.x = ( m32 - m23 ) / s;
		this.y = ( m13 - m31 ) / s;
		this.z = ( m21 - m12 ) / s;
		this.w = Math.acos( ( m11 + m22 + m33 - 1 ) / 2 );
		return this;

	}

	setFromMatrixPosition( m ) {

		const e = m.elements;
		this.x = e[ 12 ];
		this.y = e[ 13 ];
		this.z = e[ 14 ];
		this.w = e[ 15 ];
		return this;

	}

	min( v ) {

		this.x = Math.min( this.x, v.x );
		this.y = Math.min( this.y, v.y );
		this.z = Math.min( this.z, v.z );
		this.w = Math.min( this.w, v.w );
		return this;

	}

	max( v ) {

		this.x = Math.max( this.x, v.x );
		this.y = Math.max( this.y, v.y );
		this.z = Math.max( this.z, v.z );
		this.w = Math.max( this.w, v.w );
		return this;

	}

	clamp( min, max ) {

		this.x = clamp( this.x, min.x, max.x );
		this.y = clamp( this.y, min.y, max.y );
		this.z = clamp( this.z, min.z, max.z );
		this.w = clamp( this.w, min.w, max.w );
		return this;

	}

	clampScalar( min, max ) {

		this.x = clamp( this.x, min, max );
		this.y = clamp( this.y, min, max );
		this.z = clamp( this.z, min, max );
		this.w = clamp( this.w, min, max );
		return this;

	}

	clampLength( min, max ) {

		const length = this.length();
		return this.divideScalar( length || 1 ).multiplyScalar( clamp( length, min, max ) );

	}

	floor() {

		this.x = Math.floor( this.x );
		this.y = Math.floor( this.y );
		this.z = Math.floor( this.z );
		this.w = Math.floor( this.w );
		return this;

	}

	ceil() {

		this.x = Math.ceil( this.x );
		this.y = Math.ceil( this.y );
		this.z = Math.ceil( this.z );
		this.w = Math.ceil( this.w );
		return this;

	}

	round() {

		this.x = Math.round( this.x );
		this.y = Math.round( this.y );
		this.z = Math.round( this.z );
		this.w = Math.round( this.w );
		return this;

	}

	roundToZero() {

		this.x = Math.trunc( this.x );
		this.y = Math.trunc( this.y );
		this.z = Math.trunc( this.z );
		this.w = Math.trunc( this.w );
		return this;

	}

	negate() {

		this.x = - this.x;
		this.y = - this.y;
		this.z = - this.z;
		this.w = - this.w;
		return this;

	}

	dot( v ) {

		return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;

	}

	lengthSq() {

		return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;

	}

	length() {

		return Math.sqrt( this.lengthSq() );

	}

	manhattanLength() {

		return Math.abs( this.x ) + Math.abs( this.y ) + Math.abs( this.z ) + Math.abs( this.w );

	}

	normalize() {

		return this.divideScalar( this.length() || 1 );

	}

	setLength( length ) {

		return this.normalize().multiplyScalar( length );

	}

	lerp( v, alpha ) {

		this.x += ( v.x - this.x ) * alpha;
		this.y += ( v.y - this.y ) * alpha;
		this.z += ( v.z - this.z ) * alpha;
		this.w += ( v.w - this.w ) * alpha;
		return this;

	}

	lerpVectors( v1, v2, alpha ) {

		this.x = v1.x + ( v2.x - v1.x ) * alpha;
		this.y = v1.y + ( v2.y - v1.y ) * alpha;
		this.z = v1.z + ( v2.z - v1.z ) * alpha;
		this.w = v1.w + ( v2.w - v1.w ) * alpha;
		return this;

	}

	equals( v ) {

		return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w;

	}

	fromArray( array, offset = 0 ) {

		this.x = array[ offset ];
		this.y = array[ offset + 1 ];
		this.z = array[ offset + 2 ];
		this.w = array[ offset + 3 ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.x;
		array[ offset + 1 ] = this.y;
		array[ offset + 2 ] = this.z;
		array[ offset + 3 ] = this.w;
		return array;

	}

	fromBufferAttribute( attribute, index ) {

		this.x = attribute.getX( index );
		this.y = attribute.getY( index );
		this.z = attribute.getZ( index );
		this.w = attribute.getW( index );
		return this;

	}

	random() {

		this.x = Math.random();
		this.y = Math.random();
		this.z = Math.random();
		this.w = Math.random();
		return this;

	}

	* [ Symbol.iterator ]() {

		yield this.x;
		yield this.y;
		yield this.z;
		yield this.w;

	}

}

Vector4.prototype.isVector4 = true;

// ---------------------------------------------------------------- Quaternion

export class Quaternion {

	constructor( x = 0, y = 0, z = 0, w = 1 ) {

		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;

	}

	static slerpFlat( dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t ) {

		let x0 = src0[ srcOffset0 ], y0 = src0[ srcOffset0 + 1 ], z0 = src0[ srcOffset0 + 2 ], w0 = src0[ srcOffset0 + 3 ];
		let x1 = src1[ srcOffset1 ], y1 = src1[ srcOffset1 + 1 ], z1 = src1[ srcOffset1 + 2 ], w1 = src1[ srcOffset1 + 3 ];

		if ( w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1 ) {

			let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;

			if ( dot < 0 ) {

				x1 = - x1;
				y1 = - y1;
				z1 = - z1;
				w1 = - w1;
				dot = - dot;

			}

			let s = 1 - t;

			if ( dot < 0.9995 ) {

				const theta = Math.acos( dot ), sin = Math.sin( theta );
				s = Math.sin( s * theta ) / sin;
				t = Math.sin( t * theta ) / sin;
				x0 = x0 * s + x1 * t;
				y0 = y0 * s + y1 * t;
				z0 = z0 * s + z1 * t;
				w0 = w0 * s + w1 * t;

			} else {

				// nearly parallel: a normalized linear blend
				x0 = x0 * s + x1 * t;
				y0 = y0 * s + y1 * t;
				z0 = z0 * s + z1 * t;
				w0 = w0 * s + w1 * t;
				const f = 1 / Math.sqrt( x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0 );
				x0 *= f;
				y0 *= f;
				z0 *= f;
				w0 *= f;

			}

		}

		dst[ dstOffset ] = x0;
		dst[ dstOffset + 1 ] = y0;
		dst[ dstOffset + 2 ] = z0;
		dst[ dstOffset + 3 ] = w0;

	}

	static multiplyQuaternionsFlat( dst, dstOffset, src0, srcOffset0, src1, srcOffset1 ) {

		const x0 = src0[ srcOffset0 ], y0 = src0[ srcOffset0 + 1 ], z0 = src0[ srcOffset0 + 2 ], w0 = src0[ srcOffset0 + 3 ];
		const x1 = src1[ srcOffset1 ], y1 = src1[ srcOffset1 + 1 ], z1 = src1[ srcOffset1 + 2 ], w1 = src1[ srcOffset1 + 3 ];
		dst[ dstOffset ] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
		dst[ dstOffset + 1 ] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
		dst[ dstOffset + 2 ] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
		dst[ dstOffset + 3 ] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;
		return dst;

	}

	set( x, y, z, w ) {

		this.x = x;
		this.y = y;
		this.z = z;
		this.w = w;
		return this;

	}

	clone() {

		return new this.constructor( this.x, this.y, this.z, this.w );

	}

	copy( q ) {

		return this.set( q.x, q.y, q.z, q.w );

	}

	setFromEuler( euler ) {

		const x = euler.x, y = euler.y, z = euler.z, order = euler.order;
		const c1 = Math.cos( x / 2 ), c2 = Math.cos( y / 2 ), c3 = Math.cos( z / 2 );
		const s1 = Math.sin( x / 2 ), s2 = Math.sin( y / 2 ), s3 = Math.sin( z / 2 );

		switch ( order ) {

			case 'XYZ': return this.set( s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3 );
			case 'YXZ': return this.set( s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3 );
			case 'ZXY': return this.set( s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3 );
			case 'ZYX': return this.set( s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3 );
			case 'YZX': return this.set( s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3 );
			case 'XZY': return this.set( s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3 );
			default: throw new Error( `WAMR3D: unknown Euler order: ${order}` );

		}

	}

	setFromAxisAngle( axis, angle ) {

		const half = angle / 2, s = Math.sin( half );
		return this.set( axis.x * s, axis.y * s, axis.z * s, Math.cos( half ) );

	}

	setFromRotationMatrix( m ) {

		const te = m.elements;
		const m11 = te[ 0 ], m12 = te[ 4 ], m13 = te[ 8 ];
		const m21 = te[ 1 ], m22 = te[ 5 ], m23 = te[ 9 ];
		const m31 = te[ 2 ], m32 = te[ 6 ], m33 = te[ 10 ];
		const trace = m11 + m22 + m33;

		if ( trace > 0 ) {

			const s = 0.5 / Math.sqrt( trace + 1 );
			return this.set( ( m32 - m23 ) * s, ( m13 - m31 ) * s, ( m21 - m12 ) * s, 0.25 / s );

		}

		if ( m11 > m22 && m11 > m33 ) {

			const s = 2 * Math.sqrt( 1 + m11 - m22 - m33 );
			return this.set( 0.25 * s, ( m12 + m21 ) / s, ( m13 + m31 ) / s, ( m32 - m23 ) / s );

		}

		if ( m22 > m33 ) {

			const s = 2 * Math.sqrt( 1 + m22 - m11 - m33 );
			return this.set( ( m12 + m21 ) / s, 0.25 * s, ( m23 + m32 ) / s, ( m13 - m31 ) / s );

		}

		const s = 2 * Math.sqrt( 1 + m33 - m11 - m22 );
		return this.set( ( m13 + m31 ) / s, ( m23 + m32 ) / s, 0.25 * s, ( m21 - m12 ) / s );

	}

	setFromUnitVectors( vFrom, vTo ) {

		let r = vFrom.dot( vTo ) + 1;

		if ( r < 1e-8 ) {

			// opposite vectors: any axis perpendicular to them
			r = 0;
			if ( Math.abs( vFrom.x ) > Math.abs( vFrom.z ) ) this.set( - vFrom.y, vFrom.x, 0, r );
			else this.set( 0, - vFrom.z, vFrom.y, r );

		} else {

			this.set( vFrom.y * vTo.z - vFrom.z * vTo.y, vFrom.z * vTo.x - vFrom.x * vTo.z, vFrom.x * vTo.y - vFrom.y * vTo.x, r );

		}

		return this.normalize();

	}

	angleTo( q ) {

		return 2 * Math.acos( Math.abs( clamp( this.dot( q ), - 1, 1 ) ) );

	}

	rotateTowards( q, step ) {

		const angle = this.angleTo( q );
		if ( angle === 0 ) return this;
		return this.slerp( q, Math.min( 1, step / angle ) );

	}

	identity() {

		return this.set( 0, 0, 0, 1 );

	}

	invert() {

		return this.conjugate();

	}

	conjugate() {

		return this.set( - this.x, - this.y, - this.z, this.w );

	}

	dot( q ) {

		return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;

	}

	lengthSq() {

		return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;

	}

	length() {

		return Math.sqrt( this.lengthSq() );

	}

	normalize() {

		let l = this.length();
		if ( l === 0 ) return this.set( 0, 0, 0, 1 );
		l = 1 / l;
		return this.set( this.x * l, this.y * l, this.z * l, this.w * l );

	}

	multiply( q ) {

		return this.multiplyQuaternions( this, q );

	}

	premultiply( q ) {

		return this.multiplyQuaternions( q, this );

	}

	multiplyQuaternions( a, b ) {

		const ax = a.x, ay = a.y, az = a.z, aw = a.w;
		const bx = b.x, by = b.y, bz = b.z, bw = b.w;
		return this.set( ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz );

	}

	slerp( qb, t ) {

		let x = qb.x, y = qb.y, z = qb.z, w = qb.w, dot = this.dot( qb );

		if ( dot < 0 ) {

			x = - x;
			y = - y;
			z = - z;
			w = - w;
			dot = - dot;

		}

		let s = 1 - t;

		if ( dot < 0.9995 ) {

			const theta = Math.acos( dot ), sin = Math.sin( theta );
			s = Math.sin( s * theta ) / sin;
			t = Math.sin( t * theta ) / sin;
			return this.set( this.x * s + x * t, this.y * s + y * t, this.z * s + z * t, this.w * s + w * t );

		}

		this.set( this.x * s + x * t, this.y * s + y * t, this.z * s + z * t, this.w * s + w * t );
		return this.normalize();

	}

	slerpQuaternions( qa, qb, t ) {

		return this.copy( qa ).slerp( qb, t );

	}

	random() {

		const theta1 = 2 * Math.PI * Math.random(), theta2 = 2 * Math.PI * Math.random();
		const x0 = Math.random(), r1 = Math.sqrt( 1 - x0 ), r2 = Math.sqrt( x0 );
		return this.set( r1 * Math.sin( theta1 ), r1 * Math.cos( theta1 ), r2 * Math.sin( theta2 ), r2 * Math.cos( theta2 ) );

	}

	equals( q ) {

		return q.x === this.x && q.y === this.y && q.z === this.z && q.w === this.w;

	}

	fromArray( array, offset = 0 ) {

		return this.set( array[ offset ], array[ offset + 1 ], array[ offset + 2 ], array[ offset + 3 ] );

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.x;
		array[ offset + 1 ] = this.y;
		array[ offset + 2 ] = this.z;
		array[ offset + 3 ] = this.w;
		return array;

	}

	fromBufferAttribute( attribute, index ) {

		return this.set( attribute.getX( index ), attribute.getY( index ), attribute.getZ( index ), attribute.getW( index ) );

	}

	toJSON() {

		return this.toArray();

	}

	* [ Symbol.iterator ]() {

		yield this.x;
		yield this.y;
		yield this.z;
		yield this.w;

	}

}

Quaternion.prototype.isQuaternion = true;

// ---------------------------------------------------------------- Euler

const ORDERS = [ 'XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY' ];

export class Euler {

	constructor( x = 0, y = 0, z = 0, order = Euler.DEFAULT_ORDER ) {

		this.x = x;
		this.y = y;
		this._order = order;
		this.z = z;

	}

	get order() {

		return this._order;

	}

	set order( value ) {

		if ( ! ORDERS.includes( value ) ) throw new Error( `WAMR3D: unknown Euler order: ${value}` );
		this._order = value;

	}

	set( x, y, z, order = this._order ) {

		this.x = x;
		this.y = y;
		this.z = z;
		this.order = order;
		return this;

	}

	clone() {

		return new this.constructor( this.x, this.y, this.z, this._order );

	}

	copy( euler ) {

		return this.set( euler.x, euler.y, euler.z, euler.order );

	}

	setFromRotationMatrix( m, order = this._order ) {

		const te = m.elements;
		const m11 = te[ 0 ], m12 = te[ 4 ], m13 = te[ 8 ];
		const m21 = te[ 1 ], m22 = te[ 5 ], m23 = te[ 9 ];
		const m31 = te[ 2 ], m32 = te[ 6 ], m33 = te[ 10 ];
		// near gimbal lock the second angle is ±90° and the third is taken as 0
		const free = 0.9999999;

		switch ( order ) {

			case 'XYZ':
				this.y = Math.asin( clamp( m13, - 1, 1 ) );
				if ( Math.abs( m13 ) < free ) {

					this.x = Math.atan2( - m23, m33 );
					this.z = Math.atan2( - m12, m11 );

				} else {

					this.x = Math.atan2( m32, m22 );
					this.z = 0;

				}

				break;

			case 'YXZ':
				this.x = Math.asin( - clamp( m23, - 1, 1 ) );
				if ( Math.abs( m23 ) < free ) {

					this.y = Math.atan2( m13, m33 );
					this.z = Math.atan2( m21, m22 );

				} else {

					this.y = Math.atan2( - m31, m11 );
					this.z = 0;

				}

				break;

			case 'ZXY':
				this.x = Math.asin( clamp( m32, - 1, 1 ) );
				if ( Math.abs( m32 ) < free ) {

					this.y = Math.atan2( - m31, m33 );
					this.z = Math.atan2( - m12, m22 );

				} else {

					this.y = 0;
					this.z = Math.atan2( m21, m11 );

				}

				break;

			case 'ZYX':
				this.y = Math.asin( - clamp( m31, - 1, 1 ) );
				if ( Math.abs( m31 ) < free ) {

					this.x = Math.atan2( m32, m33 );
					this.z = Math.atan2( m21, m11 );

				} else {

					this.x = 0;
					this.z = Math.atan2( - m12, m22 );

				}

				break;

			case 'YZX':
				this.z = Math.asin( clamp( m21, - 1, 1 ) );
				if ( Math.abs( m21 ) < free ) {

					this.x = Math.atan2( - m23, m22 );
					this.y = Math.atan2( - m31, m11 );

				} else {

					this.x = 0;
					this.y = Math.atan2( m13, m33 );

				}

				break;

			case 'XZY':
				this.z = Math.asin( - clamp( m12, - 1, 1 ) );
				if ( Math.abs( m12 ) < free ) {

					this.x = Math.atan2( m32, m22 );
					this.y = Math.atan2( m13, m11 );

				} else {

					this.x = Math.atan2( - m23, m33 );
					this.y = 0;

				}

				break;

			default: throw new Error( `WAMR3D: unknown Euler order: ${order}` );

		}

		this._order = order;
		return this;

	}

	setFromQuaternion( q, order = this._order ) {

		return this.setFromRotationMatrix( _matrix.makeRotationFromQuaternion( q ), order );

	}

	setFromVector3( v, order = this._order ) {

		return this.set( v.x, v.y, v.z, order );

	}

	reorder( newOrder ) {

		return this.setFromQuaternion( _quaternion.setFromEuler( this ), newOrder );

	}

	equals( euler ) {

		return euler.x === this.x && euler.y === this.y && euler.z === this.z && euler.order === this._order;

	}

	fromArray( array ) {

		return this.set( array[ 0 ], array[ 1 ], array[ 2 ], array[ 3 ] ?? this._order );

	}

	toArray( array = [], offset = 0 ) {

		array[ offset ] = this.x;
		array[ offset + 1 ] = this.y;
		array[ offset + 2 ] = this.z;
		array[ offset + 3 ] = this._order;
		return array;

	}

	* [ Symbol.iterator ]() {

		yield this.x;
		yield this.y;
		yield this.z;
		yield this._order;

	}

}

Euler.DEFAULT_ORDER = 'XYZ';
Euler.prototype.isEuler = true;

// ---------------------------------------------------------------- Matrix3

export class Matrix3 {

	constructor( n11, n12, n13, n21, n22, n23, n31, n32, n33 ) {

		this.elements = [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ];
		if ( n11 !== undefined ) this.set( n11, n12, n13, n21, n22, n23, n31, n32, n33 );

	}

	/** Row-major arguments; `elements` are column-major. */
	set( n11, n12, n13, n21, n22, n23, n31, n32, n33 ) {

		const te = this.elements;
		te[ 0 ] = n11; te[ 1 ] = n21; te[ 2 ] = n31;
		te[ 3 ] = n12; te[ 4 ] = n22; te[ 5 ] = n32;
		te[ 6 ] = n13; te[ 7 ] = n23; te[ 8 ] = n33;
		return this;

	}

	identity() {

		return this.set( 1, 0, 0, 0, 1, 0, 0, 0, 1 );

	}

	copy( m ) {

		const te = this.elements, me = m.elements;
		for ( let i = 0; i < 9; i ++ ) te[ i ] = me[ i ];
		return this;

	}

	extractBasis( xAxis, yAxis, zAxis ) {

		xAxis.setFromMatrix3Column( this, 0 );
		yAxis.setFromMatrix3Column( this, 1 );
		zAxis.setFromMatrix3Column( this, 2 );
		return this;

	}

	setFromMatrix4( m ) {

		const me = m.elements;
		return this.set( me[ 0 ], me[ 4 ], me[ 8 ], me[ 1 ], me[ 5 ], me[ 9 ], me[ 2 ], me[ 6 ], me[ 10 ] );

	}

	multiply( m ) {

		return this.multiplyMatrices( this, m );

	}

	premultiply( m ) {

		return this.multiplyMatrices( m, this );

	}

	multiplyMatrices( a, b ) {

		const ae = a.elements, be = b.elements, te = this.elements;
		const a11 = ae[ 0 ], a12 = ae[ 3 ], a13 = ae[ 6 ], a21 = ae[ 1 ], a22 = ae[ 4 ], a23 = ae[ 7 ], a31 = ae[ 2 ], a32 = ae[ 5 ], a33 = ae[ 8 ];
		const b11 = be[ 0 ], b12 = be[ 3 ], b13 = be[ 6 ], b21 = be[ 1 ], b22 = be[ 4 ], b23 = be[ 7 ], b31 = be[ 2 ], b32 = be[ 5 ], b33 = be[ 8 ];
		te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31;
		te[ 3 ] = a11 * b12 + a12 * b22 + a13 * b32;
		te[ 6 ] = a11 * b13 + a12 * b23 + a13 * b33;
		te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31;
		te[ 4 ] = a21 * b12 + a22 * b22 + a23 * b32;
		te[ 7 ] = a21 * b13 + a22 * b23 + a23 * b33;
		te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31;
		te[ 5 ] = a31 * b12 + a32 * b22 + a33 * b32;
		te[ 8 ] = a31 * b13 + a32 * b23 + a33 * b33;
		return this;

	}

	multiplyScalar( s ) {

		const te = this.elements;
		for ( let i = 0; i < 9; i ++ ) te[ i ] *= s;
		return this;

	}

	determinant() {

		const te = this.elements;
		const a = te[ 0 ], b = te[ 1 ], c = te[ 2 ], d = te[ 3 ], e = te[ 4 ], f = te[ 5 ], g = te[ 6 ], h = te[ 7 ], i = te[ 8 ];
		return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;

	}

	invert() {

		const te = this.elements;
		const n11 = te[ 0 ], n21 = te[ 1 ], n31 = te[ 2 ], n12 = te[ 3 ], n22 = te[ 4 ], n32 = te[ 5 ], n13 = te[ 6 ], n23 = te[ 7 ], n33 = te[ 8 ];
		const t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13;
		const det = n11 * t11 + n21 * t12 + n31 * t13;
		if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0 );
		const detInv = 1 / det;
		te[ 0 ] = t11 * detInv;
		te[ 1 ] = ( n31 * n23 - n33 * n21 ) * detInv;
		te[ 2 ] = ( n32 * n21 - n31 * n22 ) * detInv;
		te[ 3 ] = t12 * detInv;
		te[ 4 ] = ( n33 * n11 - n31 * n13 ) * detInv;
		te[ 5 ] = ( n31 * n12 - n32 * n11 ) * detInv;
		te[ 6 ] = t13 * detInv;
		te[ 7 ] = ( n21 * n13 - n23 * n11 ) * detInv;
		te[ 8 ] = ( n22 * n11 - n21 * n12 ) * detInv;
		return this;

	}

	transpose() {

		const m = this.elements;
		let t = m[ 1 ]; m[ 1 ] = m[ 3 ]; m[ 3 ] = t;
		t = m[ 2 ]; m[ 2 ] = m[ 6 ]; m[ 6 ] = t;
		t = m[ 5 ]; m[ 5 ] = m[ 7 ]; m[ 7 ] = t;
		return this;

	}

	getNormalMatrix( matrix4 ) {

		return this.setFromMatrix4( matrix4 ).invert().transpose();

	}

	transposeIntoArray( r ) {

		const m = this.elements;
		r[ 0 ] = m[ 0 ]; r[ 1 ] = m[ 3 ]; r[ 2 ] = m[ 6 ];
		r[ 3 ] = m[ 1 ]; r[ 4 ] = m[ 4 ]; r[ 5 ] = m[ 7 ];
		r[ 6 ] = m[ 2 ]; r[ 7 ] = m[ 5 ]; r[ 8 ] = m[ 8 ];
		return this;

	}

	setUvTransform( tx, ty, sx, sy, rotation, cx, cy ) {

		const c = Math.cos( rotation ), s = Math.sin( rotation );
		return this.set( sx * c, sx * s, - sx * ( c * cx + s * cy ) + cx + tx, - sy * s, sy * c, - sy * ( - s * cx + c * cy ) + cy + ty, 0, 0, 1 );

	}

	makeTranslation( x, y ) {

		return x.isVector2 ? this.set( 1, 0, x.x, 0, 1, x.y, 0, 0, 1 ) : this.set( 1, 0, x, 0, 1, y, 0, 0, 1 );

	}

	makeRotation( theta ) {

		const c = Math.cos( theta ), s = Math.sin( theta );
		return this.set( c, - s, 0, s, c, 0, 0, 0, 1 );

	}

	makeScale( x, y ) {

		return this.set( x, 0, 0, 0, y, 0, 0, 0, 1 );

	}

	equals( matrix ) {

		const te = this.elements, me = matrix.elements;
		for ( let i = 0; i < 9; i ++ ) if ( te[ i ] !== me[ i ] ) return false;
		return true;

	}

	fromArray( array, offset = 0 ) {

		const te = this.elements;
		for ( let i = 0; i < 9; i ++ ) te[ i ] = array[ i + offset ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		const te = this.elements;
		for ( let i = 0; i < 9; i ++ ) array[ offset + i ] = te[ i ];
		return array;

	}

	clone() {

		return new this.constructor().fromArray( this.elements );

	}

}

Matrix3.prototype.isMatrix3 = true;

// ---------------------------------------------------------------- Matrix4

export const WebGLCoordinateSystem = 2000, WebGPUCoordinateSystem = 2001;

export class Matrix4 {

	constructor( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

		this.elements = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ];
		if ( n11 !== undefined ) this.set( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 );

	}

	/** Row-major arguments; `elements` are column-major. */
	set( n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44 ) {

		const te = this.elements;
		te[ 0 ] = n11; te[ 4 ] = n12; te[ 8 ] = n13; te[ 12 ] = n14;
		te[ 1 ] = n21; te[ 5 ] = n22; te[ 9 ] = n23; te[ 13 ] = n24;
		te[ 2 ] = n31; te[ 6 ] = n32; te[ 10 ] = n33; te[ 14 ] = n34;
		te[ 3 ] = n41; te[ 7 ] = n42; te[ 11 ] = n43; te[ 15 ] = n44;
		return this;

	}

	identity() {

		return this.set( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );

	}

	clone() {

		return new this.constructor().fromArray( this.elements );

	}

	copy( m ) {

		const te = this.elements, me = m.elements;
		for ( let i = 0; i < 16; i ++ ) te[ i ] = me[ i ];
		return this;

	}

	copyPosition( m ) {

		const te = this.elements, me = m.elements;
		te[ 12 ] = me[ 12 ];
		te[ 13 ] = me[ 13 ];
		te[ 14 ] = me[ 14 ];
		return this;

	}

	setFromMatrix3( m ) {

		const me = m.elements;
		return this.set( me[ 0 ], me[ 3 ], me[ 6 ], 0, me[ 1 ], me[ 4 ], me[ 7 ], 0, me[ 2 ], me[ 5 ], me[ 8 ], 0, 0, 0, 0, 1 );

	}

	extractBasis( xAxis, yAxis, zAxis ) {

		if ( this.determinantAffine() === 0 ) {

			xAxis.set( 1, 0, 0 );
			yAxis.set( 0, 1, 0 );
			zAxis.set( 0, 0, 1 );
			return this;

		}

		xAxis.setFromMatrixColumn( this, 0 );
		yAxis.setFromMatrixColumn( this, 1 );
		zAxis.setFromMatrixColumn( this, 2 );
		return this;

	}

	makeBasis( xAxis, yAxis, zAxis ) {

		return this.set( xAxis.x, yAxis.x, zAxis.x, 0, xAxis.y, yAxis.y, zAxis.y, 0, xAxis.z, yAxis.z, zAxis.z, 0, 0, 0, 0, 1 );

	}

	extractRotation( m ) {

		if ( m.determinantAffine() === 0 ) return this.identity();
		const te = this.elements, me = m.elements;
		const scaleX = 1 / _v1.setFromMatrixColumn( m, 0 ).length();
		const scaleY = 1 / _v1.setFromMatrixColumn( m, 1 ).length();
		const scaleZ = 1 / _v1.setFromMatrixColumn( m, 2 ).length();
		te[ 0 ] = me[ 0 ] * scaleX; te[ 1 ] = me[ 1 ] * scaleX; te[ 2 ] = me[ 2 ] * scaleX; te[ 3 ] = 0;
		te[ 4 ] = me[ 4 ] * scaleY; te[ 5 ] = me[ 5 ] * scaleY; te[ 6 ] = me[ 6 ] * scaleY; te[ 7 ] = 0;
		te[ 8 ] = me[ 8 ] * scaleZ; te[ 9 ] = me[ 9 ] * scaleZ; te[ 10 ] = me[ 10 ] * scaleZ; te[ 11 ] = 0;
		te[ 12 ] = 0; te[ 13 ] = 0; te[ 14 ] = 0; te[ 15 ] = 1;
		return this;

	}

	makeRotationFromEuler( euler ) {

		const te = this.elements, order = euler.order;
		const x = euler.x, y = euler.y, z = euler.z;
		const a = Math.cos( x ), b = Math.sin( x ), c = Math.cos( y ), d = Math.sin( y ), e = Math.cos( z ), f = Math.sin( z );

		if ( order === 'XYZ' ) {

			const ae = a * e, af = a * f, be = b * e, bf = b * f;
			te[ 0 ] = c * e; te[ 4 ] = - c * f; te[ 8 ] = d;
			te[ 1 ] = af + be * d; te[ 5 ] = ae - bf * d; te[ 9 ] = - b * c;
			te[ 2 ] = bf - ae * d; te[ 6 ] = be + af * d; te[ 10 ] = a * c;

		} else if ( order === 'YXZ' ) {

			const ce = c * e, cf = c * f, de = d * e, df = d * f;
			te[ 0 ] = ce + df * b; te[ 4 ] = de * b - cf; te[ 8 ] = a * d;
			te[ 1 ] = a * f; te[ 5 ] = a * e; te[ 9 ] = - b;
			te[ 2 ] = cf * b - de; te[ 6 ] = df + ce * b; te[ 10 ] = a * c;

		} else if ( order === 'ZXY' ) {

			const ce = c * e, cf = c * f, de = d * e, df = d * f;
			te[ 0 ] = ce - df * b; te[ 4 ] = - a * f; te[ 8 ] = de + cf * b;
			te[ 1 ] = cf + de * b; te[ 5 ] = a * e; te[ 9 ] = df - ce * b;
			te[ 2 ] = - a * d; te[ 6 ] = b; te[ 10 ] = a * c;

		} else if ( order === 'ZYX' ) {

			const ae = a * e, af = a * f, be = b * e, bf = b * f;
			te[ 0 ] = c * e; te[ 4 ] = be * d - af; te[ 8 ] = ae * d + bf;
			te[ 1 ] = c * f; te[ 5 ] = bf * d + ae; te[ 9 ] = af * d - be;
			te[ 2 ] = - d; te[ 6 ] = b * c; te[ 10 ] = a * c;

		} else if ( order === 'YZX' ) {

			const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
			te[ 0 ] = c * e; te[ 4 ] = bd - ac * f; te[ 8 ] = bc * f + ad;
			te[ 1 ] = f; te[ 5 ] = a * e; te[ 9 ] = - b * e;
			te[ 2 ] = - d * e; te[ 6 ] = ad * f + bc; te[ 10 ] = ac - bd * f;

		} else if ( order === 'XZY' ) {

			const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
			te[ 0 ] = c * e; te[ 4 ] = - f; te[ 8 ] = d * e;
			te[ 1 ] = ac * f + bd; te[ 5 ] = a * e; te[ 9 ] = ad * f - bc;
			te[ 2 ] = bc * f - ad; te[ 6 ] = b * e; te[ 10 ] = bd * f + ac;

		}

		te[ 3 ] = 0; te[ 7 ] = 0; te[ 11 ] = 0;
		te[ 12 ] = 0; te[ 13 ] = 0; te[ 14 ] = 0; te[ 15 ] = 1;
		return this;

	}

	makeRotationFromQuaternion( q ) {

		return this.compose( _zero, q, _one );

	}

	lookAt( eye, target, up ) {

		const te = this.elements;
		_z.subVectors( eye, target );
		// eye and target in the same place
		if ( _z.lengthSq() === 0 ) _z.z = 1;
		_z.normalize();
		_x.crossVectors( up, _z );

		if ( _x.lengthSq() === 0 ) {

			// up parallel to the view direction: nudge the direction
			if ( Math.abs( up.z ) === 1 ) _z.x += 0.0001;
			else _z.z += 0.0001;
			_z.normalize();
			_x.crossVectors( up, _z );

		}

		_x.normalize();
		_y.crossVectors( _z, _x );
		te[ 0 ] = _x.x; te[ 4 ] = _y.x; te[ 8 ] = _z.x;
		te[ 1 ] = _x.y; te[ 5 ] = _y.y; te[ 9 ] = _z.y;
		te[ 2 ] = _x.z; te[ 6 ] = _y.z; te[ 10 ] = _z.z;
		return this;

	}

	multiply( m ) {

		return this.multiplyMatrices( this, m );

	}

	premultiply( m ) {

		return this.multiplyMatrices( m, this );

	}

	multiplyMatrices( a, b ) {

		const ae = a.elements, be = b.elements, te = this.elements;
		const a11 = ae[ 0 ], a12 = ae[ 4 ], a13 = ae[ 8 ], a14 = ae[ 12 ];
		const a21 = ae[ 1 ], a22 = ae[ 5 ], a23 = ae[ 9 ], a24 = ae[ 13 ];
		const a31 = ae[ 2 ], a32 = ae[ 6 ], a33 = ae[ 10 ], a34 = ae[ 14 ];
		const a41 = ae[ 3 ], a42 = ae[ 7 ], a43 = ae[ 11 ], a44 = ae[ 15 ];
		const b11 = be[ 0 ], b12 = be[ 4 ], b13 = be[ 8 ], b14 = be[ 12 ];
		const b21 = be[ 1 ], b22 = be[ 5 ], b23 = be[ 9 ], b24 = be[ 13 ];
		const b31 = be[ 2 ], b32 = be[ 6 ], b33 = be[ 10 ], b34 = be[ 14 ];
		const b41 = be[ 3 ], b42 = be[ 7 ], b43 = be[ 11 ], b44 = be[ 15 ];
		te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
		te[ 4 ] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
		te[ 8 ] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
		te[ 12 ] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
		te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
		te[ 5 ] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
		te[ 9 ] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
		te[ 13 ] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
		te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
		te[ 6 ] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
		te[ 10 ] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
		te[ 14 ] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
		te[ 3 ] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
		te[ 7 ] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
		te[ 11 ] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
		te[ 15 ] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
		return this;

	}

	multiplyScalar( s ) {

		const te = this.elements;
		for ( let i = 0; i < 16; i ++ ) te[ i ] *= s;
		return this;

	}

	determinant() {

		const te = this.elements;
		const n11 = te[ 0 ], n12 = te[ 4 ], n13 = te[ 8 ], n14 = te[ 12 ];
		const n21 = te[ 1 ], n22 = te[ 5 ], n23 = te[ 9 ], n24 = te[ 13 ];
		const n31 = te[ 2 ], n32 = te[ 6 ], n33 = te[ 10 ], n34 = te[ 14 ];
		const n41 = te[ 3 ], n42 = te[ 7 ], n43 = te[ 11 ], n44 = te[ 15 ];
		const t11 = n23 * n34 - n24 * n33, t12 = n22 * n34 - n24 * n32, t13 = n22 * n33 - n23 * n32;
		const t21 = n21 * n34 - n24 * n31, t22 = n21 * n33 - n23 * n31, t23 = n21 * n32 - n22 * n31;
		return n11 * ( n42 * t11 - n43 * t12 + n44 * t13 ) - n12 * ( n41 * t11 - n43 * t21 + n44 * t22 ) + n13 * ( n41 * t12 - n42 * t21 + n44 * t23 ) - n14 * ( n41 * t13 - n42 * t22 + n43 * t23 );

	}

	determinantAffine() {

		const te = this.elements;
		const n11 = te[ 0 ], n12 = te[ 4 ], n13 = te[ 8 ], n21 = te[ 1 ], n22 = te[ 5 ], n23 = te[ 9 ], n31 = te[ 2 ], n32 = te[ 6 ], n33 = te[ 10 ];
		return n11 * ( n22 * n33 - n23 * n32 ) - n12 * ( n21 * n33 - n23 * n31 ) + n13 * ( n21 * n32 - n22 * n31 );

	}

	transpose() {

		const te = this.elements;
		let t = te[ 1 ]; te[ 1 ] = te[ 4 ]; te[ 4 ] = t;
		t = te[ 2 ]; te[ 2 ] = te[ 8 ]; te[ 8 ] = t;
		t = te[ 6 ]; te[ 6 ] = te[ 9 ]; te[ 9 ] = t;
		t = te[ 3 ]; te[ 3 ] = te[ 12 ]; te[ 12 ] = t;
		t = te[ 7 ]; te[ 7 ] = te[ 13 ]; te[ 13 ] = t;
		t = te[ 11 ]; te[ 11 ] = te[ 14 ]; te[ 14 ] = t;
		return this;

	}

	setPosition( x, y, z ) {

		const te = this.elements;

		if ( typeof x === 'object' ) {

			te[ 12 ] = x.x;
			te[ 13 ] = x.y;
			te[ 14 ] = x.z;

		} else {

			te[ 12 ] = x;
			te[ 13 ] = y;
			te[ 14 ] = z;

		}

		return this;

	}

	invert() {

		const te = this.elements;
		const n11 = te[ 0 ], n21 = te[ 1 ], n31 = te[ 2 ], n41 = te[ 3 ];
		const n12 = te[ 4 ], n22 = te[ 5 ], n32 = te[ 6 ], n42 = te[ 7 ];
		const n13 = te[ 8 ], n23 = te[ 9 ], n33 = te[ 10 ], n43 = te[ 11 ];
		const n14 = te[ 12 ], n24 = te[ 13 ], n34 = te[ 14 ], n44 = te[ 15 ];
		const t1 = n11 * n22 - n21 * n12, t2 = n11 * n32 - n31 * n12, t3 = n11 * n42 - n41 * n12;
		const t4 = n21 * n32 - n31 * n22, t5 = n21 * n42 - n41 * n22, t6 = n31 * n42 - n41 * n32;
		const t7 = n13 * n24 - n23 * n14, t8 = n13 * n34 - n33 * n14, t9 = n13 * n44 - n43 * n14;
		const t10 = n23 * n34 - n33 * n24, t11 = n23 * n44 - n43 * n24, t12 = n33 * n44 - n43 * n34;
		const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;
		if ( det === 0 ) return this.set( 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 );
		const detInv = 1 / det;
		te[ 0 ] = ( n22 * t12 - n32 * t11 + n42 * t10 ) * detInv;
		te[ 1 ] = ( n31 * t11 - n21 * t12 - n41 * t10 ) * detInv;
		te[ 2 ] = ( n24 * t6 - n34 * t5 + n44 * t4 ) * detInv;
		te[ 3 ] = ( n33 * t5 - n23 * t6 - n43 * t4 ) * detInv;
		te[ 4 ] = ( n32 * t9 - n12 * t12 - n42 * t8 ) * detInv;
		te[ 5 ] = ( n11 * t12 - n31 * t9 + n41 * t8 ) * detInv;
		te[ 6 ] = ( n34 * t3 - n14 * t6 - n44 * t2 ) * detInv;
		te[ 7 ] = ( n13 * t6 - n33 * t3 + n43 * t2 ) * detInv;
		te[ 8 ] = ( n12 * t11 - n22 * t9 + n42 * t7 ) * detInv;
		te[ 9 ] = ( n21 * t9 - n11 * t11 - n41 * t7 ) * detInv;
		te[ 10 ] = ( n14 * t5 - n24 * t3 + n44 * t1 ) * detInv;
		te[ 11 ] = ( n23 * t3 - n13 * t5 - n43 * t1 ) * detInv;
		te[ 12 ] = ( n22 * t8 - n12 * t10 - n32 * t7 ) * detInv;
		te[ 13 ] = ( n11 * t10 - n21 * t8 + n31 * t7 ) * detInv;
		te[ 14 ] = ( n24 * t2 - n14 * t4 - n34 * t1 ) * detInv;
		te[ 15 ] = ( n13 * t4 - n23 * t2 + n33 * t1 ) * detInv;
		return this;

	}

	scale( v ) {

		const te = this.elements, x = v.x, y = v.y, z = v.z;
		te[ 0 ] *= x; te[ 4 ] *= y; te[ 8 ] *= z;
		te[ 1 ] *= x; te[ 5 ] *= y; te[ 9 ] *= z;
		te[ 2 ] *= x; te[ 6 ] *= y; te[ 10 ] *= z;
		te[ 3 ] *= x; te[ 7 ] *= y; te[ 11 ] *= z;
		return this;

	}

	getMaxScaleOnAxis() {

		const te = this.elements;
		const x = te[ 0 ] * te[ 0 ] + te[ 1 ] * te[ 1 ] + te[ 2 ] * te[ 2 ];
		const y = te[ 4 ] * te[ 4 ] + te[ 5 ] * te[ 5 ] + te[ 6 ] * te[ 6 ];
		const z = te[ 8 ] * te[ 8 ] + te[ 9 ] * te[ 9 ] + te[ 10 ] * te[ 10 ];
		return Math.sqrt( Math.max( x, y, z ) );

	}

	makeTranslation( x, y, z ) {

		return typeof x === 'object'
			? this.set( 1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1 )
			: this.set( 1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1 );

	}

	makeRotationX( theta ) {

		const c = Math.cos( theta ), s = Math.sin( theta );
		return this.set( 1, 0, 0, 0, 0, c, - s, 0, 0, s, c, 0, 0, 0, 0, 1 );

	}

	makeRotationY( theta ) {

		const c = Math.cos( theta ), s = Math.sin( theta );
		return this.set( c, 0, s, 0, 0, 1, 0, 0, - s, 0, c, 0, 0, 0, 0, 1 );

	}

	makeRotationZ( theta ) {

		const c = Math.cos( theta ), s = Math.sin( theta );
		return this.set( c, - s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );

	}

	makeRotationAxis( axis, angle ) {

		const c = Math.cos( angle ), s = Math.sin( angle ), t = 1 - c;
		const x = axis.x, y = axis.y, z = axis.z, tx = t * x, ty = t * y;
		return this.set(
			tx * x + c, tx * y - s * z, tx * z + s * y, 0,
			tx * y + s * z, ty * y + c, ty * z - s * x, 0,
			tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
			0, 0, 0, 1
		);

	}

	makeScale( x, y, z ) {

		return this.set( x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1 );

	}

	makeShear( xy, xz, yx, yz, zx, zy ) {

		return this.set( 1, yx, zx, 0, xy, 1, zy, 0, xz, yz, 1, 0, 0, 0, 0, 1 );

	}

	compose( position, quaternion, scale ) {

		const te = this.elements;
		const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w;
		const x2 = x + x, y2 = y + y, z2 = z + z;
		const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
		const wx = w * x2, wy = w * y2, wz = w * z2;
		const sx = scale.x, sy = scale.y, sz = scale.z;
		te[ 0 ] = ( 1 - ( yy + zz ) ) * sx; te[ 1 ] = ( xy + wz ) * sx; te[ 2 ] = ( xz - wy ) * sx; te[ 3 ] = 0;
		te[ 4 ] = ( xy - wz ) * sy; te[ 5 ] = ( 1 - ( xx + zz ) ) * sy; te[ 6 ] = ( yz + wx ) * sy; te[ 7 ] = 0;
		te[ 8 ] = ( xz + wy ) * sz; te[ 9 ] = ( yz - wx ) * sz; te[ 10 ] = ( 1 - ( xx + yy ) ) * sz; te[ 11 ] = 0;
		te[ 12 ] = position.x; te[ 13 ] = position.y; te[ 14 ] = position.z; te[ 15 ] = 1;
		return this;

	}

	decompose( position, quaternion, scale ) {

		const te = this.elements;
		position.set( te[ 12 ], te[ 13 ], te[ 14 ] );
		const det = this.determinantAffine();

		if ( det === 0 ) {

			scale.set( 1, 1, 1 );
			quaternion.identity();
			return this;

		}

		let sx = _v1.set( te[ 0 ], te[ 1 ], te[ 2 ] ).length();
		const sy = _v1.set( te[ 4 ], te[ 5 ], te[ 6 ] ).length();
		const sz = _v1.set( te[ 8 ], te[ 9 ], te[ 10 ] ).length();
		// a negative determinant means a mirroring: it is put on x
		if ( det < 0 ) sx = - sx;
		const me = _m1.copy( this ).elements;
		me[ 0 ] /= sx; me[ 1 ] /= sx; me[ 2 ] /= sx;
		me[ 4 ] /= sy; me[ 5 ] /= sy; me[ 6 ] /= sy;
		me[ 8 ] /= sz; me[ 9 ] /= sz; me[ 10 ] /= sz;
		quaternion.setFromRotationMatrix( _m1 );
		scale.set( sx, sy, sz );
		return this;

	}

	makePerspective( left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		const te = this.elements;
		const x = 2 * near / ( right - left ), y = 2 * near / ( top - bottom );
		const a = ( right + left ) / ( right - left ), b = ( top + bottom ) / ( top - bottom );
		const [ c, d ] = depthRange( near, far, coordinateSystem, reversedDepth, true );
		te[ 0 ] = x; te[ 4 ] = 0; te[ 8 ] = a; te[ 12 ] = 0;
		te[ 1 ] = 0; te[ 5 ] = y; te[ 9 ] = b; te[ 13 ] = 0;
		te[ 2 ] = 0; te[ 6 ] = 0; te[ 10 ] = c; te[ 14 ] = d;
		te[ 3 ] = 0; te[ 7 ] = 0; te[ 11 ] = - 1; te[ 15 ] = 0;
		return this;

	}

	makeOrthographic( left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false ) {

		const te = this.elements;
		const x = 2 / ( right - left ), y = 2 / ( top - bottom );
		const a = - ( right + left ) / ( right - left ), b = - ( top + bottom ) / ( top - bottom );
		const [ c, d ] = depthRange( near, far, coordinateSystem, reversedDepth, false );
		te[ 0 ] = x; te[ 4 ] = 0; te[ 8 ] = 0; te[ 12 ] = a;
		te[ 1 ] = 0; te[ 5 ] = y; te[ 9 ] = 0; te[ 13 ] = b;
		te[ 2 ] = 0; te[ 6 ] = 0; te[ 10 ] = c; te[ 14 ] = d;
		te[ 3 ] = 0; te[ 7 ] = 0; te[ 11 ] = 0; te[ 15 ] = 1;
		return this;

	}

	equals( matrix ) {

		const te = this.elements, me = matrix.elements;
		for ( let i = 0; i < 16; i ++ ) if ( te[ i ] !== me[ i ] ) return false;
		return true;

	}

	fromArray( array, offset = 0 ) {

		const te = this.elements;
		for ( let i = 0; i < 16; i ++ ) te[ i ] = array[ i + offset ];
		return this;

	}

	toArray( array = [], offset = 0 ) {

		const te = this.elements;
		for ( let i = 0; i < 16; i ++ ) array[ offset + i ] = te[ i ];
		return array;

	}

}

Matrix4.prototype.isMatrix4 = true;

// The depth terms (third row) of a projection: scale and offset mapping near..far to
// -1..1 (WebGL), 0..1 (WebGPU), or 1..0 with reversed depth.
function depthRange( near, far, coordinateSystem, reversedDepth, perspective ) {

	const range = far - near;
	if ( reversedDepth ) return perspective ? [ near / range, far * near / range ] : [ 1 / range, far / range ];
	if ( coordinateSystem === WebGLCoordinateSystem ) return perspective ? [ - ( far + near ) / range, - 2 * far * near / range ] : [ - 2 / range, - ( far + near ) / range ];
	if ( coordinateSystem === WebGPUCoordinateSystem ) return perspective ? [ - far / range, - far * near / range ] : [ - 1 / range, - near / range ];
	throw new Error( `WAMR3D: invalid coordinate system: ${coordinateSystem}` );

}

// ---------------------------------------------------------------- Box3

export class Box3 {

	constructor( min = new Vector3( Infinity, Infinity, Infinity ), max = new Vector3( - Infinity, - Infinity, - Infinity ) ) {

		this.min = min;
		this.max = max;

	}

	set( min, max ) {

		this.min.copy( min );
		this.max.copy( max );
		return this;

	}

	setFromArray( array ) {

		this.makeEmpty();
		for ( let i = 0; i < array.length; i += 3 ) this.expandByPoint( _vector.fromArray( array, i ) );
		return this;

	}

	setFromBufferAttribute( attribute ) {

		this.makeEmpty();
		for ( let i = 0; i < attribute.count; i ++ ) this.expandByPoint( _vector.fromBufferAttribute( attribute, i ) );
		return this;

	}

	setFromPoints( points ) {

		this.makeEmpty();
		for ( let i = 0; i < points.length; i ++ ) this.expandByPoint( points[ i ] );
		return this;

	}

	setFromCenterAndSize( center, size ) {

		const half = _vector.copy( size ).multiplyScalar( 0.5 );
		this.min.copy( center ).sub( half );
		this.max.copy( center ).add( half );
		return this;

	}

	/**
	 * The world-space box around `object` and its descendants: their geometries' boxes
	 * transformed by their world matrices, or every vertex with `precise`.
	 */
	setFromObject( object, precise = false ) {

		this.makeEmpty();
		return this.expandByObject( object, precise );

	}

	expandByObject( object, precise = false ) {

		object.updateWorldMatrix( false, false );
		const geometry = object.geometry;

		if ( geometry !== undefined && geometry.isBufferGeometry ) {

			const m = object.matrixWorld, position = geometry.attributes.position;

			if ( precise && position !== undefined && ! object.isInstancedMesh ) {

				for ( let i = 0; i < position.count; i ++ ) this.expandByPoint( _vector.fromBufferAttribute( position, i ).applyMatrix4( m ) );

			} else {

				let box;

				if ( object.isInstancedMesh ) {

					if ( object.boundingBox === null ) object.computeBoundingBox();
					box = object.boundingBox;

				} else {

					if ( geometry.boundingBox === null ) geometry.computeBoundingBox();
					box = geometry.boundingBox;

				}

				this.union( _box.copy( box ).applyMatrix4( m ) );

			}

		}

		for ( const child of object.children ) this.expandByObject( child, precise );
		return this;

	}

	clone() {

		return new this.constructor().copy( this );

	}

	copy( box ) {

		this.min.copy( box.min );
		this.max.copy( box.max );
		return this;

	}

	makeEmpty() {

		this.min.x = this.min.y = this.min.z = Infinity;
		this.max.x = this.max.y = this.max.z = - Infinity;
		return this;

	}

	isEmpty() {

		return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;

	}

	getCenter( target = new Vector3() ) {

		return this.isEmpty() ? target.set( 0, 0, 0 ) : target.addVectors( this.min, this.max ).multiplyScalar( 0.5 );

	}

	getSize( target = new Vector3() ) {

		return this.isEmpty() ? target.set( 0, 0, 0 ) : target.subVectors( this.max, this.min );

	}

	expandByPoint( point ) {

		this.min.min( point );
		this.max.max( point );
		return this;

	}

	expandByVector( vector ) {

		this.min.sub( vector );
		this.max.add( vector );
		return this;

	}

	expandByScalar( scalar ) {

		this.min.addScalar( - scalar );
		this.max.addScalar( scalar );
		return this;

	}

	containsPoint( point ) {

		return point.x >= this.min.x && point.x <= this.max.x && point.y >= this.min.y && point.y <= this.max.y && point.z >= this.min.z && point.z <= this.max.z;

	}

	containsBox( box ) {

		return this.min.x <= box.min.x && box.max.x <= this.max.x && this.min.y <= box.min.y && box.max.y <= this.max.y && this.min.z <= box.min.z && box.max.z <= this.max.z;

	}

	getParameter( point, target ) {

		return target.set( ( point.x - this.min.x ) / ( this.max.x - this.min.x ), ( point.y - this.min.y ) / ( this.max.y - this.min.y ), ( point.z - this.min.z ) / ( this.max.z - this.min.z ) );

	}

	intersectsBox( box ) {

		return box.max.x >= this.min.x && box.min.x <= this.max.x && box.max.y >= this.min.y && box.min.y <= this.max.y && box.max.z >= this.min.z && box.min.z <= this.max.z;

	}

	intersectsSphere( sphere ) {

		this.clampPoint( sphere.center, _vector );
		return _vector.distanceToSquared( sphere.center ) <= sphere.radius * sphere.radius;

	}

	intersectsPlane( plane ) {

		// the box's extent along the normal, against the plane's offset
		const n = plane.normal;
		let min = n.x > 0 ? n.x * this.min.x : n.x * this.max.x, max = n.x > 0 ? n.x * this.max.x : n.x * this.min.x;
		min += n.y > 0 ? n.y * this.min.y : n.y * this.max.y;
		max += n.y > 0 ? n.y * this.max.y : n.y * this.min.y;
		min += n.z > 0 ? n.z * this.min.z : n.z * this.max.z;
		max += n.z > 0 ? n.z * this.max.z : n.z * this.min.z;
		return min <= - plane.constant && max >= - plane.constant;

	}

	intersectsTriangle( triangle ) {

		if ( this.isEmpty() ) return false;
		// separating axes: the edge cross products, the box axes, the triangle normal
		this.getCenter( _center );
		_extents.subVectors( this.max, _center );
		_v0.subVectors( triangle.a, _center );
		_v1.subVectors( triangle.b, _center );
		_v2.subVectors( triangle.c, _center );
		_f0.subVectors( _v1, _v0 );
		_f1.subVectors( _v2, _v1 );
		_f2.subVectors( _v0, _v2 );
		const edges = [
			0, - _f0.z, _f0.y, 0, - _f1.z, _f1.y, 0, - _f2.z, _f2.y,
			_f0.z, 0, - _f0.x, _f1.z, 0, - _f1.x, _f2.z, 0, - _f2.x,
			- _f0.y, _f0.x, 0, - _f1.y, _f1.x, 0, - _f2.y, _f2.x, 0
		];
		if ( ! separated( edges ) ) return false;
		if ( ! separated( [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] ) ) return false;
		_normal.crossVectors( _f0, _f1 );
		return separated( [ _normal.x, _normal.y, _normal.z ] );

	}

	clampPoint( point, target = new Vector3() ) {

		return target.copy( point ).clamp( this.min, this.max );

	}

	distanceToPoint( point ) {

		return this.clampPoint( point, _vector ).distanceTo( point );

	}

	getBoundingSphere( target = new Sphere() ) {

		if ( this.isEmpty() ) return target.makeEmpty();
		this.getCenter( target.center );
		target.radius = this.getSize( _vector ).length() * 0.5;
		return target;

	}

	intersect( box ) {

		this.min.max( box.min );
		this.max.min( box.max );
		if ( this.isEmpty() ) this.makeEmpty();
		return this;

	}

	union( box ) {

		this.min.min( box.min );
		this.max.max( box.max );
		return this;

	}

	applyMatrix4( matrix ) {

		if ( this.isEmpty() ) return this;
		const min = this.min, max = this.max;
		for ( let i = 0; i < 8; i ++ ) _points[ i ].set( i & 4 ? max.x : min.x, i & 2 ? max.y : min.y, i & 1 ? max.z : min.z ).applyMatrix4( matrix );
		return this.setFromPoints( _points );

	}

	translate( offset ) {

		this.min.add( offset );
		this.max.add( offset );
		return this;

	}

	equals( box ) {

		return box.min.equals( this.min ) && box.max.equals( this.max );

	}

	toJSON() {

		return { min: this.min.toArray(), max: this.max.toArray() };

	}

	fromJSON( json ) {

		this.min.fromArray( json.min );
		this.max.fromArray( json.max );
		return this;

	}

}

Box3.prototype.isBox3 = true;

// Whether the triangle (_v0, _v1, _v2) and the box of half size _extents overlap along
// every axis of `axes` (xyz triples).
function separated( axes ) {

	for ( let i = 0; i + 2 < axes.length; i += 3 ) {

		_axis.fromArray( axes, i );
		const r = _extents.x * Math.abs( _axis.x ) + _extents.y * Math.abs( _axis.y ) + _extents.z * Math.abs( _axis.z );
		const p0 = _v0.dot( _axis ), p1 = _v1.dot( _axis ), p2 = _v2.dot( _axis );
		if ( Math.max( - Math.max( p0, p1, p2 ), Math.min( p0, p1, p2 ) ) > r ) return false;

	}

	return true;

}

// ---------------------------------------------------------------- Sphere

export class Sphere {

	constructor( center = new Vector3(), radius = - 1 ) {

		this.center = center;
		this.radius = radius;

	}

	set( center, radius ) {

		this.center.copy( center );
		this.radius = radius;
		return this;

	}

	setFromPoints( points, optionalCenter ) {

		const center = this.center;
		if ( optionalCenter !== undefined ) center.copy( optionalCenter );
		else _box.setFromPoints( points ).getCenter( center );
		let maxRadiusSq = 0;
		for ( let i = 0; i < points.length; i ++ ) maxRadiusSq = Math.max( maxRadiusSq, center.distanceToSquared( points[ i ] ) );
		this.radius = Math.sqrt( maxRadiusSq );
		return this;

	}

	copy( sphere ) {

		this.center.copy( sphere.center );
		this.radius = sphere.radius;
		return this;

	}

	isEmpty() {

		return this.radius < 0;

	}

	makeEmpty() {

		this.center.set( 0, 0, 0 );
		this.radius = - 1;
		return this;

	}

	containsPoint( point ) {

		return point.distanceToSquared( this.center ) <= this.radius * this.radius;

	}

	distanceToPoint( point ) {

		return point.distanceTo( this.center ) - this.radius;

	}

	intersectsSphere( sphere ) {

		const radiusSum = this.radius + sphere.radius;
		return sphere.center.distanceToSquared( this.center ) <= radiusSum * radiusSum;

	}

	intersectsBox( box ) {

		return box.intersectsSphere( this );

	}

	intersectsPlane( plane ) {

		return Math.abs( plane.distanceToPoint( this.center ) ) <= this.radius;

	}

	clampPoint( point, target = new Vector3() ) {

		const deltaLengthSq = this.center.distanceToSquared( point );
		target.copy( point );
		if ( deltaLengthSq > this.radius * this.radius ) target.sub( this.center ).normalize().multiplyScalar( this.radius ).add( this.center );
		return target;

	}

	getBoundingBox( target = new Box3() ) {

		if ( this.isEmpty() ) return target.makeEmpty();
		target.set( this.center, this.center );
		return target.expandByScalar( this.radius );

	}

	applyMatrix4( matrix ) {

		this.center.applyMatrix4( matrix );
		this.radius = this.radius * matrix.getMaxScaleOnAxis();
		return this;

	}

	translate( offset ) {

		this.center.add( offset );
		return this;

	}

	expandByPoint( point ) {

		if ( this.isEmpty() ) {

			this.center.copy( point );
			this.radius = 0;
			return this;

		}

		_v1.subVectors( point, this.center );
		const lengthSq = _v1.lengthSq();

		if ( lengthSq > this.radius * this.radius ) {

			// grow just enough: move the centre half the way the radius grows
			const length = Math.sqrt( lengthSq ), delta = ( length - this.radius ) * 0.5;
			this.center.addScaledVector( _v1, delta / length );
			this.radius += delta;

		}

		return this;

	}

	union( sphere ) {

		if ( sphere.isEmpty() ) return this;
		if ( this.isEmpty() ) return this.copy( sphere );

		if ( this.center.equals( sphere.center ) ) {

			this.radius = Math.max( this.radius, sphere.radius );

		} else {

			_v2.subVectors( sphere.center, this.center ).setLength( sphere.radius );
			this.expandByPoint( _v1.copy( sphere.center ).add( _v2 ) );
			this.expandByPoint( _v1.copy( sphere.center ).sub( _v2 ) );

		}

		return this;

	}

	equals( sphere ) {

		return sphere.center.equals( this.center ) && sphere.radius === this.radius;

	}

	clone() {

		return new this.constructor().copy( this );

	}

	toJSON() {

		return { radius: this.radius, center: this.center.toArray() };

	}

	fromJSON( json ) {

		this.radius = json.radius;
		this.center.fromArray( json.center );
		return this;

	}

}

Sphere.prototype.isSphere = true;

// ---------------------------------------------------------------- scratch values

const _vector = new Vector3(), _v0 = new Vector3(), _v1 = new Vector3(), _v2 = new Vector3();
const _f0 = new Vector3(), _f1 = new Vector3(), _f2 = new Vector3();
const _center = new Vector3(), _extents = new Vector3(), _normal = new Vector3(), _axis = new Vector3();
const _x = new Vector3(), _y = new Vector3(), _z = new Vector3();
const _zero = new Vector3( 0, 0, 0 ), _one = new Vector3( 1, 1, 1 );
const _points = Array.from( { length: 8 }, () => new Vector3() );
const _quaternion = new Quaternion();
const _matrix = new Matrix4(), _m1 = new Matrix4();
const _box = new Box3();
