# Calendar-only integration (optional)

## Why this is separate

The browser approval uses Supabase anonymous authentication plus `device_access.user_id`.
The approved principal survives only while the browser profile retains its session.
A new device ID, ChatGPT thread ID, matching display name, URL parameter or browser
fingerprint does not prove the previous approval. This migration does not change
the browser gate, team identity, calendar permissions, files, or chat.

The new machine credential is off by default (the migration creates no credential).
Its only default ability is to create ordinary schedule rows. Reading limited
schedule fields is a separate opt-in. It cannot modify or erase rows, manage devices,
publish notices, assign arbitrary staff, access documents, or access chat.

## One-time setup (approved NAS administrator + relay owner)

1. Test the migration and existing browser workflow on staging. Apply
   `20261127100000_schedule_integration.sql` via the normal Supabase release path.
2. Select a server-side relay whose account and data permissions have been approved.
   Example: an owner-run Google Apps Script reading a separate work-only
   Google calendar via a scheduled trigger. Configure only that calendar, just the
   events intended to flow to NAS, and no primary private calendar. Do not send all
   invitations or past events. Calendar IDs alone do not carry rights to NAS.
3. Generate one 32-byte random secret in a local trusted password manager or shell
   (`openssl rand -hex 32`), compute SHA-256 of the resulting 64 lowercase ASCII hex
   characters without the trailing newline, and enter **only its digest** in the DB
   administration console. Store the original in a restricted relay secret store,
   not in a calendar event, chat, GitHub, or a browser storage value. Limit relay
   editors to trusted administrators; Apps Script editors can access Script
   Properties and are part of that trust boundary. Do not use a Supabase secret or
   service-role API key. Inspect gateway/relay logging in staging and ensure the
   custom authentication header is never copied to application logs, failure
   notifications, test output, or public; use a fixed HTTPS destination and do not
   follow redirects when sending that header. The source version should not contain
   either the real token or schedule data.

   An example administration statement, with a placeholder only:

   ```sql
   insert into public.schedule_integration_credentials
     (integration, token_digest, enabled, allow_read, expires_at)
   values
     ('dot-calendar-v1', decode('<64 lowercase hex digest characters>', 'hex'), true, false, now() + interval '90 days')
   on conflict (integration) do update
   set token_digest = excluded.token_digest, enabled = excluded.enabled,
       allow_read = excluded.allow_read, expires_at = excluded.expires_at;
   ```

4. Use one harmless synthetic event covering the target date and correct optional
   time behavior, repeat the request from a new session, validate the returned row
   and verify it in the NAS details screen. Check that missing/revoked authentication
   cannot call either RPC and that no calendar row is touched after revocation.
   Check that operator-approved production uses only the tested API and secret path.
5. Disable with `update public.schedule_integration_credentials set enabled = false where integration = 'dot-calendar-v1';`
   when no longer needed. Rotate by replacing the secret and digest together; set
   a new expiry. This does not invalidate any human browser approvals.

## Server request contract

Use the project's HTTPS Supabase origin (not the browser's Vercel origin). For both
POST requests set the project's public publishable API key in the `apikey` header,
the dedicated relay secret in `x-portal-schedule-token`, and
`Content-Type: application/json`. Do not attach a human bearer session. PostgREST
runs these RPCs under `anon`; that role is not granted access to any backing table.

- `/rest/v1/rpc/integration_create_schedule`: required JSON keys `p_request_key`
  (stable caller-selected identifier, e.g. `gcal:<event-id>`), `p_title`, and
  `p_date` (YYYY-MM-DD). Optional: `p_end_date` (last included date; convert Google's
  exclusive day endpoint), `p_start_time`, `p_end_time` (Korea local wall time),
  `p_location`, and `p_kind` (`unclassified`, `internal`, `meeting`, `business_trip`).
  Omit times for all-day or time-to-be-confirmed entries; put known broad wording
  such as “(오후)” in the title. Business rules permit today through one year
  ahead in Korea time, and at most 31 included dates. No meeting invite is sent.
- Response `{"status":"created|existing|possible_duplicate|removed","id":123}`.
  Keep the same key for a retry; changing payload under that key is a conflict, not
  an update. For an existing title/date with differing verified details, the
  response is `possible_duplicate` and nothing is written. Use the returned row
  id to reconcile before manual updates. If the resulting row was removed,
  replay does not recreate it. Do not report success merely because a job was
  queued. Network transport and row-store result are separate.
- `/rest/v1/rpc/integration_list_schedules`: only if an operator also sets
  `allow_read=true`. JSON `p_from` and `p_through` are inclusive YYYY-MM-DD and
  describe at most 14 days. Returns up to 200 rows with id/title/date/end_date/time
  only (not location, files, people, or other content). A missing time remains
  unknown. Do not persist a mirror of these titles in the relay. This read is
  not necessary for a write-only job.

The migration is not itself a ChatGPT connector or a scheduled syncing job.
The actual relay still needs the user's one-time authorization, scoped calendar
selection, secret activation and verification. Later edits and cancellations
do not automatically propagate through this create-only contract.

## Test

`psql -X -v ON_ERROR_STOP=1 -f supabase/tests/schedule_integration_fixture.sql`
against a disposable PostgreSQL database with role creation privileges; never
point this fixture at a workspace or live database. The same fixture may be
run in embedded PostgreSQL by expanding its psql `\\ir` include. It covers
denials, successful creation, missing times, replay, duplicate handling and
revocation. It does not prove PostgREST header forwarding or production schemas.
