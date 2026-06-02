import axios from 'axios';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import type { DealProviderCountryCodes, ResolvedCountryForSteam } from '../config/region-country.repository';
import { mapToSteamAppDetailsLang } from '../steam/steam-language.util';
import { buildRegionalSteamStoreAppUrl } from '../steam/steam-store-url.util';
import {
  itadLookupBySteamAppId,
  itadFetchGamePricesV3,
  itadPricesV3EntryForGameId,
  type ItadLookupResult,
} from '../game/itad-api.client';
import { ggDealsFetchPricesBySteamAppIds } from '../game/gg-deals-api.client';
import { pickItadDealFromPricesV3Entry, itadDealToPriceFields } from '../game/itad-deal-pick.util';
import { resolveItadOfferUrl } from '../game/itad-url.util';
import { buildGgDealOfferFromGameNode } from '../game/gg-deals-detail.util';
import { isGgDealsOfficialRegion } from '../config/external-deal-api.catalog';
import { mapPool } from '../../utils/map-pool';
import type { DealSource } from '../game/game-deal-link.repository';

type DealOffer = {
  source: DealSource;
  url: string;
  countryCode?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
};

export type ItadAppPrefetch = {
  lookup: ItadLookupResult;
  pricesV3Payload: unknown[];
  pricesEntry: Record<string, unknown> | null;
  offer: DealOffer | null;
};

export type GgAppPrefetch = {
  rawNode: Record<string, unknown>;
  offer: DealOffer | null;
};

export type MarketBatchPricePrefetch = {
  steamByAppid: Map<string, DealOffer | null>;
  itadByAppid: Map<string, ItadAppPrefetch>;
  ggByAppid: Map<string, GgAppPrefetch>;
};

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function prefetchSteamBatch(
  env: Env,
  appids: string[],
  pc: DealProviderCountryCodes,
  resolved: ResolvedCountryForSteam,
): Promise<Map<string, DealOffer | null>> {
  const out = new Map<string, DealOffer | null>();
  if (!appids.length) return out;

  const e = await getEffectiveEnv(env);
  const cc = String(pc.steamStoreCc || 'us')
    .trim()
    .toLowerCase();
  const biz = String(resolved.countryCode || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const l = mapToSteamAppDetailsLang(resolved.steamLanguage);
  const cfgCurrency = String(resolved.defaultCurrency ?? '')
    .trim()
    .toUpperCase();
  const timeoutMs = Math.max(e.steamHttpTimeoutMs, 12000);
  const groups = chunk(appids, 25);

  await mapPool(groups, 4, async (group) => {
    try {
      const { data } = await axios.get<Record<string, { success?: boolean; data?: Record<string, unknown> }>>(
        'https://store.steampowered.com/api/appdetails',
        {
          params: { appids: group.join(','), cc, l },
          timeout: timeoutMs,
          validateStatus: () => true,
        },
      );
      for (const appid of group) {
        const row = data?.[appid];
        if (!row?.success || !row?.data) {
          out.set(appid, null);
          continue;
        }
        const d = row.data as Record<string, unknown>;
        const price = (d.price_overview ?? {}) as Record<string, unknown>;
        const apiCurrency = String(price.currency ?? '')
          .trim()
          .toUpperCase();
        const currency = apiCurrency || cfgCurrency || 'USD';
        out.set(appid, {
          source: 'steam',
          url: buildRegionalSteamStoreAppUrl(appid, pc.steamStoreCc, resolved.steamLanguage),
          countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
          currency,
          originalPrice: num(price.initial) ?? 0,
          finalPrice: num(price.final) ?? 0,
          discountPercent: num(price.discount_percent) ?? 0,
        });
      }
    } catch {
      for (const appid of group) out.set(appid, null);
    }
  });

  return out;
}

async function prefetchItadBatch(
  env: Env,
  appids: string[],
  itadApiKey: string | undefined,
  itadBaseUrl: string | undefined,
  itadCountry: string,
  businessCountryCode: string,
): Promise<Map<string, ItadAppPrefetch>> {
  const out = new Map<string, ItadAppPrefetch>();
  if (!itadApiKey || !appids.length) return out;

  const e = await getEffectiveEnv(env);
  const lookupTimeout = Math.max(e.steamHttpTimeoutMs, 10000);
  const priceTimeout = Math.max(e.steamHttpTimeoutMs, 15000);
  const biz = String(businessCountryCode || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const itadC = String(itadCountry || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const lookupByAppid = new Map<string, ItadLookupResult>();
  await mapPool(appids, 24, async (appid) => {
    const lookup = await itadLookupBySteamAppId({
      apiKey: itadApiKey,
      baseUrl: itadBaseUrl,
      appid,
      timeoutMs: lookupTimeout,
    });
    if (lookup) lookupByAppid.set(appid, lookup);
  });

  const appidByItadId = new Map<string, string>();
  const itadIds: string[] = [];
  for (const [appid, lookup] of lookupByAppid) {
    appidByItadId.set(lookup.itadGameId, appid);
    itadIds.push(lookup.itadGameId);
  }

  const pricesByItadId = new Map<string, { entry: Record<string, unknown> | null; payload: unknown[] }>();
  for (const idChunk of chunk(itadIds, 200)) {
    const payload = await itadFetchGamePricesV3({
      apiKey: itadApiKey,
      baseUrl: itadBaseUrl,
      itadGameIds: idChunk,
      country: itadC,
      timeoutMs: priceTimeout,
    });
    if (!payload) continue;
    for (const itadGameId of idChunk) {
      pricesByItadId.set(itadGameId, {
        entry: itadPricesV3EntryForGameId(payload, itadGameId),
        payload,
      });
    }
  }

  for (const appid of appids) {
    const lookup = lookupByAppid.get(appid);
    if (!lookup) continue;
    const priced = pricesByItadId.get(lookup.itadGameId);
    const pricesEntry = priced?.entry ?? null;
    const pricesV3Payload = priced?.payload ?? [];
    const low = pickItadDealFromPricesV3Entry(pricesEntry);
    let offer: DealOffer | null = null;
    if (low) {
      const parsed = itadDealToPriceFields(low);
      offer = {
        source: 'isthereanydeal',
        url: resolveItadOfferUrl({
          deal: low,
          lookupData: lookup.lookupData,
          itadGameId: lookup.itadGameId,
          steamAppid: appid,
        }),
        countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
        currency: parsed.currency,
        originalPrice: parsed.originalPrice,
        finalPrice: parsed.finalPrice,
        discountPercent: parsed.discountPercent,
      };
    }
    out.set(appid, { lookup, pricesEntry, pricesV3Payload, offer });
  }
  return out;
}

async function prefetchGgBatch(
  env: Env,
  appids: string[],
  ggDealsApiKey: string | undefined,
  ggDealsBaseUrl: string | undefined,
  ggRegion: string,
  businessCountryCode: string,
): Promise<Map<string, GgAppPrefetch>> {
  const out = new Map<string, GgAppPrefetch>();
  if (!ggDealsApiKey || !appids.length) return out;

  const regionLc = String(ggRegion || 'us').trim().toLowerCase();
  if (!isGgDealsOfficialRegion(regionLc)) return out;

  const e = await getEffectiveEnv(env);
  const timeoutMs = Math.max(e.steamHttpTimeoutMs, 12000);
  const biz = String(businessCountryCode || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const batch = await ggDealsFetchPricesBySteamAppIds({
    apiKey: ggDealsApiKey,
    baseUrl: ggDealsBaseUrl,
    appids,
    region: regionLc,
    timeoutMs,
  });
  if (!batch) return out;

  for (const appid of appids) {
    const rawNode = batch.byAppid.get(appid) ?? batch.byAppid.get(String(Number(appid)));
    if (!rawNode) continue;
    const mapped = buildGgDealOfferFromGameNode({ rawNode, appid, regionLower: regionLc });
    out.set(appid, {
      rawNode,
      offer: mapped
        ? {
            source: 'ggdeals',
            url: mapped.url,
            countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
            currency: mapped.currency,
            finalPrice: mapped.finalPrice,
          }
        : null,
    });
  }
  return out;
}

export async function prefetchMarketBatchPrices(opts: {
  env: Env;
  appids: string[];
  pc: DealProviderCountryCodes;
  resolved: ResolvedCountryForSteam;
  platforms: DealSource[];
  itadApiKey?: string;
  ggDealsApiKey?: string;
  itadBaseUrl?: string;
  ggDealsBaseUrl?: string;
}): Promise<MarketBatchPricePrefetch> {
  const allow = new Set(opts.platforms);
  const ids = Array.from(new Set(opts.appids.map((x) => String(x ?? '').trim()).filter(Boolean)));
  const biz = String(opts.resolved.countryCode || 'US').toUpperCase();

  const [steamByAppid, itadByAppid, ggByAppid] = await Promise.all([
    allow.has('steam') ? prefetchSteamBatch(opts.env, ids, opts.pc, opts.resolved) : Promise.resolve(new Map()),
    allow.has('isthereanydeal')
      ? prefetchItadBatch(opts.env, ids, opts.itadApiKey, opts.itadBaseUrl, opts.pc.itadCountry, biz)
      : Promise.resolve(new Map()),
    allow.has('ggdeals')
      ? prefetchGgBatch(opts.env, ids, opts.ggDealsApiKey, opts.ggDealsBaseUrl, opts.pc.ggDealsRegion, biz)
      : Promise.resolve(new Map()),
  ]);

  return { steamByAppid, itadByAppid, ggByAppid };
}
