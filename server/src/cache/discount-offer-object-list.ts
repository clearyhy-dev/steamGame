import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { Env } from '../config/env';
import { createS3Client, s3BucketName } from '../storage/s3-client';

const OFFER_PREFIX = 'cache/discount-offers/v1/';

export type DiscountOfferObjectRow = {
  appid: string;
  countryCode: string;
  lastModifiedMs: number;
};

export function parseDiscountOfferObjectKey(key: string): DiscountOfferObjectRow | null {
  const m = key.match(/cache\/discount-offers\/v1\/(\d+)__([A-Z]{2})\.json$/i);
  if (!m) return null;
  return { appid: m[1], countryCode: m[2].toUpperCase(), lastModifiedMs: 0 };
}

/** 列出 MinIO 折扣 JSON 对象（appid、国家、LastModified） */
export async function listDiscountOfferObjects(env: Env): Promise<DiscountOfferObjectRow[]> {
  const client = createS3Client(env);
  const bucket = s3BucketName(env);
  const rows: DiscountOfferObjectRow[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: OFFER_PREFIX,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of out.Contents ?? []) {
      const parsed = parseDiscountOfferObjectKey(o.Key ?? '');
      if (!parsed || !o.LastModified) continue;
      rows.push({ ...parsed, lastModifiedMs: o.LastModified.getTime() });
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return rows;
}

/** appid -> 该游戏任意国家对象的最大 LastModified(ms) */
export function maxLastModifiedByAppid(rows: DiscountOfferObjectRow[]): Map<string, number> {
  const byAppid = new Map<string, number>();
  for (const r of rows) {
    const prev = byAppid.get(r.appid) ?? 0;
    if (r.lastModifiedMs > prev) byAppid.set(r.appid, r.lastModifiedMs);
  }
  return byAppid;
}
