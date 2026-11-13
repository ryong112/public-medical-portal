/* eslint-disable @typescript-eslint/no-require-imports -- Local-only browser regressions with all remote traffic mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEAM_CHAT_WINDOW_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const userId = '11111111-1111-4111-8111-111111111111';
const memberId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
const makeMessage = (id, content, own = false) => ({ id, content, sender_id: own ? userId : '22222222-2222-4222-8222-222222222222', sender_member_id: own ? memberId : null, sender_display_name: own ? '테스트 팀원' : '다른 팀원', mentioned_member_ids: [], created_at: `2026-11-13T01:${String(id).padStart(2, '0')}:00Z` });
const until = async (check, label) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(label);
};
const bounds = (locator) => locator.evaluate((element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; });
const closeEnough = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 2, `${label}: ${actual} vs ${expected}`);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const state = { messages: [makeMessage(1, '이전 안내 메시지')], posts: [], errors: [], nextId: 10, holdNextList: true, heldList: null, chat: null, unexpectedWrites: [], wsEventsSent: 0 };
  const screenshots = [];
  let releaseInitial;
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.endsWith('/list_team_members')) return reply([{ id: memberId, display_name: '테스트 팀원', handle: 'test-member' }]);
    if (url.pathname.endsWith('/get_my_team_member')) return reply({ id: memberId, display_name: '테스트 팀원', handle: 'test-member' });
    if (url.pathname.endsWith('/team_responsibility_available')) return reply(false);
    if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.endsWith('/messages')) {
        if (request.method() === 'POST') {
          const raw = request.postDataJSON(), payload = Array.isArray(raw) ? raw[0] : raw;
          state.posts.push(payload);
          const record = { ...makeMessage(state.nextId++, payload.content, true), ...payload };
          state.messages.push(record);
          return reply([record]);
        }
        if (request.method() === 'GET') {
          const snapshot = structuredClone(state.messages);
          if (state.holdNextList) {
            state.holdNextList = false;
            await new Promise((resolve) => { releaseInitial = resolve; state.heldList = snapshot; });
          }
          return reply(snapshot);
        }
      }
      if (request.method() !== 'GET') { state.unexpectedWrites.push({ path: url.pathname, method: request.method() }); return reply({ message: 'Unexpected write blocked in local test' }, 403); }
      if (url.pathname.endsWith('/categories')) return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (url.origin === new URL(baseUrl).origin) return route.continue();
    return route.abort();
  });
  // Supabase Realtime protocol v2 is exercised, not bypassed via application globals.
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => {
    socket.onMessage((raw) => {
      let message;
      try { message = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
      const [joinRef, ref, topic, event, payload] = message;
      if (event === 'phx_join') {
        const filters = (payload.config?.postgres_changes ?? []).map((filter, index) => ({ ...filter, id: index + 1 }));
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: filters } }]));
        if (topic === 'realtime:chat_main') state.chat = { socket, topic, joinRef, filters };
      } else if (event === 'heartbeat' || event === 'phx_leave') socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  const emit = (record, type = 'INSERT') => {
    assert.ok(state.chat, 'the mocked chat channel must be joined');
    const { socket, topic, joinRef, filters } = state.chat;
    const ids = filters.filter((filter) => filter.event === '*' || filter.event === type).map((filter) => filter.id);
    socket.send(JSON.stringify([joinRef, null, topic, 'postgres_changes', { ids, data: { schema: 'public', table: 'messages', type, commit_timestamp: '2026-11-13T01:00:00Z', errors: null, columns: [
      { name: 'id', type: 'int8' }, { name: 'content', type: 'text' }, { name: 'sender_id', type: 'text' }, { name: 'created_at', type: 'timestamptz' }, { name: 'sender_member_id', type: 'uuid' }, { name: 'sender_display_name', type: 'text' }, { name: 'mentioned_member_ids', type: '_uuid' },
    ], record: type === 'DELETE' ? {} : record, old_record: type === 'DELETE' ? { id: record.id } : {} } }]));
    state.wsEventsSent += 1;
  };
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => state.errors.push(error.message));
  const capture = async (name) => {
    const destination = path.join(os.tmpdir(), `my-portal-chat-window-${name}.png`);
    const style = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    try { await page.screenshot({ path: destination }); screenshots.push(destination); }
    finally { await style.evaluate((element) => element.remove()); }
  };
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await until(() => state.heldList && state.chat, 'Expected initial message snapshot and joined Realtime channel');
    await page.getByRole('button', { name: '정보공유방', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '정보공유방', exact: true });
    const liveDuringFetch = makeMessage(2, '목록 조회 중 도착한 메시지');
    state.messages.push(liveDuringFetch);
    emit(liveDuringFetch);
    await panel.locator('[data-team-message-id="2"]').waitFor();
    releaseInitial();
    await panel.locator('[data-team-message-id="1"]').waitFor();
    assert.equal(await panel.locator('[data-team-message-id="2"]').count(), 1, 'an older initial snapshot must not erase a newly received message');

    const input = panel.getByRole('textbox', { name: '공유방 메시지 작성' });
    await input.fill('중복 표시 검증');
    await panel.getByRole('button', { name: '메시지 전송', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="공유방 메시지 작성"]')?.value === '');
    const sent = state.messages.find((item) => item.content === '중복 표시 검증');
    await panel.locator(`[data-team-message-id="${sent.id}"]`).waitFor();
    emit(sent); emit(sent);
    const deliveryMarker = makeMessage(9, '실시간 이벤트 처리 확인');
    state.messages.push(deliveryMarker); emit(deliveryMarker);
    await panel.locator('[data-team-message-id="9"]').waitFor();
    assert.equal(state.posts.length, 1, 'one send must insert only once');
    assert.equal(await panel.locator(`[data-team-message-id="${sent.id}"]`).count(), 1, 'REST plus repeated Realtime delivery must render the same ID only once');
    const sameTextDifferentId = makeMessage(20, sent.content, true);
    state.messages.push(sameTextDifferentId); emit(sameTextDifferentId);
    await panel.locator('[data-team-message-id="20"]').waitFor();
    assert.equal(await panel.getByText('중복 표시 검증', { exact: true }).count(), 2, 'different IDs with equal content are legitimate separate messages');

    state.heldList = null; state.holdNextList = true;
    await input.fill('조회 경합 중 보존 확인');
    await panel.getByRole('button', { name: '메시지 전송', exact: true }).click();
    await until(() => state.heldList, 'Expected held post-send REST snapshot');
    state.messages = state.messages.filter((record) => record.id !== sameTextDifferentId.id);
    emit(sameTextDifferentId, 'DELETE');
    const updatedDuringRefresh = { ...liveDuringFetch, content: '실시간으로 수정된 메시지' };
    Object.assign(state.messages.find((record) => record.id === liveDuringFetch.id), updatedDuringRefresh);
    emit(updatedDuringRefresh, 'UPDATE');
    const duringRefresh = makeMessage(21, '후속 목록 조회 중 도착한 메시지');
    state.messages.push(duringRefresh); emit(duringRefresh);
    await panel.locator('[data-team-message-id="21"]').waitFor();
    await panel.locator('[data-team-message-id="20"]').waitFor({ state: 'detached' });
    releaseInitial();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="공유방 메시지 작성"]')?.value === '');
    assert.equal(await panel.locator('[data-team-message-id="20"]').count(), 0, 'an older REST result must not resurrect a deleted message');
    assert.equal(await panel.locator('[data-team-message-id="21"]').count(), 1, 'an event arriving during a later refresh must remain present');
    await panel.locator('[data-team-message-id="2"]').getByText('실시간으로 수정된 메시지', { exact: true }).waitFor();

    const header = panel.locator('[data-chat-drag-handle]');
    const resize = panel.locator('[data-chat-resize-handle]');
    await header.waitFor(); await resize.waitFor();
    assert.equal(await panel.getAttribute('data-chat-desktop'), 'true');
    const colors = await panel.evaluate((element) => {
      const header = element.querySelector('[data-chat-drag-handle]'), log = element.querySelector('[role="log"]'), form = element.querySelector('form');
      return { header: getComputedStyle(header).backgroundColor, log: getComputedStyle(log).backgroundColor, input: getComputedStyle(form).backgroundColor };
    });
    assert.notEqual(colors.header, colors.log, 'header and conversation backdrop must be visually distinct');
    assert.notEqual(colors.log, colors.input, 'conversation and composer need separate surfaces');
    const original = await bounds(panel), head = await bounds(header);
    await page.mouse.move(head.x + 110, head.y + 24); await page.mouse.down();
    await page.mouse.move(head.x - 290, head.y - 136, { steps: 8 }); await page.mouse.up();
    const moved = await bounds(panel);
    assert.ok(moved.x < original.x - 300 && moved.y < original.y - 100, JSON.stringify({ original, moved }));
    const grip = await bounds(resize);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + grip.height / 2 + 60, { steps: 8 }); await page.mouse.up();
    const resized = await bounds(panel);
    assert.ok(resized.width > moved.width + 90 && resized.height > moved.height + 30, JSON.stringify({ moved, resized }));
    await resize.focus(); await page.keyboard.press('ArrowRight');
    assert.ok((await bounds(panel)).width > resized.width, 'resize handle keyboard arrows are supported');
    const persisted = await bounds(panel);
    await panel.getByRole('button', { name: '정보공유방 닫기', exact: true }).click();
    await page.getByRole('button', { name: '정보공유방', exact: true }).click();
    const reopened = await bounds(panel);
    closeEnough(reopened.x, persisted.x, 'reopened x'); closeEnough(reopened.width, persisted.width, 'reopened width');
    await capture('desktop');
    await page.setViewportSize({ width: 900, height: 650 });
    await page.waitForTimeout(80);
    const clamped = await bounds(panel);
    assert.ok(clamped.x >= 0 && clamped.y >= 0 && clamped.right <= 901 && clamped.bottom <= 651, JSON.stringify(clamped));
    await panel.getByRole('button', { name: '채팅창 위치와 크기 초기화', exact: true }).click();
    const reset = await bounds(panel);
    assert.ok(reset.width <= 421 && reset.right <= 900 && reset.bottom <= 650, JSON.stringify(reset));
    const beforeInput = await bounds(panel);
    await input.fill('입력창 조작은 창을 이동하지 않습니다.');
    const afterInput = await bounds(panel);
    closeEnough(afterInput.x, beforeInput.x, 'typing does not drag x'); closeEnough(afterInput.y, beforeInput.y, 'typing does not drag y');

    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(80);
    assert.equal(await panel.getAttribute('data-chat-desktop'), 'false');
    const mobile = await bounds(panel);
    assert.ok(mobile.x >= -1 && mobile.right <= 321 && mobile.y >= 0 && mobile.bottom <= 641, JSON.stringify(mobile));
    assert.equal(await resize.isVisible(), false, 'small mobile screens must use the fixed bottom sheet, not a resize handle');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await input.fill('@');
    await panel.getByRole('listbox', { name: '멘션할 팀원' }).waitFor();
    const mentionBounds = await bounds(panel.getByRole('listbox', { name: '멘션할 팀원' }));
    assert.ok(mentionBounds.x >= 0 && mentionBounds.right <= 320, JSON.stringify(mentionBounds));
    await capture('mobile-320');
    assert.deepEqual(state.unexpectedWrites, []);
    assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['real Phoenix Realtime INSERT survives an older REST snapshot', 'one POST plus repeated same-ID Realtime emits only one message', 'different IDs with equal content remain separate', 'new INSERT, UPDATE and DELETE survive a concurrent post-send REST refresh', 'contrasting header, transcript and composer', 'header pointer drag', 'pointer and keyboard resize', 'reopening retains geometry', 'viewport shrink clamps panel', 'reset and input interactions', '320px fixed mobile sheet and mention list'], wsEventsSent: state.wsEventsSent, screenshots }, null, 2));
  } catch (error) {
    if (releaseInitial) releaseInitial();
    console.error('Browser errors:', state.errors);
    console.error((await page.locator('body').innerText()).slice(-3500));
    await capture('failure').catch(() => {});
    throw error;
  } finally { await context.close(); await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
