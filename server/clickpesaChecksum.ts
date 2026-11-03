import { createHmac } from 'node:crypto';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
};

export const createClickPesaChecksum = (checksumKey: string, payload: Record<string, unknown>): string =>
  createHmac('sha256', checksumKey)
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
