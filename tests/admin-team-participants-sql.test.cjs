/* eslint-disable @typescript-eslint/no-require-imports -- Disposable local PostgreSQL only. Never run fixtures on production. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261113_admin_team_participants.sql');
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('admin participation is additive and independent from actual device administrator authority', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(migration, /update public\.device_access|insert into public\.device_access|delete from public\.team_members|delete from public\.chat_notice_preferences/i);
  assert.doesNotMatch(migration, /insert into public\.team_notifications|update public\.messages|update public\.schedules|create policy|grant .* on table/i);
  assert.match(migration, /on conflict \(notice_id, principal\) do nothing/i);
  assert.match(migration, /where created_by_user_id = p_user_id and created_by_principal = old_principal/i);
  assert.match(migration, /revoke all on function public\.preserve_team_chat_notice_identity\(uuid, uuid\) from public, anon, authenticated/i);
});

test('approved administrator members participate without role elevation, kiosk enrollment or history loss', {
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
  const mappings = async () => Object.fromEntries((await q('select user_id,member_id from public.team_member_devices')).map((row) => [row.user_id, row.member_id]));
  const sourceSnapshot = () => scalar("select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by id) from public.messages m),'schedules',(select jsonb_agg(to_jsonb(s) order by id) from public.schedules s),'files',(select jsonb_agg(to_jsonb(f) order by id) from public.files f),'notifications',(select jsonb_agg(to_jsonb(n) order by id) from public.team_notifications n))");
  let ids;
  let legacyNotice;
  let otherAdminNotice;
  let firstMessage;
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const file of [
      '20260803_device_access_setup.sql', '20260803_approved_device_data_access.sql',
      '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql', '20261112_schedule_team_details.sql',
    ]) await db.exec(read(`supabase/migrations/${file}`));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    await q("insert into public.device_access(user_id,device_name,status,is_admin) values($1,'홍길동 사내PC','approved',true),($2,'손-전광판모드','approved',false)", [user(11), user(9)]);
    await db.exec(read('supabase/migrations/20261113_team_identity_notifications.sql'));
    await db.exec(read('supabase/migrations/20261113_team_responsibility.sql'));
    await db.exec(read('supabase/migrations/20261113_team_chat_notices.sql'));
    ids = await mappings();
    await q('update public.team_member_devices set is_kiosk=true where user_id=$1', [user(9)]);
    const secondMessage = await as(11, () => scalar("insert into public.messages(content) values('다른 관리자의 이전 공지') returning id"));
    otherAdminNotice = await as(11, () => scalar('select public.publish_team_chat_notice($1)', [secondMessage]));
    await as(11, () => q('select public.set_team_chat_notice_preference($1,false,true)', [otherAdminNotice]));
    firstMessage = await as(1, () => scalar("insert into public.messages(content) values('기존 관리자 공지') returning id"));
    legacyNotice = await as(1, () => scalar('select public.publish_team_chat_notice($1)', [firstMessage]));
    await as(1, () => q('select public.set_team_chat_notice_preference($1,true,true)', [legacyNotice]));
    await as(3, () => q('select public.set_team_chat_notice_preference($1,false,false)', [legacyNotice]));
    await as(1, () => q("select public.set_device_access($1,'approved',true)", [user(3)]));
    await as(3, () => q('select public.set_team_chat_notice_preference($1,true,true)', [legacyNotice]));
    await as(9, () => q('select public.set_team_chat_notice_preference($1,false,true)', [legacyNotice]));
    const beforeSources = await sourceSnapshot();
    const beforeDevices = await q('select * from public.device_access order by user_id');
    const beforeMembers = await q('select * from public.team_members order by id');
    const beforeKiosks = await q('select * from public.team_member_devices where is_kiosk order by user_id');
    const oldIds = { ...ids };
    await db.exec(migration);
    ids = await mappings();

    await t.test('backfill creates separate admin IDs and preserves existing members, sources and device roles', async () => {
      assert.ok(ids[user(1)]);
      assert.ok(ids[user(11)]);
      assert.notEqual(ids[user(11)], ids[user(2)], 'equal names cannot merge identities');
      assert.notEqual(ids[user(11)], ids[user(3)]);
      for (const n of [2, 3, 10]) assert.equal(ids[user(n)], oldIds[user(n)]);
      for (const original of beforeMembers) assert.deepEqual((await q('select * from public.team_members where id=$1', [original.id]))[0], original);
      assert.deepEqual(await q('select * from public.device_access order by user_id'), beforeDevices);
      assert.deepEqual(await sourceSnapshot(), beforeSources);
      assert.equal(await scalar('select count(*)::int from public.team_members'), beforeMembers.length + 2);
      assert.equal((await as(2, () => q('select * from public.list_team_members()'))).length, 5);
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });

    await t.test('all explicit kiosk markers stay unchanged and never gain a human current identity or inbox', async () => {
      assert.deepEqual(await q('select * from public.team_member_devices where is_kiosk order by user_id'), beforeKiosks);
      for (const n of [6, 7, 9]) {
        assert.equal(await as(n, () => scalar('select public.current_team_member_id()')), null);
        assert.equal(await as(n, () => scalar('select public.get_my_team_member()')), null);
        assert.equal((await as(n, () => q('select * from public.list_my_team_notifications()'))).length, 0);
      }
      assert.equal((await state(9)).hidden, true, 'kiosk auth-scoped preference remains isolated');
      await as(1, () => q("select public.set_device_access($1,'approved',true)", [user(9)]));
      assert.equal(await as(9, () => scalar('select public.current_team_member_id()')), null, 'an administrative device role cannot turn an explicit kiosk into a human participant');
    });

    await t.test('old admin notice settings/authorship are preserved without overwriting member settings or deleting user history', async () => {
      assert.equal((await state(1)).hidden, true);
      assert.equal((await state(1)).collapsed, true);
      assert.equal((await state(3)).hidden, false, 'existing canonical member preference wins over user-scoped copy');
      assert.equal((await state(3)).collapsed, false);
      assert.equal((await q('select hidden from public.chat_notice_preferences where notice_id=$1 and principal=$2', [otherAdminNotice, `member:${ids[user(11)]}`]))[0].hidden, true);
      assert.equal(await scalar("select count(*)::int from public.chat_notice_preferences where principal like 'user:%'"), 4, 'all legacy user rows remain for history');
      const author = (await q('select created_by_principal,created_by_user_id,created_by_member_id from public.chat_notices where id=$1', [legacyNotice]))[0];
      assert.deepEqual(author, { created_by_principal: `member:${ids[user(1)]}`, created_by_user_id: user(1), created_by_member_id: ids[user(1)] });
      assert.equal((await state(2)).notice.can_remove, false);
    });

    await t.test('administrators have their own attendee and mention inbox, not another member inbox', async () => {
      const scheduleId = await as(2, () => scalar("insert into public.schedules(title,date,attendee_member_ids,owner_member_id) values('관리자 참석 일정','2026-11-13',$1,$2) returning id", [[ids[user(1)], ids[user(11)]], ids[user(1)]]));
      assert.equal(await scalar('select owner_member_id from public.schedules where id=$1', [scheduleId]), ids[user(1)]);
      const adminInbox = await as(1, () => q('select * from public.list_my_team_notifications()'));
      const otherInbox = await as(11, () => q('select * from public.list_my_team_notifications()'));
      assert.equal(adminInbox.length, 1);
      assert.equal(otherInbox.length, 1);
      assert.notEqual(adminInbox[0].id, otherInbox[0].id);
      assert.equal((await as(1, () => q('select * from public.team_notifications'))).length, 1);
      assert.equal(await as(1, () => scalar('select public.mark_my_notifications_read($1)', [[otherInbox[0].id]])), 0);
      await as(2, () => q("insert into public.messages(content,mentioned_member_ids) values('관리자 멘션',$1)", [[ids[user(1)]]]));
      assert.equal((await as(1, () => q('select * from public.list_my_team_notifications()'))).length, 2);
      const sent = await as(1, () => scalar("insert into public.messages(content) values('관리자가 보낸 새 메시지') returning sender_member_id"));
      assert.equal(sent, ids[user(1)]);
      assert.equal(await as(1, () => scalar('select public.is_device_admin()')), true);
      assert.equal(await as(2, () => scalar('select public.is_device_admin()')), false);
    });

    await t.test('future administrator approvals provision automatically without promoting any other profile', async () => {
      await as(1, () => q("select public.set_device_access($1,'approved',true)", [user(8)]));
      const current = await as(8, () => scalar('select public.get_my_team_member()'));
      assert.ok(current.id);
      assert.equal(current.display_name, '미래 승인자');
      assert.equal(await as(8, () => scalar('select public.is_device_admin()')), true);
      assert.equal(await as(2, () => scalar('select public.is_device_admin()')), false);
      const pairId = await scalar('insert into public.kiosk_pair_requests(target_user_id) values($1) returning id', [user(4)]);
      await as(8, () => q('select public.approve_kiosk_pair($1)', [pairId]));
      assert.equal(await as(4, () => scalar('select public.current_team_member_id()')), null);
      assert.equal((await q('select member_id,is_kiosk from public.team_member_devices where user_id=$1', [user(4)]))[0].member_id, current.id);
    });

    await t.test('role/status transitions retain UUIDs and old publisher ownership independently from administrator privilege', async () => {
      const original = ids[user(1)];
      await as(11, () => q("select public.set_device_access($1,'approved',false)", [user(1)]));
      assert.equal(await as(1, () => scalar('select public.current_team_member_id()')), original);
      assert.equal(await as(1, () => scalar('select public.is_device_admin()')), false);
      assert.equal((await state(1)).notice.can_remove, true, 'original publisher keeps their own notice authority');
      await as(11, () => q("select public.set_device_access($1,'blocked',false)", [user(1)]));
      assert.equal(await as(1, () => scalar('select public.current_team_member_id()')), null);
      await as(1, async () => assert.rejects(() => q('select * from public.list_my_team_notifications()'), /Approved device/));
      await as(11, () => q("select public.set_device_access($1,'approved',true)", [user(1)]));
      assert.equal(await as(1, () => scalar('select public.current_team_member_id()')), original);
    });

    await t.test('only an administrator can explicitly link administrator devices; roles, kiosks and old history remain intact', async () => {
      await as(2, async () => assert.rejects(() => q('select public.admin_link_team_member_device($1,$2)', [user(11), ids[user(1)]]), /Administrator access/));
      await as(1, async () => assert.rejects(() => q('select public.admin_link_team_member_device($1,$2)', [user(9), ids[user(1)]]), /kiosk companion/));
      const oldMember = ids[user(11)];
      const oldHistory = await q('select * from public.team_notifications where recipient_member_id=$1', [oldMember]);
      await as(1, () => q('select public.admin_link_team_member_device($1,$2)', [user(11), ids[user(1)]]));
      assert.equal(await as(11, () => scalar('select public.current_team_member_id()')), ids[user(1)]);
      assert.equal(await as(11, () => scalar('select public.is_device_admin()')), true);
      assert.equal(await as(2, () => scalar('select public.is_device_admin()')), false);
      assert.deepEqual(await q('select * from public.team_notifications where recipient_member_id=$1', [oldMember]), oldHistory);
      assert.equal(await scalar('select count(*)::int from public.team_members where id=$1', [oldMember]), 1);
      assert.equal(await scalar('select team_member_is_active($1)', [oldMember]), false);
      await as(1, () => q('select public.admin_link_team_member_device($1,$2)', [user(2), ids[user(1)]]));
      assert.equal(await as(2, () => scalar('select public.current_team_member_id()')), ids[user(1)]);
      assert.equal(await as(2, () => scalar('select public.is_device_admin()')), false, 'sharing an admin member ID never shares the device administrator role');
      await as(2, async () => assert.rejects(() => q('select public.admin_set_team_member_name($1,$2)', [ids[user(1)], '권한 위조']), /Administrator access/));
      await as(2, async () => assert.rejects(() => q('select * from public.list_device_access()'), /Administrator access/));
    });

    await t.test('private identity preservation helpers remain inaccessible and reruns are idempotent', async () => {
      await as(2, async () => {
        await assert.rejects(() => q('select public.provision_team_member_device($1)', [user(2)]), /permission denied/);
        await assert.rejects(() => q('select public.preserve_team_chat_notice_identity($1,$2)', [user(2), ids[user(1)]]), /permission denied/);
      });
      await db.exec('set role anon');
      try { await assert.rejects(() => q('select public.current_team_member_id()'), /permission denied/); }
      finally { await db.exec('reset role'); }
      const before = await q('select id,display_name,handle from public.team_members order by id');
      const preferences = await q('select * from public.chat_notice_preferences order by notice_id,principal');
      const notices = await q('select * from public.chat_notices order by id');
      const sources = await sourceSnapshot();
      await db.exec(migration);
      assert.deepEqual(await q('select id,display_name,handle from public.team_members order by id'), before);
      assert.deepEqual(await q('select * from public.chat_notice_preferences order by notice_id,principal'), preferences);
      assert.deepEqual(await q('select * from public.chat_notices order by id'), notices);
      assert.deepEqual(await sourceSnapshot(), sources);
    });
  } finally { await db.close(); }
});
