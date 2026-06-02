import axios from 'axios';

import { GG_DEALS_API, isGgDealsOfficialRegion } from '../config/external-deal-api.catalog';

import { extractGgGameNodeFromPricesApiBody } from './gg-deals-detail.util';



export type GgPricesByAppIdResult = {

  rawNode: Record<string, unknown>;

  regionUsed: string;

  rateLimitRemaining?: number;

};



function normalizeBase(baseUrl?: string): string {

  const raw = String(baseUrl || GG_DEALS_API.baseUrlDefault).replace(/\/+$/, '');

  if (raw.includes('gg.deals/api')) {

    return raw.replace('https://gg.deals/api', 'https://api.gg.deals');

  }

  return raw;

}



function parseGgBatchDataMap(body: unknown): Record<string, Record<string, unknown>> {

  const out: Record<string, Record<string, unknown>> = {};

  if (body == null || typeof body !== 'object') return out;

  const root = body as Record<string, unknown>;

  if (root.success === false) return out;

  const data = root.data;

  if (data == null || typeof data !== 'object') return out;

  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {

    if (v !== null && typeof v === 'object') out[String(k).trim()] = v as Record<string, unknown>;

  }

  return out;

}



/**

 * `GET /v1/prices/by-steam-app-id/`（文档：https://gg.deals/api/prices/）

 * 仅对官方 region 列表发起请求；非支持 region 直接返回 null（不做 US 回退）。

 */

export async function ggDealsFetchPricesBySteamAppId(opts: {

  apiKey: string;

  baseUrl?: string;

  appid: string;

  region: string;

  timeoutMs: number;

}): Promise<GgPricesByAppIdResult | null> {

  const hit = await ggDealsFetchPricesBySteamAppIds({

    apiKey: opts.apiKey,

    baseUrl: opts.baseUrl,

    appids: [opts.appid],

    region: opts.region,

    timeoutMs: opts.timeoutMs,

  });

  if (!hit) return null;

  const rawNode = hit.byAppid.get(String(opts.appid).trim()) ?? hit.byAppid.get(String(Number(opts.appid)));

  if (!rawNode) return null;

  return { rawNode, regionUsed: hit.regionUsed, rateLimitRemaining: hit.rateLimitRemaining };

}



/** 批量拉价（官方上限 100 ids/请求） */

export async function ggDealsFetchPricesBySteamAppIds(opts: {

  apiKey: string;

  baseUrl?: string;

  appids: string[];

  region: string;

  timeoutMs: number;

}): Promise<{ byAppid: Map<string, Record<string, unknown>>; regionUsed: string; rateLimitRemaining?: number } | null> {

  const regionLc = String(opts.region || 'us')

    .trim()

    .toLowerCase();

  if (!isGgDealsOfficialRegion(regionLc)) return null;



  const ids = Array.from(new Set(opts.appids.map((x) => String(x ?? '').trim()).filter(Boolean)));

  if (!ids.length) return null;



  const base = normalizeBase(opts.baseUrl);

  const path = GG_DEALS_API.endpoints.pricesBySteamAppId.path;

  const url = `${base}${path}`;

  const maxPerReq = GG_DEALS_API.rateLimit.maxIdsPerRequest;

  const byAppid = new Map<string, Record<string, unknown>>();

  let rateLimitRemaining: number | undefined;



  for (let i = 0; i < ids.length; i += maxPerReq) {

    const chunk = ids.slice(i, i + maxPerReq);

    const { data, status, headers } = await axios.get<unknown>(url, {

      params: { key: opts.apiKey.trim(), ids: chunk.join(','), region: regionLc },

      timeout: opts.timeoutMs,

      validateStatus: () => true,

    });

    if (status === 429) break;

    if (status !== 200 || data == null) continue;



    const remaining = headers?.['x-ratelimit-remaining'];

    if (remaining != null) rateLimitRemaining = Number(remaining);



    const map = parseGgBatchDataMap(data);

    for (const appid of chunk) {

      const node = map[appid] ?? map[String(Number(appid))] ?? extractGgGameNodeFromPricesApiBody(data, appid);

      if (node) byAppid.set(appid, node);

    }

  }



  if (!byAppid.size) return null;

  return { byAppid, regionUsed: regionLc, rateLimitRemaining };

}

