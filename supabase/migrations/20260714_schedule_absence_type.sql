alter table public.schedules
  add column if not exists absence_type text not null default 'annual';

alter table public.schedules
  drop constraint if exists schedules_absence_type_check;

alter table public.schedules
  add constraint schedules_absence_type_check
  check (absence_type in ('annual', 'early_am', 'early_pm'));

update public.schedules
set absence_type = case
  when title ilike '%오전%' and title ilike '%조퇴%' then 'early_am'
  when title ilike '%오후%' and title ilike '%조퇴%' then 'early_pm'
  else absence_type
end
where title ilike '%조퇴%';

comment on column public.schedules.absence_type is '휴가 구분: 연차, 오전 조퇴, 오후 조퇴';

notify pgrst, 'reload schema';
