import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { SteamStoreService } from '../steam/steam-store.service';
import { VideoRepository } from '../video/video.repository';
import { serializeVideo } from '../video/video.serializer';
import { fetchSteamTrailerMp4 } from '../video/steam-trailer.util';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import { GameDealLinkRepository, type DealSource } from '../game/game-deal-link.repository';
import { GameDiscountSyncService } from '../game/game-discount-sync.service';
import { AdminSettingsRepository } from './admin.settings.repository';
import { logger } from '../../utils/logger';
import admin from 'firebase-admin';
import { SteamSyncJobRepository } from '../steam/steam-sync-job.repository';

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AdminGamesController {
  private videos = new VideoRepository();
  private store: SteamStoreService;
  private catalog = new GameCatalogRepository();
  private deals = new GameDealLinkRepository();
  private discountSync: GameDiscountSyncService;
  private settings = new AdminSettingsRepository();
  private syncJobs = new SteamSyncJobRepository();
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.store = new SteamStoreService(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals);
  }

  private async mergeTrailerUrls(
    appid: string,
    storeTrailerUrls: string[],
    relatedVideoUrls: string[],
  ): Promise<string[]> {
    let urls = Array.from(new Set([...(storeTrailerUrls ?? []).filter(Boolean), ...(relatedVideoUrls ?? []).filter(Boolean)]));
    try {
      const t = await fetchSteamTrailerMp4(this.env, appid);
      if (t.mp4Url) urls = Array.from(new Set([t.mp4Url, ...urls]));
    } catch (_) {}
    return urls.slice(0, 8);
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
    const hasDetailSyncedRaw = String(req.query.has_detail_synced ?? '').trim().toLowerCase();
    const hasDetailSynced = hasDetailSyncedRaw
      ? hasDetailSyncedRaw === '1' || hasDetailSyncedRaw === 'true'
      : hasDetailSyncedRaw === '0' || hasDetailSyncedRaw === 'false'
        ? false
        : undefined;
    const page = Math.max(1, Math.trunc(Number(req.query.page ?? 1)));
    const pageSize = Math.max(1, Math.min(Number(req.query.pageSize ?? 100), 500));
    const sortByRaw = String(req.query.sortBy ?? 'online_desc').trim().toLowerCase();
    const sortBy = (sortByRaw === 'updated_desc' || sortByRaw === 'discount_desc' ? sortByRaw : 'online_desc') as
      | 'online_desc'
      | 'updated_desc'
      | 'discount_desc';

    const [videoRows, catalogRows, total] = await Promise.all([
      this.videos.list({ limit: 2000 }),
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
    const activeDealMap = await this.deals.listActiveByAppids(catalogRows.map((r) => r.appid));

    const videoCountByAppid = new Map<string, number>();
    for (const v of videoRows) {
      const appid = String(v.gameId ?? '').trim();
      if (!appid) continue;
      videoCountByAppid.set(appid, (videoCountByAppid.get(appid) ?? 0) + 1);
    }

    const rows = catalogRows
      .filter((r) => !!r.appid)
      .map((r) => {
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
        };
      })
      .filter((r) => (hasDealLink === undefined ? true : r.hasDealLink === hasDealLink))
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

    sendAdminOk(res, { total, page, pageSize, rows });
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

    const [catalogDoc, reviewDoc, relatedVideos, dealLinks] = await Promise.all([
      this.catalog.getByAppid(appid),
      this.catalog.getReviews(appid),
      this.videos.list({ gameId: appid, limit: 1000 }),
      this.deals.listByAppid(appid),
    ]);

    if (!catalogDoc) {
      sendAdminFail(res, 404, 'Game not found in server catalog. Please sync app list first.');
      return;
    }

    const bestDeal = this.deals.pickBestDeal(appid, dealLinks, {
      steamDiscountPercent: catalogDoc.discountPercent ?? 0,
      steamStoreUrl: catalogDoc.steamStoreUrl,
    });

    sendAdminOk(res, {
      game: {
        appid: catalogDoc.appid,
        name: catalogDoc.name,
        headerImage: catalogDoc.headerImage,
        screenshots: catalogDoc.screenshots ?? [],
        trailerUrls: catalogDoc.trailerUrls ?? [],
        discountUrl: catalogDoc.discountUrl ?? '',
        steamStoreUrl: catalogDoc.steamStoreUrl ?? `https://store.steampowered.com/app/${appid}`,
        shortDescription: catalogDoc.shortDescription ?? '',
        developers: catalogDoc.developers ?? [],
        publishers: catalogDoc.publishers ?? [],
        categories: catalogDoc.categories ?? [],
        genres: catalogDoc.genres ?? [],
        tags: catalogDoc.tags ?? [],
        discountPercent: catalogDoc.discountPercent ?? 0,
        currentPlayers: catalogDoc.currentPlayers ?? 0,
        clickCount: catalogDoc.clickCount ?? 0,
        lastDetailSyncAt: catalogDoc.lastDetailSyncAt ? catalogDoc.lastDetailSyncAt.toDate().toISOString() : null,
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
    const trailerUrls = await this.mergeTrailerUrls(appid, detail.trailerUrls ?? [], fallbackVideoUrls);

    await this.catalog.upsertMeta({
      appid,
      name: detail.name,
      headerImage: detail.headerImage,
      capsuleImage: detail.capsuleImage,
      screenshots: detail.screenshots ?? [],
      trailerUrls,
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
      currentPlayers: detail.currentPlayers ?? 0,
    });

    sendAdminOk(res, { synced: true, appid });
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
      const trailerUrls = await this.mergeTrailerUrls(appid, detail.trailerUrls ?? [], fallbackVideoUrls);
      await this.catalog.upsertMeta({
        appid,
        name: detail.name,
        headerImage: detail.headerImage,
        capsuleImage: detail.capsuleImage,
        screenshots: detail.screenshots ?? [],
        trailerUrls,
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
        currentPlayers: detail.currentPlayers ?? 0,
      });
      logger.info(`[admin.games.syncDetailOne] done appid=${appid}`);
      sendAdminOk(res, { synced: true, appid });
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
            if (!detail) return { appid, ok: false, status: 'failed', message: 'not_found' };
            const relatedVideos = await this.videos.list({ gameId: appid, limit: 100 });
            const fallbackVideoUrls = relatedVideos
              .map((v) => v.playbackUrl || v.signedPlaybackUrl || '')
              .filter((u) => !!u) as string[];
            const trailerUrls = await this.mergeTrailerUrls(appid, detail.trailerUrls ?? [], fallbackVideoUrls);
            await this.catalog.upsertMeta({
              appid,
              name: detail.name,
              headerImage: detail.headerImage,
              capsuleImage: detail.capsuleImage,
              screenshots: detail.screenshots ?? [],
              trailerUrls,
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
              currentPlayers: detail.currentPlayers ?? 0,
            });
            return {
              appid,
              ok: true,
              status: 'synced',
              name: detail.name,
              currentPlayers: detail.currentPlayers ?? 0,
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
    const countriesFromCfg = String(cfg.dealCountriesCsv ?? '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    const countries =
      countriesFromReq.length > 0
        ? countriesFromReq.map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter(Boolean)
        : countriesFromCfg.length > 0
          ? countriesFromCfg
          : ['US'];
    const sourcesRaw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const sources = sourcesRaw
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => x === 'steam' || x === 'isthereanydeal' || x === 'ggdeals' || x === 'cheapshark') as DealSource[];
    const out = await this.discountSync.syncAppDeals(appid, {
      itadApiKey: cfg.itadApiKey,
      ggDealsApiKey: cfg.ggDealsApiKey,
      itadBaseUrl: cfg.itadBaseUrl,
      ggDealsBaseUrl: cfg.ggDealsBaseUrl,
      cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
      countries,
      sources: sources.length > 0 ? sources : undefined,
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
    if (out.upserted <= 0) {
      const providerMsg = out.providers.map((p) => `${p.source}:${p.ok ? 'ok' : p.reason || 'failed'}`).join(', ');
      sendAdminFail(res, 502, `No discount offers fetched for appid=${appid}. providers=[${providerMsg}]`);
      return;
    }
    const bestDeal = this.deals.pickBestDeal(appid, await this.deals.listByAppid(appid), {
      steamDiscountPercent: out.offers.find((x) => x.source === 'steam')?.discountPercent ?? 0,
      steamStoreUrl: `https://store.steampowered.com/app/${appid}`,
    });
    await this.catalog.setDiscountUrl(appid, bestDeal.url);
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

  syncDealsBatch = async (req: Request, res: Response): Promise<void> => {
    const maxBatch = Math.max(1, Math.min(Number(req.body?.batchSize ?? 100), 300));
    const delayMs = Math.max(0, Math.min(Number(req.body?.delayMs ?? 60), 3000));
    const cursorAppid = String(req.body?.cursorAppid ?? '').trim();
    const appidsRaw = Array.isArray(req.body?.appids) ? req.body.appids : [];
    const appidsInput = appidsRaw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
    const listDocsRaw = appidsInput.length > 0
      ? (await Promise.all(appidsInput.slice(0, maxBatch).map(async (appid: string) => this.catalog.getByAppid(appid)))).filter(Boolean)
      : await this.catalog.listByAppidCursor(cursorAppid, maxBatch);
    const listDocs = listDocsRaw as Array<{ appid: string; name?: string }>;
    const list = listDocs.map((x) => x!.appid);

    const cfg = await this.settings.getDiscountProviders();
    const countriesFromReq = Array.isArray(req.body?.countries) ? req.body.countries : [];
    const countriesFromCfg = String(cfg.dealCountriesCsv ?? '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    const countries =
      countriesFromReq.length > 0
        ? countriesFromReq.map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter(Boolean)
        : countriesFromCfg.length > 0
          ? countriesFromCfg
          : ['US'];
    const sourcesRaw = Array.isArray(req.body?.sources) ? req.body.sources : [];
    const sources = sourcesRaw
      .map((x: unknown) => String(x ?? '').trim().toLowerCase())
      .filter((x: string) => x === 'steam' || x === 'isthereanydeal' || x === 'ggdeals' || x === 'cheapshark') as DealSource[];
    const staleTtlHours = Math.max(1, Math.min(Number(req.body?.staleTtlHours ?? 6), 72));
    const stale = await this.deals.markStaleOlderThan(staleTtlHours, 1500);
    const rows: Array<{ appid: string; name?: string; ok: boolean; upserted: number; inserted?: number; updated?: number; deduped?: number; message?: string }> = [];
    const coverage = new Map<string, { ok: number; empty: number; failed: number }>();
    const bump = (source: string, kind: 'ok' | 'empty' | 'failed') => {
      const cur = coverage.get(source) ?? { ok: 0, empty: 0, failed: 0 };
      cur[kind] += 1;
      coverage.set(source, cur);
    };
    for (const appid of list) {
      try {
        const out = await this.discountSync.syncAppDeals(appid, {
          itadApiKey: cfg.itadApiKey,
          ggDealsApiKey: cfg.ggDealsApiKey,
          itadBaseUrl: cfg.itadBaseUrl,
          ggDealsBaseUrl: cfg.ggDealsBaseUrl,
          cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
          countries,
          sources: sources.length > 0 ? sources : undefined,
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
        if (out.upserted > 0) {
          const bestDeal = this.deals.pickBestDeal(appid, await this.deals.listByAppid(appid), {
            steamDiscountPercent: out.offers.find((x) => x.source === 'steam')?.discountPercent ?? 0,
            steamStoreUrl: `https://store.steampowered.com/app/${appid}`,
          });
          await this.catalog.setDiscountUrl(appid, bestDeal.url);
          const name = listDocs.find((x) => x?.appid === appid)?.name;
          rows.push({
            appid,
            name,
            ok: true,
            upserted: out.upserted,
            inserted: out.writeStats.inserted,
            updated: out.writeStats.updated,
            deduped: out.writeStats.deduped,
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

    const success = rows.filter((x) => x.ok).length;
    const failed = rows.length - success;
    const nextCursorAppid = list.length > 0 ? list[list.length - 1] : cursorAppid;
    sendAdminOk(res, {
      total: rows.length,
      success,
      failed,
      nextCursorAppid,
      hasMore: rows.length === maxBatch,
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
    const topN = Math.max(1, Math.min(Number(req.body?.topN ?? 100), 300));
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
    await this.catalog.setDiscountUrl(appid, bestDeal.url);
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
    const maxPages = Math.max(1, Math.min(Number(req.query.maxPages ?? 20), 200));
    const reviewPack = await this.store.fetchSteamReviews(appid, { all: true, maxPages });
    await this.catalog.saveReviews(appid, reviewPack.summary, reviewPack.reviews as Array<Record<string, unknown>>);
    sendAdminOk(res, { loaded: true, appid, reviewCount: reviewPack.reviews.length });
  };

  patch = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const discountUrl = String(req.body?.discountUrl ?? '').trim();
    await this.catalog.setDiscountUrl(appid, discountUrl);
    sendAdminOk(res, {
      appid,
      discountUrl,
    });
  };
}

