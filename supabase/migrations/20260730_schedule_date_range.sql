alter table public.schedules
  add column if not exists end_date date;

alter table public.schedules
  drop constraint if exists schedules_end_date_check;

alter table public.schedules
  add constraint schedules_end_date_check
  check (end_date is null or end_date >= date);

comment on column public.schedules.end_date is '기간 일정의 종료 날짜. null이면 하루 일정';

notify pgrst, 'reload schema';
