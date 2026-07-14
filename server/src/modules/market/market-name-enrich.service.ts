import NodeCache from 'node-cache';
import type { Env } from '../../config/env';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import { SteamStoreService } from '../steam/steam-store.service';
import { RegionCountryRepository } from '../config/region-country.repository';
import { isPlaceholderMarketName } from './market-name.util';

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

export class MarketNameEnrichService {
  private catalog = new GameCatalogRepository();
  private store: SteamStoreService;
  private regions = new RegionCountryRepository();

  constructor(private env: Env) {
    this.store = new SteamStoreService(env);
  }

  async resolveName(appid: string, countryCode: string, currentName?: string | null): Promise<string | null> {
    const id = String(appid ?? '').trim();
    if (!id || !isPlaceholderMarketName(currentName, id)) return null;

    const cacheKey = `${countryCode}:${id}`;
    const hit = cache.get<string>(cacheKey);
    if (hit) return hit;

    const catalogDoc = await this.catalog.getByAppid(id);
    const catalogName = String(catalogDoc?.name ?? '').trim();
    if (catalogName && !isPlaceholderMarketName(catalogName, id)) {
      cache.set(cacheKey, catalogName);
      return catalogName;
    }

    try {
      const cc = String(countryCode ?? 'US').trim().toUpperCase();
      const resolved = await this.regions.resolveForRegionalDetail(cc);
      const detail = await this.store.fetchAppDetails(id, {
        cc: resolved.steamCc,
        language: resolved.steamLanguage,
      });
      const steamName = String(detail?.name ?? '').trim();
      if (steamName && !isPlaceholderMarketName(steamName, id)) {
        cache.set(cacheKey, steamName);
        return steamName;
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
