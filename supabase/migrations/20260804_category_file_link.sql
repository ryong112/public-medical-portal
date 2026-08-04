-- Keep document rows connected when a visible category name is changed.
create or replace function public.rename_category_with_files(
  p_old_name text,
  p_new_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_old_name text := trim(coalesce(p_old_name, ''));
  clean_new_name text := left(trim(coalesce(p_new_name, '')), 200);
begin
  if not public.is_device_approved() then
    raise exception 'Approved device access is required';
  end if;
  if clean_old_name = '' or clean_new_name = '' then
    raise exception 'Category name is required';
  end if;
  if clean_old_name = clean_new_name then
    return;
  end if;
  if exists (select 1 from public.categories where name = clean_new_name) then
    raise exception 'A category with the same name already exists';
  end if;

  update public.files
  set category = clean_new_name
  where category = clean_old_name;

  update public.categories
  set name = clean_new_name
  where name = clean_old_name;

  if not found then
    raise exception 'Category was not found';
  end if;
end;
$$;

revoke all on function public.rename_category_with_files(text, text) from public;
grant execute on function public.rename_category_with_files(text, text) to authenticated;

-- Repair existing rows whose category only differs by a trailing recurrence formula
-- or a leading year label. Ambiguous matches are intentionally skipped.
with category_matches as (
  select
    file_row.id as file_id,
    min(category_row.name) as category_name
  from public.files as file_row
  join public.categories as category_row
    on lower(trim(regexp_replace(regexp_replace(file_row.category, '\s*\([^)]*\)\s*$', ''), '^\s*[0-9]{2,4}년(도)?\s*', '')))
     = lower(trim(regexp_replace(regexp_replace(category_row.name, '\s*\([^)]*\)\s*$', ''), '^\s*[0-9]{2,4}년(도)?\s*', '')))
  where file_row.category <> category_row.name
  group by file_row.id
  having count(*) = 1
)
update public.files as file_row
set category = category_matches.category_name
from category_matches
where file_row.id = category_matches.file_id;

notify pgrst, 'reload schema';
