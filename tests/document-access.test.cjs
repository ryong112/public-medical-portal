/* eslint-disable @typescript-eslint/no-require-imports -- Node fixture for the private document client. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const project = 'https://portal.invalid';
const legacy = `${project}/storage/v1/object/public/files/`;
const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../lib/document-access.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = (fetchMock = fetch, token = 'approved-fixture') => {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, URL, fetch: fetchMock,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: project, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-key' } },
    require: () => ({ supabase: { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } } }),
  });
  return exports;
};

test('canonical references and same-project legacy references resolve to the same object key', () => {
  const { getDocumentStoragePath, getNewDocumentReference } = load();
  assert.equal(getDocumentStoragePath(`${legacy}2026/%ED%8C%8C%EC%9D%BC%201.pdf`), '2026/파일 1.pdf');
  assert.equal(getDocumentStoragePath(getNewDocumentReference('2026/파일 1.pdf')), '2026/파일 1.pdf');
  assert.equal(getNewDocumentReference('52ab14fb-fe3d-40fa-8790-a48ba8ff5232.pdf'), 'storage://files/52ab14fb-fe3d-40fa-8790-a48ba8ff5232.pdf');
});

test('untrusted references cannot send app tokens or resolve outside the files bucket', async () => {
  const { getDocumentStoragePath, downloadDocumentBlob } = load(() => assert.fail('invalid record must not fetch'));
  const refused = ['https://outside.invalid/report.pdf', 'https://portal.invalid.example/storage/v1/object/public/files/report.pdf',
    'https://user:password@portal.invalid/storage/v1/object/public/files/report.pdf', 'storage://other-bucket/report.pdf',
    'storage://files/../report.pdf', `${legacy}./report.pdf`, `${legacy}nested/%2e%2e/report.pdf`, `${legacy}report.pdf?download=1`,
    `${legacy}nested%2Freport.pdf`, `${legacy}nested%252Freport.pdf`, `${legacy}nested%5Creport.pdf`, `${legacy}incomplete%`, `${legacy}name%00.pdf`];
  for (const record of refused) {
    assert.equal(getDocumentStoragePath(record), null, record);
    await assert.rejects(downloadDocumentBlob(record), /문서함 저장소/);
  }
});

test('every document read authenticates at the fixed Storage endpoint, never at the legacy URL', async () => {
  const controller = new AbortController();
  const { downloadDocumentBlob } = load(async (endpoint, options) => {
    assert.equal(endpoint.toString(), `${project}/storage/v1/object/authenticated/files/2026/report%201.pdf`);
    assert.equal(options.headers.authorization, 'Bearer approved-fixture');
    assert.equal(options.headers.apikey, 'fixture-key');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal, controller.signal);
    return new Response('preview.pdf', { status: 200 });
  });
  assert.equal(await (await downloadDocumentBlob(`${legacy}2026/report%201.pdf`, controller.signal)).text(), 'preview.pdf');
});

test('a missing session or Storage access denial never falls back to unauthenticated read', async () => {
  const { downloadDocumentBlob } = load(() => assert.fail('no session cannot request file'), null);
  await assert.rejects(downloadDocumentBlob('storage://files/report.pdf'), /기기 승인/);
  let requests = 0;
  const access = load(async () => { requests += 1; return new Response(null, { status: 403 }); });
  await assert.rejects(access.downloadDocumentBlob('storage://files/report.pdf'), /권한/);
  assert.equal(requests, 1);
});
