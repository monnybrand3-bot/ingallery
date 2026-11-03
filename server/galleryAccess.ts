import { createHmac, timingSafeEqual } from 'node:crypto';

const getAccessSigningKey = (): Buffer => {
  const configuredKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!configuredKey || !/^[a-fA-F0-9]{64}$/.test(configuredKey)) {
    throw new Error('PAYMENT_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex value');
  }
  return Buffer.from(configuredKey, 'hex');
};

const signatureForOrder = (orderId: string, galleryId: string): string => createHmac('sha256', getAccessSigningKey())
  .update(`ingallery:gallery-access:v1:${orderId}:${galleryId}`)
  .digest('base64url');

export const createGalleryAccessToken = (orderId: string, galleryId: string): string =>
  `${orderId}.${signatureForOrder(orderId, galleryId)}`;

export const verifyGalleryAccessToken = (token: string | null | undefined, orderId: string, galleryId: string): boolean => {
  if (!token) return false;
  const [tokenOrderId, signature, extra] = token.split('.');
  if (extra !== undefined || tokenOrderId !== orderId || !signature) return false;

  try {
    const expected = Buffer.from(signatureForOrder(orderId, galleryId), 'base64url');
    const received = Buffer.from(signature, 'base64url');
    return received.length === expected.length && timingSafeEqual(received, expected);
  } catch {
    return false;
  }
};

export const verifyPaidOrderAccess = (
  token: string | null | undefined,
  order: { id: string; gallery_id: string; status: string; payment_verified_at: string | null } | null
): boolean => Boolean(
  order &&
  order.status === 'SUCCESS' &&
  order.payment_verified_at &&
  verifyGalleryAccessToken(token, order.id, order.gallery_id)
);
