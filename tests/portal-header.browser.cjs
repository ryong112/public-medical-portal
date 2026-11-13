/* eslint-disable @typescript-eslint/no-require-imports -- Optional local-only Playwright regression; remote traffic is fully mocked. */
// Run a local dev server first and set PLAYWRIGHT_MODULE if Playwright is not installed in this repository.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.HEADER_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Header QA must only open the local application');

const externalLinks = [
  ['홍보물품 반출대장', 'https://docs.google.com/spreadsheets/d/1yz_fMbsVe0__VJWe6F0ObbrV2jvnRotqi03-mrnnZUc/edit?usp=sharing'],
  ['실적공유', 'https://docs.google.com/spreadsheets/d/1lDD-otVP5s7h-94deku3hLRF4buztn0lO0MBqzNN17M/edit?usp=sharing'],
];
const categories = [
  { id: 501, name: '26년 팀회의', order_index: 0 },
  { id: 502, name: '26년 정책결정회의', order_index: 1 },
  { id: 503, name: '공유자료', order_index: 2 },
];
const event = (id, title, overrides = {}) => ({ id, title, date: '2026-11-13', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'internal', is_notice: false, is_urgent: false, is_todo: false, is_completed: false, owner_name: '김담당', attendee_names: [], location: '회의실', linked_file_ids: [], ...overrides });
const normalSchedules = [
  event(1, '정책결정회의', { schedule_type: 'meeting', start_time: '09:00' }),
  event(2, '협력기관 업무협의', { start_time: '14:00', end_time: '15:00' }),
  event(3, '현장 의료지원 방문', { date: '2026-11-14', schedule_type: 'business_trip' }),
  event(4, '방문 일정 확인', { date: '2026-11-16', is_todo: true }),
];
const notice = event(10, '11월 부서 운영자료 제출 안내', { date: '2026-11-16', is_notice: true, start_time: null, end_time: null });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const screenshots = [], measurements = [], checks = [], errors = [], unexpectedWrites = [], blockedExternal = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  const createPage = async (isAdmin, withNotice = false) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    const state = { withNotice };
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: isAdmin });
      if (url.pathname.endsWith('/list_device_access')) return reply([]);
      if (url.pathname.startsWith('/rest/v1/')) {
        if (request.method() !== 'GET') {
          unexpectedWrites.push(`${request.method()} ${url.pathname}`);
          return reply({ message: 'Read-only header QA blocks all mutation requests' }, 403);
        }
        if (url.pathname.endsWith('/categories')) return reply(categories);
        if (url.pathname.endsWith('/schedules')) return reply(state.withNotice ? [...normalSchedules, notice] : normalSchedules);
        if (url.pathname.endsWith('/files')) return reply([{ id: 1, name: '11월 팀회의 자료.pdf', category: '26년 팀회의', size: 1234, created_at: '2026-11-12T01:00:00Z', url: 'https://portal-test.invalid/header-fixture.pdf' }]);
        if (url.pathname.endsWith('/messages')) return reply([{ id: 1, content: '운영자료 확인 부탁드립니다.', sender_id: 'fixture-sender', created_at: '2026-11-13T00:30:00Z' }]);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (url.origin === new URL(baseUrl).origin) return route.continue();
      blockedExternal.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    await context.addInitScript(() => {
      // The kiosk is deliberately NOT launched in this header-only test.
      window.__headerQaPopupCalls = [];
      window.open = (...args) => { window.__headerQaPopupCalls.push(args.map(String)); return { focus() {} }; };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.dismiss());
    await page.clock.setFixedTime(new Date('2026-11-13T01:00:00Z'));
    await page.goto(baseUrl);
    await page.locator('[data-dashboard-root]').waitFor();
    await page.getByRole('button', { name: '📁 공유자료', exact: true }).waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    return { page, context, state };
  };
  const capture = async (page, name) => {
    const file = path.join(os.tmpdir(), `my-portal-header-${name}.png`);
    const style = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    try { await page.screenshot({ path: file }); screenshots.push(file); }
    finally { await style.evaluate((element) => element.remove()); }
  };
  const fitHeader = async (page, width, label) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.waitForFunction(() => {
      const aside = document.querySelector('main > aside');
      if (!aside) return true;
      const bounds = aside.getBoundingClientRect();
      return innerWidth >= 1280 ? bounds.left >= -0.5 : bounds.right <= 1;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.locator('header').first().evaluate((header) => {
      const rect = (node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
      const visible = (node) => node.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) && !(node.tagName !== 'SUMMARY' && node.closest('details:not([open])')) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, header: rect(header), parts: [...header.children].filter(visible).map((node) => ({ label: node.getAttribute('aria-label') || node.tagName, ...rect(node) })), actions: [...header.querySelectorAll('a, button, summary')].filter(visible).map((node) => ({ label: node.getAttribute('aria-label') || node.textContent, ...rect(node) })) };
    });
    assert.ok(geometry.document <= width + 1, `${label}: document has no horizontal overflow`);
    for (const action of geometry.actions) assert.ok(action.left >= -1 && action.right <= width + 1 && action.top >= geometry.header.top && action.bottom <= geometry.header.bottom + 1, `${label}: action stays inside header: ${JSON.stringify(action)}`);
    for (let index = 1; index < geometry.parts.length; index++) assert.ok(geometry.parts[index - 1].right <= geometry.parts[index].left + 1, `${label}: header groups do not overlap: ${JSON.stringify(geometry.parts)}`);
    measurements.push({ label, ...geometry });
  };
  let page;
  try {
    const admin = await createPage(true);
    page = admin.page;
    const header = () => page.locator('header').first();
    const internal = () => header().getByRole('navigation', { name: '포털 기능' });
    const desktop = () => header().locator('[aria-label="포털 바로가기"]');
    for (const width of [1280, 1366, 1600, 1920]) {
      await fitHeader(page, width, `admin-${width}-no-notice`);
      for (const [name, href] of externalLinks) {
        const link = desktop().getByRole('link', { name: `${name} (새 탭)`, exact: true });
        assert.ok(await link.isVisible(), `${width}: ${name} remains visible`);
        assert.equal(await link.getAttribute('href'), href);
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
        assert.ok(await link.locator('svg.lucide-arrow-up-right').count(), 'External link shows the outbound arrow');
      }
      assert.equal(await header().getByText('진행 중인 주요 공지사항이 없습니다.', { exact: true }).isVisible(), false, 'No empty notice placeholder is visible');
      await capture(page, `${width}-dashboard`);
    }
    checks.push('1280/1366/1600/1920 desktop groups fit; exact external URLs, new-tab safety and outbound indicators remain visible');

    assert.equal(await internal().locator('[aria-pressed="true"]').count(), 0);
    assert.equal(await internal().getByText('새 일정 있음', { exact: true }).count(), 1);
    assert.equal(await internal().getByText('읽지 않은 메시지 있음', { exact: true }).count(), 1);
    assert.equal(await header().locator('[class*="animate-bounce"]').count(), 0, 'Unread indicators never bounce');
    await internal().getByRole('button', { name: '일정 공유', exact: true }).click();
    assert.equal(await internal().getByRole('button', { name: '홈', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await internal().locator('[aria-pressed="true"]').count(), 1);
    await internal().getByRole('button', { name: '정보공유방', exact: true }).click();
    await page.getByPlaceholder('메시지 입력...').waitFor();
    assert.equal(await internal().getByRole('button', { name: '정보공유방', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await internal().locator('[aria-pressed="true"]').count(), 1, 'Only chat is accented while chat is open');
    assert.equal(await internal().getByText('읽지 않은 메시지 있음', { exact: true }).count(), 0);
    await internal().getByRole('button', { name: '정보공유방', exact: true }).click();
    await internal().getByRole('button', { name: '홈', exact: true }).click();
    await page.locator('[data-dashboard-root]').waitFor();
    await internal().getByRole('button', { name: '손)일정확인', exact: true }).click();
    assert.equal(await internal().getByRole('button', { name: '홈', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await internal().locator('[aria-pressed="true"]').count(), 1);
    await internal().getByRole('button', { name: '홈', exact: true }).click();
    await page.locator('[data-dashboard-root]').waitFor();
    checks.push('Internal navigation, calendar/home toggles, chat accent priority and quiet unread indicators work');

    await header().getByRole('button', { name: '통합 검색', exact: true }).click();
    const search = page.getByRole('dialog', { name: '통합 검색', exact: true });
    await search.waitFor();
    await search.getByRole('textbox', { name: '통합 검색어', exact: true }).fill('팀회의');
    await search.getByText('11월 팀회의 자료.pdf', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await search.waitFor({ state: 'detached' });
    await header().getByRole('button', { name: '빠른 일정 입력', exact: true }).click();
    const quick = page.getByRole('dialog', { name: '빠른 일정 입력', exact: true });
    await quick.waitFor();
    await quick.getByRole('button', { name: '닫기', exact: true }).click();
    await quick.waitFor({ state: 'detached' });
    await header().getByRole('button', { name: '전광판 모드', exact: true }).click({ trial: true });
    assert.match(await header().getByRole('button', { name: '전광판 모드', exact: true }).getAttribute('title'), /F8/);
    await header().getByRole('button', { name: '화면 나가기 (기기 승인 유지)', exact: true }).focus();
    assert.ok(await header().getByRole('button', { name: '화면 나가기 (기기 승인 유지)', exact: true }).evaluate((node) => node === document.activeElement));
    assert.deepEqual(await page.evaluate(() => window.__headerQaPopupCalls), [], 'Header-only QA never launches a kiosk or opens an external tab');
    checks.push('Search returns mocked files; quick input opens; kiosk and exit are accessible without activating either');

    const adminSummary = header().locator('summary[aria-label="관리 메뉴"]');
    const adminDetails = adminSummary.locator('..');
    await adminSummary.click();
    for (const name of ['변경 이력', '승인 기기 관리', '연도 문서 정리']) assert.ok(await adminDetails.getByRole('button', { name, exact: true }).isVisible());
    await capture(page, 'admin-menu');
    await page.keyboard.press('Escape');
    assert.equal(await adminDetails.getAttribute('open'), null);
    assert.ok(await adminSummary.evaluate((node) => node === document.activeElement), 'Escape restores admin summary focus');
    await adminSummary.click();
    await header().getByRole('heading', { name: '공공의료지원과 문서함', exact: true }).click();
    assert.equal(await adminDetails.getAttribute('open'), null, 'Outside click closes admin menu');
    for (const [name, heading] of [['변경 이력', '변경 이력'], ['승인 기기 관리', '승인 기기 관리'], ['연도 문서 정리', '2026년 회의 문서 정리']]) {
      await adminSummary.click();
      await adminDetails.getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await adminDetails.getAttribute('open'), null, `${name} closes the admin dropdown`);
      await page.getByRole('button', { name: '닫기', exact: true }).click();
    }
    checks.push('Admin dropdown exposes all three tools; callbacks open read-only views; Escape/outside-click/focus restoration work');

    admin.state.withNotice = true;
    await page.reload();
    await page.locator('[data-dashboard-root]').waitFor();
    for (const width of [1280, 1366, 1600, 1920]) {
      await fitHeader(page, width, `admin-${width}-notice`);
      if (width >= 1536) {
        assert.ok(await header().getByText(notice.title, { exact: false }).isVisible(), `${width}: real notice content is visible`);
        await capture(page, `${width}-notice`);
      }
    }
    await header().getByText(notice.title, { exact: false }).hover();
    await header().getByText('진행 중인 모든 부서 공지 (1건)', { exact: true }).waitFor();
    await page.mouse.move(1, 1);
    checks.push('Empty notice strip is hidden; populated notice and hover list remain available without overlap');

    const regular = await createPage(false);
    page = regular.page;
    await fitHeader(page, 1366, 'non-admin-1366');
    assert.equal(await header().locator('summary[aria-label="관리 메뉴"]').count(), 0);
    assert.equal(await header().getByRole('button', { name: '변경 이력', exact: true }).count(), 0);
    await capture(page, '1366-non-admin');
    await fitHeader(page, 390, 'mobile-390');
    assert.equal(await desktop().isVisible(), false);
    assert.ok(await header().getByRole('button', { name: '일정 공유', exact: true }).isVisible());
    assert.ok(await header().getByRole('button', { name: '문서함', exact: true }).isVisible());
    const more = header().locator('summary[aria-label="더보기 메뉴"]');
    await more.click();
    const mobileMenu = more.locator('..');
    for (const [name, href] of externalLinks) assert.equal(await mobileMenu.getByRole('link', { name: `${name} ↗`, exact: true }).getAttribute('href'), href);
    assert.equal(await mobileMenu.getByRole('button', { name: '변경 이력', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await capture(page, '390-mobile');
    checks.push('Non-admin tools are hidden; 390px keeps the existing mobile actions and links');

    assert.deepEqual(unexpectedWrites, [], 'No database/storage mutation is attempted');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(JSON.stringify({ passed: true, checks, unexpectedWrites, blockedExternal, screenshots, measurements }, null, 2));
  } catch (error) {
    if (page) {
      console.error((await page.locator('body').innerText()).slice(0, 5000));
      await capture(page, 'failure').catch(() => {});
    }
    console.error('Browser errors:', errors);
    console.error('Screenshots:', screenshots);
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
