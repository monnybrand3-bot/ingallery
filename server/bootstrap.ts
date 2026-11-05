import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const migrationPaths = [
  path.join(process.cwd(), 'supabase', 'migrations', '20260923_gallery_payments.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260924_storage_quota.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260925_gallery_order_delete.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260926_gallery_previews.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260927_gallery_preview_size.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260928_gallery_preview_dimensions.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260929_gallery_photo_interactions.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20260930_gallery_image_variants.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261001_gallery_cover_video.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261002_profile_avatar_path.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261003_storage_usage_backfill.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261004_tenant_payment_provider.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261005_tenant_payment_provider_selection.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261006_verified_payment_access.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261007_stakaba_payment_provider.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261008_platform_admin.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261009_platform_package_features.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261010_deduplicate_default_plans.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261011_restore_original_packages.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261102_performance_analytics.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261103_gallery_cover_design.sql'),
  path.join(process.cwd(), 'supabase', 'migrations', '20261105_gallery_cover_videos_in_album.sql')
];

export const bootstrapDatabase = async (): Promise<void> => {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.warn('SUPABASE_DB_URL is not configured; automatic schema creation is skipped.');
    return;
  }

  const schemaSql = (await Promise.all(migrationPaths.map((migrationPath) => readFile(migrationPath, 'utf8')))).join('\n');
  const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(schemaSql);
    await client.query('commit');
    console.info('Supabase schema migration applied successfully.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};
