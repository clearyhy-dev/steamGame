import type { Request, Response } from 'express';
import axios from 'axios';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameDealLinkRepository, type GameDealLinkDoc } from './game-deal-link.repository';
import { GameDiscountOffersRepository } from './game-discount-offers.repository';
import { verifyJwt } from '../../config/jwt';
import { UsersRepository } from '../users/users.repository';
import { SteamRepository } from '../steam/steam.repository';
import { SteamStoreService } from '../steam/steam-store.service';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { GameDiscountSyncService } from './game-discount-sync.service';
import { RegionCountryRepository } from '../config/region-country.repository';
import { serializeByCountryMap, serializeGameCountryBucket } from './game-by-country.serialize';
import { CACHE_DEFAULT_TTL_SEC, cacheService } from '../../cache/cacheService';
import { DealAggregatorService, type AggregatedDealCard } from './deal-aggregator.service';
import { downloadJsonBuffer } from '../video/gcs.service';

function serializeDealLink(d: GameDealLinkDoc): Record<string, unknown> {
  return {
    dealId: d.dealId,
    appid: d.appid,
    source: d.source,
    url: d.url,
    isAffiliate: d.isAffiliate,
    isActive: d.isActive,
    priority: d.priority,
    countryCode: d.countryCode,
    currency: d.currency,
    originalPrice: d.originalPrice,
    finalPrice: d.finalPrice,
    discountPercent: d.discountPercent,
    offerStatus: d.offerStatus,
    startAt: d.startAt ? d.startAt.toDate().toISOString() : null,
    endAt: d.endAt ? d.endAt.toDate().toISOString() : null,
    lastPriceSyncAt: d.lastPriceSyncAt ? d.lastPriceSyncAt.toDate().toISOString() : null,
  };
}

/** Deal matches local storefront when country aligns or currency matches Steam listing currency. */
function isLocalDeal(d: GameDealLinkDoc, appCountry: string, steamCurrency: string): boolean {
  const cc = String(d.countryCode ?? '').trim().toUpperCase();
  const cur = String(d.currency ?? '').trim().toUpperCase();
  const sc = String(steamCurrency ?? '').trim().toUpperCase();
  if (cc && cc === appCountry) return true;
  if (cur && sc && cur === sc) return true;
  return false;
}

function parseQueryBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function pickLowestPriced(
  deals: GameDealLinkDoc[],
  dealRepo: GameDealLinkRepository,
): GameDealLinkDoc | null {
  const nowMs = Date.now();
  const active = deals.filter((l) => dealRepo.isActiveNow(l, nowMs));
  const priced = active.filter(
    (l) => typeof l.finalPrice === 'number' && l.finalPrice > 0,
  );
  if (priced.length === 0) return null;
  priced.sort((a, b) => (a.finalPrice! - b.finalPrice!) || a.priority - b.priority);
  return priced[0] ?? null;
}

export class PublicGamesController {
  private users = new UsersRepository();
  private steamRepo = new SteamRepository();
  private store: SteamStoreService;
  private settings = new AdminSettingsRepository();
  private regionCountries = new RegionCountryRepository();
  private discountSync: GameDiscountSyncService;
  private dealAgg = new DealAggregatorService();
  private deals: GameDealLinkRepository;
  private discountOffers: GameDiscountOffersRepository;

  constructor(private env: Env, private repo = new GameCatalogRepository()) {
    this.deals = new GameDealLinkRepository(env);
    this.discountOffers = new GameDiscountOffersRepository(env);
    this.store = new SteamStoreService(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals, this.repo);
  }

  private normalizeCountryCode(v: unknown): string | undefined {
    const s = String(v ?? '').trim().toUpperCase();
    if (!s) return undefined;
    return /^[A-Z]{2}$/.test(s) ? s : undefined;
  }

  private serializeCatalogRow(r: { appid: string; name: string; capsuleImage?: string; headerImage?: string; discountPercent?: number; currentPlayers?: number; priceFinal?: number; steamStoreUrl?: string }) {
    return {
      appid: r.appid,
      name: r.name,
      capsuleImage: r.capsuleImage ?? null,
      headerImage: r.headerImage ?? null,
      discountPercent: r.discountPercent ?? 0,
      currentPlayers: r.currentPlayers ?? 0,
      priceFinal: typeof r.priceFinal === 'number' ? r.priceFinal : null,
      steamStoreUrl: r.steamStoreUrl ?? `https://store.steampowered.com/app/${r.appid}`,
    };
  }

  /** GET /v1/games/catalog — 游标分页，默认 20 条（降 Firestore 无界查询） */
  catalogList = async (req: Request, res: Response): Promise<void> => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 50));
    const cursor = String(req.query.cursor ?? '').trim();
    const cacheKey = `games:catalog:v1:${cursor || '_'}:${limit}`;
    const hit = await cacheService.getCache<Record<string, unknown>>(cacheKey);
    if (hit) {
      sendAdminOk(res, hit);
      return;
    }
    const rows = await this.repo.listByAppidCursor(cursor, limit);
    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.appid ?? '' : '';
    const payload = {
      limit,
      nextCursor,
      items: rows.map((r) => this.serializeCatalogRow(r)),
    };
    await cacheService.setCache(cacheKey, payload, CACHE_DEFAULT_TTL_SEC);
    sendAdminOk(res, payload);
  };

  /**
   * GET /v1/games/search?q=&cursor=&limit=
   * 与目录列表一致：默认 limit=20，游标 `cursor` 为上一页 `nextCursor`（按 appid 扫描位置）；内存键 `games:search:*` TTL 600s。
   */
  searchGames = async (req: Request, res: Response): Promise<void> => {
    const q = String(req.query.q ?? req.query.keyword ?? '').trim();
    if (q.length < 2) {
      sendAdminFail(res, 400, 'q must be at least 2 characters');
      return;
    }
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20), 50));
    const cursor = String(req.query.cursor ?? '').trim();
    const cacheKey = `games:search:v1:${q.toLowerCase()}:${cursor || '_'}:${limit}`;
    const hit = await cacheService.getCache<Record<string, unknown>>(cacheKey);
    if (hit) {
      sendAdminOk(res, hit);
      return;
    }
    const { items, nextCursor, exhausted } = await this.repo.searchByKeywordAppidCursor({
      keyword: q,
      cursor,
      limit,
    });
    const payload = {
      q,
      limit,
      cursor: cursor || null,
      nextCursor,
      exhausted,
      items: items.map((r) => this.serializeCatalogRow(r)),
    };
    await cacheService.setCache(cacheKey, payload, CACHE_DEFAULT_TTL_SEC);
    sendAdminOk(res, payload);
  };

  /** GET /v1/games/popular-searches — 与 `cache/popular-searches.json` 对齐；CDN 优先，否则 GCS 直读，兜底静态词表 */
  popularSearches = async (_req: Request, res: Response): Promise<void> => {
    const cacheKey = 'games:popular-searches:v1:body';
    const hit = await cacheService.getCache<Record<string, unknown>>(cacheKey);
    if (hit) {
      sendAdminOk(res, hit);
      return;
    }

    const cdn = String(this.env.publicCacheCdnBase ?? '').trim().replace(/\/+$/, '');
    if (cdn) {
      try {
        const url = `${cdn}/cache/popular-searches.json`;
        const r = await axios.get<unknown>(url, { timeout: 12_000, validateStatus: (s) => s === 200 });
        const raw = r.data as { generatedAt?: string; queries?: string[] };
        if (raw && typeof raw === 'object' && Array.isArray(raw.queries)) {
          const payload = { generatedAt: raw.generatedAt ?? null, queries: raw.queries };
          await cacheService.setCache(cacheKey, payload, CACHE_DEFAULT_TTL_SEC);
          sendAdminOk(res, payload);
          return;
        }
      } catch {
        // fall through to GCS / fallback
      }
    }

    if (this.env.gcsCacheBucket || this.env.videoGcsBucket || this.env.s3Bucket || this.env.r2CacheBucket) {
      const buf = await downloadJsonBuffer(this.env, 'cache/popular-searches.json');
      if (buf) {
        try {
          const raw = JSON.parse(buf.toString('utf8')) as { generatedAt?: string; queries?: string[] };
          const payload = {
            generatedAt: raw.generatedAt ?? null,
            queries: Array.isArray(raw.queries) ? raw.queries : [],
          };
          await cacheService.setCache(cacheKey, payload, CACHE_DEFAULT_TTL_SEC);
          sendAdminOk(res, payload);
          return;
        } catch {
          // fallback below
        }
      }
    }

    const fallback = {
      generatedAt: null as string | null,
      queries: ['RPG', 'open world', 'roguelike', 'multiplayer', 'indie'],
    };
    await cacheService.setCache(cacheKey, fallback, CACHE_DEFAULT_TTL_SEC);
    sendAdminOk(res, fallback);
  };

  private normalizeLanguageCode(v: unknown): string | undefined {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return undefined;
    return /^[a-z]{2}(-[a-z]{2})?$/.test(s) ? s : undefined;
  }

  private async resolveCountryCode(req: Request): Promise<string> {
    const fromQuery = this.normalizeCountryCode(req.query.country ?? req.query.cc);
    if (fromQuery) return fromQuery;

    const header = String(req.header('Authorization') ?? '');
    if (header.startsWith('Bearer ')) {
      const token = header.substring('Bearer '.length).trim();
      try {
        const payload = verifyJwt(token, this.env);
        const user = await this.users.findById(payload.userId);
        const steamId = String(user?.steamId ?? '').trim();
        if (steamId) {
          const profile = await this.steamRepo.getSteamProfile(steamId);
          const fromSteam = this.normalizeCountryCode(profile?.countryCode);
          if (fromSteam) return fromSteam;
        }
      } catch {
        // public endpoint: ignore invalid auth and fallback to default
      }
    }
    return 'US';
  }

  /** Full regional detail: Steam formatted prices + local vs global third-party deals. */
  regionalDetail = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const fromQuery = this.normalizeCountryCode(req.query.country);
    const country = fromQuery ?? (await this.resolveCountryCode(req));
    const appCountry = (country || 'US').toUpperCase();
    const resolved = await this.regionCountries.resolveForRegionalDetail(appCountry);
    const langFromQuery = this.normalizeLanguageCode(req.query.language ?? req.query.l);
    const steamLang = langFromQuery ?? resolved.steamLanguage;
    const fallbackCc = 'US' as const;
    const fullByCountry = parseQueryBool(req.query.fullByCountry);
    try {
      const countryCodesForOffers =
        fullByCountry || appCountry === 'US' ? null : [appCountry, fallbackCc];
      const [detail, snippet, offerBuckets] = await Promise.all([
        this.store.fetchRegionalPriceDetail(appid, resolved.steamCc, steamLang, { fallbackSteamCc: fallbackCc }),
        this.store.fetchStoreSnippet(appid, resolved.steamCc, steamLang),
        fullByCountry
          ? this.discountOffers.listBucketsForAppid(appid)
          : countryCodesForOffers
            ? this.discountOffers.getBucketsForAppidAndCountries(appid, countryCodesForOffers)
            : this.discountOffers.getBucketsForAppidAndCountries(appid, [appCountry]),
      ]);
      const links = await this.deals.listByAppid(appid);
      const byCountryFromOffers = this.discountOffers.toByCountryMap(offerBuckets);
      const countryBucket = byCountryFromOffers[appCountry];
      const steamCur =
        detail && !detail.isFree && detail.currency
          ? String(detail.currency).trim().toUpperCase()
          : String(resolved.defaultCurrency ?? 'USD')
              .trim()
              .toUpperCase();
      const localDeals: GameDealLinkDoc[] = [];
      const globalDeals: GameDealLinkDoc[] = [];
      for (const d of links) {
        if (isLocalDeal(d, appCountry, steamCur)) localDeals.push(d);
        else globalDeals.push(d);
      }
      const localBest = pickLowestPriced(localDeals, this.deals);
      const globalBest = pickLowestPriced(globalDeals, this.deals);

      let steamPrice: Record<string, unknown> | null = null;
      if (detail?.isFree) {
        steamPrice = {
          currency: '',
          initial: 0,
          final: 0,
          initialFormatted: '',
          finalFormatted: '',
          discountPercent: 0,
          fallbackUsed: detail.fallbackUsed,
          source: 'steam' as const,
          isFree: true,
        };
      } else if (detail && detail.currency) {
        steamPrice = {
          currency: detail.currency,
          initial: detail.initial,
          final: detail.final,
          initialFormatted: detail.initialFormatted,
          finalFormatted: detail.finalFormatted,
          discountPercent: detail.discountPercent,
          fallbackUsed: detail.fallbackUsed,
          source: detail.source,
        };
      }

      sendAdminOk(res, {
        appid,
        country: {
          countryCode: resolved.countryCode,
          countryName: resolved.countryName,
          steamCc: resolved.steamCc,
          steamLanguage: resolved.steamLanguage,
          currencySymbol: resolved.currencySymbol,
        },
        steamStoreSnippet: snippet,
        steamPrice,
        /** 多国分桶；默认仅含当前国 + US 回退（省 Firestore reads）。`?fullByCountry=1` 恢复全量查询 */
        byCountry: serializeByCountryMap(byCountryFromOffers),
        byCountryScope: fullByCountry ? 'full' : appCountry === 'US' ? 'us_only' : 'current_plus_us',
        /** 当前请求国家的分桶（含 ITAD 扩展、值得买指数等） */
        countryPriceBucket: countryBucket ? serializeGameCountryBucket(countryBucket) : null,
        localDeals: localDeals.map(serializeDealLink),
        globalDeals: globalDeals.map(serializeDealLink),
        localBestDeal: localBest ? serializeDealLink(localBest) : null,
        globalLowestDeal: globalBest ? serializeDealLink(globalBest) : null,
        warnings: {
          showRegionWarning: detail?.fallbackUsed === true,
        },
      });
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : 'regional detail failed');
    }
  };

  steamPrice = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const country = this.normalizeCountryCode(req.query.country ?? req.query.cc) ?? (await this.resolveCountryCode(req));
    const language = String(req.query.language ?? req.query.l ?? 'en').trim() || 'en';

    try {
      const row = await this.store.fetchRegionalPrice(appid, country, language);
      if (!row) {
        sendAdminFail(res, 404, 'Steam price not found');
        return;
      }
      sendAdminOk(res, row);
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : 'steam price failed');
    }
  };

  discountLink = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const doc = await this.repo.getByAppid(appid);
    const countryCode = await this.resolveCountryCode(req);
    const links = await this.deals.listByAppid(appid);
    const scopedLinks = links.filter(
      (d) => String(d.countryCode ?? 'US').toUpperCase() === countryCode,
    );
    const fallbackLinks = scopedLinks.length > 0 ? scopedLinks : links;
    const bestDeal = this.deals.pickBestDeal(appid, fallbackLinks, {
      steamDiscountPercent: doc?.discountPercent ?? 0,
      steamStoreUrl: doc?.steamStoreUrl,
    });
    sendAdminOk(res, {
      appid,
      countryCode,
      discountUrl: bestDeal.url ?? '',
      bestDeal,
      steamDiscountPercent: doc?.discountPercent ?? 0,
      steamStoreUrl: doc?.steamStoreUrl ?? `https://store.steampowered.com/app/${appid}`,
    });
  };

  listDeals = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    const doc = await this.repo.getByAppid(appid);
    const countryCode = await this.resolveCountryCode(req);
    const links = await this.deals.listByAppid(appid);
    const scopedLinks = links.filter(
      (d) => String(d.countryCode ?? 'US').toUpperCase() === countryCode,
    );
    const fallbackLinks = scopedLinks.length > 0 ? scopedLinks : links;
    const bestDeal = this.deals.pickBestDeal(appid, fallbackLinks, {
      steamDiscountPercent: doc?.discountPercent ?? 0,
      steamStoreUrl: doc?.steamStoreUrl,
    });

    let aggregated: AggregatedDealCard | null = null;
    if (doc) {
      const offerBuckets = await this.discountOffers.getBucketsForAppidAndCountries(appid, [countryCode]);
      const byCountry = this.discountOffers.toByCountryMap(offerBuckets);
      aggregated = this.dealAgg.fromCatalogAndBucket(doc, byCountry[countryCode] ?? null, countryCode);
    }

    sendAdminOk(res, {
      appid,
      countryCode,
      aggregated,
      base: {
        originalPrice: doc?.priceInitial ?? 0,
        finalPrice: doc?.priceFinal ?? 0,
        steamDiscountPercent: doc?.discountPercent ?? 0,
      },
      links: fallbackLinks.map((d) => ({
        ...d,
        isPurchasable: String(d.url ?? '').trim().length > 0,
        startAt: d.startAt ? d.startAt.toDate().toISOString() : null,
        endAt: d.endAt ? d.endAt.toDate().toISOString() : null,
        lastPriceSyncAt: d.lastPriceSyncAt ? d.lastPriceSyncAt.toDate().toISOString() : null,
        createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
        updatedAt: d.updatedAt ? d.updatedAt.toDate().toISOString() : null,
      })),
      bestDeal,
    });
  };

  ensureMeta = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    try {
      const detail = await this.store.fetchAppDetails(appid);
      if (!detail) {
        sendAdminFail(res, 404, 'Game not found from Steam');
        return;
      }
      await this.repo.upsertMeta({
        appid,
        name: detail.name,
        headerImage: detail.headerImage,
        capsuleImage: detail.capsuleImage,
        screenshots: detail.screenshots ?? [],
        trailerUrls: detail.trailerUrls ?? [],
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
      sendAdminOk(res, { appid, synced: true });
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : 'ensure meta failed');
    }
  };

  refreshDeals = async (req: Request, res: Response): Promise<void> => {
    const appid = String(req.params.appid ?? '').trim();
    if (!appid) {
      sendAdminFail(res, 400, 'appid required');
      return;
    }
    try {
      const countryCode = await this.resolveCountryCode(req);
      const cfg = await this.settings.getDiscountProviders();
      const out = await this.discountSync.syncAppDeals(appid, {
        itadApiKey: cfg.itadApiKey,
        ggDealsApiKey: cfg.ggDealsApiKey,
        itadBaseUrl: cfg.itadBaseUrl,
        ggDealsBaseUrl: cfg.ggDealsBaseUrl,
        cheapSharkBaseUrl: cfg.cheapSharkBaseUrl,
        countries: [countryCode],
        sources: ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'],
        forceRefresh: true,
      });
      sendAdminOk(res, {
        appid,
        countryCode,
        refreshed: true,
        upserted: out.upserted,
        providers: out.providers.map((p) => ({
          source: p.source,
          ok: p.ok,
          reason: p.reason ?? '',
        })),
      });
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : 'refresh deals failed');
    }
  };
}

