-- Explicit publications reference a single schedule. Private tables, RPC-only.
-- Apply after team identity/notifications, responsibility and schedule details.
begin;

create table if not exists public.important_schedule_publications (
  schedule_id bigint primary key,
  publisher_member_id uuid references public.team_members(id) on delete set null,
  status text not null check (status in ('published', 'changed', 'cancelled')),
  revision integer not null default 1 check (revision > 0),
  last_title text not null,
  last_date date,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
-- No foreign key to schedules: a deliberate cancellation marker survives a deletion.
create table if not exists public.important_schedule_reads (
  schedule_id bigint not null references public.important_schedule_publications(schedule_id) on delete cascade,
  principal_id uuid not null,
  revision integer not null check (revision > 0),
  read_at timestamptz not null default now(),
  primary key (schedule_id, principal_id)
);
alter table public.important_schedule_publications enable row level security;
alter table public.important_schedule_reads enable row level security;
revoke all on public.important_schedule_publications, public.important_schedule_reads from public, anon, authenticated;

alter table public.team_notifications drop constraint if exists team_notifications_kind_check;
alter table public.team_notifications add constraint team_notifications_kind_check
  check (kind in ('schedule_attendee', 'chat_mention', 'important_schedule'));

create or replace function public.important_schedule_viewer()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare member_id uuid;
begin
  if auth.uid() is null or not public.is_device_approved() or exists (
    select 1 from public.team_member_devices as device where device.user_id = auth.uid() and device.is_kiosk
  ) then raise exception 'An approved human device is required' using errcode = '42501'; end if;
  member_id := public.current_team_member_id();
  if member_id is null and not public.is_device_admin() then
    raise exception 'An active team member or administrator is required' using errcode = '42501';
  end if;
  return coalesce(member_id, auth.uid());
end;
$$;

create or replace function public.notify_important_schedule(
  p_schedule_id bigint, p_revision integer, p_title text, p_body text, p_recipient_ids uuid[]
)
returns void language sql security definer set search_path = '' as $$
  insert into public.team_notifications as existing (recipient_member_id, actor_member_id, actor_display_name,
    kind, source_id, source_fingerprint, title, body)
  select distinct recipient, author.id, author.display_name, 'important_schedule', p_schedule_id::text,
    p_revision::text || ':' || md5(p_title), p_title, left(coalesce(p_body, ''), 240)
  from unnest(coalesce(p_recipient_ids, '{}'::uuid[])) as targets(recipient)
  left join public.team_members as author on author.id = public.current_team_member_id()
  where recipient is distinct from author.id and public.team_member_is_active(recipient)
  on conflict (kind, source_id, recipient_member_id) do update
    set actor_member_id = excluded.actor_member_id, actor_display_name = excluded.actor_display_name,
      source_fingerprint = excluded.source_fingerprint, title = excluded.title, body = excluded.body,
      updated_at = now(), read_at = null
    where existing.source_fingerprint is distinct from excluded.source_fingerprint;
$$;

create or replace function public.publish_important_schedule(p_schedule_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare viewer uuid; source public.schedules%rowtype; new_revision integer;
begin
  viewer := public.important_schedule_viewer();
  select * into source from public.schedules where id = p_schedule_id for update;
  if not found or source.recurrence_status = 'cancelled' then
    raise exception 'The source schedule is missing or cancelled' using errcode = '22023';
  end if;
  -- Do not fall back to human-readable names; only the actual responsible ID.
  if not public.is_device_admin() and source.owner_member_id is distinct from public.current_team_member_id() then
    raise exception 'Only the responsible member or administrator can publish' using errcode = '42501';
  end if;
  insert into public.important_schedule_publications as existing
    (schedule_id, publisher_member_id, status, last_title, last_date)
  values (p_schedule_id, public.current_team_member_id(), 'published', left(coalesce(source.title, '일정'), 160), source.date)
  on conflict (schedule_id) do update
    set publisher_member_id = excluded.publisher_member_id, status = excluded.status,
      last_title = excluded.last_title, last_date = excluded.last_date, revision = existing.revision + 1,
      published_at = now(), updated_at = now(), withdrawn_at = null
    where existing.withdrawn_at is not null
  returning revision into new_revision;
  if new_revision is null then return false; end if;
  insert into public.important_schedule_reads as existing (schedule_id, principal_id, revision)
    values (p_schedule_id, viewer, new_revision)
  on conflict (schedule_id, principal_id) do update set revision = excluded.revision, read_at = now();
  perform public.notify_important_schedule(p_schedule_id, new_revision, '중요 일정이 공유되었습니다',
    concat_ws(' · ', source.title, source.date::text), source.attendee_member_ids);
  return true;
end;
$$;

create or replace function public.important_schedule_has_change(old_row jsonb, new_row jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_build_array(old_row->'date', old_row->'end_date', old_row->'start_time', old_row->'end_time',
    nullif(btrim(old_row->>'location'), ''), old_row->'recurrence_status') is distinct from
    jsonb_build_array(new_row->'date', new_row->'end_date', new_row->'start_time', new_row->'end_time',
    nullif(btrim(new_row->>'location'), ''), new_row->'recurrence_status');
$$;

create or replace function public.capture_important_schedule_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare new_revision integer; next_status text; short_title text; short_date date; recipients uuid[];
  record_id bigint;
  removed uuid[];
begin
  if tg_op = 'DELETE' then
    record_id := old.id;
    next_status := 'cancelled'; short_title := left(coalesce(old.title, '일정'), 160); short_date := old.date;
    recipients := old.attendee_member_ids;
  elsif tg_op = 'INSERT' then
    record_id := new.id;
    -- Undo may restore the original ID. A newly created, unrelated schedule
    -- does not create a publication and never sends an important alert.
    if new.recurrence_status = 'cancelled' then return new; end if;
    next_status := 'changed'; short_title := left(coalesce(new.title, '일정'), 160); short_date := new.date;
    recipients := new.attendee_member_ids;
  else
    record_id := old.id;
    short_title := left(coalesce(new.title, '일정'), 160); short_date := new.date;
    if not public.important_schedule_has_change(to_jsonb(old), to_jsonb(new)) then
      -- A roster-only correction is not a new team-wide briefing. Tell only
      -- added or removed attendees; everyone else's card/read state stays put.
      if new.attendee_member_ids is distinct from old.attendee_member_ids and new.recurrence_status <> 'cancelled' then
        select revision into new_revision from public.important_schedule_publications
          where schedule_id = record_id and withdrawn_at is null;
        if new_revision is not null then
          perform public.notify_important_schedule(record_id, new_revision, '중요 일정 참석자로 지정되었습니다',
            concat_ws(' · ', short_title, short_date::text), array(select id from unnest(new.attendee_member_ids) as incoming(id)
              where not (id = any(old.attendee_member_ids))));
          perform public.notify_important_schedule(record_id, new_revision, '중요 일정 참석이 취소되었습니다',
            concat_ws(' · ', short_title, short_date::text), array(select id from unnest(old.attendee_member_ids) as outgoing(id)
              where not (id = any(new.attendee_member_ids))));
        end if;
      end if;
      return new;
    end if;
    next_status := case when new.recurrence_status = 'cancelled' then 'cancelled' else 'changed' end;
    recipients := new.attendee_member_ids;
    if next_status = 'cancelled' then
      recipients := coalesce(old.attendee_member_ids, '{}'::uuid[]) || coalesce(new.attendee_member_ids, '{}'::uuid[]);
    else
      removed := array(select id from unnest(old.attendee_member_ids) as outgoing(id) where not (id = any(new.attendee_member_ids)));
    end if;
  end if;
  update public.important_schedule_publications
    set status = next_status, last_title = short_title, last_date = short_date, revision = revision + 1, updated_at = now()
    where schedule_id = record_id and withdrawn_at is null and (tg_op <> 'INSERT' or status = 'cancelled')
  returning revision into new_revision;
  if new_revision is not null then
    perform public.notify_important_schedule(record_id, new_revision,
      case when next_status = 'cancelled' then '중요 일정이 취소되었습니다' else '중요 일정이 변경되었습니다' end,
      concat_ws(' · ', short_title, short_date::text), recipients);
    if cardinality(removed) > 0 then
      perform public.notify_important_schedule(record_id, new_revision, '중요 일정 참석이 취소되었습니다',
        concat_ws(' · ', short_title, short_date::text), removed);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- A publication follows the schedule, so protecting the publication RPC
-- alone is not sufficient. Keep routine shared edits (checking a task off,
-- adding a document link, etc.) intact, but protect its critical details.
create or replace function public.guard_published_schedule_source()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_id bigint;
begin
  if tg_op = 'INSERT' then source_id := new.id; else source_id := old.id; end if;
  if auth.uid() is not null and not public.is_device_admin() and exists (
    select 1 from public.important_schedule_publications where schedule_id = source_id and withdrawn_at is null
  ) and (
    tg_op <> 'UPDATE' or new.title is distinct from old.title or new.owner_member_id is distinct from old.owner_member_id
    or new.attendee_member_ids is distinct from old.attendee_member_ids
    or public.important_schedule_has_change(to_jsonb(old), to_jsonb(new))
  ) then
    perform public.important_schedule_viewer();
    if tg_op = 'INSERT' or public.current_team_member_id() is distinct from old.owner_member_id then
      raise exception 'Only the responsible member or administrator may change a published schedule' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Reuse the general attendee notification except when the same meaningful
-- date/time/location/cancellation update already sends an important notice.
create or replace function public.use_regular_schedule_notification(p_schedule_id bigint, old_row jsonb, new_row jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select not public.is_device_approved() or not (public.important_schedule_has_change(old_row, new_row)
      or old_row->'attendee_member_ids' is distinct from new_row->'attendee_member_ids'
      or old_row->'title' is distinct from new_row->'title')
    or not exists (select 1 from public.important_schedule_publications
      where schedule_id = p_schedule_id and withdrawn_at is null);
$$;

drop trigger if exists capture_schedule_team_notifications on public.schedules;
drop trigger if exists capture_schedule_team_notifications_update on public.schedules;
drop trigger if exists capture_important_schedule_change on public.schedules;
drop trigger if exists guard_published_schedule_source on public.schedules;
create trigger capture_schedule_team_notifications after insert or delete on public.schedules
  for each row execute function public.capture_team_notifications();
create trigger capture_schedule_team_notifications_update after update on public.schedules
  for each row when (public.use_regular_schedule_notification(old.id::bigint, to_jsonb(old), to_jsonb(new)))
  execute function public.capture_team_notifications();
create trigger guard_published_schedule_source before insert or update or delete on public.schedules
  for each row execute function public.guard_published_schedule_source();
create trigger capture_important_schedule_change after insert or update or delete on public.schedules
  for each row execute function public.capture_important_schedule_change();

create or replace function public.list_important_schedules()
returns table(schedule_id bigint, title text, date text, end_date text, start_time text, end_time text,
  location text, attendee_count integer, file_count integer, status text, revision integer,
  read boolean, source_available boolean, can_withdraw boolean)
language plpgsql stable security definer set search_path = '' as $$
declare viewer uuid; member_id uuid; administrator boolean;
begin
  viewer := public.important_schedule_viewer();
  member_id := public.current_team_member_id();
  administrator := public.is_device_admin();
  return query select pub.schedule_id, coalesce(source.title, pub.last_title)::text,
    coalesce(source.date, pub.last_date)::text, source.end_date::text, source.start_time::text, source.end_time::text,
    source.location::text, coalesce(cardinality(source.attendee_member_ids), 0), coalesce(cardinality(source.linked_file_ids), 0),
    pub.status, pub.revision, coalesce(seen.revision >= pub.revision, false),
    source.id is not null and pub.status <> 'cancelled',
    administrator or (member_id is not null and member_id = coalesce(source.owner_member_id,
      case when source.id is null then pub.publisher_member_id end)) is true
  from public.important_schedule_publications as pub
  left join public.schedules as source on source.id = pub.schedule_id
  left join public.important_schedule_reads as seen on seen.schedule_id = pub.schedule_id and seen.principal_id = viewer
  where pub.withdrawn_at is null
  order by case when coalesce(source.end_date, source.date, pub.last_date) >= (now() at time zone 'Asia/Seoul')::date then 0 else 1 end,
    case when coalesce(source.end_date, source.date, pub.last_date) >= (now() at time zone 'Asia/Seoul')::date then coalesce(source.date, pub.last_date) end asc nulls last,
    case when coalesce(source.end_date, source.date, pub.last_date) >= (now() at time zone 'Asia/Seoul')::date then source.start_time end asc nulls last,
    pub.updated_at desc, pub.schedule_id desc
  limit 100;
end;
$$;

create or replace function public.mark_important_schedule_read(p_schedule_id bigint, p_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare viewer uuid; current_revision integer;
begin
  viewer := public.important_schedule_viewer();
  select revision into current_revision from public.important_schedule_publications
    where schedule_id = p_schedule_id and withdrawn_at is null for key share;
  if current_revision is distinct from p_revision then return false; end if;
  insert into public.important_schedule_reads as existing (schedule_id, principal_id, revision)
  values (p_schedule_id, viewer, p_revision)
  on conflict (schedule_id, principal_id) do update set revision = excluded.revision, read_at = now()
  where existing.revision < excluded.revision;
  return true;
end;
$$;

create or replace function public.withdraw_important_schedule(p_schedule_id bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_owner uuid; member_id uuid; changed integer;
begin
  perform public.important_schedule_viewer();
  member_id := public.current_team_member_id();
  select owner_member_id into current_owner from public.schedules where id = p_schedule_id for update;
  if not found then
    select publisher_member_id into current_owner from public.important_schedule_publications where schedule_id = p_schedule_id;
  end if;
  if not public.is_device_admin() and (member_id is null or current_owner is distinct from member_id) then
    raise exception 'Only the responsible member or administrator can withdraw' using errcode = '42501';
  end if;
  update public.important_schedule_publications set withdrawn_at = now()
    where schedule_id = p_schedule_id and withdrawn_at is null;
  get diagnostics changed = row_count;
  if changed > 0 then
    delete from public.team_notifications where kind = 'important_schedule' and source_id = p_schedule_id::text;
  end if;
  return changed > 0;
end;
$$;

revoke all on function public.important_schedule_viewer(), public.notify_important_schedule(bigint, integer, text, text, uuid[]),
  public.important_schedule_has_change(jsonb, jsonb), public.capture_important_schedule_change(),
  public.guard_published_schedule_source(),
  public.use_regular_schedule_notification(bigint, jsonb, jsonb), public.list_important_schedules(),
  public.publish_important_schedule(bigint), public.mark_important_schedule_read(bigint, integer),
  public.withdraw_important_schedule(bigint) from public, anon, authenticated;
grant execute on function public.use_regular_schedule_notification(bigint, jsonb, jsonb), public.list_important_schedules(),
  public.publish_important_schedule(bigint), public.mark_important_schedule_read(bigint, integer),
  public.withdraw_important_schedule(bigint) to authenticated;

notify pgrst, 'reload schema';
commit;
