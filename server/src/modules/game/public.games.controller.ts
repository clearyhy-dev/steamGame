import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameDealLinkRepository } from './game-deal-link.repository';
import { verifyJwt } from '../../config/jwt';
import { UsersRepository } from '../users/users.repository';
import { SteamRepository } from '../steam/steam.repository';
import { SteamStoreService } from '../steam/steam-store.service';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { GameDiscountSyncService } from './game-discount-sync.service';

export class PublicGamesController {
  private users = new UsersRepository();
  private steamRepo = new SteamRepository();
  private store: SteamStoreService;
  private settings = new AdminSettingsRepository();
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

