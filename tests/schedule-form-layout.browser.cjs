/* eslint-disable @typescript-eslint/no-require-imports -- Local desktop/mobile preview using only mocked backend calls. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = new URL(process.env.SCHEDULE_FORM_TEST_URL || 'http://127.0.0.1:3000');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname));

(async () => {
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 390, height: 844 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: desktop, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.layout-test`;
  const members = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '박지민', handle: 'jimin' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김하늘', handle: 'haneul' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', display_name: '오지우', handle: 'jiwoo' },
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', display_name: '이도윤', handle: 'doyun' },
  ];
  const readRpc = {
    get_device_access_status: { status: 'approved', user_id: userId, is_admin: false },
    list_team_members: members,
    get_my_team_member: members[0],
    list_my_team_notifications: [],
    team_responsibility_available: true,
    get_team_chat_notice_state: { notice: null, preference: null },
    list_important_schedules: [],
  };
  const writes = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'layout-test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const rpc = url.pathname.split('/').at(-1);
      if (Object.hasOwn(readRpc, rpc)) return reply(readRpc[rpc]);
      return reply({ code: 'PGRST202', message: 'Unimplemented fixture RPC' }, 404);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') { writes.push(request.method() + ' ' + url.pathname); return reply([], 403); }
      if (url.pathname.endsWith('/categories')) return reply([{ id: 1, name: '사업 운영', order_index: 0 }, { id: 2, name: '회의 자료', order_index: 1 }]);
      if (url.pathname.endsWith('/files')) return reply([{ id: 1, name: '지역 연계 협의회 자료.pdf', category: '회의 자료', size: 40960 }]);
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (url.origin === origin.origin) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => new URL(url).host !== origin.host, (connection) => connection.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(20000);
  const outputs = [];
  const screenshot = async (name) => {
    const destination = path.join(os.tmpdir(), `my-portal-schedule-workspace-${name}.png`);
    await page.screenshot({ path: destination });
    outputs.push(destination);
  };
  try {
    await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
    await page.goto(origin.origin);
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    await page.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).click();
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const dialog = page.getByRole('dialog', { name: '일정 추가', exact: true });
    const title = dialog.locator('input[name="title"]');
    await title.fill('지역 연계 협의회');
    await dialog.getByLabel('일정 날짜', { exact: true }).fill('2026-11-26');
    await dialog.getByRole('button', { name: '내부일정', exact: true }).click();
    const select = async (label, id) => {
      await dialog.getByRole('combobox', { name: label, exact: true }).fill(id);
      await dialog.getByRole('option', { name: new RegExp(`@${id}$`) }).click();
    };
    await select('참석 팀원', 'jimin');
    await select('참석 팀원', 'haneul');
    await select('참석 팀원', 'jiwoo');
    await select('담당 팀원', 'doyun');
    await dialog.getByRole('button', { name: '공지사항', exact: true }).click();
    const notice = dialog.locator('[data-schedule-notification-preview]');
    assert.match(await notice.innerText(), /참석 알림 2명.*김하늘, 오지우/s);
    assert.doesNotMatch(await notice.innerText(), /박지민|이도윤/);
    const panels = dialog.locator('[data-schedule-form-grid] > section');
    const left = await panels.first().boundingBox();
    const right = await panels.last().boundingBox();
    assert.ok(right.x > left.x + left.width && Math.abs(left.y - right.y) <= 1, 'desktop has parallel two columns');
    await title.focus();
    await screenshot('desktop');
    await page.setViewportSize(mobile);
    const stackLeft = await panels.first().boundingBox();
    const stackRight = await panels.last().boundingBox();
    assert.ok(Math.abs(stackLeft.x - stackRight.x) <= 1 && stackRight.y >= stackLeft.y + stackLeft.height, 'mobile has one ordered column');
    const button = dialog.locator('button[type="submit"]');
    const footerBefore = await button.boundingBox();
    await title.scrollIntoViewIfNeeded();
    await screenshot('mobile');
    await dialog.locator('[data-schedule-form-team]').scrollIntoViewIfNeeded();
    const footerAfter = await button.boundingBox();
    assert.ok(footerAfter.y + footerAfter.height <= mobile.height && Math.abs(footerBefore.y - footerAfter.y) <= 1, 'save stays visible while scrolling the body');
    await screenshot('mobile-team');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['desktop columns', 'mobile stacking and fixed save', 'only selected recipient IDs excl. current member/owner', 'draft/preview requires no production writes'], screenshots: outputs }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
