import axios, { type AxiosResponse } from 'axios';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { mapToSteamAppDetailsLang } from './steam-language.util';
import { buildRegionalSteamStoreAppUrl } from './steam-store-url.util';

const STEAM_APPDETAILS_URL = 'https://store.steampowered.com/api/appdetails';
const DEFAULT_UA =
  'Mozilla/5.0 (compatible; SteamGamePriceSync/1.0; +https://store.steampowered.com)';

export type SteamAppDetailsRow = {
  success?: boolean;
  data?: Record<string, unknown>;
};

export type SteamDealOffer = {
  source: 'steam';
  url: string;
  countryCode?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
};

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isHtmlBlockedBody(data: unknown): boolean {
  if (typeof data === 'string') return data.includes('Access Denied') || data.includes('<HTML');
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) return true;
  }
  return false;
}

function parseRow(data: unknown, appid: string): SteamAppDetailsRow | null {
  if (!data || typeof data !== 'object' || isHtmlBlockedBody(data)) return null;
  const row = (data as Record<string, unknown>)[appid];
  if (!row || typeof row !== 'object') return null;
  return row as SteamAppDetailsRow;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function requestAppDetails(
  env: Env,
  params: Record<string, string>,
): Promise<AxiosResponse<unknown>> {
  const e = await getEffectiveEnv(env);
  const timeoutMs = Math.max(e.steamHttpTimeoutMs, 12000);
  let last: AxiosResponse<unknown> | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await axios.get<unknown>(STEAM_APPDETAILS_URL, {
      params,
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json,text/plain,*/*',
      },
      transformResponse: [(body) => body],
    });
    last = res;

    let parsed: unknown = res.data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = null;
      }
    }

    const blocked =
      res.status === 403 ||
      res.status === 429 ||
      res.status >= 500 ||
      isHtmlBlockedBody(parsed) ||
      parsed == null;

    if (!blocked) return { ...res, data: parsed };
    if (attempt < 3) await sleep(450 * (attempt + 1));
  }

  return last ?? ({ status: 403, data: null } as AxiosResponse<unknown>);
}

export async function fetchSteamAppDetailsOne(
  env: Env,
  appid: string,
  opts: { cc: string; language: string; filters?: string },
): Promise<SteamAppDetailsRow | null> {
  const cc = String(opts.cc || 'us').trim().toLowerCase();
  const l = mapToSteamAppDetailsLang(opts.language);
  const res = await requestAppDetails(env, {
    appids: appid,
    cc,
    l,
    filters: opts.filters ?? 'price_overview,basic',
  });
  return parseRow(res.data, appid);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 批量拉价：小批串行 + 间隔，降低 Steam CDN 403；失败的 appid 再单独重试 */
export async function fetchSteamAppDetailsBatch(
  env: Env,
  appids: string[],
  opts: { cc: string; language: string },
): Promise<Map<string, SteamAppDetailsRow | null>> {
  const out = new Map<string, SteamAppDetailsRow | null>();
  const ids = Array.from(new Set(appids.map((x) => String(x ?? '').trim()).filter(Boolean)));
  if (!ids.length) return out;

  const cc = String(opts.cc || 'us').trim().toLowerCase();
  const l = mapToSteamAppDetailsLang(opts.language);
  const groups = chunk(ids, 10);

  for (const group of groups) {
    const res = await requestAppDetails(env, {
      appids: group.join(','),
      cc,
      l,
      filters: 'price_overview,basic',
    });
    const blocked = res.status === 403 || isHtmlBlockedBody(res.data);
    if (blocked) {
      for (const appid of group) out.set(appid, null);
      await sleep(900);
      continue;
    }
    for (const appid of group) {
      out.set(appid, parseRow(res.data, appid));
    }
    await sleep(300);
  }

  for (const appid of ids) {
    const row = out.get(appid);
    if (row?.success && row.data) continue;
    out.set(appid, await fetchSteamAppDetailsOne(env, appid, { cc, language: opts.language }));
    await sleep(200);
  }

  return out;
}

export function steamAppDetailsRowToDealOffer(
  appid: string,
  row: SteamAppDetailsRow | null | undefined,
  opts: {
    steamStoreCc: string;
    steamLanguage: string;
    businessCountryCode: string;
    defaultCurrency: string;
  },
): SteamDealOffer | null {
  if (!row?.success || !row?.data) return null;
  const d = row.data;
  const biz = String(opts.businessCountryCode || 'US').trim().toUpperCase().slice(0, 2);
  const url = buildRegionalSteamStoreAppUrl(appid, opts.steamStoreCc, opts.steamLanguage);
  const cfgCurrency = String(opts.defaultCurrency ?? '').trim().toUpperCase() || 'USD';
  if (d.is_free === true) {
    return {
      source: 'steam',
      url,
      countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
      currency: cfgCurrency,
      originalPrice: 0,
      finalPrice: 0,
      discountPercent: 0,
    };
  }
  const price = (d.price_overview ?? {}) as Record<string, unknown>;
  const apiCurrency = String(price.currency ?? '').trim().toUpperCase();
  const currency = apiCurrency || cfgCurrency;
  const initial = num(price.initial);
  const finalP = num(price.final);
  if (initial == null && finalP == null) return null;
  return {
    source: 'steam',
    url,
    countryCode: /^[A-Z]{2}$/.test(biz) ? biz : 'US',
    currency,
    originalPrice: initial ?? finalP ?? 0,
    finalPrice: finalP ?? initial ?? 0,
    discountPercent: num(price.discount_percent) ?? 0,
  };
}
