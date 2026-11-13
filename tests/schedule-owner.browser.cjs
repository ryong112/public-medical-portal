/* eslint-disable @typescript-eslint/no-require-imports -- Local-only browser regressions; all backend traffic is mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.SCHEDULE_OWNER_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const userId = '11111111-1111-4111-8111-111111111111';
const memberA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김민수', handle: 'minsu-a' };
const memberB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김민수', handle: 'minsu-b' };
const inactiveId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const members = [memberA, memberB];
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
const schedule = (id, title, extra = {}) => ({ id, title, date: '2026-11-13', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'meeting', absence_type: 'annual', is_notice: false, is_urgent: false, is_completed: false, is_todo: false, owner_name: null, owner_member_id: null, attendee_names: [], attendee_member_ids: [], location: null, linked_file_ids: [], ...extra });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [], errors = [], screenshots = [];
  let currentPage;
  const createPage = async (capable = true) => {
    const context = await browser.newContext({ viewport: { width: 1365, height: 950 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    contexts.push(context);
    const state = { nextId: 100, writes: [], blockedExternal: [], schedules: [schedule(1, '기존 직접 입력 담당자', { owner_name: '김민수' }), schedule(2, '비활성 담당자 유지', { owner_name: '기존 담당자', owner_member_id: inactiveId }), schedule(3, '연결 담당자 복사', { owner_name: '김민수', owner_member_id: memberB.id })] };
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
      if (url.pathname.includes('/rest/v1/rpc/')) {
        const rpc = url.pathname.split('/').at(-1);
        if (rpc === 'list_team_members') return reply(members);
        if (rpc === 'get_my_team_member') return reply(memberA);
        if (rpc === 'list_my_team_notifications') return reply([]);
        if (rpc === 'team_responsibility_available') return capable ? reply(true) : reply({ code: 'PGRST202', message: 'Old schema has no optional owner ID capability' }, 404);
        state.writes.push({ unexpectedRpc: rpc });
        return reply({ message: 'Unexpected RPC blocked' }, 403);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').at(-1);
        if (request.method() !== 'GET') {
          if (table !== 'schedules') return reply({ message: 'Only mocked schedule writes are permitted' }, 403);
          const body = request.postDataJSON();
          state.writes.push({ table, method: request.method(), body });
          if (request.method() === 'POST') state.schedules.push(...(Array.isArray(body) ? body : [body]).map((item) => ({ id: state.nextId++, ...item })));
          if (request.method() === 'PATCH') {
            const target = state.schedules.find((item) => item.id === Number((url.searchParams.get('id') || '').replace('eq.', '')));
            if (target) Object.assign(target, body);
          }
          return reply([]);
        }
        if (table === 'schedules') return reply(state.schedules);
        if (table === 'categories') return reply([{ id: 1, name: '공유자료', order_index: 0 }]);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (url.origin === new URL(baseUrl).origin) return route.continue();
      state.blockedExternal.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => { void dialog.dismiss(); });
    await page.clock.setFixedTime(new Date('2026-11-13T01:00:00Z'));
    await page.goto(baseUrl);
    await page.locator('[data-dashboard-root]').waitFor();
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    return { page, state };
  };
  const details = async (form) => {
    const section = form.locator('details').filter({ hasText: '추가 정보' });
    if (!await section.evaluate((element) => element.open)) await section.locator('summary').click();
  };
  const openNew = async (page) => {
    await page.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).click();
    const form = page.locator('dialog[open]');
    await form.waitFor();
    await details(form);
    return form;
  };
  const openExisting = async (page, title, action = '일정 수정') => {
    await page.locator('[data-calendar-detail-category]').filter({ hasText: title }).first().click();
    await page.getByRole('dialog', { name: '일정 상세', exact: true }).getByRole('button', { name: action, exact: true }).click();
    const form = page.locator('dialog[open]');
    await form.waitFor();
    await details(form);
    return form;
  };
  const choose = async (form, handle) => {
    await form.getByRole('combobox', { name: '담당 팀원', exact: true }).fill(`@${handle}`);
    await form.getByRole('option', { name: new RegExp(`@${handle}`) }).click();
  };
  const save = async (form) => { await form.locator('button[type="submit"]').click(); await form.waitFor({ state: 'hidden' }); };
  const latestSave = (state) => { const write = state.writes.filter((entry) => entry.table === 'schedules').at(-1); return Array.isArray(write.body) ? write.body[0] : write.body; };
  try {
    const regular = await createPage();
    const { page, state } = regular;
    currentPage = page;
    let form = await openExisting(page, '기존 직접 입력 담당자');
    await form.getByRole('combobox', { name: '담당 팀원', exact: true }).waitFor();
    assert.equal(await form.getByRole('list', { name: '담당 팀원 선택됨', exact: true }).count(), 0, 'matching legacy names never become owner IDs');
    assert.equal(await form.getByLabel('담당자 직접 입력', { exact: true }).inputValue(), '김민수');
    await save(form);
    assert.equal(latestSave(state).owner_member_id, null);
    assert.equal(latestSave(state).owner_name, '김민수');

    form = await openNew(page);
    await form.locator('input[name="title"]').fill('고유 ID 담당자 신규');
    await choose(form, 'minsu-b');
    await save(form);
    assert.equal(latestSave(state).owner_member_id, memberB.id, 'same names are distinguished by the selected handle');
    assert.equal(latestSave(state).owner_name, '김민수');
    assert.deepEqual(latestSave(state).attendee_member_ids, [], 'owner assignment does not silently add an attendee or notification recipient');

    form = await openExisting(page, '고유 ID 담당자 신규');
    await form.getByRole('list', { name: '담당 팀원 선택됨', exact: true }).getByRole('button', { name: '김민수 @minsu-b 선택 해제', exact: true }).click();
    await save(form);
    assert.equal(latestSave(state).owner_member_id, null);
    assert.equal(latestSave(state).owner_name, null, 'clearing a linked owner also clears its stale name snapshot');

    form = await openExisting(page, '비활성 담당자 유지');
    await form.getByText('기존 담당자: 기존 담당자', { exact: true }).waitFor();
    await form.getByRole('list', { name: '담당 팀원 선택됨', exact: true }).getByText('등록 확인 필요').waitFor();
    await save(form);
    assert.equal(latestSave(state).owner_member_id, inactiveId);
    assert.equal(latestSave(state).owner_name, '기존 담당자');

    form = await openExisting(page, '연결 담당자 복사', '일정 복사');
    await form.getByRole('list', { name: '담당 팀원 선택됨', exact: true }).getByText('@minsu-b', { exact: true }).waitFor();
    await form.getByLabel('일정 날짜', { exact: true }).fill('2026-11-14');
    await save(form);
    assert.equal(latestSave(state).owner_member_id, memberB.id, 'copy keeps the selected owner ID');

    form = await openNew(page);
    await form.locator('input[name="title"]').fill('담당자 초안 복원');
    await choose(form, 'minsu-a');
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('schedule-draft:2026-11-13') || '{}').owner_member_id === id, memberA.id);
    await form.getByRole('button', { name: '취소', exact: true }).click();
    form = await openNew(page);
    await form.getByRole('button', { name: '복원', exact: true }).click();
    await form.getByRole('list', { name: '담당 팀원 선택됨', exact: true }).getByText('@minsu-a', { exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 760 });
    const picker = form.getByRole('combobox', { name: '담당 팀원', exact: true });
    await picker.scrollIntoViewIfNeeded();
    const bounds = await picker.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320, 'owner picker fits a narrow viewport');
    const screenshot = path.join(os.tmpdir(), 'my-portal-schedule-owner-mobile-320.png');
    await page.screenshot({ path: screenshot });
    screenshots.push(screenshot);
    await save(form);
    assert.equal(latestSave(state).owner_member_id, memberA.id);

    const old = await createPage(false);
    currentPage = old.page;
    form = await openNew(old.page);
    await form.locator('input[name="title"]').fill('이전 스키마 담당자');
    assert.equal(await form.getByRole('combobox', { name: '담당 팀원', exact: true }).count(), 0);
    await form.getByLabel('담당자', { exact: true }).fill('직접 입력 담당자');
    await save(form);
    assert.equal(Object.hasOwn(latestSave(old.state), 'owner_member_id'), false, 'unsupported owner column is never sent');
    assert.equal(latestSave(old.state).owner_name, '직접 입력 담당자');
    assert.ok([...state.writes, ...old.state.writes].every((entry) => entry.table === 'schedules'), 'only intended mocked schedule changes occur');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['no name-based owner ID inference', 'same-name owner selection by handle', 'explicit unlink clears stale snapshot', 'inactive owner IDs and labels preserved', 'copy preserves owner ID', 'draft restore and 320px layout', 'old-schema legacy fallback without new column'], screenshots }, null, 2));
  } catch (failure) {
    if (currentPage) console.error((await currentPage.locator('body').innerText()).slice(-6000));
    console.error('Browser errors:', errors);
    throw failure;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
