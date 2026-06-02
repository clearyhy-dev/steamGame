import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { SteamStoreService } from '../steam/steam-store.service';
import { VideoRepository } from '../video/video.repository';
import { serializeVideo } from '../video/video.serializer';
import { fetchSteamTrailerMp4 } from '../video/steam-trailer.util';
import { VideoSourceRepository } from '../video/video-source.repository';
import {
  dedupeVideosForGame,
  extractTrailerClipsFromCatalog,
  upsertSteamTrailersAsVideos,
} from '../video/sync-steam-trailers-to-videos.service';
import {
  mergeTrailerClips,
  type SteamTrailerClip,
} from '../steam/steam-trailers.parse';
import type { SteamStoreGameDetail } from '../steam/steam-store.service';
import { sqlAll } from '../../storage/sqlite/sql-client';
import { useSqliteRelationalStore } from '../../config/database';
import { GameCatalogRepository, type GameCatalogDoc, type GameCountryPriceBucket, type ItadMoneySnapshot } from '../game/game-catalog.repository';
import { serializeByCountryMap } from '../game/game-by-country.serialize';
import { GameDealLinkRepository, type DealSource, type GameDealLinkDoc } from '../game/game-deal-link.repository';
import { GameDiscountOffersRepository } from '../game/game-discount-offers.repository';
import { GameWeeklyHeatRepository } from '../game/game-weekly-heat.repository';
import { GameWeeklyHeatSyncService } from '../game/game-weekly-heat-sync.service';
import { GameTopHeatPipelineService } from '../game/game-top-heat-pipeline.service';
import { GameDiscountSyncService } from '../game/game-discount-sync.service';
import { DealSyncBatchService, type DealSyncBatchRow } from '../game/deal-sync-batch.service';
import { ggNearHistoricalLow } from '../game/gg-deals-detail.util';
import { resolveDealSyncCountryCodes } from '../game/deal-sync-countries';
import type { ResolvedCountryForSteam } from '../config/region-country.repository';
import { RegionCountryRepository } from '../config/region-country.repository';
import { buildRegionalSteamStoreAppUrl } from '../steam/steam-store-url.util';
import { maxLastPriceSyncIso } from '../game/deal-sync-skip.util';
import {
  priceSyncedTodayForDeals,
  scanCatalogForPriceSyncedFilter,
} from './admin-games-list-scan';
import { AdminSettingsRepository } from './admin.settings.repository';
import { logger } from '../../utils/logger';
import admin from 'firebase-admin';
import { SteamSyncJobRepository } from '../steam/steam-sync-job.repository';

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function formatItadMoney(m?: ItadMoneySnapshot): string | null {
  if (!m || typeof m.amount !== 'number') return null;
  const c = m.currency ? String(m.currency) : '';
  return `${m.amount} ${c}`.trim();
}

function nearHistoricalLowBucket(bucket: GameCountryPriceBucket | undefined): boolean | null {
  const low = bucket?.itadDetail?.historyLow?.all?.amount;
  const cur = bucket?.isthereanydeal?.finalPrice;
  if (typeof low !== 'number' || low <= 0 || typeof cur !== 'number') return null;
  return cur <= low * 1.08;
}

function parseQueryBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/** 管理端列表：按业务国聚合 Steam/ITAD/GG/CheapShark 链接与 ITAD 史低、值得买等（数据仅来自 `game_discount_offers`） */
function buildCountryInsightForAdminList(
  doc: GameCatalogDoc,
  cc: string,
  deals: GameDealLinkDoc[],
  resolvedCountry: ResolvedCountryForSteam | null,
  insightBucket?: GameCountryPriceBucket | null,
): Record<string, unknown> | null {
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  const bucket = insightBucket;
  if (!bucket) return null;
  const steamCcRaw = bucket?.steamCc ?? resolvedCountry?.steamCc ?? cc;
  const steamCcLower = String(steamCcRaw).trim().toLowerCase().slice(0, 2);
  const steamCcForUrl = /^[a-z]{2}$/.test(steamCcLower) ? steamCcLower : cc.toLowerCase();
  const steamLang = resolvedCountry?.steamLanguage ?? 'en';
  const regionalSteamUrl = buildRegionalSteamStoreAppUrl(doc.appid, steamCcForUrl, steamLang);
  const matchCc = (d: GameDealLinkDoc) => String(d.countryCode ?? 'US').toUpperCase() === cc;
  const dealSteam = deals.find((d) => d.source === 'steam' && matchCc(d));
  const dealItad = deals.find((d) => d.source === 'isthereanydeal' && matchCc(d));
  const dealGg = deals.find((d) => d.source === 'ggdeals' && matchCc(d));
  const dealCs = deals.find((d) => d.source === 'cheapshark' && matchCc(d));
  const hl = bucket?.itadDetail?.historyLow;
  return {
    countryCode: cc,
    /** 当前分桶国对应的 Steam 商店页（含 cc / l，与 Country 配置一致） */
    steamStoreUrl: regionalSteamUrl,
    steamPurchaseUrl: bucket?.steam?.url ?? dealSteam?.url ?? regionalSteamUrl,
    configuredCurrency: resolvedCountry?.defaultCurrency ?? null,
    steamPriceCurrency: bucket?.steam?.currency ?? null,
    itadPurchaseUrl: bucket?.isthereanydeal?.url ?? dealItad?.url ?? null,
    /** 列表展示：标明本行 ITAD 现价来自 IsThereAnyDeal，与分桶国一致 */
    itadProviderLabel: 'ITAD',
    itadBucketCountry: cc,
    itadApiCountry: bucket?.itadDetail?.itadApiCountry ?? bucket?.itadCountry ?? null,
    itadCurrentFinal: typeof bucket?.isthereanydeal?.finalPrice === 'number' ? bucket.isthereanydeal.finalPrice : null,
    itadCurrentOriginal: typeof bucket?.isthereanydeal?.originalPrice === 'number' ? bucket.isthereanydeal.originalPrice : null,
    itadCurrentCurrency: bucket?.isthereanydeal?.currency ?? null,
    itadCurrentDiscountPercent: typeof bucket?.isthereanydeal?.discountPercent === 'number' ? bucket.isthereanydeal.discountPercent : null,
    itadCurrentPriceDisplay:
      typeof bucket?.isthereanydeal?.finalPrice === 'number'
        ? `${bucket.isthereanydeal.finalPrice} ${String(bucket.isthereanydeal.currency ?? '').trim()}`.trim()
        : null,
    ggDealsUrl: bucket?.ggdeals?.url ?? dealGg?.url ?? null,
    ggProviderLabel: 'GG.deals',
    ggBucketCountry: cc,
    ggApiRegion: bucket?.ggDetail?.ggApiRegion ?? bucket?.ggDealsRegion ?? null,
    ggCurrentFinal: typeof bucket?.ggdeals?.finalPrice === 'number' ? bucket.ggdeals.finalPrice : null,
    ggCurrentCurrency: bucket?.ggdeals?.currency ?? null,
    ggCurrentDiscountPercent: typeof bucket?.ggdeals?.discountPercent === 'number' ? bucket.ggdeals.discountPercent : null,
    ggCurrentPriceDisplay:
      typeof bucket?.ggdeals?.finalPrice === 'number'
        ? `${bucket.ggdeals.finalPrice} ${String(bucket.ggdeals.currency ?? '').trim()}`.trim()
        : null,
    ggOfficialPrices: bucket?.ggDetail?.prices ?? null,
    ggNearHistoricalLow: ggNearHistoricalLow(bucket?.ggDetail?.prices, 1.05),
    ggTrendScore: bucket?.ggDetail?.trendScore ?? null,
    ggHotToday: bucket?.ggDetail?.hotToday ?? null,
    ggTrending: bucket?.ggDetail?.trending ?? null,
    ggRising: bucket?.ggDetail?.rising ?? null,
    ggRecentAttention: bucket?.ggDetail?.recentAttention ?? null,
    ggPlayerRatingPercent: bucket?.ggDetail?.playerRatingPercent ?? null,
    ggPlayerRatingLabel: bucket?.ggDetail?.playerRatingLabel ?? null,
    cheapSharkUrl: bucket?.cheapshark?.url ?? dealCs?.url ?? null,
    itadGameId: bucket?.itadDetail?.itadGameId ?? null,
    historyLowAll: formatItadMoney(hl?.all),
    historyLowY1: formatItadMoney(hl?.y1),
    historyLowM3: formatItadMoney(hl?.m3),
    itadBundleCount: bucket?.itadDetail?.bundles?.length ?? 0,
    itadPriceHistoryPoints: bucket?.itadDetail?.priceHistory?.length ?? 0,
    itadWaitlisted: bucket?.itadDetail?.stats?.waitlisted ?? null,
    itadRank: bucket?.itadDetail?.stats?.rank ?? null,
    nearHistoricalLow: nearHistoricalLowBucket(bucket),
    worthBuy: bucket?.worthBuy
      ? {
          score: bucket.worthBuy.score,
          D: bucket.worthBuy.D,
          R: bucket.worthBuy.R,
          P: bucket.worthBuy.P,
          T: bucket.worthBuy.T,
          formula: bucket.worthBuy.formula,
          computedAt: bucket.worthBuy.computedAt?.toDate?.()?.toISOString() ?? null,
        }
      : null,
    multiStoreExpansionNote:
      'ITAD 可落库各店当前价（Fanatical / Humble / GMG / GamesPlanet 等）与跨平台映射（Epic/GOG/Xbox）；当前以 historyLow + 主 deal 为主。',
    ggDiscoveryNote:
      'GG：`v1/prices/by-steam-app-id` 写入 `ggDetail.prices`（官方字段）；发现筛选见列表说明。',
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AdminGamesController {
  private videos = new VideoRepository();
  private videoSources = new VideoSourceRepository();
  private store: SteamStoreService;
  private catalog = new GameCatalogRepository();
  private deals: GameDealLinkRepository;
  private discountOffers: GameDiscountOffersRepository;
  private weeklyHeat = new GameWeeklyHeatRepository();
  private weeklyHeatSync: GameWeeklyHeatSyncService;
  private topHeatPipeline: GameTopHeatPipelineService;
  private discountSync: GameDiscountSyncService;
  private dealBatch: DealSyncBatchService;
  private settings = new AdminSettingsRepository();
  private syncJobs = new SteamSyncJobRepository();
  private regionCountries = new RegionCountryRepository();
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.deals = new GameDealLinkRepository(env);
    this.discountOffers = new GameDiscountOffersRepository(env);
    this.store = new SteamStoreService(env);
    this.weeklyHeatSync = new GameWeeklyHeatSyncService(env);
    this.topHeatPipeline = new GameTopHeatPipelineService(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals, this.catalog);
    this.dealBatch = new DealSyncBatchService(env);
  }

  private clipsFromStoreDetail(detail: SteamStoreGameDetail): SteamTrailerClip[] {
    if (detail.trailerClips?.length) return [...detail.trailerClips];
    const urls = detail.trailerUrls ?? [];
    const thumbs = detail.trailerThumbnailUrls ?? [];
    return urls.map((url, i) => ({
      url,
      thumbnailUrl: thumbs[i] && /^https?:\/\//i.test(thumbs[i]!) ? thumbs[i] : undefined,
    }));
  }

  private async mergeTrailerClips(
    appid: string,
    detail: SteamStoreGameDetail,
    relatedVideoUrls: string[],
  ): Promise<SteamTrailerClip[]> {
    const clips: SteamTrailerClip[] = [...this.clipsFromStoreDetail(detail)];
    try {
      const t = await fetchSteamTrailerMp4(this.env, appid);
      if (t.mp4Url) {
        const hit = clips.find((c) => c.url === t.mp4Url);
        if (hit) {
          if (t.thumbnailUrl && !hit.thumbnailUrl) hit.thumbnailUrl = t.thumbnailUrl;
        } else {
          clips.unshift({ url: t.mp4Url, thumbnailUrl: t.thumbnailUrl });
        }
      }
    } catch (_) {
      /* no extra trailer */
    }
    const header = detail.headerImage;
    for (const u of relatedVideoUrls) {
      const url = String(u ?? '').trim();
      if (!url || clips.some((c) => c.url === url)) continue;
      clips.push({
        url,
        thumbnailUrl: header && /^https?:\/\//i.test(header) ? header : undefined,
      });
    }
    return mergeTrailerClips(clips);
  }

  private async persistTrailersToVideos(
    appid: string,
    gameName: string,
    clips: SteamTrailerClip[],
    headerImageFallback?: string,
  ): Promise<number> {
    try {
      return await upsertSteamTrailersAsVideos(this.videos, this.videoSources, appid, gameName, clips, {
        headerImageFallback,
      });
    } catch (e) {
      logger.warn(
        `[admin.games] persistTrailersToVideos appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const keyword = norm(req.query.keyword);
    const appidFilter = String(req.query.appid ?? '').trim();
    const minDiscountPercent = Number(req.query.discount_percent ?? 0) || 0;
    const discountCountry = String(req.query.discount_country ?? '').trim().toUpperCase();
    const discountSource = String(req.query.discount_source ?? '').trim().toLowerCase();
    const hotnessMin = Number(req.query.hotness_min ?? 0) || 0;
    const hasDiscountInfoRaw = String(req.query.has_discount_info ?? '').trim().toLowerCase();
    const hasDiscountInfo = hasDiscountInfoRaw
      ? hasDiscountInfoRaw === '1' || hasDiscountInfoRaw === 'true'
      : undefined;
    const hasDealLinkRaw = String(req.query.has_deal_link ?? '').trim().toLowerCase();
    const hasDealLink = hasDealLinkRaw ? hasDealLinkRaw === '1' || hasDealLinkRaw === 'true' : undefined;
    const priceSyncedRaw = String(req.query.price_synced ?? '').trim().toLowerCase();
    const priceSynced =
      priceSyncedRaw === 'today' || priceSyncedRaw === 'yes' || priceSyncedRaw === 'no' ? priceSyncedRaw : undefined;
    const hasDetailSyncedRaw = String(req.query.has_detail_synced ?? '').trim().toLowerCase();
    const hasDetailSynced = hasDetailSyncedRaw
      ? hasDetailSyncedRaw === '1' || hasDetailSyncedRaw === 'true'
      : hasDetailSyncedRaw === '0' || hasDetailSyncedRaw === 'false'
        ? false
        : undefined;
    const insightCcRaw = String(req.query.insight_country ?? '').trim().toUpperCase();
    const includeInsight = /^[A-Z]{2}$/.test(insightCcRaw);
    const insightCc = includeInsight ? insightCcRaw : '';

    const page = Math.max(1, Math.trunc(Number(req.query.page ?? 1)));
    const pageSize = Math.max(1, Math.min(Number(req.query.pageSize ?? 100), 500));
    const sortByRaw = String(req.query.sortBy ?? 'online_desc').trim().toLowerCase();
    const sortBy = (sortByRaw === 'updated_desc' || sortByRaw === 'discount_desc' ? sortByRaw : 'online_desc') as
      | 'online_desc'
      | 'updated_desc'
      | 'discount_desc';

    const ggNearHistorical = parseQueryBool(req.query.gg_near_historical);
    const useGgDiscoveryScan = includeInsight && ggNearHistorical;
    /** 价格同步筛选：列表只读 Redis 索引 + 目录，不逐游戏拉 MinIO 折扣 JSON */
    const lightPriceSyncList = !!(priceSynced && !useGgDiscoveryScan);

    let catalogRows: GameCatalogDoc[];
    let total: number;
    let ggDiscoveryScan = false;

    if (priceSynced && !useGgDiscoveryScan) {
      const out = await scanCatalogForPriceSyncedFilter(this.env, {
        priceSynced,
        page,
        pageSize,
        sortBy,
        appid: appidFilter || undefined,
        keyword: keyword || undefined,
        minDiscountPercent: minDiscountPercent > 0 ? minDiscountPercent : undefined,
        hasDetailSynced,
        discountCountry: discountCountry || undefined,
        discountSource: discountSource || undefined,
      });
      catalogRows = out.rows;
      total = out.total;
    } else if (useGgDiscoveryScan) {
      ggDiscoveryScan = true;
      const out = await this.discountOffers.scanGgDiscoveryAgainstCatalog(this.catalog, {
        insightCc,
        page,
        pageSize,
        sortBy,
        ggNearHistorical,
        appid: appidFilter || undefined,
        keyword: keyword || undefined,
        minDiscountPercent: minDiscountPercent > 0 ? minDiscountPercent : undefined,
        hasDetailSynced,
      });
      catalogRows = out.rows;
      total = out.total;
    } else {
      const [cr, tot] = await Promise.all([
        this.catalog.queryForAdmin({
          appid: appidFilter || undefined,
          keyword: keyword || undefined,
          minDiscountPercent,
          hasDetailSynced,
          page,
          pageSize,
          sortBy,
        }),
        hasDealLink === undefined
          ? this.catalog.countForAdmin({
              minDiscountPercent,
              hasDetailSynced,
            })
          : this.catalog.countAll(),
      ]);
      catalogRows = cr;
      total = tot;
    }
    const pageAppids = catalogRows.map((r) => r.appid).filter(Boolean);
    const needDealBuckets = !lightPriceSyncList && pageAppids.length > 0;
    const allInsightBuckets = needDealBuckets
      ? await this.discountOffers.listBucketsForAppids(pageAppids)
      : [];
    const activeDealMap = needDealBuckets
      ? this.deals.buildActiveDealMapFromBuckets(allInsightBuckets)
      : new Map<string, GameDealLinkDoc[]>();
    const videoCountByAppid = lightPriceSyncList
      ? new Map<string, number>()
      : await this.videos.countByGameIds(pageAppids);
    const insightResolved = includeInsight ? await this.regionCountries.resolveForRegionalDetail(insightCc) : null;
    const insightBucketByAppid = new Map<string, GameCountryPriceBucket>();
    if (includeInsight && catalogRows.length > 0 && !lightPriceSyncList) {
      for (const b of allInsightBuckets) {
        if (String(b.countryCode ?? '')
          .trim()
          .toUpperCase() !== insightCc)
          continue;
        insightBucketByAppid.set(b.appid, this.discountOffers.countryBucketFromDoc(b));
      }
    }

    const rows = catalogRows
      .filter((r) => !!r.appid)
      .map((r) => {
        if (lightPriceSyncList) {
          const cat = catalogRows.find((x) => x.appid === r.appid) ?? r;
          const catalogDiscount = cat.discountPercent ?? 0;
          return {
            appid: cat.appid,
            name: cat.name,
            headerImage: cat.headerImage,
            linkedVideos: 0,
            originalPrice: cat.priceInitial ?? 0,
            discountPercent: catalogDiscount,
            steamDiscountPercent: catalogDiscount,
            itadDiscountPercent: null,
            ggDealsDiscountPercent: null,
            cheapSharkDiscountPercent: null,
            hasDealLink: true,
            hasDiscountInfo: catalogDiscount > 0,
            hasSourceDiscountInfo: discountSource ? discountSource === 'steam' && catalogDiscount > 0 : catalogDiscount > 0,
            maxHotnessScore: 0,
            detailSynced: typeof cat.detailSynced === 'boolean' ? cat.detailSynced : !!cat.lastDetailSyncAt,
            clickCount: cat.clickCount ?? 0,
            lastDetailSyncAt: cat.lastDetailSyncAt ? cat.lastDetailSyncAt.toDate().toISOString() : null,
            lastPriceSyncAt: priceSynced === 'yes' ? new Date().toISOString() : null,
            priceSyncedToday: priceSynced === 'today',
            countryInsight: undefined,
          };
        }
        const deals = activeDealMap.get(r.appid) ?? [];
        const bySource = (source: string) =>
          deals
            .filter(
              (d) =>
                d.source === source &&
                (discountCountry ? String(d.countryCode ?? 'US').toUpperCase() === discountCountry : true) &&
                typeof d.discountPercent === 'number',
            )
            .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))[0];
        const filteredDeals = deals.filter((d) =>
          discountCountry ? String(d.countryCode ?? 'US').toUpperCase() === discountCountry : true,
        );
        const maxHotness = filteredDeals.reduce((m, d) => Math.max(m, Number(d.hotnessScore ?? 0)), 0);
        const hasAnyDiscountInfo = filteredDeals.some((d) => typeof d.discountPercent === 'number');
        const hasSourceDiscountInfo = discountSource
          ? filteredDeals.some((d) => d.source === discountSource && typeof d.discountPercent === 'number')
          : hasAnyDiscountInfo;
        const priceSyncedToday = priceSyncedTodayForDeals(filteredDeals, discountSource || undefined);
        return {
          appid: r.appid,
          name: r.name,
          headerImage: r.headerImage,
          linkedVideos: videoCountByAppid.get(r.appid) ?? 0,
          originalPrice: r.priceInitial ?? 0,
          discountPercent: r.discountPercent ?? 0,
          steamDiscountPercent: r.discountPercent ?? 0,
          itadDiscountPercent: bySource('isthereanydeal')?.discountPercent ?? null,
          ggDealsDiscountPercent: bySource('ggdeals')?.discountPercent ?? null,
          cheapSharkDiscountPercent: bySource('cheapshark')?.discountPercent ?? null,
          hasDealLink: filteredDeals.length > 0,
          hasDiscountInfo: hasAnyDiscountInfo,
          hasSourceDiscountInfo,
          maxHotnessScore: maxHotness,
          detailSynced: typeof r.detailSynced === 'boolean' ? r.detailSynced : !!r.lastDetailSyncAt,
          clickCount: r.clickCount ?? 0,
          lastDetailSyncAt: r.lastDetailSyncAt ? r.lastDetailSyncAt.toDate().toISOString() : null,
          lastPriceSyncAt: maxLastPriceSyncIso(filteredDeals),
          priceSyncedToday,
          countryInsight: includeInsight
            ? (buildCountryInsightForAdminList(
                r,
                insightCc,
                deals,
                insightResolved,
                insightBucketByAppid.get(r.appid),
              ) ?? undefined)
            : undefined,
        };
      })
      .filter((r) => (hasDealLink === undefined ? true : r.hasDealLink === hasDealLink))
      .filter((r) => {
        if (!priceSynced || lightPriceSyncList) return true;
        if (priceSynced === 'today') return r.priceSyncedToday === true;
        if (priceSynced === 'yes') return !!r.lastPriceSyncAt;
        return !r.lastPriceSyncAt;
      })
      .filter((r) => (hasDiscountInfo === undefined ? true : discountSource ? r.hasSourceDiscountInfo === hasDiscountInfo : r.hasDiscountInfo === hasDiscountInfo))
      .filter((r) => (hotnessMin > 0 ? Number(r.maxHotnessScore ?? 0) >= hotnessMin : true))
      .sort((a, b) => {
        if (sortBy === 'discount_desc') {
          if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
          return a.appid.localeCompare(b.appid);
        }
        if (sortBy === 'updated_desc') {
          const ta = a.lastDetailSyncAt ? Date.parse(a.lastDetailSyncAt) : 0;
          const tb = b.lastDetailSyncAt ? Date.parse(b.lastDetailSyncAt) : 0;
          if (tb !== ta) return tb - ta;
          return a.appid.localeCompare(b.appid);
        }
        const oa = (catalogRows.find((x) => x.appid === a.appid)?.currentPlayers ?? 0);
        const ob = (catalogRows.find((x) => x.appid === b.appid)?.currentPlayers ?? 0);
        if (ob !== oa) return ob - oa;
        return a.appid.localeCompare(b.appid);
      })
      .map((r) => {
        const c = catalogRows.find((x) => x.appid === r.appid);
        return { ...r, currentPlayers: c?.currentPlayers ?? 0 };
      });

    sendAdminOk(res, { total, page, pageSize, rows, ggDiscoveryScan });
  };

  syncAppList = async (req: Request, res: Response): Promise<void> => {
    const started = Date.now();
    const chunkSize = Math.max(100, Math.min(Number(req.body?.chunkSize ?? req.query.chunkSize ?? 400), 500));
    const lastAppId = Math.max(0, Math.trunc(Number(req.body?.lastAppId ?? req.query.lastAppId ?? 0)));
    const maxResults = Math.max(1000, Math.min(Number(req.body?.maxResults ?? req.query.maxResults ?? 5000), 50000));
    logger.info(`[admin.games.syncAppList] start chunkSize=${chunkSize}`);
    const page = await this.store.fetchAppListPage({ lastAppId, maxResults });
    const source = page.apps;
    if (source.length === 0) {
      logger.warn('[admin.games.syncAppList] steam source empty');
      sendAdminFail(res, 502, 'Steam AppList is empty from upstream. Please retry later.');
      return;
    }
    const dedup = new Map<string, string>();
    for (const g of source) {
      if (!g.appid || dedup.has(g.appid)) continue;
      dedup.set(g.appid, g.name || `App ${g.appid}`);
    }
    const payload = Array.from(dedup.entries()).map(([appid, name]) => ({ appid, name }));
    const out = await this.catalog.upsertAppListItems(payload, { chunkSize });
    logger.info(
      `[admin.games.syncAppList] done processed=${out.processed} inserted=${out.inserted} updated=${out.updated} skipped=${out.skipped}`,
    );
    await this.syncJobs.create({
      trigger: 'manual_app_list',
      status: 'success',
      appListProcessed: out.processed,
      appListInserted: out.inserted,
      appListUpdated: out.updated,
      detailTotal: 0,
      detailSuccess: 0,
      detailFailed: 0,
      startedAt: admin.firestore.Timestamp.fromMillis(started),
      finishedAt: admin.firestore.Timestamp.now(),
      elapsedMs: Date.now() - started,
    });
    sendAdminOk(res, {
      totalFromSteam: source.length,
      uniqueCount: payload.length,
      nextLastAppId: page.lastAppId,
      hasMore: page.hasMore,
      ...out,
    });
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }

    const [catalogDoc, reviewDoc, relatedVideos, dealLinks, heatDoc] = await Promise.all([
      this.catalog.getByAppid(appid),
      this.catalog.getReviews(appid),
      this.videos.list({ gameId: appid, limit: 1000 }),
      this.deals.listByAppid(appid),
      this.weeklyHeat.getByAppid(appid),
    ]);

    if (!catalogDoc) {
      sendAdminFail(res, 404, 'Game not found in server catalog. Please sync app list first.');
      return;
    }

    const bestDeal = this.deals.pickBestDeal(appid, dealLinks, {
      steamDiscountPercent: catalogDoc.discountPercent ?? 0,
      steamStoreUrl: catalogDoc.steamStoreUrl,
    });

    const offerBuckets = await this.discountOffers.listBucketsForAppid(appid);
    const fromOffers = this.discountOffers.toByCountryMap(offerBuckets);
    const byCountry = serializeByCountryMap(fromOffers);
    const heatPlayers = heatDoc?.currentPlayers ?? catalogDoc.currentPlayers ?? 0;

    sendAdminOk(res, {
      game: {
        appid: catalogDoc.appid,
        name: catalogDoc.name,
        headerImage: catalogDoc.headerImage,
        screenshots: catalogDoc.screenshots ?? [],
        trailerUrls: catalogDoc.trailerUrls ?? [],
        steamStoreUrl: catalogDoc.steamStoreUrl ?? `https://store.steampowered.com/app/${appid}`,
        shortDescription: catalogDoc.shortDescription ?? '',
        developers: catalogDoc.developers ?? [],
        publishers: catalogDoc.publishers ?? [],
        categories: catalogDoc.categories ?? [],
        genres: catalogDoc.genres ?? [],
        tags: catalogDoc.tags ?? [],
        discountPercent: catalogDoc.discountPercent ?? 0,
        currentPlayers: heatPlayers,
        clickCount: catalogDoc.clickCount ?? 0,
        lastDetailSyncAt: catalogDoc.lastDetailSyncAt ? catalogDoc.lastDetailSyncAt.toDate().toISOString() : null,
        /** 多国分桶比价（`game_discount_offers`） */
        byCountry,
        /** 周热度主数据（`game_weekly_heat`）；`playersDaily` 仅在此维护 */
        weeklyHeat: {
          currentPlayers: heatDoc?.currentPlayers ?? null,
          weekKey: heatDoc?.weekKey ?? null,
          fetchedAt: heatDoc?.fetchedAt ? heatDoc.fetchedAt.toDate().toISOString() : null,
          playersDaily: heatDoc?.playersDaily ?? [],
        },
      },
      dealLinks: dealLinks.map((d) => ({
        ...d,
        countryCode: d.countryCode ?? 'US',
        startAt: d.startAt ? d.startAt.toDate().toISOString() : null,
        endAt: d.endAt ? d.endAt.toDate().toISOString() : null,
        lastCheckedAt: d.lastCheckedAt ? d.lastCheckedAt.toDate().toISOString() : null,
        lastPriceSyncAt: d.lastPriceSyncAt ? d.lastPriceSyncAt.toDate().toISOString() : null,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      })),
      bestDeal,
      reviewSummary: catalogDoc.reviewSummary ?? null,
      reviews: reviewDoc.reviews,
      videos: relatedVideos.map(serializeVideo),
      reviewUpdatedAt: reviewDoc.updatedAt ? reviewDoc.updatedAt.toDate().toISOString() : null,
    });
  };

  syncMeta = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }

    const [detail, relatedVideos] = await Promise.all([
      this.store.fetchAppDetails(appid),
      this.videos.list({ gameId: appid, limit: 1000 }),
    ]);

    if (!detail) {
      sendAdminFail(res, 404, 'Game not found from Steam');
      return;
    }

    const fallbackVideoUrls = relatedVideos
      .map((v) => v.playbackUrl || v.signedPlaybackUrl || '')
      .filter((u) => !!u) as string[];
    const trailerClips = await this.mergeTrailerClips(appid, detail, fallbackVideoUrls);
    const trailerUrls = trailerClips.map((c) => c.url);
    const trailerThumbnailUrls = trailerClips.map((c) => c.thumbnailUrl ?? '');

    await this.catalog.upsertMeta({
      appid,
      name: detail.name,
      headerImage: detail.headerImage,
      capsuleImage: detail.capsuleImage,
      screenshots: detail.screenshots ?? [],
      trailerUrls,
      trailerThumbnailUrls,
      shortDescription: detail.shortDescription,
      detailedDescription: detail.detailedDescription,
      steamStoreUrl: detail.steamStoreUrl,
      developers: detail.developers,
      publishers: detail.publishers,
      categories: detail.categories ?? [],
      genres: detail.genres ?? [],
      tags: detail.tags ?? [],
      isFree: detail.isFree,
      priceInitial: detail.priceInitial,
      priceFinal: detail.priceFinal,
      discountPercent: detail.discountPercent,
      steamDiscounted: detail.steamDiscounted,
    });
    const videosCreated = await this.persistTrailersToVideos(
      appid,
      detail.name,
      trailerClips,
      detail.headerImage,
    );

    sendAdminOk(res, { synced: true, appid, videosCreated });
  };

  syncDetailOne = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    try {
      logger.info(`[admin.games.syncDetailOne] start appid=${appid}`);
      const [detail, relatedVideos] = await Promise.all([
        this.store.fetchAppDetails(appid),
        this.videos.list({ gameId: appid, limit: 200 }),
      ]);
      if (!detail) {
        sendAdminFail(res, 404, 'Game not found from Steam');
        return;
      }
      const fallbackVideoUrls = relatedVideos
        .map((v) => v.playbackUrl || v.signedPlaybackUrl || '')
        .filter((u) => !!u) as string[];
      const trailerClips = await this.mergeTrailerClips(appid, detail, fallbackVideoUrls);
      const trailerUrls = trailerClips.map((c) => c.url);
      const trailerThumbnailUrls = trailerClips.map((c) => c.thumbnailUrl ?? '');
      await this.catalog.upsertMeta({
        appid,
        name: detail.name,
        headerImage: detail.headerImage,
        capsuleImage: detail.capsuleImage,
        screenshots: detail.screenshots ?? [],
        trailerUrls,
        trailerThumbnailUrls,
        shortDescription: detail.shortDescription,
        detailedDescription: detail.detailedDescription,
        steamStoreUrl: detail.steamStoreUrl,
        developers: detail.developers,
        publishers: detail.publishers,
        categories: detail.categories ?? [],
        genres: detail.genres ?? [],
        tags: detail.tags ?? [],
        isFree: detail.isFree,
        priceInitial: detail.priceInitial,
        priceFinal: detail.priceFinal,
      discountPercent: detail.discountPercent,
      steamDiscounted: detail.steamDiscounted,
      });
      const videosCreated = await this.persistTrailersToVideos(
        appid,
        detail.name,
        trailerClips,
        detail.headerImage,
      );
      logger.info(`[admin.games.syncDetailOne] done appid=${appid} videosCreated=${videosCreated}`);
      sendAdminOk(res, { synced: true, appid, videosCreated });
    } catch (e) {
      logger.error(`[admin.games.syncDetailOne] failed appid=${appid} err=${e instanceof Error ? e.message : String(e)}`);
      sendAdminFail(res, 500, 'sync detail failed');
    }
  };

  syncDetailBatch = async (req: Request, res: Response): Promise<void> => {
    const started = Date.now();
    const appidsRaw = Array.isArray(req.body?.appids) ? req.body.appids : [];
    const maxBatch = Math.max(20, Math.min(Number(req.body?.batchSize ?? 200), 500));
    const offset = Math.max(0, Math.trunc(Number(req.body?.offset ?? req.query.offset ?? 0)));
    const cursorAppid = String(req.body?.cursorAppid ?? req.query.cursorAppid ?? '').trim();
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 80), 2000));
    const concurrency = Math.max(1, Math.min(Number(req.body?.concurrency ?? 4), 8));
    const force = req.body?.force === true || String(req.query.force ?? '').toLowerCase() === 'true';
    let appids = appidsRaw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
    const syncedMap = new Map<string, boolean>();
    let unsyncedPageExhausted = false;
    if (appids.length === 0) {
      if (force) {
        const list = cursorAppid
          ? await this.catalog.listByAppidCursor(cursorAppid, maxBatch)
          : await this.catalog.listByAppidPage(offset, maxBatch);
        appids = list.map((x) => x.appid).slice(0, maxBatch);
        for (const row of list) syncedMap.set(row.appid, !!row.lastDetailSyncAt);
      } else {
        const { rows: list, exhausted } = await this.catalog.listUnsyncedByCursor(cursorAppid, maxBatch);
        unsyncedPageExhausted = exhausted;
        appids = list.map((x) => x.appid);
        for (const row of list) syncedMap.set(row.appid, !!row.lastDetailSyncAt);
      }
    } else {
      appids = appids.slice(0, maxBatch);
    }

    logger.info(
      `[admin.games.syncDetailBatch] start count=${appids.length} delayMs=${delayMs} offset=${offset} cursorAppid=${cursorAppid} concurrency=${concurrency}`,
    );
    const out: Array<{
      appid: string;
      ok: boolean;
      status: 'synced' | 'skipped' | 'failed';
      message?: string;
      name?: string;
      currentPlayers?: number;
      discountPercent?: number;
      priceFinal?: number;
    }> = [];
    for (let i = 0; i < appids.length; i += concurrency) {
      const chunk = appids.slice(i, i + concurrency);
      const settled = await Promise.all(
        chunk.map(async (appid: string) => {
          if (!force && syncedMap.get(appid) === true) {
            return { appid, ok: true, status: 'skipped', message: 'already_synced' };
          }
          try {
            let detail = await this.store.fetchAppDetails(appid);
            if (!detail) {
              await wait(400);
              detail = await this.store.fetchAppDetails(appid);
            }
            if (!detail) {
              await wait(800);
              detail = await this.store.fetchAppDetails(appid);
            }
            if (!detail) {
              await this.catalog.markDetailUnavailable(appid);
              return { appid, ok: false, status: 'failed', message: 'not_found' };
            }
            const relatedVideos = await this.videos.list({ gameId: appid, limit: 100 });
            const fallbackVideoUrls = relatedVideos
              .map((v) => v.playbackUrl || v.signedPlaybackUrl || '')
              .filter((u) => !!u) as string[];
            const trailerClips = await this.mergeTrailerClips(appid, detail, fallbackVideoUrls);
            const trailerUrls = trailerClips.map((c) => c.url);
            const trailerThumbnailUrls = trailerClips.map((c) => c.thumbnailUrl ?? '');
            await this.catalog.upsertMeta({
              appid,
              name: detail.name,
              headerImage: detail.headerImage,
              capsuleImage: detail.capsuleImage,
              screenshots: detail.screenshots ?? [],
              trailerUrls,
              trailerThumbnailUrls,
              shortDescription: detail.shortDescription,
              detailedDescription: detail.detailedDescription,
              steamStoreUrl: detail.steamStoreUrl,
              developers: detail.developers,
              publishers: detail.publishers,
              categories: detail.categories ?? [],
              genres: detail.genres ?? [],
              tags: detail.tags ?? [],
              isFree: detail.isFree,
              priceInitial: detail.priceInitial,
              priceFinal: detail.priceFinal,
              discountPercent: detail.discountPercent,
              steamDiscounted: detail.steamDiscounted,
            });
            const videosCreated = await this.persistTrailersToVideos(
              appid,
              detail.name,
              trailerClips,
              detail.headerImage,
            );
            const fresh = await this.catalog.getByAppid(appid);
            return {
              appid,
              ok: true,
              status: 'synced',
              name: detail.name,
              videosCreated,
              currentPlayers: fresh?.currentPlayers ?? 0,
              discountPercent: detail.discountPercent,
              priceFinal: detail.priceFinal,
            };
          } catch (e) {
            logger.warn(`[admin.games.syncDetailBatch] one failed appid=${appid} err=${e instanceof Error ? e.message : String(e)}`);
            return { appid, ok: false, status: 'failed', message: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      out.push(...settled);
      if (delayMs > 0) await wait(delayMs);
    }
    const success = out.filter((x) => x.status === 'synced').length;
    const skipped = out.filter((x) => x.status === 'skipped').length;
    const failed = out.filter((x) => x.status === 'failed').length;
    const nextCursorAppid = appids.length > 0 ? appids[appids.length - 1] : cursorAppid;
    const hasMore = force
      ? appids.length === maxBatch
      : appids.length === maxBatch && !unsyncedPageExhausted;
    await this.syncJobs.create({
      trigger: 'manual_detail_batch',
      status: failed > 0 ? 'partial' : 'success',
      appListProcessed: 0,
      appListInserted: 0,
      appListUpdated: 0,
      detailTotal: out.length,
      detailSuccess: success,
      detailFailed: failed,
      startedAt: admin.firestore.Timestamp.fromMillis(started),
      finishedAt: admin.firestore.Timestamp.now(),
      elapsedMs: Date.now() - started,
    });
    logger.info(`[admin.games.syncDetailBatch] done success=${success} skipped=${skipped} failed=${failed}`);
    sendAdminOk(res, {
      total: out.length,
      success,
      skipped,
      failed,
      nextOffset: offset + out.length,
      nextCursorAppid,
      hasMore,
      reachedEnd: !hasMore,
      rows: out,
    });
  };

  /** 已有详情但 videos 未写入时，按 appid 游标批量回填 Steam 预告片 */
  backfillTrailerVideos = async (req: Request, res: Response): Promise<void> => {
    if (!useSqliteRelationalStore()) {
      sendAdminFail(res, 400, 'backfill-trailer-videos requires DATA_STORE=vultr_sqlite');
      return;
    }
    const cursorAppid = String(req.body?.cursorAppid ?? '').trim();
    const batchSize = Math.max(1, Math.min(Number(req.body?.batchSize ?? 100), 300));
    const onlyWithUrls = req.body?.onlyWithUrls !== false;
    const fetchSteam = !onlyWithUrls && req.body?.fetchSteam !== false;
    const after = Math.max(0, Math.trunc(Number(cursorAppid) || 0));

    const urlFilter = onlyWithUrls
      ? ` AND (data_json LIKE '%/movie/%' OR data_json LIKE '%.mp4%' OR data_json LIKE '%.webm%')`
      : '';

    const rows = await sqlAll<{ appid: string; name: string; data_json: string }>(
      `SELECT appid, name, data_json FROM game_catalog
       WHERE (detail_synced = 1 OR last_detail_sync_at_ms > 0)
         AND (json_extract(data_json, '$.detailUnavailable') IS NULL OR json_extract(data_json, '$.detailUnavailable') = 0)${urlFilter}
         AND CAST(appid AS INTEGER) > ?
       ORDER BY CAST(appid AS INTEGER) ASC
       LIMIT ?`,
      [after, batchSize],
    );

    let videosCreated = 0;
    let noUrls = 0;
    const out: Array<{ appid: string; videosCreated: number; trailerCount: number }> = [];

    for (const row of rows) {
      const appid = String(row.appid ?? '').trim();
      if (!appid) continue;
      try {
        const doc = await this.catalog.getByAppid(appid);
        const name = doc?.name ?? row.name ?? `App ${appid}`;
        let clips = extractTrailerClipsFromCatalog(doc, row.data_json);
        if (fetchSteam || (!onlyWithUrls && clips.length === 0)) {
          try {
            const fresh = await this.store.fetchAppDetails(appid);
            if (fresh) {
              const fromStore = fresh.trailerClips?.length
                ? fresh.trailerClips
                : (fresh.trailerUrls ?? []).map((url, i) => ({
                    url,
                    thumbnailUrl: fresh.trailerThumbnailUrls?.[i] || undefined,
                  }));
              clips = mergeTrailerClips([...fromStore, ...clips]);
            }
          } catch {
            /* ignore */
          }
          if (clips.length === 0) {
            try {
              const t = await fetchSteamTrailerMp4(this.env, appid);
              if (t.mp4Url) clips = [{ url: t.mp4Url, thumbnailUrl: t.thumbnailUrl }];
            } catch {
              /* no store trailer */
            }
          }
        }
        clips = mergeTrailerClips(clips);
        if (clips.length === 0) {
          noUrls++;
          out.push({ appid, videosCreated: 0, trailerCount: 0 });
          continue;
        }
        const n = await this.persistTrailersToVideos(appid, name, clips, doc?.headerImage);
        videosCreated += n;
        out.push({ appid, videosCreated: n, trailerCount: clips.length });
      } catch (e) {
        logger.warn(
          `[admin.games.backfillTrailerVideos] appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
        );
        out.push({ appid, videosCreated: 0, trailerCount: 0 });
      }
    }

    const nextCursorAppid = rows.length > 0 ? rows[rows.length - 1]!.appid : cursorAppid;
    const hasMore = rows.length === batchSize;
    logger.info(
      `[admin.games.backfillTrailerVideos] batch=${rows.length} videosCreated=${videosCreated} noUrls=${noUrls} next=${nextCursorAppid}`,
    );
    sendAdminOk(res, {
      processed: rows.length,
      videosCreated,
      noUrls,
      nextCursorAppid,
      hasMore,
      reachedEnd: !hasMore,
      rows: out,
    });
  };

  /** 按游戏清理 videos 表重复预告片（同 Steam movie / 同 URL 只保留一条） */
  dedupeTrailerVideos = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.max(1, Math.min(Number(req.body?.limit ?? 5000), 50_000));
    let gameIds: string[] = [];
    if (useSqliteRelationalStore()) {
      const rows = await sqlAll<{ game_id: string }>(
        `SELECT DISTINCT game_id AS game_id FROM videos
         WHERE game_id IS NOT NULL AND TRIM(game_id) != ''
         LIMIT ?`,
        [limit],
      );
      gameIds = rows.map((r) => String(r.game_id ?? '').trim()).filter(Boolean);
    } else {
      const vids = await this.videos.list({ limit: 1000 });
      gameIds = Array.from(new Set(vids.map((v) => String(v.gameId ?? '').trim()).filter(Boolean)));
    }
    let removed = 0;
    for (const gid of gameIds) {
      removed += await dedupeVideosForGame(this.videos, gid);
    }
    logger.info(`[admin.games.dedupeTrailerVideos] games=${gameIds.length} removed=${removed}`);
    sendAdminOk(res, { gamesScanned: gameIds.length, duplicatesRemoved: removed });
  };

  listSyncJobs = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 30), 100));
    const rows = await this.syncJobs.listRecent(limit);
    sendAdminOk(res, {
      rows: rows.map((r) => ({
        ...r,
        startedAt: r.startedAt.toDate().toISOString(),
        finishedAt: r.finishedAt.toDate().toISOString(),
        createdAt: r.createdAt.toDate().toISOString(),
      })),
    });
  };

  listDealLinks = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const rows = await this.deals.listByAppid(appid);
    sendAdminOk(res, {
      rows: rows.map((d) => ({
        ...d,
        countryCode: d.countryCode ?? 'US',
        hotnessScore: d.hotnessScore ?? null,
        startAt: d.startAt ? d.startAt.toDate().toISOString() : null,
        endAt: d.endAt ? d.endAt.toDate().toISOString() : null,
        lastCheckedAt: d.lastCheckedAt ? d.lastCheckedAt.toDate().toISOString() : null,
        lastPriceSyncAt: d.lastPriceSyncAt ? d.lastPriceSyncAt.toDate().toISOString() : null,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      })),
    });
  };

  syncDeals = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const cfg = await this.settings.getDiscountProviders();
    const countriesFromReq = Array.isArray(req.body?.countries) ? req.body.countries : [];
    const defaultCountries = await resolveDealSyncCountryCodes(this.regionCountries);
    const countries =
      countriesFromReq.length > 0
        ? countriesFromReq.map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter(Boolean)
        : defaultCountries;
    const sourcesRaw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const sources = sourcesRaw
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => x === 'steam' || x === 'isthereanydeal' || x === 'ggdeals' || x === 'cheapshark') as DealSource[];
    const forceRefresh = req.body?.forceRefresh !== false;
    const out = await this.discountSync.syncAppDeals(appid, {
      itadApiKey: cfg.itadApiKey,
      ggDealsApiKey: cfg.ggDealsApiKey,
      itadBaseUrl: cfg.itadBaseUrl,
      ggDealsBaseUrl: cfg.ggDealsBaseUrl,
      cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
      countries,
      sources: sources.length > 0 ? sources : undefined,
      forceRefresh,
    });
    if (out.skipped && out.skipReason === 'zero_price') {
      sendAdminOk(res, {
        appid,
        upserted: 0,
        writeStats: out.writeStats,
        skipped: true,
        skipReason: 'zero_price',
        providers: out.providers,
        countries,
      });
      return;
    }
    if (out.offers.length === 0) {
      const providerMsg = out.providers.map((p) => `${p.source}:${p.ok ? 'ok' : p.reason || 'failed'}`).join(', ');
      sendAdminFail(res, 502, `No discount offers fetched for appid=${appid}. providers=[${providerMsg}]`);
      return;
    }
    const bestDeal = this.deals.pickBestDeal(appid, await this.deals.listByAppid(appid), {
      steamDiscountPercent: out.offers.find((x) => x.source === 'steam')?.discountPercent ?? 0,
      steamStoreUrl: `https://store.steampowered.com/app/${appid}`,
    });
    sendAdminOk(res, {
      appid,
      upserted: out.upserted,
      writeStats: out.writeStats,
      offers: out.offers,
      providers: out.providers,
      countries,
      bestDeal,
    });
  };

  /**
   * Cloud Scheduler：`POST /api/internal/cron/daily-deals`，Header `X-Cron-Secret`。
   * 按在线人数取 Top N（默认 1000），全平台折扣同步，分块降低单次请求峰值内存。
   */
  runDailyDealsCron = async (req: Request, res: Response): Promise<void> => {
    const topN = Math.max(1, Math.min(Number(req.body?.topN ?? 1000), 1000));
    const chunkSize = Math.max(50, Math.min(Number(req.body?.chunkSize ?? 200), 400));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 50), 3000));
    const staleTtlHours = Math.max(1, Math.min(Number(req.body?.staleTtlHours ?? 6), 72));
    const sortByDiscountHeat = req.body?.sortByDiscountHeat === true;
    const todayDiscountOnly = req.body?.todayDiscountOnly === true;
    const out = await this.dealBatch.runDailyTopHotDealsSync({
      topN,
      chunkSize,
      delayMs,
      staleTtlHours,
      sortByDiscountHeat,
      todayDiscountOnly,
    });
    sendAdminOk(res, {
      mode: 'cron_daily_deals',
      topN: out.topN,
      chunkSize: out.chunkSize,
      total: out.total,
      success: out.success,
      failed: out.failed,
      staleMarked: out.staleMarked,
      staleScanned: out.staleScanned,
      coverage: out.coverage,
      rows: out.rowsSample,
      rowsTruncated: out.rowsTruncated,
    });
  };

  /**
   * 管理端：按 catalog 游标跑一页「周热度」同步（默认跳过近 7 天已拉取的游戏，除非 `force`）。
   */
  syncWeeklyHeatPage = async (req: Request, res: Response): Promise<void> => {
    const out = await this.weeklyHeatSync.runPage({
      cursorAppid: String(req.body?.cursorAppid ?? req.query.cursorAppid ?? '').trim(),
      pageSize: Number(req.body?.pageSize ?? req.query.pageSize) || undefined,
      delayMs: Number(req.body?.delayMs ?? req.query.delayMs) || undefined,
      force: req.body?.force === true || String(req.query.force ?? '').toLowerCase() === 'true',
    });
    sendAdminOk(res, { mode: 'weekly_heat_page', ...out });
  };

  /**
   * Cloud Scheduler：`POST /api/internal/cron/weekly-heat`，Header `X-Cron-Secret`。
   * 多页串联刷新在线人数（写入 `game_weekly_heat` + catalog 排序镜像）；建议每周一次，`maxPages` 控制单请求上限。
   */
  /**
   * 热度 TopN：刷新 Steam 在线人数 + 确保详情 + 每款最新评论（默认 50 条）。
   */
  syncTopHeatPipeline = async (req: Request, res: Response): Promise<void> => {
    const out = await this.topHeatPipeline.run({
      topN: Number(req.body?.topN ?? 500),
      delayMs: Number(req.body?.delayMs ?? 45),
      maxReviews: Number(req.body?.maxReviews ?? 50),
      refreshPlayers: req.body?.refreshPlayers !== false,
      syncDetails: req.body?.syncDetails !== false,
      syncReviews: req.body?.syncReviews !== false,
      forcePlayers: req.body?.forcePlayers === true,
      reviewStaleHours: Number(req.body?.reviewStaleHours ?? 168),
    });
    sendAdminOk(res, { mode: 'top_heat_pipeline', ...out });
  };

  /** Cloud Scheduler：`POST /api/internal/cron/top-heat-pipeline` */
  runTopHeatPipelineCron = async (req: Request, res: Response): Promise<void> => {
    const out = await this.topHeatPipeline.run({
      topN: Number(req.body?.topN ?? 500),
      delayMs: Number(req.body?.delayMs ?? 45),
      maxReviews: Number(req.body?.maxReviews ?? 50),
      forcePlayers: req.body?.forcePlayers !== false,
    });
    sendAdminOk(res, { mode: 'cron_top_heat_pipeline', ...out });
  };

  runWeeklyHeatCron = async (req: Request, res: Response): Promise<void> => {
    const maxPages = Math.max(1, Math.min(Number(req.body?.maxPages ?? 120), 600));
    const pageSize = Math.max(50, Math.min(Number(req.body?.pageSize ?? 300), 500));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 40), 2000));
    const force = req.body?.force === true;
    let cursor = String(req.body?.cursorAppid ?? '').trim();
    let refreshed = 0;
    let skippedFresh = 0;
    let failed = 0;
    let scanned = 0;
    let pages = 0;
    let lastCursor: string | null = null;
    let lastHasMore = false;
    for (let i = 0; i < maxPages; i++) {
      const out = await this.weeklyHeatSync.runPage({ cursorAppid: cursor, pageSize, delayMs, force });
      pages += 1;
      refreshed += out.refreshed;
      skippedFresh += out.skippedFresh;
      failed += out.failed;
      scanned += out.scanned;
      lastCursor = out.nextCursorAppid;
      lastHasMore = out.hasMore;
      if (!out.hasMore) break;
      if (!out.nextCursorAppid) break;
      cursor = out.nextCursorAppid;
    }
    sendAdminOk(res, {
      mode: 'cron_weekly_heat',
      maxPages,
      pagesRun: pages,
      scanned,
      refreshed,
      skippedFresh,
      failed,
      nextCursorAppid: lastCursor,
      hitPageCap: pages >= maxPages && lastHasMore,
    });
  };

  /**
   * 清空 `game_discount_offers` 并剔除 catalog 上已废弃镜像字段（`purgeLegacyCatalogFieldsForAllGames`），
   * 再按 Steam / ITAD / GG / CheapShark 分四轮跑 TopN（与计划任务拆分一致；默认「今日主站有折」+ 折扣热度 + 配置表全部国家）。
   * 单请求耗时可至数十分钟，请用大超时客户端调用。
   */
  fullResetResyncDealsToday = async (req: Request, res: Response): Promise<void> => {
    const purgeFirst = req.body?.purgeFirst !== false;
    const topN = Math.max(1, Math.min(Number(req.body?.topN ?? 1000), 1000));
    const chunkSize = Math.max(50, Math.min(Number(req.body?.chunkSize ?? 200), 400));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 50), 3000));
    const staleTtlHours = Math.max(1, Math.min(Number(req.body?.staleTtlHours ?? 6), 72));
    const todayDiscountOnly = req.body?.todayDiscountOnly !== false;
    const sortByDiscountHeat = req.body?.sortByDiscountHeat !== false;
    const countryScope = req.body?.countryScope === 'enabled' ? 'enabled' : 'all_configured';

    type Purge =
      | { skipped: true }
      | { skipped?: false; dealLinksDeleted: number; catalogGamesUpdated: number };

    let purge: Purge = { skipped: true };

    if (purgeFirst) {
      logger.info('[admin.games] fullResetResync: deleting game_discount_offers');
      const linkOut = await this.deals.deleteAllDealLinks();
      logger.info(`[admin.games] fullResetResync: deleted ${linkOut.deleted} discount-offer docs`);
      logger.info('[admin.games] fullResetResync: purging legacy catalog fields (byCountry / playersDaily / discountUrl)');
      const catOut = await this.catalog.purgeLegacyCatalogFieldsForAllGames();
      logger.info(`[admin.games] fullResetResync: updated ${catOut.gamesUpdated} catalog games`);
      purge = { dealLinksDeleted: linkOut.deleted, catalogGamesUpdated: catOut.gamesUpdated };
    }

    const PLATFORM_SOURCES: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'];
    type PlatformOk = {
      source: DealSource;
      ok: true;
      total: number;
      success: number;
      failed: number;
      staleMarked: number;
      staleScanned: number;
      coverage: Array<{ source: string; ok: number; empty: number; failed: number }>;
    };
    type PlatformErr = { source: DealSource; ok: false; error: string };
    const platforms: Array<PlatformOk | PlatformErr> = [];

    for (const source of PLATFORM_SOURCES) {
      try {
        logger.info(
          `[admin.games] fullResetResync: runDailyTopHotDealsSync source=${source} topN=${topN} todayOnly=${todayDiscountOnly} heat=${sortByDiscountHeat} scope=${countryScope}`,
        );
        const out = await this.dealBatch.runDailyTopHotDealsSync({
          topN,
          chunkSize,
          delayMs,
          staleTtlHours,
          sortByDiscountHeat,
          todayDiscountOnly,
          sources: [source],
          countryScope,
        });
        platforms.push({
          source,
          ok: true,
          total: out.total,
          success: out.success,
          failed: out.failed,
          staleMarked: out.staleMarked,
          staleScanned: out.staleScanned,
          coverage: out.coverage,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[admin.games] fullResetResync: platform=${source} failed: ${msg}`);
        platforms.push({ source, ok: false, error: msg });
      }
    }

    const allOk = platforms.every((p) => p.ok);
    sendAdminOk(res, {
      mode: 'full_reset_resync_today_by_platform',
      allPlatformsOk: allOk,
      purge,
      params: {
        topN,
        chunkSize,
        delayMs,
        staleTtlHours,
        todayDiscountOnly,
        sortByDiscountHeat,
        countryScope,
      },
      platforms,
    });
  };

  syncDealsBatch = async (req: Request, res: Response): Promise<void> => {
    const appidsRaw = Array.isArray(req.body?.appids) ? req.body.appids : [];
    const appidsInput = appidsRaw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
    const requestedBatch = Number(req.body?.batchSize ?? (appidsInput.length > 0 ? appidsInput.length : 100));
    const maxCap = appidsInput.length > 0 ? 1000 : 300;
    const maxBatch = Math.max(1, Math.min(Number.isFinite(requestedBatch) ? requestedBatch : 100, maxCap));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 60), 3000));
    const cursorAppid = String(req.body?.cursorAppid ?? '').trim();
    const listDocsRaw = appidsInput.length > 0
      ? (await Promise.all(appidsInput.slice(0, maxBatch).map(async (appid: string) => this.catalog.getByAppid(appid)))).filter(Boolean)
      : await this.catalog.listByAppidCursor(cursorAppid, maxBatch);
    const listDocs = listDocsRaw as Array<{ appid: string; name?: string }>;
    const list = listDocs.map((x) => x!.appid);

    const cfg = await this.settings.getDiscountProviders();
    const countriesFromReq = Array.isArray(req.body?.countries) ? req.body.countries : [];
    const defaultCountries = await resolveDealSyncCountryCodes(this.regionCountries);
    const countries =
      countriesFromReq.length > 0
        ? countriesFromReq.map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter(Boolean)
        : defaultCountries;
    const sourcesRaw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const sources = sourcesRaw
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => x === 'steam' || x === 'isthereanydeal' || x === 'ggdeals' || x === 'cheapshark') as DealSource[];
    const staleTtlHours = Math.max(1, Math.min(Number(req.body?.staleTtlHours ?? 6), 72));
    const stale = await this.deals.markStaleOlderThan(staleTtlHours, 1500);
    const { rows, coverage } = await this.dealBatch.executeDealSyncCore(
      listDocs,
      countries,
      sources.length > 0 ? sources : undefined,
      delayMs,
      cfg,
    );

    const success = rows.filter((x) => x.ok).length;
    const failed = rows.length - success;
    const nextCursorAppid = list.length > 0 ? list[list.length - 1] : cursorAppid;
    sendAdminOk(res, {
      total: rows.length,
      success,
      failed,
      nextCursorAppid,
      hasMore: appidsInput.length === 0 && list.length === maxBatch,
      cursorStart: cursorAppid || null,
      cursorEnd: nextCursorAppid || null,
      requestedBatchSize: maxBatch,
      staleMarked: stale.staleMarked,
      staleScanned: stale.scanned,
      coverage: Array.from(coverage.entries()).map(([source, v]) => ({ source, ...v })),
      rows,
    });
  };

  syncDealsHotTop = async (req: Request, res: Response): Promise<void> => {
    const topN = Math.max(1, Math.min(Number(req.body?.topN ?? 1000), 1000));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 60), 3000));
    const sourcesRaw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const sources = sourcesRaw
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => x === 'steam' || x === 'isthereanydeal' || x === 'ggdeals' || x === 'cheapshark') as DealSource[];
    const hotRows = await this.catalog.queryForAdmin({ page: 1, pageSize: topN, sortBy: 'online_desc' });
    req.body = {
      ...req.body,
      appids: hotRows.map((r) => r.appid),
      batchSize: topN,
      delayMs,
      sources,
      cursorAppid: '',
    };
    await this.syncDealsBatch(req, res);
  };

  upsertDealLink = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const dealId = req.params.dealId ? String(req.params.dealId).trim() : undefined;
    let source = String(req.body?.source ?? '').trim().toLowerCase() as DealSource;
    let url = String(req.body?.url ?? '').trim();
    if (dealId && (!source || !url)) {
      const oldRows = await this.deals.listByAppid(appid);
      const old = oldRows.find((x) => x.dealId === dealId);
      if (old) {
        source = source || old.source;
        url = url || old.url;
      }
    }
    if (!source) source = 'manual';
    if (!url) {
      sendAdminFail(res, 400, 'url required');
      return;
    }
    const row = await this.deals.upsertForApp(appid, {
      dealId,
      source,
      url,
      isAffiliate: req.body?.isAffiliate,
      isActive: req.body?.isActive,
      priority: req.body?.priority,
      startAt: req.body?.startAt,
      endAt: req.body?.endAt,
    });
    const bestDeal = this.deals.pickBestDeal(appid, await this.deals.listByAppid(appid), {
      steamStoreUrl: `https://store.steampowered.com/app/${appid}`,
    });
    sendAdminOk(res, {
      deal: {
        ...row,
        countryCode: row.countryCode ?? 'US',
        startAt: row.startAt ? row.startAt.toDate().toISOString() : null,
        endAt: row.endAt ? row.endAt.toDate().toISOString() : null,
        lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toDate().toISOString() : null,
        lastPriceSyncAt: row.lastPriceSyncAt ? row.lastPriceSyncAt.toDate().toISOString() : null,
        createdAt: row.createdAt ? row.createdAt.toDate().toISOString() : null,
        updatedAt: row.updatedAt ? row.updatedAt.toDate().toISOString() : null,
      },
      bestDeal,
    });
  };

  loadReviews = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const maxReviews = Math.max(1, Math.min(Number(req.query.maxReviews ?? req.body?.maxReviews ?? 50), 100));
    const reviewPack = await this.store.fetchSteamReviews(appid, { maxReviews });
    await this.catalog.saveReviews(appid, reviewPack.summary, reviewPack.reviews as Array<Record<string, unknown>>);
    sendAdminOk(res, { loaded: true, appid, reviewCount: reviewPack.reviews.length, maxReviews });
  };

}

