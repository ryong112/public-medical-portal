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
const viewports = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: viewports[0], timezoneId: 'Asia/Seoul' });
  const errors = [], writes = [], screenshots = [], measurements = [];
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
  const dashboard = () => page.locator('[data-dashboard-root]');
  const dayPanel = (day) => page.locator(`[data-dashboard-day="${day}"]`);
  const rows = (scope) => scope.locator('[data-schedule-id]');
  const filters = () => page.getByRole('group', { name: '일정 유형', exact: true });
  const summary = (key) => page.locator(`[data-dashboard-summary="${key}"]`);
  const nextButton = (scope) => scope.getByRole('button', { name: /다음 페이지/ });
  const screenshot = async (name) => {
    const file = path.join(os.tmpdir(), `my-portal-compact-${name}.png`);
    await page.screenshot({ path: file }); screenshots.push(file);
  };
  const settleLayout = async (viewport) => {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => innerWidth >= 1280 || document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const assertFits = async (label) => {
    const geometry = await page.evaluate(() => {
      const selectors = ['[data-dashboard-root]', '[data-dashboard-root] > header', '[data-dashboard-day="today"]', '[data-dashboard-day="tomorrow"]', '[data-dashboard-summary="todo"]', '[data-dashboard-summary="notice"]', '[data-dashboard-summary="week"]', '[data-dashboard-summary="absence"]'];
      return {
        viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        nodes: selectors.map((selector) => {
          const node = document.querySelector(selector);
          if (!node) return { selector, missing: true };
          const box = node.getBoundingClientRect();
          return { selector, x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
        }),
        lists: [...document.querySelectorAll('[data-dashboard-list]')].map((list) => {
          const box = list.getBoundingClientRect();
          return { name: list.dataset.dashboardList, y: box.y, bottom: box.bottom, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, rows: [...list.querySelectorAll('[data-schedule-id]')].map((row) => {
            const bounds = row.getBoundingClientRect();
            return { id: row.dataset.scheduleId, y: bounds.y, bottom: bounds.bottom, height: bounds.height };
          }) };
        }),
      };
    });
    assert.ok(geometry.document[0] <= geometry.viewport[0] + 1, `${label}: no horizontal page scrolling`);
    assert.ok(geometry.document[1] <= geometry.viewport[1] + 1, `${label}: no vertical page scrolling`);
    for (const node of geometry.nodes) {
      assert.ok(!node.missing, `${label}: ${node.selector} exists`);
      assert.ok(node.height > 0 && node.width > 0, `${label}: ${node.selector} is not collapsed`);
      assert.ok(node.x >= -1 && node.y >= -1 && node.right <= geometry.viewport[0] + 1 && node.bottom <= geometry.viewport[1] + 1, `${label}: ${node.selector} stays entirely in viewport: ${JSON.stringify(node)}`);
      assert.ok(node.scrollHeight <= node.clientHeight + 2 && node.scrollWidth <= node.clientWidth + 2, `${label}: ${node.selector} has no clipped overflowing content: ${JSON.stringify(node)}`);
    }
    for (const list of geometry.lists) {
      assert.ok(list.scrollHeight <= list.clientHeight + 2, `${label}: ${list.name} list is not clipped`);
      for (const row of list.rows) assert.ok(row.y >= list.y - 1 && row.bottom <= list.bottom + 1 && row.height >= 40, `${label}: entire readable row ${row.id} fits ${list.name}: ${JSON.stringify({ list, row })}`);
    }
    measurements.push({ label, ...geometry }); return geometry;
  };
  const visitAllRows = async (scope) => {
    const previousButton = scope.getByRole('button', { name: /이전 페이지/ });
    for (let turns = 0; turns < 150 && await previousButton.count() > 0 && !await previousButton.isDisabled(); turns += 1) await previousButton.click();
    const visited = new Set();
    for (let turns = 0; turns < 150; turns += 1) {
      for (const id of await rows(scope).evaluateAll((elements) => elements.map((element) => Number(element.dataset.scheduleId)))) visited.add(id);
      const next = nextButton(scope);
      if (await next.count() === 0 || await next.isDisabled()) return visited;
      const previous = (await rows(scope).first().getAttribute('data-schedule-id')) ?? '';
      await next.click();
      await page.waitForFunction(({ selector, oldId }) => document.querySelector(`${selector} [data-schedule-id]`)?.getAttribute('data-schedule-id') !== oldId, { selector: await scope.getAttribute('data-dashboard-day') ? `[data-dashboard-day="${await scope.getAttribute('data-dashboard-day')}"]` : 'dialog[open]', oldId: previous });
    }
    throw new Error('Pagination did not reach its final page');
  };
  try {
    await page.goto(baseUrl);
    await dashboard().waitFor();
    assert.equal(await filters().count(), 1, 'only one shared category control exists');
    assert.equal(await filters().getByRole('button').count(), 6, 'all and five categories appear once');
    assert.equal(await dayPanel('today').getByRole('group', { name: /유형/ }).count(), 0);
    assert.equal(await dashboard().getByText('앞으로 7일', { exact: true }).count(), 0);
    assert.equal(await dashboard().getByText('유형 선택 · 목록 필터', { exact: true }).count(), 0);
    await summary('week').getByText('주간 일정', { exact: true }).waitFor();
    await filters().getByRole('button', { name: '회의', exact: true }).click();
    await dayPanel('today').getByText('정책결정회의', { exact: true }).waitFor();
    assert.equal(await rows(dayPanel('today')).count(), 1);
    assert.equal(await rows(dayPanel('tomorrow')).count(), 1);
    assert.equal(await summary('todo').locator('[data-dashboard-count]').innerText(), '0');
    assert.equal(await summary('notice').locator('[data-dashboard-count]').innerText(), '0');
    assert.equal(await summary('week').locator('[data-dashboard-count]').innerText(), '2');
    await filters().getByRole('button', { name: '휴가', exact: true }).click();
    await dayPanel('today').getByText('이팀원', { exact: true }).waitFor();
    assert.equal(await rows(dayPanel('today')).count(), 1);
    assert.equal(await rows(dayPanel('tomorrow')).count(), 0);
    await filters().getByRole('button', { name: '전체', exact: true }).click();
    assert.equal(await dayPanel('today').locator('[data-dashboard-count]').innerText(), '5', 'all includes leave');
    for (const viewport of viewports) {
      await settleLayout(viewport);
      await assertFits(`normal ${viewport.width}x${viewport.height}`);
      assert.ok(await filters().getByRole('button', { name: '내부일정', exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 12));
      await screenshot(`${viewport.width}x${viewport.height}`);
    }
    const todoButton = page.getByRole('button', { name: /^할 일 \d+건 상세 보기$/ });
    await todoButton.focus(); await todoButton.press('Enter');
    const details = page.locator('dialog[open]');
    await details.waitFor();
    await details.getByText('기한 지난 업무', { exact: true }).waitFor();
    await details.getByRole('button', { name: '기한 지난 업무 완료 처리', exact: true }).click();
    await page.keyboard.press('Escape');
    await details.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.closest('[data-dashboard-summary="todo"]'));
    await assertFits('summary modal closed');
    await page.getByRole('button', { name: /^공지사항 \d+건 상세 보기$/ }).click();
    await details.waitFor();
    await details.locator('[data-schedule-id="1"]').getByRole('button').last().click();
    const nestedScheduleDetails = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await nestedScheduleDetails.waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0, 'summary native dialog closes before root schedule details');
    await nestedScheduleDetails.getByText('김담당', { exact: false }).waitFor();
    await nestedScheduleDetails.getByRole('button', { name: '닫기', exact: true }).click();
    await settleLayout(viewports[0]);
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    const printDialog = page.getByRole('dialog', { name: '주간 일정 인쇄 / PDF 저장' });
    await printDialog.waitFor();
    await printDialog.getByText('종료일 2026-11-18 (7일)', { exact: true }).waitFor();
    await printDialog.getByText('이참석', { exact: true }).waitFor();
    await printDialog.getByText('회의실 A', { exact: true }).waitFor();
    await printDialog.getByText('휴가) 이팀원', { exact: true }).waitFor();
    await printDialog.getByLabel('시작일', { exact: true }).fill('2026-11-13');
    await printDialog.getByText('종료일 2026-11-19 (7일)', { exact: true }).waitFor();
    await printDialog.getByLabel('시작일', { exact: true }).fill('2026-11-12');
    await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
    await printDialog.getByRole('button', { name: '인쇄 / PDF 저장', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.weekly-print-controls').isVisible(), false);
    const pdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-compact-week.pdf'), preferCSSPageSize: true });
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.equal(pageCount, 1, 'ordinary week still fits one A4 landscape sheet');
    await page.emulateMedia({ media: 'screen' });
    await page.keyboard.press('Escape'); await printDialog.waitFor({ state: 'hidden' });
    const longTitle = '장문의 일정 제목도 상세 화면에서는 빠짐없이 읽을 수 있어야 합니다 '.repeat(8);
    fixtures.splice(0, fixtures.length,
      ...Array.from({ length: 40 }, (_, index) => event(100 + index, ['internal', 'meeting', 'business_trip'][index % 3], index === 39 ? longTitle : `오늘 다량 업무 ${index}`, { owner_name: '김담당', attendee_names: ['이참석', '박참석'], location: '기관 회의실', is_notice: index % 2 === 0, is_todo: index % 3 === 0 })),
      ...Array.from({ length: 25 }, (_, index) => event(200 + index, 'meeting', `내일 다량 업무 ${index}`, { date: '2026-11-13' })),
      ...Array.from({ length: 20 }, (_, index) => event(300 + index, 'leave', `휴가) 직원${index}`, { start_time: null, end_time: null })),
    );
    await page.reload(); await dashboard().waitFor();
    for (const viewport of viewports) {
      await settleLayout(viewport);
      const busyGeometry = await assertFits(`busy ${viewport.width}x${viewport.height}`);
      const normalGeometry = measurements.find(({ label }) => label === `normal ${viewport.width}x${viewport.height}`);
      for (const node of busyGeometry.nodes) {
        const original = normalGeometry.nodes.find(({ selector }) => selector === node.selector);
        assert.ok(Math.abs(original.height - node.height) <= 1 && Math.abs(original.y - node.y) <= 1, `${viewport.width}: ${node.selector} does not grow or push lower panels when data grows`);
      }
      if (viewport.width === 1920 || viewport.width === 320) {
        const todayIds = await visitAllRows(dayPanel('today'));
        const tomorrowIds = await visitAllRows(dayPanel('tomorrow'));
        assert.equal(todayIds.size, 60, `${viewport.width}: all 40 work + 20 leave events reachable`);
        assert.equal(tomorrowIds.size, 25, `${viewport.width}: all 25 tomorrow events reachable`);
        await assertFits(`busy final page ${viewport.width}x${viewport.height}`);
      }
      await screenshot(`busy-${viewport.width}x${viewport.height}`);
    }
    await page.reload(); await dayPanel('today').waitFor();
    for (let turns = 0; turns < 100 && !await dayPanel('today').locator('[data-schedule-id="139"]').count(); turns += 1) await nextButton(dayPanel('today')).click();
    await dayPanel('today').locator('[data-schedule-id="139"]').getByRole('button').last().click();
    const scheduleDetails = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await scheduleDetails.getByRole('heading').waitFor();
    assert.ok((await scheduleDetails.getByRole('heading').innerText()).endsWith(longTitle.trim()), 'schedule details retain the complete title after its category prefix');
    await scheduleDetails.getByRole('button', { name: '닫기', exact: true }).click();
    await settleLayout(viewports[0]);
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    await printDialog.getByText('내일 다량 업무 24', { exact: true }).waitFor();
    await page.emulateMedia({ media: 'print' });
    const longPdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-compact-week-many.pdf'), preferCSSPageSize: true });
    const longPageCount = (longPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.ok(longPageCount > 1, 'busy week print retains every row across pages');
    assert.deepEqual(errors, []); assert.deepEqual(writes, ['/rest/v1/schedules']);
    console.log(JSON.stringify({ passed: true, pageCount, longPageCount, cases: ['one shared category control', 'global category filtering', 'all includes leave', 'five viewport sizes fit', 'summary keyboard and focus restoration', 'overdue completion', 'all 85 busy-day rows reachable', 'long title detail', 'ordinary and busy week print'], screenshots, layoutsChecked: measurements.map(({ label, viewport, document }) => ({ label, viewport, document })) }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(0, 5000)); console.error('Browser errors:', errors); throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
