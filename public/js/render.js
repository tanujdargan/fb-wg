// render.js — all drawing. Every shape is drawn programmatically on canvas;
// no images are ever loaded. This module is browser-only (canvas 2D
// context) and is not imported by the Node test suite.

import { CONSTS, TILE } from './physics.js';

const { CELL, COLS, ROWS } = CONSTS;

export const CANVAS_W = COLS * CELL; // 780
export const CANVAS_H = ROWS * CELL; // 580

// Smoothed door openness per door id, so the barrier visibly slides instead
// of popping between states. Purely a rendering nicety — world.js state is
// the authoritative boolean.
const doorAnim = new Map();

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  g.addColorStop(0, '#1b2440');
  g.addColorStop(1, '#2c3a63');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawSolidTile(ctx, x, y) {
  ctx.fillStyle = '#5b4636';
  ctx.fillRect(x, y, CELL, CELL);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, CELL, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y + CELL - 3, CELL, 3);
}

function drawExitTile(ctx, x, y, color, glow) {
  ctx.fillStyle = '#3a3226';
  ctx.fillRect(x, y, CELL, CELL);
  const pulse = 0.55 + 0.25 * Math.sin(glow);
  ctx.fillStyle = color;
  ctx.globalAlpha = pulse;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
  ctx.globalAlpha = 1;
}

function drawHazardTile(ctx, x, y, tile, t) {
  // base pit
  ctx.fillStyle = '#161c2e';
  ctx.fillRect(x, y, CELL, CELL);
  const bob = Math.sin(t / 220 + x * 0.05) * 1.5;
  const top = y + CELL / 2 + bob;
  const height = CELL / 2 - bob;
  let color1, color2;
  if (tile === TILE.FIRE_POOL) {
    color1 = '#ff8a3d';
    color2 = '#d43b1c';
  } else if (tile === TILE.WATER_POOL) {
    color1 = '#5fd0ff';
    color2 = '#1c6fd4';
  } else {
    color1 = '#9cff6b';
    color2 = '#4c7a1f';
  }
  const g = ctx.createLinearGradient(0, top, 0, y + CELL);
  g.addColorStop(0, color1);
  g.addColorStop(1, color2);
  ctx.fillStyle = g;
  ctx.fillRect(x, top, CELL, Math.max(0, height));
}

function drawTiles(ctx, grid, t) {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const tile = row[c];
      if (tile === TILE.EMPTY) continue;
      const x = c * CELL;
      const y = r * CELL;
      if (tile === TILE.SOLID) drawSolidTile(ctx, x, y);
      else if (tile === TILE.FIRE_EXIT) drawExitTile(ctx, x, y, '#ff7a3d', t / 260 + c);
      else if (tile === TILE.WATER_EXIT) drawExitTile(ctx, x, y, '#4db6ff', t / 260 + c);
      else drawHazardTile(ctx, x, y, tile, t);
    }
  }
}

function drawButtons(ctx, level, world) {
  const buttons = (level.objects && level.objects.buttons) || [];
  for (const b of buttons) {
    const pressed = !!world.buttons[b.id];
    const x = b.x * CELL;
    const y = b.y * CELL;
    const plateH = pressed ? 4 : 6;
    ctx.fillStyle = '#8a8f9c';
    ctx.fillRect(x + 3, y + CELL - 6, CELL - 6, 6);
    ctx.fillStyle = pressed ? '#ffd76a' : '#f2c94c';
    ctx.fillRect(x + 3, y + CELL - plateH - 2, CELL - 6, plateH);
  }
}

function drawDoors(ctx, level, world, dt) {
  const doors = (level.objects && level.objects.doors) || [];
  for (const d of doors) {
    const target = world.doors[d.id] ? 1 : 0;
    const cur = doorAnim.has(d.id) ? doorAnim.get(d.id) : target;
    const next = lerp(cur, target, Math.min(1, dt / 120));
    doorAnim.set(d.id, next);

    const x = d.x * CELL;
    const yTop = d.y * CELL;
    const fullH = d.h * CELL;
    // Closed (next=0): full bar. Open (next=1): retracted upward, leaving a
    // small track cap so the doorway is still visually legible.
    const visibleH = fullH * (1 - next * 0.85);
    const y = yTop + (fullH - visibleH);
    ctx.fillStyle = '#7c8a9e';
    ctx.fillRect(x + 2, yTop, CELL - 4, 4); // track cap at the top
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x + 4, y, CELL - 8, visibleH);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeRect(x + 4, y, CELL - 8, visibleH);
  }
}

function drawGems(ctx, level, world, t) {
  const gems = (level.objects && level.objects.gems) || [];
  gems.forEach((g, i) => {
    if (world.gems[i]) return;
    const cx = g.x * CELL + CELL / 2;
    const cy = g.y * CELL + CELL / 2 + Math.sin(t / 260 + i) * 2;
    const size = 6;
    const color = g.element === 'fire' ? '#ff9f4d' : '#5fc4ff';
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.75, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.75, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

export function drawChar(ctx, char) {
  if (char.alive === false) return; // dead characters are hidden until respawn
  const isFire = char.element === 'fire';
  const bodyColor = isFire ? '#ff5a36' : '#3aa0ff';
  const bodyColor2 = isFire ? '#c22c14' : '#0d5fb0';

  ctx.save();
  const g = ctx.createLinearGradient(char.x, char.y, char.x, char.y + char.h);
  g.addColorStop(0, bodyColor);
  g.addColorStop(1, bodyColor2);
  ctx.fillStyle = g;
  roundRect(ctx, char.x, char.y, char.w, char.h, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();

  // eyes
  const eyeY = char.y + char.h * 0.32;
  const dir = char.vx > 0.05 ? 1 : char.vx < -0.05 ? -1 : 0;
  const eyeOffset = 3 + dir * 1;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(char.x + char.w / 2 - eyeOffset, eyeY, 2.4, 0, Math.PI * 2);
  ctx.arc(char.x + char.w / 2 + eyeOffset, eyeY, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#161c2e';
  ctx.beginPath();
  ctx.arc(char.x + char.w / 2 - eyeOffset + dir * 0.6, eyeY, 1.1, 0, Math.PI * 2);
  ctx.arc(char.x + char.w / 2 + eyeOffset + dir * 0.6, eyeY, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawHUD(ctx, { levelName, score, message }) {
  ctx.save();
  ctx.font = '600 14px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(10,14,26,0.55)';
  ctx.fillRect(0, 0, CANVAS_W, 28);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(levelName || '', 10, 14);

  const scoreText = `🔥 ${score?.fire || 0}    💧 ${score?.water || 0}`;
  ctx.textAlign = 'right';
  ctx.fillText(scoreText, CANVAS_W - 10, 14);
  ctx.textAlign = 'left';

  if (message) {
    ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,14,26,0.65)';
    ctx.fillRect(CANVAS_W / 2 - 160, CANVAS_H / 2 - 24, 320, 48);
    ctx.fillStyle = '#fff';
    ctx.fillText(message, CANVAS_W / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/**
 * Draws one full frame. `t` is a monotonically increasing ms timestamp used
 * for cosmetic animation (liquid bob, exit pulse, gem float); `dt` is the ms
 * since the previous render call, used to smooth door motion.
 */
export function render(ctx, { level, world, chars, t = 0, dt = 16, hud = {} }) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawBackground(ctx);
  drawTiles(ctx, world.grid, t);
  drawButtons(ctx, level, world);
  drawDoors(ctx, level, world, dt);
  drawGems(ctx, level, world, t);
  for (const char of chars) drawChar(ctx, char);
  drawHUD(ctx, hud);
}
