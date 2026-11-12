/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright regression test; all remote data is mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const event = (id, schedule_type, title, overrides = {}) => ({ id, schedule_type, title, date: '2026-11-12', end_date: null, start_time: '10:00', end_time: '11:00', is_notice: false, is_urgent: false, is_todo: false, is_completed: false, ...overrides });
const fixtures = [
  event(1, 'business_trip', '현장 방문', { owner_name: '김담당', attendee_names: ['이참석'], location: '회의실 A', is_notice: true, is_urgent: true }),
  event(2, 'internal', '기관 협의회', { start_time: '09:00' }), event(3, 'meeting', '정책결정회의'),
  event(4, 'unclassified', '문서 정리', { is_todo: true }), event(5, 'leave', '휴가) 이팀원', { start_time: null, end_time: null }),
  event(6, 'unclassified', '기한 지난 업무', { date: '2026-11-10', is_todo: true }),
  event(7, 'meeting', '내일 회의', { date: '2026-11-13' }), event(8, 'business_trip', '다음 주 방문', { date: '2026-11-18' }),
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul' });
  const errors = [];
  const writes = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') writes.push(url.pathname);
      if (url.pathname.endsWith('/schedules')) {
        if (request.method() === 'PATCH') {
          const id = Number(url.searchParams.get('id')?.replace('eq.', ''));
          Object.assign(fixtures.find((schedule) => schedule.id === id), request.postDataJSON());
        }
        return reply(fixtures);
      }
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-12T01:00:00Z'));
  const screenshot = (name) => page.screenshot({ path: path.join(os.tmpdir(), `my-portal-workflow-${name}.png`) });
  try {
    await page.goto(baseUrl);
    const todo = page.getByRole('heading', { name: 'TO DO LIST', exact: true }).locator('xpath=ancestor::section[1]');
    await todo.getByText('기한 지남 1개', { exact: true }).waitFor();
    const toggle = todo.getByRole('button', { name: '상세 보기', exact: true });
    await toggle.focus();
    await toggle.press('Enter');
    assert.equal(await todo.getByRole('button', { name: '상세 접기', exact: true }).getAttribute('aria-expanded'), 'true');
    await todo.getByText('기한 지난 업무', { exact: true }).waitFor();
    await todo.getByRole('button', { name: '상세 접기', exact: true }).press('Escape');
    assert.equal(await todo.getByRole('button', { name: '상세 보기', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await todo.getByRole('region', { name: 'TO DO LIST 상세' }).count(), 0);
    const today = page.getByRole('heading', { name: '오늘 일정', exact: true }).locator('xpath=ancestor::section[1]');
    await today.getByRole('button', { name: '업무 전체 4건', exact: true }).waitFor();
    assert.equal(await today.locator('div[data-schedule-category].border-l-4').count(), 4);
    await today.getByText('담당 김담당 · 장소 회의실 A', { exact: true }).waitFor();
    await today.getByRole('button', { name: '휴가 1건', exact: true }).click();
    assert.equal(await today.locator('div[data-schedule-category].border-l-4').count(), 1);
    await today.getByRole('button', { name: '업무 전체 4건', exact: true }).click();
    await screenshot('desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
    await today.scrollIntoViewIfNeeded();
    assert.ok(await today.evaluate((element) => element.getBoundingClientRect().height > 500), 'mobile today list is not collapsed by flex sizing');
    for (const row of await today.locator('div[data-schedule-category].border-l-4').all()) assert.ok((await row.boundingBox()).height > 40);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no mobile horizontal page overflow');
    assert.ok(await today.getByRole('button', { name: '내부일정 1건', exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 12));
    await screenshot('mobile');
    await todo.getByRole('button', { name: '상세 보기', exact: true }).click();
    await todo.getByRole('button', { name: '기한 지난 업무 완료 처리', exact: true }).click();
    await todo.getByText('기한 지남 0개', { exact: true }).waitFor();
    await todo.getByRole('button', { name: '상세 접기', exact: true }).click();
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '주간 일정 인쇄 / PDF 저장' });
    await dialog.waitFor();
    await dialog.getByText('종료일 2026-11-18 (7일)', { exact: true }).waitFor();
    await dialog.getByText('이참석', { exact: true }).waitFor();
    await dialog.getByText('회의실 A', { exact: true }).waitFor();
    await dialog.getByText('휴가) 이팀원', { exact: true }).waitFor();
    await dialog.getByLabel('시작일', { exact: true }).fill('2026-11-13');
    await dialog.getByText('종료일 2026-11-19 (7일)', { exact: true }).waitFor();
    await dialog.getByLabel('시작일', { exact: true }).fill('2026-11-12');
    await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
    await dialog.getByRole('button', { name: '인쇄 / PDF 저장', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.weekly-print-controls').isVisible(), false);
    const pdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-workflow-week.pdf'), preferCSSPageSize: true });
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.equal(pageCount, 1, `ordinary seven-event week fits one A4 landscape page (got ${pageCount})`);
    await screenshot('print');
    await page.emulateMedia({ media: 'screen' });
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: '주간 일정 인쇄 / PDF 저장' }).count(), 0);
    await page.waitForFunction(() => document.activeElement?.textContent === '주간 인쇄');
    // Stress week must paginate while keeping the final row; no one-page scaling.
    fixtures.push(...Array.from({ length: 80 }, (_, index) => event(100 + index, 'internal', `다량 업무 ${index} 아주 긴 설명을 포함하는 일정 제목과 필요한 상세내용`, { owner_name: '김담당', attendee_names: ['이참석', '박참석'], location: '기관 회의실' })));
    await page.reload();
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    await page.getByRole('dialog', { name: '주간 일정 인쇄 / PDF 저장' }).getByText('다량 업무 79 아주 긴 설명을 포함하는 일정 제목과 필요한 상세내용', { exact: true }).waitFor();
    await page.emulateMedia({ media: 'print' });
    const longPdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-workflow-week-many.pdf'), preferCSSPageSize: true });
    const longPageCount = (longPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.ok(longPageCount > 1, 'busy week paginates');
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, ['/rest/v1/schedules']);
    console.log(JSON.stringify({ passed: true, pageCount, longPageCount, cases: ['keyboard details + Escape', 'overdue completion', 'truthful category counts', 'mobile rows and readable filters', 'metadata and absence print', 'date selector', 'one-page ordinary week', 'multi-page busy week', 'close restores focus'], screenshots: ['desktop', 'mobile', 'print'].map((name) => path.join(os.tmpdir(), `my-portal-workflow-${name}.png`)) }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(0, 5000));
    console.error('Browser errors:', errors);
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
