import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { PublicMarketController } from './public.market.controller';

export function createPublicMarketRouter(env: Env) {
  const router = express.Router();
  const c = new PublicMarketController(env);
  router.get('/:cc/games', asyncHandler(c.listGames));
  router.get('/:cc/lists/:listName', asyncHandler(c.getList));
  router.get('/:cc/games/:appid', asyncHandler(c.getGame));
  router.post('/:cc/games/:appid/refresh', asyncHandler(c.refreshGame));
  return router;
}
