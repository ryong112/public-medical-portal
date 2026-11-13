/* eslint-disable @typescript-eslint/no-require-imports -- Local-only photo review regressions; all remote requests are mocked. */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_ATTENDEE_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const memberA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김민수', handle: 'minsu-a' };
const memberB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김민수', handle: 'minsu-b' };
const memberC = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', display_name: '이지영', handle: 'jiyoung' };
const inactiveId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const members = [memberA, memberB, memberC];
const base = { date: '2026-11-10', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'meeting', absence_type: 'annual', is_urgent: false, is_notice: false, is_todo: false, is_completed: false };
const photoRow = (title, overrides = {}) => ({ ...base, title, person_labels: [], source_text: title, ink_color: 'red', color_confidence: 0.96, confidence: 0.96, warnings: [], ...overrides });
const photo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="white"/><text x="20" y="50">2026-11</text></svg>');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  const state = { capable: true, writes: [], errors: [], analysis: { schedules: [], visible_months: ['2026-11'], analysis_warnings: [] } };
  const existing = [
    { ...base, id: 1, title: '기존 회의', date: '2026-11-11', attendee_member_ids: [memberB.id], attendee_names: [memberB.display_name, '외부 참석자'] },
    { ...base, id: 2, title: '휴가-룡', date: '2026-11-08', schedule_type: 'leave', attendee_member_ids: [inactiveId], attendee_names: ['기존 참석자'] },
    { ...base, id: 3, title: '휴가', date: '2026-11-12', schedule_type: 'leave', attendee_member_ids: [memberA.id], attendee_names: [memberA.display_name] },
    { ...base, id: 4, title: '휴가', date: '2026-11-12', schedule_type: 'leave', attendee_member_ids: [memberB.id], attendee_names: [memberB.display_name] },
    { ...base, id: 5, title: '다음달 미리 등록', date: '2026-12-10', attendee_member_ids: [memberC.id], attendee_names: [memberC.display_name] },
  ];
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.endsWith('/list_team_members')) return state.capable ? reply(members) : reply({ code: 'PGRST202', message: 'legacy team schema' }, 404);
    if (url.pathname.endsWith('/get_my_team_member')) return state.capable ? reply(memberA) : reply({ code: 'PGRST202', message: 'legacy team schema' }, 404);
    if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
    if (url.pathname.endsWith('/team_responsibility_available')) return reply(false);
    if (url.pathname.endsWith('/save_whiteboard_corrections')) return reply(0);
    if (url.pathname.includes('/functions/v1/analyze-whiteboard')) return reply(state.analysis);
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') {
        if (!url.pathname.endsWith('/schedules')) throw new Error(`Unexpected write ${url.pathname}`);
        state.writes.push({ method: request.method(), query: url.search, body: request.postDataJSON() });
        return reply([]);
      }
      if (url.pathname.endsWith('/schedules')) return reply(existing);
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => state.errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  const open = async (rows) => {
    state.analysis = { schedules: rows, visible_months: ['2026-11'], analysis_warnings: [] };
    await page.getByRole('button', { name: /화이트보드 가져오기|사진 분석/ }).click();
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'board.svg', mimeType: 'image/svg+xml', buffer: photo });
    await page.getByRole('button', { name: '일정 분석 시작' }).click();
    await page.getByRole('heading', { name: '추출된 일정 확인' }).waitFor();
  };
  const drafts = () => page.locator('[data-whiteboard-draft]');
  const close = () => page.getByRole('button', { name: '닫기', exact: true }).click();
  try {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    await open([
      photoRow('방문재활(홍천) ③-희,예', { person_labels: ['희', '예'] }),
      photoRow('휴-룡', { schedule_type: 'leave', person_labels: ['룡'] }),
    ]);
    assert.deepEqual(await page.getByLabel('일정 제목', { exact: true }).evaluateAll((inputs) => inputs.map((input) => input.value)), ['방문재활(홍천) ③', '휴가']);
    assert.equal(await drafts().first().getByRole('checkbox', { checked: true }).count(), 0, 'OCR labels never select IDs automatically');
    await drafts().first().getByRole('checkbox', { name: '김민수 @minsu-a', exact: true }).check();
    await drafts().first().getByRole('checkbox', { name: '이지영', exact: true }).check();
    await drafts().nth(1).getByRole('checkbox', { name: '김민수 @minsu-b', exact: true }).check();
    await page.getByRole('button', { name: '일정 추가', exact: true }).click();
    await drafts().last().getByLabel('일정 제목', { exact: true }).fill('사용자 보완 제목-룡');
    await drafts().last().getByRole('checkbox', { name: '이지영', exact: true }).check();
    await page.setViewportSize({ width: 320, height: 844 });
    await drafts().last().getByRole('checkbox', { name: '이지영', exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth));
    assert.ok(await drafts().last().getByRole('checkbox', { name: '이지영', exact: true }).evaluate((element) => element.getBoundingClientRect().width < 24 && element.closest('label').getBoundingClientRect().height < 65), 'checkbox chips stay compact rather than inheriting full-width text field styles');
    const screenshot = path.join(os.tmpdir(), 'my-portal-whiteboard-attendees-mobile-320.png');
    await page.screenshot({ path: screenshot });
    await page.getByRole('button', { name: '선택 일정 3건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const inserted = state.writes.at(-1).body;
    assert.deepEqual(inserted[0].attendee_member_ids, [memberA.id, memberC.id]);
    assert.deepEqual(inserted[0].attendee_names, [memberA.display_name, memberC.display_name]);
    assert.deepEqual(inserted[1].attendee_member_ids, [memberB.id]);
    assert.equal(inserted[2].title, '사용자 보완 제목-룡', 'manual title corrections are never re-stripped on save');

    await open([photoRow('기존 회의', { date: '2026-11-11' })]);
    assert.ok(await drafts().first().getByRole('checkbox', { name: '김민수 @minsu-b', exact: true }).isChecked());
    assert.equal(await page.getByRole('button', { name: '선택 일정 0건 반영' }).isDisabled(), true);
    await drafts().first().getByRole('checkbox', { name: '김민수 @minsu-b', exact: true }).uncheck();
    await drafts().first().getByRole('checkbox', { name: '이지영', exact: true }).check();
    await page.getByRole('button', { name: '선택 일정 1건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const changed = state.writes.at(-1);
    assert.equal(changed.query, '?id=eq.1');
    assert.deepEqual(changed.body.attendee_member_ids, [memberC.id]);
    assert.deepEqual(changed.body.attendee_names, ['외부 참석자', memberC.display_name]);

    await open([photoRow('휴가-룡', { date: '2026-11-08', schedule_type: 'leave', person_labels: ['룡'] })]);
    assert.ok(await drafts().first().getByRole('checkbox', { name: /기존 참석자 목록에 없음/ }).isChecked());
    await drafts().first().getByRole('checkbox', { name: '김민수 @minsu-a', exact: true }).check();
    await page.getByRole('button', { name: '선택 일정 1건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(state.writes.at(-1).query, '?id=eq.2');
    assert.equal(state.writes.at(-1).body.title, '휴가');
    assert.deepEqual(state.writes.at(-1).body.attendee_member_ids, [inactiveId, memberA.id]);

    await open([photoRow('휴가', { date: '2026-11-12', schedule_type: 'leave' })]);
    await page.getByText(/이름을 제외한 제목이 기존 일정과 겹칩니다/).waitFor();
    assert.equal(await page.getByRole('button', { name: '선택 일정 0건 반영' }).isDisabled(), true, 'ambiguous normalized matches must not overwrite someone');
    await close();

    await open([photoRow('기존 회의', { date: '2026-11-11', source_text: '기존 회의-예', person_labels: ['예'] })]);
    await page.getByText(/다른 사람의 일정을 덮어쓰지 않도록/).waitFor();
    assert.equal(await drafts().first().getByRole('checkbox', { checked: true }).count(), 0, 'a different photographed person cannot inherit an existing person by cleaned title alone');
    assert.equal(await page.getByRole('button', { name: '선택 일정 0건 반영' }).isDisabled(), true);
    await close();

    state.capable = false;
    await page.reload();
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    await open([photoRow('기존 회의', { date: '2026-11-11', start_time: '09:00' })]);
    assert.equal(await drafts().first().getByRole('checkbox').count(), 1, 'historical IDs stay visible but unavailable in legacy mode');
    await page.getByRole('button', { name: '선택 일정 1건 반영' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.ok(!Object.hasOwn(state.writes.at(-1).body, 'attendee_member_ids'));
    assert.ok(!Object.hasOwn(state.writes.at(-1).body, 'attendee_names'));
    assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['raw OCR names separated without automatic IDs', 'region and session numbers retained', 'same-name stable checkbox IDs', 'manual addition and manual title preservation', '320px checkbox wrapping', 'participant-only edits become updates', 'legacy free names retained', 'inactive IDs retained', 'ambiguous matches stay unselected', 'next-month isolation and old schema omission'], screenshot }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-6000));
    console.error(state.errors);
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
