import { sqlGet, sqlRun, sqlAll } from './sql-client';
import { nowMs } from './timestamp';

export type MarketSyncGlobalState = {
  countryQueue: string[];
  currentCountryIndex: number;
  currentCountryCode: string | null;
  appidCursor: string;
  /** 当前国 Steam 区域畅销榜 appid 列表（热度降序） */
  countryHotAppids: string[];
  countryHotForCode: string | null;
  lastRunAtMs: number | null;
  lastRunSummary: string | null;
};

type StateRow = {
  id: number;
  country_queue_json: string;
  current_country_index: number;
  current_country_code: string | null;
  appid_cursor: string;
  country_hot_appids_json?: string;
  country_hot_for_code?: string | null;
  last_run_at_ms: number | null;
  last_run_summary: string | null;
  updated_at_ms: number;
};

function parseHotAppids(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseQueue(raw: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x ?? '').trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  } catch {
    return [];
  }
}

function rowToState(r: StateRow): MarketSyncGlobalState {
  return {
    countryQueue: parseQueue(r.country_queue_json),
    currentCountryIndex: r.current_country_index,
    currentCountryCode: r.current_country_code,
    appidCursor: r.appid_cursor ?? '',
    countryHotAppids: parseHotAppids(r.country_hot_appids_json),
    countryHotForCode: r.country_hot_for_code ?? null,
    lastRunAtMs: r.last_run_at_ms,
    lastRunSummary: r.last_run_summary,
  };
}

export async function sqliteGetMarketSyncGlobalState(): Promise<MarketSyncGlobalState | null> {
  const row = await sqlGet<StateRow>('SELECT * FROM market_sync_global_state WHERE id = 1');
  return row ? rowToState(row) : null;
}

export async function sqliteSaveMarketSyncGlobalState(state: MarketSyncGlobalState): Promise<void> {
  const now = nowMs();
  await sqlRun(
    `INSERT INTO market_sync_global_state (
      id, country_queue_json, current_country_index, current_country_code, appid_cursor,
      country_hot_appids_json, country_hot_for_code,
      last_run_at_ms, last_run_summary, updated_at_ms
    ) VALUES (1,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      country_queue_json=excluded.country_queue_json,
      current_country_index=excluded.current_country_index,
      current_country_code=excluded.current_country_code,
      appid_cursor=excluded.appid_cursor,
      country_hot_appids_json=excluded.country_hot_appids_json,
      country_hot_for_code=excluded.country_hot_for_code,
      last_run_at_ms=excluded.last_run_at_ms,
      last_run_summary=excluded.last_run_summary,
      updated_at_ms=excluded.updated_at_ms`,
    [
      JSON.stringify(state.countryQueue),
      state.currentCountryIndex,
      state.currentCountryCode,
      state.appidCursor,
      JSON.stringify(state.countryHotAppids ?? []),
      state.countryHotForCode,
      state.lastRunAtMs,
      state.lastRunSummary,
      now,
    ],
  );
}

export async function sqliteEnsureMarketSyncGlobalState(initialQueue: string[]): Promise<MarketSyncGlobalState> {
  const existing = await sqliteGetMarketSyncGlobalState();
  if (existing) return existing;
  const state: MarketSyncGlobalState = {
    countryQueue: initialQueue,
    currentCountryIndex: 0,
    currentCountryCode: initialQueue[0] ?? null,
    appidCursor: '',
    countryHotAppids: [],
    countryHotForCode: null,
    lastRunAtMs: null,
    lastRunSummary: null,
  };
  await sqliteSaveMarketSyncGlobalState(state);
  return state;
}

/** 分片 worker 独立游标（每 worker 在分片内轮询国家） */
export type MarketSyncWorkerState = {
  workerId: number;
  workerCount: number;
  currentShardIndex: number;
  shardQueue: string[];
  lastRunAtMs: number | null;
  lastRunSummary: string | null;
};

/** 每国独立 appid 游标与畅销榜缓存（多 worker 安全） */
export type MarketSyncCountryState = {
  countryCode: string;
  appidCursor: string;
  countryHotAppids: string[];
  lastRunAtMs: number | null;
  lastRunSummary: string | null;
};

type WorkerStateRow = {
  worker_id: number;
  worker_count: number;
  current_shard_index: number;
  shard_queue_json: string;
  last_run_at_ms: number | null;
  last_run_summary: string | null;
  updated_at_ms: number;
};

type CountryStateRow = {
  country_code: string;
  appid_cursor: string;
  country_hot_appids_json: string;
  last_run_at_ms: number | null;
  last_run_summary: string | null;
  updated_at_ms: number;
};

function rowToWorkerState(r: WorkerStateRow): MarketSyncWorkerState {
  return {
    workerId: r.worker_id,
    workerCount: r.worker_count,
    currentShardIndex: r.current_shard_index,
    shardQueue: parseQueue(r.shard_queue_json),
    lastRunAtMs: r.last_run_at_ms,
    lastRunSummary: r.last_run_summary,
  };
}

function rowToCountryState(r: CountryStateRow): MarketSyncCountryState {
  return {
    countryCode: r.country_code,
    appidCursor: r.appid_cursor ?? '',
    countryHotAppids: parseHotAppids(r.country_hot_appids_json),
    lastRunAtMs: r.last_run_at_ms,
    lastRunSummary: r.last_run_summary,
  };
}

export async function sqliteGetMarketSyncWorkerState(
  workerId: number,
  workerCount: number,
): Promise<MarketSyncWorkerState | null> {
  const row = await sqlGet<WorkerStateRow>(
    'SELECT * FROM market_sync_worker_state WHERE worker_id = ? AND worker_count = ?',
    [workerId, workerCount],
  );
  return row ? rowToWorkerState(row) : null;
}

export async function sqliteSaveMarketSyncWorkerState(state: MarketSyncWorkerState): Promise<void> {
  const now = nowMs();
  await sqlRun(
    `INSERT INTO market_sync_worker_state (
      worker_id, worker_count, current_shard_index, shard_queue_json,
      last_run_at_ms, last_run_summary, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(worker_id, worker_count) DO UPDATE SET
      current_shard_index=excluded.current_shard_index,
      shard_queue_json=excluded.shard_queue_json,
      last_run_at_ms=excluded.last_run_at_ms,
      last_run_summary=excluded.last_run_summary,
      updated_at_ms=excluded.updated_at_ms`,
    [
      state.workerId,
      state.workerCount,
      state.currentShardIndex,
      JSON.stringify(state.shardQueue),
      state.lastRunAtMs,
      state.lastRunSummary,
      now,
    ],
  );
}

export async function sqliteEnsureMarketSyncWorkerState(
  workerId: number,
  workerCount: number,
  shardQueue: string[],
): Promise<MarketSyncWorkerState> {
  const existing = await sqliteGetMarketSyncWorkerState(workerId, workerCount);
  if (existing) {
    if (JSON.stringify(existing.shardQueue) !== JSON.stringify(shardQueue)) {
      existing.shardQueue = shardQueue;
      if (existing.currentShardIndex >= shardQueue.length) existing.currentShardIndex = 0;
      await sqliteSaveMarketSyncWorkerState(existing);
    }
    return existing;
  }
  const state: MarketSyncWorkerState = {
    workerId,
    workerCount,
    currentShardIndex: 0,
    shardQueue,
    lastRunAtMs: null,
    lastRunSummary: null,
  };
  await sqliteSaveMarketSyncWorkerState(state);
  return state;
}

export async function sqliteGetMarketSyncCountryState(countryCode: string): Promise<MarketSyncCountryState | null> {
  const cc = countryCode.toUpperCase();
  const row = await sqlGet<CountryStateRow>(
    'SELECT * FROM market_sync_country_state WHERE country_code = ?',
    [cc],
  );
  return row ? rowToCountryState(row) : null;
}

export async function sqliteSaveMarketSyncCountryState(state: MarketSyncCountryState): Promise<void> {
  const now = nowMs();
  const cc = state.countryCode.toUpperCase();
  await sqlRun(
    `INSERT INTO market_sync_country_state (
      country_code, appid_cursor, country_hot_appids_json,
      last_run_at_ms, last_run_summary, updated_at_ms
    ) VALUES (?,?,?,?,?,?)
    ON CONFLICT(country_code) DO UPDATE SET
      appid_cursor=excluded.appid_cursor,
      country_hot_appids_json=excluded.country_hot_appids_json,
      last_run_at_ms=excluded.last_run_at_ms,
      last_run_summary=excluded.last_run_summary,
      updated_at_ms=excluded.updated_at_ms`,
    [
      cc,
      state.appidCursor,
      JSON.stringify(state.countryHotAppids ?? []),
      state.lastRunAtMs,
      state.lastRunSummary,
      now,
    ],
  );
}

export async function sqliteEnsureMarketSyncCountryState(countryCode: string): Promise<MarketSyncCountryState> {
  const existing = await sqliteGetMarketSyncCountryState(countryCode);
  if (existing) return existing;
  const state: MarketSyncCountryState = {
    countryCode: countryCode.toUpperCase(),
    appidCursor: '',
    countryHotAppids: [],
    lastRunAtMs: null,
    lastRunSummary: null,
  };
  await sqliteSaveMarketSyncCountryState(state);
  return state;
}

export async function sqliteResetMarketSyncCountryStates(countryCodes: string[]): Promise<number> {
  if (countryCodes.length === 0) return 0;
  let n = 0;
  for (const cc of countryCodes) {
    await sqliteSaveMarketSyncCountryState({
      countryCode: cc.toUpperCase(),
      appidCursor: '',
      countryHotAppids: [],
      lastRunAtMs: null,
      lastRunSummary: null,
    });
    n++;
  }
  return n;
}

export async function sqliteListMarketSyncWorkerStates(workerCount?: number): Promise<MarketSyncWorkerState[]> {
  const rows = workerCount
    ? await sqlAll<WorkerStateRow>(
        'SELECT * FROM market_sync_worker_state WHERE worker_count = ? ORDER BY worker_id ASC',
        [workerCount],
      )
    : await sqlAll<WorkerStateRow>(
        'SELECT * FROM market_sync_worker_state ORDER BY worker_count ASC, worker_id ASC',
      );
  return rows.map(rowToWorkerState);
}
