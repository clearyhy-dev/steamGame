import admin from 'firebase-admin';
import { GG_DEALS_API } from '../config/external-deal-api.catalog';
import type { GgDetailSnapshot, GgOfficialPricesSnapshot } from './game-catalog.repository';

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

/**
 * 从 GG API 响应体取单游戏节点：`{ success, data: { [steamAppId]: { url, prices } } }`
 * （与 ggdeals-steam-companion `fetchGamePricesApi` 一致）
 */
export function extractGgGameNodeFromPricesApiBody(body: unknown, appid: string): Record<string, unknown> | null {
  if (body == null || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  if (root.success === false) return null;
  const data = root.data;
  if (data == null || typeof data !== 'object') return null;
  const map = data as Record<string, unknown>;
  const keys = [appid, String(Number(appid))];
  for (const k of keys) {
    const v = map[k];
    if (v !== null && typeof v === 'object') return v as Record<string, unknown>;
  }
  return null;
}

/** 固定路径：`node.prices.currentRetail` / `historicalRetail` / `currency` 等 */
export function parseOfficialGgPricesFromGameNode(node: Record<string, unknown> | null): GgOfficialPricesSnapshot | undefined {
  if (!node) return undefined;
  const pricesRaw = node.prices;
  if (pricesRaw == null || typeof pricesRaw !== 'object') return undefined;
  const p = pricesRaw as Record<string, unknown>;
  const currentRetail = num(p.currentRetail);
  const currentKeyshops = num(p.currentKeyshops);
  const historicalRetail = num(p.historicalRetail);
  const historicalKeyshops = num(p.historicalKeyshops);
  const currency = str(p.currency);
  let lowestCurrentSource: 'retail' | 'keyshop' | undefined;
  if (currentRetail !== undefined && currentKeyshops !== undefined) {
    lowestCurrentSource = currentRetail <= currentKeyshops ? 'retail' : 'keyshop';
  } else if (currentRetail !== undefined) lowestCurrentSource = 'retail';
  else if (currentKeyshops !== undefined) lowestCurrentSource = 'keyshop';

  const hasAny =
    currentRetail !== undefined ||
    currentKeyshops !== undefined ||
    historicalRetail !== undefined ||
    historicalKeyshops !== undefined ||
    currency !== undefined;
  if (!hasAny) return undefined;

  return {
    ...(currentRetail !== undefined ? { currentRetail } : {}),
    ...(currentKeyshops !== undefined ? { currentKeyshops } : {}),
    ...(historicalRetail !== undefined ? { historicalRetail } : {}),
    ...(historicalKeyshops !== undefined ? { historicalKeyshops } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(lowestCurrentSource ? { lowestCurrentSource } : {}),
  };
}

export function lowestCurrentPriceFromGgOfficialPrices(prices: GgOfficialPricesSnapshot): {
  finalPrice: number;
  currency: string;
  source: 'retail' | 'keyshop';
} | null {
  const cur = str(prices.currency) ?? 'USD';
  const r = prices.currentRetail;
  const k = prices.currentKeyshops;
  if (r !== undefined && k !== undefined) {
    return r <= k ? { finalPrice: r, currency: cur, source: 'retail' } : { finalPrice: k, currency: cur, source: 'keyshop' };
  }
  if (r !== undefined) return { finalPrice: r, currency: cur, source: 'retail' };
  if (k !== undefined) return { finalPrice: k, currency: cur, source: 'keyshop' };
  return null;
}

/** 按 GG Prices API 文档映射单游戏 offer（region 已由调用方传入 API） */
export function buildGgDealOfferFromGameNode(input: {
  rawNode: Record<string, unknown>;
  appid: string;
  regionLower: string;
}): {
  url: string;
  currency: string;
  finalPrice: number;
  priceSource: 'retail' | 'keyshop';
} | null {
  const prices = parseOfficialGgPricesFromGameNode(input.rawNode);
  const low = prices ? lowestCurrentPriceFromGgOfficialPrices(prices) : null;
  if (!low) return null;

  const regionLc = String(input.regionLower || 'us').trim().toLowerCase();
  let url = String(input.rawNode.url ?? `https://gg.deals/game/steam-app/${input.appid}/`);
  url = appendGgDealsRegionToUrl(url, regionLc);

  return {
    url,
    currency: low.currency,
    finalPrice: low.finalPrice,
    priceSource: low.source,
  };
}

export function ggNearHistoricalLow(prices: GgOfficialPricesSnapshot | undefined, ratio = 1.05): boolean {
  if (!prices) return false;
  const hit = (cur?: number, hist?: number) =>
    typeof cur === 'number' && typeof hist === 'number' && hist > 0 && cur <= hist * ratio;
  return hit(prices.currentRetail, prices.historicalRetail) || hit(prices.currentKeyshops, prices.historicalKeyshops);
}

/**
 * 为 GG.deals 链接附加 `region=`，便于打开对应区域商店（API 若已带参数则不改）。
 */
export function appendGgDealsRegionToUrl(url: string, regionLower: string): string {
  const u = String(url ?? '').trim();
  if (!u) return u;
  if (/[?&]region=/i.test(u)) return u;
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}region=${encodeURIComponent(String(regionLower || 'us').toLowerCase())}`;
}

/**
 * 仅从 `prices/by-steam-app-id` 的 `rawNode`（单游戏对象）映射 `ggDetail`，不做 Steam/深搜兜底。
 */
export function buildGgDetailSnapshot(input: {
  rawNode: Record<string, unknown> | null;
  /** 实际请求官方 API 的 region */
  ggRegionLower: string;
  priceSyncOk: boolean;
  requestedGgRegion?: string;
  regionProxied?: boolean;
}): GgDetailSnapshot {
  const now = admin.firestore.Timestamp.now();
  const region = String(input.ggRegionLower || 'us')
    .trim()
    .toLowerCase();
  const requested = String(input.requestedGgRegion || region)
    .trim()
    .toLowerCase();
  const proxied = Boolean(input.regionProxied);
  const node = input.rawNode;
  const prices = parseOfficialGgPricesFromGameNode(node);

  const noteBase = `${GG_DEALS_API.docUrl} — GET ${GG_DEALS_API.endpoints.pricesBySteamAppId.path} region=${region}`;
  return {
    ggApiRegion: region,
    ...(requested && requested !== region ? { requestedGgRegion: requested } : {}),
    ...(proxied ? { regionProxied: true, requestedGgRegion: requested || region } : {}),
    syncedAt: now,
    priceSyncOk: input.priceSyncOk,
    ...(prices ? { prices } : {}),
    chartNote: node
      ? proxied
        ? `${noteBase} (proxy for ${requested})`
        : noteBase
      : proxied
        ? `gg_region_${requested}_proxied_empty`
        : region === 'us'
          ? 'no_gg_api_payload'
          : `gg_region_${region}_not_supported`,
  };
}
