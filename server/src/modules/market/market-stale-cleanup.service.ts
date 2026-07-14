import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { sqlAll, sqlRun } from '../../storage/sqlite/sql-client';
import { nowMs } from '../../storage/sqlite/timestamp';
import { readMarketJson, writeMarketJson } from '../../cache/market-object-storage';
import type { MarketPricesDoc } from '../market/market.types';
import type { MarketStaleDiscountCleanupResult } from '../market/market.types';
import type { GameCountryPriceBucket } from '../game/game-catalog.repository';

export type MarketStaleCleanupOpts = {
  maxRows?: number;
  staleOlderThanHours?: number;
  rewriteObjects?: boolean;
  /** stale_hours：按小时阈值；before_today：清理今日 0 点前未更新的折扣（每日全量同步用） */
  cutoffMode?: 'stale_hours' | 'before_today';
  maxBatches?: number;
};

function dayStartMs(timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayKey = fmt.format(new Date());
  return new Date(`${dayKey}T12:00:00Z`).getTime() - 12 * 3600_000;
}

function bucketHasActiveDiscount(bucket: GameCountryPriceBucket | null | undefined): boolean {
  if (!bucket) return false;
  const parts = [bucket.steam, bucket.isthereanydeal, bucket.ggdeals, bucket.cheapshark];
  return parts.some((p) => {
    if (!p || (p.offerStatus ?? 'active') === 'invalid') return false;
    return (p.discountPercent ?? 0) > 0;
  });
}

function stripExpiredDiscountFromBucket(bucket: GameCountryPriceBucket): GameCountryPriceBucket {
  const strip = (snap: GameCountryPriceBucket['steam']) => {
    if (!snap) return snap;
    if ((snap.offerStatus ?? 'active') === 'invalid') return undefined;
    if ((snap.discountPercent ?? 0) <= 0) return snap;
    return { ...snap, discountPercent: 0, offerStatus: 'stale' as const };
  };
  return {
    ...bucket,
    steam: strip(bucket.steam),
    isthereanydeal: strip(bucket.isthereanydeal),
    ggdeals: strip(bucket.ggdeals),
    cheapshark: strip(bucket.cheapshark),
  };
}

/**
 * 清理「价格未在有效期内更新但仍显示折扣」的 market 索引与 MinIO prices.json。
 * 典型场景：促销结束但轮询未覆盖到该国该款，榜单仍显示旧折扣。
 */
export async function runMarketStaleDiscountCleanup(
  env: Env,
  opts?: MarketStaleCleanupOpts,
): Promise<MarketStaleDiscountCleanupResult> {
  const tz = String(process.env.DEAL_SYNC_PRICE_DAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const maxRows = Math.max(1, Math.min(Number(opts?.maxRows ?? 1500), 5000));
  const staleHours = Math.max(1, Math.min(Number(opts?.staleOlderThanHours ?? 24), 168));
  const cutoffMode = opts?.cutoffMode ?? 'stale_hours';
  const cutoffMs =
    cutoffMode === 'before_today'
      ? dayStartMs(tz)
      : Math.min(dayStartMs(tz), Date.now() - staleHours * 3600_000);
  const rewriteObjects = opts?.rewriteObjects !== false;

  const rows = await sqlAll<{
    country_code: string;
    appid: string;
    prices_json_path: string | null;
    discount_percent: number;
    price_synced_at_ms: number | null;
  }>(
    `SELECT country_code, appid, prices_json_path, discount_percent, price_synced_at_ms
     FROM market_games
     WHERE discount_percent > 0
       AND (price_synced_at_ms IS NULL OR price_synced_at_ms < ?)
     ORDER BY price_synced_at_ms ASC
     LIMIT ?`,
    [cutoffMs, maxRows],
  );

  let clearedIndex = 0;
  let clearedObjects = 0;
  let skipped = 0;
  const now = nowMs();

  for (const r of rows) {
    const cc = r.country_code.toUpperCase();
    const appid = String(r.appid);
    const path = String(r.prices_json_path ?? '').trim();

    if (rewriteObjects && path) {
      try {
        const doc = await readMarketJson<MarketPricesDoc>(env, path);
        if (doc?.bucket && bucketHasActiveDiscount(doc.bucket)) {
          const bucket = stripExpiredDiscountFromBucket(doc.bucket);
          await writeMarketJson(env, path, {
            ...doc,
            bucket,
            syncedAt: new Date().toISOString(),
          });
          clearedObjects += 1;
        }
      } catch (e) {
        logger.warn(
          `[market-stale-cleanup] object cc=${cc} appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
        );
        skipped += 1;
      }
    }

    await sqlRun(
      `UPDATE market_games SET
        discount_percent = 0,
        final_price = NULL,
        data_json = json_set(COALESCE(NULLIF(data_json,''), '{}'), '$.priceSummary.discountPercent', 0),
        updated_at_ms = ?
       WHERE country_code = ? AND appid = ?`,
      [now, cc, appid],
    );
    clearedIndex += 1;
  }

  const summary = `market 失效折扣清理 mode=${cutoffMode} cutoff=${new Date(cutoffMs).toISOString()} 扫描=${rows.length} 清索引=${clearedIndex} 清对象=${clearedObjects} 跳过=${skipped}`;
  logger.info(`[market-stale-cleanup] ${summary}`);

  return { scanned: rows.length, clearedIndex, clearedObjects, skipped };
}

/** 分批清理直至无更多行或达到 maxBatches */
export async function runMarketStaleDiscountCleanupAll(
  env: Env,
  opts?: MarketStaleCleanupOpts,
): Promise<MarketStaleDiscountCleanupResult> {
  const maxBatches = Math.max(1, Math.min(Number(opts?.maxBatches ?? 20), 100));
  const batchSize = Math.max(1, Math.min(Number(opts?.maxRows ?? 5000), 5000));
  let total: MarketStaleDiscountCleanupResult = { scanned: 0, clearedIndex: 0, clearedObjects: 0, skipped: 0 };

  for (let i = 0; i < maxBatches; i++) {
    const r = await runMarketStaleDiscountCleanup(env, { ...opts, maxRows: batchSize });
    total = {
      scanned: total.scanned + r.scanned,
      clearedIndex: total.clearedIndex + r.clearedIndex,
      clearedObjects: total.clearedObjects + r.clearedObjects,
      skipped: total.skipped + r.skipped,
    };
    if (r.scanned < batchSize) break;
  }

  logger.info(
    `[market-stale-cleanup] all done 扫描=${total.scanned} 清索引=${total.clearedIndex} 清对象=${total.clearedObjects} 跳过=${total.skipped}`,
  );
  return total;
}
