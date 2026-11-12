/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright regression test; all remote data is mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Never run this mocked browser test on production');

// Synthetic dates deliberately test styling, not the real public holiday calendar.
const holidays = [
  { date: '2026-11-12', name: '테스트 평일 공휴일' },
  { date: '2026-11-17', name: '테스트 대체공휴일' },
  { date: '2026-11-21', name: '테스트 토요일 공휴일' },
  { date: '2027-01-01', name: '테스트 새해 공휴일' },
];
const userId = '11111111-1111-4111-8111-111111111111';
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
const colors = (value) => (value.match(/\d+(?:\.\d+)?/g) || []).map(Number).slice(0, 3);
const isRed = ([red, green, blue]) => red >= 130 && red - green >= 50 && red > green * 1.4 && red > blue * 1.2;
const isBlue = ([red, green, blue]) => blue >= 120 && blue - red >= 50 && blue > red * 1.3 && blue > green * 1.1;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const checks = [], screenshots = [];
  try {
    for (const scenario of [
      { today: '2026-11-12', red: ['2026-11-12', '2026-11-15', '2026-11-17'], blue: ['2026-11-14'], named: ['2026-11-12', '2026-11-17'], file: 'weekday-holiday' },
      { today: '2026-11-19', red: ['2026-11-21', '2026-11-22'], blue: [], named: ['2026-11-21'], file: 'saturday-holiday' },
      { today: '2026-12-29', red: ['2027-01-01', '2027-01-03'], blue: ['2027-01-02'], named: ['2027-01-01'], file: 'year-boundary' },
    ]) {
      const errors = [], writes = [], years = new Set();
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Seoul' });
      await context.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url());
        const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
        if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
        if (url.pathname.startsWith('/rest/v1/')) {
          if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
          return reply([]);
        }
        if (url.pathname === '/api/korean-holidays') {
          const year = url.searchParams.get('year');
          years.add(year);
          return reply({ holidays: holidays.filter(({ date }) => date.startsWith(`${year}-`)) });
        }
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
        return route.abort();
      });
      await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.setDefaultTimeout(15000);
      await page.clock.setFixedTime(new Date(`${scenario.today}T01:00:00Z`));
      await page.goto(baseUrl);
      const dashboard = page.locator('[data-dashboard-root]');
      await dashboard.waitFor();
      const tile = (date) => page.locator(`[data-dashboard-week-date="${date}"]`);
      for (const date of scenario.named) {
        const name = holidays.find((holiday) => holiday.date === date).name;
        await tile(date).locator('[data-week-holiday-name]').filter({ hasText: name }).waitFor();
        assert.ok((await tile(date).getAttribute('aria-label')).includes(name), `${date}: the full holiday name is accessible`);
        assert.ok((await tile(date).getAttribute('title')).includes(name), `${date}: truncated holiday names retain their full tooltip`);
        assert.equal(await tile(date).getAttribute('data-week-day-kind'), 'holiday', `${date}: holiday takes priority over weekday and Saturday`);
      }
      for (const date of scenario.red) {
        const color = await tile(date).locator('time strong').evaluate((node) => getComputedStyle(node).color);
        assert.ok(isRed(colors(color)), `${date}: Sunday or public holiday date is red, got ${color}`);
      }
      for (const date of scenario.blue) {
        const color = await tile(date).locator('time strong').evaluate((node) => getComputedStyle(node).color);
        assert.ok(isBlue(colors(color)), `${date}: ordinary Saturday date is blue, got ${color}`);
        assert.equal(await tile(date).getAttribute('data-week-day-kind'), 'saturday');
      }
      if (scenario.file === 'weekday-holiday') {
        const ordinary = tile('2026-11-16');
        assert.equal(await ordinary.getAttribute('data-week-day-kind'), 'weekday');
        const color = colors(await ordinary.locator('time strong').evaluate((node) => getComputedStyle(node).color));
        assert.ok(!isRed(color) && !isBlue(color), 'An ordinary weekday is neutral, not a holiday');
      }
      const namedDate = scenario.named[0];
      await tile(namedDate).click();
      const preview = page.locator('[data-anchored-preview][data-state="open"]');
      await preview.waitFor();
      assert.ok((await preview.getByRole('heading').innerText()).includes(holidays.find(({ date }) => date === namedDate).name), 'The day mini also identifies its holiday');
      await page.keyboard.press('Escape'); await page.locator('[data-anchored-preview]').waitFor({ state: 'hidden' });
      if (scenario.file === 'year-boundary') assert.ok(years.has('2026') && years.has('2027'), 'The weekly view fetches both years across December and January');
      for (const viewport of [{ width: 1366, height: 768 }, { width: 320, height: 640 }]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(150);
        if (viewport.width === 320) {
          const name = holidays.find(({ date }) => date === namedDate).name;
          assert.ok((await tile(namedDate).getAttribute('aria-label')).includes(name), 'Mobile keeps the full holiday name accessible');
          const color = await tile(namedDate).locator('time strong').evaluate((node) => getComputedStyle(node).color);
          assert.ok(isRed(colors(color)), 'Mobile still marks the holiday date in red');
          await tile(namedDate).click(); await preview.waitFor();
          assert.ok((await preview.getByRole('heading').innerText()).includes(name), 'The mobile day mini displays the complete holiday name');
          await page.keyboard.press('Escape'); await page.locator('[data-anchored-preview]').waitFor({ state: 'hidden' });
        }
        const geometry = await dashboard.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return { rootWidth: node.clientWidth, scrollWidth: node.scrollWidth, rootHeight: node.clientHeight, scrollHeight: node.scrollHeight, bottom: box.bottom, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, width: innerWidth, height: innerHeight };
        });
        assert.ok(geometry.docWidth <= geometry.width + 1 && geometry.docHeight <= geometry.height + 1, `${scenario.file}: holiday names never create page scrolling: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.scrollWidth <= geometry.rootWidth + 1 && geometry.scrollHeight <= geometry.rootHeight + 2 && geometry.bottom <= geometry.height + 1, `${scenario.file}: holiday content stays within the one-screen dashboard`);
        const file = path.join(os.tmpdir(), `my-portal-dashboard-holidays-${scenario.file}-${viewport.width}x${viewport.height}.png`);
        const overlay = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
        await page.screenshot({ path: file }); screenshots.push(file);
        await overlay.evaluate((node) => node.remove());
      }
      assert.deepEqual(errors, [], 'No browser exceptions');
      assert.deepEqual(writes, [], 'No schedule data writes');
      checks.push({ today: scenario.today, years: [...years], red: scenario.red, blue: scenario.blue, holidayNames: scenario.named });
      await context.close();
    }
    console.log(JSON.stringify({ passed: true, checks, screenshots }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
