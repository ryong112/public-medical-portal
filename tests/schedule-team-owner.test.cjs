/* eslint-disable @typescript-eslint/no-require-imports -- Local TypeScript helper regressions. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib/schedule-team-owner.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(require, loaded, loaded.exports);
const { normalizeOwnerMemberId, getScheduleOwnerName, changeScheduleOwner } = loaded.exports;
const members = [{ id: 'a', display_name: '김민수' }, { id: 'b', display_name: '김민수' }, { id: 'c', display_name: '이지영' }];

test('owner names never infer member IDs, including duplicate names', () => {
  assert.equal(normalizeOwnerMemberId(undefined), null);
  assert.equal(normalizeOwnerMemberId('  '), null);
  assert.equal(getScheduleOwnerName(' 김민수 ', null, members), '김민수');
  assert.deepEqual(changeScheduleOwner(null, [], '김민수', members), { ownerMemberId: null, ownerName: '김민수' });
  assert.deepEqual(changeScheduleOwner(null, ['b'], '기존 직접 입력', members), { ownerMemberId: 'b', ownerName: '김민수' });
});

test('selected ID gets its current presentation name without changing identity', () => {
  assert.equal(getScheduleOwnerName('이전 이름', 'c', members), '이지영');
  assert.deepEqual(changeScheduleOwner('b', ['c'], '김민수', members), { ownerMemberId: 'c', ownerName: '이지영' });
  assert.deepEqual(changeScheduleOwner('b', [], '김민수', members), { ownerMemberId: null, ownerName: '' });
});

test('unavailable owner IDs retain their stored names until explicitly removed', () => {
  assert.equal(normalizeOwnerMemberId(' unavailable-id '), 'unavailable-id');
  assert.equal(getScheduleOwnerName('기존 담당자', 'unavailable-id', members), '기존 담당자');
  assert.equal(getScheduleOwnerName('', 'unavailable-id', members), null);
  assert.deepEqual(changeScheduleOwner('unavailable-id', [], '기존 담당자', members), { ownerMemberId: null, ownerName: '' });
});

test('draft/copy snapshot keeps the selected ID while legacy schema omits its new column', () => {
  const form = readFileSync(path.join(__dirname, '..', 'app/components/schedule-form-modal.tsx'), 'utf8');
  assert.match(form, /ownerAssignmentAvailable = false/);
  assert.match(form, /owner_member_id: ownerMemberId/);
  assert.match(form, /ownerAssignmentAvailable \? \{ owner_member_id: ownerMemberId \} : \{\}/);
  assert.match(form, /setOwnerMemberId\(normalizeOwnerMemberId\(savedDraft\.owner_member_id\)\)/);
  assert.match(form, /normalizeOwnerMemberId\(initialSchedule\?\.owner_member_id\)/);
  assert.match(form, /multiple=\{false\} label="담당 팀원"/);
});
