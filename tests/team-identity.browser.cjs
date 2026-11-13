/* eslint-disable @typescript-eslint/no-require-imports -- Optional local Playwright regression. Every remote request is intercepted; no external writes. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.TEAM_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Only a local application may be tested');

const userId = '11111111-1111-4111-8111-111111111111';
const memberA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김민수', handle: 'minsu-a' };
const memberB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김민수', handle: 'minsu-b' };
const members = [memberA, memberB, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', display_name: '이지영', handle: 'jiyoung' }];
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
const schedule = (id, title, extra = {}) => ({ id, title, date: '2026-11-13', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'meeting', absence_type: 'annual', is_notice: false, is_urgent: false, is_completed: false, is_todo: false, owner_name: null, attendee_names: [], attendee_member_ids: [], location: null, linked_file_ids: [], ...extra });
const notification = (id, sourceId, title) => ({ id, kind: 'schedule_attendee', source_id: String(sourceId), title, body: '내가 참석자로 지정된 일정입니다.', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-13T00:00:00Z', read_at: null });
const waitSignal = async (promise, label) => {
  let timer;
  try { await Promise.race([promise, new Promise((resolve, reject) => { void resolve; timer = setTimeout(() => reject(new Error(label)), 10000); })]); }
  finally { clearTimeout(timer); }
};
const holdList = (state) => { state.holdNextList = true; return new Promise((resolve) => { state.onHeldList = resolve; }); };
const holdMark = (state) => { state.holdNextMark = true; return new Promise((resolve) => { state.onHeldMark = resolve; }); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [], screenshots = [], contexts = [];
  const createPage = async ({ admin = false, capable = true } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1365, height: 950 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    contexts.push(context);
    const state = { admin, capable, schedules: [schedule(10, '알림 연결 일정'), schedule(11, '두 번째 알림 일정')], notifications: admin ? [] : [notification('10000000-0000-4000-8000-000000000001', 10, '알림 연결 일정'), notification('10000000-0000-4000-8000-000000000002', 11, '두 번째 알림 일정')], messages: Array.from({ length: 40 }, (_, index) => ({ id: 51 + index, content: index === 0 ? '@minsu-a 알림으로 연결한 원본 대화입니다.' : `이어지는 공유 메시지 ${index}`, sender_id: '22222222-2222-4222-8222-222222222222', sender_member_id: memberB.id, sender_display_name: memberB.display_name, mentioned_member_ids: index === 0 ? [memberA.id] : [], created_at: new Date(Date.parse('2026-11-13T00:00:00Z') + index * 60000).toISOString() })), writes: [], markCalls: [], listCalls: 0, blockedExternal: [], holdNextList: false, failNextList: false, heldList: null, nextId: 100 };
    Object.assign(state, { currentMember: admin ? null : memberA, sourceOverrides: {}, sourceRequests: [], dialogs: [], holdNextMark: false, heldMark: null });
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: state.admin });
      if (url.pathname.includes('/rest/v1/rpc/')) {
        const rpc = url.pathname.split('/').at(-1);
        if (['list_team_members', 'get_my_team_member', 'list_my_team_notifications'].includes(rpc) && !state.capable) return reply({ code: 'PGRST202', message: `Function ${rpc} is unavailable in the old schema` }, 404);
        if (rpc === 'list_team_members') return reply(members);
        if (rpc === 'team_responsibility_available') return reply(false);
        if (rpc === 'get_my_team_member') return reply(state.currentMember);
        if (rpc === 'list_my_team_notifications') {
          state.listCalls += 1;
          if (state.failNextList) { state.failNextList = false; return reply({ message: 'Mock transient notification failure' }, 500); }
          const snapshot = structuredClone(state.notifications);
          if (state.holdNextList) {
            state.holdNextList = false;
            await new Promise((resolve) => { state.heldList = { release: resolve, request }; state.onHeldList?.(); });
          }
          return reply(snapshot);
        }
        if (rpc === 'mark_my_notifications_read') {
          const body = request.postDataJSON();
          state.markCalls.push(body);
          const recipientsNotifications = state.notifications;
          if (state.holdNextMark) {
            state.holdNextMark = false;
            await new Promise((resolve) => { state.heldMark = { release: resolve, request }; state.onHeldMark?.(); });
          }
          recipientsNotifications.forEach((item) => { if (body.p_notification_ids === null || body.p_notification_ids.includes(item.id)) item.read_at = '2026-11-13T01:00:00Z'; });
          return reply(null);
        }
        state.writes.push({ unexpectedRpc: rpc });
        return reply({ message: 'Unexpected RPC is blocked in this test' }, 403);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').at(-1);
        if (request.method() === 'GET' && ['schedules', 'messages'].includes(table) && url.searchParams.get('select') === '*' && url.searchParams.get('id')?.startsWith('eq.')) {
          const sourceId = Number(url.searchParams.get('id').slice(3));
          const key = `${table}:${sourceId}`;
          state.sourceRequests.push({ table, sourceId });
          if (Object.hasOwn(state.sourceOverrides, key)) {
            const override = state.sourceOverrides[key];
            if (override?.status) return reply(override.body, override.status);
            return reply(override ? [override] : []);
          }
          const match = state[table].find((item) => item.id === sourceId);
          return reply(match ? [match] : []);
        }
        if (!state.capable && table === 'schedules' && (url.searchParams.get('select') || '').includes('attendee_member_ids')) return reply({ code: '42703', message: 'column schedules.attendee_member_ids does not exist' }, 400);
        if (request.method() !== 'GET') {
          const body = request.postDataJSON();
          state.writes.push({ table, method: request.method(), body });
          if (table !== 'schedules') return reply({ message: 'Unexpected mutation blocked' }, 403);
          if (request.method() === 'POST') state.schedules.push(...(Array.isArray(body) ? body : [body]).map((item) => ({ id: state.nextId++, ...item })));
          if (request.method() === 'PATCH') {
            const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
            const target = state.schedules.find((item) => item.id === id);
            if (target) Object.assign(target, body);
          }
          return reply([]);
        }
        if (table === 'schedules') return reply(state.capable ? state.schedules : state.schedules.map(({ attendee_member_ids: ignored, ...rest }) => { void ignored; return rest; }));
        if (table === 'messages') return reply(state.messages);
        if (table === 'categories') return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (url.origin === new URL(baseUrl).origin) return route.continue();
      state.blockedExternal.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    await context.addInitScript(() => {
      window.__teamQaPermissionRequests = 0;
      if ('Notification' in window) Notification.requestPermission = async () => { window.__teamQaPermissionRequests += 1; return 'denied'; };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => { state.dialogs.push(dialog.message()); void dialog.dismiss(); });
    await page.clock.setFixedTime(new Date('2026-11-13T01:00:00Z'));
    await page.goto(baseUrl);
    await page.locator('[data-dashboard-root]').waitFor();
    return { page, state, context };
  };
  const formFor = (page) => page.locator('dialog[open]');
  const openNew = async (page) => {
    await page.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).click();
    const form = formFor(page);
    await form.waitFor();
    const details = form.locator('details').filter({ hasText: '추가 정보' });
    if (!await details.evaluate((element) => element.open)) await details.locator('summary').click();
    return form;
  };
  const choose = async (form, handle, keyboard = false) => {
    const input = form.getByRole('combobox', { name: '참석 팀원', exact: true });
    await input.fill(`@${handle}`);
    const option = form.getByRole('option', { name: new RegExp(`@${handle}`) });
    await option.waitFor();
    if (keyboard) { await input.press('ArrowDown'); await input.press('Enter'); }
    else await option.click();
  };
  const save = async (form) => { await form.locator('button[type="submit"]').click(); await form.waitFor({ state: 'hidden' }); };
  const latestSave = (state) => { const write = state.writes.filter((entry) => entry.table === 'schedules').at(-1); return Array.isArray(write.body) ? write.body[0] : write.body; };
  const detail = async (page, title) => { await page.locator('[data-calendar-detail-category]').filter({ hasText: title }).first().click(); return page.getByRole('dialog', { name: '일정 상세', exact: true }); };
  const capture = async (page, label) => {
    const file = path.join(os.tmpdir(), `my-portal-team-${label}.png`);
    const style = await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
    try { await page.screenshot({ path: file }); screenshots.push(file); }
    finally { await style.evaluate((element) => element.remove()); }
  };
  let currentPage;
  try {
    const regular = await createPage();
    const { page, state } = regular;
    currentPage = page;
    const bell = page.getByRole('button', { name: /^개인 알림/ });
    await page.getByRole('button', { name: '개인 알림, 읽지 않은 알림 2개', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '개인 알림', exact: true }).count(), 0, 'notifications start closed');
    await bell.click();
    let panel = page.getByRole('region', { name: '개인 알림', exact: true });
    await panel.waitFor();
    assert.equal(await panel.getByRole('dialog').count(), 0, 'notifications are a popover, not a modal');
    assert.equal(await panel.locator('li').filter({ hasText: '알림 연결 일정' }).locator('time').getAttribute('datetime'), '2026-11-13T00:00:00Z', 'meaningful updates show the updated timestamp, not old creation time');
    await panel.getByRole('status').filter({ hasText: '불러오는 중' }).waitFor({ state: 'hidden' });

    const heldReady = holdList(state);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitSignal(heldReady, 'Held notification request did not start');
    await panel.getByRole('button', { name: '알림 연결 일정 읽음으로 표시', exact: true }).click();
    await page.getByRole('button', { name: '개인 알림, 읽지 않은 알림 1개', exact: true }).waitFor();
    const staleFinished = page.waitForResponse((response) => response.request() === state.heldList.request);
    state.heldList.release();
    await staleFinished;
    await page.waitForTimeout(150);
    await panel.getByRole('button', { name: '알림 연결 일정 읽음으로 표시', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await bell.getAttribute('aria-label'), '개인 알림, 읽지 않은 알림 1개', 'stale polling response cannot restore a successfully read notification');
    assert.deepEqual(state.markCalls[0].p_notification_ids, ['10000000-0000-4000-8000-000000000001']);

    await panel.getByRole('button').filter({ hasText: '두 번째 알림 일정' }).click();
    const linked = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await linked.getByRole('heading', { name: /두 번째 알림 일정/ }).waitFor();
    assert.equal(await panel.count(), 0, 'source navigation closes only the notification popover');
    await linked.getByRole('button', { name: '닫기', exact: true }).click();
    state.notifications.push(notification('10000000-0000-4000-8000-000000000003', 10, '모두 읽음 검증'));
    await bell.click();
    panel = page.getByRole('region', { name: '개인 알림', exact: true });
    await panel.getByText('모두 읽음 검증', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '모두 읽음으로 표시', exact: true }).click();
    await panel.getByText('모두 확인함', { exact: true }).waitFor();
    assert.equal(state.markCalls.at(-1).p_notification_ids, null);
    await page.keyboard.press('Escape');
    assert.equal(await bell.evaluate((element) => element === document.activeElement), true, 'Escape restores focus to notification bell');

    state.failNextList = true;
    await bell.click();
    panel = page.getByRole('region', { name: '개인 알림', exact: true });
    await panel.getByRole('alert').waitFor();
    await panel.getByRole('button', { name: '다시 시도', exact: true }).click();
    await panel.getByRole('alert').waitFor({ state: 'hidden' });
    await panel.getByRole('button', { name: '알림 닫기', exact: true }).click();
    state.notifications.push({ ...notification('10000000-0000-4000-8000-000000000004', 51, '나를 언급한 대화 확인'), kind: 'chat_mention' });
    await bell.click();
    panel = page.getByRole('region', { name: '개인 알림', exact: true });
    await panel.getByRole('button').filter({ hasText: '나를 언급한 대화 확인' }).click();
    const chat = page.getByRole('dialog', { name: '정보공유방', exact: true });
    const originalMessage = chat.locator('[data-team-message-id="51"]');
    await originalMessage.waitFor();
    assert.match(await originalMessage.getAttribute('class'), /ring-amber-200/, 'mention notification highlights its original message');
    const targetBox = await originalMessage.boundingBox(), logBox = await chat.getByRole('log').boundingBox();
    assert.ok(targetBox.y >= logBox.y - 1 && targetBox.y + targetBox.height <= logBox.y + logBox.height + 1, 'original mentioned message scrolls inside the visible log');
    await chat.getByRole('button', { name: '정보공유방 닫기', exact: true }).click();
    assert.ok(state.sourceRequests.some((request) => request.table === 'schedules' && request.sourceId === 11), 'cached schedule notification still fetches its fresh original');
    assert.ok(state.sourceRequests.some((request) => request.table === 'messages' && request.sourceId === 51), 'mention notification fetches the fresh original message');

    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    let form = await openNew(page);
    await form.locator('input[name="title"]').fill('팀원 UUID 참석 검증');
    await form.getByLabel('참석자', { exact: true }).fill('외부 참석자');
    await choose(form, 'minsu-a');
    await choose(form, 'minsu-b', true);
    assert.equal(await form.getByRole('button', { name: /김민수 @minsu-[ab] 선택 해제/ }).count(), 2, 'equal display names remain two distinct selections');
    await form.getByRole('combobox', { name: '참석 팀원', exact: true }).press('Escape');
    assert.equal(await form.isVisible(), true, 'Escape in picker does not close schedule form');
    await page.setViewportSize({ width: 320, height: 760 });
    const formBounds = await form.boundingBox();
    assert.ok(formBounds.x >= 0 && formBounds.x + formBounds.width <= 320, 'form fits 320px viewport');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'picker introduces no page overflow');
    await form.getByRole('combobox', { name: '참석 팀원', exact: true }).scrollIntoViewIfNeeded();
    await capture(page, 'picker-320');
    await save(form);
    assert.deepEqual(latestSave(state).attendee_member_ids, [memberA.id, memberB.id], 'the write uses member UUIDs, not device identity');
    assert.deepEqual(latestSave(state).attendee_names, ['외부 참석자', '김민수']);
    await page.setViewportSize({ width: 1365, height: 950 });

    let details = await detail(page, '팀원 UUID 참석 검증');
    await details.getByRole('button', { name: '일정 복사', exact: true }).click();
    form = formFor(page);
    await form.getByRole('button', { name: '김민수 @minsu-a 선택 해제', exact: true }).waitFor();
    assert.equal(await form.getByLabel('참석자', { exact: true }).inputValue(), ' 외부 참석자'.trim(), 'linked snapshots are not copied into legacy text');
    await form.getByLabel('일정 날짜', { exact: true }).fill('2026-11-14');
    await save(form);
    assert.deepEqual(latestSave(state).attendee_member_ids, [memberA.id, memberB.id], 'copy preserves member IDs');
    details = await detail(page, '팀원 UUID 참석 검증');
    await details.getByRole('button', { name: '일정 수정', exact: true }).click();
    form = formFor(page);
    await form.getByRole('button', { name: '김민수 @minsu-a 선택 해제', exact: true }).click();
    await form.getByRole('button', { name: '김민수 @minsu-b 선택 해제', exact: true }).click();
    await save(form);
    assert.deepEqual(latestSave(state).attendee_member_ids, []);
    assert.deepEqual(latestSave(state).attendee_names, ['외부 참석자'], 'removed ID names do not survive as legacy text');

    form = await openNew(page);
    await form.locator('input[name="title"]').fill('팀원 초안 복원 검증');
    await form.getByLabel('참석자', { exact: true }).fill('초안 외부 참석자');
    await choose(form, 'minsu-a');
    await choose(form, 'minsu-b');
    await form.getByRole('button', { name: '취소', exact: true }).click();
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('schedule-draft:2026-11-13')));
    assert.deepEqual(draft.attendee_member_ids, [memberA.id, memberB.id]);
    assert.deepEqual(draft.legacy_attendee_names, ['초안 외부 참석자']);
    form = await openNew(page);
    await form.getByRole('button', { name: '복원', exact: true }).click();
    await form.getByRole('button', { name: '김민수 @minsu-a 선택 해제', exact: true }).waitFor();
    await form.getByRole('button', { name: '김민수 @minsu-a 선택 해제', exact: true }).click();
    await save(form);
    assert.deepEqual(latestSave(state).attendee_member_ids, [memberB.id]);
    assert.deepEqual(latestSave(state).attendee_names, ['초안 외부 참석자', '김민수']);

    await page.setViewportSize({ width: 320, height: 760 });
    await bell.click();
    panel = page.getByRole('region', { name: '개인 알림', exact: true });
    const panelBounds = await panel.boundingBox();
    assert.ok(panelBounds.x >= 7 && panelBounds.x + panelBounds.width <= 313, 'notification popover fits the 320px viewport');
    await capture(page, 'notifications-320');
    await panel.getByRole('button', { name: '알림 닫기', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__teamQaPermissionRequests), 0, 'no browser notification permission requested');
    assert.ok(state.writes.every((write) => write.table === 'schedules'), 'all mutations are intended mocked schedule writes');

    await page.setViewportSize({ width: 1365, height: 950 });
    const sourceFailures = [
      { key: 'schedules:10', source: 10, title: '원본 조회 실패 검증', override: { status: 403, body: { code: '42501', message: 'Mock source access failure' } }, message: /일정을 불러오지 못했습니다/ },
      { key: 'schedules:10', source: 10, title: '삭제된 일정 검증', override: null, message: /삭제되었거나 취소된 일정/ },
      { key: 'schedules:10', source: 10, title: '취소된 일정 검증', override: schedule(10, '서버에서 취소된 일정', { recurrence_status: 'cancelled' }), message: /삭제되었거나 취소된 일정/ },
      { key: 'messages:51', source: 51, title: '삭제된 원본 대화 검증', kind: 'chat_mention', override: null, message: /삭제된 메시지/ },
    ];
    for (const [index, failure] of sourceFailures.entries()) {
      state.sourceOverrides[failure.key] = failure.override;
      state.notifications.push({ ...notification(`20000000-0000-4000-8000-00000000000${index}`, failure.source, failure.title), ...(failure.kind ? { kind: failure.kind } : {}) });
      const marksBefore = state.markCalls.length;
      await bell.click();
      panel = page.getByRole('region', { name: '개인 알림', exact: true });
      const alert = page.waitForEvent('dialog');
      await panel.getByRole('button').filter({ hasText: failure.title }).click();
      assert.match((await alert).message(), failure.message);
      assert.equal(await page.getByRole('dialog', { name: '일정 상세', exact: true }).count(), 0, 'failed fresh lookup never opens stale cached schedule');
      assert.equal(await page.getByRole('dialog', { name: '정보공유방', exact: true }).count(), 0, 'deleted original message never opens cached chat');
      assert.equal(state.markCalls.length, marksBefore, 'failed or missing original is not marked read');
    }

    const transition = await createPage();
    currentPage = transition.page;
    const transitionBell = transition.page.getByRole('button', { name: /^개인 알림/ });
    await transition.page.getByRole('button', { name: '개인 알림, 읽지 않은 알림 2개', exact: true }).waitFor();
    await transitionBell.click();
    const transitionPanel = transition.page.getByRole('region', { name: '개인 알림', exact: true });
    await transitionPanel.getByRole('status').filter({ hasText: '불러오는 중' }).waitFor({ state: 'hidden' });
    await transitionPanel.getByRole('button', { name: '알림 닫기', exact: true }).click();
    const oldListReady = holdList(transition.state);
    await transitionBell.click();
    await waitSignal(oldListReady, 'Old recipient list request did not start');
    const oldList = transition.state.heldList;
    const oldMarkReady = holdMark(transition.state);
    await transitionPanel.getByRole('button', { name: '알림 연결 일정 읽음으로 표시', exact: true }).click();
    await waitSignal(oldMarkReady, 'Old recipient read request did not start');
    const oldMark = transition.state.heldMark;
    transition.state.currentMember = memberB;
    transition.state.notifications = [notification('30000000-0000-4000-8000-000000000001', 11, '새 팀원 전용 알림')];
    const newListReady = holdList(transition.state);
    await transition.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitSignal(newListReady, 'New recipient list request did not start');
    const newList = transition.state.heldList;
    await transitionPanel.getByText('알림 연결 일정', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await transitionBell.getAttribute('aria-label'), '개인 알림', 'A to B transition clears old badge before the new inbox arrives');
    const listCallsAtSwitch = transition.state.listCalls;
    const oldListFinished = transition.page.waitForResponse((response) => response.request() === oldList.request);
    const oldMarkFinished = transition.page.waitForResponse((response) => response.request() === oldMark.request);
    oldList.release();
    oldMark.release();
    await Promise.all([oldListFinished, oldMarkFinished]);
    await transition.page.waitForTimeout(150);
    assert.equal(await transitionPanel.getByText('알림 연결 일정', { exact: true }).count(), 0, 'late A list cannot repopulate B inbox');
    assert.equal(transition.state.listCalls, listCallsAtSwitch, 'late A read success cannot refresh the new recipient inbox');
    assert.equal(await transitionBell.getAttribute('aria-label'), '개인 알림');
    newList.release();
    await transitionPanel.getByText('새 팀원 전용 알림', { exact: true }).waitFor();
    transition.state.currentMember = null;
    transition.state.notifications = [];
    const nullListReady = holdList(transition.state);
    await transition.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitSignal(nullListReady, 'Unlinked recipient list request did not start');
    await transitionPanel.getByText('새 팀원 전용 알림', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await transitionBell.getAttribute('aria-label'), '개인 알림', 'B to null transition immediately clears the old inbox');
    transition.state.heldList.release();
    await transitionPanel.getByRole('status').filter({ hasText: '아직 받은 알림이 없습니다.' }).waitFor();

    const admin = await createPage({ admin: true });
    currentPage = admin.page;
    await admin.page.getByRole('button', { name: /^개인 알림/ }).click();
    await admin.page.getByRole('status').filter({ hasText: '아직 받은 알림이 없습니다.' }).waitFor();
    await admin.page.getByRole('button', { name: '알림 닫기', exact: true }).click();
    await admin.page.getByRole('button', { name: '일정 공유', exact: true }).click();
    form = await openNew(admin.page);
    await form.locator('input[name="title"]').fill('관리자 팀원 선택 검증');
    await choose(form, 'minsu-b');
    await save(form);
    assert.deepEqual(latestSave(admin.state).attendee_member_ids, [memberB.id], 'admin without a personal team profile can select recipients');

    const old = await createPage({ capable: false });
    currentPage = old.page;
    await old.page.getByRole('button', { name: '일정 공유', exact: true }).click();
    assert.equal(await old.page.getByRole('button', { name: /^개인 알림/ }).count(), 0, 'old schema hides unavailable personal notification utility');
    form = await openNew(old.page);
    await form.locator('input[name="title"]').fill('이전 스키마 참석자 검증');
    await form.getByLabel('참석자', { exact: true }).fill('김민수, 외부 참석자');
    assert.equal(await form.getByRole('combobox', { name: '참석 팀원', exact: true }).count(), 0);
    await save(form);
    assert.equal(Object.hasOwn(latestSave(old.state), 'attendee_member_ids'), false, 'old schema omits unsupported identity fields');
    assert.deepEqual(latestSave(old.state).attendee_names, ['김민수', '외부 참석자']);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['recipient notification bell and read state', 'delayed polling cannot revert successful read', 'notification freshly fetches original schedule and focuses original mentioned message', 'fresh source error/deletion/cancellation never opens stale cache or marks read', 'A to B to null identity transitions clear old inbox and reject late list/read responses', 'updated timestamp and transient error retry', 'read-all and Escape focus', 'same-name UUID selections and keyboard', '320px form and notification popover', 'copy/edit/draft preserve IDs without stale names', 'admin without member can choose recipients', 'old-schema legacy text remains usable', 'no notification permission prompts or external writes'], screenshots }, null, 2));
  } catch (failure) {
    if (currentPage) console.error((await currentPage.locator('body').innerText()).slice(-6000));
    console.error('Browser errors:', errors);
    throw failure;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
