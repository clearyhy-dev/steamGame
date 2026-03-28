import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { UsersController } from './users.controller';

export function usersRouter(_env: Env) {
  const router = express.Router();

  const controller = new UsersController(_env);

  router.get('/me', authMiddleware(_env), controller.me);
  router.get('/me/steam-profile', authMiddleware(_env), controller.steamProfile);

  return router;
}

