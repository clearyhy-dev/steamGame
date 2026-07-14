import { sqlRun } from './sql-client';
import { logger } from '../../utils/logger';

const USER_COLUMN_MIGRATIONS = [
  'ALTER TABLE users ADD COLUMN country_code TEXT',
  'ALTER TABLE users ADD COLUMN country_source TEXT',
  'ALTER TABLE users ADD COLUMN country_updated_at_ms INTEGER',
  'ALTER TABLE users ADD COLUMN google_sub TEXT',
];

const VIDEO_ENGAGEMENTS_DDL = `
CREATE TABLE IF NOT EXISTS video_engagements (
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  liked INTEGER NOT NULL DEFAULT 0,
  favorited INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  watched_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_video_engagements_video ON video_engagements(video_id);
`;

export async function ensureRelationalSchema(): Promise<void> {
  for (const sql of USER_COLUMN_MIGRATIONS) {
    try {
      await sqlRun(sql);
    } catch {
      /* column may already exist */
    }
  }
  for (const stmt of VIDEO_ENGAGEMENTS_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    try {
      await sqlRun(stmt);
    } catch (e) {
      logger.warn(`[relational-schema] ${stmt.slice(0, 60)}…: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  logger.info('[relational-schema] users columns + video_engagements ensured');
}
