import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { SteamStoreService } from '../steam/steam-store.service';
import { RegionCountryRepository } from '../config/region-country.repository';
import { GameDiscountSyncService } from '../game/game-discount-sync.service';
import { GameDealLinkRepository, type DealSource } from '../game/game-deal-link.repository';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import { GameDiscountOffersRepository } from '../game/game-discount-offers.repository';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { buildRegionalSteamStoreAppUrl } from '../steam/steam-store-url.util';
import {
  marketGameDetailPath,
  marketGameHeatPath,
  marketGamePricesPath,
  writeMarketJson,
  assertMarketStorageConfigured,
} from '../../cache/market-object-storage';
import {
  sqliteUpsertMarketGame,
  sqliteGetMarketGame,
  sqliteIsMarketGameFullySyncedToday,
} from '../../storage/sqlite/market-games.store';
import { useSqliteRelationalStore } from '../../config/database';
import type {
  MarketDetailDoc,
  MarketHeatDoc,
  MarketPricesDoc,
  MarketSyncGameResult,
  MarketGameRow,
} from './market.types';
import type { MarketBatchPricePrefetch } from './market-batch-price-prefetch';
import { buildMarketGamePriceSummary } from './market-price-summary.util';
import { jsonPlain } from '../../utils/json-plain';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function computeHeatScore(discountPercent: number, currentPlayers: number): number {
  const d = Math.max(0, Math.min(100, discountPercent));
  const p = Math.min(5_000_000, Math.max(0, currentPlayers));
  return d * 6000 + p;
}

/** 区域畅销榜名次（0=榜首）→ heat_score，便于各国 Top 榜按 Steam 热度排序 */
function heatScoreFromRegionalRank(rank: number, topN: number, currentPlayers: number, discountPercent: number): number {
  const r = Math.max(0, Math.min(topN - 1, Math.trunc(rank)));
  const rankScore = (topN - r) * 10_000;
  const players = Math.min(5_000_000, Math.max(0, currentPlayers));
  const disc = Math.max(0, Math.min(100, discountPercent)) * 10;
  return rankScore + players + disc;
}

function dayStartMs(timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dayKey = fmt.format(new Date());
  const probe = new Date(`${dayKey}T12:00:00Z`);
  return probe.getTime() - 12 * 3600_000;
}

export class MarketSyncService {
  private store: SteamStoreService;
  private regionCountries = new RegionCountryRepository();
  private catalog = new GameCatalogRepository();
  private deals: GameDealLinkRepository;
  private discountSync: GameDiscountSyncService;
  private discountOffers: GameDiscountOffersRepository;
  private settings = new AdminSettingsRepository();

  constructor(private env: Env) {
    this.store = new SteamStoreService(env);
    this.deals = new GameDealLinkRepository(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals, this.catalog);
    this.discountOffers = new GameDiscountOffersRepository(env);
  }

  /** 单国单游戏：详情 + 热度 + 四平台价，落盘 v2 + market_games 索引 */
  async syncGameMarket(
    countryCode: string,
    appid: string,
    opts?: {
      includeDetail?: boolean;
      includeHeat?: boolean;
      includePrices?: boolean;
      platforms?: DealSource[];
      forceRefresh?: boolean;
      skipIfSyncedToday?: boolean;
      delayMs?: number;
      /** 轮询仅刷价：跳过 URL 探测、ITAD enrichment、worthBuy */
      bulkPricesOnly?: boolean;
      /** 批级 API 预取（ITAD/GG/Steam 合并请求） */
      batchPricePrefetch?: MarketBatchPricePrefetch;
      /** 已解析的国家配置（批内复用） */
      resolvedCountry?: import('../config/region-country.repository').ResolvedCountryForSteam;
      /** 折扣 provider 配置（批内复用） */
      discountCfg?: Awaited<ReturnType<AdminSettingsRepository['getDiscountProviders']>>;
      /** Steam 区域畅销榜名次（0=榜首） */
      regionalHotRank?: number;
      regionalHotTopN?: number;
    },
  ): Promise<MarketSyncGameResult> {
    const cc = String(countryCode ?? '').trim().toUpperCase();
    const id = String(appid ?? '').trim();
    if (!cc || !/^[A-Z]{2}$/.test(cc) || !id) {
      return { appid: id, ok: false, detailOk: false, heatOk: false, pricesOk: false, message: 'invalid_input' };
    }

    assertMarketStorageConfigured(this.env);
    if (!useSqliteRelationalStore()) {
      throw new Error('market v2 requires DATA_STORE=vultr_sqlite');
    }

    const includeDetail = opts?.includeDetail !== false;
    const includeHeat = opts?.includeHeat !== false;
    const includePrices = opts?.includePrices !== false;
    const force = opts?.forceRefresh === true;
    const tz = String(process.env.DEAL_SYNC_PRICE_DAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai';

    if (opts?.skipIfSyncedToday && !force) {
      const synced = await sqliteIsMarketGameFullySyncedToday(cc, id, dayStartMs(tz));
      if (synced) {
        return { appid: id, ok: true, detailOk: true, heatOk: true, pricesOk: true, skipped: true, message: 'synced_today' };
      }
    }

    const resolved = opts?.resolvedCountry ?? (await this.regionCountries.resolveForRegionalDetail(cc));
    const detailPath = marketGameDetailPath(cc, id);
    const heatPath = marketGameHeatPath(cc, id);
    const pricesPath = marketGamePricesPath(cc, id);

    let detailOk = !includeDetail;
    let heatOk = !includeHeat;
    let pricesOk = !includePrices;
    const existingRow = await sqliteGetMarketGame(cc, id);
    const catalogDoc =
      opts?.bulkPricesOnly && existingRow?.name?.trim()
        ? null
        : await this.catalog.getByAppid(id);
    let name =
      String(catalogDoc?.name ?? existingRow?.name ?? '')
        .trim() || `App ${id}`;
    let discountPercent = 0;
    let finalPrice: number | null = null;
    let originalPrice: number | null = null;
    let currentPlayers = 0;
    let detailForSummary: Pick<
      import('../steam/steam-store.service').SteamStoreGameDetail,
      'priceInitial' | 'priceFinal' | 'discountPercent' | 'steamStoreUrl' | 'isFree'
    > | null = null;
    let priceBucket: import('../game/game-catalog.repository').GameCountryPriceBucket | null = null;
    const nowIso = new Date().toISOString();
    const nowMsVal = Date.now();

    try {
      if (includeDetail) {
        const detail = await this.store.fetchAppDetails(id, {
          cc: resolved.steamCc,
          language: resolved.steamLanguage,
        });
        if (!detail) {
          return { appid: id, ok: false, detailOk: false, heatOk: false, pricesOk: false, message: 'steam_detail_not_found' };
        }
        if (!catalogDoc?.name?.trim() && !existingRow?.name?.trim()) {
          name = detail.name || name;
        }
        discountPercent = detail.discountPercent ?? 0;
        finalPrice = detail.isFree ? 0 : detail.priceFinal ?? null;
        detailForSummary = detail;
        const detailDoc: MarketDetailDoc = {
          ...detail,
          steamStoreUrl: buildRegionalSteamStoreAppUrl(id, resolved.steamCc, resolved.steamLanguage),
          countryCode: cc,
          steamCc: resolved.steamCc,
          steamLanguage: resolved.steamLanguage,
          syncedAt: nowIso,
        };
        await writeMarketJson(this.env, detailPath, detailDoc);
        detailOk = true;
      }

      if (includeHeat) {
        const players = await this.store.fetchCurrentPlayers(id);
        currentPlayers = players ?? 0;
        const heatDoc: MarketHeatDoc = {
          countryCode: cc,
          appid: id,
          currentPlayers,
          heatScore: computeHeatScore(discountPercent, currentPlayers),
          catalogDiscountPercent: discountPercent,
          syncedAt: nowIso,
        };
        await writeMarketJson(this.env, heatPath, heatDoc);
        heatOk = true;
      }

      if (includePrices) {
        const bulk = opts?.bulkPricesOnly === true;
        const platforms = opts?.platforms?.length
          ? opts.platforms
          : bulk
            ? (['steam', 'isthereanydeal', 'ggdeals'] as DealSource[])
            : (['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'] as DealSource[]);
        const cfg = opts?.discountCfg ?? (await this.settings.getDiscountProviders());
        const prefetch = opts?.batchPricePrefetch;
        const out = await this.discountSync.syncAppDeals(id, {
          countries: [cc],
          sources: platforms,
          forceRefresh: force,
          bulkPricesOnly: opts?.bulkPricesOnly === true,
          itadApiKey: cfg.itadApiKey,
          ggDealsApiKey: cfg.ggDealsApiKey,
          itadBaseUrl: cfg.itadBaseUrl,
          ggDealsBaseUrl: cfg.ggDealsBaseUrl,
          cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
          pricePrefetch: prefetch
            ? {
                steamOffer: prefetch.steamByAppid.get(id),
                itad: prefetch.itadByAppid.get(id),
                gg: prefetch.ggByAppid.get(id),
              }
            : undefined,
        });
        const bucketDoc = await this.discountOffers.getBucket(id, cc);
        const bucket = bucketDoc ? this.discountOffers.countryBucketFromDoc(bucketDoc) : null;
        priceBucket = bucket;
        const steamSnap = bucket?.steam;
        if (steamSnap?.discountPercent != null) discountPercent = steamSnap.discountPercent;
        if (steamSnap?.finalPrice != null) finalPrice = steamSnap.finalPrice;
        const pricesDoc: MarketPricesDoc = {
          countryCode: cc,
          appid: id,
          currency: resolved.defaultCurrency,
          currencySymbol: resolved.currencySymbol,
          bucket: bucket ? jsonPlain(bucket) : null,
          syncedAt: nowIso,
        };
        await writeMarketJson(this.env, pricesPath, pricesDoc);
        pricesOk =
          !!bucket?.steam ||
          !!bucket?.isthereanydeal ||
          !!bucket?.ggdeals ||
          !!bucket?.cheapshark ||
          out.offers.length > 0 ||
          out.providers.some((p) => p.ok);
        if (!pricesOk && out.providers.every((p) => p.reason === 'skipped_same_calendar_day')) {
          pricesOk = true;
        }
        if (out.skipped && out.skipReason === 'zero_price_steam_only') {
          pricesOk = pricesOk || out.providers.some((p) => p.source !== 'steam' && p.ok);
        }
      }

      const existing = await sqliteGetMarketGame(cc, id);
      const rankHeat =
        typeof opts?.regionalHotRank === 'number' && opts.regionalHotTopN
          ? heatScoreFromRegionalRank(opts.regionalHotRank, opts.regionalHotTopN, currentPlayers, discountPercent)
          : computeHeatScore(discountPercent, currentPlayers);
      const heatScore = rankHeat;
      const priceSummary = buildMarketGamePriceSummary({
        countryCode: cc,
        appid: id,
        resolved,
        bucket: priceBucket,
        detail: detailForSummary,
      });
      originalPrice = priceSummary.originalPrice;
      finalPrice = priceSummary.finalPrice;
      discountPercent = priceSummary.discountPercent ?? discountPercent;
      const row: MarketGameRow = {
        countryCode: cc,
        appid: id,
        name,
        currency: resolved.defaultCurrency,
        currencySymbol: resolved.currencySymbol,
        currentPlayers,
        discountPercent,
        originalPrice,
        finalPrice,
        heatScore,
        detailSyncedAtMs: detailOk ? nowMsVal : (existing?.detailSyncedAtMs ?? null),
        priceSyncedAtMs: pricesOk ? nowMsVal : (existing?.priceSyncedAtMs ?? null),
        detailJsonPath: detailPath,
        heatJsonPath: heatPath,
        pricesJsonPath: pricesPath,
        priceSummary,
      };
      await sqliteUpsertMarketGame(row);

      const ok = detailOk && heatOk && pricesOk;
      return {
        appid: id,
        ok,
        detailOk,
        heatOk,
        pricesOk,
        message: ok ? undefined : 'partial_sync',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`[market-sync] appid=${id} cc=${cc} err=${msg}`);
      if (detailOk || heatOk) {
        const existing = await sqliteGetMarketGame(cc, id);
        const rankHeat =
          typeof opts?.regionalHotRank === 'number' && opts.regionalHotTopN
            ? heatScoreFromRegionalRank(opts.regionalHotRank, opts.regionalHotTopN, currentPlayers, discountPercent)
            : computeHeatScore(discountPercent, currentPlayers);
        const heatScore = rankHeat;
        const priceSummary =
          existing?.priceSummary ??
          buildMarketGamePriceSummary({
            countryCode: cc,
            appid: id,
            resolved,
            bucket: priceBucket,
            detail: detailForSummary,
          });
        await sqliteUpsertMarketGame({
          countryCode: cc,
          appid: id,
          name,
          currency: resolved.defaultCurrency,
          currencySymbol: resolved.currencySymbol,
          currentPlayers,
          discountPercent: priceSummary.discountPercent ?? discountPercent,
          originalPrice: priceSummary.originalPrice,
          finalPrice: priceSummary.finalPrice ?? finalPrice,
          heatScore,
          detailSyncedAtMs: detailOk ? nowMsVal : (existing?.detailSyncedAtMs ?? null),
          priceSyncedAtMs: pricesOk ? nowMsVal : (existing?.priceSyncedAtMs ?? null),
          detailJsonPath: detailPath,
          heatJsonPath: heatPath,
          pricesJsonPath: pricesPath,
          priceSummary,
        });
      }
      return { appid: id, ok: false, detailOk, heatOk, pricesOk, message: msg };
    } finally {
      if (opts?.delayMs && opts.delayMs > 0) await wait(opts.delayMs);
    }
  }
}
