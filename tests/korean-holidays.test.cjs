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
const { getRequiredHolidayYears, mergeHolidayYear } = load('lib/korean-holidays.ts');
const normalize = value => JSON.parse(JSON.stringify(value));

test('calendar and current week years are stable, unique and sorted', () => {
  assert.deepEqual(normalize(getRequiredHolidayYears(2026, '2026-11-12')), [2026]);
  assert.deepEqual(normalize(getRequiredHolidayYears(2028, '2026-11-12')), [2026, 2028]);
  assert.deepEqual(normalize(getRequiredHolidayYears(2028, '2026-12-29')), [2026, 2027, 2028]);
  assert.deepEqual(normalize(getRequiredHolidayYears(2026, '2026-12-25')), [2026]);
  assert.deepEqual(normalize(getRequiredHolidayYears(2026, '2026-12-26')), [2026, 2027]);
  assert.deepEqual(normalize(getRequiredHolidayYears(1999, 'invalid')), []);
});

test('a refreshed year replaces removed holidays while other years remain', () => {
  const previous = { '2025-01-01': ['이전 연도'], '2026-01-01': ['오래된 이름'], '2026-05-01': ['제거할 일정'], '2027-01-01': ['다음 연도'] };
  const snapshot = JSON.stringify(previous);
  const merged = mergeHolidayYear(previous, 2026, [{ date: '2026-01-01', name: '새해' }]);
  assert.deepEqual(normalize(merged), { '2025-01-01': ['이전 연도'], '2027-01-01': ['다음 연도'], '2026-01-01': ['새해'] });
  assert.equal(JSON.stringify(previous), snapshot, 'input cache is not mutated');
  assert.deepEqual(normalize(mergeHolidayYear(merged, 2026, [])), { '2025-01-01': ['이전 연도'], '2027-01-01': ['다음 연도'] });
});

test('duplicate names are trimmed and merged without accepting invalid dates or another year', () => {
  const merged = mergeHolidayYear({}, 2026, [
    { date: '2026-01-01', name: '새해' }, { date: '2026-01-01', name: ' 새해 ' },
    { date: '2026-01-01', name: '공휴일' }, { date: '2026-01-02', name: ' ' },
    { date: '2026-02-30', name: '존재하지 않는 날' }, { date: '2027-01-01', name: '다른 연도' },
    { date: '2026-1-01', name: '잘못된 날짜' },
  ]);
  assert.deepEqual(normalize(merged), { '2026-01-01': ['새해', '공휴일'] });
});

test('out-of-order year responses preserve both sides of a new year', () => {
  const nextYearFirst = mergeHolidayYear({}, 2027, [{ date: '2027-01-01', name: '새해' }]);
  const result = mergeHolidayYear(nextYearFirst, 2026, [{ date: '2026-12-25', name: '성탄절' }]);
  assert.deepEqual(normalize(result), { '2027-01-01': ['새해'], '2026-12-25': ['성탄절'] });
  assert.equal(mergeHolidayYear(result, 2101, []), result);
});
