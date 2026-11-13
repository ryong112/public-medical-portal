/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser smoke test; use an installed Playwright module through PLAYWRIGHT_MODULE. */
// Run against a local dev server: node tests/whiteboard-import.browser.cjs
// Every Supabase request is mocked. This test never reads or changes live data.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Browser test must run locally');
const baseSchedule = {
  title: '의료지원', date: '2026-11-04', end_date: null, start_time: '10:00', end_time: '11:00',
  schedule_type: 'internal', absence_type: 'annual', is_urgent: false, is_notice: false, is_todo: false, is_completed: false,
};
const photoRow = (overrides = {}) => ({
  ...baseSchedule, source_text: '4일 의료지원 10:00', ink_color: 'blue', color_confidence: 0.95, confidence: 0.92, warnings: [], ...overrides,
});
const photo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="white"/><text x="40" y="60" font-size="32">2026-11</text><text x="40" y="130" fill="blue" font-size="28">4 10:00 schedule</text></svg>');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul' });
  const writes = [];
  const requests = [];
  const errors = [];
  const failures = [];
  let analysis = { schedules: [], visible_months: ['2026-11'], analysis_warnings: [] };
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  const existing = [
    { ...baseSchedule, id: 1, date: '2026-12-04', title: '다음달 미리 등록한 일정' },
    { ...baseSchedule, id: 2, title: '야간 기간 일정', date: '2026-11-05', end_date: '2026-11-07', start_time: '22:00:00', end_time: '09:00:00' },
  ];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({
      access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' },
    });
    if (url.pathname.includes('/functions/v1/analyze-whiteboard')) {
      requests.push(request.postDataJSON());
      return reply(analysis);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
      if (['list_team_members', 'get_my_team_member', 'list_my_team_notifications'].some((rpc) => url.pathname.endsWith('/' + rpc))) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'Team identity unavailable in legacy fixture' }) });
      writes.push({ pathname: url.pathname, body: request.postDataJSON() });
      return reply(0);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') {
        writes.push({ pathname: url.pathname, query: url.search, body: request.postDataJSON() });
        return reply([]);
      }
      return reply(url.pathname.endsWith('/schedules') ? existing : []);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.clock.setFixedTime(new Date('2026-11-03T01:00:00Z'));
  try {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    const openAndAnalyze = async () => {
      await page.getByRole('button', { name: /화이트보드 가져오기|사진 분석/ }).click();
      await page.locator('input[type="file"]').first().setInputFiles({ name: 'board.svg', mimeType: 'image/svg+xml', buffer: photo });
      await page.getByRole('button', { name: '일정 분석 시작' }).click();
      await page.getByRole('heading', { name: '추출된 일정 확인' }).waitFor();
    };

    // Zero results must still allow direct addition and focus the new title.
    await openAndAnalyze();
    assert.equal(await page.getByRole('button', { name: '일정 추가', exact: true }).count(), 1);
    await page.getByRole('button', { name: '일정 추가', exact: true }).click();
    assert.equal(await page.getByLabel('일정 제목', { exact: true }).count(), 1);
    await page.getByLabel('일정 제목', { exact: true }).fill('사진에서 누락된 일정');
    await page.getByRole('button', { name: '이 일정 제외' }).click();
    assert.equal(await page.getByRole('button', { name: '일정 추가', exact: true }).count(), 1);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    assert.equal(writes.length, 0);

    // Four separate rows survive; next month's DB event never appears in review.
    analysis = {
      schedules: [photoRow(), photoRow({ title: '두번째 일정', start_time: '11:00', end_time: '12:00' }), photoRow({ title: '세번째 일정', start_time: '', end_time: '' }), photoRow({ title: '네번째 일정', start_time: '', end_time: '', confidence: 0.6 })],
      visible_months: ['2026-11'], visible_schedule_count: 4, analysis_warnings: [],
    };
    await openAndAnalyze();
    assert.equal(await page.getByLabel('일정 제목', { exact: true }).count(), 4);
    assert.ok((await page.getByLabel('일정 제목', { exact: true }).evaluateAll((inputs) => inputs.map((input) => input.value))).every((title) => !title.includes('다음달')));
    assert.equal(await page.getByText('파랑 · 내부일정', { exact: true }).count(), 4);
    assert.equal(requests.at(-1).targetMonth, '2026-11');
    // Review filter changes visibility only, never silently drops selected rows.
    await page.getByRole('button', { name: '확인 필요한 일정 1건' }).click();
    assert.equal(await page.getByLabel('일정 제목', { exact: true }).count(), 1);
    assert.equal(await page.getByLabel('일정 제목', { exact: true }).inputValue(), '네번째 일정');
    assert.equal(await page.getByRole('button', { name: '선택 일정 4건 반영' }).count(), 1);
    await page.getByRole('button', { name: '전체 4건', exact: true }).click();
    assert.equal(await page.getByLabel('일정 제목', { exact: true }).count(), 4);
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-whiteboard-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('일정 제목', { exact: true }).last().scrollIntoViewIfNeeded();
    const addBox = await page.getByRole('button', { name: '일정 추가', exact: true }).boundingBox();
    assert.ok(addBox && addBox.y + addBox.height <= 844 && addBox.y >= 0, 'Add stays in the mobile viewport');
    assert.ok(await page.getByLabel('일정 제목', { exact: true }).first().evaluate((el) => getComputedStyle(el).fontSize === '16px'));
    assert.ok(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), 'Mobile form does not overflow horizontally');
    const screenshot = path.join(os.tmpdir(), 'my-portal-whiteboard-mobile.png');
    await page.screenshot({ path: screenshot });
    await page.getByRole('button', { name: '일정 추가', exact: true }).click();
    await page.getByLabel('일정 제목', { exact: true }).last().fill('직접 보완한 다섯번째 일정');
    await page.getByRole('button', { name: '선택 일정 5건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.length, 5);
    assert.ok(writes[0].body.every((item) => item.date.startsWith('2026-11')));

    // Inherited range end dates must reach both validation and update payload.
    analysis = { schedules: [photoRow({ title: '야간 기간 일정', date: '2026-11-05', start_time: '23:00', end_time: '09:00' })], visible_months: ['2026-11'], analysis_warnings: [] };
    await openAndAnalyze();
    await page.getByRole('button', { name: '선택 일정 1건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.at(-1).body.end_date, '2026-11-07');
    assert.equal(writes.at(-1).query, '?id=eq.2');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['zero-result add', 'last-delete add', 'four photo rows', 'future-month isolation', 'review filter preserves selections', 'mobile fixed actions', 'manual addition saved', 'existing overnight range preserved'], screenshot }, null, 2));
  } catch (error) {
    console.error(await page.locator('body').innerText());
    console.error('Browser errors:', errors);
    console.error('Failed requests:', failures);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
