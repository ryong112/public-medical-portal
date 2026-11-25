/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated PostgreSQL fixture, never production. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261125093000_important_schedule_sharing.sql');
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('important publications and per-ID reads are RPC-only and survive deletion of a source', () => {
  assert.match(migration, /revoke all on public\.important_schedule_publications, public\.important_schedule_reads from public, anon, authenticated/);
  assert.doesNotMatch(migration, /schedule_id bigint primary key references public\.schedules/);
  assert.match(migration, /device\.user_id = auth\.uid\(\) and device\.is_kiosk/);
  assert.match(migration, /source\.owner_member_id is distinct from public\.current_team_member_id\(\)/);
  assert.doesNotMatch(migration, /grant .* on table|grant .* to anon/i);
});

test('important schedule publishing, live source projection and notifications in isolated PostgreSQL', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to an isolated PGlite runtime.',
}, async (t) => {
  const db = new PGlite();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const value = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
  const as = async (n, run, role = 'authenticated') => {
    await rows("select set_config('request.jwt.claim.sub',$1,false)", [n ? user(n) : '']);
    await db.exec(`set role ${role}`);
    try { return await run(); } finally {
      await db.exec('reset role');
      await rows("select set_config('request.jwt.claim.sub','',false)");
    }
  };
  const inbox = (actor) => as(actor, () => rows('select * from public.list_my_team_notifications()'));
  const board = (actor) => as(actor, () => rows('select * from public.list_important_schedules()'));
  let first;
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const file of [
      '20260803_device_access_setup.sql', '20260803_approved_device_data_access.sql',
      '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql', '20261112_schedule_team_details.sql',
    ]) await db.exec(read(`supabase/migrations/${file}`));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    for (const file of ['20261113_team_identity_notifications.sql','20261113_team_responsibility.sql','20261113_team_chat_notices.sql','20261113_admin_team_participants.sql']) {
      await db.exec(read(`supabase/migrations/${file}`));
    }
    const members = Object.fromEntries((await rows('select user_id, member_id from public.team_member_devices')).map((row) => [row.user_id, row.member_id]));
    await db.exec(migration);
    first = await as(2, () => value(`insert into public.schedules(title,date,start_time,location,owner_member_id,attendee_member_ids)
      values('중요 사례회의','2026-11-27','14:00','회의실 A',$1,array[$2::uuid]) returning id`, [members[user(2)], members[user(3)]]));

    await t.test('explicit action by actual owner; anonymous, blocked, kiosk and other members are denied', async () => {
      assert.deepEqual(await board(2), []);
      for (const actor of [4, 5, 6, 7, 9]) await assert.rejects(() => board(actor), /approved human device/);
      await assert.rejects(() => as(null, () => rows('select * from public.list_important_schedules()'), 'anon'), /permission denied/);
      await assert.rejects(() => as(2, () => rows('select * from public.important_schedule_publications')), /permission denied/);
      await assert.rejects(() => as(3, () => value('select public.publish_important_schedule($1)', [first])), /responsible member/);
      assert.equal(await as(2, () => value('select public.publish_important_schedule($1)', [first])), true);
      assert.equal(await as(1, () => value('select public.publish_important_schedule($1)', [first])), false);
      assert.equal((await board(2))[0].read, true);
      assert.equal((await board(3))[0].read, false);
      assert.equal((await inbox(3)).filter((item) => item.kind === 'important_schedule').length, 1);
      assert.equal((await inbox(10)).length, 0);
      assert.equal((await board(10)).length, 1, 'non-recipients can still see the team board');
    });

    await t.test('view status is personal, title corrections are live without alerts, critical updates have one notification', async () => {
      assert.equal(await as(3, () => value('select public.mark_important_schedule_read($1,1)', [first])), true);
      assert.equal((await board(3))[0].read, true);
      assert.equal((await board(10))[0].read, false);
      await assert.rejects(() => as(3, () => rows("update public.schedules set location='임의 변경' where id=$1", [first])), /responsible member/);
      await assert.rejects(() => as(3, () => rows('update public.schedules set owner_member_id=$1 where id=$2', [members[user(3)], first])), /responsible member/);
      await assert.rejects(() => as(6, () => rows('delete from public.schedules where id=$1', [first])), /approved human device/);
      await as(3, () => rows('update public.schedules set is_completed=true where id=$1', [first]));
      await as(2, () => rows("update public.schedules set title='중요 주간회의' where id=$1", [first]));
      const corrected = (await board(3))[0];
      assert.equal(corrected.title, '중요 주간회의');
      assert.equal(corrected.revision, 1);
      assert.equal(corrected.read, true);
      const before = (await inbox(3)).find((item) => item.kind === 'schedule_attendee');
      await as(2, () => rows("update public.schedules set start_time='15:30', location='회의실 B' where id=$1", [first]));
      const changed = (await board(3))[0];
      assert.equal(changed.status, 'changed');
      assert.equal(changed.start_time, '15:30:00');
      assert.equal(changed.location, '회의실 B');
      assert.equal(changed.read, false);
      assert.equal(await as(3, () => value('select public.mark_important_schedule_read($1,1)', [first])), false);
      assert.equal((await inbox(3)).find((item) => item.kind === 'schedule_attendee').title, before.title);
      assert.match((await inbox(3)).find((item) => item.kind === 'important_schedule').title, /변경/);
    });

    await t.test('delete retains a cancellation marker and recipient inbox; withdrawal is distinct and leaves the source intact', async () => {
      await as(3, () => value('select public.mark_important_schedule_read($1,2)', [first]));
      await as(2, () => rows('update public.schedules set attendee_member_ids=array[$1::uuid] where id=$2', [members[user(10)], first]));
      assert.equal((await board(3))[0].revision, 2, 'recipient-only changes do not update everyone’s read state');
      assert.equal((await board(3))[0].read, true);
      assert.match((await inbox(3)).find((item) => item.kind === 'important_schedule').title, /참석이 취소/);
      assert.match((await inbox(10)).find((item) => item.kind === 'important_schedule').title, /참석자로 지정/);
      await as(2, () => rows('update public.schedules set attendee_member_ids=array[$1::uuid] where id=$2', [members[user(3)], first]));
      await as(2, () => rows('delete from public.schedules where id=$1', [first]));
      const cancelled = (await board(3))[0];
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.source_available, false);
      assert.equal(cancelled.title, '중요 주간회의');
      assert.equal(cancelled.location, null);
      assert.match((await inbox(3)).find((item) => item.kind === 'important_schedule').title, /취소/);
      const second = await as(1, () => value("insert into public.schedules(title,date) values('관리자 일정','2026-11-28') returning id"));
      assert.equal(await as(1, () => value('select public.publish_important_schedule($1)', [second])), true);
      await assert.rejects(() => as(3, () => value('select public.withdraw_important_schedule($1)', [second])), /responsible member/);
      assert.equal(await as(1, () => value('select public.withdraw_important_schedule($1)', [second])), true);
      assert.equal((await board(3)).some((item) => item.schedule_id === second), false);
      assert.equal(await value('select count(*)::int from public.schedules where id=$1', [second]), 1);
    });
  } finally { await db.close(); }
});
