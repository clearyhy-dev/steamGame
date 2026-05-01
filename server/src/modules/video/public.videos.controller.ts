import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { getSignedReadUrl } from './gcs.service';
import { VideoRepository } from './video.repository';
import { publicVideoSummary, serializeVideo } from './video.serializer';

export class PublicVideosController {
  constructor(
    private env: Env,
    private videos = new VideoRepository(),
  ) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const rows = await this.videos.listPublicReady(100);
    sendAdminOk(res, rows.map(publicVideoSummary));
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
      });
      return;
    }

    if (!this.env.videoGcsBucket) {
      sendAdminFail(res, 503, 'Playback storage not configured');
      return;
    }

    const objectPath = `videos/${v.videoId}/master.mp4`;
    try {
      const url = await getSignedReadUrl(this.env, objectPath);
      sendAdminOk(res, {
        url,
        expiresInMinutes: this.env.videoSignedUrlMinutes,
        deliveryType: 'processed',
      });
    } catch (e) {
      sendAdminFail(res, 500, e instanceof Error ? e.message : String(e));
    }
  };
}
