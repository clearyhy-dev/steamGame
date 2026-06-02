import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env';

export function usesS3ObjectStorage(env: Env): boolean {
  const b = (process.env.CACHE_UPLOAD_BACKEND ?? env.cacheUploadBackend ?? 's3').trim().toLowerCase();
  return b === 's3' || b === 'r2' || b === 'minio';
}

export function s3BucketName(env: Env): string {
  const b =
    process.env.S3_BUCKET?.trim() ||
    env.s3Bucket?.trim() ||
    process.env.R2_CACHE_BUCKET?.trim() ||
    env.r2CacheBucket?.trim() ||
    env.gcsCacheBucket?.trim() ||
    env.videoGcsBucket?.trim();
  if (!b) throw new Error('Set S3_BUCKET (or R2_CACHE_BUCKET / GCS_CACHE_BUCKET)');
  return b;
}

export function createS3Client(env: Env): S3Client {
  const endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    env.s3Endpoint?.trim() ||
    process.env.R2_ENDPOINT?.trim() ||
    env.r2Endpoint?.trim();
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    env.s3AccessKeyId?.trim() ||
    process.env.R2_ACCESS_KEY_ID?.trim() ||
    env.r2AccessKeyId?.trim();
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    env.s3SecretAccessKey?.trim() ||
    process.env.R2_SECRET_ACCESS_KEY?.trim() ||
    env.r2SecretAccessKey?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY required for S3/MinIO');
  }
  return new S3Client({
    region: process.env.S3_REGION?.trim() || 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function s3PutJson(
  env: Env,
  objectPath: string,
  data: unknown,
  cacheControl: string,
): Promise<void> {
  const client = createS3Client(env);
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  await client.send(
    new PutObjectCommand({
      Bucket: s3BucketName(env),
      Key: objectPath,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: cacheControl,
    }),
  );
}

export async function s3PutBuffer(
  env: Env,
  objectPath: string,
  body: Buffer,
  contentType: string,
  cacheControl?: string,
): Promise<void> {
  const client = createS3Client(env);
  await client.send(
    new PutObjectCommand({
      Bucket: s3BucketName(env),
      Key: objectPath,
      Body: body,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  );
}

export async function s3GetBuffer(env: Env, objectPath: string): Promise<Buffer | null> {
  const client = createS3Client(env);
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: s3BucketName(env), Key: objectPath }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) return null;
    return Buffer.from(bytes);
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    if (name === 'NoSuchKey' || (e as { Code?: string })?.Code === 'NoSuchKey') return null;
    throw e;
  }
}

export async function s3ListKeys(env: Env, prefix: string, maxKeys = 500): Promise<string[]> {
  const client = createS3Client(env);
  const bucket = s3BucketName(env);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: maxKeys,
      }),
    );
    for (const o of out.Contents ?? []) {
      if (o.Key) keys.push(o.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function s3SignedGetUrl(env: Env, objectPath: string, expiresSec: number): Promise<string> {
  const pub = objectStoragePublicBase(env);
  if (pub) return `${pub}/${objectPath.replace(/^\//, '')}`;
  const client = createS3Client(env);
  const cmd = new GetObjectCommand({ Bucket: s3BucketName(env), Key: objectPath });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(client as any, cmd, { expiresIn: expiresSec });
}

export function objectStoragePublicBase(env: Env): string | undefined {
  const base = env.publicCacheCdnBase?.trim().replace(/\/+$/, '');
  if (base) return base;
  if (!usesS3ObjectStorage(env)) return undefined;
  const endpoint = (process.env.S3_ENDPOINT ?? env.s3Endpoint ?? '').trim().replace(/\/+$/, '');
  const bucket = s3BucketName(env);
  if (endpoint) return `${endpoint}/${bucket}`;
  return undefined;
}
