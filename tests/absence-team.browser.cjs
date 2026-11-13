/* eslint-disable @typescript-eslint/no-require-imports -- Read-only mocked local browser regression for participant-based absence displays. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.ABSENCE_TEAM_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const userId = '11111111-1111-4111-8111-111111111111';
const members = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김민수', handle: 'minsu-a' }, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김민수', handle: 'minsu-b' }];
const leave = (id, fields = {}) => ({ id, title: '휴가', date: '2026-11-13', end_date: null, start_time: null, end_time: null, schedule_type: 'leave', absence_type: 'annual', is_notice: false, is_todo: false, is_urgent: false, is_completed: false, ...fields });
const schedules = [leave(1, { attendee_member_ids: members.map((member) => member.id), attendee_names: ['김민수'] }), leave(2, { title: '조퇴', absence_type: 'early', start_time: '13:00', end_time: '14:00', attendee_member_ids: [members[0].id], attendee_names: ['김민수'] }), leave(3, { title: '외출', absence_type: 'outing', attendee_names: ['박외부'] })];
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-only`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const errors = [], writes = [], screenshots = [];
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.endsWith('/list_team_members')) return reply(members);
    if (url.pathname.endsWith('/get_my_team_member')) return reply(members[0]);
    if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
    if (url.pathname.endsWith('/team_responsibility_available')) return reply(true);
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') { writes.push({ path: url.pathname, method: request.method() }); return reply({ message: 'Unexpected mocked write rejected' }, 403); }
      if (url.pathname.endsWith('/schedules')) return reply(schedules);
      if (url.pathname.endsWith('/categories')) return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (url.origin === new URL(baseUrl).origin) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-13T01:00:00Z'));
  const capture = async (name) => { const file = path.join(os.tmpdir(), `my-portal-absence-team-${name}.png`); await page.screenshot({ path: file }); screenshots.push(file); };
  try {
    await page.goto(baseUrl);
    const summary = page.locator('[data-dashboard-summary="absence"]');
    await summary.getByRole('button', { name: '이번 달 휴가 3명 미리보기', exact: true }).waitFor();
    assert.equal(await summary.locator('[data-dashboard-count]').innerText(), '3', 'equal names remain separate stable IDs, but repeated leave types do not double-count a member');
    await summary.getByRole('button', { name: '이번 달 휴가 3명 미리보기', exact: true }).click();
    const mini = page.locator('[data-absence-calendar]');
    await mini.waitFor();
    assert.equal(await mini.locator('[data-absence-date="2026-11-13"]').getAttribute('data-absence-count'), '3');
    const names = await mini.locator('[data-absence-selected-list]').innerText();
    assert.ok(names.includes('김민수 (@minsu-a)'));
    assert.ok(names.includes('김민수 (@minsu-b)'));
    assert.ok(names.includes('박외부'));
    assert.ok(!names.includes('이름 미상'));
    await mini.getByRole('button', { name: '월간 현황표', exact: true }).click();
    const board = page.getByRole('dialog', { name: '월간 휴가 현황', exact: true });
    await board.waitFor();
    for (const member of members) {
      assert.equal(await board.locator(`tr[data-absence-person-key="member:${member.id}"]`).count(), 1);
      assert.ok((await board.innerText()).includes(`김민수 (@${member.handle})`));
    }
    assert.equal(await board.locator('tr[data-absence-person-key]').count(), 3);
    await capture('desktop');
    await page.setViewportSize({ width: 320, height: 844 });
    assert.equal(await board.locator('article[data-absence-person-key]:visible').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture('mobile-320');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${baseUrl}/kiosk`);
    const today = page.locator('[data-kiosk-panel="absences-today"]');
    await today.getByText('김민수 (@minsu-a) · 김민수 (@minsu-b)', { exact: true }).waitFor();
    assert.ok(!(await today.innerText()).includes('이름 미상'));
    await capture('kiosk');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['cleaned absence titles use selected members', 'UUID count distinguishes equal names and deduplicates repeat types', 'mini calendar participant names', 'monthly board ID rows', '320px mobile rows', 'dedicated kiosk roster lookup'], screenshots }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
