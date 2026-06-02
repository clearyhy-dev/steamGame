import { createClient } from 'redis';
import type { Env } from '../../config/env';
import { dealPriceDayTz } from '../game/deal-price-day.util';
import { getPriceSyncIndexStats, rebuildPriceSyncIndexFromObjectStorage } from '../../cache/price-sync-index';
import {
  createS3Client,
  objectStoragePublicBase,
  s3BucketName,
  usesS3ObjectStorage,
} from '../../storage/s3-client';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

export type DataPlacementRow = {
  category: string;
  examples: string;
  primaryStore: 'vultr-minio' | 'vultr-redis' | 'vultr-sqlite' | 'gcp-firestore' | 'gcp-gcs' | 'memory';
  notes: string;
};

export const DATA_PLACEMENT: DataPlacementRow[] = [
  {
    category: '公开 JSON 缓存',
    examples: 'cache/top-discounts-*.json、cache/hot-deals-*.json、cache/country-prices-*.json',
    primaryStore: 'vultr-minio',
    notes: '由「构建公开缓存」任务写入；App 经 PUBLIC_CACHE_CDN_BASE 读取。禁止写入 GCS。',
  },
  {
    category: '分国家折扣分桶（大）',
    examples: 'cache/discount-offers/v1/{appid}__{CC}.json',
    primaryStore: 'vultr-minio',
    notes: 'DISCOUNT_OFFERS_PERSISTENCE=object_storage 时写入；单游戏×国家一个 JSON，体量最大。',
  },
  {
    category: '视频文件',
    examples: 'videos/{videoId}/…mp4、封面等',
    primaryStore: 'vultr-minio',
    notes: '视频流水线转码后上传；元数据在 SQLite（videos / video_jobs / video_sources）。',
  },
  {
    category: 'API 热点缓存',
    examples: 'steamgame:v1:*（Redis 键）',
    primaryStore: 'vultr-redis',
    notes: 'TTL 约 10 分钟，仅性能层；失效后可从 SQLite/MinIO 重建。',
  },
  {
    category: '今日已同步游戏索引',
    examples: 'steamgame:v1:price-sync:YYYY-MM-DD:all、:US、:US:isthereanydeal',
    primaryStore: 'vultr-redis',
    notes: '折扣同步成功后 SADD；Admin「今日已同步」筛选 SMEMBERS，避免每次列举 MinIO。',
  },
  {
    category: '游戏目录 / 评论 / 周热度',
    examples: 'game_catalog、game_reviews、game_weekly_heat',
    primaryStore: 'vultr-sqlite',
    notes: 'DATA_STORE=vultr_sqlite；Steam 同步写入 SQLite 表（含 data_json 与索引列）。',
  },
  {
    category: '折扣分桶元数据（可选）',
    examples: 'game_discount_offers（仅当 persistence=firestore 时）',
    primaryStore: 'vultr-minio',
    notes: '生产应设 DISCOUNT_OFFERS_PERSISTENCE=object_storage，大 JSON 只在 MinIO。',
  },
  {
    category: '国家 / 渠道 / 定时任务 / 用户',
    examples: 'region_country_configs、config_*、scheduled_tasks、users',
    primaryStore: 'vultr-sqlite',
    notes: '关系型 SQLite 表；不再使用 GCP Firestore。',
  },
  {
    category: 'Steam 资料 / 收藏 / 同步任务',
    examples: 'steam_profiles、user_favorites、steam_sync_jobs',
    primaryStore: 'vultr-sqlite',
    notes: 'SQLite 表；Steam 登录与同步读写 Vultr。',
  },
  {
    category: '请求日志',
    examples: 'api_request_logs',
    primaryStore: 'vultr-sqlite',
    notes: '默认 REQUEST_LOG_ENABLED=false；可设保留天数清理。',
  },
  {
    category: 'SQLite 数据库文件',
    examples: '/opt/steamgame-data/sqlite/steam.db',
    primaryStore: 'vultr-sqlite',
    notes: '经 data-api :8090 访问；Cloud Run 设 SQLITE_API_URL。',
  },
];

function parseRedisUrl(url: string): { host: string; port: number; hasPassword: boolean } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 6379,
      hasPassword: !!u.password,
    };
  } catch {
    return { host: '', port: 6379, hasPassword: false };
  }
}

export async function buildInfrastructureConfig(env: Env) {
  const s3 = usesS3ObjectStorage(env);
  const priceSyncIndex = await getPriceSyncIndexStats();
  const gcsLegacy = !!(env.gcsCacheBucket?.trim() || env.videoGcsBucket?.trim());
  const redisUrl = process.env.REDIS_URL?.trim() || '';
  const sqlitePath = process.env.SQLITE_PATH?.trim() || '/opt/steamgame-data/sqlite/steam.db';

  return {
    policy: {
      largeObjectsOnGcpForbidden: true,
      discountOffersPersistence: env.discountOffersPersistence,
      cacheUploadBackend: env.cacheUploadBackend,
      dealSyncPriceDayTz: dealPriceDayTz(),
    },
    warnings: [
      ...(gcsLegacy && s3
        ? ['环境变量仍含 GCS_CACHE_BUCKET/VIDEO_GCS_BUCKET，请确认 Cloud Run 已移除以免误写 GCS。']
        : []),
      ...(!s3 ? ['未启用 S3/MinIO（CACHE_UPLOAD_BACKEND 非 s3），大对象可能仍走 GCS。'] : []),
      ...(!redisUrl ? ['未设置 REDIS_URL，API 仅使用进程内缓存。'] : []),
    ],
    dataPlacement: DATA_PLACEMENT,
    minio: s3
      ? {
          enabled: true,
          endpoint: env.s3Endpoint ?? process.env.S3_ENDPOINT ?? '',
          bucket: s3BucketName(env),
          accessKeyId: env.s3AccessKeyId ?? process.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.s3SecretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY ?? '',
          publicCdnBase: objectStoragePublicBase(env) ?? env.publicCacheCdnBase ?? '',
          consoleUrlHint: `${(env.s3Endpoint ?? '').replace(/:9000$/, ':9001')}`,
        }
      : { enabled: false },
    redis: redisUrl
      ? {
          enabled: true,
          url: redisUrl,
          ...parseRedisUrl(redisUrl),
        }
      : { enabled: false },
    sqlite: {
      pathOnVultrHost: sqlitePath,
      appConnected: env.dataStore === 'vultr_sqlite' && !!env.sqliteApiUrl,
      dataApiUrl: env.sqliteApiUrl ?? '',
      note:
        env.dataStore === 'vultr_sqlite'
          ? '元数据经 DATA API 读写（:8090），Cloud Run 不访问 Firestore。'
          : '未启用 vultr_sqlite；仍使用 Firestore。',
    },
    gcp: {
      firestoreProjectId: env.firebaseProjectId,
      gcsConfigured: gcsLegacy,
      gcsCacheBucket: env.gcsCacheBucket ?? '',
      videoGcsBucket: env.videoGcsBucket ?? '',
    },
    priceSyncIndex,
  };
}

export async function rebuildPriceSyncIndex(env: Env): Promise<{ todayAll: number; ever: number; objects: number }> {
  return rebuildPriceSyncIndexFromObjectStorage(env);
}

export async function browseMinio(
  env: Env,
  opts: { prefix?: string; limit?: number },
): Promise<{
  bucket: string;
  prefix: string;
  objects: { key: string; size: number; lastModified: string | null }[];
  truncated: boolean;
  prefixSummary: { prefix: string; objectCount: number; totalBytes: number }[];
}> {
  if (!usesS3ObjectStorage(env)) {
    throw new Error('MinIO/S3 未启用');
  }
  const client = createS3Client(env);
  const bucket = s3BucketName(env);
  const prefix = (opts.prefix ?? '').replace(/^\//, '');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const listOut = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      MaxKeys: limit,
    }),
  );
  const objects = (listOut.Contents ?? []).map((o) => ({
    key: o.Key ?? '',
    size: o.Size ?? 0,
    lastModified: o.LastModified?.toISOString() ?? null,
  }));

  const topPrefixes = ['cache/', 'cache/discount-offers/v1/', 'videos/'];
  const prefixSummary: { prefix: string; objectCount: number; totalBytes: number }[] = [];
  for (const p of topPrefixes) {
    let count = 0;
    let totalBytes = 0;
    let token: string | undefined;
    do {
      const out = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: p,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const o of out.Contents ?? []) {
        count += 1;
        totalBytes += o.Size ?? 0;
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
      if (count >= 50_000) break;
    } while (token);
    prefixSummary.push({ prefix: p, objectCount: count, totalBytes });
  }

  return {
    bucket,
    prefix,
    objects,
    truncated: !!listOut.IsTruncated,
    prefixSummary,
  };
}

export async function browseRedis(env: Env): Promise<{
  connected: boolean;
  dbSize: number;
  memoryHuman?: string;
  keyPrefix: string;
  sampleKeys: string[];
  error?: string;
}> {
  const url = process.env.REDIS_URL?.trim();
  const keyPrefix = 'steamgame:v1:';
  if (!url) {
    return { connected: false, dbSize: 0, keyPrefix, sampleKeys: [], error: 'REDIS_URL 未配置' };
  }
  const client = createClient({ url });
  try {
    await client.connect();
    const infoRaw = await client.info('memory');
    const memoryHuman = infoRaw.match(/used_memory_human:([^\r\n]+)/)?.[1]?.trim();
    const dbSize = await client.dbSize();
    const sampleKeys: string[] = [];
    let cursor = 0;
    do {
      const reply = await client.scan(cursor, { MATCH: `${keyPrefix}*`, COUNT: 100 });
      cursor = reply.cursor;
      sampleKeys.push(...reply.keys);
    } while (cursor !== 0 && sampleKeys.length < 40);
    return { connected: true, dbSize, memoryHuman, keyPrefix, sampleKeys: sampleKeys.slice(0, 40) };
  } catch (e) {
    return {
      connected: false,
      dbSize: 0,
      keyPrefix,
      sampleKeys: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
  }
}
