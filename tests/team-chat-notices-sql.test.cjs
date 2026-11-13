/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local PostgreSQL only; never run fixtures on production. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261113_team_chat_notices.sql');
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('chat notice SQL keeps private display settings separate from the single shared notice', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /chat_notices_one_active_idx[\s\S]*?where active/);
  assert.match(migration, /references public\.messages\(id\) on delete cascade/);
  assert.match(migration, /revoke all on table public\.chat_notices, public\.chat_notice_preferences from public, anon, authenticated/);
  assert.doesNotMatch(migration, /update public\.messages|insert into public\.messages|create policy|grant .* on table|insert into public\.team_notifications/i);
});

test('shared chat notice and ID-scoped preferences execute in isolated PostgreSQL', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to the temporary @electric-sql/pglite runtime for SQL integration tests.',
}, async (t) => {
  const db = new PGlite();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await q(sql, params))[0])[0];
  const as = async (n, run) => {
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub', $1, false)", [n ? user(n) : '']);
    if (n) await db.exec('set role authenticated');
    try { return await run(); } finally {
      await db.exec('reset role');
      await q("select set_config('request.jwt.claim.sub', '', false)");
    }
  };
  const state = (n) => as(n, () => scalar('select public.get_team_chat_notice_state()'));
  let memberIds;
  let firstMessage;
  let secondMessage;
  let firstNotice;
  let secondNotice;
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const file of [
      '20260803_device_access_setup.sql', '20260803_approved_device_data_access.sql',
      '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql', '20261112_schedule_team_details.sql',
    ]) await db.exec(read(`supabase/migrations/${file}`));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    await db.exec(read('supabase/migrations/20261113_team_identity_notifications.sql'));
    memberIds = Object.fromEntries((await q('select user_id, member_id from public.team_member_devices')).map((row) => [row.user_id, row.member_id]));
    firstMessage = await as(2, () => scalar("insert into public.messages(content) values('첫 공지 원문') returning id"));
    secondMessage = await as(3, () => scalar("insert into public.messages(content) values('두 번째 공지 원문') returning id"));
    await db.exec(migration);

    await t.test('installation does not publish old messages, create personal settings, or send alerts', async () => {
      assert.deepEqual(await state(2), { notice: null, collapsed: false, hidden: false });
      assert.equal(await scalar('select count(*)::int from public.messages'), 2);
      assert.equal(await scalar('select count(*)::int from public.chat_notices'), 0);
      assert.equal(await scalar('select count(*)::int from public.chat_notice_preferences'), 0);
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });

    await t.test('only approved profiles may call RPCs; tables and principal helper are private', async () => {
      for (const n of [4, 5, 9]) {
        await as(n, async () => {
          await assert.rejects(() => q('select public.get_team_chat_notice_state()'), /Approved device/);
          await assert.rejects(() => q('select public.publish_team_chat_notice($1)', [firstMessage]), /Approved device/);
          await assert.rejects(() => q('select public.set_team_chat_notice_preference($1,true,true)', [user(11)]), /Approved device/);
          await assert.rejects(() => q('select public.remove_team_chat_notice($1)', [user(11)]), /Approved device/);
        });
      }
      await as(2, async () => {
        await assert.rejects(() => q('select * from public.chat_notices'), /permission denied/);
        await assert.rejects(() => q('select * from public.chat_notice_preferences'), /permission denied/);
        await assert.rejects(() => q('select public.team_chat_notice_principal()'), /permission denied/);
      });
      await db.exec('set role anon');
      try { await assert.rejects(() => q('select public.get_team_chat_notice_state()'), /permission denied/); }
      finally { await db.exec('reset role'); }
    });

    await t.test('publishing derives its actor and everyone sees one original referenced message', async () => {
      firstNotice = await as(2, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage]));
      assert.equal((await state(2)).notice.can_remove, true);
      assert.equal((await state(3)).notice.can_remove, false);
      assert.equal((await state(1)).notice.can_remove, true);
      assert.equal((await state(3)).notice.content, '첫 공지 원문');
      assert.equal((await state(3)).notice.message_id, firstMessage);
      const actor = (await q('select created_by_principal,created_by_user_id,created_by_member_id,author_name from public.chat_notices where id=$1', [firstNotice]))[0];
      assert.equal(actor.created_by_principal, `member:${memberIds[user(2)]}`);
      assert.equal(actor.created_by_user_id, user(2));
      assert.equal(actor.created_by_member_id, memberIds[user(2)]);
      assert.equal(actor.author_name, '홍길동');
      assert.equal(await as(3, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage])), firstNotice, 'retry/same message cannot take over ownership');
      assert.equal(await scalar('select count(*)::int from public.chat_notices where active'), 1);
      assert.equal(await scalar('select count(*)::int from public.messages'), 2);
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });

    await t.test('collapse/hide belongs to each stable ID, not an equal display name or everyone', async () => {
      await as(2, () => q('select public.set_team_chat_notice_preference($1,true,true)', [firstNotice]));
      assert.equal((await state(2)).hidden, true);
      assert.equal((await state(2)).collapsed, true);
      assert.equal((await state(3)).hidden, false, 'equal-name member has a distinct preference');
      assert.equal((await state(3)).collapsed, false);
      await as(1, () => q('select public.admin_link_team_member_device($1,$2)', [user(10), memberIds[user(2)]]));
      assert.equal((await state(10)).hidden, true, 'explicitly linked human browser shares stable-ID state');
      await as(10, () => q('select public.set_team_chat_notice_preference($1,false,false)', [firstNotice]));
      assert.equal((await state(2)).hidden, false);
      assert.equal((await state(3)).hidden, false);
      assert.equal(await scalar('select count(*)::int from public.chat_notice_preferences'), 1);
    });

    await t.test('admins and kiosk profiles without a team member use isolated auth-ID preferences', async () => {
      await as(1, () => q('select public.set_team_chat_notice_preference($1,true,true)', [firstNotice]));
      assert.equal((await state(1)).hidden, true);
      assert.equal((await state(7)).hidden, false, 'administrator companion is not a shared human inbox');
      await as(7, () => q('select public.set_team_chat_notice_preference($1,true,false)', [firstNotice]));
      assert.equal((await state(7)).collapsed, true);
      assert.equal((await state(1)).hidden, true);
      assert.equal((await state(2)).hidden, false);
      assert.equal(await scalar("select count(*)::int from public.chat_notice_preferences where principal like 'user:%'"), 2);
    });

    await t.test('only publisher/administrator can end the shared notice, and personal hiding never ends it', async () => {
      await as(3, async () => assert.rejects(() => q('select public.remove_team_chat_notice($1)', [firstNotice]), /publisher or an administrator/));
      assert.equal((await state(3)).notice.id, firstNotice);
      assert.equal((await state(10)).notice.can_remove, true, 'linked human ID is the publisher');
      await as(10, () => q('select public.remove_team_chat_notice($1)', [firstNotice]));
      assert.equal((await state(3)).notice, null);
      firstNotice = await as(2, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage]));
      await as(1, () => q('select public.remove_team_chat_notice($1)', [firstNotice]));
      assert.equal((await state(2)).notice, null);
      firstNotice = await as(2, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage]));
    });

    await t.test('replacement gets a new notice ID and stale actions cannot alter the newer announcement', async () => {
      await as(2, () => q('select public.set_team_chat_notice_preference($1,true,true)', [firstNotice]));
      secondNotice = await as(3, () => scalar('select public.publish_team_chat_notice($1)', [secondMessage]));
      assert.notEqual(secondNotice, firstNotice);
      assert.equal((await state(2)).notice.id, secondNotice);
      assert.equal((await state(2)).hidden, false);
      assert.equal((await state(2)).collapsed, false);
      await as(2, () => q('select public.remove_team_chat_notice($1)', [firstNotice]));
      assert.equal((await state(3)).notice.id, secondNotice);
      await as(2, async () => assert.rejects(() => q('select public.set_team_chat_notice_preference($1,true,true)', [firstNotice]), /no longer active/));
      assert.equal(await scalar('select count(*)::int from public.chat_notices where active'), 1);
    });

    await t.test('edited source text is reflected, deleted sources clear notice/preferences, and empty/missing messages reject', async () => {
      await as(3, () => q('select public.set_team_chat_notice_preference($1,true,false)', [secondNotice]));
      await as(3, () => q("update public.messages set content='수정한 공지 원문' where id=$1", [secondMessage]));
      assert.equal((await state(2)).notice.content, '수정한 공지 원문');
      // Legacy deployments can allow null source content. A later edit must
      // keep the management controls usable even though new blank pins reject.
      await db.exec('alter table public.messages alter column content drop not null');
      await as(3, () => q('update public.messages set content=null where id=$1', [secondMessage]));
      assert.equal((await state(3)).notice.content, '');
      assert.equal((await state(3)).notice.can_remove, true);
      await as(3, () => q('delete from public.messages where id=$1', [secondMessage]));
      assert.equal((await state(2)).notice, null);
      assert.equal(await scalar('select count(*)::int from public.chat_notices where id=$1', [secondNotice]), 0);
      assert.equal(await scalar('select count(*)::int from public.chat_notice_preferences where notice_id=$1', [secondNotice]), 0);
      await as(2, async () => assert.rejects(() => q('select public.publish_team_chat_notice($1)', [secondMessage]), /no longer exists/));
      const blank = await as(2, () => scalar("insert into public.messages(content) values('   ') returning id"));
      await as(2, async () => assert.rejects(() => q('select public.publish_team_chat_notice($1)', [blank]), /non-empty/));
      // Some legacy deployments allow nullable message content. Exercise that
      // compatibility only in this disposable database, never on production.
      const empty = await as(2, () => scalar('insert into public.messages(content) values(null) returning id'));
      await as(2, async () => assert.rejects(() => q('select public.publish_team_chat_notice($1)', [empty]), /non-empty/));
      await as(2, async () => assert.rejects(() => q('select public.publish_team_chat_notice(null)'), /Choose a message/));
    });

    await t.test('migration rerun preserves current notice and preferences without changing existing sources', async () => {
      const notice = await as(2, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage]));
      await as(2, () => q('select public.set_team_chat_notice_preference($1,true,true)', [notice]));
      await db.exec(migration);
      assert.equal((await state(2)).notice.id, notice);
      assert.equal((await state(2)).hidden, true);
      assert.equal((await state(3)).hidden, false);
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });
  } finally { await db.close(); }
});
