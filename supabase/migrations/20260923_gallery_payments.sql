create extension if not exists pgcrypto;

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'locked')),
  is_unlocked boolean not null default false,
  access_price numeric(12, 2) not null default 0 check (access_price >= 0),
  currency text not null default 'TZS' check (currency in ('TZS', 'USD')),
  image_count integer not null default 0 check (image_count >= 0),
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  studio_name text not null default 'My Studio',
  avatar_url text,
  billing_email text,
  preferences jsonb not null default '{}'::jsonb,
  role text not null default 'photographer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid references public.galleries(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  order_reference text not null unique,
  payment_reference text,
  customer_name text,
  customer_email text,
  customer_phone text,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('TZS', 'USD')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  provider text not null default 'clickpesa',
  checkout_url text,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  phone text,
  status text not null default 'active' check (status in ('active', 'lead', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null,
  client_email text,
  amount numeric(12, 2) not null check (amount > 0),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  phone text,
  display_name text not null,
  role text not null,
  permissions jsonb not null default '[]'::jsonb,
  team_name text not null default 'Unassigned',
  commission_percentage numeric(5, 2) not null default 0 check (commission_percentage >= 0 and commission_percentage <= 100),
  performance_percentage numeric(5, 2) not null default 0 check (performance_percentage >= 0 and performance_percentage <= 100),
  status text not null default 'active' check (status in ('active', 'pending', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, member_id)
);

alter table public.team_members add column if not exists team_name text not null default 'Unassigned';
alter table public.team_members add column if not exists phone text;
alter table public.team_members add column if not exists commission_percentage numeric(5, 2) not null default 0;
alter table public.team_members add column if not exists performance_percentage numeric(5, 2) not null default 0;
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.orders alter column gallery_id drop not null;

create table if not exists public.studio_roles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  role_name text not null,
  role_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, role_key)
);

create table if not exists public.studio_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  event_date date not null,
  access_token uuid not null default gen_random_uuid() unique,
  team_count integer not null default 1 check (team_count > 0 and team_count <= 20),
  role_requirements jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.studio_events(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  team_name text not null,
  assignment_group text not null default 'Team 1',
  role text not null,
  member_phone text,
  commission_percentage numeric(5, 2) not null default 0 check (commission_percentage >= 0 and commission_percentage <= 100),
  performance_percentage numeric(5, 2) not null default 0 check (performance_percentage >= 0 and performance_percentage <= 100),
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);

create table if not exists public.performance_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.studio_events(id) on delete set null,
  performance_percentage numeric(5, 2) not null check (performance_percentage >= 0 and performance_percentage <= 100),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists galleries_owner_updated_idx on public.galleries(owner_id, updated_at desc);
create index if not exists profiles_studio_idx on public.profiles(studio_name);
create index if not exists gallery_images_gallery_idx on public.gallery_images(gallery_id, sort_order);
create index if not exists orders_gallery_status_idx on public.orders(gallery_id, status);
create index if not exists clients_owner_idx on public.clients(owner_id, updated_at desc);
create index if not exists quotes_owner_idx on public.quotes(owner_id, created_at desc);
create index if not exists team_members_owner_idx on public.team_members(owner_id, created_at desc);
create index if not exists studio_roles_owner_idx on public.studio_roles(owner_id, created_at);
create index if not exists studio_events_owner_date_idx on public.studio_events(owner_id, event_date);
create index if not exists event_assignments_event_idx on public.event_assignments(event_id, team_name);
create index if not exists performance_history_member_idx on public.performance_history(owner_id, member_id, created_at desc);

alter table public.galleries enable row level security;
alter table public.profiles enable row level security;
alter table public.gallery_images enable row level security;
alter table public.orders enable row level security;
alter table public.clients enable row level security;
alter table public.quotes enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "owners manage galleries" on public.galleries;
create policy "owners manage galleries" on public.galleries for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "users manage own profile" on public.profiles;
create policy "users manage own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "owners manage gallery images" on public.gallery_images;
create policy "owners manage gallery images" on public.gallery_images for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owners read orders" on public.orders;
create policy "owners read orders" on public.orders for select using (auth.uid() = owner_id);

drop policy if exists "owners manage team members" on public.team_members;
create policy "owners manage team members" on public.team_members for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

alter table public.studio_roles enable row level security;
drop policy if exists "owners manage studio roles" on public.studio_roles;
create policy "owners manage studio roles" on public.studio_roles for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

alter table public.studio_events enable row level security;
alter table public.event_assignments enable row level security;
alter table public.performance_history enable row level security;

drop policy if exists "owners manage clients" on public.clients;
create policy "owners manage clients" on public.clients for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owners manage quotes" on public.quotes;
create policy "owners manage quotes" on public.quotes for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owners manage studio events" on public.studio_events;
create policy "owners manage studio events" on public.studio_events for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owners manage event assignments" on public.event_assignments;
create policy "owners manage event assignments" on public.event_assignments for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "owners manage performance history" on public.performance_history;
create policy "owners manage performance history" on public.performance_history for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.raw_user_meta_data ->> 'role', 'photographer'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, display_name, role)
select id, coalesce(raw_user_meta_data ->> 'name', ''), coalesce(raw_user_meta_data ->> 'role', 'photographer')
from auth.users
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('gallery-images', 'gallery-images', false)
on conflict (id) do nothing;