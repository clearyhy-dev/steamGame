import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { FavoritesPricesController } from './favorites-prices.controller';

export function favoritesPricesRouter(env: Env) {
  const router = express.Router();
  const controller = new FavoritesPricesController(env);
  router.get('/prices', authMiddleware(env), controller.list);
  return router;
}
