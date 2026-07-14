import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { nowMs } from './timestamp';

export type VideoEngagementRow = {
  userId: string;
  videoId: string;
  liked: boolean;
  favorited: boolean;
  rating: number | null;
  watchedMs: number;
  updatedAtMs: number;
};

type DbRow = {
  user_id: string;
  video_id: string;
  liked: number;
  favorited: number;
  rating: number | null;
  watched_ms: number;
  updated_at_ms: number;
};

function rowToEngagement(r: DbRow): VideoEngagementRow {
  return {
    userId: r.user_id,
    videoId: r.video_id,
    liked: r.liked === 1,
    favorited: r.favorited === 1,
    rating: r.rating,
    watchedMs: r.watched_ms,
    updatedAtMs: r.updated_at_ms,
  };
}

export async function sqliteGetVideoEngagement(
  userId: string,
  videoId: string,
): Promise<VideoEngagementRow | null> {
  const row = await sqlGet<DbRow>(
    'SELECT * FROM video_engagements WHERE user_id = ? AND video_id = ?',
    [userId, videoId],
  );
  return row ? rowToEngagement(row) : null;
}

export async function sqliteUpsertVideoEngagement(input: {
  userId: string;
  videoId: string;
  liked?: boolean;
  favorited?: boolean;
  rating?: number | null;
  watchedMs?: number;
}): Promise<VideoEngagementRow> {
  const now = nowMs();
  const cur = await sqliteGetVideoEngagement(input.userId, input.videoId);
  const liked = input.liked ?? cur?.liked ?? false;
  const favorited = input.favorited ?? cur?.favorited ?? false;
  const rating = input.rating !== undefined ? input.rating : (cur?.rating ?? null);
  const watchedMs = Math.max(0, input.watchedMs ?? cur?.watchedMs ?? 0);
  await sqlRun(
    `INSERT INTO video_engagements (user_id, video_id, liked, favorited, rating, watched_ms, updated_at_ms)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id, video_id) DO UPDATE SET
       liked=excluded.liked, favorited=excluded.favorited, rating=excluded.rating,
       watched_ms=excluded.watched_ms, updated_at_ms=excluded.updated_at_ms`,
    [
      input.userId,
      input.videoId,
      liked ? 1 : 0,
      favorited ? 1 : 0,
      rating,
      watchedMs,
      now,
    ],
  );
  return {
    userId: input.userId,
    videoId: input.videoId,
    liked,
    favorited,
    rating,
    watchedMs,
    updatedAtMs: now,
  };
}

export async function sqliteGetVideoEngagementStats(videoId: string): Promise<{
  likeCount: number;
  favoriteCount: number;
  viewCount: number;
  avgRating: number | null;
}> {
  const row = await sqlGet<{
    like_count: number;
    favorite_count: number;
    view_count: number;
    avg_rating: number | null;
  }>(
    `SELECT
       SUM(CASE WHEN liked = 1 THEN 1 ELSE 0 END) AS like_count,
       SUM(CASE WHEN favorited = 1 THEN 1 ELSE 0 END) AS favorite_count,
       COUNT(*) AS view_count,
       AVG(CASE WHEN rating IS NOT NULL THEN rating END) AS avg_rating
     FROM video_engagements WHERE video_id = ?`,
    [videoId],
  );
  return {
    likeCount: Number(row?.like_count ?? 0),
    favoriteCount: Number(row?.favorite_count ?? 0),
    viewCount: Number(row?.view_count ?? 0),
    avgRating: row?.avg_rating != null ? Number(row.avg_rating) : null,
  };
}

export async function sqliteListUserEngagementsForVideos(
  userId: string,
  videoIds: string[],
): Promise<Map<string, VideoEngagementRow>> {
  if (videoIds.length === 0) return new Map();
  const placeholders = videoIds.map(() => '?').join(',');
  const rows = await sqlAll<DbRow>(
    `SELECT * FROM video_engagements WHERE user_id = ? AND video_id IN (${placeholders})`,
    [userId, ...videoIds],
  );
  const out = new Map<string, VideoEngagementRow>();
  for (const r of rows) out.set(r.video_id, rowToEngagement(r));
  return out;
}

export async function sqliteListUserLikedVideoIds(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<Array<{ videoId: string; updatedAtMs: number }>> {
  const rows = await sqlAll<{ video_id: string; updated_at_ms: number }>(
    `SELECT video_id, updated_at_ms
     FROM video_engagements
     WHERE user_id = ? AND liked = 1 AND user_id NOT LIKE 'anon_%'
     ORDER BY updated_at_ms DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset],
  );
  return rows.map((r) => ({ videoId: r.video_id, updatedAtMs: r.updated_at_ms }));
}

export async function sqliteRecordAnonymousVideoView(videoId: string, watchedMs = 0): Promise<void> {
  const anonUserId = `anon_${videoId.slice(0, 8)}`;
  const cur = await sqliteGetVideoEngagement(anonUserId, videoId);
  await sqliteUpsertVideoEngagement({
    userId: anonUserId,
    videoId,
    watchedMs: (cur?.watchedMs ?? 0) + Math.max(0, watchedMs),
  });
}
