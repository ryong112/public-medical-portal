/* eslint-disable @typescript-eslint/no-require-imports -- Pure local feed race regressions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '..', 'lib/team-chat-feed.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function('exports', compiled)(loaded.exports);
const { upsertTeamChatMessages, createTeamChatReconciler } = loaded.exports;
const row = (id, content = '테스트') => ({ id, content });

test('REST snapshot then repeated live echoes render one database ID, not one content string', () => {
  const original = row(10);
  let rows = upsertTeamChatMessages([], [original, original]);
  rows = upsertTeamChatMessages(rows, [row('10'), row(10)]);
  assert.equal(rows.length, 1);
  rows = upsertTeamChatMessages(rows, [row(11)]);
  assert.equal(rows.length, 2, 'distinct messages with identical content must remain distinct');
});

test('live inserts and updates during a slow snapshot survive its older response', () => {
  const feed = createTeamChatReconciler();
  const token = feed.beginSnapshot();
  feed.upsert(row(2));
  feed.upsert(row(1, '새 내용'));
  const result = feed.finishSnapshot(token, [row(1, '오래된 내용')]);
  assert.equal(result.length, 2);
  assert.equal(result.find((message) => message.id === 1).content, '새 내용');
});

test('live deletion wins over an in-flight snapshot without resurrecting a removed row', () => {
  const feed = createTeamChatReconciler();
  const token = feed.beginSnapshot();
  feed.remove(1);
  assert.deepEqual(feed.finishSnapshot(token, [row(1), row(2)]), [row(2)]);
});

test('only the latest snapshot request in the current authenticated generation may apply', () => {
  const feed = createTeamChatReconciler();
  const old = feed.beginSnapshot();
  const latest = feed.beginSnapshot();
  assert.deepEqual(feed.finishSnapshot(latest, [row(2)]), [row(2)]);
  assert.equal(feed.finishSnapshot(old, [row(1)]), null);
  const previousIdentity = feed.beginSnapshot();
  feed.reset();
  assert.equal(feed.finishSnapshot(previousIdentity, [row(3)]), null);
});

test('a fresh reconnect snapshot replaces stale history instead of unioning deleted messages forever', () => {
  const feed = createTeamChatReconciler();
  feed.upsert(row(1));
  assert.deepEqual(feed.finishSnapshot(feed.beginSnapshot(), []), []);
});

test('delete followed by an explicit newer restoration retains the restored ID', () => {
  const feed = createTeamChatReconciler();
  const token = feed.beginSnapshot();
  feed.remove(1);
  feed.upsert(row(1, '복원된 내용'));
  assert.deepEqual(feed.finishSnapshot(token, [row(1, '이전 내용')]), [row(1, '복원된 내용')]);
});
