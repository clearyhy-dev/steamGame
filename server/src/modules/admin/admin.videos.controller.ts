import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { VideoRepository } from '../video/video.repository';
import { VideoSourceRepository } from '../video/video-source.repository';
import { VideoAdminService } from '../video/video-admin.service';
import { serializeVideo, serializeVideoSource } from '../video/video.serializer';
import type { VideoStatus, Visibility } from '../video/video.types';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import type { AdminAuthedRequest } from './adminAuth.middleware';

export class AdminVideosController {
  constructor(
    private env: Env,
    private videos = new VideoRepository(),
    private sources = new VideoSourceRepository(),
    private adminSvc = new VideoAdminService(env),
    private catalog = new GameCatalogRepository(),
  ) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const status = req.query.status as VideoStatus | undefined;
    const visibility = req.query.visibility as Visibility | undefined;
    const gameId = req.query.gameId ? String(req.query.gameId) : undefined;
    const rows = await this.videos.list({ status, visibility, gameId });
    const appids = rows.map((r) => String(r.gameId ?? '').trim()).filter(Boolean);
    const games = await this.catalog.listByAppids(appids);
    const gameMap = new Map(games.map((g) => [g.appid, g]));
    sendAdminOk(
      res,
      rows.map((r) => {
        const g = gameMap.get(String(r.gameId ?? '').trim());
        return {
          ...serializeVideo(r),
          gameName: g?.name ?? null,
        };
      }),
    );
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const video = await this.videos.findById(req.params.videoId);
    if (!video) {
      sendAdminFail(res, 404, 'Video not found');
      return;
    }
    const source = await this.sources.findById(video.sourceId);
    sendAdminOk(res, {
      video: serializeVideo(video),
      source: source ? serializeVideoSource(source) : null,
    });
  };

  publish = async (req: AdminAuthedRequest, res: Response): Promise<void> => {
    try {
      await this.adminSvc.publish(req.params.videoId, req.admin?.username ?? 'admin');
      sendAdminOk(res, { videoId: req.params.videoId });
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : String(e));
    }
  };

  unpublish = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.adminSvc.unpublish(req.params.videoId);
      sendAdminOk(res, { videoId: req.params.videoId });
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : String(e));
    }
  };

  reprocess = async (req: Request, res: Response): Promise<void> => {
    try {
      const out = await this.adminSvc.reprocess(req.params.videoId);
      sendAdminOk(res, out);
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : String(e));
    }
  };
}
