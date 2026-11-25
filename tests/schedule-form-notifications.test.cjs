/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const helpers = {};
const source = readFileSync(path.join(__dirname, '../lib/schedule-form-notifications.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helpers });
const { previewScheduleAttendeeNotifications } = helpers;
const members = [
  { id: 'owner', display_name: '담당 팀원' },
  { id: 'a', display_name: '동명이인' },
  { id: 'b', display_name: '동명이인' },
  { id: 'inactive', display_name: '비활성 팀원', active: false },
];
const base = { title: '현장 회의', date: '2026-11-26', end_date: null, start_time: '10:00', end_time: '11:00', location: '회의실', attendee_member_ids: ['owner', 'a', 'inactive', 'missing'] };
const preview = (current, original, extra) => previewScheduleAttendeeNotifications({
  current, original, members, actorMemberId: 'owner', supportsNotifications: true, ...extra,
});
const ids = (rows) => Array.from(rows, (row) => row.id);

test('recipients are active selected IDs, not a name match, owner assignment or self', () => {
  assert.deepEqual(ids(preview(base)), ['a']);
  assert.deepEqual(ids(preview(base, undefined, { actorMemberId: null })), ['owner', 'a']);
  assert.deepEqual(ids(preview({ ...base, attendee_member_ids: ['a', 'a', 'b'] })), ['a', 'b']);
});

test('meaningful changes notify all selected, otherwise only newly selected recipients', () => {
  const current = { ...base, attendee_member_ids: ['owner', 'a', 'b'] };
  assert.deepEqual(ids(preview(current, { ...base, start_time: '10:00:00' })), ['b']);
  assert.deepEqual(ids(preview({ ...current, location: '큰 회의실' }, base)), ['a', 'b']);
  assert.deepEqual(ids(preview(base, { ...base, start_time: '10:00:00.0' })), []);
  assert.deepEqual(ids(preview(base, { ...base, start_time: '10:00:05' })), ['a']);
});

test('insufficient identity or capability is unknown, not zero', () => {
  assert.equal(preview(base, undefined, { actorMemberId: undefined }), null);
  assert.equal(preview(base, undefined, { supportsNotifications: false }), null);
});

test('important changes notify arrivals and removals, but title-only edits do not send another alert', () => {
  const current = { ...base, attendee_member_ids: ['b'] };
  assert.deepEqual(ids(preview({ ...current, start_time: '14:00' }, base, { published: true })), ['a', 'b']);
  assert.deepEqual(ids(preview(current, base, { published: true })), ['a', 'b']);
  assert.deepEqual(ids(preview({ ...base, title: '제목만 변경' }, base, { published: true })), []);
  assert.deepEqual(ids(preview({ ...current, start_time: '14:00' }, base)), ['b']);
});
