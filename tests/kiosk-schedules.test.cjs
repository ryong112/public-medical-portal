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
const { getKioskGroups, getKioskEventStatus, formatKioskTime, formatKioskDateRange, cleanKioskTitle, getKioskAbsenceLabel, getKioskAbsencePeopleLabel } = load('lib/kiosk-schedules.ts');
const event = (id, extra = {}) => ({ id, title: `회의) 일정 ${id}`, date: '2026-11-13', start_time: null, end_time: null, schedule_type: 'meeting', ...extra });
const local = (value) => new Date(value);
const status = (extra, now = '2026-11-13T12:30:00') => getKioskEventStatus(event(1, extra), local(now));
const equalStatus = (actual, label, kind, dimmed = false) => { assert.equal(actual.label, label); assert.equal(actual.kind, kind); assert.equal(actual.dimmed, dimmed); };
const ids = (items) => Array.from(items, ({ id }) => id);

test('week grouping crosses a year without losing ongoing ranges or overdue unfinished work', () => {
  const fixtures = [event(1, { date: '2026-12-31' }), event(2, { date: '2027-01-01' }), event(3, { date: '2027-01-03' }), event(4, { date: '2027-01-04' }), event(5, { date: '2027-01-10' }), event(6, { date: '2027-01-11' }), event(7, { date: '2026-12-29', end_date: '2027-01-05' }), event(8, { date: '2026-12-20', is_todo: true }), event(9, { date: '2026-12-21', is_todo: true, is_completed: true }), event(10, { date: '2026-12-31', recurrence_status: 'cancelled' }), event(11, { date: 'bad-date', is_todo: true })];
  const groups = getKioskGroups(fixtures, '2026-12-31');
  assert.deepEqual(ids(groups.today), [7, 1]);
  assert.deepEqual(ids(groups.thisWeek), [7, 2, 3]);
  assert.deepEqual(ids(groups.nextWeek), [7, 4, 5]);
  assert.deepEqual(ids(groups.todos), [8]);
  assert.equal(fixtures[0].id, 1, 'grouping does not reorder the input');
});

test('Sunday has no remaining this-week items and future leave excludes today’s multi-day leave', () => {
  const fixtures = [event(1, { date: '2026-11-15' }), event(2, { date: '2026-11-16' }), event(3, { date: '2026-11-22' }), event(4, { date: '2026-11-23' }), event(5, { date: '2026-11-14', end_date: '2026-11-17', schedule_type: 'leave' }), event(6, { date: '2026-11-16', schedule_type: 'leave' }), event(7, { date: '2026-11-23', schedule_type: 'leave' }), event(8, { date: '2026-11-14', is_notice: true }), event(9, { date: '2026-11-18', is_notice: true })];
  const groups = getKioskGroups(fixtures, '2026-11-15');
  assert.deepEqual(ids(groups.thisWeek), []);
  assert.deepEqual(ids(groups.nextWeek), [2, 9, 3]);
  assert.deepEqual(ids(groups.absencesToday), [5]);
  assert.deepEqual(ids(groups.absencesUpcoming), [6]);
  assert.deepEqual(ids(groups.notices), [9]);
  assert.ok(Object.values(getKioskGroups(fixtures, 'invalid')).every((items) => items.length === 0));
});

test('explicit times progress from thirty minutes away through ongoing to ended', () => {
  const schedule = { start_time: '13:00:00', end_time: '14:00:00' };
  equalStatus(status(schedule), '30분 후', 'soon');
  equalStatus(status(schedule, '2026-11-13T13:00:00'), '진행 중', 'ongoing');
  equalStatus(status(schedule, '2026-11-13T14:00:00'), '종료', 'ended', true);
  equalStatus(status({ start_time: '13:00:30', end_time: '14:00:00' }, '2026-11-13T12:30:31'), '30분 후', 'soon');
  equalStatus(status({ start_time: '14:00', end_time: '15:00' }), '오늘', 'upcoming');
});

test('unknown times and a passed start alone never fabricate completion or ongoing status', () => {
  equalStatus(status({}), '오늘', 'unknown');
  equalStatus(status({ start_time: '09:00' }), '오늘', 'unknown');
  equalStatus(status({ end_time: '13:00' }), '오늘', 'unknown');
  equalStatus(status({ end_time: '12:00' }), '종료', 'ended', true);
  equalStatus(status({ start_time: '13:00', end_time: '12:00' }), '30분 후', 'soon');
  equalStatus(status({ start_time: '25:00', end_time: 'bad' }), '오늘', 'unknown');
  equalStatus(status({ date: '2026-11-12' }), '지난 일정', 'unknown');
});

test('multi-day times refer to the first start and final end, not daily repetitions', () => {
  const range = { date: '2026-11-12', end_date: '2026-11-14', start_time: '09:00', end_time: '10:00' };
  equalStatus(status(range), '진행 중', 'ongoing');
  equalStatus(status(range, '2026-11-14T09:59:59'), '진행 중', 'ongoing');
  equalStatus(status(range, '2026-11-14T10:00:00'), '종료', 'ended', true);
  equalStatus(status({ ...range, start_time: null, end_time: null }), '오늘', 'unknown');
});

test('event day countdowns and overdue work remain distinct from known-ended meetings', () => {
  equalStatus(status({ date: '2026-11-14' }), '내일', 'upcoming');
  equalStatus(status({ date: '2026-11-16' }), 'D-3', 'upcoming');
  equalStatus(status({ date: '2027-01-01' }, '2026-12-30T12:00:00'), 'D-2', 'upcoming');
  equalStatus(status({ date: '2026-11-12', is_todo: true }), '기한 지남', 'overdue');
  equalStatus(status({ is_todo: true, end_time: '12:00' }), '기한 지남', 'overdue');
  equalStatus(status({ is_todo: true, is_completed: true }), '완료', 'ended', true);
  equalStatus(status({ date: 'bad' }), '날짜 미정', 'unknown');
});

test('display helpers show readable dates, time ranges and absence names without repeated prefixes', () => {
  assert.equal(formatKioskTime({ start_time: '09:05:00', end_time: '10:30:00.000000' }), '09:05–10:30');
  assert.equal(formatKioskTime({ start_time: '9:05' }), '09:05부터');
  assert.equal(formatKioskTime({ end_time: '17:00:00' }), '17:00까지');
  assert.equal(formatKioskTime({ start_time: '29:00' }), '시간 미정');
  assert.equal(formatKioskDateRange({ date: '2026-11-13' }), '11.13(금)');
  assert.equal(formatKioskDateRange({ date: '2026-12-31', end_date: '2027-01-01' }), '12.31(목)–1.1(금)');
  assert.equal(formatKioskDateRange({ date: '2026-11-13', end_date: 'bad' }), '11.13(금)');
  assert.equal(cleanKioskTitle('회의) 정책결정회의'), '정책결정회의');
  assert.equal(getKioskAbsencePeopleLabel({ title: '휴가) 휴가-희' }), '희');
  assert.equal(getKioskAbsencePeopleLabel({ title: '휴가) 옛이름', owner_name: '김팀원 / 이팀원 / 김팀원' }), '김팀원 · 이팀원');
  assert.equal(getKioskAbsencePeopleLabel({ title: '휴가', attendee_names: ['김팀원', '이팀원'] }), '김팀원 · 이팀원');
  assert.equal(getKioskAbsencePeopleLabel({ title: '휴가', attendee_member_ids: ['member-a', 'member-b'], attendee_names: ['김민수'] }, [{ id: 'member-a', display_name: '김민수', handle: 'minsu-a' }, { id: 'member-b', display_name: '김민수', handle: 'minsu-b' }]), '김민수 (@minsu-a) · 김민수 (@minsu-b)');
  assert.equal(getKioskAbsenceLabel({ title: '외출) 김팀원', absence_type: 'outing' }), '외출');
  assert.equal(getKioskAbsenceLabel({ title: '휴가) 김팀원', absence_type: 'early_pm' }), '오후 조퇴');
});
