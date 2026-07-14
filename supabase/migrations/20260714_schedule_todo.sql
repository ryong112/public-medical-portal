alter table public.schedules
  add column if not exists is_todo boolean not null default false;

update public.schedules
set is_todo = true
where is_completed = true
  and is_todo = false;

comment on column public.schedules.is_todo is '오늘의 TO DO LIST 표시 여부';

notify pgrst, 'reload schema';
