/* eslint-disable @typescript-eslint/no-require-imports -- Local fixture for the OCR access gate. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const source = (relative) => readFileSync(path.join(root, relative), 'utf8');
const base = 'supabase/functions/analyze-whiteboard';
const compiled = ts.transpileModule(source(`${base}/access.ts`), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers, TextDecoder });
const { authorizeWhiteboardRequest, extractUserBearer, readBoundedPhotoBody, PhotoBodyError } = helpers;
const url = 'https://fixture.invalid/analyze-whiteboard';

test('only a bounded Bearer user-token shape reaches the separate Auth verifier', () => {
  for (const header of [null, 'Bearer', 'Bearer sb_publishable_test', 'Bearer sb_secret_test', 'Basic aaa.bbb.ccc', 'Bearer a.b.c, Bearer a.b.c', `Bearer ${'a'.repeat(8193)}.b.c`]) {
    assert.equal(extractUserBearer(header), null);
  }
  assert.equal(extractUserBearer('Bearer fixture.payload.signature'), 'fixture.payload.signature');
});

test('the approval RPC is never called for a rejected Auth token; all uncertain access fails closed', async () => {
  const bad = await authorizeWhiteboardRequest('fixture', async () => false, () => assert.fail('RPC before Auth'));
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  const denied = await authorizeWhiteboardRequest('fixture', async () => true, async () => false);
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  const unavailable = await authorizeWhiteboardRequest('fixture', async () => true, async () => { throw new Error('db down'); });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 503);
  const normal = await authorizeWhiteboardRequest('fixture', async () => true, async () => true);
  assert.equal(normal.ok, true);
});

test('OCR reads only bounded JSON objects and handles oversize streaming bodies without parsing', async () => {
  const make = (body, headers) => new Request(url, { method: 'POST', body, headers });
  assert.equal((await readBoundedPhotoBody(make('{"data":"일정"}'), 64)).data, '일정');
  await assert.rejects(readBoundedPhotoBody(make('[]'), 64), (error) => error instanceof PhotoBodyError && error.status === 400);
  await assert.rejects(readBoundedPhotoBody(make('{'), 64), (error) => error instanceof PhotoBodyError && error.status === 400);
  await assert.rejects(readBoundedPhotoBody(make('{}', { 'content-length': '33' }), 32), (error) => error instanceof PhotoBodyError && error.status === 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40)); controller.close(); } });
  await assert.rejects(readBoundedPhotoBody(new Request(url, { method: 'POST', body: stream, duplex: 'half' }), 32), (error) => error instanceof PhotoBodyError && error.status === 413);
});

test('the real handler puts auth before body parsing, quota and external-model operations', () => {
  const code = source(`${base}/index.ts`).split('Deno.serve')[1];
  assert.match(source('supabase/config.toml'), /\[functions\.analyze-whiteboard\]\s*verify_jwt = true/);
  assert.match(code, /caller\.auth\.getUser\(jwt\)/);
  assert.match(code, /caller\.rpc\('is_approved_human_device'\)/);
  const gate = code.indexOf('if (!access.ok)');
  assert.ok(gate > 0);
  for (const marker of ['readBoundedPhotoBody(request)', "rpc('claim_whiteboard_analysis'", "from('whiteboard_corrections')", 'await readPhoto(']) {
    assert.ok(code.indexOf(marker) > gate, marker);
  }
});

test('mocked Edge handler rejects unapproved devices before opening the body or creating a privileged client', async () => {
  const requests = [];
  let serve;
  let authenticated = false;
  let approved = false;
  const env = new Map([['SUPABASE_URL', 'https://local-config.invalid'], ['SUPABASE_ANON_KEY', 'public-fixture'], ['SUPABASE_SERVICE_ROLE_KEY', 'private-fixture'], ['GEMINI_API_KEY', 'model-fixture']]);
  const code = ts.transpileModule(source(`${base}/index.ts`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {}, Request, Response, AbortSignal, console,
    fetch: () => assert.fail('this synthetic suite never calls a vendor'),
    Deno: { env, serve: (handler) => { serve = handler; } },
    require: (id) => {
      if (id === './access.ts') return helpers;
      if (!id.startsWith('npm:@supabase/supabase-js')) return {};
      return { createClient(_url, key, options) {
        if (key === 'private-fixture') {
          requests.push('privileged-client');
          return { rpc: async (name) => { requests.push(name); return { data: false }; } };
        }
        assert.equal(options.global.headers.Authorization, 'Bearer fixture.payload.signature');
        return {
          auth: { getUser: async () => { requests.push('verify-user'); return { data: { user: authenticated ? { id: 'fixture' } : null } }; } },
          rpc: async (name) => { requests.push(name); return { data: approved }; },
        };
      } };
    },
  });
  const request = (value) => ({ method: 'POST', headers: new Headers(value ? { authorization: value } : {}), get body() { assert.fail('body must not be inspected'); } });
  assert.equal((await serve(request(null))).status, 401);
  assert.deepEqual(requests, []);
  assert.equal((await serve(request('Bearer fixture.payload.signature'))).status, 401);
  assert.deepEqual(requests.splice(0), ['verify-user']);
  authenticated = true;
  assert.equal((await serve(request('Bearer fixture.payload.signature'))).status, 403);
  assert.deepEqual(requests.splice(0), ['verify-user', 'is_approved_human_device']);
  approved = true;
  const allowed = new Request(url, {
    method: 'POST', headers: { authorization: 'Bearer fixture.payload.signature' },
    body: JSON.stringify({ imageBase64: 'YQ==', mimeType: 'image/png' }),
  });
  assert.equal((await serve(allowed)).status, 429);
  assert.deepEqual(requests.splice(0), ['verify-user', 'is_approved_human_device', 'privileged-client', 'claim_whiteboard_analysis']);
});

test('migration requires approved non-kiosk devices for corrections and files with no direct storage table changes', () => {
  const sql = source('supabase/migrations/20261125090000_private_portal_documents_ocr.sql');
  assert.match(sql, /auth\.uid\(\) is not null and public\.is_device_approved\(\)[\s\S]+device\.is_kiosk[\s\S]+pairing\.used_at is not null/);
  assert.match(sql, /human_portal_document_objects on storage\.objects\s+as restrictive for all to public/);
  assert.match(sql, /save_whiteboard_corrections\(p_corrections jsonb\)[\s\S]+if not public\.is_approved_human_device\(\)/);
  assert.match(sql, /revoke all on function public\.save_whiteboard_corrections\(jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.save_whiteboard_corrections\(jsonb\) to authenticated;/);
  assert.doesNotMatch(sql, /(?:update|insert into|delete from) storage\.(?:objects|buckets)\b/i);
});
