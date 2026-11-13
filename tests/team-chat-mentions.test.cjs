/* eslint-disable @typescript-eslint/no-require-imports -- Run the shared pure mention helpers with Node's test runner. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib', 'team-chat-mentions.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers });
const { getChatMentionQuery, getChatMentionRanges, getSelectedChatMentionIds, getChatTextSegments } = helpers;
const members = [
  { id: 'member-1', display_name: '같은 이름', handle: 'kim_1' },
  { id: 'member-2', display_name: '같은 이름', handle: 'kim_2' },
];
const plain = (value) => JSON.parse(JSON.stringify(value));

test('only selected stable IDs whose complete mention token remains are sent', () => {
  assert.deepEqual(plain(getSelectedChatMentionIds('@kim_1 확인 부탁드려요. @kim_2', [members[0]])), ['member-1']);
  assert.deepEqual(plain(getSelectedChatMentionIds('@kim_2 확인 부탁드려요.', [members[0]])), []);
  assert.deepEqual(plain(getSelectedChatMentionIds('@kim_1 @kim_1', [members[0], members[0]])), ['member-1']);
  assert.deepEqual(plain(getSelectedChatMentionIds('@unknown @kim_2', [])), []);
});

test('email addresses, longer handles and escaped punctuation cannot add recipients', () => {
  for (const content of ['mail@kim_1', '@kim_10', '@kim_1_extra', '@@kim_1', '@kim_1.extra', '@kim_1-name']) {
    assert.equal(getChatMentionRanges(content, 'kim_1').length, 0, content);
  }
  assert.equal(getChatMentionRanges('(@kim_1), 확인', 'kim_1').length, 1);
  assert.equal(getChatMentionRanges('@kim.1 @kimX1', 'kim.1').length, 1);
  assert.equal(getChatMentionRanges('@김팀원_2222 확인', '김팀원').length, 0);
  assert.equal(getChatMentionRanges('@김팀원_2222 확인', '김팀원_2222').length, 1);
});

test('picker searches the caret token and replaces the entire partial token', () => {
  assert.deepEqual(plain(getChatMentionQuery('안녕하세요 @kim_1 확인', 10)), { start: 6, end: 12, query: 'kim' });
  assert.deepEqual(plain(getChatMentionQuery('@', 1)), { start: 0, end: 1, query: '' });
  assert.equal(getChatMentionQuery('mail@kim_1', 10), null);
  assert.equal(getChatMentionQuery('@kim_1 완료', 9), null);
  assert.equal(getChatMentionQuery('@kim_1', 0), null);
  assert.equal(getChatMentionQuery('@kim_1', -1), null);
  assert.deepEqual(plain(getChatMentionQuery('확인 @김팀', 6)), { start: 3, end: 6, query: '김팀' });
});

test('legacy messages stay plain and saved mentions use IDs, not display names', () => {
  assert.deepEqual(plain(getChatTextSegments('@kim_1 <script>alert(1)</script>', members)), [{ text: '@kim_1 <script>alert(1)</script>' }]);
  assert.deepEqual(plain(getChatTextSegments('@kim_1 @kim_2', members, ['member-2'])), [
    { text: '@kim_1 ' }, { text: '@kim_2', memberId: 'member-2' },
  ]);
  assert.deepEqual(plain(getChatTextSegments('@kim_1', members, ['deleted-member'])), [{ text: '@kim_1' }]);
});
