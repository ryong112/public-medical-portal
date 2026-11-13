/* eslint-disable @typescript-eslint/no-require-imports -- Local-only notice regressions. All auth, database, and external requests are mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEAM_CHAT_NOTICE_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const userId = '11111111-1111-4111-8111-111111111111';
const memberA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김공지', handle: 'notice-a' };
const memberB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '이확인', handle: 'notice-b' };
const members = [memberA, memberB];
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
const makeMessage = (id, content, member = memberA) => ({ id, content, sender_id: userId, sender_member_id: member.id, sender_display_name: member.display_name, mentioned_member_ids: [], created_at: '2026-11-13T01:00:00Z' });
const until = async (check, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(label);
};
const waitTurn = (page) => page.waitForTimeout(100);
const refresh = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [], errors = [], screenshots = [];
  const backend = {
    messages: [makeMessage(1, '금요일 팀회의 안내'), makeMessage(2, '월간 보고서 제출 안내', memberB), makeMessage(3, '긴 공지입니다. '.repeat(120) + '<img src=x onerror="window.__noticeHtmlRan=true">')],
    notice: null, prefs: new Map(), nextNotice: 1,
  };
  const noticeSnapshot = (state) => {
    if (!backend.notice) return { notice: null, collapsed: false, hidden: false };
    const message = backend.messages.find((row) => row.id === backend.notice.messageId);
    if (!message) return { notice: null, collapsed: false, hidden: false };
    const principal = state.currentMember?.id ?? userId;
    const pref = backend.prefs.get(`${principal}:${backend.notice.id}`) ?? { collapsed: false, hidden: false };
    return {
      notice: { id: backend.notice.id, message_id: message.id, content: message.content, author_name: backend.notice.authorName, created_at: backend.notice.createdAt, can_remove: state.admin || backend.notice.creator === principal },
      ...pref,
    };
  };
  const createPage = async ({ member = memberA, admin = false, capable = true } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    contexts.push(context);
    const state = { currentMember: member, admin, capable, reads: 0, publishes: [], preferences: [], removes: [], sent: [], unexpectedWrites: [], holdNextRead: false, heldRead: null, holdNextPreference: false, heldPreference: null, failNextPreference: false, failHeldPreference: false, confirmAnswers: [], confirmations: [] };
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: state.admin });
      if (url.pathname.endsWith('/list_team_members')) return reply(members);
      if (url.pathname.endsWith('/get_my_team_member')) return reply(state.currentMember);
      if (url.pathname.endsWith('/team_responsibility_available')) return reply(false);
      if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
      if (url.pathname.endsWith('/get_team_chat_notice_state')) {
        state.reads += 1;
        if (!state.capable) return reply({ code: 'PGRST202', message: 'Notice capability not installed' }, 404);
        const snapshot = structuredClone(noticeSnapshot(state));
        if (state.holdNextRead) {
          state.holdNextRead = false;
          await new Promise((resolve) => { state.heldRead = { snapshot, release: resolve }; });
        }
        return reply(snapshot);
      }
      if (url.pathname.endsWith('/publish_team_chat_notice')) {
        const body = request.postDataJSON();
        state.publishes.push(body);
        if (backend.notice?.messageId !== body.p_message_id) backend.notice = {
          id: `10000000-0000-4000-8000-${String(backend.nextNotice++).padStart(12, '0')}`,
          messageId: body.p_message_id, creator: state.currentMember?.id ?? userId,
          authorName: state.currentMember?.display_name ?? '관리자', createdAt: '2026-11-13T01:10:00Z',
        };
        return reply(backend.notice.id);
      }
      if (url.pathname.endsWith('/set_team_chat_notice_preference')) {
        const body = request.postDataJSON(), principal = state.currentMember?.id ?? userId;
        state.preferences.push({ principal, ...body });
        if (state.failNextPreference) { state.failNextPreference = false; return reply({ code: 'XX000', message: 'Mock preference save rejected' }, 503); }
        const failHeld = state.failHeldPreference;
        state.failHeldPreference = false;
        if (!failHeld) backend.prefs.set(`${principal}:${body.p_notice_id}`, { collapsed: body.p_collapsed, hidden: body.p_hidden });
        if (state.holdNextPreference) {
          state.holdNextPreference = false;
          await new Promise((resolve) => { state.heldPreference = { release: resolve }; });
        }
        if (failHeld) return reply({ code: 'XX000', message: 'Mock delayed old-identity preference failure' }, 503);
        return reply(null);
      }
      if (url.pathname.endsWith('/remove_team_chat_notice')) {
        const body = request.postDataJSON();
        state.removes.push(body);
        const principal = state.currentMember?.id ?? userId;
        if (!state.admin && backend.notice?.creator !== principal) return reply({ code: '42501', message: 'Not the notice author' }, 403);
        if (backend.notice?.id === body.p_notice_id) backend.notice = null;
        return reply(null);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (url.pathname.endsWith('/messages')) {
          if (request.method() === 'POST') {
            const payload = request.postDataJSON(); state.sent.push(payload);
            const row = { ...makeMessage(100 + state.sent.length, payload.content, state.currentMember ?? memberA), ...payload };
            backend.messages.push(row); return reply([row]);
          }
          if (request.method() === 'GET') return reply(backend.messages);
        }
        if (request.method() !== 'GET') { state.unexpectedWrites.push({ path: url.pathname, method: request.method() }); return reply({ message: 'Unexpected external mutation blocked' }, 403); }
        if (url.pathname.endsWith('/categories')) return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (url.origin === new URL(baseUrl).origin) return route.continue();
      return route.abort();
    });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => { state.confirmations.push(dialog.message()); if (state.confirmAnswers.shift() === false) await dialog.dismiss(); else await dialog.accept(); });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '정보공유방', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '정보공유방', exact: true });
    await panel.waitFor();
    return { page, context, state, panel };
  };
  const card = (panel) => panel.locator('[data-chat-notice]');
  const stateIs = async (panel, value) => {
    await panel.locator(`[data-chat-notice][data-chat-notice-state="${value}"]`).waitFor();
  };
  const capture = async (page, name) => {
    const destination = path.join(os.tmpdir(), `my-portal-chat-notice-${name}.png`);
    const style = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    try { await page.screenshot({ path: destination }); screenshots.push(destination); } finally { await style.evaluate((element) => element.remove()); }
  };
  let currentPage;
  try {
    const first = await createPage(); currentPage = first.page;
    const { page, state, panel } = first;
    await panel.locator('[data-team-message-id="1"]').getByRole('button', { name: '김공지의 메시지 공지로 등록', exact: true }).waitFor();
    assert.equal(await card(panel).count(), 0, 'a room without a shared notice has no fixed notice area');
    await panel.locator('[data-team-message-id="1"]').getByRole('button', { name: '김공지의 메시지 공지로 등록', exact: true }).click();
    await stateIs(panel, 'expanded');
    assert.equal(state.publishes.length, 1);
    assert.equal(state.publishes[0].p_message_id, 1);
    assert.equal(await card(panel).getByText('금요일 팀회의 안내', { exact: true }).count(), 1);
    const layout = await panel.evaluate((element) => {
      const header = element.querySelector('[data-chat-drag-handle]').getBoundingClientRect(), notice = element.querySelector('[data-chat-notice]').getBoundingClientRect(), log = element.querySelector('[role="log"]').getBoundingClientRect();
      return { headerBottom: header.bottom, noticeTop: notice.top, noticeBottom: notice.bottom, logTop: log.top };
    });
    assert.ok(layout.noticeTop >= layout.headerBottom - 1 && layout.noticeBottom <= layout.logTop + 1, JSON.stringify(layout));
    await card(panel).getByRole('button', { name: '공지 원문 보기', exact: true }).click();
    assert.equal(await panel.locator('[data-team-message-id="1"]').getAttribute('data-chat-notice-source'), 'true');
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await stateIs(panel, 'collapsed');
    await panel.getByRole('button', { name: '정보공유방 닫기', exact: true }).click();
    await page.getByRole('button', { name: '정보공유방', exact: true }).click();
    await stateIs(panel, 'collapsed');
    await card(panel).getByRole('button', { name: '내 화면에서 공지 숨기기', exact: true }).click();
    await stateIs(panel, 'hidden');
    assert.ok(backend.notice, 'personal hiding cannot remove the shared notice');

    const second = await createPage({ member: memberB });
    await stateIs(second.panel, 'expanded');
    assert.equal(await second.panel.getByRole('button', { name: '전체 공지 종료', exact: true }).count(), 0, 'non-author ordinary members cannot remove the shared notice');
    const linked = await createPage({ member: memberA });
    await stateIs(linked.panel, 'hidden');
    await linked.context.close();
    await card(panel).getByRole('button', { name: '공지 다시 보기', exact: true }).click();
    await stateIs(panel, 'collapsed');
    await card(panel).getByRole('button', { name: '공지 펼치기', exact: true }).click();
    await stateIs(panel, 'expanded');

    state.failNextPreference = true;
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    await stateIs(panel, 'expanded');
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await stateIs(panel, 'collapsed');

    const previousNoticeId = backend.notice.id, publishCount = state.publishes.length;
    state.confirmAnswers.push(false);
    await panel.locator('[data-team-message-id="2"]').getByRole('button', { name: '이확인의 메시지 공지로 등록', exact: true }).click();
    assert.equal(state.publishes.length, publishCount, 'cancelling room-wide replacement performs no mutation');
    assert.equal(backend.notice.id, previousNoticeId);
    await panel.locator('[data-team-message-id="2"]').getByRole('button', { name: '이확인의 메시지 공지로 등록', exact: true }).click();
    await stateIs(panel, 'expanded');
    await card(panel).getByText('월간 보고서 제출 안내', { exact: true }).waitFor();
    assert.notEqual(backend.notice.id, previousNoticeId, 'a replacement receives its own per-ID preference scope');
    assert.ok(state.confirmations.some((message) => /공지/.test(message)));
    await refresh(second.page); await waitTurn(second.page);
    await card(second.panel).getByText('월간 보고서 제출 안내', { exact: true }).waitFor();

    // An old pre-mutation read must never revert a successful personal preference.
    state.holdNextRead = true;
    await refresh(page);
    await until(() => state.heldRead, 'Expected held notice polling response');
    const staleRead = state.heldRead;
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await stateIs(panel, 'collapsed');
    staleRead.release(); state.heldRead = null;
    await waitTurn(page);
    await stateIs(panel, 'collapsed');

    // A late result for A cannot leak A's collapsed preference into B's identity.
    state.holdNextRead = true;
    await refresh(page);
    await until(() => state.heldRead, 'Expected held read for the previous identity');
    const oldIdentityRead = state.heldRead;
    assert.equal(oldIdentityRead.snapshot.collapsed, true);
    await waitTurn(page);
    state.currentMember = memberB;
    await refresh(page);
    await stateIs(panel, 'expanded');
    oldIdentityRead.release(); state.heldRead = null;
    await waitTurn(page);
    await stateIs(panel, 'expanded');
    assert.equal(await panel.getByRole('button', { name: '전체 공지 종료', exact: true }).count(), 0);
    state.holdNextPreference = true;
    await card(panel).getByRole('button', { name: '내 화면에서 공지 숨기기', exact: true }).click();
    await until(() => state.heldPreference, 'Expected held B preference save');
    const staleSave = state.heldPreference;
    state.currentMember = memberA;
    await refresh(page); await waitTurn(page);
    await stateIs(panel, 'collapsed');
    staleSave.release(); state.heldPreference = null;
    await waitTurn(page);
    await stateIs(panel, 'collapsed');
    await card(panel).getByRole('button', { name: '공지 펼치기', exact: true }).click();
    await card(panel).getByRole('button', { name: '전체 공지 종료', exact: true }).waitFor();

    // An old human's delayed failure cannot leave error text or a disabled action in the new ID.
    state.holdNextPreference = true;
    state.failHeldPreference = true;
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await until(() => state.heldPreference, 'Expected delayed failing A preference request');
    const oldFailingSave = state.heldPreference;
    state.currentMember = memberB;
    await refresh(page);
    await stateIs(panel, 'hidden');
    assert.equal(await card(panel).getByRole('button', { name: '공지 다시 보기', exact: true }).isEnabled(), true, 'new ID actions must not retain the old pending lock');
    oldFailingSave.release(); state.heldPreference = null;
    await waitTurn(page);
    await stateIs(panel, 'hidden');
    assert.equal(await panel.getByRole('alert').count(), 0, 'old ID failure must not appear in the new ID notice');
    assert.equal(await card(panel).getByRole('button', { name: '공지 다시 보기', exact: true }).isEnabled(), true);
    state.currentMember = memberA;
    await refresh(page);
    await stateIs(panel, 'expanded');

    // A long expanded notice may scroll internally, not push the composer outside a small chat.
    await panel.locator('[data-team-message-id="3"]').getByRole('button', { name: '김공지의 메시지 공지로 등록', exact: true }).click();
    await stateIs(panel, 'expanded');
    assert.equal(await card(panel).locator('img,script').count(), 0, 'notice body must stay safe React text');
    const grip = panel.locator('[data-chat-resize-handle]');
    await grip.focus();
    for (let index = 0; index < 12; index += 1) await page.keyboard.press('Shift+ArrowUp');
    const small = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect(), form = element.querySelector('form').getBoundingClientRect();
      return { height: bounds.height, bottom: bounds.bottom, formTop: form.top, formBottom: form.bottom };
    });
    assert.ok(small.formTop >= 0 && small.formBottom <= small.bottom + 1, JSON.stringify(small));
    await page.setViewportSize({ width: 320, height: 640 }); await waitTurn(page);
    const mobile = await panel.evaluate((element) => {
      const bounds = element.getBoundingClientRect(), form = element.querySelector('form').getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, bottom: bounds.bottom, formTop: form.top, formBottom: form.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    assert.ok(mobile.left >= -1 && mobile.right <= 321 && mobile.formTop >= 0 && mobile.formBottom <= mobile.bottom + 1 && mobile.scrollWidth <= mobile.width, JSON.stringify(mobile));
    await capture(page, 'mobile-320');
    await card(panel).getByRole('button', { name: '공지 접기', exact: true }).click();
    await stateIs(panel, 'collapsed');
    const input = panel.getByRole('textbox', { name: '공유방 메시지 작성' });
    await input.fill('@');
    await panel.getByRole('listbox', { name: '멘션할 팀원' }).waitFor();
    await input.press('Escape');
    await input.fill('공지와 함께 채팅 전송 확인');
    await panel.getByRole('button', { name: '메시지 전송', exact: true }).click();
    await until(() => state.sent.length === 1, 'Expected normal message send with notice present');
    await page.setViewportSize({ width: 1440, height: 900 }); await waitTurn(page);
    await panel.getByRole('button', { name: '채팅창 위치와 크기 초기화', exact: true }).click();
    await capture(page, 'desktop');

    // Deleting the source message removes the notice on refresh without fabricating a copy.
    backend.messages = backend.messages.filter((message) => message.id !== 3);
    await refresh(page); await waitTurn(page);
    await card(panel).waitFor({ state: 'detached' });
    await panel.locator('[data-team-message-id="1"]').getByRole('button', { name: '김공지의 메시지 공지로 등록', exact: true }).click();
    await stateIs(panel, 'expanded');
    state.confirmAnswers.push(false);
    const removeCount = state.removes.length;
    await card(panel).getByRole('button', { name: '전체 공지 종료', exact: true }).click();
    assert.equal(state.removes.length, removeCount);
    await card(panel).getByRole('button', { name: '전체 공지 종료', exact: true }).click();
    await card(panel).waitFor({ state: 'detached' });
    assert.equal(backend.notice, null);

    const legacy = await createPage({ capable: false });
    await until(() => legacy.state.reads > 0, 'Expected missing-schema capability check');
    assert.equal(await legacy.panel.getByRole('button', { name: /메시지 공지로 등록/ }).count(), 0, 'missing SQL must not break the old chat or show unusable actions');
    await legacy.panel.getByRole('textbox', { name: '공유방 메시지 작성' }).fill('기존 공유방 입력 유지');
    assert.ok(state.preferences.every(({ principal, ...args }) => { void principal; return Object.keys(args).sort().join(',') === 'p_collapsed,p_hidden,p_notice_id'; }), 'preference requests never send another member or auth identity');
    for (const entry of [first, second, legacy]) assert.deepEqual(entry.state.unexpectedWrites, []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['message selection publishes one fixed room notice', 'collapse, hide and restore are personal and persistent', 'linked member profiles share preferences, different IDs do not', 'non-author cannot remove shared notice', 'failed preference save retains prior state', 'replacement cancellation has zero writes and new notice resets old preference', 'late polling cannot revert a successful preference', 'identity switches clear old preferences and ignore late save/list responses', 'old-ID delayed failure cannot leak local error or pending lock into the new ID', 'long notice and composer fit resized desktop and 320px mobile', 'mentions and normal send remain usable', 'deleted source removes notice without copying content', 'shared removal confirmation and old-schema fallback'], noticePublishes: state.publishes.length, preferenceWrites: state.preferences.length, screenshots }, null, 2));
  } catch (error) {
    console.error('Browser errors:', errors);
    if (currentPage) { console.error((await currentPage.locator('body').innerText()).slice(-5000)); await capture(currentPage, 'failure').catch(() => {}); }
    throw error;
  } finally { await Promise.all(contexts.map((context) => context.close().catch(() => {}))); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
