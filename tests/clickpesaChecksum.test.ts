import assert from 'node:assert/strict';
import test from 'node:test';

import { createClickPesaChecksum } from '../server/clickpesaChecksum.ts';

test('ClickPesa checksum canonicalizes nested object keys before signing', () => {
  const key = 'clickpesa-checksum-test-key';
  const first = {
    totalPrice: '10000',
    orderReference: 'IG0123456789ABCDEF01',
    orderCurrency: 'TZS',
    customer: { customerName: 'Test Client', customerPhone: '255700000000' }
  };
  const reordered = {
    customer: { customerPhone: '255700000000', customerName: 'Test Client' },
    orderCurrency: 'TZS',
    orderReference: 'IG0123456789ABCDEF01',
    totalPrice: '10000'
  };

  assert.equal(createClickPesaChecksum(key, first), createClickPesaChecksum(key, reordered));
  assert.notEqual(createClickPesaChecksum(key, first), createClickPesaChecksum(key, { ...first, totalPrice: '10001' }));
});
