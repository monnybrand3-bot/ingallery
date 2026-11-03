alter table public.tenant_payment_provider_settings
  drop constraint if exists tenant_payment_provider_settings_provider_check;

alter table public.tenant_payment_provider_settings
  add constraint tenant_payment_provider_settings_provider_check
  check (provider in ('clickpesa', 'malipo', 'stakaba'));