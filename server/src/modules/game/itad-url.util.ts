/** ITAD 游戏页（非 Steam 商店 deal 跳转链接） */
export function buildItadGamePageUrl(input: {
  lookupData?: Record<string, unknown> | null;
  itadGameId?: string | null;
  steamAppid?: string | null;
}): string {
  const ld = input.lookupData ?? {};
  const game = (ld.game && typeof ld.game === 'object' ? ld.game : {}) as Record<string, unknown>;
  const slug = String(ld.slug ?? game.slug ?? '')
    .trim()
    .toLowerCase();
  if (slug) return `https://isthereanydeal.com/game/${encodeURIComponent(slug)}/`;
  const gid = String(input.itadGameId ?? ld.id ?? game.id ?? '').trim();
  if (gid) return `https://isthereanydeal.com/game/${encodeURIComponent(gid)}/info/`;
  const appid = String(input.steamAppid ?? '').trim();
  if (appid) return `https://isthereanydeal.com/search/?q=${encodeURIComponent(`appid:${appid}`)}`;
  return 'https://isthereanydeal.com/';
}

export function isSteamStoreUrl(url: string | null | undefined): boolean {
  return /steampowered\.com\/app\//i.test(String(url ?? ''));
}

/** ITAD `deals/v2` / `games/prices/v3` 返回的购买跳转（itad.link 或 next.isthereanydeal.com/link） */
export function isItadDealPurchaseUrl(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim();
  if (!u) return false;
  return /itad\.link\//i.test(u) || /isthereanydeal\.com\/link\//i.test(u);
}

export function itadDealPurchaseUrl(deal: Record<string, unknown> | null | undefined): string | null {
  const u = String(deal?.url ?? '').trim();
  if (!u || !isItadDealPurchaseUrl(u)) return null;
  return u;
}

/** 优先使用 prices/v3 deal 购买链接，否则回退 ITAD 游戏页 */
export function resolveItadOfferUrl(input: {
  deal: Record<string, unknown> | null | undefined;
  lookupData?: Record<string, unknown> | null;
  itadGameId: string;
  steamAppid: string;
}): string {
  const purchase = itadDealPurchaseUrl(input.deal ?? null);
  if (purchase) return purchase;
  return buildItadGamePageUrl({
    lookupData: input.lookupData,
    itadGameId: input.itadGameId,
    steamAppid: input.steamAppid,
  });
}
