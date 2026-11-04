import 'dotenv/config';

import cors from 'cors';
import express, { type Request, type Response } from 'express';
import sharp from 'sharp';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import type { Archiver } from 'archiver';

import { supabase, supabaseAuth } from './supabase.js';
import { bootstrapDatabase } from './bootstrap.js';
import { createGalleryAccessToken, verifyPaidOrderAccess } from './galleryAccess.js';
import { decryptPaymentCredentials, encryptPaymentCredentials, type EncryptedPaymentCredentials, type PaymentProviderCredentials } from './paymentCredentials.js';
import { rateLimiter } from "./rate_limiter.js";
import { createClickPesaChecksum } from "./clickpesaChecksum.js";
import { createPresignedDownloadUrl, createPresignedUploadUrl, deleteObjectFromR2, ensureR2CorsConfiguration, getR2ObjectSize, getR2ObjectStream, putBufferToR2, verifyObjectInR2 } from './r2.js';
import {
  calculateStorageWarning,
  getEffectiveStorageLimit,
  humanizeBytes,
  isQuotaExceeded,
  reserveStorageForUpload
} from './storage.js';

const PUBLIC_GALLERY_PREVIEW_LIMIT = 10;
const PUBLIC_GALLERY_PAGE_SIZE = 24;

const archiverModule = createRequire(import.meta.url)('archiver') as {
  ZipArchive: new (options: { level: number }) => Archiver;
};

interface AuthBody {
  email?: string;
  password?: string;
  name?: string;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
  userEmail?: string;
}

type GalleryCoverDesign = 'classic' | 'editorial' | 'cinematic' | 'minimal';
const isGalleryCoverDesign = (value: string): value is GalleryCoverDesign =>
  ['classic', 'editorial', 'cinematic', 'minimal'].includes(value);

interface GalleryBody {
  title?: string;
  accessPrice?: number;
  currency?: 'TZS' | 'USD';
  coverDesign?: GalleryCoverDesign;
}

interface ImageBody {
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

interface CheckoutBody {
  galleryId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  network?: string;
}

interface PaymentSettingsBody {
  provider?: string;
  environment?: string;
  clientId?: string;
  apiKey?: string;
  secretKey?: string;
  checksumKey?: string;
  disconnect?: boolean;
}

interface TeamInviteBody {
  email?: string;
  name?: string;
  password?: string;
  role?: string;
  permissions?: string[];
  teamName?: string;
  commissionPercentage?: number;
  performancePercentage?: number;
  phone?: string;
}

interface EventBody {
  eventName?: string;
  eventDate?: string;
  roleRequirements?: Record<string, number>;
}

interface ClientBody {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

interface QuoteBody {
  clientId?: string;
  clientName?: string;
  clientEmail?: string;
  amount?: number;
  notes?: string;
}

interface ManualOrderBody {
  clientName?: string;
  galleryName?: string;
  amount?: number;
  method?: string;
}

interface ProfileBody {
  displayName?: string;
  studioName?: string;
  avatarUrl?: string;
  billingEmail?: string;
  preferences?: Record<string, unknown>;
}

interface ClickPesaWebhook {
  event?: string;
  data?: {
    id?: string;
    status?: string;
    paymentReference?: string;
    orderReference?: string;
    collectedAmount?: string;
    collectedCurrency?: string;
  };
}

interface MalipoCallback {
  transaction_id?: string;
  reference_id?: string;
  invoice_id?: string | null;
  status?: string;
  amount?: string;
  payment_date?: string;
  timestamp?: string;
  remark?: string;
}

const app = express();
app.set('trust proxy', 1);
const port = Number(process.env.PORT ?? 8787);
const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5175,http://localhost:5173,http://localhost:5174').split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  ...Array.from({ length: 11 }, (_, index) => 5173 + index).flatMap((portNumber) => [
    `http://localhost:${portNumber}`,
    `http://127.0.0.1:${portNumber}`
  ])
]);
const isAllowedFrontendOrigin = (origin: string): boolean =>
  allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
const resolveFrontendOrigin = (request: Request): string => {
  const requestOrigin = request.get('origin');
  if (requestOrigin && isAllowedFrontendOrigin(requestOrigin)) return requestOrigin;
  return configuredOrigins[0] ?? `http://localhost:${port}`;
};
const startedAt = Date.now();
const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';

interface DemoGalleryImage {
  id: string;
  gallery_id: string;
  owner_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface DemoGalleryRecord {
  id: string;
  owner_id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'locked';
  access_price: number;
  currency: 'TZS' | 'USD';
  cover_design?: 'classic' | 'editorial' | 'cinematic' | 'minimal';
  is_unlocked: boolean;
  image_count: number;
  cover_path: string | null;
  cover_video_url: string | null;
  cover_video_path: string | null;
  updated_at: string;
  images: DemoGalleryImage[];
}

const demoGalleryStore: DemoGalleryRecord[] = [
  {
    id: 'demo-gallery-1',
    owner_id: DEMO_USER_ID,
    title: 'Summer Collection',
    slug: 'summer-collection',
    status: 'published',
    access_price: 0,
    currency: 'TZS',
    is_unlocked: true,
    image_count: 0,
    cover_path: null,
    cover_video_url: null,
    cover_video_path: null,
    updated_at: new Date().toISOString(),
    images: []
  }
];

const isDemoUser = (_userId?: string): boolean => false;

const getDemoGalleryList = () => demoGalleryStore.map((gallery) => ({
  id: gallery.id,
  title: gallery.title,
  slug: gallery.slug,
  status: gallery.status,
  accessPrice: gallery.access_price,
  currency: gallery.currency,
  isUnlocked: gallery.is_unlocked,
  imageCount: gallery.images.length,
  updatedAt: gallery.updated_at,
  coverUrl: gallery.cover_path ? `${process.env.R2_PUBLIC_URL ?? 'https://images.r2.dev'}/${encodeURIComponent(gallery.cover_path)}` : null
}));

const getDemoGalleryById = (galleryId: string) => demoGalleryStore.find((gallery) => gallery.id === galleryId);
const deleteR2Objects = async (keys: Array<string | null | undefined>): Promise<void> => {
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  for (let offset = 0; offset < uniqueKeys.length; offset += 20) {
    await Promise.all(uniqueKeys.slice(offset, offset + 20).map((key) => deleteObjectFromR2(key)));
  }
};
const getGalleryIdParam = (request: Request): string => {
  const value = request.params.galleryId;
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};

const cancelPendingUpload = async ({
  tenantId,
  galleryId,
  ownerId,
  storagePath
}: {
  tenantId: string;
  galleryId: string | null;
  ownerId: string;
  storagePath: string;
}): Promise<boolean> => {
  let reservationQuery = supabase.from('files')
    .select('id, size_bytes')
    .eq('tenant_id', tenantId)
    .eq('user_id', ownerId)
    .eq('storage_key', storagePath)
    .eq('status', 'processing');
  reservationQuery = galleryId ? reservationQuery.eq('gallery_id', galleryId) : reservationQuery.is('gallery_id', null);
  const { data: reservation, error } = await reservationQuery.maybeSingle();
  if (error) throw error;
  if (!reservation) return false;

  await deleteObjectFromR2(storagePath);
  const { data: deletedReservation, error: deleteError } = await supabase.from('files')
    .delete()
    .eq('id', reservation.id)
    .eq('status', 'processing')
    .select('id')
    .maybeSingle();
  if (deleteError) throw deleteError;
  if (!deletedReservation) return false;

  const { error: releaseError } = await supabase.rpc('release_tenant_storage', {
    p_tenant_id: tenantId,
    p_file_size_bytes: Number(reservation.size_bytes)
  });
  if (releaseError) throw releaseError;
  return true;
};

const syncGalleryImageCount = async (galleryId: string, ownerId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('gallery_images')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', galleryId);

  const actualCount = Number(count ?? 0);
  if (!error && Number.isFinite(actualCount)) {
    await supabase
      .from('galleries')
      .update({ image_count: actualCount })
      .eq('id', galleryId)
      .eq('owner_id', ownerId);
  }

  return actualCount;
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isAllowedFrontendOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
  const started = Date.now();
  response.on('finish', () => {
    if (request.path.startsWith('/api/')) {
      const route = request.route?.path
        ? `${request.baseUrl}${String(request.route.path)}`
        : request.path;
      const status = response.statusCode;
      void supabase.from('platform_system_logs').insert({
        level: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
        method: request.method,
        route: route.slice(0, 255),
        status,
        duration_ms: Date.now() - started,
        user_id: (request as AuthenticatedRequest).userId ?? null
      }).then(({ error }) => {
        if (error) console.warn('Unable to persist platform request log:', error.message);
      }, (error: unknown) => console.warn('Unable to persist platform request log:', error));
    }
    console.info(JSON.stringify({
      event: 'http_request',
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - started
    }));
  });
  next();
});

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'ingallery-api',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString()
  });
});

const getBearerToken = (request: Request): string | null => {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length);
};

const requireUser = async (request: AuthenticatedRequest, response: Response, next: () => void): Promise<void> => {
  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ ok: false, message: 'Authentication required' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.id === DEMO_USER_ID) {
    response.status(401).json({ ok: false, message: 'Invalid session' });
    return;
  }

  request.userId = data.user.id;
  request.userRole = String(data.user.user_metadata?.role ?? 'photographer');
  request.userEmail = data.user.email?.toLowerCase();
  next();
};

const requirePlatformAdmin = async (request: AuthenticatedRequest, response: Response, next: () => void): Promise<void> => {
  if (!request.userId || !request.userEmail) {
    response.status(401).json({ ok: false, message: 'Authentication required' });
    return;
  }
  const { data, error } = await supabase.from('platform_admins').select('email').eq('email', request.userEmail).eq('enabled', true).maybeSingle();
  if (error || !data) {
    response.status(403).json({ ok: false, message: 'Platform administrator access required' });
    return;
  }
  request.userRole = 'platform-admin';
  next();
};

const requireAdmin = (request: AuthenticatedRequest, response: Response, next: () => void): void => {
  if (!['studio-admin', 'admin', 'owner'].includes(request.userRole ?? '')) {
    response.status(403).json({ ok: false, message: 'Admin access required' });
    return;
  }
  next();
};

const ensureTenantForUser = async (userId: string): Promise<{ tenantId: string; planLimitBytes: number; extraBytes: number; usedBytes: number; reservedBytes: number }> => {
  const { data: profileData } = await supabase.from('profiles').select('tenant_id').eq('id', userId).maybeSingle();
  let tenantId = profileData?.tenant_id as string | undefined;

  if (!tenantId) {
    const { data: membershipData } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    tenantId = membershipData?.tenant_id as string | undefined;
  }

  if (!tenantId) {
    const { data: createdTenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        owner_id: userId,
        name: 'My Studio',
        slug: `studio-${Date.now()}-${userId.slice(0, 8)}`
      })
      .select('id')
      .single();

    if (tenantError || !createdTenant) {
      throw new Error(tenantError?.message ?? 'Unable to create tenant');
    }

    tenantId = createdTenant.id;

    await supabase.from('tenant_members').upsert({
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner'
    });

    await supabase.from('profiles').update({ tenant_id: tenantId, updated_at: new Date().toISOString() }).eq('id', userId);
  }

  if (!tenantId) {
    throw new Error('Unable to resolve a tenant for this user');
  }

  type SubscriptionPlanRow = { plan_id: string | null };
  const { error: expirationError } = await supabase.from('tenant_subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('status', 'active').lte('expires_at', new Date().toISOString());
  if (expirationError) throw expirationError;
  const { data: subscriptionData } = await supabase
    .from('tenant_subscriptions')
    .select('plan_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionPlanRow>();

  let planId = subscriptionData?.plan_id ?? null;
  if (!planId) {
    const { data: starterPlan } = await supabase
      .from('plans')
      .select('id')
      .eq('name', 'Starter')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    planId = starterPlan?.id ?? null;
    if (planId) {
      await supabase.from('tenant_subscriptions').insert({ tenant_id: tenantId, plan_id: planId, status: 'active' });
    }
  }
  let planLimitBytes = 0;

  if (planId) {
    const { data: planData } = await supabase.from('plans').select('storage_limit_bytes').eq('id', planId).maybeSingle();
    planLimitBytes = Number(planData?.storage_limit_bytes ?? 0);
  }

  const { data: storageData } = await supabase
    .from('tenant_storage')
    .select('used_bytes, reserved_bytes, extra_bytes')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return {
    tenantId,
    planLimitBytes,
    extraBytes: Number(storageData?.extra_bytes ?? 0),
    usedBytes: Number(storageData?.used_bytes ?? 0),
    reservedBytes: Number(storageData?.reserved_bytes ?? 0)
  };
};

interface TenantPaymentConfiguration {
  provider: 'clickpesa' | 'malipo' | 'stakaba';
  environment: 'sandbox' | 'production';
  credentials: PaymentProviderCredentials;
}

const resolveOwnedTenantId = async (userId: string): Promise<string> => {
  const tenantContext = await ensureTenantForUser(userId);
  const { data: tenant, error } = await supabase.from('tenants').select('id')
    .eq('id', tenantContext.tenantId).eq('owner_id', userId).maybeSingle();
  if (error) throw error;
  if (!tenant) throw new Error('Only the studio owner can manage payment provider settings.');
  return tenant.id;
};

const loadTenantPaymentConfiguration = async (tenantId: string, provider?: TenantPaymentConfiguration['provider']): Promise<TenantPaymentConfiguration | null> => {
  let query = supabase.from('tenant_payment_provider_settings')
    .select('provider, environment, encrypted_credentials, credentials_iv, credentials_auth_tag')
    .eq('tenant_id', tenantId);
  query = provider ? query.eq('provider', provider) : query.eq('is_selected', true);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const credentials = decryptPaymentCredentials<PaymentProviderCredentials>({
    ciphertext: data.encrypted_credentials,
    iv: data.credentials_iv,
    authTag: data.credentials_auth_tag
  } satisfies EncryptedPaymentCredentials);
  if (credentials.provider !== data.provider) throw new Error('Stored payment provider credentials do not match the selected provider.');
  return {
    provider: data.provider as TenantPaymentConfiguration['provider'],
    environment: data.environment as TenantPaymentConfiguration['environment'],
    credentials
  };
};

const ensureTenantStorageRow = async (tenantId: string, extraBytes = 0): Promise<void> => {
  await supabase.from('tenant_storage').upsert({
    tenant_id: tenantId,
    used_bytes: 0,
    reserved_bytes: 0,
    extra_bytes: extraBytes,
    updated_at: new Date().toISOString()
  }, { onConflict: 'tenant_id', ignoreDuplicates: true });
};

const updateStoredUsageAfterUpload = async (tenantId: string, fileSizeBytes: number, previousReservedBytes: number): Promise<void> => {
  const { data: storageData } = await supabase
    .from('tenant_storage')
    .select('used_bytes, reserved_bytes, extra_bytes')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const usedBytes = Number(storageData?.used_bytes ?? 0) + fileSizeBytes;
  const reservedBytes = Math.max(0, Number(storageData?.reserved_bytes ?? previousReservedBytes ?? 0) - fileSizeBytes);

  await supabase.from('tenant_storage').upsert({
    tenant_id: tenantId,
    used_bytes: usedBytes,
    reserved_bytes: reservedBytes,
    extra_bytes: Number(storageData?.extra_bytes ?? 0),
    updated_at: new Date().toISOString()
  }, { onConflict: 'tenant_id' });
};

app.post('/api/auth/signup', async (request: Request<unknown, unknown, AuthBody>, response: Response) => {
  const { email, password, name } = request.body;
  if (!email || !password || !name || password.length < 6) {
    response.status(400).json({ ok: false, message: 'Name, email, and a six-character password are required' });
    return;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'studio-admin' }
  });

  if (error || !data.user) {
    response.status(400).json({ ok: false, message: error?.message ?? 'Unable to create account' });
    return;
  }

  const { data: sessionData, error: sessionError } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (sessionError || !sessionData.session) {
    response.status(201).json({ ok: true, data: { id: data.user.id, email: data.user.email, name, role: 'studio-admin', isAuthenticated: true, lastLogin: new Date().toISOString() }, message: 'Account created. Sign in to continue.' });
    return;
  }

  response.status(201).json({
    ok: true,
    data: {
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
      user: { id: data.user.id, email: data.user.email, name, role: 'studio-admin' }
    }
  });
});

app.post('/api/auth/login', async (request: Request<unknown, unknown, AuthBody>, response: Response) => {
  const email = request.body.email?.trim().toLowerCase();
  const password = request.body.password;
  if (!email || !password) {
    response.status(400).json({ ok: false, message: 'Email and password are required' });
    return;
  }
  const attemptLogin = async (loginEmail: string, loginPassword: string) => supabaseAuth.auth.signInWithPassword({ email: loginEmail, password: loginPassword });

  const { data, error } = await attemptLogin(email, password);
  if (!error && data.session && data.user) {
    if (data.user.id === DEMO_USER_ID) {
      response.status(401).json({ ok: false, message: 'This sample account is disabled. Sign in with your own account.' });
      return;
    }
    const { data: platformAdmin } = data.user.email
      ? await supabase.from('platform_admins').select('email').eq('email', data.user.email.toLowerCase()).eq('enabled', true).maybeSingle()
      : { data: null };
    response.json({
      ok: true,
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata.name ?? '', role: platformAdmin ? 'platform-admin' : 'photographer' }
      }
    });
    return;
  }

  response.status(401).json({ ok: false, message: error?.message ?? 'Unable to sign in' });
});

app.post('/api/auth/refresh', async (request: Request, response: Response) => {
  const refreshToken = String(request.body?.refreshToken ?? '').trim();
  if (!refreshToken) {
    response.status(400).json({ ok: false, message: 'A refresh token is required.' });
    return;
  }
  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    response.status(401).json({ ok: false, message: 'Session expired. Sign in again.' });
    return;
  }
  response.json({ ok: true, data: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token } });
});

app.post('/api/auth/password/request', rateLimiter(5, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const email = String(request.body?.email ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ ok: false, data: { sent: false }, message: 'Enter a valid email address.' });
    return;
  }

  const redirectTo = `${resolveFrontendOrigin(request)}/reset-password.html`;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      console.warn(JSON.stringify({ event: 'password_recovery_request_failed', message: error.message }));
      response.status(502).json({ ok: false, data: { sent: false }, message: 'Unable to send a recovery email. Check the Supabase email and redirect settings, then try again.' });
      return;
    }
    response.json({ ok: true, data: { sent: true }, message: 'If an account exists for that email, recovery instructions will arrive shortly.' });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'password_recovery_request_failed', message: error instanceof Error ? error.message : String(error) }));
    response.status(502).json({ ok: false, data: { sent: false }, message: 'Unable to send a recovery email. Please try again later.' });
  }
});

app.post('/api/auth/password/recovery', async (request: Request, response: Response) => {
  const accessToken = String(request.body?.accessToken ?? '');
  const password = String(request.body?.password ?? '');
  if (!accessToken || password.length < 8) { response.status(400).json({ ok: false, message: 'A valid recovery link and a password of at least 8 characters are required.' }); return; }
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user) { response.status(401).json({ ok: false, message: 'This recovery link is invalid or expired. Request a new one.' }); return; }
  const { error } = await supabase.auth.admin.updateUserById(authData.user.id, { password });
  if (error) { response.status(400).json({ ok: false, message: 'Unable to update the password. Request a new recovery email.' }); return; }
  response.json({ ok: true, data: { updated: true } });
});

app.get('/api/session', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.auth.admin.getUserById(request.userId as string);
  if (error || !data.user) {
    response.status(404).json({ ok: false, message: 'User not found' });
    return;
  }

  response.json({ ok: true, data: { id: data.user.id, email: data.user.email, name: data.user.user_metadata.name ?? '' } });
});

app.get('/api/profile', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('profiles').select('id, display_name, studio_name, avatar_url, avatar_path, billing_email, preferences, role, created_at, updated_at').eq('id', request.userId).single();
  if (error || !data) { response.status(404).json({ ok: false, message: error?.message ?? 'Profile not found' }); return; }
  const avatarUrl = data.avatar_path
    ? await createPresignedDownloadUrl({ key: data.avatar_path, expiresIn: 3600 })
    : data.avatar_url;
  response.json({ ok: true, data: { ...data, avatarUrl } });
});

app.patch('/api/profile', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as ProfileBody;
  const displayName = body.displayName?.trim();
  const studioName = body.studioName?.trim();
  const billingEmail = body.billingEmail?.trim().toLowerCase();
  if (displayName !== undefined && displayName.length > 120 || studioName !== undefined && (!studioName || studioName.length > 120) || billingEmail !== undefined && billingEmail !== '' && !/^\S+@\S+\.\S+$/.test(billingEmail)) {
    response.status(400).json({ ok: false, message: 'Invalid profile details' });
    return;
  }
  const { data, error } = await supabase.from('profiles').update({
    ...(displayName !== undefined ? { display_name: displayName } : {}),
    ...(studioName !== undefined ? { studio_name: studioName } : {}),
    ...(billingEmail !== undefined ? { billing_email: billingEmail || null } : {}),
    ...(body.preferences !== undefined ? { preferences: body.preferences } : {}),
    updated_at: new Date().toISOString()
  }).eq('id', request.userId).select('id, display_name, studio_name, avatar_url, avatar_path, billing_email, preferences, role, created_at, updated_at').single();
  if (error || !data) { response.status(400).json({ ok: false, message: error?.message ?? 'Unable to update profile' }); return; }
  const avatarUrl = data.avatar_path ? await createPresignedDownloadUrl({ key: data.avatar_path, expiresIn: 3600 }) : data.avatar_url;
  response.json({ ok: true, data: { ...data, avatarUrl } });
});

app.get('/api/payment-settings', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  try {
    const tenantId = await resolveOwnedTenantId(request.userId as string);
    const { data, error } = await supabase.from('tenant_payment_provider_settings')
      .select('provider, environment, is_selected').eq('tenant_id', tenantId);
    if (error) throw error;
    const selected = data?.find(p => p.is_selected);
    response.json({ ok: true, data: {
      providers: data ?? [],
      selected: selected?.provider ?? null,
      environment: selected?.environment ?? 'production',
      configured: Boolean(selected)
    } });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('Only the studio owner')
      ? error.message
      : 'Unable to load payment settings.';
    response.status(message.startsWith('Only the studio owner') ? 403 : 500).json({ ok: false, message });
  }
});

app.post('/api/payment-settings/select', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  try {
    const { provider } = request.body as { provider: string };
    const tenantId = await resolveOwnedTenantId(request.userId as string);
    const { error: deselectError } = await supabase.from('tenant_payment_provider_settings')
      .update({ is_selected: false }).eq('tenant_id', tenantId);
    if (deselectError) throw deselectError;
    const { error: selectError } = await supabase.from('tenant_payment_provider_settings')
      .update({ is_selected: true }).eq('tenant_id', tenantId).eq('provider', provider);
    if (selectError) throw selectError;
    response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to switch active payment provider.';
    response.status(500).json({ ok: false, message });
  }
});

app.put('/api/payment-settings', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  try {
    const tenantId = await resolveOwnedTenantId(request.userId as string);
    const body = request.body as PaymentSettingsBody;
    if (body.disconnect) {
      const { data: current, error: currentError } = await supabase.from('tenant_payment_provider_settings')
        .select('provider').eq('tenant_id', tenantId).eq('is_selected', true).maybeSingle();
      if (currentError) throw currentError;
      if (current) {
        const { data: pendingOrder, error: pendingError } = await supabase.from('orders').select('id')
          .eq('owner_id', request.userId as string).eq('provider', current.provider).eq('status', 'PENDING').limit(1).maybeSingle();
        if (pendingError) throw pendingError;
        if (pendingOrder) {
          response.status(409).json({ ok: false, message: 'A payment is still pending. Disconnect after it completes or expires.' });
          return;
        }
      }
      const { error } = await supabase.from('tenant_payment_provider_settings').delete().eq('tenant_id', tenantId).eq('is_selected', true);
      if (error) throw error;
      response.json({ ok: true, data: { provider: null, environment: 'production', configured: false } });
      return;
    }

    if (body.provider !== 'clickpesa' && body.provider !== 'malipo' && body.provider !== 'stakaba') {
      response.status(400).json({ ok: false, message: 'Choose a supported payment provider.' });
      return;
    }
    const provider = body.provider;
    const environment = provider === 'clickpesa' ? 'production' : body.environment;
    if (environment !== 'sandbox' && environment !== 'production') {
      response.status(400).json({ ok: false, message: 'Choose a valid payment environment.' });
      return;
    }

    const { data: current, error: currentError } = await supabase.from('tenant_payment_provider_settings')
      .select('provider, environment, encrypted_credentials, credentials_iv, credentials_auth_tag')
      .eq('tenant_id', tenantId).eq('provider', provider).maybeSingle();
    if (currentError) throw currentError;

    const suppliedCredentials = Boolean(body.clientId?.trim() || body.apiKey?.trim() || body.secretKey?.trim() || body.checksumKey?.trim());
    if (current && (suppliedCredentials || current.environment !== environment)) {
      const { data: pendingOrder, error: pendingError } = await supabase.from('orders').select('id')
        .eq('owner_id', request.userId as string).eq('provider', provider).eq('status', 'PENDING').limit(1).maybeSingle();
      if (pendingError) throw pendingError;
      if (pendingOrder) {
        response.status(409).json({ ok: false, message: 'A payment is still pending with this provider. Update these credentials after it completes or expires.' });
        return;
      }
    }

    let encrypted: EncryptedPaymentCredentials;
    const firstCredential = (provider === 'clickpesa' ? body.clientId : body.apiKey)?.trim();
    const secondCredential = provider === 'clickpesa' ? body.apiKey?.trim() : provider === 'malipo' ? body.secretKey?.trim() : undefined;
    const suppliedChecksumKey = body.checksumKey?.trim();
    if (provider === 'clickpesa' && current?.provider === 'clickpesa') {
      const savedCredentials = decryptPaymentCredentials<Extract<PaymentProviderCredentials, { provider: 'clickpesa' }>>({
        ciphertext: current.encrypted_credentials,
        iv: current.credentials_iv,
        authTag: current.credentials_auth_tag
      });
      const credentials: Extract<PaymentProviderCredentials, { provider: 'clickpesa' }> = {
        provider,
        clientId: firstCredential || savedCredentials.clientId,
        apiKey: secondCredential || savedCredentials.apiKey,
        checksumKey: suppliedChecksumKey || savedCredentials.checksumKey
      };
      if (credentials.clientId.length > 500 || credentials.apiKey.length > 500 || (credentials.checksumKey && credentials.checksumKey.length > 500)) {
        response.status(400).json({ ok: false, message: 'ClickPesa credentials must be 500 characters or fewer.' });
        return;
      }
      encrypted = encryptPaymentCredentials(credentials);
    } else if (!firstCredential && !secondCredential && !suppliedChecksumKey && current?.provider === provider) {
      encrypted = {
        ciphertext: current.encrypted_credentials,
        iv: current.credentials_iv,
        authTag: current.credentials_auth_tag
      };
    } else {
      const missingCredential = provider === 'stakaba' ? !firstCredential : !firstCredential || !secondCredential;
      if (missingCredential || !firstCredential || firstCredential.length > 500 || (secondCredential && secondCredential.length > 500)) {
        response.status(400).json({ ok: false, message: provider === 'stakaba' ? 'Enter the Stakaba API key.' : 'Enter both credentials for the selected provider.' });
        return;
      }
      const credentials: PaymentProviderCredentials = provider === 'clickpesa'
        ? { provider, clientId: firstCredential, apiKey: secondCredential!, ...(suppliedChecksumKey ? { checksumKey: suppliedChecksumKey } : {}) }
        : provider === 'malipo'
          ? { provider, apiKey: firstCredential, secretKey: secondCredential! }
          : { provider, apiKey: firstCredential };
      encrypted = encryptPaymentCredentials(credentials);
    }

    if (provider === 'stakaba') {
      const stakabaKey = firstCredential || decryptPaymentCredentials<Extract<PaymentProviderCredentials, { provider: 'stakaba' }>>({
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag
      }).apiKey;
      if (!stakabaKey.startsWith(environment === 'sandbox' ? 'sk_test_' : 'sk_live_')) {
        response.status(400).json({ ok: false, message: `Use a Stakaba ${environment === 'sandbox' ? 'sandbox' : 'live'} API key for the selected environment.` });
        return;
      }
    }

    const { error: deselectError } = await supabase.from('tenant_payment_provider_settings')
      .update({ is_selected: false }).eq('tenant_id', tenantId);
    if (deselectError) throw deselectError;
    const { error: saveError } = await supabase.from('tenant_payment_provider_settings').upsert({
      tenant_id: tenantId,
      provider,
      environment,
      encrypted_credentials: encrypted.ciphertext,
      credentials_iv: encrypted.iv,
      credentials_auth_tag: encrypted.authTag,
      is_selected: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id,provider' });
    if (saveError) throw saveError;
    response.json({ ok: true, data: { provider, environment, configured: true } });
  } catch (error) {
    const isOwnerError = error instanceof Error && error.message.startsWith('Only the studio owner');
    const encryptionKeyError = error instanceof Error && error.message.startsWith('PAYMENT_CREDENTIALS_ENCRYPTION_KEY');
    if (!isOwnerError) console.error('tenant_payment_settings_save_failed', error);
    response.status(isOwnerError ? 403 : 500).json({
      ok: false,
      message: isOwnerError
        ? error.message
        : encryptionKeyError
          ? 'Payment encryption is not configured. Set PAYMENT_CREDENTIALS_ENCRYPTION_KEY on the API server and restart it.'
          : 'Unable to save payment settings. Check the server logs for details.'
    });
  }
});

const PROFILE_LOGO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_LOGO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

app.post('/api/profile/logo-upload-url', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as Pick<ImageBody, 'fileName' | 'mimeType' | 'fileSize'>;
  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim().toLowerCase();
  const fileSize = Number(body.fileSize);
  if (!fileName || !PROFILE_LOGO_MIME_TYPES.has(mimeType ?? '') || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > PROFILE_LOGO_MAX_BYTES) {
    response.status(400).json({ ok: false, message: 'Choose a JPG, PNG, or WEBP logo under 5 MB.' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${tenantContext.tenantId}/profile/${request.userId}/${randomUUID()}-${safeName}`;
  let reserved = false;
  try {
    await ensureTenantStorageRow(tenantContext.tenantId, tenantContext.extraBytes);
    const { data: quota, error: quotaError } = await supabase.rpc('reserve_tenant_storage', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: fileSize
    });
    if (quotaError) throw quotaError;
    if (!quota?.ok) {
      response.status(400).json({ ok: false, message: `Storage limit exceeded. You have ${humanizeBytes(Number(quota?.available_bytes ?? 0))} remaining.` });
      return;
    }
    reserved = true;
    const { url } = await createPresignedUploadUrl({ key: storagePath, contentType: mimeType as string, expiresIn: 300 });
    const { error: fileError } = await supabase.from('files').insert({
      tenant_id: tenantContext.tenantId,
      user_id: request.userId as string,
      gallery_id: null,
      filename: fileName,
      original_filename: fileName,
      storage_key: storagePath,
      size_bytes: fileSize,
      mime_type: mimeType,
      status: 'processing'
    });
    if (fileError) throw fileError;
    response.json({ ok: true, data: { signedUrl: url, storagePath, fileName, mimeType, fileSize } });
  } catch (error) {
    if (reserved) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath })
        .catch(() => supabase.rpc('release_tenant_storage', { p_tenant_id: tenantContext.tenantId, p_file_size_bytes: fileSize }));
    }
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to prepare logo upload.' });
  }
});

app.post('/api/profile/logo-upload-cancel', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const storagePath = String(request.body?.storagePath ?? '').trim();
  if (!storagePath) {
    response.status(400).json({ ok: false, message: 'Logo upload reservation is required.' });
    return;
  }
  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (!storagePath.startsWith(`${tenantContext.tenantId}/profile/${request.userId}/`)) {
    response.status(403).json({ ok: false, message: 'Logo path does not belong to this account.' });
    return;
  }
  try {
    const cancelled = await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath });
    response.json({ ok: true, data: { cancelled } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to cancel logo upload.' });
  }
});

app.post('/api/profile/logo', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as { storagePath?: string; mimeType?: string; fileSize?: number; clear?: boolean };
  const storagePath = body.storagePath?.trim();
  if (!body.clear && !storagePath) {
    response.status(400).json({ ok: false, message: 'Select a studio logo to upload.' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (storagePath && (!storagePath.startsWith(`${tenantContext.tenantId}/profile/${request.userId}/`) || !PROFILE_LOGO_MIME_TYPES.has(body.mimeType?.toLowerCase() ?? '') || !Number.isSafeInteger(body.fileSize) || Number(body.fileSize) <= 0 || Number(body.fileSize) > PROFILE_LOGO_MAX_BYTES)) {
    response.status(400).json({ ok: false, message: 'Logo upload details are invalid.' });
    return;
  }

  const { data: current, error: currentError } = await supabase.from('profiles').select('avatar_path, avatar_url')
    .eq('id', request.userId).maybeSingle();
  if (currentError || !current) {
    response.status(404).json({ ok: false, message: 'Studio profile not found.' });
    return;
  }

  let reservation: { id: string; size_bytes: number; mime_type: string } | null = null;
  if (storagePath) {
    const lookup = await supabase.from('files').select('id, size_bytes, mime_type')
      .eq('tenant_id', tenantContext.tenantId).is('gallery_id', null).eq('user_id', request.userId)
      .eq('storage_key', storagePath).eq('status', 'processing').maybeSingle();
    reservation = lookup.data;
    if (lookup.error || !reservation || Number(reservation.size_bytes) !== Number(body.fileSize) || reservation.mime_type !== body.mimeType) {
      response.status(404).json({ ok: false, message: 'Logo upload reservation not found.' });
      return;
    }
    if (!(await verifyObjectInR2(storagePath)) || await getR2ObjectSize(storagePath) !== Number(body.fileSize)) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath }).catch(() => false);
      response.status(400).json({ ok: false, message: 'Uploaded logo could not be verified.' });
      return;
    }
  }

  const { data: profile, error: updateError } = await supabase.from('profiles').update({
    avatar_url: null,
    avatar_path: storagePath ?? null,
    updated_at: new Date().toISOString()
  }).eq('id', request.userId).select('id, avatar_path').single();
  if (updateError || !profile) {
    if (storagePath && reservation) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath }).catch(() => false);
    }
    response.status(500).json({ ok: false, message: 'Unable to save studio logo.' });
    return;
  }

  if (storagePath && reservation) {
    const { error: fileUpdateError } = await supabase.from('files').update({ status: 'uploaded', updated_at: new Date().toISOString() }).eq('id', reservation.id);
    if (fileUpdateError) {
      await supabase.from('profiles').update({ avatar_url: current.avatar_url, avatar_path: current.avatar_path, updated_at: new Date().toISOString() }).eq('id', request.userId);
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath }).catch(() => false);
      response.status(500).json({ ok: false, message: 'Unable to finalize logo storage usage.' });
      return;
    }
    const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: Number(body.fileSize)
    });
    if (finalizeError || !finalized?.ok) {
      await supabase.from('profiles').update({ avatar_url: current.avatar_url, avatar_path: current.avatar_path, updated_at: new Date().toISOString() }).eq('id', request.userId);
      await supabase.from('files').update({ status: 'processing' }).eq('id', reservation.id);
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId: null, ownerId: request.userId as string, storagePath }).catch(() => false);
      response.status(500).json({ ok: false, message: 'Unable to finalize logo storage usage.' });
      return;
    }
  }

  if (current.avatar_path && current.avatar_path !== storagePath) {
    const previous = await supabase.from('files').select('id, size_bytes').eq('tenant_id', tenantContext.tenantId)
      .is('gallery_id', null).eq('user_id', request.userId).eq('storage_key', current.avatar_path).maybeSingle();
    await deleteObjectFromR2(current.avatar_path).catch(() => {});
    if (previous.data) {
      await supabase.from('files').delete().eq('id', previous.data.id);
      const { data: usage } = await supabase.from('tenant_storage').select('used_bytes').eq('tenant_id', tenantContext.tenantId).maybeSingle();
      await supabase.from('tenant_storage').update({
        used_bytes: Math.max(0, Number(usage?.used_bytes ?? 0) - Number(previous.data.size_bytes ?? 0)),
        updated_at: new Date().toISOString()
      }).eq('tenant_id', tenantContext.tenantId);
    }
  }

  const avatarUrl = profile.avatar_path ? await createPresignedDownloadUrl({ key: profile.avatar_path, expiresIn: 3600 }) : null;
  response.json({ ok: true, data: { avatarPath: profile.avatar_path, avatarUrl } });
});

app.get('/api/storage', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.vary('Authorization');
  try {
    const tenantContext = await ensureTenantForUser(request.userId as string);
    const currentPlanName = await supabase
      .from('tenant_subscriptions')
      .select('plan_id')
      .eq('tenant_id', tenantContext.tenantId)
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const planId = currentPlanName.data?.plan_id ?? null;
    const { data: planData } = planId
      ? await supabase.from('plans').select('name, storage_limit_bytes').eq('id', planId).maybeSingle()
      : { data: null };

    const effectiveLimitBytes = getEffectiveStorageLimit({
      planLimitBytes: tenantContext.planLimitBytes,
      extraBytes: tenantContext.extraBytes
    });
    const usedBytes = tenantContext.usedBytes;
    const reservedBytes = tenantContext.reservedBytes;
    const totalUsedBytes = usedBytes + reservedBytes;
    const remainingBytes = Math.max(0, effectiveLimitBytes - totalUsedBytes);
    const ratio = effectiveLimitBytes > 0 ? totalUsedBytes / effectiveLimitBytes : 0;

    response.json({
      ok: true,
      data: {
        tenantId: tenantContext.tenantId,
        planName: planData?.name ?? 'No active plan',
        planLimitBytes: tenantContext.planLimitBytes,
        extraBytes: tenantContext.extraBytes,
        effectiveLimitBytes,
        usedBytes,
        reservedBytes,
        remainingBytes,
        totalUsedBytes,
        usedDisplay: humanizeBytes(usedBytes),
        remainingDisplay: humanizeBytes(remainingBytes),
        limitDisplay: humanizeBytes(effectiveLimitBytes),
        warning: calculateStorageWarning(ratio)
      }
    });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to load storage usage' });
  }
});

app.get('/api/dashboard', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data: galleries, error } = await supabase
    .from('galleries')
    .select('id, title, slug, status, updated_at, image_count, cover_path, cover_preview_path, cover_processing_status, cover_design')
    .eq('owner_id', request.userId)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    response.status(500).json({ ok: false, message: error.message });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  const effectiveLimit = getEffectiveStorageLimit({
    planLimitBytes: tenantContext.planLimitBytes,
    extraBytes: tenantContext.extraBytes
  });

  const [{ data: profile }, { data: plan }, { data: orders }, { count: activeClients }] = await Promise.all([
    supabase.from('profiles').select('studio_name, display_name').eq('id', request.userId).maybeSingle(),
    supabase.from('tenant_subscriptions').select('plans(name)').eq('tenant_id', tenantContext.tenantId).eq('status', 'active').order('starts_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('orders').select('amount, currency, status').eq('owner_id', request.userId),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('owner_id', request.userId).eq('status', 'active')
  ]);
  const revenueByCurrency: Record<'TZS' | 'USD', number> = { TZS: 0, USD: 0 };
  const pendingByCurrency: Record<'TZS' | 'USD', number> = { TZS: 0, USD: 0 };
  (orders ?? []).forEach((order) => {
    const currency = order.currency as 'TZS' | 'USD';
    if (currency !== 'TZS' && currency !== 'USD') return;
    if (['SUCCESS', 'PAID', 'COMPLETED'].includes(String(order.status).toUpperCase())) {
      revenueByCurrency[currency] += Number(order.amount ?? 0);
    } else if (['PENDING', 'PROCESSING'].includes(String(order.status).toUpperCase())) {
      pendingByCurrency[currency] += Number(order.amount ?? 0);
    }
  });
  const planValue = Array.isArray(plan?.plans) ? plan.plans[0] : plan?.plans;

  const recentGalleries = await Promise.all((galleries ?? []).map(async (gallery) => {
    const imageCount = await syncGalleryImageCount(gallery.id, request.userId as string);
    return {
      id: gallery.id,
      title: gallery.title,
      slug: gallery.slug,
      status: gallery.status,
      updatedAt: gallery.updated_at,
      imageCount,
      coverDesign: gallery.cover_design ?? 'classic',
      coverUrl: gallery.cover_processing_status === 'ready' && gallery.cover_preview_path
        ? await createPresignedDownloadUrl({ key: gallery.cover_preview_path, expiresIn: 600 })
        : null
    };
  }));

  response.json({
    ok: true,
    data: {
      studioName: profile?.studio_name ?? profile?.display_name ?? '',
      activePlan: planValue?.name ?? '',
      storageUsed: tenantContext.usedBytes,
      storageLimit: effectiveLimit,
      revenueByCurrency,
      pendingByCurrency,
      activeClients: activeClients ?? 0,
      recentGalleries
    }
  });
});

app.get('/api/galleries', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  if (isDemoUser(request.userId)) {
    response.json({
      ok: true,
      data: getDemoGalleryList()
    });
    return;
  }

  const { data, error } = await supabase
    .from('galleries')
    .select('id, title, slug, status, access_price, currency, is_unlocked, image_count, cover_path, cover_preview_path, cover_processing_status, cover_video_url, cover_video_path, cover_design, updated_at')
    .eq('owner_id', request.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    response.status(500).json({ ok: false, message: error.message });
    return;
  }

  const galleriesWithCover = await Promise.all((data ?? []).map(async (gallery) => {
    const imageCount = await syncGalleryImageCount(gallery.id, request.userId as string);
    return {
      id: gallery.id,
      title: gallery.title,
      slug: gallery.slug,
      status: gallery.status,
      accessPrice: gallery.access_price,
      currency: gallery.currency,
      isUnlocked: gallery.is_unlocked,
      imageCount,
      coverDesign: gallery.cover_design ?? 'classic',
      updatedAt: gallery.updated_at,
      coverUrl: gallery.cover_processing_status === 'ready' && gallery.cover_preview_path
        ? await createPresignedDownloadUrl({ key: gallery.cover_preview_path, expiresIn: 600 })
        : null
    };
  }));

  response.json({
    ok: true,
    data: galleriesWithCover
  });
});

app.get('/api/galleries/:galleryId', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);

  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }

    const coverUrl = gallery.cover_path
      ? `${process.env.R2_PUBLIC_URL ?? 'https://images.r2.dev'}/${encodeURIComponent(gallery.cover_path)}`
      : null;
    response.json({
      ok: true,
      data: {
        id: gallery.id,
        title: gallery.title,
        slug: gallery.slug,
        status: gallery.status,
        access_price: gallery.access_price,
        currency: gallery.currency,
        is_unlocked: gallery.is_unlocked,
        image_count: gallery.images.length,
        imageCount: gallery.images.length,
        cover_path: gallery.cover_path,
        coverUrl,
        updated_at: gallery.updated_at,
        accessPrice: gallery.access_price,
        isUnlocked: gallery.is_unlocked,
        coverPath: gallery.cover_path,
        coverVideoPath: gallery.cover_video_path,
        coverVideoUrl: gallery.cover_video_url
      }
    });
    return;
  }

  const { data: gallery, error } = await supabase
    .from('galleries')
    .select('id, title, slug, status, access_price, currency, is_unlocked, image_count, cover_path, cover_preview_path, cover_processing_status, cover_video_url, cover_video_path, cover_design, updated_at')
    .eq('id', request.params.galleryId)
    .eq('owner_id', request.userId)
    .single();

  if (error || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  const coverUrl = gallery.cover_processing_status === 'ready' && gallery.cover_preview_path
    ? await createPresignedDownloadUrl({ key: gallery.cover_preview_path, expiresIn: 600 })
    : null;
  const coverVideoUrl = gallery.cover_video_url || (gallery.cover_video_path
    ? await createPresignedDownloadUrl({ key: gallery.cover_video_path, expiresIn: 3600 })
    : null);
  response.json({ ok: true, data: { ...gallery, accessPrice: gallery.access_price, isUnlocked: gallery.is_unlocked, imageCount: gallery.image_count, coverDesign: gallery.cover_design ?? 'classic', coverUrl, coverVideoUrl } });
});

app.put('/api/galleries/:galleryId', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);
  const body = request.body as GalleryBody;
  const title = body.title?.trim();
  const accessPrice = Number(body.accessPrice ?? 0);
  const currency = body.currency ?? 'TZS';
  const coverDesign = body.coverDesign ?? 'classic';
  if (!title || title.length > 120 || !Number.isFinite(accessPrice) || accessPrice < 0 || !['TZS', 'USD'].includes(currency) || !isGalleryCoverDesign(coverDesign)) {
    response.status(400).json({ ok: false, message: 'A valid title, price, and currency are required' });
    return;
  }

  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery || gallery.owner_id !== request.userId) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }
    gallery.title = title;
    gallery.access_price = accessPrice;
    gallery.currency = currency;
    gallery.cover_design = coverDesign;
    gallery.is_unlocked = accessPrice === 0;
    gallery.status = gallery.is_unlocked ? 'published' : 'locked';
    gallery.updated_at = new Date().toISOString();
    response.json({
      ok: true,
      data: {
        id: gallery.id,
        title: gallery.title,
        slug: gallery.slug,
        status: gallery.status,
        access_price: gallery.access_price,
        accessPrice: gallery.access_price,
        currency: gallery.currency,
        is_unlocked: gallery.is_unlocked,
        isUnlocked: gallery.is_unlocked,
        image_count: gallery.images.length,
        imageCount: gallery.images.length,
        updated_at: gallery.updated_at,
        cover_path: gallery.cover_path,
        coverPath: gallery.cover_path,
        coverDesign: gallery.cover_design ?? 'classic'
      }
    });
    return;
  }

  const { data: currentGallery, error: lookupError } = await supabase
    .from('galleries')
    .select('id, is_unlocked')
    .eq('id', galleryId)
    .eq('owner_id', request.userId)
    .maybeSingle();
  if (lookupError || !currentGallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  const isUnlocked = accessPrice === 0;
  const { data, error } = await supabase
    .from('galleries')
    .update({
      title,
      access_price: accessPrice,
      currency,
      cover_design: coverDesign,
      is_unlocked: isUnlocked,
      status: isUnlocked ? 'published' : 'locked',
      updated_at: new Date().toISOString()
    })
    .eq('id', galleryId)
    .eq('owner_id', request.userId)
    .select('id, title, slug, status, access_price, currency, is_unlocked, image_count, cover_path, cover_design, updated_at')
    .single();
  if (error || !data) {
    console.error('gallery_update_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to save gallery changes right now.' });
    return;
  }
  response.json({
    ok: true,
    data: {
      ...data,
      accessPrice: data.access_price,
      isUnlocked: data.is_unlocked,
      imageCount: data.image_count,
      coverPath: data.cover_path,
      coverDesign: data.cover_design ?? 'classic'
    }
  });
});

app.get('/api/galleries/:galleryId/images', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);
  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery || gallery.owner_id !== request.userId) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }
    response.json({
      ok: true,
      data: await Promise.all(gallery.images.map(async (image) => ({
        id: image.id,
        storagePath: image.storage_path,
        fileName: image.file_name,
        mimeType: image.mime_type,
        fileSize: image.file_size,
        processingStatus: 'ready' as const,
        previewUrl: await createPresignedDownloadUrl({ key: image.storage_path, expiresIn: 600 })
      })))
    });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id')
    .eq('id', galleryId)
    .eq('owner_id', request.userId)
    .maybeSingle();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  const { data: images, error } = await supabase
    .from('gallery_images')
    .select('id, storage_path, preview_path, processing_status, file_name, mime_type, file_size')
    .eq('gallery_id', galleryId)
    .eq('owner_id', request.userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('gallery_edit_images_lookup_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load gallery photos right now.' });
    return;
  }
  response.json({
    ok: true,
    data: await Promise.all((images ?? []).map(async (image) => ({
      id: image.id,
      storagePath: image.storage_path,
      fileName: image.file_name,
      mimeType: image.mime_type,
      fileSize: image.file_size,
      processingStatus: image.processing_status,
      previewUrl: image.processing_status === 'ready' && image.preview_path
        ? await createPresignedDownloadUrl({ key: image.preview_path, expiresIn: 600 })
        : null
    })))
  });
});

app.get('/api/clients', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('clients').select('id, display_name, email, phone, status, notes, created_at, updated_at').eq('owner_id', request.userId).order('updated_at', { ascending: false });
  if (error) { response.status(500).json({ ok: false, message: error.message }); return; }
  response.json({ ok: true, data: data ?? [] });
});

app.get('/api/performance', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc('get_performance_summary', {
    p_owner_id: request.userId,
    p_since: since
  });
  if (error) {
    console.error('performance_summary_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load performance metrics.' });
    return;
  }
  const summary = (data ?? {}) as Record<string, unknown>;
  const publishedGalleryCount = Number(summary.publishedGalleryCount ?? 0);
  const viewedGalleryCount = Number(summary.viewedGalleryCount ?? 0);
  const buyerCount = Number(summary.buyerCount ?? 0);
  const repeatBuyerCount = Number(summary.repeatBuyerCount ?? 0);
  response.json({ ok: true, data: {
    galleryViewRate: publishedGalleryCount > 0 ? Math.round(viewedGalleryCount / publishedGalleryCount * 1000) / 10 : null,
    publishedGalleryCount,
    viewedGalleryCount,
    viewCount: Number(summary.viewCount ?? 0),
    uniqueVisitorCount: Number(summary.uniqueVisitorCount ?? 0),
    repeatClientRate: buyerCount > 0 ? Math.round(repeatBuyerCount / buyerCount * 1000) / 10 : null,
    repeatBuyerCount,
    buyerCount,
    galleryViews: Array.isArray(summary.galleryViews) ? summary.galleryViews : []
  } });
});

app.post('/api/clients', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as ClientBody;
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) { response.status(400).json({ ok: false, message: 'Client name and valid email are required' }); return; }
  const { data, error } = await supabase.from('clients').insert({ owner_id: request.userId, display_name: name, email, phone: body.phone?.trim() || null, notes: body.notes?.trim() || null }).select('id, display_name, email, phone, status, notes, created_at, updated_at').single();
  if (error || !data) { response.status(400).json({ ok: false, message: error?.message ?? 'Unable to save client' }); return; }
  response.status(201).json({ ok: true, data });
});

app.post('/api/quotes', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as QuoteBody;
  const amount = Number(body.amount);
  if (!body.clientName?.trim() || !Number.isFinite(amount) || amount <= 0) { response.status(400).json({ ok: false, message: 'Client and valid quote amount are required' }); return; }
  const { data, error } = await supabase.from('quotes').insert({ owner_id: request.userId, client_id: body.clientId || null, client_name: body.clientName.trim(), client_email: body.clientEmail?.trim() || null, amount, notes: body.notes?.trim() || null }).select('id, client_name, client_email, amount, notes, status, created_at').single();
  if (error || !data) { response.status(400).json({ ok: false, message: error?.message ?? 'Unable to save quote' }); return; }
  response.status(201).json({ ok: true, data });
});

app.get('/api/orders', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('orders').select('id, order_reference, customer_name, customer_email, amount, currency, status, provider, created_at, gallery_id').eq('owner_id', request.userId).order('created_at', { ascending: false });
  if (error) { response.status(500).json({ ok: false, message: error.message }); return; }
  response.json({ ok: true, data: data ?? [] });
});

app.post('/api/orders/manual', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as ManualOrderBody;
  const amount = Number(body.amount);
  if (!body.clientName?.trim() || !body.galleryName?.trim() || !Number.isFinite(amount) || amount <= 0) { response.status(400).json({ ok: false, message: 'Client, gallery, and valid amount are required' }); return; }
  const reference = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await supabase.from('orders').insert({ owner_id: request.userId, order_reference: reference, customer_name: body.clientName.trim(), amount, currency: 'TZS', status: 'PENDING', provider: `manual:${body.method ?? 'other'}`, provider_payload: { galleryName: body.galleryName.trim() } }).select('id, order_reference, customer_name, amount, currency, status, provider, created_at').single();
  if (error || !data) { response.status(400).json({ ok: false, message: error?.message ?? 'Unable to save manual order' }); return; }
  response.status(201).json({ ok: true, data });
});

const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

app.delete('/api/galleries/:galleryId', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);

  if (isDemoUser(request.userId)) {
    const index = demoGalleryStore.findIndex((gallery) => gallery.id === galleryId && gallery.owner_id === request.userId);
    if (index === -1) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }

    demoGalleryStore.splice(index, 1);
    response.json({ ok: true, data: { id: galleryId, deleted: true } });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, owner_id, cover_path, cover_preview_path, cover_preview_size, image_count')
    .eq('id', galleryId)
    .eq('owner_id', request.userId)
    .single();

  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  const { data: images, error: imageError } = await supabase
    .from('gallery_images')
    .select('file_size, preview_size, medium_size, large_size, storage_path, preview_path, medium_path, large_path')
    .eq('gallery_id', galleryId);

  if (imageError) {
    console.error('gallery_delete_images_lookup_failed', imageError);
    response.status(500).json({ ok: false, message: 'Unable to delete this gallery right now. Please try again.' });
    return;
  }

  const { data: galleryFiles, error: fileLookupError } = await supabase.from('files')
    .select('storage_key, size_bytes, status')
    .eq('gallery_id', galleryId)
    .eq('user_id', request.userId as string);
  if (fileLookupError) {
    console.error('gallery_delete_files_lookup_failed', fileLookupError);
    response.status(500).json({ ok: false, message: 'Unable to delete this gallery right now. Please try again.' });
    return;
  }

  const imageStoragePaths = new Set((images ?? []).map((image) => image.storage_path));
  const variantBytes = (images ?? []).reduce((total, image) =>
    total + Number(image.file_size ?? 0) + Number(image.preview_size ?? 0) +
      Number(image.medium_size ?? 0) + Number(image.large_size ?? 0), 0);
  const standaloneUsedBytes = (galleryFiles ?? []).reduce((total, file) =>
    total + (file.status !== 'processing' && !imageStoragePaths.has(file.storage_key) ? Number(file.size_bytes ?? 0) : 0), 0);
  const pendingReservationBytes = (galleryFiles ?? []).reduce((total, file) =>
    total + (file.status === 'processing' && !imageStoragePaths.has(file.storage_key) ? Number(file.size_bytes ?? 0) : 0), 0);
  const standaloneCoverPreviewBytes = gallery.cover_path && imageStoragePaths.has(gallery.cover_path)
    ? 0
    : Number(gallery.cover_preview_size ?? 0);
  const removedBytes = variantBytes + standaloneUsedBytes + standaloneCoverPreviewBytes;
  const objectKeys = [
    ...(images ?? []).flatMap((image) => [
      image.storage_path,
      image.preview_path,
      image.medium_path,
      image.large_path,
      `${image.storage_path}.preview.webp`,
      `${image.storage_path}.medium.webp`,
      `${image.storage_path}.large.webp`
    ]),
    ...(galleryFiles ?? []).map((file) => file.storage_key),
    ...(gallery.cover_preview_path ? [gallery.cover_preview_path] : []),
    ...(gallery.cover_path ? [`${gallery.cover_path}.cover.webp`] : [])
  ];
  try {
    await deleteR2Objects(objectKeys);
  } catch (error) {
    console.error('gallery_delete_r2_objects_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to remove all gallery photos from storage. Please retry.' });
    return;
  }

  const { error: deleteFilesError } = await supabase.from('files').delete().eq('gallery_id', galleryId).eq('user_id', request.userId as string);
  if (deleteFilesError) {
    console.error('gallery_delete_files_failed', deleteFilesError);
    response.status(500).json({ ok: false, message: 'Unable to delete this gallery right now. Please try again.' });
    return;
  }

  const { error: deleteImagesError } = await supabase.from('gallery_images').delete().eq('gallery_id', galleryId);
  if (deleteImagesError) {
    console.error('gallery_delete_images_failed', deleteImagesError);
    response.status(500).json({ ok: false, message: 'Unable to delete this gallery right now. Please try again.' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (removedBytes > 0) {
    const { data: usageRemoval, error: usageRemovalError } = await supabase.rpc('remove_tenant_storage_usage', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: removedBytes
    });
    if (usageRemovalError || !usageRemoval?.ok) {
      console.error('gallery_delete_storage_usage_update_failed', usageRemovalError ?? usageRemoval);
      response.status(500).json({ ok: false, message: 'Photos were removed, but storage usage could not be updated. Please contact support.' });
      return;
    }
  }
  if (pendingReservationBytes > 0) {
    const { error: reservationReleaseError } = await supabase.rpc('release_tenant_storage', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: pendingReservationBytes
    });
    if (reservationReleaseError) {
      console.error('gallery_delete_pending_storage_release_failed', reservationReleaseError);
      response.status(500).json({ ok: false, message: 'Photos were removed, but pending storage reservations could not be released.' });
      return;
    }
  }

  const { error: deleteGalleryError } = await supabase.from('galleries').delete().eq('id', galleryId).eq('owner_id', request.userId);
  if (deleteGalleryError) {
    console.error('gallery_delete_record_failed', deleteGalleryError);
    response.status(500).json({ ok: false, message: 'Unable to delete this gallery right now. Please try again.' });
    return;
  }

  response.json({ ok: true, data: { id: galleryId, deleted: true } });
});

app.post('/api/galleries', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as GalleryBody;
  const title = body.title?.trim();
  const accessPrice = Number(body.accessPrice ?? 0);
  const currency = body.currency ?? 'TZS';
  const coverDesign = body.coverDesign ?? 'classic';

  if (!title || title.length > 120 || !Number.isFinite(accessPrice) || accessPrice < 0 || !['TZS', 'USD'].includes(currency) || !isGalleryCoverDesign(coverDesign)) {
    response.status(400).json({ ok: false, message: 'A valid title, price, and currency are required' });
    return;
  }

  if (isDemoUser(request.userId)) {
    const userId = request.userId as string;
    const galleryId = randomUUID();
    const createdGallery = {
      id: galleryId,
      owner_id: userId,
      title,
      slug: `${slugify(title) || 'gallery'}-${galleryId.slice(0, 8)}`,
      status: accessPrice === 0 ? 'published' : 'locked',
      access_price: accessPrice,
      currency,
      cover_design: coverDesign,
      is_unlocked: accessPrice === 0,
      image_count: 0,
      cover_path: null,
      cover_video_url: null,
      cover_video_path: null,
      updated_at: new Date().toISOString(),
      images: [] as DemoGalleryImage[]
    } satisfies DemoGalleryRecord;

    demoGalleryStore.unshift(createdGallery);
    response.status(201).json({
      ok: true,
      data: {
        id: createdGallery.id,
        title: createdGallery.title,
        slug: createdGallery.slug,
        status: createdGallery.status,
        access_price: createdGallery.access_price,
        currency: createdGallery.currency,
        cover_design: createdGallery.cover_design,
        is_unlocked: createdGallery.is_unlocked,
        image_count: createdGallery.image_count,
        updated_at: createdGallery.updated_at
      }
    });
    return;
  }

  const galleryId = randomUUID();
  const { data, error } = await supabase.from('galleries').insert({
    id: galleryId,
    owner_id: request.userId,
    title,
    slug: `${slugify(title) || 'gallery'}-${galleryId.slice(0, 8)}`,
    status: accessPrice === 0 ? 'published' : 'locked',
    access_price: accessPrice,
    currency,
    cover_design: coverDesign,
    is_unlocked: accessPrice === 0
  }).select('id, title, slug, status, access_price, currency, is_unlocked, image_count, cover_design, updated_at').single();

  if (error || !data) {
    response.status(500).json({ ok: false, message: error?.message ?? 'Unable to create gallery' });
    return;
  }

  response.status(201).json({ ok: true, data });
});

const imageVariantJobs = new Set<string>();
const MAX_CONCURRENT_IMAGE_VARIANT_JOBS = 2;

const processGalleryImageVariants = async (imageId: string): Promise<void> => {
  const jobKey = `image:${imageId}`;
  if (imageVariantJobs.has(jobKey) || imageVariantJobs.size >= MAX_CONCURRENT_IMAGE_VARIANT_JOBS) return;
  imageVariantJobs.add(jobKey);

  let variantReservation = 0;
  let reservationActive = false;
  let tenantId = '';
  let originalSize = 0;
  let previousVariantState: {
    preview_path: string | null;
    preview_size: number;
    preview_width: number;
    preview_height: number;
    medium_path: string | null;
    medium_size: number;
    medium_width: number;
    medium_height: number;
    large_path: string | null;
    large_size: number;
    large_width: number;
    large_height: number;
  } | null = null;
  let storedVariantKeys: string[] = [];
  try {
    const { data: claimedImage, error: claimError } = await supabase
      .from('gallery_images')
      .update({ processing_status: 'processing', processing_started_at: new Date().toISOString() })
      .eq('id', imageId)
      .eq('processing_status', 'queued')
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimedImage) return;

    const { data: image, error: imageError } = await supabase
      .from('gallery_images')
      .select('id, tenant_id, storage_path, file_size, preview_path, preview_size, preview_width, preview_height, medium_path, medium_size, medium_width, medium_height, large_path, large_size, large_width, large_height')
      .eq('id', imageId)
      .single();
    if (imageError || !image) throw imageError ?? new Error('Queued image metadata was not found.');

    tenantId = image.tenant_id;
    originalSize = Number(image.file_size);
    previousVariantState = {
      preview_path: image.preview_path,
      preview_size: Number(image.preview_size ?? 0),
      preview_width: Number(image.preview_width ?? 0),
      preview_height: Number(image.preview_height ?? 0),
      medium_path: image.medium_path,
      medium_size: Number(image.medium_size ?? 0),
      medium_width: Number(image.medium_width ?? 0),
      medium_height: Number(image.medium_height ?? 0),
      large_path: image.large_path,
      large_size: Number(image.large_size ?? 0),
      large_width: Number(image.large_width ?? 0),
      large_height: Number(image.large_height ?? 0)
    };
    const variants: Array<{ name: 'preview' | 'medium' | 'large'; width: number; height: number; quality: number }> = [
      { name: 'preview', width: 380, height: 480, quality: 72 },
      { name: 'medium', width: 1200, height: 1500, quality: 78 },
      { name: 'large', width: 2000, height: 2500, quality: 82 }
    ];
    const existingPaths = {
      preview: image.preview_path,
      medium: image.medium_path,
      large: image.large_path
    };
    const outputs: Array<{
      name: 'preview' | 'medium' | 'large';
      key: string;
      buffer: Buffer;
      width: number;
      height: number;
      size: number;
    }> = [];

    for (const variant of variants) {
      if (existingPaths[variant.name]) continue;
      const source = await getR2ObjectStream(image.storage_path);
      const transformer = sharp()
        .rotate()
        .resize({ width: variant.width, height: variant.height, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant.quality, effort: 4 });
      const outputPromise = transformer.toBuffer({ resolveWithObject: true });
      await pipeline(source, transformer);
      const output = await outputPromise;
      outputs.push({
        name: variant.name,
        key: `${image.storage_path}.${variant.name}.webp`,
        buffer: output.data,
        width: output.info.width,
        height: output.info.height,
        size: output.data.byteLength
      });
    }

    variantReservation = outputs.reduce((total, output) => total + output.size, 0);
    if (variantReservation > 0) {
      const { data: reservation, error: reservationError } = await supabase.rpc('reserve_tenant_storage', {
        p_tenant_id: tenantId,
        p_file_size_bytes: variantReservation
      });
      if (reservationError) throw reservationError;
      if (!reservation?.ok) throw new Error('There is not enough plan storage available for optimized previews.');
      reservationActive = true;
    }

    for (const output of outputs) {
      await putBufferToR2({
        key: output.key,
        contentType: 'image/webp',
        body: output.buffer,
        cacheControl: 'private, max-age=31536000, immutable'
      });
      storedVariantKeys.push(output.key);
    }

    const byName = new Map(outputs.map((output) => [output.name, output]));
    const preview = byName.get('preview') ?? (image.preview_path ? {
      key: image.preview_path,
      size: Number(image.preview_size ?? 0),
      width: Number(image.preview_width ?? 0),
      height: Number(image.preview_height ?? 0)
    } : undefined);
    const medium = byName.get('medium') ?? (image.medium_path ? {
      key: image.medium_path,
      size: Number(image.medium_size ?? 0),
      width: Number(image.medium_width ?? 0),
      height: Number(image.medium_height ?? 0)
    } : undefined);
    const large = byName.get('large') ?? (image.large_path ? {
      key: image.large_path,
      size: Number(image.large_size ?? 0),
      width: Number(image.large_width ?? 0),
      height: Number(image.large_height ?? 0)
    } : undefined);
    if (!preview || !medium || !large) throw new Error('One or more image variants were not generated.');

    const { data: updatedImage, error: imageUpdateError } = await supabase
      .from('gallery_images')
      .update({
        preview_path: preview.key,
        preview_size: preview.size,
        preview_width: preview.width,
        preview_height: preview.height,
        medium_path: medium.key,
        medium_size: medium.size,
        medium_width: medium.width,
        medium_height: medium.height,
        large_path: large.key,
        large_size: large.size,
        large_width: large.width,
        large_height: large.height,
        processing_status: 'ready',
        processing_started_at: null
      })
      .eq('id', image.id)
      .eq('processing_status', 'processing')
      .select('id')
      .maybeSingle();
    if (imageUpdateError) throw imageUpdateError;
    if (!updatedImage) throw new Error('The image processing state changed before the variants were saved.');

    const { error: coverUpdateError } = await supabase.from('galleries')
      .update({
        cover_preview_path: preview.key,
        cover_preview_size: preview.size,
        cover_preview_width: preview.width,
        cover_preview_height: preview.height,
        cover_processing_status: 'ready',
        cover_processing_started_at: null
      })
      .eq('cover_path', image.storage_path)
      .in('cover_processing_status', ['queued', 'processing']);
    if (coverUpdateError) console.error('gallery_cover_preview_update_failed', { imageId, error: coverUpdateError });

    const { data: updatedFile, error: fileUpdateError } = await supabase
      .from('files')
      .update({
        size_bytes: originalSize + preview.size + medium.size + large.size,
        status: 'uploaded',
        updated_at: new Date().toISOString()
      })
      .eq('id', image.id)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle();
    if (fileUpdateError) throw fileUpdateError;
    if (!updatedFile) throw new Error('Storage metadata for the image was not found.');

    if (variantReservation > 0) {
      const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
        p_tenant_id: tenantId,
        p_file_size_bytes: variantReservation
      });
      if (finalizeError) throw finalizeError;
      if (!finalized?.ok) throw new Error('Unable to finalize storage for the image previews.');
      reservationActive = false;
    }
  } catch (error) {
    console.error('gallery_image_variants_failed', { imageId, error });
    if (reservationActive && tenantId) {
      const { error: releaseError } = await supabase.rpc('release_tenant_storage', {
        p_tenant_id: tenantId,
        p_file_size_bytes: variantReservation
      });
      if (releaseError) console.error('gallery_image_variant_reservation_release_failed', { imageId, error: releaseError });
    }
    if (tenantId) {
      const { error: fileFailureError } = await supabase.from('files').update({
        size_bytes: originalSize + Number(previousVariantState?.preview_size ?? 0) +
          Number(previousVariantState?.medium_size ?? 0) + Number(previousVariantState?.large_size ?? 0),
        status: 'failed',
        updated_at: new Date().toISOString()
      }).eq('id', imageId).eq('tenant_id', tenantId);
      if (fileFailureError) console.error('gallery_image_file_failure_update_failed', { imageId, error: fileFailureError });
    }
    await Promise.all(storedVariantKeys.map((key) => deleteObjectFromR2(key).catch((deleteError) => {
      console.error('gallery_image_variant_cleanup_failed', { imageId, key, error: deleteError });
    })));
    const { error: imageFailureError } = await supabase.from('gallery_images').update({
      ...(previousVariantState ?? {}),
      processing_status: 'failed',
      processing_started_at: null
    }).eq('id', imageId).in('processing_status', ['processing', 'ready']);
    if (imageFailureError) console.error('gallery_image_failure_update_failed', { imageId, error: imageFailureError });
  } finally {
    imageVariantJobs.delete(jobKey);
  }
};

const processGalleryCoverVariant = async (galleryId: string): Promise<void> => {
  const jobKey = `cover:${galleryId}`;
  if (imageVariantJobs.has(jobKey) || imageVariantJobs.size >= MAX_CONCURRENT_IMAGE_VARIANT_JOBS) return;
  imageVariantJobs.add(jobKey);

  let tenantId = '';
  let coverPath = '';
  let coverFileId = '';
  let coverFileStatus = '';
  let originalSize = 0;
  let reservedOriginalSize = 0;
  let storedFileSize = 0;
  let previewSize = 0;
  let reservationActive = false;
  let originalReservationActive = false;
  let variantStored = false;
  try {
    const { data: claimedGallery, error: claimError } = await supabase.from('galleries')
      .update({ cover_processing_status: 'processing', cover_processing_started_at: new Date().toISOString() })
      .eq('id', galleryId)
      .eq('cover_processing_status', 'queued')
      .select('id, tenant_id, cover_path')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimedGallery) return;
    if (!claimedGallery.cover_path) {
      const { error } = await supabase.from('galleries').update({
        cover_preview_path: null,
        cover_preview_size: 0,
        cover_preview_width: 0,
        cover_preview_height: 0,
        cover_processing_status: 'ready',
        cover_processing_started_at: null
      }).eq('id', galleryId).eq('cover_processing_status', 'processing');
      if (error) throw error;
      return;
    }

    tenantId = claimedGallery.tenant_id;
    coverPath = claimedGallery.cover_path;

    const { data: galleryImage, error: galleryImageError } = await supabase.from('gallery_images')
      .select('preview_path, preview_size, preview_width, preview_height, processing_status')
      .eq('gallery_id', galleryId)
      .eq('storage_path', coverPath)
      .maybeSingle();
    if (galleryImageError) throw galleryImageError;
    if (galleryImage) {
      if (galleryImage.processing_status === 'ready' && galleryImage.preview_path) {
        const { error } = await supabase.from('galleries').update({
          cover_preview_path: galleryImage.preview_path,
          cover_preview_size: galleryImage.preview_size,
          cover_preview_width: galleryImage.preview_width,
          cover_preview_height: galleryImage.preview_height,
          cover_processing_status: 'ready',
          cover_processing_started_at: null
        }).eq('id', galleryId).eq('cover_path', coverPath).eq('cover_processing_status', 'processing');
        if (error) throw error;
      } else if (galleryImage.processing_status === 'queued' || galleryImage.processing_status === 'processing') {
        const { error } = await supabase.from('galleries').update({
          cover_processing_status: 'queued',
          cover_processing_started_at: null
        }).eq('id', galleryId).eq('cover_path', coverPath).eq('cover_processing_status', 'processing');
        if (error) throw error;
      } else {
        const { error } = await supabase.from('galleries').update({
          cover_processing_status: 'failed',
          cover_processing_started_at: null
        }).eq('id', galleryId).eq('cover_path', coverPath).eq('cover_processing_status', 'processing');
        if (error) throw error;
      }
      return;
    }

    const { data: coverFile, error: coverFileError } = await supabase.from('files')
      .select('id, size_bytes, status')
      .eq('tenant_id', tenantId)
      .eq('gallery_id', galleryId)
      .eq('storage_key', coverPath)
      .maybeSingle();
    if (coverFileError) throw coverFileError;
    if (!coverFile) throw new Error('Gallery cover file record was not found.');
    coverFileId = coverFile.id;
    coverFileStatus = coverFile.status;
    storedFileSize = Number(coverFile.size_bytes);
    reservedOriginalSize = storedFileSize;
    originalReservationActive = coverFileStatus === 'processing';
    originalSize = await getR2ObjectSize(coverPath);
    if (coverFileStatus === 'processing') {
      if (reservedOriginalSize !== originalSize) {
        throw new Error('Uploaded cover size did not match its storage reservation.');
      }
    }

    const source = await getR2ObjectStream(coverPath);
    const transformer = sharp()
      .rotate()
      .resize({ width: 1600, height: 1000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 });
    const outputPromise = transformer.toBuffer({ resolveWithObject: true });
    await pipeline(source, transformer);
    const output = await outputPromise;
    previewSize = output.data.byteLength;
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_tenant_storage', {
      p_tenant_id: tenantId,
      p_file_size_bytes: previewSize
    });
    if (reservationError) throw reservationError;
    if (!reservation?.ok) throw new Error('There is not enough plan storage available for the cover preview.');
    reservationActive = true;

    const previewPath = `${coverPath}.cover.webp`;
    await putBufferToR2({
      key: previewPath,
      contentType: 'image/webp',
      body: output.data,
      cacheControl: 'private, max-age=31536000, immutable'
    });
    variantStored = true;

    const { data: updatedGallery, error: galleryUpdateError } = await supabase.from('galleries').update({
      cover_preview_path: previewPath,
      cover_preview_size: previewSize,
      cover_preview_width: output.info.width,
      cover_preview_height: output.info.height,
      cover_processing_status: 'ready',
      cover_processing_started_at: null
    }).eq('id', galleryId).eq('cover_path', coverPath).eq('cover_processing_status', 'processing')
      .select('id')
      .maybeSingle();
    if (galleryUpdateError) throw galleryUpdateError;
    if (!updatedGallery) throw new Error('The cover changed before its preview was saved.');
    const { error: fileUpdateError } = await supabase.from('files').update({
      size_bytes: originalSize + previewSize,
      status: 'uploaded',
      updated_at: new Date().toISOString()
    }).eq('id', coverFile.id).eq('tenant_id', tenantId);
    if (fileUpdateError) throw fileUpdateError;
    if (originalReservationActive) {
      const { data: originalFinalized, error: originalFinalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
        p_tenant_id: tenantId,
        p_file_size_bytes: originalSize
      });
      if (originalFinalizeError) throw originalFinalizeError;
      if (!originalFinalized?.ok) throw new Error('Unable to finalize storage for the cover upload.');
      originalReservationActive = false;
    }
    const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
      p_tenant_id: tenantId,
      p_file_size_bytes: previewSize
    });
    if (finalizeError) throw finalizeError;
    if (!finalized?.ok) throw new Error('Unable to finalize storage for the cover preview.');
    reservationActive = false;
  } catch (error) {
    console.error('gallery_cover_preview_failed', { galleryId, coverPath, error });
    if (reservationActive && tenantId) {
      const { error: releaseError } = await supabase.rpc('release_tenant_storage', {
        p_tenant_id: tenantId,
        p_file_size_bytes: previewSize
      });
      if (releaseError) console.error('gallery_cover_reservation_release_failed', { galleryId, error: releaseError });
    }
    if (originalReservationActive && tenantId && originalSize > 0) {
      const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
        p_tenant_id: tenantId,
        p_file_size_bytes: originalSize
      });
      if (finalizeError || !finalized?.ok) {
        console.error('gallery_cover_original_storage_finalize_failed', { galleryId, error: finalizeError ?? finalized });
      } else {
        originalReservationActive = false;
      }
    }
    if (variantStored && coverPath) {
      await deleteObjectFromR2(`${coverPath}.cover.webp`).catch((deleteError) => {
        console.error('gallery_cover_variant_cleanup_failed', { galleryId, error: deleteError });
      });
    }
    if (coverPath) {
      const { error: galleryFailureError } = await supabase.from('galleries').update({
        cover_preview_path: null,
        cover_preview_size: 0,
        cover_preview_width: 0,
        cover_preview_height: 0,
        cover_processing_status: 'failed',
        cover_processing_started_at: null
      }).eq('id', galleryId).eq('cover_path', coverPath).in('cover_processing_status', ['processing', 'ready']);
      if (galleryFailureError) console.error('gallery_cover_failure_update_failed', { galleryId, error: galleryFailureError });
    }
    if (coverFileId && tenantId) {
      const { error: fileFailureError } = await supabase.from('files').update({
        size_bytes: originalReservationActive ? reservedOriginalSize : originalSize || storedFileSize,
        status: coverFileStatus === 'processing' && originalReservationActive ? 'processing' : 'uploaded',
        updated_at: new Date().toISOString()
      }).eq('id', coverFileId).eq('tenant_id', tenantId);
      if (fileFailureError) console.error('gallery_cover_file_failure_update_failed', { galleryId, error: fileFailureError });
    }
  } finally {
    imageVariantJobs.delete(jobKey);
  }
};

const resumeQueuedImageVariantJobs = async (): Promise<void> => {
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let staleQuery = supabase
    .from('gallery_images')
    .update({ processing_status: 'queued', processing_started_at: null })
    .eq('processing_status', 'processing');
  staleQuery = staleQuery.lt('processing_started_at', staleBefore);
  const { error: staleJobsError } = await staleQuery;
  if (staleJobsError) {
    console.error('gallery_image_variant_recovery_failed', staleJobsError);
    return;
  }

  const { error: staleCoversError } = await supabase.from('galleries')
    .update({ cover_processing_status: 'queued', cover_processing_started_at: null })
    .eq('cover_processing_status', 'processing')
    .lt('cover_processing_started_at', staleBefore);
  if (staleCoversError) {
    console.error('gallery_cover_recovery_failed', staleCoversError);
    return;
  }

  let availableSlots = MAX_CONCURRENT_IMAGE_VARIANT_JOBS - imageVariantJobs.size;
  if (availableSlots <= 0) return;
  const { data: queuedImages, error } = await supabase
    .from('gallery_images')
    .select('id')
    .eq('processing_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(availableSlots);
  if (error) {
    console.error('gallery_image_variant_queue_lookup_failed', error);
    return;
  }
  for (const image of queuedImages ?? []) void processGalleryImageVariants(image.id);

  availableSlots = MAX_CONCURRENT_IMAGE_VARIANT_JOBS - imageVariantJobs.size;
  if (availableSlots <= 0) return;
  const { data: queuedCovers, error: coverQueueError } = await supabase.from('galleries')
    .select('id')
    .eq('cover_processing_status', 'queued')
    .order('updated_at', { ascending: true })
    .limit(availableSlots);
  if (coverQueueError) {
    console.error('gallery_cover_queue_lookup_failed', coverQueueError);
    return;
  }
  for (const gallery of queuedCovers ?? []) void processGalleryCoverVariant(gallery.id);
};

app.post('/api/galleries/:galleryId/upload-url', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as Pick<ImageBody, 'fileName' | 'mimeType' | 'fileSize'>;
  const fileName = body.fileName?.trim();
  const fileSize = Number(body.fileSize);
  const mimeType = body.mimeType?.trim();

  if (!fileName || !mimeType?.startsWith('image/') || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
    response.status(400).json({ ok: false, message: 'A valid image file is required' });
    return;
  }

  const galleryId = getGalleryIdParam(request);

  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storageKey = `demo/${gallery.id}/${randomUUID()}-${safeFileName}`;
    const signedUrl = `${process.env.R2_PUBLIC_URL ?? 'https://images.r2.dev'}/${encodeURIComponent(storageKey)}`;

    response.json({
      ok: true,
      data: {
        signedUrl,
        storagePath: storageKey,
        fileName,
        mimeType,
        fileSize,
        reservedBytes: fileSize,
        effectiveLimitBytes: 10 * 1024 * 1024 * 1024,
        remainingBytes: 10 * 1024 * 1024 * 1024
      }
    });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries').select('id, owner_id').eq('id', galleryId).eq('owner_id', request.userId).single();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  const { tenantId, extraBytes } = tenantContext;

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storageKey = `${tenantId}/${gallery.id}/${randomUUID()}-${safeFileName}`;
  let storageReserved = false;

  try {
    await ensureTenantStorageRow(tenantId, extraBytes);
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_tenant_storage', {
      p_tenant_id: tenantId,
      p_file_size_bytes: fileSize
    });
    if (reservationError) throw reservationError;
    if (!reservation?.ok) {
      response.status(400).json({
        ok: false,
        message: `Storage limit exceeded. You have ${humanizeBytes(Number(reservation?.available_bytes ?? 0))} remaining.`
      });
      return;
    }
    storageReserved = true;

    const { url } = await createPresignedUploadUrl({ key: storageKey, contentType: mimeType, expiresIn: 300 });
    const { error: reservationRecordError } = await supabase.from('files').insert({
      tenant_id: tenantId,
      user_id: request.userId as string,
      gallery_id: gallery.id,
      filename: fileName,
      original_filename: fileName,
      storage_key: storageKey,
      size_bytes: fileSize,
      mime_type: mimeType,
      status: 'processing'
    });
    if (reservationRecordError) throw reservationRecordError;

    response.json({
      ok: true,
      data: {
        signedUrl: url,
        storagePath: storageKey,
        fileName,
        mimeType,
        fileSize,
        reservedBytes: fileSize,
        effectiveLimitBytes: Number(reservation.effective_limit_bytes ?? 0),
        remainingBytes: Number(reservation.remaining_bytes ?? 0)
      }
    });
  } catch (error) {
    if (storageReserved) {
      const cancelled = await cancelPendingUpload({
        tenantId,
        galleryId: gallery.id,
        ownerId: request.userId as string,
        storagePath: storageKey
      }).catch(() => false);
      if (!cancelled) {
        await supabase.rpc('release_tenant_storage', { p_tenant_id: tenantId, p_file_size_bytes: fileSize });
      }
    }
    console.error('upload_url_error', error);
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to create upload URL' });
  }
});

const COVER_VIDEO_MAX_BYTES = 150 * 1024 * 1024;
const getCanonicalYouTubeUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      videoId = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] ?? '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
  } catch {
    return null;
  }
};

app.post('/api/galleries/:galleryId/cover-video-upload-url', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as Pick<ImageBody, 'fileName' | 'mimeType' | 'fileSize'>;
  const fileName = body.fileName?.trim();
  const mimeType = body.mimeType?.trim().toLowerCase();
  const fileSize = Number(body.fileSize);
  if (!fileName || !['video/mp4', 'video/webm'].includes(mimeType ?? '') || !Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > COVER_VIDEO_MAX_BYTES) {
    response.status(400).json({ ok: false, message: 'Choose an MP4 or WebM cover video under 150 MB.' });
    return;
  }

  const galleryId = getGalleryIdParam(request);
  if (isDemoUser(request.userId)) {
    response.status(503).json({ ok: false, message: 'Video file uploads require configured R2 storage.' });
    return;
  }
  const { data: gallery, error: galleryError } = await supabase.from('galleries')
    .select('id').eq('id', galleryId).eq('owner_id', request.userId).maybeSingle();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found.' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  const storageKey = `${tenantContext.tenantId}/${galleryId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  let storageReserved = false;
  try {
    await ensureTenantStorageRow(tenantContext.tenantId, tenantContext.extraBytes);
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_tenant_storage', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: fileSize
    });
    if (reservationError) throw reservationError;
    if (!reservation?.ok) {
      response.status(400).json({ ok: false, message: `Storage limit exceeded. You have ${humanizeBytes(Number(reservation?.available_bytes ?? 0))} remaining.` });
      return;
    }
    storageReserved = true;
    const { url } = await createPresignedUploadUrl({ key: storageKey, contentType: mimeType as string, expiresIn: 600 });
    const { error: reservationRecordError } = await supabase.from('files').insert({
      tenant_id: tenantContext.tenantId,
      user_id: request.userId as string,
      gallery_id: galleryId,
      filename: fileName,
      original_filename: fileName,
      storage_key: storageKey,
      size_bytes: fileSize,
      mime_type: mimeType,
      status: 'processing'
    });
    if (reservationRecordError) throw reservationRecordError;
    response.json({ ok: true, data: { signedUrl: url, storagePath: storageKey, fileName, mimeType, fileSize } });
  } catch (error) {
    if (storageReserved) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath: storageKey })
        .catch(() => supabase.rpc('release_tenant_storage', { p_tenant_id: tenantContext.tenantId, p_file_size_bytes: fileSize }));
    }
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to prepare video upload.' });
  }
});

app.post('/api/galleries/:galleryId/cover-video', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);
  const body = request.body as { youtubeUrl?: string; storagePath?: string; mimeType?: string; fileSize?: number; clear?: boolean };
  const youtubeUrl = body.youtubeUrl?.trim();
  const storagePath = body.storagePath?.trim();
  if (body.clear && (youtubeUrl || storagePath)) {
    response.status(400).json({ ok: false, message: 'Clear the video or provide one video source.' });
    return;
  }
  if (!body.clear && Boolean(youtubeUrl) === Boolean(storagePath)) {
    response.status(400).json({ ok: false, message: 'Provide one YouTube URL or uploaded video.' });
    return;
  }

  const canonicalYouTubeUrl = youtubeUrl ? getCanonicalYouTubeUrl(youtubeUrl) : null;
  if (youtubeUrl && !canonicalYouTubeUrl) {
    response.status(400).json({ ok: false, message: 'Enter a valid YouTube video link.' });
    return;
  }

  if (isDemoUser(request.userId)) {
    const demoGallery = getDemoGalleryById(galleryId);
    if (!demoGallery) {
      response.status(404).json({ ok: false, message: 'Gallery not found.' });
      return;
    }
    if (storagePath) {
      response.status(503).json({ ok: false, message: 'Video file uploads require configured R2 storage.' });
      return;
    }
    demoGallery.cover_video_url = canonicalYouTubeUrl;
    demoGallery.cover_video_path = null;
    demoGallery.updated_at = new Date().toISOString();
    response.json({ ok: true, data: { id: galleryId, coverVideoUrl: canonicalYouTubeUrl } });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase.from('galleries')
    .select('id, cover_video_path').eq('id', galleryId).eq('owner_id', request.userId).maybeSingle();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found.' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (storagePath) {
    if (!body.mimeType || !['video/mp4', 'video/webm'].includes(body.mimeType.toLowerCase()) || !Number.isSafeInteger(body.fileSize) || Number(body.fileSize) <= 0 || !storagePath.startsWith(`${tenantContext.tenantId}/${galleryId}/`)) {
      response.status(400).json({ ok: false, message: 'Invalid uploaded video details.' });
      return;
    }
    const { data: reservation, error: reservationError } = await supabase.from('files')
      .select('id, size_bytes, mime_type').eq('tenant_id', tenantContext.tenantId).eq('gallery_id', galleryId)
      .eq('user_id', request.userId).eq('storage_key', storagePath).eq('status', 'processing').maybeSingle();
    if (reservationError || !reservation || Number(reservation.size_bytes) !== Number(body.fileSize) || reservation.mime_type !== body.mimeType) {
      response.status(404).json({ ok: false, message: 'Video upload reservation not found.' });
      return;
    }
    if (!(await verifyObjectInR2(storagePath)) || await getR2ObjectSize(storagePath) !== Number(body.fileSize)) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath }).catch(() => false);
      response.status(400).json({ ok: false, message: 'Uploaded video could not be verified.' });
      return;
    }
  }

  const newVideoPath = storagePath ?? null;
  const newVideoUrl = canonicalYouTubeUrl;
  const { error: updateError } = await supabase.from('galleries').update({
    cover_video_url: newVideoUrl,
    cover_video_path: newVideoPath,
    updated_at: new Date().toISOString()
  }).eq('id', galleryId).eq('owner_id', request.userId);
  if (updateError) {
    response.status(500).json({ ok: false, message: 'Unable to save the cover video.' });
    return;
  }

  if (storagePath) {
    const { error: fileUpdateError } = await supabase.from('files').update({ status: 'uploaded', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantContext.tenantId).eq('storage_key', storagePath).eq('status', 'processing');
    const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: Number(body.fileSize)
    });
    if (fileUpdateError || finalizeError || !finalized?.ok) {
      console.error('cover_video_storage_finalize_failed', fileUpdateError ?? finalizeError);
      response.status(500).json({ ok: false, message: 'Video saved, but storage accounting could not be finalized.' });
      return;
    }
  }

  if (gallery.cover_video_path && gallery.cover_video_path !== newVideoPath) {
    const { data: previousFile } = await supabase.from('files').select('size_bytes')
      .eq('tenant_id', tenantContext.tenantId).eq('storage_key', gallery.cover_video_path).maybeSingle();
    try {
      await deleteObjectFromR2(gallery.cover_video_path);
      await supabase.from('files').delete().eq('tenant_id', tenantContext.tenantId).eq('storage_key', gallery.cover_video_path);
      if (previousFile) {
        const { data: storage } = await supabase.from('tenant_storage').select('used_bytes').eq('tenant_id', tenantContext.tenantId).maybeSingle();
        await supabase.from('tenant_storage').update({
          used_bytes: Math.max(0, Number(storage?.used_bytes ?? 0) - Number(previousFile.size_bytes ?? 0)),
          updated_at: new Date().toISOString()
        }).eq('tenant_id', tenantContext.tenantId);
      }
    } catch (cleanupError) {
      console.warn('previous_cover_video_cleanup_failed', cleanupError);
    }
  }

  response.json({ ok: true, data: { id: galleryId, coverVideoUrl: newVideoUrl, coverVideoPath: newVideoPath } });
});

app.post('/api/galleries/:galleryId/upload-cancel', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const galleryId = getGalleryIdParam(request);
  const storagePath = String(request.body?.storagePath ?? '').trim();
  if (!storagePath) {
    response.status(400).json({ ok: false, message: 'Upload reservation is required' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (!storagePath.startsWith(`${tenantContext.tenantId}/`)) {
    response.status(403).json({ ok: false, message: 'The storage path does not belong to this tenant' });
    return;
  }

  try {
    const cancelled = await cancelPendingUpload({
      tenantId: tenantContext.tenantId,
      galleryId,
      ownerId: request.userId as string,
      storagePath
    });
    response.json({ ok: true, data: { cancelled } });
  } catch (error) {
    console.error('upload_reservation_cancel_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to cancel this upload right now.' });
  }
});

app.post('/api/galleries/:galleryId/upload', requireUser, (_request: AuthenticatedRequest, response: Response) => {
  response.status(410).json({ ok: false, message: 'This upload endpoint is retired. Use the quota-based upload URL flow.' });
});

app.post('/api/galleries/:galleryId/images', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as ImageBody;
  const galleryId = getGalleryIdParam(request);
  const storagePath = body.storagePath?.trim();
  const fileName = body.fileName?.trim();
  const fileSize = Number(body.fileSize);

  if (!storagePath || !fileName || !body.mimeType?.startsWith('image/') || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
    response.status(400).json({ ok: false, message: 'Invalid image metadata' });
    return;
  }

  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }

    const imageRecord = {
      id: randomUUID(),
      gallery_id: gallery.id,
      owner_id: request.userId as string,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: body.mimeType,
      file_size: fileSize,
      created_at: new Date().toISOString()
    } satisfies DemoGalleryImage;

    gallery.images = [...gallery.images, imageRecord];
    gallery.image_count = gallery.images.length;
    gallery.updated_at = new Date().toISOString();

    response.status(201).json({ ok: true, data: imageRecord });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (!storagePath.startsWith(`${tenantContext.tenantId}/`)) {
    response.status(403).json({ ok: false, message: 'The storage path does not belong to this tenant' });
    return;
  }

  let insertedImageId: string | null = null;
  let originalStorageAccounted = false;
  try {
    const { data: reservation, error: reservationError } = await supabase.from('files')
      .select('id, size_bytes')
      .eq('tenant_id', tenantContext.tenantId)
      .eq('gallery_id', galleryId)
      .eq('user_id', request.userId)
      .eq('storage_key', storagePath)
      .eq('status', 'processing')
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservation || Number(reservation.size_bytes) !== fileSize) {
      response.status(404).json({ ok: false, message: 'Upload reservation not found for this gallery.' });
      return;
    }

    if (!(await verifyObjectInR2(storagePath))) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath });
      response.status(400).json({ ok: false, message: 'The image did not reach R2. Please retry the upload.' });
      return;
    }

    const actualFileSize = await getR2ObjectSize(storagePath);
    if (actualFileSize !== fileSize) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath });
      response.status(400).json({ ok: false, message: 'Uploaded photo size did not match its storage reservation. Please retry.' });
      return;
    }

    const { data: image, error: imageError } = await supabase.from('gallery_images').insert({
      gallery_id: galleryId,
      owner_id: request.userId,
      tenant_id: tenantContext.tenantId,
      storage_path: storagePath,
      processing_status: 'queued',
      file_name: fileName,
      mime_type: body.mimeType,
      file_size: fileSize
    }).select('id, gallery_id, storage_path, file_name, mime_type, file_size, created_at, processing_status').single();

    if (imageError || !image) {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath });
      response.status(400).json({ ok: false, message: imageError?.message ?? 'Unable to save image metadata' });
      return;
    }
    insertedImageId = image.id;

    const { error: fileUpdateError } = await supabase.from('files').upsert({
      id: image.id,
      tenant_id: tenantContext.tenantId,
      user_id: request.userId as string,
      gallery_id: galleryId,
      filename: fileName,
      original_filename: fileName,
      storage_key: storagePath,
      size_bytes: fileSize,
      mime_type: body.mimeType,
      status: 'processing',
      updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id,storage_key' });
    if (fileUpdateError) throw fileUpdateError;

    const { data: finalized, error: finalizeError } = await supabase.rpc('finalize_tenant_storage_reservation', {
      p_tenant_id: tenantContext.tenantId,
      p_file_size_bytes: fileSize
    });
    if (finalizeError) throw finalizeError;
    if (!finalized?.ok) throw new Error('Unable to finalize the storage reservation for this upload.');
    originalStorageAccounted = true;

    const { count } = await supabase.from('gallery_images').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId);
    await supabase.from('galleries').update({ image_count: count ?? 0, updated_at: new Date().toISOString() }).eq('id', galleryId).eq('owner_id', request.userId);
    response.status(201).json({ ok: true, data: image });
    void processGalleryImageVariants(image.id);
  } catch (error) {
    if (insertedImageId) {
      const { error: deleteImageError } = await supabase.from('gallery_images').delete().eq('id', insertedImageId);
      if (deleteImageError) console.error('gallery_image_registration_cleanup_failed', deleteImageError);
    }
    if (originalStorageAccounted) {
      const { data: storageData, error: storageLookupError } = await supabase
        .from('tenant_storage')
        .select('used_bytes')
        .eq('tenant_id', tenantContext.tenantId)
        .maybeSingle();
      if (storageLookupError) console.error('gallery_image_storage_rollback_lookup_failed', storageLookupError);
      const { error: storageRollbackError } = await supabase.from('tenant_storage').update({
        used_bytes: Math.max(0, Number(storageData?.used_bytes ?? 0) - fileSize),
        updated_at: new Date().toISOString()
      }).eq('tenant_id', tenantContext.tenantId);
      if (storageRollbackError) console.error('gallery_image_storage_rollback_failed', storageRollbackError);
      const { error: fileDeleteError } = await supabase.from('files')
        .delete().eq('tenant_id', tenantContext.tenantId).eq('storage_key', storagePath);
      if (fileDeleteError) console.error('gallery_image_file_cleanup_failed', fileDeleteError);
      await deleteObjectFromR2(storagePath).catch((cleanupError) => console.error('gallery_image_original_cleanup_failed', cleanupError));
    } else {
      await cancelPendingUpload({ tenantId: tenantContext.tenantId, galleryId, ownerId: request.userId as string, storagePath })
        .catch((cleanupError) => console.error('gallery_image_reservation_cleanup_failed', cleanupError));
    }
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to save image metadata' });
  }
});

app.post('/api/galleries/:galleryId/cover', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as Pick<ImageBody, 'storagePath' | 'mimeType'>;
  const galleryId = getGalleryIdParam(request);
  const storagePath = body.storagePath?.trim();
  if (!storagePath || !body.mimeType?.startsWith('image/')) {
    response.status(400).json({ ok: false, message: 'A valid cover image is required' });
    return;
  }

  if (isDemoUser(request.userId)) {
    const gallery = getDemoGalleryById(galleryId);
    if (!gallery) {
      response.status(404).json({ ok: false, message: 'Gallery not found' });
      return;
    }

    gallery.cover_path = storagePath;
    gallery.updated_at = new Date().toISOString();
    response.json({ ok: true, data: { id: gallery.id, cover_path: storagePath, updated_at: gallery.updated_at } });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (!storagePath.startsWith(`${tenantContext.tenantId}/`)) {
    response.status(403).json({ ok: false, message: 'The storage path does not belong to this tenant' });
    return;
  }

  const { data: galleryImage, error: galleryImageError } = await supabase
    .from('gallery_images')
    .select('id, preview_path, preview_size, preview_width, preview_height, processing_status')
    .eq('gallery_id', galleryId)
    .eq('owner_id', request.userId)
    .eq('storage_path', storagePath)
    .maybeSingle();
  if (galleryImageError) {
    console.error('gallery_cover_image_lookup_failed', galleryImageError);
    response.status(500).json({ ok: false, message: 'Unable to verify the selected gallery photo.' });
    return;
  }
  const { data: pendingCover } = galleryImage ? { data: null } : await supabase
    .from('files')
    .select('id, size_bytes')
    .eq('gallery_id', galleryId)
    .eq('user_id', request.userId)
    .eq('tenant_id', tenantContext.tenantId)
    .eq('storage_key', storagePath)
    .eq('status', 'processing')
    .maybeSingle();
  if (!galleryImage && !pendingCover) {
    response.status(403).json({ ok: false, message: 'Choose a photo from this gallery or upload a new cover image.' });
    return;
  }

  if (!(await verifyObjectInR2(storagePath))) {
    response.status(400).json({ ok: false, message: 'The cover image did not reach R2. Please retry the upload.' });
    return;
  }

  if (pendingCover) {
    const actualSize = await getR2ObjectSize(storagePath);
    if (actualSize !== Number(pendingCover.size_bytes)) {
      response.status(400).json({ ok: false, message: 'Uploaded cover size did not match its storage reservation. Please retry.' });
      return;
    }
  }

  const coverIsGalleryImage = Boolean(galleryImage);
  const galleryCoverPreviewReady = Boolean(
    galleryImage?.processing_status === 'ready' && galleryImage.preview_path
  );
  const { data, error } = await supabase
    .from('galleries')
    .update({
      cover_path: storagePath,
      cover_preview_path: galleryCoverPreviewReady ? galleryImage?.preview_path : null,
      cover_preview_size: galleryCoverPreviewReady ? Number(galleryImage?.preview_size ?? 0) : 0,
      cover_preview_width: galleryCoverPreviewReady ? Number(galleryImage?.preview_width ?? 0) : 0,
      cover_preview_height: galleryCoverPreviewReady ? Number(galleryImage?.preview_height ?? 0) : 0,
      cover_processing_status: coverIsGalleryImage ? (galleryCoverPreviewReady ? 'ready' : 'queued') : 'queued',
      cover_processing_started_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', galleryId)
    .eq('owner_id', request.userId)
    .select('id, cover_path, cover_preview_path, cover_processing_status, updated_at')
    .single();

  if (error || !data) {
    response.status(404).json({ ok: false, message: error?.message ?? 'Gallery not found' });
    return;
  }

  response.json({ ok: true, data });
  if (!coverIsGalleryImage) void processGalleryCoverVariant(galleryId);
});

const getPublicGalleryImagePage = async ({
  galleryId,
  isUnlocked,
  offset,
  limit
}: {
  galleryId: string;
  isUnlocked: boolean;
  offset: number;
  limit: number;
}) => {
  const { data: images, error } = await supabase
    .from('gallery_images')
    .select('id, storage_path, preview_path, preview_size, preview_width, preview_height, medium_path, medium_width, medium_height, large_path, large_width, large_height, processing_status, file_name, mime_type, file_size, created_at')
    .eq('gallery_id', galleryId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return Promise.all((images ?? []).map(async (image, pageIndex) => {
    const index = offset + pageIndex;
    const isReady = image.processing_status === 'ready' && Boolean(image.preview_path);
    const canPreview = isReady && (isUnlocked || index < PUBLIC_GALLERY_PREVIEW_LIMIT);
    const previewUrl = canPreview
      ? await createPresignedDownloadUrl({ key: image.preview_path, expiresIn: 600 })
      : null;
    const mediumUrl = isUnlocked && isReady && image.medium_path
      ? await createPresignedDownloadUrl({ key: image.medium_path, expiresIn: 600 })
      : null;
    const largeUrl = isUnlocked && isReady && image.large_path
      ? await createPresignedDownloadUrl({ key: image.large_path, expiresIn: 600 })
      : null;
    return {
      id: image.id,
      fileName: image.file_name,
      mimeType: image.mime_type,
      fileSize: image.file_size,
      createdAt: image.created_at,
      processingStatus: image.processing_status,
      previewUrl,
      previewWidth: image.preview_width,
      previewHeight: image.preview_height,
      mediumUrl,
      mediumWidth: image.medium_width,
      mediumHeight: image.medium_height,
      largeUrl,
      largeWidth: image.large_width,
      largeHeight: image.large_height,
      viewUrl: largeUrl || mediumUrl,
      downloadUrl: isUnlocked
        ? await createPresignedDownloadUrl({ key: image.storage_path, expiresIn: 600, downloadFileName: image.file_name })
        : null
    };
  }));
};

const hasPaidGalleryAccess = async (galleryId: string, accessToken: string | undefined): Promise<boolean> => {
  if (!accessToken) return false;
  const [orderId] = accessToken.split('.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId ?? '')) return false;
  const { data: order, error } = await supabase.from('orders').select('id, gallery_id, status, payment_verified_at')
    .eq('id', orderId).eq('gallery_id', galleryId).maybeSingle();
  if (error) throw error;
  return verifyPaidOrderAccess(accessToken, order);
};

const galleryIsUnlockedForVisitor = async (gallery: { id: string; access_price: number }, request: Request): Promise<boolean> =>
  Number(gallery.access_price) <= 0 || hasPaidGalleryAccess(gallery.id, request.header('x-gallery-access-token'));

const recordPublicGalleryView = async (gallery: { id: string; owner_id: string; status: string }, request: Request): Promise<void> => {
  if (gallery.status !== 'published') return;
  const visitorId = String(request.header('x-gallery-visitor-id') ?? '');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(visitorId)) return;
  const visitorHash = createHash('sha256').update(visitorId).digest('hex');
  const { error } = await supabase.from('gallery_view_events').upsert({
    owner_id: gallery.owner_id,
    gallery_id: gallery.id,
    visitor_hash: visitorHash,
    view_date: new Date().toISOString().slice(0, 10)
  }, { onConflict: 'owner_id,gallery_id,visitor_hash,view_date', ignoreDuplicates: true });
  if (error) console.warn('gallery_view_tracking_failed', { galleryId: gallery.id, message: error.message });
};

app.get('/api/public/galleries/:slug', rateLimiter(100, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const identifier = decodeURIComponent(String(request.params.slug));
  const isId = /^[0-9a-f-]{36}$/i.test(identifier);
  const lookupField = isId ? 'id' : 'slug';
  const firstLookup = await supabase.from('galleries')
    .select('id, owner_id, title, slug, status, access_price, currency, image_count, cover_path, cover_preview_path, cover_processing_status, cover_video_url, cover_video_path, cover_design')
    .eq(lookupField, identifier).maybeSingle();
  let gallery = firstLookup.data;
  let error = firstLookup.error;
  if (!gallery && !error && !isId) {
    const titleLookup = await supabase.from('galleries')
      .select('id, owner_id, title, slug, status, access_price, currency, image_count, cover_path, cover_preview_path, cover_processing_status, cover_video_url, cover_video_path, cover_design')
      .eq('title', identifier).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    gallery = titleLookup.data;
    error = titleLookup.error;
  }
  if (error || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  // The gallery row is kept in sync when photos are added or removed, so avoid
  // a separate exact-count query on every client page view.
  const imageCount = Number(gallery.image_count ?? 0);

  let isUnlocked: boolean;
  try {
    isUnlocked = await galleryIsUnlockedForVisitor(gallery, request);
  } catch (accessError) {
    console.error('public_gallery_access_check_failed', accessError);
    response.status(500).json({ ok: false, message: 'Unable to verify gallery access.' });
    return;
  }
  response.vary('X-Gallery-Access-Token');
  response.setHeader('Cache-Control', isUnlocked ? 'private, no-store' : 'private, max-age=30, stale-while-revalidate=60');

  let publicImages;
  try {
    const [images, coverUrl, coverVideoUrl, profileResult] = await Promise.all([
      getPublicGalleryImagePage({ galleryId: gallery.id, isUnlocked, offset: 0, limit: PUBLIC_GALLERY_PAGE_SIZE }),
      gallery.cover_processing_status === 'ready' && gallery.cover_preview_path
        ? createPresignedDownloadUrl({ key: gallery.cover_preview_path, expiresIn: 600 }) : Promise.resolve(null),
      gallery.cover_video_url || (gallery.cover_video_path
        ? createPresignedDownloadUrl({ key: gallery.cover_video_path, expiresIn: 3600 }) : Promise.resolve(null)),
      supabase.from('profiles').select('studio_name, display_name, avatar_url, avatar_path').eq('id', gallery.owner_id).maybeSingle()
    ]);
    publicImages = images;
    const studioProfile = profileResult.data;
    const studioLogoUrl = studioProfile?.avatar_path
      ? await createPresignedDownloadUrl({ key: studioProfile.avatar_path, expiresIn: 3600 })
      : studioProfile?.avatar_url ?? null;
    void recordPublicGalleryView(gallery, request).catch((trackingError) => {
      console.warn('gallery_view_tracking_failed', { galleryId: gallery.id, message: String(trackingError) });
    });
    response.json({
      ok: true,
      data: {
        id: gallery.id, title: gallery.title, slug: gallery.slug, status: gallery.status,
        isUnlocked, accessPrice: gallery.access_price, currency: gallery.currency, imageCount,
        coverDesign: gallery.cover_design ?? 'classic', coverPath: gallery.cover_path, coverUrl,
        coverVideoPath: gallery.cover_video_path, coverVideoUrl,
        studioName: studioProfile?.studio_name || studioProfile?.display_name || null,
        studioLogoUrl, nextImageOffset: publicImages.length,
        hasMoreImages: publicImages.length < imageCount, images: publicImages
      }
    });
  } catch (pageError) {
    console.error('public_gallery_image_page_failed', pageError);
    response.status(500).json({ ok: false, message: 'Unable to load gallery previews.' });
    return;
  }
});

app.get('/api/public/galleries/:slug/images', rateLimiter(100, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const slug = String(request.params.slug);
  const offset = Number(request.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    response.status(400).json({ ok: false, message: 'A valid gallery image offset is required.' });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, access_price')
    .eq('slug', slug)
    .maybeSingle();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found.' });
    return;
  }
  let isUnlocked: boolean;
  try {
    isUnlocked = await galleryIsUnlockedForVisitor(gallery, request);
  } catch (accessError) {
    console.error('public_gallery_access_check_failed', accessError);
    response.status(500).json({ ok: false, message: 'Unable to verify gallery access.' });
    return;
  }
  response.vary('X-Gallery-Access-Token');
  response.setHeader('Cache-Control', isUnlocked ? 'private, no-store' : 'private, max-age=30, stale-while-revalidate=60');
  const { count, error: countError } = await supabase
    .from('gallery_images')
    .select('id', { count: 'exact', head: true })
    .eq('gallery_id', gallery.id);
  if (countError) {
    response.status(500).json({ ok: false, message: 'Unable to load gallery photos.' });
    return;
  }
  const imageCount = count ?? 0;
  if (offset >= imageCount) {
    response.json({ ok: true, data: { images: [], nextOffset: imageCount, hasMore: false } });
    return;
  }
  try {
    const images = await getPublicGalleryImagePage({
      galleryId: gallery.id,
      isUnlocked,
      offset,
      limit: PUBLIC_GALLERY_PAGE_SIZE
    });
    response.json({
      ok: true,
      data: {
        images,
        nextOffset: offset + images.length,
        hasMore: offset + images.length < imageCount
      }
    });
  } catch (error) {
    console.error('public_gallery_image_page_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load gallery photos.' });
  }
});

const PUBLIC_VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const getPublicRouteParam = (request: Request, key: string): string => {
  const value = request.params[key];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};

const getInteractiveGalleryImage = async (gallerySlug: string, imageId: string, request: Request) => {
  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, access_price')
    .eq('slug', gallerySlug)
    .maybeSingle();
  if (galleryError || !gallery) return null;
  const isUnlocked = await galleryIsUnlockedForVisitor(gallery, request);

  const { data: image, error: imageError } = await supabase
    .from('gallery_images')
    .select('id')
    .eq('gallery_id', gallery.id)
    .eq('id', imageId)
    .maybeSingle();
  if (imageError) throw imageError;
  if (!image) return null;
  if (isUnlocked) return { gallery: { ...gallery, is_unlocked: true }, image };

  const { data: previewImages, error: previewError } = await supabase
    .from('gallery_images')
    .select('id')
    .eq('gallery_id', gallery.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PUBLIC_GALLERY_PREVIEW_LIMIT);
  if (previewError) throw previewError;
  return previewImages?.some((preview) => preview.id === image.id)
    ? { gallery: { ...gallery, is_unlocked: false }, image }
    : null;
};

app.get('/api/public/galleries/:slug/interactions', async (request: Request, response: Response) => {
  const visitorId = String(request.query.visitorId ?? '');
  const requestedIds = String(request.query.imageIds ?? '').split(',').filter(Boolean);
  if (visitorId && !PUBLIC_VISITOR_ID_PATTERN.test(visitorId)) {
    response.status(400).json({ ok: false, message: 'Invalid visitor identifier' });
    return;
  }
  if (requestedIds.length > PUBLIC_GALLERY_PAGE_SIZE || requestedIds.some((id) => !PUBLIC_IMAGE_ID_PATTERN.test(id))) {
    response.status(400).json({ ok: false, message: 'Invalid photo identifiers.' });
    return;
  }

  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, access_price')
    .eq('slug', getPublicRouteParam(request, 'slug'))
    .maybeSingle();
  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }
  const isUnlocked = await galleryIsUnlockedForVisitor(gallery, request);
  let imageQuery = supabase
    .from('gallery_images')
    .select('id')
    .eq('gallery_id', gallery.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (requestedIds.length && isUnlocked) imageQuery = imageQuery.in('id', requestedIds);
  else imageQuery = imageQuery.limit(isUnlocked ? PUBLIC_GALLERY_PAGE_SIZE : PUBLIC_GALLERY_PREVIEW_LIMIT);
  const { data: imageRows, error: imageError } = await imageQuery;
  if (imageError) {
    response.status(500).json({ ok: false, message: 'Unable to load photo reactions.' });
    return;
  }
  let visibleIds = (imageRows ?? []).map((image) => image.id);
  if (!isUnlocked && requestedIds.length) {
    const permittedIds = new Set(visibleIds);
    visibleIds = requestedIds.filter((id) => permittedIds.has(id));
  }
  if (!visibleIds.length) {
    response.json({ ok: true, data: {} });
    return;
  }

  const [likesResult, commentsResult] = await Promise.all([
    supabase.from('gallery_photo_likes').select('image_id, visitor_id').in('image_id', visibleIds),
    supabase.from('gallery_photo_comments').select('image_id').in('image_id', visibleIds)
  ]);
  if (likesResult.error || commentsResult.error) {
    console.error('gallery_interactions_load_failed', likesResult.error ?? commentsResult.error);
    response.status(500).json({ ok: false, message: 'Unable to load photo reactions.' });
    return;
  }

  const summary: Record<string, { likes: number; comments: number; likedByVisitor: boolean }> = {};
  visibleIds.forEach((id) => { summary[id] = { likes: 0, comments: 0, likedByVisitor: false }; });
  (likesResult.data ?? []).forEach((like) => {
    const photo = summary[like.image_id];
    if (!photo) return;
    photo.likes += 1;
    if (visitorId && like.visitor_id === visitorId) photo.likedByVisitor = true;
  });
  (commentsResult.data ?? []).forEach((comment) => {
    if (summary[comment.image_id]) summary[comment.image_id].comments += 1;
  });
  response.json({ ok: true, data: summary });
});

app.post('/api/public/galleries/:slug/images/:imageId/like', async (request: Request, response: Response) => {
  const visitorId = String(request.body?.visitorId ?? '');
  if (!PUBLIC_VISITOR_ID_PATTERN.test(visitorId)) {
    response.status(400).json({ ok: false, message: 'A valid visitor identifier is required' });
    return;
  }
  let target: Awaited<ReturnType<typeof getInteractiveGalleryImage>>;
  try {
    target = await getInteractiveGalleryImage(getPublicRouteParam(request, 'slug'), getPublicRouteParam(request, 'imageId'), request);
  } catch (error) {
    console.error('gallery_like_access_check_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to update this reaction.' });
    return;
  }
  if (!target) {
    response.status(404).json({ ok: false, message: 'Photo is not available in this gallery preview.' });
    return;
  }

  const { data: existing, error: lookupError } = await supabase
    .from('gallery_photo_likes')
    .select('image_id')
    .eq('image_id', target.image.id)
    .eq('visitor_id', visitorId)
    .maybeSingle();
  if (lookupError) {
    response.status(500).json({ ok: false, message: 'Unable to update this reaction.' });
    return;
  }
  if (existing) {
    const { error } = await supabase.from('gallery_photo_likes').delete().eq('image_id', target.image.id).eq('visitor_id', visitorId);
    if (error) {
      response.status(500).json({ ok: false, message: 'Unable to update this reaction.' });
      return;
    }
  } else {
    const { error } = await supabase.from('gallery_photo_likes').insert({ image_id: target.image.id, visitor_id: visitorId });
    if (error && error.code !== '23505') {
      response.status(500).json({ ok: false, message: 'Unable to update this reaction.' });
      return;
    }
  }

  const { count, error: countError } = await supabase
    .from('gallery_photo_likes')
    .select('image_id', { count: 'exact', head: true })
    .eq('image_id', target.image.id);
  if (countError) {
    response.status(500).json({ ok: false, message: 'Unable to refresh this reaction.' });
    return;
  }
  response.json({ ok: true, data: { liked: !existing, count: count ?? 0 } });
});

app.get('/api/public/galleries/:slug/images/:imageId/comments', async (request: Request, response: Response) => {
  let target: Awaited<ReturnType<typeof getInteractiveGalleryImage>>;
  try {
    target = await getInteractiveGalleryImage(getPublicRouteParam(request, 'slug'), getPublicRouteParam(request, 'imageId'), request);
  } catch (error) {
    console.error('gallery_comments_access_check_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load photo comments.' });
    return;
  }
  if (!target) {
    response.status(404).json({ ok: false, message: 'Photo is not available in this gallery preview.' });
    return;
  }
  const { data, error } = await supabase
    .from('gallery_photo_comments')
    .select('id, display_name, body, created_at')
    .eq('image_id', target.image.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('gallery_comments_load_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to load photo comments.' });
    return;
  }
  response.json({ ok: true, data: data ?? [] });
});

app.post('/api/public/galleries/:slug/images/:imageId/comments', async (request: Request, response: Response) => {
  const visitorId = String(request.body?.visitorId ?? '');
  const displayName = String(request.body?.displayName ?? '').trim();
  const body = String(request.body?.body ?? '').trim();
  if (!PUBLIC_VISITOR_ID_PATTERN.test(visitorId) || !displayName || displayName.length > 60 || !body || body.length > 1200) {
    response.status(400).json({ ok: false, message: 'Enter a name and comment of up to 1,200 characters.' });
    return;
  }
  let target: Awaited<ReturnType<typeof getInteractiveGalleryImage>>;
  try {
    target = await getInteractiveGalleryImage(getPublicRouteParam(request, 'slug'), getPublicRouteParam(request, 'imageId'), request);
  } catch (error) {
    console.error('gallery_comment_access_check_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to post this comment.' });
    return;
  }
  if (!target) {
    response.status(404).json({ ok: false, message: 'Photo is not available in this gallery preview.' });
    return;
  }
  const { data, error } = await supabase
    .from('gallery_photo_comments')
    .insert({ image_id: target.image.id, visitor_id: visitorId, display_name: displayName, body })
    .select('id, display_name, body, created_at')
    .single();
  if (error || !data) {
    console.error('gallery_comment_create_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to post this comment.' });
    return;
  }
  response.status(201).json({ ok: true, data });
});

app.get('/api/public/galleries/:slug/download-all', rateLimiter(10, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, title, slug, access_price')
    .eq('slug', request.params.slug)
    .maybeSingle();

  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }
  if (!await galleryIsUnlockedForVisitor(gallery, request)) {
    response.status(402).json({ ok: false, message: 'Unlock this gallery before downloading its photos.' });
    return;
  }

  const { data: images, error: imageError } = await supabase
    .from('gallery_images')
    .select('storage_path, file_name')
    .eq('gallery_id', gallery.id)
    .order('created_at', { ascending: true });
  if (imageError) {
    response.status(500).json({ ok: false, message: 'Unable to prepare the gallery download.' });
    return;
  }
  if (!images?.length) {
    response.status(404).json({ ok: false, message: 'This gallery has no photos to download.' });
    return;
  }

  const archiveName = `${gallery.slug || 'gallery'}-photos.zip`;
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', `attachment; filename="${archiveName.replace(/[^A-Za-z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`);
  response.setHeader('Cache-Control', 'no-store');

  const archive = new archiverModule.ZipArchive({ level: 0 });
  archive.on('warning', (error) => console.warn('gallery_archive_warning', error));
  archive.on('error', (error) => {
    console.error('gallery_archive_failed', error);
    response.destroy(error);
  });
  response.on('close', () => {
    if (!response.writableEnded) archive.abort();
  });
  archive.pipe(response);

  try {
    for (const [index, image] of images.entries()) {
      const safeName = image.file_name.replace(/[\\/\u0000-\u001f]/g, '_') || 'photo';
      archive.append(await getR2ObjectStream(image.storage_path), {
        name: `${String(index + 1).padStart(3, '0')}-${safeName}`
      });
    }
    await archive.finalize();
  } catch (error) {
    console.error('gallery_archive_source_failed', error);
    archive.abort();
    response.destroy(error instanceof Error ? error : new Error('Gallery download failed'));
  }
});

app.get('/api/public/galleries/:slug/images/:imageId/download', rateLimiter(10, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const { data: gallery, error: galleryError } = await supabase
    .from('galleries')
    .select('id, access_price')
    .eq('slug', request.params.slug)
    .single();

  if (galleryError || !gallery) {
    response.status(404).json({ ok: false, message: 'Gallery not found' });
    return;
  }

  if (!await galleryIsUnlockedForVisitor(gallery, request)) {
    response.status(402).json({ ok: false, message: 'This gallery must be unlocked before downloading photos' });
    return;
  }

  const { data: image, error: imageError } = await supabase
    .from('gallery_images')
    .select('id, storage_path, file_name, mime_type')
    .eq('id', request.params.imageId)
    .eq('gallery_id', gallery.id)
    .single();

  if (imageError || !image) {
    response.status(404).json({ ok: false, message: 'Image not found' });
    return;
  }

  try {
    const url = await createPresignedDownloadUrl({ key: image.storage_path, expiresIn: 600 });
    response.json({ ok: true, data: { url, fileId: image.id, fileName: image.file_name, mimeType: image.mime_type } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to generate download URL' });
  }
});

app.get('/api/files/:fileId/download', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const fileId = request.params.fileId;

  const { data: fileData, error: fileError } = await supabase
    .from('files')
    .select('id, tenant_id, user_id, storage_key, filename, original_filename, mime_type, size_bytes')
    .eq('id', fileId)
    .maybeSingle();

  if (fileError || !fileData) {
    response.status(404).json({ ok: false, message: 'File not found' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (fileData.tenant_id !== tenantContext.tenantId) {
    response.status(403).json({ ok: false, message: 'Unauthorized download' });
    return;
  }

  try {
    const signedUrl = await createPresignedDownloadUrl({ key: fileData.storage_key, expiresIn: 600 });
    response.json({ ok: true, data: { url: signedUrl, fileId: fileData.id, fileName: fileData.original_filename, mimeType: fileData.mime_type } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to generate download URL' });
  }
});

app.delete('/api/files/:fileId', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const fileId = request.params.fileId;

  const { data: fileData, error: fileError } = await supabase
    .from('files')
    .select('id, tenant_id, user_id, storage_key, size_bytes, status')
    .eq('id', fileId)
    .maybeSingle();

  if (fileError || !fileData) {
    response.status(404).json({ ok: false, message: 'File not found' });
    return;
  }

  const tenantContext = await ensureTenantForUser(request.userId as string);
  if (fileData.tenant_id !== tenantContext.tenantId) {
    response.status(403).json({ ok: false, message: 'Unauthorized deletion' });
    return;
  }

  try {
    const { data: image, error: imageLookupError } = await supabase.from('gallery_images')
      .select('id, gallery_id, storage_path, preview_path, medium_path, large_path')
      .eq('id', fileId)
      .eq('tenant_id', tenantContext.tenantId)
      .maybeSingle();
    if (imageLookupError) throw imageLookupError;
    const { data: standaloneCover, error: coverLookupError } = image ? { data: null, error: null } :
      await supabase.from('galleries')
        .select('id')
        .eq('cover_path', fileData.storage_key)
        .eq('owner_id', request.userId)
        .maybeSingle();
    if (coverLookupError) throw coverLookupError;
    const objectKeys = image
      ? [
          image.storage_path,
          image.preview_path,
          image.medium_path,
          image.large_path,
          `${image.storage_path}.preview.webp`,
          `${image.storage_path}.medium.webp`,
          `${image.storage_path}.large.webp`
        ]
      : [fileData.storage_key, ...(standaloneCover ? [`${fileData.storage_key}.cover.webp`] : [])];
    await deleteR2Objects(objectKeys);

    if (image) {
      const { error: imageDeleteError } = await supabase.from('gallery_images')
        .delete().eq('id', image.id).eq('tenant_id', tenantContext.tenantId);
      if (imageDeleteError) throw imageDeleteError;
      const { count, error: countError } = await supabase.from('gallery_images')
        .select('id', { count: 'exact', head: true })
        .eq('gallery_id', image.gallery_id);
      if (countError) throw countError;
      const { error: galleryUpdateError } = await supabase.from('galleries')
        .update({ image_count: count ?? 0, updated_at: new Date().toISOString() })
        .eq('id', image.gallery_id);
      if (galleryUpdateError) throw galleryUpdateError;
      const { error: clearCoverError } = await supabase.from('galleries').update({
        cover_path: null,
        cover_preview_path: null,
        cover_preview_size: 0,
        cover_preview_width: 0,
        cover_preview_height: 0,
        cover_processing_status: 'ready',
        cover_processing_started_at: null
      }).eq('id', image.gallery_id).eq('cover_path', image.storage_path);
      if (clearCoverError) throw clearCoverError;
    }

    const { error: fileDeleteError } = await supabase.from('files').delete()
      .eq('id', fileId).eq('tenant_id', tenantContext.tenantId);
    if (fileDeleteError) throw fileDeleteError;
    if (standaloneCover) {
      const { error: clearCoverError } = await supabase.from('galleries').update({
        cover_path: null,
        cover_preview_path: null,
        cover_preview_size: 0,
        cover_preview_width: 0,
        cover_preview_height: 0,
        cover_processing_status: 'ready',
        cover_processing_started_at: null
      }).eq('id', standaloneCover.id).eq('cover_path', fileData.storage_key);
      if (clearCoverError) throw clearCoverError;
    }
    if (Number(fileData.size_bytes ?? 0) > 0 && !image && fileData.status === 'processing') {
      const { error: reservationReleaseError } = await supabase.rpc('release_tenant_storage', {
        p_tenant_id: tenantContext.tenantId,
        p_file_size_bytes: Number(fileData.size_bytes)
      });
      if (reservationReleaseError) throw reservationReleaseError;
    } else if (Number(fileData.size_bytes ?? 0) > 0) {
      const { data: usageRemoval, error: usageRemovalError } = await supabase.rpc('remove_tenant_storage_usage', {
        p_tenant_id: tenantContext.tenantId,
        p_file_size_bytes: Number(fileData.size_bytes)
      });
      if (usageRemovalError || !usageRemoval?.ok) throw usageRemovalError ?? new Error('Unable to update tenant storage usage.');
    }

    response.json({ ok: true, data: { deleted: true, fileId } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to delete file' });
  }
});

const teamRoles = new Set(['admin', 'lead-editor', 'retoucher', 'photographer', 'videographer']);
const teamPermissions = new Set(['galleries', 'clients', 'orders', 'storage', 'settings', 'team', 'performance']);

const normalizeRoleKey = (value: string): string => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

const getAllowedRoles = async (ownerId: string): Promise<Set<string>> => {
  const { data } = await supabase.from('studio_roles').select('role_key').eq('owner_id', ownerId);
  return new Set([...teamRoles, ...(data ?? []).map((role) => role.role_key)]);
};

app.get('/api/team/roles', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('studio_roles').select('id, role_name, role_key, created_at').eq('owner_id', request.userId).order('role_name');
  if (error) {
    response.status(500).json({ ok: false, message: error.message });
    return;
  }
  const builtInRoles = Array.from(teamRoles).map((roleKey) => ({ id: roleKey, role_name: roleKey.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()), role_key: roleKey, builtIn: true }));
  response.json({ ok: true, data: [...builtInRoles, ...(data ?? [])] });
});

app.post('/api/team/roles', requireUser, requireAdmin, async (request: AuthenticatedRequest, response: Response) => {
  const roleName = String(request.body?.roleName ?? '').trim();
  const roleKey = normalizeRoleKey(roleName);
  if (!roleName || roleName.length > 60 || !roleKey || teamRoles.has(roleKey)) {
    response.status(400).json({ ok: false, message: 'Enter a unique custom role name' });
    return;
  }
  const { data, error } = await supabase.from('studio_roles').insert({ owner_id: request.userId, role_name: roleName, role_key: roleKey }).select('id, role_name, role_key, created_at').single();
  if (error || !data) {
    response.status(400).json({ ok: false, message: error?.message ?? 'Unable to create role' });
    return;
  }
  response.status(201).json({ ok: true, data });
});

app.get('/api/team/members', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('team_members')
    .select('id, member_id, email, display_name, role, permissions, team_name, commission_percentage, performance_percentage, phone, status, created_at')
    .eq('owner_id', request.userId).order('created_at', { ascending: false });
  if (error) {
    response.status(500).json({ ok: false, message: error.message });
    return;
  }
  response.json({ ok: true, data: data ?? [] });
});

app.patch('/api/team/members/:memberId', requireUser, requireAdmin, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as TeamInviteBody;
  const allowedRoles = await getAllowedRoles(request.userId as string);
  const role = body.role;
  const permissions = Array.from(new Set((body.permissions ?? []).filter((permission) => teamPermissions.has(permission))));
  const commissionPercentage = Number(body.commissionPercentage ?? 0);
  const performancePercentage = Number(body.performancePercentage ?? 0);
  const teamName = body.teamName?.trim() || 'Unassigned';
  if (!role || !allowedRoles.has(role) || !Number.isFinite(commissionPercentage) || commissionPercentage < 0 || commissionPercentage > 100 || !Number.isFinite(performancePercentage) || performancePercentage < 0 || performancePercentage > 100 || teamName.length > 80) {
    response.status(400).json({ ok: false, message: 'Valid role, team, commission, and performance percentages are required' });
    return;
  }

  const { data, error } = await supabase.from('team_members').update({
    role,
    phone: body.phone?.trim() || null,
    permissions,
    team_name: teamName,
    commission_percentage: commissionPercentage,
    performance_percentage: performancePercentage,
    updated_at: new Date().toISOString()
  }).eq('owner_id', request.userId).eq('member_id', request.params.memberId)
    .select('id, member_id, email, display_name, role, permissions, team_name, commission_percentage, performance_percentage, phone, status, created_at').single();
  if (error || !data) {
    response.status(404).json({ ok: false, message: error?.message ?? 'Team member not found' });
    return;
  }
  await supabase.from('performance_history').insert({ owner_id: request.userId, member_id: request.params.memberId, performance_percentage: performancePercentage, note: 'Admin score update' });
  response.json({ ok: true, data });
});

app.get('/api/team/members/:memberId/performance', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('performance_history').select('id, event_id, performance_percentage, note, created_at').eq('owner_id', request.userId).eq('member_id', request.params.memberId).order('created_at', { ascending: false });
  if (error) { response.status(500).json({ ok: false, message: error.message }); return; }
  response.json({ ok: true, data: data ?? [] });
});

app.post('/api/team/invite', requireUser, requireAdmin, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as TeamInviteBody;
  const allowedRoles = await getAllowedRoles(request.userId as string);
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? '';
  const role = body.role ?? 'photographer';
  const permissions = Array.from(new Set((body.permissions ?? []).filter((permission) => teamPermissions.has(permission))));
  const teamName = body.teamName?.trim() || 'Unassigned';
  const commissionPercentage = Number(body.commissionPercentage ?? 0);
  const performancePercentage = Number(body.performancePercentage ?? 0);
    const phone = body.phone?.trim() || null;

  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !name || name.length < 2 || password.length < 8 || !allowedRoles.has(role) || !teamName || teamName.length > 80 || !Number.isFinite(commissionPercentage) || commissionPercentage < 0 || commissionPercentage > 100 || !Number.isFinite(performancePercentage) || performancePercentage < 0 || performancePercentage > 100) {
    response.status(400).json({ ok: false, message: 'Name, valid email, role, password, commission, and performance percentages are required' });
    return;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, invitedBy: request.userId, role }
  });
  if (createError || !created.user) {
    response.status(400).json({ ok: false, message: createError?.message ?? 'Unable to create invited user' });
    return;
  }

  const { data: member, error: memberError } = await supabase.from('team_members').insert({
    owner_id: request.userId,
    member_id: created.user.id,
    email,
    display_name: name,
    role,
    permissions,
    team_name: teamName,
    commission_percentage: commissionPercentage,
    performance_percentage: performancePercentage,
    phone,
    status: 'active'
  }).select('id, member_id, email, display_name, role, permissions, team_name, commission_percentage, performance_percentage, phone, status, created_at').single();
  if (memberError || !member) {
    await supabase.auth.admin.deleteUser(created.user.id);
    response.status(500).json({ ok: false, message: memberError?.message ?? 'Unable to save team member' });
    return;
  }

  response.status(201).json({ ok: true, data: member, message: 'Member created. Share the temporary password securely.' });
});

app.get('/api/team/events', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const { data: events, error } = await supabase.from('studio_events')
    .select('id, event_name, event_date, team_count, role_requirements, status, created_at')
    .eq('owner_id', request.userId).order('event_date', { ascending: true });
  if (error) {
    response.status(500).json({ ok: false, message: error.message });
    return;
  }
  const eventIds = (events ?? []).map((event) => event.id);
  const { data: assignments } = eventIds.length
    ? await supabase.from('event_assignments').select('event_id, member_id, team_name, role, commission_percentage, performance_percentage').in('event_id', eventIds)
    : { data: [] };
  response.json({ ok: true, data: (events ?? []).map((event) => ({ ...event, assignments: (assignments ?? []).filter((assignment) => assignment.event_id === event.id) })) });
});

app.get('/api/public/team-events/:accessToken', async (request: Request, response: Response) => {
  const { data: event, error } = await supabase.from('studio_events')
    .select('id, event_name, event_date, role_requirements, status').eq('access_token', request.params.accessToken).single();
  if (error || !event) {
    response.status(404).json({ ok: false, message: 'Event roster not found' });
    return;
  }
  const { data: assignments } = await supabase.from('event_assignments')
    .select('member_id, team_name, assignment_group, role, performance_percentage').eq('event_id', event.id).order('team_name');
  const memberIds = (assignments ?? []).map((assignment) => assignment.member_id);
  const { data: members } = memberIds.length
    ? await supabase.from('team_members').select('member_id, display_name').in('member_id', memberIds)
    : { data: [] };
  const names = new Map((members ?? []).map((member) => [member.member_id, member.display_name]));
  response.json({ ok: true, data: { ...event, assignments: (assignments ?? []).map((assignment) => ({ ...assignment, display_name: names.get(assignment.member_id) ?? 'Team member' })) } });
});

app.post('/api/team/events', requireUser, requireAdmin, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as EventBody;
  const allowedRoles = await getAllowedRoles(request.userId as string);
  const eventName = body.eventName?.trim();
  const eventDate = body.eventDate?.trim();
  const roleRequirements = Object.fromEntries(Object.entries(body.roleRequirements ?? {}).filter(([role, count]) => allowedRoles.has(role) && role !== 'admin' && Number.isInteger(count) && count > 0 && count <= 20));
  const requiredMemberCount = Object.values(roleRequirements).reduce((total, count) => total + count, 0);
  if (!eventName || eventName.length > 120 || !eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || requiredMemberCount < 1 || requiredMemberCount > 50) {
    response.status(400).json({ ok: false, message: 'Event name, date, and at least one valid role requirement are required' });
    return;
  }

  const { data: members, error: memberError } = await supabase.from('team_members')
    .select('member_id, display_name, role, team_name, phone, commission_percentage, performance_percentage').eq('owner_id', request.userId).eq('status', 'active');
  if (memberError || !members?.length) {
    response.status(400).json({ ok: false, message: 'Add active team members before scheduling an event' });
    return;
  }

  const { data: existingEvents } = await supabase.from('studio_events').select('id').eq('owner_id', request.userId).eq('event_date', eventDate).neq('status', 'cancelled');
  const existingEventIds = (existingEvents ?? []).map((event) => event.id);
  const { data: existingAssignments } = await supabase.from('event_assignments').select('event_id, member_id').eq('owner_id', request.userId);
  const unavailableMembers = new Set((existingAssignments ?? []).filter((assignment) => existingEventIds.includes(assignment.event_id)).map((assignment) => assignment.member_id));
  const assignmentsToCreate: Array<{ member_id: string; team_name: string; role: string; member_phone: string | null; commission_percentage: number; performance_percentage: number }> = [];
  for (const [role, count] of Object.entries(roleRequirements)) {
    const candidates = members.filter((member) => member.role === role && !unavailableMembers.has(member.member_id)).sort((left, right) => Number(right.performance_percentage) - Number(left.performance_percentage));
    if (candidates.length < count) {
      response.status(409).json({ ok: false, message: `Not enough available ${role}s for this date` });
      return;
    }
    candidates.slice(0, count).forEach((member) => assignmentsToCreate.push({ member_id: member.member_id, team_name: member.team_name, role: member.role, member_phone: member.phone, commission_percentage: member.commission_percentage, performance_percentage: member.performance_percentage }));
  }

  const { data: event, error: eventError } = await supabase.from('studio_events').insert({ owner_id: request.userId, event_name: eventName, event_date: eventDate, team_count: requiredMemberCount, role_requirements: roleRequirements }).select('id, event_name, event_date, access_token, team_count, role_requirements, status, created_at').single();
  if (eventError || !event) {
    response.status(500).json({ ok: false, message: eventError?.message ?? 'Unable to schedule event' });
    return;
  }
  const assignmentRows = assignmentsToCreate.map((assignment) => ({ event_id: event.id, owner_id: request.userId, ...assignment }));
  const { data: assignments, error: assignmentError } = await supabase.from('event_assignments').insert(assignmentRows).select('member_id, team_name, role, member_phone, commission_percentage, performance_percentage');
  if (assignmentError) {
    await supabase.from('studio_events').delete().eq('id', event.id).eq('owner_id', request.userId);
    response.status(500).json({ ok: false, message: assignmentError.message });
    return;
  }
  response.status(201).json({ ok: true, data: { ...event, assignments: assignments ?? [] } });
});

const malipoTokens = new Map<string, { value: string; expiresAt: number }>();
const getMalipoToken = async (credentials: Extract<PaymentProviderCredentials, { provider: 'malipo' }>, environment: string): Promise<string> => {
  const cacheKey = createHash('sha256').update(`${credentials.apiKey}:${credentials.secretKey}:${environment}`).digest('hex');
  const cached = malipoTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const baseUrl = process.env.MALIPO_BASE_URL ?? 'https://pay.tunzaa.co.tz';
  const tokenResponse = await fetch(`${baseUrl}/accounts/request/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Environment': environment },
    body: JSON.stringify({ api_key: credentials.apiKey, secret_key: credentials.secretKey })
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; expires_in?: number; message?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody.message ?? 'Unable to authorize with Malipo');
  malipoTokens.set(cacheKey, { value: tokenBody.access_token, expiresAt: Date.now() + Math.max(60, (tokenBody.expires_in ?? 3600) - 60) * 1000 });
  return tokenBody.access_token;
};

const clickPesaTokens = new Map<string, { value: string; expiresAt: number }>();
const getClickPesaToken = async (credentials: Extract<PaymentProviderCredentials, { provider: 'clickpesa' }>): Promise<string> => {
  const cacheKey = createHash('sha256').update(`${credentials.clientId}:${credentials.apiKey}`).digest('hex');
  const cached = clickPesaTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tokenResponse = await fetch('https://api.clickpesa.com/third-parties/generate-token', {
    method: 'POST',
    headers: { 'client-id': credentials.clientId, 'api-key': credentials.apiKey }
  });
  const tokenBody = (await tokenResponse.json()) as { token?: string; message?: string };
  if (!tokenResponse.ok || !tokenBody.token) throw new Error(tokenBody.message ?? 'Unable to authorize with ClickPesa');
  clickPesaTokens.set(cacheKey, { value: tokenBody.token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return tokenBody.token;
};

const requestStakaba = async (path: string, apiKey: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
  const url = `https://api.stakaba.com${path}`;
  const baseHeaders = new Headers(init.headers);
  baseHeaders.set('x-api-key', apiKey);
  let providerResponse = await fetch(url, { ...init, headers: baseHeaders });
  if (providerResponse.status === 401) {
    const bearerHeaders = new Headers(init.headers);
    bearerHeaders.set('Authorization', `Bearer ${apiKey}`);
    providerResponse = await fetch(url, { ...init, headers: bearerHeaders });
  }
  const providerBody = await providerResponse.json() as Record<string, unknown>;
  if (!providerResponse.ok) console.error("Stakaba API Error Response:", providerBody);
  if (!providerResponse.ok) throw new Error('Stakaba rejected the API key or request.');
  return providerBody;
};

const readStakabaTransaction = async (apiKey: string, internalReference: string): Promise<Record<string, unknown>> => {
  const response = await requestStakaba(`/api/v1/transactions/${encodeURIComponent(internalReference)}`, apiKey);
  return response.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data as Record<string, unknown>
    : response;
};

const platformAdminRoute = [requireUser, requirePlatformAdmin] as const;

app.get('/api/public/plans', async (_request: Request, response: Response) => {
  const { data, error } = await supabase.from('plans')
    .select('id, name, price, currency, billing_interval, storage_limit_bytes, max_users, max_projects, max_photos_per_gallery, watermark_level, support_level, features')
    .eq('status', 'active').order('price', { ascending: true });
  if (error) { response.status(500).json({ ok: false, message: 'Unable to load plans.' }); return; }
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  response.json({ ok: true, data: data ?? [] });
});

app.get('/api/platform/admin/overview', ...platformAdminRoute, async (_request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  try {
    const [profiles, tenants, subscriptions, packagePayments, errors, requests, galleries, activePlans, inactivePlans, pendingPayments, failedPayments, recentPayments, recentIssues, gateway] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('tenants').select('id', { count: 'exact', head: true }),
      supabase.from('tenant_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('platform_package_payments').select('amount, currency').eq('status', 'SUCCESS').limit(10000),
      supabase.from('platform_system_logs').select('id', { count: 'exact', head: true }).eq('level', 'error').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
      supabase.from('platform_system_logs').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
      supabase.from('galleries').select('id', { count: 'exact', head: true }),
      supabase.from('plans').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('plans').select('id', { count: 'exact', head: true }).eq('status', 'inactive'),
      supabase.from('platform_package_payments').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'),
      supabase.from('platform_package_payments').select('id', { count: 'exact', head: true }).eq('status', 'FAILED'),
      supabase.from('platform_package_payments').select('id, order_reference, amount, currency, status, provider, created_at, plan_id').order('created_at', { ascending: false }).limit(5),
      supabase.from('platform_system_logs').select('id, level, method, route, status, created_at').in('level', ['error', 'warning']).order('created_at', { ascending: false }).limit(5),
      supabase.from('platform_payment_settings').select('provider, environment').eq('id', true).maybeSingle()
    ]);
    const revenue: Record<string, number> = { TZS: 0, USD: 0 };
    for (const item of packagePayments.data ?? []) revenue[item.currency] = (revenue[item.currency] ?? 0) + Number(item.amount ?? 0);
    response.json({ ok: true, data: {
      photographerCount: profiles.count ?? 0,
      tenantCount: tenants.count ?? 0,
      activeSubscriptions: subscriptions.count ?? 0,
      grossRevenueByCurrency: revenue,
      requestsLast24Hours: requests.count ?? 0,
      errorsLast24Hours: errors.count ?? 0,
      apiUptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      galleryCount: galleries.count ?? 0,
      activePlanCount: activePlans.count ?? 0,
      inactivePlanCount: inactivePlans.count ?? 0,
      pendingPackagePayments: pendingPayments.count ?? 0,
      failedPackagePayments: failedPayments.count ?? 0,
      recentPayments: recentPayments.data ?? [],
      recentIssues: recentIssues.data ?? [],
      gateway: gateway.data ?? null
    } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to load platform overview.' });
  }
});

app.get('/api/platform/admin/users', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  const page = Math.max(1, Number(request.query.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(request.query.perPage ?? 50)));
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
  if (error) { response.status(500).json({ ok: false, message: 'Unable to list photographer accounts.' }); return; }
  const ids = data.users.map((user) => user.id);
  const [profiles, tenants] = ids.length ? await Promise.all([
    supabase.from('profiles').select('id, display_name, studio_name, created_at').in('id', ids),
    supabase.from('tenants').select('id, owner_id, status, created_at').in('owner_id', ids)
  ]) : [{ data: [] }, { data: [] }];
  const profileById = new Map((profiles.data ?? []).map((profile) => [profile.id, profile]));
  const tenantByOwner = new Map((tenants.data ?? []).map((tenant) => [tenant.owner_id, tenant]));
  const tenantIds = (tenants.data ?? []).map((tenant) => tenant.id);
  const subscriptions = tenantIds.length ? await supabase.from('tenant_subscriptions')
    .select('tenant_id, status, starts_at, expires_at, plans(name)')
    .in('tenant_id', tenantIds).order('starts_at', { ascending: false }) : { data: [] };
  const subscriptionByTenant = new Map<string, NonNullable<typeof subscriptions.data>[number]>();
  for (const subscription of subscriptions.data ?? []) if (!subscriptionByTenant.has(subscription.tenant_id)) subscriptionByTenant.set(subscription.tenant_id, subscription);
  response.json({ ok: true, data: data.users.map((user) => {
    const tenant = tenantByOwner.get(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? profileById.get(user.id)?.display_name ?? '',
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      confirmed: Boolean(user.email_confirmed_at),
      suspendedUntil: user.banned_until && Date.parse(user.banned_until) > Date.now() ? user.banned_until : null,
      studio: profileById.get(user.id)?.studio_name ?? profileById.get(user.id)?.display_name ?? '',
      tenantStatus: tenant?.status ?? 'not set up',
      tenantId: tenant?.id ?? null,
      subscription: tenant ? subscriptionByTenant.get(tenant.id) ?? null : null
    };
  }), page, perPage, lastPage: data.lastPage });
});

app.put('/api/platform/admin/users/:userId', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const userId = String(request.params.userId);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || userId === request.userId) { response.status(400).json({ ok: false, message: 'Choose a valid photographer account.' }); return; }
  const body = request.body as { name?: unknown; email?: unknown; studioName?: unknown; active?: unknown; planId?: unknown };
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const studioName = String(body.studioName ?? '').trim();
  const planId = String(body.planId ?? '');
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || studioName.length > 120 || typeof body.active !== 'boolean') {
    response.status(400).json({ ok: false, message: 'Enter a valid name, email, studio name, and account status.' }); return;
  }
  const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !authUser.user) { response.status(404).json({ ok: false, message: 'Photographer account not found.' }); return; }
  const { data: isPlatformAdmin } = authUser.user.email ? await supabase.from('platform_admins').select('email').eq('email', authUser.user.email.toLowerCase()).eq('enabled', true).maybeSingle() : { data: null };
  if (isPlatformAdmin) { response.status(403).json({ ok: false, message: 'Platform administrator accounts cannot be edited here.' }); return; }
  const { data: tenant } = await supabase.from('tenants').select('id').eq('owner_id', userId).maybeSingle();
  const updateUser: Record<string, unknown> = { user_metadata: { ...(authUser.user.user_metadata ?? {}), name } };
  if (email !== authUser.user.email?.toLowerCase()) { updateUser.email = email; updateUser.email_confirm = true; }
  if (!body.active) updateUser.ban_duration = '876000h';
  else if (authUser.user.banned_until) updateUser.ban_duration = 'none';
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, updateUser);
  if (updateError) { response.status(400).json({ ok: false, message: 'Unable to update this photographer account.' }); return; }
  const { error: profileError } = await supabase.from('profiles').upsert({ id: userId, display_name: name, studio_name: studioName || 'My Studio', updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (profileError) { response.status(500).json({ ok: false, message: 'Account saved, but profile details could not be updated.' }); return; }
  if (tenant) {
    await supabase.from('tenants').update({ status: body.active ? 'active' : 'suspended', updated_at: new Date().toISOString() }).eq('id', tenant.id);
  }
  if (planId) {
    const { data: plan } = await supabase.from('plans').select('id').eq('id', planId).maybeSingle();
    if (!plan) { response.status(400).json({ ok: false, message: 'Selected package was not found; other account changes were saved.' }); return; }
    const tenantId = tenant?.id ?? (await ensureTenantForUser(userId)).tenantId;
    const { error: subscriptionError } = await supabase.rpc('platform_admin_set_subscription', { p_tenant_id: tenantId, p_plan_id: plan.id });
    if (subscriptionError) { response.status(500).json({ ok: false, message: 'Account details saved, but package assignment failed.' }); return; }
  }
  response.json({ ok: true, data: { id: userId } });
});

app.post('/api/platform/admin/users/:userId/recovery', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const userId = String(request.params.userId);
  const { data: userData, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !userData.user?.email) { response.status(404).json({ ok: false, message: 'Photographer email was not found.' }); return; }
  const redirectTo = `${(process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(',')[0].replace(/\/$/, '')}/reset-password.html`;
  const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(userData.user.email, { redirectTo });
  if (recoveryError) { response.status(502).json({ ok: false, message: 'Could not send a password recovery email. Check Supabase email settings.' }); return; }
  response.json({ ok: true, data: { sent: true } });
});

app.get('/api/platform/admin/plans', ...platformAdminRoute, async (_request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  const { data, error } = await supabase.from('plans').select('*').order('price', { ascending: true });
  if (error) { response.status(500).json({ ok: false, message: 'Unable to load packages.' }); return; }
  response.json({ ok: true, data: data ?? [] });
});

const validatePlatformPlan = (body: Record<string, unknown>): { name: string; price: number; currency: 'TZS' | 'USD'; billing_interval: 'month' | 'year' | 'lifetime'; storage_limit_bytes: number; max_users: number; max_projects: number; max_photos_per_gallery: number; watermark_level: 'basic' | 'advanced'; support_level: 'standard' | 'priority'; status: 'active' | 'inactive'; features: Record<string, boolean> } | null => {
  const name = String(body.name ?? '').trim();
  const price = Number(body.price);
  const currency = body.currency === 'USD' ? 'USD' : body.currency === 'TZS' ? 'TZS' : null;
  const billingInterval = ['month', 'year', 'lifetime'].includes(String(body.billingInterval)) ? String(body.billingInterval) as 'month' | 'year' | 'lifetime' : null;
  const storage = Number(body.storageLimitBytes);
  const maxUsers = Number(body.maxUsers);
  const maxProjects = Number(body.maxProjects);
  const maxPhotosPerGallery = Number(body.maxPhotosPerGallery);
  const watermarkLevel = body.watermarkLevel === 'advanced' ? 'advanced' : body.watermarkLevel === 'basic' ? 'basic' : null;
  const supportLevel = body.supportLevel === 'priority' ? 'priority' : body.supportLevel === 'standard' ? 'standard' : null;
  const status = body.status === 'inactive' ? 'inactive' : body.status === 'active' ? 'active' : null;
  if (!name || name.length > 80 || !Number.isFinite(price) || price < 0 || !currency || !billingInterval || !Number.isSafeInteger(storage) || storage < 0 || !Number.isSafeInteger(maxUsers) || maxUsers < 1 || !Number.isSafeInteger(maxProjects) || maxProjects < 0 || !Number.isSafeInteger(maxPhotosPerGallery) || maxPhotosPerGallery < 0 || !watermarkLevel || !supportLevel || !status) return null;
  const allowedFeatures = ['clientDownloads', 'originalQualityDownloads', 'clientPaymentUnlock', 'qrGalleryLinks', 'galleryExpiration', 'ingalleryBranding', 'customBranding', 'customDomain', 'clientFavorites', 'galleryPassword', 'emailNotifications', 'analytics', 'bulkUpload', 'prioritySupport', 'teamManagement', 'agencyDashboard'];
  const rawFeatures = body.features && typeof body.features === 'object' ? body.features as Record<string, unknown> : {};
  const features = Object.fromEntries(allowedFeatures.map((key) => [key, rawFeatures[key] === true]));
  return { name, price, currency, billing_interval: billingInterval, storage_limit_bytes: storage, max_users: maxUsers, max_projects: maxProjects, max_photos_per_gallery: maxPhotosPerGallery, watermark_level: watermarkLevel, support_level: supportLevel, status, features };
};

app.post('/api/platform/admin/plans', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const plan = validatePlatformPlan(request.body as Record<string, unknown>);
  if (!plan) { response.status(400).json({ ok: false, message: 'Enter a valid package name, price, limits, currency, and status.' }); return; }
  const { data: duplicate } = await supabase.from('plans').select('id').ilike('name', plan.name).limit(1).maybeSingle();
  if (duplicate) { response.status(409).json({ ok: false, message: 'A package with that name already exists.' }); return; }
  const { data, error } = await supabase.from('plans').insert(plan).select('*').single();
  if (error || !data) { response.status(400).json({ ok: false, message: error?.message ?? 'Unable to create package.' }); return; }
  response.status(201).json({ ok: true, data });
});

app.put('/api/platform/admin/plans/:planId', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const plan = validatePlatformPlan(request.body as Record<string, unknown>);
  if (!plan) { response.status(400).json({ ok: false, message: 'Enter valid package details.' }); return; }
  const { data: duplicate } = await supabase.from('plans').select('id').ilike('name', plan.name).neq('id', String(request.params.planId)).limit(1).maybeSingle();
  if (duplicate) { response.status(409).json({ ok: false, message: 'Another package already uses that name.' }); return; }
  const { data, error } = await supabase.from('plans').update({ ...plan, updated_at: new Date().toISOString() })
    .eq('id', String(request.params.planId)).select('*').maybeSingle();
  if (error || !data) { response.status(404).json({ ok: false, message: error?.message ?? 'Package not found.' }); return; }
  response.json({ ok: true, data });
});

app.get('/api/platform/admin/revenue', ...platformAdminRoute, async (_request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  const packagePayments = await supabase.from('platform_package_payments').select('id, order_reference, amount, currency, status, provider, created_at, user_id, plan_id').order('created_at', { ascending: false }).limit(150);
  if (packagePayments.error) { response.status(500).json({ ok: false, message: 'Unable to load revenue records.' }); return; }
  const planIds = [...new Set((packagePayments.data ?? []).map((payment) => payment.plan_id))];
  const plans = planIds.length ? await supabase.from('plans').select('id, name').in('id', planIds) : { data: [] };
  const planNames = new Map((plans.data ?? []).map((plan) => [plan.id, plan.name]));
  const rows = (packagePayments.data ?? []).map((payment) => ({ ...payment, revenueType: 'Platform package', customer: planNames.get(payment.plan_id) ?? 'Plan purchase' }));
  response.json({ ok: true, data: rows });
});

app.get('/api/platform/admin/logs', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  const level = String(request.query.level ?? 'all');
  const limit = Math.min(250, Math.max(1, Number(request.query.limit ?? 100)));
  let query = supabase.from('platform_system_logs').select('id, level, method, route, status, duration_ms, user_id, created_at').order('created_at', { ascending: false }).limit(limit);
  if (['info', 'warning', 'error'].includes(level)) query = query.eq('level', level);
  const { data, error } = await query;
  if (error) { response.status(500).json({ ok: false, message: 'Unable to load system logs.' }); return; }
  response.json({ ok: true, data: data ?? [] });
});

app.get('/api/platform/admin/payment-settings', ...platformAdminRoute, async (_request: AuthenticatedRequest, response: Response) => {
  const { data, error } = await supabase.from('platform_payment_settings').select('provider, environment, updated_at').eq('id', true).maybeSingle();
  if (error) { response.status(500).json({ ok: false, message: 'Unable to load platform payment settings.' }); return; }
  response.json({ ok: true, data: { configured: Boolean(data), provider: data?.provider ?? null, environment: data?.environment ?? 'production', updatedAt: data?.updated_at ?? null } });
});

app.put('/api/platform/admin/payment-settings', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as PaymentSettingsBody;
  if (!['clickpesa', 'malipo', 'stakaba'].includes(body.provider ?? '') || !['sandbox', 'production'].includes(body.environment ?? '')) {
    response.status(400).json({ ok: false, message: 'Choose a supported payment provider and environment.' }); return;
  }
  let credentials: PaymentProviderCredentials | null = null;
  if (body.provider === 'clickpesa' && body.clientId?.trim() && body.apiKey?.trim()) credentials = { provider: 'clickpesa', clientId: body.clientId.trim(), apiKey: body.apiKey.trim(), ...(body.checksumKey?.trim() ? { checksumKey: body.checksumKey.trim() } : {}) };
  if (body.provider === 'malipo' && body.apiKey?.trim() && body.secretKey?.trim()) credentials = { provider: 'malipo', apiKey: body.apiKey.trim(), secretKey: body.secretKey.trim() };
  if (body.provider === 'stakaba' && body.apiKey?.trim()) credentials = { provider: 'stakaba', apiKey: body.apiKey.trim() };
  if (!credentials) { response.status(400).json({ ok: false, message: 'Enter the required credentials for this provider.' }); return; }
  try {
    const { count, error: pendingLookupError } = await supabase.from('platform_package_payments').select('id', { count: 'exact', head: true }).eq('status', 'PENDING');
    if (pendingLookupError) throw pendingLookupError;
    if ((count ?? 0) > 0) {
      response.status(409).json({ ok: false, message: 'Gateway settings cannot be changed while package payments are pending. Wait for them to complete, or resolve them before changing the gateway.' }); return;
    }
    const encrypted = encryptPaymentCredentials(credentials);
    const { error } = await supabase.from('platform_payment_settings').upsert({
      id: true,
      provider: credentials.provider,
      environment: body.environment,
      encrypted_credentials: encrypted.ciphertext,
      credentials_iv: encrypted.iv,
      credentials_auth_tag: encrypted.authTag,
      updated_by: request.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;
    response.json({ ok: true, data: { configured: true, provider: credentials.provider, environment: body.environment } });
  } catch (error) {
    response.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to save platform payment settings.' });
  }
});

app.post('/api/platform/admin/payment-settings/test', ...platformAdminRoute, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as PaymentSettingsBody;
  try {
    if (body.provider === 'clickpesa' && body.clientId && body.apiKey) await getClickPesaToken({ provider: 'clickpesa', clientId: body.clientId, apiKey: body.apiKey });
    else if (body.provider === 'malipo' && body.apiKey && body.secretKey) await getMalipoToken({ provider: 'malipo', apiKey: body.apiKey, secretKey: body.secretKey }, body.environment ?? 'production');
    else if (body.provider === 'stakaba' && body.apiKey) await requestStakaba('/api/v1/transactions?limit=1', body.apiKey);
    else { response.status(400).json({ ok: false, message: 'Enter the required provider credentials.' }); return; }
    response.json({ ok: true, data: { connected: true, provider: body.provider } });
  } catch (error) {
    response.status(502).json({ ok: false, message: error instanceof Error ? error.message : 'Provider connection failed.' });
  }
});

const loadPlatformPaymentConfiguration = async (): Promise<{ provider: string; environment: string; credentials: PaymentProviderCredentials } | null> => {
  const { data, error } = await supabase.from('platform_payment_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const credentials = decryptPaymentCredentials<PaymentProviderCredentials>({
    ciphertext: data.encrypted_credentials,
    iv: data.credentials_iv,
    authTag: data.credentials_auth_tag
  });
  return { provider: data.provider, environment: data.environment, credentials };
};

const activatePackageSubscription = async (payment: { id: string }, providerPayload: unknown): Promise<void> => {
  const { error } = await supabase.rpc('activate_platform_package_payment', { p_payment_id: payment.id, p_provider_payload: providerPayload });
  if (error) throw error;
};

app.post('/api/platform/subscriptions/checkout', requireUser, rateLimiter(10, 15 * 60 * 1000), async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as { planId?: string; customerPhone?: string; network?: string };
  const phone = String(body.customerPhone ?? '').trim();
  const normalizedPhone = phone.replace(/^\+/, '').replace(/^0/, '255');
  if (!body.planId || !/^255\d{9}$/.test(normalizedPhone)) {
    response.status(400).json({ ok: false, message: 'Choose a package and enter a valid Tanzanian mobile number.' }); return;
  }
  if (!STAKABA_NETWORKS.has(String(body.network ?? ''))) {
    response.status(400).json({ ok: false, message: 'Choose your mobile money network.' }); return;
  }
  let createdPaymentId: string | null = null;
  let providerInitiated = false;
  try {
    const [tenantId, planResult, configuration] = await Promise.all([
      resolveOwnedTenantId(request.userId as string),
      supabase.from('plans').select('id, name, price, currency, billing_interval, status').eq('id', body.planId).eq('status', 'active').maybeSingle(),
      loadPlatformPaymentConfiguration()
    ]);
    const plan = planResult.data;
    if (planResult.error || !plan) { response.status(404).json({ ok: false, message: 'The selected package is unavailable.' }); return; }
    if (Number(plan.price) <= 0) {
      await supabase.from('tenant_subscriptions').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('status', 'active');
      const startsAt = new Date();
      const expiresAt = plan.billing_interval === 'month' ? new Date(startsAt.getTime()) : plan.billing_interval === 'year' ? new Date(startsAt.getTime()) : null;
      if (expiresAt && plan.billing_interval === 'month') expiresAt.setMonth(expiresAt.getMonth() + 1);
      if (expiresAt && plan.billing_interval === 'year') expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const { error } = await supabase.from('tenant_subscriptions').insert({ tenant_id: tenantId, plan_id: plan.id, status: 'active', starts_at: startsAt.toISOString(), expires_at: expiresAt?.toISOString() ?? null });
      if (error) throw error;
      response.json({ ok: true, data: { paymentRequired: false, checkoutUrl: '/subscription_storage_plans/code.html' } }); return;
    }
    if (!configuration) { response.status(503).json({ ok: false, message: 'Package payments are not configured yet. Contact the platform owner.' }); return; }
    if (configuration.provider === 'stakaba' && plan.currency !== 'TZS') { response.status(400).json({ ok: false, message: 'Stakaba package checkout currently supports TZS plans only.' }); return; }

    const orderReference = `IGP${randomBytes(9).toString('hex').toUpperCase()}`;
    const { data: payment, error: insertError } = await supabase.from('platform_package_payments').insert({
      tenant_id: tenantId,
      user_id: request.userId,
      plan_id: plan.id,
      order_reference: orderReference,
      provider: configuration.provider,
      amount: plan.price,
      currency: plan.currency,
      billing_interval: plan.billing_interval,
      status: 'PENDING'
    }).select('id').single();
    if (insertError || !payment) throw insertError ?? new Error('Unable to create package payment.');
    createdPaymentId = payment.id;

    const pendingUrl = new URL('/payment_pending_status/code.html', resolveFrontendOrigin(request));
    pendingUrl.searchParams.set('type', 'package');
    pendingUrl.searchParams.set('reference', orderReference);
    pendingUrl.searchParams.set('package', plan.name);
    pendingUrl.searchParams.set('amount', String(plan.price));
    pendingUrl.searchParams.set('currency', plan.currency);
    let checkoutUrl = pendingUrl.toString();
    let paymentReference: string | null = null;
    let providerPayload: unknown = null;

    if (configuration.provider === 'malipo' && configuration.credentials.provider === 'malipo') {
      const token = await getMalipoToken(configuration.credentials, configuration.environment);
      const baseUrl = process.env.MALIPO_BASE_URL ?? 'https://pay.tunzaa.co.tz';
      const providerResponse = await fetch(`${baseUrl}/payments/initiate-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Environment': configuration.environment },
        body: JSON.stringify({ customer_msisdn: normalizedPhone, amount: String(plan.price), reference: orderReference })
      });
      providerPayload = await providerResponse.json();
      const result = providerPayload as { success?: boolean; transactionID?: string; message?: string };
      if (!providerResponse.ok || !result.success || !result.transactionID) throw new Error(result.message ?? 'Unable to initiate package payment with Malipo.');
      paymentReference = result.transactionID;
      providerInitiated = true;
    } else if (configuration.provider === 'clickpesa' && configuration.credentials.provider === 'clickpesa') {
      const token = await getClickPesaToken(configuration.credentials);
      const callbackUrl = `${process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${port}`}/api/platform/payments/clickpesa/webhook`;
      const description = `InGallery ${plan.name} package`;
      const customer = { totalPrice: String(plan.price), orderReference, orderCurrency: plan.currency, customerName: request.userEmail ?? '', customerEmail: request.userEmail ?? '', customerPhone: normalizedPhone, description, callbackUrl };
      const providerResponse = await fetch('https://api.clickpesa.com/third-parties/checkout-link/generate-checkout-url', {
        method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...customer, ...(configuration.credentials.checksumKey ? { checksum: createClickPesaChecksum(configuration.credentials.checksumKey, customer) } : {}) })
      });
      providerPayload = await providerResponse.json();
      const result = providerPayload as { checkoutLink?: string; message?: string };
      if (!providerResponse.ok || !result.checkoutLink) throw new Error(result.message ?? 'Unable to create package checkout with ClickPesa.');
      checkoutUrl = result.checkoutLink;
      providerInitiated = true;
    } else if (configuration.provider === 'stakaba' && configuration.credentials.provider === 'stakaba') {
      providerPayload = await requestStakaba('/api/v1/payments/collection', configuration.credentials.apiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grossAmount: Number(plan.price), currency: plan.currency, mobileNumber: normalizeStakabaPhone(phone), network: body.network, metadata: { orderId: orderReference } })
      });
      const resultData = (providerPayload as { data?: Record<string, unknown> }).data ?? providerPayload as Record<string, unknown>;
      paymentReference = String(resultData.internalReference ?? '');
      if (!paymentReference) throw new Error('Stakaba did not return a package payment reference.');
      providerInitiated = true;
    } else {
      throw new Error('The configured package payment provider is unavailable.');
    }

    const { error: updateError } = await supabase.from('platform_package_payments').update({
      payment_reference: paymentReference,
      checkout_url: checkoutUrl,
      provider_payload: providerPayload,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);
    if (updateError) throw updateError;
    response.status(202).json({ ok: true, data: { orderReference, transactionId: paymentReference, checkoutUrl } });
  } catch (error) {
    if (createdPaymentId && !providerInitiated) await supabase.from('platform_package_payments').update({ status: 'FAILED', updated_at: new Date().toISOString() }).eq('id', createdPaymentId).eq('status', 'PENDING');
    console.error('platform_package_payment_initiation_failed', error);
    const statusCode = error instanceof Error && error.message.startsWith('Only the studio owner') ? 403 : 502;
    response.status(statusCode).json({ ok: false, message: error instanceof Error ? error.message : 'Unable to start package payment.' });
  }
});

app.get('/api/platform/payments/orders/:orderReference/status', rateLimiter(60, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const orderReference = String(request.params.orderReference);
  if (!/^IGP[A-F0-9]{18}$/.test(orderReference)) { response.status(400).json({ ok: false, message: 'Invalid package payment reference.' }); return; }
  const { data: payment, error } = await supabase.from('platform_package_payments').select('*').eq('order_reference', orderReference).maybeSingle();
  if (error || !payment) { response.status(404).json({ ok: false, message: 'Package payment not found.' }); return; }
  if (payment.status === 'SUCCESS') { response.json({ ok: true, data: { status: 'SUCCESS' } }); return; }
  if (payment.status === 'FAILED') { response.json({ ok: true, data: { status: 'FAILED' } }); return; }
  try {
    const configuration = await loadPlatformPaymentConfiguration();
    if (!configuration || configuration.provider !== payment.provider) throw new Error('Platform payment configuration is unavailable.');
    let providerStatus = 'PENDING';
    let providerPayload: unknown = null;
    let paidAmount: number | null = null;
    let paidCurrency: string | null = null;
    if (payment.provider === 'malipo' && configuration.credentials.provider === 'malipo' && payment.payment_reference) {
      const token = await getMalipoToken(configuration.credentials, configuration.environment);
      const baseUrl = process.env.MALIPO_BASE_URL ?? 'https://pay.tunzaa.co.tz';
      const statusResponse = await fetch(`${baseUrl}/payments/check-status/${encodeURIComponent(payment.payment_reference)}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Environment': configuration.environment }
      });
      providerPayload = await statusResponse.json();
      if (!statusResponse.ok) throw new Error('Unable to verify package payment with Malipo.');
      const details = (providerPayload as { data?: Record<string, unknown> }).data ?? providerPayload as Record<string, unknown>;
      providerStatus = String(details.status ?? details.payment_status ?? details.transaction_status ?? '').toUpperCase();
      paidAmount = Number(details.amount ?? details.paid_amount ?? details.collectedAmount);
      paidCurrency = String(details.currency ?? details.collectedCurrency ?? payment.currency);
      if (['COMPLETED', 'SUCCESS', 'PAID'].includes(providerStatus)) providerStatus = 'SUCCESS';
      else if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(providerStatus)) providerStatus = 'FAILED';
      else providerStatus = 'PENDING';
    } else if (payment.provider === 'clickpesa' && configuration.credentials.provider === 'clickpesa') {
      const token = await getClickPesaToken(configuration.credentials);
      const verifyResponse = await fetch(`https://api.clickpesa.com/third-parties/payments/${encodeURIComponent(orderReference)}`, { headers: { Authorization: token } });
      providerPayload = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error('Unable to verify package payment with ClickPesa.');
      const all = Array.isArray(providerPayload) ? providerPayload : Array.isArray((providerPayload as { data?: unknown }).data) ? (providerPayload as { data: Record<string, unknown>[] }).data : [providerPayload as Record<string, unknown>];
      const detail = all.find((item) => String(item.orderReference ?? '') === orderReference);
      providerStatus = String(detail?.status ?? '').toUpperCase();
      paidAmount = Number(detail?.collectedAmount);
      paidCurrency = String(detail?.collectedCurrency ?? payment.currency);
      if (['SUCCESS', 'SETTLED', 'COMPLETED', 'PAID'].includes(providerStatus)) providerStatus = 'SUCCESS';
      else if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED'].includes(providerStatus)) providerStatus = 'FAILED';
      else providerStatus = 'PENDING';
    } else if (payment.provider === 'stakaba' && configuration.credentials.provider === 'stakaba' && payment.payment_reference) {
      providerPayload = await readStakabaTransaction(configuration.credentials.apiKey, payment.payment_reference);
      const detail = providerPayload as Record<string, unknown>;
      providerStatus = String(detail.status ?? '').toUpperCase();
      paidAmount = Number(detail.grossAmount ?? detail.amount);
      paidCurrency = String(detail.currency ?? payment.currency);
      if (['SUCCESS', 'SETTLED', 'COMPLETED', 'PAID'].includes(providerStatus)) providerStatus = 'SUCCESS';
      else if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(providerStatus)) providerStatus = 'FAILED';
      else providerStatus = 'PENDING';
    }
    if (providerStatus === 'SUCCESS' && (paidAmount !== Number(payment.amount) || paidCurrency !== payment.currency)) {
      response.status(400).json({ ok: false, message: 'Package payment amount verification failed.' }); return;
    }
    if (providerStatus === 'SUCCESS') {
      await activatePackageSubscription(payment, providerPayload);
      response.json({ ok: true, data: { status: 'SUCCESS' } }); return;
    }
    if (providerStatus === 'FAILED') {
      const { error: updateError } = await supabase.from('platform_package_payments').update({ status: 'FAILED', provider_payload: providerPayload, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'PENDING');
      if (updateError) throw updateError;
      response.json({ ok: true, data: { status: 'FAILED' } }); return;
    }
    response.json({ ok: true, data: { status: 'PENDING' } });
  } catch (error) {
    console.error('platform_package_payment_status_failed', error);
    response.status(502).json({ ok: false, message: 'Unable to verify package payment right now.' });
  }
});

interface StakabaOrderForVerification {
  id: string;
  gallery_id: string | null;
  owner_id: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  payment_reference: string | null;
  payment_verified_at?: string | null;
}

const verifyStakabaOrder = async (order: StakabaOrderForVerification): Promise<'SUCCESS' | 'FAILED' | 'PENDING'> => {
  if (!order.payment_reference) return 'PENDING';
  const tenantContext = await ensureTenantForUser(order.owner_id);
  const configuration = await loadTenantPaymentConfiguration(tenantContext.tenantId, 'stakaba');
  if (!configuration || configuration.provider !== 'stakaba' || configuration.credentials.provider !== 'stakaba') {
    throw new Error('The gallery owner Stakaba account is unavailable.');
  }

  const transaction = await readStakabaTransaction(configuration.credentials.apiKey, order.payment_reference);
  if (String(transaction.internalReference ?? '') !== order.payment_reference) {
    throw new Error('Stakaba transaction reference verification failed.');
  }
  const status = String(transaction.status ?? '').toUpperCase();
  if (status === 'SUCCESS') {
    const amountMatches = Number(transaction.grossAmount) === Number(order.amount);
    const currencyMatches = String(transaction.currency ?? '') === order.currency;
    if (!amountMatches || !currencyMatches) throw new Error('Stakaba transaction amount verification failed.');
    if (!order.payment_verified_at) {
      const now = new Date().toISOString();
      const { error } = await supabase.from('orders').update({
        status: 'SUCCESS',
        payment_verified_at: now,
        provider_payload: transaction,
        updated_at: now
      }).eq('id', order.id).neq('status', 'FAILED');
      if (error) throw error;
    }
    return 'SUCCESS';
  }
  if (status === 'FAILED') {
    const { error } = await supabase.from('orders').update({ status: 'FAILED', provider_payload: transaction, updated_at: new Date().toISOString() })
      .eq('id', order.id).neq('status', 'SUCCESS');
    if (error) throw error;
    return 'FAILED';
  }
  return 'PENDING';
};

app.post('/api/payment-settings/test', requireUser, async (request: AuthenticatedRequest, response: Response) => {
  const body = request.body as PaymentSettingsBody;
  if (body.provider !== 'clickpesa' && body.provider !== 'malipo' && body.provider !== 'stakaba') {
    response.status(400).json({ ok: false, message: 'Choose a supported payment provider.' });
    return;
  }
  const provider = body.provider;
  const environment = provider === 'clickpesa' ? 'production' : body.environment;
  if (environment !== 'sandbox' && environment !== 'production') {
    response.status(400).json({ ok: false, message: 'Choose a valid payment environment.' });
    return;
  }

  try {
    const tenantId = await resolveOwnedTenantId(request.userId as string);
    const firstCredential = (provider === 'clickpesa' ? body.clientId : body.apiKey)?.trim();
    const secondCredential = provider === 'clickpesa' ? body.apiKey?.trim() : provider === 'malipo' ? body.secretKey?.trim() : undefined;
    const hasPrimaryCredentials = provider === 'clickpesa'
      ? Boolean(body.clientId?.trim() || body.apiKey?.trim())
      : provider === 'malipo'
        ? Boolean(body.apiKey?.trim() || body.secretKey?.trim())
        : Boolean(body.apiKey?.trim());
    let credentials: PaymentProviderCredentials;
    if (hasPrimaryCredentials) {
      const missingCredential = provider === 'stakaba' ? !firstCredential : !firstCredential || !secondCredential;
      if (missingCredential || !firstCredential || firstCredential.length > 500 || (secondCredential && secondCredential.length > 500)) {
        response.status(400).json({ ok: false, message: provider === 'stakaba' ? 'Enter the Stakaba API key before testing.' : 'Enter both credentials for the selected provider before testing.' });
        return;
      }
      credentials = provider === 'clickpesa'
        ? { provider, clientId: firstCredential, apiKey: secondCredential!, ...(body.checksumKey?.trim() ? { checksumKey: body.checksumKey.trim() } : {}) }
        : provider === 'malipo'
          ? { provider, apiKey: firstCredential, secretKey: secondCredential! }
          : { provider, apiKey: firstCredential };
    } else {
      const saved = await loadTenantPaymentConfiguration(tenantId, provider);
      if (!saved || saved.credentials.provider !== provider) {
        response.status(400).json({ ok: false, message: 'Enter credentials or connect this provider before testing.' });
        return;
      }
      credentials = provider === 'clickpesa' && saved.credentials.provider === 'clickpesa' && body.checksumKey?.trim()
        ? { ...saved.credentials, checksumKey: body.checksumKey.trim() }
        : saved.credentials;
    }

    if (provider === 'clickpesa' && credentials.provider === 'clickpesa') {
      await getClickPesaToken(credentials);
    } else if (provider === 'malipo' && credentials.provider === 'malipo') {
      await getMalipoToken(credentials, environment);
    } else if (provider === 'stakaba' && credentials.provider === 'stakaba') {
      if (!credentials.apiKey.startsWith(environment === 'sandbox' ? 'sk_test_' : 'sk_live_')) {
        response.status(400).json({ ok: false, message: `Use a Stakaba ${environment === 'sandbox' ? 'sandbox' : 'live'} API key for the selected environment.` });
        return;
      }
      await requestStakaba('/api/v1/transactions?limit=1', credentials.apiKey);
    } else {
      response.status(400).json({ ok: false, message: 'Credentials do not match the selected provider.' });
      return;
    }

    const message = provider === 'clickpesa'
      ? credentials.provider === 'clickpesa' && credentials.checksumKey
        ? 'ClickPesa API credentials authenticated. The checksum key will sign checkout requests.'
        : 'ClickPesa API credentials authenticated. Add your checksum key if checksum validation is enabled in ClickPesa.'
      : 'Provider credentials authenticated successfully.';
    response.json({ ok: true, data: { provider, connected: true }, message });
  } catch (error) {
    const isOwnerError = error instanceof Error && error.message.startsWith('Only the studio owner');
    console.warn('payment_provider_connectivity_test_failed', { provider, message: error instanceof Error ? error.message : 'Unknown provider error' });
    const providerLabel = provider === 'clickpesa' ? 'ClickPesa' : provider === 'malipo' ? 'Malipo by Tunzaa' : 'Stakaba';
    response.status(isOwnerError ? 403 : 400).json({
      ok: false,
      message: isOwnerError ? error.message : `Unable to connect to ${providerLabel}. Check the credentials and environment.`
    });
  }
});

const STAKABA_NETWORKS = new Set(['Mpesa', 'TigoPesa', 'AirtelMoney', 'HaloPesa']);

const normalizeStakabaPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('255')) return digits;
  if (digits.startsWith('0')) return `255${digits.slice(1)}`;
  return digits.length === 9 ? `255${digits}` : digits;
};

const initiateGalleryPayment = async (request: Request, response: Response): Promise<void> => {
  const body = request.body as CheckoutBody;
  if (!body.galleryId || !body.customerPhone) { response.status(400).json({ ok: false, message: 'Gallery and customer phone are required' }); return; }
  const { data: gallery, error: galleryError } = await supabase.from('galleries').select('id, owner_id, title, access_price, currency, is_unlocked').eq('id', body.galleryId).single();
  if (galleryError || !gallery) { response.status(404).json({ ok: false, message: 'Gallery not found' }); return; }
  if (Number(gallery.access_price) <= 0) { response.status(409).json({ ok: false, message: 'This gallery is free and does not require checkout.' }); return; }

  let tenantConfiguration: TenantPaymentConfiguration | null;
  try {
    const tenantContext = await ensureTenantForUser(gallery.owner_id);
    tenantConfiguration = await loadTenantPaymentConfiguration(tenantContext.tenantId);
    console.log("DEBUG: initiateGalleryPayment provider for tenant ", tenantContext.tenantId, " : ", tenantConfiguration?.provider);
  } catch (error) {
    console.error('gallery_payment_provider_lookup_failed', error);
    response.status(503).json({ ok: false, message: 'The gallery owner payment account is unavailable.' });
    return;
  }
  if (!tenantConfiguration) {
    response.status(409).json({ ok: false, message: 'The gallery owner has not connected a payment provider yet.' });
    return;
  }
  if (tenantConfiguration.provider === 'stakaba') {
    if (gallery.currency !== 'TZS' || !Number.isSafeInteger(Number(gallery.access_price))) {
      response.status(400).json({ ok: false, message: 'Stakaba mobile-money checkout requires a whole-number TZS price.' });
      return;
    }
    if (!STAKABA_NETWORKS.has(body.network ?? '')) {
      response.status(400).json({ ok: false, message: 'Choose a supported mobile money network.' });
      return;
    }
    if (!/^255\d{9}$/.test(normalizeStakabaPhone(body.customerPhone))) {
      response.status(400).json({ ok: false, message: 'Enter a valid Tanzanian mobile number.' });
      return;
    }
  }

  const orderReference = `IG${randomBytes(9).toString('hex').toUpperCase()}`;
  const { data: order, error: orderError } = await supabase.from('orders').insert({
    gallery_id: gallery.id,
    owner_id: gallery.owner_id,
    order_reference: orderReference,
    customer_name: body.customerName?.trim() || null,
    customer_email: body.customerEmail?.trim() || null,
    customer_phone: body.customerPhone.trim(),
    amount: gallery.access_price,
    currency: gallery.currency,
    status: 'PENDING',
    provider: tenantConfiguration.provider
  }).select('id, order_reference, amount, currency').single();
  if (orderError || !order) { response.status(500).json({ ok: false, message: orderError?.message ?? 'Unable to create order' }); return; }

  try {
    if (tenantConfiguration.provider === 'malipo' && tenantConfiguration.credentials.provider === 'malipo') {
      const { credentials, environment } = tenantConfiguration;
      const token = await getMalipoToken(credentials, environment);
      const baseUrl = process.env.MALIPO_BASE_URL ?? 'https://pay.tunzaa.co.tz';
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Environment': environment };
      if (environment === 'sandbox' && process.env.MALIPO_SANDBOX_SCENARIO) headers['X-Sandbox-Scenario'] = process.env.MALIPO_SANDBOX_SCENARIO;
      const paymentResponse = await fetch(`${baseUrl}/payments/initiate-payment`, { method: 'POST', headers, body: JSON.stringify({ customer_msisdn: body.customerPhone.trim().replace(/^\+/, ''), amount: String(order.amount), reference: orderReference }) });
      const paymentBody = (await paymentResponse.json()) as { success?: boolean; transactionID?: string; message?: string };
      if (!paymentResponse.ok || !paymentBody.success || !paymentBody.transactionID) throw new Error(paymentBody.message ?? 'Unable to initiate Malipo payment');
      const { error: updateError } = await supabase.from('orders').update({ payment_reference: paymentBody.transactionID, provider_payload: paymentBody, updated_at: new Date().toISOString() }).eq('id', order.id);
      if (updateError) throw updateError;
      const pendingUrl = new URL('/payment_pending_status/code.html', resolveFrontendOrigin(request));
      pendingUrl.searchParams.set('reference', orderReference);
      pendingUrl.searchParams.set('transactionId', paymentBody.transactionID);
      pendingUrl.searchParams.set('galleryId', gallery.id);
      pendingUrl.searchParams.set('gallery', gallery.title);
      response.status(202).json({ ok: true, data: { orderReference, transactionId: paymentBody.transactionID, checkoutUrl: pendingUrl.toString() } });
      return;
    }

    if (tenantConfiguration.provider === 'clickpesa' && tenantConfiguration.credentials.provider === 'clickpesa') {
      const token = await getClickPesaToken(tenantConfiguration.credentials);
      const callbackUrl = `${process.env.PUBLIC_API_BASE_URL ?? `http://localhost:${port}`}/api/payments/clickpesa/webhook`;
      const clickPesaResponse = await fetch('https://api.clickpesa.com/third-parties/checkout-link/generate-checkout-url', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalPrice: String(order.amount),
          orderReference,
          orderCurrency: order.currency,
          customerName: body.customerName?.trim(),
          customerEmail: body.customerEmail?.trim(),
          customerPhone: body.customerPhone.trim().replace(/^\+/, ''),
          description: `Gallery access: ${gallery.title}`,
          callbackUrl,
          ...(tenantConfiguration.credentials.checksumKey ? { checksum: createClickPesaChecksum(tenantConfiguration.credentials.checksumKey, { totalPrice: String(order.amount), orderReference, orderCurrency: order.currency, customerName: body.customerName?.trim(), customerEmail: body.customerEmail?.trim(), customerPhone: body.customerPhone.trim().replace(/^\+/, ''), description: `Gallery access: ${gallery.title}`, callbackUrl }) } : {}),
        })
      });
      const providerBody = (await clickPesaResponse.json()) as { checkoutLink?: string; message?: string };
      if (!clickPesaResponse.ok || !providerBody.checkoutLink) throw new Error(providerBody.message ?? 'Unable to create ClickPesa checkout link');
      const { error: updateError } = await supabase.from('orders').update({ checkout_url: providerBody.checkoutLink, provider_payload: providerBody, updated_at: new Date().toISOString() }).eq('id', order.id);
      if (updateError) throw updateError;
      response.status(201).json({ ok: true, data: { orderReference, checkoutUrl: providerBody.checkoutLink } });
      return;
    }

    if (tenantConfiguration.provider === 'stakaba' && tenantConfiguration.credentials.provider === 'stakaba') {
      const providerBody = await requestStakaba('/api/v1/payments/collection', tenantConfiguration.credentials.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grossAmount: Number(order.amount),
          currency: 'TZS',
          mobileNumber: normalizeStakabaPhone(body.customerPhone),
          network: body.network,
          metadata: { orderId: orderReference }
        })
      });
      const resultData = providerBody.data && typeof providerBody.data === 'object'
        ? providerBody.data as Record<string, unknown>
        : providerBody;
      const internalReference = String(resultData.internalReference ?? '');
      if (!internalReference) throw new Error('Stakaba did not return a transaction reference.');
      const { error: updateError } = await supabase.from('orders').update({
        payment_reference: internalReference,
        provider_payload: providerBody,
        updated_at: new Date().toISOString()
      }).eq('id', order.id);
      if (updateError) throw updateError;
      const pendingUrl = new URL('/payment_pending_status/code.html', resolveFrontendOrigin(request));
      pendingUrl.searchParams.set('reference', orderReference);
      pendingUrl.searchParams.set('galleryId', gallery.id);
      pendingUrl.searchParams.set('gallery', gallery.title);
      response.status(202).json({ ok: true, data: { orderReference, transactionId: internalReference, checkoutUrl: pendingUrl.toString() } });
      return;
    }

    throw new Error('The selected payment provider is not available.');
  } catch (error) {
    await supabase.from('orders').update({ status: 'FAILED', updated_at: new Date().toISOString() }).eq('id', order.id);
    console.error('gallery_payment_initiation_failed', error);
    const message = error instanceof Error ? error.message : 'Unable to start payment. Check the gallery owner payment settings and try again.';
    response.status(502).json({ ok: false, message });
  }
};

app.post('/api/payments/initiate', rateLimiter(10, 15 * 60 * 1000), initiateGalleryPayment);
app.post('/api/payments/malipo/initiate', rateLimiter(10, 15 * 60 * 1000), initiateGalleryPayment);

const checkPaymentStatus = async (request: Request, response: Response): Promise<void> => {
  try {
    const transactionId = String(request.params.transactionId);
    const { data: order, error: orderError } = await supabase.from('orders')
      .select('id, gallery_id, owner_id, amount, currency, status, provider, payment_verified_at')
      .eq('payment_reference', transactionId).maybeSingle();
    if (orderError || !order) {
      response.status(404).json({ ok: false, message: 'Payment order not found.' });
      return;
    }
    if (order.status === 'SUCCESS' && order.payment_verified_at) {
      response.json({ ok: true, data: {
        status: 'SUCCESS',
        ...(order.gallery_id ? { accessToken: createGalleryAccessToken(order.id, order.gallery_id) } : {})
      } });
      return;
    }
    if (order.status === 'FAILED') {
      response.json({ ok: true, data: { status: 'FAILED' } });
      return;
    }
    if (order.provider !== 'malipo') {
      response.json({ ok: true, data: { status: order.status } });
      return;
    }

    const tenantContext = await ensureTenantForUser(order.owner_id);
    const tenantConfiguration = await loadTenantPaymentConfiguration(tenantContext.tenantId, 'malipo');
    if (tenantConfiguration?.provider !== 'malipo' || tenantConfiguration.credentials.provider !== 'malipo') {
      response.status(503).json({ ok: false, message: 'The gallery owner Malipo account is not connected.' });
      return;
    }
    const { credentials, environment } = tenantConfiguration;
    const token = await getMalipoToken(credentials, environment);
    const baseUrl = process.env.MALIPO_BASE_URL ?? 'https://pay.tunzaa.co.tz';
    const statusResponse = await fetch(`${baseUrl}/payments/check-status/${encodeURIComponent(transactionId)}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Environment': environment } });
    const statusBody = await statusResponse.json() as { data?: unknown; message?: string; [key: string]: unknown };
    if (!statusResponse.ok) {
      response.status(502).json({ ok: false, message: 'Unable to check payment status with the gallery owner provider.' });
      return;
    }

    const paymentData = statusBody.data && typeof statusBody.data === 'object' && !Array.isArray(statusBody.data)
      ? statusBody.data as Record<string, unknown>
      : statusBody;
    const paymentStatus = String(paymentData.status ?? paymentData.payment_status ?? paymentData.transaction_status ?? '').toUpperCase();
    const paidStatuses = new Set(['COMPLETED', 'SUCCESS', 'PAID']);
    if (paidStatuses.has(paymentStatus)) {
      const returnedTransactionId = paymentData.transactionID ?? paymentData.transactionId ?? paymentData.transaction_id;
      if (returnedTransactionId && String(returnedTransactionId) !== transactionId) {
        response.status(400).json({ ok: false, message: 'Payment transaction verification failed.' });
        return;
      }

      const paidAmount = Number(paymentData.amount ?? paymentData.paid_amount ?? paymentData.collectedAmount);
      const paidCurrency = paymentData.currency ?? paymentData.collectedCurrency;
      if (!Number.isFinite(paidAmount) || paidAmount !== Number(order.amount) || (paidCurrency && String(paidCurrency) !== order.currency)) {
        response.status(400).json({ ok: false, message: 'Payment amount verification failed.' });
        return;
      }

      const now = new Date().toISOString();
      const { error: updateOrderError } = await supabase.from('orders')
        .update({ status: 'SUCCESS', payment_verified_at: now, provider_payload: statusBody, updated_at: now })
        .eq('id', order.id);
      if (updateOrderError) {
        response.status(500).json({ ok: false, message: 'Unable to confirm the payment order.' });
        return;
      }
      response.json({ ok: true, data: {
        ...paymentData,
        status: 'COMPLETED',
        accessToken: order.gallery_id ? createGalleryAccessToken(order.id, order.gallery_id) : null
      }, message: statusBody.message });
      return;
    }

    if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(paymentStatus)) {
      const { error: updateError } = await supabase.from('orders').update({ status: 'FAILED', provider_payload: statusBody, updated_at: new Date().toISOString() }).eq('id', order.id);
      if (updateError) throw updateError;
      response.json({ ok: true, data: { status: 'FAILED' } });
      return;
    }
    response.json({ ok: true, data: { status: 'PENDING' }, message: statusBody.message });
  } catch (error) {
    console.error('gallery_payment_status_failed', error);
    response.status(502).json({ ok: false, message: 'Unable to check payment status right now.' });
  }
};

app.get('/api/payments/status/:transactionId', checkPaymentStatus);
app.get('/api/payments/malipo/status/:transactionId', checkPaymentStatus);

app.get('/api/payments/orders/:orderReference/status', async (request: Request, response: Response) => {
  const orderReference = String(request.params.orderReference);
  if (!/^[A-Za-z0-9]{1,20}$/.test(orderReference)) {
    response.status(400).json({ ok: false, message: 'Invalid order reference.' });
    return;
  }
  const { data: order, error: orderError } = await supabase.from('orders')
    .select('id, gallery_id, owner_id, amount, currency, status, provider, payment_reference, payment_verified_at')
    .eq('order_reference', orderReference).maybeSingle();
  if (orderError || !order) {
    response.status(404).json({ ok: false, message: 'Payment order not found.' });
    return;
  }
  if (order.status === 'SUCCESS' && order.payment_verified_at) {
    response.json({ ok: true, data: {
      status: 'SUCCESS',
      accessToken: order.gallery_id ? createGalleryAccessToken(order.id, order.gallery_id) : null
    } });
    return;
  }
  if (order.status === 'FAILED') {
    response.json({ ok: true, data: { status: 'FAILED' } });
    return;
  }
  if (order.provider === 'stakaba') {
    try {
      const status = await verifyStakabaOrder(order);
      response.json({ ok: true, data: {
        status,
        ...(status === 'SUCCESS' && order.gallery_id ? { accessToken: createGalleryAccessToken(order.id, order.gallery_id) } : {})
      } });
    } catch (error) {
      console.error('stakaba_order_status_check_failed', error);
      response.status(502).json({ ok: false, message: 'Unable to verify this payment right now.' });
    }
    return;
  }
  if (order.provider !== 'clickpesa') {
    response.json({ ok: true, data: { status: 'PENDING' } });
    return;
  }

  try {
    const tenantContext = await ensureTenantForUser(order.owner_id);
    const configuration = await loadTenantPaymentConfiguration(tenantContext.tenantId, 'clickpesa');
    if (!configuration || configuration.credentials.provider !== 'clickpesa') {
      response.status(503).json({ ok: false, message: 'The gallery owner ClickPesa account is unavailable.' });
      return;
    }
    const token = await getClickPesaToken(configuration.credentials);
    const providerResponse = await fetch(`https://api.clickpesa.com/third-parties/payments/${encodeURIComponent(orderReference)}`, {
      headers: { Authorization: token }
    });
    const providerBody = await providerResponse.json() as Array<Record<string, unknown>> | Record<string, unknown>;
    if (!providerResponse.ok) throw new Error('ClickPesa payment lookup failed.');
    const payments = Array.isArray(providerBody)
      ? providerBody
      : Array.isArray((providerBody as { data?: unknown }).data)
        ? (providerBody as { data: Array<Record<string, unknown>> }).data
        : [providerBody];
    const payment = payments.find((candidate) => String(candidate.orderReference ?? '') === orderReference);
    const providerStatus = String(payment?.status ?? '').toUpperCase();
    if (!payment || ['PENDING', 'PROCESSING'].includes(providerStatus)) {
      response.json({ ok: true, data: { status: 'PENDING' } });
      return;
    }
    if (['SUCCESS', 'SETTLED'].includes(providerStatus)) {
      const amountMatches = Number(payment.collectedAmount) === Number(order.amount);
      const currencyMatches = !payment.collectedCurrency || payment.collectedCurrency === order.currency;
      if (!amountMatches || !currencyMatches) {
        response.status(400).json({ ok: false, message: 'Payment amount verification failed.' });
        return;
      }
      const { error: updateError } = await supabase.from('orders').update({
        status: 'SUCCESS',
        payment_verified_at: new Date().toISOString(),
        payment_reference: String(payment.paymentReference ?? payment.id ?? ''),
        provider_payload: payment,
        updated_at: new Date().toISOString()
      }).eq('id', order.id).neq('status', 'SUCCESS');
      if (updateError) throw updateError;
      response.json({ ok: true, data: {
        status: 'SUCCESS',
        accessToken: order.gallery_id ? createGalleryAccessToken(order.id, order.gallery_id) : null
      } });
      return;
    }
    if (providerStatus === 'FAILED') {
      const { error: updateError } = await supabase.from('orders').update({ status: 'FAILED', provider_payload: payment, updated_at: new Date().toISOString() })
        .eq('id', order.id).neq('status', 'SUCCESS');
      if (updateError) throw updateError;
      response.json({ ok: true, data: { status: 'FAILED' } });
      return;
    }
    response.json({ ok: true, data: { status: 'PENDING' } });
  } catch (error) {
    console.error('clickpesa_order_status_check_failed', error);
    response.status(502).json({ ok: false, message: 'Unable to verify this payment right now.' });
  }
});

app.post('/api/payments/stakaba/webhook', async (request: Request, response: Response) => {
  const payload = request.body as { internalReference?: string };
  const internalReference = String(payload.internalReference ?? '');
  if (!internalReference || internalReference.length > 100) {
    response.status(400).json({ ok: false, message: 'Invalid Stakaba payment reference.' });
    return;
  }
  const { data: order, error } = await supabase.from('orders')
    .select('id, gallery_id, owner_id, amount, currency, status, provider, payment_reference, payment_verified_at')
    .eq('provider', 'stakaba').eq('payment_reference', internalReference).maybeSingle();
  if (error || !order) {
    response.status(404).json({ ok: false, message: 'Stakaba payment order not found.' });
    return;
  }
  try {
    const status = await verifyStakabaOrder(order);
    if (status === 'PENDING') {
      response.status(503).json({ ok: false, message: 'Stakaba has not confirmed a final payment status yet.' });
      return;
    }
    response.status(200).json({ ok: true });
  } catch (error) {
    console.error('stakaba_webhook_verification_failed', error);
    response.status(503).json({ ok: false, message: 'Unable to verify Stakaba payment yet.' });
  }
});

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortKeys(entry)]));
  return value;
};

app.post('/api/platform/payments/clickpesa/webhook', rateLimiter(100, 15 * 60 * 1000), async (request: Request, response: Response) => {
  const payload = request.body as ClickPesaWebhook;
  const orderReference = String(payload.data?.orderReference ?? '');
  if (!orderReference) { response.status(400).json({ ok: false, message: 'Missing package order reference.' }); return; }
  const { data: payment, error } = await supabase.from('platform_package_payments').select('*').eq('order_reference', orderReference).eq('provider', 'clickpesa').maybeSingle();
  if (error || !payment) { response.status(404).json({ ok: false, message: 'Package payment not found.' }); return; }
  if (payment.status === 'SUCCESS') { response.json({ ok: true }); return; }
  try {
    const configuration = await loadPlatformPaymentConfiguration();
    if (configuration?.provider !== 'clickpesa' || configuration.credentials.provider !== 'clickpesa') throw new Error('ClickPesa is not configured.');
    const token = await getClickPesaToken(configuration.credentials);
    const providerResponse = await fetch(`https://api.clickpesa.com/third-parties/payments/${encodeURIComponent(orderReference)}`, { headers: { Authorization: token } });
    const providerBody = await providerResponse.json() as Array<Record<string, unknown>> | Record<string, unknown>;
    if (!providerResponse.ok) throw new Error('Unable to verify ClickPesa payment.');
    const wrappedData = (providerBody as { data?: unknown }).data;
    const payments = Array.isArray(providerBody) ? providerBody : Array.isArray(wrappedData) ? wrappedData as Array<Record<string, unknown>> : [providerBody];
    const verified = payments.find((item) => String(item.orderReference ?? '') === orderReference);
    const verifiedStatus = String(verified?.status ?? '').toUpperCase();
    if (['SUCCESS', 'SETTLED', 'COMPLETED', 'PAID'].includes(verifiedStatus)) {
      if (Number(verified?.collectedAmount) !== Number(payment.amount) || String(verified?.collectedCurrency ?? payment.currency) !== payment.currency) {
        response.status(400).json({ ok: false, message: 'Package payment amount verification failed.' }); return;
      }
      await activatePackageSubscription(payment, providerBody);
    } else if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED'].includes(verifiedStatus)) {
      await supabase.from('platform_package_payments').update({ status: 'FAILED', provider_payload: providerBody, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'PENDING');
    }
    response.json({ ok: true });
  } catch (error) {
    console.error('platform_clickpesa_webhook_verification_failed', error);
    response.status(503).json({ ok: false, message: 'Unable to verify package payment yet.' });
  }
});

app.post('/api/platform/payments/stakaba/webhook', async (request: Request, response: Response) => {
  const internalReference = String((request.body as { internalReference?: string }).internalReference ?? '');
  if (!internalReference) { response.status(400).json({ ok: false, message: 'Missing Stakaba reference.' }); return; }
  const { data: payment, error } = await supabase.from('platform_package_payments').select('*').eq('payment_reference', internalReference).eq('provider', 'stakaba').maybeSingle();
  if (error || !payment) { response.status(404).json({ ok: false, message: 'Package payment not found.' }); return; }
  if (payment.status === 'SUCCESS') { response.json({ ok: true }); return; }
  try {
    const configuration = await loadPlatformPaymentConfiguration();
    if (configuration?.provider !== 'stakaba' || configuration.credentials.provider !== 'stakaba') throw new Error('Stakaba is not configured.');
    const detail = await readStakabaTransaction(configuration.credentials.apiKey, internalReference);
    const status = String(detail.status ?? '').toUpperCase();
    if (['SUCCESS', 'SETTLED', 'COMPLETED', 'PAID'].includes(status)) {
      if (Number(detail.grossAmount ?? detail.amount) !== Number(payment.amount) || String(detail.currency ?? payment.currency) !== payment.currency) {
        response.status(400).json({ ok: false, message: 'Package payment amount verification failed.' }); return;
      }
      await activatePackageSubscription(payment, detail);
    } else if (['FAILED', 'DECLINED', 'CANCELLED', 'CANCELED', 'REJECTED'].includes(status)) {
      await supabase.from('platform_package_payments').update({ status: 'FAILED', provider_payload: detail, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'PENDING');
    } else { response.status(503).json({ ok: false, message: 'Stakaba has not confirmed a final payment status.' }); return; }
    response.json({ ok: true });
  } catch (error) {
    console.error('platform_stakaba_webhook_verification_failed', error);
    response.status(503).json({ ok: false, message: 'Unable to verify package payment yet.' });
  }
});

app.post('/api/platform/payments/malipo/callback', async (request: Request, response: Response) => {
  const payload = request.body as MalipoCallback;
  if (!payload.reference_id || !payload.status) { response.status(400).json({ ok: false, message: 'Invalid package payment callback.' }); return; }
  const { data: payment, error } = await supabase.from('platform_package_payments').select('*').eq('order_reference', payload.reference_id).eq('provider', 'malipo').maybeSingle();
  if (error || !payment) { response.status(404).json({ ok: false, message: 'Package payment not found.' }); return; }
  if (payment.status === 'SUCCESS') { response.json({ ok: true }); return; }
  try {
    const configuration = await loadPlatformPaymentConfiguration();
    if (configuration?.provider !== 'malipo' || configuration.credentials.provider !== 'malipo') throw new Error('Malipo is not configured.');
    const signature = request.header('x-signature');
    const expected = createHmac('sha256', configuration.credentials.secretKey).update(JSON.stringify(sortKeys(request.body))).digest('hex');
    const signatureMatches = Boolean(signature && /^[a-fA-F0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')));
    if (!signatureMatches) { response.status(401).json({ ok: false, message: 'Invalid payment callback signature.' }); return; }
    if (payload.status === 'COMPLETED') {
      if (Number(payload.amount) !== Number(payment.amount)) { response.status(400).json({ ok: false, message: 'Package payment amount verification failed.' }); return; }
      await activatePackageSubscription(payment, payload);
    } else if (payload.status === 'FAILED') {
      await supabase.from('platform_package_payments').update({ status: 'FAILED', payment_reference: payload.transaction_id ?? null, provider_payload: payload, updated_at: new Date().toISOString() }).eq('id', payment.id).eq('status', 'PENDING');
    }
    response.json({ ok: true });
  } catch (error) {
    console.error('platform_malipo_callback_verification_failed', error);
    response.status(503).json({ ok: false, message: 'Unable to verify package payment yet.' });
  }
});

app.post('/api/payments/malipo/callback', async (request: Request, response: Response) => {
  const payload = request.body as MalipoCallback;
  if (!payload.reference_id || !payload.status) { response.status(400).json({ ok: false, message: 'Invalid Malipo callback' }); return; }
  const { data: order, error } = await supabase.from('orders').select('id, gallery_id, owner_id, amount, currency, provider, status, payment_verified_at').eq('order_reference', payload.reference_id).eq('provider', 'malipo').maybeSingle();
  if (error || !order) { response.status(404).json({ ok: false, message: 'Order not found' }); return; }
  if (order.status === 'SUCCESS' && order.payment_verified_at) { response.json({ ok: true }); return; }
  let tenantConfiguration: TenantPaymentConfiguration | null;
  try {
    const tenantContext = await ensureTenantForUser(order.owner_id);
    tenantConfiguration = await loadTenantPaymentConfiguration(tenantContext.tenantId, 'malipo');
  } catch (lookupError) {
    console.error('malipo_callback_credentials_lookup_failed', lookupError);
    response.status(500).json({ ok: false, message: 'Unable to verify payment callback.' });
    return;
  }
  if (tenantConfiguration?.provider !== 'malipo' || tenantConfiguration.credentials.provider !== 'malipo') {
    response.status(401).json({ ok: false, message: 'Malipo account configuration not found.' });
    return;
  }
  const signature = request.header('x-signature');
  const expected = createHmac('sha256', tenantConfiguration.credentials.secretKey).update(JSON.stringify(sortKeys(request.body))).digest('hex');
  let signatureMatches = false;
  if (signature && /^[a-fA-F0-9]{64}$/.test(signature)) {
    signatureMatches = timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  }
  if (!signatureMatches) { response.status(401).json({ ok: false, message: 'Invalid Malipo signature' }); return; }
  const amountMatches = Number(payload.amount) === Number(order.amount);
  if (payload.status === 'COMPLETED' && amountMatches) {
    const { error: updateError } = await supabase.from('orders').update({ status: 'SUCCESS', payment_verified_at: new Date().toISOString(), payment_reference: payload.transaction_id, provider_payload: payload, updated_at: new Date().toISOString() }).eq('id', order.id);
    if (updateError) { response.status(500).json({ ok: false, message: 'Unable to confirm payment.' }); return; }
  } else if (payload.status === 'FAILED') {
    const { error: updateError } = await supabase.from('orders').update({ status: 'FAILED', provider_payload: payload, updated_at: new Date().toISOString() }).eq('id', order.id);
    if (updateError) { response.status(500).json({ ok: false, message: 'Unable to update payment status.' }); return; }
  } else if (payload.status === 'COMPLETED') {
    response.status(400).json({ ok: false, message: 'Payment amount verification failed.' });
    return;
  }
  response.json({ ok: true });
});
app.post('/api/payments/clickpesa/checkout', initiateGalleryPayment);

const processClickPesaWebhook = async (payload: ClickPesaWebhook, response: Response): Promise<void> => {
  const event = payload.event?.toUpperCase();
  const payment = payload.data;
  if (!payment?.orderReference || !['PAYMENT RECEIVED', 'PAYMENT FAILED'].includes(event ?? '')) {
    response.status(400).json({ ok: false, message: 'Unsupported ClickPesa webhook' });
    return;
  }

  const { data: order, error: orderError } = await supabase.from('orders').select('id, gallery_id, owner_id, amount, currency, status, payment_verified_at').eq('order_reference', payment.orderReference).eq('provider', 'clickpesa').single();
  if (orderError || !order) {
    response.status(404).json({ ok: false, message: 'Order not found' });
    return;
  }
  if (order.status === 'SUCCESS' && order.payment_verified_at) {
    response.status(200).json({ ok: true });
    return;
  }

  let tenantConfiguration: TenantPaymentConfiguration | null;
  try {
    const tenantContext = await ensureTenantForUser(order.owner_id);
    tenantConfiguration = await loadTenantPaymentConfiguration(tenantContext.tenantId, 'clickpesa');
  } catch (error) {
    console.error('clickpesa_callback_credentials_lookup_failed', error);
    response.status(500).json({ ok: false, message: 'Unable to verify payment callback.' });
    return;
  }
  if (!tenantConfiguration || tenantConfiguration.credentials.provider !== 'clickpesa') {
    response.status(401).json({ ok: false, message: 'ClickPesa account configuration not found.' });
    return;
  }

  try {
    const token = await getClickPesaToken(tenantConfiguration.credentials);
    const verificationResponse = await fetch(`https://api.clickpesa.com/third-parties/payments/${encodeURIComponent(payment.orderReference)}`, {
      headers: { Authorization: token }
    });
    const verificationBody = await verificationResponse.json() as Array<Record<string, unknown>> | Record<string, unknown>;
    if (!verificationResponse.ok) throw new Error('ClickPesa payment lookup failed.');
    const verifiedPayments = Array.isArray(verificationBody)
      ? verificationBody
      : Array.isArray((verificationBody as { data?: unknown }).data)
        ? (verificationBody as { data: Array<Record<string, unknown>> }).data
        : [verificationBody];
    const verifiedPayment = verifiedPayments.find((entry) => String(entry.orderReference ?? '') === payment.orderReference);
    const verifiedStatus = String(verifiedPayment?.status ?? '').toUpperCase();
    const webhookStatus = String(payment.status ?? '').toUpperCase();
    const statusesMatch = event === 'PAYMENT RECEIVED'
      ? webhookStatus === 'SUCCESS' && ['SUCCESS', 'SETTLED'].includes(verifiedStatus)
      : webhookStatus === 'FAILED' && verifiedStatus === 'FAILED';
    if (!verifiedPayment || !statusesMatch) {
      response.status(400).json({ ok: false, message: 'ClickPesa payment verification failed.' });
      return;
    }

    if (event === 'PAYMENT RECEIVED') {
      const amountMatches = Number(verifiedPayment.collectedAmount) === Number(order.amount);
      const currencyMatches = !verifiedPayment.collectedCurrency || verifiedPayment.collectedCurrency === order.currency;
      if (!amountMatches || !currencyMatches) {
        response.status(400).json({ ok: false, message: 'Payment verification failed' });
        return;
      }
      const { error: updateError } = await supabase.from('orders').update({ status: 'SUCCESS', payment_verified_at: new Date().toISOString(), payment_reference: payment.paymentReference ?? payment.id, provider_payload: payload, updated_at: new Date().toISOString() }).eq('id', order.id);
      if (updateError) { response.status(500).json({ ok: false, message: 'Unable to confirm payment.' }); return; }
    } else {
      if (String(verifiedPayment.status ?? '').toUpperCase() !== 'FAILED') {
        response.status(400).json({ ok: false, message: 'Payment status verification failed' });
        return;
      }
      const { error: updateError } = await supabase.from('orders').update({ status: 'FAILED', provider_payload: payload, updated_at: new Date().toISOString() }).eq('id', order.id).neq('status', 'SUCCESS');
      if (updateError) { response.status(500).json({ ok: false, message: 'Unable to update payment status.' }); return; }
    }
    response.status(200).json({ ok: true });
  } catch (error) {
    console.error('clickpesa_callback_verification_failed', error);
    response.status(502).json({ ok: false, message: 'Unable to verify payment with ClickPesa right now.' });
  }
};

app.post('/api/payments/clickpesa/webhook', rateLimiter(100, 15 * 60 * 1000), async (request: Request, response: Response) => {
  await processClickPesaWebhook(request.body as ClickPesaWebhook, response);
});

app.post('/api/payments/clickpesa/callback', rateLimiter(100, 15 * 60 * 1000), async (request: Request, response: Response) => {
  await processClickPesaWebhook({ event: 'PAYMENT RECEIVED', data: request.body as ClickPesaWebhook['data'] }, response);
});

app.use((error: Error, _request: Request, response: Response, _next: (error?: Error) => void) => {
  console.error(JSON.stringify({ event: 'unhandled_error', message: error.message, stack: error.stack }));
  response.status(500).json({ ok: false, message: 'Internal server error' });
});

bootstrapDatabase()
  .then(async () => {
    await resumeQueuedImageVariantJobs();
    const imageQueueRecoveryTimer = setInterval(() => void resumeQueuedImageVariantJobs(), 60_000);
    imageQueueRecoveryTimer.unref();
    const platformLogRetentionTimer = setInterval(() => {
      void supabase.from('platform_system_logs').delete()
        .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .then(({ error }) => { if (error) console.warn('Unable to prune old platform request logs:', error.message); });
    }, 6 * 60 * 60 * 1000);
    platformLogRetentionTimer.unref();
    try {
      await ensureR2CorsConfiguration();
      console.info('R2 CORS configuration verified.');
    } catch (error) {
      console.warn(JSON.stringify({ event: 'r2_cors_configuration_failed', message: error instanceof Error ? error.message : String(error) }));
    }

    app.listen(port, () => {
      console.log(`InGallery API listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error(JSON.stringify({ event: 'schema_bootstrap_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
