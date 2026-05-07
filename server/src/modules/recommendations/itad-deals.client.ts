import axios from 'axios';
import type { CheapSharkDealRow } from './cheapshark.client';

/** Steam 商店在 ITAD 中的 shop id（与官方文档示例一致）。 */
const STEAM_SHOP_ID = '61';

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function pickBanner(assets: unknown): string {
  if (!assets || typeof assets !== 'object') return '';
  const a = assets as Record<string, unknown>;
  const keys = ['banner400', 'banner600', 'banner300', 'banner145', 'boxart'];
  for (const k of keys) {
    const s = String(a[k] ?? '').trim();
    if (s.length > 0) return s;
  }
  return '';
}

function steamAppIdFromUrl(url: string): string | null {
  const m = url.match(/steampowered\.com\/app\/(\d+)/i);
  return m ? m[1] : null;
}

/** ITAD returns display `amount` + ISO `currency` (not Steam minor units). */
export function formatItadMoneyAmount(amount: number, currency: string): string {
  const c = String(currency ?? 'USD').trim().toUpperCase() || 'USD';
  const intLike = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX']);
  const frac = intLike.has(c) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c,
      currencyDisplay: 'symbol',
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(amount);
  } catch {
    return `${c} ${amount}`;
  }
}

/**
 * Extract ITAD `deal.price` / `deal.regular` for list display (docs: deals/v2).
 * Exported for fixture-based shape checks.
 */
export function extractItadDealPriceDisplay(deal: Record<string, unknown> | null | undefined): {
  saleFormatted: string;
  regularFormatted: string;
  currency: string;
} | null {
  if (!deal || typeof deal !== 'object') return null;
  const price = deal.price as Record<string, unknown> | undefined;
  const regular = deal.regular as Record<string, unknown> | undefined;
  const saleAmt = num(price?.amount);
  const regAmt = num(regular?.amount);
  const cur =
    String(price?.currency ?? regular?.currency ?? 'USD')
      .trim()
      .toUpperCase() || 'USD';
  if (!(Number.isFinite(saleAmt) && saleAmt >= 0)) return null;
  const regOk = Number.isFinite(regAmt) && regAmt >= 0 ? regAmt : saleAmt;
  return {
    currency: cur,
    saleFormatted: formatItadMoneyAmount(saleAmt, cur),
    regularFormatted: formatItadMoneyAmount(regOk, cur),
  };
}

async function fetchSteamAppIdForGame(
  base: string,
  apiKey: string,
  itadGameId: string,
  timeoutMs: number,
): Promise<string | null> {
  if (!itadGameId.trim()) return null;
  const auths = [{ key: apiKey }, { token: apiKey }];
  for (const auth of auths) {
    try {
      const r = await axios.get(`${base}/games/info/v2`, {
        params: { ...auth, id: itadGameId.trim() },
        timeout: timeoutMs,
        validateStatus: () => true,
      });
      if (r.status === 200 && r.data && r.data.appid != null) {
        return String(r.data.appid).trim();
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function mapItadListItemToRow(
  item: any,
  base: string,
  apiKey: string,
  timeoutMs: number,
): Promise<CheapSharkDealRow | null> {
  const deal = item?.deal;
  if (!deal || typeof deal !== 'object') return null;
  const shopId = num(deal.shop?.id, -1);
  if (shopId !== 61) return null;

  const url = String(deal.url ?? '');
  let steamApp =
    steamAppIdFromUrl(url) ??
    (await fetchSteamAppIdForGame(base, apiKey, String(item.id ?? '').trim(), timeoutMs));
  if (!steamApp) return null;

  const sale = num(deal.price?.amount);
  const normal = num(deal.regular?.amount);
  const cut = Math.round(num(deal.cut));
  const thumb = pickBanner(item.assets);
  const priced = extractItadDealPriceDisplay(deal as Record<string, unknown>);
  const currency =
    priced?.currency ??
    (String(deal.price?.currency ?? 'USD').trim().toUpperCase() || 'USD');

  return {
    dealID: steamApp,
    title: String(item.title ?? ''),
    steamAppID: steamApp,
    salePrice: sale,
    normalPrice: normal,
    savings: cut,
    thumb,
    metacriticScore: undefined,
    steamRatingCount: undefined,
    lastChange: undefined,
    itadSaleFormatted: priced?.saleFormatted,
    itadRegularFormatted: priced?.regularFormatted,
    itadSaleCurrency: currency,
    listPriceSource: 'itad_store',
  };
}

/**
 * ITAD `GET /deals/v2`：按国家 + 仅 Steam 店拉取当前折扣，并转成与 CheapShark 列表兼容的结构，
 * 供推荐打分逻辑复用。需后台配置的 ITAD API Key（与 discount_providers 一致）。
 */
export async function fetchItadSteamDealsAsCheapSharkRows(opts: {
  apiKey: string;
  baseUrl: string;
  country: string;
  limit: number;
  /** 如 `-cut`（折扣从高到低）、`price`（现价从低到高）；不传则使用 ITAD 默认排序 */
  sort?: string;
  timeoutMs: number;
}): Promise<CheapSharkDealRow[]> {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const key = opts.apiKey.trim();
  if (!key) return [];

  const lim = Math.min(Math.max(Math.trunc(opts.limit), 10), 200);
  let list: any[] = [];
  const authModes = [['key', key] as const, ['token', key] as const];
  for (const [authField, authVal] of authModes) {
    try {
      const params: Record<string, string | number> = {
        country: String(opts.country ?? 'US')
          .trim()
          .toUpperCase()
          .slice(0, 2),
        offset: 0,
        limit: lim,
        shops: STEAM_SHOP_ID,
        [authField]: authVal,
      };
      if (opts.sort && opts.sort.trim()) {
        params.sort = opts.sort.trim();
      }
      const resp = await axios.get(`${base}/deals/v2`, {
        params,
        timeout: opts.timeoutMs,
        validateStatus: () => true,
      });
      if (resp.status === 200 && Array.isArray(resp.data?.list)) {
        list = resp.data.list;
        break;
      }
    } catch {
      /* try token */
    }
  }

  if (!list.length) return [];

  const CONCURRENCY = 8;
  const out: CheapSharkDealRow[] = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      chunk.map((item) => mapItadListItemToRow(item, base, key, opts.timeoutMs)),
    );
    for (const r of rows) {
      if (r) out.push(r);
    }
  }
  return out;
}
