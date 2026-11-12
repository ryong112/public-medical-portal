/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright smoke test using an installed module via PLAYWRIGHT_MODULE. */
// Run against the local dev server. All authentication, Supabase and remote traffic is mocked.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' });
  const writes = [];
  const errors = [];
  const prompts = [];
  const confirmAnswers = [];
  const metadataKeys = ['owner_name', 'attendee_names', 'location', 'linked_file_ids'];
  const duplicateSelect = 'id,title,date,end_date,recurrence_status';
  const paginatedDuplicateTitle = '대량 조회 경계 검증 회의';
  const duplicatePageRequests = [];
  let largeDuplicateMode = false;
  const largeDuplicateRows = [
    ...Array.from({ length: 500 }, (_, index) => ({ id: 10000 + index, title: '다른 업무 ' + (index + 1), date: '2026-11-11', end_date: null, recurrence_status: 'active' })),
    { id: 10500, title: paginatedDuplicateTitle, date: '2026-11-11', end_date: null, recurrence_status: 'active' },
  ];
  let metadataReady = true;
  let authRequests = 0;
  let nextId = 10;
  const schedules = [{ id: 1, title: '기존 회의', date: '2026-11-11', end_date: null, start_time: '10:00', end_time: '11:00', schedule_type: 'meeting', absence_type: 'annual', is_notice: false, is_urgent: false, is_completed: false, is_todo: false, owner_name: '이팀원', attendee_names: [], location: null, linked_file_ids: [] }];
  schedules.push(
    { ...schedules[0], id: 2, title: '담당 일치 확인', owner_name: '김민수', attendee_names: [] },
    { ...schedules[0], id: 3, title: '참석 일치 확인', owner_name: '이팀원', attendee_names: ['김민수'] },
    { ...schedules[0], id: 4, title: '다른 사람만 있는 업무', owner_name: '김민수현', attendee_names: ['김민'] },
    { ...schedules[0], id: 5, title: '김민수 이름만 들어간 업무', owner_name: '정팀원', attendee_names: [] },
  );
  const files = [{ id: 21, name: '협의자료.pdf', category: '운영', url: 'https://fixture.invalid/meeting.pdf', size: 4096 }, { id: 22, name: '사업계획.docx', category: '계획', url: 'https://fixture.invalid/plan.docx', size: 2048 }];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) {
      authRequests += 1;
      return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    }
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      if (largeDuplicateMode && table === 'schedules' && request.method() === 'GET' && url.searchParams.get('select') === duplicateSelect) {
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit') || 500);
        const rows = largeDuplicateRows.slice(offset, offset + limit);
        duplicatePageRequests.push({ offset, limit, count: rows.length, date: url.searchParams.get('date'), overlap: url.searchParams.get('or'), order: url.searchParams.get('order') });
        return reply(rows);
      }
      if (!metadataReady && table === 'schedules' && metadataKeys.some((key) => (url.searchParams.get('select') || '').includes(key))) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42703', message: 'column schedules.owner_name does not exist' }) });
      if (request.method() !== 'GET') {
        const body = request.postDataJSON();
        writes.push({ table, method: request.method(), body });
        if (!metadataReady && table === 'schedules' && (Array.isArray(body) ? body : [body]).some((entry) => metadataKeys.some((key) => Object.hasOwn(entry, key)))) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST204', message: 'Could not find optional metadata columns' }) });
        if (table === 'schedules' && request.method() === 'POST') schedules.push(...(Array.isArray(body) ? body : [body]).map((entry) => ({ id: nextId++, ...entry })));
        if (table === 'schedules' && request.method() === 'PATCH') {
          const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
          const target = schedules.find((schedule) => schedule.id === id);
          if (target) Object.assign(target, body);
        }
        return reply([]);
      }
      return reply(table === 'schedules' ? metadataReady ? schedules : schedules.map((schedule) => Object.fromEntries(Object.entries(schedule).filter(([key]) => !metadataKeys.includes(key)))) : table === 'files' ? files : []);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    prompts.push(dialog.message());
    if (confirmAnswers.shift() === true) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.clock.setFixedTime(new Date('2026-11-11T01:00:00Z'));
  const nativeForm = () => page.locator('dialog[open]');
  const openNew = async () => {
    await page.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).click();
    await nativeForm().waitFor();
    return nativeForm();
  };
  const openDetails = async (title) => {
    await page.locator('[data-calendar-detail-category]').filter({ hasText: title }).first().click();
    return page.getByRole('dialog', { name: '일정 상세', exact: true });
  };
  const saveAndClose = async (form) => {
    await form.locator('button[type="submit"]').click();
    await form.waitFor({ state: 'hidden' });
  };
  const scheduleWrites = () => writes.filter((write) => write.table === 'schedules');
  try {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    const personalName = page.getByLabel('내 일정 기준 이름', { exact: true });
    const personalFilter = page.getByRole('button', { name: '내 일정만', exact: true });
    const allFilter = page.getByRole('button', { name: '전체 일정', exact: true });
    const calendarCards = page.locator('[data-calendar-detail-category]');
    await calendarCards.first().waitFor();
    assert.equal(await calendarCards.count(), 5);
    const authBeforeFilter = authRequests;
    const originalSchedules = JSON.stringify(schedules);
    assert.match(await personalName.getAttribute('title'), /접근 권한 설정이 아닙니다/);
    await personalName.fill(' 김민수 ');
    await personalFilter.click();
    await calendarCards.filter({ hasText: '기존 회의' }).waitFor({ state: 'hidden' });
    assert.equal(await calendarCards.count(), 2, 'owner and attendee exact matches are both included');
    await calendarCards.filter({ hasText: '담당 일치 확인' }).waitFor();
    await calendarCards.filter({ hasText: '참석 일치 확인' }).waitFor();
    assert.equal(await calendarCards.filter({ hasText: '다른 사람만 있는 업무' }).count(), 0, 'similar person names do not match');
    assert.equal(await calendarCards.filter({ hasText: '김민수 이름만 들어간 업무' }).count(), 0, 'a person name in the title is not ownership');
    assert.equal(await personalFilter.getAttribute('aria-pressed'), 'true');
    await personalName.fill('김');
    await calendarCards.first().waitFor({ state: 'hidden' });
    assert.equal(await calendarCards.count(), 0, 'a partial name is not an exact person match');
    await allFilter.click();
    await calendarCards.filter({ hasText: '기존 회의' }).waitFor();
    assert.equal(await calendarCards.count(), 5, 'all records remain accessible after filtering');
    await personalName.fill('김민수');
    await personalFilter.click();
    await calendarCards.filter({ hasText: '기존 회의' }).waitFor({ state: 'hidden' });
    await personalName.fill('');
    await calendarCards.filter({ hasText: '기존 회의' }).waitFor();
    assert.equal(await calendarCards.count(), 5, 'clearing the person name restores the full view');
    assert.equal(await allFilter.getAttribute('aria-pressed'), 'true');
    assert.equal(await personalFilter.isDisabled(), true);
    assert.equal(authRequests, authBeforeFilter, 'view changes do not change authentication');
    assert.equal(JSON.stringify(schedules), originalSchedules, 'filter changes never mutate schedule data');
    assert.equal(writes.length, 0, 'personal filtering makes no permission or data writes');

    let form = await openNew();
    assert.equal(await form.locator('input[name="title"]').evaluate((input) => document.activeElement === input), true);
    await form.locator('button[type="submit"]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await form.getByRole('button', { name: '일정 창 닫기' }).evaluate((button) => document.activeElement === button), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await form.locator('button[type="submit"]').evaluate((button) => document.activeElement === button), true);
    await page.keyboard.press('Escape');
    await form.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '이 날짜에 일정 추가', exact: true }).evaluate((button) => document.activeElement === button), true);

    form = await openNew();
    await form.locator('input[name="title"]').fill('새 사업 협의');
    await form.getByLabel('시작 시간 직접 입력').fill('930');
    await form.getByLabel('시작 시간 직접 입력').press('Tab');
    await form.getByLabel('종료 시간 직접 입력').fill('1100');
    await form.getByLabel('종료 시간 직접 입력').press('Tab');
    const timeSize = await form.getByLabel('시작 시간 직접 입력').evaluate((input) => {
      const box = input.getBoundingClientRect();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = getComputedStyle(input).font;
      return { width: box.width, textWidth: context.measureText(input.value).width, scrollWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.ok(timeSize.width > timeSize.textWidth + 20, 'mobile time text has ample visible width');
    assert.ok(timeSize.scrollWidth <= timeSize.viewport, 'no horizontal mobile overflow');
    await form.locator('summary').filter({ hasText: '추가 정보' }).click();
    await form.getByLabel('담당자', { exact: true }).fill('김민수');
    await form.getByLabel('장소', { exact: true }).fill('본관 2층 회의실');
    await form.getByLabel('참석자', { exact: true }).fill('김민수, 이지영, 김민수');
    await form.getByRole('searchbox').fill('협의');
    await form.getByRole('checkbox', { name: /협의자료/ }).check();
    const footerBefore = await form.locator('footer').boundingBox();
    await form.locator('form > div').evaluate((body) => { body.scrollTop = body.scrollHeight; });
    const footerAfter = await form.locator('footer').boundingBox();
    assert.ok(Math.abs(footerAfter.y - footerBefore.y) < 1 && footerAfter.y + footerAfter.height <= 844, 'save/cancel remain inside mobile viewport while form body scrolls');
    await form.getByRole('button', { name: '공지사항', exact: true }).click();
    await form.getByRole('button', { name: 'TO DO', exact: true }).click();
    await form.getByRole('button', { name: '긴급', exact: true }).click();
    await page.screenshot({ path: path.join(os.tmpdir(), 'my-portal-schedule-form-mobile.png') });
    await saveAndClose(form);
    let saved = scheduleWrites().at(-1).body[0];
    assert.equal(saved.start_time, '09:30');
    assert.equal(saved.end_time, '11:00');
    assert.equal(saved.owner_name, '김민수');
    assert.deepEqual(saved.attendee_names, ['김민수', '이지영']);
    assert.deepEqual(saved.linked_file_ids, [21]);
    assert.equal(saved.location, '본관 2층 회의실');
    assert.ok(saved.is_notice && saved.is_todo && saved.is_urgent);

    let detail = await openDetails('새 사업 협의');
    await detail.getByRole('button', { name: '일정 수정', exact: true }).click();
    form = nativeForm();
    assert.equal(await form.getByLabel('담당자', { exact: true }).inputValue(), '김민수');
    assert.equal(await form.getByLabel('참석자', { exact: true }).inputValue(), '김민수, 이지영');
    assert.equal(await form.getByRole('checkbox', { name: /협의자료/ }).isChecked(), true);
    await form.getByLabel('장소', { exact: true }).fill('본관 3층 회의실');
    await saveAndClose(form);
    assert.equal(scheduleWrites().at(-1).method, 'PATCH');
    assert.equal(scheduleWrites().at(-1).body.location, '본관 3층 회의실');
    assert.equal(prompts.length, 0, 'editing excludes its own row from duplicate check');

    detail = await openDetails('새 사업 협의');
    await detail.getByRole('button', { name: '일정 복사', exact: true }).click();
    form = nativeForm();
    assert.equal(await form.getByLabel('장소', { exact: true }).inputValue(), '본관 3층 회의실');
    await form.getByLabel('일정 날짜', { exact: true }).fill('2026-11-12');
    await saveAndClose(form);
    saved = scheduleWrites().at(-1).body[0];
    assert.equal(saved.date, '2026-11-12');
    assert.equal(saved.owner_name, '김민수');
    assert.deepEqual(saved.attendee_names, ['김민수', '이지영']);
    assert.deepEqual(saved.linked_file_ids, [21]);
    assert.equal(saved.is_completed, false);

    form = await openNew();
    await form.locator('input[name="title"]').fill('주간 시스템 점검');
    await form.locator('summary').filter({ hasText: '추가 정보' }).click();
    await form.getByLabel('담당자', { exact: true }).fill('임시 담당자');
    await form.getByRole('checkbox', { name: /사업계획/ }).check();
    await form.getByRole('button', { name: '취소', exact: true }).click();
    form = await openNew();
    await form.getByRole('button', { name: '복원', exact: true }).click();
    assert.equal(await form.locator('input[name="title"]').inputValue(), '주간 시스템 점검');
    assert.equal(await form.getByLabel('담당자', { exact: true }).inputValue(), '임시 담당자');
    assert.equal(await form.getByRole('checkbox', { name: /사업계획/ }).isChecked(), true);
    await form.locator('summary').filter({ hasText: '반복 일정' }).click();
    await form.getByRole('button', { name: '매주 수요일', exact: true }).click();
    await saveAndClose(form);
    const repeated = scheduleWrites().at(-1).body;
    assert.ok(repeated.length > 1);
    assert.ok(repeated.every((entry) => entry.owner_name === '임시 담당자' && entry.linked_file_ids[0] === 22));
    assert.ok(writes.some((write) => write.table === 'schedule_recurrence_groups'));
    assert.equal(await page.evaluate(() => localStorage.getItem('schedule-draft:2026-11-11')), null);

    form = await openNew();
    await form.locator('input[name="title"]').fill('기존 회의');
    const writesBeforeCancel = scheduleWrites().length;
    confirmAnswers.push(false);
    await form.locator('button[type="submit"]').click();
    await form.getByRole('alert').waitFor();
    assert.match(await form.getByRole('alert').innerText(), /저장하지 않았습니다/);
    assert.equal(scheduleWrites().length, writesBeforeCancel);
    assert.ok(prompts.at(-1).includes('동일한 내용'));
    confirmAnswers.push(true);
    await saveAndClose(form);
    assert.equal(scheduleWrites().length, writesBeforeCancel + 1);
    assert.equal(prompts.length, 2);

    largeDuplicateMode = true;
    form = await openNew();
    await form.locator('input[name="title"]').fill(paginatedDuplicateTitle);
    const writesBeforePagedCancel = writes.length;
    const promptsBeforePagedCancel = prompts.length;
    confirmAnswers.push(false);
    await form.locator('button[type="submit"]').click();
    await form.getByRole('alert').waitFor();
    assert.match(await form.getByRole('alert').innerText(), /저장하지 않았습니다/);
    assert.equal(prompts.length, promptsBeforePagedCancel + 1, 'the matching 501st row triggers confirmation');
    assert.ok(prompts.at(-1).includes(paginatedDuplicateTitle));
    assert.deepEqual(duplicatePageRequests, [
      { offset: 0, limit: 500, count: 500, date: 'lte.2026-11-11', overlap: '(end_date.gte.2026-11-11,date.gte.2026-11-11)', order: 'id.asc' },
      { offset: 500, limit: 500, count: 1, date: 'lte.2026-11-11', overlap: '(end_date.gte.2026-11-11,date.gte.2026-11-11)', order: 'id.asc' },
    ], 'duplicate search follows the ordered, date-bounded second page');
    assert.equal(writes.length, writesBeforePagedCancel, 'cancelling a second-page duplicate performs zero writes');
    await form.getByRole('button', { name: '취소', exact: true }).click();
    largeDuplicateMode = false;

    metadataReady = false;
    const legacyProbe = page.waitForResponse((response) => response.status() === 400 && new URL(response.url()).searchParams.get('select') === metadataKeys.join(','));
    await page.reload();
    await legacyProbe;
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    assert.equal(await personalName.isDisabled(), true, 'personal view is unavailable without metadata columns');
    assert.equal(await personalFilter.isDisabled(), true);
    assert.equal(await allFilter.getAttribute('aria-pressed'), 'true');
    form = await openNew();
    await form.locator('input[name="title"]').fill('기본 일정 호환성 검증');
    await form.locator('summary').filter({ hasText: '추가 정보' }).click();
    await form.getByRole('status').filter({ hasText: '추가 정보 저장 기능을 준비 중입니다' }).waitFor();
    for (const label of ['담당자', '참석자', '장소']) assert.equal(await form.getByLabel(label, { exact: true }).isDisabled(), true);
    assert.equal(await form.getByRole('checkbox', { name: /협의자료/ }).isDisabled(), true);
    const beforeLegacySave = scheduleWrites().length;
    await saveAndClose(form);
    assert.equal(scheduleWrites().length, beforeLegacySave + 1, 'basic schedules still save without the additive SQL');
    saved = scheduleWrites().at(-1).body[0];
    assert.equal(saved.title, '기본 일정 호환성 검증');
    assert.equal(saved.date, '2026-11-11');
    for (const key of metadataKeys) assert.equal(Object.hasOwn(saved, key), false, key + ' is omitted for the old schema');
    await calendarCards.filter({ hasText: '기본 일정 호환성 검증' }).waitFor();
    assert.deepEqual(errors, []);
    assert.ok(writes.every((write) => ['schedules', 'schedule_recurrence_groups'].includes(write.table)), 'only intended mocked schedule writes');
    console.log(JSON.stringify({ passed: true, cases: ['exact owner/attendee personal view, not a permission change', 'other people, partial names and title-only names excluded', 'clearing person restores all schedules without writes', 'native modal focus trap, Escape and restoration', '390px time input and sticky save/cancel', 'optional metadata and document create/edit/copy', 'attendee deduplication', 'notice/todo/urgent preserved', 'draft restoration with metadata', 'recurrence with metadata', 'duplicate cancellation and confirmed save', '501st-row duplicate found across date-bounded pages and cancellation writes nothing', 'old schema disables optional controls but saves basic schedule without new fields'], screenshot: path.join(os.tmpdir(), 'my-portal-schedule-form-mobile.png') }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(-5000));
    console.error('Browser errors:', errors);
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
