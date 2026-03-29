import axios from 'axios';

/** CheapShark /deals 列表项（与客户端 CheapShark 一致） */
export type CheapSharkDealRow = {
  dealID: string;
  title: string;
  storeID?: string;
  salePrice: string | number;
  normalPrice: string | number;
  savings: string | number;
  steamAppID?: string;
  steamRatingText?: string;
  steamRatingCount?: number;
  metacriticScore?: string | number;
  releaseDate?: number;
  lastChange?: number;
  thumb?: string;
};

const BASE = 'https://www.cheapshark.com/api/1.0';

/** `GET /games?steamAppId=` 单条查询，用于愿望单定价 */
export type CheapSharkGameInfo = {
  gameID?: string;
  steamAppID?: string;
  title?: string;
  cheapest?: string;
  /** CheapShark 列表字段名 */
  cheapestDealID?: string;
  retail?: string;
  savings?: string | number;
};

export async function fetchGameBySteamAppId(steamAppId: string, timeoutMs: number): Promise<CheapSharkGameInfo | null> {
  if (!steamAppId.trim()) return null;
  try {
    const resp = await axios.get(`${BASE}/games`, {
      timeout: timeoutMs,
      params: { steamAppId: steamAppId.trim() },
    });
    const data = resp.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0] as CheapSharkGameInfo;
  } catch (_) {
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

/** `GET /deals?id=` 返回的 `gameInfo`（与客户端 [GameModel.fromCheapSharkGameInfo] 一致） */
export async function fetchDealGameInfo(dealId: string, timeoutMs: number): Promise<{
  salePrice: number;
  retailPrice: number;
  discountPercent: number;
  title: string;
  steamAppID: string;
  thumb: string;
} | null> {
  if (!dealId.trim()) return null;
  try {
    const resp = await axios.get(`${BASE}/deals`, {
      timeout: timeoutMs,
      params: { id: dealId.trim() },
    });
    const gi = resp.data?.gameInfo;
    if (!gi || typeof gi !== 'object') return null;
    const sale = num((gi as any).salePrice);
    const retail = num((gi as any).retailPrice);
    const discount = retail > 0 ? Math.round((1 - sale / retail) * 100) : 0;
    return {
      salePrice: sale,
      retailPrice: retail,
      discountPercent: discount,
      title: String((gi as any).name ?? ''),
      steamAppID: String((gi as any).steamAppID ?? ''),
      thumb: String((gi as any).thumb ?? ''),
    };
  } catch (_) {
    return null;
  }
}

export async function fetchDealsPage(opts: {
  pageSize: number;
  timeoutMs: number;
  /** CheapShark: Recent | Deal Rating | Metacritic | Release | Savings */
  sortBy?: string;
}): Promise<CheapSharkDealRow[]> {
  const { pageSize, timeoutMs, sortBy = 'Recent' } = opts;
  try {
    const resp = await axios.get(`${BASE}/deals`, {
      timeout: timeoutMs,
      params: {
        pageSize: Math.min(Math.max(pageSize, 10), 60),
        sortBy,
      },
    });
    const data = resp.data;
    if (!Array.isArray(data)) return [];
    return data as CheapSharkDealRow[];
  } catch (e) {
    return [];
  }
}
