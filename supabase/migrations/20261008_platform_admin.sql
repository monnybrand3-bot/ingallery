create table if not exists public.platform_admins (
  email text primary key check (email = lower(email)),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.platform_admins (email, enabled)
values ('francishaymon89@gmail.com', true)
on conflict (email) do update set enabled = excluded.enabled;

alter table public.plans add column if not exists billing_interval text not null default 'month'
  check (billing_interval in ('month', 'year', 'lifetime'));

create table if not exists public.platform_system_logs (
  id bigint generated always as identity primary key,
  level text not null check (level in ('info', 'warning', 'error')),
  method text not null,
  route text not null,
  status integer not null,
  duration_ms integer not null,
  user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists platform_system_logs_created_idx on public.platform_system_logs(created_at desc);
create index if not exists platform_system_logs_level_created_idx on public.platform_system_logs(level, created_at desc);

create table if not exists public.platform_payment_settings (
  id boolean primary key default true check (id),
  provider text not null check (provider in ('clickpesa', 'malipo', 'stakaba')),
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  encrypted_credentials text not null,
  credentials_iv text not null,
  credentials_auth_tag text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_package_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id uuid not null references public.plans(id) on delete restrict,
  order_reference text not null unique,
  payment_reference text,
  provider text not null check (provider in ('clickpesa', 'malipo', 'stakaba')),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('TZS', 'USD')),
  billing_interval text not null default 'month' check (billing_interval in ('month', 'year', 'lifetime')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  checkout_url text,
  provider_payload jsonb,
  payment_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_package_payments_created_idx on public.platform_package_payments(created_at desc);
create index if not exists platform_package_payments_user_status_idx on public.platform_package_payments(user_id, status, created_at desc);
alter table public.platform_package_payments add column if not exists billing_interval text not null default 'month'
  check (billing_interval in ('month', 'year', 'lifetime'));

alter table public.platform_admins enable row level security;
alter table public.platform_system_logs enable row level security;
alter table public.platform_payment_settings enable row level security;
alter table public.platform_package_payments enable row level security;

revoke all on public.platform_admins, public.platform_system_logs, public.platform_payment_settings, public.platform_package_payments from public, anon, authenticated;
grant all on public.platform_admins, public.platform_system_logs, public.platform_payment_settings, public.platform_package_payments to service_role;
grant usage, select on sequence public.platform_system_logs_id_seq to service_role;

drop function if exists public.activate_platform_package_payment(uuid);

create or replace function public.activate_platform_package_payment(p_payment_id uuid, p_provider_payload jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.platform_package_payments%rowtype;
begin
  select * into payment_row from public.platform_package_payments where id = p_payment_id for update;
  if not found then raise exception 'Package payment not found'; end if;
  if payment_row.status = 'SUCCESS' then return true; end if;
  if payment_row.status <> 'PENDING' then return false; end if;

  update public.tenant_subscriptions
    set status = 'expired', updated_at = now()
    where tenant_id = payment_row.tenant_id and status = 'active';
  insert into public.tenant_subscriptions(tenant_id, plan_id, status, starts_at)
    values (
      payment_row.tenant_id,
      payment_row.plan_id,
      'active',
      now()
    );
  update public.tenant_subscriptions
    set expires_at = case
      when payment_row.billing_interval = 'month' then now() + interval '1 month'
      when payment_row.billing_interval = 'year' then now() + interval '1 year'
      else null
    end
    where tenant_id = payment_row.tenant_id and status = 'active' and plan_id = payment_row.plan_id;
  update public.platform_package_payments
    set status = 'SUCCESS', payment_verified_at = now(), provider_payload = p_provider_payload, updated_at = now()
    where id = payment_row.id;
  return true;
end;
$$;

revoke all on function public.activate_platform_package_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.activate_platform_package_payment(uuid, jsonb) to service_role;
