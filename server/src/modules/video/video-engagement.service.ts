import type { Env } from '../../config/env';
import { VideoRepository } from './video.repository';
import {
  sqliteGetVideoEngagement,
  sqliteGetVideoEngagementStats,
  sqliteRecordAnonymousVideoView,
  sqliteUpsertVideoEngagement,
} from '../../storage/sqlite/video-engagements.store';
import { useSqliteRelationalStore } from '../../config/database';
import { ApiError } from '../../utils/apiError';

export class VideoEngagementService {
  private videos = new VideoRepository();

  constructor(_env: Env) {}

  private ensureStore() {
    if (!useSqliteRelationalStore()) {
      throw new ApiError(503, 'INTERNAL_ERROR', 'Video engagements require vultr_sqlite');
    }
  }

  async toggleLike(userId: string, videoId: string) {
    this.ensureStore();
    await this.ensureVideo(videoId);
    const cur = await sqliteGetVideoEngagement(userId, videoId);
    const liked = !(cur?.liked ?? false);
    const row = await sqliteUpsertVideoEngagement({ userId, videoId, liked });
    const stats = await sqliteGetVideoEngagementStats(videoId);
    return { liked: row.liked, stats };
  }

  async toggleFavorite(userId: string, videoId: string) {
    this.ensureStore();
    await this.ensureVideo(videoId);
    const cur = await sqliteGetVideoEngagement(userId, videoId);
    const favorited = !(cur?.favorited ?? false);
    const row = await sqliteUpsertVideoEngagement({ userId, videoId, favorited });
    const stats = await sqliteGetVideoEngagementStats(videoId);
    return { favorited: row.favorited, stats };
  }

  async setRating(userId: string, videoId: string, rating: number) {
    this.ensureStore();
    await this.ensureVideo(videoId);
    const r = Math.trunc(rating);
    if (r < 1 || r > 5) throw new ApiError(400, 'BAD_REQUEST', 'rating must be 1-5');
    const row = await sqliteUpsertVideoEngagement({ userId, videoId, rating: r });
    const stats = await sqliteGetVideoEngagementStats(videoId);
    return { rating: row.rating, stats };
  }

  async recordView(videoId: string, watchedMs: number, userId?: string) {
    this.ensureStore();
    await this.ensureVideo(videoId);
    if (userId) {
      const cur = await sqliteGetVideoEngagement(userId, videoId);
      await sqliteUpsertVideoEngagement({
        userId,
        videoId,
        watchedMs: (cur?.watchedMs ?? 0) + Math.max(0, watchedMs),
      });
    } else {
      await sqliteRecordAnonymousVideoView(videoId, watchedMs);
    }
    const stats = await sqliteGetVideoEngagementStats(videoId);
    return { stats };
  }

  private async ensureVideo(videoId: string) {
    const v = await this.videos.findById(videoId);
    if (!v || v.visibility !== 'public' || v.status !== 'ready') {
      throw new ApiError(404, 'BAD_REQUEST', 'Video not found');
    }
  }
}
