/* eslint-disable @typescript-eslint/no-require-imports -- Local TypeScript geometry regression. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib/team-chat-window.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
const { clampChatWindow, defaultChatWindow, parseChatWindow } = loaded.exports;

test('default chat is a compact independent desktop window, not a full-page overlay', () => {
  assert.deepEqual(defaultChatWindow({ width: 1600, height: 1000 }), { x: 1156, y: 256, width: 420, height: 720 });
});

test('moving and resizing keep every edge reachable inside the viewport', () => {
  assert.deepEqual(clampChatWindow({ x: -900, y: -800, width: 100, height: 150 }, { width: 1365, height: 950 }), { x: 16, y: 16, width: 340, height: 360 });
  assert.deepEqual(clampChatWindow({ x: 9000, y: 9000, width: 9000, height: 9000 }, { width: 1365, height: 950 }), { x: 16, y: 16, width: 1333, height: 918 });
});

test('a smaller screen clamps old saved coordinates without losing the close button', () => {
  const next = clampChatWindow({ x: 1600, y: 900, width: 600, height: 800 }, { width: 800, height: 600 });
  assert.equal(next.x + next.width, 784);
  assert.equal(next.y + next.height, 584);
  assert.equal(next.width, 600);
  assert.equal(next.height, 568);
  const short = defaultChatWindow({ width: 800, height: 300 });
  assert.equal(short.height, 268);
  assert.equal(short.y, 16);
});

test('storage accepts versioned numeric geometry only, never executable content', () => {
  const geometry = { x: 40, y: 30, width: 500, height: 600 };
  assert.deepEqual(parseChatWindow(JSON.stringify({ version: 1, ...geometry })), geometry);
  for (const invalid of [null, '', 'not json', '[]', 'null', '{}', JSON.stringify({ version: 2, ...geometry }), JSON.stringify({ version: 1, ...geometry, width: '500' }), '{"version":1,"x":40,"y":30,"width":1e999,"height":600}']) {
    assert.equal(parseChatWindow(invalid), null);
  }
});
