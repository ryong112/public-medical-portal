-- Optional team details. Existing approved-device RLS policies remain unchanged.
-- Run this file once before deploying the corresponding portal UI.
begin;

alter table public.schedules
  add column if not exists owner_name text,
  add column if not exists attendee_names text[] not null default '{}',
  add column if not exists location text,
  add column if not exists linked_file_ids bigint[] not null default '{}';

create or replace function public.validate_schedule_team_details()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.owner_name := nullif(trim(new.owner_name), '');
  new.location := nullif(trim(new.location), '');
  new.attendee_names := coalesce(new.attendee_names, '{}'::text[]);
  new.linked_file_ids := coalesce(new.linked_file_ids, '{}'::bigint[]);
  if char_length(coalesce(new.owner_name, '')) > 100 or char_length(coalesce(new.location, '')) > 200 then
    raise exception '담당자는 100자, 장소는 200자 이내로 입력해 주세요.';
  end if;
  if cardinality(new.attendee_names) > 50 or exists (
    select 1 from unnest(new.attendee_names) as name where name is null or char_length(trim(name)) = 0 or char_length(name) > 100
  ) then
    raise exception '참석자는 50명 이내, 이름은 100자 이내로 입력해 주세요.';
  end if;
  if cardinality(new.linked_file_ids) > 50 then
    raise exception '관련 문서는 50개까지 연결할 수 있습니다.';
  end if;
  if tg_op = 'INSERT' or new.linked_file_ids is distinct from old.linked_file_ids then
    -- Foreign-link integrity, not a schedule editing lock. Keep linked documents
    -- alive until this transaction commits so a simultaneous delete can clean up.
    perform id from public.files where id = any(new.linked_file_ids) order by id for key share;
    if exists (select 1 from unnest(new.linked_file_ids) as file_id where file_id is null
      or not exists (select 1 from public.files f where f.id = file_id)) then
      raise exception '연결할 문서를 찾지 못했습니다. 문서 목록을 새로 확인해 주세요.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_schedule_team_details on public.schedules;
create trigger validate_schedule_team_details before insert or update on public.schedules
for each row execute function public.validate_schedule_team_details();

create or replace function public.unlink_deleted_schedule_document()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- A multi-file delete fires AFTER triggers after all affected files are gone.
  -- Remove every missing link at once, otherwise validation can reject the
  -- remaining link to another file deleted by the same statement.
  update public.schedules as schedule
    set linked_file_ids = array(
      select file_id from unnest(schedule.linked_file_ids) as file_id
      where exists (select 1 from public.files as file where file.id = file_id)
    )
    where schedule.linked_file_ids @> array[old.id::bigint];
  return old;
end;
$$;

drop trigger if exists unlink_deleted_schedule_document on public.files;
create trigger unlink_deleted_schedule_document after delete on public.files
for each row execute function public.unlink_deleted_schedule_document();

create index if not exists schedules_linked_file_ids_idx on public.schedules using gin (linked_file_ids);

-- Idempotent upload finalization. A retry after a lost response waits for the
-- original transaction and reuses its row rather than adding a duplicate.
create or replace function public.register_uploaded_document(p_name text, p_url text, p_size bigint, p_category text)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  existing_id bigint;
begin
  if not public.is_device_approved() then
    raise exception '승인된 기기에서만 문서를 등록할 수 있습니다.';
  end if;
  if nullif(trim(p_name), '') is null or char_length(p_name) > 255
    or p_url is null or p_url !~ '^https://' or char_length(p_url) > 2048
    or p_size is null or p_size < 0 then
    raise exception '문서 이름·주소·크기를 확인해 주세요.';
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

comment on column public.schedules.owner_name is '선택 입력 담당자 이름. 로그인 또는 접근 권한이 아님';
comment on column public.schedules.attendee_names is '선택 입력 참석자 이름 목록';
comment on column public.schedules.linked_file_ids is '공유 문서함 문서 ID 연결. 실제 문서 복사 없음';

notify pgrst, 'reload schema';
commit;
