import type { DealSource, GameDealLinkDoc } from './game-deal-link.repository';
import { isPriceSyncedOnCalendarDay } from './deal-price-day.util';
import { syncTimestampToMs } from '../../storage/sqlite/timestamp';

export { isPriceSyncedOnCalendarDay } from './deal-price-day.util';

const ALL_SOURCES: DealSource[] = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'];

function dealMatches(deal: GameDealLinkDoc, source: DealSource, businessCc: string): boolean {
  if (deal.source !== source) return false;
  return String(deal.countryCode ?? 'US').trim().toUpperCase() === businessCc;
}

/** 该国×渠道是否已在当前日历日同步过价格 */
export function isCountrySourceSyncedToday(
  deals: GameDealLinkDoc[],
  source: DealSource,
  businessCc: string,
  forceRefresh: boolean,
): boolean {
  if (forceRefresh) return false;
  const row = deals.find((d) => dealMatches(d, source, businessCc));
  if (!row?.lastPriceSyncAt || !String(row.url ?? '').trim()) return false;
  return isPriceSyncedOnCalendarDay(row.lastPriceSyncAt);
}

/** 批量选品：跳过「所有目标国×渠道」今日均已同步的游戏 */
export function filterGamesNeedingPriceSync(
  listDocs: Array<{ appid: string; name?: string }>,
  dealsByAppid: Map<string, GameDealLinkDoc[]>,
  countries: string[],
  sources: DealSource[] | undefined,
  forceRefresh: boolean,
): { toSync: Array<{ appid: string; name?: string }>; skipped: number } {
  if (forceRefresh) return { toSync: listDocs, skipped: 0 };
  const srcs = sources && sources.length > 0 ? sources : ALL_SOURCES;
  const toSync: Array<{ appid: string; name?: string }> = [];
  let skipped = 0;
  for (const doc of listDocs) {
    const deals = dealsByAppid.get(doc.appid) ?? [];
    const needs = countries.some((cc) =>
      srcs.some((s) => !isCountrySourceSyncedToday(deals, s, cc, false)),
    );
    if (needs) toSync.push(doc);
    else skipped += 1;
  }
  return { toSync, skipped };
}

export function maxLastPriceSyncIso(deals: GameDealLinkDoc[]): string | null {
  let max = 0;
  for (const d of deals) {
    const ms = syncTimestampToMs(d.lastPriceSyncAt) ?? 0;
    if (ms > max) max = ms;
  }
  return max > 0 ? new Date(max).toISOString() : null;
}
