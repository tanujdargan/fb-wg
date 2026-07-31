// main.js — screen state machine + fixed-step game loop. Browser entry
// point; wires together physics.js, world.js, render.js, input.js,
// levels.js and transport-mock.js. Not imported by the Node test suite.

import { CONSTS, TILE, stepChar, tileAt } from './physics.js';
import { createWorld, stepWorld } from './world.js';
import { render } from './render.js';
import { createInput } from './input.js';
import { loadLevel } from './levels.js';
import { createTransport } from './transport-mock.js';

const { CELL, CHAR_W, CHAR_H, TICK_MS } = CONSTS;
const RESPAWN_TICKS = Math.round(800 / TICK_MS); // 800ms worth of fixed ticks
const TOTAL_LEVELS = 4;

const els = {
  screens: Array.from(document.querySelectorAll('.screen')),
  lobbyName: document.getElementById('lobby-name'),
  lobbyCode: document.getElementById('lobby-code'),
  lobbyStatus: document.getElementById('lobby-status'),
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  charselectStatus: document.getElementById('charselect-status'),
  chooseFire: document.getElementById('choose-fire'),
  chooseWater: document.getElementById('choose-water'),
  canvas: document.getElementById('game-canvas'),
  levelDoneStats: document.getElementById('level-done-stats'),
  btnNextLevel: document.getElementById('btn-next-level'),
  btnRestart: document.getElementById('btn-restart'),
};

const ctx = els.canvas.getContext('2d');

function showScreen(id) {
  for (const el of els.screens) el.classList.toggle('active', el.id === id);
}

// -- transport / lobby / character select ----------------------------------

const transport = createTransport();
let myElement = null;
let otherElement = null;
let inputMine = null;
let inputOther = null;

transport.on('peer-joined', () => {
  els.charselectStatus.textContent = 'Player 2 joined — choose your character.';
});

transport.on('claimed', ({ who, element }) => {
  const btn = element === 'fire' ? els.chooseFire : els.chooseWater;
  btn.disabled = true;
  btn.classList.add('taken');
  els.charselectStatus.textContent =
    who === 'me' ? `You are ${element}. Waiting for the other player…` : `${element} was claimed.`;
});

transport.on('error', ({ message }) => {
  els.charselectStatus.textContent = message;
});

transport.on('start', (payload) => {
  myElement = payload.fire === 'me' ? 'fire' : 'water';
  otherElement = myElement === 'fire' ? 'water' : 'fire';

  if (inputMine) inputMine.destroy();
  if (inputOther) inputOther.destroy();
  // Local mock mode: the real human always drives their claimed character
  // with WASD; the mock peer's character is driven by the SAME keyboard's
  // arrow keys, so both characters are playable locally for testing.
  inputMine = createInput('wasd');
  inputOther = createInput('arrows');

  showScreen('screen-game');
  startLevel(1);
});

async function createRoom() {
  const name = els.lobbyName.value.trim() || 'Player';
  els.lobbyStatus.textContent = 'Creating room…';
  els.btnCreate.disabled = true;
  els.btnJoin.disabled = true;
  try {
    const { code } = await transport.create({ name });
    els.lobbyStatus.textContent = `Room code: ${code}. A second player will join shortly…`;
    showScreen('screen-charselect');
    els.charselectStatus.textContent = 'Waiting for a second player…';
  } catch (err) {
    els.lobbyStatus.textContent = `Failed to create room: ${err.message}`;
    els.btnCreate.disabled = false;
    els.btnJoin.disabled = false;
  }
}

async function joinRoom() {
  const name = els.lobbyName.value.trim() || 'Player';
  const code = els.lobbyCode.value.trim();
  if (!code) {
    els.lobbyStatus.textContent = 'Enter a room code to join.';
    return;
  }
  els.lobbyStatus.textContent = 'Joining room…';
  els.btnCreate.disabled = true;
  els.btnJoin.disabled = true;
  try {
    await transport.join({ code, name });
    els.lobbyStatus.textContent = `Joined room ${code}.`;
    showScreen('screen-charselect');
    els.charselectStatus.textContent = 'Waiting for a second player…';
  } catch (err) {
    els.lobbyStatus.textContent = `Failed to join room: ${err.message}`;
    els.btnCreate.disabled = false;
    els.btnJoin.disabled = false;
  }
}

els.btnCreate.addEventListener('click', createRoom);
els.btnJoin.addEventListener('click', joinRoom);
els.chooseFire.addEventListener('click', () => transport.send({ type: 'claim', element: 'fire' }));
els.chooseWater.addEventListener('click', () => transport.send({ type: 'claim', element: 'water' }));

// -- game state --------------------------------------------------------------

const game = {
  levelNum: 0,
  level: null,
  world: null,
  fire: null,
  water: null,
  tickCount: 0,
  deathTick: null,
  running: false,
};

function spawnChar(level, element) {
  const [col, row] = level.spawns[element];
  return {
    x: col * CELL,
    y: row * CELL,
    vx: 0,
    vy: 0,
    w: CHAR_W,
    h: CHAR_H,
    onGround: false,
    element,
    alive: true,
  };
}

function resetCharsAndWorld() {
  game.world = createWorld(game.level);
  game.fire = spawnChar(game.level, 'fire');
  game.water = spawnChar(game.level, 'water');
  game.deathTick = null;
}

async function startLevel(n) {
  game.levelNum = n;
  game.level = await loadLevel(n);
  resetCharsAndWorld();
  game.tickCount = 0;
  game.running = true;
  lastFrameTime = null;
  accumulator = 0;
  requestAnimationFrame(frame);
}

function inputFor(element) {
  const src = element === myElement ? inputMine : inputOther;
  return src ? src.state : { left: false, right: false, jump: false };
}

// The tile a grounded character stands "on" is the one just below their
// feet: floor((y+h)/CELL), not the row their own body occupies.
function tileUnderFeet(char, grid) {
  const col = Math.floor((char.x + char.w / 2) / CELL);
  const row = Math.floor((char.y + char.h) / CELL);
  return tileAt(grid, col, row);
}

function bothOnExit() {
  const { fire, water, world } = game;
  return (
    fire.onGround &&
    tileUnderFeet(fire, world.grid) === TILE.FIRE_EXIT &&
    water.onGround &&
    tileUnderFeet(water, world.grid) === TILE.WATER_EXIT
  );
}

function tick() {
  game.tickCount++;
  stepChar(game.fire, inputFor('fire'), game.world.grid);
  stepChar(game.water, inputFor('water'), game.world.grid);
  stepWorld(game.world, [game.fire, game.water]);

  if (game.deathTick !== null) {
    if (game.tickCount - game.deathTick >= RESPAWN_TICKS) {
      resetCharsAndWorld();
    }
    return;
  }

  if (game.fire.alive === false || game.water.alive === false) {
    game.deathTick = game.tickCount;
    return;
  }

  if (bothOnExit()) {
    game.running = false;
    onLevelComplete();
  }
}

function onLevelComplete() {
  const { score } = game.world;
  els.levelDoneStats.textContent = `Gems collected — fire: ${score.fire || 0}, water: ${score.water || 0}`;
  els.btnNextLevel.textContent = game.levelNum >= TOTAL_LEVELS ? 'Finish' : 'Continue';
  showScreen('screen-level-done');
}

els.btnNextLevel.addEventListener('click', () => {
  if (game.levelNum >= TOTAL_LEVELS) {
    showScreen('screen-win');
  } else {
    showScreen('screen-game');
    startLevel(game.levelNum + 1);
  }
});

els.btnRestart.addEventListener('click', () => {
  window.location.reload();
});

let lastFrameTime = null;
let accumulator = 0;

function buildHud() {
  return {
    levelName: game.level ? game.level.name : '',
    score: game.world ? game.world.score : { fire: 0, water: 0 },
    message: game.deathTick !== null ? 'Ouch! Respawning…' : '',
  };
}

function frame(ts) {
  if (!game.running) return;
  if (lastFrameTime == null) lastFrameTime = ts;
  let dt = ts - lastFrameTime;
  lastFrameTime = ts;
  if (dt > 250) dt = 250; // clamp after tab-away / stalls
  accumulator += dt;

  // Fixed 60Hz simulation step driven by an accumulator; never step physics
  // directly inside rAF.
  while (accumulator >= TICK_MS) {
    tick();
    accumulator -= TICK_MS;
    if (!game.running) break;
  }

  render(ctx, {
    level: game.level,
    world: game.world,
    chars: [game.fire, game.water],
    t: ts,
    dt,
    hud: buildHud(),
  });

  if (game.running) requestAnimationFrame(frame);
}

showScreen('screen-lobby');
