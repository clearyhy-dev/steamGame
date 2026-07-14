import type { Env } from '../../config/env';
import { sqliteGetMarketGame } from '../../storage/sqlite/market-games.store';
import { useSqliteRelationalStore } from '../../config/database';
import type { MarketGamePriceSummary, MarketPlatformPriceCell } from '../market/market-price-summary.util';
import type { FavoriteBaselinePrices, FavoritePlatformBaseline } from './favorites.types';

function cellToBaseline(cell: MarketPlatformPriceCell | undefined): FavoritePlatformBaseline | undefined {
  if (!cell || cell.finalPrice == null || !Number.isFinite(cell.finalPrice)) return undefined;
  const currency = String(cell.currency ?? 'USD').trim().toUpperCase() || 'USD';
  return {
    finalPrice: cell.finalPrice,
    currency,
    url: cell.url ?? undefined,
    originalPrice: cell.originalPrice,
    discountPercent: cell.discountPercent,
  };
}

function lowestFromPlatforms(
  platforms: FavoriteBaselinePrices['platforms'],
): { price: number; currency: string } | null {
  const cells = [platforms.steam, platforms.isthereanydeal, platforms.ggdeals].filter(Boolean) as FavoritePlatformBaseline[];
  if (cells.length === 0) return null;
  let best = cells[0];
  for (const c of cells.slice(1)) {
    if (c.finalPrice < best.finalPrice) best = c;
  }
  return { price: best.finalPrice, currency: best.currency };
}

export class FavoritesBaselineService {
  constructor(_env: Env) {}

  async captureForApp(userCountryCode: string, appid: string): Promise<FavoriteBaselinePrices | null> {
    if (!useSqliteRelationalStore()) return null;
    const cc = String(userCountryCode ?? 'US').trim().toUpperCase();
    const id = String(appid ?? '').trim();
    if (!cc || !id) return null;

    const market = await sqliteGetMarketGame(cc, id);
    const ps = market?.priceSummary as MarketGamePriceSummary | null | undefined;
    if (!ps?.platforms) return null;

    const platforms = {
      steam: cellToBaseline(ps.platforms.steam),
      isthereanydeal: cellToBaseline(ps.platforms.isthereanydeal),
      ggdeals: cellToBaseline(ps.platforms.ggdeals),
    };
    const lowest = lowestFromPlatforms(platforms);
    if (!lowest) return null;

    return {
      countryCode: cc,
      capturedAt: new Date().toISOString(),
      platforms,
      lowestFinalPrice: lowest.price,
      lowestCurrency: lowest.currency,
    };
  }
}

export function currentLowestFromSummary(priceSummary: unknown): { price: number; currency: string } | null {
  const ps = priceSummary as MarketGamePriceSummary | null | undefined;
  if (!ps?.platforms) return null;
  const platforms = {
    steam: cellToBaseline(ps.platforms.steam),
    isthereanydeal: cellToBaseline(ps.platforms.isthereanydeal),
    ggdeals: cellToBaseline(ps.platforms.ggdeals),
  };
  return lowestFromPlatforms(platforms);
}

export function platformCellsFromSummary(priceSummary: unknown): FavoriteBaselinePrices['platforms'] {
  const ps = priceSummary as MarketGamePriceSummary | null | undefined;
  if (!ps?.platforms) return {};
  return {
    steam: cellToBaseline(ps.platforms.steam),
    isthereanydeal: cellToBaseline(ps.platforms.isthereanydeal),
    ggdeals: cellToBaseline(ps.platforms.ggdeals),
  };
}
