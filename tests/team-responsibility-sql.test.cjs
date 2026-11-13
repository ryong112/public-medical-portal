/* eslint-disable @typescript-eslint/no-require-imports -- Local-only optional PostgreSQL test runtime. */
// Disposable local PostgreSQL only. Never run test fixture SQL on a remote DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261113_team_responsibility.sql');
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('responsibility migration is additive and does not infer, notify, or expand access', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /add column if not exists owner_member_id uuid references public\.team_members/);
  assert.match(migration, /new\.owner_member_id is distinct from previous_owner/);
  assert.match(migration, /revoke all on function public\.validate_team_responsibility\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /update public\.(?:schedules|files) set/i);
  assert.doesNotMatch(migration, /create policy|grant .* on table|team_notifications|drop table/i);
});

test('optional schedule/document responsible IDs execute in isolated PostgreSQL', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to the temporary @electric-sql/pglite install for SQL integration tests.',
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
  let member;
  let scheduleId;
  let fileId;
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const file of [
      '20260803_device_access_setup.sql', '20260803_approved_device_data_access.sql',
      '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql',
      '20261112_schedule_team_details.sql',
    ]) await db.exec(read(`supabase/migrations/${file}`));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    await db.exec(read('supabase/migrations/20261113_team_identity_notifications.sql'));
    const ids = Object.fromEntries((await q('select user_id, member_id from public.team_member_devices')).map((row) => [row.user_id, row.member_id]));
    member = (n) => ids[user(n)];
    scheduleId = await as(2, () => scalar("insert into public.schedules(title,date,owner_name) values('기존 업무','2026-11-13','기존 자유입력 담당자') returning id"));
    fileId = await as(2, () => scalar("select public.register_uploaded_document('기존 문서.pdf','https://files.example/legacy.pdf',12,'회의')"));
    await db.exec(migration);

    await t.test('existing records and free-text labels stay unassigned without notifications', async () => {
      assert.equal(await scalar('select owner_member_id from public.schedules where id=$1', [scheduleId]), null);
      assert.equal(await scalar('select owner_name from public.schedules where id=$1', [scheduleId]), '기존 자유입력 담당자');
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [fileId]), null);
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });

    await t.test('capability RPC is approved-only; internal validator and raw identity tables stay private', async () => {
      await as(2, async () => {
        assert.equal(await scalar('select public.team_responsibility_available()'), true);
        await assert.rejects(() => q('select public.validate_team_responsibility()'), /permission denied/);
        await assert.rejects(() => q('select * from public.team_members'), /permission denied/);
      });
      await as(4, async () => assert.rejects(() => q('select public.team_responsibility_available()'), /Approved device/));
      await as(5, async () => assert.rejects(() => q('select public.team_responsibility_available()'), /Approved device/));
      await db.exec('set role anon');
      try { await assert.rejects(() => q('select public.team_responsibility_available()'), /permission denied/); }
      finally { await db.exec('reset role'); }
    });

    await t.test('explicit IDs distinguish duplicate names and snapshot schedule name only on assignment', async () => {
      assert.notEqual(member(2), member(3));
      await as(2, () => q('update public.schedules set owner_member_id=$1,owner_name=$2 where id=$3', [member(3), '위조한 표기', scheduleId]));
      assert.equal(await scalar('select owner_member_id from public.schedules where id=$1', [scheduleId]), member(3));
      assert.equal(await scalar('select owner_name from public.schedules where id=$1', [scheduleId]), '홍길동');
      await as(2, () => q('update public.files set owner_member_id=$1 where id=$2', [member(3), fileId]));
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [fileId]), member(3));
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
      await as(1, () => q("select public.admin_set_team_member_name($1,'새 표시 이름')", [member(3)]));
      await as(2, () => q("update public.schedules set title='다른 필드 수정' where id=$1", [scheduleId]));
      assert.equal(await scalar('select owner_name from public.schedules where id=$1', [scheduleId]), '홍길동');
    });

    await t.test('new inactive, unknown, admin, or kiosk-only owner IDs cannot be assigned', async () => {
      await as(1, () => q("select public.set_device_access($1,'blocked',false)", [user(3)]));
      for (const target of [member(3), user(1), user(7), user(11)]) {
        await as(2, async () => assert.rejects(() => q("insert into public.schedules(title,date,owner_member_id) values('잘못된 담당','2026-11-14',$1)", [target]), /no longer active/));
        await as(2, async () => assert.rejects(() => q("insert into public.files(name,url,owner_member_id) values('잘못된 담당.pdf','https://files.example/invalid.pdf',$1)", [target]), /no longer active/));
      }
    });

    await t.test('retained inactive IDs allow unrelated edits, replacement, and explicit clearing', async () => {
      await as(2, () => q('update public.schedules set is_completed=true where id=$1', [scheduleId]));
      await as(2, () => q("update public.files set name='제목만 변경.pdf' where id=$1", [fileId]));
      assert.equal(await scalar('select owner_member_id from public.schedules where id=$1', [scheduleId]), member(3));
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [fileId]), member(3));
      await as(2, () => q('update public.schedules set owner_member_id=$1 where id=$2', [member(2), scheduleId]));
      assert.equal(await scalar('select owner_name from public.schedules where id=$1', [scheduleId]), '홍길동');
      await as(2, () => q("update public.schedules set owner_member_id=null,owner_name='직접 입력' where id=$1", [scheduleId]));
      await as(2, () => q('update public.files set owner_member_id=null where id=$1', [fileId]));
      assert.equal(await scalar('select owner_member_id from public.schedules where id=$1', [scheduleId]), null);
      assert.equal(await scalar('select owner_name from public.schedules where id=$1', [scheduleId]), '직접 입력');
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [fileId]), null);
    });

    await t.test('approved shared edits and idempotent upload/SQL reruns remain compatible', async () => {
      const newFileId = await as(2, () => scalar("select public.register_uploaded_document('신규.pdf','https://files.example/new.pdf',15,'회의')"));
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [newFileId]), null);
      await as(2, () => q('update public.files set owner_member_id=$1 where id=$2', [member(10), newFileId]));
      await as(10, () => q("update public.files set name='공동 수정.pdf' where id=$1", [newFileId]));
      assert.equal(await as(2, () => scalar("select public.register_uploaded_document('신규.pdf','https://files.example/new.pdf',15,'회의')")), newFileId);
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [newFileId]), member(10));
      await as(5, async () => assert.rejects(() => q("insert into public.files(name,url,owner_member_id) values('차단.pdf','https://files.example/blocked.pdf',$1)", [member(2)]), /row-level security/));
      await db.exec(migration);
      assert.equal(await scalar('select owner_member_id from public.files where id=$1', [newFileId]), member(10));
      assert.equal(await scalar('select count(*)::int from public.team_notifications'), 0);
    });
  } finally { await db.close(); }
});
