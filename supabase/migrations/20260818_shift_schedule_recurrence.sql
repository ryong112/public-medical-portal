-- Move every active occurrence in one recurrence group by the same number of days.
-- This is intentionally exposed only to approved authenticated devices.

create or replace function public.shift_schedule_recurrence_group(
  p_group_id uuid,
  p_day_delta integer
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  shifted_count integer := 0;
begin
  if not public.is_device_approved() then
    raise exception '승인된 기기에서만 반복 일정을 이동할 수 있습니다.';
  end if;

  if p_group_id is null then
    raise exception '반복 일정 그룹이 없습니다.';
  end if;

  if p_day_delta = 0 then
    return 0;
  end if;

  if abs(p_day_delta) > 366 then
    raise exception '반복 일정은 한 번에 366일을 초과하여 이동할 수 없습니다.';
  end if;

  update public.schedules
  set
    date = date + p_day_delta,
    end_date = case when end_date is null then null else end_date + p_day_delta end,
    recurrence_original_date = recurrence_original_date + p_day_delta,
    recurrence_is_exception = false
  where recurrence_group_id = p_group_id
    and recurrence_status = 'active';

  get diagnostics shifted_count = row_count;
  return shifted_count;
end;
$$;

revoke all on function public.shift_schedule_recurrence_group(uuid, integer) from public, anon;
grant execute on function public.shift_schedule_recurrence_group(uuid, integer) to authenticated;

comment on function public.shift_schedule_recurrence_group(uuid, integer)
  is '승인 기기에서 반복 일정 전체를 동일한 일수만큼 이동';

notify pgrst, 'reload schema';
