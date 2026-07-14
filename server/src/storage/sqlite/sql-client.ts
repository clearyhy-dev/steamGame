import { loadEnv } from '../../config/env';

type SqlMode = 'all' | 'get' | 'run';

export type SqlRow = Record<string, unknown>;

let baseUrl: string | undefined;
let secret: string | undefined;

function cfg(): { base: string; secret?: string } {
  if (!baseUrl) {
    const env = loadEnv();
    const base = env.sqliteApiUrl ?? process.env.SQLITE_API_URL?.trim();
    if (!base) throw new Error('SQLITE_API_URL is required when DATA_STORE=vultr_sqlite');
    baseUrl = base.replace(/\/+$/, '');
    secret = (env.sqliteApiSecret ?? process.env.SQLITE_API_SECRET?.trim()) || undefined;
  }
  return { base: baseUrl, secret };
}

function isTransientSqlFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|other side closed|socket hang up|UND_ERR_SOCKET/i.test(
    msg,
  );
}

async function sqlRequest<T>(sql: string, params: unknown[], mode: SqlMode): Promise<T> {
  const { base, secret: sec } = cfg();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sec) headers['X-Data-Api-Secret'] = sec;
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base}/v1/sql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql, params, mode }),
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; message?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(`SQLite API: ${res.status} ${json.message ?? ''} — ${sql.slice(0, 120)}`);
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (!isTransientSqlFetchError(e) || attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
  throw lastErr;
}

export async function sqlAll<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const out = await sqlRequest<{ rows: T[] }>(sql, params, 'all');
  return out.rows ?? [];
}

export async function sqlGet<T extends SqlRow = SqlRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const out = await sqlRequest<{ row: T | null }>(sql, params, 'get');
  return out.row ?? null;
}

export async function sqlRun(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
  const out = await sqlRequest<{ changes: number }>(sql, params, 'run');
  return { changes: out.changes ?? 0 };
}
