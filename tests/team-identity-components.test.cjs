/* eslint-disable @typescript-eslint/no-require-imports -- Local TypeScript/React component regressions. No network or database writes. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const load = (file) => {
  const source = readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
  return loaded.exports;
};

const { getLegacyAttendeeText, getScheduleAttendeeNames, normalizeAttendeeMemberIds } = load('lib/schedule-team-attendees.ts');
const Picker = load('app/components/team-member-picker.tsx').default;
const Notifications = load('app/components/portal-notifications.tsx').default;
const members = [
  { id: 'member-a', display_name: '김민수', handle: 'minsu-a' },
  { id: 'member-b', display_name: '김민수', handle: 'minsu-b' },
  { id: 'member-c', display_name: '이지영', handle: 'jiyoung' },
];

test('member IDs are preserved independently of equal display names', () => {
  assert.deepEqual(normalizeAttendeeMemberIds(['member-a', 'member-b', 'member-a', '', null]), ['member-a', 'member-b']);
  assert.deepEqual(getScheduleAttendeeNames('', ['member-a', 'member-b'], members), ['김민수']);
  assert.deepEqual(getScheduleAttendeeNames('기존 참석자', ['member-c'], members), ['기존 참석자', '이지영']);
});

test('unlinked legacy names never become member identities or disappear by name alone', () => {
  assert.equal(getLegacyAttendeeText('김민수, 외부 참석자', [], members), '김민수, 외부 참석자');
  assert.deepEqual(getScheduleAttendeeNames('김민수, 김민수, 외부 참석자', [], members), ['김민수', '외부 참석자']);
  assert.equal(getLegacyAttendeeText('김민수', ['missing-id'], members), '김민수');
});

test('removing an initially linked member removes its compatibility name, not legacy names', () => {
  const legacy = getLegacyAttendeeText('김민수, 외부 참석자', ['member-a'], members);
  assert.deepEqual(getScheduleAttendeeNames(legacy, [], members), ['외부 참석자']);
  assert.deepEqual(getScheduleAttendeeNames(legacy, ['member-c'], members), ['외부 참석자', '이지영']);
});

test('late-arriving member information can separate existing ID snapshots without remapping', () => {
  const raw = '김민수, 외부 참석자';
  assert.equal(getLegacyAttendeeText(raw, ['member-a'], []), raw);
  const legacy = getLegacyAttendeeText(raw, ['member-a'], members);
  assert.deepEqual(getScheduleAttendeeNames(legacy, [], members), ['외부 참석자']);
});

test('legacy text keeps a trailing delimiter editable and normalizes only when saved', () => {
  assert.equal(getLegacyAttendeeText('외부 참석자,', ['member-a'], members), '외부 참석자,');
  assert.deepEqual(getScheduleAttendeeNames('  외부   참석자；,외부 참석자,\n', [], []), ['외부 참석자；', '외부 참석자']);
  assert.deepEqual(getScheduleAttendeeNames(' 외부   참석자, 외부 참석자;이지영\n', [], []), ['외부 참석자', '이지영']);
});

test('picker chips use selected ID and distinguish duplicate names with handles', () => {
  const markup = renderToStaticMarkup(React.createElement(Picker, { members, selectedIds: ['member-b'], onChange() {} }));
  assert.match(markup, /@minsu-b/);
  assert.doesNotMatch(markup, /@minsu-a/);
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-expanded="false"/);
});

test('picker shows legacy names separately without selecting a matching member', () => {
  const markup = renderToStaticMarkup(React.createElement(Picker, { members, selectedIds: [], legacyNames: ['김민수'], onChange() {} }));
  assert.match(markup, /기존 직접 입력 이름/);
  assert.match(markup, /이름만으로 팀원을 연결하거나 알림을 보내지 않습니다/);
  assert.doesNotMatch(markup, /선택 해제/);
});

test('picker preserves unavailable IDs and offers visible old-schema fallback', () => {
  const markup = renderToStaticMarkup(React.createElement(Picker, { members: [], selectedIds: ['unknown'], unavailable: true, onChange() {} }));
  assert.match(markup, /등록 확인 필요/);
  assert.match(markup, /기존 입력 정보는 그대로 유지됩니다/);
  assert.match(markup, /disabled=""/);
});

test('notification bell is closed and recipient-provided counts are accessible without browser APIs', () => {
  const markup = renderToStaticMarkup(React.createElement(Notifications, { items: [{ id: 'n1', kind: 'chat_mention', source_id: 'm1', title: '비공개 알림 내용', created_at: '2026-11-13T00:00:00Z', read_at: null }], onMarkRead() {}, onSelect() {} }));
  assert.match(markup, /개인 알림, 읽지 않은 알림 1개/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /비공개 알림 내용/);
  assert.doesNotMatch(markup, /role="dialog"/);
});

test('notification count honors server totals and caps only its visual badge', () => {
  const markup = renderToStaticMarkup(React.createElement(Notifications, { items: [], unreadCount: 125, onMarkRead() {}, onSelect() {} }));
  assert.match(markup, /읽지 않은 알림 125개/);
  assert.match(markup, />99\+</);
});
