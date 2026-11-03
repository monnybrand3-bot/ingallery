alter table public.gallery_images
  add column if not exists preview_size bigint not null default 0;