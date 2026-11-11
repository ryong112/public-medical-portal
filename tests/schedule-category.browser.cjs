/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright smoke test using an installed module via PLAYWRIGHT_MODULE. */
// Start the local dev server first. Supabase traffic is fully mocked.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const event = (id, schedule_type, title, overrides = {}) => ({
  id, schedule_type, title, date: '2026-11-11', end_date: null, start_time: '10:00', end_time: '11:00',
  absence_type: 'annual', is_notice: false, is_urgent: false, is_todo: false, is_completed: false, ...overrides,
});
const fixtures = [
  event(1, 'business_trip', '기간 출장', { start_time: '08:00', end_date: '2026-11-13', is_notice: true, is_urgent: true }),
  event(2, 'internal', '기관 협의회', { start_time: '09:00' }),
  event(3, 'meeting', '정책결정회의'),
  event(4, 'business_trip', '외부 방문', { start_time: '11:00', end_time: null }),
  event(5, 'leave', '휴가 김팀원', { start_time: null, end_time: null }),
  event(6, 'unclassified', '문서 정리', { start_time: null, end_time: null }),
  event(7, 'leave', '휴가 이팀원', { date: '2026-11-14', start_time: null, end_time: null }),
  event(8, 'unclassified', '일반 점검', { date: '2026-11-15', start_time: null, end_time: null }),
  event(9, 'meeting', '내일 회의', { date: '2026-11-12' }),
];

const assertColor = async (locator, property, category) => {
  await locator.waitFor();
  const rgb = await locator.evaluate((el, cssProperty) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(el).getPropertyValue(cssProperty);
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, property);
  const [r, g, b] = rgb;
  const matches = {
    business_trip: g > r && g > b,
    internal: b > r && b > g,
    meeting: r > g && b > g,
    leave: r > g && g > b,
    general: Math.max(r, g, b) - Math.min(r, g, b) < 50,
  }[category];
  assert.ok(matches, `${category} ${property} has expected color family; got ${rgb}`);
};

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
    if (url.pathname.startsWith('/auth/v1/')) return reply({
      access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' },
    });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') writes.push(url.pathname);
      return reply(url.pathname.endsWith('/schedules') ? fixtures : []);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-11T01:00:00Z'));
  try {
    await page.goto(baseUrl);
    for (const category of ['internal', 'business_trip', 'meeting', 'general']) {
      await assertColor(page.locator(`div[data-schedule-category="${category}"]`).first(), 'border-left-color', category);
      await assertColor(page.locator(`button[data-schedule-category="${category}"]`).first(), 'background-color', category);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-category-dashboard.png') });
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    await page.getByLabel('일정 분류 색상').waitFor();
    for (const category of ['internal', 'business_trip', 'meeting', 'leave', 'general']) {
      await assertColor(page.locator(`[data-calendar-category="${category}"]`).first(), 'background-color', category);
      await assertColor(page.locator(`[data-calendar-detail-category="${category}"]`).first(), 'border-left-color', category);
    }
    // A period marked urgent/notice still belongs to the green trip category.
    const trip = page.locator('[data-calendar-category="business_trip"]').first();
    assert.ok(await trip.getByText('공지', { exact: true }).count() || await trip.locator('svg').count());
    await trip.click();
    assert.equal(await page.getByRole('button', { name: '일정 수정', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-category-calendar.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
    for (const category of ['internal', 'business_trip', 'meeting', 'leave', 'general']) {
      await assertColor(page.locator(`[data-calendar-dot-category="${category}"]`).first(), 'background-color', category);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-category-mobile.png') });
    await page.getByRole('button', { name: '이 날짜에 일정 추가' }).click();
    for (const [label, category] of [['출장)', 'business_trip'], ['회의)', 'meeting'], ['내부일정)', 'internal'], ['연차·조퇴·외출)', 'leave']]) {
      const button = page.getByRole('button', { name: label, exact: true });
      await button.click();
      await assertColor(button, 'background-color', category);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${baseUrl}/kiosk`);
    for (const category of ['internal', 'business_trip', 'meeting', 'leave', 'general']) {
      await assertColor(page.locator(`div[data-schedule-category="${category}"].border-l-4`).first(), 'border-left-color', category);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-category-kiosk.png') });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    console.log(JSON.stringify({ passed: true, cases: ['dashboard rows and filters', 'calendar category chips', 'selected date cards', 'notice and period retain category', 'mobile dots and width', 'new schedule type controls', 'kiosk categories'], screenshots: ['dashboard', 'calendar', 'mobile', 'kiosk'].map((name) => path.join(os.tmpdir(), `my-portal-category-${name}.png`)) }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(0, 3000));
    console.error('Browser errors:', errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
