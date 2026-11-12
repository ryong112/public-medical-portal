/* eslint-disable @typescript-eslint/no-require-imports -- Pure TypeScript helper tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/week-carousel.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const current = { exports: {} };
vm.runInNewContext(output, { module: current, exports: current.exports });
const { getWeekCarouselIndices, nextWeekCarouselIndex, normalizeWeekCarouselIndex, canRotateWeekCarousel } = current.exports;

test('carousel wraps rows through the last and first schedules without duplicating the visible window', () => {
  assert.deepEqual(Array.from(getWeekCarouselIndices(5, 4, 3)), [4, 0, 1]);
  assert.deepEqual(Array.from(getWeekCarouselIndices(5, 4, 3, true)), [4, 0, 1, 2]);
  assert.equal(nextWeekCarouselIndex(4, 5), 0);
});
test('a full cycle exposes every schedule in the original order', () => {
  const seen = [];
  let index = 0;
  for (let turn = 0; turn < 12; turn += 1) {
    seen.push(getWeekCarouselIndices(12, index, 3)[0]);
    index = nextWeekCarouselIndex(index, 12);
  }
  assert.deepEqual(seen, Array.from({ length: 12 }, (_, position) => position));
  assert.equal(index, 0);
});
test('short lists have no entering duplicate and do not need automatic movement', () => {
  assert.deepEqual(Array.from(getWeekCarouselIndices(2, 0, 3, true)), [0, 1]);
  assert.deepEqual(Array.from(getWeekCarouselIndices(0, 4, 3, true)), []);
  assert.equal(canRotateWeekCarousel(2, 3), false);
  assert.equal(canRotateWeekCarousel(3, 3), false);
  assert.equal(canRotateWeekCarousel(4, 3), true);
});
test('data and viewport changes preserve a valid bounded start', () => {
  assert.equal(normalizeWeekCarouselIndex(11, 3), 2);
  assert.equal(normalizeWeekCarouselIndex(-1, 3), 2);
  assert.equal(normalizeWeekCarouselIndex(8, 0), 0);
  assert.deepEqual(Array.from(getWeekCarouselIndices(3, 11, 1)), [2]);
  assert.equal(canRotateWeekCarousel(2, 1), true);
});
