import type { Env } from '../../config/env';
import type { VideoDoc } from './video.types';
import { VideoRepository } from './video.repository';
import { sqliteGetMarketGame } from '../../storage/sqlite/market-games.store';
import {
  sqliteGetVideoEngagementStats,
  sqliteListUserEngagementsForVideos,
  sqliteListUserLikedVideoIds,
  type VideoEngagementRow,
} from '../../storage/sqlite/video-engagements.store';
import { useSqliteRelationalStore } from '../../config/database';
import { publicVideoSummary, serializeVideo } from './video.serializer';

export type VideoFeedItem = ReturnType<typeof publicVideoSummary> & {
  steamAppId?: string;
  linkedAppId?: string;
  gameName?: string;
  playbackVariant: 'vertical' | 'master';
  hasAudio?: boolean;
  stats: {
    likeCount: number;
    favoriteCount: number;
    viewCount: number;
    avgRating: number | null;
  };
  engagement?: {
    liked: boolean;
    favorited: boolean;
    rating: number | null;
  };
  game?: {
    appid: string;
    name: string;
    headerImage?: string;
    priceSummary: unknown;
    discountPercent: number | null;
  } | null;
};

function hasVerticalVariant(v: VideoDoc): boolean {
  if (v.deliveryType !== 'processed') return false;
  const names = (v.variants ?? []).map((x) => x.name);
  return names.includes('vertical_9_16');
}

function verticalVariantHasAudio(v: VideoDoc): boolean {
  if (v.verticalHasAudio === true) return true;
  if (v.verticalHasAudio === false) return false;
  const vertical = (v.variants ?? []).find((x) => x.name === 'vertical_9_16');
  if (vertical?.hasAudio === true) return true;
  if (vertical?.hasAudio === false) return false;
  return v.audioPresent !== false;
}

function resolvePlaybackVariant(v: VideoDoc): 'vertical' | 'master' {
  if (!hasVerticalVariant(v)) return 'master';
  return verticalVariantHasAudio(v) ? 'vertical' : 'master';
}

function resolveVideoAppId(v: VideoDoc): string {
  const steam = String(v.steamAppId ?? '').trim();
  if (/^\d+$/.test(steam)) return steam;
  const gid = String(v.gameId ?? '').trim();
  if (/^\d+$/.test(gid)) return gid;
  return steam || gid;
}

function feedScore(v: VideoDoc, stats: { likeCount: number; viewCount: number }): number {
  const updatedMs =
    typeof (v.updatedAt as { toMillis?: () => number })?.toMillis === 'function'
      ? (v.updatedAt as { toMillis: () => number }).toMillis()
      : Date.now();
  const ageHours = Math.max(1, (Date.now() - updatedMs) / 3_600_000);
  const heat = stats.likeCount * 3 + stats.viewCount + (stats.likeCount > 0 ? 10 : 0);
  return heat / Math.sqrt(ageHours) + Math.random() * 0.5;
}

export class VideoFeedService {
  private videos = new VideoRepository();

  constructor(_env: Env) {}

  async buildFeedItem(
    v: VideoDoc,
    cc: string,
    stats: {
      likeCount: number;
      favoriteCount: number;
      viewCount: number;
      avgRating: number | null;
    },
    engagement?: VideoEngagementRow,
  ): Promise<VideoFeedItem> {
    const summary = publicVideoSummary(v);
    const appid = resolveVideoAppId(v);
    let game: VideoFeedItem['game'] = null;
    if (appid && useSqliteRelationalStore()) {
      const market = await sqliteGetMarketGame(cc, appid);
      if (market) {
        game = {
          appid,
          name: market.name,
          headerImage: undefined,
          priceSummary: market.priceSummary,
          discountPercent: market.discountPercent,
        };
      }
    }
    return {
      ...summary,
      steamAppId: appid || v.steamAppId,
      linkedAppId: appid || undefined,
      gameName: v.gameName ?? game?.name,
      playbackVariant: resolvePlaybackVariant(v),
      hasAudio: verticalVariantHasAudio(v) || v.audioPresent === true,
      stats,
      ...(engagement
        ? {
            engagement: {
              liked: engagement.liked,
              favorited: engagement.favorited,
              rating: engagement.rating,
            },
          }
        : {}),
      game,
    };
  }

  async listUserLikedVideos(params: {
    userId: string;
    limit?: number;
    offset?: number;
    country?: string;
  }): Promise<{ items: Array<VideoFeedItem & { likedAtMs: number }> }> {
    const cc = (params.country ?? 'US').trim().toUpperCase();
    const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
    const offset = Math.max(0, params.offset ?? 0);
    const rows = useSqliteRelationalStore()
      ? await sqliteListUserLikedVideoIds(params.userId, limit, offset)
      : [];
    const items: Array<VideoFeedItem & { likedAtMs: number }> = [];
    for (const row of rows) {
      const v = await this.videos.findById(row.videoId);
      if (!v || v.visibility !== 'public' || v.status !== 'ready') continue;
      const stats = await sqliteGetVideoEngagementStats(v.videoId);
      const engMap = await sqliteListUserEngagementsForVideos(params.userId, [v.videoId]);
      const item = await this.buildFeedItem(v, cc, stats, engMap.get(v.videoId));
      items.push({ ...item, likedAtMs: row.updatedAtMs });
    }
    return { items };
  }

  async listFeed(params: {
    cursor?: string;
    limit?: number;
    country?: string;
    userId?: string;
  }): Promise<{ items: VideoFeedItem[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(params.limit ?? 10, 30));
    const cc = (params.country ?? 'US').trim().toUpperCase();
    const all = await this.videos.listPublicReady(300);
    const candidates = all.filter((v) => v.deliveryType === 'processed' && hasVerticalVariant(v));
    const pool = candidates.length > 0 ? candidates : all.filter((v) => v.status === 'ready' && v.visibility === 'public');

    const scored = await Promise.all(
      pool.map(async (v) => {
        const stats = useSqliteRelationalStore()
          ? await sqliteGetVideoEngagementStats(v.videoId)
          : { likeCount: 0, favoriteCount: 0, viewCount: 0, avgRating: null };
        return { v, stats, score: feedScore(v, stats) };
      }),
    );
    scored.sort((a, b) => b.score - a.score);

    let start = 0;
    if (params.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8')) as {
          videoId?: string;
        };
        const idx = scored.findIndex((x) => x.v.videoId === decoded.videoId);
        if (idx >= 0) start = idx + 1;
      } catch {
        start = 0;
      }
    }

    const slice = scored.slice(start, start + limit);
    const videoIds = slice.map((x) => x.v.videoId);
    const engagements =
      params.userId && useSqliteRelationalStore()
        ? await sqliteListUserEngagementsForVideos(params.userId, videoIds)
        : new Map<string, VideoEngagementRow>();

    const items: VideoFeedItem[] = [];
    for (const { v, stats } of slice) {
      const eng = engagements.get(v.videoId);
      items.push(await this.buildFeedItem(v, cc, stats, eng));
    }

    const last = slice[slice.length - 1];
    const nextCursor =
      start + limit < scored.length && last
        ? Buffer.from(JSON.stringify({ videoId: last.v.videoId }), 'utf8').toString('base64url')
        : null;

    return { items, nextCursor };
  }

  serializePublic(v: VideoDoc) {
    return serializeVideo(v);
  }
}
