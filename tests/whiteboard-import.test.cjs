/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads the TypeScript helper without adding a test dependency. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'lib', 'whiteboard-import.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers, Date, Set, JSON });
const { compareWhiteboardSchedule, getPhotoExistingSchedules, getWhiteboardImportError, isWhiteboardDate, isWhiteboardTime } = helpers;
const schedule = (overrides = {}) => ({
  title: '정책결정회의', date: '2026-11-04', end_date: null,
  start_time: '10:00', end_time: '11:00', schedule_type: 'meeting',
  absence_type: 'annual', is_urgent: false, ...overrides,
});

test('photo comparison includes exact dates only, leaving unrelated future months and recurrences alone', () => {
  const existing = [schedule({ id: 1 }), schedule({ id: 2, date: '2026-12-04' }), schedule({ id: 3, date: '2026-11-11' })];
  assert.deepEqual(getPhotoExistingSchedules(existing, ['2026-11-04']).map((item) => item.id), [1]);
  assert.equal(compareWhiteboardSchedule(schedule({ date: '2026-11-05' }), existing).matched, null);
});

test('manual entries use the same duplicate protection as photo entries', () => {
  const draft = schedule({ is_manual: true, title: '회의） 정책결정회의' });
  assert.equal(compareWhiteboardSchedule(draft, [schedule({ id: 1 })]).status, 'duplicate');
});

test('database second precision does not create a false change', () => {
  assert.equal(compareWhiteboardSchedule(schedule(), [schedule({ id: 1, start_time: '10:00:00', end_time: '11:00:00' })]).status, 'duplicate');
});

test('missing photo end date does not shorten a known multi-day event', () => {
  const existing = schedule({ id: 1, end_date: '2026-11-06' });
  const result = compareWhiteboardSchedule(schedule({ start_time: '09:00' }), [existing]);
  assert.equal(result.status, 'changed');
  assert.equal(result.matched.end_date, '2026-11-06');
  assert.deepEqual(Array.from(result.changedFields), ['시작 시간']);
  assert.equal(compareWhiteboardSchedule(schedule(), [existing]).status, 'duplicate');
});

test('an explicit photo end date is compared', () => {
  const result = compareWhiteboardSchedule(schedule({ end_date: '2026-11-07' }), [schedule({ id: 1, end_date: '2026-11-06' })]);
  assert.equal(result.status, 'changed');
  assert.deepEqual(Array.from(result.changedFields), ['종료 날짜']);
});

test('ambiguous same-title events are not silently overwritten', () => {
  const result = compareWhiteboardSchedule(schedule({ start_time: '12:00' }), [schedule({ id: 1 }), schedule({ id: 2, start_time: '13:00' })]);
  assert.equal(result.status, 'new');
  assert.equal(result.matched, null);
});

test('strict calendar validation rejects rollover dates and accepts leap day', () => {
  for (const value of ['', '2026-02-29', '2026-11-31', '2026-13-01', '0000-01-01', '2026-1-04']) assert.equal(isWhiteboardDate(value), false, value);
  assert.equal(isWhiteboardDate('2028-02-29'), true);
});

test('time validation accepts missing and valid times but rejects malformed hours/minutes', () => {
  for (const value of ['', '00:00', '23:59']) assert.equal(isWhiteboardTime(value), true, value);
  for (const value of ['24:00', '10:60', '9:30', '10:30:00']) assert.equal(isWhiteboardTime(value), false, value);
});

test('import validates missing fields, bad dates, date order, and same-day time order', () => {
  for (const draft of [schedule({ title: ' ' }), schedule({ date: '' }), schedule({ date: '2026-11-31' }), schedule({ end_date: '2026-11-03' }), schedule({ end_time: '09:00' }), schedule({ start_time: '24:00' })]) {
    assert.equal(typeof getWhiteboardImportError([draft]), 'string');
  }
  assert.equal(getWhiteboardImportError([schedule({ end_date: '2026-11-05', end_time: '09:00' })]), null);
});

test('duplicate drafts in one import are rejected, but distinct same-day times remain valid', () => {
  assert.match(getWhiteboardImportError([schedule(), schedule({ title: '회의) 정책결정회의' })]), /중복/u);
  assert.equal(getWhiteboardImportError([schedule(), schedule({ start_time: '13:00', end_time: '14:00' })]), null);
});

test('absence subtype changes are visible without affecting other categories', () => {
  const existing = schedule({ id: 1, schedule_type: 'leave', absence_type: 'annual' });
  const result = compareWhiteboardSchedule(schedule({ schedule_type: 'leave', absence_type: 'outing' }), [existing]);
  assert.deepEqual(Array.from(result.changedFields), ['휴가 구분']);
  assert.equal(compareWhiteboardSchedule(schedule({ absence_type: 'outing' }), [schedule({ id: 2 })]).status, 'duplicate');
});

test('explicit attendee IDs make participant-only changes actionable without guessing names', () => {
  const existing = schedule({ id: 1, attendee_member_ids: ['member-a'] });
  assert.equal(compareWhiteboardSchedule(schedule(), [existing]).status, 'duplicate', 'legacy schemas do not erase stored IDs');
  assert.equal(compareWhiteboardSchedule(schedule({ attendee_member_ids: ['member-a'] }), [existing]).status, 'duplicate');
  const changed = compareWhiteboardSchedule(schedule({ attendee_member_ids: ['member-b'] }), [existing]);
  assert.equal(changed.status, 'changed');
  assert.deepEqual(Array.from(changed.changedFields), ['참석 팀원']);
});

test('same-title photo rows distinguish explicit stable attendee sets but not their ordering', () => {
  assert.equal(getWhiteboardImportError([schedule({ attendee_member_ids: ['a'] }), schedule({ attendee_member_ids: ['b'] })]), null);
  assert.match(getWhiteboardImportError([schedule({ attendee_member_ids: ['a', 'b'] }), schedule({ attendee_member_ids: ['b', 'a', 'a'] })]), /중복/u);
});
