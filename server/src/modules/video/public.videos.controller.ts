import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { getSignedReadUrl } from './gcs.service';
import { VideoRepository } from './video.repository';
import { publicVideoSummary, serializeVideo } from './video.serializer';
import { VideoFeedService } from './video-feed.service';
import { VideoEngagementService } from './video-engagement.service';

export class PublicVideosController {
  private feedSvc: VideoFeedService;
  private engagementSvc: VideoEngagementService;

  constructor(
    private env: Env,
    private videos = new VideoRepository(),
  ) {
    this.feedSvc = new VideoFeedService(env);
    this.engagementSvc = new VideoEngagementService(env);
  }

  list = async (_req: Request, res: Response): Promise<void> => {
    const rows = await this.videos.listPublicReady(100);
    sendAdminOk(res, rows.map(publicVideoSummary));
  };

  feed = async (req: AuthedRequest, res: Response): Promise<void> => {
    const cursor = req.query.cursor != null ? String(req.query.cursor) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const country = req.query.country != null ? String(req.query.country) : undefined;
    const out = await this.feedSvc.listFeed({
      cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
      country,
      userId: req.auth?.userId,
    });
    sendAdminOk(res, out);
  };

  listMyLikes = async (req: AuthedRequest, res: Response): Promise<void> => {
    const userId = req.auth?.userId;
    if (!userId) {
      sendAdminFail(res, 401, 'Unauthorized');
      return;
    }
    const country = req.query.country != null ? String(req.query.country) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
    const out = await this.feedSvc.listUserLikedVideos({
      userId,
      country,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    sendAdminOk(res, out);
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const v = await this.videos.findById(req.params.videoId);
    if (!v || v.visibility !== 'public' || v.status !== 'ready') {
      sendAdminFail(res, 404, 'Video not found');
      return;
    }
    sendAdminOk(res, serializeVideo(v));
  };

  playback = async (req: Request, res: Response): Promise<void> => {
    const v = await this.videos.findById(req.params.videoId);
    if (!v || v.visibility !== 'public' || v.status !== 'ready') {
      sendAdminFail(res, 404, 'Video not found');
      return;
    }

    if (v.deliveryType === 'embed') {
      sendAdminOk(res, {
        url: v.playbackUrl ?? '',
        expiresInMinutes: null,
        deliveryType: 'embed',
        variant: 'embed',
      });
      return;
    }

    if (!this.env.videoGcsBucket && !this.env.s3Bucket) {
      sendAdminFail(res, 503, 'Playback storage not configured');
      return;
    }

    const variant = String(req.query.variant ?? 'master').trim().toLowerCase();
    const vertical = variant === 'vertical' || variant === 'vertical_9_16';
    const verticalVariant = (v.variants ?? []).find((x) => x.name === 'vertical_9_16');
    const masterVariant = (v.variants ?? []).find((x) => x.name === 'master');
    const verticalHasAudio =
      v.verticalHasAudio === true ||
      verticalVariant?.hasAudio === true ||
      (v.verticalHasAudio !== false && verticalVariant?.hasAudio !== false && v.audioPresent !== false);
    const masterHasAudio =
      v.audioPresent === true || masterVariant?.hasAudio === true || v.audioPresent !== false;

    const useVertical =
      vertical && verticalVariant?.storagePath && verticalHasAudio;
    const objectPath = useVertical
      ? this.storagePathToObject(verticalVariant!.storagePath!, v.videoId, 'vertical_9_16.mp4')
      : `videos/${v.videoId}/master.mp4`;
    const selectedHasAudio = useVertical ? verticalHasAudio : masterHasAudio;

    try {
      const url = await getSignedReadUrl(this.env, objectPath);
      sendAdminOk(res, {
        url,
        expiresInMinutes: this.env.videoSignedUrlMinutes,
        deliveryType: 'processed',
        variant: useVertical ? 'vertical_9_16' : 'master',
        hasAudio: selectedHasAudio,
      });
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : String(e));
    }
  };

  like = async (req: AuthedRequest, res: Response): Promise<void> => {
    const userId = req.auth?.userId;
    if (!userId) {
      sendAdminFail(res, 401, 'Unauthorized');
      return;
    }
    const out = await this.engagementSvc.toggleLike(userId, req.params.videoId);
    sendAdminOk(res, out);
  };

  favorite = async (req: AuthedRequest, res: Response): Promise<void> => {
    const userId = req.auth?.userId;
    if (!userId) {
      sendAdminFail(res, 401, 'Unauthorized');
      return;
    }
    const out = await this.engagementSvc.toggleFavorite(userId, req.params.videoId);
    sendAdminOk(res, out);
  };

  rating = async (req: AuthedRequest, res: Response): Promise<void> => {
    const userId = req.auth?.userId;
    if (!userId) {
      sendAdminFail(res, 401, 'Unauthorized');
      return;
    }
    const rating = Number(req.body?.rating);
    const out = await this.engagementSvc.setRating(userId, req.params.videoId, rating);
    sendAdminOk(res, out);
  };

  view = async (req: AuthedRequest, res: Response): Promise<void> => {
    const watchedMs = Number(req.body?.watchedMs ?? req.body?.watched_ms ?? 0);
    const out = await this.engagementSvc.recordView(
      req.params.videoId,
      Number.isFinite(watchedMs) ? watchedMs : 0,
      req.auth?.userId,
    );
    sendAdminOk(res, out);
  };

  private storagePathToObject(storagePath: string, videoId: string, fallbackFile: string): string {
    const gsPrefix = `gs://${this.env.videoGcsBucket ?? this.env.s3Bucket ?? ''}/`;
    if (storagePath.startsWith(gsPrefix)) {
      return storagePath.slice(gsPrefix.length);
    }
    if (storagePath.includes('/')) return storagePath.replace(/^gs:\/\/[^/]+\//, '');
    return `videos/${videoId}/${fallbackFile}`;
  }
}
