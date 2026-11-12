/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(__dirname, '../lib/whiteboard-review.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: helpers });
const { photoScheduleNeedsReview } = helpers;
const draft = { title: '기관 협의회', date: '2026-11-12', confidence: 0.95, color_confidence: 0.96, ink_color: 'blue', warnings: [] };
test('review filter finds uncertain text/color, missing dates and changed events', () => {
  assert.equal(photoScheduleNeedsReview(draft, 'new'), false);
  for (const patch of [{ date: '' }, { confidence: 0.5 }, { color_confidence: 0.5 }, { ink_color: 'teal' }, { warnings: ['색상 확인'] }, { outside_photo_month: true }]) assert.equal(photoScheduleNeedsReview({ ...draft, ...patch }, 'new'), true);
  assert.equal(photoScheduleNeedsReview(draft, 'changed'), true);
});
test('manual schedule is not falsely uncertain due to no ink, but required fields still reviewed', () => {
  assert.equal(photoScheduleNeedsReview({ ...draft, is_manual: true, ink_color: 'unknown', color_confidence: 0 }, 'new'), false);
  assert.equal(photoScheduleNeedsReview({ ...draft, is_manual: true, title: '' }, 'new'), true);
});
