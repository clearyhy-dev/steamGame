import type {
  GameCountryPriceBucket,
  GgDetailSnapshot,
  ItadDetailSnapshot,
  RegionalSourcePriceSnapshot,
  WorthBuyStoredSnapshot,
} from './game-catalog.repository';
import { jsonPlain, toIsoString } from '../../utils/json-plain';

export function serializeRegionalSourcePriceSnapshot(s: RegionalSourcePriceSnapshot | undefined) {
  if (!s) return undefined;
  return jsonPlain({
    url: s.url,
    currency: s.currency,
    originalPrice: s.originalPrice,
    finalPrice: s.finalPrice,
    discountPercent: s.discountPercent,
    dealId: s.dealId,
    priority: s.priority,
    isActive: s.isActive,
    isAffiliate: s.isAffiliate,
    offerStatus: s.offerStatus,
    invalidReason: s.invalidReason,
    hotnessScore: s.hotnessScore,
    error: s.error,
    syncedAt: toIsoString(s.syncedAt),
    lastCheckedAt: toIsoString(s.lastCheckedAt),
    lastPriceSyncAt: toIsoString(s.lastPriceSyncAt),
    startAt: toIsoString(s.startAt ?? null),
    endAt: toIsoString(s.endAt ?? null),
  });
}

export function serializeItadDetail(d: ItadDetailSnapshot | undefined) {
  if (!d) return undefined;
  return jsonPlain({ ...d, syncedAt: toIsoString(d.syncedAt) });
}

export function serializeGgDetail(d: GgDetailSnapshot | undefined) {
  if (!d) return undefined;
  return jsonPlain({ ...d, syncedAt: toIsoString(d.syncedAt) });
}

export function serializeWorthBuy(w: WorthBuyStoredSnapshot | undefined) {
  if (!w) return undefined;
  return jsonPlain({ ...w, computedAt: toIsoString(w.computedAt) });
}

/** 显式字段，避免把杂项原样透出；输出 plain JSON。 */
export function serializeGameCountryBucket(b: GameCountryPriceBucket): Record<string, unknown> {
  return jsonPlain({
    countryCode: b.countryCode,
    steamCc: b.steamCc,
    itadCountry: b.itadCountry,
    ggDealsRegion: b.ggDealsRegion,
    cheapsharkCountry: b.cheapsharkCountry,
    lastFullSyncAt: toIsoString(b.lastFullSyncAt),
    steam: serializeRegionalSourcePriceSnapshot(b.steam),
    isthereanydeal: serializeRegionalSourcePriceSnapshot(b.isthereanydeal),
    ggdeals: serializeRegionalSourcePriceSnapshot(b.ggdeals),
    cheapshark: serializeRegionalSourcePriceSnapshot(b.cheapshark),
    itadDetail: serializeItadDetail(b.itadDetail),
    ggDetail: serializeGgDetail(b.ggDetail),
    worthBuy: serializeWorthBuy(b.worthBuy),
  });
}

export function serializeByCountryMap(
  byCountry: Record<string, GameCountryPriceBucket> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  if (!byCountry) return undefined;
  return Object.fromEntries(
    Object.entries(byCountry).map(([cc, raw]) => [cc, serializeGameCountryBucket(raw as GameCountryPriceBucket)]),
  );
}
