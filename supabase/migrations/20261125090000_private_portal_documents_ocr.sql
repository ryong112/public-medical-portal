-- Prerequisite: the team identity migrations have been applied.
-- Change the hosted `files` bucket to private through Storage settings/API,
-- not by editing storage.buckets directly. See PRIVATE_PORTAL_RELEASE.md.
begin;

create or replace function public.is_approved_human_device()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_device_approved()
    and not exists (
      select 1 from public.team_member_devices as device
      where device.user_id = auth.uid() and device.is_kiosk
    )
    and not exists (
      select 1 from public.kiosk_pair_requests as pairing
      where pairing.target_user_id = auth.uid() and pairing.used_at is not null
    );
$$;

revoke all on function public.is_approved_human_device() from public, anon;
-- Public restrictive policies below may be evaluated for anon even if the
-- table privilege check would deny it. The helper returns false for anon.
grant execute on function public.is_approved_human_device() to anon, authenticated;

drop policy if exists human_portal_document_metadata on public.files;
create policy human_portal_document_metadata on public.files
as restrictive for all to public
using ((select public.is_approved_human_device()))
with check ((select public.is_approved_human_device()));

drop policy if exists human_portal_document_objects on storage.objects;
create policy human_portal_document_objects on storage.objects
as restrictive for all to public
using (bucket_id <> 'files' or (select public.is_approved_human_device()))
with check (bucket_id <> 'files' or (select public.is_approved_human_device()));

-- Leave preexisting file IDs and addresses untouched for existing schedule
-- links. A new/replaced reference must refer to a real portal Storage object.
create or replace function public.validate_new_portal_document_reference()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare object_key text;
begin
  if tg_op = 'UPDATE' then
    if new.url is not distinct from old.url then return new; end if;
  end if;
  if not public.is_approved_human_device() then
    raise exception '승인된 팀원 기기에서만 문서를 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if new.url is null or new.url !~ '^storage://files/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,12})?$' then
    raise exception '문서함의 저장 경로를 확인해 주세요.' using errcode = '22023';
  end if;
  object_key := substr(new.url, length('storage://files/') + 1);
  if not exists (select 1 from storage.objects as stored where stored.bucket_id = 'files' and stored.name = object_key) then
    raise exception '파일이 저장되지 않았습니다. 다시 업로드해 주세요.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_new_portal_document_reference() from public, anon, authenticated;
drop trigger if exists validate_new_portal_document_reference on public.files;
create trigger validate_new_portal_document_reference before insert or update of url on public.files
for each row execute function public.validate_new_portal_document_reference();

create or replace function public.register_uploaded_document(p_name text, p_url text, p_size bigint, p_category text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare existing_id bigint;
begin
  if not public.is_approved_human_device() then
    raise exception '승인된 팀원 기기에서만 문서를 등록할 수 있습니다.' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or char_length(p_name) > 255
    or p_url is null or p_url !~ '^storage://files/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,12})?$'
    or p_size is null or p_size < 0 then
    raise exception '문서 이름·저장 경로·크기를 확인해 주세요.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_url, 0));
  select id into existing_id from public.files where url = p_url order by id limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.files (name, url, size, category)
    values (trim(p_name), p_url, p_size, coalesce(nullif(trim(p_category), ''), '일반'))
    returning id into existing_id;
  return existing_id;
end;
$$;
revoke all on function public.register_uploaded_document(text, text, bigint, text) from public, anon;
grant execute on function public.register_uploaded_document(text, text, bigint, text) to authenticated;

create or replace function public.save_whiteboard_corrections(p_corrections jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare saved_count integer := 0;
begin
  if not public.is_approved_human_device() then
    raise exception '승인된 팀원 기기에서만 사진 교정을 저장할 수 있습니다.' using errcode = '42501';
  end if;
  if p_corrections is null or jsonb_typeof(p_corrections) <> 'array' then return 0; end if;
  if jsonb_array_length(p_corrections) > 100 or octet_length(p_corrections::text) > 262144 then
    raise exception '교정 기록은 100개 이하로 나누어 저장해 주세요.' using errcode = '22023';
  end if;

  -- The OCR spelling reference uses only title pairs. Do not retain new raw
  -- transcriptions (which may have names) as shared correction memory.
  insert into public.whiteboard_corrections (source_text, ai_title, corrected_title, ai_schedule_type, corrected_schedule_type)
  select '', pair.ai_title, pair.corrected_title, pair.ai_type, pair.corrected_type
  from (
    select distinct
      left(trim(item->>'ai_title'), 200) as ai_title,
      left(trim(item->>'corrected_title'), 200) as corrected_title,
      case when item->>'ai_schedule_type' in ('meeting', 'business_trip', 'internal', 'leave', 'unclassified')
        then item->>'ai_schedule_type' else 'unclassified' end as ai_type,
      case when item->>'corrected_schedule_type' in ('meeting', 'business_trip', 'internal', 'leave', 'unclassified')
        then item->>'corrected_schedule_type' else 'unclassified' end as corrected_type
    from jsonb_array_elements(p_corrections) as entry(item)
    where jsonb_typeof(item) = 'object'
  ) as pair
  where pair.ai_title <> '' and pair.corrected_title <> ''
    and (pair.ai_title <> pair.corrected_title or pair.ai_type <> pair.corrected_type)
  on conflict (ai_title, corrected_title, ai_schedule_type, corrected_schedule_type)
  do update set source_text = '', occurrence_count = public.whiteboard_corrections.occurrence_count + 1, updated_at = now();

  get diagnostics saved_count = row_count;
  return saved_count;
end;
$$;
revoke all on function public.save_whiteboard_corrections(jsonb) from public, anon, authenticated;
grant execute on function public.save_whiteboard_corrections(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
