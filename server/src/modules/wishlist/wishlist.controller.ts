import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { WishlistDecisionsService } from './wishlist.service';

export class WishlistController {
  private svc: WishlistDecisionsService;

  constructor(env: Env) {
    this.svc = new WishlistDecisionsService(env);
  }

  decisions = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const data = await this.svc.listDecisions(userId);
    return sendSuccess(res, data);
  };
}
