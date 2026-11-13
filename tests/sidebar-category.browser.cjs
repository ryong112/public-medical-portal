/* eslint-disable @typescript-eslint/no-require-imports -- Optional local-only Playwright regression. */
// Start a local dev server first. All auth, database, storage and external WebSocket traffic is mocked.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.SIDEBAR_CATEGORY_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'This regression must never access the live application');

const originalName = '운영자료';
const renamedName = '운영자료 새 이름';
const bottomName = '아래쪽의 긴 이름을 가진 자료 분류';
const categories = [
  { id: 1, name: originalName, order_index: 0 },
  { id: 2, name: '참고자료', order_index: 1 },
  ...Array.from({ length: 22 }, (_, index) => ({ id: index + 10, name: `자료 분류 ${String(index + 1).padStart(2, '0')}`, order_index: index + 2 })),
  { id: 99, name: bottomName, order_index: 24 },
];
const files = [
  { id: 101, name: '연결된 운영 문서.pdf', category: originalName, url: 'https://portal-test.invalid/storage/v1/object/public/files/operations.pdf', size: 1234, created_at: '2026-11-11T01:00:00Z' },
  { id: 102, name: '참고 문서.pdf', category: '참고자료', url: 'https://portal-test.invalid/storage/v1/object/public/files/reference.pdf', size: 4321, created_at: '2026-11-10T01:00:00Z' },
  { id: 103, name: '아래쪽 문서.pdf', category: bottomName, url: 'https://portal-test.invalid/storage/v1/object/public/files/bottom.pdf', size: 100, created_at: '2026-11-09T01:00:00Z' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, timezoneId: 'Asia/Seoul' });
  const errors = [], writes = [], dialogs = [], screenshots = [], checks = [];
  const userId = '11111111-1111-4111-8111-111111111111';
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;
  let rejectRename = true;
  let acceptConfirmation = false;
  const matches = (row, url) => [...url.searchParams].every(([key, value]) => {
    if (!['id', 'category', 'name', 'url'].includes(key)) return true;
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').map((part) => part.replace(/^"|"$/g, '')).includes(String(row[key]));
    return true;
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
    if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
    if (url.pathname.startsWith('/rest/v1/')) {
      if (request.method() !== 'GET') writes.push({ method: request.method(), pathname: url.pathname, query: url.search, body: request.postDataJSON() });
      if (url.pathname.endsWith('/rpc/rename_category_with_files')) {
        if (rejectRename) { rejectRename = false; return reply({ code: '42501', message: 'test category rename failure' }, 403); }
        const { p_old_name: oldName, p_new_name: newName } = request.postDataJSON();
        const category = categories.find((row) => row.name === oldName);
        assert.ok(category, 'atomic rename must target an existing category');
        category.name = newName;
        for (const file of files) if (file.category === oldName) file.category = newName;
        return reply(null);
      }
      const rows = url.pathname.endsWith('/categories') ? categories : url.pathname.endsWith('/files') ? files : null;
      if (rows) {
        if (request.method() === 'PATCH') {
          const updated = rows.filter((row) => matches(row, url));
          for (const row of updated) Object.assign(row, request.postDataJSON());
          return reply(updated);
        }
        if (request.method() === 'DELETE') {
          for (let index = rows.length - 1; index >= 0; index--) if (matches(rows[index], url)) rows.splice(index, 1);
          return reply([]);
        }
        return reply(rows.filter((row) => matches(row, url)));
      }
      return reply([]);
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      writes.push({ method: request.method(), pathname: url.pathname, body: request.postDataJSON() });
      return reply([]);
    }
    if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => socket.close());
  if (process.env.SIDEBAR_CATEGORY_TRACE === '1') await context.addInitScript(() => {
    window.__sidebarQaEvents = [];
    for (const type of ['pointerdown', 'click', 'scroll', 'focusin', 'resize']) document.addEventListener(type, (event) => {
      const target = event.target;
      window.__sidebarQaEvents.push({ type, target: target instanceof Element ? target.getAttribute('aria-label') || target.tagName : String(target), className: target instanceof Element ? target.getAttribute('class') : null, sidebar: target instanceof Element && Boolean(target.closest('main > aside')), scroll: target instanceof Element ? [target.scrollLeft, target.scrollTop, target.clientWidth, target.scrollWidth] : null, menu: document.querySelectorAll('[role="menu"]').length, at: performance.now() });
    }, true);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'confirm' && acceptConfirmation) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.clock.setFixedTime(new Date('2026-11-11T01:00:00Z'));
  const sidebar = page.locator('main > aside');
  const trigger = (name) => sidebar.getByRole('button', { name: `${name} 분류 메뉴`, exact: true });
  const categoryButton = (name) => sidebar.getByRole('button', { name: `📁 ${name}`, exact: true });
  const menu = () => page.getByRole('menu');
  const renameItem = () => menu().getByRole('menuitem', { name: '이름 변경', exact: true });
  const deleteItem = () => menu().getByRole('menuitem', { name: '삭제', exact: true });
  const capture = async (name) => {
    const destination = path.join(os.tmpdir(), `my-portal-sidebar-category-${name}.png`);
    await page.screenshot({ path: destination }); screenshots.push(destination);
  };
  const focused = (locator) => locator.evaluate((element) => document.activeElement === element);
  const fileSnapshot = () => files.map((file) => {
    const copy = { ...file };
    delete copy.category;
    return copy;
  });
  const assertNoOverflow = async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page should fit ${page.viewportSize().width}px viewport`);
    assert.ok(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth), 'sidebar should not overflow horizontally');
  };
  const assertMenuFits = async () => {
    for (const locator of [menu(), renameItem(), deleteItem()]) {
      const rect = await locator.boundingBox();
      assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= page.viewportSize().width + 1 && rect.y + rect.height <= page.viewportSize().height + 1, 'menu and each action must remain fully inside the viewport');
    }
  };
  try {
    await page.goto(baseUrl);
    await trigger(originalName).waitFor();
    await sidebar.getByRole('button', { name: '홈', exact: true }).waitFor();
    assert.equal(await sidebar.getByRole('button', { name: / 분류 삭제$/ }).count(), 0, 'individual category rows no longer expose a direct delete X');
    await page.locator('[data-dashboard-root]').waitFor();
    assert.equal(await sidebar.getByRole('button', { name: '공공의료지원과 일정', exact: true }).count(), 0, 'only the sidebar dashboard label becomes 홈');
    assert.equal(await page.locator('[data-dashboard-root]').getByRole('heading', { name: '공공의료지원과 일정', exact: true }).count(), 1, 'right dashboard retains its original heading');
    const initialFiles = fileSnapshot();
    const dashboardMarkup = await page.locator('[data-dashboard-root]').innerHTML();

    await trigger(originalName).click();
    await renameItem().waitFor();
    assert.equal(await trigger(originalName).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-dashboard-root]').count(), 1, 'opening category actions must not navigate');
    assert.equal(await page.locator('[data-dashboard-root]').innerHTML(), dashboardMarkup, 'opening a sidebar menu does not change the right dashboard');
    assert.deepEqual(writes, [], 'opening category actions never writes or deletes');
    assert.deepEqual(dialogs, [], 'opening category actions never prompts deletion');
    await assertMenuFits();
    await page.keyboard.press('Escape');
    await menu().waitFor({ state: 'detached' });
    assert.ok(await focused(trigger(originalName)), 'Escape restores focus to the menu trigger');
    await trigger(originalName).press('Enter');
    await renameItem().waitFor();
    assert.ok(await focused(renameItem()), 'keyboard opening focuses the first action');
    await page.keyboard.press('ArrowDown');
    assert.ok(await focused(deleteItem()), 'ArrowDown reaches delete');
    await page.keyboard.press('ArrowUp');
    assert.ok(await focused(renameItem()), 'ArrowUp returns to rename');
    await page.keyboard.press('End');
    assert.ok(await focused(deleteItem()), 'End reaches the final action');
    await page.keyboard.press('Home');
    assert.ok(await focused(renameItem()), 'Home reaches the first action');
    await page.keyboard.press('Escape');
    await trigger(originalName).click();
    await page.locator('[data-dashboard-root] h2').click();
    await menu().waitFor({ state: 'detached' });
    assert.deepEqual(writes, [], 'outside dismissal never mutates categories');
    checks.push('홈 sidebar label; unchanged right dashboard; no navigation or writes from menu; Escape, outside and keyboard actions');

    await trigger(bottomName).scrollIntoViewIfNeeded();
    await trigger(bottomName).click();
    await renameItem().waitFor();
    await assertMenuFits();
    await capture('desktop-bottom-menu');
    await page.keyboard.press('Escape');
    checks.push('last category menu escapes the scrolling sidebar without clipping');

    await trigger(originalName).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await trigger(originalName).click();
    await renameItem().click();
    const renameDialog = page.getByRole('dialog', { name: '분류 이름 변경', exact: true });
    await renameDialog.waitFor();
    assert.equal(await page.locator('[data-dashboard-root]').count(), 1, 'renaming an unselected category keeps the current screen');
    assert.equal(await renameDialog.getByRole('textbox', { name: '분류 이름', exact: true }).inputValue(), originalName);
    await renameDialog.getByRole('button', { name: '취소', exact: true }).click();
    await renameDialog.waitFor({ state: 'detached' });
    assert.deepEqual(writes, [], 'cancelling the rename dialog never writes');

    await categoryButton(originalName).click();
    await trigger(originalName).click();
    await renameItem().click();
    const renameInput = page.getByRole('textbox', { name: '분류 이름', exact: true });
    await renameInput.fill(`  ${renamedName}  `);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes('test category rename failure'));
    assert.equal(await renameInput.count(), 1, 'a failed rename keeps the editor open');
    assert.equal(categories.find((category) => category.id === 1).name, originalName);
    assert.equal(files.find((file) => file.id === 101).category, originalName);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await trigger(renamedName).waitFor();
    await renameInput.waitFor({ state: 'detached' });
    assert.equal(categories.find((category) => category.id === 1).name, renamedName);
    assert.equal(files.find((file) => file.id === 101).category, renamedName, 'renaming a category preserves its document association');
    assert.deepEqual(fileSnapshot(), initialFiles, 'renaming preserves every file ID, URL and metadata');
    assert.equal(await page.getByRole('heading', { name: renamedName, exact: true }).count(), 1, 'active file view follows the renamed category');
    assert.equal(await page.getByRole('button', { name: '연결된 운영 문서.pdf 미리보기', exact: true }).count(), 1, 'linked files remain visible under the new name');
    assert.deepEqual(writes.filter((entry) => entry.pathname.endsWith('/rename_category_with_files')).map((entry) => entry.body), [
      { p_old_name: originalName, p_new_name: renamedName },
      { p_old_name: originalName, p_new_name: renamedName },
    ]);
    checks.push('rename failure is recoverable; retry uses the atomic RPC and retains category ID, file IDs, URLs and selected view');

    await trigger(renamedName).click();
    await deleteItem().click();
    await trigger(renamedName).waitFor();
    assert.equal(dialogs.filter((dialog) => dialog.type === 'confirm').length, 1, 'delete explicitly requires confirmation');
    assert.match(dialogs.at(-1).message, /파일 1개/);
    assert.equal(writes.filter((entry) => entry.method === 'DELETE').length, 0, 'cancelling confirmation never deletes');
    acceptConfirmation = true;
    await trigger(renamedName).click();
    await deleteItem().click();
    await trigger(renamedName).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();
    await trigger(renamedName).waitFor();
    assert.equal(writes.filter((entry) => entry.method === 'DELETE').length, 0, 'undo prevents all database and storage deletions');
    assert.equal(await page.getByRole('button', { name: '연결된 운영 문서.pdf 미리보기', exact: true }).count(), 1, 'undo restores files and the selected category');
    checks.push('deletion requires confirm; cancel is inert; undo restores category and linked files before any persistence');

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: '분류 메뉴', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().left >= -1);
      assert.equal(await sidebar.getByRole('button', { name: '홈', exact: true }).innerText(), '홈', 'mobile drawer uses the exact 홈 label');
      await trigger(bottomName).scrollIntoViewIfNeeded();
      await trigger(bottomName).click();
      await renameItem().waitFor();
      await assertMenuFits();
      await assertNoOverflow();
      await capture(`mobile-${width}-bottom-menu`);
      await page.keyboard.press('Escape');
      await sidebar.getByRole('button', { name: '홈', exact: true }).click();
      await page.locator('[data-dashboard-root]').waitFor();
      await page.waitForFunction(() => document.querySelector('main > aside')?.getBoundingClientRect().right <= 1);
      await assertNoOverflow();
      const mobileMore = page.locator('details').filter({ has: page.locator('summary[aria-label="더보기 메뉴"]') });
      await mobileMore.locator('summary').click();
      assert.equal(await mobileMore.getByRole('button', { name: '홈', exact: true }).innerText(), '홈', 'mobile More menu uses the same exact 홈 label');
      await mobileMore.getByRole('button', { name: '홈', exact: true }).click();
      assert.equal(await mobileMore.getAttribute('open'), null, 'mobile 홈 action closes the More menu');
    }
    checks.push('390px and 320px drawer menus fit; bottom actions stay visible; mobile 홈 returns to the original dashboard');

    await page.getByRole('button', { name: '분류 메뉴', exact: true }).click();
    await trigger(renamedName).click();
    await deleteItem().click();
    await page.getByRole('button', { name: '되돌리기', exact: true }).waitFor();
    assert.equal(writes.some((entry) => entry.method === 'DELETE'), false, 'accepted delete remains undoable before its timer');
    const storageDeleted = page.waitForResponse((response) => new URL(response.url()).pathname.startsWith('/storage/v1/') && response.request().method() === 'DELETE');
    await page.clock.fastForward(8100);
    await storageDeleted;
    await page.waitForFunction(() => !document.body.innerText.includes('8초 후 삭제가 확정됩니다.'));
    const deletions = writes.filter((entry) => entry.method === 'DELETE');
    assert.equal(deletions.filter((entry) => entry.pathname.endsWith('/files')).length, 2, 'commit deletes one metadata row set and one storage object set');
    assert.equal(deletions.filter((entry) => entry.pathname.endsWith('/categories')).length, 1, 'commit deletes the category once');
    assert.equal(new URLSearchParams(deletions.find((entry) => entry.pathname === '/rest/v1/files').query).get('id'), 'in.(101)', 'file deletion targets the captured file ID');
    assert.equal(new URLSearchParams(deletions.find((entry) => entry.pathname === '/rest/v1/categories').query).get('id'), 'eq.1', 'category deletion targets its stable ID');
    assert.deepEqual(deletions.find((entry) => entry.pathname.startsWith('/storage/v1/')).body, { prefixes: ['operations.pdf'] }, 'storage cleanup touches only the target category file');
    assert.deepEqual(files.map((file) => file.id), [102, 103], 'committed deletion only removes the selected category documents');
    assert.ok(!categories.some((category) => category.id === 1));
    assert.ok(categories.some((category) => category.id === 2));
    checks.push('accepted deletion persists only after its undo interval, deleting the target category, target file IDs and their storage object');

    assert.deepEqual(errors, [], 'browser must not log uncaught page errors');
    console.log(JSON.stringify({ passed: true, checks, writes, screenshots, browserErrors: errors }, null, 2));
  } catch (error) {
    console.error((await page.locator('body').innerText()).slice(0, 6000));
    console.error('Browser errors:', errors);
    if (process.env.SIDEBAR_CATEGORY_TRACE === '1') console.error('Interaction trace:', await page.evaluate(() => window.__sidebarQaEvents.slice(-80)));
    await capture('failure').catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
