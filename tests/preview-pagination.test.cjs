/* eslint-disable @typescript-eslint/no-require-imports -- Run pure TypeScript paging helpers with Node's built-in test runner. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const current = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '..', 'lib/preview-pagination.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: current, exports: current.exports });
const { createPreviewWheelGesture, normalizePreviewWheel, consumePreviewWheel, getPreviewPageWindow } = current.exports;

test('wheel units normalize without changing horizontal or zoom behavior at the caller', () => {
  assert.equal(normalizePreviewWheel(4, 0, 400), 4);
  assert.equal(normalizePreviewWheel(4, 1, 400), 64);
  assert.equal(normalizePreviewWheel(1, 2, 400), 400);
});

test('small trackpad deltas accumulate and the momentum tail turns only one page', () => {
  let state = createPreviewWheelGesture();
  const turns = [];
  for (let index = 0; index < 30; index += 1) {
    const result = consumePreviewWheel(state, 20, index * 30);
    state = result.state; turns.push(result.direction);
  }
  assert.deepEqual(turns.filter(Boolean), [1]);
  const next = consumePreviewWheel(state, 80, 1200);
  assert.equal(next.direction, 1);
});

test('reverse gestures respect the minimum lock and can deliberately return', () => {
  const first = consumePreviewWheel(createPreviewWheelGesture(), 120, 0);
  assert.equal(first.direction, 1);
  const locked = consumePreviewWheel(first.state, -120, 100);
  assert.equal(locked.direction, 0);
  assert.equal(consumePreviewWheel(locked.state, -120, 400).direction, -1);
});

test('a bounded page window retains the first, current and last pages', () => {
  assert.deepEqual(Array.from(getPreviewPageWindow(0, 2)), [0, 1]);
  for (const currentPage of [0, 1, 6, 14, 49]) {
    const pages = Array.from(getPreviewPageWindow(currentPage, 50));
    assert.equal(pages.length, 7);
    assert.equal(pages[0], 0);
    assert.equal(pages.at(-1), 49);
    assert.ok(pages.includes(currentPage));
    assert.deepEqual(pages, [...new Set(pages)].sort((a, b) => a - b));
  }
  assert.deepEqual(Array.from(getPreviewPageWindow(16, 50, 3)), [0, 16, 49]);
});
