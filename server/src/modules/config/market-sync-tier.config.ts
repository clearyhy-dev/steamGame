export type MarketSyncTier = 'T1' | 'T2';

export type MarketSyncTierSettings = {
  /** T1 每国 Steam 畅销榜 Top N（默认 500） */
  t1TopNPerCountry: number;
  /** T2 每国 Top N（默认 200） */
  t2TopNPerCountry: number;
  /** T2 每隔几天同步一次（默认 2） */
  t2SyncIntervalDays: number;
};

export const DEFAULT_MARKET_SYNC_TIER_SETTINGS: MarketSyncTierSettings = {
  t1TopNPerCountry: 500,
  t2TopNPerCountry: 200,
  t2SyncIntervalDays: 2,
};

/** 初始 T1 国家（可在 Admin Country/Steam 页随时调整） */
export const DEFAULT_T1_COUNTRY_CODES = new Set([
  'US',
  'CN',
  'JP',
  'KR',
  'GB',
  'DE',
  'FR',
  'CA',
  'AU',
  'BR',
]);

export function normalizeMarketSyncTier(raw: unknown): MarketSyncTier {
  const s = String(raw ?? '').trim().toUpperCase();
  return s === 'T1' ? 'T1' : 'T2';
}

export function topNForSyncTier(tier: MarketSyncTier, settings: MarketSyncTierSettings): number {
  const n = tier === 'T1' ? settings.t1TopNPerCountry : settings.t2TopNPerCountry;
  return Math.max(1, Math.min(Math.trunc(n), 500));
}

export function calendarDayKey(ms: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(ms));
}

/** T1 每天同步；T2 按 intervalDays 轮转（与 DEAL_SYNC_PRICE_DAY_TZ 对齐） */
export function shouldSyncTierOnDay(
  tier: MarketSyncTier,
  settings: MarketSyncTierSettings,
  atMs = Date.now(),
  timeZone?: string,
): boolean {
  if (tier === 'T1') return true;
  const tz = String(timeZone ?? process.env.DEAL_SYNC_PRICE_DAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const interval = Math.max(1, Math.min(Math.trunc(settings.t2SyncIntervalDays), 14));
  const dayKey = calendarDayKey(atMs, tz);
  const dayNum = Math.floor(new Date(`${dayKey}T12:00:00Z`).getTime() / 86400000);
  return dayNum % interval === 0;
}

export function mergeMarketSyncTierSettings(
  partial?: Partial<MarketSyncTierSettings> | null,
): MarketSyncTierSettings {
  const d = DEFAULT_MARKET_SYNC_TIER_SETTINGS;
  return {
    t1TopNPerCountry: Math.max(
      1,
      Math.min(500, Math.trunc(Number(partial?.t1TopNPerCountry ?? d.t1TopNPerCountry))),
    ),
    t2TopNPerCountry: Math.max(
      1,
      Math.min(500, Math.trunc(Number(partial?.t2TopNPerCountry ?? d.t2TopNPerCountry))),
    ),
    t2SyncIntervalDays: Math.max(
      1,
      Math.min(14, Math.trunc(Number(partial?.t2SyncIntervalDays ?? d.t2SyncIntervalDays))),
    ),
  };
}
