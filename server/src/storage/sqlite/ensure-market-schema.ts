import { sqlRun, sqlGet } from './sql-client';
import { useSqliteRelationalStore } from '../../config/database';
import { logger } from '../../utils/logger';

const MARKET_DDL = `
CREATE TABLE IF NOT EXISTS market_games (
  country_code TEXT NOT NULL,
  appid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  currency_symbol TEXT NOT NULL DEFAULT '$',
  current_players INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  final_price REAL,
  heat_score REAL NOT NULL DEFAULT 0,
  detail_synced_at_ms INTEGER,
  price_synced_at_ms INTEGER,
  detail_json_path TEXT,
  heat_json_path TEXT,
  prices_json_path TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (country_code, appid)
);
CREATE INDEX IF NOT EXISTS idx_market_games_country_players ON market_games(country_code, current_players DESC);
CREATE INDEX IF NOT EXISTS idx_market_games_country_heat ON market_games(country_code, heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_market_games_country_appid ON market_games(country_code, appid ASC);
CREATE TABLE IF NOT EXISTS market_sync_global_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  country_queue_json TEXT NOT NULL DEFAULT '[]',
  current_country_index INTEGER NOT NULL DEFAULT 0,
  current_country_code TEXT,
  appid_cursor TEXT NOT NULL DEFAULT '',
  last_run_at_ms INTEGER,
  last_run_summary TEXT,
  updated_at_ms INTEGER NOT NULL
);
`;

/** Cloud Run 启动时确保 market v2 表存在（无需单独 redeploy Vultr data-api） */
export async function ensureMarketV2Tables(): Promise<void> {
  if (!useSqliteRelationalStore()) return;
  const statements = MARKET_DDL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) {
    await sqlRun(sql);
  }
  logger.info('[market-schema] market_games + market_sync_global_state ensured');
  await migrateMarketSyncStateHotColumns();
}

async function migrateMarketSyncStateHotColumns(): Promise<void> {
  const cols = await sqlGet<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('market_sync_global_state') WHERE name='country_hot_appids_json'",
  );
  if ((cols?.n ?? 0) > 0) return;
  try {
    await sqlRun(`ALTER TABLE market_sync_global_state ADD COLUMN country_hot_appids_json TEXT NOT NULL DEFAULT '[]'`);
    await sqlRun(`ALTER TABLE market_sync_global_state ADD COLUMN country_hot_for_code TEXT`);
    logger.info('[market-schema] market_sync_global_state hot-appids columns added');
  } catch (e) {
    logger.warn(`[market-schema] hot columns migrate: ${e instanceof Error ? e.message : String(e)}`);
  }
}
