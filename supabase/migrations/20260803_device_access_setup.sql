create table if not exists public.device_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_name text not null,
  status text not null default 'pending',
  is_admin boolean not null default false,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_access_name_check check (char_length(device_name) between 2 and 80),
  constraint device_access_status_check check (status in ('pending', 'approved', 'blocked')),
  constraint device_access_admin_check check (not is_admin or status = 'approved')
);

alter table public.device_access enable row level security;

revoke all on table public.device_access from public, anon, authenticated;

create or replace function public.is_device_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.device_access
    where user_id = auth.uid()
      and status = 'approved'
  );
$$;

create or replace function public.is_device_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.device_access
    where user_id = auth.uid()
      and status = 'approved'
      and is_admin = true
  );
$$;

create or replace function public.get_device_access_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  access_record public.device_access%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select * into access_record
  from public.device_access
  where user_id = auth.uid();

  if not found then
    return jsonb_build_object(
      'status', 'unregistered',
      'user_id', auth.uid(),
      'is_admin', false
    );
  end if;

  update public.device_access
  set last_seen_at = now(), updated_at = now()
  where user_id = auth.uid();

  return jsonb_build_object(
    'status', access_record.status,
    'user_id', access_record.user_id,
    'device_name', access_record.device_name,
    'is_admin', access_record.is_admin,
    'requested_at', access_record.requested_at,
    'approved_at', access_record.approved_at
  );
end;
$$;

create or replace function public.request_device_access(p_device_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := left(trim(coalesce(p_device_name, '')), 80);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if char_length(clean_name) < 2 then
    raise exception 'Device name is too short';
  end if;

  insert into public.device_access (user_id, device_name)
  values (auth.uid(), clean_name)
  on conflict (user_id) do update
  set device_name = excluded.device_name,
      last_seen_at = now(),
      updated_at = now();

  return public.get_device_access_status();
end;
$$;

create or replace function public.list_device_access()
returns table (
  user_id uuid,
  device_name text,
  status text,
  is_admin boolean,
  requested_at timestamptz,
  approved_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_device_admin() then
    raise exception 'Administrator access is required';
  end if;

  return query
  select
    access.user_id,
    access.device_name,
    access.status,
    access.is_admin,
    access.requested_at,
    access.approved_at,
    access.last_seen_at
  from public.device_access as access
  order by
    case access.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    access.requested_at desc;
end;
$$;

create or replace function public.set_device_access(
  p_user_id uuid,
  p_status text,
  p_is_admin boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.device_access%rowtype;
  next_is_admin boolean;
  approved_admin_count integer;
begin
  if not public.is_device_admin() then
    raise exception 'Administrator access is required';
  end if;
  if p_status not in ('pending', 'approved', 'blocked') then
    raise exception 'Invalid device status';
  end if;

  select * into target
  from public.device_access
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Device was not found';
  end if;

  next_is_admin := case
    when p_status <> 'approved' then false
    when p_is_admin is null then target.is_admin
    else p_is_admin
  end;

  if target.is_admin and not next_is_admin then
    select count(*) into approved_admin_count
    from public.device_access
    where status = 'approved' and is_admin = true;

    if approved_admin_count <= 1 then
      raise exception 'The last administrator cannot be removed';
    end if;
  end if;

  update public.device_access
  set status = p_status,
      is_admin = next_is_admin,
      approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else null end,
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

revoke all on function public.is_device_approved() from public;
revoke all on function public.is_device_admin() from public;
revoke all on function public.get_device_access_status() from public;
revoke all on function public.request_device_access(text) from public;
revoke all on function public.list_device_access() from public;
revoke all on function public.set_device_access(uuid, text, boolean) from public;

grant execute on function public.is_device_approved() to authenticated;
grant execute on function public.is_device_admin() to authenticated;
grant execute on function public.get_device_access_status() to authenticated;
grant execute on function public.request_device_access(text) to authenticated;
grant execute on function public.list_device_access() to authenticated;
grant execute on function public.set_device_access(uuid, text, boolean) to authenticated;

comment on table public.device_access is '회원가입 없이 브라우저 기기별로 관리하는 대시보드 접근 승인 목록';

notify pgrst, 'reload schema';
