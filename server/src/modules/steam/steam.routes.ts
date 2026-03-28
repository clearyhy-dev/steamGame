import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { SteamController } from './steam.controller';

export function steamRouter(_env: Env) {
  const router = express.Router();

  const controller = new SteamController(_env);

  router.get('/friends', authMiddleware(_env), controller.friends);
  router.get('/friends/status', authMiddleware(_env), controller.friendsStatus);
  router.get('/games/owned', authMiddleware(_env), controller.gamesOwned);
  router.get('/games/recent', authMiddleware(_env), controller.gamesRecent);
  router.get('/overview', authMiddleware(_env), controller.overview);
  router.post('/sync', authMiddleware(_env), controller.sync);

  return router;
}

