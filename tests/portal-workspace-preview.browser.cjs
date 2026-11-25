/* eslint-disable @typescript-eslint/no-require-imports -- Local browser test with synthetic data and no remote traffic. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = new URL(process.env.PORTAL_WORKSPACE_TEST_URL || 'http://127.0.0.1:3000').origin;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const userId = '11111111-1111-4111-8111-111111111111';
const teammateId = '22222222-2222-4222-8222-222222222222';
const member = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김하늘', handle: '하늘' };
const teammate = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '이서현', handle: '서현' };
const third = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', display_name: '박지우', handle: '지우' };
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-fixture`;
const today = '2026-11-25';
const createSchedule = (id, date, title, schedule_type, values = {}) => ({
  id, date, title, schedule_type, end_date: null, start_time: '10:00', end_time: '11:00',
  is_notice: false, is_urgent: false, is_todo: false, is_completed: false,
  owner_name: member.display_name, owner_member_id: member.id, attendee_names: [teammate.display_name],
  attendee_member_ids: [teammate.id], location: '', linked_file_ids: [], ...values,
});
const schedules = [
  createSchedule(10, today, '지역 연계 간담회', 'internal', { start_time: '14:00', end_time: '15:00', location: '본관 2층 회의실', linked_file_ids: [21] }),
  createSchedule(11, today, '내년도 운영계획 초안 확인', 'general', { start_time: '16:00', end_time: '17:00', is_todo: true }),
  createSchedule(12, today, '연차 · 이서현', 'leave', { owner_name: teammate.display_name, owner_member_id: teammate.id, attendee_member_ids: [teammate.id], start_time: null, end_time: null, absence_type: 'annual' }),
  createSchedule(13, '2026-11-26', '방문재활 사례 회의', 'meeting', { owner_name: teammate.display_name, owner_member_id: teammate.id, is_notice: true, location: '재활센터 교육실', start_time: '13:30', end_time: '14:30' }),
  createSchedule(14, '2026-11-27', '지역 협력기관 현장 방문', 'business_trip', { start_time: '09:30', end_time: null, location: '협력기관' }),
  createSchedule(15, '2026-11-30', '월간 실적 취합', 'internal'),
  createSchedule(16, '2026-12-01', '팀 회의', 'meeting'),
];
const documents = [{ id: 21, name: '지역 연계 간담회 자료.hwp', url: 'storage://files/demo-material.hwp', size: 30944, category: '회의 자료', created_at: '2026-11-24T03:00:00Z' }];
const categories = [{ id: 1, name: '회의 자료', order_index: 0 }, { id: 2, name: '업무 매뉴얼', order_index: 1 }, { id: 3, name: '공유 자료', order_index: 2 }];
const messages = [
  [30, '공용 자료 정리 기준을 업무 매뉴얼에 추가했습니다.', teammate, '2026-11-24T07:35:00Z'],
  [31, '내일 쓰는 안내문은 회의 자료 폴더에 올려뒀어요.', teammate, '2026-11-25T00:14:00Z'],
  [32, '파일명 맨 앞에 날짜만 넣으면 찾기 쉬울 것 같아요.', teammate, '2026-11-25T00:15:00Z'],
  [33, '좋습니다. 오늘 올리는 자료부터 맞춰둘게요.', member, '2026-11-25T00:19:00Z'],
  [34, '@하늘 간담회 자료에 참고할 내용도 같이 넣었습니다.', teammate, '2026-11-25T00:27:00Z'],
].map(([id, content, sender, created_at]) => ({ id, content, sender_id: sender === member ? userId : teammateId, sender_member_id: sender.id, sender_display_name: sender.display_name, mentioned_member_ids: id === 34 ? [member.id] : [], created_at }));

const asShare = (schedule, status, read, overrides = {}) => ({
  schedule_id: schedule.id, title: schedule.title, date: schedule.date, end_date: schedule.end_date,
  start_time: schedule.start_time, end_time: schedule.end_time, location: schedule.location,
  attendee_count: schedule.attendee_member_ids.length, file_count: schedule.linked_file_ids.length,
  status, revision: status === 'published' ? 1 : 2, read, source_available: status !== 'cancelled',
  can_withdraw: schedule.owner_member_id === member.id, ...overrides,
});
const captures = [];
const capture = async (page, name) => {
  const target = path.join(os.tmpdir(), `my-portal-workspace-${name}.png`);
  await page.screenshot({ path: target, animations: 'disabled', style: 'nextjs-portal { display: none !important }' });
  captures.push(target);
};

async function verify(browser, label, size) {
  const context = await browser.newContext({ viewport: size, timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce', isMobile: label === 'mobile', hasTouch: label === 'mobile' });
  const errors = [], writes = [], unexpected = [];
  const published = [
    asShare(schedules[3], 'changed', false),
    asShare(schedules[4], 'published', false),
    asShare(createSchedule(90, '2026-11-27', '시민회관 안전 점검', 'internal'), 'cancelled', true, { can_withdraw: false }),
  ];
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin === origin) return url.pathname === '/api/korean-holidays' ? reply({ holidays: [] }) : route.continue();
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'test-only', expires_in: 3600, expires_at: 2100000000, token_type: 'bearer', user: { id: userId, role: 'authenticated', aud: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.endsWith('/list_team_members')) return reply([member, teammate, third]);
    if (url.pathname.endsWith('/get_my_team_member')) return reply(member);
    if (url.pathname.endsWith('/team_responsibility_available')) return reply(true);
    if (url.pathname.endsWith('/list_my_team_notifications')) return reply([]);
    if (url.pathname.endsWith('/get_team_chat_notice_state')) return reply({ collapsed: false, hidden: false, notice: { id: 'fixture', message_id: 30, content: messages[0].content, author_name: teammate.display_name, created_at: messages[0].created_at, can_remove: false } });
    if (url.pathname.endsWith('/list_important_schedules')) return reply(published);
    if (url.pathname.endsWith('/publish_important_schedule')) {
      const body = req.postDataJSON();
      writes.push(['publish', body]);
      if (body.p_schedule_id !== 10) return reply({ code: '42501' }, 403);
      if (!published.some((entry) => entry.schedule_id === 10)) published.unshift(asShare(schedules[0], 'published', true));
      return reply(true);
    }
    if (url.pathname.endsWith('/mark_important_schedule_read')) {
      const body = req.postDataJSON();
      writes.push(['read', body]);
      const row = published.find((entry) => entry.schedule_id === body.p_schedule_id && entry.revision === body.p_revision);
      if (row) row.read = true;
      return reply(Boolean(row));
    }
    if (url.pathname.startsWith('/rest/v1/') && req.method() === 'GET') {
      const table = url.pathname.split('/').at(-1);
      const items = { schedules, messages, files: documents, categories }[table] ?? [];
      const id = url.searchParams.get('id')?.match(/^eq\.(\d+)$/u)?.[1];
      return reply(id ? items.filter((item) => item.id === Number(id)) : items);
    }
    if (req.method() !== 'GET') unexpected.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  await context.routeWebSocket((value) => new URL(value).hostname !== '127.0.0.1' && new URL(value).hostname !== 'localhost', (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-25T01:00:00Z'));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const dashboard = page.locator('[data-dashboard-root]');
  try {
    await dashboard.locator('[data-dashboard-summary="absence"]').getByRole('button', { name: /이번 달 휴가 1명/ }).waitFor();
  } catch (error) {
    console.error('Preview setup:', label, errors, await page.locator('body').innerText());
    throw error;
  }
  await capture(page, `home-${label}`);

  await page.getByRole('button', { name: '내 일정만', exact: true }).click();
  await dashboard.locator('[data-dashboard-summary="notice"]').getByRole('button', { name: /공지사항 1건/ }).waitFor();
  await dashboard.locator('[data-dashboard-summary="absence"]').getByRole('button', { name: /이번 달 휴가 1명/ }).waitFor();
  assert.equal(await dashboard.locator('[data-dashboard-day="today"] [data-schedule-id="12"]').count(), 0);
  await page.getByRole('button', { name: '전체 일정', exact: true }).click();

  const search = async (query, name) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '통합 검색' });
    await dialog.getByRole('textbox', { name: '통합 검색어' }).fill(query);
    await dialog.getByRole('button', { name }).click();
  };
  await search('파일명 맨 앞', /파일명 맨 앞/u);
  const room = page.getByRole('dialog', { name: '정보공유방', exact: true });
  await room.locator('[data-team-message-id="32"]').waitFor();
  await page.waitForFunction(() => document.activeElement?.closest('[data-team-message-id="32"]'));
  await capture(page, `chat-${label}`);
  await room.getByRole('tab', { name: /중요 일정/u }).click();
  await room.locator('[data-important-schedule-id="13"]').getByText('일정 변경', { exact: true }).waitFor();
  await room.locator('[data-important-schedule-id="90"]').getByText('취소', { exact: true }).waitFor();
  if (label === 'pc') {
    const drag = async (selector, dx, dy, offset = 12) => {
      const box = await room.locator(selector).boundingBox();
      assert.ok(box);
      const x = box.x + offset, y = box.y + Math.min(box.height / 2, 18);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 12 });
      await page.mouse.up();
    };
    await drag('[data-chat-drag-handle]', -318, -10, 150);
    await drag('[data-chat-resize-handle]', 252, 0);
    assert.ok((await room.boundingBox()).width >= 640);
  }
  await capture(page, `important-${label}`);
  await room.locator('[data-important-schedule-id="13"]').getByRole('button', { name: '일정 보기' }).click();
  const detail = page.getByRole('dialog', { name: '일정 상세' });
  await detail.getByRole('heading', { name: '방문재활 사례 회의' }).waitFor();
  assert.equal(await detail.getByRole('button', { name: '일정 수정' }).count(), 0, 'A different owner manages this published schedule');
  await detail.getByRole('button', { name: '닫기', exact: true }).click();
  await room.getByRole('button', { name: '정보공유방 닫기' }).click();

  await search('간담회 자료.hwp', /지역 연계 간담회 자료.hwp/u);
  const doc = page.getByRole('dialog', { name: '지역 연계 간담회 자료.hwp', exact: true });
  await doc.getByRole('button', { name: /연결된 일정/u }).click();
  await doc.getByRole('list').getByRole('button', { name: /지역 연계 간담회/u }).click();
  await detail.getByRole('heading', { name: '지역 연계 간담회' }).waitFor();
  await detail.getByRole('button', { name: '지역 연계 간담회 자료.hwp' }).click();
  await doc.getByRole('button', { name: '미리보기 닫기' }).click();
  await detail.getByRole('button', { name: '중요 일정에 공유' }).click();
  assert.equal(writes.filter(([kind]) => kind === 'publish').length, 0);
  await detail.getByRole('button', { name: '공유하기', exact: true }).click();
  await room.locator('[data-important-schedule-id="10"]').getByText('지역 연계 간담회', { exact: true }).waitFor();
  assert.deepEqual(writes.filter(([kind]) => kind === 'publish'), [['publish', { p_schedule_id: 10 }]]);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await verify(browser, 'pc', { width: 1440, height: 900 });
    await verify(browser, 'mobile', { width: 390, height: 844 });
    console.log(JSON.stringify({ passed: true, captures }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
