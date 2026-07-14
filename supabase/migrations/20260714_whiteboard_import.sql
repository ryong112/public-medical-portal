alter table public.schedules
  add column if not exists schedule_type text not null default 'unclassified';

alter table public.schedules
  drop constraint if exists schedules_schedule_type_check;

alter table public.schedules
  add constraint schedules_schedule_type_check
  check (schedule_type in ('meeting', 'business_trip', 'internal', 'leave', 'unclassified'));

create table if not exists public.whiteboard_ai_usage (
  usage_date date primary key,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.whiteboard_ai_usage enable row level security;

create or replace function public.claim_whiteboard_analysis(p_daily_limit integer default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_count integer;
begin
  insert into public.whiteboard_ai_usage (usage_date, request_count, updated_at)
  values (current_date, 1, now())
  on conflict (usage_date) do update
    set request_count = public.whiteboard_ai_usage.request_count + 1,
        updated_at = now()
    where public.whiteboard_ai_usage.request_count < p_daily_limit
  returning request_count into claimed_count;

  return claimed_count is not null;
end;
$$;

revoke all on table public.whiteboard_ai_usage from anon, authenticated;
revoke all on function public.claim_whiteboard_analysis(integer) from public, anon, authenticated;
grant execute on function public.claim_whiteboard_analysis(integer) to service_role;

comment on column public.schedules.schedule_type is '화이트보드 색상 기반 일정 유형';
comment on table public.whiteboard_ai_usage is '화이트보드 AI 분석의 일별 전역 사용량 제한';
