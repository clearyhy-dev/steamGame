/** 将任意对象转为可 JSON 序列化的 plain 结构（SQLite / MinIO 栈，无 Firestore 依赖） */
export function toIsoString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.toDate === 'function') {
      const d = (o.toDate as () => Date)();
      return d instanceof Date ? d.toISOString() : null;
    }
    if (typeof o.__firestoreTimestampMillis === 'number') {
      return new Date(o.__firestoreTimestampMillis).toISOString();
    }
    if (typeof o._seconds === 'number') {
      return new Date(o._seconds * 1000).toISOString();
    }
  }
  return null;
}

export function jsonPlain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (v == null) return v;
      if (typeof v === 'object') {
        const iso = toIsoString(v);
        if (iso && (typeof (v as Record<string, unknown>).toDate === 'function' || (v as Record<string, unknown>).__firestoreTimestampMillis != null)) {
          return iso;
        }
      }
      return v;
    }),
  ) as T;
}
