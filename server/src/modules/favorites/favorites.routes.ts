import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { FavoritesController } from './favorites.controller';

export function favoritesRouter(_env: Env) {
  const router = express.Router();

  const controller = new FavoritesController(_env);

  router.get('/', authMiddleware(_env), controller.list);
  router.post('/', authMiddleware(_env), controller.add);
  router.delete('/:appid', authMiddleware(_env), controller.remove);

  return router;
}

