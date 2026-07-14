alter table public.schedules
  add column if not exists is_completed boolean not null default false,
  add column if not exists is_urgent boolean not null default false;

comment on column public.schedules.is_completed is '공용 TO DO LIST 완료 여부';
comment on column public.schedules.is_urgent is '긴급 일정 표시 여부';
