-- Recurring schedule foundation.
-- Existing schedules intentionally remain standalone. Only newly-created recurring
-- schedules should be connected to a row in schedule_recurrence_groups.

create table if not exists public.schedule_recurrence_groups (
  id uuid primary key default gen_random_uuid(),
  recurrence_type text not null,
  weekday smallint not null,
  monthly_week text,
  starts_on date not null,
  ends_on date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_recurrence_groups_type_check
    check (recurrence_type in ('weekly', 'biweekly', 'monthly')),
  constraint schedule_recurrence_groups_weekday_check
    check (weekday between 0 and 6),
  constraint schedule_recurrence_groups_monthly_week_check
    check (
      (recurrence_type = 'monthly' and monthly_week in ('first', 'second', 'third', 'fourth', 'last'))
      or (recurrence_type <> 'monthly' and monthly_week is null)
    ),
  constraint schedule_recurrence_groups_date_check
    check (starts_on <= ends_on),
  constraint schedule_recurrence_groups_single_year_check
    check (extract(year from starts_on) = extract(year from ends_on))
);

comment on table public.schedule_recurrence_groups is '한 해 안에서 생성되는 정기 일정의 반복 규칙';
comment on column public.schedule_recurrence_groups.weekday is '요일: 0=일요일, 6=토요일';
comment on column public.schedule_recurrence_groups.monthly_week is '월간 반복 주차: 첫째, 둘째, 셋째, 넷째, 마지막 주';

alter table public.schedules
  add column if not exists recurrence_group_id uuid,
  add column if not exists recurrence_original_date date,
  add column if not exists recurrence_index integer,
  add column if not exists recurrence_status text not null default 'active',
  add column if not exists recurrence_is_exception boolean not null default false,
  add column if not exists recurrence_cancelled_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedules_recurrence_group_fk'
      and conrelid = 'public.schedules'::regclass
  ) then
    alter table public.schedules
      add constraint schedules_recurrence_group_fk
      foreign key (recurrence_group_id)
      references public.schedule_recurrence_groups(id)
      on delete restrict;
  end if;
end;
$$;

alter table public.schedules
  drop constraint if exists schedules_recurrence_index_check;

alter table public.schedules
  add constraint schedules_recurrence_index_check
  check (recurrence_index is null or recurrence_index >= 0);

alter table public.schedules
  drop constraint if exists schedules_recurrence_status_check;

alter table public.schedules
  add constraint schedules_recurrence_status_check
  check (recurrence_status in ('active', 'cancelled'));

alter table public.schedules
  drop constraint if exists schedules_recurrence_metadata_check;

alter table public.schedules
  add constraint schedules_recurrence_metadata_check
  check (
    (
      recurrence_group_id is null
      and recurrence_original_date is null
      and recurrence_index is null
      and recurrence_is_exception = false
    )
    or
    (
      recurrence_group_id is not null
      and recurrence_original_date is not null
      and recurrence_index is not null
    )
  );

create unique index if not exists schedules_recurrence_group_index_unique
  on public.schedules (recurrence_group_id, recurrence_index)
  where recurrence_group_id is not null;

create unique index if not exists schedules_recurrence_original_date_unique
  on public.schedules (recurrence_group_id, recurrence_original_date)
  where recurrence_group_id is not null;

create index if not exists schedules_recurrence_scope_lookup
  on public.schedules (recurrence_group_id, recurrence_index, recurrence_status)
  where recurrence_group_id is not null;

comment on column public.schedules.recurrence_group_id is '같은 정기 일정 회차를 연결하는 그룹 ID';
comment on column public.schedules.recurrence_original_date is '개별 회차 이동 전 최초 예정일';
comment on column public.schedules.recurrence_index is '그룹 안의 0부터 시작하는 회차 순서';
comment on column public.schedules.recurrence_status is '정기 일정 회차 상태: active 또는 cancelled';
comment on column public.schedules.recurrence_is_exception is '날짜나 내용이 개별 수정된 회차 여부';
comment on column public.schedules.recurrence_cancelled_at is '회차 취소 시각';

-- Match the approved-device policy pattern used by the shared dashboard tables.
alter table public.schedule_recurrence_groups enable row level security;

revoke all on table public.schedule_recurrence_groups from public, anon;
grant select, insert, update, delete on table public.schedule_recurrence_groups to authenticated;

drop policy if exists "approved_devices_share_recurrence_groups" on public.schedule_recurrence_groups;
drop policy if exists "device_approval_required_for_recurrence_groups" on public.schedule_recurrence_groups;

create policy "approved_devices_share_recurrence_groups"
on public.schedule_recurrence_groups
as permissive
for all
to authenticated
using (public.is_device_approved())
with check (public.is_device_approved());

create policy "device_approval_required_for_recurrence_groups"
on public.schedule_recurrence_groups
as restrictive
for all
to authenticated
using (public.is_device_approved())
with check (public.is_device_approved());

notify pgrst, 'reload schema';
