// levels.js — level loading + validation. No DOM references at module top
// level (loadLevel uses fetch, but only inside the function body, so this
// file is still importable under Node for validateLevel/testing).

const COLS = 39;
const ROWS = 29;

function inBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

/**
 * Throws a descriptive Error if `json` is not a well-formed, self-consistent
 * level. Returns true on success.
 */
export function validateLevel(json) {
  function fail(msg) {
    throw new Error(`Invalid level: ${msg}`);
  }

  if (!json || typeof json !== 'object') fail('level must be an object');
  if (typeof json.name !== 'string' || !json.name.trim()) fail('name must be a non-empty string');

  if (!Array.isArray(json.grid)) fail('grid must be an array');
  if (json.grid.length !== ROWS) fail(`grid must have ${ROWS} rows, got ${json.grid.length}`);
  json.grid.forEach((row, r) => {
    if (!Array.isArray(row)) fail(`row ${r} must be an array`);
    if (row.length !== COLS) fail(`row ${r} must have ${COLS} cols, got ${row.length}`);
    row.forEach((v, c) => {
      if (!Number.isInteger(v) || v < 0 || v > 6) {
        fail(`grid[${r}][${c}] must be an int 0-6, got ${JSON.stringify(v)}`);
      }
    });
  });

  for (let c = 0; c < COLS; c++) {
    if (json.grid[0][c] !== 1) fail(`top border cell col ${c} must be solid`);
    if (json.grid[ROWS - 1][c] !== 1) fail(`bottom border cell col ${c} must be solid`);
  }
  for (let r = 0; r < ROWS; r++) {
    if (json.grid[r][0] !== 1) fail(`left border cell row ${r} must be solid`);
    if (json.grid[r][COLS - 1] !== 1) fail(`right border cell row ${r} must be solid`);
  }

  const hasFireExit = json.grid.some((row) => row.includes(5));
  const hasWaterExit = json.grid.some((row) => row.includes(6));
  if (!hasFireExit) fail('grid must contain at least one fire exit tile (5)');
  if (!hasWaterExit) fail('grid must contain at least one water exit tile (6)');

  if (!json.spawns || typeof json.spawns !== 'object') fail('spawns required');
  for (const el of ['fire', 'water']) {
    const s = json.spawns[el];
    if (!Array.isArray(s) || s.length !== 2) fail(`spawns.${el} must be [col,row]`);
    const [col, row] = s;
    if (!inBounds(col, row)) fail(`spawns.${el} (${col},${row}) out of bounds`);
    if (json.grid[row][col] !== 0) fail(`spawns.${el} must be on an empty cell, found ${json.grid[row][col]}`);
  }

  const objects = json.objects || {};
  const gems = objects.gems || [];
  const buttons = objects.buttons || [];
  const doors = objects.doors || [];

  const buttonIds = new Set();
  buttons.forEach((b, i) => {
    if (!b || typeof b.id !== 'string' || !b.id) fail(`buttons[${i}] missing id`);
    if (buttonIds.has(b.id)) fail(`duplicate button id "${b.id}"`);
    buttonIds.add(b.id);
    if (!inBounds(b.x, b.y)) fail(`buttons[${i}] (${b.x},${b.y}) out of bounds`);
  });

  const doorIds = new Set();
  doors.forEach((d, i) => {
    if (!d || typeof d.id !== 'string' || !d.id) fail(`doors[${i}] missing id`);
    if (doorIds.has(d.id)) fail(`duplicate door id "${d.id}"`);
    doorIds.add(d.id);
    if (!inBounds(d.x, d.y)) fail(`doors[${i}] (${d.x},${d.y}) out of bounds`);
    if (!Number.isInteger(d.h) || d.h < 1) fail(`doors[${i}] h must be a positive integer`);
    if (d.y < 1 || d.y + d.h - 1 > ROWS - 2) fail(`doors[${i}] extends outside the interior vertically`);
    if (!buttonIds.has(d.button)) fail(`doors[${i}] references unknown button "${d.button}"`);
  });

  gems.forEach((g, i) => {
    if (!g || (g.element !== 'fire' && g.element !== 'water')) {
      fail(`gems[${i}] element must be "fire" or "water"`);
    }
    if (!inBounds(g.x, g.y)) fail(`gems[${i}] (${g.x},${g.y}) out of bounds`);
  });

  return true;
}

/**
 * Fetches and validates public/maps/level{n}.json. Browser-only (uses
 * fetch); not exercised by the Node test suite.
 */
export async function loadLevel(n) {
  const res = await fetch(`maps/level${n}.json`);
  if (!res.ok) throw new Error(`Failed to load level ${n}: HTTP ${res.status}`);
  const json = await res.json();
  validateLevel(json);
  return json;
}
