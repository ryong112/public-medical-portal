-- Approved human administrators also participate under stable team member IDs.
-- This does NOT grant administrator access: that remains device_access.is_admin.
-- Install after team identity, responsibility and chat notice migrations.
begin;

create or replace function public.current_team_member_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select device.member_id
  from public.team_member_devices as device
  join public.device_access as access on access.user_id = device.user_id
  where device.user_id = auth.uid() and not device.is_kiosk
    and access.status = 'approved';
$$;

create or replace function public.team_member_is_active(p_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.team_member_devices as device
    join public.device_access as access on access.user_id = device.user_id
    where device.member_id = p_member_id and not device.is_kiosk
      and access.status = 'approved'
  );
$$;

create or replace function public.preserve_team_chat_notice_identity(p_user_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old_principal text := 'user:' || p_user_id::text;
  member_principal text := 'member:' || p_member_id::text;
begin
  if p_user_id is null or p_member_id is null then return; end if;
  -- Use the same lock as notice publishing/preferences so a previously approved
  -- administrator cannot lose a saved setting while gaining their member ID.
  perform pg_catalog.pg_advisory_xact_lock(210413, 1);
  insert into public.chat_notice_preferences(notice_id, principal, collapsed, hidden, updated_at)
  select notice_id, member_principal, collapsed, hidden, updated_at
  from public.chat_notice_preferences where principal = old_principal
  on conflict (notice_id, principal) do nothing;
  -- Keep the old user-scoped rows for history. Never overwrite an existing
  -- member-scoped preference and never guess a second person's identity.
  update public.chat_notices set created_by_principal = member_principal,
    created_by_member_id = p_member_id
  where created_by_user_id = p_user_id and created_by_principal = old_principal;
end;
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
  select * into access_record from public.device_access where user_id = p_user_id for update;
  if not found or access_record.status <> 'approved' then return; end if;

  select * into mapping from public.team_member_devices where user_id = p_user_id;
  if found then
    if not mapping.is_kiosk then
      update public.team_members set
        display_name = public.team_display_name_from_device(access_record.device_name), updated_at = now()
      where id = mapping.member_id and name_source_user_id = p_user_id
        and display_name is distinct from public.team_display_name_from_device(access_record.device_name);
      perform public.preserve_team_chat_notice_identity(p_user_id, mapping.member_id);
    end if;
    return;
  end if;

  -- Explicit kiosk markers and used pairing records remain authoritative, even
  -- when a companion profile was later assigned an administrative device role.
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
  perform public.preserve_team_chat_notice_identity(p_user_id, new_member_id);
end;
$$;

create or replace function public.admin_link_team_member_device(p_user_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.device_access%rowtype;
begin
  if not public.is_device_admin() then raise exception 'Administrator access is required'; end if;
  select * into target from public.device_access where user_id = p_user_id for update;
  if not found or target.status <> 'approved' then
    raise exception 'Only an approved human device can be linked';
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
  -- Explicit linking changes future identity/routing only. Old member IDs,
  -- notifications and member-scoped history remain intact, as before.
  perform public.preserve_team_chat_notice_identity(p_user_id, p_member_id);
  update public.team_member_devices set member_id = p_member_id, updated_at = now()
  where is_kiosk and source_user_id = p_user_id;
end;
$$;

-- Existing approved human administrators are enrolled individually. Existing
-- general members and explicit kiosk mappings retain their IDs and handles.
do $$
declare target record;
begin
  for target in
    select access.user_id from public.device_access as access
    where access.status = 'approved' and access.is_admin
      and not exists (select 1 from public.kiosk_pair_requests as request
        where request.target_user_id = access.user_id and request.used_at is not null)
    order by access.requested_at, access.user_id
  loop perform public.provision_team_member_device(target.user_id); end loop;
  for target in
    select access.user_id from public.device_access as access
    where access.status = 'approved' and access.is_admin
      and exists (select 1 from public.kiosk_pair_requests as request
        where request.target_user_id = access.user_id and request.used_at is not null)
    order by access.requested_at, access.user_id
  loop perform public.provision_team_member_device(target.user_id); end loop;
end;
$$;

revoke all on function public.current_team_member_id() from public, anon, authenticated;
revoke all on function public.team_member_is_active(uuid) from public, anon, authenticated;
revoke all on function public.provision_team_member_device(uuid) from public, anon, authenticated;
revoke all on function public.preserve_team_chat_notice_identity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_link_team_member_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.current_team_member_id() to authenticated;
grant execute on function public.admin_link_team_member_device(uuid, uuid) to authenticated;

comment on function public.current_team_member_id() is 'Current approved human browser member UUID, including administrators; explicit kiosk profiles are excluded. Device administrator privileges remain independent.';
comment on function public.preserve_team_chat_notice_identity(uuid, uuid) is 'Private preservation of prior auth-scoped notice settings and authorship when an approved human gains a member ID. Existing member preferences are never overwritten.';
notify pgrst, 'reload schema';
commit;
