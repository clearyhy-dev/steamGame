import type { Env } from '../config/env';
import type { GameDiscountCountryDoc } from '../modules/game/game-discount-offers.repository';
import { uploadPublicCacheJson, cacheUploadTargetLabel } from './cache-object-upload';
import { s3GetBuffer, s3ListKeys, usesS3ObjectStorage } from '../storage/s3-client';
import { downloadJsonBuffer } from '../modules/video/gcs.service';
import { jsonPlain } from '../utils/json-plain';

const PREFIX = 'cache/discount-offers/v1/';
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

export function discountOfferObjectPath(appid: string, businessCountryCode: string): string {
  const key = String(appid ?? '').trim();
  const cc = String(businessCountryCode ?? '')
    .trim()
    .toUpperCase();
  return `${PREFIX}${key}__${cc}.json`;
}

/** MinIO 存 plain JSON（ISO 时间字符串），不再写 Firestore Timestamp 包装。 */
export function serializeDiscountCountryDoc(doc: GameDiscountCountryDoc): string {
  return JSON.stringify(jsonPlain(doc));
}

export function deserializeDiscountCountryDoc(json: string): GameDiscountCountryDoc {
  return JSON.parse(json) as GameDiscountCountryDoc;
}

async function downloadBufferOs(env: Env, objectPath: string): Promise<Buffer | null> {
  if (usesS3ObjectStorage(env)) return s3GetBuffer(env, objectPath);
  const bucket = env.gcsCacheBucket?.trim() || env.videoGcsBucket?.trim();
  if (!bucket) throw new Error('GCS_CACHE_BUCKET or VIDEO_GCS_BUCKET required');
  return downloadJsonBuffer(bucket, objectPath);
}

export async function readDiscountOfferDoc(
  env: Env,
  appid: string,
  businessCountryCode: string,
): Promise<GameDiscountCountryDoc | null> {
  const path = discountOfferObjectPath(appid, businessCountryCode);
  const buf = await downloadBufferOs(env, path);
  if (!buf || buf.length === 0) return null;
  try {
    return deserializeDiscountCountryDoc(buf.toString('utf8'));
  } catch {
    return null;
  }
}

export async function writeDiscountOfferDoc(env: Env, doc: GameDiscountCountryDoc): Promise<void> {
  const cc = String(doc.countryCode ?? '')
    .trim()
    .toUpperCase();
  const path = discountOfferObjectPath(doc.appid, cc);
  await uploadPublicCacheJson(env, path, jsonPlain(doc), CACHE_CONTROL);
}

export async function listDiscountOfferKeysForAppid(env: Env, appid: string): Promise<string[]> {
  const key = String(appid ?? '').trim();
  if (!key) return [];
  const prefix = `${PREFIX}${key}__`;
  if (usesS3ObjectStorage(env)) {
    const keys = await s3ListKeys(env, prefix);
    return keys.filter((n) => n.endsWith('.json'));
  }
  const bucket = env.gcsCacheBucket?.trim() || env.videoGcsBucket?.trim();
  if (!bucket) return [];
  const { getGcs } = await import('../modules/video/gcs.service');
  const [files] = await getGcs()
    .bucket(bucket)
    .getFiles({ prefix, maxResults: 500 });
  return files.map((f) => f.name).filter((n) => n.startsWith(prefix) && n.endsWith('.json'));
}

export function assertObjectStorageConfigured(env: Env): void {
  if (!cacheUploadTargetLabel(env)) {
    throw new Error('Configure S3_BUCKET / S3_ENDPOINT or GCS_CACHE_BUCKET for discount object_storage');
  }
}
