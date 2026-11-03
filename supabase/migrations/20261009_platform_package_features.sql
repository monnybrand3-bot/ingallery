alter table public.plans add column if not exists features jsonb not null default '{}'::jsonb;

create or replace function public.platform_admin_set_subscription(p_tenant_id uuid, p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Package not found';
  end if;
  update public.tenant_subscriptions set status = 'expired', updated_at = now()
    where tenant_id = p_tenant_id and status in ('active', 'trial');
  insert into public.tenant_subscriptions (tenant_id, plan_id, status, starts_at, expires_at)
    select p_tenant_id, id, 'active', now(), case billing_interval
      when 'month' then now() + interval '1 month'
      when 'year' then now() + interval '1 year'
      else null end
    from public.plans where id = p_plan_id;
end;
$$;

revoke all on function public.platform_admin_set_subscription(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_set_subscription(uuid, uuid) to service_role;
