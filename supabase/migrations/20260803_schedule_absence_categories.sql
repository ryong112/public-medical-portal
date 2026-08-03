alter table public.schedules
  drop constraint if exists schedules_absence_type_check;

update public.schedules
set absence_type = 'early'
where absence_type in ('early_am', 'early_pm');

alter table public.schedules
  add constraint schedules_absence_type_check
  check (absence_type in ('annual', 'early', 'outing'));

comment on column public.schedules.absence_type is '휴가 구분: 연차, 조퇴, 외출';

notify pgrst, 'reload schema';
