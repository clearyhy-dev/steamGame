import admin from 'firebase-admin';

export function nowMs(): number {
  return Date.now();
}

export function msToTimestamp(ms: number | null | undefined): admin.firestore.Timestamp | undefined {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return undefined;
  return admin.firestore.Timestamp.fromMillis(ms);
}

export function timestampToMs(v: admin.firestore.Timestamp | undefined | null): number | undefined {
  if (!v) return undefined;
  return v.toMillis();
}

export function dateToMs(v: Date | undefined | null): number | undefined {
  if (!v) return undefined;
  const ms = v.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export function msToDate(ms: number | null | undefined): Date | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  return new Date(ms);
}

/** Firestore Timestamp / plain ms / ISO / `{ _seconds }` → epoch ms */
export function syncTimestampToMs(
  v: admin.firestore.Timestamp | Date | number | string | Record<string, unknown> | undefined | null,
): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (v instanceof Date) {
    const n = v.getTime();
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'object') {
    if (typeof (v as admin.firestore.Timestamp).toMillis === 'function') {
      return (v as admin.firestore.Timestamp).toMillis();
    }
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
      return dateToMs((v as { toDate: () => Date }).toDate());
    }
    const o = v as { _seconds?: number; _nanoseconds?: number; seconds?: number; nanoseconds?: number };
    const sec = typeof o._seconds === 'number' ? o._seconds : o.seconds;
    if (typeof sec === 'number') {
      const ns = typeof o._nanoseconds === 'number' ? o._nanoseconds : o.nanoseconds ?? 0;
      return sec * 1000 + Math.floor(ns / 1e6);
    }
  }
  return undefined;
}
