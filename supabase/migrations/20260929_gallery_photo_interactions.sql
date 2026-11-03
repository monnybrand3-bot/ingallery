create table if not exists public.gallery_photo_likes (
  image_id uuid not null references public.gallery_images(id) on delete cascade,
  visitor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (image_id, visitor_id)
);

create table if not exists public.gallery_photo_comments (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.gallery_images(id) on delete cascade,
  visitor_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now()
);

create index if not exists gallery_photo_comments_image_created_idx
  on public.gallery_photo_comments (image_id, created_at desc);

alter table public.gallery_photo_likes enable row level security;
alter table public.gallery_photo_comments enable row level security;
