alter table public.orders
  drop constraint if exists orders_gallery_id_fkey;

alter table public.orders
  add constraint orders_gallery_id_fkey
  foreign key (gallery_id)
  references public.galleries(id)
  on delete set null;