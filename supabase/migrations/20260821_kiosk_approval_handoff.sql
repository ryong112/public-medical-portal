-- One-time approval handoff from an already-approved browser profile to the
-- dedicated kiosk browser profile. Pair requests expire quickly, are single-use,
-- and can only be approved by a currently approved device.

create table if not exists public.kiosk_pair_requests (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  approved_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

create index if not exists kiosk_pair_requests_target_idx
  on public.kiosk_pair_requests (target_user_id, created_at desc);

alter table public.kiosk_pair_requests enable row level security;
revoke all on table public.kiosk_pair_requests from public, anon, authenticated;

create or replace function public.create_kiosk_pair_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  current_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select access.status into current_status
  from public.device_access as access
  where access.user_id = auth.uid();

  if current_status = 'blocked' then
    raise exception 'This kiosk profile is blocked';
  end if;
  if current_status = 'approved' then
    return jsonb_build_object('status', 'approved');
  end if;

  delete from public.kiosk_pair_requests
  where target_user_id = auth.uid()
    and used_at is null;

  insert into public.kiosk_pair_requests (target_user_id)
  values (auth.uid())
  returning id into request_id;

  return jsonb_build_object(
    'status', 'pending',
    'request_id', request_id,
    'expires_at', now() + interval '5 minutes'
  );
end;
$$;

create or replace function public.approve_kiosk_pair(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair_request public.kiosk_pair_requests%rowtype;
  source_name text;
  target_status text;
  kiosk_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if not public.is_device_approved() then
    raise exception 'An approved device is required';
  end if;

  select request.* into pair_request
  from public.kiosk_pair_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Kiosk pairing request was not found';
  end if;
  if pair_request.used_at is not null then
    raise exception 'Kiosk pairing request was already used';
  end if;
  if pair_request.expires_at <= now() then
    raise exception 'Kiosk pairing request expired';
  end if;

  select access.device_name into source_name
  from public.device_access as access
  where access.user_id = auth.uid()
    and access.status = 'approved';

  select access.status into target_status
  from public.device_access as access
  where access.user_id = pair_request.target_user_id;

  if target_status = 'blocked' then
    raise exception 'The target kiosk profile is blocked';
  end if;

  kiosk_name := left(coalesce(source_name, '승인 기기') || ' · 전광판', 80);

  insert into public.device_access (
    user_id,
    device_name,
    status,
    is_admin,
    requested_at,
    approved_at,
    last_seen_at,
    updated_at
  )
  values (
    pair_request.target_user_id,
    kiosk_name,
    'approved',
    false,
    now(),
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update
  set device_name = excluded.device_name,
      status = 'approved',
      is_admin = false,
      approved_at = now(),
      last_seen_at = now(),
      updated_at = now();

  update public.kiosk_pair_requests
  set approved_by = auth.uid(),
      used_at = now()
  where id = pair_request.id;

  return jsonb_build_object(
    'status', 'approved',
    'target_user_id', pair_request.target_user_id,
    'device_name', kiosk_name
  );
end;
$$;

revoke all on function public.create_kiosk_pair_request() from public;
revoke all on function public.approve_kiosk_pair(uuid) from public;
grant execute on function public.create_kiosk_pair_request() to authenticated;
grant execute on function public.approve_kiosk_pair(uuid) to authenticated;

notify pgrst, 'reload schema';
