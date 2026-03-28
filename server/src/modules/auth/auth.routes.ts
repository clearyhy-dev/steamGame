import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { AuthController } from './auth.controller';

export function authRouter(_env: Env) {
  const router = express.Router();

  const controller = new AuthController(_env);

  router.get('/steam/start', controller.startSteam);
  router.get('/steam/callback', controller.callbackSteam);

  router.post('/steam/bind', authMiddleware(_env), controller.bindSteam);
  router.post('/logout', authMiddleware(_env), controller.logout);

  return router;
}

