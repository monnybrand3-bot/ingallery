alter table public.tenant_payment_provider_settings
  add column if not exists is_selected boolean not null default false;

alter table public.tenant_payment_provider_settings
  drop constraint if exists tenant_payment_provider_settings_pkey;

alter table public.tenant_payment_provider_settings
  add constraint tenant_payment_provider_settings_pkey primary key (tenant_id, provider);

create unique index if not exists tenant_payment_provider_one_selected_idx
  on public.tenant_payment_provider_settings (tenant_id)
  where is_selected;