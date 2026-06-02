/**
 * Firestore 集合名 → Vultr SQLite 表（与 deploy/vultr/data-api/src/schema.sql 一致）。
 * 配置/用户/国家/Steam 走关系型 store；游戏/视频等走 data-api 集合路由。
 */
export const SQLITE_RELATIONAL_COLLECTIONS = [
  'users',
  'region_country_configs',
  'system_config',
  'steam_profiles',
  'steam_friends_cache',
  'steam_games_owned_cache',
  'steam_games_recent_cache',
] as const;

export const SQLITE_DOC_COLLECTIONS = [
  'game_catalog',
  'game_reviews',
  'game_weekly_heat',
  'game_deal_links',
  'game_discount_offers',
  'user_favorites',
  'steam_sync_jobs',
  'api_request_logs',
  'videos',
  'video_jobs',
  'video_sources',
] as const;
