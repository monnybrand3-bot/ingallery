create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Studio',
  slug text not null unique default gen_random_uuid()::text,
  status text not null default 'active' check (status in ('active', 'suspended', 'trial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12, 2) not null default 0,
  currency text not null default 'USD' check (currency in ('USD', 'TZS')),
  storage_limit_bytes bigint not null default 0 check (storage_limit_bytes >= 0),
  max_users integer not null default 1 check (max_users >= 1),
  max_projects integer not null default 1 check (max_projects >= 0),
  max_photos_per_gallery integer not null default 1000 check (max_photos_per_gallery >= 0),
  watermark_level text not null default 'basic' check (watermark_level in ('basic', 'advanced')),
  support_level text not null default 'standard' check (support_level in ('standard', 'priority')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'trial', 'paused', 'expired', 'cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.storage_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  price numeric(12, 2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'active', 'cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  payment_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_storage (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  extra_bytes bigint not null default 0 check (extra_bytes >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  gallery_id uuid references public.galleries(id) on delete set null,
  filename text not null,
  original_filename text not null,
  storage_key text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'deleted', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, storage_key)
);

-- The four default plans are seeded once below. Keep this migration safe to
-- replay because the API applies registered migrations at every startup.

alter table public.profiles add column if not exists tenant_id uuid references public.tenants(id) on delete set null;
alter table public.galleries add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.gallery_images add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

create index if not exists tenants_owner_idx on public.tenants(owner_id, created_at desc);
create index if not exists plans_status_idx on public.plans(status, created_at desc);
create index if not exists tenant_members_tenant_idx on public.tenant_members(tenant_id, user_id);
create index if not exists tenant_subscriptions_tenant_idx on public.tenant_subscriptions(tenant_id, status, starts_at desc);
create index if not exists storage_addons_tenant_idx on public.storage_addons(tenant_id, status, created_at desc);
create index if not exists tenant_storage_updated_idx on public.tenant_storage(updated_at desc);
create index if not exists files_tenant_gallery_idx on public.files(tenant_id, gallery_id, created_at desc);
create index if not exists files_storage_key_idx on public.files(storage_key);
create index if not exists files_user_idx on public.files(user_id, created_at desc);

create or replace function public.get_effective_tenant_storage_limit(p_tenant_id uuid)
returns bigint
language sql
stable
as $$
  select coalesce((
    select plans.storage_limit_bytes
    from public.tenant_subscriptions ts
    join public.plans plans on plans.id = ts.plan_id
    where ts.tenant_id = p_tenant_id and ts.status = 'active'
    order by ts.starts_at desc
    limit 1
  ), 0)
  + coalesce((
    select sum(storage_bytes)
    from public.storage_addons
    where tenant_id = p_tenant_id and status = 'active'
  ), 0)
  + coalesce((
    select extra_bytes
    from public.tenant_storage
    where tenant_id = p_tenant_id
  ), 0);
$$;

create or replace function public.reserve_tenant_storage(p_tenant_id uuid, p_file_size_bytes bigint)
returns jsonb
language plpgsql
as $$
declare
  current_used bigint := 0;
  current_reserved bigint := 0;
  current_extra bigint := 0;
  effective_limit bigint := 0;
  remaining bigint := 0;
begin
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid file size');
  end if;

  insert into public.tenant_storage(tenant_id, used_bytes, reserved_bytes, extra_bytes, updated_at)
  values (p_tenant_id, 0, 0, 0, now())
  on conflict (tenant_id) do nothing;

  select coalesce(used_bytes, 0), coalesce(reserved_bytes, 0), coalesce(extra_bytes, 0)
    into current_used, current_reserved, current_extra
  from public.tenant_storage
  where tenant_id = p_tenant_id;

  effective_limit := public.get_effective_tenant_storage_limit(p_tenant_id);
  remaining := effective_limit - current_used - current_reserved;

  if p_file_size_bytes > remaining then
    return jsonb_build_object(
      'ok', false,
      'reason', 'Storage limit exceeded',
      'available_bytes', remaining,
      'effective_limit_bytes', effective_limit,
      'used_bytes', current_used,
      'reserved_bytes', current_reserved
    );
  end if;

  update public.tenant_storage
    set reserved_bytes = current_reserved + p_file_size_bytes,
        updated_at = now()
  where tenant_id = p_tenant_id;

  return jsonb_build_object(
    'ok', true,
    'reserved_bytes', p_file_size_bytes,
    'remaining_bytes', effective_limit - (current_used + current_reserved + p_file_size_bytes),
    'effective_limit_bytes', effective_limit
  );
end;
$$;

create or replace function public.release_tenant_storage(p_tenant_id uuid, p_file_size_bytes bigint)
returns jsonb
language plpgsql
as $$
declare
  current_reserved bigint := 0;
begin
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid release size');
  end if;

  update public.tenant_storage
    set reserved_bytes = greatest(0, coalesce(reserved_bytes, 0) - p_file_size_bytes),
        updated_at = now()
  where tenant_id = p_tenant_id;

  return jsonb_build_object('ok', true, 'released_bytes', p_file_size_bytes);
end;
$$;

alter table public.tenants enable row level security;
alter table public.plans enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.storage_addons enable row level security;
alter table public.tenant_storage enable row level security;
alter table public.files enable row level security;

drop policy if exists "tenant owners manage tenants" on public.tenants;
create policy "tenant owners manage tenants" on public.tenants for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "tenant members read tenant" on public.tenant_members;
create policy "tenant members read tenant" on public.tenant_members for select using (auth.uid() = user_id or auth.uid() = (select owner_id from public.tenants where id = tenant_id limit 1));
drop policy if exists "tenant owners manage subscriptions" on public.tenant_subscriptions;
create policy "tenant owners manage subscriptions" on public.tenant_subscriptions for all using (auth.uid() = (select owner_id from public.tenants where id = tenant_id limit 1)) with check (auth.uid() = (select owner_id from public.tenants where id = tenant_id limit 1));
drop policy if exists "tenant owners manage storage" on public.tenant_storage;
create policy "tenant owners manage storage" on public.tenant_storage for all using (auth.uid() = (select owner_id from public.tenants where id = tenant_id limit 1)) with check (auth.uid() = (select owner_id from public.tenants where id = tenant_id limit 1));
drop policy if exists "tenant owners manage files" on public.files;
create policy "tenant owners manage files" on public.files for all using (auth.uid() = tenant_id::uuid or auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "public plans readable" on public.plans;
create policy "public plans readable" on public.plans for select using (true);

create or replace function public.ensure_user_tenant()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  user_tenant_id uuid;
begin
  select tenant_id into user_tenant_id from public.profiles where id = auth.uid() limit 1;
  if user_tenant_id is not null then
    return user_tenant_id;
  end if;

  insert into public.tenants(owner_id, name, slug)
  values (auth.uid(), 'My Studio', format('studio-%s', replace(auth.uid()::text, '-', '')))
  on conflict (slug) do nothing
  returning id into user_tenant_id;

  if user_tenant_id is null then
    select id into user_tenant_id from public.tenants where owner_id = auth.uid() limit 1;
  end if;

  update public.profiles set tenant_id = user_tenant_id where id = auth.uid();
  insert into public.tenant_members(tenant_id, user_id, role)
  values (user_tenant_id, auth.uid(), 'owner')
  on conflict (tenant_id, user_id) do nothing;

  return user_tenant_id;
end;
$$;

insert into public.plans (name, price, currency, storage_limit_bytes, max_users, max_projects, status)
select seed.name, seed.price, seed.currency, seed.storage_limit_bytes, seed.max_users, seed.max_projects, 'active'
from (values
  ('Starter', 15000::numeric, 'TZS', 21474836480::bigint, 1, 10),
  ('Professional', 35000::numeric, 'TZS', 107374182400::bigint, 1, 50),
  ('Studio', 75000::numeric, 'TZS', 536870912000::bigint, 3, 200),
  ('Agency', 120000::numeric, 'TZS', 1099511627776::bigint, 10, 0)
) as seed(name, price, currency, storage_limit_bytes, max_users, max_projects)
where not exists (select 1 from public.plans existing where lower(existing.name) = lower(seed.name));
