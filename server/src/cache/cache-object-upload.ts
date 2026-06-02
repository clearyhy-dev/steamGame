import type { Env } from '../config/env';
import { uploadJsonPublic } from '../modules/video/gcs.service';
import { s3BucketName, usesS3ObjectStorage } from '../storage/s3-client';

/** 写入公开 JSON 缓存：S3/MinIO（默认）或 GCS */
export async function uploadPublicCacheJson(
  env: Env,
  objectPath: string,
  data: unknown,
  cacheControl: string,
): Promise<void> {
  await uploadJsonPublic(env, objectPath, data, cacheControl);
}

export function cacheUploadTargetLabel(env: Env): string {
  if (usesS3ObjectStorage(env)) return s3BucketName(env);
  return env.gcsCacheBucket?.trim() || env.videoGcsBucket?.trim() || '';
}
