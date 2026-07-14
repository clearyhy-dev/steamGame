import type { Env } from '../../config/env';
import { FavoritesRepository } from '../favorites/favorites.repository';
import { UsersRepository } from '../users/users.repository';
import { sqliteGetMarketGame } from '../../storage/sqlite/market-games.store';
import { useSqliteRelationalStore } from '../../config/database';
import { ApiError } from '../../utils/apiError';

export type FavoritePriceItem = {
  appid: string;
  name: string;
  priceSummary: unknown;
  discountPercent: number | null;
  currency: string | null;
  syncedAt: number | null;
};

export class FavoritesPricesService {
  private favorites = new FavoritesRepository();
  private users = new UsersRepository();

  constructor(_env: Env) {}

  async listPrices(userId: string, country?: string): Promise<{
    countryCode: string;
    currency: string | null;
    items: FavoritePriceItem[];
  }> {
    if (!useSqliteRelationalStore()) {
      throw new ApiError(503, 'INTERNAL_ERROR', 'Favorites prices require vultr_sqlite data store');
    }
    const user = await this.users.findById(userId);
    const cc = (country ?? user?.countryCode ?? 'US').trim().toUpperCase();
    const favs = await this.favorites.listFavorites(userId);
    const items: FavoritePriceItem[] = [];
    let currency: string | null = null;

    for (const f of favs) {
      const appid = String(f.appid ?? '').trim();
      if (!appid) continue;
      const market = await sqliteGetMarketGame(cc, appid);
      if (market?.currency && !currency) currency = market.currency;
      items.push({
        appid,
        name: market?.name ?? f.name ?? appid,
        priceSummary: market?.priceSummary ?? null,
        discountPercent: market?.discountPercent ?? null,
        currency: market?.currency ?? null,
        syncedAt: market?.priceSyncedAtMs ?? null,
      });
    }

    return { countryCode: cc, currency, items };
  }
}
