/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the Deno helper using Node's installed test runner and TypeScript compiler. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'supabase', 'functions', 'analyze-whiteboard', 'request.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = {};
vm.runInNewContext(compiled, { exports: helpers, Set, Promise, setTimeout, fetch });
const { fetchWithPhotoRetry } = helpers;
const url = 'https://example.invalid/photo-analysis';

test('a transient 503 retries once, cancels the discarded body, then returns the successful response', async () => {
  let calls = 0;
  let cancellations = 0;
  const pauses = [];
  const controller = new AbortController();
  const init = { method: 'POST', body: 'image-request', signal: controller.signal };
  const success = new Response('{"schedules":[]}', { status: 200 });
  const response = await fetchWithPhotoRetry(url, init, async (input, options) => {
    assert.equal(input, url);
    assert.equal(options, init);
    assert.equal(options.signal, controller.signal);
    calls += 1;
    return calls === 1
      ? new Response(new ReadableStream({ cancel() { cancellations += 1; } }), { status: 503 })
      : success;
  }, async (milliseconds) => { pauses.push(milliseconds); });
  assert.equal(response, success);
  assert.equal(calls, 2);
  assert.equal(cancellations, 1);
  assert.deepEqual(pauses, [500]);
});

test('only the specified transient HTTP statuses are retried', async () => {
  for (const status of [408, 500, 502, 503, 504]) {
    let calls = 0;
    const response = await fetchWithPhotoRetry(url, {}, async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? status : 200 });
    }, async () => undefined);
    assert.equal(calls, 2, String(status));
    assert.equal(response.status, 200);
  }
});

test('authorization, validation, and quota responses are returned without retries or delays', async () => {
  for (const status of [400, 401, 403, 404, 422, 429]) {
    let calls = 0;
    const original = new Response('request rejected', { status });
    const response = await fetchWithPhotoRetry(url, {}, async () => {
      calls += 1;
      return original;
    }, async () => { assert.fail('Non-transient errors must not pause'); });
    assert.equal(response, original);
    assert.equal(calls, 1);
    assert.equal(await response.text(), 'request rejected');
  }
});

test('persistent transient failures stop after three attempts and preserve the final response', async () => {
  let calls = 0;
  const pauses = [];
  const response = await fetchWithPhotoRetry(url, {}, async () => {
    calls += 1;
    return new Response('failure-' + calls, { status: 503 });
  }, async (milliseconds) => { pauses.push(milliseconds); });
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [500, 1000]);
  assert.equal(await response.text(), 'failure-3');
});

test('an already aborted request never reaches fetch or pause', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchWithPhotoRetry(url, { signal: controller.signal }, async () => {
    assert.fail('Aborted requests must not fetch');
  }, async () => { assert.fail('Aborted requests must not pause'); }), { name: 'AbortError' });
});

test('aborting after a transient response prevents the retry and its delay', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchWithPhotoRetry(url, { signal: controller.signal }, async () => {
    calls += 1;
    controller.abort();
    return new Response(null, { status: 503 });
  }, async () => { assert.fail('Aborted request must not pause'); }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('aborting during the delay preserves the shared deadline and prevents another fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pauses = [];
  await assert.rejects(fetchWithPhotoRetry(url, { signal: controller.signal }, async () => {
    calls += 1;
    return new Response(null, { status: 503 });
  }, async (milliseconds) => {
    pauses.push(milliseconds);
    controller.abort();
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.deepEqual(pauses, [500]);
});

test('network exceptions propagate without an unbounded transport retry', async () => {
  const failure = new TypeError('network unavailable');
  let calls = 0;
  await assert.rejects(fetchWithPhotoRetry(url, {}, async () => {
    calls += 1;
    throw failure;
  }, async () => { assert.fail('Network exceptions must propagate'); }), (error) => error === failure);
  assert.equal(calls, 1);
});
