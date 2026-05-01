import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { PublicVideosController } from './public.videos.controller';

export function createPublicVideosRouter(env: Env) {
  const router = express.Router();
  const c = new PublicVideosController(env);

  router.get('/', asyncHandler(c.list));
  router.get('/:videoId/playback', asyncHandler(c.playback));
  router.get('/:videoId', asyncHandler(c.getOne));

  return router;
}
