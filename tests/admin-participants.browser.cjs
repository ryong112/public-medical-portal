/* eslint-disable @typescript-eslint/no-require-imports -- Local-only admin participant regression; every remote request is mocked. */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.ADMIN_PARTICIPANTS_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const adminUser = '11111111-1111-4111-8111-111111111111';
const mobileUser = '22222222-2222-4222-8222-222222222222';
const normalUser = '33333333-3333-4333-8333-333333333333';
const kioskUser = '44444444-4444-4444-8444-444444444444';
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mobileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const normalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const members = [
  { id: adminId, display_name: '손관리', handle: 'admin-pc' },
  { id: mobileId, display_name: '관리자 휴대폰', handle: 'admin-mobile' },
  { id: normalId, display_name: '일반 팀원', handle: 'normal-pc' },
];
const mappings = [
  { user_id: adminUser, member_id: adminId, is_kiosk: false },
  { user_id: mobileUser, member_id: mobileId, is_kiosk: false },
  { user_id: normalUser, member_id: normalId, is_kiosk: false },
  { user_id: kioskUser, member_id: null, is_kiosk: true },
];
const devices = [
  { user_id: adminUser, device_name: '손관리 사내PC', is_admin: true },
  { user_id: mobileUser, device_name: '관리자 휴대폰', is_admin: true },
  { user_id: normalUser, device_name: '일반 팀원 사내PC', is_admin: false },
  { user_id: kioskUser, device_name: '전광판 전용', is_admin: false },
].map((device) => ({ ...device, status: 'approved', requested_at: '2026-11-01T00:00:00Z', approved_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-13T00:00:00Z' }));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [], screenshots = [];
  const state = { schedules: [], notifications: [], writes: [], adminWrites: [], roleWrites: [], errors: [], capable: true };
  const createPage = async (userId, isAdmin) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    contexts.push(context);
    const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: isAdmin });
      if (url.pathname.endsWith('/list_team_members')) return reply(state.capable ? members : [members[2]]);
      if (url.pathname.endsWith('/get_my_team_member')) return reply(state.capable ? members.find((member) => member.id === mappings.find((mapping) => mapping.user_id === userId)?.member_id) ?? null : isAdmin ? null : members[2]);
      if (url.pathname.endsWith('/list_my_team_notifications')) return reply(state.capable && isAdmin ? state.notifications : []);
      if (url.pathname.endsWith('/mark_my_notifications_read')) {
        const body = request.postDataJSON();
        state.notifications.forEach((item) => { if (body.p_notification_ids === null || body.p_notification_ids.includes(item.id)) item.read_at = '2026-11-13T02:00:00Z'; });
        return reply(1);
      }
      if (url.pathname.endsWith('/team_responsibility_available')) return reply(false);
      if (url.pathname.endsWith('/get_team_chat_notice_state')) return reply({ code: 'PGRST202', message: 'Chat notice capability unavailable in this fixture' }, 404);
      if (url.pathname.endsWith('/list_device_access')) return reply(devices);
      if (url.pathname.endsWith('/list_team_member_devices')) return reply(state.capable ? mappings : mappings.map((mapping) => [adminUser, mobileUser].includes(mapping.user_id) ? { ...mapping, member_id: null } : mapping));
      if (url.pathname.endsWith('/admin_set_team_member_name')) {
        assert.ok(isAdmin);
        const body = request.postDataJSON();
        state.adminWrites.push({ rpc: 'rename', body });
        members.find((member) => member.id === body.p_member_id).display_name = body.p_display_name;
        return reply(null);
      }
      if (url.pathname.endsWith('/admin_link_team_member_device')) {
        assert.ok(isAdmin);
        const body = request.postDataJSON();
        state.adminWrites.push({ rpc: 'link', body });
        mappings.find((mapping) => mapping.user_id === body.p_user_id).member_id = body.p_member_id;
        return reply(null);
      }
      if (url.pathname.endsWith('/set_device_access')) { state.roleWrites.push(request.postDataJSON()); throw new Error('Participant editing must not change device roles'); }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (url.pathname.endsWith('/schedules')) {
          if (request.method() === 'POST') {
            const body = request.postDataJSON();
            state.writes.push(body);
            for (const values of Array.isArray(body) ? body : [body]) {
              const schedule = { id: 10 + state.schedules.length, ...values };
              state.schedules.push(schedule);
              if (schedule.attendee_member_ids?.includes(adminId)) state.notifications.push({ id: '10000000-0000-4000-8000-000000000001', kind: 'schedule_attendee', source_id: String(schedule.id), title: '관리자 참석 일정', body: '참석자로 지정되었습니다.', created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z', read_at: null });
            }
            return reply([]);
          }
          const sourceId = url.searchParams.get('id')?.replace('eq.', '');
          return reply(sourceId ? state.schedules.filter((item) => String(item.id) === sourceId) : state.schedules);
        }
        if (request.method() !== 'GET') throw new Error(`Unexpected write ${url.pathname}`);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
      return route.abort();
    });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => state.errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.clock.setFixedTime(new Date('2026-11-13T00:00:00Z'));
    await page.goto(baseUrl);
    await page.locator('[data-dashboard-root]').waitFor();
    return page;
  };
  const openDevices = async (page) => {
    await page.getByLabel('관리 메뉴', { exact: true }).click();
    await page.getByRole('button', { name: '승인 기기 관리', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '기기·팀원 관리' });
    await dialog.getByRole('heading', { name: '손관리 사내PC', exact: true }).waitFor();
    return dialog;
  };
  try {
    const regular = await createPage(normalUser, false);
    await regular.getByRole('button', { name: '일정 공유', exact: true }).click();
    await regular.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).click();
    const form = regular.locator('dialog[open]');
    await form.locator('input[name="title"]').fill('관리자 참석 일정');
    await form.locator('details').filter({ hasText: '추가 정보' }).locator('summary').click();
    await form.getByRole('combobox', { name: '참석 팀원', exact: true }).fill('@admin-pc');
    await form.getByRole('option', { name: /@admin-pc/ }).click();
    await form.locator('button[type="submit"]').click();
    await form.waitFor({ state: 'hidden' });
    assert.deepEqual(state.writes[0][0].attendee_member_ids, [adminId]);
    assert.deepEqual(state.writes[0][0].attendee_names, ['손관리']);

    const admin = await createPage(adminUser, true);
    await admin.getByRole('button', { name: /개인 알림, 읽지 않은 알림 1개/ }).click();
    const inbox = admin.getByRole('region', { name: '개인 알림', exact: true });
    await inbox.getByText('관리자 참석 일정', { exact: true }).waitFor();
    const markRead = admin.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/mark_my_notifications_read'));
    await inbox.getByRole('button', { name: '관리자 참석 일정 읽음으로 표시' }).click();
    await markRead;
    assert.ok(state.notifications[0].read_at);
    await inbox.getByRole('button', { name: '알림 닫기' }).click();

    const dialog = await openDevices(admin);
    const pc = dialog.locator('article').filter({ has: admin.getByRole('heading', { name: '손관리 사내PC', exact: true }) });
    const mobile = dialog.locator('article').filter({ has: admin.getByRole('heading', { name: '관리자 휴대폰', exact: true }) });
    const kiosk = dialog.locator('article').filter({ has: admin.getByRole('heading', { name: '전광판 전용', exact: true }) });
    await pc.getByRole('button', { name: '이름 수정', exact: true }).click();
    await pc.getByRole('textbox').fill('손수정');
    await pc.getByRole('button', { name: '이름 저장', exact: true }).click();
    await pc.getByRole('button', { name: '이름 수정', exact: true }).waitFor();
    assert.deepEqual(state.adminWrites[0], { rpc: 'rename', body: { p_member_id: adminId, p_display_name: '손수정' } });
    await mobile.getByRole('combobox').selectOption(adminId);
    const linkSaved = admin.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/admin_link_team_member_device'));
    await mobile.getByRole('button', { name: '연결 변경', exact: true }).click();
    await linkSaved;
    await mobile.getByRole('button', { name: '연결 변경', exact: true }).waitFor();
    await admin.waitForFunction(() => document.querySelectorAll('article select').length > 0);
    assert.deepEqual(state.adminWrites[1], { rpc: 'link', body: { p_user_id: mobileUser, p_member_id: adminId } });
    assert.equal(devices.find((device) => device.user_id === adminUser).is_admin, true);
    assert.equal(devices.find((device) => device.user_id === mobileUser).is_admin, true);
    assert.deepEqual(state.roleWrites, []);
    assert.equal(await pc.getByRole('button', { name: '관리자 해제', exact: true }).count(), 1);
    assert.equal(await kiosk.getByRole('combobox').count(), 0);
    const screenshot = path.join(os.tmpdir(), 'my-portal-admin-participant-management.png');
    await admin.screenshot({ path: screenshot }); screenshots.push(screenshot);
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();

    state.capable = false;
    await admin.reload();
    const legacy = await openDevices(admin);
    const legacyPc = legacy.locator('article').filter({ has: admin.getByRole('heading', { name: '손관리 사내PC', exact: true }) });
    assert.equal(await legacyPc.getByRole('button', { name: '이름 수정', exact: true }).count(), 0, 'legacy admin without a member mapping retains the old fallback');
    assert.equal(await legacyPc.getByRole('combobox').count(), 0);
    assert.equal(await legacyPc.getByRole('button', { name: '관리자 해제', exact: true }).count(), 1);
    assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['administrator UUID available to regular attendee picker', 'admin own in-app inbox and read state', 'admin profile name edit', 'admin device linking preserves role', 'kiosk exclusion', 'legacy unmapped admin fallback'], screenshots }, null, 2));
  } finally { for (const context of contexts) await context.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
