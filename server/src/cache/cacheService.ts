import NodeCache from 'node-cache';
import { createClient } from 'redis';
import { logger } from '../utils/logger';

/** 默认 TTL（秒），与计划「热门接口可更长」由调用方覆盖 */
const DEFAULT_TTL_SEC = 600;

const KEY_PREFIX = 'steamgame:v1:';

const store = new NodeCache({
  stdTTL: DEFAULT_TTL_SEC,
  checkperiod: 120,
  useClones: false,
});

function redisUrl(): string | undefined {
  const u = process.env.REDIS_URL?.trim();
  return u || undefined;
}

let redisClient: ReturnType<typeof createClient> | null = null;
let redisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  const url = redisUrl();
  if (!url) return null;
  if (redisClient?.isOpen) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;
  redisConnectPromise = (async () => {
    try {
      const c = createClient({ url });
      c.on('error', (err) => logger.error(`[cacheService] redis ${err instanceof Error ? err.message : String(err)}`));
      await c.connect();
      redisClient = c;
      logger.info('[cacheService] redis connected (shared cache survives Cloud Run redeploys)');
      return c;
    } catch (e) {
      logger.error(`[cacheService] redis connect failed: ${e instanceof Error ? e.message : String(e)}`);
      redisClient = null;
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();
  return redisConnectPromise;
}

function rk(key: string): string {
  return `${KEY_PREFIX}${key}`;
}

/**
 * 公开 API 短缓存。
 * - 未设置 `REDIS_URL`：仅 **进程内 node-cache**，Cloud Run **重新部署 / 新实例** 后缓存为空。
 * - 设置 `REDIS_URL`（Upstash、Memorystore 等）：**跨实例、跨部署** 仍可读回（在 TTL 内），避免冷启动大量回源 Firestore。
 *
 * 业务真源仍在 Firestore / GCS；此处仅为性能层，**不等价于数据持久化**。
 */
export const cacheService = {
  async getCache<T>(key: string): Promise<T | undefined> {
    const r = await getRedis();
    if (r) {
      try {
        const raw = await r.get(rk(key));
        if (raw == null) return undefined;
        return JSON.parse(raw) as T;
      } catch (e) {
        logger.warn(`[cacheService] redis get ${key}: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      }
    }
    return store.get<T>(key);
  },

  /** @param ttlSec 秒；省略则用默认 600 */
  async setCache<T>(key: string, value: T, ttlSec?: number): Promise<boolean> {
    const sec = ttlSec != null && ttlSec > 0 ? Math.floor(ttlSec) : DEFAULT_TTL_SEC;
    const r = await getRedis();
    if (r) {
      try {
        await r.set(rk(key), JSON.stringify(value), { EX: Math.max(1, sec) });
        return true;
      } catch (e) {
        logger.warn(`[cacheService] redis set ${key}: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    if (ttlSec != null && ttlSec > 0) {
      return store.set(key, value, ttlSec);
    }
    return store.set(key, value);
  },

  async invalidateCache(key: string): Promise<number> {
    const r = await getRedis();
    if (r) {
      try {
        return Number(await r.del(rk(key)));
      } catch {
        return 0;
      }
    }
    return store.del(key);
  },

  async invalidatePrefix(prefix: string): Promise<void> {
    const r = await getRedis();
    if (r) {
      const pattern = `${KEY_PREFIX}${prefix}*`;
      try {
        for await (const k of r.scanIterator({ MATCH: pattern, COUNT: 200 })) {
          await r.del(k);
        }
      } catch (e) {
        logger.warn(`[cacheService] redis invalidatePrefix: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const keys = store.keys().filter((k) => String(k).startsWith(prefix));
    if (keys.length) store.del(keys);
  },

  flushAll(): void {
    store.flushAll();
  },

  /** Redis SET：未配置 REDIS_URL 时返回 false */
  async redisSAdd(key: string, member: string, ttlSec?: number): Promise<boolean> {
    const r = await getRedis();
    if (!r) return false;
    const full = rk(key);
    try {
      await r.sAdd(full, member);
      if (ttlSec != null && ttlSec > 0) await r.expire(full, Math.max(1, Math.floor(ttlSec)));
      return true;
    } catch (e) {
      logger.warn(`[cacheService] redisSAdd ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },

  async redisSMembers(key: string): Promise<string[] | null> {
    const r = await getRedis();
    if (!r) return null;
    try {
      return await r.sMembers(rk(key));
    } catch (e) {
      logger.warn(`[cacheService] redisSMembers ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  },

  async redisSCard(key: string): Promise<number | null> {
    const r = await getRedis();
    if (!r) return null;
    try {
      return await r.sCard(rk(key));
    } catch (e) {
      logger.warn(`[cacheService] redisSCard ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  },

  /** 原子替换 SET（用于每日索引重建） */
  async redisReplaceSet(key: string, members: string[], ttlSec?: number): Promise<boolean> {
    const r = await getRedis();
    if (!r) return false;
    const full = rk(key);
    try {
      await r.del(full);
      if (members.length > 0) {
        const batch = 500;
        for (let i = 0; i < members.length; i += batch) {
          await r.sAdd(full, members.slice(i, i + batch));
        }
        if (ttlSec != null && ttlSec > 0) await r.expire(full, Math.max(1, Math.floor(ttlSec)));
      }
      return true;
    } catch (e) {
      logger.warn(`[cacheService] redisReplaceSet ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },
};

export const CACHE_DEFAULT_TTL_SEC = DEFAULT_TTL_SEC;
export const CACHE_HOT_TTL_SEC = 1800;
export const CACHE_LONG_TTL_SEC = 86400;
