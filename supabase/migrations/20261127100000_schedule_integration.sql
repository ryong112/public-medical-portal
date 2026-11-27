-- An opt-in calendar machine credential, independent of browser access.
-- Applies after 20261125093000_important_schedule_sharing.sql.
begin;

create table if not exists public.schedule_integration_credentials (
  integration text primary key check (integration = 'dot-calendar-v1'),
  token_digest bytea not null check (octet_length(token_digest) = 32),
  enabled boolean not null default false,
  allow_read boolean not null default false,
  expires_at timestamptz not null
);

create table if not exists public.schedule_integration_requests (
  request_key text primary key,
  payload_digest bytea not null,
  schedule_id bigint not null,
  recorded_at timestamptz not null default now()
);

alter table public.schedule_integration_credentials enable row level security;
alter table public.schedule_integration_requests enable row level security;
revoke all on public.schedule_integration_credentials, public.schedule_integration_requests from public, anon, authenticated;

-- Only a high-entropy 32-byte hex secret qualifies. No browser-visible key,
-- public identifier, device-name match, or service-role credential is used.
create or replace function public.require_schedule_integration(p_read boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied text := (nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-portal-schedule-token');
begin
  if supplied is null or octet_length(supplied) <> 64 or supplied !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1 from public.schedule_integration_credentials as c
       where c.integration = 'dot-calendar-v1' and c.enabled and c.expires_at > now()
         and (not p_read or c.allow_read)
         and c.token_digest = sha256(convert_to(supplied, 'UTF8'))
     ) then
    raise exception 'Calendar integration authentication failed' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.integration_list_schedules(p_from date, p_through date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  perform public.require_schedule_integration(true);
  if p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through)
     or p_through < p_from or p_through - p_from > 13 then
    raise exception 'A calendar window of at most 14 days is required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by date, start_time nulls last, id), '[]'::jsonb)
  into result
  from (
    select id, title, date, end_date, start_time, end_time
    from public.schedules
    where date <= p_through and coalesce(end_date, date) >= p_from
      and recurrence_status is distinct from 'cancelled'
      and not coalesce(is_todo, false)
    order by date, start_time nulls last, id
    limit 201
  ) as s;
  if jsonb_array_length(result) > 200 then
    raise exception 'Calendar window has too many entries; narrow the dates' using errcode = '22023';
  end if;
  return result;
end;
$$;

create or replace function public.integration_create_schedule(
  p_request_key text, p_title text, p_date date, p_end_date date default null,
  p_start_time time default null, p_end_time time default null, p_location text default null,
  p_kind text default 'unclassified'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_title text := btrim(p_title);
  clean_location text := nullif(btrim(p_location), '');
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
  normalized_end_date date := nullif(p_end_date, p_date);
  fingerprint bytea;
  previous public.schedule_integration_requests%rowtype;
  candidate public.schedules%rowtype;
  new_id bigint;
begin
  perform public.require_schedule_integration(false);
  if p_request_key is null or octet_length(p_request_key) not between 8 and 180
     or p_request_key !~ '^[A-Za-z0-9_.:-]+$'
     or clean_title is null or char_length(clean_title) not between 1 and 160
     or clean_title ~ '[[:cntrl:]]'
     or char_length(clean_location) > 160 or clean_location ~ '[[:cntrl:]]'
     or p_date is null or not isfinite(p_date)
     or (p_end_date is not null and (not isfinite(p_end_date) or p_end_date < p_date))
     or p_kind is null or p_kind not in ('unclassified', 'internal', 'meeting', 'business_trip')
     or p_start_time = time '24:00' or p_end_time = time '24:00'
     or (p_end_time is not null and (p_start_time is null or (normalized_end_date is null and p_end_time <= p_start_time))) then
    raise exception 'Invalid calendar entry' using errcode = '22023';
  end if;
  if normalized_end_date - p_date > 30 then
    raise exception 'Calendar entry lasts too many days' using errcode = '22023';
  end if;
  fingerprint := sha256(convert_to(jsonb_build_array(
    clean_title, p_date, normalized_end_date, p_start_time, p_end_time, clean_location, p_kind
  )::text, 'UTF8'));
  -- Scope serialized writes to this low-volume integration, not human actions.
  perform pg_advisory_xact_lock(140781002, 1);
  select * into previous from public.schedule_integration_requests where request_key = p_request_key;
  if found then
    if previous.payload_digest <> fingerprint then
      raise exception 'Request key was used for different calendar data' using errcode = '23505';
    end if;
    if not exists (select 1 from public.schedules where id = previous.schedule_id
                   and recurrence_status is distinct from 'cancelled') then
      return jsonb_build_object('status', 'removed', 'id', previous.schedule_id);
    end if;
    return jsonb_build_object('status', 'existing', 'id', previous.schedule_id);
  end if;
  if p_date < today_kst or coalesce(normalized_end_date, p_date) > today_kst + 366 then
    raise exception 'New entries must be within the next year in Korea time' using errcode = '22023';
  end if;
  select * into candidate from public.schedules
  where date = p_date and lower(regexp_replace(btrim(title), '[[:space:]]+', ' ', 'g'))
                       = lower(regexp_replace(clean_title, '[[:space:]]+', ' ', 'g'))
    and recurrence_status is distinct from 'cancelled' and not coalesce(is_todo, false)
  order by id limit 1;
  if found then
    if nullif(candidate.end_date, p_date) is distinct from normalized_end_date
       or candidate.start_time is distinct from p_start_time
       or candidate.end_time is distinct from p_end_time
       or nullif(btrim(candidate.location), '') is distinct from clean_location then
      return jsonb_build_object('status', 'possible_duplicate', 'id', candidate.id);
    end if;
    insert into public.schedule_integration_requests(request_key, payload_digest, schedule_id)
      values (p_request_key, fingerprint, candidate.id);
    return jsonb_build_object('status', 'existing', 'id', candidate.id);
  end if;

  insert into public.schedules
    (title, date, end_date, start_time, end_time, location, schedule_type, is_notice, is_todo,
     is_urgent, is_completed)
  values
    (clean_title, p_date, normalized_end_date, p_start_time, p_end_time, clean_location, p_kind,
     false, false, false, false)
  returning id into new_id;
  insert into public.schedule_integration_requests(request_key, payload_digest, schedule_id)
    values (p_request_key, fingerprint, new_id);
  return jsonb_build_object('status', 'created', 'id', new_id);
end;
$$;

revoke all on function public.require_schedule_integration(boolean) from public, anon, authenticated;
revoke all on function public.integration_list_schedules(date, date) from public, anon, authenticated;
revoke all on function public.integration_create_schedule(text, text, date, date, time, time, text, text) from public, anon, authenticated;
grant execute on function public.integration_list_schedules(date, date) to anon;
grant execute on function public.integration_create_schedule(text, text, date, date, time, time, text, text) to anon;

notify pgrst, 'reload schema';
commit;
