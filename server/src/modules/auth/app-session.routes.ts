import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppSessionController } from './app-session.controller';

export function appSessionRouter(env: Env) {
  const router = express.Router();
  const c = new AppSessionController(env);
  router.post('/app-session', asyncHandler(c.createAppSession));
  return router;
}
