/* eslint-disable @typescript-eslint/no-require-imports -- Local-only mocked document assignment regression. */
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.DOCUMENT_OWNER_TEST_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname));

const userId = '11111111-1111-4111-8111-111111111111';
const memberA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: '김민수', handle: 'minsu-a' };
const memberB = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: '김민수', handle: 'minsu-b' };
const inactiveId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: 2100000000, role: 'authenticated' })).toString('base64url')}.local-test-only`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contexts = [], errors = [], screenshots = [];
  let currentPage;
  const createPage = async (capable = true) => {
    const context = await browser.newContext({ viewport: { width: 1365, height: 950 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    contexts.push(context);
    const state = { writes: [], failNextSave: true, files: [
      { id: 1, name: '담당자 선택 문서.hwp', url: 'https://fixture.invalid/owner.hwp', category: '팀회의', size: 2048, created_at: '2026-11-13T01:00:00Z', ...(capable ? { owner_member_id: null } : {}) },
      { id: 2, name: '비활성 담당자 문서.hwp', url: 'https://fixture.invalid/inactive.hwp', category: '팀회의', size: 2048, created_at: '2026-11-13T00:00:00Z', ...(capable ? { owner_member_id: inactiveId } : {}) },
    ] };
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/auth/v1/')) return reply({ access_token: token, refresh_token: 'local-refresh', token_type: 'bearer', expires_in: 3600, expires_at: 2100000000, user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-11-01T00:00:00Z' } });
      if (url.pathname.endsWith('/get_device_access_status')) return reply({ status: 'approved', user_id: userId, is_admin: false });
      if (url.pathname.includes('/rest/v1/rpc/')) {
        const rpc = url.pathname.split('/').at(-1);
        if (rpc === 'list_team_members') return reply([memberA, memberB]);
        if (rpc === 'get_my_team_member') return reply(memberA);
        if (rpc === 'list_my_team_notifications') return reply([]);
        if (rpc === 'team_responsibility_available') return capable ? reply(true) : reply({ code: 'PGRST202', message: 'Optional owner capability unavailable' }, 404);
        state.writes.push({ unexpectedRpc: rpc });
        return reply({ message: 'Unexpected RPC blocked' }, 403);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').at(-1);
        if (request.method() !== 'GET') {
          const body = request.postDataJSON();
          state.writes.push({ table, method: request.method(), body });
          if (table !== 'files' || request.method() !== 'PATCH') return reply({ message: 'Only mocked document metadata changes are permitted' }, 403);
          if (state.failNextSave) { state.failNextSave = false; return reply({ code: '42501', message: '담당자 변경 저장 실패 테스트' }, 403); }
          const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
          Object.assign(state.files.find((file) => file.id === id), body);
          return reply([{ id }]);
        }
        if (table === 'files') return reply(state.files);
        if (table === 'categories') return reply([{ id: 1, name: '팀회의', order_index: 0 }]);
        return reply([]);
      }
      if (url.pathname === '/api/korean-holidays') return reply({ holidays: [] });
      if (url.origin === new URL(baseUrl).origin) return route.continue();
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
    await page.getByRole('button', { name: '🏠 전체 문서 보기', exact: true }).click();
    return { page, state };
  };
  const open = async (page, name) => {
    await page.getByRole('button', { name: `${name} 문서 정보 수정`, exact: true }).click();
    const editor = page.getByRole('dialog', { name: '문서 정보 수정', exact: true });
    await editor.waitFor();
    return editor;
  };
  const save = async (editor) => { await editor.getByRole('button', { name: '변경 저장', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); };
  const choose = async (editor, handle) => {
    await editor.getByRole('combobox', { name: '문서 담당자', exact: true }).fill(`@${handle}`);
    await editor.getByRole('option', { name: new RegExp(`@${handle}`) }).click();
  };
  try {
    const regular = await createPage();
    const { page, state } = regular;
    currentPage = page;
    let editor = await open(page, '담당자 선택 문서.hwp');
    await editor.getByRole('combobox', { name: '문서 담당자', exact: true }).waitFor();
    assert.equal(await editor.getByRole('list', { name: '문서 담당자 선택됨', exact: true }).count(), 0, 'existing documents remain unassigned');
    await choose(editor, 'minsu-b');
    await editor.getByLabel('파일 이름', { exact: true }).fill('담당자 지정 문서');
    await editor.getByRole('button', { name: '변경 저장', exact: true }).click();
    await editor.getByRole('alert').getByText('담당자 변경 저장 실패 테스트', { exact: true }).waitFor();
    assert.equal(await editor.getByLabel('파일 이름', { exact: true }).inputValue(), '담당자 지정 문서');
    await editor.getByRole('list', { name: '문서 담당자 선택됨', exact: true }).getByText('@minsu-b', { exact: true }).waitFor();
    await save(editor);
    assert.equal(state.writes.at(-1).body.owner_member_id, memberB.id, 'equal names are distinguished by selected member ID');
    assert.equal(state.files[0].url, 'https://fixture.invalid/owner.hwp', 'assignment never replaces file contents or URL');
    await page.locator('table [data-document-owner]').getByText('담당 김민수', { exact: true }).waitFor();
    assert.equal(await page.locator('table [data-document-owner]').first().getAttribute('title'), '@minsu-b');

    editor = await open(page, '담당자 지정 문서.hwp');
    const search = editor.getByRole('combobox', { name: '문서 담당자', exact: true });
    await search.fill('@minsu-a');
    await editor.getByRole('listbox', { name: '문서 담당자 검색 결과', exact: true }).waitFor();
    await search.press('Escape');
    await editor.waitFor();
    assert.equal(await search.getAttribute('aria-expanded'), 'false', 'Escape closes picker before the enclosing document editor');
    await editor.getByRole('list', { name: '문서 담당자 선택됨', exact: true }).getByRole('button', { name: '김민수 @minsu-b 선택 해제', exact: true }).click();
    await save(editor);
    assert.equal(state.writes.at(-1).body.owner_member_id, null, 'explicit unlink persists null');

    editor = await open(page, '비활성 담당자 문서.hwp');
    await editor.getByRole('list', { name: '문서 담당자 선택됨', exact: true }).getByText('등록 확인 필요').waitFor();
    await editor.getByLabel('파일 이름', { exact: true }).fill('비활성 담당자 유지 문서');
    await save(editor);
    assert.equal(Object.hasOwn(state.writes.at(-1).body, 'owner_member_id'), false, 'unchanged inactive owner is not silently removed or remapped');
    assert.equal(state.files[1].owner_member_id, inactiveId);

    await page.setViewportSize({ width: 320, height: 760 });
    editor = await open(page, '담당자 지정 문서.hwp');
    await choose(editor, 'minsu-a');
    const bounds = await editor.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320, 'owner editor fits 320px');
    const screenshot = path.join(os.tmpdir(), 'my-portal-document-owner-mobile-320.png');
    await page.screenshot({ path: screenshot });
    screenshots.push(screenshot);
    await save(editor);
    assert.equal(state.writes.at(-1).body.owner_member_id, memberA.id);

    const old = await createPage(false);
    currentPage = old.page;
    old.state.failNextSave = false;
    editor = await open(old.page, '담당자 선택 문서.hwp');
    assert.equal(await editor.getByRole('combobox', { name: '문서 담당자', exact: true }).count(), 0, 'legacy backend hides optional assignment control');
    await editor.getByLabel('파일 이름', { exact: true }).fill('이전 스키마 문서 변경');
    await save(editor);
    assert.equal(Object.hasOwn(old.state.writes.at(-1).body, 'owner_member_id'), false);
    assert.ok([...state.writes, ...old.state.writes].every((entry) => entry.table === 'files' && entry.method === 'PATCH'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, cases: ['unassigned documents stay unassigned', 'same-name owner ID selection', 'failed save keeps name and owner draft', 'owner badge uses the selected handle', 'Escape closes picker only', 'explicit null unlink', 'inactive original ID preserved', '320px layout', 'old-schema controls hidden without new column'], screenshots }, null, 2));
  } catch (failure) {
    if (currentPage) console.error((await currentPage.locator('body').innerText()).slice(-6000));
    console.error('Browser errors:', errors);
    throw failure;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
