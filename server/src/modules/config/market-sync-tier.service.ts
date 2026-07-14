import type { RegionCountryConfigDoc } from '../../modules/config/region-country.repository';
import { RegionCountryRepository } from '../../modules/config/region-country.repository';
import { MarketSyncTierRepository } from './market-sync-tier.repository';
import {
  normalizeMarketSyncTier,
  shouldSyncTierOnDay,
  topNForSyncTier,
  type MarketSyncTier,
  type MarketSyncTierSettings,
} from './market-sync-tier.config';

export type RegionCountryForMarketSync = RegionCountryConfigDoc & {
  syncTier: MarketSyncTier;
  topNPerCountry: number;
};

export async function loadRegionCountriesForMarketSync(opts?: {
  atMs?: number;
  timeZone?: string;
  syncTierFilter?: 'T1' | 'T2';
}): Promise<{ settings: MarketSyncTierSettings; countries: RegionCountryForMarketSync[] }> {
  const tierRepo = new MarketSyncTierRepository();
  const regionRepo = new RegionCountryRepository();
  const settings = await tierRepo.getSettings();
  const enabled = await regionRepo.listEnabledPublic();
  const out: RegionCountryForMarketSync[] = [];
  for (const row of enabled) {
    const syncTier = normalizeMarketSyncTier(row.syncTier);
    if (opts?.syncTierFilter && syncTier !== opts.syncTierFilter) continue;
    if (!shouldSyncTierOnDay(syncTier, settings, opts?.atMs, opts?.timeZone)) continue;
    out.push({
      ...row,
      syncTier,
      topNPerCountry: topNForSyncTier(syncTier, settings),
    });
  }
  return { settings, countries: out };
}

export function countryCodesFromMarketSyncList(countries: RegionCountryForMarketSync[]): string[] {
  return countries.map((c) => c.countryCode.toUpperCase());
}

export function topNForCountryInSyncList(
  countries: RegionCountryForMarketSync[],
  countryCode: string,
  fallback = 200,
): number {
  const cc = countryCode.toUpperCase();
  const hit = countries.find((c) => c.countryCode.toUpperCase() === cc);
  return hit?.topNPerCountry ?? fallback;
}
