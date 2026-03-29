import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { StatsController } from './stats.controller';

export function statsRouter(env: Env) {
  const r = express.Router();
  const c = new StatsController(env);
  r.get('/summary', authMiddleware(env), c.summary);
  r.get('/share-card', authMiddleware(env), c.shareCard);
  return r;
}
