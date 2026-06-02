import admin from 'firebase-admin';
import { syncTimestampToMs } from '../../storage/sqlite/timestamp';

/** 折扣「今日已同步」日历日（与 Admin 筛选、跳过逻辑一致） */
export const DEFAULT_DEAL_PRICE_DAY_TZ = 'Asia/Shanghai';

export function calendarDayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}

export function dealPriceDayTz(): string {
  return String(process.env.DEAL_SYNC_PRICE_DAY_TZ ?? DEFAULT_DEAL_PRICE_DAY_TZ).trim() || DEFAULT_DEAL_PRICE_DAY_TZ;
}

export function isPriceSyncedOnCalendarDay(
  lastPriceSyncAt: admin.firestore.Timestamp | Date | number | string | undefined,
  nowMs = Date.now(),
  timeZone?: string,
): boolean {
  const lastMs = syncTimestampToMs(lastPriceSyncAt);
  if (lastMs == null) return false;
  const tz = timeZone ?? dealPriceDayTz();
  return calendarDayKey(lastMs, tz) === calendarDayKey(nowMs, tz);
}
