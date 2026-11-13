/* eslint-disable @typescript-eslint/no-require-imports -- Pure TypeScript helper tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/kiosk-pagination.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const current = { exports: {} };
vm.runInNewContext(output, { module: current, exports: current.exports });
const { getKioskPageSize } = current.exports;

test('rows keep their readable size and navigation gets its own space', () => {
  assert.equal(getKioskPageSize(240, 76, 3), 3);
  assert.equal(getKioskPageSize(240, 76, 20), 2);
  assert.equal(getKioskPageSize(300, 76, 20), 3);
});
test('large panels keep a sensible row limit without making narrow columns', () => {
  assert.equal(getKioskPageSize(1000, 76, 50), 6);
  assert.equal(getKioskPageSize(1000, 76, 50, 4), 4);
});
test('short and transient zero-height panels still expose a valid first page', () => {
  assert.equal(getKioskPageSize(100, 76, 50), 1);
  assert.equal(getKioskPageSize(0, 76, 50), 1);
  assert.equal(getKioskPageSize(NaN, 76, 50), 1);
  assert.equal(getKioskPageSize(300, 76, 0), 3);
});
