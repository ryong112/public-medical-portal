/* eslint-disable @typescript-eslint/no-require-imports -- Execute pure TypeScript helpers with the built-in Node runner. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const code = ts.transpileModule(readFileSync(path.join(__dirname, '..', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const current = { exports: {} };
  vm.runInNewContext(code, { exports: current.exports, module: current, require: name => name.startsWith('.') ? load(`${path.join(path.dirname(relative), name)}.ts`) : require(name) });
  modules.set(relative, current.exports); return current.exports;
}
const { getDayDistance, getDayProximityLabel, getScheduleProximityLabel } = load('lib/schedule-proximity.ts');

test('weekly labels read today, tomorrow and a precise countdown', () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => getDayProximityLabel(`2026-11-${12 + i}`, '2026-11-12')), ['오늘', '내일', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6']);
  assert.equal(getDayProximityLabel('2026-11-11', '2026-11-12'), '지난 일정');
});
test('month, year, leap and daylight-saving boundaries retain calendar-day distance', () => {
  for (const [start, end, days] of [['2026-12-31', '2027-01-02', 2], ['2028-02-28', '2028-03-01', 2], ['2026-03-07', '2026-03-09', 2], ['2026-10-31', '2026-11-02', 2]]) {
    assert.equal(getDayDistance(end, start), days);
    assert.equal(getDayProximityLabel(end, start), `D-${days}`);
  }
});
test('an ongoing range is today, while a future range counts down to its start', () => {
  assert.equal(getScheduleProximityLabel({ date: '2026-11-10', end_date: '2026-11-13' }, '2026-11-12'), '오늘');
  assert.equal(getScheduleProximityLabel({ date: '2026-11-14', end_date: '2026-11-16' }, '2026-11-12'), 'D-2');
  assert.equal(getScheduleProximityLabel({ date: '2026-11-10', end_date: '2026-11-11' }, '2026-11-12'), '지난 일정');
});
test('invalid dates do not silently roll over or produce NaN labels', () => {
  assert.equal(getDayDistance('2026-02-30', '2026-11-12'), null);
  assert.equal(getDayProximityLabel('bad-date', '2026-11-12'), '날짜 미정');
  assert.equal(getScheduleProximityLabel({ date: '2026-11-13' }, ''), '날짜 미정');
});
