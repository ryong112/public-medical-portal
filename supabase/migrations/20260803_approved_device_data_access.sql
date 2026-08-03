-- Run this only after the first device has been approved and made an administrator.
-- Approved devices share the same dashboard data; unapproved anonymous sessions are denied.

do $$
declare
  table_name text;
begin
  foreach table_name in array array['messages', 'files', 'categories', 'schedules']
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise notice 'Skipping missing table public.%', table_name;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);

    execute format('drop policy if exists %I on public.%I', 'approved_devices_share_data', table_name);
    execute format('drop policy if exists %I on public.%I', 'device_approval_required', table_name);

    execute format(
      'create policy %I on public.%I as permissive for all to authenticated using (public.is_device_approved()) with check (public.is_device_approved())',
      'approved_devices_share_data',
      table_name
    );

    -- Existing authenticated policies are OR-combined by default. This restrictive policy
    -- ensures they can never bypass the approved-device check.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_device_approved()) with check (public.is_device_approved())',
      'device_approval_required',
      table_name
    );
  end loop;
end;
$$;

-- Supabase Storage upload/update/delete access for the existing `files` bucket.
-- The bucket remains public during this compatibility stage so existing stored URLs keep working.
revoke all on table storage.objects from anon;
grant select, insert, update, delete on table storage.objects to authenticated;

drop policy if exists "approved_devices_manage_files" on storage.objects;
drop policy if exists "device_approval_required_for_files" on storage.objects;

create policy "approved_devices_manage_files"
on storage.objects
as permissive
for all
to authenticated
using (bucket_id = 'files' and public.is_device_approved())
with check (bucket_id = 'files' and public.is_device_approved());

create policy "device_approval_required_for_files"
on storage.objects
as restrictive
for all
to authenticated
using (bucket_id <> 'files' or public.is_device_approved())
with check (bucket_id <> 'files' or public.is_device_approved());

notify pgrst, 'reload schema';
