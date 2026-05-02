import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameDealLinkRepository, type GameDealLinkDoc } from './game-deal-link.repository';
import { verifyJwt } from '../../config/jwt';
import { UsersRepository } from '../users/users.repository';
import { SteamRepository } from '../steam/steam.repository';
import { SteamStoreService } from '../steam/steam-store.service';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { GameDiscountSyncService } from './game-discount-sync.service';
import { RegionCountryRepository } from '../config/region-country.repository';

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

  constructor(
    private env: Env,
    private repo = new GameCatalogRepository(),
    private deals = new GameDealLinkRepository(),
  ) {
    this.store = new SteamStoreService(env);
    this.discountSync = new GameDiscountSyncService(env, this.deals);
  }

  private normalizeCountryCode(v: unknown): string | undefined {
    const s = String(v ?? '').trim().toUpperCase();
    if (!s) return undefined;
    return /^[A-Z]{2}$/.test(s) ? s : undefined;
  }

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
    const rs = await this.settings.getRegionSettings();
    const fallbackCc = (String(rs.fallbackCountry ?? 'US').trim().toUpperCase() || 'US') as string;
    const resolved = await this.regionCountries.resolveForRegionalDetail(appCountry);
    try {
      const detail = await this.store.fetchRegionalPriceDetail(
        appid,
        resolved.steamCc,
        resolved.steamLanguage,
        { fallbackSteamCc: fallbackCc },
      );
      const links = await this.deals.listByAppid(appid);
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
        steamPrice,
        localDeals: localDeals.map(serializeDealLink),
        globalDeals: globalDeals.map(serializeDealLink),
        localBestDeal: localBest ? serializeDealLink(localBest) : null,
        globalLowestDeal: globalBest ? serializeDealLink(globalBest) : null,
        warnings: {
          showRegionWarning: rs.showRegionWarning === true,
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
      discountUrl: doc?.discountUrl ?? '',
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
    sendAdminOk(res, {
      appid,
      countryCode,
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
        currentPlayers: detail.currentPlayers ?? 0,
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

