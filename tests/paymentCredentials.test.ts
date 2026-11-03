import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptPaymentCredentials,
  encryptPaymentCredentials,
  type PaymentProviderCredentials
} from '../server/paymentCredentials.ts';

const TEST_ENCRYPTION_KEY = 'a'.repeat(64);

test('payment credentials are encrypted and authenticated', () => {
  const previousKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const credentials: PaymentProviderCredentials = {
    provider: 'clickpesa',
    clientId: 'merchant-client-id',
    apiKey: 'merchant-api-key'
  };

  try {
    const encrypted = encryptPaymentCredentials(credentials);

    assert.equal(encrypted.ciphertext.includes(credentials.apiKey), false);
    assert.deepEqual(decryptPaymentCredentials<PaymentProviderCredentials>(encrypted), credentials);
    assert.throws(() => decryptPaymentCredentials({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -4)}AAAA` }));
  } finally {
    if (previousKey === undefined) delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test('Stakaba API keys are encrypted using the same server-only credential vault', () => {
  const previousKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const credentials: PaymentProviderCredentials = {
    provider: 'stakaba',
    apiKey: 'sk_test_example-merchant-key'
  };

  try {
    const encrypted = encryptPaymentCredentials(credentials);
    assert.equal(encrypted.ciphertext.includes(credentials.apiKey), false);
    assert.deepEqual(decryptPaymentCredentials<PaymentProviderCredentials>(encrypted), credentials);
  } finally {
    if (previousKey === undefined) delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
