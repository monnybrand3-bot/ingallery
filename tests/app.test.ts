import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRouteLookup,
  getKeyForLabel,
  createOnboardingState,
  getApiBaseUrl,
  formatCurrencyTotals,
  createApiService,
  resolveGalleryThumbnail,
  resolveGalleryCoverUrl,
  isValidEmail,
  isValidPassword,
  buildGalleryPublicUrl,
  buildGalleryCheckoutUrl,
  partitionPublicGalleryImages,
  PUBLIC_GALLERY_PREVIEW_LIMIT,
  resolveGalleryUploadPlan,
  normalizeGalleryCheckoutState
} from '../app.ts';

test('buildRouteLookup creates a stable route map', () => {
  const routes = buildRouteLookup();

  assert.equal(routes.dashboard, 'photographer_dashboard_overview/code.html');
  assert.equal(routes.checkout, 'client_checkout_flow/code.html');
  assert.equal(routes.success, 'public_gallery_unpaid/code.html');
  assert.equal(routes['unlock now'], undefined);
});

test('getKeyForLabel normalizes text consistently', () => {
  assert.equal(getKeyForLabel('  Create New Gallery  '), 'create new gallery');
  assert.equal(getKeyForLabel('Dashboard'), 'dashboard');
});

test('email and password validation rejects malformed credentials', () => {
  assert.equal(isValidEmail('studio@example.com'), true);
  assert.equal(isValidEmail('bad-email'), false);
  assert.equal(isValidPassword('strong-pass1'), true);
  assert.equal(isValidPassword('weak'), false);
});

test('onboarding state starts with the real user identifier', () => {
  const onboarding = createOnboardingState('user-123');

  assert.equal(onboarding.step, 'profile');
  assert.equal(onboarding.userId, 'user-123');
});

test('dashboard revenue formats each currency separately', () => {
  assert.equal(formatCurrencyTotals({ TZS: 125000, USD: 12.5 }), 'TZS 125,000 · USD 12.5');
  assert.equal(formatCurrencyTotals({ TZS: 0, USD: 0 }), 'TZS 0');
});

test('getApiBaseUrl and service creation provide a backend-ready configuration', () => {
  const baseUrl = getApiBaseUrl();
  const service = createApiService(baseUrl);

  assert.match(baseUrl, /api|localhost|render|vercel/i);
  assert.equal(typeof service.getDashboard, 'function');
  assert.equal(typeof service.login, 'function');
  assert.equal(typeof service.deleteGallery, 'function');
  assert.equal(typeof service.updateGallery, 'function');
  assert.equal(typeof service.getGalleryImages, 'function');
  assert.equal(typeof service.getPublicGalleryImages, 'function');
});

test('login preserves authentication errors returned by the API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    message: 'Invalid login credentials'
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });

  try {
    const result = await createApiService('http://localhost:8787').login('studio@example.com', 'wrong-password');

    assert.equal(result.ok, false);
    assert.equal(result.message, 'Invalid login credentials');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cover-only gallery uploads do not count the cover as a regular gallery photo', () => {
  const coverFile = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' });
  const plan = resolveGalleryUploadPlan({ galleryFiles: [], coverFile, isEdit: false });

  assert.equal(plan.hasCover, true);
  assert.deepEqual(plan.photoFiles, []);
  assert.equal(plan.canProceed, true);
});

test('gallery payment summaries resolve the real gallery amount and cover before checkout', () => {
  const summary = normalizeGalleryCheckoutState({
    id: 'g-123',
    title: 'Summer Collection',
    slug: 'summer-collection',
    accessPrice: 50000,
    currency: 'TZS',
    imageCount: 42,
    coverUrl: 'https://cdn.example.com/cover.jpg'
  });

  assert.equal(summary.id, 'g-123');
  assert.equal(summary.title, 'Summer Collection');
  assert.equal(summary.accessPrice, 50000);
  assert.equal(summary.currency, 'TZS');
  assert.equal(summary.coverUrl, 'https://cdn.example.com/cover.jpg');
});

test('gallery thumbnail resolution keeps real cover URLs available for card rendering', () => {
  const gallery = { title: 'Summer Collection', coverUrl: 'https://cdn.example.com/cover.jpg' };

  assert.equal(resolveGalleryThumbnail(gallery), 'https://cdn.example.com/cover.jpg');
  assert.equal(resolveGalleryThumbnail({ title: 'No Cover' }), null);
});

test('gallery cover resolution prefers the real cover but falls back to a preview image', () => {
  const gallery = {
    title: 'City Lights',
    coverUrl: '',
    images: [{ previewUrl: 'https://cdn.example.com/preview-1.jpg' }, { previewUrl: 'https://cdn.example.com/preview-2.jpg' }]
  };

  assert.equal(resolveGalleryCoverUrl(gallery), 'https://cdn.example.com/preview-1.jpg');
  assert.equal(resolveGalleryCoverUrl({ title: 'No Cover' }), null);
});

test('auth validation rejects malformed email and weak passwords', () => {
  assert.equal(isValidEmail('studio@example.com'), true);
  assert.equal(isValidEmail('studio.example.com'), false);
  assert.equal(isValidPassword('StrongPass123!'), true);
  assert.equal(isValidPassword('password'), false);
});

test('gallery URL builders keep the gallery reference attached to public and checkout pages', () => {
  const publicUrl = buildGalleryPublicUrl({ id: 'g-123', slug: 'summer-collection', title: 'Summer Collection' });
  const checkoutUrl = buildGalleryCheckoutUrl({ id: 'g-123', title: 'Summer Collection' });

  assert.match(publicUrl, /galleryId=g-123/);
  assert.match(checkoutUrl, /galleryId=g-123/);
  assert.match(publicUrl, /summer-collection/);
});

test('locked galleries expose at most ten previewable photos and keep the rest locked', () => {
  const images = Array.from({ length: 47 }, (_, index) => ({
    id: `photo-${index + 1}`,
    previewUrl: index < PUBLIC_GALLERY_PREVIEW_LIMIT
      ? `https://cdn.example.com/photo-${index + 1}.webp`
      : null
  }));

  const result = partitionPublicGalleryImages(images, false);

  assert.equal(PUBLIC_GALLERY_PREVIEW_LIMIT, 10);
  assert.equal(result.previewImages.length, 10);
  assert.equal(result.lockedImages.length, 37);
  assert.equal(result.lockedImages.some((image) => image.previewUrl), false);
  assert.equal(result.previewImages.at(-1)?.id, 'photo-10');
});

test('unlocked galleries expose every available photo and have no locked photos', () => {
  const images = Array.from({ length: 12 }, (_, index) => ({
    id: `photo-${index + 1}`,
    previewUrl: `https://cdn.example.com/photo-${index + 1}.webp`
  }));

  const result = partitionPublicGalleryImages(images, true);

  assert.equal(result.previewImages.length, 12);
  assert.deepEqual(result.lockedImages, []);
});
