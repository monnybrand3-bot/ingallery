alter table public.gallery_images
  add column if not exists medium_path text,
  add column if not exists large_path text,
  add column if not exists medium_size bigint not null default 0,
  add column if not exists large_size bigint not null default 0,
  add column if not exists medium_width integer not null default 0,
  add column if not exists medium_height integer not null default 0,
  add column if not exists large_width integer not null default 0,
  add column if not exists large_height integer not null default 0,
  add column if not exists processing_status text not null default 'ready',
  add column if not exists processing_started_at timestamptz;

alter table public.galleries
  add column if not exists cover_preview_path text,
  add column if not exists cover_preview_size bigint not null default 0,
  add column if not exists cover_preview_width integer not null default 0,
  add column if not exists cover_preview_height integer not null default 0,
  add column if not exists cover_processing_status text not null default 'ready',
  add column if not exists cover_processing_started_at timestamptz;

alter table public.galleries
  drop constraint if exists galleries_cover_processing_status_check;

alter table public.galleries
  add constraint galleries_cover_processing_status_check
  check (cover_processing_status in ('queued', 'processing', 'ready', 'failed'));

alter table public.gallery_images
  drop constraint if exists gallery_images_processing_status_check;

alter table public.gallery_images
  add constraint gallery_images_processing_status_check
  check (processing_status in ('queued', 'processing', 'ready', 'failed'));

update public.gallery_images
set processing_status = 'queued'
where processing_status = 'ready'
  and (preview_path is null or medium_path is null or large_path is null);

update public.galleries as gallery
set cover_preview_path = image.preview_path,
    cover_preview_size = image.preview_size,
    cover_preview_width = image.preview_width,
    cover_preview_height = image.preview_height,
    cover_processing_status = 'ready'
from public.gallery_images as image
where gallery.cover_path = image.storage_path
  and image.processing_status = 'ready'
  and image.preview_path is not null;

update public.galleries
set cover_processing_status = 'queued'
where cover_path is not null
  and cover_preview_path is null
  and cover_processing_status = 'ready';

create index if not exists gallery_images_processing_status_idx
  on public.gallery_images (processing_status, processing_started_at)
  where processing_status in ('queued', 'processing');
create index if not exists gallery_images_gallery_created_id_idx
  on public.gallery_images (gallery_id, created_at, id);
create index if not exists galleries_cover_processing_status_idx
  on public.galleries (cover_processing_status, cover_processing_started_at)
  where cover_processing_status in ('queued', 'processing');

create or replace function public.reserve_tenant_storage(p_tenant_id uuid, p_file_size_bytes bigint)
returns jsonb
language plpgsql
as $$
declare
  current_used bigint := 0;
  current_reserved bigint := 0;
  effective_limit bigint := 0;
  remaining bigint := 0;
begin
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid file size');
  end if;

  insert into public.tenant_storage(tenant_id, used_bytes, reserved_bytes, extra_bytes, updated_at)
  values (p_tenant_id, 0, 0, 0, now())
  on conflict (tenant_id) do nothing;

  select coalesce(used_bytes, 0), coalesce(reserved_bytes, 0)
    into current_used, current_reserved
  from public.tenant_storage
  where tenant_id = p_tenant_id
  for update;

  effective_limit := public.get_effective_tenant_storage_limit(p_tenant_id);
  remaining := effective_limit - current_used - current_reserved;
  if p_file_size_bytes > remaining then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Storage limit exceeded',
      'available_bytes', remaining,
      'effective_limit_bytes', effective_limit,
      'used_bytes', current_used,
      'reserved_bytes', current_reserved
    );
  end if;

  update public.tenant_storage
    set reserved_bytes = reserved_bytes + p_file_size_bytes,
        updated_at = now()
  where tenant_id = p_tenant_id;

  return jsonb_build_object(
    'ok', true,
    'reserved_bytes', p_file_size_bytes,
    'remaining_bytes', effective_limit - (current_used + current_reserved + p_file_size_bytes),
    'effective_limit_bytes', effective_limit
  );
end;
$$;

create or replace function public.finalize_tenant_storage_reservation(p_tenant_id uuid, p_file_size_bytes bigint)
returns jsonb
language plpgsql
as $$
begin
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid reservation size');
  end if;

  update public.tenant_storage
    set used_bytes = used_bytes + p_file_size_bytes,
        reserved_bytes = reserved_bytes - p_file_size_bytes,
        updated_at = now()
  where tenant_id = p_tenant_id
    and reserved_bytes >= p_file_size_bytes;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Tenant storage reservation not found');
  end if;
  return jsonb_build_object('ok', true, 'used_bytes', p_file_size_bytes);
end;
$$;

create or replace function public.remove_tenant_storage_usage(p_tenant_id uuid, p_file_size_bytes bigint)
returns jsonb
language plpgsql
as $$
begin
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid removal size');
  end if;

  update public.tenant_storage
    set used_bytes = greatest(0, used_bytes - p_file_size_bytes),
        updated_at = now()
  where tenant_id = p_tenant_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Tenant storage record not found');
  end if;
  return jsonb_build_object('ok', true, 'removed_bytes', p_file_size_bytes);
end;
$$;

revoke execute on function public.reserve_tenant_storage(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.release_tenant_storage(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.finalize_tenant_storage_reservation(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.remove_tenant_storage_usage(uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_tenant_storage(uuid, bigint) to service_role;
grant execute on function public.release_tenant_storage(uuid, bigint) to service_role;
grant execute on function public.finalize_tenant_storage_reservation(uuid, bigint) to service_role;
grant execute on function public.remove_tenant_storage_usage(uuid, bigint) to service_role;
