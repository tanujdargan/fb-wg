// See physics.test.js for why this CommonJS file dynamic-imports the ES
// module game code under public/js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const mapsDir = path.join(__dirname, '..', 'public', 'maps');

function loadJson(n) {
  return JSON.parse(readFileSync(path.join(mapsDir, `level${n}.json`), 'utf8'));
}

(async () => {
  const { validateLevel } = await import('../public/js/levels.js');

  for (const n of [1, 2, 3, 4]) {
    test(`level${n}.json passes validateLevel`, () => {
      const json = loadJson(n);
      assert.equal(validateLevel(json), true);
    });
  }

  test('validateLevel rejects wrong grid dimensions', () => {
    const bad = loadJson(1);
    bad.grid = bad.grid.slice(0, 10);
    assert.throws(() => validateLevel(bad), /29 rows/);
  });

  test('validateLevel rejects out-of-range tile ints', () => {
    const bad = loadJson(1);
    bad.grid[5][5] = 9;
    assert.throws(() => validateLevel(bad), /int 0-6/);
  });

  test('validateLevel rejects a spawn on a non-empty cell', () => {
    const bad = loadJson(1);
    bad.spawns.fire = [1, 0]; // border cell, solid
    assert.throws(() => validateLevel(bad), /empty cell/);
  });

  test('validateLevel rejects a door referencing an unknown button', () => {
    const bad = loadJson(3);
    bad.objects.doors[0].button = 'nope';
    assert.throws(() => validateLevel(bad), /unknown button/);
  });

  test('validateLevel rejects a non-solid border cell', () => {
    const bad = loadJson(1);
    bad.grid[0][5] = 0;
    assert.throws(() => validateLevel(bad), /border cell/);
  });

  test('validateLevel rejects a level missing an exit tile', () => {
    const bad = loadJson(1);
    bad.grid = bad.grid.map((row) => row.map((v) => (v === 5 ? 1 : v)));
    assert.throws(() => validateLevel(bad), /fire exit/);
  });
})();
