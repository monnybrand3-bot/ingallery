insert into public.gallery_images (
  gallery_id,
  owner_id,
  tenant_id,
  storage_path,
  file_name,
  mime_type,
  file_size,
  processing_status
)
select
  gallery.id,
  gallery.owner_id,
  gallery.tenant_id,
  gallery.cover_video_path,
  file.original_filename,
  file.mime_type,
  file.size_bytes,
  'ready'
from public.galleries as gallery
join public.files as file
  on file.tenant_id = gallery.tenant_id
  and file.gallery_id = gallery.id
  and file.storage_key = gallery.cover_video_path
where gallery.cover_video_path is not null
  and file.mime_type in ('video/mp4', 'video/webm')
  and not exists (
    select 1
    from public.gallery_images as existing
    where existing.storage_path = gallery.cover_video_path
  )
on conflict (storage_path) do nothing;

update public.files as file
set id = image.id,
    updated_at = now()
from public.gallery_images as image
where image.storage_path = file.storage_key
  and image.tenant_id = file.tenant_id
  and image.mime_type in ('video/mp4', 'video/webm')
  and file.id <> image.id
  and not exists (
    select 1 from public.files as other_file where other_file.id = image.id
  );

update public.galleries as gallery
set image_count = (
  select count(*)::integer
  from public.gallery_images as image
  where image.gallery_id = gallery.id
),
updated_at = now()
where gallery.cover_video_path is not null;
