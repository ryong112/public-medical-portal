/* eslint-disable @typescript-eslint/no-require-imports -- Run the pure upload state machine with Node's built-in runner. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(path.join(__dirname, '..', 'lib', 'document-upload.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers, crypto: { randomUUID } });
const { createDocumentUploads, createDocumentUploadRunner, getDocumentListRows } = helpers;
const fakeFile = (name = '기관 문서.pdf') => ({ name, size: 100 });

test('new items capture category, use unique fixed storage paths, and start with indeterminate progress', () => {
  const items = createDocumentUploads([fakeFile(), fakeFile()], '운영');
  assert.equal(items[0].targetCategory, '운영');
  assert.equal(items[0].status, 'queued');
  assert.equal(items[0].progress, null);
  assert.match(items[0].storagePath, /^[a-z0-9-]+\.pdf$/);
  assert.notEqual(items[0].storagePath, items[1].storagePath);
});

test('metadata failure retries only metadata, preserving category and path even with stale input', async () => {
  const [initial] = createDocumentUploads([fakeFile()], '원래 분류');
  let uploads = 0;
  let saves = 0;
  const seen = [];
  const runner = createDocumentUploadRunner({
    upload: async (item, progress) => { uploads++; progress(52); return { url: `https://files.example/${item.storagePath}` }; },
    ensureMetadata: async (item) => { saves++; seen.push(item); if (saves === 1) throw new Error('database unavailable'); },
  });
  const changes = [];
  const [failed] = await runner.run([initial], (item) => changes.push(item));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.storageUploaded, true);
  assert.equal(failed.error, 'database unavailable');
  assert.ok(changes.some((item) => item.status === 'uploading' && item.progress === 52));
  const [done] = await runner.run([{ ...initial, targetCategory: '현재 화면 분류' }], () => {});
  assert.equal(done.status, 'succeeded');
  assert.equal(done.attempts, 2);
  assert.equal(uploads, 1);
  assert.equal(saves, 2);
  assert.equal(seen[1].targetCategory, '원래 분류');
  assert.equal(seen[1].storagePath, initial.storagePath);
  assert.equal(done.error, undefined);
});

test('storage failure retries the same path, never calls metadata early and continues other files', async () => {
  const items = createDocumentUploads([fakeFile('first.pdf'), fakeFile('second.hwp')], '자료');
  const attempts = new Map();
  const paths = [];
  const saved = [];
  const runner = createDocumentUploadRunner({
    upload: async (item) => {
      const attempt = (attempts.get(item.id) ?? 0) + 1;
      attempts.set(item.id, attempt);
      paths.push(item.storagePath);
      if (item.file.name === 'first.pdf' && attempt === 1) throw { message: 'storage unavailable' };
      return { url: `https://files.example/${item.storagePath}` };
    },
    ensureMetadata: async (item) => { saved.push(item.id); },
  });
  const results = await runner.run(items, () => {});
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].storageUploaded, false);
  assert.equal(results[0].error, 'storage unavailable');
  assert.equal(results[1].status, 'succeeded');
  assert.deepEqual(saved, [items[1].id]);
  const retried = await runner.run(results, () => {});
  assert.ok(retried.every((item) => item.status === 'succeeded'));
  assert.equal(paths[0], paths[2]);
  assert.equal(attempts.get(items[1].id), 1);
  assert.deepEqual(saved, [items[1].id, items[0].id]);
});

test('successful items are not uploaded or inserted again on repeat run with stale queued inputs', async () => {
  const items = createDocumentUploads([fakeFile()], '자료');
  let uploads = 0;
  let saves = 0;
  const runner = createDocumentUploadRunner({ upload: async () => { uploads++; return { url: 'https://files.example/one' }; }, ensureMetadata: async () => { saves++; } });
  await runner.run(items, () => {});
  await runner.run(items, () => {});
  assert.equal(uploads, 1);
  assert.equal(saves, 1);
});

test('concurrent attempts for one item are coalesced and success waits for metadata persistence', async () => {
  const items = createDocumentUploads([fakeFile()], '자료');
  let complete;
  let saves = 0;
  let uploads = 0;
  const gate = new Promise((resolve) => { complete = resolve; });
  const events = [];
  const runner = createDocumentUploadRunner({ upload: async () => { uploads++; return { url: 'https://files.example/one' }; }, ensureMetadata: async () => { saves++; await gate; } });
  const one = runner.run(items, (item) => events.push(item.status));
  const two = runner.run(items, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(uploads, 1);
  assert.equal(saves, 1);
  assert.ok(!events.includes('succeeded'));
  assert.ok(events.includes('saving'));
  complete();
  const [first, second] = await Promise.all([one, two]);
  assert.equal(first[0].status, 'succeeded');
  assert.equal(second[0].status, 'succeeded');
});

test('an idempotent metadata service reconciles an ambiguous server response without duplicate rows', async () => {
  const items = createDocumentUploads([fakeFile()], '자료');
  const rows = new Map();
  let firstResponse = true;
  let inserts = 0;
  const runner = createDocumentUploadRunner({
    upload: async () => ({ url: 'https://files.example/one' }),
    ensureMetadata: async (item) => {
      if (rows.has(item.url)) return;
      rows.set(item.url, item);
      inserts++;
      if (firstResponse) { firstResponse = false; throw new Error('response lost after commit'); }
    },
  });
  const [failed] = await runner.run(items, () => {});
  assert.equal(failed.status, 'failed');
  const [done] = await runner.run([failed], () => {});
  assert.equal(done.status, 'succeeded');
  assert.equal(inserts, 1);
  assert.equal(rows.size, 1);
});

test('inline upload slots honor the captured category and current filename search', () => {
  const uploads = createDocumentUploads([fakeFile('Weekly Report.pdf'), fakeFile('휴가 안내.pdf')], '팀회의');
  assert.equal(getDocumentListRows([], uploads, '다른 분류').length, 0);
  assert.equal(getDocumentListRows([], uploads, '팀회의', '  REPORT ').length, 1);
  assert.equal(getDocumentListRows([], uploads, '전체', '휴가')[0].item.id, uploads[1].id);
  assert.equal(getDocumentListRows([], uploads, '팀회의').length, 2);
});

test('success waits for an actual URL row and replaces its slot without duplicate documents', () => {
  const [initial] = createDocumentUploads([fakeFile()], '팀회의');
  const done = { ...initial, status: 'succeeded', url: 'https://files.example/new.pdf' };
  const oldFile = { id: 1, name: initial.file.name, url: 'https://files.example/old.pdf', category: '팀회의' };
  const waiting = getDocumentListRows([oldFile], [done], '팀회의');
  assert.equal(waiting.length, 2, 'an equal filename is not evidence that the upload has been listed');
  assert.equal(waiting[0].type, 'upload');
  const actual = { id: 2, name: initial.file.name, url: done.url, category: '팀회의' };
  const rows = getDocumentListRows([oldFile, actual], [done], '팀회의');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'file');
  assert.equal(rows[0].uploadId, initial.id, 'the actual file reuses the temporary row key');
  assert.equal(rows[0].file, actual);
  assert.equal(rows[1].file, oldFile);
});

test('a persisted row is authoritative before the metadata response, including a lost response', () => {
  const [initial] = createDocumentUploads([fakeFile()], '팀회의');
  const actual = { id: 1, name: initial.file.name, url: 'https://files.example/new.pdf', category: '팀회의' };
  for (const status of ['saving', 'failed', 'succeeded']) {
    const rows = getDocumentListRows([actual], [{ ...initial, url: actual.url, status }], '팀회의');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'file');
  }
});

test('a moved or renamed server row never resurrects the old upload slot', () => {
  const [initial] = createDocumentUploads([fakeFile('원래 이름.pdf')], '팀회의');
  const upload = { ...initial, url: 'https://files.example/new.pdf', status: 'succeeded' };
  const moved = { id: 1, url: upload.url, name: '변경된 이름.pdf', category: '참고자료' };
  assert.equal(getDocumentListRows([], [upload], '팀회의', '', [moved]).length, 0);
  assert.equal(getDocumentListRows([], [upload], '전체', '원래 이름', [moved]).length, 0);
  const rows = getDocumentListRows([moved], [upload], '참고자료', '변경된', [moved]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file.name, '변경된 이름.pdf');
});

test('settled File references are released only after their exact URL is listed, including lost responses', () => {
  const [initial] = createDocumentUploads([fakeFile()], '팀회의');
  const url = 'https://files.example/committed.pdf';
  const actual = { url };
  for (const status of ['succeeded', 'failed']) {
    assert.deepEqual(helpers.getSettledDocumentUploadIds([actual], [{ ...initial, url, status }]), [initial.id]);
    assert.deepEqual(helpers.getSettledDocumentUploadIds([], [{ ...initial, url, status }]), []);
    assert.deepEqual(helpers.getSettledDocumentUploadIds([{ url: 'https://files.example/other.pdf' }], [{ ...initial, url, status }]), []);
  }
  for (const status of ['queued', 'uploading', 'saving']) {
    assert.deepEqual(helpers.getSettledDocumentUploadIds([actual], [{ ...initial, url, status }]), []);
  }
});
