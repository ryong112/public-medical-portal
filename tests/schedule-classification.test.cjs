/* eslint-disable @typescript-eslint/no-require-imports -- Node's built-in runner tests the TypeScript parser without adding a test dependency. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const loadSource = (filename, imports = {}) => {
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Intl, Set, JSON, require: (name) => name in imports ? imports[name] : require(name) });
  return exports;
};
const classification = loadSource('lib/schedule-classification.ts');
const { inferScheduleTypeFromText } = classification;
const { parseQuickSchedule } = loadSource('app/components/quick-schedule-input.tsx', {
  '@/lib/schedule-classification': classification,
  '@/lib/schedule-category': { scheduleCategoryStyles: {} },
});

test('internal collaboration terms use the internal category by default', () => {
  for (const title of ['부서 협의회', '지역기관 간담회', '업무협약식', '업무 협약식', '업무협약 회의', '협약식']) {
    assert.equal(inferScheduleTypeFromText(title), 'internal', title);
  }
});

test('an explicit trip takes precedence over generic internal collaboration vocabulary', () => {
  for (const title of ['보건소 출장 간담회', '협의회 참석 출장', '출장 업무협약식']) {
    assert.equal(inferScheduleTypeFromText(title), 'business_trip', title);
  }
});

test('explicit category prefixes remain authoritative, including full-width punctuation', () => {
  for (const [title, expected] of [
    ['회의) 협의회', 'meeting'], ['회의： 업무협약식', 'meeting'],
    ['11/12 10:00 내부일정) 업무협약 출장 협의회', 'internal'],
    ['출장） 간담회', 'business_trip'], ['휴가) 간담회', 'leave'],
    ['일반) 간담회', 'unclassified'], ['미분류: 협의회', 'unclassified'],
  ]) assert.equal(inferScheduleTypeFromText(title), expected, title);
});

test('regular recurring meetings and unspecified general titles keep their categories', () => {
  for (const title of ['팀회의', '정책결정회의', '월례회의', '확대간부회의']) assert.equal(inferScheduleTypeFromText(title), 'meeting', title);
  for (const title of ['', '문서 검토', '운영 점검']) assert.equal(inferScheduleTypeFromText(title), 'unclassified', title);
});

test('leave terms retain absence classification', () => {
  for (const title of ['연차 김팀원', '오후 반차 김팀원', '조퇴 김팀원', '외출 김팀원', '휴가 김팀원']) {
    assert.equal(inferScheduleTypeFromText(title), 'leave', title);
  }
});

test('quick parsing keeps the collaboration title, date and time while classifying internal', () => {
  const parsed = parseQuickSchedule('11/12 오전 10시 지역기관 간담회', '2026-11-01');
  assert.equal(parsed.schedule.schedule_type, 'internal');
  assert.equal(parsed.schedule.title, '지역기관 간담회');
  assert.equal(parsed.schedule.date, '2026-11-12');
  assert.equal(parsed.schedule.start_time, '10:00');
});

test('quick parsing strips an explicit type prefix without leftover punctuation', () => {
  for (const [source, expectedType, expectedTitle] of [
    ['11/12 10시 회의) 지역기관 협의회', 'meeting', '지역기관 협의회'],
    ['11/12 10시 출장) 지역기관 간담회', 'business_trip', '지역기관 간담회'],
    ['11/12 10시 내부 일정) 업무협약식', 'internal', '업무협약식'],
    ['11/12 휴가) 김팀원', 'leave', '김팀원'],
  ]) {
    const parsed = parseQuickSchedule(source, '2026-11-01');
    assert.equal(parsed.schedule.schedule_type, expectedType, source);
    assert.equal(parsed.schedule.title, expectedTitle, source);
  }
});

test('quick parsing retains absence subtypes and does not misclassify an explicitly internal meeting', () => {
  const early = parseQuickSchedule('11/12 오후 3시 조퇴 김팀원', '2026-11-01').schedule;
  assert.equal(early.schedule_type, 'leave');
  assert.equal(early.absence_type, 'early');
  assert.equal(early.title, '김팀원');
  const internal = parseQuickSchedule('11/12 10시 내부일정 회의 준비', '2026-11-01').schedule;
  assert.equal(internal.schedule_type, 'internal');
  assert.equal(internal.title, '회의 준비');
});
