import type { GameCountryPriceBucket, RegionalSourcePriceSnapshot } from '../game/game-catalog.repository';
import type { ResolvedCountryForSteam } from '../config/region-country.repository';
import { ggDealsRegionFromSteamCc } from '../config/deal-provider-region.catalog';
import { buildRegionalSteamStoreAppUrl } from '../steam/steam-store-url.util';
import { buildItadGamePageUrl, isSteamStoreUrl } from '../game/itad-url.util';
import type { SteamStoreGameDetail } from '../steam/steam-store.service';

const INT_LIKE_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX']);

export type MarketPlatformPriceCell = {
  originalPrice: number | null;
  finalPrice: number | null;
  discountPercent: number | null;
  currency: string | null;
  url: string | null;
};

export type MarketGamePriceSummary = {
  originalPrice: number | null;
  finalPrice: number | null;
  discountPercent: number | null;
  steamStoreUrl: string | null;
  platforms: {
    steam: MarketPlatformPriceCell;
    isthereanydeal: MarketPlatformPriceCell;
    ggdeals: MarketPlatformPriceCell;
    cheapshark: MarketPlatformPriceCell;
  };
};

function legacyCentScaledJpy(amount: number): number | null {
  if (amount <= 5000 || amount > 999999 || amount % 100 !== 0) return null;
  const d = amount / 100;
  if (d >= 500 && d <= 50000) return d;
  return null;
}

function steamMinorToDisplay(amount: number | null | undefined, currency: string | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const c = String(currency ?? 'USD')
    .trim()
    .toUpperCase();
  if (INT_LIKE_CURRENCIES.has(c)) {
    if (c === 'JPY') {
      return legacyCentScaledJpy(amount) ?? amount;
    }
    return amount;
  }
  return amount / 100;
}

const EMPTY_PLATFORM_CELL: MarketPlatformPriceCell = {
  originalPrice: null,
  finalPrice: null,
  discountPercent: null,
  currency: null,
  url: null,
};

function cellFromSnapshotOrEmpty(
  snap: RegionalSourcePriceSnapshot | undefined,
  opts?: { priceSyncOk?: boolean; steamMinorUnits?: boolean },
): MarketPlatformPriceCell {
  if (!snap || snap.error) return EMPTY_PLATFORM_CELL;
  if (opts?.priceSyncOk === false) return EMPTY_PLATFORM_CELL;
  const cell = cellFromSnapshot(snap, { steamMinorUnits: opts?.steamMinorUnits });
  if (cell.finalPrice == null && cell.originalPrice == null) return EMPTY_PLATFORM_CELL;
  return cell;
}

/** 旧版 GG 在美国区静默回退写入的价格；非 US 区应视为无效 */
function isLegacyGgUsFallback(cell: MarketPlatformPriceCell, expectedGgRegion: string): boolean {
  const region = String(expectedGgRegion || 'us')
    .trim()
    .toLowerCase();
  if (region === 'us') return false;
  const url = String(cell.url ?? '');
  if (!url) return false;
  return /[?&]region=us(?:&|$|#)/i.test(url) && !new RegExp(`[?&]region=${region}(?:&|$|#)`, 'i').test(url);
}

function cellFromSnapshot(
  snap: RegionalSourcePriceSnapshot | undefined,
  opts?: { steamMinorUnits?: boolean },
): MarketPlatformPriceCell {
  const currency = snap?.currency ? String(snap.currency).trim().toUpperCase() : null;
  const origRaw = typeof snap?.originalPrice === 'number' ? snap.originalPrice : null;
  const finRaw = typeof snap?.finalPrice === 'number' ? snap.finalPrice : null;
  const originalPrice = opts?.steamMinorUnits ? steamMinorToDisplay(origRaw, currency) : origRaw;
  const finalPrice = opts?.steamMinorUnits ? steamMinorToDisplay(finRaw, currency) : finRaw;
  return {
    originalPrice,
    finalPrice,
    discountPercent: typeof snap?.discountPercent === 'number' ? snap.discountPercent : null,
    currency,
    url: snap?.url ? String(snap.url) : null,
  };
}

function fixItadCell(
  cell: MarketPlatformPriceCell,
  bucket: GameCountryPriceBucket | null,
  appid: string,
): MarketPlatformPriceCell {
  const u = String(cell.url ?? '');
  if (u && !isSteamStoreUrl(u)) return cell;
  const gid = bucket?.itadDetail?.itadGameId;
  const nextUrl = buildItadGamePageUrl({ itadGameId: gid, steamAppid: appid });
  return { ...cell, url: nextUrl };
}

export function buildMarketGamePriceSummary(input: {
  countryCode: string;
  appid: string;
  resolved: ResolvedCountryForSteam;
  bucket: GameCountryPriceBucket | null;
  detail?: Pick<SteamStoreGameDetail, 'priceInitial' | 'priceFinal' | 'discountPercent' | 'steamStoreUrl' | 'isFree'> | null;
}): MarketGamePriceSummary {
  const { countryCode, appid, resolved, bucket, detail } = input;
  const cc = countryCode.toUpperCase();
  const steamCc = String(bucket?.steamCc ?? resolved.steamCc ?? cc)
    .trim()
    .toLowerCase()
    .slice(0, 2);
  const steamStoreUrl =
    detail?.steamStoreUrl ??
    bucket?.steam?.url ??
    buildRegionalSteamStoreAppUrl(appid, steamCc, resolved.steamLanguage);

  const steam = cellFromSnapshotOrEmpty(bucket?.steam, { steamMinorUnits: true });
  if (steam.finalPrice == null && detail) {
    const cur = resolved.defaultCurrency;
    steam.originalPrice =
      steam.originalPrice ??
      (detail.isFree ? 0 : steamMinorToDisplay(detail.priceInitial, cur));
    steam.finalPrice =
      steam.finalPrice ?? (detail.isFree ? 0 : steamMinorToDisplay(detail.priceFinal, cur));
    steam.discountPercent = steam.discountPercent ?? detail.discountPercent ?? null;
    steam.currency = steam.currency ?? cur;
    steam.url = steam.url ?? steamStoreUrl;
  }

  const ggExpectedRegion = String(bucket?.ggDetail?.ggApiRegion ?? ggDealsRegionFromSteamCc(resolved.steamCc))
    .trim()
    .toLowerCase();
  let ggdeals = cellFromSnapshotOrEmpty(bucket?.ggdeals, { priceSyncOk: bucket?.ggDetail?.priceSyncOk });
  if (isLegacyGgUsFallback(ggdeals, ggExpectedRegion)) {
    ggdeals = EMPTY_PLATFORM_CELL;
  }

  const platforms = {
    steam,
    isthereanydeal: fixItadCell(cellFromSnapshot(bucket?.isthereanydeal), bucket, appid),
    ggdeals,
    cheapshark: cellFromSnapshot(bucket?.cheapshark),
  };

  return {
    originalPrice: steam.originalPrice,
    finalPrice: steam.finalPrice,
    discountPercent: steam.discountPercent,
    steamStoreUrl,
    platforms,
  };
}

export function parseMarketGamePriceSummary(raw: unknown): MarketGamePriceSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const platformsRaw = o.platforms;
  if (!platformsRaw || typeof platformsRaw !== 'object') return null;
  const p = platformsRaw as Record<string, unknown>;
  const readCell = (v: unknown): MarketPlatformPriceCell => {
    const c = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      originalPrice: typeof c.originalPrice === 'number' ? c.originalPrice : null,
      finalPrice: typeof c.finalPrice === 'number' ? c.finalPrice : null,
      discountPercent: typeof c.discountPercent === 'number' ? c.discountPercent : null,
      currency: typeof c.currency === 'string' ? c.currency : null,
      url: typeof c.url === 'string' ? c.url : null,
    };
  };
  return {
    originalPrice: typeof o.originalPrice === 'number' ? o.originalPrice : null,
    finalPrice: typeof o.finalPrice === 'number' ? o.finalPrice : null,
    discountPercent: typeof o.discountPercent === 'number' ? o.discountPercent : null,
    steamStoreUrl: typeof o.steamStoreUrl === 'string' ? o.steamStoreUrl : null,
    platforms: {
      steam: readCell(p.steam),
      isthereanydeal: readCell(p.isthereanydeal),
      ggdeals: readCell(p.ggdeals),
      cheapshark: readCell(p.cheapshark),
    },
  };
}
