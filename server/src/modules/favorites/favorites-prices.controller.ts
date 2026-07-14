import type { Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';
import { FavoritesPricesService } from './favorites-prices.service';

export class FavoritesPricesController {
  private svc: FavoritesPricesService;

  constructor(env: Env) {
    this.svc = new FavoritesPricesService(env);
  }

  list = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const country = req.query.country != null ? String(req.query.country) : undefined;
    const out = await this.svc.listPrices(userId, country);
    return sendSuccess(res, out);
  };
}
