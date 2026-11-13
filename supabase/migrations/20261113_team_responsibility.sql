-- Optional responsibility labels only. These IDs do not change shared access,
-- notify members, or turn document/schedule records into privately owned data.
-- Install after 20261113_team_identity_notifications.sql. Existing records stay
-- unassigned, including legacy free-text schedule owner names.
begin;

alter table public.schedules
  add column if not exists owner_member_id uuid references public.team_members(id) on delete restrict;
alter table public.files
  add column if not exists owner_member_id uuid references public.team_members(id) on delete restrict;

create index if not exists schedules_owner_member_id_idx on public.schedules(owner_member_id)
  where owner_member_id is not null;
create index if not exists files_owner_member_id_idx on public.files(owner_member_id)
  where owner_member_id is not null;

create or replace function public.validate_team_responsibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous_owner uuid;
begin
  if tg_op = 'UPDATE' then previous_owner := old.owner_member_id; end if;
  -- Retain inactive historical references when editing another field. A new
  -- assignment must point to an active human member, not an admin or kiosk.
  if new.owner_member_id is not null and new.owner_member_id is distinct from previous_owner then
    if not public.team_member_is_active(new.owner_member_id) then
      raise exception 'The selected responsible team member is no longer active';
    end if;
    if tg_table_name = 'schedules' then
      -- Keep compatibility text only when a person is explicitly assigned.
      -- Unrelated saves must not rewrite historical/free-text owner names.
      select display_name into new.owner_name
      from public.team_members where id = new.owner_member_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_schedule_responsibility on public.schedules;
create trigger validate_schedule_responsibility before insert or update on public.schedules
for each row execute function public.validate_team_responsibility();
drop trigger if exists validate_document_responsibility on public.files;
create trigger validate_document_responsibility before insert or update on public.files
for each row execute function public.validate_team_responsibility();

create or replace function public.team_responsibility_available()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_device_approved() then raise exception 'Approved device access is required'; end if;
  return true;
end;
$$;

revoke all on function public.validate_team_responsibility() from public, anon, authenticated;
revoke all on function public.team_responsibility_available() from public, anon, authenticated;
grant execute on function public.team_responsibility_available() to authenticated;

comment on column public.schedules.owner_member_id is 'Optional responsible human team ID. No assignment by name inference, access change, or automatic notification.';
comment on column public.files.owner_member_id is 'Optional document contact team ID. Shared approved-device access is unchanged.';

notify pgrst, 'reload schema';
commit;
