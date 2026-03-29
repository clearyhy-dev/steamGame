import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { StatsService } from './stats.service';

export class StatsController {
  private svc: StatsService;

  constructor(env: Env) {
    this.svc = new StatsService(env);
  }

  summary = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const data = await this.svc.summary(userId);
    return sendSuccess(res, data);
  };

  shareCard = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const data = await this.svc.shareCard(userId);
    return sendSuccess(res, data);
  };
}
