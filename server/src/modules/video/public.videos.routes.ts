import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { PublicVideosController } from './public.videos.controller';
import { authMiddleware, optionalAuthMiddleware } from '../../middlewares/auth.middleware';

export function createPublicVideosRouter(env: Env) {
  const router = express.Router();
  const c = new PublicVideosController(env);

  router.get('/feed', optionalAuthMiddleware(env), asyncHandler(c.feed));
  router.get('/me/likes', authMiddleware(env), asyncHandler(c.listMyLikes));
  router.get('/', asyncHandler(c.list));
  router.post('/:videoId/like', authMiddleware(env), asyncHandler(c.like));
  router.post('/:videoId/favorite', authMiddleware(env), asyncHandler(c.favorite));
  router.post('/:videoId/rating', authMiddleware(env), asyncHandler(c.rating));
  router.post('/:videoId/view', optionalAuthMiddleware(env), asyncHandler(c.view));
  router.get('/:videoId/playback', asyncHandler(c.playback));
  router.get('/:videoId', asyncHandler(c.getOne));

  return router;
}
