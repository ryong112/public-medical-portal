/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright regression test; all remote data is mocked. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));
const event = (id, schedule_type, title, overrides = {}) => ({ id, schedule_type, title, date: '2026-11-12', end_date: null, start_time: '10:00', end_time: '11:00', is_notice: false, is_urgent: false, is_todo: false, is_completed: false, ...overrides });
const fixtures = [
  event(1, 'business_trip', '현장 방문', { owner_name: '김담당', attendee_names: ['이참석'], location: '회의실 A', is_notice: true, is_urgent: true }),
  event(2, 'internal', '기관 협의회', { start_time: '09:00' }), event(3, 'meeting', '정책결정회의'),
  event(4, 'unclassified', '문서 정리', { is_todo: true }), event(5, 'leave', '휴가) 이팀원', { start_time: null, end_time: null }),
  event(6, 'unclassified', '기한 지난 업무', { date: '2026-11-10', is_todo: true }),
  event(7, 'meeting', '내일 회의', { date: '2026-11-13' }), event(8, 'business_trip', '다음 주 방문', { date: '2026-11-18' }),
];
const normalFixtures = structuredClone(fixtures);
const mixedFixtures = [
  ...normalFixtures,
  event(9, 'business_trip', '의료지원 협의 방문', { date: '2026-11-16', owner_name: '박담당', location: '협력 병원', is_notice: true }),
  event(10, 'internal', '업무협약 사전 간담회', { date: '2026-11-17', owner_name: '이팀원' }),
  event(11, 'leave', '조퇴) 박팀원', { start_time: '15:00', end_time: null, owner_name: '박팀원', absence_type: 'early_pm' }),
  event(12, 'meeting', '교육 운영 회의', { date: '2026-11-13', start_time: '14:00', end_time: '15:00', owner_name: '김담당', location: '교육실' }),
  event(13, 'business_trip', '지역 행사 의료지원', { date: '2026-11-14', start_time: '09:00', owner_name: '박담당', location: '시민회관' }),
  event(14, 'internal', '주간 자료 정리', { date: '2026-11-15', start_time: null, end_time: null, owner_name: '이팀원' }),
];
const sparseFixtures = [
  event(20, 'leave', '휴가-희', { start_time: null, end_time: null, absence_type: 'annual' }),
  event(21, 'internal', '보육교사교육', { date: '2026-11-13', start_time: '16:00', end_time: null }),
  event(22, 'internal', '농아인협회 MOU관련-룡', { date: '2026-11-13', start_time: null, end_time: null }),
  event(23, 'leave', '휴가-희', { date: '2026-11-13', start_time: null, end_time: null, absence_type: 'annual' }),
];
const viewports = [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1366, height: 640 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 640 }];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: viewports[0], timezoneId: 'Asia/Seoul' });
  const errors = [], writes = [], screenshots = [], measurements = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  const mockRoute = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') writes.push(url.pathname);
      if (url.pathname.endsWith('/categories')) return reply([{ id: 501, name: '26년 팀회의', order_index: 0 }, { id: 502, name: '26년 팀회의록', order_index: 1 }, { id: 503, name: '공유자료', order_index: 2 }]);
      if (url.pathname.endsWith('/schedules')) {
        if (request.method() === 'PATCH') {
          const id = Number(url.searchParams.get('id')?.replace('eq.', ''));
          Object.assign(fixtures.find((schedule) => schedule.id === id), request.postDataJSON());
        }
        return reply(fixtures);
      }
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  };
  await context.route('**/*', mockRoute);
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-12T01:00:00Z'));
  const dashboard = () => page.locator('[data-dashboard-root]');
  const dayPanel = (day) => page.locator(`[data-dashboard-day="${day}"]`);
  const rows = (scope) => scope.locator('[data-schedule-id]');
  const legend = () => page.locator('[data-dashboard-legend]');
  const summary = (key) => page.locator(`[data-dashboard-summary="${key}"]`);
  const peek = () => page.locator('[data-anchored-preview][data-state="open"]');
  const summaryTrigger = (key) => summary(key).locator('[data-anchored-preview-trigger]');
  const dateTrigger = (date) => dashboard().locator(`[data-dashboard-week-trigger="${date}"]`);
  const nextButton = (scope) => scope.getByRole('button', { name: /다음 페이지/ });
  const screenshot = async (name) => {
    const file = path.join(os.tmpdir(), `my-portal-hub-dashboard-${name}.png`);
    const developmentOverlay = await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    try { await page.screenshot({ path: file }); screenshots.push(file); }
    finally { await developmentOverlay.evaluate((element) => element.remove()); }
  };
  const settleLayout = async (viewport) => {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => {
      const aside = document.querySelector('main > aside');
      if (!aside) return true;
      const bounds = aside.getBoundingClientRect();
      return innerWidth >= 1280 ? bounds.left >= -0.5 : bounds.right <= 1;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const assertFits = async (label) => {
    const geometry = await page.evaluate(() => {
      const selectors = ['[data-dashboard-root]', '[data-dashboard-root] > header', '[data-dashboard-week]', '[data-dashboard-day="today"]', '[data-dashboard-day="tomorrow"]', '[data-dashboard-summary="todo"]', '[data-dashboard-summary="notice"]', '[data-dashboard-summary="week"]', '[data-dashboard-summary="absence"]', 'aside[aria-label="확인할 내용"]', '[data-dashboard-context="todo"]', '[data-dashboard-context="notice"]', '[data-dashboard-context="absence"]'];
      return {
        viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        nodes: selectors.map((selector) => {
          const node = document.querySelector(selector);
          if (!node) return { selector, missing: true };
          const box = node.getBoundingClientRect();
          return { selector, x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
        }).filter((node) => !(node.selector.startsWith('[data-dashboard-context=') || node.selector === 'aside[aria-label="확인할 내용"]') || node.missing || node.height > 0),
        lists: [...document.querySelectorAll('[data-dashboard-list]')].filter((list) => list.getBoundingClientRect().height > 0).map((list) => {
          const box = list.getBoundingClientRect();
          return { name: list.dataset.dashboardList, y: box.y, bottom: box.bottom, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, rows: [...list.querySelectorAll('[data-schedule-id]')].map((row) => {
            const bounds = row.getBoundingClientRect();
            return { id: row.dataset.scheduleId, y: bounds.y, bottom: bounds.bottom, height: bounds.height };
          }) };
        }),
      };
    });
    assert.ok(geometry.document[0] <= geometry.viewport[0] + 1, `${label}: no horizontal page scrolling`);
    assert.ok(geometry.document[1] <= geometry.viewport[1] + 1, `${label}: no vertical page scrolling`);
    const rootWidth = geometry.nodes.find(({ selector }) => selector === '[data-dashboard-root]').width;
    const expectedCapacity = rootWidth <= 570 ? 1 : geometry.viewport[1] <= 760 ? 2 : 3;
    for (const capacity of await dashboard().locator('[data-week-carousel-capacity]').evaluateAll((tiles) => tiles.map((tile) => Number(tile.dataset.weekCarouselCapacity)))) {
      assert.equal(capacity, expectedCapacity, `${label}: weekly tile density adapts to available screen space`);
    }
    for (const node of geometry.nodes) {
      assert.ok(!node.missing, `${label}: ${node.selector} exists`);
      assert.ok(node.height > 0 && node.width > 0, `${label}: ${node.selector} is not collapsed`);
      assert.ok(node.x >= -1 && node.y >= -1 && node.right <= geometry.viewport[0] + 1 && node.bottom <= geometry.viewport[1] + 1, `${label}: ${node.selector} stays entirely in viewport: ${JSON.stringify(node)}`);
      assert.ok(node.scrollHeight <= node.clientHeight + 2 && node.scrollWidth <= node.clientWidth + 2, `${label}: ${node.selector} has no clipped overflowing content: ${JSON.stringify(node)}`);
    }
    for (const list of geometry.lists) {
      assert.ok(list.scrollHeight <= list.clientHeight + 2, `${label}: ${list.name} list is not clipped`);
      for (const row of list.rows) assert.ok(row.y >= list.y - 1 && row.bottom <= list.bottom + 1 && row.height >= 40, `${label}: entire readable row ${row.id} fits ${list.name}: ${JSON.stringify({ list, row })}`);
    }
    measurements.push({ label, ...geometry }); return geometry;
  };
  const assertContentHeight = async (label, counts) => {
    for (const [day, count] of Object.entries(counts)) {
      const panel = dayPanel(day);
      const geometry = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const events = [...element.querySelectorAll('[data-schedule-id]')];
        const last = events.at(-1)?.getBoundingClientRect();
        const navigation = element.querySelector('nav');
        return { height: bounds.height, trailing: last ? bounds.bottom - last.bottom : null, rows: events.length, navigation: Boolean(navigation) };
      });
      assert.equal(await panel.locator('[data-dashboard-count]').innerText(), String(count), `${label}: ${day} keeps its complete count`);
      if (count <= geometry.rows) assert.equal(geometry.navigation, false, `${label}: ${day} single-page list has no redundant pagination`);
      else assert.equal(geometry.navigation, count > 0, `${label}: ${day} overflow has accessible pagination`);
      if (!geometry.navigation && geometry.trailing !== null) assert.ok(geometry.trailing <= 24, `${label}: ${day} does not trap a large blank area below its final row: ${JSON.stringify(geometry)}`);
      if (!count) assert.ok(geometry.height <= 160, `${label}: ${day} empty card remains compact: ${JSON.stringify(geometry)}`);
    }
  };
  const replaceFixtures = async (items) => {
    fixtures.splice(0, fixtures.length, ...structuredClone(items));
    await page.reload();
    await dashboard().waitFor();
    const counts = ['2026-11-12', '2026-11-13'].map((date) => items.filter((item) => item.date <= date && (item.end_date || item.date) >= date).length);
    await page.waitForFunction(([today, tomorrow]) => document.querySelector('[data-dashboard-day="today"] [data-dashboard-count]')?.textContent === String(today) && document.querySelector('[data-dashboard-day="tomorrow"] [data-dashboard-count]')?.textContent === String(tomorrow), counts);
  };
  const visitAllRows = async (scope) => {
    const previousButton = scope.getByRole('button', { name: /이전 페이지/ });
    for (let turns = 0; turns < 150 && await previousButton.count() > 0 && !await previousButton.isDisabled(); turns += 1) await previousButton.click();
    const visited = new Set();
    for (let turns = 0; turns < 150; turns += 1) {
      for (const id of await rows(scope).evaluateAll((elements) => elements.map((element) => Number(element.dataset.scheduleId)))) visited.add(id);
      const next = nextButton(scope);
      if (await next.count() === 0 || await next.isDisabled()) return visited;
      const previous = (await rows(scope).first().getAttribute('data-schedule-id')) ?? '';
      await next.click();
      await page.waitForFunction(({ selector, oldId }) => document.querySelector(`${selector} [data-schedule-id]`)?.getAttribute('data-schedule-id') !== oldId, { selector: await scope.getAttribute('data-dashboard-day') ? `[data-dashboard-day="${await scope.getAttribute('data-dashboard-day')}"]` : 'dialog[open]', oldId: previous });
    }
    throw new Error('Pagination did not reach its final page');
  };
  const visitAllPeekRows = async (list) => {
    const first = list.locator('[data-preview-page-index="0"]');
    if (await first.count()) await first.click();
    const visited = new Set();
    for (let turns = 0; turns < 150; turns += 1) {
      for (const id of await rows(list).evaluateAll((elements) => elements.map((element) => Number(element.dataset.scheduleId)))) visited.add(id);
      const current = Number(await list.getAttribute('data-preview-page-current'));
      const total = Number(await list.getAttribute('data-preview-page-total'));
      if (current === total) return visited;
      await list.focus(); await list.press('PageDown');
      await page.waitForFunction((oldPage) => Number(document.querySelector('[data-preview-wheel-pages]')?.getAttribute('data-preview-page-current')) > oldPage, current);
    }
    throw new Error('Preview dot paging did not reach its final page');
  };
  const assertWeeklyCarousel = async () => {
    const carouselContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Seoul' });
    await carouselContext.route('**/*', mockRoute);
    await carouselContext.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    const carouselPage = await carouselContext.newPage();
    carouselPage.on('pageerror', (error) => errors.push(error.message));
    // Keep virtual time isolated: advancing the rotation test must not disturb
    // the dashboard's normal hover, calendar and wheel timing regressions.
    await carouselPage.clock.install({ time: new Date('2026-11-12T01:00:00Z') });
    await carouselPage.clock.pauseAt(new Date('2026-11-12T01:00:01Z'));
    try {
      await carouselPage.goto(baseUrl);
      for (let attempt = 0; attempt < 8 && !await carouselPage.locator('[data-week-carousel-index]').count(); attempt += 1) {
        await carouselPage.clock.runFor(500); await carouselPage.waitForTimeout(30);
      }
      const tile = carouselPage.locator('[data-dashboard-week-date="2026-11-12"]');
      await tile.waitFor();
      const index = async () => Number(await tile.getAttribute('data-week-carousel-index'));
      const visibleIds = async () => tile.evaluate((element) => {
        const bounds = element.querySelector('[data-week-carousel-viewport]').getBoundingClientRect();
        return [...element.querySelectorAll('[data-week-schedule-id]')].filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && rect.height > 0;
        }).map((row) => Number(row.dataset.weekScheduleId));
      });
      assert.equal(Number(await tile.getAttribute('data-week-visible-count')), 3, 'desktop tiles immediately expose three readable schedule slots');
      assert.equal(await tile.locator('button').count(), 0, 'the entire rotating day tile is a single button, including its event text');
      const initial = await index();
      const visited = new Set(await visibleIds());
      for (let turns = 0; turns < 5; turns += 1) {
        const previous = await index();
        for (let attempt = 0; attempt < 15 && (await index() === previous || await tile.getAttribute('data-week-carousel-moving') === 'true'); attempt += 1) {
          await carouselPage.clock.runFor(500); await carouselPage.waitForTimeout(10);
        }
        assert.equal(await index(), (previous + 1) % 5, 'overflow schedules advance one row in the original order');
        for (const id of await visibleIds()) visited.add(id);
      }
      assert.equal(await index(), initial, 'one complete cycle wraps seamlessly back to its first row');
      assert.deepEqual([...visited].sort((a, b) => a - b), [1, 2, 3, 4, 5], 'every schedule is exposed; the extra animation row never drops an item');
      await tile.hover(); await carouselPage.clock.runFor(6500);
      const hovered = await index();
      await carouselPage.clock.runFor(6500);
      assert.equal(await index(), hovered, 'hover and the open preview keep the reading target still');
      await carouselPage.keyboard.press('Escape'); await carouselPage.clock.runFor(250);
      await carouselPage.mouse.move(5, 5); await carouselPage.clock.runFor(250);
      const pause = carouselPage.locator('[data-week-autoplay-control]');
      await pause.click();
      assert.equal(await pause.getAttribute('aria-pressed'), 'true', 'a visible pause control disables automatic movement');
      const paused = await index(); await carouselPage.clock.runFor(12000);
      assert.equal(await index(), paused, 'manual pause does not silently resume after an interval');
      await pause.click();
      assert.equal(await pause.getAttribute('aria-pressed'), 'false');
      await tile.focus(); await carouselPage.clock.runFor(6500);
      const focused = await index(); await carouselPage.clock.runFor(6500);
      assert.equal(await index(), focused, 'keyboard focus pauses automatic rotation as well as the mini preview');
      await carouselPage.keyboard.press('Escape'); await carouselPage.clock.runFor(250);
      await pause.focus(); await carouselPage.mouse.move(5, 5); await carouselPage.clock.runFor(500);
      await carouselPage.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const hidden = await index(); await carouselPage.clock.runFor(12000);
      assert.equal(await index(), hidden, 'background documents do not continue running a carousel');
      await carouselPage.evaluate(() => {
        delete document.visibilityState; delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await carouselPage.clock.runFor(100); await carouselPage.waitForTimeout(20);
      await carouselPage.emulateMedia({ reducedMotion: 'reduce' });
      await carouselPage.waitForTimeout(50);
      // An already moving row may settle once when motion is disabled. Start
      // checking stability only after that transition has reached a whole row.
      await carouselPage.clock.runFor(600); await carouselPage.waitForTimeout(20);
      assert.equal(await tile.getAttribute('data-week-carousel-paused'), 'true', 'reduced-motion change pauses its timer before the stability window');
      assert.equal(await tile.getAttribute('data-week-carousel-moving'), 'false', 'reduced-motion change settles an in-flight row before the stability window');
      const reduced = await index(); await carouselPage.clock.runFor(12000);
      assert.equal(await index(), reduced, 'reduced motion disables automatic content rotation');
      assert.equal(await pause.isVisible(), false, 'a motion-disabled carousel does not advertise an ineffective playback control');
      const file = path.join(os.tmpdir(), 'my-portal-hub-dashboard-week-carousel-1366x768.png');
      await carouselPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await carouselPage.screenshot({ path: file }); screenshots.push(file);
      await carouselPage.emulateMedia({ reducedMotion: 'no-preference' }); await carouselPage.waitForTimeout(50);
      await carouselPage.clock.runFor(600);
      await carouselPage.getByRole('button', { name: '일정 공유', exact: true }).click();
      assert.equal(await carouselPage.locator('[data-week-carousel-index]').count(), 0, 'leaving the dashboard unmounts every rotating tile');
      await carouselPage.clock.runFor(12000);
    } finally { await carouselContext.close(); }
  };
  try {
    await page.goto(baseUrl);
    await dashboard().waitFor();
    assert.equal(await legend().count(), 1, 'category colors are explained in one static legend');
    assert.equal(await legend().getByRole('button').count(), 0, 'legend never filters or behaves like buttons');
    assert.equal(await legend().locator('[data-dashboard-legend-category]').count(), 5, 'five categories appear once without an unnecessary all button');
    assert.equal(await dashboard().locator('[data-dashboard-week-date]').count(), 7, 'all seven dates are visible without horizontal navigation');
    for (const [offset, label] of ['오늘', '내일', 'D-2', 'D-3', 'D-4', 'D-5', 'D-6'].entries()) {
      const date = `2026-11-${12 + offset}`;
      assert.equal(await dateTrigger(date).getByText(label, { exact: true }).count(), 1, `${date}: proximity is readable directly on its full-day card`);
      assert.equal(await dateTrigger(date).getAttribute('type'), 'button', `${date}: the entire day card is one semantic trigger`);
      assert.equal(await dateTrigger(date).locator('button').count(), 0, `${date}: no nested event buttons bypass the day's preview`);
    }
    assert.equal(await dayPanel('today').getByRole('group', { name: /유형/ }).count(), 0);
    assert.equal(await dashboard().getByText('앞으로 7일', { exact: true }).count(), 0);
    assert.equal(await dashboard().getByText('유형 선택 · 목록 필터', { exact: true }).count(), 0);
    await summary('week').getByText('주간 일정', { exact: true }).waitFor();
    assert.equal(await dayPanel('today').locator('[data-dashboard-count]').innerText(), '5', 'all includes leave');
    assert.equal(await summary('todo').locator('[data-dashboard-count]').innerText(), '2');
    assert.equal(await summary('notice').locator('[data-dashboard-count]').innerText(), '1');
    assert.equal(await summary('week').locator('[data-dashboard-count]').innerText(), '7');
    const initialCount = await dayPanel('today').locator('[data-dashboard-count]').innerText();
    await legend().getByText('회의', { exact: true }).click();
    assert.equal(await dayPanel('today').locator('[data-dashboard-count]').innerText(), initialCount, 'clicking a legend label never hides other categories');
    for (const viewport of viewports) {
      await settleLayout(viewport);
      await assertFits(`normal ${viewport.width}x${viewport.height}`);
      assert.ok(await legend().getByText('내부일정', { exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 12));
      await screenshot(`${viewport.width}x${viewport.height}`);
    }
    await replaceFixtures(mixedFixtures);
    for (const viewport of viewports) {
      await settleLayout(viewport);
      await assertFits(`mixed ${viewport.width}x${viewport.height}`);
      assert.equal(await dashboard().locator('[data-dashboard-week-date]').count(), 7);
      for (const key of ['todo', 'notice', 'absence']) {
        assert.ok((await summary(key).innerText()).trim().length > 0, `${viewport.width}: ${key} remains visible in the overview`);
      }
      if (viewport.width >= 1366 && viewport.height > 720) {
        for (const key of ['todo', 'notice', 'absence']) {
          const contextPanel = dashboard().locator(`[data-dashboard-context="${key}"]`);
          assert.equal(await contextPanel.isVisible(), true, `${key}: actual information is visible on desktop`);
          assert.ok(await contextPanel.locator('[data-preview-schedule-id]').count() > 0, `${key}: important content is not hidden behind its numeric summary`);
        }
      } else if (viewport.height <= 720) {
        for (const key of ['todo', 'notice', 'absence']) {
          assert.equal(await summary(key).locator('[data-preview-schedule-id]').isVisible(), true, `${key}: compact height keeps a concrete title in its summary`);
        }
      }
      await screenshot(`mixed-${viewport.width}x${viewport.height}`);
    }
    await replaceFixtures(sparseFixtures);
    for (const viewport of viewports) {
      await settleLayout(viewport);
      const geometry = await assertFits(`sparse ${viewport.width}x${viewport.height}`);
      await assertContentHeight(`sparse ${viewport.width}x${viewport.height}`, { today: 1, tomorrow: 3 });
      assert.ok(await rows(dayPanel('today')).count() >= 1, `${viewport.width}: today keeps a readable preview row`);
      assert.ok(await rows(dayPanel('tomorrow')).count() >= 1, `${viewport.width}: tomorrow keeps a readable preview row`);
      assert.equal((await visitAllRows(dayPanel('tomorrow'))).size, 3, `${viewport.width}: all three tomorrow events remain accessible`);
      if (viewport.width >= 1024) {
        const today = geometry.nodes.find(({ selector }) => selector === '[data-dashboard-day="today"]');
        const tomorrow = geometry.nodes.find(({ selector }) => selector === '[data-dashboard-day="tomorrow"]');
        assert.ok(today.height <= 150 && tomorrow.height <= 300, `${viewport.width}: one/three events remain compact rather than filling the screen`);
        assert.ok(tomorrow.height - today.height >= 90, `${viewport.width}: cards independently follow their own content height`);
      }
      await screenshot(`sparse-${viewport.width}x${viewport.height}`);
    }
    await replaceFixtures([]);
    for (const viewport of viewports) {
      await settleLayout(viewport);
      await assertFits(`empty ${viewport.width}x${viewport.height}`);
      await assertContentHeight(`empty ${viewport.width}x${viewport.height}`, { today: 0, tomorrow: 0 });
      assert.equal(await dayPanel('today').getByText('오늘은 일정이 없습니다.', { exact: true }).count(), 1);
      assert.equal(await dayPanel('tomorrow').getByText('내일은 일정이 없습니다.', { exact: true }).count(), 1);
      await screenshot(`empty-${viewport.width}x${viewport.height}`);
    }
    await replaceFixtures(normalFixtures);
    await settleLayout(viewports[0]);
    const dismissPeek = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(220);
      assert.equal(await page.locator('[data-anchored-preview]').count(), 0);
      await page.mouse.move(5, 5);
    };
    const assertPeekBounds = async (trigger) => {
      await peek().waitFor();
      await page.waitForTimeout(200);
      assert.equal(await page.locator('[data-anchored-preview]').count(), 1, 'only one mini window exists');
      const surface = await peek().boundingBox();
      const anchor = await trigger.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(surface.x >= 8 && surface.y >= 8 && surface.x + surface.width <= viewport.width - 7 && surface.y + surface.height <= viewport.height - 7, `preview remains within viewport: ${JSON.stringify(surface)}`);
      const origin = await peek().evaluate((element) => getComputedStyle(element).transformOrigin.split(' ').map(parseFloat));
      assert.ok(Math.abs(surface.x + origin[0] - (anchor.x + anchor.width / 2)) <= 24, 'growth originates horizontally from the actual hovered card rather than a fixed screen position');
      assert.ok(Math.min(...[anchor.y, anchor.y + anchor.height / 2, anchor.y + anchor.height].map((value) => Math.abs(surface.y + origin[1] - value))) <= 24, 'growth originates at an edge of the actual hovered card');
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), 'preview never expands the page itself');
    };
    for (const date of ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
      await dateTrigger(date).hover();
      await page.waitForTimeout(70);
    }
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'rapidly crossing date cards never flashes a preview');
    await settleLayout({ width: 1366, height: 768 });
    const hoveredDate = dateTrigger('2026-11-13');
    await hoveredDate.hover(); await page.waitForTimeout(470);
    await assertPeekBounds(hoveredDate);
    assert.equal(await peek().getAttribute('data-preview-pinned'), 'false', 'hover does not pin the preview');
    assert.equal(await peek().locator('[data-schedule-id="7"]').count(), 1, 'hover reveals the selected date contents');
    const sourceBounds = await hoveredDate.boundingBox();
    const previewBounds = await peek().boundingBox();
    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, (sourceBounds.y + sourceBounds.height + previewBounds.y) / 2);
    await page.waitForTimeout(500);
    assert.equal(await peek().count(), 1, 'slowly crossing the visual gap does not dismiss the preview');
    await peek().hover(); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 1, 'moving from the trigger to the mini window preserves it');
    await screenshot('hover-date-1366x768');
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'leaving both trigger and window dismisses it');
    await hoveredDate.hover(); await page.waitForTimeout(470); await peek().waitFor();
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    assert.equal(await peek().count(), 0, 'Escape does not reopen the preview while the pointer is still over its trigger');
    await page.mouse.move(5, 5);
    await dateTrigger('2026-11-18').hover(); await page.waitForTimeout(470);
    await assertPeekBounds(dateTrigger('2026-11-18'));
    await peek().evaluate((element) => { window.__previewSurface = element; });
    await summaryTrigger('notice').hover(); await page.waitForTimeout(470);
    await assertPeekBounds(summaryTrigger('notice'));
    assert.equal(await peek().evaluate((element) => element === window.__previewSurface), true, 'switching categories reuses one window rather than repeatedly creating and destroying it');
    assert.equal(await peek().locator('[data-schedule-id="1"]').count(), 1, 'the existing window switches to the new category');
    await dismissPeek();
    await hoveredDate.click(); await peek().waitFor();
    assert.equal(await peek().getAttribute('data-preview-pinned'), 'true', 'clicking pins the current card');
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 1, 'a pinned card stays visible after pointer exit');
    await dashboard().getByRole('heading', { name: '공공의료지원과 일정', exact: true }).click();
    await page.waitForTimeout(220); assert.equal(await peek().count(), 0, 'outside click closes a pinned card');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await hoveredDate.hover(); await page.waitForTimeout(470); await peek().waitFor();
    assert.equal(await peek().evaluate((element) => getComputedStyle(element).animationName), 'none', 'reduced motion avoids the growing animation');
    await dismissPeek(); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await summaryTrigger('week').hover(); await page.waitForTimeout(470); await peek().waitFor();
    await page.waitForTimeout(100);
    assert.equal(await peek().locator('[data-schedule-id]').count(), 7, 'an ordinary seven-event week expands to show all rows at once when the viewport permits it');
    assert.equal(await peek().locator('[data-schedule-id="2"]').getByText('오늘', { exact: true }).count(), 1, 'the weekly list distinguishes today at the event level');
    assert.equal(await peek().locator('[data-schedule-id="7"]').getByText('내일', { exact: true }).count(), 1, 'the weekly list distinguishes tomorrow at the event level');
    assert.equal(await peek().locator('[data-schedule-id="8"]').getByText('D-6', { exact: true }).count(), 1, 'later weekly events show their exact remaining days');
    assert.equal(await peek().locator('[data-preview-pagination]').count(), 0, 'a list that fits the expanded window does not show unnecessary page dots');
    await assertPeekBounds(summaryTrigger('week')); await screenshot('week-expanded-1366x768');
    await dismissPeek();
    await assertWeeklyCarousel();
    const calendarFixtures = [...normalFixtures,
      event(40, 'leave', '휴가) 과거 제목 이름', { owner_name: '기간 담당', date: '2026-11-11', end_date: '2026-11-13', start_time: null, end_time: null, absence_type: 'annual' }),
      event(41, 'leave', '휴가) 월말 담당', { owner_name: '월말 담당', date: '2026-11-30', end_date: '2026-12-02', start_time: null, end_time: null, absence_type: 'annual' }),
      event(42, 'leave', '조퇴) 과거 제목 이름', { owner_name: '기간 담당', start_time: '13:00', end_time: null, absence_type: 'early_pm' }),
    ];
    await replaceFixtures(calendarFixtures); await settleLayout({ width: 1366, height: 768 });
    await summaryTrigger('absence').hover(); await page.waitForTimeout(470); await page.locator('[data-absence-calendar]').waitFor();
    await assertPeekBounds(summaryTrigger('absence'));
    const calendar = page.locator('[data-absence-calendar]');
    assert.equal(await calendar.locator('[data-absence-date="2026-11-12"]').getAttribute('aria-pressed'), 'true', 'today with an absence is the initial selected date');
    assert.match(await calendar.locator('[data-absence-date="2026-11-12"]').getAttribute('aria-label'), /목요일.*2명/, 'weekday and unique person count are readable, without double-counting a person with two types');
    await calendar.locator('[data-absence-date="2026-11-13"]').click();
    assert.equal(await calendar.locator('[data-absence-selected-list] [data-absence-schedule-id="40"]').count(), 1);
    assert.equal(await calendar.locator('[data-absence-selected-list] [data-absence-schedule-id="7"]').count(), 0, 'meeting on the same date is not in the absence calendar');
    await calendar.getByText('기간 담당', { exact: true }).waitFor();
    await calendar.getByRole('button', { name: '다음 달 휴가', exact: true }).click();
    assert.match(await calendar.locator('[data-absence-date="2026-12-02"]').getAttribute('aria-label'), /수요일.*1명/, 'cross-month range continues on every covered date');
    await calendar.locator('[data-absence-date="2026-12-02"]').click();
    assert.equal(await calendar.locator('[data-absence-selected-list] [data-absence-schedule-id="41"]').count(), 1);
    await calendar.getByRole('button', { name: '이전 달 휴가', exact: true }).click();
    await calendar.locator('[data-absence-date="2026-11-12"]').click();
    await screenshot('hover-absence-1366x768');
    assert.equal(await peek().getAttribute('data-preview-pinned'), 'false', 'selecting a calendar day never implicitly pins a hovered preview');
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'mouse selection leaves focus behind, but exiting the absence preview still closes it');
    await summaryTrigger('absence').hover(); await page.waitForTimeout(470); await calendar.waitFor();
    await calendar.getByRole('button', { name: '다음 달 휴가', exact: true }).click();
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'mouse month navigation also closes on pointer exit');
    await summaryTrigger('absence').hover(); await page.waitForTimeout(470); await calendar.waitFor();
    await peek().getByRole('button', { name: '미리보기 고정', exact: true }).click();
    await calendar.locator('[data-absence-date="2026-11-13"]').click();
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().getAttribute('data-preview-pinned'), 'true', 'only an explicit pin preserves a calendar after mouse date selection and exit');
    await peek().getByRole('button', { name: '미리보기 고정', exact: true }).click();
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'unpinning returns the calendar to ordinary hover dismissal');
    await page.keyboard.press('Tab'); await summaryTrigger('absence').focus(); await calendar.waitFor();
    await calendar.locator('[data-absence-date="2026-11-13"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.mouse.move(5, 5); await page.waitForTimeout(500);
    assert.equal(await peek().count(), 1, 'keyboard focus inside an unpinned calendar remains usable after pointer exit');
    await calendar.getByRole('button', { name: '월간 현황표', exact: true }).focus(); await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    assert.equal(await peek().count(), 0, 'tabbing completely out of the calendar releases keyboard persistence');
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true });
    await touchContext.route('**/*', mockRoute);
    await touchContext.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
    const touchPage = await touchContext.newPage();
    touchPage.on('pageerror', (error) => errors.push(error.message));
    await touchPage.clock.setFixedTime(new Date('2026-11-12T01:00:00Z'));
    await touchPage.goto(baseUrl); await touchPage.locator('[data-dashboard-root]').waitFor();
    await touchPage.locator('[data-dashboard-summary="absence"] [data-anchored-preview-trigger]').tap();
    await touchPage.locator('[data-absence-calendar]').waitFor();
    assert.equal(await touchPage.locator('[data-anchored-preview]').getAttribute('data-preview-pinned'), 'true', 'touch tap opens a pinned mini calendar without hover');
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
      await touchPage.setViewportSize(viewport);
      await touchPage.waitForTimeout(220);
      const surface = await touchPage.locator('[data-anchored-preview]').boundingBox();
      assert.ok(surface.x >= 8 && surface.y >= 8 && surface.x + surface.width <= viewport.width - 7 && surface.y + surface.height <= viewport.height - 7, `${viewport.width}: touch mini calendar stays within the viewport`);
      const file = path.join(os.tmpdir(), `my-portal-hub-dashboard-hover-absence-${viewport.width}x${viewport.height}.png`);
      await touchPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
      await touchPage.screenshot({ path: file }); screenshots.push(file);
    }
    await touchPage.getByRole('button', { name: '미리보기 닫기', exact: true }).tap();
    await touchPage.waitForTimeout(220); assert.equal(await touchPage.locator('[data-anchored-preview]').count(), 0);
    fixtures.splice(0, fixtures.length, ...Array.from({ length: 30 }, (_, index) => event(600 + index, 'meeting', `터치 페이지 일정 ${index}`)));
    await touchPage.reload(); await touchPage.locator('[data-dashboard-root]').waitFor();
    await touchPage.locator('[data-dashboard-summary="week"] [data-anchored-preview-trigger]').tap();
    const touchPages = touchPage.locator('[data-preview-wheel-pages]'); await touchPages.waitFor(); await touchPage.waitForTimeout(100);
    const touchTotal = Number(await touchPages.getAttribute('data-preview-page-total'));
    assert.ok(touchTotal > 1, 'narrow touch preview exposes multiple pages for long lists');
    await touchPages.locator(`[data-preview-page-index="${touchTotal - 1}"]`).tap();
    assert.equal(Number(await touchPages.getAttribute('data-preview-page-current')), touchTotal, 'touch can jump directly to the final page without a wheel');
    assert.equal(await touchPages.locator('[aria-current="page"]').count(), 1, 'touch still marks exactly one active page');
    const touchDotsFile = path.join(os.tmpdir(), 'my-portal-hub-dashboard-wheel-dots-320x640.png');
    await touchPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await touchPage.screenshot({ path: touchDotsFile }); screenshots.push(touchDotsFile);
    await touchContext.close();
    await replaceFixtures(normalFixtures); await settleLayout(viewports[0]);
    const assertDirectDetails = async (preview, title) => {
      await preview.click();
      const direct = page.getByRole('dialog', { name: '일정 상세', exact: true });
      await direct.waitFor();
      assert.ok((await direct.getByRole('heading').innerText()).endsWith(title), `${title}: one click opens its actual details`);
      assert.equal(await page.locator('dialog[open]').count(), 0, `${title}: no intermediary list dialog is required`);
      await direct.getByRole('button', { name: '닫기', exact: true }).click();
    };
    await assertDirectDetails(dashboard().locator('[data-dashboard-context="notice"] [data-preview-schedule-id="1"]').first(), '현장 방문');
    await assertDirectDetails(dashboard().locator('[data-dashboard-context="todo"] [data-preview-schedule-id="6"]').first(), '기한 지난 업무');
    await assertDirectDetails(dashboard().locator('[data-dashboard-context="absence"] [data-preview-schedule-id="5"]').first(), '이팀원');
    const todayTile = dateTrigger('2026-11-12');
    for (const trigger of [todayTile.locator('time'), todayTile.locator('span').filter({ hasText: /^5건$/ }).last()]) {
      await trigger.click(); await peek().waitFor();
      assert.equal(await rows(peek()).count(), 5, 'date and count hit targets both expose every event for that day');
      assert.equal(await page.getByRole('dialog', { name: '일정 상세', exact: true }).count(), 0, 'a day-card hit target never edits a representative event directly');
      await page.keyboard.press('Escape'); await peek().waitFor({ state: 'hidden' });
    }
    const tomorrowTile = dateTrigger('2026-11-13');
    const tomorrowBounds = await tomorrowTile.boundingBox();
    await tomorrowTile.click({ position: { x: tomorrowBounds.width - 7, y: tomorrowBounds.height - 7 } });
    await peek().waitFor();
    assert.equal(await rows(peek()).count(), 1, 'empty padding within the date card opens the same full-day mini list');
    await page.keyboard.press('Escape'); await peek().waitFor({ state: 'hidden' });
    await tomorrowTile.locator('[data-week-schedule-id="7"]').first().click();
    await peek().waitFor();
    assert.equal(await page.getByRole('dialog', { name: '일정 상세', exact: true }).count(), 0, 'clicking the visible event text opens the day list rather than edit/details');
    assert.equal(await peek().locator('[data-schedule-id="7"]').count(), 1, 'the card body uses the same complete day preview as its count');
    await assertDirectDetails(peek().locator('[data-schedule-id="7"]').getByRole('button').last(), '내일 회의');
    await summaryTrigger('absence').click();
    await page.locator('[data-absence-calendar]').waitFor();
    assert.equal(await page.locator('[data-absence-selected-list] [data-absence-schedule-id="5"]').count(), 1, 'leave calendar initially includes today leave');
    assert.equal(await page.locator('[data-absence-selected-list] [data-absence-schedule-id="2"]').count(), 0, 'leave calendar never mixes work into the absence list');
    await page.keyboard.press('Escape'); await peek().waitFor({ state: 'hidden' });
    await dateTrigger('2026-11-13').click();
    const dateDetails = peek();
    await dateDetails.waitFor();
    assert.equal(await dateDetails.locator('[data-schedule-id="7"]').count(), 1, 'date tile opens the exact date list');
    assert.equal(await dateDetails.locator('[data-schedule-id="2"]').count(), 0, 'date tile does not include another date');
    await page.keyboard.press('Escape'); await dateDetails.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '일정 공유', exact: true }).click();
    await page.getByRole('button', { name: '다음 달', exact: true }).click();
    await page.getByRole('heading', { name: /2026년\s*12월$/ }).waitFor();
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await dashboard().waitFor();
    await dayPanel('tomorrow').getByRole('button', { name: '내일 일정 달력 보기', exact: true }).click();
    await page.getByRole('heading', { name: /2026년\s*11월$/ }).waitFor();
    await page.waitForFunction(() => /2026년\s*11월\s*13일\s*금요일/.test(document.querySelector('#selected-calendar-date-heading')?.textContent || ''));
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await dashboard().waitFor();
    await settleLayout(viewports.at(-1));
    const todoButton = summaryTrigger('todo');
    await todoButton.focus(); await todoButton.press('Enter');
    const details = peek();
    await details.waitFor();
    await details.getByText('기한 지난 업무', { exact: true }).waitFor();
    await details.getByRole('button', { name: '기한 지난 업무 완료 처리', exact: true }).click();
    await page.keyboard.press('Escape');
    await details.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.closest('[data-dashboard-summary="todo"]'));
    await assertFits('summary modal closed');
    await summaryTrigger('notice').click();
    await details.waitFor();
    await details.locator('[data-schedule-id="1"]').getByRole('button').last().click();
    const nestedScheduleDetails = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await nestedScheduleDetails.waitFor();
    assert.equal(await peek().count(), 0, 'summary preview closes before root schedule details');
    await nestedScheduleDetails.getByText('김담당', { exact: false }).waitFor();
    await nestedScheduleDetails.getByRole('button', { name: '닫기', exact: true }).click();
    await settleLayout(viewports[0]);
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    const printDialog = page.getByRole('dialog', { name: '주간 일정 인쇄 / PDF 저장' });
    await printDialog.waitFor();
    await printDialog.getByText('종료일 2026-11-18 (7일)', { exact: true }).waitFor();
    await printDialog.getByText('이참석', { exact: true }).waitFor();
    await printDialog.getByText('회의실 A', { exact: true }).waitFor();
    await printDialog.getByText('휴가) 이팀원', { exact: true }).waitFor();
    await printDialog.getByLabel('시작일', { exact: true }).fill('2026-11-13');
    await printDialog.getByText('종료일 2026-11-19 (7일)', { exact: true }).waitFor();
    await printDialog.getByLabel('시작일', { exact: true }).fill('2026-11-12');
    await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
    await printDialog.getByRole('button', { name: '인쇄 / PDF 저장', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__printCalls), 1);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.weekly-print-controls').isVisible(), false);
    const pdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-compact-week.pdf'), preferCSSPageSize: true });
    const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.equal(pageCount, 1, 'ordinary week still fits one A4 landscape sheet');
    await page.emulateMedia({ media: 'screen' });
    await page.keyboard.press('Escape'); await printDialog.waitFor({ state: 'hidden' });
    const longTitle = '장문의 일정 제목도 상세 화면에서는 빠짐없이 읽을 수 있어야 합니다 '.repeat(8);
    fixtures.splice(0, fixtures.length,
      ...Array.from({ length: 40 }, (_, index) => event(100 + index, ['internal', 'meeting', 'business_trip'][index % 3], index === 39 ? longTitle : `오늘 다량 업무 ${index}`, { owner_name: '김담당', attendee_names: ['이참석', '박참석'], location: '기관 회의실', is_notice: index % 2 === 0, is_todo: index % 3 === 0 })),
      ...Array.from({ length: 25 }, (_, index) => event(200 + index, 'meeting', `내일 다량 업무 ${index}`, { date: '2026-11-13' })),
      ...Array.from({ length: 20 }, (_, index) => event(300 + index, 'leave', `휴가) 직원${index}`, { start_time: null, end_time: null })),
    );
    await page.reload(); await dashboard().waitFor();
    for (const viewport of viewports) {
      await settleLayout(viewport);
      const busyGeometry = await assertFits(`busy ${viewport.width}x${viewport.height}`);
      const normalGeometry = measurements.find(({ label }) => label === `normal ${viewport.width}x${viewport.height}`);
      for (const node of busyGeometry.nodes) {
        if (node.selector.startsWith('[data-dashboard-day=') || node.selector.startsWith('[data-dashboard-context=') || node.selector === 'aside[aria-label="확인할 내용"]') continue;
        const original = normalGeometry.nodes.find(({ selector }) => selector === node.selector);
        assert.ok(Math.abs(original.height - node.height) <= 1 && Math.abs(original.y - node.y) <= 1, `${viewport.width}: ${node.selector} retains its overview position when data grows`);
      }
      for (const day of ['today', 'tomorrow']) assert.ok(await rows(dayPanel(day)).count() <= (viewport.width >= 1024 ? 4 : 3), `${viewport.width}: ${day} previews have a readable row limit`);
      if (viewport.width === 1920 || viewport.width === 320) {
        const todayIds = await visitAllRows(dayPanel('today'));
        const tomorrowIds = await visitAllRows(dayPanel('tomorrow'));
        assert.equal(todayIds.size, 60, `${viewport.width}: all 40 work + 20 leave events reachable`);
        assert.equal(tomorrowIds.size, 25, `${viewport.width}: all 25 tomorrow events reachable`);
        await assertFits(`busy final page ${viewport.width}x${viewport.height}`);
      }
      await screenshot(`busy-${viewport.width}x${viewport.height}`);
    }
    // The narrow viewport reaches page 60; widening must clamp it to the new final page without an empty list.
    await settleLayout(viewports[0]);
    await assertFits('busy resize from last mobile page');
    for (const day of ['today', 'tomorrow']) {
      const panel = dayPanel(day);
      assert.ok(await rows(panel).count() > 0, `${day}: resized final page remains populated`);
      const [current, total] = (await panel.locator('nav').innerText()).match(/\d+/g).map(Number);
      assert.ok(current >= 1 && current <= total, `${day}: page index clamps after resizing`);
      assert.equal(await nextButton(panel).isDisabled(), true, `${day}: resized final page is still the final page`);
    }
    await settleLayout({ width: 1366, height: 768 });
    await summaryTrigger('week').click(); await peek().waitFor();
    const wheelPages = peek().locator('[data-preview-wheel-pages]'); await wheelPages.waitFor(); await page.waitForTimeout(100);
    const currentPeekPage = async () => Number(await wheelPages.getAttribute('data-preview-page-current'));
    const wheelTotal = Number(await wheelPages.getAttribute('data-preview-page-total'));
    assert.ok(wheelTotal > 1, 'long preview lists retain accessible pages instead of growing outside the screen');
    assert.equal(await peek().getByRole('button', { name: /이전 페이지|다음 페이지/ }).count(), 0, 'the mini list replaces old footer arrows with its right-side dots');
    assert.ok(await wheelPages.locator('[data-preview-page-index]').count() <= 7, 'dot rail stays bounded even for many pages');
    const activeDot = wheelPages.locator('[data-preview-page-index][aria-current="page"]');
    assert.equal(await activeDot.count(), 1);
    const inactiveDot = wheelPages.locator('[data-preview-page-index]:not([aria-current="page"])').first();
    const activeColor = await activeDot.locator('[data-page-dot]').evaluate((element) => getComputedStyle(element).backgroundColor);
    const inactiveColor = await inactiveDot.locator('[data-page-dot]').evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.notEqual(activeColor, inactiveColor, 'current page is visually darker than unselected page dots');
    const activeBounds = await activeDot.boundingBox(); assert.ok(activeBounds.width >= 22 && activeBounds.height >= 22, 'small visible dots retain usable click targets');
    const initialPage = await currentPeekPage();
    await wheelPages.hover(); await page.mouse.wheel(0, 120); await page.waitForTimeout(30);
    assert.equal(await currentPeekPage(), initialPage + 1, 'one deliberate wheel movement advances one page');
    for (let index = 0; index < 5; index += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(25); }
    assert.equal(await currentPeekPage(), initialPage + 1, 'trackpad inertia in one burst cannot skip multiple pages');
    await screenshot('wheel-dots-1366x768');
    await page.waitForTimeout(450); await page.mouse.wheel(0, -120); await page.waitForTimeout(40);
    assert.equal(await currentPeekPage(), initialPage, 'a fresh reverse gesture moves back one page');
    await page.waitForTimeout(450);
    await wheelPages.dispatchEvent('wheel', { deltaY: 120, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true });
    await wheelPages.dispatchEvent('wheel', { deltaX: 120, deltaY: 2, deltaMode: 0, bubbles: true, cancelable: true });
    await page.waitForTimeout(40); assert.equal(await currentPeekPage(), initialPage, 'zoom and primarily horizontal wheel gestures never change pages');
    await wheelPages.dispatchEvent('wheel', { deltaY: 1, deltaMode: 0, bubbles: true, cancelable: true });
    await page.waitForTimeout(40); assert.equal(await currentPeekPage(), initialPage, 'a tiny wheel movement does not accidentally advance a page');
    await page.waitForTimeout(450);
    await wheelPages.dispatchEvent('wheel', { deltaY: 4, deltaMode: 1, bubbles: true, cancelable: true });
    await page.waitForTimeout(40); assert.equal(await currentPeekPage(), initialPage + 1, 'line-mode wheel deltas are normalized');
    await wheelPages.locator(`[data-preview-page-index="${wheelTotal - 1}"]`).click();
    await page.waitForTimeout(450); await wheelPages.hover(); await page.mouse.wheel(0, 120); await page.waitForTimeout(50);
    assert.equal(await currentPeekPage(), wheelTotal, 'scrolling at the end never wraps to another page');
    await wheelPages.locator('[data-preview-page-index="0"]').click();
    await page.waitForTimeout(450); await wheelPages.hover(); await page.mouse.wheel(0, -120); await page.waitForTimeout(50);
    assert.equal(await currentPeekPage(), 1, 'scrolling above the beginning never wraps');
    await wheelPages.focus(); await wheelPages.press('PageDown');
    assert.equal(await currentPeekPage(), 2, 'keyboard page navigation remains available without using a wheel');
    for (const height of [730, 710, 730]) {
      await settleLayout({ width: 1366, height });
      await assertFits(`wheel preview breakpoint 1366x${height}`);
      await assertPeekBounds(summaryTrigger('week'));
    }
    await settleLayout({ width: 1366, height: 768 });
    assert.equal((await visitAllPeekRows(wheelPages)).size, 85, 'dot and keyboard navigation can still access every preview item');
    await assertPeekBounds(summaryTrigger('week'));
    await peek().getByRole('button', { name: '전체 목록 보기', exact: true }).click();
    const fullWeek = page.locator('dialog[open]');
    await fullWeek.waitFor();
    assert.equal((await visitAllRows(fullWeek)).size, 85, 'preview full-list action preserves access to all 85 events');
    await page.keyboard.press('Escape'); await fullWeek.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.closest('[data-dashboard-summary="week"]'));
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-anchored-preview]').count(), 0, 'closing the full list restores its source without reopening the preview');
    await page.mouse.move(5, 5);
    await summaryTrigger('week').hover(); await page.waitForTimeout(470); await peek().waitFor();
    assert.equal(await peek().getAttribute('data-preview-pinned'), 'false', 'a fresh deliberate hover still works after full-list focus restoration');
    await dismissPeek();
    await summaryTrigger('absence').click(); await page.locator('[data-absence-calendar]').waitFor();
    const longAbsenceList = page.locator('[data-absence-selected-list]');
    assert.equal(await longAbsenceList.locator('[data-absence-schedule-id]').count(), 20, 'all 20 absences are retained within the calendar');
    assert.ok(await longAbsenceList.evaluate((element) => element.scrollHeight > element.clientHeight), 'only the local absence list scrolls for large leave counts');
    assert.equal(await peek().locator('[data-preview-wheel-pages]').count(), 0, 'calendar lists do not inherit wheel page navigation');
    await longAbsenceList.hover(); const absenceScrollTop = await longAbsenceList.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 320); await page.waitForTimeout(100);
    assert.ok(await longAbsenceList.evaluate((element) => element.scrollTop) > absenceScrollTop, 'wheel inside the calendar scrolls its local leave list normally');
    await longAbsenceList.locator('[data-absence-schedule-id="319"]').click();
    const lastAbsenceDetails = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await lastAbsenceDetails.waitFor();
    assert.ok((await lastAbsenceDetails.getByRole('heading').innerText()).endsWith('직원19'), 'the last absence remains directly accessible');
    await lastAbsenceDetails.getByRole('button', { name: '닫기', exact: true }).click();
    assert.equal(await legend().getByRole('button').count(), 0, 'large datasets still have no accidental category filter');
    await page.reload(); await dayPanel('today').waitFor();
    for (let turns = 0; turns < 100 && !await dayPanel('today').locator('[data-schedule-id="139"]').count(); turns += 1) await nextButton(dayPanel('today')).click();
    await dayPanel('today').locator('[data-schedule-id="139"]').getByRole('button').last().click();
    const scheduleDetails = page.getByRole('dialog', { name: '일정 상세', exact: true });
    await scheduleDetails.getByRole('heading').waitFor();
    assert.ok((await scheduleDetails.getByRole('heading').innerText()).endsWith(longTitle.trim()), 'schedule details retain the complete title after its category prefix');
    await scheduleDetails.getByRole('button', { name: '닫기', exact: true }).click();
    await settleLayout(viewports[0]);
    await page.getByRole('button', { name: '주간 인쇄', exact: true }).click();
    await printDialog.getByText('내일 다량 업무 24', { exact: true }).waitFor();
    await page.emulateMedia({ media: 'print' });
    const longPdf = await page.pdf({ path: path.join(os.tmpdir(), 'my-portal-compact-week-many.pdf'), preferCSSPageSize: true });
    const longPageCount = (longPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.ok(longPageCount > 1, 'busy week print retains every row across pages');
    assert.deepEqual(errors, []); assert.deepEqual(writes, ['/rest/v1/schedules']);
    console.log(JSON.stringify({ passed: true, pageCount, longPageCount, cases: [
      'one static noninteractive category legend', 'all categories remain visible', 'all includes leave',
      'seven visible date tiles with today, tomorrow and D-N labels', 'responsive three, two and one-row weekly tiles',
      'weekly carousel exposes every event in order and wraps without loss', 'hover, keyboard focus and open previews pause rotation',
      'global pause, hidden documents and reduced motion stop automatic content changes', 'unmount cleans up rotating tiles',
      'six viewport sizes and mixed information fit', 'rapid crossings never flash a preview',
      'preview grows from its actual card and stays within viewport', 'pointer transfer into preview preserves it',
      'Escape suppresses reopening under the pointer', 'changing category keeps exactly one window', 'click pin and outside dismissal',
      'reduced motion avoids grow animation', 'absence weekday and unique person count', 'cross-month absence range on every date',
      'mouse-selected calendar closes after exit', 'explicit pin and unpin preserve intended dismissal',
      'keyboard calendar focus persists until tabbed out', 'touch calendar at 390 and 320 pixels', 'touch directly selects dot pages',
      'one-click notice, todo and absence details', 'whole weekly tile, date, count, title and padding open the full-day mini before details',
      'date tile opens only the exact date', 'absence calendar excludes work', 'calendar action selects the requested date after another month',
      'sparse independent card heights and no trapped whitespace', 'compact empty state and no redundant navigation',
      'summary keyboard and focus restoration', 'overdue completion', 'all 85 busy-day rows reachable', 'bounded dark-current dot rail',
      'wheel gestures do not skip pages through inertia', 'wheel direction units and ignored zoom/horizontal input',
      'wheel boundaries never wrap', 'popup breakpoint resize never clips rows', 'dot and keyboard navigation retains every preview item',
      'calendar local scrolling is not intercepted', 'resize clamps last page', 'long title detail', 'ordinary and busy week print',
    ], screenshots,
      sparseCardSizes: measurements.filter(({ label }) => label.startsWith('sparse ')).map(({ label, nodes }) => ({ label, cards: nodes.filter(({ selector }) => selector.startsWith('[data-dashboard-day=')).map(({ selector, height }) => ({ selector, height })) })),
      layoutsChecked: measurements.map(({ label, viewport, document }) => ({ label, viewport, document })) }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(0, 5000)); console.error('Browser errors:', errors); throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
