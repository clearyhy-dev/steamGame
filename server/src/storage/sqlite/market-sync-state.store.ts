import { sqlGet, sqlRun } from './sql-client';
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
