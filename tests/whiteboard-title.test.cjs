/* eslint-disable @typescript-eslint/no-require-imports -- Pure shared title-cleaning regressions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const helpers = {};
const source = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/analyze-whiteboard/title.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: helpers, Set });
const { cleanWhiteboardTitle, normalizeWhiteboardPersonLabels } = helpers;

test('short handwritten names are separated from hyphen suffixes without inferring any ID', () => {
  for (const [source, expected] of [['휴가-룡', '휴가'], ['휴-룡', '휴가'], ['방문-희,예', '방문'], ['방문-희, 예', '방문'], ['학교적응-희·예', '학교적응']]) {
    const result = cleanWhiteboardTitle(source);
    assert.equal(result.title, expected, source);
    assert.ok(result.removedNames.length);
    assert.deepEqual(Object.keys(result).sort(), ['removedNames', 'title', 'warnings']);
  }
});

test('all region, numeral glyphs, session units and number-number hyphens are preserved', () => {
  for (const [source, expected] of [
    ['방문재활(홍천) ③-권,혜', '방문재활(홍천) ③'],
    ['학교적응(강릉) 4회기-희', '학교적응(강릉) 4회기'],
    ['축구 3-2-희', '축구 3-2'],
    ['방문-희,예 4회기', '방문 4회기'],
    ['방문-희,예(③)', '방문 (③)'],
  ]) assert.equal(cleanWhiteboardTitle(source).title, expected, source);
  for (const title of ['축구-3-2', '방문(양구) 4회기', '학교적응-강릉', '방문-양구', '방문-홍천', '회의-학교지원단']) {
    assert.equal(cleanWhiteboardTitle(title).title, title, title);
  }
});

test('full names need observed or known name evidence and only a trailing label is removed', () => {
  assert.equal(cleanWhiteboardTitle('회의-손굉룡', { personLabels: ['손굉룡'] }).title, '회의');
  assert.equal(cleanWhiteboardTitle('회의-김민수', { knownNames: ['김민수'] }).title, '회의');
  assert.equal(cleanWhiteboardTitle('회의-홍길동', { knownNames: ['홍길동'] }).title, '회의');
  assert.equal(cleanWhiteboardTitle('회의-이혜리', { knownNames: ['이혜리'] }).title, '회의');
  assert.equal(cleanWhiteboardTitle('방문재활(홍천) ③ 권,혜', { personLabels: ['권', '혜'] }).title, '방문재활(홍천) ③');
  assert.equal(cleanWhiteboardTitle('김민수 교육 자료', { knownNames: ['김민수'] }).title, '김민수 교육 자료');
  assert.equal(cleanWhiteboardTitle('학교적응 강릉', { personLabels: ['강릉'] }).title, '학교적응 강릉');
  assert.equal(cleanWhiteboardTitle('기관 협약-정책').title, '기관 협약-정책');
  assert.ok(cleanWhiteboardTitle('기관 협약-정책').warnings.length);
});

test('ambiguous places remain even if OCR called them names; empty or malformed hints are safe', () => {
  for (const title of ['방문-양구', '학교적응-강릉', '회의-홍천군', '회의-재활지원단']) {
    const suffix = title.split('-').at(-1);
    const result = cleanWhiteboardTitle(title, { personLabels: [suffix] });
    assert.equal(result.title, title);
    if (suffix.length <= 4) assert.ok(result.warnings.length);
  }
  assert.equal(cleanWhiteboardTitle('-희').title, '-희');
  assert.equal(cleanWhiteboardTitle('').title, '');
  assert.equal(cleanWhiteboardTitle('축구-3-2', { personLabels: ['3', '2', '<script>'] }).title, '축구-3-2');
  assert.deepEqual(Array.from(normalizeWhiteboardPersonLabels(['희,예', '희', 2, null, '3회기', '<img>'])), ['희', '예']);
});
