import admin from 'firebase-admin';

const TS = '_firestore_timestamp';

export function serializeForSqlite(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof admin.firestore.Timestamp) {
    return { [TS]: true, seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) {
    return { [TS]: true, seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 };
  }
  if (Array.isArray(value)) return value.map(serializeForSqlite);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = serializeForSqlite(v);
    }
    return out;
  }
  return value;
}

export function deserializeFromSqlite(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o[TS] === true && typeof o.seconds === 'number') {
      return new admin.firestore.Timestamp(
        o.seconds as number,
        typeof o.nanoseconds === 'number' ? (o.nanoseconds as number) : 0,
      );
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = deserializeFromSqlite(v);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(deserializeFromSqlite);
  return value;
}
