/* eslint-disable @typescript-eslint/no-require-imports -- Local disposable PGlite runtime, never a remote connection. */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite')); } catch {}

const read = (file) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const migration = (file) => read(`supabase/migrations/${file}`);
const user = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = '52ab14fb-fe3d-40fa-8790-a48ba8ff5232.pdf';
const missing = '52ab14fb-fe3d-40fa-8790-a48ba8ff5233.pdf';
const legacy = 'https://portal.invalid/storage/v1/object/public/files/legacy.pdf';
const correction = JSON.stringify([{ source_text: 'synthetic original text', ai_title: '오타제목', corrected_title: '수정제목' },
  { source_text: 'another original', ai_title: '오타제목', corrected_title: '수정제목' }]);

test('private documents and OCR authority execute in disposable PostgreSQL', {
  skip: PGlite ? false : 'Set PGLITE_MODULE to the optional disposable runtime.',
}, async (t) => {
  const db = new PGlite();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const scalar = async (sql, params = []) => Object.values((await q(sql, params))[0])[0];
  const reject = (sql, params, code) => assert.rejects(() => q(sql, params), (error) => error.code === code);
  const as = async (n, run) => {
    await q("select set_config('request.jwt.claim.sub', $1, false)", [n ? user(n) : '']);
    await db.exec(n ? 'set role authenticated' : 'set role anon');
    try { return await run(); } finally { await db.exec('reset role'); }
  };
  try {
    await db.exec(read('supabase/tests/team_identity_notifications_fixture.sql'));
    await db.exec(`create role service_role nologin;
      alter table storage.objects add column name text;
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon, authenticated;
      create policy fixture_old_storage_read on storage.objects for select to authenticated using (true);
      insert into storage.objects(bucket_id, name) values ('files', 'legacy.pdf'), ('files', '${key}');
      insert into public.files(name, url, size, category) values ('Legacy', '${legacy}', 43, 'Fixture');`);
    for (const file of [
      '20260714_whiteboard_import.sql', '20260714_whiteboard_corrections.sql', '20260803_device_access_setup.sql',
      '20260803_approved_device_data_access.sql', '20260807_activity_history.sql', '20260821_kiosk_approval_handoff.sql', '20261112_schedule_team_details.sql',
    ]) await db.exec(migration(file));
    await db.exec(read('supabase/tests/team_identity_notifications_seed.sql'));
    await db.exec(migration('20261113_team_identity_notifications.sql'));
    await db.exec(migration('20261113_team_chat_notices.sql'));
    await db.exec(migration('20261113_admin_team_participants.sql'));
    await db.exec(migration('20261113_team_responsibility.sql'));
    await db.exec(migration('20261125090000_private_portal_documents_ocr.sql'));

    await t.test('approved staff and admins retain old rows, register a real object and reject fake refs', async () => {
      await as(2, async () => {
        assert.equal(await scalar('select public.is_approved_human_device()'), true);
        assert.equal(await scalar('select url from public.files where id=1'), legacy);
        assert.equal(await scalar('select count(*)::int from storage.objects'), 2);
        await q("update public.files set name = 'Renamed legacy' where id=1");
        const args = ['Uploaded', `storage://files/${key}`, 51, 'Fixture'];
        const register = 'select public.register_uploaded_document($1,$2,$3,$4)';
        const id = await scalar(register, args);
        assert.equal(await scalar(register, args), id);
        assert.equal(await scalar('select url from public.files where id=$1', [id]), args[1]);
        await reject(register, ['Missing', `storage://files/${missing}`, 1, 'Fixture'], '22023');
        await reject(register, ['Unsafe', 'https://other.invalid/file.pdf', 1, 'Fixture'], '22023');
        await reject("insert into public.files(name,url) values ('Unsafe', $1)", [legacy], '22023');
        await reject('update public.files set url=$1 where id=1', [`storage://files/${missing}`], '22023');
        assert.equal(await scalar('select public.save_whiteboard_corrections($1::jsonb)', [correction]), 1);
        await reject('select public.claim_whiteboard_analysis(20)', [], '42501');
        await reject('select * from public.whiteboard_corrections', [], '42501');
      });
      await as(1, async () => {
        assert.equal(await scalar('select public.is_approved_human_device()'), true);
        assert.equal(await scalar('select count(*)::int from public.files'), 2);
      });
      assert.deepEqual(await q("select source_text, occurrence_count from public.whiteboard_corrections where ai_title='오타제목'"),
        [{ source_text: '', occurrence_count: 1 }]);
    });

    await t.test('pending, blocked, unregistered and both paired kiosk identities fail closed', async () => {
      for (const n of [4, 5, 6, 7, 11]) await as(n, async () => {
        assert.equal(await scalar('select public.is_approved_human_device()'), false, String(n));
        assert.equal(await scalar('select count(*)::int from public.files'), 0, String(n));
        assert.equal(await scalar('select count(*)::int from storage.objects'), 0, String(n));
        await reject('select public.save_whiteboard_corrections($1::jsonb)', [correction], '42501');
        await reject('select public.register_uploaded_document($1,$2,$3,$4)', ['Rejected', `storage://files/${key}`, 1, 'Fixture'], '42501');
      });
      await q('delete from public.team_member_devices where user_id=$1', [user(6)]);
      await as(6, async () => assert.equal(await scalar('select public.is_approved_human_device()'), false, 'used pairing still forbids access if a mapping is missing'));
    });

    await t.test('anonymous has no original, metadata or correction privilege', async () => {
      await as(null, async () => {
        assert.equal(await scalar('select public.is_approved_human_device()'), false);
        await reject('select * from public.files', [], '42501');
        await reject('select * from storage.objects', [], '42501');
        await reject('select public.save_whiteboard_corrections($1::jsonb)', [correction], '42501');
      });
      assert.equal(await scalar('select count(*)::int from public.files'), 2);
      assert.equal(await scalar('select count(*)::int from storage.objects'), 2);
    });
  } finally {
    await db.close();
  }
});
