/* eslint-disable @typescript-eslint/no-require-imports -- Local-only optional PostgreSQL test runtime. */
// Isolated PostgreSQL 18 (PGlite), never a remote connection. Optional dependency:
// npm.cmd install --prefix "$env:TEMP/my-portal-team-sql-runtime" --no-save --package-lock=false @electric-sql/pglite
// $env:PGLITE_MODULE="$env:TEMP/my-portal-team-sql-runtime/node_modules/@electric-sql/pglite"
// node --test tests/team-identity-sql.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261113_team_identity_notifications.sql');
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('team migration preserves names as labels, UUID routing, and private security boundaries', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /unique\(kind, source_id, recipient_member_id\)/);
  assert.match(migration, /revoke all on table public\.team_members, public\.team_member_devices from public, anon, authenticated/);
  assert.match(migration, /create policy team_notifications_require_own[\s\S]*?as restrictive/);
  assert.doesNotMatch(migration, /update public\.schedules set attendee_member_ids/);
  assert.doesNotMatch(migration, /drop table/i);
});

test('team identity and in-app notifications execute in isolated PostgreSQL', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to the temporary @electric-sql/pglite install to run SQL integration tests.',
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
  const rejected = async (sql, params, pattern) => {
    await assert.rejects(() => q(sql, params), pattern);
  };
  let ids;
  let scheduleId;
  let notificationId;
  let messageId;
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const file of [
      '20260803_device_access_setup.sql', '20260803_approved_device_data_access.sql',
      '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql', '20261112_schedule_team_details.sql',
    ]) await db.exec(read(`supabase/migrations/${file}`));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    await db.exec(migration);
    ids = Object.fromEntries((await q('select user_id, member_id from public.team_member_devices')).map((row) => [row.user_id, row.member_id]));
    const member = (n) => ids[user(n)];

    await t.test('backfill skips pending, blocked, admins, and explicitly paired kiosks; equal names remain separate', async () => {
      assert.equal(await scalar('select count(*)::int from public.team_members'), 3);
      assert.equal(await scalar('select count(*)::int from public.team_member_devices'), 5);
      assert.equal(member(1), undefined);
      assert.equal(member(4), undefined);
      assert.equal(member(5), undefined);
      assert.equal(member(6), member(2));
      assert.equal(member(7), null);
      assert.notEqual(member(2), member(3));
      const names = await q('select display_name, handle from public.team_members where id = any($1::uuid[])', [[member(2), member(3)]]);
      assert.deepEqual(names.map((row) => row.display_name), ['홍길동', '홍길동']);
      assert.equal(new Set(names.map((row) => row.handle)).size, 2);
      assert.ok(names.some((row) => /^홍길동_[a-f0-9]{8}$/.test(row.handle)));
      assert.equal(await scalar("select public.team_display_name_from_device('송채민/병원PC')"), '송채민');
      assert.equal(await scalar("select public.team_display_name_from_device('이름_사내 PC')"), '이름');
      assert.equal(await scalar("select public.team_display_name_from_device('기기명에 병원PC가 포함됨')"), '기기명에 병원PC가 포함됨');
    });

    await t.test('RPCs expose only approved roster; private device mappings/admin operations are not member-readable', async () => {
      await as(2, async () => {
        assert.equal((await q('select * from public.list_team_members()')).length, 3);
        assert.equal((await scalar('select public.get_my_team_member()')).id, member(2));
        await rejected('select * from public.team_member_devices', [], /permission denied/);
        await rejected('select * from public.team_members', [], /permission denied/);
        await rejected('select * from public.device_access', [], /permission denied/);
        await rejected('select * from public.list_team_member_devices()', [], /Administrator/);
        await rejected('select public.provision_team_member_device($1)', [user(4)], /permission denied/);
        await rejected('select public.admin_link_team_member_device($1,$2)', [user(3), member(2)], /Administrator/);
      });
      await as(4, async () => rejected('select * from public.list_team_members()', [], /Approved device/));
      await as(11, async () => rejected('select * from public.list_team_members()', [], /Approved device/));
      await db.exec('set role anon');
      try {
        await rejected('select * from public.team_notifications', [], /permission denied/);
        await rejected('select * from public.list_team_members()', [], /permission denied/);
      } finally { await db.exec('reset role'); }
      await as(1, async () => {
        assert.equal(await scalar('select public.get_my_team_member()'), null);
        assert.equal((await q('select * from public.list_team_member_devices()')).length, 5);
      });
    });

    await t.test('future approvals provision automatically; status transitions and display renames preserve UUID and handle', async () => {
      const originalHandle = await scalar('select handle from public.team_members where id=$1', [member(2)]);
      await as(1, async () => q("select public.set_device_access($1,'approved',false)", [user(8)]));
      const futureMember = await scalar('select member_id from public.team_member_devices where user_id=$1', [user(8)]);
      assert.ok(futureMember);
      assert.equal(await scalar('select display_name from public.team_members where id=$1', [futureMember]), '미래 승인자');
      await as(1, async () => q("select public.set_device_access($1,'blocked',false)", [user(2)]));
      await as(2, async () => rejected('select public.get_my_team_member()', [], /Approved device/));
      await as(1, async () => q("select public.set_device_access($1,'approved',true)", [user(2)]));
      await as(2, async () => assert.equal(await scalar('select public.get_my_team_member()'), null));
      await as(1, async () => q("select public.set_device_access($1,'approved',false)", [user(2)]));
      await as(2, async () => q("select public.request_device_access('홍길동 변경 사내PC')"));
      assert.equal(await scalar('select member_id from public.team_member_devices where user_id=$1', [user(2)]), member(2));
      assert.equal(await scalar('select handle from public.team_members where id=$1', [member(2)]), originalHandle);
      assert.equal(await scalar('select display_name from public.team_members where id=$1', [member(2)]), '홍길동 변경');
      await as(1, async () => q("select public.admin_set_team_member_name($1,'확인된 표시명')", [member(2)]));
      await as(2, async () => q("select public.request_device_access('다른 기기명 병원PC')"));
      assert.equal(await scalar('select display_name from public.team_members where id=$1', [member(2)]), '확인된 표시명');
      assert.equal(await scalar('select handle from public.team_members where id=$1', [member(2)]), originalHandle);
    });

    await t.test('attendee UUIDs generate recipient-specific, non-spoofable notifications; self-only read/update', async () => {
      scheduleId = await as(1, async () => scalar("insert into public.schedules(title,date,attendee_member_ids) values('회의','2026-11-13',$1::uuid[]) returning id", [[member(2), member(10), member(2)]]));
      assert.equal(await scalar('select cardinality(attendee_member_ids) from public.schedules where id=$1', [scheduleId]), 2);
      assert.equal(await scalar("select count(*)::int from public.team_notifications where kind='schedule_attendee' and source_id=$1", [String(scheduleId)]), 2);
      notificationId = await scalar('select id from public.team_notifications where recipient_member_id=$1', [member(2)]);
      const otherNotificationId = await scalar('select id from public.team_notifications where recipient_member_id=$1', [member(10)]);
      await as(2, async () => {
        assert.equal((await q('select * from public.list_my_team_notifications()')).length, 1);
        assert.equal((await q('select * from public.team_notifications')).length, 1);
        assert.equal(await scalar('select public.mark_my_notifications_read($1::uuid[])', [[otherNotificationId]]), 0);
        assert.equal(await scalar('select public.mark_my_notifications_read($1::uuid[])', [[notificationId]]), 1);
        await rejected('update public.team_notifications set read_at=null', [], /permission denied/);
        await rejected("insert into public.team_notifications(recipient_member_id,kind,source_id,source_fingerprint,title,body) values($1,'chat_mention','forged','x','x','x')", [member(10)], /permission denied/);
      });
      assert.equal(await scalar('select read_at is null from public.team_notifications where id=$1', [otherNotificationId]), true);
      await as(1, async () => assert.equal((await q('select * from public.list_my_team_notifications()')).length, 0));
    });

    await t.test('meaningful schedule changes refresh one existing notification; no-op saves stay read', async () => {
      await as(1, async () => q('update public.schedules set title=title where id=$1', [scheduleId]));
      assert.equal(await scalar('select read_at is not null from public.team_notifications where id=$1', [notificationId]), true);
      await as(1, async () => q("update public.schedules set date='2026-11-14',title='변경된 회의' where id=$1", [scheduleId]));
      assert.equal(await scalar('select read_at is null from public.team_notifications where id=$1', [notificationId]), true);
      assert.equal(await scalar('select title from public.team_notifications where id=$1', [notificationId]), '참석 일정이 변경되었습니다');
      assert.equal(await scalar("select count(*)::int from public.team_notifications where kind='schedule_attendee' and source_id=$1", [String(scheduleId)]), 2);
      await as(2, async () => q('select public.mark_my_notifications_read($1::uuid[])', [[notificationId]]));
      await as(1, async () => q("update public.schedules set date='2026-11-14',title='변경된 회의',is_completed=true where id=$1", [scheduleId]));
      assert.equal(await scalar('select read_at is not null from public.team_notifications where id=$1', [notificationId]), true);
      await as(1, async () => q('update public.schedules set attendee_member_ids=$1::uuid[] where id=$2', [[member(10)], scheduleId]));
      await as(1, async () => q('update public.schedules set attendee_member_ids=$1::uuid[] where id=$2', [[member(2), member(10)], scheduleId]));
      assert.equal(await scalar('select read_at is not null from public.team_notifications where id=$1', [notificationId]), true);
    });

    await t.test('inactive historical targets do not break unrelated edits; newly added inactive/unknown/null targets fail', async () => {
      await as(1, async () => q("select public.set_device_access($1,'blocked',false)", [user(10)]));
      await as(1, async () => q('update public.schedules set is_completed=false where id=$1', [scheduleId]));
      await as(1, async () => rejected("insert into public.schedules(title,date,attendee_member_ids) values('비활성','2026-11-14',$1::uuid[])", [[member(10)]], /no longer active/));
      await as(1, async () => rejected("insert into public.schedules(title,date,attendee_member_ids) values('알 수 없음','2026-11-14',$1::uuid[])", [[user(11)]], /no longer active/));
      await as(1, async () => rejected("insert into public.schedules(title,date,attendee_member_ids) values('null','2026-11-14',$1::uuid[])", [[null]], /non-null/));
      await as(10, async () => rejected('select * from public.list_my_team_notifications()', [], /Approved device/));
      await as(10, async () => assert.equal((await q('select * from public.team_notifications')).length, 0));
      await as(1, async () => q("select public.set_device_access($1,'approved',false)", [user(10)]));
    });

    await t.test('chat mentions route by UUID, derive real author including admins, and deduplicate retries/re-adds', async () => {
      messageId = await as(1, async () => scalar("insert into public.messages(content,sender_id,mentioned_member_ids,sender_member_id,sender_display_name) values('확인 @홍길동','arbitrary-local-id',$1::uuid[],$2,'FORGED') returning id", [[member(2)], member(10)]));
      const message = (await q('select * from public.messages where id=$1', [messageId]))[0];
      assert.equal(message.sender_id, user(1));
      assert.equal(message.sender_member_id, null);
      assert.equal(message.sender_display_name, '운영 관리자');
      const notifications = await q("select * from public.team_notifications where kind='chat_mention' and source_id=$1", [String(messageId)]);
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].recipient_member_id, member(2));
      assert.equal(notifications[0].actor_member_id, null);
      assert.equal(notifications[0].actor_display_name, '운영 관리자');
      await as(2, async () => q('select public.mark_my_notifications_read($1::uuid[])', [[notifications[0].id]]));
      await as(1, async () => q("update public.messages set content='내용만 수정',sender_id='FORGED',sender_member_id=$1,sender_display_name='FORGED' where id=$2", [member(10), messageId]));
      await as(1, async () => q('update public.messages set mentioned_member_ids=$1::uuid[] where id=$2', [[], messageId]));
      await as(1, async () => q('update public.messages set mentioned_member_ids=$1::uuid[] where id=$2', [[member(2)], messageId]));
      assert.equal(await scalar('select read_at is not null from public.team_notifications where id=$1', [notifications[0].id]), true);
      assert.equal(await scalar('select sender_display_name from public.messages where id=$1', [messageId]), '운영 관리자');
      assert.equal(await scalar('select sender_id from public.messages where id=$1', [messageId]), user(1));
      const ownMessage = await as(2, async () => scalar("insert into public.messages(content,sender_id,mentioned_member_ids) values('self and colleague','another-browser-id',$1::uuid[]) returning id", [[member(2), member(10)]]));
      const ownNotifications = await q("select * from public.team_notifications where kind='chat_mention' and source_id=$1", [String(ownMessage)]);
      assert.equal(await scalar('select sender_id from public.messages where id=$1', [ownMessage]), user(2));
      assert.equal(ownNotifications.length, 1);
      assert.equal(ownNotifications[0].recipient_member_id, member(10));
      assert.equal(ownNotifications[0].actor_member_id, member(2));
    });

    await t.test('future kiosk handoffs link explicitly without a second identity or kiosk inbox', async () => {
      const countBefore = await scalar('select count(*)::int from public.team_members');
      const pair = await as(9, async () => scalar('select public.create_kiosk_pair_request()'));
      await as(2, async () => q('select public.approve_kiosk_pair($1)', [pair.request_id]));
      const mapping = (await q('select * from public.team_member_devices where user_id=$1', [user(9)]))[0];
      assert.equal(mapping.is_kiosk, true);
      assert.equal(mapping.member_id, member(2));
      assert.equal(await scalar('select count(*)::int from public.team_members'), countBefore);
      await as(9, async () => {
        assert.equal(await scalar('select public.get_my_team_member()'), null);
        assert.equal((await q('select * from public.list_my_team_notifications()')).length, 0);
      });
      await as(1, async () => rejected('select public.admin_link_team_member_device($1,$2)', [user(9), member(2)], /kiosk companion/));
      await as(2, async () => rejected('select public.approve_kiosk_pair($1)', [pair.request_id], /already used/));
    });

    await t.test('only explicit admin linking shares future identity, without deleting old identities or changing handles', async () => {
      const oldMember = member(3);
      const handleBefore = await scalar('select handle from public.team_members where id=$1', [member(2)]);
      await as(1, async () => q('select public.admin_link_team_member_device($1,$2)', [user(3), member(2)]));
      await as(3, async () => assert.equal((await scalar('select public.get_my_team_member()')).id, member(2)));
      assert.equal(await scalar('select count(*)::int from public.team_members where id=$1', [oldMember]), 1);
      assert.equal(await scalar('select handle from public.team_members where id=$1', [member(2)]), handleBefore);
      await as(3, async () => assert.equal((await q('select * from public.list_my_team_notifications()')).length, 2));
    });

    await t.test('source deletion cleans only its notifications; rerunning migration preserves stable UUIDs and handles', async () => {
      await as(1, async () => q('delete from public.messages where id=$1', [messageId]));
      assert.equal(await scalar("select count(*)::int from public.team_notifications where kind='chat_mention' and source_id=$1", [String(messageId)]), 0);
      await as(1, async () => q('delete from public.schedules where id=$1', [scheduleId]));
      assert.equal(await scalar("select count(*)::int from public.team_notifications where kind='schedule_attendee' and source_id=$1", [String(scheduleId)]), 0);
      const identities = await q('select id, handle from public.team_members order by id');
      await db.exec(migration);
      assert.deepEqual(await q('select id, handle from public.team_members order by id'), identities);
    });

    await t.test('service maintenance without an authenticated actor cannot fabricate recipient notifications', async () => {
      const maintenanceSchedule = await scalar("insert into public.schedules(title,date,attendee_member_ids) values('서비스 정비','2026-11-20',$1::uuid[]) returning id", [[member(2), member(10)]]);
      assert.equal(await scalar("select count(*)::int from public.team_notifications where kind='schedule_attendee' and source_id=$1", [String(maintenanceSchedule)]), 0);
      const legacyMessage = await scalar("insert into public.messages(content,sender_id) values('기존 시스템 메시지','old-anonymous-browser-id') returning id");
      assert.equal(await scalar('select sender_id from public.messages where id=$1', [legacyMessage]), 'old-anonymous-browser-id');
      await as(2, async () => q("update public.messages set content='수정',sender_id='FORGED' where id=$1", [legacyMessage]));
      assert.equal(await scalar('select sender_id from public.messages where id=$1', [legacyMessage]), 'old-anonymous-browser-id');
      await as(2, async () => rejected('select public.capture_team_notifications()', [], /permission denied/));
    });
  } finally { await db.close(); }
});
