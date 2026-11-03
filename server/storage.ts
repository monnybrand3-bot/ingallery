export type StorageWarningLevel = '75%' | '90%' | '95%' | '100%';

export interface StorageLimitInput {
  planLimitBytes: number;
  extraBytes?: number;
}

export interface UploadReservationInput {
  usedBytes: number;
  reservedBytes: number;
  extraBytes: number;
  planLimitBytes: number;
  fileSizeBytes: number;
}

export interface UploadReservationResult {
  ok: boolean;
  reservedBytes: number;
  remainingBytes: number;
  effectiveLimitBytes: number;
  totalUsedBytes: number;
  reason?: string;
}

export const bytesFromHumanReadable = (value: string | number): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }

  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const match = trimmed.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2] ?? 'B';
  const multiplier = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024
  }[unit] ?? 1;

  return Math.max(0, Math.trunc(amount * multiplier));
};

export const getEffectiveStorageLimit = ({ planLimitBytes, extraBytes = 0 }: StorageLimitInput): number => {
  const safePlanLimit = Number(planLimitBytes ?? 0);
  const safeExtra = Number(extraBytes ?? 0);
  return Math.max(0, Math.trunc(safePlanLimit + safeExtra));
};

export const humanizeBytes = (value: number): string => {
  const safeValue = Math.max(0, Number(value ?? 0));
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let normalized = safeValue;
  let unitIndex = 0;

  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? Math.round(normalized) : normalized >= 10 ? Math.round(normalized) : Number(normalized.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
};

export const calculateStorageWarning = (ratio: number): StorageWarningLevel | undefined => {
  const normalized = Number(ratio ?? 0);
  if (normalized >= 1) return '100%';
  if (normalized >= 0.95) return '95%';
  if (normalized >= 0.9) return '90%';
  if (normalized >= 0.75) return '75%';
  return undefined;
};

export const isQuotaExceeded = (usedBytes: number, fileSizeBytes: number, limitBytes: number): boolean => {
  const safeUsed = Number(usedBytes ?? 0);
  const safeFileSize = Number(fileSizeBytes ?? 0);
  const safeLimit = Number(limitBytes ?? 0);
  return safeUsed + safeFileSize > safeLimit;
};

export const reserveStorageForUpload = ({
  usedBytes,
  reservedBytes,
  extraBytes,
  planLimitBytes,
  fileSizeBytes
}: UploadReservationInput): UploadReservationResult => {
  const effectiveLimitBytes = getEffectiveStorageLimit({ planLimitBytes, extraBytes });
  const totalUsedBytes = Number(usedBytes ?? 0) + Number(reservedBytes ?? 0);
  const remainingBytes = Math.max(0, effectiveLimitBytes - totalUsedBytes);

  if (fileSizeBytes <= 0) {
    return {
      ok: false,
      reservedBytes: 0,
      remainingBytes,
      effectiveLimitBytes,
      totalUsedBytes,
      reason: 'File size must be greater than zero.'
    };
  }

  if (fileSizeBytes > remainingBytes) {
    return {
      ok: false,
      reservedBytes: 0,
      remainingBytes,
      effectiveLimitBytes,
      totalUsedBytes,
      reason: 'Storage limit exceeded. The current plan cannot accept this upload.'
    };
  }

  return {
    ok: true,
    reservedBytes: fileSizeBytes,
    remainingBytes: remainingBytes - fileSizeBytes,
    effectiveLimitBytes,
    totalUsedBytes: totalUsedBytes + fileSizeBytes
  };
};
