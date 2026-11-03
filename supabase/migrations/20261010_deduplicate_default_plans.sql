do $$
declare
  duplicate_row record;
begin
  for duplicate_row in
    select id, canonical_id
    from (
      select id,
        first_value(id) over (partition by lower(trim(name)) order by created_at asc, id asc) as canonical_id,
        row_number() over (partition by lower(trim(name)) order by created_at asc, id asc) as row_number
      from public.plans
    ) ranked
    where row_number > 1
  loop
    update public.tenant_subscriptions set plan_id = duplicate_row.canonical_id where plan_id = duplicate_row.id;
    update public.platform_package_payments set plan_id = duplicate_row.canonical_id where plan_id = duplicate_row.id;
    delete from public.plans where id = duplicate_row.id;
  end loop;
end;
$$;

create unique index if not exists plans_name_normalized_unique on public.plans (lower(trim(name)));
