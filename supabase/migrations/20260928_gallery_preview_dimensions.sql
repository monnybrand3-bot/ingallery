alter table public.gallery_images
  add column if not exists preview_width integer not null default 0,
  add column if not exists preview_height integer not null default 0;