import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bytesFromHumanReadable,
  calculateStorageWarning,
  getEffectiveStorageLimit,
  isQuotaExceeded,
  reserveStorageForUpload,
  humanizeBytes
} from '../server/storage.ts';

test('storage helpers convert plan sizes and warn at thresholds', () => {
  assert.equal(bytesFromHumanReadable('10 GB'), 10 * 1024 * 1024 * 1024);
  assert.equal(bytesFromHumanReadable('20 GB'), 20 * 1024 * 1024 * 1024);
  assert.equal(calculateStorageWarning(0.75), '75%');
  assert.equal(calculateStorageWarning(0.9), '90%');
  assert.equal(calculateStorageWarning(0.95), '95%');
  assert.equal(calculateStorageWarning(1), '100%');
});

test('quota checks enforce effective storage limits and reservations', () => {
  const limit = 20 * 1024 * 1024 * 1024;
  assert.equal(isQuotaExceeded(19 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024, limit), true);
  assert.equal(isQuotaExceeded(18 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024, limit), false);

  const summary = reserveStorageForUpload({
    usedBytes: 17 * 1024 * 1024 * 1024,
    reservedBytes: 0,
    extraBytes: 10 * 1024 * 1024 * 1024,
    planLimitBytes: 20 * 1024 * 1024 * 1024,
    fileSizeBytes: 3 * 1024 * 1024 * 1024
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.reservedBytes, 3 * 1024 * 1024 * 1024);
  assert.equal(summary.remainingBytes, 10 * 1024 * 1024 * 1024);
});

test('humanized byte output stays readable', () => {
  assert.equal(humanizeBytes(1024), '1 KB');
  assert.equal(humanizeBytes(1024 * 1024), '1 MB');
  assert.equal(humanizeBytes(10 * 1024 * 1024 * 1024), '10 GB');
});

test('effective quota includes purchased extra storage', () => {
  const limit = getEffectiveStorageLimit({
    planLimitBytes: 20 * 1024 * 1024 * 1024,
    extraBytes: 10 * 1024 * 1024 * 1024
  });

  assert.equal(limit, 30 * 1024 * 1024 * 1024);
});
