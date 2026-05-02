import axios from 'axios';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { mapToSteamAppDetailsLang } from './steam-language.util';

export type SteamStoreGameDetail = {
  appid: string;
  name: string;
  steamStoreUrl: string;
  headerImage?: string;
  capsuleImage?: string;
  screenshots: string[];
  trailerUrls: string[];
  shortDescription?: string;
  detailedDescription?: string;
  developers: string[];
  publishers: string[];
  categories: string[];
  genres: string[];
  tags: string[];
  isFree: boolean;
  priceInitial: number;
  priceFinal: number;
  discountPercent: number;
  steamDiscounted: boolean;
  currentPlayers?: number;
};

export type SteamRegionalPrice = {
  appid: string;
  country: string;
  currency: string;
  regularPrice: number;
  salePrice: number;
  discountPercent: number;
  fallbackUsed: boolean;
  /** Present when Steam returned formatted strings or server formatted from minor units. */
  initialFormatted?: string;
  finalFormatted?: string;
  priceSource?: 'steam' | 'fallback_format';
};

/** Parsed regional price for API responses — amounts are Steam minor units until formatted for display. */
export type SteamRegionalPriceDetail = {
  currency: string;
  initial: number;
  final: number;
  initialFormatted: string;
  finalFormatted: string;
  discountPercent: number;
  fallbackUsed: boolean;
  /** Steam returned formatted strings vs server-side Intl fallback */
  source: 'steam' | 'fallback_format';
  isFree?: boolean;
};

export type SteamReviewRow = {
  reviewId: string;
  authorSteamId: string;
  content: string;
  language: string;
  votedUp: boolean;
  votesUp: number;
  timestampCreated: number;
  timestampUpdated: number;
};

export type SteamReviewSummary = {
  reviewScoreDesc: string;
  positivePercent: number;
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
};

function intField(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v);
  return Number.parseInt(String(v ?? '0'), 10) || 0;
}

export class SteamStoreService {
  constructor(private env: Env) {}

  async fetchCurrentPlayers(appid: string): Promise<number | null> {
    const e = await getEffectiveEnv(this.env);
    const url = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/';
    try {
      const { data } = await axios.get<any>(url, {
        params: { appid },
        timeout: Math.max(e.steamHttpTimeoutMs, 8000),
        validateStatus: () => true,
      });
      const v = data?.response?.player_count;
      if (typeof v === 'number') return Math.max(0, Math.trunc(v));
      return null;
    } catch {
      return null;
    }
  }

  async fetchAppDetails(appid: string): Promise<SteamStoreGameDetail | null> {
    const e = await getEffectiveEnv(this.env);
    const url = 'https://store.steampowered.com/api/appdetails';
    const { data } = await axios.get<Record<string, any>>(url, {
      params: { appids: appid, cc: 'us', l: 'en' },
      timeout: Math.max(e.steamHttpTimeoutMs, 15000),
      validateStatus: () => true,
    });

    const row = data?.[appid];
    if (!row?.success || !row?.data) return null;
    const d = row.data as Record<string, any>;
    const screenshotsRaw = Array.isArray(d.screenshots) ? d.screenshots : [];
    const screenshots = screenshotsRaw
      .map((s: any) => String(s?.path_full ?? '').trim())
      .filter(Boolean)
      .slice(0, 20);
    const moviesRaw = Array.isArray(d.movies) ? d.movies : [];
    const trailerUrls = moviesRaw
      .map((m: any) => {
        const mp4Max = String(m?.mp4?.max ?? '').trim();
        const mp4 = String(m?.mp4?.['480'] ?? '').trim();
        const webm = String(m?.webm?.max ?? '').trim();
        return mp4Max || mp4 || webm;
      })
      .filter(Boolean)
      .slice(0, 8);

    const price = (d.price_overview ?? {}) as Record<string, any>;
    const categories = (Array.isArray(d.categories) ? d.categories : [])
      .map((c: any) => String(c?.description ?? '').trim())
      .filter(Boolean);
    const genres = (Array.isArray(d.genres) ? d.genres : [])
      .map((g: any) => String(g?.description ?? '').trim())
      .filter(Boolean);
    const tags = Array.isArray(d.popular_tags)
      ? d.popular_tags.map((t: any) => String(t).trim()).filter(Boolean)
      : [];

    return {
      appid,
      name: String(d.name ?? ''),
      steamStoreUrl: `https://store.steampowered.com/app/${appid}`,
      headerImage: d.header_image ? String(d.header_image) : undefined,
      capsuleImage: d.capsule_image ? String(d.capsule_image) : undefined,
      screenshots,
      trailerUrls,
      shortDescription: d.short_description ? String(d.short_description) : undefined,
      detailedDescription: d.detailed_description ? String(d.detailed_description) : undefined,
      developers: (Array.isArray(d.developers) ? d.developers : []).map((x: any) => String(x ?? '').trim()).filter(Boolean),
      publishers: (Array.isArray(d.publishers) ? d.publishers : []).map((x: any) => String(x ?? '').trim()).filter(Boolean),
      categories,
      genres,
      tags,
      isFree: d.is_free === true,
      priceInitial: intField(price.initial),
      priceFinal: intField(price.final),
      discountPercent: intField(price.discount_percent),
      steamDiscounted: intField(price.discount_percent) > 0,
      currentPlayers: (await this.fetchCurrentPlayers(appid)) ?? undefined,
    };
  }

  private normalizeLanguageCode(v: unknown): string {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return 'en';
    return /^[a-z]{2}(-[a-z]{2})?$/.test(s) ? s : 'en';
  }

  private normalizeCountryCode(v: unknown): string {
    const s = String(v ?? '').trim().toUpperCase();
    if (!s) return 'US';
    return /^[A-Z]{2}$/.test(s) ? s : 'US';
  }

  /** Steam returns minor units (cents) for most currencies; JPY is whole yen. */
  minorUnitsToDisplayAmount(amount: number, currency: string): number {
    const c = String(currency ?? 'USD').trim().toUpperCase();
    if (c === 'JPY') return amount;
    return amount / 100;
  }

  formatMinorUnitsFallback(amountMinor: number, currency: string): string {
    const c = String(currency ?? 'USD').trim().toUpperCase();
    const display = this.minorUnitsToDisplayAmount(amountMinor, c);
    const intLike = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX']);
    const frac = intLike.has(c) ? 0 : 2;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: c,
        currencyDisplay: 'symbol',
        minimumFractionDigits: frac,
        maximumFractionDigits: frac,
      }).format(display);
    } catch {
      return `${c} ${display}`;
    }
  }

  private parseSteamPriceOverView(appid: string, country: string, payload: any): SteamRegionalPrice | null {
    const row = payload?.[appid];
    if (!row?.success || !row?.data) return null;
    const po = row.data?.price_overview;
    if (!po) return null;
    const currency = String(po.currency ?? '').trim().toUpperCase() || 'USD';
    const initial = intField(po.initial);
    const finalP = intField(po.final);
    const discount = intField(po.discount_percent);
    const initFmt = String(po.initial_formatted ?? '').trim();
    const finFmt = String(po.final_formatted ?? '').trim();
    const priceSource: 'steam' | 'fallback_format' =
      initFmt.length > 0 && finFmt.length > 0 ? 'steam' : 'fallback_format';
    return {
      appid,
      country,
      currency,
      regularPrice: this.minorUnitsToDisplayAmount(initial, currency),
      salePrice: this.minorUnitsToDisplayAmount(finalP, currency),
      discountPercent: discount,
      fallbackUsed: false,
      initialFormatted:
        initFmt || this.formatMinorUnitsFallback(initial, currency),
      finalFormatted: finFmt || this.formatMinorUnitsFallback(finalP, currency),
      priceSource,
    };
  }

  private parseSteamRegionalPriceDetail(
    appid: string,
    payload: any,
    fallbackUsed: boolean,
  ): SteamRegionalPriceDetail | null {
    const row = payload?.[appid];
    if (!row?.success || !row?.data) return null;
    const d = row.data as Record<string, any>;
    if (d.is_free === true) {
      return {
        currency: '',
        initial: 0,
        final: 0,
        initialFormatted: '',
        finalFormatted: '',
        discountPercent: 0,
        fallbackUsed,
        source: 'steam',
        isFree: true,
      };
    }
    const po = d.price_overview;
    if (!po) return null;
    const currency = String(po.currency ?? '').trim().toUpperCase() || 'USD';
    const initial = intField(po.initial);
    const finalP = intField(po.final);
    const discount = intField(po.discount_percent);
    const initFmt = String(po.initial_formatted ?? '').trim();
    const finFmt = String(po.final_formatted ?? '').trim();
    const source: 'steam' | 'fallback_format' =
      initFmt.length > 0 && finFmt.length > 0 ? 'steam' : 'fallback_format';
    return {
      currency,
      initial,
      final: finalP,
      initialFormatted:
        initFmt || this.formatMinorUnitsFallback(initial, currency),
      finalFormatted: finFmt || this.formatMinorUnitsFallback(finalP, currency),
      discountPercent: discount,
      fallbackUsed,
      source,
    };
  }

  /**
   * Fetches `price_overview` (+ `basic` for is_free) using Steam Store cc + configured language.
   * Prefers Steam `*_formatted` strings; otherwise formats minor units server-side.
   */
  async fetchRegionalPriceDetail(
    appid: string,
    steamCc: string,
    steamLanguageShort: string,
    opts?: { fallbackSteamCc?: string },
  ): Promise<SteamRegionalPriceDetail | null> {
    const e = await getEffectiveEnv(this.env);
    const url = 'https://store.steampowered.com/api/appdetails';
    const cc = this.normalizeCountryCode(steamCc);
    const langToken = mapToSteamAppDetailsLang(steamLanguageShort);

    const req = async (countryCode: string) =>
      axios.get<Record<string, any>>(url, {
        params: {
          appids: appid,
          cc: this.normalizeCountryCode(countryCode),
          l: langToken,
          filters: 'price_overview,basic',
        },
        timeout: Math.max(e.steamHttpTimeoutMs, 15000),
        validateStatus: () => true,
      });

    const first = await req(cc);
    let detail = this.parseSteamRegionalPriceDetail(appid, first.data, false);
    if (detail && !detail.isFree && detail.currency) return detail;
    if (detail?.isFree) return detail;

    const fb = String(opts?.fallbackSteamCc ?? 'US').trim().toUpperCase();
    if (fb && fb !== cc) {
      const second = await req(fb);
      detail = this.parseSteamRegionalPriceDetail(appid, second.data, true);
      if (detail && !detail.isFree && detail.currency) return detail;
      if (detail?.isFree) return { ...detail, fallbackUsed: true };
    }
    return null;
  }

  /** Maps app UI language codes (en, zh, …) to Steam appdetails `l` tokens. */
  private clientUiLangToSteamL(v?: string): string {
    const s = String(v ?? 'en').trim().toLowerCase();
    if (s === 'zh' || s === 'zh-cn' || s === 'zh-hans') return 'schinese';
    if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-hant') return 'tchinese';
    if (s === 'ja') return 'japanese';
    if (s === 'ko') return 'koreana';
    if (s === 'de') return 'german';
    if (s === 'fr') return 'french';
    if (s === 'es') return 'spanish';
    if (s === 'pt' || s === 'pt-br') return 'portuguese';
    if (s === 'ru') return 'russian';
    if (s === 'pl') return 'polish';
    if (s === 'it') return 'italian';
    if (s === 'tr') return 'turkish';
    if (s === 'th') return 'thai';
    if (s === 'vi') return 'vietnamese';
    if (s === 'ar') return 'arabic';
    if (s === 'he') return 'hebrew';
    if (s === 'el') return 'greek';
    if (s === 'hi') return 'hindi';
    if (s === 'id') return 'indonesian';
    if (s === 'nl') return 'dutch';
    if (s === 'sv') return 'swedish';
    return 'english';
  }

  async fetchRegionalPrice(appid: string, country?: string, language?: string): Promise<SteamRegionalPrice | null> {
    const e = await getEffectiveEnv(this.env);
    const url = 'https://store.steampowered.com/api/appdetails';
    const cc = this.normalizeCountryCode(country);
    const lang = this.clientUiLangToSteamL(language);

    const req = async (countryCode: string) =>
      axios.get<Record<string, any>>(url, {
        params: {
          appids: appid,
          cc: countryCode,
          l: lang,
          filters: 'price_overview',
        },
        timeout: Math.max(e.steamHttpTimeoutMs, 15000),
        validateStatus: () => true,
      });

    const first = await req(cc);
    const firstParsed = this.parseSteamPriceOverView(appid, cc, first.data);
    if (firstParsed) return firstParsed;

    if (cc !== 'US') {
      const fallback = await req('US');
      const us = this.parseSteamPriceOverView(appid, 'US', fallback.data);
      if (us) {
        return {
          ...us,
          fallbackUsed: true,
        };
      }
    }
    return null;
  }

  async fetchAppListPage(input?: { lastAppId?: number; maxResults?: number }): Promise<{
    apps: Array<{ appid: string; name: string }>;
    lastAppId: number;
    hasMore: boolean;
  }> {
    const e = await getEffectiveEnv(this.env);
    const key = String(e.steamApiKey ?? '').trim();
    if (!key) return { apps: [], lastAppId: input?.lastAppId ?? 0, hasMore: false };
    let lastAppId = Math.max(0, Math.trunc(input?.lastAppId ?? 0));
    const maxResults = Math.max(1000, Math.min(Math.trunc(input?.maxResults ?? 5000), 50000));
    const url = 'https://api.steampowered.com/IStoreService/GetAppList/v1/';
    const { data } = await axios.get<any>(url, {
      params: {
        key,
        max_results: maxResults,
        last_appid: lastAppId,
        include_games: true,
        include_dlc: false,
        include_software: false,
        include_videos: false,
        include_hardware: false,
      },
      timeout: Math.max(e.steamHttpTimeoutMs, 30000),
      validateStatus: () => true,
    });
    const resp = data?.response ?? {};
    const appsRaw = Array.isArray(resp?.apps) ? resp.apps : [];
    const apps = appsRaw
      .map((a: any) => ({
        appid: String(a?.appid ?? '').trim(),
        name: String(a?.name ?? '').trim(),
      }))
      .filter((a: { appid: string; name: string }) => !!a.appid);
    for (const a of appsRaw) {
      const n = intField(a?.appid);
      if (n > lastAppId) lastAppId = n;
    }
    return {
      apps,
      lastAppId,
      hasMore: resp?.have_more_results === true,
    };
  }

  async fetchAppList(): Promise<Array<{ appid: string; name: string }>> {
    const all: Array<{ appid: string; name: string }> = [];
    let lastAppId = 0;
    let guard = 0;
    while (guard < 80) {
      guard += 1;
      const page = await this.fetchAppListPage({ lastAppId, maxResults: 50000 });
      if (page.apps.length === 0) break;
      all.push(...page.apps);
      lastAppId = page.lastAppId;
      if (!page.hasMore) break;
    }
    return all;
  }

  async fetchSteamReviews(appid: string, opts?: { all?: boolean; maxPages?: number }): Promise<{
    summary: SteamReviewSummary | null;
    reviews: SteamReviewRow[];
  }> {
    const e = await getEffectiveEnv(this.env);
    const maxPages = Math.max(1, Math.min(opts?.maxPages ?? (opts?.all ? 200 : 3), 200));
    const allReviews: SteamReviewRow[] = [];
    let cursor = '*';
    let summary: SteamReviewSummary | null = null;

    for (let i = 0; i < maxPages; i += 1) {
      const url = `https://store.steampowered.com/appreviews/${encodeURIComponent(appid)}`;
      const { data } = await axios.get<any>(url, {
        params: {
          json: 1,
          language: 'all',
          num_per_page: 100,
          filter: 'recent',
          cursor,
        },
        timeout: Math.max(e.steamHttpTimeoutMs, 12000),
        validateStatus: () => true,
      });

      if (!data || (data.success !== 1 && data.success !== true)) break;

      if (!summary && data.query_summary) {
        const qs = data.query_summary as Record<string, unknown>;
        const tp = intField(qs.total_positive);
        const tn = intField(qs.total_negative);
        const denom = tp + tn;
        const pct = denom > 0 ? Math.round((tp * 100) / denom) : 0;
        summary = {
          reviewScoreDesc: String(qs.review_score_desc ?? ''),
          positivePercent: pct,
          totalReviews: intField(qs.num_reviews) || denom,
          totalPositive: tp,
          totalNegative: tn,
        };
      }

      const rowsRaw = Array.isArray(data.reviews) ? data.reviews : [];
      for (const r of rowsRaw) {
        const text = String(r?.review ?? '').replace(/<[^>]*>/g, '').trim();
        if (!text) continue;
        allReviews.push({
          reviewId: String(r?.recommendationid ?? ''),
          authorSteamId: String(r?.author?.steamid ?? ''),
          content: text,
          language: String(r?.language ?? ''),
          votedUp: r?.voted_up === true,
          votesUp: intField(r?.votes_up),
          timestampCreated: intField(r?.timestamp_created),
          timestampUpdated: intField(r?.timestamp_updated) || intField(r?.timestamp_created),
        });
      }

      const nextCursor = String(data.cursor ?? '').trim();
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    allReviews.sort((a, b) => b.timestampCreated - a.timestampCreated);
    return { summary, reviews: allReviews };
  }
}

