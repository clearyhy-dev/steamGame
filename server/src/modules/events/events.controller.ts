import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { logger } from '../../utils/logger';

/** 轻量埋点：写入日志（可后续接 BigQuery / Firestore） */
export class EventsController {
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
    return sendSuccess(res, { ok: true });
  };

  conversion = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    logger.info(JSON.stringify({ event: 'conversion', userId, body: req.body }));
    return sendSuccess(res, { ok: true });
  };
}
