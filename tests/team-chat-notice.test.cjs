/* eslint-disable @typescript-eslint/no-require-imports -- Local state/parser and presentational regressions only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = (file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports);
  return loaded.exports;
};
const { parseTeamChatNoticeState } = load('lib/team-chat-notice.ts');
const Card = load('app/components/chat-notice-card.tsx').default;
const notice = { id: 'notice-a', message_id: 10, content: '<img src=x onerror="bad()"> 공지 내용', author_name: '등록자', created_at: '2026-11-13T00:00:00Z', can_remove: false };
const state = (value) => ({ notice, collapsed: false, hidden: false, ...value });
const props = (value = {}) => ({ notice, collapsed: false, hidden: false, busy: false, canOpenSource: true, onPreference: () => {}, onOpenSource: () => {}, onRemove: () => {}, ...value });

test('notice parser rejects missing, unknown, malformed or unsafe identities without accepting legacy []', () => {
  for (const value of [null, [], {}, state({ hidden: 'true' }), state({ notice: { ...notice, message_id: 1.5 } }), state({ notice: { ...notice, created_at: 'not a date' } }), state({ notice: { ...notice, can_remove: 'yes' } })]) assert.equal(parseTeamChatNoticeState(value), null);
  assert.deepEqual(parseTeamChatNoticeState(state()), state());
});

test('a missing notice clears old hidden and collapsed preferences', () => {
  assert.deepEqual(parseTeamChatNoticeState({ notice: null, hidden: true, collapsed: true }), { notice: null, hidden: false, collapsed: false });
});

test('shared notice card keeps safe text and distinguishes personal hiding from privileged global removal', () => {
  const html = renderToStaticMarkup(React.createElement(Card, props()));
  assert.ok(html.includes('내 화면에서 공지 숨기기'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('전체 공지 종료'));
  assert.ok(renderToStaticMarkup(React.createElement(Card, props({ notice: { ...notice, can_remove: true } }))).includes('전체 공지 종료'));
});

test('collapsed and hidden cards remain recoverable without creating another shared notice', () => {
  const collapsed = renderToStaticMarkup(React.createElement(Card, props({ collapsed: true })));
  assert.ok(collapsed.includes('공지 펼치기'));
  const hidden = renderToStaticMarkup(React.createElement(Card, props({ hidden: true })));
  assert.ok(hidden.includes('공지 다시 보기'));
  assert.ok(!hidden.includes('공지 원문 보기'));
  assert.ok(!hidden.includes('전체 공지 종료'));
});
