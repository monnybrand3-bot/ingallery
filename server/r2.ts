import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME ?? 'ingallery-files';
const publicUrl = process.env.R2_PUBLIC_URL ?? '';

export const isR2Configured = (): boolean => Boolean(accountId && accessKeyId && secretAccessKey && bucketName);

export const getR2Client = (): S3Client | null => {
  if (!isR2Configured()) return null;

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId as string,
      secretAccessKey: secretAccessKey as string
    },
    forcePathStyle: false,
    retryMode: 'standard',
    maxAttempts: 3
  });
};

export const createPresignedUploadUrl = async ({
  key,
  contentType,
  expiresIn = 300
}: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<{ url: string; key: string }> => {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 storage is not configured. Set the R2 environment variables before uploading files.');
  }

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType
  });

  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, key };
};

export const createPresignedDownloadUrl = async ({
  key,
  expiresIn = 600,
  downloadFileName
}: {
  key: string;
  expiresIn?: number;
  downloadFileName?: string;
}): Promise<string> => {
  const client = getR2Client();
  if (!client) {
    throw new Error('R2 storage is not configured. Set the R2 environment variables before downloading files.');
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ...(downloadFileName ? {
      ResponseContentDisposition: `attachment; filename="${downloadFileName.replace(/[^A-Za-z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadFileName)}`
    } : {})
  });

  return getSignedUrl(client, command, { expiresIn });
};

export const deleteObjectFromR2 = async (key: string): Promise<void> => {
  const client = getR2Client();
  if (!client) throw new Error('R2 storage is not configured.');

  await client.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key
  }));
};

export const verifyObjectInR2 = async (key: string): Promise<boolean> => {
  const client = getR2Client();
  if (!client) throw new Error('R2 storage is not configured.');
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)) return false;
    throw error;
  }
};

export const getR2ObjectStream = async (key: string): Promise<Readable> => {
  const client = getR2Client();
  if (!client) throw new Error('R2 storage is not configured.');
  const response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if (!response.Body || !('pipe' in response.Body)) throw new Error('R2 object is not readable as a stream.');
  return response.Body as Readable;
};

export const getR2ObjectSize = async (key: string): Promise<number> => {
  const client = getR2Client();
  if (!client) throw new Error('R2 storage is not configured.');
  const response = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  if (!Number.isSafeInteger(response.ContentLength) || Number(response.ContentLength) <= 0) {
    throw new Error('R2 object size could not be verified.');
  }
  return Number(response.ContentLength);
};

export const putBufferToR2 = async ({
  key,
  contentType,
  body,
  cacheControl
}: {
  key: string;
  contentType: string;
  body: Uint8Array;
  cacheControl?: string;
}): Promise<void> => {
  const client = getR2Client();
  if (!client) throw new Error('R2 storage is not configured.');
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    Body: body,
    CacheControl: cacheControl ?? "public, max-age=31536000, immutable"
  }));
};

export const getBucketPublicUrl = (): string => publicUrl;

export const ensureR2CorsConfiguration = async (): Promise<void> => {
  const client = getR2Client();
  if (!client) return;

  const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const localOrigins = Array.from({ length: 11 }, (_, index) => 5173 + index).flatMap((portNumber) => [
    `http://localhost:${portNumber}`,
    `http://127.0.0.1:${portNumber}`
  ]);
  const allowedOrigins = [...new Set([...configuredOrigins, ...localOrigins])];

  await client.send(new PutBucketCorsCommand({
    Bucket: bucketName,
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: allowedOrigins,
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600
      }]
    }
  }));
};
