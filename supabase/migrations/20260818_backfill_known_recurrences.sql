-- Connect known legacy meeting schedules that were created before recurrence
-- metadata was introduced. Existing recurrence groups are never changed.

do $$
declare
  series record;
  new_group_id uuid;
  connected_count integer := 0;
begin
  for series in
    with candidates as (
      select
        s.id,
        s.date,
        regexp_replace(trim(s.title), '\s+', '', 'g') as normalized_title,
        extract(year from s.date)::integer as schedule_year
      from public.schedules as s
      where s.recurrence_group_id is null
        and s.recurrence_status = 'active'
        and regexp_replace(trim(s.title), '\s+', '', 'g') in (
          '팀회의',
          '정책결정회의',
          '월례회의',
          '확대간부회의'
        )
    )
    select
      candidate.normalized_title,
      candidate.schedule_year,
      min(candidate.date) as starts_on,
      max(candidate.date) as ends_on,
      min(candidate.date) as first_date,
      case
        when candidate.normalized_title in ('월례회의', '확대간부회의') then 'monthly'
        else 'biweekly'
      end as recurrence_type,
      case
        when candidate.normalized_title = '월례회의' then 'first'
        when candidate.normalized_title = '확대간부회의' then 'last'
        else null
      end as monthly_week
    from candidates as candidate
    where not exists (
      select 1
      from public.schedules as linked
      where linked.recurrence_group_id is not null
        and extract(year from linked.date)::integer = candidate.schedule_year
        and regexp_replace(trim(linked.title), '\s+', '', 'g') = candidate.normalized_title
    )
    group by candidate.normalized_title, candidate.schedule_year
    having count(*) >= 2
      and count(*) = count(distinct candidate.date)
  loop
    new_group_id := gen_random_uuid();

    insert into public.schedule_recurrence_groups (
      id,
      recurrence_type,
      weekday,
      monthly_week,
      starts_on,
      ends_on
    )
    values (
      new_group_id,
      series.recurrence_type,
      extract(dow from series.first_date)::smallint,
      series.monthly_week,
      series.starts_on,
      series.ends_on
    );

    with ordered_occurrences as (
      select
        schedule.id,
        schedule.date,
        (row_number() over (order by schedule.date, schedule.id) - 1)::integer as recurrence_index
      from public.schedules as schedule
      where schedule.recurrence_group_id is null
        and schedule.recurrence_status = 'active'
        and extract(year from schedule.date)::integer = series.schedule_year
        and regexp_replace(trim(schedule.title), '\s+', '', 'g') = series.normalized_title
    )
    update public.schedules as schedule
    set
      recurrence_group_id = new_group_id,
      recurrence_original_date = occurrence.date,
      recurrence_index = occurrence.recurrence_index,
      recurrence_is_exception = false
    from ordered_occurrences as occurrence
    where schedule.id = occurrence.id;

    get diagnostics connected_count = row_count;
    raise notice '%년 %: %개 일정을 반복 그룹으로 연결했습니다.', series.schedule_year, series.normalized_title, connected_count;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
