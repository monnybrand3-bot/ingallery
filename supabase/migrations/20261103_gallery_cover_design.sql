alter table public.galleries
  add column if not exists cover_design text not null default 'classic';

alter table public.galleries
  drop constraint if exists galleries_cover_design_check;

alter table public.galleries
  add constraint galleries_cover_design_check
  check (cover_design in ('classic', 'editorial', 'cinematic', 'minimal'));
