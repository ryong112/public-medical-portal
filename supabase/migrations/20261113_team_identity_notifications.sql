-- Stable portal identities are browser-approval mappings, not proof of a person's
-- identity. Never merge equal names. An administrator must explicitly link a
-- second approved browser to an existing member.
-- Install atomically AFTER the existing device, kiosk and schedule migrations.
begin;

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  handle text not null unique,
  name_source_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_display_name_check check (char_length(trim(display_name)) between 1 and 100),
  constraint team_members_handle_check check (char_length(handle) between 1 and 100 and handle !~ '[[:space:]@]')
);

create table if not exists public.team_member_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid references public.team_members(id) on delete restrict,
  is_kiosk boolean not null default false,
  source_user_id uuid references auth.users(id) on delete set null,
  linked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_member_devices_human_member_check check (is_kiosk or member_id is not null)
);
create index if not exists team_member_devices_member_idx on public.team_member_devices(member_id);

alter table public.team_members enable row level security;
alter table public.team_member_devices enable row level security;
revoke all on table public.team_members, public.team_member_devices from public, anon, authenticated;

create or replace function public.team_display_name_from_device(p_device_name text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(trim(regexp_replace(trim(coalesce(p_device_name, '')), '[[:space:]/·_-]+(사내[[:space:]]*PC|병원[[:space:]]*PC)$', '', 'i')), ''),
    nullif(trim(p_device_name), ''),
    '이름 미등록'
  );
$$;

create or replace function public.current_team_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select device.member_id
  from public.team_member_devices as device
  join public.device_access as access on access.user_id = device.user_id
  where device.user_id = auth.uid() and not device.is_kiosk
    and access.status = 'approved' and not access.is_admin;
$$;

create or replace function public.team_member_is_active(p_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_member_devices as device
    join public.device_access as access on access.user_id = device.user_id
    where device.member_id = p_member_id and not device.is_kiosk
      and access.status = 'approved' and not access.is_admin
  );
$$;

create or replace function public.provision_team_member_device(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  access_record public.device_access%rowtype;
  mapping public.team_member_devices%rowtype;
  paired_source uuid;
  new_member_id uuid := gen_random_uuid();
  clean_name text;
  base_handle text;
  candidate_handle text;
  collision_count integer := 0;
begin
  -- Serialize provisioning with concurrent approval, rename, and admin linking.
  select * into access_record from public.device_access where user_id = p_user_id for update;
  if not found or access_record.status <> 'approved' or access_record.is_admin then return; end if;

  select * into mapping from public.team_member_devices where user_id = p_user_id;
  if found then
    if not mapping.is_kiosk then
      update public.team_members set
        display_name = public.team_display_name_from_device(access_record.device_name), updated_at = now()
      where id = mapping.member_id and name_source_user_id = p_user_id
        and display_name is distinct from public.team_display_name_from_device(access_record.device_name);
    end if;
    return;
  end if;

  -- Historical companion profiles are recognized ONLY by the explicit used
  -- pairing record, never by an ambiguous device-name suffix.
  select request.approved_by into paired_source
  from public.kiosk_pair_requests as request
  where request.target_user_id = p_user_id and request.used_at is not null
  order by request.used_at desc, request.id limit 1;
  if found then
    insert into public.team_member_devices(user_id, member_id, is_kiosk, source_user_id)
    select p_user_id, source.member_id, true, paired_source
    from (select 1) as singleton
    left join public.team_member_devices as source on source.user_id = paired_source;
    return;
  end if;

  clean_name := public.team_display_name_from_device(access_record.device_name);
  base_handle := left(lower(regexp_replace(clean_name, '[^a-zA-Z0-9가-힣_.-]+', '', 'g')), 48);
  if base_handle = '' then base_handle := 'member'; end if;
  candidate_handle := base_handle;
  loop
    begin
      insert into public.team_members(id, display_name, handle, name_source_user_id)
        values (new_member_id, clean_name, candidate_handle, p_user_id);
      exit;
    exception when unique_violation then
      collision_count := collision_count + 1;
      candidate_handle := base_handle || '_' || left(replace(new_member_id::text, '-', ''),
        case when collision_count = 1 then 8 else 32 end);
      if collision_count > 2 then raise; end if;
    end;
  end loop;
  insert into public.team_member_devices(user_id, member_id) values (p_user_id, new_member_id);
end;
$$;

create or replace function public.sync_approved_team_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.provision_team_member_device(new.user_id);
  return new;
end;
$$;
drop trigger if exists sync_approved_team_member on public.device_access;
create trigger sync_approved_team_member after insert or update of status, is_admin, device_name
on public.device_access for each row execute function public.sync_approved_team_member();

-- Two passes avoid provisioning a kiosk before its human source. Only currently
-- approved, non-admin records are backfilled; no old text attendees are guessed.
do $$
declare target record;
begin
  for target in
    select access.user_id from public.device_access as access
    where access.status = 'approved' and not access.is_admin
      and not exists (select 1 from public.kiosk_pair_requests as request
        where request.target_user_id = access.user_id and request.used_at is not null)
    order by access.requested_at, access.user_id
  loop perform public.provision_team_member_device(target.user_id); end loop;
  for target in
    select access.user_id from public.device_access as access
    where access.status = 'approved' and not access.is_admin
      and exists (select 1 from public.kiosk_pair_requests as request
        where request.target_user_id = access.user_id and request.used_at is not null)
    order by access.requested_at, access.user_id
  loop perform public.provision_team_member_device(target.user_id); end loop;
end;
$$;

create or replace function public.list_team_members()
returns table(id uuid, display_name text, handle text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_device_approved() then raise exception 'Approved device access is required'; end if;
  return query select member.id, member.display_name, member.handle
  from public.team_members as member where public.team_member_is_active(member.id)
  order by member.display_name, member.handle;
end;
$$;

create or replace function public.get_my_team_member()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_device_approved() then raise exception 'Approved device access is required'; end if;
  select jsonb_build_object('id', member.id, 'display_name', member.display_name, 'handle', member.handle)
  into result from public.team_members as member where member.id = public.current_team_member_id();
  return result;
end;
$$;

create or replace function public.admin_link_team_member_device(p_user_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.device_access%rowtype;
begin
  if not public.is_device_admin() then raise exception 'Administrator access is required'; end if;
  select * into target from public.device_access where user_id = p_user_id for update;
  if not found or target.status <> 'approved' or target.is_admin then
    raise exception 'Only an approved non-admin human device can be linked';
  end if;
  if exists (select 1 from public.team_member_devices where user_id = p_user_id and is_kiosk) then
    raise exception 'A kiosk companion cannot be linked as a human device';
  end if;
  if not exists (select 1 from public.team_members where id = p_member_id) then
    raise exception 'Team member was not found';
  end if;
  insert into public.team_member_devices(user_id, member_id, linked_by)
    values(p_user_id, p_member_id, auth.uid())
  on conflict (user_id) do update set member_id = excluded.member_id,
    linked_by = excluded.linked_by, updated_at = now();
  -- Retain the old member/handle and old notifications; do not silently transfer
  -- somebody else's history. Explicit linking affects future identity/routing.
  update public.team_member_devices set member_id = p_member_id, updated_at = now()
  where is_kiosk and source_user_id = p_user_id;
end;
$$;

create or replace function public.admin_set_team_member_name(p_member_id uuid, p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_device_admin() then raise exception 'Administrator access is required'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 100 then
    raise exception 'Display name must contain between 1 and 100 characters';
  end if;
  update public.team_members set display_name = trim(p_display_name), name_source_user_id = null, updated_at = now()
  where id = p_member_id;
  if not found then raise exception 'Team member was not found'; end if;
  -- The unique handle is intentionally immutable when the display name changes.
end;
$$;

create or replace function public.list_team_member_devices()
returns table(user_id uuid, member_id uuid, is_kiosk boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_device_admin() then raise exception 'Administrator access is required'; end if;
  return query select device.user_id, device.member_id, device.is_kiosk
    from public.team_member_devices as device order by device.user_id;
end;
$$;

-- The approval handoff writes the kiosk marker BEFORE approving the target, so
-- its approval trigger cannot accidentally create an independent human identity.
create or replace function public.approve_kiosk_pair(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pair_request public.kiosk_pair_requests%rowtype;
  source_name text;
  target_access public.device_access%rowtype;
  source_member_id uuid;
  kiosk_name text;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if not public.is_device_approved() then raise exception 'An approved device is required'; end if;
  select request.* into pair_request from public.kiosk_pair_requests as request
    where request.id = p_request_id for update;
  if not found then raise exception 'Kiosk pairing request was not found'; end if;
  if pair_request.used_at is not null then raise exception 'Kiosk pairing request was already used'; end if;
  if pair_request.expires_at <= now() then raise exception 'Kiosk pairing request expired'; end if;
  if pair_request.target_user_id = auth.uid() then raise exception 'A profile cannot pair with itself'; end if;
  select access.device_name into source_name from public.device_access as access
    where access.user_id = auth.uid() and access.status = 'approved' for share;
  if not found then raise exception 'An approved device is required'; end if;
  select * into target_access from public.device_access where user_id = pair_request.target_user_id for update;
  if found and (target_access.status = 'blocked' or target_access.is_admin) then
    raise exception 'A blocked or administrator profile cannot become a kiosk';
  end if;
  select member_id into source_member_id from public.team_member_devices where user_id = auth.uid();
  insert into public.team_member_devices(user_id, member_id, is_kiosk, source_user_id, linked_by)
  values(pair_request.target_user_id, source_member_id, true, auth.uid(), auth.uid())
  on conflict(user_id) do update set member_id = excluded.member_id, is_kiosk = true,
    source_user_id = excluded.source_user_id, linked_by = excluded.linked_by, updated_at = now();
  kiosk_name := left(coalesce(source_name, '승인 기기') || ' · 전광판', 80);
  insert into public.device_access(user_id, device_name, status, is_admin, approved_at)
  values(pair_request.target_user_id, kiosk_name, 'approved', false, now())
  on conflict(user_id) do update set device_name = excluded.device_name, status = 'approved', is_admin = false,
    approved_at = now(), last_seen_at = now(), updated_at = now();
  update public.kiosk_pair_requests set approved_by = auth.uid(), used_at = now() where id = pair_request.id;
  return jsonb_build_object('status', 'approved', 'target_user_id', pair_request.target_user_id, 'device_name', kiosk_name);
end;
$$;

alter table public.schedules add column if not exists attendee_member_ids uuid[] not null default '{}';
alter table public.messages
  add column if not exists mentioned_member_ids uuid[] not null default '{}',
  add column if not exists sender_member_id uuid references public.team_members(id) on delete restrict,
  add column if not exists sender_display_name text;
create index if not exists schedules_attendee_member_ids_idx on public.schedules using gin(attendee_member_ids);
create index if not exists messages_mentioned_member_ids_idx on public.messages using gin(mentioned_member_ids);

create or replace function public.validate_team_member_targets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_ids uuid[]; old_ids uuid[] := '{}';
begin
  if tg_table_name = 'schedules' then
    target_ids := coalesce(new.attendee_member_ids, '{}'::uuid[]);
    if tg_op = 'UPDATE' then old_ids := old.attendee_member_ids; end if;
  else
    target_ids := coalesce(new.mentioned_member_ids, '{}'::uuid[]);
    if tg_op = 'UPDATE' then old_ids := old.mentioned_member_ids; end if;
  end if;
  if cardinality(target_ids) > 50 or array_position(target_ids, null) is not null then
    raise exception 'At most 50 non-null team member IDs are allowed';
  end if;
  target_ids := array(select distinct target from unnest(target_ids) as target order by target);
  -- Retained, now-inactive IDs are historical references. Only newly added IDs
  -- must be active, so blocking a device cannot break unrelated schedule edits.
  if exists (select 1 from unnest(target_ids) as target
    where not (target = any(coalesce(old_ids, '{}'::uuid[]))) and not public.team_member_is_active(target)) then
    raise exception 'A selected team member is no longer active';
  end if;
  if tg_table_name = 'schedules' then new.attendee_member_ids := target_ids;
  else
    new.mentioned_member_ids := target_ids;
    if tg_op = 'INSERT' then
      -- Keep the legacy text column compatible, but never accept a browser's
      -- claimed author for new authenticated messages (including administrators).
      if auth.uid() is not null then new.sender_id := auth.uid()::text; end if;
      new.sender_member_id := public.current_team_member_id();
      select coalesce(member.display_name, public.team_display_name_from_device(access.device_name))
        into new.sender_display_name
      from public.device_access as access
      left join public.team_members as member on member.id = new.sender_member_id
      where access.user_id = auth.uid() and access.status = 'approved';
    else
      -- Preserve historical anonymous IDs and original author snapshots on edits.
      new.sender_id := old.sender_id;
      new.sender_member_id := old.sender_member_id;
      new.sender_display_name := old.sender_display_name;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists validate_schedule_member_targets on public.schedules;
create trigger validate_schedule_member_targets before insert or update on public.schedules
for each row execute function public.validate_team_member_targets();
drop trigger if exists validate_message_member_targets on public.messages;
create trigger validate_message_member_targets before insert or update on public.messages
for each row execute function public.validate_team_member_targets();

create table if not exists public.team_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_member_id uuid not null references public.team_members(id) on delete restrict,
  actor_member_id uuid references public.team_members(id) on delete restrict,
  actor_display_name text,
  kind text not null check (kind in ('schedule_attendee', 'chat_mention')),
  source_id text not null,
  source_fingerprint text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  read_at timestamptz,
  constraint team_notifications_source_recipient_unique unique(kind, source_id, recipient_member_id)
);
create index if not exists team_notifications_inbox_idx on public.team_notifications(recipient_member_id, updated_at desc);
alter table public.team_notifications enable row level security;
revoke all on table public.team_notifications from public, anon, authenticated;
grant select on table public.team_notifications to authenticated;
drop policy if exists team_notifications_read_own on public.team_notifications;
drop policy if exists team_notifications_require_own on public.team_notifications;
create policy team_notifications_read_own on public.team_notifications as permissive for select to authenticated
using (recipient_member_id = public.current_team_member_id());
create policy team_notifications_require_own on public.team_notifications as restrictive for select to authenticated
using (public.is_device_approved() and recipient_member_id = public.current_team_member_id());

create or replace function public.schedule_team_notification_fingerprint(p_row jsonb)
returns text language sql immutable set search_path = '' as $$
  select md5(jsonb_build_array(p_row->'title', p_row->'date', p_row->'end_date',
    p_row->'start_time', p_row->'end_time', p_row->'location', p_row->'recurrence_status')::text);
$$;

create or replace function public.capture_team_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_ids uuid[];
  old_ids uuid[] := '{}';
  actor_id uuid;
  actor_name text;
  target_kind text;
  notification_title text;
  notification_body text;
  fingerprint text;
  meaningful_change boolean := false;
  source_row jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.team_notifications where kind = case when tg_table_name = 'schedules'
      then 'schedule_attendee' else 'chat_mention' end and source_id = old.id::text;
    return old;
  end if;
  -- Actor and recipients are derived from authenticated state and validated
  -- source columns. Clients cannot insert an arbitrary inbox row or actor.
  if auth.uid() is null or not public.is_device_approved() then return new; end if;
  actor_id := public.current_team_member_id();
  select coalesce(member.display_name, public.team_display_name_from_device(access.device_name)) into actor_name
  from public.device_access as access left join public.team_members as member on member.id = actor_id
  where access.user_id = auth.uid() and access.status = 'approved';
  source_row := to_jsonb(new);
  if tg_table_name = 'schedules' then
    target_kind := 'schedule_attendee';
    target_ids := new.attendee_member_ids;
    fingerprint := public.schedule_team_notification_fingerprint(source_row);
    if tg_op = 'UPDATE' then
      old_ids := old.attendee_member_ids;
      meaningful_change := fingerprint is distinct from public.schedule_team_notification_fingerprint(to_jsonb(old));
    end if;
    notification_title := case when meaningful_change then '참석 일정이 변경되었습니다' else '일정 참석자로 지정되었습니다' end;
    notification_body := left(concat_ws(' · ', nullif(source_row->>'title', ''), nullif(source_row->>'date', ''),
      nullif(source_row->>'start_time', ''), nullif(source_row->>'location', '')), 1000);
  else
    target_kind := 'chat_mention';
    target_ids := new.mentioned_member_ids;
    if tg_op = 'UPDATE' then old_ids := old.mentioned_member_ids; end if;
    fingerprint := md5(coalesce(new.content, ''));
    notification_title := coalesce(actor_name, '팀원') || ' 님이 대화에서 멘션했습니다';
    notification_body := left(coalesce(new.content, ''), 1000);
  end if;

  insert into public.team_notifications as existing(
    recipient_member_id, actor_member_id, actor_display_name, kind, source_id, source_fingerprint, title, body)
  select target, actor_id, actor_name, target_kind, new.id::text, fingerprint, notification_title, notification_body
  from unnest(target_ids) as target
  where target is distinct from actor_id and public.team_member_is_active(target)
    and (meaningful_change or not (target = any(coalesce(old_ids, '{}'::uuid[]))))
  on conflict(kind, source_id, recipient_member_id) do update
  set actor_member_id = excluded.actor_member_id, actor_display_name = excluded.actor_display_name,
    source_fingerprint = excluded.source_fingerprint, title = excluded.title, body = excluded.body,
    updated_at = now(), read_at = null
  where meaningful_change and existing.source_fingerprint is distinct from excluded.source_fingerprint;
  return new;
end;
$$;
drop trigger if exists capture_schedule_team_notifications on public.schedules;
create trigger capture_schedule_team_notifications after insert or update or delete on public.schedules
for each row execute function public.capture_team_notifications();
drop trigger if exists capture_message_team_notifications on public.messages;
create trigger capture_message_team_notifications after insert or update or delete on public.messages
for each row execute function public.capture_team_notifications();

create or replace function public.list_my_team_notifications(p_limit integer default 50)
returns table(id uuid, kind text, source_id text, title text, body text,
  actor_member_id uuid, actor_display_name text, created_at timestamptz, updated_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_device_approved() then raise exception 'Approved device access is required'; end if;
  return query select notification.id, notification.kind, notification.source_id, notification.title, notification.body,
    notification.actor_member_id, notification.actor_display_name,
    notification.created_at, notification.updated_at, notification.read_at
  from public.team_notifications as notification
  where notification.recipient_member_id = public.current_team_member_id()
  order by notification.updated_at desc, notification.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

create or replace function public.mark_my_notifications_read(p_notification_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if not public.is_device_approved() then raise exception 'Approved device access is required'; end if;
  if cardinality(p_notification_ids) > 100 then raise exception 'At most 100 notification IDs are allowed'; end if;
  update public.team_notifications set read_at = now()
  where recipient_member_id = public.current_team_member_id() and read_at is null
    and (p_notification_ids is null or id = any(p_notification_ids));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- SECURITY DEFINER functions default to PUBLIC execution: explicitly close every
-- internal helper and grant only the authenticated entry points below.
revoke all on function public.team_display_name_from_device(text) from public, anon, authenticated;
revoke all on function public.team_member_is_active(uuid) from public, anon, authenticated;
revoke all on function public.provision_team_member_device(uuid) from public, anon, authenticated;
revoke all on function public.sync_approved_team_member() from public, anon, authenticated;
revoke all on function public.validate_team_member_targets() from public, anon, authenticated;
revoke all on function public.schedule_team_notification_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.capture_team_notifications() from public, anon, authenticated;
revoke all on function public.current_team_member_id() from public, anon, authenticated;
revoke all on function public.list_team_members() from public, anon, authenticated;
revoke all on function public.get_my_team_member() from public, anon, authenticated;
revoke all on function public.admin_link_team_member_device(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_set_team_member_name(uuid, text) from public, anon, authenticated;
revoke all on function public.list_team_member_devices() from public, anon, authenticated;
revoke all on function public.approve_kiosk_pair(uuid) from public, anon, authenticated;
revoke all on function public.list_my_team_notifications(integer) from public, anon, authenticated;
revoke all on function public.mark_my_notifications_read(uuid[]) from public, anon, authenticated;
grant execute on function public.current_team_member_id() to authenticated;
grant execute on function public.list_team_members() to authenticated;
grant execute on function public.get_my_team_member() to authenticated;
grant execute on function public.admin_link_team_member_device(uuid, uuid) to authenticated;
grant execute on function public.admin_set_team_member_name(uuid, text) to authenticated;
grant execute on function public.list_team_member_devices() to authenticated;
grant execute on function public.approve_kiosk_pair(uuid) to authenticated;
grant execute on function public.list_my_team_notifications(integer) to authenticated;
grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;

comment on table public.team_members is 'Stable portal IDs. Names do not establish verified personal identity. No name-based auto-merging.';
comment on table public.team_member_devices is 'Private auth.users/browser-approval to member mapping; kiosk companions are not human roster members.';
comment on column public.team_members.handle is 'Unique mention label, immutable across display-name/status changes. Routing always uses UUID.';
comment on column public.schedules.attendee_member_ids is 'Explicit member UUID selections, independent of legacy attendee_names. No name inference.';
comment on column public.messages.mentioned_member_ids is 'Explicit mention UUID selections. Text alone never determines notification recipients.';
comment on table public.team_notifications is 'In-app RPC polling only, not Realtime. Server-derived recipients; shared inbox/read state for explicitly linked human browsers.';

notify pgrst, 'reload schema';
commit;
