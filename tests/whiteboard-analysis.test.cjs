/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the Deno helper with Node's existing test runner and installed TypeScript compiler. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'supabase', 'functions', 'analyze-whiteboard', 'analysis.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
const titleHelpers = {};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(path.dirname(filename), 'title.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: titleHelpers, Set });
vm.runInNewContext(compiled, { exports: helpers, Date, Map, Set, JSON, require: (id) => {
  assert.equal(id, './title.ts');
  return titleHelpers;
} });
const { normalizePhotoAnalysis, relevantSpellingHints, flagColorDisagreements, validDate, buildPhotoPrompt } = helpers;
const row = (overrides = {}) => ({
  title: '정책결정회의', date: '2026-11-04', end_date: null,
  start_time: null, end_time: null, absence_type: 'annual',
  source_text: '4 정책결정회의', ink_color: 'blue', color_confidence: 0.95,
  is_urgent: false, confidence: 0.9, warnings: [], ...overrides,
});
const photo = (schedules = [row()], overrides = {}) => ({
  visible_months: [{ month: '2026-11', evidence: '2026년 11월' }],
  visible_schedule_count: schedules.length, schedules, analysis_warnings: [], ...overrides,
});

test('visible ink controls category even when the title suggests a meeting or old category suggests a trip', () => {
  for (const ink_color of ['blue', 'cyan']) {
    const analysis = normalizePhotoAnalysis(photo([row({ ink_color, schedule_type: 'business_trip' })]));
    assert.equal(analysis.schedules[0].schedule_type, 'internal');
    assert.equal(relevantSpellingHints(analysis, [{
      ai_title: '정책결정회의', corrected_title: '정책결정회의',
      ai_schedule_type: 'internal', corrected_schedule_type: 'business_trip',
    }]).length, 0);
  }
  for (const [ink_color, category] of [['red', 'meeting'], ['green', 'business_trip'], ['orange', 'leave']]) {
    assert.equal(normalizePhotoAnalysis(photo([row({ ink_color })])).schedules[0].schedule_type, category);
  }
});

test('ambiguous blue-green ink does not become a business trip automatically', () => {
  for (const [ink_color, color_confidence] of [['teal', 0.95], ['unknown', 1], ['green', 0.5]]) {
    const result = normalizePhotoAnalysis(photo([row({ ink_color, color_confidence })])).schedules[0];
    assert.equal(result.schedule_type, 'unclassified');
    assert.match(result.warnings.join(' '), /색상/u);
  }
});

test('cross-pass blue-green disagreements require confirmation in either direction', () => {
  for (const [before, after] of [['blue', 'green'], ['green', 'cyan']]) {
    const initial = normalizePhotoAnalysis(photo([row({ ink_color: before })]));
    const reviewed = normalizePhotoAnalysis(photo([row({ ink_color: after })]));
    const result = flagColorDisagreements(initial, reviewed).schedules[0];
    assert.equal(result.schedule_type, 'unclassified');
    assert.ok(result.color_confidence <= 0.7);
    assert.match(result.warnings.join(' '), /파란색과 초록색/u);
  }
});

test('consistent blue ink remains internal after verification', () => {
  const initial = normalizePhotoAnalysis(photo());
  const reviewed = normalizePhotoAnalysis(photo([row({ ink_color: 'cyan' })]));
  assert.equal(flagColorDisagreements(initial, reviewed).schedules[0].schedule_type, 'internal');
});

test('a next-month date outside the photo evidence is cleared for manual confirmation', () => {
  const result = normalizePhotoAnalysis(photo([row({ date: '2026-12-04' })])).schedules[0];
  assert.equal(result.date, null);
  assert.match(result.warnings.join(' '), /2026-12-04/u);
  const actualNextMonth = normalizePhotoAnalysis(photo([row({ date: '2026-12-04' })], {
    visible_months: [{ month: '2026-12', evidence: '2026년 12월' }],
  }));
  assert.equal(actualNextMonth.schedules[0].date, '2026-12-04');
});

test('four distinct schedules written in the same date cell remain four schedules', () => {
  const schedules = ['정책결정회의', '방문재활', '의료지원', '홍천 출장'].map((title) => row({ title, source_text: `4 ${title}` }));
  const result = normalizePhotoAnalysis(photo(schedules));
  assert.equal(result.schedules.length, 4);
  assert.equal(new Set(result.schedules.map((item) => item.title)).size, 4);
  assert.equal(result.visible_schedule_count, 4);
});

test('missing visual source does not create a photo event', () => {
  const result = normalizePhotoAnalysis(photo([row({ source_text: '' })]));
  assert.equal(result.schedules.length, 0);
  assert.match(result.analysis_warnings.join(' '), /빠진 일정/u);
});

test('a photo count larger than extracted rows is visibly flagged', () => {
  const result = normalizePhotoAnalysis(photo([row()], { visible_schedule_count: 4 }));
  assert.match(result.analysis_warnings.join(' '), /4건/u);
  assert.match(result.analysis_warnings.join(' '), /직접 추가/u);
});

test('invalid and ambiguous dates or times stay empty rather than rolling into another month', () => {
  for (const date of ['', '2026-02-29', '2026-02-30', '2026-13-01', '0000-01-01']) assert.equal(validDate(date), null, date);
  assert.equal(validDate('2028-02-29'), '2028-02-29');
  const result = normalizePhotoAnalysis(photo([row({ start_time: '24:00', end_time: '09:60', end_date: '2026-11-03' })])).schedules[0];
  assert.equal(result.start_time, null);
  assert.equal(result.end_time, null);
  assert.equal(result.end_date, null);
});

test('only relevant unambiguous spelling hints reach verification; dates, categories and historical events do not', () => {
  const analysis = normalizePhotoAnalysis(photo([row({ title: '방문재난', source_text: '4 방문재난' })]));
  const hints = relevantSpellingHints(analysis, [
    { ai_title: '방문재난', corrected_title: '방문재활', source_text: '2026-12-04 방문재활', ai_schedule_type: 'business_trip', corrected_schedule_type: 'internal' },
    { ai_title: '다음달회의', corrected_title: '다음 달 회의', source_text: '2026-12-15 다음달회의' },
  ]);
  assert.equal(JSON.stringify(hints), JSON.stringify([{ misread: '방문재난', spelling: '방문재활' }]));
  assert.equal(relevantSpellingHints(analysis, [
    { ai_title: '방문재난', corrected_title: '방문재활' },
    { ai_title: '방문재난', corrected_title: '방문재단' },
  ]).length, 0);
});

test('the image month takes precedence and prompt prohibits inventing future recurrence rows', () => {
  const prompt = buildPhotoPrompt('2026-11-03', '2026-11');
  assert.match(prompt, /사진에 적힌 월이 기준 월보다 우선/u);
  assert.match(prompt, /반복 확장하지 마십시오/u);
  assert.match(prompt, /4개 일정은 반드시 4개 항목/u);
});

test('photo names are separated from titles while source, region and session numbers remain intact', () => {
  const original = '방문재활(홍천) ③-희,예';
  const result = normalizePhotoAnalysis(photo([row({ title: original, source_text: original, person_labels: ['희', '예'] })])).schedules[0];
  assert.equal(result.title, '방문재활(홍천) ③');
  assert.equal(result.source_text, original);
  assert.deepEqual(Array.from(result.person_labels), ['희', '예']);
  assert.equal(normalizePhotoAnalysis(photo([row({ title: '학교적응-강릉', person_labels: ['강릉'] })])).schedules[0].title, '학교적응-강릉');
  const prompt = buildPhotoPrompt('2026-11-13', '2026-11');
  assert.match(prompt, /회기 숫자·③ 기호·지역·기관명은 반드시 그대로/u);
  assert.match(prompt, /팀원 ID·참석자를 추정하거나 자동 배정하지 않습니다/u);
});
