import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { logger } from '../../utils/logger';
import { GameCatalogRepository } from '../game/game-catalog.repository';

/** 轻量埋点：写入日志（可后续接 BigQuery / Firestore） */
export class EventsController {
  private games = new GameCatalogRepository();
  constructor(_env: Env) {}

  exposure = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    logger.info(JSON.stringify({ event: 'exposure', userId, body: req.body }));
    return sendSuccess(res, { ok: true });
  };

  click = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    logger.info(JSON.stringify({ event: 'click', userId, body: req.body }));
    const appid = String(req.body?.appid ?? req.body?.gameId ?? req.body?.targetId ?? '').trim();
    if (appid) {
      try {
        await this.games.increaseClickCount(appid);
      } catch (e) {
        logger.warn(`click_count_update_failed appid=${appid} err=${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return sendSuccess(res, { ok: true });
  };

  conversion = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    logger.info(JSON.stringify({ event: 'conversion', userId, body: req.body }));
    return sendSuccess(res, { ok: true });
  };
}
