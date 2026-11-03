alter table public.galleries
  add column if not exists cover_video_url text,
  add column if not exists cover_video_path text;