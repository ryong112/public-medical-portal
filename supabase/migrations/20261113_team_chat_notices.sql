-- One shared chat notice. Visibility belongs to the current stable member ID,
-- not to a browser-supplied identity; approved non-member profiles use auth.uid().
-- Install after 20261113_team_identity_notifications.sql. No existing messages
-- are copied, rewritten, automatically published, or used to send new alerts.
begin;

create table if not exists public.chat_notices (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.messages(id) on delete cascade,
  active boolean not null default true,
  created_by_principal text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_member_id uuid references public.team_members(id) on delete restrict,
  author_name text not null,
  created_at timestamptz not null default now(),
  constraint chat_notices_principal_check check (created_by_principal ~ '^(member|user):[0-9a-f-]{36}$')
);
create unique index if not exists chat_notices_one_active_idx
  on public.chat_notices ((1)) where active;
create index if not exists chat_notices_message_idx on public.chat_notices(message_id);

create table if not exists public.chat_notice_preferences (
  notice_id uuid not null references public.chat_notices(id) on delete cascade,
  principal text not null,
  collapsed boolean not null default false,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(notice_id, principal),
  constraint chat_notice_preferences_principal_check check (principal ~ '^(member|user):[0-9a-f-]{36}$')
);

alter table public.chat_notices enable row level security;
alter table public.chat_notice_preferences enable row level security;
revoke all on table public.chat_notices, public.chat_notice_preferences from public, anon, authenticated;

create or replace function public.team_chat_notice_principal()
returns text language plpgsql stable security definer set search_path = '' as $$
declare member_id uuid;
begin
  if auth.uid() is null or not public.is_device_approved() then
    raise exception 'Approved device access is required';
  end if;
  member_id := public.current_team_member_id();
  return case when member_id is not null then 'member:' || member_id::text
    else 'user:' || auth.uid()::text end;
end;
$$;

create or replace function public.get_team_chat_notice_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer text := public.team_chat_notice_principal();
  result jsonb;
begin
  select jsonb_build_object(
    'notice', jsonb_build_object('id', notice.id, 'message_id', notice.message_id,
      'content', coalesce(message.content, ''), 'author_name', notice.author_name, 'created_at', notice.created_at,
      'can_remove', notice.created_by_principal = viewer or public.is_device_admin()),
    'collapsed', coalesce(preference.collapsed, false),
    'hidden', coalesce(preference.hidden, false)) into result
  from public.chat_notices as notice
  join public.messages as message on message.id = notice.message_id
  left join public.chat_notice_preferences as preference on preference.notice_id = notice.id and preference.principal = viewer
  where notice.active;
  return coalesce(result, jsonb_build_object('notice', null, 'collapsed', false, 'hidden', false));
end;
$$;

create or replace function public.publish_team_chat_notice(p_message_id bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor text := public.team_chat_notice_principal();
  actor_member_id uuid := public.current_team_member_id();
  actor_name text;
  message_content text;
  current_notice public.chat_notices%rowtype;
  result uuid;
begin
  if p_message_id is null then raise exception 'Choose a message to publish'; end if;
  -- Shared mutations serialize, so concurrent publishers cannot create two active
  -- rows, and an older tab can never remove a newer replacement accidentally.
  perform pg_catalog.pg_advisory_xact_lock(210413, 1);
  select content into message_content from public.messages where id = p_message_id for key share;
  if not found then raise exception 'The selected message no longer exists'; end if;
  if nullif(trim(coalesce(message_content, '')), '') is null then
    raise exception 'Choose a non-empty message to publish';
  end if;
  select * into current_notice from public.chat_notices where active for update;
  if found and current_notice.message_id = p_message_id then return current_notice.id; end if;
  select coalesce(member.display_name, public.team_display_name_from_device(access.device_name)) into actor_name
  from public.device_access as access
  left join public.team_members as member on member.id = actor_member_id
  where access.user_id = auth.uid() and access.status = 'approved';
  update public.chat_notices set active = false where active;
  insert into public.chat_notices(message_id, created_by_principal, created_by_user_id, created_by_member_id, author_name)
  values(p_message_id, actor, auth.uid(), actor_member_id, coalesce(actor_name, '승인 사용자')) returning id into result;
  return result;
end;
$$;

create or replace function public.set_team_chat_notice_preference(p_notice_id uuid, p_collapsed boolean, p_hidden boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer text := public.team_chat_notice_principal();
begin
  if p_notice_id is null or p_collapsed is null or p_hidden is null then
    raise exception 'Notice ID and explicit display preferences are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(210413, 1);
  if not exists (select 1 from public.chat_notices where id = p_notice_id and active) then
    raise exception 'The notice is no longer active';
  end if;
  insert into public.chat_notice_preferences(notice_id, principal, collapsed, hidden)
  values(p_notice_id, viewer, p_collapsed, p_hidden)
  on conflict(notice_id, principal) do update set collapsed = excluded.collapsed, hidden = excluded.hidden, updated_at = now();
end;
$$;

create or replace function public.remove_team_chat_notice(p_notice_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor text := public.team_chat_notice_principal();
  current_notice public.chat_notices%rowtype;
begin
  if p_notice_id is null then raise exception 'Choose the notice to remove'; end if;
  perform pg_catalog.pg_advisory_xact_lock(210413, 1);
  select * into current_notice from public.chat_notices where id = p_notice_id and active for update;
  if not found then return; end if;
  if current_notice.created_by_principal <> actor and not public.is_device_admin() then
    raise exception 'Only the notice publisher or an administrator can end the shared notice';
  end if;
  update public.chat_notices set active = false where id = p_notice_id and active;
end;
$$;

revoke all on function public.team_chat_notice_principal() from public, anon, authenticated;
revoke all on function public.get_team_chat_notice_state() from public, anon, authenticated;
revoke all on function public.publish_team_chat_notice(bigint) from public, anon, authenticated;
revoke all on function public.set_team_chat_notice_preference(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function public.remove_team_chat_notice(uuid) from public, anon, authenticated;
grant execute on function public.get_team_chat_notice_state() to authenticated;
grant execute on function public.publish_team_chat_notice(bigint) to authenticated;
grant execute on function public.set_team_chat_notice_preference(uuid, boolean, boolean) to authenticated;
grant execute on function public.remove_team_chat_notice(uuid) to authenticated;

comment on table public.chat_notices is 'One shared active chat notice references the original message; no message/content duplication or notification fan-out.';
comment on table public.chat_notice_preferences is 'Private per-notice display state. Canonical team-member ID shares explicitly linked human browsers; approved non-members use their auth ID.';
notify pgrst, 'reload schema';
commit;
