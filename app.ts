const memoryStorage = new Map<string, string>();
const LEGACY_DEMO_STORAGE_KEYS = ['ingallery:roles', 'ingallery:events', 'ingallery:manualPayments', 'ingallery:subscription', 'ingallery:settings'];

if (typeof window !== 'undefined' && window.localStorage) {
  LEGACY_DEMO_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

const getStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  return {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    }
  };
};

export type GalleryStatus = 'draft' | 'published' | 'locked';

export interface GallerySummary {
  id: string;
  title: string;
  slug?: string;
  status: GalleryStatus;
  updatedAt: string;
  imageCount: number;
  coverUrl?: string | null;
  coverDesign?: 'classic' | 'editorial' | 'cinematic' | 'minimal';
}

export interface DashboardSnapshot {
  studioName: string;
  activePlan: string;
  storageUsed: number;
  storageLimit: number;
  revenueByCurrency: Record<'TZS' | 'USD', number>;
  pendingByCurrency: Record<'TZS' | 'USD', number>;
  activeClients: number;
  totalGalleries?: number;
  activeGalleries?: number;
  recentGalleries: GallerySummary[];
}

export const formatCurrencyTotals = (totals: Record<'TZS' | 'USD', number>): string => {
  const currencies: Array<'TZS' | 'USD'> = ['TZS', 'USD'];
  const formatted = currencies.filter((currency) => Number(totals[currency]) > 0).map((currency) => {
    const amount = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: currency === 'USD' ? 2 : 0
    }).format(Number(totals[currency]));
    return `${currency} ${amount}`;
  });
  return formatted.length ? formatted.join(' · ') : 'TZS 0';
};

export interface GalleryRecord extends GallerySummary {
  slug: string;
  accessPrice: number;
  currency: 'TZS' | 'USD';
  isUnlocked: boolean;
  coverPath?: string | null;
  coverUrl?: string | null;
  coverVideoPath?: string | null;
  coverVideoUrl?: string | null;
}

export interface GalleryImageRecord {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  processingStatus?: 'queued' | 'processing' | 'ready' | 'failed';
  previewUrl: string | null;
}

export interface PublicGalleryRecord extends GalleryRecord {
  coverUrl?: string | null;
  studioName?: string | null;
  studioLogoUrl?: string | null;
  nextImageOffset: number;
  hasMoreImages: boolean;
  images: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    processingStatus: 'queued' | 'processing' | 'ready' | 'failed';
    previewUrl: string | null;
    previewWidth?: number;
    previewHeight?: number;
    mediumUrl?: string | null;
    mediumWidth?: number;
    mediumHeight?: number;
    largeUrl?: string | null;
    largeWidth?: number;
    largeHeight?: number;
    viewUrl?: string | null;
    downloadUrl: string | null;
  }>;
}

export interface PublicGalleryImagesPage {
  images: PublicGalleryRecord['images'];
  nextOffset: number;
  hasMore: boolean;
}

export const PUBLIC_GALLERY_PREVIEW_LIMIT = 10;

export const partitionPublicGalleryImages = <T extends { id: string; previewUrl: string | null }>(
  images: T[],
  isUnlocked: boolean
): { previewImages: T[]; lockedImages: T[] } => {
  const previewImages = (isUnlocked ? images : images.slice(0, PUBLIC_GALLERY_PREVIEW_LIMIT))
    .filter((image) => Boolean(image.previewUrl));
  const previewIds = new Set(previewImages.map((image) => image.id));

  return {
    previewImages,
    lockedImages: isUnlocked ? [] : images.filter((image) => !previewIds.has(image.id))
  };
};

export interface UploadUrl {
  signedUrl: string;
  token: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface CheckoutLink {
  orderReference: string;
  checkoutUrl: string;
  transactionId?: string;
}

export interface PublicGalleryPaymentOptions {
  provider: TenantPaymentProvider | null;
  supportsMobileMoneyPush: boolean;
  supportsOtherMethods: boolean;
}

export type TenantPaymentProvider = 'clickpesa' | 'malipo' | 'stakaba';

export interface TenantPaymentSettings {
  provider: TenantPaymentProvider | null;
  environment: 'sandbox' | 'production';
  configured: boolean;
}

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: 'studio-admin' | 'photographer' | 'platform-admin';
  isAuthenticated: boolean;
  lastLogin: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface StudioProfile {
  id: string;
  display_name: string;
  studio_name: string;
  avatar_url: string | null;
  avatar_path?: string | null;
  avatarUrl?: string | null;
  billing_email: string | null;
  preferences: Record<string, unknown>;
}

export interface OrderRecord {
  id: string;
  order_reference: string;
  customer_name: string | null;
  customer_email: string | null;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  created_at: string;
  gallery_id: string | null;
}

export interface StorageSnapshot {
  planName: string;
  planLimitBytes: number;
  extraBytes: number;
  effectiveLimitBytes: number;
  usedBytes: number;
  reservedBytes: number;
  remainingBytes: number;
  totalUsedBytes: number;
  usedDisplay: string;
  remainingDisplay: string;
  limitDisplay: string;
  warning: 'normal' | 'approaching' | 'critical';
}

export interface TeamMemberRecord {
  id: string;
  member_id: string;
  email: string;
  display_name: string;
  role: string;
  permissions: string[];
  team_name: string;
  commission_percentage: number;
  performance_percentage: number;
  phone: string | null;
  status: string;
  created_at: string;
}

export interface TeamRoleRecord {
  id: string;
  role_name: string;
  role_key: string;
  builtIn?: boolean;
}

export interface TeamEventRecord {
  id: string;
  event_name: string;
  event_date: string;
  status: string;
}

export type OnboardingStep = 'profile' | 'gallery' | 'billing' | 'launch';

export interface OnboardingState {
  userId: string;
  step: OnboardingStep;
  completed: boolean;
  startedAt: string;
  updatedAt: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  message?: string;
}

export const buildRouteLookup = (): Record<string, string> => ({
  dashboard: 'photographer_dashboard_overview/code.html',
  galleries: 'ingallery_photography_studio_platform/code.html',
  gallery: 'public_gallery_unpaid/code.html',
  collections: 'photographer_dashboard_overview/code.html',
  clients: 'client_management_dashboard/code.html',
  orders: 'order_management_dashboard/code.html',
  storage: 'storage_hosting_dashboard/code.html',
  settings: 'marketing_seo_settings/code.html',
  team: 'team_permissions_view/code.html',
  performance: 'studio_performance_report/code.html',
  plans: 'subscription_storage_plans/code.html',
  checkout: 'client_checkout_flow/code.html',
  pending: 'payment_pending_status/code.html',
  success: 'public_gallery_unpaid/code.html',
  create: 'create_new_gallery_form/code.html',
  'upload new gallery': 'create_new_gallery_form/code.html',
  'create new gallery': 'create_new_gallery_form/code.html',
  'create gallery': 'create_new_gallery_form/code.html',
  'back to galleries': 'ingallery_photography_studio_platform/code.html',
  'view all': 'ingallery_photography_studio_platform/code.html',
  'view gallery': 'public_gallery_unpaid/code.html',
  'client access': 'client_detail_view/code.html'
});

export const getKeyForLabel = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

export const resolveGalleryThumbnail = (gallery?: { coverUrl?: string | null; title?: string }): string | null => {
  if (!gallery) return null;
  const value = gallery.coverUrl?.trim();
  return value ? value : null;
};

export const buildGalleryPublicUrl = ({
  id,
  slug,
  title,
  basePath = '../public_gallery_unpaid/code.html'
}: {
  id?: string;
  slug?: string;
  title?: string;
  basePath?: string;
}): string => {
  const params = new URLSearchParams();
  const value = slug?.trim() || title?.trim() || 'gallery';
  params.set('gallery', value);
  if (id) params.set('galleryId', id);
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}${params.toString()}`;
};

export const buildGalleryCheckoutUrl = ({
  id,
  title,
  basePath = '../client_checkout_flow/code.html'
}: {
  id?: string;
  title?: string;
  basePath?: string;
}): string => {
  const params = new URLSearchParams();
  if (title?.trim()) params.set('gallery', title.trim());
  if (id) params.set('galleryId', id);
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}${params.toString()}`;
};

export const normalizeGalleryCheckoutState = (gallery?: {
  id?: string | null;
  title?: string | null;
  slug?: string | null;
  accessPrice?: number | null;
  currency?: string | null;
  imageCount?: number | null;
  coverUrl?: string | null;
}): {
  id: string;
  title: string;
  slug: string;
  accessPrice: number;
  currency: 'TZS' | 'USD';
  imageCount: number;
  coverUrl: string | null;
} => {
  const accessPrice = Number(gallery?.accessPrice ?? 0);
  const currency = (gallery?.currency ?? 'TZS').toUpperCase() === 'USD' ? 'USD' : 'TZS';

  return {
    id: gallery?.id ?? '',
    title: gallery?.title?.trim() || 'Gallery',
    slug: gallery?.slug ?? '',
    accessPrice: Number.isFinite(accessPrice) ? accessPrice : 0,
    currency,
    imageCount: Number(gallery?.imageCount ?? 0),
    coverUrl: gallery?.coverUrl?.trim() ? gallery.coverUrl.trim() : null
  };
};

export const resolveGalleryCoverUrl = (
  gallery?: {
    coverUrl?: string | null;
    firstImageUrl?: string | null;
    images?: Array<{ previewUrl?: string | null }> | null;
  } | null
): string | null => {
  if (!gallery) return null;

  const fallbackImage = gallery.images?.find((image) => image.previewUrl)?.previewUrl?.trim();
  const value = gallery.coverUrl?.trim() || gallery.firstImageUrl?.trim() || fallbackImage || null;
  return value || null;
};

export const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export const isValidPassword = (password: string): boolean =>
  password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);

const ensureGalleryFeedbackStyles = (): void => {
  if (document.querySelector('[data-gallery-feedback-styles]')) return;
  const style = document.createElement('style');
  style.dataset.galleryFeedbackStyles = 'true';
  style.textContent = `
    .gallery-confirm-dialog { width: min(440px, calc(100vw - 32px)); border: 1px solid rgba(233,195,73,.34); background: #1a1c1c; color: #e2e2e2; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.55); }
    .gallery-confirm-dialog::backdrop { background: rgba(0,0,0,.68); backdrop-filter: blur(4px); }
    .gallery-confirm-dialog__icon { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid rgba(255,180,171,.35); background: rgba(255,180,171,.1); color: #ffb4ab; }
    .gallery-confirm-dialog__title { margin: 18px 0 8px; color: #e9c349; font: 600 24px/1.25 'Playfair Display', serif; }
    .gallery-confirm-dialog__copy { color: #c4c7c7; font: 14px/1.6 Inter, sans-serif; overflow-wrap: anywhere; }
    .gallery-confirm-dialog__actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 26px; }
    .gallery-confirm-dialog__button { min-height: 42px; border: 1px solid rgba(255,255,255,.2); background: transparent; color: #e2e2e2; padding: 0 16px; font: 600 11px Inter, sans-serif; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
    .gallery-confirm-dialog__button--delete { border-color: #b3261e; background: #b3261e; color: #fff; }
    .gallery-toast { position: fixed; z-index: 1000; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 12px; width: min(380px, calc(100vw - 32px)); border: 1px solid rgba(78,222,163,.38); border-left: 3px solid #4edea3; background: #1a1c1c; color: #e2e2e2; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.38); font: 500 14px/1.45 Inter, sans-serif; animation: gallery-toast-in .22s ease-out both; pointer-events: none; }
    .gallery-toast .material-symbols-outlined { color: #4edea3; font-size: 20px; }
    .gallery-toast.is-error { border-color: rgba(255,180,171,.38); border-left-color: #ffb4ab; }
    .gallery-toast.is-error .material-symbols-outlined { color: #ffb4ab; }
    .gallery-toast.is-leaving { animation: gallery-toast-out .18s ease-in both; }
    @keyframes gallery-toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes gallery-toast-out { to { opacity: 0; transform: translateY(8px); } }
    @media (max-width: 600px) { .gallery-toast { right: 16px; bottom: 16px; } }
    @media (prefers-reduced-motion: reduce) { .gallery-toast, .gallery-toast.is-leaving { animation: none; } }
  `;
  document.head.append(style);
};

export const confirmGalleryDeletion = (galleryTitle: string): Promise<boolean> => {
  ensureGalleryFeedbackStyles();
  const dialog = document.createElement('dialog');
  dialog.className = 'gallery-confirm-dialog';
  dialog.setAttribute('aria-labelledby', 'gallery-delete-title');
  dialog.innerHTML = `
    <span class="gallery-confirm-dialog__icon material-symbols-outlined" aria-hidden="true">delete</span>
    <h2 class="gallery-confirm-dialog__title" id="gallery-delete-title">Delete gallery?</h2>
    <p class="gallery-confirm-dialog__copy"></p>
    <div class="gallery-confirm-dialog__actions">
      <button type="button" class="gallery-confirm-dialog__button" data-gallery-cancel>Cancel</button>
      <button type="button" class="gallery-confirm-dialog__button gallery-confirm-dialog__button--delete" data-gallery-confirm>Delete gallery</button>
    </div>`;
  const copy = dialog.querySelector('p');
  if (copy) copy.textContent = `"${galleryTitle}" and all of its uploaded photos will be permanently deleted.`;
  document.body.append(dialog);

  return new Promise((resolve) => {
    const finish = (confirmed: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(confirmed);
    };
    dialog.querySelector('[data-gallery-cancel]')?.addEventListener('click', () => finish(false));
    dialog.querySelector('[data-gallery-confirm]')?.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-gallery-cancel]')?.focus();
  });
};

export const showGalleryToast = (message: string, isError = false): void => {
  ensureGalleryFeedbackStyles();
  document.querySelector('.gallery-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `gallery-toast${isError ? ' is-error' : ''}`;
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = isError ? 'error' : 'check_circle';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);
  document.body.append(toast);
  window.setTimeout(() => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 200);
  }, 3600);
};

export const resolveGalleryUploadPlan = ({
  galleryFiles,
  coverFile,
  isEdit = false
}: {
  galleryFiles?: File[] | null;
  coverFile?: File | null;
  isEdit?: boolean;
}): { hasCover: boolean; photoFiles: File[]; canProceed: boolean } => {
  const selectedGalleryFiles = Array.from(galleryFiles ?? []).filter((file) => Boolean(file));
  const cover = coverFile ?? null;
  const sameFile = (file: File, comparisonFile: File | null): boolean => {
    if (!comparisonFile) return false;
    return file === comparisonFile || (
      file.name === comparisonFile.name &&
      file.size === comparisonFile.size &&
      file.lastModified === comparisonFile.lastModified
    );
  };

  const photoFiles = selectedGalleryFiles.filter((file) => !sameFile(file, cover));
  const hasCover = Boolean(cover);

  return {
    hasCover,
    photoFiles,
    canProceed: isEdit ? true : photoFiles.length > 0 || hasCover
  };
};

export const labelFor = (element: Element): string => {
  const icon = element.querySelector('.material-symbols-outlined');
  const text = element.textContent ?? '';
  const normalizedText = icon ? text.replace(icon.textContent ?? '', '') : text;
  return getKeyForLabel(normalizedText);
};

const readLocalStorage = <T>(key: string, fallback: T): T => {
  try {
    const raw = getStorage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const buildDefaultDashboardSnapshot = (): DashboardSnapshot => ({
  studioName: '',
  activePlan: '',
  storageUsed: 0,
  storageLimit: 0,
  revenueByCurrency: { TZS: 0, USD: 0 },
  pendingByCurrency: { TZS: 0, USD: 0 },
  activeClients: 0,
  totalGalleries: 0,
  activeGalleries: 0,
  recentGalleries: []
});

const normalizeSession = (session: UserSession | null): UserSession | null => {
  if (!session?.isAuthenticated) return session;

  const normalizedSession = {
    ...session,
    role: session.role ?? 'studio-admin'
  };

  return normalizedSession;
};

export const getCurrentSession = (): UserSession | null => {
  const session = readLocalStorage<UserSession | null>('ingallery:session', null);
  if (session?.id === '11111111-1111-4111-8111-111111111111' || session?.id === 'user-demo-01' || /^(demo|login|signup)_access_/.test(session?.accessToken ?? '')) {
    getStorage().removeItem('ingallery:session');
    getStorage().removeItem('ingallery:dashboard');
    return null;
  }
  if (session?.isAuthenticated) return normalizeSession(session);
  return null;
};

export const clearCurrentSession = (): void => {
  getStorage().removeItem('ingallery:session');
  getStorage().removeItem('ingallery:dashboard');
};

export const createOnboardingState = (userId: string): OnboardingState => ({
  userId,
  step: 'profile',
  completed: false,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

declare global {
  interface Window {
    INGALLERY_API_BASE_URL?: string;
  }
}

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && window.INGALLERY_API_BASE_URL) {
    return window.INGALLERY_API_BASE_URL;
  }

  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }

  if (typeof process !== 'undefined' && process.env && process.env.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL as string;
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local') || /^192\.168\./.test(hostname)) {
      return `http://${hostname}:8787`;
    }
    return 'https://ingallery-bd.onrender.com';
  }
  return 'http://localhost:8787';
};

export const getPublicFrontendUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PUBLIC_FRONTEND_URL) {
    return String(import.meta.env.VITE_PUBLIC_FRONTEND_URL).replace(/\/$/, '');
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
};

if (typeof window !== 'undefined') {
  window.INGALLERY_API_BASE_URL = getApiBaseUrl();
}

export interface PerformanceSummary {
  galleryViewRate: number | null;
  publishedGalleryCount: number;
  viewedGalleryCount: number;
  viewCount: number;
  uniqueVisitorCount: number;
  repeatClientRate: number | null;
  repeatBuyerCount: number;
  buyerCount: number;
  galleryViews: Array<{ galleryId: string; viewCount: number; uniqueVisitors: number }>;
}

export interface ApiService {
  getDashboard: () => Promise<ApiResponse<DashboardSnapshot>>;
  getGalleries: () => Promise<ApiResponse<GalleryRecord[]>>;
  getGallery: (galleryId: string) => Promise<ApiResponse<GalleryRecord>>;
  getGalleryImages: (galleryId: string) => Promise<ApiResponse<GalleryImageRecord[]>>;
  updateGallery: (galleryId: string, updates: { title: string; accessPrice: number; currency?: 'TZS' | 'USD'; coverDesign?: GalleryRecord['coverDesign'] }) => Promise<ApiResponse<GalleryRecord>>;
  deleteGallery: (galleryId: string) => Promise<ApiResponse<{ id: string; deleted: boolean }>>;
  getClients: () => Promise<ApiResponse<Array<{ id: string; display_name: string; email: string; phone?: string; status: string; created_at: string }>>>;
  getOrders: () => Promise<ApiResponse<OrderRecord[]>>;
  getPerformance: () => Promise<ApiResponse<PerformanceSummary>>;
  getStorage: () => Promise<ApiResponse<StorageSnapshot>>;
  getTeamMembers: () => Promise<ApiResponse<TeamMemberRecord[]>>;
  getTeamRoles: () => Promise<ApiResponse<TeamRoleRecord[]>>;
  inviteTeamMember: (invite: { name: string; email: string; password: string; role: string; teamName?: string; phone?: string }) => Promise<ApiResponse<TeamMemberRecord>>;
  getTeamEvents: () => Promise<ApiResponse<TeamEventRecord[]>>;
  createGallery: (title: string, accessPrice: number, currency?: 'TZS' | 'USD', coverDesign?: GalleryRecord['coverDesign']) => Promise<ApiResponse<GalleryRecord>>;
  createUploadUrl: (galleryId: string, file: File) => Promise<ApiResponse<UploadUrl>>;
  uploadImage: (galleryId: string, file: File) => Promise<ApiResponse<{ storagePath: string; fileName: string; mimeType: string; fileSize: number }>>;
  uploadGalleryVideo: (galleryId: string, file: File, onProgress?: (percent: number) => void) => Promise<ApiResponse<unknown>>;
  confirmImage: (galleryId: string, upload: Pick<UploadUrl, 'storagePath' | 'fileName' | 'mimeType' | 'fileSize'>) => Promise<ApiResponse<unknown>>;
  setCoverImage: (galleryId: string, upload: Pick<UploadUrl, 'storagePath' | 'mimeType'>) => Promise<ApiResponse<unknown>>;
  uploadCoverVideo: (galleryId: string, file: File, onProgress?: (percent: number) => void) => Promise<ApiResponse<unknown>>;
  setCoverVideo: (galleryId: string, video: { youtubeUrl?: string; storagePath?: string; mimeType?: string; fileSize?: number; clear?: boolean }) => Promise<ApiResponse<unknown>>;
  getPublicGallery: (slug: string, accessToken?: string) => Promise<ApiResponse<PublicGalleryRecord>>;
  getPublicGalleryImages: (slug: string, offset: number, accessToken?: string) => Promise<ApiResponse<PublicGalleryImagesPage>>;
  getPublicGalleryPaymentOptions: (galleryId: string) => Promise<ApiResponse<PublicGalleryPaymentOptions>>;
  createCheckout: (galleryId: string, customer: { name?: string; email: string; phone: string; network?: string; paymentMethod?: 'mobile_money' | 'other' }) => Promise<ApiResponse<CheckoutLink>>;
  login: (email: string, password: string) => Promise<ApiResponse<UserSession | null>>;
  signup: (email: string, password: string, name: string) => Promise<ApiResponse<UserSession | null>>;
  requestPasswordRecovery: (email: string) => Promise<ApiResponse<{ sent: boolean }>>;
  getSession: () => Promise<ApiResponse<UserSession | null>>;
  getProfile: () => Promise<ApiResponse<StudioProfile>>;
  updateProfile: (updates: { displayName: string; studioName: string; billingEmail: string }) => Promise<ApiResponse<StudioProfile>>;
  uploadStudioLogo: (file: File) => Promise<ApiResponse<{ avatarUrl: string; avatarPath: string }>>;
  clearStudioLogo: () => Promise<ApiResponse<{ avatarUrl: null; avatarPath: null }>>;
  getPaymentSettings: () => Promise<ApiResponse<TenantPaymentSettings>>;
  selectPaymentProvider: (settings: { provider: TenantPaymentProvider }) => Promise<ApiResponse<void>>;
  savePaymentSettings: (settings: { provider: TenantPaymentProvider; environment: 'sandbox' | 'production'; clientId?: string; apiKey?: string; secretKey?: string; checksumKey?: string; disconnect?: boolean }) => Promise<ApiResponse<TenantPaymentSettings>>;
  testPaymentSettings: (settings: { provider: TenantPaymentProvider; environment: 'sandbox' | 'production'; clientId?: string; apiKey?: string; secretKey?: string; checksumKey?: string }) => Promise<ApiResponse<{ provider: TenantPaymentProvider; connected: boolean }>>;
}

export const createApiService = (baseUrl: string): ApiService => {
  const getGalleryVisitorId = (): string | undefined => {
    if (typeof window === 'undefined') return undefined;
    try {
      const key = 'ingallery:gallery-visitor';
      const existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      const generated = globalThis.crypto?.randomUUID?.() ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      window.sessionStorage.setItem(key, generated);
      return generated;
    } catch {
      return undefined;
    }
  };

  const request = async <T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> => {
    const headers = new Headers(init?.headers ?? {});
    if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers
    });
    const body = (await response.json()) as ApiResponse<T>;
    if (!response.ok) {
      const error = new Error(body.message ?? 'API request failed') as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body;
  };

  let refreshInFlight: Promise<UserSession | null> | null = null;
  const refreshCurrentSession = async (): Promise<UserSession | null> => {
    const current = getCurrentSession();
    if (!current?.refreshToken) return null;
    if (!refreshInFlight) {
      refreshInFlight = request<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: current.refreshToken })
      }).then((response) => {
        const refreshed = { ...current, accessToken: response.data.accessToken, refreshToken: response.data.refreshToken };
        getStorage().setItem('ingallery:session', JSON.stringify(refreshed));
        return refreshed;
      }).catch(() => {
        clearCurrentSession();
        return null;
      }).finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  };

  const authorizedRequest = async <T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> => {
    const session = getCurrentSession();
    const send = (accessToken?: string) => request<T>(path, {
      ...init,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers
      }
    });
    try {
      return await send(session?.accessToken);
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 401) throw error;
      const refreshed = await refreshCurrentSession();
      if (!refreshed) throw error;
      return send(refreshed.accessToken);
    }
  };

  const putFileToStorage = (signedUrl: string, file: File, mimeType: string, onProgress?: (percent: number) => void): Promise<void> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', signedUrl);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Video upload to storage failed. Please retry.'));
      });
      xhr.addEventListener('error', () => reject(new Error('Video upload connection failed. Please retry.')));
      xhr.addEventListener('abort', () => reject(new Error('Video upload was cancelled.')));
      xhr.send(file);
    });

  return {
    getDashboard: async () => {
      return authorizedRequest<DashboardSnapshot>('/api/dashboard');
    },
    getGalleries: () => authorizedRequest<GalleryRecord[]>('/api/galleries'),
    getGallery: (galleryId) => authorizedRequest<GalleryRecord>(`/api/galleries/${encodeURIComponent(galleryId)}`),
    getGalleryImages: (galleryId) => authorizedRequest<GalleryImageRecord[]>(`/api/galleries/${encodeURIComponent(galleryId)}/images`),
    updateGallery: (galleryId, updates) => authorizedRequest<GalleryRecord>(`/api/galleries/${encodeURIComponent(galleryId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    }),
    deleteGallery: (galleryId) => authorizedRequest<{ id: string; deleted: boolean }>(`/api/galleries/${encodeURIComponent(galleryId)}`, {
      method: 'DELETE'
    }),
    getClients: () => authorizedRequest<Array<{ id: string; display_name: string; email: string; phone?: string; status: string; created_at: string }>>('/api/clients'),
    getOrders: () => authorizedRequest<OrderRecord[]>('/api/orders'),
    getPerformance: () => authorizedRequest<PerformanceSummary>('/api/performance'),
    getStorage: () => authorizedRequest<StorageSnapshot>('/api/storage'),
    getTeamMembers: () => authorizedRequest<TeamMemberRecord[]>('/api/team/members'),
    getTeamRoles: () => authorizedRequest<TeamRoleRecord[]>('/api/team/roles'),
    inviteTeamMember: (invite) => authorizedRequest<TeamMemberRecord>('/api/team/invite', {
      method: 'POST',
      body: JSON.stringify(invite)
    }),
    getTeamEvents: () => authorizedRequest<TeamEventRecord[]>('/api/team/events'),
    createGallery: (title, accessPrice, currency = 'TZS', coverDesign = 'classic') => authorizedRequest<GalleryRecord>('/api/galleries', {
      method: 'POST',
      body: JSON.stringify({ title, accessPrice, currency, coverDesign })
    }),
    createUploadUrl: (galleryId, file) => authorizedRequest<UploadUrl>(`/api/galleries/${encodeURIComponent(galleryId)}/upload-url`, {
      method: 'POST',
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size })
    }),
    uploadImage: async (galleryId, file) => {
      const upload = await authorizedRequest<UploadUrl>(`/api/galleries/${encodeURIComponent(galleryId)}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size })
      });
      try {
        const storageResponse = await fetch(upload.data.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file
        });
        if (!storageResponse.ok) throw new Error('Media upload to storage failed.');

        return await authorizedRequest<{ storagePath: string; fileName: string; mimeType: string; fileSize: number }>(`/api/galleries/${encodeURIComponent(galleryId)}/images`, {
          method: 'POST',
          body: JSON.stringify({
            storagePath: upload.data.storagePath,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size
          })
        });
      } catch (error) {
        await authorizedRequest(`/api/galleries/${encodeURIComponent(galleryId)}/upload-cancel`, {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath })
        }).catch(() => {});
        throw error;
      }
    },
    uploadGalleryVideo: async (galleryId, file, onProgress) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const mimeType = file.type || ({ mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension ?? ''] || '';
      if (!['video/mp4', 'video/webm'].includes(mimeType)) throw new Error('Choose an MP4 or WebM gallery video.');
      const upload = await authorizedRequest<UploadUrl>(`/api/galleries/${encodeURIComponent(galleryId)}/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType, fileSize: file.size })
      });
      try {
        await putFileToStorage(upload.data.signedUrl, file, mimeType, onProgress);
        return await authorizedRequest<unknown>(`/api/galleries/${encodeURIComponent(galleryId)}/images`, {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath, fileName: file.name, mimeType, fileSize: file.size })
        });
      } catch (error) {
        await authorizedRequest(`/api/galleries/${encodeURIComponent(galleryId)}/upload-cancel`, {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath })
        }).catch(() => {});
        throw error;
      }
    },
    confirmImage: (galleryId, upload) => authorizedRequest<unknown>(`/api/galleries/${encodeURIComponent(galleryId)}/images`, {
      method: 'POST',
      body: JSON.stringify(upload)
    }),
    setCoverImage: (galleryId, upload) => authorizedRequest<unknown>(`/api/galleries/${encodeURIComponent(galleryId)}/cover`, {
      method: 'POST',
      body: JSON.stringify(upload)
    }),
    uploadCoverVideo: async (galleryId, file, onProgress) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const mimeType = file.type || ({ mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[extension ?? ''] || '';
      if (!['video/mp4', 'video/webm'].includes(mimeType)) throw new Error('Choose an MP4 or WebM cover video.');
      const upload = await authorizedRequest<UploadUrl>(`/api/galleries/${encodeURIComponent(galleryId)}/cover-video-upload-url`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType, fileSize: file.size })
      });
      try {
        await putFileToStorage(upload.data.signedUrl, file, mimeType, onProgress);
        return await authorizedRequest<unknown>(`/api/galleries/${encodeURIComponent(galleryId)}/cover-video`, {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath, mimeType, fileSize: file.size })
        });
      } catch (error) {
        await authorizedRequest(`/api/galleries/${encodeURIComponent(galleryId)}/upload-cancel`, {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath })
        }).catch(() => {});
        throw error;
      }
    },
    setCoverVideo: (galleryId, video) => authorizedRequest<unknown>(`/api/galleries/${encodeURIComponent(galleryId)}/cover-video`, {
      method: 'POST',
      body: JSON.stringify(video)
    }),
    getPublicGallery: async (slug, accessToken) => {
      const visitorId = getGalleryVisitorId();
      return request<PublicGalleryRecord>(`/api/public/galleries/${encodeURIComponent(slug)}`, {
        headers: {
          ...(accessToken ? { 'X-Gallery-Access-Token': accessToken } : {}),
          ...(visitorId ? { 'X-Gallery-Visitor-Id': visitorId } : {})
        }
      });
    },
    getPublicGalleryImages: (slug, offset, accessToken) => request<PublicGalleryImagesPage>(
      `/api/public/galleries/${encodeURIComponent(slug)}/images?offset=${encodeURIComponent(String(offset))}`,
      { headers: accessToken ? { 'X-Gallery-Access-Token': accessToken } : undefined }
    ),
    getPublicGalleryPaymentOptions: (galleryId) => request<PublicGalleryPaymentOptions>(`/api/public/galleries/${encodeURIComponent(galleryId)}/payment-options`),
    createCheckout: (galleryId, customer) => request<CheckoutLink>('/api/payments/initiate', {
      method: 'POST',
      body: JSON.stringify({
        galleryId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        network: customer.network,
        paymentMethod: customer.paymentMethod
      })
    }),
    login: async (email, password) => {
      try {
        const response = await request<{
          accessToken: string;
          refreshToken: string;
          user: { id: string; email?: string; name?: string; role?: UserSession['role'] };
        }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        const session: UserSession = {
          id: response.data.user.id,
          name: response.data.user.name ?? '',
          email: response.data.user.email ?? email,
          role: response.data.user.role ?? 'studio-admin',
          isAuthenticated: true,
          lastLogin: new Date().toISOString(),
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken
        };
        getStorage().setItem('ingallery:session', JSON.stringify(session));
        return { ok: response.ok, data: session, message: response.message };
      } catch (error) {
        const message = error instanceof TypeError
          ? 'Unable to sign in. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to sign in. Please try again.';
        return { ok: false, data: null, message };
      }
    },
    signup: async (email, password, name) => {
      try {
        const response = await request<{
          accessToken?: string;
          refreshToken?: string;
          user?: { id: string; email?: string; name?: string; role?: string };
          id?: string;
          email?: string;
          name?: string;
          role?: string;
        }>('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email, password, name })
        });
        const user = response.data.user;
        if (!response.data.accessToken || !user) {
          return { ok: true, data: null, message: response.message ?? 'Account created. Sign in to continue.' };
        }
        const session: UserSession = {
          id: user?.id ?? response.data.id ?? '',
          name: user?.name ?? response.data.name ?? name,
          email: user?.email ?? response.data.email ?? email,
          role: 'studio-admin',
          isAuthenticated: true,
          lastLogin: new Date().toISOString(),
          accessToken: response.data.accessToken,
          refreshToken: response.data.refreshToken
        };
        getStorage().setItem('ingallery:session', JSON.stringify(session));
        return { ok: response.ok, data: session, message: response.message };
      } catch {
        return { ok: false, data: null, message: 'Unable to create your account. Check your connection and try again.' };
      }
    },
    requestPasswordRecovery: async (email) => {
      try {
        return await request<{ sent: boolean }>('/api/auth/password/request', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
      } catch (error) {
        const message = error instanceof TypeError
          ? 'Unable to contact the server. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to send a recovery email. Please try again.';
        return { ok: false, data: { sent: false }, message };
      }
    },
    getSession: async () => {
      try {
        return await authorizedRequest<UserSession | null>('/api/session');
      } catch {
        return { ok: false, data: null, message: 'Session is invalid or expired' };
      }
    },
    getProfile: () => authorizedRequest<StudioProfile>('/api/profile'),
    updateProfile: (updates) => authorizedRequest<StudioProfile>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }),
    uploadStudioLogo: async (file) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const mimeType = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[extension ?? ''] || '';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Choose a JPG, PNG, or WEBP logo.');
      const upload = await authorizedRequest<UploadUrl>('/api/profile/logo-upload-url', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType, fileSize: file.size })
      });
      try {
        const storageResponse = await fetch(upload.data.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
          body: file
        });
        if (!storageResponse.ok) throw new Error('Logo upload to storage failed.');
        return await authorizedRequest<{ avatarUrl: string; avatarPath: string }>('/api/profile/logo', {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath, mimeType, fileSize: file.size })
        });
      } catch (error) {
        await authorizedRequest('/api/profile/logo-upload-cancel', {
          method: 'POST',
          body: JSON.stringify({ storagePath: upload.data.storagePath })
        }).catch(() => {});
        throw error;
      }
    },
    clearStudioLogo: () => authorizedRequest<{ avatarUrl: null; avatarPath: null }>('/api/profile/logo', {
      method: 'POST',
      body: JSON.stringify({ clear: true })
    }),
    getPaymentSettings: () => authorizedRequest<TenantPaymentSettings>('/api/payment-settings'),
    selectPaymentProvider: (settings) => authorizedRequest<void>('/api/payment-settings/select', { method: 'POST', body: JSON.stringify(settings) }),
    savePaymentSettings: (settings) => authorizedRequest<TenantPaymentSettings>('/api/payment-settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }),
    testPaymentSettings: (settings) => authorizedRequest<{ provider: TenantPaymentProvider; connected: boolean }>('/api/payment-settings/test', {
      method: 'POST',
      body: JSON.stringify(settings)
    })
  };
};

export const logoutUser = (): void => {
  getStorage().removeItem('ingallery:session');
};

export const getDashboardSnapshot = (): DashboardSnapshot => {
  const cached = readLocalStorage<DashboardSnapshot | null>('ingallery:dashboard', null);
  if (cached) return cached;

  const storedGallery = readLocalStorage<{ title: string; createdAt: string } | null>('ingallery:lastGallery', null);
  const snapshot = buildDefaultDashboardSnapshot();

  if (storedGallery) {
    snapshot.recentGalleries.unshift({
      id: `g-${Date.now()}`,
      title: storedGallery.title,
      status: 'draft',
      updatedAt: storedGallery.createdAt,
      imageCount: 0
    });
  }

  getStorage().setItem('ingallery:dashboard', JSON.stringify(snapshot));
  return snapshot;
};

export const saveGalleryDraft = (title: string): DashboardSnapshot => {
  const nextSnapshot = getDashboardSnapshot();
  const cleanTitle = title.trim();

  if (!cleanTitle) {
    return nextSnapshot;
  }

  const updated = {
    ...nextSnapshot,
    recentGalleries: [
      {
        id: `g-${Date.now()}`,
        title: cleanTitle,
        status: 'draft' as const,
        updatedAt: new Date().toISOString(),
        imageCount: 0
      },
      ...nextSnapshot.recentGalleries
    ]
  };

  getStorage().setItem('ingallery:dashboard', JSON.stringify(updated));
  return updated;
};

export const initializeApp = (): { session: UserSession | null; snapshot: DashboardSnapshot } => {
  return { session: getCurrentSession(), snapshot: buildDefaultDashboardSnapshot() };
};

export const hydrateDashboard = (): void => {
  const dashboardRoot = document.querySelector('[data-dashboard-root]');
  if (!dashboardRoot) return;

  const snapshot = getDashboardSnapshot();
  const storagePercent = Math.min(100, Math.round((snapshot.storageUsed / snapshot.storageLimit) * 100));

  dashboardRoot.innerHTML = `
    <section class="space-y-6 p-6 lg:p-8">
      <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.2em] text-secondary">${snapshot.studioName}</p>
          <h1 class="mt-2 font-display text-3xl md:text-5xl text-white">Overview</h1>
        </div>
        <span class="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-on-surface-variant">${snapshot.activePlan}</span>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="glass-panel rounded p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Gross paid sales</p>
          <p class="mt-3 text-xl font-semibold text-white">${formatCurrencyTotals(snapshot.revenueByCurrency)}</p>
        </article>
        <article class="glass-panel rounded p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Pending</p>
          <p class="mt-3 text-xl font-semibold text-white">${formatCurrencyTotals(snapshot.pendingByCurrency)}</p>
        </article>
        <article class="glass-panel rounded p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Clients</p>
          <p class="mt-3 text-2xl font-semibold text-white">${snapshot.activeClients}</p>
        </article>
        <article class="glass-panel rounded p-4">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Storage</p>
          <p class="mt-3 text-2xl font-semibold text-white">${storagePercent}%</p>
        </article>
      </div>

      <div class="glass-panel rounded p-5">
        <div class="flex items-center justify-between">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Storage</p>
          <p class="text-sm text-white">${snapshot.storageUsed} GB / ${snapshot.storageLimit} GB</p>
        </div>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
          <div class="h-full rounded-full bg-secondary" style="width: ${storagePercent}%"></div>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <article class="glass-panel rounded p-5">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Recent galleries</p>
          <ul class="mt-4 space-y-3">
            ${snapshot.recentGalleries
              .slice(0, 4)
              .map(
                (gallery) => `
                  <li class="flex items-center justify-between border-b border-white/10 pb-3 last:border-b-0 last:pb-0">
                    <div>
                      <p class="text-white">${gallery.title}</p>
                      <p class="text-xs uppercase tracking-[0.15em] text-on-surface-variant">${gallery.imageCount} images</p>
                    </div>
                    <span class="rounded border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-secondary">${gallery.status}</span>
                  </li>
                `
              )
              .join('')}
          </ul>
        </article>

        <article class="glass-panel rounded p-5">
          <p class="text-xs uppercase tracking-[0.2em] text-on-surface-variant">Operational status</p>
          <div class="mt-4 space-y-4">
            <div class="flex items-center justify-between"> <span class="text-on-surface-variant">Uploads</span> <span class="text-green-400">Live</span> </div>
            <div class="flex items-center justify-between"> <span class="text-on-surface-variant">Payments</span> <span class="text-secondary">Queued</span> </div>
            <div class="flex items-center justify-between"> <span class="text-on-surface-variant">Client access</span> <span class="text-white">Healthy</span> </div>
          </div>
        </article>
      </div>
    </section>
  `;
};

type RecentActivityEvent = {
  kind: 'payment' | 'gallery' | 'client';
  label: string;
  createdAt: string;
};

const escapeActivityText = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character] ?? character));

const relativeActivityTime = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Recently';

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'Just now';
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} min ago`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)} hours ago`;
  return `${Math.floor(elapsedSeconds / 86400)} days ago`;
};

const hydrateRecentActivity = async (): Promise<void> => {
  const activityRoot = document.querySelector<HTMLElement>('[data-recent-activity]');
  if (!activityRoot) return;

  if (!getCurrentSession()?.accessToken) {
    activityRoot.innerHTML = '<p class="text-body-md text-on-surface-variant">Sign in to view recent activity.</p>';
    return;
  }

  try {
    const api = createApiService(getApiBaseUrl());
    const [ordersResponse, galleriesResponse, clientsResponse] = await Promise.all([
      api.getOrders(),
      api.getGalleries(),
      api.getClients()
    ]);
    const events: RecentActivityEvent[] = [
      ...ordersResponse.data.map((order) => {
        const status = order.status.toUpperCase();
        const label = ['SUCCESS', 'PAID', 'COMPLETED'].includes(status) ? 'Payment received' : `Payment ${status.toLowerCase()}`;
        return {
          kind: 'payment' as const,
          label: `${label}: ${order.currency} ${Number(order.amount).toLocaleString()}`,
          createdAt: order.created_at
        };
      }),
      ...galleriesResponse.data.map((gallery) => ({
        kind: 'gallery' as const,
        label: `Gallery updated: ${gallery.title} (${gallery.imageCount} photos)`,
        createdAt: gallery.updatedAt
      })),
      ...clientsResponse.data.map((client) => ({
        kind: 'client' as const,
        label: `New client: ${client.display_name}`,
        createdAt: client.created_at
      }))
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 6);

    if (!events.length) {
      activityRoot.innerHTML = '<p class="text-body-md text-on-surface-variant">No recent activity yet.</p>';
      return;
    }

    const styles = {
      payment: { icon: 'payments', background: 'bg-secondary/10 border-secondary/20', iconTone: 'text-secondary' },
      gallery: { icon: 'cloud_done', background: 'bg-primary/10 border-primary/20', iconTone: 'text-primary' },
      client: { icon: 'person_add', background: 'bg-tertiary/10 border-tertiary/20', iconTone: 'text-tertiary' }
    };
    activityRoot.innerHTML = events.map((event, index) => {
      const style = styles[event.kind];
      const isLast = index === events.length - 1;
      return `
        <div class="flex gap-4 items-start relative ${isLast ? '' : 'pb-6 border-b border-white/5'}">
          <div class="w-10 h-10 rounded-full ${style.background} flex items-center justify-center shrink-0 border">
            <span class="material-symbols-outlined ${style.iconTone}" aria-hidden="true">${style.icon}</span>
          </div>
          <div class="min-w-0">
            <p class="text-body-md font-body-md text-on-surface">${escapeActivityText(event.label)}</p>
            <p class="text-label-sm font-label-sm text-on-surface-variant mt-1">${relativeActivityTime(event.createdAt)}</p>
          </div>
        </div>`;
    }).join('');
  } catch (error) {
    if ((error as Error & { status?: number }).status === 401) {
      clearCurrentSession();
      activityRoot.innerHTML = '<p class="text-body-md text-on-surface-variant">Your session has expired. <a class="text-secondary underline" href="../index.html">Sign in again</a> to view recent activity.</p>';
      return;
    }
    activityRoot.innerHTML = '<p class="text-body-md text-on-surface-variant">Recent activity is temporarily unavailable. Check that the API is running, then reload this page.</p>';
  }
};

export const initNavigation = (): void => {
  const root = '../';
  const routes = buildRouteLookup();

  const go = (target?: string): void => {
    if (target) window.location.href = root + target;
  };

  document.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
    const target = routes[labelFor(link)];
    if (target) link.href = root + target;
  });

  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (button.classList.contains('admin-tab')) return;
    const target = routes[labelFor(button)];
    if (!target || button.getAttribute('onclick') || button.closest('form')) return;
    button.addEventListener('click', () => go(target));
  });

  document.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const controlledInputId = button.getAttribute('aria-controls');
      const passwordInput = controlledInputId
        ? document.getElementById(controlledInputId) as HTMLInputElement | null
        : button.parentElement?.querySelector<HTMLInputElement>('input[type="password"], input[type="text"]') ?? null;
      if (!passwordInput) return;
      const reveal = passwordInput.type === 'password';
      passwordInput.type = reveal ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(reveal));
      button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      const icon = button.querySelector<HTMLElement>('.material-symbols-outlined');
      if (icon) icon.textContent = reveal ? 'visibility_off' : 'visibility';
    });
  });

  const loginForm = document.querySelector<HTMLFormElement>('[data-login-form]');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event: SubmitEvent) => {
      event.preventDefault();
      const emailInput = loginForm.querySelector<HTMLInputElement>('#email, input[type="email"]');
      const passwordInput = loginForm.querySelector<HTMLInputElement>('#password, input[autocomplete="current-password"]');
      const messageNode = loginForm.querySelector<HTMLElement>('[data-login-message]');
      const email = emailInput?.value.trim() ?? '';
      const password = passwordInput?.value ?? '';
      const result = await createApiService(getApiBaseUrl()).login(email, password);

      if (messageNode) {
        messageNode.textContent = result.message ?? 'Authentication updated';
        messageNode.style.color = result.ok ? '#4edea3' : '#ffb4ab';
      }

      if (result.ok && result.data) {
        const redirectTarget = result.data.role === 'platform-admin'
          ? 'platform_admin/code.html'
          : loginForm.dataset.redirect ?? 'photographer_dashboard_overview/code.html';
        if (result.data.role !== 'platform-admin') getStorage().setItem('ingallery:onboarding', JSON.stringify(createOnboardingState(result.data.id)));
        window.location.href = redirectTarget;
      }
    });
  }

  const signupForm = document.querySelector<HTMLFormElement>('[data-signup-form]');
  if (signupForm) {
    signupForm.addEventListener('submit', async (event: SubmitEvent) => {
      event.preventDefault();
      const nameInput = signupForm.querySelector<HTMLInputElement>('[name="name"]');
      const emailInput = signupForm.querySelector<HTMLInputElement>('[name="email"]');
      const passwordInput = signupForm.querySelector<HTMLInputElement>('[name="password"]');
      const messageNode = signupForm.querySelector<HTMLElement>('[data-signup-message]');

      const name = nameInput?.value.trim() ?? '';
      const email = emailInput?.value.trim() ?? '';
      const password = passwordInput?.value ?? '';
      const result = await createApiService(getApiBaseUrl()).signup(email, password, name);

      if (messageNode) {
        messageNode.textContent = result.message ?? 'Account setup complete';
        messageNode.style.color = result.ok ? '#4edea3' : '#ffb4ab';
      }

      if (result.ok && result.data) {
        getStorage().setItem('ingallery:onboarding', JSON.stringify(createOnboardingState(result.data.id)));
        const redirectTarget = signupForm.dataset.redirect ?? 'photographer_dashboard_overview/code.html';
        window.location.href = redirectTarget;
      }
    });
  }

  const passwordRecoveryForm = document.querySelector<HTMLFormElement>('[data-password-recovery-form]');
  if (passwordRecoveryForm) {
    passwordRecoveryForm.addEventListener('submit', async (event: SubmitEvent) => {
      event.preventDefault();
      const emailInput = passwordRecoveryForm.querySelector<HTMLInputElement>('[name="email"]');
      const messageNode = passwordRecoveryForm.querySelector<HTMLElement>('[data-password-recovery-message]');
      const submitButton = passwordRecoveryForm.querySelector<HTMLButtonElement>('button[type="submit"]');
      const email = emailInput?.value.trim() ?? '';
      if (!emailInput?.reportValidity()) return;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending…';
      }
      const result = await createApiService(getApiBaseUrl()).requestPasswordRecovery(email);
      if (messageNode) {
        messageNode.textContent = result.message ?? (result.ok ? 'Check your email for recovery instructions.' : 'Unable to send a recovery email. Please try again.');
        messageNode.style.color = result.ok ? '#4edea3' : '#ffb4ab';
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Send Recovery Link';
      }
    });
  }

  const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => labelFor(button) === 'save settings'
  );

  if (saveButton && !saveButton.hasAttribute('data-settings-save')) {
    saveButton.addEventListener('click', () => {
      saveButton.textContent = 'Saved';
      saveButton.disabled = true;
      window.setTimeout(() => {
        saveButton.textContent = 'Save Settings';
        saveButton.disabled = false;
      }, 1800);
    });
  }

  void hydrateRecentActivity();

  if (window.location.pathname.includes('photographer_dashboard_overview')) {
    initializeApp();
    hydrateDashboard();
  }
};

if (typeof document !== 'undefined') {
  const run = (): void => initNavigation();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}
