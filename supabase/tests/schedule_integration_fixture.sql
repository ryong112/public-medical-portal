-- Run with psql or embedded PostgreSQL on a DISPOSABLE database only from repo root:
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/schedule_integration_fixture.sql
-- The fixture creates its own roles/table. It is not an integration smoke test of production.
create role anon;
create role authenticated;
create table public.schedules (
  id bigint generated always as identity primary key,
  title text not null,
  date date not null,
  end_date date,
  start_time time,
  end_time time,
  location text,
  schedule_type text,
  recurrence_status text default 'active',
  is_notice boolean not null default false,
  is_completed boolean not null default false,
  is_urgent boolean not null default false,
  is_todo boolean not null default false
);
alter table public.schedules enable row level security;
grant select on public.schedules to authenticated;
\ir ../migrations/20261127100000_schedule_integration.sql

begin;
set local role anon;
do $test$
declare i date := (now() at time zone 'Asia/Seoul')::date;
begin
  begin
    perform public.integration_create_schedule('create-01', 'test', i);
    raise exception 'no token should fail';
  exception when insufficient_privilege then null; end;
  begin
    perform public.integration_list_schedules(i, i);
    raise exception 'no token list should fail';
  exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
insert into public.schedule_integration_credentials (integration, token_digest, enabled, expires_at)
values ('dot-calendar-v1', sha256(convert_to(repeat('a',64), 'UTF8')), true, now() + interval '1 hour');

set local role anon;
select set_config('request.headers', jsonb_build_object('x-portal-schedule-token', repeat('b',64))::text, true);
do $test$
declare i date := (now() at time zone 'Asia/Seoul')::date;
begin
  begin
    perform public.integration_create_schedule('create-01', 'test', i);
    raise exception 'wrong token should fail';
  exception when insufficient_privilege then null; end;
end;
$test$;

select set_config('request.headers', jsonb_build_object('x-portal-schedule-token', repeat('a',64))::text, true);
do $test$
declare
  i date := (now() at time zone 'Asia/Seoul')::date;
  result jsonb;
  created_id text;
begin
  result := public.integration_create_schedule('gcal:event-01','  수리센터 지도점검 (오후) ',i);
  if result->>'status' <> 'created' then raise exception 'expected created, got %', result; end if;
  created_id := result->>'id';
  result := public.integration_create_schedule('gcal:event-01','수리센터 지도점검 (오후)',i,p_end_date=>i);
  if result->>'status' <> 'existing' or result->>'id' <> created_id then raise exception 'idempotency failed: %', result; end if;
  result := public.integration_create_schedule('gcal:event-02','수리센터 지도점검 (오후)',i);
  if result->>'status' <> 'existing' or result->>'id' <> created_id then raise exception 'semantic duplicate failed: %', result; end if;
  result := public.integration_create_schedule('gcal:event-03','수리센터 지도점검 (오후)',i,p_start_time=>time '13:00');
  if result->>'status' <> 'possible_duplicate' or result->>'id' <> created_id then raise exception 'possible duplicate failed: %', result; end if;
  begin
    perform public.integration_create_schedule('gcal:event-01','명칭이 바뀐 일정',i);
    raise exception 'same key collision should fail';
  exception when unique_violation then null; end;
  begin
    perform public.integration_create_schedule('gcal:event-04','종료만 지정할 수 없음',i,p_end_time=>time '14:00');
    raise exception 'end only should fail';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.integration_create_schedule('gcal:event-04','클라이언트 권한을 넘는 종류',i,p_kind=>'leave');
    raise exception 'unsupported category should fail';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.integration_list_schedules(i,i);
    raise exception 'read must be separately enabled';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.schedules;
    raise exception 'capability should not change direct schedule grants';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.schedule_integration_requests;
    raise exception 'request data cannot be retrieved directly';
  exception when insufficient_privilege then null; end;
  begin
    perform public.require_schedule_integration(false);
    raise exception 'credential verifier not callable directly';
  exception when insufficient_privilege then null; end;
end;
$test$;

reset role;
update public.schedule_integration_credentials set allow_read = true;
insert into public.schedules (date,title,is_todo) values ((now() at time zone 'Asia/Seoul')::date,'Excluded to-do',true);
set local role anon;
do $test$
declare
  i date := (now() at time zone 'Asia/Seoul')::date;
  result jsonb;
begin
  result := public.integration_list_schedules(i,i);
  if jsonb_array_length(result) <> 1 or result->0->>'title' <> '수리센터 지도점검 (오후)'
     or result->0->>'start_time' is not null or result->0->>'end_time' is not null or result->0 ? 'location' then
    raise exception 'wrong or overexposed list: %',result;
  end if;
  begin
    perform public.integration_list_schedules(i,i+14);
    raise exception 'a 15-day list should fail';
  exception when invalid_parameter_value then null; end;
end;
$test$;
reset role;
delete from public.schedules where not is_todo;
set local role anon;
do $test$
declare result jsonb;
begin
  result := public.integration_create_schedule('gcal:event-01','수리센터 지도점검 (오후)',(now() at time zone 'Asia/Seoul')::date);
  if result->>'status' <> 'removed' then raise exception 'intentional delete should not cause recreation: %', result; end if;
end;
$test$;
reset role;
update public.schedule_integration_credentials set enabled = false;
set local role anon;
do $test$
begin
  begin
    perform public.integration_create_schedule('gcal:event-01','수리센터 지도점검 (오후)',(now() at time zone 'Asia/Seoul')::date);
    raise exception 'revoked token should fail';
  exception when insufficient_privilege then null; end;
end;
$test$;
rollback;
