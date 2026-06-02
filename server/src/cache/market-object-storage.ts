import type { Env } from '../config/env';
import { uploadPublicCacheJson, cacheUploadTargetLabel } from './cache-object-upload';
import { s3GetBuffer, usesS3ObjectStorage } from '../storage/s3-client';
import { downloadJsonBuffer } from '../modules/video/gcs.service';

const PREFIX = 'cache/markets/v2/';
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

export function marketGameDetailPath(countryCode: string, appid: string): string {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  const id = String(appid ?? '').trim();
  return `${PREFIX}${cc}/games/${id}/detail.json`;
}

export function marketGameHeatPath(countryCode: string, appid: string): string {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  const id = String(appid ?? '').trim();
  return `${PREFIX}${cc}/games/${id}/heat.json`;
}

export function marketGamePricesPath(countryCode: string, appid: string): string {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  const id = String(appid ?? '').trim();
  return `${PREFIX}${cc}/games/${id}/prices.json`;
}

export function marketListPath(countryCode: string, name: string): string {
  const cc = String(countryCode ?? '').trim().toUpperCase();
  return `${PREFIX}${cc}/lists/${name}.json`;
}

async function downloadBuffer(env: Env, objectPath: string): Promise<Buffer | null> {
  if (usesS3ObjectStorage(env)) return s3GetBuffer(env, objectPath);
  const bucket = env.gcsCacheBucket?.trim() || env.videoGcsBucket?.trim();
  if (!bucket) throw new Error('GCS_CACHE_BUCKET or VIDEO_GCS_BUCKET required');
  return downloadJsonBuffer(bucket, objectPath);
}

export async function readMarketJson<T>(env: Env, objectPath: string): Promise<T | null> {
  const buf = await downloadBuffer(env, objectPath);
  if (!buf || buf.length === 0) return null;
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeMarketJson(env: Env, objectPath: string, payload: unknown): Promise<void> {
  if (!cacheUploadTargetLabel(env)) {
    throw new Error('Object storage not configured for market v2 writes');
  }
  await uploadPublicCacheJson(env, objectPath, payload, CACHE_CONTROL);
}

export function assertMarketStorageConfigured(env: Env): void {
  if (!cacheUploadTargetLabel(env)) {
    throw new Error('Configure S3_* or GCS_CACHE_BUCKET for market v2 object storage');
  }
}
