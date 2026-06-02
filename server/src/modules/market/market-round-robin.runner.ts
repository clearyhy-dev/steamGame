import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { RegionCountryRepository } from '../config/region-country.repository';
import { MarketSyncService } from './market-sync.service';
import type { MarketRoundRobinPayload, MarketRoundRobinResult } from './market.types';
import type { DealSource } from '../game/game-deal-link.repository';
import {
  sqliteEnsureMarketSyncGlobalState,
  sqliteGetMarketSyncGlobalState,
  sqliteSaveMarketSyncGlobalState,
  type MarketSyncGlobalState,
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

const DEFAULT_PLATFORMS: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'];
/** 轮询仅刷价：跳过 CheapShark（每款 2 次 HTTP，批量无收益） */
const BULK_PRICE_PLATFORMS: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals'];
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_BATCH_SIZE = 80;

function rrIncludeDetail(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includeDetail === true;
}

function rrIncludeHeat(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includeHeat === true;
}

function rrIncludePrices(payload?: MarketRoundRobinPayload): boolean {
  return payload?.includePrices !== false;
}

async function loadEnabledCountryQueue(): Promise<string[]> {
  const repo = new RegionCountryRepository();
  const enabled = await repo.listEnabledPublic();
  if (enabled.length > 0) {
    return enabled
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.countryCode.localeCompare(b.countryCode))
      .map((r) => r.countryCode.toUpperCase());
  }
  const all = await repo.listAllForAdmin();
  if (all.length > 0) {
    return all
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.countryCode.localeCompare(b.countryCode))
      .map((r) => r.countryCode.toUpperCase());
  }
  return ['US'];
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
    startIdx = Math.min(alreadyInMarket, hotAppids.length);
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
  const appids = await fetchRegionalTopSellerAppids(env, {
    steamCc: resolved.steamCc,
    steamLanguage: resolved.steamLanguage,
    limit: topN,
  });
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

  const batchSize = Math.max(1, Math.min(Number(payload?.batchSize ?? DEFAULT_BATCH_SIZE), 200));
  const topNPerCountry = Math.max(1, Math.min(Number(payload?.topNPerCountry ?? 200), 500));
  const delayMs = Math.max(0, Math.min(Number(payload?.delayMs ?? 0), 3000));
  const skipSyncedToday = payload?.skipSyncedToday !== false;
  const forceRefresh = payload?.forceRefresh === true;
  const concurrency = Math.max(1, Math.min(Number(payload?.concurrency ?? DEFAULT_CONCURRENCY), 24));
  const includeDetail = rrIncludeDetail(payload);
  const includeHeat = rrIncludeHeat(payload);
  const includePrices = rrIncludePrices(payload);
  const bulkPricesOnly = includePrices && !includeDetail && !includeHeat;
  const platforms = (payload?.platforms?.length
    ? payload.platforms
    : bulkPricesOnly
      ? BULK_PRICE_PLATFORMS
      : DEFAULT_PLATFORMS) as DealSource[];

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
  const { appids, startIdx } = pickAppidBatchFromHotList(
    hotAppids,
    state.appidCursor,
    batchSize,
    alreadyInMarket,
    forceRefresh,
  );
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

  if (delayMs > 0 && concurrency > 1) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const lastAppid = appids.length > 0 ? appids[appids.length - 1]! : state.appidCursor;
  let countryCompleted = false;
  let nextCountryCode: string | null = countryCode;

  if (!infraError) {
    const batchShort = appids.length < batchSize;
    const reachedTopN = forceRefresh ? batchShort : alreadyInMarket >= topNPerCountry || batchShort;
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
