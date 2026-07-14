alter table public.schedules
  alter column start_time drop not null,
  alter column end_time drop not null;
