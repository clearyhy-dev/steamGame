import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameDealLinkRepository, type DealSource } from './game-deal-link.repository';
import { GameDiscountSyncService } from './game-discount-sync.service';
import { resolveDealSyncCountryCodes, type DealSyncCountryScope } from './deal-sync-countries';
import { RegionCountryRepository } from '../config/region-country.repository';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { filterGamesNeedingPriceSync } from './deal-sync-skip.util';
import { rebuildPriceSyncIndexFromObjectStorage } from '../../cache/price-sync-index';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DealSyncBatchRow = {
  appid: string;
  name?: string;
  ok: boolean;
  upserted: number;
  inserted?: number;
  updated?: number;
  deduped?: number;
  message?: string;
};

export type DailyTopDealsSyncResult = {
  topN: number;
  chunkSize: number;
  total: number;
  success: number;
  failed: number;
  staleMarked: number;
  staleScanned: number;
  coverage: Array<{ source: string; ok: number; empty: number; failed: number }>;
  rowsSample: DealSyncBatchRow[];
  rowsTruncated: boolean;
  /** skipPriceSyncedToday 时跳过的游戏数 */
  skippedSyncedToday?: number;
};

/**
 * 折扣批量写入（管理端批量 / Cron / 计划任务共用）。
 */
export class DealSyncBatchService {
  private catalog = new GameCatalogRepository();
  private deals: GameDealLinkRepository;
  private discountSync: GameDiscountSyncService;
  private settings = new AdminSettingsRepository();
  private regionCountries = new RegionCountryRepository();
  private readonly envRef: Env;

  constructor(env: Env) {
    this.envRef = env;
    this.deals = new GameDealLinkRepository(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals, this.catalog);
  }

  mergeCoverageMaps(
    into: Map<string, { ok: number; empty: number; failed: number }>,
    from: Map<string, { ok: number; empty: number; failed: number }>,
  ): void {
    for (const [k, v] of from.entries()) {
      const cur = into.get(k) ?? { ok: 0, empty: 0, failed: 0 };
      cur.ok += v.ok;
      cur.empty += v.empty;
      cur.failed += v.failed;
      into.set(k, cur);
    }
  }

  async executeDealSyncCore(
    listDocs: Array<{ appid: string; name?: string }>,
    countries: string[],
    sources: DealSource[] | undefined,
    delayMs: number,
    cfg: Awaited<ReturnType<AdminSettingsRepository['getDiscountProviders']>>,
    opts?: { forceRefresh?: boolean },
  ): Promise<{ rows: DealSyncBatchRow[]; coverage: Map<string, { ok: number; empty: number; failed: number }> }> {
    const rows: DealSyncBatchRow[] = [];
    const coverage = new Map<string, { ok: number; empty: number; failed: number }>();
    const bump = (source: string, kind: 'ok' | 'empty' | 'failed') => {
      const cur = coverage.get(source) ?? { ok: 0, empty: 0, failed: 0 };
      cur[kind] += 1;
      coverage.set(source, cur);
    };
    for (const appid of listDocs.map((d) => d.appid)) {
      try {
        const out = await this.discountSync.syncAppDeals(appid, {
          itadApiKey: cfg.itadApiKey,
          ggDealsApiKey: cfg.ggDealsApiKey,
          itadBaseUrl: cfg.itadBaseUrl,
          ggDealsBaseUrl: cfg.ggDealsBaseUrl,
          cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
          countries,
          sources: sources && sources.length > 0 ? sources : undefined,
          forceRefresh: opts?.forceRefresh === true,
        });
        if (out.skipped && out.skipReason === 'zero_price') {
          const name = listDocs.find((x) => x?.appid === appid)?.name;
          rows.push({ appid, name, ok: true, upserted: 0, inserted: 0, updated: 0, deduped: 0, message: 'skipped_zero_price' });
          for (const p of out.providers) {
            if (p.ok) bump(p.source, 'ok');
            else if ((p.reason ?? '') === 'empty_response') bump(p.source, 'empty');
            else bump(p.source, 'failed');
          }
          if (delayMs > 0) await wait(delayMs);
          continue;
        }
        if (out.offers.length > 0) {
          const name = listDocs.find((x) => x?.appid === appid)?.name;
          rows.push({
            appid,
            name,
            ok: true,
            upserted: out.upserted,
            inserted: out.writeStats.inserted,
            updated: out.writeStats.updated,
            deduped: out.writeStats.deduped,
            ...(out.upserted === 0 && out.writeStats.deduped > 0 ? { message: 'deduped_same_day_or_unchanged' } : {}),
          });
        } else {
          const name = listDocs.find((x) => x?.appid === appid)?.name;
          rows.push({
            appid,
            name,
            ok: false,
            upserted: 0,
            inserted: out.writeStats.inserted,
            updated: out.writeStats.updated,
            deduped: out.writeStats.deduped,
            message: 'no_offers',
          });
        }
        for (const p of out.providers) {
          if (p.ok) bump(p.source, 'ok');
          else if ((p.reason ?? '') === 'empty_response') bump(p.source, 'empty');
          else bump(p.source, 'failed');
        }
      } catch (e) {
        const name = listDocs.find((x) => x?.appid === appid)?.name;
        rows.push({ appid, name, ok: false, upserted: 0, inserted: 0, updated: 0, deduped: 0, message: e instanceof Error ? e.message : String(e) });
        bump('unknown', 'failed');
      }
      if (delayMs > 0) await wait(delayMs);
    }
    return { rows, coverage };
  }

  /**
   * 删除无效折扣链接（Firestore 文档）；供计划任务调用。
   */
  async runInvalidDealLinksCleanup(maxDelete?: number): Promise<{ deleted: number }> {
    return this.deals.purgeInvalidDealLinks(maxDelete ?? 10_000);
  }

  /**
   * 按平台 × 国家分别跑同步：候选游戏来自全库「折扣热度」排序，保证每个平台每个国家都处理同一批 Top minGames（默认 500）。
   * `todayDiscountOnly` 为 true 时仅选 catalog 当前有主站折扣的条目。
   */
  async runPerPlatformCountryHeatDealsSync(params?: {
    minGames?: number;
    chunkSize?: number;
    delayMs?: number;
    staleTtlHours?: number;
    todayDiscountOnly?: boolean;
    countries?: string[];
    /** 仅跑指定平台（如计划任务拆成 Steam / ITAD / GG / CS 四条）；不传则四平台全跑 */
    sources?: DealSource[];
    /** 为 true 时跳过「同一日历日已拉价则跳过」，便于每日任务拿到完整写入量（API 调用更多） */
    forceRefresh?: boolean;
  }): Promise<DailyTopDealsSyncResult> {
    const minGames = Math.max(50, Math.min(Number(params?.minGames ?? 500), 5000));
    const chunkSize = Math.max(30, Math.min(Number(params?.chunkSize ?? 80), 300));
    const delayMs = Math.max(0, Math.min(Number(params?.delayMs ?? 45), 3000));
    const staleTtlHours = Math.max(1, Math.min(Number(params?.staleTtlHours ?? 6), 72));
    const todayOnly = params?.todayDiscountOnly !== false;
    const cfg = await this.settings.getDiscountProviders();
    const countries =
      Array.isArray(params?.countries) && params!.countries!.length > 0
        ? params!.countries!.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))
        : await resolveDealSyncCountryCodes(this.regionCountries);
    const stale = await this.deals.markStaleOlderThan(staleTtlHours, 1500);
    const listDocs = await this.catalog.listAppidsForDiscountHeatSync({
      limit: minGames,
      todayDiscountOnly: todayOnly,
      requireDetailSynced: true,
    });
    const allPlatforms: DealSource[][] = [['steam'], ['isthereanydeal'], ['ggdeals'], ['cheapshark']];
    const want =
      Array.isArray(params?.sources) && params!.sources!.length > 0
        ? new Set(params!.sources!.map((s) => String(s).trim().toLowerCase()))
        : null;
    let platformSources = want?.size
      ? allPlatforms.filter((pair) => want!.has(String(pair[0]).toLowerCase()))
      : allPlatforms;
    if (platformSources.length === 0) {
      logger.warn('[deal-sync-batch] per-platform-heat: sources 未匹配任何平台，回退四平台全跑');
      platformSources = allPlatforms;
    }
    const forceRefresh = params?.forceRefresh === true;
    logger.info(
      `[deal-sync-batch] per-platform-heat minGames=${minGames} countries=${countries.length} candidates=${listDocs.length} todayOnly=${todayOnly} platforms=${platformSources.map((p) => p[0]).join(',')} forceRefresh=${forceRefresh}`,
    );
    const allRows: DealSyncBatchRow[] = [];
    const coverageAgg = new Map<string, { ok: number; empty: number; failed: number }>();
    for (const cc of countries) {
      for (const sources of platformSources) {
        for (let i = 0; i < listDocs.length; i += chunkSize) {
          const slice = listDocs.slice(i, i + chunkSize);
          const { rows, coverage } = await this.executeDealSyncCore(slice, [cc], sources, delayMs, cfg, {
            forceRefresh,
          });
          allRows.push(...rows);
          this.mergeCoverageMaps(coverageAgg, coverage);
        }
      }
    }
    const success = allRows.filter((x) => x.ok).length;
    const failed = allRows.length - success;
    logger.info(`[deal-sync-batch] per-platform-heat done rows=${allRows.length} success=${success} failed=${failed}`);
    return {
      topN: minGames,
      chunkSize,
      total: allRows.length,
      success,
      failed,
      staleMarked: stale.staleMarked,
      staleScanned: stale.scanned,
      coverage: Array.from(coverageAgg.entries()).map(([source, v]) => ({ source, ...v })),
      rowsSample: allRows.slice(0, 200),
      rowsTruncated: allRows.length > 200,
    };
  }

  async runDailyTopHotDealsSync(params?: {
    topN?: number;
    chunkSize?: number;
    delayMs?: number;
    staleTtlHours?: number;
    /** 候选来自全库扫描并按折扣热度排序（可与 todayDiscountOnly 联用） */
    sortByDiscountHeat?: boolean;
    /** 仅选 catalog 主站当前有折扣的游戏 */
    todayDiscountOnly?: boolean;
    /** 仅同步指定渠道；不传则四渠道全开 */
    sources?: DealSource[];
    /**
     * 国家范围：计划任务 Top 类默认 `all_configured`（配置表全部国，不按「启用」锁定）。
     */
    countryScope?: DealSyncCountryScope;
    /** 显式国家列表时优先于 countryScope */
    countries?: string[];
    forceRefresh?: boolean;
    skipPriceSyncedToday?: boolean;
  }): Promise<DailyTopDealsSyncResult> {
    const topN = Math.max(1, Math.min(Number(params?.topN ?? 1000), 5000));
    const chunkSize = Math.max(50, Math.min(Number(params?.chunkSize ?? 200), 400));
    const delayMs = Math.max(0, Math.min(Number(params?.delayMs ?? 50), 3000));
    const staleTtlHours = Math.max(1, Math.min(Number(params?.staleTtlHours ?? 6), 72));
    const cfg = await this.settings.getDiscountProviders();
    const countryScope: DealSyncCountryScope = params?.countryScope ?? 'enabled';
    const countries =
      Array.isArray(params?.countries) && params!.countries!.length > 0
        ? params!.countries!.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))
        : await resolveDealSyncCountryCodes(this.regionCountries, countryScope);
    const sourcesFilter =
      Array.isArray(params?.sources) && params!.sources!.length > 0 ? params!.sources! : undefined;
    const stale = await this.deals.markStaleOlderThan(staleTtlHours, 1500);
    const useHeat = params?.sortByDiscountHeat === true || params?.todayDiscountOnly === true;
    const docs = useHeat
      ? await this.catalog.listAppidsForDiscountHeatSync({
          limit: topN,
          todayDiscountOnly: params?.todayDiscountOnly === true,
          requireDetailSynced: true,
        })
      : (await this.catalog.queryForAdmin({ page: 1, pageSize: topN, sortBy: 'online_desc' })).map((r) => ({
          appid: r.appid,
          name: r.name,
        }));
    const forceRefresh = params?.forceRefresh === true;
    const skipPriceSyncedToday = params?.skipPriceSyncedToday === true;
    logger.info(
      `[deal-sync-batch] daily-top topN=${topN} chunk=${chunkSize} games=${docs.length} heat=${useHeat} todayOnly=${params?.todayDiscountOnly === true} countries=${countries.length} scope=${countryScope} sources=${sourcesFilter?.join(',') ?? 'all'} forceRefresh=${forceRefresh} skipSyncedToday=${skipPriceSyncedToday}`,
    );
    const allRows: DealSyncBatchRow[] = [];
    const coverageAgg = new Map<string, { ok: number; empty: number; failed: number }>();
    let skippedSyncedToday = 0;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const slice = docs.slice(i, i + chunkSize);
      let workSlice = slice;
      if (skipPriceSyncedToday && !forceRefresh) {
        const dealMap = await this.deals.listActiveByAppids(slice.map((d) => d.appid));
        const { toSync, skipped } = filterGamesNeedingPriceSync(
          slice,
          dealMap,
          countries,
          sourcesFilter,
          false,
        );
        skippedSyncedToday += skipped;
        workSlice = toSync;
      }
      if (workSlice.length === 0) continue;
      const { rows, coverage } = await this.executeDealSyncCore(workSlice, countries, sourcesFilter, delayMs, cfg, {
        forceRefresh,
      });
      allRows.push(...rows);
      this.mergeCoverageMaps(coverageAgg, coverage);
    }
    const success = allRows.filter((x) => x.ok).length;
    const failed = allRows.length - success;
    logger.info(
      `[deal-sync-batch] daily-top done total=${allRows.length} success=${success} failed=${failed} skippedSyncedToday=${skippedSyncedToday}`,
    );
    void rebuildPriceSyncIndexFromObjectStorage(this.envRef).catch((e) =>
      logger.warn(`[deal-sync-batch] price-sync-index rebuild: ${e instanceof Error ? e.message : String(e)}`),
    );
    return {
      topN,
      chunkSize,
      total: allRows.length,
      success,
      failed,
      staleMarked: stale.staleMarked,
      staleScanned: stale.scanned,
      coverage: Array.from(coverageAgg.entries()).map(([source, v]) => ({ source, ...v })),
      rowsSample: allRows.slice(0, 200),
      rowsTruncated: allRows.length > 200,
      skippedSyncedToday,
    };
  }

  /**
   * 按 catalog appid 游标批量拉折扣（四渠道全开），供每日计划任务推进全库。
   */
  async runCatalogCursorDealsSync(params?: {
    cursorAppid?: string;
    batchSize?: number;
    delayMs?: number;
    maxBatchesPerRun?: number;
    staleTtlHours?: number;
    countryScope?: DealSyncCountryScope;
    countries?: string[];
    sources?: DealSource[];
    forceRefresh?: boolean;
    skipPriceSyncedToday?: boolean;
  }): Promise<
    DailyTopDealsSyncResult & {
      nextCursorAppid: string;
      batchesRun: number;
      reachedEnd: boolean;
      gamesProcessed: number;
    }
  > {
    const batchSize = Math.max(20, Math.min(Number(params?.batchSize ?? 200), 400));
    const delayMs = Math.max(0, Math.min(Number(params?.delayMs ?? 50), 3000));
    const maxBatches = Math.max(1, Math.min(Number(params?.maxBatchesPerRun ?? 30), 120));
    const staleTtlHours = Math.max(1, Math.min(Number(params?.staleTtlHours ?? 6), 72));
    const countryScope: DealSyncCountryScope = params?.countryScope ?? 'enabled';
    const countries =
      Array.isArray(params?.countries) && params!.countries!.length > 0
        ? params!.countries!.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))
        : await resolveDealSyncCountryCodes(this.regionCountries, countryScope);
    const sourcesFilter =
      Array.isArray(params?.sources) && params!.sources!.length > 0 ? params!.sources! : undefined;
    const forceRefresh = params?.forceRefresh === true;
    const skipPriceSyncedToday = params?.skipPriceSyncedToday === true;
    const cfg = await this.settings.getDiscountProviders();
    const stale = await this.deals.markStaleOlderThan(staleTtlHours, 1500);

    let cursor = String(params?.cursorAppid ?? '').trim();
    const allRows: DealSyncBatchRow[] = [];
    const coverageAgg = new Map<string, { ok: number; empty: number; failed: number }>();
    let skippedSyncedToday = 0;
    let batchesRun = 0;
    let gamesProcessed = 0;

    for (let b = 0; b < maxBatches; b++) {
      const listDocs = await this.catalog.listByAppidCursor(cursor, batchSize);
      if (listDocs.length === 0) {
        cursor = '';
        break;
      }
      gamesProcessed += listDocs.length;
      let workSlice = listDocs;
      if (skipPriceSyncedToday && !forceRefresh) {
        const dealMap = await this.deals.listActiveByAppids(listDocs.map((d) => d.appid));
        const { toSync, skipped } = filterGamesNeedingPriceSync(
          listDocs,
          dealMap,
          countries,
          sourcesFilter,
          false,
        );
        skippedSyncedToday += skipped;
        const syncIds = new Set(toSync.map((d) => d.appid));
        workSlice = listDocs.filter((d) => syncIds.has(d.appid));
      }
      if (workSlice.length > 0) {
        const { rows, coverage } = await this.executeDealSyncCore(workSlice, countries, sourcesFilter, delayMs, cfg, {
          forceRefresh,
        });
        allRows.push(...rows);
        this.mergeCoverageMaps(coverageAgg, coverage);
      }
      cursor = listDocs[listDocs.length - 1]!.appid;
      batchesRun += 1;
      if (listDocs.length < batchSize) {
        cursor = '';
        break;
      }
    }

    const success = allRows.filter((x) => x.ok).length;
    const failed = allRows.length - success;
    const reachedEnd = cursor === '';
    logger.info(
      `[deal-sync-batch] catalog-cursor batches=${batchesRun} games=${gamesProcessed} rows=${allRows.length} success=${success} next=${cursor || 'START'} end=${reachedEnd}`,
    );
    void rebuildPriceSyncIndexFromObjectStorage(this.envRef).catch((e) =>
      logger.warn(`[deal-sync-batch] price-sync-index rebuild: ${e instanceof Error ? e.message : String(e)}`),
    );
    return {
      topN: gamesProcessed,
      chunkSize: batchSize,
      total: allRows.length,
      success,
      failed,
      staleMarked: stale.staleMarked,
      staleScanned: stale.scanned,
      coverage: Array.from(coverageAgg.entries()).map(([source, v]) => ({ source, ...v })),
      rowsSample: allRows.slice(0, 200),
      rowsTruncated: allRows.length > 200,
      skippedSyncedToday,
      nextCursorAppid: cursor,
      batchesRun,
      reachedEnd,
      gamesProcessed,
    };
  }
}
