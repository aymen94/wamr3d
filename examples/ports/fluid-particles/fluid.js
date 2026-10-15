// Particle fluid on the CPU: position-based "double density relaxation" (Clavet, Beaudoin
// and Poulin, 2005) with a uniform grid for neighbour search. Units are particle-scale:
// the interaction radius is 1 and one step is one time unit, so the constants below are
// per step, not per second.

const RADIUS = 1;
const REST_DENSITY = 3.2;
const STIFFNESS = 0.06;
const NEAR_STIFFNESS = 0.25;
const GRAVITY = 0.006;
const VISCOSITY = 0.08;
const MAX_PAIRS = 48;

export class Fluid {

	constructor( { width, height, depth, blockX, blockY, blockZ, spacing = 0.5 } ) {

		this.width = width;
		this.height = height;
		this.depth = depth;
		this.count = blockX * blockY * blockZ;
		this.position = new Float32Array( this.count * 3 );
		this.previous = new Float32Array( this.count * 3 );
		this.velocity = new Float32Array( this.count * 3 );
		this.gravity = [ 0, - GRAVITY, 0 ];

		let i = 0;
		for ( let z = 0; z < blockZ; z ++ ) for ( let y = 0; y < blockY; y ++ ) for ( let x = 0; x < blockX; x ++ ) {

			// A little jitter keeps the lattice from staying perfectly stacked.
			this.position[ i ++ ] = 0.3 + x * spacing + Math.random() * 0.01;
			this.position[ i ++ ] = 0.3 + y * spacing + Math.random() * 0.01;
			this.position[ i ++ ] = 0.3 + z * spacing + Math.random() * 0.01;

		}

		this.cellsX = Math.ceil( width / RADIUS );
		this.cellsY = Math.ceil( height / RADIUS );
		this.cellsZ = Math.ceil( depth / RADIUS );
		const cells = this.cellsX * this.cellsY * this.cellsZ;
		this.cellStart = new Int32Array( cells + 1 );
		this.cellOf = new Int32Array( this.count );
		this.sorted = new Int32Array( this.count );
		this.pairs = new Int32Array( this.count * MAX_PAIRS );
		this.pairStart = new Int32Array( this.count + 1 );
		this.density = new Float32Array( this.count );
		this.near = new Float32Array( this.count );
		this.listed = false;

	}

	/** Pushes every particle within `radius` of the point outwards and up. */
	splash( x, y, z, radius, strength ) {

		const { position, velocity } = this;
		for ( let i = 0; i < this.count; i ++ ) {

			const dx = position[ i * 3 ] - x, dy = position[ i * 3 + 1 ] - y, dz = position[ i * 3 + 2 ] - z;
			const d = Math.hypot( dx, dy, dz );
			if ( d >= radius || d === 0 ) continue;
			const f = strength * ( 1 - d / radius ) / d;
			velocity[ i * 3 ] += dx * f;
			velocity[ i * 3 + 1 ] += Math.abs( dy * f ) + strength * 0.5 * ( 1 - d / radius );
			velocity[ i * 3 + 2 ] += dz * f;

		}

	}

	step() {

		const { count, position, previous, velocity, gravity } = this;

		for ( let i = 0; i < count * 3; i += 3 ) {

			velocity[ i ] += gravity[ 0 ];
			velocity[ i + 1 ] += gravity[ 1 ];
			velocity[ i + 2 ] += gravity[ 2 ];

		}

		// Viscosity uses the neighbour list of the previous step, which is close enough.
		if ( this.listed ) this.viscosity();

		for ( let i = 0; i < count * 3; i ++ ) {

			previous[ i ] = position[ i ];
			position[ i ] += velocity[ i ];

		}

		this.collide();
		this.buildGrid();
		this.listNeighbours();
		this.relax();
		this.collide();

		for ( let i = 0; i < count * 3; i ++ ) velocity[ i ] = position[ i ] - previous[ i ];

	}

	cell( x, y, z ) {

		const cx = Math.min( this.cellsX - 1, Math.max( 0, Math.floor( x / RADIUS ) ) );
		const cy = Math.min( this.cellsY - 1, Math.max( 0, Math.floor( y / RADIUS ) ) );
		const cz = Math.min( this.cellsZ - 1, Math.max( 0, Math.floor( z / RADIUS ) ) );
		return ( cz * this.cellsY + cy ) * this.cellsX + cx;

	}

	// Counting sort of particle indices by cell: `sorted[cellStart[c] .. cellStart[c + 1]]`.
	buildGrid() {

		const { count, position, cellStart, cellOf, sorted } = this;
		cellStart.fill( 0 );
		for ( let i = 0; i < count; i ++ ) {

			const c = this.cell( position[ i * 3 ], position[ i * 3 + 1 ], position[ i * 3 + 2 ] );
			cellOf[ i ] = c;
			cellStart[ c + 1 ] ++;

		}

		for ( let c = 1; c < cellStart.length; c ++ ) cellStart[ c ] += cellStart[ c - 1 ];
		const fill = cellStart.slice( 0, - 1 );
		for ( let i = 0; i < count; i ++ ) sorted[ fill[ cellOf[ i ] ] ++ ] = i;

	}

	// Each pair within RADIUS is listed once, under its lower index, at most MAX_PAIRS per
	// particle: `pairs[pairStart[i] .. pairStart[i + 1]]`.
	listNeighbours() {

		const { count, position, cellStart, sorted, cellsX, cellsY, cellsZ, pairs, pairStart } = this;
		let n = 0;
		for ( let i = 0; i < count; i ++ ) {

			pairStart[ i ] = n;
			const limit = n + MAX_PAIRS;
			const px = position[ i * 3 ], py = position[ i * 3 + 1 ], pz = position[ i * 3 + 2 ];
			const cx = Math.min( cellsX - 1, Math.max( 0, Math.floor( px ) ) );
			const cy = Math.min( cellsY - 1, Math.max( 0, Math.floor( py ) ) );
			const cz = Math.min( cellsZ - 1, Math.max( 0, Math.floor( pz ) ) );

			for ( let z = Math.max( 0, cz - 1 ); z <= Math.min( cellsZ - 1, cz + 1 ); z ++ ) {

				for ( let y = Math.max( 0, cy - 1 ); y <= Math.min( cellsY - 1, cy + 1 ); y ++ ) {

					const row = ( z * cellsY + y ) * cellsX;
					const to = cellStart[ row + Math.min( cellsX - 1, cx + 1 ) + 1 ];
					for ( let k = cellStart[ row + Math.max( 0, cx - 1 ) ]; k < to && n < limit; k ++ ) {

						const j = sorted[ k ];
						if ( j <= i ) continue;
						const dx = position[ j * 3 ] - px, dy = position[ j * 3 + 1 ] - py, dz = position[ j * 3 + 2 ] - pz;
						if ( dx * dx + dy * dy + dz * dz < RADIUS * RADIUS ) pairs[ n ++ ] = j;

					}

				}

			}

		}

		pairStart[ count ] = n;
		this.listed = true;

	}

	// Damps velocity differences between approaching neighbours.
	viscosity() {

		const { count, position, velocity, pairs, pairStart } = this;
		for ( let i = 0; i < count; i ++ ) {

			for ( let k = pairStart[ i ]; k < pairStart[ i + 1 ]; k ++ ) {

				const j = pairs[ k ];
				const dx = position[ j * 3 ] - position[ i * 3 ], dy = position[ j * 3 + 1 ] - position[ i * 3 + 1 ], dz = position[ j * 3 + 2 ] - position[ i * 3 + 2 ];
				const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
				if ( d >= RADIUS || d < 1e-6 ) continue;
				const nx = dx / d, ny = dy / d, nz = dz / d;
				const u = ( velocity[ i * 3 ] - velocity[ j * 3 ] ) * nx + ( velocity[ i * 3 + 1 ] - velocity[ j * 3 + 1 ] ) * ny + ( velocity[ i * 3 + 2 ] - velocity[ j * 3 + 2 ] ) * nz;
				if ( u <= 0 ) continue;
				const impulse = 0.5 * ( 1 - d / RADIUS ) * VISCOSITY * u;
				velocity[ i * 3 ] -= impulse * nx; velocity[ i * 3 + 1 ] -= impulse * ny; velocity[ i * 3 + 2 ] -= impulse * nz;
				velocity[ j * 3 ] += impulse * nx; velocity[ j * 3 + 1 ] += impulse * ny; velocity[ j * 3 + 2 ] += impulse * nz;

			}

		}

	}

	relax() {

		const { count, position, pairs, pairStart, density, near } = this;
		density.fill( 0 );
		near.fill( 0 );
		for ( let i = 0; i < count; i ++ ) {

			for ( let k = pairStart[ i ]; k < pairStart[ i + 1 ]; k ++ ) {

				const j = pairs[ k ];
				const dx = position[ j * 3 ] - position[ i * 3 ], dy = position[ j * 3 + 1 ] - position[ i * 3 + 1 ], dz = position[ j * 3 + 2 ] - position[ i * 3 + 2 ];
				const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
				if ( d >= RADIUS ) continue;
				const q = 1 - d / RADIUS, q2 = q * q;
				density[ i ] += q2; density[ j ] += q2;
				near[ i ] += q2 * q; near[ j ] += q2 * q;

			}

		}

		for ( let i = 0; i < count; i ++ ) {

			const pi = STIFFNESS * ( density[ i ] - REST_DENSITY ), ni = NEAR_STIFFNESS * near[ i ];
			for ( let k = pairStart[ i ]; k < pairStart[ i + 1 ]; k ++ ) {

				const j = pairs[ k ];
				const dx = position[ j * 3 ] - position[ i * 3 ], dy = position[ j * 3 + 1 ] - position[ i * 3 + 1 ], dz = position[ j * 3 + 2 ] - position[ i * 3 + 2 ];
				const d = Math.sqrt( dx * dx + dy * dy + dz * dz );
				if ( d >= RADIUS || d < 1e-6 ) continue;
				const q = 1 - d / RADIUS;
				const pressure = 0.5 * ( pi + STIFFNESS * ( density[ j ] - REST_DENSITY ) );
				const nearPressure = 0.5 * ( ni + NEAR_STIFFNESS * near[ j ] );
				const push = 0.5 * ( pressure * q + nearPressure * q * q ) / d;
				position[ j * 3 ] += dx * push; position[ j * 3 + 1 ] += dy * push; position[ j * 3 + 2 ] += dz * push;
				position[ i * 3 ] -= dx * push; position[ i * 3 + 1 ] -= dy * push; position[ i * 3 + 2 ] -= dz * push;

			}

		}

	}

	collide() {

		const { count, position } = this;
		const limits = [ this.width, this.height, this.depth ];
		const margin = 0.15;
		for ( let i = 0; i < count; i ++ ) {

			for ( let a = 0; a < 3; a ++ ) {

				const k = i * 3 + a;
				if ( position[ k ] < margin ) position[ k ] = margin;
				else if ( position[ k ] > limits[ a ] - margin ) position[ k ] = limits[ a ] - margin;

			}

		}

	}

}
