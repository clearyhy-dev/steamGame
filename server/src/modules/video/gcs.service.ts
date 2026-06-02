import fs from 'fs/promises';
import { Storage } from '@google-cloud/storage';
import type { Env } from '../../config/env';
import {
  s3BucketName,
  s3GetBuffer,
  s3PutBuffer,
  s3PutJson,
  s3SignedGetUrl,
  usesS3ObjectStorage,
} from '../../storage/s3-client';

let storageSingleton: Storage | null = null;

export function getGcs(): Storage {
  if (!storageSingleton) storageSingleton = new Storage();
  return storageSingleton;
}

function resolveBucket(env: Env): string {
  if (usesS3ObjectStorage(env)) return s3BucketName(env);
  const bucketName = env.videoGcsBucket ?? env.gcsCacheBucket;
  if (!bucketName) throw new Error('VIDEO_GCS_BUCKET or S3_BUCKET is not configured');
  return bucketName;
}

export async function uploadLocalFile(env: Env, localPath: string, objectPath: string): Promise<void> {
  if (usesS3ObjectStorage(env)) {
    const buf = await fs.readFile(localPath);
    const contentType = objectPath.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
    await s3PutBuffer(env, objectPath, buf, contentType);
    return;
  }
  const bucketName = resolveBucket(env);
  await getGcs().bucket(bucketName).upload(localPath, {
    destination: objectPath,
    resumable: false,
  });
}

export async function getSignedReadUrl(env: Env, objectPath: string): Promise<string> {
  if (usesS3ObjectStorage(env)) {
    const minutes = env.videoSignedUrlMinutes;
    return s3SignedGetUrl(env, objectPath, minutes * 60);
  }
  const bucketName = resolveBucket(env);
  const minutes = env.videoSignedUrlMinutes;
  const [url] = await getGcs()
    .bucket(bucketName)
    .file(objectPath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + minutes * 60 * 1000,
    });
  return url;
}

export function gsUri(bucket: string, objectPath: string): string {
  return `gs://${bucket}/${objectPath}`;
}

export function s3Uri(env: Env, objectPath: string): string {
  return `s3://${s3BucketName(env)}/${objectPath}`;
}

/** 写入 JSON（公开缓存或折扣分桶） */
export async function uploadJsonPublic(
  env: Env,
  objectPath: string,
  data: unknown,
  cacheControl: string,
): Promise<void> {
  if (usesS3ObjectStorage(env)) {
    await s3PutJson(env, objectPath, data, cacheControl);
    return;
  }
  const bucketName = resolveBucket(env);
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  await getGcs()
    .bucket(bucketName)
    .file(objectPath)
    .save(buf, {
      contentType: 'application/json; charset=utf-8',
      resumable: false,
      metadata: { cacheControl },
    });
}

/** @deprecated 请传 Env；保留兼容 cache 模块旧签名 */
export async function uploadJsonPublicLegacy(
  bucketName: string,
  objectPath: string,
  data: unknown,
  cacheControl: string,
): Promise<void> {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  await getGcs()
    .bucket(bucketName)
    .file(objectPath)
    .save(buf, {
      contentType: 'application/json; charset=utf-8',
      resumable: false,
      metadata: { cacheControl },
    });
}

export async function downloadJsonBuffer(envOrBucket: Env | string, objectPath: string): Promise<Buffer | null> {
  if (typeof envOrBucket !== 'string') {
    if (usesS3ObjectStorage(envOrBucket)) return s3GetBuffer(envOrBucket, objectPath);
    const bucketName = envOrBucket.gcsCacheBucket ?? envOrBucket.videoGcsBucket;
    if (!bucketName) throw new Error('GCS bucket not configured');
    return downloadJsonBuffer(bucketName, objectPath);
  }
  const bucketName = envOrBucket;
  try {
    const [buf] = await getGcs().bucket(bucketName).file(objectPath).download();
    return buf;
  } catch (e: unknown) {
    const code = (e as { code?: number })?.code;
    if (code === 404) return null;
    throw e;
  }
}

export async function uploadRawFile(
  env: Env,
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (usesS3ObjectStorage(env)) {
    await s3PutBuffer(env, objectPath, body, contentType);
    return;
  }
  const bucketName = resolveBucket(env);
  await getGcs()
    .bucket(bucketName)
    .file(objectPath)
    .save(body, { resumable: false, contentType });
}
