// This suite lives in a CommonJS tests/ directory (see tests/room.test.js),
// but the game code under public/js is authored as native ES modules (see
// public/package.json). We bridge the two with a dynamic import() inside an
// async IIFE — node:test happily collects tests registered asynchronously
// as long as they're registered before the process goes idle.
const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const { CONSTS, stepChar, tileAt } = await import('../public/js/physics.js');
  const { createWorld, stepWorld } = await import('../public/js/world.js');

  const { CELL, CHAR_W, CHAR_H } = CONSTS;

function emptyGrid(cols = 20, rows = 20) {
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function withBorder(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  for (let c = 0; c < cols; c++) {
    grid[0][c] = 1;
    grid[rows - 1][c] = 1;
  }
  for (let r = 0; r < rows; r++) {
    grid[r][0] = 1;
    grid[r][cols - 1] = 1;
  }
  return grid;
}

function makeChar(overrides = {}) {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    w: CHAR_W,
    h: CHAR_H,
    onGround: false,
    element: 'fire',
    alive: true,
    ...overrides,
  };
}

const noInput = { left: false, right: false, jump: false };

test('falls under gravity and lands on solid ground', () => {
  const grid = withBorder(emptyGrid());
  // floor at row 10
  for (let c = 0; c < 20; c++) grid[10][c] = 1;
  const char = makeChar({ x: 40, y: 20 });
  let landed = false;
  for (let i = 0; i < 200 && !landed; i++) {
    stepChar(char, noInput, grid);
    if (char.onGround) landed = true;
  }
  assert.equal(landed, true, 'character should land');
  assert.equal(char.onGround, true);
  assert.equal(char.vy, 0);
  assert.equal(char.y + char.h, 10 * CELL, 'should rest flush on the floor');
});

test('walks into a wall and stops flush', () => {
  const grid = withBorder(emptyGrid());
  for (let c = 0; c < 20; c++) grid[10][c] = 1; // floor
  grid[9][12] = 1; // wall segment sticking up at col 12
  grid[8][12] = 1;
  const char = makeChar({ x: 40, y: 10 * CELL - CHAR_H, onGround: true });
  const input = { left: false, right: true, jump: false };
  let prevX = char.x;
  for (let i = 0; i < 300; i++) {
    stepChar(char, input, grid);
    if (char.x === prevX && i > 5) break;
    prevX = char.x;
  }
  assert.equal(char.x + char.w, 12 * CELL, 'should stop flush against the wall');
});

test('cannot tunnel through a 1-cell wall at max fall speed', () => {
  const grid = withBorder(emptyGrid());
  grid[15][10] = 1; // single 1-cell-thick floor tile
  const char = makeChar({ x: 10 * CELL, y: CELL, vy: CONSTS.MAX_FALL, onGround: false });
  // pre-charge to max fall speed by falling through open space first
  for (let i = 0; i < 50; i++) {
    if (char.onGround) break;
    stepChar(char, noInput, grid);
  }
  assert.equal(char.onGround, true, 'should have landed on the thin floor, not tunnelled through');
  assert.equal(char.y + char.h, 15 * CELL);
});

test('jump from ground rises then returns', () => {
  const grid = withBorder(emptyGrid());
  for (let c = 0; c < 20; c++) grid[10][c] = 1;
  const char = makeChar({ x: 40, y: 10 * CELL - CHAR_H, onGround: true });
  stepChar(char, { left: false, right: false, jump: true }, grid);
  assert.equal(char.onGround, false, 'should leave the ground on jump');
  assert.ok(char.vy < 0, 'initial jump velocity should be upward (negative)');

  let minY = char.y;
  let landed = false;
  for (let i = 0; i < 200 && !landed; i++) {
    stepChar(char, noInput, grid);
    if (char.y < minY) minY = char.y;
    if (char.onGround) landed = true;
  }
  assert.equal(landed, true, 'should come back down and land');
  assert.ok(minY < 10 * CELL - CHAR_H, 'should have risen above the starting height');
});

test('fire character dies in a water pool but survives a fire pool', () => {
  const grid = withBorder(emptyGrid());
  for (let c = 0; c < 20; c++) grid[10][c] = 1;
  grid[10][12] = 3; // water pool
  grid[10][14] = 2; // fire pool

  // Drop the fire character into the water pool: it is not solid for fire,
  // so they fall through and should die once they overlap the bottom half.
  const fireInWater = makeChar({ x: 12 * CELL, y: CELL, element: 'fire' });
  for (let i = 0; i < 60 && fireInWater.alive; i++) stepChar(fireInWater, noInput, grid);
  assert.equal(fireInWater.alive, false, 'fire should die falling into a water pool');

  // Fire pool is solid for fire (immune); fire should land safely on top.
  const fireOnFire = makeChar({ x: 14 * CELL, y: CELL, element: 'fire' });
  for (let i = 0; i < 60; i++) stepChar(fireOnFire, noInput, grid);
  assert.equal(fireOnFire.alive, true, 'fire should survive standing on a fire pool');
  assert.equal(fireOnFire.onGround, true);
});

test('water character dies in a fire pool but survives a water pool', () => {
  const grid = withBorder(emptyGrid());
  for (let c = 0; c < 20; c++) grid[10][c] = 1;
  grid[10][12] = 2; // fire pool
  grid[10][14] = 3; // water pool

  const waterInFire = makeChar({ x: 12 * CELL, y: CELL, element: 'water' });
  for (let i = 0; i < 60 && waterInFire.alive; i++) stepChar(waterInFire, noInput, grid);
  assert.equal(waterInFire.alive, false, 'water should die falling into a fire pool');

  const waterOnWater = makeChar({ x: 14 * CELL, y: CELL, element: 'water' });
  for (let i = 0; i < 60; i++) stepChar(waterOnWater, noInput, grid);
  assert.equal(waterOnWater.alive, true, 'water should survive standing on a water pool');
  assert.equal(waterOnWater.onGround, true);
});

test('goo kills both fire and water characters', () => {
  const grid = withBorder(emptyGrid());
  for (let c = 0; c < 20; c++) grid[10][c] = 1;
  grid[10][12] = 4; // goo

  const fire = makeChar({ x: 12 * CELL, y: CELL, element: 'fire' });
  const water = makeChar({ x: 12 * CELL, y: CELL, element: 'water' });
  for (let i = 0; i < 60; i++) {
    stepChar(fire, noInput, grid);
    stepChar(water, noInput, grid);
  }
  assert.equal(fire.alive, false, 'goo should kill fire');
  assert.equal(water.alive, false, 'goo should kill water');
});

test('tileAt treats out-of-bounds as solid', () => {
  const grid = withBorder(emptyGrid());
  assert.equal(tileAt(grid, -1, 5), CONSTS.TILE.SOLID);
  assert.equal(tileAt(grid, 5, 999), CONSTS.TILE.SOLID);
});

// -- world.js: shared-object simulation (buttons, doors, gems, exits) -----

function miniLevel() {
  const rows = 15;
  const cols = 15;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    grid[0][c] = 1;
    grid[rows - 1][c] = 1;
  }
  for (let r = 0; r < rows; r++) {
    grid[r][0] = 1;
    grid[r][cols - 1] = 1;
  }
  const floor = 10;
  for (let c = 1; c < cols - 1; c++) grid[floor][c] = 1;
  grid[floor][12] = 5; // fire exit
  grid[floor][13] = 6; // water exit
  return {
    name: 'mini',
    grid,
    spawns: { fire: [2, 8], water: [4, 8] },
    objects: {
      gems: [{ x: 5, y: 9, element: 'fire' }],
      buttons: [{ id: 'b1', x: 3, y: 9 }],
      doors: [{ id: 'd1', x: 7, y: 6, h: 4, button: 'b1' }],
    },
  };
}

function miniChar(x, y, element) {
  return { x, y, vx: 0, vy: 0, w: CHAR_W, h: CHAR_H, onGround: false, element, alive: true };
}

test('world: button press opens linked door, release closes it', () => {
  const level = miniLevel();
  const world = createWorld(level);
  const doorCol = 7;

  // Nobody on the button: door starts closed (solid).
  assert.equal(world.doors.d1, false);
  assert.equal(tileAt(world.grid, doorCol, 8), 1);

  const onButton = miniChar(3 * CELL, 9 * CELL, 'water');
  stepWorld(world, [onButton]);
  assert.equal(world.buttons.b1, true, 'button should register the overlapping character');
  assert.equal(world.doors.d1, true, 'linked door should open');
  assert.equal(tileAt(world.grid, doorCol, 8), 0, 'door cell should become passable while open');

  const offButton = miniChar(0 * CELL + 1, 0, 'water'); // moved away
  stepWorld(world, [offButton]);
  assert.equal(world.buttons.b1, false);
  assert.equal(world.doors.d1, false, 'door should close once the button is released');
  assert.equal(tileAt(world.grid, doorCol, 8), 1, 'door cell should become solid again');
});

test('world: closed door blocks movement, open door does not', () => {
  const level = miniLevel();
  const world = createWorld(level); // door closed by default
  const walker = miniChar(6 * CELL, 10 * CELL - CHAR_H, 'fire');
  const input = { left: false, right: true, jump: false };
  for (let i = 0; i < 60; i++) stepChar(walker, input, world.grid);
  assert.ok(walker.x + walker.w <= 7 * CELL, 'should be stopped by the closed door at column 7');

  // Now hold the button and confirm the same walk clears the doorway.
  const holder = miniChar(3 * CELL, 9 * CELL, 'water');
  stepWorld(world, [holder]);
  assert.equal(world.doors.d1, true);
  const walker2 = miniChar(6 * CELL, 10 * CELL - CHAR_H, 'fire');
  for (let i = 0; i < 60; i++) {
    stepWorld(world, [holder, walker2]); // holder keeps standing on the button
    stepChar(walker2, input, world.grid);
  }
  assert.ok(walker2.x > 7 * CELL, 'should pass through the open doorway');
});

test('world: gem collected only by the matching element', () => {
  const level = miniLevel();
  const world = createWorld(level);
  const gemCol = 5;
  const gemRow = 9;

  const wrongElement = miniChar(gemCol * CELL, gemRow * CELL, 'water');
  stepWorld(world, [wrongElement]);
  assert.equal(world.gems[0], false, 'water should not collect a fire gem');
  assert.equal(world.score.water, 0);

  const rightElement = miniChar(gemCol * CELL, gemRow * CELL, 'fire');
  stepWorld(world, [rightElement]);
  assert.equal(world.gems[0], true, 'fire should collect the fire gem');
  assert.equal(world.score.fire, 1);
});

test('exit: level complete requires both characters grounded on their own exit tile', () => {
  const level = miniLevel();
  const world = createWorld(level);
  const { TILE } = CONSTS;

  // The tile a grounded character is standing "on" is the one their feet
  // rest flush against, i.e. floor((y+h)/CELL) — not the row their own body
  // occupies (which would be one row higher).
  function bothOnExit(fire, water, grid) {
    const fireTile = tileAt(grid, Math.floor((fire.x + fire.w / 2) / CELL), Math.floor((fire.y + fire.h) / CELL));
    const waterTile = tileAt(grid, Math.floor((water.x + water.w / 2) / CELL), Math.floor((water.y + water.h) / CELL));
    return fire.onGround && fireTile === TILE.FIRE_EXIT && water.onGround && waterTile === TILE.WATER_EXIT;
  }

  const fire = miniChar(12 * CELL, CELL, 'fire');
  const water = miniChar(13 * CELL, CELL, 'water');
  for (let i = 0; i < 60; i++) {
    stepChar(fire, { left: false, right: false, jump: false }, world.grid);
    stepChar(water, { left: false, right: false, jump: false }, world.grid);
  }
  assert.equal(fire.onGround, true);
  assert.equal(water.onGround, true);
  assert.equal(bothOnExit(fire, water, world.grid), true, 'both grounded on own exits should satisfy the win condition');

  // Swap: fire standing on the water exit tile should NOT satisfy the condition.
  const fireOnWrongExit = miniChar(13 * CELL, CELL, 'fire');
  for (let i = 0; i < 60; i++) stepChar(fireOnWrongExit, { left: false, right: false, jump: false }, world.grid);
  assert.equal(bothOnExit(fireOnWrongExit, water, world.grid), false, 'standing on the wrong exit should not count');
});
})();
