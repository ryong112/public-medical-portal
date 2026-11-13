/* eslint-disable @typescript-eslint/no-require-imports -- Read-only TypeScript helper tests with Node's built-in runner. */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const source = readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const current = { exports: {} };
  vm.runInNewContext(output, { exports: current.exports, module: current, require: (name) => {
    if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
    const base = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(relative), name);
    const target = [base, `${base}.ts`, `${base}.tsx`].find(file => existsSync(path.join(__dirname, '..', file)));
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

test('photographed absence titles use selected participant names instead of the operator or cleaned title', () => {
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { title: '휴가', owner_name: '업무 담당자', attendee_names: ['김직원', '이직원'] }))), ['김직원', '이직원']);
  assert.deepEqual(Array.from(helpers.getAbsencePeople(leave(1, '2026-11-12', { title: '휴가' }))), ['이름 미상']);
});

test('stable participant IDs count equal names separately and repeated schedules only once per person', () => {
  const members = [{ id: 'member-a', display_name: '김민수', handle: 'minsu-a' }, { id: 'member-b', display_name: '김민수', handle: 'minsu-b' }];
  const schedules = [leave(1, '2026-11-12', { title: '휴가', attendee_member_ids: ['member-a', 'member-b'], attendee_names: ['김민수'] }), leave(2, '2026-11-12', { title: '조퇴', absence_type: 'early', attendee_member_ids: ['member-a'], attendee_names: ['김민수'] })];
  assert.deepEqual(Array.from(helpers.getAbsencePeople(schedules[0], members)), ['김민수 (@minsu-a)', '김민수 (@minsu-b)']);
  const day = helpers.buildAbsenceMonth(schedules, '2026-11', members).days.find((item) => item.date === '2026-11-12');
  assert.equal(day.people.length, 2);
  assert.equal(helpers.collectAbsencePersonEntries(schedules, members).length, 2);
  assert.equal(helpers.getAbsencePersonEntries(schedules[0], members)[0].key, 'member:member-a');
});

test('inactive selected IDs retain a single stored label and never infer an ID from a matching legacy name', () => {
  const selected = leave(1, '2026-11-12', { title: '휴가', attendee_member_ids: ['inactive-a', 'inactive-b'], attendee_names: ['동명이인'] });
  assert.equal(helpers.getAbsencePersonEntries(selected).length, 2);
  assert.deepEqual(Array.from(helpers.getAbsencePeople(selected)), ['동명이인', '동명이인']);
  const legacy = helpers.getAbsencePersonEntries(leave(2, '2026-11-12', { title: '휴가', attendee_names: ['김직원'] }), [{ id: 'member-a', display_name: '김직원', handle: 'kim' }]);
  assert.equal(legacy[0].key, 'name:김직원');
});

test('monthly absence board creates separate ID-keyed rows for a multi-participant cleaned title', () => {
  const Board = load('app/components/monthly-absence-board.tsx').default;
  const members = [{ id: 'member-a', display_name: '김민수', handle: 'minsu-a' }, { id: 'member-b', display_name: '김민수', handle: 'minsu-b' }];
  const html = renderToStaticMarkup(React.createElement(Board, { open: true, onClose: () => {}, currentDate: '2026-11-12', members, schedules: [leave(1, '2026-11-12', { title: '휴가', attendee_member_ids: ['member-a', 'member-b'], attendee_names: ['김민수'] })] }));
  assert.ok(html.includes('data-absence-person-key="member:member-a"'));
  assert.ok(html.includes('data-absence-person-key="member:member-b"'));
  assert.ok(html.includes('김민수 (@minsu-a)'));
  assert.ok(html.includes('김민수 (@minsu-b)'));
  assert.ok(!html.includes('이름 미상'));
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
