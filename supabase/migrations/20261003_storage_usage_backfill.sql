with image_usage as (
  select
    coalesce(
      image.tenant_id,
      gallery.tenant_id,
      profile.tenant_id,
      (select tenant.id from public.tenants as tenant where tenant.owner_id = gallery.owner_id order by tenant.created_at limit 1)
    ) as tenant_id,
    sum(
      coalesce(image.file_size, 0) +
      coalesce(image.preview_size, 0) +
      coalesce(image.medium_size, 0) +
      coalesce(image.large_size, 0)
    ) as used_bytes
  from public.gallery_images as image
  join public.galleries as gallery on gallery.id = image.gallery_id
  left join public.profiles as profile on profile.id = gallery.owner_id
  group by 1
), standalone_file_usage as (
  select
    coalesce(
      file.tenant_id,
      gallery.tenant_id,
      profile.tenant_id,
      (select tenant.id from public.tenants as tenant where tenant.owner_id = file.user_id order by tenant.created_at limit 1)
    ) as tenant_id,
    sum(case when file.status <> 'processing' then file.size_bytes else 0 end) as used_bytes,
    sum(case when file.status = 'processing' then file.size_bytes else 0 end) as reserved_bytes
  from public.files as file
  left join public.galleries as gallery on gallery.id = file.gallery_id
  left join public.profiles as profile on profile.id = file.user_id
  where not exists (
    select 1 from public.gallery_images as image where image.storage_path = file.storage_key
  )
  group by 1
), standalone_cover_usage as (
  select
    coalesce(
      gallery.tenant_id,
      profile.tenant_id,
      (select tenant.id from public.tenants as tenant where tenant.owner_id = gallery.owner_id order by tenant.created_at limit 1)
    ) as tenant_id,
    sum(gallery.cover_preview_size) as used_bytes
  from public.galleries as gallery
  left join public.profiles as profile on profile.id = gallery.owner_id
  where gallery.cover_preview_path is not null
    and not exists (
      select 1 from public.gallery_images as image where image.storage_path = gallery.cover_path
    )
  group by 1
)
insert into public.tenant_storage (tenant_id, used_bytes, reserved_bytes, extra_bytes, updated_at)
select
  tenant.id,
  coalesce(image_usage.used_bytes, 0) + coalesce(standalone_file_usage.used_bytes, 0) + coalesce(standalone_cover_usage.used_bytes, 0),
  coalesce(standalone_file_usage.reserved_bytes, 0),
  0,
  now()
from public.tenants as tenant
left join image_usage on image_usage.tenant_id = tenant.id
left join standalone_file_usage on standalone_file_usage.tenant_id = tenant.id
left join standalone_cover_usage on standalone_cover_usage.tenant_id = tenant.id
where not exists (
  select 1 from public.tenant_storage as storage where storage.tenant_id = tenant.id
)
on conflict (tenant_id) do nothing;