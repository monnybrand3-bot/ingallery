create table if not exists public.gallery_view_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  visitor_hash text not null check (length(visitor_hash) = 64),
  view_date date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  unique (owner_id, gallery_id, visitor_hash, view_date)
);

create index if not exists gallery_view_events_owner_date_idx
  on public.gallery_view_events(owner_id, view_date desc);
create index if not exists gallery_view_events_gallery_date_idx
  on public.gallery_view_events(gallery_id, view_date desc);

alter table public.gallery_view_events enable row level security;
revoke all on public.gallery_view_events from public, anon, authenticated;
grant all on public.gallery_view_events to service_role;

create or replace function public.get_performance_summary(p_owner_id uuid, p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with published_galleries as (
    select id from public.galleries where owner_id = p_owner_id and status = 'published'
  ),
  views_by_gallery as (
    select events.gallery_id, count(*)::integer as view_count,
      count(distinct events.visitor_hash)::integer as unique_visitors
    from public.gallery_view_events events
    join published_galleries galleries on galleries.id = events.gallery_id
    where events.owner_id = p_owner_id and events.created_at >= p_since
    group by events.gallery_id
  ),
  paid_orders_by_client as (
    select lower(trim(customer_email)) as email, count(*)::integer as paid_order_count
    from public.orders
    where owner_id = p_owner_id
      and customer_email is not null and trim(customer_email) <> ''
      and upper(status) in ('SUCCESS', 'PAID', 'COMPLETED')
    group by lower(trim(customer_email))
  )
  select jsonb_build_object(
    'publishedGalleryCount', (select count(*)::integer from published_galleries),
    'viewedGalleryCount', (select count(*)::integer from views_by_gallery),
    'viewCount', coalesce((select sum(view_count)::integer from views_by_gallery), 0),
    'uniqueVisitorCount', coalesce((
      select count(distinct events.visitor_hash)::integer from public.gallery_view_events events
      join published_galleries galleries on galleries.id = events.gallery_id
      where events.owner_id = p_owner_id and events.created_at >= p_since
    ), 0),
    'galleryViews', coalesce((
      select jsonb_agg(jsonb_build_object('galleryId', gallery_id, 'viewCount', view_count, 'uniqueVisitors', unique_visitors))
      from views_by_gallery
    ), '[]'::jsonb),
    'buyerCount', (select count(*)::integer from paid_orders_by_client),
    'repeatBuyerCount', (select count(*)::integer from paid_orders_by_client where paid_order_count > 1)
  );
$$;

revoke all on function public.get_performance_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_performance_summary(uuid, timestamptz) to service_role;
