// world.js — shared-object simulation: buttons, doors, gems.
// Deterministic given (level, chars) inputs. No DOM, no globals.
//
// createWorld(level)            -> world
// stepWorld(world, chars)       -> world   (host-side simulation)
// serializeWorld(world)         -> plain JSON snapshot
// applyWorld(world, snapshot)   -> world   (guest-side: adopt host snapshot)
//
// world.grid is the *effective collision grid* — a clone of level.grid with
// door cells baked in as solid (1) while closed. Pass world.grid to
// stepChar() so characters collide with closed doors.

import { CONSTS } from './physics.js';

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function cellOverlapsChar(char, col, row) {
  const { CELL } = CONSTS;
  const cx = col * CELL;
  const cy = row * CELL;
  return (
    char.x < cx + CELL &&
    char.x + char.w > cx &&
    char.y < cy + CELL &&
    char.y + char.h > cy
  );
}

function applyDoors(world) {
  const { level, grid, doors } = world;
  const list = (level.objects && level.objects.doors) || [];
  for (const d of list) {
    const open = !!doors[d.id];
    for (let i = 0; i < d.h; i++) {
      const row = d.y + i;
      if (row < 0 || row >= grid.length) continue;
      grid[row][d.x] = open ? level.grid[row][d.x] : 1;
    }
  }
}

export function createWorld(level) {
  const grid = cloneGrid(level.grid);
  const buttons = {};
  for (const b of (level.objects && level.objects.buttons) || []) buttons[b.id] = false;
  const doors = {};
  for (const d of (level.objects && level.objects.doors) || []) doors[d.id] = false;
  const gems = {};
  ((level.objects && level.objects.gems) || []).forEach((_, i) => {
    gems[i] = false;
  });

  const world = {
    level,
    grid,
    buttons,
    doors,
    gems,
    score: { fire: 0, water: 0 },
  };
  applyDoors(world);
  return world;
}

export function stepWorld(world, chars) {
  const level = world.level;
  const alive = chars.filter((c) => c.alive !== false);

  for (const b of (level.objects && level.objects.buttons) || []) {
    world.buttons[b.id] = alive.some((ch) => cellOverlapsChar(ch, b.x, b.y));
  }

  for (const d of (level.objects && level.objects.doors) || []) {
    world.doors[d.id] = !!world.buttons[d.button];
  }
  applyDoors(world);

  ((level.objects && level.objects.gems) || []).forEach((g, i) => {
    if (world.gems[i]) return;
    const got = alive.find((ch) => ch.element === g.element && cellOverlapsChar(ch, g.x, g.y));
    if (got) {
      world.gems[i] = true;
      world.score[g.element] = (world.score[g.element] || 0) + 1;
    }
  });

  return world;
}

export function serializeWorld(world) {
  return JSON.parse(
    JSON.stringify({
      buttons: world.buttons,
      doors: world.doors,
      gems: world.gems,
      score: world.score,
    })
  );
}

export function applyWorld(world, snapshot) {
  world.buttons = { ...snapshot.buttons };
  world.doors = { ...snapshot.doors };
  world.gems = { ...snapshot.gems };
  world.score = { ...snapshot.score };
  applyDoors(world);
  return world;
}
