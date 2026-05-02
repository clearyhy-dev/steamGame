import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { PublicGamesController } from './public.games.controller';

export function createPublicGamesRouter(env: Env) {
  const router = express.Router();
  const c = new PublicGamesController(env);
  router.get('/:appid/steam-price', asyncHandler(c.steamPrice));
  router.get('/:appid/discount-link', asyncHandler(c.discountLink));
  router.get('/:appid/deals', asyncHandler(c.listDeals));
  router.post('/:appid/ensure-meta', asyncHandler(c.ensureMeta));
  router.post('/:appid/refresh-deals', asyncHandler(c.refreshDeals));
  return router;
}

