import { ITAD_API } from '../config/external-deal-api.catalog';

/** Steam 商店在 ITAD 中的 shop id */
export const ITAD_STEAM_SHOP_ID = ITAD_API.steamShopId;

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function itadShopId(deal: Record<string, unknown>): number | null {
  const shop = deal.shop as Record<string, unknown> | undefined;
  const id = num(shop?.id ?? deal.shopId);
  return id != null ? Math.trunc(id) : null;
}

function dealFinalAmount(deal: Record<string, unknown>): number | null {
  const price = deal.price as Record<string, unknown> | undefined;
  const amt = num(price?.amount);
  return amt != null ? amt : null;
}

/**
 * 从 ITAD `games/prices/v3` 单游戏条目的 deals 列表中选价（文档：Prices）：
 * 取 `country` 请求下 **现价最低** 的一档（含 keyshop/零售），并保留其 `url`/`cut`/`regular`。
 * 各平台列独立展示：Steam 列走 Steam API，ITAD 列走 ITAD 最优 deal，不做 Steam 店优先。
 */
export function pickItadDealFromPricesV3Entry(first: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!first || typeof first !== 'object') return null;
  const raw = first.deals ?? first.prices;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const deals = raw.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
  if (deals.length === 0) return null;

  let best: Record<string, unknown> | null = null;
  let bestAmt = Infinity;
  let bestCut = -1;
  for (const d of deals) {
    const amt = dealFinalAmount(d);
    if (amt == null) continue;
    const cut = num(d.cut ?? (d.price as Record<string, unknown> | undefined)?.cut) ?? 0;
    if (amt < bestAmt || (amt === bestAmt && cut > bestCut)) {
      bestAmt = amt;
      bestCut = cut;
      best = d;
    }
  }
  return best ?? deals[0] ?? null;
}

/** 仅取 ITAD Steam 店 (shop 61) — 供需要与 Steam 区域价对齐的场景 */
export function pickItadSteamDealFromPricesV3Entry(
  first: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!first || typeof first !== 'object') return null;
  const raw = first.deals ?? first.prices;
  if (!Array.isArray(raw)) return null;
  const deals = raw.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object');
  return deals.find((d) => itadShopId(d) === ITAD_STEAM_SHOP_ID) ?? null;
}

/** ITAD deal 块 → 展示价（amount 已是 display 单位，非 Steam 分） */
export function itadDealToPriceFields(deal: Record<string, unknown>): {
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  currency: string;
} {
  const price = deal.price as Record<string, unknown> | undefined;
  const regular = deal.regular as Record<string, unknown> | undefined;
  const finalPrice = num(price?.amount);
  const original = num(regular?.amount ?? price?.amount_old);
  const cut = num(deal.cut ?? price?.cut);
  const currency =
    String(price?.currency ?? regular?.currency ?? 'USD')
      .trim()
      .toUpperCase() || 'USD';
  return {
    currency,
    ...(original != null ? { originalPrice: original } : {}),
    ...(finalPrice != null ? { finalPrice } : {}),
    ...(cut != null
      ? { discountPercent: cut }
      : original != null && finalPrice != null && original > 0
        ? { discountPercent: Math.round((1 - finalPrice / original) * 100) }
        : {}),
  };
}
