import { Storage } from '@google-cloud/storage';
import type { Env } from '../../config/env';

let storageSingleton: Storage | null = null;

export function getGcs(): Storage {
  if (!storageSingleton) storageSingleton = new Storage();
  return storageSingleton;
}

export async function uploadLocalFile(env: Env, localPath: string, gcsObjectPath: string): Promise<void> {
  const bucketName = env.videoGcsBucket;
  if (!bucketName) throw new Error('VIDEO_GCS_BUCKET is not configured');

  await getGcs().bucket(bucketName).upload(localPath, {
    destination: gcsObjectPath,
    resumable: false,
  });
}

export async function getSignedReadUrl(env: Env, gcsObjectPath: string): Promise<string> {
  const bucketName = env.videoGcsBucket;
  if (!bucketName) throw new Error('VIDEO_GCS_BUCKET is not configured');

  const minutes = env.videoSignedUrlMinutes;
  const [url] = await getGcs()
    .bucket(bucketName)
    .file(gcsObjectPath)
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
