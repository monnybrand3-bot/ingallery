create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'locked')),
  image_count integer not null default 0 check (image_count >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists galleries_owner_updated_idx
  on public.galleries (owner_id, updated_at desc);

alter table public.galleries enable row level security;

create policy "owners can read their galleries"
  on public.galleries for select
  using (auth.uid() = owner_id);

create policy "owners can create galleries"
  on public.galleries for insert
  with check (auth.uid() = owner_id);

create policy "owners can update their galleries"
  on public.galleries for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);