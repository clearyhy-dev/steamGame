import type { Env } from '../config/env';
import { calendarDayKey, dealPriceDayTz } from '../modules/game/deal-price-day.util';
import { usesS3ObjectStorage } from '../storage/s3-client';
import { logger } from '../utils/logger';
import { cacheService } from './cacheService';
import { listDiscountOfferObjects, maxLastModifiedByAppid } from './discount-offer-object-list';

/** 日历日 SET 保留 72h，跨日自动失效 */
const DAY_SET_TTL_SEC = 72 * 3600;
const EVER_SET_TTL_SEC = 400 * 24 * 3600;

function todayDayKey(nowMs = Date.now()): string {
  return calendarDayKey(nowMs, dealPriceDayTz());
}

function indexKeyTodayAll(day: string): string {
  return `price-sync:${day}:all`;
}

function indexKeyTodayCountry(day: string, countryCode: string): string {
  return `price-sync:${day}:${countryCode.toUpperCase()}`;
}

function indexKeyTodayCountrySource(day: string, countryCode: string, source: string): string {
  return `price-sync:${day}:${countryCode.toUpperCase()}:${source.toLowerCase()}`;
}

const INDEX_KEY_EVER = 'price-sync:ever';

export function resolvePriceSyncIndexKey(
  mode: 'today' | 'yes',
  opts?: { countryCode?: string; source?: string },
): string {
  if (mode === 'yes') return INDEX_KEY_EVER;
  const day = todayDayKey();
  const cc = String(opts?.countryCode ?? '').trim().toUpperCase();
  const src = String(opts?.source ?? '').trim().toLowerCase();
  if (cc && src) return indexKeyTodayCountrySource(day, cc, src);
  if (cc) return indexKeyTodayCountry(day, cc);
  return indexKeyTodayAll(day);
}

/** 已配置 REDIS_URL 即走索引路径（避免 SMEMBERS 失败时误回退列举 MinIO） */
export function isPriceSyncIndexConfigured(): boolean {
  return !!process.env.REDIS_URL?.trim();
}

export async function isPriceSyncIndexAvailable(): Promise<boolean> {
  if (!isPriceSyncIndexConfigured()) return false;
  const card = await cacheService.redisSCard(indexKeyTodayAll(todayDayKey()));
  return card !== null;
}

/** 价格同步成功后写入 Redis（增量） */
export async function recordPriceSync(
  appid: string,
  opts?: { countryCode?: string; source?: string },
): Promise<void> {
  const id = String(appid ?? '').trim();
  if (!id) return;
  const day = todayDayKey();
  const cc = String(opts?.countryCode ?? 'US').trim().toUpperCase() || 'US';
  const src = String(opts?.source ?? '').trim().toLowerCase();

  await cacheService.redisSAdd(indexKeyTodayAll(day), id, DAY_SET_TTL_SEC);
  await cacheService.redisSAdd(indexKeyTodayCountry(day, cc), id, DAY_SET_TTL_SEC);
  if (src) await cacheService.redisSAdd(indexKeyTodayCountrySource(day, cc, src), id, DAY_SET_TTL_SEC);
  await cacheService.redisSAdd(INDEX_KEY_EVER, id, EVER_SET_TTL_SEC);
}

export async function listPriceSyncedAppids(
  mode: 'today' | 'yes',
  opts?: { countryCode?: string; source?: string },
): Promise<string[] | null> {
  if (!isPriceSyncIndexConfigured()) return null;
  const key = resolvePriceSyncIndexKey(mode, opts);
  const members = await cacheService.redisSMembers(key);
  return members ?? [];
}

export async function getPriceSyncIndexStats(): Promise<{
  redis: boolean;
  dayKey: string;
  todayAll: number | null;
  ever: number | null;
}> {
  const dayKey = todayDayKey();
  const todayAll = await cacheService.redisSCard(indexKeyTodayAll(dayKey));
  const ever = await cacheService.redisSCard(INDEX_KEY_EVER);
  return {
    redis: todayAll !== null,
    dayKey,
    todayAll,
    ever,
  };
}

/** 从 MinIO 折扣对象 LastModified 重建「今日 / 曾同步」索引 */
export async function rebuildPriceSyncIndexFromObjectStorage(env: Env): Promise<{
  todayAll: number;
  ever: number;
  objects: number;
}> {
  if (!usesS3ObjectStorage(env) || env.discountOffersPersistence !== 'object_storage') {
    throw new Error('需要 DISCOUNT_OFFERS_PERSISTENCE=object_storage 且 S3/MinIO 已配置');
  }
  const rows = await listDiscountOfferObjects(env);
  const tz = dealPriceDayTz();
  const todayKey = calendarDayKey(Date.now(), tz);
  const day = todayKey;

  const todayAll = new Set<string>();
  const todayByCountry = new Map<string, Set<string>>();
  const ever = new Set<string>();
  const byAppidMax = maxLastModifiedByAppid(rows);

  for (const r of rows) {
    ever.add(r.appid);
    if (calendarDayKey(r.lastModifiedMs, tz) !== todayKey) continue;
    todayAll.add(r.appid);
    const cc = r.countryCode.toUpperCase();
    if (!todayByCountry.has(cc)) todayByCountry.set(cc, new Set());
    todayByCountry.get(cc)!.add(r.appid);
  }

  await cacheService.redisReplaceSet(indexKeyTodayAll(day), [...todayAll], DAY_SET_TTL_SEC);
  for (const [cc, set] of todayByCountry.entries()) {
    await cacheService.redisReplaceSet(indexKeyTodayCountry(day, cc), [...set], DAY_SET_TTL_SEC);
  }
  await cacheService.redisReplaceSet(INDEX_KEY_EVER, [...ever], EVER_SET_TTL_SEC);

  logger.info(
    `[price-sync-index] rebuilt from MinIO objects=${rows.length} todayAll=${todayAll.size} ever=${ever.size} appidsWithOffer=${byAppidMax.size}`,
  );

  return { todayAll: todayAll.size, ever: ever.size, objects: rows.length };
}

let rebuildTodayInFlight: Promise<void> | null = null;

/** 今日索引为空时后台从 MinIO 回填一次 */
export function ensureTodayPriceSyncIndex(env: Env): void {
  if (!usesS3ObjectStorage(env) || env.discountOffersPersistence !== 'object_storage') return;
  if (rebuildTodayInFlight) return;
  rebuildTodayInFlight = (async () => {
    try {
      const day = todayDayKey();
      const n = await cacheService.redisSCard(indexKeyTodayAll(day));
      if (n != null && n > 0) return;
      await rebuildPriceSyncIndexFromObjectStorage(env);
    } catch (e) {
      logger.warn(`[price-sync-index] ensureToday: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      rebuildTodayInFlight = null;
    }
  })();
}
