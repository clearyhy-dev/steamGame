import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { VideoSourceRepository } from '../video/video-source.repository';
import { VideoAdminService } from '../video/video-admin.service';
import { serializeVideoSource } from '../video/video.serializer';
import type { IngestMode, SourceType } from '../video/video.types';
import { GameCatalogRepository } from '../game/game-catalog.repository';

export class AdminVideoSourcesController {
  constructor(
    private env: Env,
    private repo = new VideoSourceRepository(),
    private adminSvc = new VideoAdminService(env),
    private catalog = new GameCatalogRepository(),
  ) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const sourceType = req.query.sourceType as SourceType | undefined;
    const gameId = req.query.gameId ? String(req.query.gameId) : undefined;
    const rows = await this.repo.list({ sourceType, gameId });
    const appids = rows.map((x) => String(x.steamAppId ?? x.gameId ?? '').trim()).filter(Boolean);
    const games = await this.catalog.listByAppids(appids);
    const gameMap = new Map(games.map((g) => [g.appid, g]));
    sendAdminOk(
      res,
      rows.map((r) => {
        const appid = String(r.steamAppId ?? r.gameId ?? '').trim();
        const g = gameMap.get(appid);
        return {
          ...serializeVideoSource(r),
          gameHeaderImage: g?.headerImage ?? null,
          gameName: g?.name ?? null,
          gameDescription: g?.shortDescription ?? null,
        };
      }),
    );
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const doc = await this.repo.findById(req.params.sourceId);
    if (!doc) {
      sendAdminFail(res, 404, 'Source not found');
      return;
    }
    sendAdminOk(res, serializeVideoSource(doc));
  };

  createYoutube = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const gameId = String(b.gameId ?? '');
    const title = String(b.title ?? '');
    const sourceUrl = String(b.sourceUrl ?? '');
    const ingestMode = String(b.ingestMode ?? 'process') as IngestMode;
    const priority = Number(b.priority ?? 0);
    const steamAppId = b.steamAppId != null ? String(b.steamAppId) : undefined;

    if (!gameId || !title || !sourceUrl) {
      sendAdminFail(res, 400, 'gameId, title, sourceUrl required');
      return;
    }
    if (ingestMode !== 'embed' && ingestMode !== 'process') {
      sendAdminFail(res, 400, 'ingestMode must be embed or process');
      return;
    }

    const sourceId = await this.repo.create({
      gameId,
      steamAppId,
      sourceType: 'youtube',
      title,
      sourceUrl,
      ingestMode,
      enabled: true,
      priority,
    });
    sendAdminOk(res, { sourceId });
  };

  createSteam = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const steamAppId = String(b.steamAppId ?? '');
    const gameId = steamAppId;
    const title = String(b.title ?? `Steam ${steamAppId}`);
    const ingestMode = String(b.ingestMode ?? 'process') as IngestMode;
    const priority = Number(b.priority ?? 0);

    if (!steamAppId) {
      sendAdminFail(res, 400, 'steamAppId required');
      return;
    }
    if (ingestMode !== 'embed' && ingestMode !== 'process') {
      sendAdminFail(res, 400, 'ingestMode must be embed or process');
      return;
    }

    const existed = await this.repo.findSteamByAppId(steamAppId);
    if (existed) {
      sendAdminFail(res, 409, `Steam source already exists for appid=${steamAppId}`);
      return;
    }

    const sourceId = await this.repo.create({
      gameId,
      steamAppId,
      sourceType: 'steam',
      title,
      sourceUrl: '',
      ingestMode,
      enabled: true,
      priority,
    });
    sendAdminOk(res, { sourceId });
  };

  patch = async (req: Request, res: Response): Promise<void> => {
    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (b.priority != null) patch.priority = Number(b.priority);
    if (typeof b.title === 'string') patch.title = b.title;

    const existing = await this.repo.findById(req.params.sourceId);
    if (!existing) {
      sendAdminFail(res, 404, 'Source not found');
      return;
    }
    await this.repo.update(req.params.sourceId, patch as never);
    sendAdminOk(res, { sourceId: req.params.sourceId });
  };

  ingest = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.adminSvc.ingestFromSource(req.params.sourceId);
      sendAdminOk(res, result);
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : String(e));
    }
  };
}
