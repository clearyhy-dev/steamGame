import type { Response } from 'express';
import type { Env } from '../../config/env';
import { FavoritesService } from './favorites.service';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';

export class FavoritesController {
  private svc: FavoritesService;

  constructor(env: Env) {
    this.svc = new FavoritesService(env);
  }

  list = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const items = await this.svc.list(userId);
    return sendSuccess(res, { favorites: items });
  };

  add = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    await this.svc.add(userId, req.body ?? {});
    return sendSuccess(res, { ok: true });
  };

  remove = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const appid = String(req.params.appid ?? '');
    await this.svc.remove(userId, appid);
    return sendSuccess(res, { ok: true });
  };
}

