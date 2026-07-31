// input.js — keyboard + touch input. Browser-only (DOM). Produces a live
// {left,right,jump} state object that main.js reads once per fixed tick.
//
// createInput(mode): mode is 'wasd' (A/D + W or Space) or 'arrows'
// (ArrowLeft/ArrowRight + ArrowUp or Space). When 'ontouchstart' in window,
// also renders semi-transparent on-screen controls: left/right buttons
// bottom-left, jump button bottom-right. Multi-touch safe (each button
// tracks its own set of active touch identifiers).

const KEY_MAPS = {
  wasd: {
    left: new Set(['a', 'A']),
    right: new Set(['d', 'D']),
    jump: new Set(['w', 'W', ' ']),
  },
  arrows: {
    left: new Set(['ArrowLeft']),
    right: new Set(['ArrowRight']),
    jump: new Set(['ArrowUp', ' ']),
  },
};

function attachTouchButton(el, onChange) {
  const active = new Set();
  const update = () => onChange(active.size > 0);

  const start = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) active.add(t.identifier);
    update();
  };
  const end = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) active.delete(t.identifier);
    update();
  };

  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });

  return () => {
    el.removeEventListener('touchstart', start);
    el.removeEventListener('touchend', end);
    el.removeEventListener('touchcancel', end);
  };
}

function buildTouchOverlay(state) {
  const wrap = document.createElement('div');
  wrap.className = 'touch-controls';

  const leftBtn = document.createElement('button');
  leftBtn.className = 'touch-btn touch-btn--left';
  leftBtn.textContent = '◀';
  leftBtn.setAttribute('aria-label', 'left');

  const rightBtn = document.createElement('button');
  rightBtn.className = 'touch-btn touch-btn--right';
  rightBtn.textContent = '▶';
  rightBtn.setAttribute('aria-label', 'right');

  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'touch-btn touch-btn--jump';
  jumpBtn.textContent = '⤒';
  jumpBtn.setAttribute('aria-label', 'jump');

  const dpad = document.createElement('div');
  dpad.className = 'touch-dpad';
  dpad.appendChild(leftBtn);
  dpad.appendChild(rightBtn);
  wrap.appendChild(dpad);
  wrap.appendChild(jumpBtn);
  document.body.appendChild(wrap);

  const touchLeft = { down: false };
  const touchRight = { down: false };
  const touchJump = { down: false };

  const cleanups = [
    attachTouchButton(leftBtn, (down) => {
      touchLeft.down = down;
    }),
    attachTouchButton(rightBtn, (down) => {
      touchRight.down = down;
    }),
    attachTouchButton(jumpBtn, (down) => {
      touchJump.down = down;
    }),
  ];

  return {
    touchLeft,
    touchRight,
    touchJump,
    destroy() {
      cleanups.forEach((fn) => fn());
      wrap.remove();
    },
  };
}

/**
 * Creates a live input source. Returns { state: {left,right,jump}, destroy }.
 * `state` is mutated in place every animation frame / keystroke — read it
 * fresh each fixed-tick call to stepChar.
 */
export function createInput(mode = 'wasd') {
  const map = KEY_MAPS[mode] || KEY_MAPS.wasd;
  const state = { left: false, right: false, jump: false };
  const keysDown = new Set();

  let touch = null;
  if (typeof window !== 'undefined' && 'ontouchstart' in window) {
    touch = buildTouchOverlay(state);
  }

  function recompute() {
    let left = false;
    let right = false;
    let jump = false;
    for (const k of keysDown) {
      if (map.left.has(k)) left = true;
      if (map.right.has(k)) right = true;
      if (map.jump.has(k)) jump = true;
    }
    if (touch) {
      if (touch.touchLeft.down) left = true;
      if (touch.touchRight.down) right = true;
      if (touch.touchJump.down) jump = true;
    }
    state.left = left;
    state.right = right;
    state.jump = jump;
  }

  const onKeyDown = (e) => {
    keysDown.add(e.key);
    recompute();
  };
  const onKeyUp = (e) => {
    keysDown.delete(e.key);
    recompute();
  };
  const onBlur = () => {
    keysDown.clear();
    recompute();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  // Touch state is polled continuously via recompute() calls, but nothing
  // drives recompute() after a touch-only change; patch touch handlers to
  // call it too by re-wrapping onChange through recompute on every raf tick
  // is wasteful, so instead we just recompute on every touch event by
  // hooking into the touch state setters above via a light poller here.
  let pollHandle = null;
  if (touch) {
    const poll = () => {
      recompute();
      pollHandle = requestAnimationFrame(poll);
    };
    pollHandle = requestAnimationFrame(poll);
  }

  return {
    state,
    destroy() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      }
      if (pollHandle) cancelAnimationFrame(pollHandle);
      if (touch) touch.destroy();
    },
  };
}
