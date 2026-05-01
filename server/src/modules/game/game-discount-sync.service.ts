import axios from 'axios';
import admin from 'firebase-admin';
import { SteamStoreService } from '../steam/steam-store.service';
import { fetchDealGameInfo, fetchGameBySteamAppId } from '../recommendations/cheapshark.client';
import type { DealSource, GameDealLinkDoc, GameDealLinkRepository } from './game-deal-link.repository';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';

type DealOffer = {
  source: DealSource;
  url: string;
  countryCode?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  hotnessScore?: number;
};

type ProviderSyncResult = {
  source: DealSource;
  ok: boolean;
  reason?: string;
  offer?: DealOffer;
};

type SyncWriteStats = {
  inserted: number;
  updated: number;
  deduped: number;
};

const SOURCE_HOTNESS_WEIGHT: Record<DealSource, number> = {
  steam: 70,
  isthereanydeal: 85,
  ggdeals: 90,
  cheapshark: 80,
  affiliate: 60,
  fanatical: 75,
  cdkeys: 75,
  gearup: 65,
  manual: 50,
};

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export class GameDiscountSyncService {
  private async probeOfferUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
    const u = String(url ?? '').trim();
    if (!u) return { ok: false, reason: 'missing_url' };
    try {
      const head = await axios.head(u, { timeout: 6000, maxRedirects: 5, validateStatus: () => true });
      if (head.status >= 200 && head.status < 400) return { ok: true };
      if (head.status === 405 || head.status === 403) {
        const get = await axios.get(u, { timeout: 6000, maxRedirects: 5, validateStatus: () => true });
        if (get.status >= 200 && get.status < 400) return { ok: true };
        return { ok: false, reason: `http_${get.status}` };
      }
      return { ok: false, reason: `http_${head.status}` };
    } catch {
      return { ok: false, reason: 'probe_failed' };
    }
  }

  private hotnessScore(o: DealOffer): number {
    const discount = Number(o.discountPercent ?? 0);
    const original = Number(o.originalPrice ?? 0);
    const finalPrice = Number(o.finalPrice ?? 0);
    const absoluteSave = original > 0 && finalPrice >= 0 ? Math.max(0, original - finalPrice) : 0;
    const sourceWeight = SOURCE_HOTNESS_WEIGHT[o.source] ?? 50;
    return discount * 1000 + absoluteSave + sourceWeight;
  }

  private steam: SteamStoreService;

  constructor(
    private env: Env,
    private deals: GameDealLinkRepository,
  ) {
    this.steam = new SteamStoreService(env);
  }

  private async fetchSteam(appid: string, countryCode = 'US'): Promise<DealOffer | null> {
    const e = await getEffectiveEnv(this.env);
    const cc = String(countryCode || 'US').trim().toLowerCase();
    try {
      const { data } = await axios.get<Record<string, any>>('https://store.steampowered.com/api/appdetails', {
        params: { appids: appid, cc, l: 'en' },
        timeout: Math.max(e.steamHttpTimeoutMs, 12000),
        validateStatus: () => true,
      });
      const row = data?.[appid];
      if (!row?.success || !row?.data) return null;
      const d = row.data as Record<string, any>;
      const price = (d.price_overview ?? {}) as Record<string, any>;
      return {
        source: 'steam',
        url: `https://store.steampowered.com/app/${appid}`,
        countryCode: cc.toUpperCase(),
        currency: String(price.currency ?? 'USD'),
        originalPrice: num(price.initial) ?? 0,
        finalPrice: num(price.final) ?? 0,
        discountPercent: num(price.discount_percent) ?? 0,
      };
    } catch {
      return null;
    }
  }

  private async fetchCheapShark(appid: string, cheapSharkBaseUrl?: string): Promise<DealOffer | null> {
    const e = await getEffectiveEnv(this.env);
    const to = e.steamHttpTimeoutMs;
    if (cheapSharkBaseUrl && cheapSharkBaseUrl.trim()) {
      try {
        const base = cheapSharkBaseUrl.replace(/\/+$/, '');
        const gameResp = await axios.get<any[]>(`${base}/games`, {
          params: { steamAppId: appid },
          timeout: Math.max(to, 8000),
          validateStatus: () => true,
        });
        const g = Array.isArray(gameResp.data) ? gameResp.data[0] : null;
        if (!g?.cheapestDealID) return null;
        const dealResp = await axios.get<any>(`${base}/deals`, {
          params: { id: String(g.cheapestDealID) },
          timeout: Math.max(to, 8000),
          validateStatus: () => true,
        });
        const gi = dealResp.data?.gameInfo;
        if (!gi) return null;
        const sale = num(gi?.salePrice) ?? 0;
        const retail = num(gi?.retailPrice) ?? 0;
        const discountPercent = retail > 0 ? Math.round((1 - sale / retail) * 100) : 0;
        return {
          source: 'cheapshark',
          url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(g.cheapestDealID))}`,
          countryCode: 'US',
          currency: 'USD',
          originalPrice: retail,
          finalPrice: sale,
          discountPercent,
        };
      } catch {
        return null;
      }
    }
    const g = await fetchGameBySteamAppId(appid, Math.max(to, 8000));
    if (!g?.cheapestDealID) return null;
    const info = await fetchDealGameInfo(String(g.cheapestDealID), Math.max(to, 8000));
    if (!info) return null;
    return {
      source: 'cheapshark',
      url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(g.cheapestDealID))}`,
      countryCode: 'US',
      currency: 'USD',
      originalPrice: info.retailPrice,
      finalPrice: info.salePrice,
      discountPercent: info.discountPercent,
    };
  }

  private async fetchGgDeals(appid: string, ggDealsApiKey?: string, ggDealsBaseUrl?: string, countryCode = 'US'): Promise<DealOffer | null> {
    if (!ggDealsApiKey) return null;
    try {
      const e = await getEffectiveEnv(this.env);
      const rawBase = (ggDealsBaseUrl || 'https://api.gg.deals').replace(/\/+$/, '');
      const baseCandidates = rawBase.includes('gg.deals/api')
        ? [rawBase, rawBase.replace('https://gg.deals/api', 'https://api.gg.deals')]
        : [rawBase, 'https://api.gg.deals', 'https://gg.deals/api'];
      const endpointCandidates = ['/v1/prices/by-steam-app-id/', '/prices/by-steam-app-id/'];

      for (const base of Array.from(new Set(baseCandidates))) {
        for (const endpoint of endpointCandidates) {
          const { data } = await axios.get<any>(`${base}${endpoint}`, {
            params: {
              key: ggDealsApiKey,
              ids: appid,
              region: String(countryCode || 'US').toLowerCase(),
            },
            timeout: Math.max(e.steamHttpTimeoutMs, 10000),
            validateStatus: () => true,
          });
          const node = data?.result?.[appid] ?? data?.data?.[appid] ?? data?.[appid];
          if (!node) continue;
          const priceNode = node?.price ?? node?.current ?? node;
          const original = num(priceNode?.regular ?? priceNode?.basePrice ?? priceNode?.oldPrice);
          const finalPrice = num(priceNode?.price ?? priceNode?.amount ?? priceNode?.newPrice);
          const discount = num(priceNode?.discount ?? priceNode?.discountPercent);
          return {
            source: 'ggdeals',
            url: String(node?.url ?? `https://gg.deals/game/steam-app/${appid}/`),
            countryCode: String(countryCode || 'US').toUpperCase(),
            currency: String(priceNode?.currency ?? 'USD'),
            originalPrice: original,
            finalPrice,
            discountPercent:
              discount ??
              (typeof original === 'number' && typeof finalPrice === 'number' && original > 0
                ? Math.round((1 - finalPrice / original) * 100)
                : undefined),
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fetchItad(appid: string, itadApiKey?: string, itadBaseUrl?: string, countryCode = 'US'): Promise<DealOffer | null> {
    if (!itadApiKey) return null;
    try {
      const e = await getEffectiveEnv(this.env);
      const base = (itadBaseUrl || 'https://api.isthereanydeal.com').replace(/\/+$/, '');
      const lookupCandidates = [{ key: itadApiKey }, { token: itadApiKey }];
      let lookupData: any = null;
      for (const authParams of lookupCandidates) {
        const lookup = await axios.get<any>(`${base}/games/lookup/v1`, {
          params: { ...authParams, appid: Number(appid) },
          timeout: Math.max(e.steamHttpTimeoutMs, 10000),
          validateStatus: () => true,
        });
        if (lookup.data && !lookup.data?.error) {
          lookupData = lookup.data;
          break;
        }
      }
      if (!lookupData) return null;
      const gameId = lookupData?.id ?? lookupData?.game?.id;
      if (!gameId) return null;
      let pricesData: any = null;
      for (const authParams of lookupCandidates) {
        const prices = await axios.post<any>(
          `${base}/games/prices/v3`,
          [gameId],
          {
            params: { ...authParams, country: String(countryCode || 'US').toUpperCase() },
            timeout: Math.max(e.steamHttpTimeoutMs, 12000),
            validateStatus: () => true,
          },
        );
        if (prices.data && !prices.data?.error) {
          pricesData = prices.data;
          break;
        }
      }
      if (!pricesData) return null;
      const first = Array.isArray(pricesData) ? pricesData[0] : null;
      const low = first?.deals?.[0] ?? first?.prices?.[0] ?? null;
      if (!low) return null;
      const original = num(low?.regular?.amount ?? low?.price?.old ?? low?.price?.amount_old);
      const finalPrice = num(low?.price?.amount ?? low?.cut ?? low?.price_new);
      const discount = num(low?.cut ?? low?.price?.cut ?? low?.discount);
      const url = String(low?.url ?? low?.shop?.url ?? `https://isthereanydeal.com/game/${appid}/`);
      return {
        source: 'isthereanydeal',
        url,
        countryCode: String(countryCode || 'US').toUpperCase(),
        currency: String(low?.price?.currency ?? low?.regular?.currency ?? 'USD'),
        originalPrice: original,
        finalPrice,
        discountPercent:
          discount ?? (typeof original === 'number' && typeof finalPrice === 'number' && original > 0 ? Math.round((1 - finalPrice / original) * 100) : undefined),
      };
    } catch {
      return null;
    }
  }

  async syncAppDeals(
    appid: string,
    opts?: {
      itadApiKey?: string;
      ggDealsApiKey?: string;
      itadBaseUrl?: string;
      ggDealsBaseUrl?: string;
      cheapSharkBaseUrl?: string;
      countries?: string[];
      sources?: DealSource[];
    },
  ): Promise<{
    upserted: number;
    offers: DealOffer[];
    rows: GameDealLinkDoc[];
    providers: ProviderSyncResult[];
    writeStats: SyncWriteStats;
    skipped?: boolean;
    skipReason?: string;
  }> {
    const id = String(appid ?? '').trim();
    if (!id) {
      return {
        upserted: 0,
        offers: [],
        rows: [],
        providers: [],
        writeStats: { inserted: 0, updated: 0, deduped: 0 },
        skipped: true,
        skipReason: 'empty_appid',
      };
    }
    const now = admin.firestore.Timestamp.now();
    const providers: ProviderSyncResult[] = [];
    const allowSources = new Set((opts?.sources ?? ['steam', 'ggdeals', 'isthereanydeal', 'cheapshark']).map((x) => String(x)));
    const countries = Array.from(
      new Set((opts?.countries ?? ['US']).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)),
    );
    const run = async (
      source: DealSource,
      fn: () => Promise<DealOffer | null>,
      skipReason?: string,
    ) => {
      if (skipReason) {
        providers.push({ source, ok: false, reason: skipReason });
        return;
      }
      try {
        const offer = await fn();
        if (offer?.url) providers.push({ source, ok: true, offer });
        else providers.push({ source, ok: false, reason: 'empty_response' });
      } catch (e) {
        providers.push({ source, ok: false, reason: e instanceof Error ? e.message : String(e) });
      }
    };

    // First fetch Steam prices; if all regions are zero/free, skip external providers.
    if (allowSources.has('steam')) {
      await Promise.all(countries.map((cc) => run('steam', () => this.fetchSteam(id, cc))));
    }
    const steamOffers = providers
      .filter((x) => x.source === 'steam' && x.ok && x.offer)
      .map((x) => x.offer as DealOffer);
    const hasPaidPrice = steamOffers.some((o) => {
      const original = Number(o.originalPrice ?? 0);
      const finalPrice = Number(o.finalPrice ?? 0);
      return original > 0 || finalPrice > 0;
    });
    if (!hasPaidPrice) {
      return {
        upserted: 0,
        offers: [],
        rows: [],
        providers,
        writeStats: { inserted: 0, updated: 0, deduped: 0 },
        skipped: true,
        skipReason: 'zero_price',
      };
    }

    // Execute provider fetches by platform hotness (high -> low), so top platforms are always fetched first.
    const providerTasks: Array<{
      source: DealSource;
      fn: () => Promise<DealOffer | null>;
      skipReason?: string;
    }> = [];
    for (const cc of countries) {
      if (allowSources.has('ggdeals')) {
        providerTasks.push({
          source: 'ggdeals',
          fn: () => this.fetchGgDeals(id, opts?.ggDealsApiKey, opts?.ggDealsBaseUrl, cc),
          skipReason: opts?.ggDealsApiKey ? undefined : 'missing_api_key',
        });
      }
      if (allowSources.has('isthereanydeal')) {
        providerTasks.push({
          source: 'isthereanydeal',
          fn: () => this.fetchItad(id, opts?.itadApiKey, opts?.itadBaseUrl, cc),
          skipReason: opts?.itadApiKey ? undefined : 'missing_api_key',
        });
      }
    }
    // CheapShark is US-centric; run once per app.
    if (allowSources.has('cheapshark')) {
      providerTasks.push({
        source: 'cheapshark',
        fn: () => this.fetchCheapShark(id, opts?.cheapSharkBaseUrl),
      });
    }
    providerTasks.sort((a, b) => (SOURCE_HOTNESS_WEIGHT[b.source] ?? 0) - (SOURCE_HOTNESS_WEIGHT[a.source] ?? 0));
    for (const t of providerTasks) {
      await run(t.source, t.fn, t.skipReason);
    }

    const offers = providers
      .filter((x) => x.ok && x.offer)
      .map((x) => {
        const o = x.offer as DealOffer;
        return { ...o, hotnessScore: this.hotnessScore(o) };
      })
      .filter((o) => String(o.url ?? '').trim().length > 0)
      .sort((a, b) => Number(b.hotnessScore ?? 0) - Number(a.hotnessScore ?? 0));
    const existingLinks = await this.deals.listByAppid(id);
    const existingByDealId = new Map(existingLinks.map((x) => [x.dealId, x] as const));
    const writeStats: SyncWriteStats = { inserted: 0, updated: 0, deduped: 0 };
    const rows: GameDealLinkDoc[] = [];
    for (const [idx, o] of offers.entries()) {
      const dealId = `${id}_${o.source}_${String(o.countryCode || 'US').toUpperCase()}`.toLowerCase();
      const prev = existingByDealId.get(dealId);
      const nextUrl = String(o.url ?? '').trim();
      const nextOriginal = o.originalPrice;
      const nextFinal = o.finalPrice;
      const nextDiscount = o.discountPercent;
      const unchanged =
        !!prev &&
        prev.url === nextUrl &&
        Number(prev.originalPrice ?? -1) === Number(nextOriginal ?? -1) &&
        Number(prev.finalPrice ?? -1) === Number(nextFinal ?? -1) &&
        Number(prev.discountPercent ?? -1) === Number(nextDiscount ?? -1);
      if (unchanged) {
        writeStats.deduped += 1;
        continue;
      }
      const probe = await this.probeOfferUrl(nextUrl);
      const deal = await this.deals.upsertForApp(id, {
        dealId,
        source: o.source,
        url: nextUrl,
        isAffiliate: false,
        priority: 10 + idx * 10,
        countryCode: String(o.countryCode || 'US').toUpperCase(),
        startAt: null,
        endAt: null,
        ...(o.currency !== undefined ? { currency: o.currency } : {}),
        ...(o.originalPrice !== undefined ? { originalPrice: o.originalPrice } : {}),
        ...(o.finalPrice !== undefined ? { finalPrice: o.finalPrice } : {}),
        ...(o.discountPercent !== undefined ? { discountPercent: o.discountPercent } : {}),
        ...(o.hotnessScore !== undefined ? { hotnessScore: o.hotnessScore } : {}),
        ...(probe.ok
          ? { offerStatus: 'active' as const, invalidReason: '', isActive: true }
          : { offerStatus: 'invalid' as const, invalidReason: probe.reason || 'unreachable_url', isActive: false }),
        lastCheckedAt: now,
        lastPriceSyncAt: now,
      });
      if (prev) writeStats.updated += 1;
      else writeStats.inserted += 1;
      rows.push(deal);
    }
    return { upserted: rows.length, offers, rows, providers, writeStats };
  }
}

