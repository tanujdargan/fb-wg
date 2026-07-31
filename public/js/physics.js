// physics.js — pure character physics. No DOM, no globals, no side effects
// beyond mutating the `char` object passed in. Safe to import in Node or
// browser.
//
// Grid tile values (see levels.js / world.js for the authoritative doc):
//   0 empty, 1 solid, 2 fire pool, 3 water pool, 4 goo, 5 fire exit, 6 water exit
//
// A tile is "solid" (stoppable ground/wall) for a character when:
//   - it is a wall (1) or either exit tile (5, 6) — exits are standable floor, or
//   - it is a pool matching the character's own element (fire on fire pool,
//     water on water pool) — characters walk safely on their own element.
// Pools/goo are otherwise non-solid: a character who isn't immune falls
// through them and is killed once their body overlaps the *bottom half* of
// the cell (see TILE VALUES / hazard rules in the project brief).

export const TILE = {
  EMPTY: 0,
  SOLID: 1,
  FIRE_POOL: 2,
  WATER_POOL: 3,
  GOO: 4,
  FIRE_EXIT: 5,
  WATER_EXIT: 6,
};

export const CONSTS = {
  CELL: 20,
  COLS: 39,
  ROWS: 29,
  CHAR_W: 16,
  CHAR_H: 32,
  GRAVITY: 0.35,
  MAX_FALL: 8,
  RUN_SPEED: 2.2,
  JUMP_VEL: -6.5,
  TICK_MS: 1000 / 60,
  TILE,
};

/**
 * Read a tile from a grid, treating out-of-bounds as solid (defensive —
 * well-formed levels always have solid borders so this should never matter).
 */
export function tileAt(grid, col, row) {
  if (row < 0 || row >= grid.length) return TILE.SOLID;
  const r = grid[row];
  if (!r || col < 0 || col >= r.length) return TILE.SOLID;
  return r[col];
}

function isSolidTileFor(tile, element) {
  if (tile === TILE.SOLID || tile === TILE.FIRE_EXIT || tile === TILE.WATER_EXIT) return true;
  if (tile === TILE.FIRE_POOL && element === 'fire') return true;
  if (tile === TILE.WATER_POOL && element === 'water') return true;
  return false;
}

function cellRange(pos, size, cell) {
  return [Math.floor(pos / cell), Math.floor((pos + size - 1) / cell)];
}

function rectSolid(grid, x, y, w, h, element) {
  const { CELL } = CONSTS;
  const [colMin, colMax] = cellRange(x, w, CELL);
  const [rowMin, rowMax] = cellRange(y, h, CELL);
  for (let r = rowMin; r <= rowMax; r++) {
    for (let c = colMin; c <= colMax; c++) {
      if (isSolidTileFor(tileAt(grid, c, r), element)) return true;
    }
  }
  return false;
}

// Moves a single axis by `delta` pixels and resolves collision by snapping
// flush to the tile boundary. Safe against tunnelling as long as |delta| is
// smaller than CONSTS.CELL (true for all tuned constants: RUN_SPEED and
// MAX_FALL are both well under CELL=20).
function moveAxis(char, grid, axis, delta) {
  if (!delta) return;
  const { CELL } = CONSTS;
  if (axis === 'x') {
    const newX = char.x + delta;
    if (rectSolid(grid, newX, char.y, char.w, char.h, char.element)) {
      if (delta > 0) {
        const col = Math.floor((newX + char.w - 1) / CELL);
        char.x = col * CELL - char.w;
      } else {
        const col = Math.floor(newX / CELL);
        char.x = (col + 1) * CELL;
      }
      char.vx = 0;
    } else {
      char.x = newX;
    }
  } else {
    const newY = char.y + delta;
    if (rectSolid(grid, char.x, newY, char.w, char.h, char.element)) {
      if (delta > 0) {
        const row = Math.floor((newY + char.h - 1) / CELL);
        char.y = row * CELL - char.h;
        char.onGround = true;
      } else {
        const row = Math.floor(newY / CELL);
        char.y = (row + 1) * CELL;
      }
      char.vy = 0;
    } else {
      char.y = newY;
    }
  }
}

function applyHazards(char, grid) {
  const { CELL } = CONSTS;
  const [colMin, colMax] = cellRange(char.x, char.w, CELL);
  const [rowMin, rowMax] = cellRange(char.y, char.h, CELL);
  for (let r = rowMin; r <= rowMax; r++) {
    for (let c = colMin; c <= colMax; c++) {
      const t = tileAt(grid, c, r);
      if (t !== TILE.FIRE_POOL && t !== TILE.WATER_POOL && t !== TILE.GOO) continue;
      const cellLeft = c * CELL;
      const cellRight = cellLeft + CELL;
      const hazardTop = r * CELL + CELL / 2; // hazards only occupy the bottom half of the cell
      const hazardBottom = r * CELL + CELL;
      const overlapX = char.x < cellRight && char.x + char.w > cellLeft;
      const overlapY = char.y < hazardBottom && char.y + char.h > hazardTop;
      if (!overlapX || !overlapY) continue;
      if (t === TILE.GOO) {
        char.alive = false;
      } else if (t === TILE.FIRE_POOL && char.element === 'water') {
        char.alive = false;
      } else if (t === TILE.WATER_POOL && char.element === 'fire') {
        char.alive = false;
      }
    }
  }
}

/**
 * Advance one character by one fixed 60Hz tick, mutating it in place.
 * char: {x,y,vx,vy,w,h,onGround,element,alive}
 * input: {left,right,jump}
 * grid: 29x39 array of tile ints (the *effective* collision grid — the
 *       caller is responsible for baking dynamic door state into it before
 *       calling stepChar; see world.js).
 */
export function stepChar(char, input, grid) {
  if (char.alive === false) return char;

  const { GRAVITY, MAX_FALL, RUN_SPEED, JUMP_VEL } = CONSTS;

  let vx = 0;
  if (input && input.left) vx -= RUN_SPEED;
  if (input && input.right) vx += RUN_SPEED;
  char.vx = vx;
  moveAxis(char, grid, 'x', vx);

  char.vy = Math.min(char.vy + GRAVITY, MAX_FALL);
  if (input && input.jump && char.onGround) {
    char.vy = JUMP_VEL;
    char.onGround = false;
  }
  char.onGround = false;
  moveAxis(char, grid, 'y', char.vy);

  applyHazards(char, grid);

  return char;
}
