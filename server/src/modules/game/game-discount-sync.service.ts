import axios from 'axios';
import admin from 'firebase-admin';
import type { DealProviderCountryCodes, ResolvedCountryForSteam } from '../config/region-country.repository';
import { RegionCountryRepository } from '../config/region-country.repository';
import { mapToSteamAppDetailsLang } from '../steam/steam-language.util';
import { buildRegionalSteamStoreAppUrl } from '../steam/steam-store-url.util';
import { fetchSteamAppDetailsOne, steamAppDetailsRowToDealOffer } from '../steam/steam-appdetails.client';
import { SteamStoreService } from '../steam/steam-store.service';
import { fetchDealGameInfo, fetchGameBySteamAppId } from '../recommendations/cheapshark.client';
import type { DealSource, GameDealLinkDoc, GameDealLinkRepository } from './game-deal-link.repository';
import type { GameCatalogRepository, RegionalSourcePriceSnapshot } from './game-catalog.repository';
import { GameDiscountOffersRepository } from './game-discount-offers.repository';
import { GameWeeklyHeatRepository } from './game-weekly-heat.repository';
import { fetchItadEnrichmentForCountry } from './itad-enrichment.service';
import { resolveItadOfferUrl } from './itad-url.util';
import { pickItadDealFromPricesV3Entry, pickItadSteamDealFromPricesV3Entry, itadDealToPriceFields } from './itad-deal-pick.util';
import { itadLookupBySteamAppId, itadFetchGamePricesV3, itadPricesV3EntryForGameId } from './itad-api.client';
import { ggDealsFetchPricesBySteamAppId } from './gg-deals-api.client';
import { resolveGgDealsApiRegion } from '../config/deal-provider-region.catalog';
import { computeWorthBuy } from './worth-buy.util';
import {
  buildGgDetailSnapshot,
  buildGgDealOfferFromGameNode,
} from './gg-deals-detail.util';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { syncTimestampToMs } from '../../storage/sqlite/timestamp';

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

const INT_LIKE_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX']);

/** ITAD 价为展示单位；写入 steam 桶时需转为 Steam API 分/整数单位 */
function displayToSteamMinorUnits(amount: number | undefined, currency: string): number | undefined {
  if (amount == null || !Number.isFinite(amount)) return undefined;
  const c = String(currency ?? 'USD').trim().toUpperCase();
  if (INT_LIKE_CURRENCIES.has(c)) return Math.round(amount);
  return Math.round(amount * 100);
}

/** 与 deal 扁平化 `dealId` 生成规则一致 */
function syncDealIdForSource(appid: string, source: DealSource, countryCode: string): string {
  const cc = String(countryCode || 'US').toUpperCase();
  return `${String(appid).trim()}_${source}_${cc}`.toLowerCase();
}

/** 某日历日在某 IANA 时区下的 YYYY-MM-DD（用于「当天是否已拉过价」） */
function calendarDayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

const DEFAULT_DEAL_PRICE_DAY_TZ = 'America/New_York';

export class GameDiscountSyncService {
  private regionCountries = new RegionCountryRepository();
  private offers: GameDiscountOffersRepository;
  private weeklyHeat = new GameWeeklyHeatRepository();

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

  private offerFromStoredDeal(prev: GameDealLinkDoc): DealOffer {
    return {
      source: prev.source,
      url: prev.url,
      countryCode: String(prev.countryCode ?? 'US').toUpperCase(),
      currency: prev.currency,
      originalPrice: prev.originalPrice,
      finalPrice: prev.finalPrice,
      discountPercent: prev.discountPercent,
    };
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
    private catalog: GameCatalogRepository,
  ) {
    this.steam = new SteamStoreService(env);
    this.offers = new GameDiscountOffersRepository(env);
  }

  private offerToSnapshot(offer: DealOffer, now: admin.firestore.Timestamp): RegionalSourcePriceSnapshot {
    return {
      url: offer.url,
      currency: offer.currency,
      originalPrice: offer.originalPrice,
      finalPrice: offer.finalPrice,
      discountPercent: offer.discountPercent,
      syncedAt: now,
      lastPriceSyncAt: now,
    };
  }

  private async writeCountrySourceSnapshot(
    appid: string,
    businessCountryCode: string,
    pc: DealProviderCountryCodes,
    source: 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark',
    result: { ok: boolean; offer?: DealOffer | null; reason?: string },
    now: admin.firestore.Timestamp,
  ): Promise<void> {
    const providerCodes = {
      steamCc: pc.steamStoreCc.toUpperCase(),
      itadCountry: pc.itadCountry,
      ggDealsRegion: pc.ggDealsRegion,
      cheapsharkCountry: pc.cheapsharkCountry,
    };
    const fail = (reason: string): RegionalSourcePriceSnapshot => ({
      error: reason,
      syncedAt: now,
    });
    const patch =
      result.ok && result.offer
        ? this.offerToSnapshot(result.offer, now)
        : fail(String(result.reason ?? 'empty_response'));

    if (source === 'steam') {
      await this.offers.mergeCountryPriceBucket(appid, businessCountryCode, { providerCodes, steam: patch });
    } else if (source === 'isthereanydeal') {
      await this.offers.mergeCountryPriceBucket(appid, businessCountryCode, { providerCodes, isthereanydeal: patch });
    } else if (source === 'ggdeals') {
      await this.offers.mergeCountryPriceBucket(appid, businessCountryCode, { providerCodes, ggdeals: patch });
    } else {
      await this.offers.mergeCountryPriceBucket(appid, businessCountryCode, { providerCodes, cheapshark: patch });
    }
  }

  /**
   * 按业务国解析出的 Steam `cc`、商店语言 `l` 拉价；购买/商店链接带 `cc`+`l`，各国独立 URL。
   * 标价货币优先 Steam 返回，缺省时用国家配置 `defaultCurrency`。
   */
  private async fetchSteam(appid: string, pc: DealProviderCountryCodes, resolved: ResolvedCountryForSteam): Promise<DealOffer | null> {
    const biz = String(resolved.countryCode || 'US')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    try {
      const row = await fetchSteamAppDetailsOne(this.env, appid, {
        cc: pc.steamStoreCc,
        language: resolved.steamLanguage,
      });
      return steamAppDetailsRowToDealOffer(appid, row, {
        steamStoreCc: pc.steamStoreCc,
        steamLanguage: resolved.steamLanguage,
        businessCountryCode: biz,
        defaultCurrency: resolved.defaultCurrency,
      });
    } catch {
      return null;
    }
  }

  private async fetchCheapShark(
    appid: string,
    cheapSharkBaseUrl?: string,
    offerCountryCode = 'US',
  ): Promise<DealOffer | null> {
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
        const cc = String(offerCountryCode || 'US')
          .trim()
          .toUpperCase()
          .slice(0, 2);
        return {
          source: 'cheapshark',
          url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(g.cheapestDealID))}`,
          countryCode: /^[A-Z]{2}$/.test(cc) ? cc : 'US',
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
    const cc2 = String(offerCountryCode || 'US')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    return {
      source: 'cheapshark',
      url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(g.cheapestDealID))}`,
      countryCode: /^[A-Z]{2}$/.test(cc2) ? cc2 : 'US',
      currency: 'USD',
      originalPrice: info.retailPrice,
      finalPrice: info.salePrice,
      discountPercent: info.discountPercent,
    };
  }

  private async fetchGgDeals(
    appid: string,
    ggDealsApiKey: string | undefined,
    ggDealsBaseUrl: string | undefined,
    ggRegion: string,
    businessCountryCode: string,
  ): Promise<{
    offer: DealOffer | null;
    rawNode: Record<string, unknown> | null;
    apiRegion: string;
    requestedRegion: string;
    proxied: boolean;
  }> {
    const apiKey = String(ggDealsApiKey ?? '').trim();
    const resolvedGg = resolveGgDealsApiRegion(ggRegion);
    if (!apiKey) {
      return {
        offer: null,
        rawNode: null,
        apiRegion: resolvedGg.apiRegion,
        requestedRegion: resolvedGg.requestedRegion,
        proxied: resolvedGg.proxied,
      };
    }
    const biz = String(businessCountryCode || 'US')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    try {
      const e = await getEffectiveEnv(this.env);
      const timeoutMs = Math.max(e.steamHttpTimeoutMs, 10000);
      const hit = await ggDealsFetchPricesBySteamAppId({
        apiKey,
        baseUrl: ggDealsBaseUrl,
        appid,
        region: resolvedGg.apiRegion,
        timeoutMs,
      });
      const rawNode = hit?.rawNode ?? null;
      if (!rawNode) {
        return {
          offer: null,
          rawNode: null,
          apiRegion: resolvedGg.apiRegion,
          requestedRegion: resolvedGg.requestedRegion,
          proxied: resolvedGg.proxied,
        };
      }
      const mapped = buildGgDealOfferFromGameNode({
        rawNode,
        appid,
        regionLower: resolvedGg.apiRegion,
      });
      if (!mapped) {
        return {
          offer: null,
          rawNode,
          apiRegion: resolvedGg.apiRegion,
          requestedRegion: resolvedGg.requestedRegion,
          proxied: resolvedGg.proxied,
        };
      }
      return {
        offer: {
          source: 'ggdeals',
          url: mapped.url,
          countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
          currency: mapped.currency,
          originalPrice: undefined,
          finalPrice: mapped.finalPrice,
          discountPercent: undefined,
        },
        rawNode,
        apiRegion: resolvedGg.apiRegion,
        requestedRegion: resolvedGg.requestedRegion,
        proxied: resolvedGg.proxied,
      };
    } catch {
      return {
        offer: null,
        rawNode: null,
        apiRegion: resolvedGg.apiRegion,
        requestedRegion: resolvedGg.requestedRegion,
        proxied: resolvedGg.proxied,
      };
    }
  }

  private async fetchItad(
    appid: string,
    itadApiKey: string | undefined,
    itadBaseUrl: string | undefined,
    itadCountry: string,
    businessCountryCode: string,
  ): Promise<{ offer: DealOffer | null; itadGameId?: string; pricesV3Payload?: unknown }> {
    const apiKey = String(itadApiKey ?? '').trim();
    if (!apiKey) return { offer: null };
    const biz = String(businessCountryCode || 'US')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    try {
      const e = await getEffectiveEnv(this.env);
      const timeoutMs = Math.max(e.steamHttpTimeoutMs, 10000);
      const lookup = await itadLookupBySteamAppId({
        apiKey,
        baseUrl: itadBaseUrl,
        appid,
        timeoutMs,
      });
      if (!lookup) return { offer: null };
      const itadGameId = lookup.itadGameId;
      const itadC = String(itadCountry || 'US')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const priceTimeout = Math.max(e.steamHttpTimeoutMs, 12000);
      const pricesData = await itadFetchGamePricesV3({
        apiKey,
        baseUrl: itadBaseUrl,
        itadGameIds: [itadGameId],
        country: itadC,
        timeoutMs: priceTimeout,
      });
      const first = itadPricesV3EntryForGameId(pricesData, itadGameId);
      const low = pickItadDealFromPricesV3Entry(first);
      if (!low) return { offer: null };
      const parsed = itadDealToPriceFields(low);
      const url = resolveItadOfferUrl({
        deal: low,
        lookupData: lookup.lookupData,
        itadGameId,
        steamAppid: appid,
      });
      return {
        offer: {
          source: 'isthereanydeal',
          url,
          countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
          currency: parsed.currency,
          originalPrice: parsed.originalPrice,
          finalPrice: parsed.finalPrice,
          discountPercent: parsed.discountPercent,
        },
        itadGameId,
        /** 供 enrichment 复用，避免再打一次 `games/prices/v3` */
        pricesV3Payload: pricesData,
      };
    } catch {
      return { offer: null };
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
      /** 为 true 时不做「当日已同步则跳过」；管理端单游戏实时同步、公开 refresh 等应传 true */
      forceRefresh?: boolean;
      /** 批量仅刷价：跳过 URL 探测、ITAD enrichment、worthBuy 计算 */
      bulkPricesOnly?: boolean;
      /** 批级预取结果（跳过对应 HTTP 请求） */
      pricePrefetch?: {
        steamOffer?: DealOffer | null;
        itad?: {
          lookup: { itadGameId: string; lookupData: Record<string, unknown> };
          pricesV3Payload: unknown[];
          pricesEntry: Record<string, unknown> | null;
          offer: DealOffer | null;
        };
        gg?: {
          rawNode: Record<string, unknown>;
          offer: DealOffer | null;
          apiRegion?: string;
          requestedRegion?: string;
          proxied?: boolean;
        };
      };
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
    const allowSources = new Set(
      (opts?.sources ?? (opts?.bulkPricesOnly ? ['steam', 'ggdeals', 'isthereanydeal'] : ['steam', 'ggdeals', 'isthereanydeal', 'cheapshark'])).map(
        (x) => String(x),
      ),
    );
    const countries = Array.from(
      new Set((opts?.countries ?? ['US']).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)),
    );

    const forceRefresh = opts?.forceRefresh === true;
    const bulk = opts?.bulkPricesOnly === true;
    const existingLinksEarly =
      bulk && forceRefresh ? [] : await this.deals.listByAppid(id);
    const existingByDealId = new Map(existingLinksEarly.map((x) => [x.dealId, x] as const));
    const priceDayTz = String(process.env.DEAL_SYNC_PRICE_DAY_TZ ?? DEFAULT_DEAL_PRICE_DAY_TZ).trim() || DEFAULT_DEAL_PRICE_DAY_TZ;

    const alreadyFetchedToday = (source: DealSource, businessCc: string): GameDealLinkDoc | null => {
      if (forceRefresh) return null;
      const row = existingByDealId.get(syncDealIdForSource(id, source, businessCc));
      if (!row?.lastPriceSyncAt || !String(row.url ?? '').trim()) return null;
      const lastMs = syncTimestampToMs(row.lastPriceSyncAt);
      if (lastMs == null) return null;
      const nowMs = now.toMillis();
      if (calendarDayKey(lastMs, priceDayTz) !== calendarDayKey(nowMs, priceDayTz)) return null;
      return row;
    };

    const record = (source: DealSource, ok: boolean, offer?: DealOffer | null, reason?: string) => {
      providers.push({ source, ok, offer: offer ?? undefined, reason });
    };

    // 1) Steam + 2) GG + 3) ITAD：按国并行；4) CheapShark：一次抓取
    const itadPerCountryOk: { cc: string; ok: boolean; itadGameId?: string; pricesV3Payload?: unknown }[] = [];

    for (const businessCc of countries) {
      const pc = await this.regionCountries.resolveDealProviderCodes(businessCc);
      const resolved = await this.regionCountries.resolveForRegionalDetail(businessCc);

      const runSteam = async (): Promise<void> => {
        if (!allowSources.has('steam')) return;
        const skipRow = alreadyFetchedToday('steam', businessCc);
        if (skipRow) {
          const offer = this.offerFromStoredDeal(skipRow);
          record('steam', true, offer, 'skipped_same_calendar_day');
          return;
        }
        let offer: DealOffer | null = null;
        let reason: string | undefined;
        const pfSteam = opts?.pricePrefetch?.steamOffer;
        if (pfSteam != null && pfSteam.url) {
          offer = pfSteam;
        } else {
          try {
            offer = await this.fetchSteam(id, pc, resolved);
            if (!offer?.url) reason = 'empty_response';
          } catch (e) {
            reason = e instanceof Error ? e.message : String(e);
          }
        }
        const ok = !!(offer && offer.url);
        record('steam', ok, offer, ok ? undefined : reason);
        await this.writeCountrySourceSnapshot(id, businessCc, pc, 'steam', { ok, offer, reason }, now);
      };

      const runGg = async (): Promise<void> => {
        if (!allowSources.has('ggdeals')) return;
        const skipGg = alreadyFetchedToday('ggdeals', businessCc);
        if (skipGg) {
          const offer = this.offerFromStoredDeal(skipGg);
          record('ggdeals', true, offer, 'skipped_same_calendar_day');
          return;
        }
        let offer: DealOffer | null = null;
        let reason: string | undefined;
        let rawGg: Record<string, unknown> | null = null;
        const resolvedGg = resolveGgDealsApiRegion(pc.ggDealsRegion);
        let ggApiRegion = resolvedGg.apiRegion;
        let ggRequestedRegion = resolvedGg.requestedRegion;
        let ggProxied = resolvedGg.proxied;
        const pfGg = opts?.pricePrefetch?.gg;
        if (pfGg !== undefined) {
          offer = pfGg.offer;
          rawGg = pfGg.rawNode ?? null;
          if (pfGg.apiRegion) ggApiRegion = pfGg.apiRegion;
          if (pfGg.requestedRegion) ggRequestedRegion = pfGg.requestedRegion;
          if (typeof pfGg.proxied === 'boolean') ggProxied = pfGg.proxied;
          if (!offer?.url) reason = 'empty_response';
        } else if (!String(opts?.ggDealsApiKey ?? '').trim()) {
          reason = 'missing_api_key';
        } else {
          const ggKey = String(opts!.ggDealsApiKey).trim();
          try {
            const gg = await this.fetchGgDeals(id, ggKey, opts!.ggDealsBaseUrl, pc.ggDealsRegion, businessCc);
            offer = gg.offer;
            rawGg = gg.rawNode;
            ggApiRegion = gg.apiRegion;
            ggRequestedRegion = gg.requestedRegion;
            ggProxied = gg.proxied;
            if (!offer?.url) reason = 'empty_response';
          } catch (e) {
            reason = e instanceof Error ? e.message : String(e);
          }
        }
        const ok = !!(offer && offer.url);
        record('ggdeals', ok, offer, ok ? undefined : reason);
        await this.writeCountrySourceSnapshot(id, businessCc, pc, 'ggdeals', { ok, offer, reason }, now);
        // 批量刷价也要写 ggDetail：jp/kr 等代理到 us 时靠 regionProxied 避免 summary 误清
        const ggDetail = buildGgDetailSnapshot({
          rawNode: rawGg,
          ggRegionLower: ggApiRegion,
          requestedGgRegion: ggRequestedRegion,
          regionProxied: ggProxied,
          priceSyncOk: ok,
        });
        await this.offers.mergeCountryPriceBucket(id, businessCc, { ggDetail });
      };

      const runItad = async (): Promise<void> => {
        if (!allowSources.has('isthereanydeal')) return;
        const skipItad = alreadyFetchedToday('isthereanydeal', businessCc);
        if (skipItad) {
          const offer = this.offerFromStoredDeal(skipItad);
          record('isthereanydeal', true, offer, 'skipped_same_calendar_day');
          itadPerCountryOk.push({ cc: businessCc, ok: false });
          return;
        }
        let offer: DealOffer | null = null;
        let itadGameId: string | undefined;
        let pricesV3Payload: unknown;
        let reason: string | undefined;
        const pfItad = opts?.pricePrefetch?.itad;
        if (pfItad !== undefined) {
          offer = pfItad.offer;
          itadGameId = pfItad.lookup.itadGameId;
          pricesV3Payload = pfItad.pricesV3Payload;
          if (!offer?.url) reason = 'empty_response';
        } else if (!String(opts?.itadApiKey ?? '').trim()) {
          reason = 'missing_api_key';
        } else {
          const itadKey = String(opts!.itadApiKey).trim();
          try {
            const itad = await this.fetchItad(id, itadKey, opts!.itadBaseUrl, pc.itadCountry, businessCc);
            offer = itad.offer;
            itadGameId = itad.itadGameId;
            pricesV3Payload = itad.pricesV3Payload;
            if (!offer?.url) reason = 'empty_response';
          } catch (e) {
            reason = e instanceof Error ? e.message : String(e);
          }
        }
        const ok = !!(offer && offer.url);
        record('isthereanydeal', ok, offer, ok ? undefined : reason);
        itadPerCountryOk.push({
          cc: businessCc,
          ok,
          itadGameId: ok ? itadGameId : undefined,
          pricesV3Payload: ok ? pricesV3Payload : undefined,
        });
        await this.writeCountrySourceSnapshot(id, businessCc, pc, 'isthereanydeal', { ok, offer, reason }, now);
      };

      // 串行写入 bucket，避免并行 read-merge-write 互相覆盖（典型症状：ITAD/GG 已更新但 Steam 仍为旧 error）
      await runSteam();
      await runGg();
      await runItad();

      // Steam Store API 被 CDN 403/限流时：用 ITAD prices/v3 的 Steam 店 (shop 61) 补 Steam 官方零售价
      if (allowSources.has('steam')) {
        const steamIdx = providers.findIndex((p) => p.source === 'steam');
        const steamP = steamIdx >= 0 ? providers[steamIdx] : null;
        const needSteam =
          !steamP?.ok ||
          !steamP.offer?.url ||
          (steamP.offer.finalPrice == null && (steamP.offer.originalPrice == null || steamP.offer.originalPrice === 0));
        if (needSteam) {
          const itadRow = itadPerCountryOk.find((x) => x.cc === businessCc);
          const pfItad = opts?.pricePrefetch?.itad;
          const entry =
            pfItad?.pricesEntry ??
            (itadRow?.pricesV3Payload && itadRow.itadGameId
              ? itadPricesV3EntryForGameId(itadRow.pricesV3Payload as unknown[], itadRow.itadGameId)
              : null);
          const steamDeal = pickItadSteamDealFromPricesV3Entry(entry);
          if (steamDeal) {
            const parsed = itadDealToPriceFields(steamDeal);
            const cur = parsed.currency || resolved.defaultCurrency;
            const offer: DealOffer = {
              source: 'steam',
              url: buildRegionalSteamStoreAppUrl(id, pc.steamStoreCc, resolved.steamLanguage),
              countryCode: businessCc,
              currency: cur,
              originalPrice: displayToSteamMinorUnits(parsed.originalPrice, cur),
              finalPrice: displayToSteamMinorUnits(parsed.finalPrice, cur),
              discountPercent: parsed.discountPercent,
            };
            const rec = { source: 'steam' as const, ok: true, offer, reason: 'itad_steam_shop_fallback' };
            if (steamIdx >= 0) providers[steamIdx] = rec;
            else providers.push(rec);
            await this.writeCountrySourceSnapshot(id, businessCc, pc, 'steam', { ok: true, offer }, now);
          }
        }
      }
    }

    const steamOffers = providers
      .filter((x) => x.source === 'steam' && x.ok && x.offer)
      .map((x) => x.offer as DealOffer);
    const hasPaidPrice = steamOffers.some((o) => {
      const original = Number(o.originalPrice ?? 0);
      const finalPrice = Number(o.finalPrice ?? 0);
      return original > 0 || finalPrice > 0;
    });
    const steamOnlyFree = !hasPaidPrice;

    let csTemplate: DealOffer | null = null;
    if (allowSources.has('cheapshark') && !bulk) {
      const primary = countries[0] ?? 'US';
      const skipCs = alreadyFetchedToday('cheapshark', primary);
      if (skipCs) {
        csTemplate = this.offerFromStoredDeal(skipCs);
        record('cheapshark', true, csTemplate, 'skipped_same_calendar_day');
      } else {
        const csPc = await this.regionCountries.resolveDealProviderCodes(primary);
        let reason: string | undefined;
        try {
          csTemplate = await this.fetchCheapShark(id, opts?.cheapSharkBaseUrl, csPc.cheapsharkCountry);
          if (!csTemplate?.url) reason = 'empty_response';
        } catch (e) {
          reason = e instanceof Error ? e.message : String(e);
        }
        const ok = !!(csTemplate && csTemplate.url);
        record('cheapshark', ok, csTemplate, ok ? undefined : reason);
        for (const businessCc of countries) {
          const pc = await this.regionCountries.resolveDealProviderCodes(businessCc);
          await this.writeCountrySourceSnapshot(id, businessCc, pc, 'cheapshark', { ok, offer: csTemplate, reason }, now);
        }
      }
    }

    const offers: DealOffer[] = [];
    for (const p of providers) {
      if (!p.ok || !p.offer) continue;
      if (p.source === 'cheapshark') {
        for (const cc of countries) {
          offers.push({
            ...p.offer,
            countryCode: cc,
            hotnessScore: this.hotnessScore({ ...p.offer, countryCode: cc }),
          });
        }
      } else {
        offers.push({ ...p.offer, hotnessScore: this.hotnessScore(p.offer) });
      }
    }
    offers.sort((a, b) => Number(b.hotnessScore ?? 0) - Number(a.hotnessScore ?? 0));
    const writeStats: SyncWriteStats = { inserted: 0, updated: 0, deduped: 0 };
    const rows: GameDealLinkDoc[] = [];
    if (!bulk) {
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
    }

    const effectiveEnv = await getEffectiveEnv(this.env);
    const itadTimeout = Math.max(effectiveEnv.steamHttpTimeoutMs, 10000);
    const itadBase = (opts?.itadBaseUrl || 'https://api.isthereanydeal.com').replace(/\/+$/, '');
    if (opts?.itadApiKey && allowSources.has('isthereanydeal') && !bulk) {
      for (const { cc, ok, itadGameId, pricesV3Payload } of itadPerCountryOk) {
        if (!ok || !itadGameId) continue;
        const pc = await this.regionCountries.resolveDealProviderCodes(cc);
        const itadDetail = await fetchItadEnrichmentForCountry({
          appid: id,
          itadCountry: pc.itadCountry,
          apiKey: opts.itadApiKey,
          baseUrl: itadBase,
          timeoutMs: itadTimeout,
          itadGameId,
          pricesV3Payload,
        });
        await this.offers.mergeCountryPriceBucket(id, cc, { itadDetail });
      }
    }

    for (const cc of countries) {
      await this.offers.mergeCountryPriceBucket(id, cc, { markFullSync: true });
    }

    const catalogDoc = await this.catalog.getByAppid(id);
    if (catalogDoc && !bulk) {
      const computedAt = admin.firestore.Timestamp.now();
      const heatDoc = await this.weeklyHeat.getByAppid(id);
      const buckets = await this.offers.listBucketsForAppid(id);
      const countrySet = new Set(countries.map((c) => String(c).toUpperCase()));
      for (const bucketDoc of buckets) {
        const cc = String(bucketDoc.countryCode ?? '')
          .trim()
          .toUpperCase();
        if (!countrySet.has(cc)) continue;
        const b = this.offers.countryBucketFromDoc(bucketDoc);
        const w = computeWorthBuy(b, {
          reviewSummary: catalogDoc.reviewSummary,
          currentPlayers: heatDoc?.currentPlayers ?? catalogDoc.currentPlayers ?? 0,
        });
        await this.offers.mergeCountryPriceBucket(id, cc, {
          worthBuy: { ...w, computedAt },
        });
      }
    }

    return {
      upserted: rows.length,
      offers,
      rows,
      providers,
      writeStats,
      ...(steamOnlyFree && offers.length === 0 ? { skipped: true, skipReason: 'zero_price_steam_only' as const } : {}),
    };
  }
}
