/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../lib/schedule-workflow.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: helpers });
const { compareScheduleTitles, findDuplicateSchedules, scheduleMatchesPerson, getSchedulePeople } = helpers;
const schedule = (title, extra = {}) => ({ title, date: '2026-11-12', ...extra });

test('duplicate title matching ignores presentation, not meaningful different titles', () => {
  assert.equal(compareScheduleTitles('회의) 정책 결정회의', '정책결정회의'), 'same');
  assert.equal(compareScheduleTitles('  회의) 정책 결정회의 ', '정책결정회의'), 'same');
  assert.equal(compareScheduleTitles('정책결정회의', '정책결졍회의'), 'similar');
  assert.equal(compareScheduleTitles('회의', '휴가'), null);
  assert.equal(compareScheduleTitles('제1차 정책결정회의', '제2차 정책결정회의'), null);
  assert.equal(compareScheduleTitles('', ''), null);
});
test('same day or overlapping period matches, different days do not', () => {
  assert.equal(findDuplicateSchedules([schedule('팀회의')], [schedule('팀 회의')]).length, 1);
  assert.equal(findDuplicateSchedules([schedule('팀회의')], [schedule('팀회의', { date: '2026-11-13' })]).length, 0);
  assert.equal(findDuplicateSchedules([schedule('기관방문')], [schedule('기관방문', { date: '2026-11-10', end_date: '2026-11-15' })]).length, 1);
});
test('editing excludes itself, cancelled schedules are ignored, batch duplicate still detected', () => {
  assert.equal(findDuplicateSchedules([schedule('팀회의')], [schedule('팀회의', { id: 1 }), schedule('팀회의', { id: 2, recurrence_status: 'cancelled' })], ['1']).length, 0);
  const result = findDuplicateSchedules([schedule('기관방문'), schedule('출장) 기관방문')], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].inBatch, true);
});
test('my schedule means exact chosen person in owner or attendees, never device identity', () => {
  assert.equal(scheduleMatchesPerson(schedule('회의', { owner_name: ' 김팀원 ' }), '김팀원'), true);
  assert.equal(scheduleMatchesPerson(schedule('회의', { attendee_names: ['김팀원'] }), '김'), false);
  assert.equal(scheduleMatchesPerson(schedule('김팀원 회의'), '김팀원'), false);
  assert.equal(scheduleMatchesPerson(schedule('회의'), ''), false);
  assert.equal(getSchedulePeople([schedule('회의', { owner_name: '김팀원', attendee_names: ['김팀원', '이팀원'] })]).length, 2);
});
