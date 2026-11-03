import assert from 'node:assert/strict';
import test from 'node:test';

import { createGalleryAccessToken, verifyGalleryAccessToken, verifyPaidOrderAccess } from '../server/galleryAccess.ts';

const TEST_ENCRYPTION_KEY = 'b'.repeat(64);
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const GALLERY_ID = '22222222-2222-4222-8222-222222222222';

test('gallery access token is bound to its paid order and gallery', () => {
  const previousKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

  try {
    const token = createGalleryAccessToken(ORDER_ID, GALLERY_ID);
    assert.equal(verifyGalleryAccessToken(token, ORDER_ID, GALLERY_ID), true);
    assert.equal(verifyGalleryAccessToken(token, '33333333-3333-4333-8333-333333333333', GALLERY_ID), false);
    assert.equal(verifyGalleryAccessToken(token, ORDER_ID, '44444444-4444-4444-8444-444444444444'), false);
    assert.equal(verifyGalleryAccessToken(`${token.slice(0, -1)}x`, ORDER_ID, GALLERY_ID), false);
    assert.equal(verifyGalleryAccessToken(null, ORDER_ID, GALLERY_ID), false);
    assert.equal(verifyPaidOrderAccess(token, { id: ORDER_ID, gallery_id: GALLERY_ID, status: 'SUCCESS', payment_verified_at: new Date().toISOString() }), true);
    assert.equal(verifyPaidOrderAccess(token, { id: ORDER_ID, gallery_id: GALLERY_ID, status: 'SUCCESS', payment_verified_at: null }), false);
    assert.equal(verifyPaidOrderAccess(token, { id: ORDER_ID, gallery_id: GALLERY_ID, status: 'PENDING', payment_verified_at: null }), false);
  } finally {
    if (previousKey === undefined) delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
