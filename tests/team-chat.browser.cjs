/* eslint-disable @typescript-eslint/no-require-imports -- Optional browser regression with local-only and mocked remote traffic. */
// Start the development server first; PLAYWRIGHT_MODULE can point to an existing Playwright install.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEAM_CHAT_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const userId = '11111111-1111-4111-8111-111111111111';
const mobileUserId = '22222222-2222-4222-8222-222222222222';
const kioskUserId = '33333333-3333-4333-8333-333333333333';
const adminUserId = '44444444-4444-4444-8444-444444444444';
const member1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const member2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const initialMessages = [
  { id: 1, content: '기존 메시지 원문 @김팀원 <img src=x onerror="window.__chatHtmlRan=true">', sender_id: 'old-anonymous-id', created_at: '2026-11-10T01:00:00Z' },
  { id: 2, content: '@김팀원_2222 확인 부탁드립니다.', sender_id: mobileUserId, sender_member_id: member2, sender_display_name: '작성 당시 이름', mentioned_member_ids: [member2], created_at: '2026-11-11T02:00:00Z' },
];

const buildContext = async (browser, isAdmin) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul' });
  const activeUserId = isAdmin ? adminUserId : userId;
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: activeUserId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  const members = [
    { id: member1, display_name: '김팀원', handle: '김팀원' },
    { id: member2, display_name: '김팀원', handle: '김팀원_2222' },
  ];
  const memberDevices = [
    { user_id: userId, member_id: member1, is_kiosk: false },
    { user_id: mobileUserId, member_id: member2, is_kiosk: false },
    { user_id: kioskUserId, member_id: member1, is_kiosk: true },
    { user_id: adminUserId, member_id: null, is_kiosk: false },
  ];
  const devices = [
    { user_id: userId, device_name: '김팀원 PC', status: 'approved', is_admin: false },
    { user_id: mobileUserId, device_name: '김팀원 휴대폰', status: 'approved', is_admin: false },
    { user_id: kioskUserId, device_name: '공용 전광판', status: 'approved', is_admin: false },
    { user_id: adminUserId, device_name: '관리자 PC', status: 'approved', is_admin: true },
  ].map((device) => ({ ...device, requested_at: '2026-11-01T00:00:00Z', approved_at: '2026-11-01T00:00:00Z', last_seen_at: '2026-11-13T00:00:00Z' }));
  const state = { posts: [], adminWrites: [], messages: structuredClone(initialMessages), failNextSend: !isAdmin, releaseFirstSend: null, failNextRename: false, errors: [] };
  await context.addInitScript(() => {
    window.__notificationPermissionRequests = 0;
    if ('Notification' in window) Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: () => { window.__notificationPermissionRequests += 1; return Promise.resolve('denied'); } });
  });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: activeUserId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: activeUserId, is_admin: isAdmin });
    if (url.pathname.endsWith('/list_team_members')) return reply(members);
    if (url.pathname.endsWith('/get_my_team_member')) return reply(isAdmin ? null : members[0]);
    if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
    if (url.pathname.endsWith('/mark_my_notifications_read')) return reply(null);
    if (url.pathname.endsWith('/list_device_access')) return reply(devices);
    if (url.pathname.endsWith('/list_team_member_devices')) return reply(memberDevices);
    if (url.pathname.endsWith('/admin_link_team_member_device')) {
      const payload = request.postDataJSON();
      state.adminWrites.push({ kind: 'link', payload });
      assert.ok(isAdmin);
      Object.assign(memberDevices.find((mapping) => mapping.user_id === payload.p_user_id), { member_id: payload.p_member_id });
      return reply(null);
    }
    if (url.pathname.endsWith('/admin_set_team_member_name')) {
      const payload = request.postDataJSON();
      state.adminWrites.push({ kind: 'rename', payload });
      assert.ok(isAdmin);
      if (state.failNextRename) { state.failNextRename = false; return reply({ code: '42501', message: 'mock rename rejected' }, 403); }
      members.find((member) => member.id === payload.p_member_id).display_name = payload.p_display_name;
      return reply(null);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.endsWith('/messages')) {
        if (request.method() === 'POST') {
          const raw = request.postDataJSON();
          const payload = Array.isArray(raw) ? raw[0] : raw;
          state.posts.push(payload);
          if (state.failNextSend) {
            state.failNextSend = false;
            await new Promise((resolve) => { state.releaseFirstSend = resolve; });
            return reply({ code: 'XX000', message: 'mock send failure' }, 503);
          }
          const message = { id: state.messages.length + 1, ...payload, sender_member_id: isAdmin ? null : member1, sender_display_name: isAdmin ? '관리자' : members[0].display_name, created_at: '2026-11-13T00:00:00Z' };
          state.messages.push(message);
          return reply([message]);
        }
        return reply(state.messages);
      }
      if (url.pathname.endsWith('/categories')) return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
      if (url.pathname.endsWith('/schedules') || url.pathname.endsWith('/files')) return reply([]);
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => state.errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '정보공유방', exact: true }).click();
  await page.getByRole('dialog', { name: '정보공유방', exact: true }).waitFor();
  return { context, page, state };
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const screenshots = [];
  const screenshot = async (page, name) => {
    const file = path.join(os.tmpdir(), `my-portal-team-chat-${name}.png`);
    const style = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    try { await page.screenshot({ path: file }); screenshots.push(file); }
    finally { await style.evaluate((element) => element.remove()); }
  };
  try {
    const normal = await buildContext(browser, false);
    const { page, state } = normal;
    const panel = page.getByRole('dialog', { name: '정보공유방', exact: true });
    const input = panel.getByRole('textbox', { name: '공유방 메시지 작성' });
    const send = panel.getByRole('button', { name: '메시지 전송', exact: true });
    assert.equal(await panel.locator('[data-team-message-id]').count(), initialMessages.length);
    assert.equal(await panel.locator('[data-team-message-id="1"]').getByText(initialMessages[0].content, { exact: true }).count(), 1);
    assert.equal(await panel.locator('img, script').count(), 0, 'message content must remain React text, never executable HTML');
    assert.equal(await panel.getByText('작성 당시 이름', { exact: true }).count(), 1);
    assert.ok(await panel.getByText(/2026년 11월 10일/).count());
    assert.ok(await panel.getByText(/2026년 11월 11일/).count());
    await screenshot(page, 'desktop');
    await input.fill('@');
    await panel.getByRole('listbox', { name: '멘션할 팀원' }).waitFor();
    assert.equal(await panel.getByRole('option').count(), 2, 'same display names still have two independently selectable UUIDs');
    await input.press('ArrowDown');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '@김팀원_2222 ');
    await input.fill('@김팀원_2222 일정 확인 부탁드립니다.');
    await send.click();
    await panel.getByRole('button', { name: '메시지 전송 중', exact: true }).waitFor();
    assert.equal(await input.getAttribute('readonly'), '');
    await input.press('Enter');
    assert.equal(state.posts.length, 1, 'a second Enter while sending cannot insert a duplicate');
    assert.ok(state.releaseFirstSend);
    state.releaseFirstSend();
    await panel.getByRole('alert').waitFor();
    assert.equal(await input.inputValue(), '@김팀원_2222 일정 확인 부탁드립니다.', 'failed transmission must keep the draft');
    assert.deepEqual(state.posts[0].mentioned_member_ids, [member2]);
    await send.click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="공유방 메시지 작성"]')?.value === '');
    assert.deepEqual(state.posts[1].mentioned_member_ids, [member2], 'retry must keep the same selected UUID');
    assert.equal(state.messages[0].content, initialMessages[0].content, 'old content must not be rewritten');
    await input.fill('@unknown 임의 입력은 알림을 보내지 않습니다.');
    await send.click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="공유방 메시지 작성"]')?.value === '');
    assert.deepEqual(state.posts[2].mentioned_member_ids, []);
    await input.fill('@');
    await input.press('Escape');
    assert.equal(await panel.getByRole('listbox').count(), 0);
    assert.ok(await panel.isVisible(), 'first Escape dismisses the picker without closing the chat');
    await page.setViewportSize({ width: 320, height: 640 });
    await input.fill('');
    await input.fill('@');
    await panel.getByRole('listbox').waitFor();
    const geometry = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const picker = element.querySelector('[role="listbox"]').getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: element.clientWidth, scrollWidth: element.scrollWidth, pickerLeft: picker.left, pickerRight: picker.right, viewport: innerWidth };
    });
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, JSON.stringify(geometry));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
    assert.ok(geometry.pickerLeft >= 0 && geometry.pickerRight <= 320, JSON.stringify(geometry));
    await screenshot(page, 'mobile-320');
    assert.equal(await page.evaluate(() => window.__notificationPermissionRequests), 0, 'site-only notifications must not ask for OS/browser permission');
    assert.deepEqual(state.errors, []);
    await normal.context.close();

    const admin = await buildContext(browser, true);
    const adminPanel = admin.page.getByRole('dialog', { name: '정보공유방', exact: true });
    const adminInput = adminPanel.getByRole('textbox', { name: '공유방 메시지 작성' });
    await adminInput.fill('@');
    await adminPanel.getByRole('option').filter({ hasText: '@김팀원_2222' }).click();
    await adminPanel.getByRole('button', { name: '메시지 전송', exact: true }).click();
    await admin.page.waitForFunction(() => document.querySelector('textarea[aria-label="공유방 메시지 작성"]')?.value === '');
    assert.deepEqual(admin.state.posts[0].mentioned_member_ids, [member2], 'admins without their own member profile can mention a team member');
    await adminPanel.getByRole('button', { name: '정보공유방 닫기' }).click();
    await admin.page.getByLabel('관리 메뉴', { exact: true }).click();
    await admin.page.getByRole('button', { name: '승인 기기 관리', exact: true }).click();
    const deviceDialog = admin.page.getByRole('dialog', { name: '기기·팀원 관리' });
    const pc = deviceDialog.locator('article').filter({ has: admin.page.getByRole('heading', { name: '김팀원 PC', exact: true }) });
    const mobile = deviceDialog.locator('article').filter({ has: admin.page.getByRole('heading', { name: '김팀원 휴대폰', exact: true }) });
    const kiosk = deviceDialog.locator('article').filter({ has: admin.page.getByRole('heading', { name: '공용 전광판', exact: true }) });
    await pc.getByRole('button', { name: '이름 수정', exact: true }).waitFor();
    assert.equal(await kiosk.getByRole('combobox').count(), 0);
    assert.equal(await kiosk.getByRole('button', { name: '이름 수정', exact: true }).count(), 0);
    assert.equal(await kiosk.getByText('전광판 · 자동 연결', { exact: true }).count(), 1);
    await pc.getByRole('button', { name: '이름 수정', exact: true }).click();
    await pc.getByRole('textbox').fill('김연결');
    await pc.getByRole('button', { name: '이름 저장', exact: true }).click();
    await pc.getByRole('button', { name: '이름 수정', exact: true }).waitFor();
    assert.deepEqual(admin.state.adminWrites[0], { kind: 'rename', payload: { p_member_id: member1, p_display_name: '김연결' } });
    await mobile.getByRole('combobox').selectOption(member1);
    const confirmations = [];
    admin.page.once('dialog', async (dialog) => { confirmations.push(dialog.message()); await dialog.accept(); });
    const linkedReload = admin.page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/list_team_member_devices'));
    await mobile.getByRole('button', { name: '연결 변경', exact: true }).click();
    await linkedReload;
    assert.equal(confirmations.length, 1);
    assert.match(confirmations[0], /같은 사람/);
    assert.match(confirmations[0], /기록은 이동하지 않습니다/);
    assert.deepEqual(admin.state.adminWrites[1], { kind: 'link', payload: { p_user_id: mobileUserId, p_member_id: member1 } });
    admin.state.failNextRename = true;
    await pc.getByRole('button', { name: '이름 수정', exact: true }).click();
    await pc.getByRole('textbox').fill('다시 시도할 이름');
    await pc.getByRole('button', { name: '이름 저장', exact: true }).click();
    await deviceDialog.getByRole('alert').waitFor();
    assert.equal(await pc.getByRole('textbox').inputValue(), '다시 시도할 이름');
    await screenshot(admin.page, 'device-management');
    assert.equal(await admin.page.evaluate(() => window.__notificationPermissionRequests), 0);
    assert.deepEqual(admin.state.errors, []);
    await admin.context.close();
    console.log('Team chat browser checks passed: legacy content, authors/dates, safe text, UUID mentions, retry draft, keyboard, mobile 320, admin mentions, device linking and rename.');
    console.log(JSON.stringify({ screenshots }));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
