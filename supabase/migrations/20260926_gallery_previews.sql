alter table public.gallery_images
  add column if not exists preview_path text;