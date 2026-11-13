/* eslint-disable @typescript-eslint/no-require-imports -- Optional local-only Playwright regression; remote data is mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'Run only against the mocked local application');
const NOW = new Date('2026-11-13T03:30:00Z');
const event = (id, schedule_type, title, options = {}) => ({ id, title, schedule_type, date: '2026-11-13', end_date: null, start_time: null, end_time: null, is_notice: false, is_todo: false, is_completed: false, is_urgent: false, absence_type: 'annual', ...options });
const examples = [
  event(1, 'meeting', '팀 주간업무 점검', { start_time: '09:00', end_time: '10:00' }),
  event(2, 'internal', '협의회 실무 간담회', { start_time: '12:00', end_time: '13:00' }),
  event(3, 'meeting', '정책결정회의', { start_time: '13:00', end_time: '14:00', location: '2층 회의실' }),
  event(4, 'business_trip', '보건소 방문 협의', { start_time: '15:00', end_time: null }),
  event(5, 'unclassified', '방문재활 사례 검토'),
  event(6, 'business_trip', '지역 행사 의료지원', { date: '2026-11-14', start_time: '09:00', end_time: '17:00' }),
  event(7, 'internal', '주간 시설 점검', { date: '2026-11-15', start_time: '10:00', end_time: null }),
  event(8, 'meeting', '팀회의', { date: '2026-11-16', start_time: '10:00', end_time: '11:00' }),
  event(9, 'business_trip', '방문재활 · 강릉', { date: '2026-11-17', start_time: '09:30', end_time: null }),
  event(10, 'internal', '지역 협력기관 업무협약', { date: '2026-11-18', start_time: '14:00', end_time: '15:00' }),
  event(11, 'meeting', '확대간부회의', { date: '2026-11-19', start_time: '16:00', end_time: '17:00' }),
  event(12, 'internal', '직원 교육', { date: '2026-11-20', start_time: '10:00', end_time: '11:30' }),
  event(13, 'unclassified', '월간 실적 제출', { date: '2026-11-12', is_todo: true }),
  event(14, 'internal', '공유 자료 최신본 확인', { is_todo: true }),
  event(15, 'internal', '협력기관 방문 안내', { date: '2026-11-16', is_notice: true, is_urgent: true }),
  event(16, 'leave', '휴가) 희', { owner_name: '희' }),
  event(17, 'leave', '외출) 기', { owner_name: '기', absence_type: 'outing', start_time: '15:00', end_time: '16:00' }),
  event(18, 'leave', '휴가) 예', { owner_name: '예', date: '2026-11-16', end_date: '2026-11-17' }),
  event(19, 'leave', '조퇴) 롱', { owner_name: '롱', date: '2026-11-18', absence_type: 'early_pm', start_time: '14:00', end_time: null }),
];
let fixtures = [...examples];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, timezoneId: 'Asia/Seoul' });
  const errors = [], writes = [], screenshots = [], measurements = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) { if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`); return reply(url.pathname.endsWith('/schedules') ? fixtures : []); }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  await context.addInitScript(() => {
    let fullscreen = null;
    window.__fullscreenRequests = 0; window.__closed = false;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Fullscreen mock retains the requested DOM element.
    Element.prototype.requestFullscreen = async function () { fullscreen = this; window.__fullscreenRequests += 1; document.dispatchEvent(new Event('fullscreenchange')); };
    document.exitFullscreen = async () => { fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
    window.resizeTo = () => {}; window.moveTo = () => {}; window.close = () => { window.__closed = true; };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: NOW });
  const board = () => page.locator('[data-kiosk-board]');
  const panel = (key) => page.locator(`[data-kiosk-panel="${key}"]`);
  const capture = async (name) => {
    const file = path.join(os.tmpdir(), `my-portal-kiosk-v2${name}.png`);
    const overlay = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.screenshot({ path: file }); screenshots.push(file); await overlay.evaluate((node) => node.remove());
  };
  const settle = async () => { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForTimeout(350); };
  const assertFits = async (name, mobile = false) => {
    await settle();
    const geometry = await board().evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, top: box.top, docWidth: document.documentElement.scrollWidth, rootWidth: node.clientWidth, rootScrollWidth: node.scrollWidth, rootHeight: node.clientHeight, rootScrollHeight: node.scrollHeight, bottom: box.bottom,
        panels: [...node.querySelectorAll('[data-kiosk-panel]')].map((panel) => { const rect = panel.getBoundingClientRect(); return { key: panel.dataset.kioskPanel, x: rect.x, y: rect.y, bottom: rect.bottom, right: rect.right, height: rect.height, width: rect.width, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight, clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth }; }),
        events: [...node.querySelectorAll('[data-kiosk-event-id]')].map((row) => { const rect = row.getBoundingClientRect(); const viewport = row.closest('ul')?.parentElement?.getBoundingClientRect(); return { id: row.dataset.kioskEventId, height: rect.height, right: rect.right, bottom: rect.bottom, viewportBottom: viewport?.bottom, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, scrollHeight: row.scrollHeight, clientHeight: row.clientHeight }; }),
      };
    });
    assert.ok(geometry.docWidth <= geometry.width + 1 && geometry.rootScrollWidth <= geometry.rootWidth + 2, `${name}: no horizontal overflow ${JSON.stringify(geometry)}`);
    if (!mobile) {
      assert.ok(geometry.top === 0 && Math.abs(geometry.bottom - geometry.height) <= 1 && geometry.rootScrollHeight <= geometry.rootHeight + 2, `${name}: board fills exactly one screen: top ${geometry.top}, bottom ${geometry.bottom}, height ${geometry.height}`);
      for (const item of geometry.panels) assert.ok(item.bottom <= geometry.height + 1 && item.right <= geometry.width + 1 && item.scrollHeight <= item.clientHeight + 2, `${name}: full ${item.key} panel fits: ${JSON.stringify(item)}`);
    } else {
      // Main panels share framed containers; the borderless support strip uses its own full-width track.
      for (const keys of [['today', 'absences-today', 'this-week', 'next-week'], ['notices', 'todos', 'absences-upcoming']]) {
        const group = geometry.panels.filter((item) => keys.includes(item.key));
        for (const item of group) assert.ok(Math.abs(item.width - group[0].width) <= 2, `${name}: mobile ${keys[0]} group uses a consistent full width: ${item.key}`);
      }
    }
    for (const item of geometry.events) assert.ok(item.height >= 38 && item.scrollWidth <= item.clientWidth + 2 && item.scrollHeight <= item.clientHeight + 2 && (!item.viewportBottom || item.bottom <= item.viewportBottom + 2), `${name}: event is readable and not clipped: ${JSON.stringify(item)}`);
    measurements.push({ name, ...geometry }); return geometry;
  };
  const load = async () => { await page.goto(`${baseUrl}/kiosk`); await board().waitFor(); await settle(); };
  try {
    await load();
    await page.locator('[data-kiosk-autoplay="true"]').click();
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await assertFits(`normal ${viewport.width}`, viewport.width < 700); await capture(`preview-${viewport.width}`);
      if (viewport.width >= 1000) {
        const todayBox = await panel('today').boundingBox();
        const thisWeekBox = await panel('this-week').boundingBox();
        const nextWeekBox = await panel('next-week').boundingBox();
        assert.ok(thisWeekBox.width >= todayBox.width * 1.5, 'weekly agenda receives substantially more width than today');
        assert.ok(Math.abs(thisWeekBox.x - nextWeekBox.x) <= 2 && Math.abs(thisWeekBox.width - nextWeekBox.width) <= 2, 'both weeks share a continuous agenda column');
        assert.ok(nextWeekBox.y >= thisWeekBox.y + thisWeekBox.height && nextWeekBox.y - thisWeekBox.y - thisWeekBox.height <= 20, 'next week immediately follows this week, without an empty central island');
      }
      if (viewport.width === 1920) {
        assert.ok(await panel('today').locator('[data-kiosk-event-id]').count() >= 3, 'large screen shows at least three today events');
        assert.equal(await panel('absences-today').locator('[data-kiosk-event-id]').count(), 2, 'large screen shows both today absences immediately');
        assert.equal(await panel('this-week').locator('[data-kiosk-event-id]').count(), 2, 'wide agenda shows this week immediately');
        assert.equal(await panel('next-week').locator('[data-kiosk-event-id]').count(), 6, 'wide agenda shows all six next-week examples without unused central space');
      }
      if (viewport.width === 1366) assert.ok(await panel('today').locator('[data-kiosk-event-id]').count() >= 2, 'laptop screen shows at least two today events');
      if (viewport.width < 700) {
        await board().evaluate((node) => { node.scrollTop = node.scrollHeight; });
        assert.ok(await panel('absences-upcoming').evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight + 2), 'mobile can scroll to the final panel');
        await board().evaluate((node) => { node.scrollTop = 0; });
      }
    }
    fixtures = examples.filter((item) => [1, 2, 6, 7, 8, 9, 16, 17, 18, 19].includes(item.id)).map((item) => item.id === 1 ? { ...item, is_notice: true, is_todo: true } : item);
    await page.setViewportSize({ width: 1280, height: 720 }); await load();
    await assertFits('sparse boundary 2+2+2+2 with support 1280'); await capture('sparse-boundary-1280');
    assert.equal(await board().getAttribute('data-kiosk-sparse'), 'true', 'two events in each main section uses the compact layout');
    if (process.env.KIOSK_PREVIEW_ONLY === '1') { console.log(JSON.stringify({ passed: true, previewOnly: true, screenshots, browserErrors: errors.length, externalWrites: writes.length }, null, 2)); assert.deepEqual(errors, []); assert.deepEqual(writes, []); return; }
    fixtures = [...examples]; await load(); await page.locator('[data-kiosk-autoplay="true"]').click();
    await page.setViewportSize({ width: 1920, height: 1080 }); await settle();
    assert.equal(await panel('absences-today').locator('[data-kiosk-event-id="16"]').count(), 1);
    assert.equal(await panel('absences-upcoming').locator('[data-kiosk-event-id="18"]').count(), 1);
    assert.equal(await panel('absences-upcoming').locator('[data-kiosk-event-id="16"]').count(), 0, 'today absence is not duplicated among upcoming leave');
    const todayRows = new Map();
    const todayList = panel('today').locator('[data-kiosk-rotation]');
    const todayPages = Number(await todayList.getAttribute('data-kiosk-pages'));
    for (let index = 0; index < todayPages; index += 1) {
      for (const row of await todayList.locator('[data-kiosk-event-id]').evaluateAll((rows) => rows.map((node) => [node.dataset.kioskEventId, node.dataset.kioskEventStatus]))) todayRows.set(...row);
      if (todayPages > 1) await todayList.getByRole('button', { name: '오늘 일정 다음 페이지', exact: true }).click();
    }
    assert.equal(todayRows.get('1'), 'ended', 'only definite end time makes an event ended');
    assert.equal(todayRows.get('2'), 'ongoing');
    assert.equal(todayRows.get('3'), 'soon');
    assert.equal(todayRows.get('5'), 'unknown', 'untimed event is never falsely marked ongoing or ended');
    const firstClock = await board().locator('time').getAttribute('dateTime');
    await page.clock.fastForward(1100); await settle();
    assert.notEqual(await board().locator('time').getAttribute('dateTime'), firstClock, 'seconds keep ticking');
    await page.keyboard.press('F8'); await board().waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '전광판 다시 전체 화면으로 펼치기', exact: true }).waitFor();
    await page.keyboard.press('F8'); await board().waitFor();
    assert.ok(await page.evaluate(() => window.__fullscreenRequests >= 2), 'F8 restoration requests full screen again');
    fixtures = [event(41, 'meeting', '오늘 한 건의 회의', { start_time: '14:00', end_time: '15:00' })];
    await load();
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport); await assertFits(`sparse ${viewport.width}`); await capture(`sparse-${viewport.width}`);
      assert.ok((await panel('today').boundingBox()).height < 260, 'single event does not fill an oversized empty panel');
    }
    fixtures = []; await load(); await assertFits('empty'); await capture('empty');
    fixtures = Array.from({ length: 50 }, (_, index) => event(100 + index, ['meeting', 'internal', 'business_trip'][index % 3], `다음 주 일정 ${index + 1}${index % 10 === 0 ? ' · 지역사회 협력기관 보건의료 연계사업 추진 현황 및 운영 계획 논의' : ''}`, { date: '2026-11-16', start_time: '10:00', end_time: '11:00' }));
    await load();
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); await assertFits(`busy ${viewport.width}`, viewport.width < 700); await capture(`busy-${viewport.width}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 }); await settle();
    const rotating = panel('next-week').locator('[data-kiosk-rotation]');
    const pages = Number(await rotating.getAttribute('data-kiosk-pages'));
    assert.ok(pages > 1, '50 events have multiple accessible pages');
    const seen = new Set();
    await rotating.focus(); await rotating.press('Home');
    for (let index = 0; index < pages; index += 1) {
      await settle(); await assertFits(`busy page ${index + 1}`);
      for (const id of await rotating.locator('[data-kiosk-event-id]').evaluateAll((rows) => rows.map((node) => node.dataset.kioskEventId))) seen.add(id);
      await rotating.getByRole('button', { name: '다음 주 일정 다음 페이지', exact: true }).click();
    }
    assert.equal(seen.size, 50, 'all events remain accessible without an inaccessible other-count');
    const currentPage = () => rotating.getAttribute('data-kiosk-page');
    const unchangedForCycle = async (reason) => { const before = await currentPage(); await page.clock.fastForward(9000); await settle(); assert.equal(await currentPage(), before, reason); };
    const resume = async () => { await page.evaluate(() => document.activeElement?.blur()); await page.mouse.move(2, 2); await settle(); };
    await resume();
    assert.equal(await rotating.getAttribute('data-kiosk-playing'), 'true');
    const firstPage = await currentPage(); await page.clock.fastForward(8100); await settle();
    assert.notEqual(await currentPage(), firstPage, 'automatic advance after eight seconds');
    await rotating.hover(); await unchangedForCycle('hover pauses automatic paging');
    await resume(); await rotating.focus(); await rotating.press('Home');
    await unchangedForCycle('keyboard navigation/focus pauses automatic paging');
    await resume();
    await page.locator('[data-kiosk-autoplay="true"]').click(); await unchangedForCycle('global pause stops all lists');
    assert.equal(await rotating.getAttribute('data-kiosk-playing'), 'false');
    await page.locator('[data-kiosk-autoplay="false"]').click(); await resume();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settle(); await unchangedForCycle('reduced motion disables automatic paging');
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await resume();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await settle();
    await unchangedForCycle('background tab does not advance pages');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await resume();
    assert.equal(await rotating.getAttribute('data-kiosk-playing'), 'true');
    fixtures = Array.from({ length: 12 }, (_, index) => [
      event(300 + index, 'internal', `오늘의 업무 일정 ${index + 1}`, { start_time: '14:00', end_time: '15:00', is_notice: true, is_todo: true }),
      event(400 + index, 'leave', `휴가) 팀원 ${index + 1}`, { owner_name: `팀원 ${index + 1}` }),
      event(500 + index, 'leave', `휴가) 팀원 ${index + 1}`, { owner_name: `팀원 ${index + 1}`, date: '2026-11-16' }),
    ]).flat();
    await load(); await page.locator('[data-kiosk-autoplay="true"]').click();
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport); await assertFits(`all panels busy ${viewport.width}`); await capture(`all-panels-busy-${viewport.width}`);
      for (const key of ['today', 'absences-today', 'notices', 'todos', 'absences-upcoming']) {
        const list = panel(key).locator('[data-kiosk-rotation]');
        const listPages = Number(await list.getAttribute('data-kiosk-pages'));
        const label = await list.getAttribute('data-kiosk-rotation');
        const seenRows = new Set();
        for (let index = 0; index < listPages; index += 1) {
          for (const id of await list.locator('[data-kiosk-event-id]').evaluateAll((rows) => rows.map((node) => node.dataset.kioskEventId))) seenRows.add(id);
          await list.getByRole('button', { name: `${label} 다음 페이지`, exact: true }).click();
        }
        assert.equal(seenRows.size, 12, `${key} ${viewport.width}: all twelve records remain accessible`);
      }
    }
    await page.getByRole('button', { name: '전광판 닫기', exact: true }).click(); await page.waitForURL('about:blank');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    console.log(JSON.stringify({ passed: true, screenshots, checks: measurements.map(({ name, width, height, panels, events }) => ({ name, width, height, panels: panels.length, visibleEvents: events.length })), browserErrors: errors.length, externalWrites: writes.length }, null, 2));
  } catch (error) { await capture('failure').catch(() => undefined); console.error((await page.locator('body').innerText()).slice(0, 4000)); console.error('Browser errors:', errors); throw error; }
  finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
