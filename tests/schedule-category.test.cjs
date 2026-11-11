/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the shared display classification with the built-in Node runner. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib', 'schedule-category.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers });
const { getScheduleCategory } = helpers;

test('saved classification remains authoritative despite meeting, trip or leave words in the title', () => {
  assert.equal(getScheduleCategory({ title: '휴가 운영 협의회', schedule_type: 'internal' }), 'internal');
  assert.equal(getScheduleCategory({ title: '출장) 기관 간담회', schedule_type: 'meeting' }), 'meeting');
  assert.equal(getScheduleCategory({ title: '내부일정) 교육', schedule_type: 'business_trip' }), 'business_trip');
});

test('legacy category prefixes still display correctly, including full-width punctuation', () => {
  for (const [title, expected] of [['출장） 기관 방문', 'business_trip'], ['회의) 팀회의', 'meeting'], ['내부일정: 간담회', 'internal'], ['조퇴) 김팀원', 'leave'], ['휴가) 김팀원', 'leave']]) {
    assert.equal(getScheduleCategory({ title, schedule_type: 'unclassified' }), expected, title);
  }
});

test('range, urgent and notice metadata do not change a schedule category', () => {
  for (const schedule_type of ['internal', 'business_trip', 'meeting', 'leave']) {
    assert.equal(getScheduleCategory({ title: '테스트', schedule_type, end_date: '2026-11-13', is_urgent: true, is_notice: true }), schedule_type);
  }
});

test('unspecified titles use the neutral general category without reclassifying existing content', () => {
  for (const title of ['', '근무 검토', '휴가 계획 회의자료 검토', '기관 간담회']) assert.equal(getScheduleCategory({ title }), 'general', title);
});
