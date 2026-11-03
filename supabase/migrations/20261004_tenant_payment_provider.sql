create table if not exists public.tenant_payment_provider_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('clickpesa', 'malipo')),
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  encrypted_credentials text not null,
  credentials_iv text not null,
  credentials_auth_tag text not null,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);

create unique index if not exists tenant_payment_provider_one_selected_idx
  on public.tenant_payment_provider_settings (tenant_id)
  where is_selected;

alter table public.tenant_payment_provider_settings enable row level security;
revoke all on public.tenant_payment_provider_settings from public, anon, authenticated;
grant all on public.tenant_payment_provider_settings to service_role;