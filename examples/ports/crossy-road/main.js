// "Crossy Road" clone by Hunor Márton Borbély, from his three.js tutorial
// (freeCodeCamp, "How to Code a Crossy Road Game Clone with Three.js", and
// JavaScriptGameTutorials.com). The tutorial's modules are joined into one file; the
// game is the same: endless rows of forest, cars and trucks, arrow keys to hop.

import { loadLibrary, Stats } from '../lib.js';

const THREE = await loadLibrary();
const stats = new Stats();

// ---------------------------------------------------------------- constants

const minTileIndex = - 8;
const maxTileIndex = 8;
const tilesPerRow = maxTileIndex - minTileIndex + 1;
const tileSize = 42;

// ---------------------------------------------------------------- renderer and camera

function Renderer() {

	const canvas = document.querySelector( 'canvas.game' );
	if ( ! canvas ) throw new Error( 'Canvas not found' );

	const renderer = new THREE.WebGPURenderer( {
		antialias: true,
		canvas: canvas,
	} );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.shadowMap.enabled = true;

	return renderer;

}

function Camera() {

	const size = 300;
	const viewRatio = window.innerWidth / window.innerHeight;
	const width = viewRatio < 1 ? size : size * viewRatio;
	const height = viewRatio < 1 ? size / viewRatio : size;

	const camera = new THREE.OrthographicCamera(
		width / - 2, // left
		width / 2, // right
		height / 2, // top
		height / - 2, // bottom
		100, // near
		900 // far
	);

	camera.up.set( 0, 0, 1 );
	camera.position.set( 300, - 300, 300 );
	camera.lookAt( 0, 0, 0 );

	return camera;

}

// ---------------------------------------------------------------- textures

function Texture( width, height, rects ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext( '2d' );
	context.fillStyle = '#ffffff';
	context.fillRect( 0, 0, width, height );
	context.fillStyle = 'rgba(0,0,0,0.6)';
	rects.forEach( ( rect ) => {

		context.fillRect( rect.x, rect.y, rect.w, rect.h );

	} );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

const carFrontTexture = Texture( 40, 80, [ { x: 0, y: 10, w: 30, h: 60 } ] );
const carBackTexture = Texture( 40, 80, [ { x: 10, y: 10, w: 30, h: 60 } ] );
const carRightSideTexture = Texture( 110, 40, [ { x: 10, y: 0, w: 50, h: 30 }, { x: 70, y: 0, w: 30, h: 30 } ] );
const carLeftSideTexture = Texture( 110, 40, [ { x: 10, y: 10, w: 50, h: 30 }, { x: 70, y: 10, w: 30, h: 30 } ] );

const truckFrontTexture = Texture( 30, 30, [ { x: 5, y: 0, w: 10, h: 30 } ] );
const truckRightSideTexture = Texture( 25, 30, [ { x: 15, y: 5, w: 10, h: 10 } ] );
const truckLeftSideTexture = Texture( 25, 30, [ { x: 15, y: 15, w: 10, h: 10 } ] );

// ---------------------------------------------------------------- map pieces

function Grass( rowIndex ) {

	const grass = new THREE.Group();
	grass.position.y = rowIndex * tileSize;

	const createSection = ( color ) => new THREE.Mesh(
		new THREE.BoxGeometry( tilesPerRow * tileSize, tileSize, 3 ),
		new THREE.MeshLambertMaterial( { color } )
	);

	const middle = createSection( 0xbaf455 );
	middle.receiveShadow = true;
	grass.add( middle );

	const left = createSection( 0x99c846 );
	left.position.x = - tilesPerRow * tileSize;
	grass.add( left );

	const right = createSection( 0x99c846 );
	right.position.x = tilesPerRow * tileSize;
	grass.add( right );

	return grass;

}

function Road( rowIndex ) {

	const road = new THREE.Group();
	road.position.y = rowIndex * tileSize;

	const createSection = ( color ) => new THREE.Mesh(
		new THREE.PlaneGeometry( tilesPerRow * tileSize, tileSize ),
		new THREE.MeshLambertMaterial( { color } )
	);

	const middle = createSection( 0x454a59 );
	middle.receiveShadow = true;
	road.add( middle );

	const left = createSection( 0x393d49 );
	left.position.x = - tilesPerRow * tileSize;
	road.add( left );

	const right = createSection( 0x393d49 );
	right.position.x = tilesPerRow * tileSize;
	road.add( right );

	return road;

}

function Tree( tileIndex, height ) {

	const tree = new THREE.Group();
	tree.position.x = tileIndex * tileSize;

	const trunk = new THREE.Mesh(
		new THREE.BoxGeometry( 15, 15, 20 ),
		new THREE.MeshLambertMaterial( { color: 0x4d2926 } )
	);
	trunk.position.z = 10;
	tree.add( trunk );

	const crown = new THREE.Mesh(
		new THREE.BoxGeometry( 30, 30, height ),
		new THREE.MeshLambertMaterial( { color: 0x7aa21d } )
	);
	crown.position.z = height / 2 + 20;
	crown.castShadow = true;
	crown.receiveShadow = true;
	tree.add( crown );

	return tree;

}

function Wheel( x ) {

	const wheel = new THREE.Mesh(
		new THREE.BoxGeometry( 12, 33, 12 ),
		new THREE.MeshLambertMaterial( { color: 0x333333 } )
	);
	wheel.position.x = x;
	wheel.position.z = 6;
	return wheel;

}

function Car( initialTileIndex, direction, color ) {

	const car = new THREE.Group();
	car.position.x = initialTileIndex * tileSize;
	if ( ! direction ) car.rotation.z = Math.PI;

	const main = new THREE.Mesh(
		new THREE.BoxGeometry( 60, 30, 15 ),
		new THREE.MeshLambertMaterial( { color } )
	);
	main.position.z = 12;
	main.castShadow = true;
	main.receiveShadow = true;
	car.add( main );

	// A box's faces take materials in the order +x, -x, +y, -y, +z, -z.
	const cabin = new THREE.Mesh( new THREE.BoxGeometry( 33, 24, 12 ), [
		new THREE.MeshLambertMaterial( { color: 0xcccccc, map: carBackTexture } ),
		new THREE.MeshLambertMaterial( { color: 0xcccccc, map: carFrontTexture } ),
		new THREE.MeshLambertMaterial( { color: 0xcccccc, map: carRightSideTexture } ),
		new THREE.MeshLambertMaterial( { color: 0xcccccc, map: carLeftSideTexture } ),
		new THREE.MeshLambertMaterial( { color: 0xcccccc } ), // top
		new THREE.MeshLambertMaterial( { color: 0xcccccc } ), // bottom
	] );
	cabin.position.x = - 6;
	cabin.position.z = 25.5;
	cabin.castShadow = true;
	cabin.receiveShadow = true;
	car.add( cabin );

	const frontWheel = Wheel( 18 );
	car.add( frontWheel );

	const backWheel = Wheel( - 18 );
	car.add( backWheel );

	return car;

}

function Truck( initialTileIndex, direction, color ) {

	const truck = new THREE.Group();
	truck.position.x = initialTileIndex * tileSize;
	if ( ! direction ) truck.rotation.z = Math.PI;

	const cargo = new THREE.Mesh(
		new THREE.BoxGeometry( 70, 35, 35 ),
		new THREE.MeshLambertMaterial( { color: 0xb4c6fc } )
	);
	cargo.position.x = - 15;
	cargo.position.z = 25;
	cargo.castShadow = true;
	cargo.receiveShadow = true;
	truck.add( cargo );

	const cabin = new THREE.Mesh( new THREE.BoxGeometry( 30, 30, 30 ), [
		new THREE.MeshLambertMaterial( { color, map: truckFrontTexture } ), // front
		new THREE.MeshLambertMaterial( { color } ), // back
		new THREE.MeshLambertMaterial( { color, map: truckLeftSideTexture } ),
		new THREE.MeshLambertMaterial( { color, map: truckRightSideTexture } ),
		new THREE.MeshLambertMaterial( { color } ), // top
		new THREE.MeshLambertMaterial( { color } ), // bottom
	] );
	cabin.position.x = 35;
	cabin.position.z = 20;
	cabin.castShadow = true;
	cabin.receiveShadow = true;
	truck.add( cabin );

	const frontWheel = Wheel( 37 );
	truck.add( frontWheel );

	const middleWheel = Wheel( 5 );
	truck.add( middleWheel );

	const backWheel = Wheel( - 35 );
	truck.add( backWheel );

	return truck;

}

// ---------------------------------------------------------------- row generation

function generateRows( amount ) {

	const rows = [];
	for ( let i = 0; i < amount; i ++ ) {

		const rowData = generateRow();
		rows.push( rowData );

	}

	return rows;

}

function generateRow() {

	const type = randomElement( [ 'car', 'truck', 'forest' ] );
	if ( type === 'car' ) return generateCarLaneMetadata();
	if ( type === 'truck' ) return generateTruckLaneMetadata();
	return generateForesMetadata();

}

function randomElement( array ) {

	return array[ Math.floor( Math.random() * array.length ) ];

}

function generateForesMetadata() {

	const occupiedTiles = new Set();
	const trees = Array.from( { length: 4 }, () => {

		let tileIndex;
		do {

			tileIndex = THREE.MathUtils.randInt( minTileIndex, maxTileIndex );

		} while ( occupiedTiles.has( tileIndex ) );

		occupiedTiles.add( tileIndex );

		const height = randomElement( [ 20, 45, 60 ] );

		return { tileIndex, height };

	} );

	return { type: 'forest', trees };

}

function generateCarLaneMetadata() {

	const direction = randomElement( [ true, false ] );
	const speed = randomElement( [ 125, 156, 188 ] );

	const occupiedTiles = new Set();

	const vehicles = Array.from( { length: 3 }, () => {

		let initialTileIndex;
		do {

			initialTileIndex = THREE.MathUtils.randInt( minTileIndex, maxTileIndex );

		} while ( occupiedTiles.has( initialTileIndex ) );

		occupiedTiles.add( initialTileIndex - 1 );
		occupiedTiles.add( initialTileIndex );
		occupiedTiles.add( initialTileIndex + 1 );

		const color = randomElement( [ 0xa52523, 0xbdb638, 0x78b14b ] );

		return { initialTileIndex, color };

	} );

	return { type: 'car', direction, speed, vehicles };

}

function generateTruckLaneMetadata() {

	const direction = randomElement( [ true, false ] );
	const speed = randomElement( [ 125, 156, 188 ] );

	const occupiedTiles = new Set();

	const vehicles = Array.from( { length: 2 }, () => {

		let initialTileIndex;
		do {

			initialTileIndex = THREE.MathUtils.randInt( minTileIndex, maxTileIndex );

		} while ( occupiedTiles.has( initialTileIndex ) );

		occupiedTiles.add( initialTileIndex - 2 );
		occupiedTiles.add( initialTileIndex - 1 );
		occupiedTiles.add( initialTileIndex );
		occupiedTiles.add( initialTileIndex + 1 );
		occupiedTiles.add( initialTileIndex + 2 );

		const color = randomElement( [ 0xa52523, 0xbdb638, 0x78b14b ] );

		return { initialTileIndex, color };

	} );

	return { type: 'truck', direction, speed, vehicles };

}

// ---------------------------------------------------------------- map

const metadata = [];

const map = new THREE.Group();

function initializeMap() {

	// Remove all rows
	metadata.length = 0;
	map.remove( ...map.children );

	// Add new rows
	for ( let rowIndex = 0; rowIndex > - 10; rowIndex -- ) {

		const grass = Grass( rowIndex );
		map.add( grass );

	}

	addRows();

}

function addRows() {

	const newMetadata = generateRows( 20 );

	const startIndex = metadata.length;
	metadata.push( ...newMetadata );

	newMetadata.forEach( ( rowData, index ) => {

		const rowIndex = startIndex + index + 1;

		if ( rowData.type === 'forest' ) {

			const row = Grass( rowIndex );

			rowData.trees.forEach( ( { tileIndex, height } ) => {

				const three = Tree( tileIndex, height );
				row.add( three );

			} );

			map.add( row );

		}

		if ( rowData.type === 'car' ) {

			const row = Road( rowIndex );

			rowData.vehicles.forEach( ( vehicle ) => {

				const car = Car(
					vehicle.initialTileIndex,
					rowData.direction,
					vehicle.color
				);
				vehicle.ref = car;
				row.add( car );

			} );

			map.add( row );

		}

		if ( rowData.type === 'truck' ) {

			const row = Road( rowIndex );

			rowData.vehicles.forEach( ( vehicle ) => {

				const truck = Truck(
					vehicle.initialTileIndex,
					rowData.direction,
					vehicle.color
				);
				vehicle.ref = truck;
				row.add( truck );

			} );

			map.add( row );

		}

	} );

}

// ---------------------------------------------------------------- player

const player = Player();

function Player() {

	const player = new THREE.Group();

	const body = new THREE.Mesh(
		new THREE.BoxGeometry( 15, 15, 20 ),
		new THREE.MeshLambertMaterial( { color: 'white' } )
	);
	body.position.z = 10;
	body.castShadow = true;
	body.receiveShadow = true;
	player.add( body );

	const cap = new THREE.Mesh(
		new THREE.BoxGeometry( 2, 4, 2 ),
		new THREE.MeshLambertMaterial( { color: 0xf0619a } )
	);
	cap.position.z = 21;
	cap.castShadow = true;
	cap.receiveShadow = true;
	player.add( cap );

	const playerContainer = new THREE.Group();
	playerContainer.add( player );

	return playerContainer;

}

const position = {
	currentRow: 0,
	currentTile: 0,
};

const movesQueue = [];

function initializePlayer() {

	// Initialize the Three.js player object
	player.position.x = 0;
	player.position.y = 0;
	player.children[ 0 ].position.z = 0;

	// Initialize metadata
	position.currentRow = 0;
	position.currentTile = 0;

	// Clear the moves queue
	movesQueue.length = 0;

}

function queueMove( direction ) {

	const isValidMove = endsUpInValidPosition(
		{
			rowIndex: position.currentRow,
			tileIndex: position.currentTile,
		},
		[ ...movesQueue, direction ]
	);

	if ( ! isValidMove ) return;

	movesQueue.push( direction );

}

function stepCompleted() {

	const direction = movesQueue.shift();

	if ( direction === 'forward' ) position.currentRow += 1;
	if ( direction === 'backward' ) position.currentRow -= 1;
	if ( direction === 'left' ) position.currentTile -= 1;
	if ( direction === 'right' ) position.currentTile += 1;

	// Add new rows if the player is running out of them
	if ( position.currentRow > metadata.length - 10 ) addRows();

	const scoreDOM = document.getElementById( 'score' );
	if ( scoreDOM ) scoreDOM.innerText = position.currentRow.toString();

}

function calculateFinalPosition( currentPosition, moves ) {

	return moves.reduce( ( position, direction ) => {

		if ( direction === 'forward' )
			return {
				rowIndex: position.rowIndex + 1,
				tileIndex: position.tileIndex,
			};
		if ( direction === 'backward' )
			return {
				rowIndex: position.rowIndex - 1,
				tileIndex: position.tileIndex,
			};
		if ( direction === 'left' )
			return {
				rowIndex: position.rowIndex,
				tileIndex: position.tileIndex - 1,
			};
		if ( direction === 'right' )
			return {
				rowIndex: position.rowIndex,
				tileIndex: position.tileIndex + 1,
			};
		return position;

	}, currentPosition );

}

function endsUpInValidPosition( currentPosition, moves ) {

	// Calculate where the player would end up after the move
	const finalPosition = calculateFinalPosition(
		currentPosition,
		moves
	);

	// Detect if we hit the edge of the board
	if (
		finalPosition.rowIndex === - 1 ||
		finalPosition.tileIndex === minTileIndex - 1 ||
		finalPosition.tileIndex === maxTileIndex + 1
	) {

		// Invalid move, ignore move command
		return false;

	}

	// Detect if we hit a tree
	const finalRow = metadata[ finalPosition.rowIndex - 1 ];
	if (
		finalRow &&
		finalRow.type === 'forest' &&
		finalRow.trees.some(
			( tree ) => tree.tileIndex === finalPosition.tileIndex
		)
	) {

		// Invalid move, ignore move command
		return false;

	}

	return true;

}

// ---------------------------------------------------------------- animation

const clock = new THREE.Clock();

function animateVehicles() {

	const delta = clock.getDelta();

	// Animate cars and trucks
	metadata.forEach( ( rowData ) => {

		if ( rowData.type === 'car' || rowData.type === 'truck' ) {

			const beginningOfRow = ( minTileIndex - 2 ) * tileSize;
			const endOfRow = ( maxTileIndex + 2 ) * tileSize;

			rowData.vehicles.forEach( ( { ref } ) => {

				if ( ! ref ) throw Error( 'Vehicle reference is missing' );

				if ( rowData.direction ) {

					ref.position.x =
						ref.position.x > endOfRow
							? beginningOfRow
							: ref.position.x + rowData.speed * delta;

				} else {

					ref.position.x =
						ref.position.x < beginningOfRow
							? endOfRow
							: ref.position.x - rowData.speed * delta;

				}

			} );

		}

	} );

}

const moveClock = new THREE.Clock( false );

function animatePlayer() {

	if ( ! movesQueue.length ) return;

	if ( ! moveClock.running ) moveClock.start();

	const stepTime = 0.2; // Seconds it takes to take a step
	const progress = Math.min( 1, moveClock.getElapsedTime() / stepTime );

	setPosition( progress );
	setRotation( progress );

	// Once a step has ended
	if ( progress >= 1 ) {

		stepCompleted();
		moveClock.stop();

	}

}

function setPosition( progress ) {

	const startX = position.currentTile * tileSize;
	const startY = position.currentRow * tileSize;
	let endX = startX;
	let endY = startY;

	if ( movesQueue[ 0 ] === 'left' ) endX -= tileSize;
	if ( movesQueue[ 0 ] === 'right' ) endX += tileSize;
	if ( movesQueue[ 0 ] === 'forward' ) endY += tileSize;
	if ( movesQueue[ 0 ] === 'backward' ) endY -= tileSize;

	player.position.x = THREE.MathUtils.lerp( startX, endX, progress );
	player.position.y = THREE.MathUtils.lerp( startY, endY, progress );
	player.children[ 0 ].position.z = Math.sin( progress * Math.PI ) * 8;

}

function setRotation( progress ) {

	let endRotation = 0;
	if ( movesQueue[ 0 ] == 'forward' ) endRotation = 0;
	if ( movesQueue[ 0 ] == 'left' ) endRotation = Math.PI / 2;
	if ( movesQueue[ 0 ] == 'right' ) endRotation = - Math.PI / 2;
	if ( movesQueue[ 0 ] == 'backward' ) endRotation = Math.PI;

	player.children[ 0 ].rotation.z = THREE.MathUtils.lerp(
		player.children[ 0 ].rotation.z,
		endRotation,
		progress
	);

}

// ---------------------------------------------------------------- hit test

const resultDOM = document.getElementById( 'result-container' );
const finalScoreDOM = document.getElementById( 'final-score' );

// `Box3.setFromObject` is not in WAMR3D yet: the boxes are built from each object's world
// position and its size on the board, which matches the tutorial's boxes for these shapes.
const playerBoundingBox = new THREE.Box3();
const vehicleBoundingBox = new THREE.Box3();
const center = new THREE.Vector3();
const size = new THREE.Vector3();

function hitTest() {

	const row = metadata[ position.currentRow - 1 ];
	if ( ! row ) return;

	if ( row.type === 'car' || row.type === 'truck' ) {

		player.children[ 0 ].getWorldPosition( center );
		playerBoundingBox.setFromCenterAndSize( center, size.set( 15, 15, 20 ) );

		row.vehicles.forEach( ( { ref } ) => {

			if ( ! ref ) throw Error( 'Vehicle reference is missing' );

			ref.getWorldPosition( center );
			const length = row.type === 'car' ? 60 : 105;
			vehicleBoundingBox.setFromCenterAndSize( center, size.set( length, 33, 40 ) );

			if ( playerBoundingBox.intersectsBox( vehicleBoundingBox ) ) {

				if ( ! resultDOM || ! finalScoreDOM ) return;
				resultDOM.style.visibility = 'visible';
				finalScoreDOM.innerText = position.currentRow.toString();

			}

		} );

	}

}

// ---------------------------------------------------------------- input

document.getElementById( 'forward' )?.addEventListener( 'click', () => queueMove( 'forward' ) );

document.getElementById( 'backward' )?.addEventListener( 'click', () => queueMove( 'backward' ) );

document.getElementById( 'left' )?.addEventListener( 'click', () => queueMove( 'left' ) );

document.getElementById( 'right' )?.addEventListener( 'click', () => queueMove( 'right' ) );

window.addEventListener( 'keydown', ( event ) => {

	if ( event.key === 'ArrowUp' ) {

		event.preventDefault(); // Avoid scrolling the page
		queueMove( 'forward' );

	} else if ( event.key === 'ArrowDown' ) {

		event.preventDefault(); // Avoid scrolling the page
		queueMove( 'backward' );

	} else if ( event.key === 'ArrowLeft' ) {

		event.preventDefault(); // Avoid scrolling the page
		queueMove( 'left' );

	} else if ( event.key === 'ArrowRight' ) {

		event.preventDefault(); // Avoid scrolling the page
		queueMove( 'right' );

	}

} );

// ---------------------------------------------------------------- main

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x99c846 );
scene.add( player );
scene.add( map );

const ambientLight = new THREE.AmbientLight();
scene.add( ambientLight );

const dirLight = new THREE.DirectionalLight();
dirLight.position.set( - 100, - 100, 200 );
dirLight.up.set( 0, 0, 1 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.up.set( 0, 0, 1 );
dirLight.shadow.camera.left = - 400;
dirLight.shadow.camera.right = 400;
dirLight.shadow.camera.top = 400;
dirLight.shadow.camera.bottom = - 400;
dirLight.shadow.camera.near = 50;
dirLight.shadow.camera.far = 400;
dirLight.target = player;
player.add( dirLight );

const camera = Camera();
player.add( camera );

const scoreDOM = document.getElementById( 'score' );

initializeGame();

document.querySelector( '#retry' )?.addEventListener( 'click', initializeGame );

function initializeGame() {

	initializePlayer();
	initializeMap();

	// Initialize UI
	if ( scoreDOM ) scoreDOM.innerText = '0';
	if ( resultDOM ) resultDOM.style.visibility = 'hidden';

}

const renderer = Renderer();
renderer.setAnimationLoop( animate );

window.addEventListener( 'resize', () => {

	const size = 300;
	const viewRatio = window.innerWidth / window.innerHeight;
	const width = viewRatio < 1 ? size : size * viewRatio;
	const height = viewRatio < 1 ? size / viewRatio : size;
	camera.left = width / - 2;
	camera.right = width / 2;
	camera.top = height / 2;
	camera.bottom = height / - 2;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

} );

function animate() {

	animateVehicles();
	animatePlayer();
	hitTest();

	renderer.render( scene, camera );
	stats.update();

}
