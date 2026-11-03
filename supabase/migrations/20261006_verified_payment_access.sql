alter table public.orders
  add column if not exists payment_verified_at timestamptz;