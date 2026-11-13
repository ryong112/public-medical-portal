/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright smoke test using PLAYWRIGHT_MODULE. */
// Start the local dev server first. All auth, database, storage and external WebSocket traffic is mocked.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.DOCUMENT_TEST_URL || 'http://127.0.0.1:3000';
const legacySchema = process.env.DOCUMENT_TEST_LEGACY_SCHEMA === '1';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const assetBase = 'https://portal-test.invalid/storage/v1/object/public/files/';
const files = [
  { id: 1, name: '현장 회의 자료.png', url: `${assetBase}preview.png`, category: '운영자료', size: imageBytes.length, created_at: '2026-11-10T01:00:00Z' },
  { id: 2, name: '불러오기 실패.png', url: `${assetBase}fallback.png`, category: '운영자료', size: imageBytes.length, created_at: '2026-11-10T02:00:00Z' },
  { id: 3, name: '한글 문서.hwp', url: `${assetBase}office.hwp`, category: '참고자료', size: 1234, created_at: '2026-11-10T03:00:00Z' },
  { id: 4, name: `${'매우 긴 문서 이름 '.repeat(10)}.docx`, url: `${assetBase}long.docx`, category: '참고자료', size: null, created_at: null },
];
const categories = [{ id: 1, name: '운영자료', order_index: 0 }, { id: 2, name: '참고자료', order_index: 1 }];
const schedules = [{ id: 1, title: '문서 연결 확인 회의', date: '2026-11-11', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'meeting', absence_type: 'annual', is_notice: false, is_urgent: false, is_todo: false, is_completed: false, owner_name: '테스트 담당자', attendee_names: [], location: '회의실', linked_file_ids: [1, 3] }];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const errors = [];
  const storageRequests = [];
  const metadataRequests = [];
  const metadataPaths = [];
  const updateRequests = [];
  const pathNames = new Map();
  let renameAttempts = 0;
  let nextId = 10;
  let storageFailed = false;
  let metadataFailed = false;
  let fallbackHealthy = false;
  let releaseImage;
  let imageGate = null;
  let releaseUpload;
  let uploadGate = null;
  let hideNewMetadata = false;
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({
      access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' },
    });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.hostname === 'portal-test.invalid') {
      if (url.pathname.endsWith('/preview.png') && imageGate) await imageGate;
      if (url.pathname.endsWith('/fallback.png') && !fallbackHealthy) return reply({ message: 'test preview unavailable' }, 503);
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream', body: imageBytes });
    }
    if (url.pathname.startsWith('/storage/v1/object/files/') && ['POST', 'PUT'].includes(request.method())) {
      const payload = request.postDataBuffer()?.toString('utf8') ?? '';
      const name = payload.includes('storage-fail-body') ? 'storage-fail.txt' : payload.includes('metadata-fail-body') ? 'metadata-fail.txt' : payload.includes('dismiss-fail-body') ? 'dismiss-fail.txt' : pathNames.get(url.pathname);
      assert.ok(name, 'test upload should contain an expected fixture');
      pathNames.set(url.pathname, name);
      storageRequests.push({ name, path: url.pathname });
      if (uploadGate) await uploadGate;
      if (name === 'dismiss-fail.txt') return reply({ statusCode: '503', error: 'ServiceUnavailable', message: 'dismissed storage failure' }, 503);
      if (name === 'storage-fail.txt' && !storageFailed) { storageFailed = true; return reply({ statusCode: '503', error: 'ServiceUnavailable', message: 'test storage failure' }, 503); }
      return reply({ Key: `files/${url.pathname.split('/').pop()}`, Id: '11111111-2222-4333-8444-555555555555' });
    }
    if (url.pathname.endsWith('/rpc/register_uploaded_document') || (url.pathname.endsWith('/files') && request.method() === 'POST')) {
      const raw = request.postDataJSON();
      const input = Array.isArray(raw) ? raw[0] : raw;
      const row = 'p_name' in input ? { name: input.p_name, url: input.p_url, size: input.p_size, category: input.p_category } : input;
      metadataRequests.push(row);
      metadataPaths.push(url.pathname);
      if (row.name === 'metadata-fail.txt' && !metadataFailed) { metadataFailed = true; return reply({ code: 'XX000', message: 'test metadata failure' }, 503); }
      const existing = files.find((file) => file.url === row.url);
      const id = existing?.id ?? nextId++;
      if (!existing) files.push({ id, ...row, created_at: '2026-11-11T01:00:00Z' });
      return reply(url.pathname.includes('/rpc/') ? id : [{ id }]);
    }
    if (url.pathname.endsWith('/files') && request.method() === 'PATCH') {
      const values = request.postDataJSON();
      updateRequests.push(values);
      if (++renameAttempts === 1) return reply({ code: '42501', message: 'test rename failure' }, 403);
      const id = Number(url.searchParams.get('id')?.replace('eq.', ''));
      Object.assign(files.find((file) => file.id === id), values);
      return reply([{ id }]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.endsWith('/files')) {
        const targetUrl = url.searchParams.get('url')?.replace(/^eq\./, '');
        return reply(targetUrl ? files.filter((file) => file.url === targetUrl).map(({ id }) => ({ id })) : files.filter((file) => !(hideNewMetadata && file.name === 'metadata-fail.txt')));
      }
      if (url.pathname.endsWith('/categories')) return reply(categories);
      if (url.pathname.endsWith('/schedules')) {
        if (legacySchema && url.searchParams.get('select')?.includes('owner_name') && url.searchParams.get('limit') === '1') return reply({ code: '42703', message: 'optional metadata migration not installed' }, 400);
        return reply(schedules);
      }
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.clock.setFixedTime(new Date('2026-11-11T01:00:00Z'));
  const screenshots = [];
  const capture = async (name) => { const destination = path.join(os.tmpdir(), `my-portal-document-${legacySchema ? 'legacy-' : ''}${name}.png`); await page.screenshot({ path: destination }); screenshots.push(destination); };
  const assertNoOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `page should fit ${page.viewportSize().width}px viewport`);
  try {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: '🏠 전체 문서 보기', exact: true }).click();
    await page.getByRole('button', { name: '현장 회의 자료.png 문서 정보 수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '문서 정보 수정' });
    await editor.getByLabel('파일 이름', { exact: true }).fill('변경된 회의 자료');
    await editor.getByLabel('이동할 분류').selectOption('참고자료');
    await editor.getByRole('button', { name: '변경 저장', exact: true }).click();
    await editor.getByRole('alert').getByText('test rename failure', { exact: true }).waitFor();
    assert.equal(await editor.count(), 1, 'failed rename must not close the editor');
    await editor.getByRole('button', { name: '변경 저장', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    assert.deepEqual(updateRequests[1], { name: '변경된 회의 자료.png', category: '참고자료' });
    assert.equal(files[0].url, `${assetBase}preview.png`, 'rename/move never rewrites the storage URL');

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
      await assertNoOverflow();
      assert.equal(await page.locator('article').filter({ hasText: '변경된 회의 자료.png' }).count(), 1, 'mobile document cards are rendered');
    }
    await capture('mobile');

    imageGate = new Promise((resolve) => { releaseImage = resolve; });
    await page.getByRole('button', { name: '변경된 회의 자료.png 미리보기', exact: true }).click();
    const imageDialog = page.getByRole('dialog', { name: '변경된 회의 자료.png', exact: true });
    await imageDialog.getByRole('status').getByText('미리보기를 불러오는 중…', { exact: true }).waitFor();
    releaseImage(); imageGate = null;
    await imageDialog.locator('img').waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="변경된 회의 자료.png"]')?.naturalWidth > 0);
    await assertNoOverflow();
    await capture('image-preview');
    await imageDialog.getByRole('button', { name: '미리보기 닫기', exact: true }).click();

    await page.getByRole('button', { name: '불러오기 실패.png 미리보기', exact: true }).click();
    const failedPreview = page.getByRole('dialog', { name: '불러오기 실패.png', exact: true });
    await failedPreview.getByRole('alert').waitFor();
    fallbackHealthy = true;
    const downloadPromise = page.waitForEvent('download');
    await failedPreview.getByRole('button', { name: '다운로드', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), '불러오기 실패.png');
    await failedPreview.getByRole('button', { name: '미리보기 닫기', exact: true }).click();

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole('button', { name: '📁 운영자료', exact: true }).click();
    const mainTop = await page.locator('main').evaluate((element) => element.getBoundingClientRect().top);
    uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
    await page.getByLabel('파일 업로드', { exact: true }).setInputFiles([
      { name: 'storage-fail.txt', mimeType: 'text/plain', buffer: Buffer.from('storage-fail-body') },
      { name: 'metadata-fail.txt', mimeType: 'text/plain', buffer: Buffer.from('metadata-fail-body') },
    ]);
    const uploadingRow = page.locator('tr[data-document-upload-id]').filter({ hasText: 'storage-fail.txt' });
    const queuedRow = page.locator('tr[data-document-upload-id]').filter({ hasText: 'metadata-fail.txt' });
    await uploadingRow.locator('[role="status"]').getByText('업로드 중…', { exact: true }).waitFor();
    await queuedRow.locator('[role="status"]').getByText('업로드 대기', { exact: true }).waitFor();
    assert.equal(await uploadingRow.locator('progress').getAttribute('value'), null, 'unknown storage progress must remain indeterminate');
    assert.equal(await page.getByRole('region', { name: '파일 업로드 현황' }).count(), 0, 'the global upload panel must not push the page down');
    assert.equal(await page.locator('main').evaluate((element) => element.getBoundingClientRect().top), mainTop);
    await page.getByRole('button', { name: '📁 참고자료', exact: true }).click();
    assert.equal(await page.locator('[data-document-upload-id]:visible').count(), 0, 'upload slots belong only to their destination folder');
    await page.getByRole('button', { name: '📁 운영자료', exact: true }).click();
    await page.getByLabel('파일명 검색').fill('metadata-fail');
    assert.equal(await page.locator('tr[data-document-upload-id]').count(), 1, 'filename search applies to queued uploads');
    await page.getByLabel('파일명 검색').fill('');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
    await assertNoOverflow();
    assert.equal(await page.locator('article[data-document-upload-id]:visible').count(), 2, 'mobile upload rows stay in the document list');
    await capture('upload-pending-mobile');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await capture('upload-pending');
    releaseUpload(); uploadGate = null;
    await page.getByRole('button', { name: 'metadata-fail.txt 다시 시도', exact: true }).waitFor();
    assert.equal(storageRequests.length, 2);
    assert.equal(metadataRequests.length, 1, 'storage failure must not attempt metadata creation');
    await page.getByRole('button', { name: '📁 참고자료', exact: true }).click();
    assert.equal(await page.locator('[data-document-upload-id]:visible').count(), 0);
    await page.getByRole('button', { name: '📁 운영자료', exact: true }).click();
    await page.getByRole('button', { name: 'storage-fail.txt 다시 시도', exact: true }).click();
    await page.getByRole('button', { name: 'storage-fail.txt 다운로드', exact: true }).waitFor();
    assert.equal(await page.locator('tr[data-document-file-id]').filter({ hasText: 'storage-fail.txt' }).count(), 1, 'the saved document replaces the upload slot exactly once');
    hideNewMetadata = true;
    await page.getByRole('button', { name: 'metadata-fail.txt 다시 시도', exact: true }).click();
    await page.getByRole('button', { name: 'metadata-fail.txt 목록 새로고침', exact: true }).waitFor();
    await page.locator('tr[data-document-upload-id]').getByText('등록 완료 · 목록 확인 중', { exact: true }).waitFor();
    hideNewMetadata = false;
    await page.getByRole('button', { name: 'metadata-fail.txt 목록 새로고침', exact: true }).click();
    await page.getByRole('button', { name: 'metadata-fail.txt 다운로드', exact: true }).waitFor();
    assert.equal(await page.locator('[data-document-upload-id]').count(), 0, 'completed items automatically disappear after real file rows arrive');
    assert.equal(storageRequests.length, 3, 'metadata-only failure must not re-upload storage');
    assert.equal(storageRequests[0].path, storageRequests[2].path, 'storage retry reuses the exact path');
    assert.equal(metadataRequests.length, 3);
    assert.ok(metadataPaths.every((pathname) => legacySchema ? pathname.endsWith('/files') : pathname.endsWith('/rpc/register_uploaded_document')), 'metadata registration uses the matching migrated or legacy route');
    assert.ok(metadataRequests.every((item) => item.category === '운영자료'), 'retry keeps original category after navigation');
    assert.equal(files.filter((file) => file.name === 'storage-fail.txt').length, 1);
    assert.equal(files.filter((file) => file.name === 'metadata-fail.txt').length, 1);
    await capture('upload-retried');
    await page.getByLabel('파일 업로드', { exact: true }).setInputFiles({ name: 'dismiss-fail.txt', mimeType: 'text/plain', buffer: Buffer.from('dismiss-fail-body') });
    await page.getByRole('button', { name: 'dismiss-fail.txt 업로드 항목 닫기', exact: true }).click();
    assert.equal(await page.locator('[data-document-upload-id]').count(), 0, 'failed upload can be dismissed without affecting saved documents');
    assert.equal(files.filter((file) => ['storage-fail.txt', 'metadata-fail.txt'].includes(file.name)).length, 2);

    await page.getByRole('button', { name: '홈', exact: true }).click();
    await page.locator('[data-dashboard-day="today"]').getByText('문서 연결 확인 회의', { exact: true }).click();
    const scheduleDialog = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await scheduleDialog.getByRole('button', { name: '변경된 회의 자료.png', exact: true }).click();
    await imageDialog.locator('img').waitFor();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await imageDialog.getByRole('button', { name: '미리보기 닫기', exact: true }).evaluate((element) => document.activeElement === element), 'preview traps backwards tab within top dialog');
    await page.keyboard.press('Escape');
    await imageDialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent === '변경된 회의 자료.png');
    assert.ok(await scheduleDialog.getByRole('button', { name: '변경된 회의 자료.png', exact: true }).evaluate((element) => document.activeElement === element), 'preview restores focus to schedule document link');
    await scheduleDialog.getByRole('button', { name: '한글 문서.hwp', exact: true }).click();
    const officeDialog = page.getByRole('dialog', { name: '한글 문서.hwp', exact: true });
    await officeDialog.getByText('이 형식은 브라우저 미리보기를 지원하지 않습니다.', { exact: false }).waitFor();
    assert.equal(await officeDialog.locator('iframe, img').count(), 0, 'office format must never be embedded');
    await officeDialog.getByRole('button', { name: '미리보기 닫기', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, legacySchema, cases: ['rename errors remain open', 'rename/move preserves extension and URL', '320px and 390px mobile cards fit', 'verified image loading', 'preview download fallback', 'inline queued/uploading rows without global panel or fake progress', 'upload folder/search/mobile filtering', 'storage and metadata failures retry separately', 'retry retains captured category', 'real row replaces slot once and clears automatically', 'list-only refresh does not re-upload', 'failed upload dismissal leaves documents intact', 'schedule linked preview and focus restoration', 'office format download-only'], storageRequests: storageRequests.length, metadataRequests: metadataRequests.length, screenshots }, null, 2));
  } catch (error) {
    if (releaseImage) releaseImage();
    if (releaseUpload) releaseUpload();
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    console.error('Browser errors:', errors);
    await capture('failure').catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
