import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { RegionCountryRepository } from '../config/region-country.repository';
import { MarketSyncService } from './market-sync.service';
import type { MarketRoundRobinPayload, MarketDailyFullSyncResult, MarketRoundRobinResult, MarketRoundRobinShardPayload, MarketRoundRobinShardResult, MarketDailyShardedFullSyncResult, MarketShardSyncStatus } from './market.types';
import type { DealSource } from '../game/game-deal-link.repository';
import {
  sqliteEnsureMarketSyncGlobalState,
  sqliteGetMarketSyncGlobalState,
  sqliteSaveMarketSyncGlobalState,
  type MarketSyncGlobalState,
  sqliteEnsureMarketSyncWorkerState,
  sqliteSaveMarketSyncWorkerState,
  sqliteEnsureMarketSyncCountryState,
  sqliteSaveMarketSyncCountryState,
  sqliteResetMarketSyncCountryStates,
  sqliteListMarketSyncWorkerStates,
  type MarketSyncCountryState,
} from '../../storage/sqlite/market-sync-state.store';
import { sqliteCountMarketGamesForCountry } from '../../storage/sqlite/market-games.store';
import { useSqliteRelationalStore } from '../../config/database';
import { writeMarketJson, marketListPath } from '../../cache/market-object-storage';
import { sqliteListMarketGames } from '../../storage/sqlite/market-games.store';
import { fetchRegionalTopSellerAppids } from '../steam/steam-regional-topsellers';
import type { ResolvedCountryForSteam } from '../config/region-country.repository';

import { mapPool } from '../../utils/map-pool';
import { prefetchMarketBatchPrices } from './market-batch-price-prefetch';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { loadRegionCountriesForMarketSync, countryCodesFromMarketSyncList, topNForCountryInSyncList } from '../config/market-sync-tier.service';
import { resolveDiscountCfgForPriceSync } from './market-discount-config.util';
import { runMarketStaleDiscountCleanupAll } from './market-stale-cleanup.service';

const DEFAULT_PLATFORMS: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'];
/** 轮询仅刷价：跳过 CheapShark（每款 2 次 HTTP，批量无收益） */
const BULK_PRICE_PLATFORMS: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals'];
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_BATCH_SIZE = 80;
const DEFAULT_SHARD_WORKER_COUNT = 2;
const DEFAULT_SHARD_CONCURRENCY = 4;

function rrIncludeDetail(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includeDetail === true;
}

function rrIncludeHeat(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includeHeat === true;
}

function rrIncludePrices(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includePrices !== false;
}

async function loadEnabledCountryQueue(syncTierFilter?: 'T1' | 'T2'): Promise<string[]> {
  const { countries } = await loadRegionCountriesForMarketSync(
    syncTierFilter ? { syncTierFilter } : undefined,
  );
  if (countries.length > 0) {
    return countryCodesFromMarketSyncList(countries);
  }
  const repo = new RegionCountryRepository();
  const enabled = await repo.listEnabledPublic();
  if (enabled.length > 0) {
    return enabled
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.countryCode.localeCompare(b.countryCode))
      .map((r) => r.countryCode.toUpperCase());
  }
  return ['US'];
}

function buildShardQueue(fullQueue: string[], workerId: number, workerCount: number): string[] {
  const wc = Math.max(1, workerCount);
  const wid = ((workerId % wc) + wc) % wc;
  return fullQueue.filter((_, i) => i % wc === wid);
}

type RoundRobinOpts = {
  batchSize: number;
  topNPerCountry: number;
  delayMs: number;
  skipSyncedToday: boolean;
  forceRefresh: boolean;
  concurrency: number;
  includeDetail: boolean;
  includeHeat: boolean;
  includePrices: boolean;
  bulkPricesOnly: boolean;
  platforms: DealSource[];
};

function resolveRoundRobinOpts(payload?: MarketRoundRobinPayload): RoundRobinOpts {
  const includeDetail = rrIncludeDetail(payload);
  const includeHeat = rrIncludeHeat(payload);
  const includePrices = rrIncludePrices(payload);
  const bulkPricesOnly = includePrices && !includeDetail && !includeHeat;
  const platforms = (payload?.platforms?.length
    ? payload.platforms
    : bulkPricesOnly
      ? BULK_PRICE_PLATFORMS
      : DEFAULT_PLATFORMS) as DealSource[];
  return {
    batchSize: Math.max(1, Math.min(Number(payload?.batchSize ?? DEFAULT_BATCH_SIZE), 200)),
    topNPerCountry: Math.max(1, Math.min(Number(payload?.topNPerCountry ?? 200), 500)),
    delayMs: Math.max(0, Math.min(Number(payload?.delayMs ?? 0), 3000)),
    skipSyncedToday: payload?.skipSyncedToday !== false,
    forceRefresh: payload?.forceRefresh === true,
    concurrency: Math.max(1, Math.min(Number(payload?.concurrency ?? DEFAULT_CONCURRENCY), 24)),
    includeDetail,
    includeHeat,
    includePrices,
    bulkPricesOnly,
    platforms,
  };
}

async function fallbackHotAppidsFromMarket(countryCode: string, topN: number): Promise<string[]> {
  const cc = countryCode.toUpperCase();
  const { rows } = await sqliteListMarketGames({
    countryCode: cc,
    page: 1,
    pageSize: Math.max(1, Math.min(topN, 500)),
    sortBy: 'heat_desc',
  });
  return rows.map((r) => String(r.appid ?? '').trim()).filter(Boolean);
}

async function ensureGlobalState(): Promise<MarketSyncGlobalState> {
  const queue = await loadEnabledCountryQueue();
  const state = await sqliteEnsureMarketSyncGlobalState(queue);
  if (JSON.stringify(state.countryQueue) !== JSON.stringify(queue)) {
    state.countryQueue = queue;
    if (state.currentCountryIndex >= queue.length) state.currentCountryIndex = 0;
    state.currentCountryCode = queue[state.currentCountryIndex] ?? null;
    await sqliteSaveMarketSyncGlobalState(state);
  }
  return state;
}

/** 从 Steam 区域畅销榜 TopN 按游标取一批 appid（各国列表独立，热度降序） */
function pickAppidBatchFromHotList(
  hotAppids: string[],
  cursorAppid: string,
  batchSize: number,
  alreadyInMarket: number,
  forceRefresh: boolean,
): { appids: string[]; startIdx: number } {
  if (hotAppids.length === 0) return { appids: [], startIdx: 0 };

  const cursor = String(cursorAppid ?? '').trim();
  let startIdx = 0;
  if (cursor) {
    const idx = hotAppids.indexOf(cursor);
    startIdx = idx >= 0 ? idx + 1 : forceRefresh ? 0 : Math.min(alreadyInMarket, hotAppids.length);
  } else if (!forceRefresh && alreadyInMarket > 0) {
    // 该国 TopN 已满：每日从畅销榜头重新刷价，勿用 alreadyInMarket 作起点（否则 startIdx=200 → 空批）
    startIdx = alreadyInMarket >= hotAppids.length ? 0 : Math.min(alreadyInMarket, hotAppids.length);
  }
  return { appids: hotAppids.slice(startIdx, startIdx + batchSize), startIdx };
}

async function ensureCountryHotAppids(
  env: Env,
  state: MarketSyncGlobalState,
  countryCode: string,
  resolved: ResolvedCountryForSteam,
  topN: number,
  refresh: boolean,
): Promise<string[]> {
  const cc = countryCode.toUpperCase();
  if (
    !refresh &&
    state.countryHotForCode === cc &&
    state.countryHotAppids.length >= Math.min(topN, 1)
  ) {
    return state.countryHotAppids.slice(0, topN);
  }
  const t0 = Date.now();
  let appids = await fetchRegionalTopSellerAppids(env, {
    steamCc: resolved.steamCc,
    steamLanguage: resolved.steamLanguage,
    limit: topN,
  });
  if (appids.length === 0) {
    appids = await fallbackHotAppidsFromMarket(cc, topN);
    if (appids.length > 0) {
      logger.warn(`[market-rr] topsellers empty cc=${cc}, fallback market_games n=${appids.length}`);
    }
  }
  state.countryHotAppids = appids;
  state.countryHotForCode = cc;
  logger.info(
    `[market-rr] steam topsellers cc=${cc} steamCc=${resolved.steamCc} n=${appids.length}/${topN} ms=${Date.now() - t0} head=${appids.slice(0, 5).join(',')}`,
  );
  return appids;
}

export async function runMarketCountryRoundRobin(env: Env, payload?: MarketRoundRobinPayload): Promise<MarketRoundRobinResult> {
  if (!useSqliteRelationalStore()) {
    throw new Error('market round-robin requires DATA_STORE=vultr_sqlite');
  }

  const opts = resolveRoundRobinOpts(payload);
  if (opts.includePrices) {
    await resolveDiscountCfgForPriceSync(undefined, new AdminSettingsRepository());
  }
  const {
    batchSize,
    topNPerCountry,
    delayMs,
    skipSyncedToday,
    forceRefresh,
    concurrency,
    includeDetail,
    includeHeat,
    includePrices,
    bulkPricesOnly,
    platforms,
  } = opts;

  let state = await ensureGlobalState();
  const queue = state.countryQueue;
  if (queue.length === 0) {
    throw new Error('no enabled countries for market sync');
  }

  if (payload?.resetQueue === true) {
    state.currentCountryIndex = 0;
    state.currentCountryCode = queue[0] ?? null;
    state.appidCursor = '';
    state.countryHotAppids = [];
    state.countryHotForCode = null;
    await sqliteSaveMarketSyncGlobalState(state);
  }

  const idx = Math.max(0, Math.min(state.currentCountryIndex, queue.length - 1));
  const countryCode = queue[idx]!;
  const regionRepo = new RegionCountryRepository();
  const resolved = await regionRepo.resolveForRegionalDetail(countryCode);

  const alreadyInMarket = await sqliteCountMarketGamesForCountry(countryCode);
  const refreshHotList =
    state.countryHotForCode !== countryCode ||
    state.countryHotAppids.length === 0 ||
    (forceRefresh && !state.appidCursor);
  const hotAppids = await ensureCountryHotAppids(env, state, countryCode, resolved, topNPerCountry, refreshHotList);
  let { appids, startIdx } = pickAppidBatchFromHotList(
    hotAppids,
    state.appidCursor,
    batchSize,
    alreadyInMarket,
    forceRefresh,
  );
  // 游标已到榜末或满编国家无游标：从榜首重新取批
  if (appids.length === 0 && hotAppids.length > 0) {
    state.appidCursor = '';
    ({ appids, startIdx } = pickAppidBatchFromHotList(hotAppids, '', batchSize, 0, forceRefresh));
    logger.info(`[market-rr] cursor wrap cc=${countryCode} restart head n=${appids.length}`);
  }
  const hotRankByAppid = new Map<string, number>();
  appids.forEach((id, i) => hotRankByAppid.set(id, startIdx + i));

  const settingsRepo = new AdminSettingsRepository();
  const discountCfg = bulkPricesOnly ? await settingsRepo.getDiscountProviders() : undefined;
  const pc = bulkPricesOnly ? await regionRepo.resolveDealProviderCodes(countryCode) : undefined;

  let batchPrefetch: Awaited<ReturnType<typeof prefetchMarketBatchPrices>> | undefined;
  if (bulkPricesOnly && appids.length > 0 && discountCfg && pc) {
    const t0 = Date.now();
    batchPrefetch = await prefetchMarketBatchPrices({
      env,
      appids,
      pc,
      resolved,
      platforms,
      itadApiKey: discountCfg.itadApiKey,
      ggDealsApiKey: discountCfg.ggDealsApiKey,
      itadBaseUrl: discountCfg.itadBaseUrl,
      ggDealsBaseUrl: discountCfg.ggDealsBaseUrl,
    });
    logger.info(
      `[market-rr] prefetch cc=${countryCode} n=${appids.length} steam=${batchPrefetch.steamByAppid.size} itad=${batchPrefetch.itadByAppid.size} gg=${batchPrefetch.ggByAppid.size} ms=${Date.now() - t0}`,
    );
  }

  const sync = new MarketSyncService(env);
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let infraError = false;

  const syncOptsBase = {
    includeDetail,
    includeHeat,
    includePrices,
    platforms,
    forceRefresh,
    skipIfSyncedToday: skipSyncedToday,
    bulkPricesOnly,
    delayMs: 0,
    resolvedCountry: resolved,
    discountCfg,
  };

  const outcomes = await mapPool(appids, concurrency, async (appid) => {
    try {
      const r = await sync.syncGameMarket(countryCode, appid, {
        ...syncOptsBase,
        batchPricePrefetch: batchPrefetch,
        regionalHotRank: hotRankByAppid.get(appid),
        regionalHotTopN: topNPerCountry,
      });
      return { appid, ok: true as const, r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/SQLite API|Object storage|SQLITE_API/i.test(msg)) infraError = true;
      logger.warn(`[market-rr] sync failed appid=${appid} cc=${countryCode} err=${msg}`);
      return { appid, ok: false as const, err: msg };
    }
  });

  for (const o of outcomes) {
    if (!o.ok) {
      failed++;
      continue;
    }
    if (o.r.skipped) skipped++;
    else if (o.r.ok) success++;
    else failed++;
  }

  if (batchPrefetch && bulkPricesOnly && !infraError) {
    const steamMiss = appids.filter((id) => {
      const offer = batchPrefetch!.steamByAppid.get(id);
      return !offer?.url;
    });
    if (steamMiss.length > 0) {
      logger.info(`[market-rr] steam retry cc=${countryCode} n=${steamMiss.length}`);
      const retryOutcomes = await mapPool(steamMiss, 2, async (appid) => {
        try {
          const r = await sync.syncGameMarket(countryCode, appid, {
            ...syncOptsBase,
            batchPricePrefetch: undefined,
            regionalHotRank: hotRankByAppid.get(appid),
            regionalHotTopN: topNPerCountry,
          });
          return { appid, ok: true as const, r };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[market-rr] steam retry failed appid=${appid} cc=${countryCode} err=${msg}`);
          return { appid, ok: false as const };
        }
      });
      for (const o of retryOutcomes) {
        if (!o.ok) continue;
        if (o.r.skipped) continue;
        if (o.r.ok && o.r.pricesOk) success++;
      }
    }
  }

  if (delayMs > 0 && concurrency > 1) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const lastAppid = appids.length > 0 ? appids[appids.length - 1]! : state.appidCursor;
  let countryCompleted = false;
  let nextCountryCode: string | null = countryCode;

  if (!infraError) {
    const batchShort = appids.length < batchSize;
    const reachedTopN =
      appids.length > 0 && (forceRefresh ? batchShort : batchShort || startIdx + appids.length >= hotAppids.length);
    if (reachedTopN) {
      countryCompleted = true;
      const nextIdx = (idx + 1) % queue.length;
      state.currentCountryIndex = nextIdx;
      state.currentCountryCode = queue[nextIdx] ?? null;
      state.appidCursor = '';
      state.countryHotAppids = [];
      state.countryHotForCode = null;
      nextCountryCode = state.currentCountryCode;
    } else {
      state.appidCursor = lastAppid;
      state.currentCountryCode = countryCode;
    }
    state.lastRunAtMs = Date.now();
    state.lastRunSummary = `轮询 ${countryCode} · Steam畅销榜 · 本批 ${appids.length} · 并发 ${concurrency} · 成功 ${success} 失败 ${failed} 跳过 ${skipped} · 仅价=${bulkPricesOnly}${bulkPricesOnly ? '(无CS)' : ''} · 预取=${!!batchPrefetch} · 货币 ${resolved.defaultCurrency}`;
    await sqliteSaveMarketSyncGlobalState(state);
  }

  const summary = infraError
    ? `轮询 ${countryCode} · 基础设施错误，游标未推进 · 失败 ${failed}`
    : `${state.lastRunSummary ?? ''}${countryCompleted ? ` · 下一国 ${nextCountryCode ?? '—'}` : ` · 下一起点 ${lastAppid}`}`;

  logger.info(`[market-rr] ${summary}`);

  return {
    countryCode,
    currency: resolved.defaultCurrency,
    currencySymbol: resolved.currencySymbol,
    batchSize,
    topNPerCountry,
    processed: appids.length,
    success,
    failed,
    skipped,
    nextAppidCursor: state.appidCursor,
    countryCompleted,
    nextCountryCode,
    summary,
  };
}

export async function buildMarketListsForCountry(env: Env, countryCode: string): Promise<string[]> {
  const cc = countryCode.toUpperCase();
  const keys: string[] = [];
  const now = new Date().toISOString();

  const topDiscount = await sqliteListMarketGames({
    countryCode: cc,
    page: 1,
    pageSize: 100,
    sortBy: 'discount_desc',
  });
  const pathDisc = marketListPath(cc, 'top-discounts');
  await writeMarketJson(env, pathDisc, { generatedAt: now, countryCode: cc, items: topDiscount.rows });
  keys.push(pathDisc);

  const topHeat = await sqliteListMarketGames({
    countryCode: cc,
    page: 1,
    pageSize: 200,
    sortBy: 'heat_desc',
  });
  const pathHeat = marketListPath(cc, 'top-heat');
  await writeMarketJson(env, pathHeat, { generatedAt: now, countryCode: cc, items: topHeat.rows });
  keys.push(pathHeat);

  return keys;
}

/**
 * 每日全量：4 worker 分片并行刷完各国 Steam 畅销榜 TopN 价格。
 * @deprecated 内部仍保留单进程串行路径；默认走分片并行。
 */
export async function runMarketDailyFullSync(
  env: Env,
  payload?: MarketRoundRobinPayload & { workerCount?: number; useLegacySerial?: boolean },
): Promise<MarketDailyFullSyncResult> {
  if (payload?.useLegacySerial === true) {
    return runMarketDailyFullSyncLegacy(env, payload);
  }
  const sharded = await runMarketDailyShardedFullSync(env, payload);
  return {
    countries: sharded.countries,
    countriesCompleted: sharded.countriesCompleted,
    batches: sharded.batches,
    totalProcessed: sharded.totalProcessed,
    totalSuccess: sharded.totalSuccess,
    totalFailed: sharded.totalFailed,
    totalSkipped: sharded.totalSkipped,
    cleanup: sharded.cleanup,
    summary: sharded.summary,
  };
}

/** 旧版单进程串行每日全量（仅 useLegacySerial 时调用） */
async function runMarketDailyFullSyncLegacy(
  env: Env,
  payload?: MarketRoundRobinPayload,
): Promise<MarketDailyFullSyncResult> {
  const queue = await loadEnabledCountryQueue();
  if (queue.length === 0) {
    throw new Error('no enabled countries for market daily sync');
  }

  const topN = Math.max(1, Math.min(Number(payload?.topNPerCountry ?? 200), 500));
  const batchSize = Math.max(1, Math.min(Number(payload?.batchSize ?? 80), 200));
  const maxBatchesPerCountry = Math.ceil(topN / batchSize) + 2;
  const syncPayload: MarketRoundRobinPayload = {
    topNPerCountry: topN,
    batchSize,
    delayMs: Math.max(0, Math.min(Number(payload?.delayMs ?? 0), 3000)),
    skipSyncedToday: false,
    forceRefresh: false,
    includeDetail: false,
    includeHeat: false,
    includePrices: true,
    concurrency: Math.max(1, Math.min(Number(payload?.concurrency ?? 10), 24)),
    platforms: ['steam', 'isthereanydeal', 'ggdeals'],
  };

  let cleanup: MarketDailyFullSyncResult['cleanup'];
  const doCleanup = payload?.cleanupBeforeSync !== false;
  if (doCleanup && env.discountOffersPersistence === 'object_storage') {
    cleanup = await runMarketStaleDiscountCleanupAll(env, {
      cutoffMode: 'before_today',
      maxRows: Math.max(500, Math.min(Number(payload?.cleanupMaxRows ?? 5000), 5000)),
      maxBatches: Math.max(1, Math.min(Number(payload?.cleanupMaxBatches ?? 30), 100)),
      staleOlderThanHours: Number(payload?.cleanupStaleOlderThanHours ?? 72),
    });
    logger.info(
      `[market-daily] cleanup before sync 清索引=${cleanup.clearedIndex} 清对象=${cleanup.clearedObjects}`,
    );
  }

  let countriesCompleted = 0;
  let batches = 0;
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const maxIterations = queue.length * maxBatchesPerCountry + 4;
  let resetOnce = true;

  logger.info(
    `[market-daily] start countries=${queue.length} topN=${topN} batch=${batchSize} platforms=steam,itad,gg`,
  );

  for (let i = 0; i < maxIterations && countriesCompleted < queue.length; i++) {
    const r = await runMarketCountryRoundRobin(env, {
      ...syncPayload,
      resetQueue: resetOnce,
    });
    resetOnce = false;
    batches += 1;
    totalProcessed += r.processed;
    totalSuccess += r.success;
    totalFailed += r.failed;
    totalSkipped += r.skipped;
    if (r.countryCompleted) countriesCompleted += 1;
    logger.info(`[market-daily] batch ${batches} ${r.summary}`);
    if (r.processed === 0 && r.failed > 0) break;
    if (r.processed === 0 && !r.countryCompleted) {
      logger.warn(`[market-daily] stall cc=${r.countryCode} advancing`);
      countriesCompleted += 1;
    }
  }

  const cleanupPart = cleanup
    ? ` · 清理旧折扣 索引${cleanup.clearedIndex} 对象${cleanup.clearedObjects}`
    : '';
  const summary = `每日全量 ${countriesCompleted}/${queue.length} 国 · Top${topN} · Steam原价+Steam/ITAD/GG · 批次数 ${batches} · 处理 ${totalProcessed} 成功 ${totalSuccess} 失败 ${totalFailed} 跳过 ${totalSkipped}${cleanupPart}`;
  logger.info(`[market-daily] ${summary}`);

  return {
    countries: queue.length,
    countriesCompleted,
    batches,
    totalProcessed,
    totalSuccess,
    totalFailed,
    totalSkipped,
    cleanup,
    summary,
  };
}

export async function runMarketBuildAllLists(env: Env): Promise<{ countries: number; keys: string[] }> {
  const queue = await loadEnabledCountryQueue();
  const keys: string[] = [];
  for (const cc of queue) {
    try {
      const k = await buildMarketListsForCountry(env, cc);
      keys.push(...k);
    } catch (e) {
      logger.warn(`[market-lists] cc=${cc} err=${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { countries: queue.length, keys };
}

export async function getMarketRoundRobinStatus(): Promise<MarketSyncGlobalState | null> {
  return sqliteGetMarketSyncGlobalState();
}

async function ensureCountryHotAppidsForShard(
  env: Env,
  countryState: MarketSyncCountryState,
  resolved: ResolvedCountryForSteam,
  topN: number,
  refresh: boolean,
): Promise<string[]> {
  const cc = countryState.countryCode.toUpperCase();
  if (!refresh && countryState.countryHotAppids.length >= Math.min(topN, 1)) {
    return countryState.countryHotAppids.slice(0, topN);
  }
  const t0 = Date.now();
  let appids = await fetchRegionalTopSellerAppids(env, {
    steamCc: resolved.steamCc,
    steamLanguage: resolved.steamLanguage,
    limit: topN,
  });
  if (appids.length === 0) {
    appids = await fallbackHotAppidsFromMarket(cc, topN);
    if (appids.length > 0) {
      logger.warn(`[market-shard] topsellers empty cc=${cc}, fallback market_games n=${appids.length}`);
    }
  }
  countryState.countryHotAppids = appids;
  logger.info(
    `[market-shard] steam topsellers cc=${cc} steamCc=${resolved.steamCc} n=${appids.length}/${topN} ms=${Date.now() - t0} head=${appids.slice(0, 5).join(',')}`,
  );
  return appids;
}

/** 分片轮询：每个 worker 独立处理 queue[index % workerCount === workerId] 的国家 */
export async function runMarketCountryRoundRobinShard(
  env: Env,
  payload: MarketRoundRobinShardPayload,
): Promise<MarketRoundRobinShardResult> {
  if (!useSqliteRelationalStore()) {
    throw new Error('market shard round-robin requires DATA_STORE=vultr_sqlite');
  }

  const workerCount = Math.max(1, Math.min(Number(payload.workerCount ?? DEFAULT_SHARD_WORKER_COUNT), 16));
  const workerId = ((Number(payload.workerId) % workerCount) + workerCount) % workerCount;
  const shardPayload: MarketRoundRobinPayload = { ...payload };
  if (payload.concurrency == null && shardPayload.concurrency == null) {
    shardPayload.concurrency = DEFAULT_SHARD_CONCURRENCY;
  }
  const opts = resolveRoundRobinOpts(shardPayload);
  if (opts.includePrices) {
    await resolveDiscountCfgForPriceSync(undefined, new AdminSettingsRepository());
  }
  const {
    batchSize,
    delayMs,
    skipSyncedToday,
    forceRefresh,
    concurrency,
    includeDetail,
    includeHeat,
    includePrices,
    bulkPricesOnly,
    platforms,
  } = opts;

  const { settings: tierSettings, countries: syncCountries } = await loadRegionCountriesForMarketSync(
    payload.syncTierFilter ? { syncTierFilter: payload.syncTierFilter } : undefined,
  );
  const fullQueue = countryCodesFromMarketSyncList(syncCountries);
  if (fullQueue.length === 0) {
    throw new Error('no enabled countries for market shard sync');
  }
  const shardQueue = buildShardQueue(fullQueue, workerId, workerCount);
  if (shardQueue.length === 0) {
    throw new Error(`worker ${workerId}/${workerCount} has no countries in shard`);
  }

  let workerState = await sqliteEnsureMarketSyncWorkerState(workerId, workerCount, shardQueue);

  if (payload.resetShard === true) {
    workerState.currentShardIndex = 0;
    await sqliteResetMarketSyncCountryStates(shardQueue);
    await sqliteSaveMarketSyncWorkerState(workerState);
  }

  const shardIdx = Math.max(0, Math.min(workerState.currentShardIndex, shardQueue.length - 1));
  const countryCode = shardQueue[shardIdx]!;
  const useTierTopN = payload.ignoreSyncTier !== true;
  const topNPerCountry = useTierTopN
    ? topNForCountryInSyncList(syncCountries, countryCode, tierSettings.t2TopNPerCountry)
    : opts.topNPerCountry;
  const regionRepo = new RegionCountryRepository();
  const resolved = await regionRepo.resolveForRegionalDetail(countryCode);

  let countryState = await sqliteEnsureMarketSyncCountryState(countryCode);
  const alreadyInMarket = await sqliteCountMarketGamesForCountry(countryCode);
  const refreshHotList =
    countryState.countryHotAppids.length === 0 || (forceRefresh && !countryState.appidCursor);
  const hotAppids = await ensureCountryHotAppidsForShard(
    env,
    countryState,
    resolved,
    topNPerCountry,
    refreshHotList,
  );

  let { appids, startIdx } = pickAppidBatchFromHotList(
    hotAppids,
    countryState.appidCursor,
    batchSize,
    alreadyInMarket,
    forceRefresh,
  );
  if (appids.length === 0 && hotAppids.length > 0) {
    countryState.appidCursor = '';
    ({ appids, startIdx } = pickAppidBatchFromHotList(hotAppids, '', batchSize, 0, forceRefresh));
    logger.info(`[market-shard] cursor wrap worker=${workerId} cc=${countryCode} restart head n=${appids.length}`);
  }

  const hotRankByAppid = new Map<string, number>();
  appids.forEach((id, i) => hotRankByAppid.set(id, startIdx + i));

  const settingsRepo = new AdminSettingsRepository();
  const discountCfg = bulkPricesOnly ? await settingsRepo.getDiscountProviders() : undefined;
  const pc = bulkPricesOnly ? await regionRepo.resolveDealProviderCodes(countryCode) : undefined;

  let batchPrefetch: Awaited<ReturnType<typeof prefetchMarketBatchPrices>> | undefined;
  if (bulkPricesOnly && appids.length > 0 && discountCfg && pc) {
    const t0 = Date.now();
    batchPrefetch = await prefetchMarketBatchPrices({
      env,
      appids,
      pc,
      resolved,
      platforms,
      itadApiKey: discountCfg.itadApiKey,
      ggDealsApiKey: discountCfg.ggDealsApiKey,
      itadBaseUrl: discountCfg.itadBaseUrl,
      ggDealsBaseUrl: discountCfg.ggDealsBaseUrl,
    });
    logger.info(
      `[market-shard] prefetch worker=${workerId} cc=${countryCode} n=${appids.length} steam=${batchPrefetch.steamByAppid.size} itad=${batchPrefetch.itadByAppid.size} gg=${batchPrefetch.ggByAppid.size} ms=${Date.now() - t0}`,
    );
  }

  const sync = new MarketSyncService(env);
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let infraError = false;

  const syncOptsBase = {
    includeDetail,
    includeHeat,
    includePrices,
    platforms,
    forceRefresh,
    skipIfSyncedToday: skipSyncedToday,
    bulkPricesOnly,
    delayMs: 0,
    resolvedCountry: resolved,
    discountCfg,
  };

  const outcomes = await mapPool(appids, concurrency, async (appid) => {
    try {
      const r = await sync.syncGameMarket(countryCode, appid, {
        ...syncOptsBase,
        batchPricePrefetch: batchPrefetch,
        regionalHotRank: hotRankByAppid.get(appid),
        regionalHotTopN: topNPerCountry,
      });
      return { appid, ok: true as const, r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/SQLite API|Object storage|SQLITE_API/i.test(msg)) infraError = true;
      logger.warn(`[market-shard] sync failed worker=${workerId} appid=${appid} cc=${countryCode} err=${msg}`);
      return { appid, ok: false as const, err: msg };
    }
  });

  for (const o of outcomes) {
    if (!o.ok) {
      failed++;
      continue;
    }
    if (o.r.skipped) skipped++;
    else if (o.r.ok) success++;
    else failed++;
  }

  if (batchPrefetch && bulkPricesOnly && !infraError) {
    const steamMiss = appids.filter((id) => {
      const offer = batchPrefetch!.steamByAppid.get(id);
      return !offer?.url;
    });
    if (steamMiss.length > 0) {
      logger.info(`[market-shard] steam retry worker=${workerId} cc=${countryCode} n=${steamMiss.length}`);
      const retryOutcomes = await mapPool(steamMiss, 2, async (appid) => {
        try {
          const r = await sync.syncGameMarket(countryCode, appid, {
            ...syncOptsBase,
            batchPricePrefetch: undefined,
            regionalHotRank: hotRankByAppid.get(appid),
            regionalHotTopN: topNPerCountry,
          });
          return { appid, ok: true as const, r };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[market-shard] steam retry failed worker=${workerId} appid=${appid} cc=${countryCode} err=${msg}`);
          return { appid, ok: false as const };
        }
      });
      for (const o of retryOutcomes) {
        if (!o.ok) continue;
        if (o.r.skipped) continue;
        if (o.r.ok && o.r.pricesOk) success++;
      }
    }
  }

  if (delayMs > 0 && concurrency > 1) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const lastAppid = appids.length > 0 ? appids[appids.length - 1]! : countryState.appidCursor;
  let countryCompleted = false;
  let nextCountryCode: string | null = countryCode;

  if (!infraError) {
    const batchShort = appids.length < batchSize;
    const reachedTopN =
      appids.length > 0 && (forceRefresh ? batchShort : batchShort || startIdx + appids.length >= hotAppids.length);
    if (reachedTopN) {
      countryCompleted = true;
      const nextIdx = (shardIdx + 1) % shardQueue.length;
      workerState.currentShardIndex = nextIdx;
      nextCountryCode = shardQueue[nextIdx] ?? null;
      countryState.appidCursor = '';
      countryState.countryHotAppids = [];
    } else {
      countryState.appidCursor = lastAppid;
      nextCountryCode = countryCode;
    }
    const runSummary = `分片 W${workerId}/${workerCount} ${countryCode} · 本批 ${appids.length} · 并发 ${concurrency} · 成功 ${success} 失败 ${failed} 跳过 ${skipped} · 仅价=${bulkPricesOnly}${bulkPricesOnly ? '(无CS)' : ''} · 预取=${!!batchPrefetch} · 货币 ${resolved.defaultCurrency}`;
    countryState.lastRunAtMs = Date.now();
    countryState.lastRunSummary = runSummary;
    workerState.lastRunAtMs = Date.now();
    workerState.lastRunSummary = runSummary + (countryCompleted ? ` · 下一国 ${nextCountryCode ?? '—'}` : ` · 下一起点 ${lastAppid}`);
    await sqliteSaveMarketSyncCountryState(countryState);
    await sqliteSaveMarketSyncWorkerState(workerState);
  }

  const summary = infraError
    ? `分片 W${workerId}/${workerCount} ${countryCode} · 基础设施错误，游标未推进 · 失败 ${failed}`
    : workerState.lastRunSummary ?? '';

  logger.info(`[market-shard] ${summary}`);

  return {
    workerId,
    workerCount,
    shardIndex: workerState.currentShardIndex,
    shardCountries: shardQueue,
    countryCode,
    currency: resolved.defaultCurrency,
    currencySymbol: resolved.currencySymbol,
    batchSize,
    topNPerCountry,
    processed: appids.length,
    success,
    failed,
    skipped,
    nextAppidCursor: countryState.appidCursor,
    countryCompleted,
    nextCountryCode,
    summary,
  };
}

async function runMarketShardWorkerLoop(
  env: Env,
  workerId: number,
  workerCount: number,
  payload: MarketRoundRobinPayload,
  maxBatches: number,
  resetOnce: boolean,
): Promise<{
  workerId: number;
  countriesCompleted: number;
  batches: number;
  totalProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
}> {
  let countriesCompleted = 0;
  let batches = 0;
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let resetShard = resetOnce;

  for (let i = 0; i < maxBatches; i++) {
    const r = await runMarketCountryRoundRobinShard(env, {
      ...payload,
      workerId,
      workerCount,
      resetShard,
    });
    resetShard = false;
    batches += 1;
    totalProcessed += r.processed;
    totalSuccess += r.success;
    totalFailed += r.failed;
    totalSkipped += r.skipped;
    if (r.countryCompleted) countriesCompleted += 1;
    logger.info(`[market-shard-loop] W${workerId} batch ${batches} ${r.summary}`);
    if (r.processed === 0 && r.failed > 0) break;
    if (r.processed === 0 && !r.countryCompleted) {
      logger.warn(`[market-shard-loop] W${workerId} stall cc=${r.countryCode} advancing`);
      countriesCompleted += 1;
    }
    const shardQueue = r.shardCountries;
    if (countriesCompleted >= shardQueue.length) break;
  }

  return {
    workerId,
    countriesCompleted,
    batches,
    totalProcessed,
    totalSuccess,
    totalFailed,
    totalSkipped,
  };
}

/** 4 worker 并行刷完各国 TopN（方案 B；TopN 按 T1/T2 分层配置） */
export async function runMarketDailyShardedFullSync(
  env: Env,
  payload?: MarketRoundRobinPayload & { workerCount?: number },
): Promise<MarketDailyShardedFullSyncResult> {
  const tierFilter = payload?.syncTierFilter;
  await resolveDiscountCfgForPriceSync(undefined, new AdminSettingsRepository());
  const { settings: tierSettings, countries: syncCountries } = await loadRegionCountriesForMarketSync(
    tierFilter ? { syncTierFilter: tierFilter } : undefined,
  );
  const queue = countryCodesFromMarketSyncList(syncCountries);
  if (queue.length === 0) {
    const skipMsg =
      payload?.syncTierFilter === 'T2'
        ? 'T2 今日非同步日，已跳过'
        : '无可用国家，已跳过';
    logger.info(`[market-daily-shard] ${skipMsg}`);
    return {
      countries: 0,
      countriesCompleted: 0,
      batches: 0,
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkipped: 0,
      summary: skipMsg,
      workerCount: 0,
      workers: [],
    };
  }

  const workerCount = Math.max(1, Math.min(Number(payload?.workerCount ?? DEFAULT_SHARD_WORKER_COUNT), 16));
  const batchSize = Math.max(1, Math.min(Number(payload?.batchSize ?? 100), 200));
  const syncPayload: MarketRoundRobinPayload = {
    batchSize,
    delayMs: Math.max(0, Math.min(Number(payload?.delayMs ?? 0), 3000)),
    skipSyncedToday: false,
    forceRefresh: payload?.forceRefresh === true,
    includeDetail: false,
    includeHeat: false,
    includePrices: true,
    concurrency: Math.max(1, Math.min(Number(payload?.concurrency ?? DEFAULT_SHARD_CONCURRENCY), 24)),
    platforms: ['steam', 'isthereanydeal', 'ggdeals'],
    syncTierFilter: payload?.syncTierFilter,
    cleanupBeforeSync: payload?.cleanupBeforeSync,
  };
  const maxTopN = syncCountries.reduce((m, c) => Math.max(m, c.topNPerCountry), tierSettings.t1TopNPerCountry);

  let cleanup: MarketDailyFullSyncResult['cleanup'];
  const doCleanup = payload?.cleanupBeforeSync !== false;
  if (doCleanup && env.discountOffersPersistence === 'object_storage') {
    cleanup = await runMarketStaleDiscountCleanupAll(env, {
      cutoffMode: 'before_today',
      maxRows: Math.max(500, Math.min(Number(payload?.cleanupMaxRows ?? 5000), 5000)),
      maxBatches: Math.max(1, Math.min(Number(payload?.cleanupMaxBatches ?? 30), 100)),
      staleOlderThanHours: Number(payload?.cleanupStaleOlderThanHours ?? 72),
    });
    logger.info(
      `[market-daily-shard] cleanup before sync 清索引=${cleanup.clearedIndex} 清对象=${cleanup.clearedObjects}`,
    );
  }

  const maxBatchesPerCountry = Math.ceil(maxTopN / batchSize) + 2;
  const maxBatchesPerWorker = Math.ceil((queue.length / workerCount) * maxBatchesPerCountry) + 4;

  logger.info(
    `[market-daily-shard] start workers=${workerCount} countries=${queue.length} tiered maxTopN=${maxTopN} batch=${batchSize} concurrency=${syncPayload.concurrency}`,
  );

  const workerResults = await Promise.all(
    Array.from({ length: workerCount }, (_, workerId) =>
      runMarketShardWorkerLoop(env, workerId, workerCount, syncPayload, maxBatchesPerWorker, true),
    ),
  );

  let batches = 0;
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let countriesCompleted = 0;
  for (const w of workerResults) {
    batches += w.batches;
    totalProcessed += w.totalProcessed;
    totalSuccess += w.totalSuccess;
    totalFailed += w.totalFailed;
    totalSkipped += w.totalSkipped;
    countriesCompleted += w.countriesCompleted;
  }

  const cleanupPart = cleanup
    ? ` · 清理旧折扣 索引${cleanup.clearedIndex} 对象${cleanup.clearedObjects}`
    : '';
  const summary = `分片每日全量 ${workerCount} worker · ${countriesCompleted}/${queue.length} 国（分层） · 批次数 ${batches} · 处理 ${totalProcessed} 成功 ${totalSuccess} 失败 ${totalFailed} 跳过 ${totalSkipped}${cleanupPart}`;
  logger.info(`[market-daily-shard] ${summary}`);

  return {
    countries: queue.length,
    countriesCompleted,
    batches,
    totalProcessed,
    totalSuccess,
    totalFailed,
    totalSkipped,
    cleanup,
    workerCount,
    workers: workerResults,
    summary,
  };
}

export async function getMarketShardSyncStatus(workerCount = DEFAULT_SHARD_WORKER_COUNT): Promise<MarketShardSyncStatus> {
  const fullQueue = await loadEnabledCountryQueue();
  const wc = Math.max(1, Math.min(workerCount, 16));
  const stored = await sqliteListMarketSyncWorkerStates(wc);
  const byId = new Map(stored.map((w) => [w.workerId, w]));
  const workers = Array.from({ length: wc }, (_, workerId) => {
    const shardQueue = buildShardQueue(fullQueue, workerId, wc);
    const w = byId.get(workerId);
    return {
      workerId,
      workerCount: wc,
      currentShardIndex: w?.currentShardIndex ?? 0,
      shardQueue: w?.shardQueue.length ? w.shardQueue : shardQueue,
      shardSize: shardQueue.length,
      lastRunAtMs: w?.lastRunAtMs ?? null,
      lastRunSummary: w?.lastRunSummary ?? null,
    };
  });
  return { workerCount: wc, fullQueue, workers };
}
