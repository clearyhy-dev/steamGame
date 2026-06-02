-- 配置 / 用户 / 国家 / Steam（迁移目标）
-- 游戏相关表仅建结构，数据由 Steam/折扣 API 同步写入

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  password_hash TEXT,
  display_name TEXT,
  avatar_url TEXT,
  auth_providers_json TEXT NOT NULL DEFAULT '[]',
  admin_note TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  steam_id TEXT,
  steam_persona_name TEXT,
  steam_avatar TEXT,
  steam_profile_url TEXT,
  registered_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id);
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS config_discount_providers (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  itad_api_key TEXT NOT NULL DEFAULT '',
  gg_deals_api_key TEXT NOT NULL DEFAULT '',
  steam_api_key TEXT NOT NULL DEFAULT '',
  itad_base_url TEXT NOT NULL DEFAULT 'https://api.isthereanydeal.com',
  gg_deals_base_url TEXT NOT NULL DEFAULT 'https://api.gg.deals',
  cheap_shark_base_url TEXT NOT NULL DEFAULT 'https://www.cheapshark.com/api/1.0',
  steam_web_api_base_url TEXT NOT NULL DEFAULT 'https://api.steampowered.com',
  steam_store_base_url TEXT NOT NULL DEFAULT 'https://store.steampowered.com',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config_runtime (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  task_key TEXT NOT NULL,
  timezone TEXT NOT NULL,
  frequency TEXT NOT NULL,
  time_of_day TEXT,
  every_hours INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  last_run_at_ms INTEGER,
  last_run_ok INTEGER,
  last_run_summary TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS region_country_configs (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  native_name TEXT,
  steam_cc TEXT NOT NULL,
  itad_country TEXT,
  gg_deals_region TEXT,
  cheapshark_country TEXT,
  default_currency TEXT NOT NULL,
  currency_symbol TEXT NOT NULL,
  steam_language TEXT NOT NULL,
  ui_language TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_region_country_sort ON region_country_configs(sort_order, country_code);

CREATE TABLE IF NOT EXISTS steam_profiles (
  steam_id TEXT PRIMARY KEY,
  persona_name TEXT NOT NULL,
  real_name TEXT,
  avatar TEXT,
  avatar_full TEXT,
  profile_url TEXT,
  country_code TEXT,
  country_hydration_checked_at_ms INTEGER,
  force_country_refresh_once INTEGER NOT NULL DEFAULT 0,
  time_created INTEGER,
  last_fetched_at_ms INTEGER NOT NULL,
  linked_user_id TEXT
);

CREATE TABLE IF NOT EXISTS steam_friends_cache (
  owner_steam_id TEXT PRIMARY KEY,
  friends_json TEXT NOT NULL,
  last_fetched_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_owned_games_cache (
  owner_steam_id TEXT PRIMARY KEY,
  games_json TEXT NOT NULL,
  game_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_recent_games_cache (
  owner_steam_id TEXT PRIMARY KEY,
  games_json TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at_ms INTEGER NOT NULL
);

-- 游戏域（JSON + 索引列；由 Steam/折扣同步写入）
CREATE TABLE IF NOT EXISTS game_catalog (
  appid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  detail_synced INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  current_players INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  last_detail_sync_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_catalog_players ON game_catalog(current_players DESC);
CREATE INDEX IF NOT EXISTS idx_game_catalog_updated ON game_catalog(updated_at_ms DESC);

-- 国家维度市场数据（v2：Admin/App 按 country_code 查询）
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

CREATE TABLE IF NOT EXISTS game_reviews (
  appid TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_weekly_heat (
  appid TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT,
  visibility TEXT,
  game_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_game_id ON videos(game_id);

CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);

CREATE TABLE IF NOT EXISTS video_sources (
  id TEXT PRIMARY KEY,
  steam_app_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_sources_steam_app ON video_sources(steam_app_id);

-- Firestore 集合 → 独立 JSON 表（doc_id + data_json）
CREATE TABLE IF NOT EXISTS user_favorites (
  doc_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_updated ON user_favorites(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS game_deal_links (
  doc_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_discount_offers (
  doc_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_discount_offers_updated ON game_discount_offers(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS steam_sync_jobs (
  doc_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steam_sync_jobs_updated ON steam_sync_jobs(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS api_request_logs (
  doc_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_updated ON api_request_logs(updated_at_ms DESC);

-- 未映射集合的兜底（不应再写入新数据）
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (collection, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
