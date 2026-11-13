/* eslint-disable @typescript-eslint/no-require-imports -- Local-only mocked browser regression. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.WHITEBOARD_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'This regression must never access the live application');
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'Asia/Seoul', userAgent: WINDOWS_UA });
  const errors = [], writes = [], checks = [], apiCalls = [], screenshots = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) { if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`); return reply([]); }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  await context.exposeBinding('__qaRecord', ({ page }, entry) => apiCalls.push({ page, ...entry }));
  await context.addInitScript((nativeProbe) => {
    if (nativeProbe) {
      const record = (name, detail = null) => { void window.__qaRecord({ name, detail, at: Date.now(), url: location.href, fullscreen: Boolean(document.fullscreenElement), focused: document.hasFocus(), visibility: document.visibilityState }); };
      for (const name of ['focus', 'blur', 'pagehide', 'pageshow']) window.addEventListener(name, () => record(`native-${name}`));
      document.addEventListener('fullscreenchange', () => record('native-fullscreenchange'));
      document.addEventListener('visibilitychange', () => record('native-visibilitychange'));
      const focus = window.focus.bind(window), close = window.close.bind(window);
      window.focus = () => { record('native-focus-call'); return focus(); };
      window.close = () => { record('native-close-call'); return close(); };
      const exit = document.exitFullscreen.bind(document);
      document.exitFullscreen = () => { record('native-exitFullscreen-call', new Error().stack?.split('\n').slice(1, 4).join('\n')); return exit(); };
      const request = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function (...args) {
        record('native-fullscreen-request'); const promise = request.apply(this, args);
        void promise.then(() => record('native-fullscreen-resolved'), (error) => record('native-fullscreen-rejected', error.message)); return promise;
      };
      return;
    }
    let fullscreen = null, pipSequence = 0;
    const realOpen = window.open.bind(window);
    const state = window.__kioskTest = { events: [], fullscreenMode: location.search.includes('qa-defer-initial') || window.name === 'qa-initial-kiosk' ? 'defer' : 'resolve', exitFullscreenMode: 'resolve', pipMode: 'resolve', blockPopup: false, resolveFullscreen: null, resolvePip: null, fullscreenPending: [] };
    const record = (name, detail = null) => { const entry = { name, detail }; state.events.push(entry); void window.__qaRecord(entry); };
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    Element.prototype.requestFullscreen = function () {
      record('fullscreen-request', { mode: state.fullscreenMode, url: location.href });
      if (state.fullscreenMode === 'reject') return Promise.reject(new DOMException('Fullscreen blocked by simulated policy', 'NotAllowedError'));
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Retain the DOM element requested by this browser mock.
      const complete = () => { fullscreen = this; record('fullscreen-resolved'); document.dispatchEvent(new Event('fullscreenchange')); };
      if (state.fullscreenMode === 'defer') return new Promise((resolve) => { state.fullscreenPending.push(() => { complete(); resolve(); }); state.resolveFullscreen = () => state.fullscreenPending.splice(0).forEach((finish) => finish()); });
      complete(); return Promise.resolve();
    };
    document.exitFullscreen = async () => { record('fullscreen-exit'); if (state.exitFullscreenMode === 'reject') throw new DOMException('Fullscreen exit rejected by simulated policy', 'NotAllowedError'); fullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
    window.focus = () => record('owner-focus');
    window.resizeTo = (width, height) => record('resize', { width, height });
    window.moveTo = (left, top) => record('move', { left, top });
    window.open = (url, target, features) => { record('window-open', { url: String(url), target, features }); return state.blockPopup ? null : realOpen(url, target, features); };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href.startsWith('dphskiosk:')) { record('native-protocol', this.href); return; }
      return anchorClick.call(this);
    };
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, writable: true, value: {
      requestWindow: (options) => {
        record('pip-request', options);
        if (state.pipMode === 'reject') return Promise.reject(new DOMException('PiP disabled by simulated policy', 'NotAllowedError'));
        const controller = realOpen('about:blank', `qa-pip-${Date.now()}-${pipSequence++}`, `popup,width=${options?.width || 360},height=${options?.height || 210}`);
        if (!controller) return Promise.reject(new Error('Mock controller window was not opened'));
        const close = controller.close.bind(controller);
        controller.close = () => { record('pip-close'); close(); };
        controller.focus = () => record('pip-focus');
        state.pipWindow = controller;
        if (state.pipMode === 'defer') return new Promise((resolve) => { state.resolvePip = () => resolve(controller); });
        return Promise.resolve(controller);
      },
    } });
  }, process.env.KIOSK_NATIVE_PROBE === '1');
  context.on('page', (page) => { page.setDefaultTimeout(12000); page.on('pageerror', (error) => errors.push(error.message)); });
  const home = await context.newPage();
  const board = (page) => page.locator('[data-kiosk-board]');
  const settle = (page) => page.waitForTimeout(180);
  const launch = async () => {
    const popup = context.waitForEvent('page');
    await home.getByRole('button', { name: '전광판 모드', exact: true }).click();
    const kiosk = await popup; await kiosk.waitForURL('**/kiosk*'); await board(kiosk).waitFor(); await settle(kiosk); return kiosk;
  };
  const collapseWithPip = async (kiosk) => {
    const popup = context.waitForEvent('page');
    await kiosk.getByRole('button', { name: '전광판 접기', exact: true }).click();
    const pip = await popup; await pip.locator('#reopen-kiosk').waitFor(); await board(kiosk).waitFor({ state: 'hidden' }); return pip;
  };
  const names = (kiosk) => kiosk.evaluate(() => window.__kioskTest.events.map((entry) => entry.name));
  const clear = (kiosk) => kiosk.evaluate(() => { window.__kioskTest.events = []; });
  const capture = async (page, name) => {
    if (process.env.KIOSK_NATIVE_PROBE !== '1') await page.setViewportSize({ width: 360, height: 210 });
    const file = path.join(os.tmpdir(), `my-portal-kiosk-controller-${name}.png`);
    await page.screenshot({ path: file }); screenshots.push(file);
  };
  const assertRestoreOrder = async (kiosk) => {
    const events = await names(kiosk); const request = events.indexOf('fullscreen-request');
    assert.ok(request >= 0, 'restore requests actual Fullscreen API');
    for (const operation of ['owner-focus', 'pip-close']) {
      const index = events.indexOf(operation); assert.ok(index < 0 || request < index, `fullscreen request precedes ${operation}: ${events}`);
    }
  };
  let kiosk;
  try {
    await home.goto(baseUrl); await home.getByRole('button', { name: '전광판 모드', exact: true }).waitFor();
    assert.match(await home.evaluate(() => navigator.userAgent), /Windows/);
    kiosk = await launch();
    if (process.env.KIOSK_NATIVE_PROBE === '1') {
      const supported = await kiosk.evaluate(() => ({ fullscreen: Boolean(document.documentElement.requestFullscreen), documentPip: 'documentPictureInPicture' in window, secureContext: window.isSecureContext }));
      const initiallyFullscreen = await kiosk.evaluate(() => Boolean(document.fullscreenElement));
      if (!initiallyFullscreen && supported.fullscreen) {
        await kiosk.getByRole('button', { name: '전체 화면', exact: true }).click(); await settle(kiosk);
      }
      const enteredFullscreen = await kiosk.evaluate(() => Boolean(document.fullscreenElement));
      const possiblePip = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
      await kiosk.getByRole('button', { name: '전광판 접기', exact: true }).click();
      const pip = await possiblePip;
      const pipOpened = await kiosk.evaluate(() => Boolean(window.documentPictureInPicture?.window));
      let restoredFullscreen = false, controllerRetained = false, retryMessage = '';
      if (pip) {
        await pip.locator('#reopen-kiosk').waitFor(); await capture(pip, 'native'); await pip.locator('#reopen-kiosk').click();
        await kiosk.waitForFunction(() => Boolean(document.fullscreenElement), undefined, { timeout: 3000 }).catch(() => undefined);
        restoredFullscreen = await kiosk.evaluate(() => Boolean(document.fullscreenElement));
        controllerRetained = !pip.isClosed();
        if (controllerRetained) retryMessage = await pip.getByRole('status').innerText().catch(() => '');
      }
      await kiosk.waitForTimeout(1000);
      restoredFullscreen = await kiosk.evaluate(() => Boolean(document.fullscreenElement));
      controllerRetained = Boolean(pip && !pip.isClosed());
      console.log(JSON.stringify({ nativeBrowserProbe: true, supported, initiallyFullscreen, enteredFullscreen, pipOpened, automationCanAccessPip: Boolean(pip), restoredFullscreen, controllerRetained, retryMessage, trace: apiCalls.filter(({ name }) => name.startsWith('native-')).map(({ page, ...entry }) => ({ ...entry, pageUrl: page.url() })), browserErrors: errors, externalWrites: writes, limitation: 'Instrumented native browser APIs in headless Chromium only; physical multi-monitor placement and OS always-on-top behavior are not validated.' }, null, 2));
      if (supported.fullscreen && supported.documentPip && supported.secureContext) {
        assert.equal(enteredFullscreen, true, 'native browser enters fullscreen before collapse');
        assert.equal(pipOpened, true, 'native Document PiP is created');
        assert.ok(pip, 'native Document PiP is accessible to the browser runner');
        assert.equal(restoredFullscreen, true, 'native fullscreen persists at least one second after PiP restoration');
        assert.equal(controllerRetained, false, 'successful native restoration closes the PiP controller');
      }
      assert.deepEqual(errors, []); assert.deepEqual(writes, []); return;
    }
    assert.equal(await board(home).count(), 0, 'original document page remains independent');
    assert.equal((await names(home)).includes('native-protocol'), false, 'Windows launch never calls the removed installer protocol');
    assert.ok((await home.evaluate(() => window.__kioskTest.events)).some((entry) => entry.name === 'window-open' && entry.detail.features.includes('popup')), 'launch requests a separate browser window');
    await home.getByRole('button', { name: '전광판 모드', exact: true }).click(); await settle(home);
    assert.equal(context.pages().filter((page) => page.url().includes('/kiosk')).length, 1, 'repeated launch reuses the dedicated window');
    checks.push('Windows launches one independent web kiosk without an installer');

    let pip = await collapseWithPip(kiosk);
    assert.ok((await names(kiosk)).includes('pip-request'), 'dedicated kiosk uses Document PiP when available');
    await capture(pip, 'ready');
    await clear(kiosk); await pip.locator('#reopen-kiosk').click(); await board(kiosk).waitFor();
    await kiosk.waitForFunction(() => Boolean(document.fullscreenElement)); if (!pip.isClosed()) await pip.waitForEvent('close');
    assert.ok(pip.isClosed()); await assertRestoreOrder(kiosk);
    checks.push('PiP click restoration requests fullscreen before focus or controller close');

    pip = await collapseWithPip(kiosk);
    await kiosk.evaluate(() => { window.__kioskTest.fullscreenMode = 'reject'; window.__kioskTest.events = []; });
    await pip.locator('#reopen-kiosk').click(); await settle(kiosk);
    assert.equal(pip.isClosed(), false, 'failed fullscreen keeps the working PiP controller');
    await pip.locator('#reopen-kiosk').waitFor();
    assert.equal((await names(kiosk)).includes('pip-close'), false, 'failed fullscreen must not discard the controller');
    await pip.getByRole('status').waitFor();
    assert.match(await pip.getByRole('status').innerText(), /전체화면을 열지 못했습니다/, 'controller explicitly communicates fullscreen failure');
    await pip.getByRole('button', { name: '창 모드로 보기', exact: true }).waitFor();
    await capture(pip, 'denied');
    await assertRestoreOrder(kiosk);
    await kiosk.evaluate(() => { window.__kioskTest.fullscreenMode = 'resolve'; });
    await pip.locator('#reopen-kiosk').click(); await board(kiosk).waitFor(); await kiosk.waitForFunction(() => Boolean(document.fullscreenElement));
    checks.push('fullscreen denial preserves controller and allows retry');

    await kiosk.evaluate(() => { window.__kioskTest.exitFullscreenMode = 'reject'; });
    const failedExitPopup = context.waitForEvent('page');
    await kiosk.getByRole('button', { name: '전광판 접기', exact: true }).click(); pip = await failedExitPopup;
    if (!pip.isClosed()) await pip.waitForEvent('close');
    await board(kiosk).waitFor();
    assert.equal(await kiosk.evaluate(() => Boolean(document.fullscreenElement)), true, 'failed exit keeps the board in its original fullscreen state');
    await kiosk.getByRole('status').waitFor();
    assert.match(await kiosk.getByRole('status').innerText(), /종료하지 못했습니다|접기를 완료하지 못했습니다/, 'failed exit has a visible recovery explanation even while fullscreen');
    await kiosk.evaluate(() => { window.__kioskTest.exitFullscreenMode = 'resolve'; });
    checks.push('fullscreen-exit rejection keeps the board usable and disposes the unused PiP window');

    await kiosk.evaluate(() => { window.__kioskTest.savedPipApi = window.documentPictureInPicture; window.documentPictureInPicture = undefined; window.__kioskTest.events = []; });
    await kiosk.keyboard.press('F8'); await board(kiosk).waitFor({ state: 'hidden' });
    await kiosk.locator('[data-kiosk-controller]').waitFor();
    assert.ok((await kiosk.evaluate(() => window.__kioskTest.events)).some((entry) => entry.name === 'resize' && entry.detail.width <= 420 && entry.detail.height <= 260), 'without PiP the dedicated browser becomes a small controller');
    await clear(kiosk); await kiosk.keyboard.press('F8'); await board(kiosk).waitFor(); await assertRestoreOrder(kiosk);
    await kiosk.evaluate(() => { window.documentPictureInPicture = window.__kioskTest.savedPipApi; window.__kioskTest.pipMode = 'reject'; });
    await kiosk.keyboard.press('F8'); await board(kiosk).waitFor({ state: 'hidden' }); await kiosk.locator('[data-kiosk-controller]').waitFor();
    await kiosk.keyboard.press('F8'); await board(kiosk).waitFor();
    checks.push('unsupported or rejected PiP falls back to a small F8 controller');

    await kiosk.evaluate(() => { window.__kioskTest.pipMode = 'resolve'; });
    pip = await collapseWithPip(kiosk);
    await clear(kiosk); await pip.keyboard.press('F8').catch((error) => { if (!pip.isClosed()) throw error; }); await board(kiosk).waitFor(); await kiosk.waitForFunction(() => Boolean(document.fullscreenElement)); await assertRestoreOrder(kiosk);
    await kiosk.evaluate(() => { window.__kioskTest.pipMode = 'defer'; window.__kioskTest.events = []; });
    const delayed = context.waitForEvent('page');
    await kiosk.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', repeat: true })); });
    pip = await delayed; await settle(kiosk);
    assert.equal((await names(kiosk)).filter((name) => name === 'pip-request').length, 1, 'rapid F8 presses do not spawn duplicate PiP windows');
    await kiosk.evaluate(() => window.__kioskTest.resolvePip()); await pip.locator('#reopen-kiosk').waitFor();
    await kiosk.evaluate(() => { window.__kioskTest.fullscreenMode = 'defer'; window.__kioskTest.events = []; });
    await pip.evaluate(() => { document.querySelector('#reopen-kiosk').click(); document.querySelector('#reopen-kiosk').click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); });
    await settle(kiosk); assert.equal((await names(kiosk)).filter((name) => name === 'fullscreen-request').length, 1, 'restoration is serialized while fullscreen is pending');
    await kiosk.evaluate(() => window.__kioskTest.resolveFullscreen()); await board(kiosk).waitFor(); await kiosk.waitForFunction(() => Boolean(document.fullscreenElement));
    checks.push('F8 and repeated controller clicks are serialized across pending browser requests');

    await kiosk.evaluate(() => { window.__kioskTest.pipMode = 'resolve'; window.__kioskTest.fullscreenMode = 'resolve'; });
    pip = await collapseWithPip(kiosk);
    const kioskClosed = kiosk.waitForEvent('close'); const pipClosed = pip.waitForEvent('close');
    await pip.getByRole('button', { name: '전광판 완전히 종료', exact: true }).click(); await Promise.all([kioskClosed, pipClosed]);
    assert.equal(home.isClosed(), false); await home.getByRole('button', { name: '전광판 모드', exact: true }).waitFor();
    await home.keyboard.press('F8'); await settle(home); assert.equal(await board(home).count(), 0, 'F8 is scoped to the kiosk, not an always-active home-page shortcut');
    checks.push('closing the PiP controller closes only the kiosk and leaves the document page usable');

    kiosk = await launch(); await kiosk.evaluate(() => { window.__kioskTest.pipMode = 'defer'; });
    const latePopup = context.waitForEvent('page');
    await kiosk.getByRole('button', { name: '전광판 접기', exact: true }).click(); pip = await latePopup;
    const lateOwnerClosed = kiosk.waitForEvent('close'); const latePipClosed = pip.waitForEvent('close');
    await kiosk.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.__kioskTest.resolvePip(); });
    await Promise.all([lateOwnerClosed, latePipClosed]);
    checks.push('late PiP response after kiosk exit cannot leave an orphan controller');

    const initialPopup = context.waitForEvent('page');
    await home.evaluate((base) => { window.open(`${base}/kiosk?qa-defer-initial=1`, 'qa-initial-kiosk', 'popup,width=1200,height=800'); }, baseUrl);
    kiosk = await initialPopup; await board(kiosk).waitFor(); await settle(kiosk);
    assert.equal(await kiosk.evaluate(() => Boolean(document.fullscreenElement)), false);
    pip = await collapseWithPip(kiosk);
    await kiosk.evaluate(() => window.__kioskTest.resolveFullscreen()); await settle(kiosk);
    assert.equal(await kiosk.evaluate(() => Boolean(document.fullscreenElement)), false, 'late initial fullscreen cannot cover the desktop after the user has collapsed the board');
    await board(kiosk).waitFor({ state: 'hidden' }); await pip.locator('#reopen-kiosk').waitFor();
    const initialOwnerClosed = kiosk.waitForEvent('close'); const initialPipClosed = pip.waitForEvent('close');
    await pip.getByRole('button', { name: '전광판 완전히 종료', exact: true }).click(); await Promise.all([initialOwnerClosed, initialPipClosed]);
    checks.push('late initial fullscreen completion cannot undo a newer collapsed state');

    kiosk = await launch(); await home.close(); await board(kiosk).waitFor();
    assert.equal(kiosk.isClosed(), false, 'the dedicated application survives closure of the original document page');
    const closed = kiosk.waitForEvent('close'); await kiosk.getByRole('button', { name: '전광판 닫기', exact: true }).click(); await closed;
    checks.push('dedicated kiosk remains usable when its opener is closed');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    console.log(JSON.stringify({ passed: true, checks, screenshots, browserErrors: errors.length, externalWrites: writes.length, apiCallCount: apiCalls.length, limitation: 'Browser Fullscreen/PiP permissions and window placement are mocked; this is not a physical multi-monitor or OS always-on-top test.' }, null, 2));
  } catch (error) {
    for (const page of context.pages()) console.error(page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 2000));
    console.error('Recent browser API calls:', apiCalls.slice(-20).map(({ name, detail }) => ({ name, detail })));
    console.error('Browser errors:', errors); throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
