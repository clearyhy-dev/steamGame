import axios from 'axios';
import { ITAD_API } from '../config/external-deal-api.catalog';

export type ItadLookupResult = {
  itadGameId: string;
  lookupData: Record<string, unknown>;
  slug?: string;
};

function normalizeBase(baseUrl?: string): string {
  return String(baseUrl || ITAD_API.baseUrlDefault).replace(/\/+$/, '');
}

function authVariants(apiKey: string): Array<Record<string, string>> {
  const k = apiKey.trim();
  return [{ key: k }, { token: k }];
}

/**
 * `GET /games/lookup/v1` — Steam appid → ITAD game id（文档：Games Lookup）。
 */
export async function itadLookupBySteamAppId(opts: {
  apiKey: string;
  baseUrl?: string;
  appid: string;
  timeoutMs: number;
}): Promise<ItadLookupResult | null> {
  const base = normalizeBase(opts.baseUrl);
  const appid = String(opts.appid ?? '').trim();
  if (!appid) return null;

  for (const auth of authVariants(opts.apiKey)) {
    try {
      const r = await axios.get<Record<string, unknown>>(`${base}${ITAD_API.endpoints.gamesLookupV1.path}`, {
        params: { ...auth, appid: Number(appid) },
        timeout: opts.timeoutMs,
        validateStatus: () => true,
      });
      if (!r.data || r.data.error) continue;
      const gameId = r.data.id ?? (r.data.game as Record<string, unknown> | undefined)?.id;
      if (!gameId) continue;
      const game = (r.data.game && typeof r.data.game === 'object' ? r.data.game : {}) as Record<string, unknown>;
      const slug = String(r.data.slug ?? game.slug ?? '').trim() || undefined;
      return {
        itadGameId: String(gameId).trim(),
        lookupData: r.data,
        slug,
      };
    } catch {
      /* next auth */
    }
  }
  return null;
}

/**
 * `POST /games/prices/v3` — 按国取各店 deals（文档：Prices）。
 * 不传 `shops` 时返回该国所有覆盖店铺；deals[].url 为 itad.link 购买跳转。
 */
export async function itadFetchGamePricesV3(opts: {
  apiKey: string;
  baseUrl?: string;
  itadGameIds: string[];
  country: string;
  timeoutMs: number;
  /** 限定 shop id 列表；省略则拉全部店 */
  shops?: number[];
  /** 仅返回有折扣的 deal（query deals=true） */
  dealsOnly?: boolean;
  /** 允许 voucher 价（默认 true，与文档 default 一致） */
  vouchers?: boolean;
}): Promise<unknown[] | null> {
  const base = normalizeBase(opts.baseUrl);
  const ids = opts.itadGameIds.map((id) => String(id).trim()).filter(Boolean);
  if (!ids.length) return null;

  const country = String(opts.country || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const params: Record<string, string | number | boolean> = { country };
  if (opts.shops && opts.shops.length) params.shops = opts.shops.join(',');
  if (opts.dealsOnly) params.deals = true;
  if (opts.vouchers === false) params.vouchers = false;

  for (const auth of authVariants(opts.apiKey)) {
    try {
      const r = await axios.post<unknown>(`${base}${ITAD_API.endpoints.gamesPricesV3.path}`, ids, {
        params: { ...auth, ...params },
        timeout: opts.timeoutMs,
        validateStatus: () => true,
      });
      if (r.data && !(r.data as Record<string, unknown>).error && Array.isArray(r.data)) {
        return r.data;
      }
    } catch {
      /* next */
    }
  }
  return null;
}

export function itadPricesV3EntryForGameId(
  pricesData: unknown[] | null,
  itadGameId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(pricesData) || !pricesData.length) return null;
  const want = String(itadGameId).trim();
  for (const row of pricesData) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    if (String(o.id ?? '').trim() === want) return o;
  }
  return (pricesData[0] as Record<string, unknown>) ?? null;
}
