import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedPaymentCredentials {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export type PaymentProviderCredentials =
  | { provider: 'clickpesa'; clientId: string; apiKey: string; checksumKey?: string }
  | { provider: 'malipo'; apiKey: string; secretKey: string }
  | { provider: 'stakaba'; apiKey: string };

const getEncryptionKey = (): Buffer => {
  const configuredKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!configuredKey || !/^[a-fA-F0-9]{64}$/.test(configuredKey)) {
    throw new Error('PAYMENT_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex value');
  }
  return Buffer.from(configuredKey, 'hex');
};

export const encryptPaymentCredentials = (credentials: PaymentProviderCredentials): EncryptedPaymentCredentials => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
};

export const decryptPaymentCredentials = <T extends PaymentProviderCredentials>(encrypted: EncryptedPaymentCredentials): T => {
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
};
