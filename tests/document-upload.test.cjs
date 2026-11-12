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
const { createDocumentUploads, createDocumentUploadRunner } = helpers;
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
