import type { Timestamp } from 'firebase-admin/firestore';

export function tsToIso(t: Timestamp | undefined | null): string | null {
  if (!t) return null;
  if (typeof (t as Timestamp).toDate === 'function') {
    return (t as Timestamp).toDate().toISOString();
  }
  return null;
}

export function isoToMillis(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : undefined;
}
