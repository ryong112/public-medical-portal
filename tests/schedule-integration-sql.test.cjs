/* eslint-disable @typescript-eslint/no-require-imports -- Disposable PostgreSQL regression test, never production. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const read = (file) => readFileSync(resolve(__dirname, '..', file), 'utf8');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}
const migration = read('supabase/migrations/20261127100000_schedule_integration.sql');

test('only narrow RPC privileges are added and integration is not enabled by migration', () => {
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete)|on\s+public\.device_access|alter table public\.schedules/i);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /allow_read boolean not null default false/);
});

test('isolated schedule integration auth, idempotency and read scope', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to an isolated PGlite runtime.',
}, async () => {
  const db = new PGlite();
  const fixture = read('supabase/tests/schedule_integration_fixture.sql');
  try {
    await db.exec(fixture.replace(/^\\ir .*$/m, () => migration));
  } finally {
    await db.close();
  }
});

test('existing approved-device policies and schedule triggers coexist with narrow writes', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to an isolated PGlite runtime.',
}, async () => {
  const db = new PGlite();
  const run = (name) => db.exec(read('supabase/migrations/' + name));
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    for (const name of [
      '20260714_schedule_todo.sql', '20260803_device_access_setup.sql',
      '20260803_approved_device_data_access.sql','20260807_activity_history.sql',
      '20260821_kiosk_approval_handoff.sql','20261112_schedule_team_details.sql',
    ]) await run(name);
    await db.exec("alter table public.schedules add is_notice boolean default false, add is_urgent boolean default false, add schedule_type text default 'unclassified'");
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    for (const name of [
      '20261113_team_identity_notifications.sql','20261113_team_responsibility.sql',
      '20261113_team_chat_notices.sql','20261113_admin_team_participants.sql',
      '20261125093000_important_schedule_sharing.sql',
    ]) await run(name);
    await db.exec(migration);
    await db.exec(`
      insert into public.schedule_integration_credentials (integration,token_digest,enabled,expires_at)
      values ('dot-calendar-v1',sha256(convert_to(repeat('a',64),'UTF8')),true,now()+interval '1 hour');
      select set_config('request.headers',jsonb_build_object('x-portal-schedule-token',repeat('a',64))::text,false);
      set role anon;
    `);
    const { rows:[{result}] } = await db.query(`
      select public.integration_create_schedule('gcal:test-schedule','수리센터 수행기관 지도점검 (오후)',
        (now() at time zone 'Asia/Seoul')::date,p_kind=>'meeting') as result
    `);
    assert.equal(result.status, 'created');
    await assert.rejects(db.query('select * from public.schedules'), /permission denied/);
    await assert.rejects(db.query('select * from public.files'), /permission denied/);
    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false)
    `);
    const {rows} = await db.query('select title,start_time,end_time,is_notice,owner_member_id from public.schedules where id=$1', [result.id]);
    assert.deepEqual(rows, [{title:'수리센터 수행기관 지도점검 (오후)',start_time:null,end_time:null,is_notice:false,owner_member_id:null}]);
    assert.deepEqual((await db.query('select * from public.list_important_schedules()')).rows, []);
  } finally {
    await db.close();
  }
});
