/* eslint-disable @typescript-eslint/no-require-imports -- Read-only TypeScript helper tests with Node's built-in runner. */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const source = readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const current = { exports: {} };
  vm.runInNewContext(output, { exports: current.exports, module: current, require: (name) => {
    if (!name.startsWith('.')) return require(name);
    const base = path.join(path.dirname(relative), name);
    const target = [base, `${base}.ts`].find(file => existsSync(path.join(__dirname, '..', file)));
    return load(target);
  } });
  cache.set(relative, current.exports); return current.exports;
}
const helpers = load('lib/absence-calendar.ts');
const leave = (id, date, fields = {}) => ({ id, date, title: '휴가) 김직원', schedule_type: 'leave', start_time: null, end_time: null, ...fields });

test('absence names prefer explicit ownership and strip repeated legacy prefixes', () => {
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { owner_name: '박담당', title: '휴가) 다른이름' }))), ['박담당']);
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { title: '휴가) 휴가-희, 롱 / 희' }))), ['희', '롱']);
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { title: '오후 조퇴) 박팀원 (조퇴)' }))), ['박팀원']);
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { title: '휴가) 오후반차-희' }))), ['희']);
});
test('month geometry and weekday labels preserve leap days and year boundaries', () => {
  const leap = helpers.buildAbsenceMonth([], '2028-02');
  assert.equal(leap.days.length, 29);
  assert.equal(leap.leadingDays, 2);
  assert.equal(helpers.buildAbsenceMonth([], '2026-11').leadingDays, 0);
  assert.equal(helpers.formatAbsenceDayLabel('2026-11-13'), '11.13(금)');
  assert.equal(helpers.shiftAbsenceMonth('2026-12', 1), '2027-01');
  assert.equal(helpers.shiftAbsenceMonth('2026-01', -1), '2025-12');
  assert.equal(helpers.buildAbsenceMonth([], '2026-13'), null);
});
test('ranged absences mark every intersecting day across months and ignore ordinary work', () => {
  const schedules = [leave(1, '2026-11-30', { end_date: '2026-12-02' }), leave(2, '2026-11-12', { schedule_type: 'meeting', title: '정책결정회의' })];
  const november = helpers.buildAbsenceMonth(schedules, '2026-11');
  const december = helpers.buildAbsenceMonth(schedules, '2026-12');
  assert.equal(november.days.find(day => day.date === '2026-11-30').items.length, 1);
  assert.equal(november.days.find(day => day.date === '2026-11-12').items.length, 0);
  assert.deepEqual(Array.from(december.days.slice(0, 3), day => day.items.length), [1, 1, 0]);
  assert.equal(helpers.formatAbsenceRangeLabel(schedules[0]), '11.30(월)–12.2(수)');
});
test('same person keeps separate absence types without double-counting people', () => {
  const schedules = [leave(1, '2026-11-12', { owner_name: '김직원', absence_type: 'annual' }), leave(2, '2026-11-12', { owner_name: '김직원', absence_type: 'early_pm', start_time: '13:00' }), leave(3, '2026-11-12', { owner_name: '박직원', absence_type: 'outing' })];
  const day = helpers.buildAbsenceMonth(schedules, '2026-11').days.find(day => day.date === '2026-11-12');
  assert.equal(day.items.length, 3);
  assert.equal(day.people.length, 2);
  assert.deepEqual(Array.from(day.items, item => item.id), [2, 1, 3]);
});
test('default date shows today first, then the nearest future absence, without selecting expired leave', () => {
  const schedules = [leave(1, '2026-11-03'), leave(2, '2026-11-13'), leave(3, '2026-11-30')];
  assert.equal(helpers.getDefaultAbsenceDate(schedules, '2026-11', '2026-11-12'), '2026-11-13');
  assert.equal(helpers.getDefaultAbsenceDate([...schedules, leave(4, '2026-11-12')], '2026-11', '2026-11-12'), '2026-11-12');
  assert.equal(helpers.getDefaultAbsenceDate([leave(1, '2026-11-03')], '2026-11', '2026-11-12'), '2026-11-12');
  assert.equal(helpers.getDefaultAbsenceDate([leave(1, '2026-10-03')], '2026-10', '2026-11-12'), '2026-10-03');
});
