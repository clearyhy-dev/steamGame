import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { RecommendationsService } from './recommendations.service';

export class RecommendationsController {
  private svc: RecommendationsService;

  constructor(env: Env) {
    this.svc = new RecommendationsService(env);
  }

  home = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const data = await this.svc.getHomeRecommendations(userId);
    return sendSuccess(res, data);
  };

  explore = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const tab = String(req.query.tab ?? 'trending');
    const data = await this.svc.getExplore(userId, tab);
    return sendSuccess(res, data);
  };
}
