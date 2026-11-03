alter table public.plans add column if not exists max_photos_per_gallery integer not null default 1000 check (max_photos_per_gallery >= 0);
alter table public.plans add column if not exists watermark_level text not null default 'basic' check (watermark_level in ('basic', 'advanced'));
alter table public.plans add column if not exists support_level text not null default 'standard' check (support_level in ('standard', 'priority'));

create table if not exists public.system_data_migrations (
  migration text primary key,
  applied_at timestamptz not null default now()
);
alter table public.system_data_migrations enable row level security;
revoke all on public.system_data_migrations from public, anon, authenticated;
grant all on public.system_data_migrations to service_role;

do $restore_original_packages$
begin
if not exists (select 1 from public.system_data_migrations where migration = '20261011_restore_original_packages') then
update public.plans set name = 'Studio' where lower(name) = 'business';
update public.plans set name = 'Agency' where lower(name) = 'enterprise';

with original_packages(name, price, storage_bytes, gallery_limit, photo_limit, team_limit, watermark, support, features) as (
  values
    ('Starter', 15000::numeric, 21474836480::bigint, 10, 1000, 1, 'basic', 'standard', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":false,"customDomain":false,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":false,"teamManagement":false,"agencyDashboard":false}'::jsonb),
    ('Professional', 35000::numeric, 107374182400::bigint, 50, 3000, 1, 'advanced', 'standard', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":false,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":false,"teamManagement":false,"agencyDashboard":false}'::jsonb),
    ('Studio', 75000::numeric, 536870912000::bigint, 200, 10000, 3, 'advanced', 'priority', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":true,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":true,"teamManagement":true,"agencyDashboard":false}'::jsonb),
    ('Agency', 120000::numeric, 1099511627776::bigint, 0, 20000, 10, 'advanced', 'priority', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":true,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":true,"teamManagement":true,"agencyDashboard":true}'::jsonb)
)
update public.plans p set
  price = package.price,
  currency = 'TZS',
  billing_interval = 'month',
  storage_limit_bytes = package.storage_bytes,
  max_projects = package.gallery_limit,
  max_photos_per_gallery = package.photo_limit,
  max_users = package.team_limit,
  watermark_level = package.watermark,
  support_level = package.support,
  features = package.features,
  status = 'active',
  updated_at = now()
from original_packages package
where lower(p.name) = lower(package.name);

insert into public.plans (name, price, currency, billing_interval, storage_limit_bytes, max_projects, max_photos_per_gallery, max_users, watermark_level, support_level, features, status)
select package.name, package.price, 'TZS', 'month', package.storage_bytes, package.gallery_limit, package.photo_limit, package.team_limit, package.watermark, package.support, package.features, 'active'
from (
  values
    ('Starter', 15000::numeric, 21474836480::bigint, 10, 1000, 1, 'basic', 'standard', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":false,"customDomain":false,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":false,"teamManagement":false,"agencyDashboard":false}'::jsonb),
    ('Professional', 35000::numeric, 107374182400::bigint, 50, 3000, 1, 'advanced', 'standard', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":false,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":false,"teamManagement":false,"agencyDashboard":false}'::jsonb),
    ('Studio', 75000::numeric, 536870912000::bigint, 200, 10000, 3, 'advanced', 'priority', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":true,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":true,"teamManagement":true,"agencyDashboard":false}'::jsonb),
    ('Agency', 120000::numeric, 1099511627776::bigint, 0, 20000, 10, 'advanced', 'priority', '{"clientDownloads":true,"originalQualityDownloads":true,"clientPaymentUnlock":true,"qrGalleryLinks":true,"galleryExpiration":true,"ingalleryBranding":true,"customBranding":true,"customDomain":true,"clientFavorites":true,"galleryPassword":true,"emailNotifications":true,"analytics":true,"bulkUpload":true,"prioritySupport":true,"teamManagement":true,"agencyDashboard":true}'::jsonb)
) as package(name, price, storage_bytes, gallery_limit, photo_limit, team_limit, watermark, support, features)
where not exists (select 1 from public.plans existing where lower(existing.name) = lower(package.name));

insert into public.system_data_migrations(migration) values ('20261011_restore_original_packages');
end if;
end;
$restore_original_packages$;
